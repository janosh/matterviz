// Bonding algorithms for structure visualization

import { element_data } from '$lib/element'
import type { ElementSymbol } from '$lib/element'
import type { Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, BondOrder, BondPair, Site, StructureBond } from '$lib/structure'

type SpatialGrid = Map<number, number[]>

// Shared per-symbol element data lookup (also used by pbc.ts and polyhedra.ts)
export const element_lookup = new Map(element_data.map((el) => [el.symbol, el]))
const covalent_radii = new Map<string, number>(
  element_data.flatMap((el) =>
    el.covalent_radius === null ? [] : [[el.symbol, el.covalent_radius]],
  ),
)

// Majority-occupancy element of a (possibly disordered) site
export const get_majority_element = (site: Site | undefined): ElementSymbol | null => {
  if (!site?.species?.length) return null
  return site.species.reduce((max, spec) => (spec.occu > max.occu ? spec : max)).element
}

const is_zero_cell_shift = (cell_shift: Vec3 | undefined): boolean =>
  cell_shift === undefined || cell_shift.every((val) => val === 0)

const format_cell_shift = (cell_shift: Vec3 | undefined): string => {
  if (cell_shift === undefined || is_zero_cell_shift(cell_shift)) return ``
  return `@${cell_shift.join(`,`)}`
}

const negate_cell_shift = (cell_shift: Vec3): Vec3 => [
  cell_shift[0] === 0 ? 0 : -cell_shift[0],
  cell_shift[1] === 0 ? 0 : -cell_shift[1],
  cell_shift[2] === 0 ? 0 : -cell_shift[2],
]

const canonical_self_bond_shift = (cell_shift: Vec3): Vec3 => {
  const first_non_zero = cell_shift.find((val) => val !== 0)
  return first_non_zero !== undefined && first_non_zero < 0
    ? negate_cell_shift(cell_shift)
    : cell_shift
}

const normalize_bond_endpoints = (
  site_idx_1: number,
  site_idx_2: number,
  cell_shift?: Vec3,
): Pick<StructureBond, `site_idx_1` | `site_idx_2` | `cell_shift`> => {
  if (site_idx_1 === site_idx_2) {
    const ordered = { site_idx_1, site_idx_2 }
    if (cell_shift === undefined || is_zero_cell_shift(cell_shift)) return ordered
    return { ...ordered, cell_shift: canonical_self_bond_shift(cell_shift) }
  }
  const ordered =
    site_idx_1 < site_idx_2
      ? { site_idx_1, site_idx_2 }
      : { site_idx_1: site_idx_2, site_idx_2: site_idx_1 }
  if (cell_shift === undefined || is_zero_cell_shift(cell_shift)) return ordered
  return {
    ...ordered,
    cell_shift: site_idx_1 < site_idx_2 ? cell_shift : negate_cell_shift(cell_shift),
  }
}

export const normalize_structure_bond = (
  site_idx_1: number,
  site_idx_2: number,
  order: BondOrder,
  cell_shift?: Vec3,
): StructureBond => {
  const bond = normalize_bond_endpoints(site_idx_1, site_idx_2, cell_shift)
  return { ...bond, order }
}

export const get_bond_key = (idx_1: number, idx_2: number, cell_shift?: Vec3): string => {
  const normalized = normalize_bond_endpoints(idx_1, idx_2, cell_shift)
  return `${normalized.site_idx_1}-${normalized.site_idx_2}${format_cell_shift(
    normalized.cell_shift,
  )}`
}

// Remap explicit bond metadata after site deletion: drop bonds touching deleted
// sites and shift each surviving index down by the number of deleted indices below it.
export function remap_bonds_after_deletion(
  bonds: readonly StructureBond[],
  deleted_indices: ReadonlySet<number>,
): StructureBond[] {
  // Sort the deleted indices once; shift each surviving index down by the count of deleted
  // indices below it via binary search (O(log m) per lookup vs re-filtering the set each call).
  const sorted = [...deleted_indices].sort((idx_a, idx_b) => idx_a - idx_b)
  const shift = (idx: number) => {
    let [lo, hi] = [0, sorted.length]
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < idx) lo = mid + 1
      else hi = mid
    }
    return idx - lo // lo == count of deleted indices < idx
  }
  return bonds
    .filter(
      (bond) => !deleted_indices.has(bond.site_idx_1) && !deleted_indices.has(bond.site_idx_2),
    )
    .map((bond) => ({
      ...bond,
      site_idx_1: shift(bond.site_idx_1),
      site_idx_2: shift(bond.site_idx_2),
    }))
}

export type BondEditState = {
  added_bonds: StructureBond[]
  removed_bonds: StructureBond[]
  bond_order_overrides: StructureBond[]
}

export type BondEditAction =
  | `added`
  | `already-visible`
  | `deleted-added`
  | `deleted-calculated`
  | `not-visible`
  | `ordered-added`
  | `ordered-calculated`
  | `restored`

export type BondEditResult = {
  action: BondEditAction
  changed: boolean
  state: BondEditState
}

export type BondKeyTarget = Pick<StructureBond, `site_idx_1` | `site_idx_2` | `cell_shift`>
type BondOrderTarget = BondKeyTarget & {
  bond_order?: BondOrder
  order?: BondOrder
}

export const BOND_ORDER_OPTIONS: { order: BondOrder; label: string }[] = [
  { order: 1, label: `Single` },
  { order: 1.5, label: `1.5` },
  { order: 2, label: `Double` },
  { order: 3, label: `Triple` },
  { order: `aromatic`, label: `Aromatic` },
]

const site_image_shift = (sites: Site[] | undefined, site_idx: number): Vec3 => {
  const site = sites?.[site_idx]
  const orig_site_idx = site?.properties?.orig_site_idx
  if (typeof orig_site_idx !== `number`) return [0, 0, 0]
  const orig_site = sites?.[orig_site_idx]
  if (!site?.abc || !orig_site?.abc) return [0, 0, 0]
  return [
    Math.round(site.abc[0] - orig_site.abc[0]),
    Math.round(site.abc[1] - orig_site.abc[1]),
    Math.round(site.abc[2] - orig_site.abc[2]),
  ]
}

const original_site_idx = (sites: Site[] | undefined, site_idx: number): number => {
  const orig_site_idx = sites?.[site_idx]?.properties?.orig_site_idx
  return typeof orig_site_idx === `number` ? orig_site_idx : site_idx
}

export const canonicalize_bond_target = (
  bond: BondKeyTarget,
  sites: Site[] | undefined,
): BondKeyTarget => {
  const shift_1 = site_image_shift(sites, bond.site_idx_1)
  const shift_2 = site_image_shift(sites, bond.site_idx_2)
  const base_shift = bond.cell_shift ?? [0, 0, 0]
  const cell_shift: Vec3 = [
    base_shift[0] + shift_2[0] - shift_1[0],
    base_shift[1] + shift_2[1] - shift_1[1],
    base_shift[2] + shift_2[2] - shift_1[2],
  ]
  return normalize_bond_endpoints(
    original_site_idx(sites, bond.site_idx_1),
    original_site_idx(sites, bond.site_idx_2),
    cell_shift,
  )
}

const bond_key_for = (bond: BondKeyTarget): string =>
  get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)

const matches_bond_key = (bond: BondKeyTarget, key: string): boolean =>
  bond_key_for(bond) === key

const replace_bond = (bonds: StructureBond[], next_bond: StructureBond): StructureBond[] => {
  const key = bond_key_for(next_bond)
  return [...bonds.filter((bond) => !matches_bond_key(bond, key)), next_bond]
}

const remove_bond_key = (bonds: StructureBond[], key: string): StructureBond[] =>
  bonds.filter((bond) => !matches_bond_key(bond, key))

const includes_bond_key = (bonds: BondKeyTarget[], key: string): boolean =>
  bonds.some((bond) => matches_bond_key(bond, key))

const get_bond_order = (bond: BondOrderTarget | undefined): BondOrder =>
  bond?.bond_order ?? bond?.order ?? 1

const find_bond_by_key = <BondType extends BondKeyTarget>(
  bonds: BondType[],
  key: string,
): BondType | undefined => bonds.find((bond) => matches_bond_key(bond, key))

const make_bond_record = (bond: BondKeyTarget, order: BondOrder): StructureBond =>
  normalize_structure_bond(bond.site_idx_1, bond.site_idx_2, order, bond.cell_shift)

export function has_visible_bond(
  edit_state: BondEditState,
  bond: BondKeyTarget,
  calculated_bonds: BondOrderTarget[],
): boolean {
  const key = bond_key_for(bond)
  if (includes_bond_key(edit_state.removed_bonds, key)) {
    return false
  }
  if (includes_bond_key(edit_state.added_bonds, key)) return true
  return includes_bond_key(calculated_bonds, key)
}

export function add_or_restore_bond(
  edit_state: BondEditState,
  bond: BondKeyTarget,
  calculated_bonds: BondOrderTarget[],
  order: BondOrder,
): BondEditResult {
  const record = make_bond_record(bond, order)
  const key = bond_key_for(record)
  const removed_bond = find_bond_by_key(edit_state.removed_bonds, key)
  if (removed_bond) {
    return {
      action: `restored`,
      changed: true,
      state: {
        ...edit_state,
        added_bonds: remove_bond_key(edit_state.added_bonds, key),
        removed_bonds: remove_bond_key(edit_state.removed_bonds, key),
        bond_order_overrides:
          removed_bond.order === order
            ? remove_bond_key(edit_state.bond_order_overrides, key)
            : replace_bond(edit_state.bond_order_overrides, record),
      },
    }
  }
  if (has_visible_bond(edit_state, record, calculated_bonds)) {
    return { action: `already-visible`, changed: false, state: edit_state }
  }
  return {
    action: `added`,
    changed: true,
    state: {
      ...edit_state,
      added_bonds: replace_bond(edit_state.added_bonds, record),
      bond_order_overrides: remove_bond_key(edit_state.bond_order_overrides, key),
    },
  }
}

export function delete_bond(
  edit_state: BondEditState,
  bond: BondKeyTarget,
  calculated_bonds: BondOrderTarget[],
): BondEditResult {
  const record = make_bond_record(bond, 1)
  const key = bond_key_for(record)
  if (includes_bond_key(edit_state.added_bonds, key)) {
    return {
      action: `deleted-added`,
      changed: true,
      state: {
        ...edit_state,
        added_bonds: remove_bond_key(edit_state.added_bonds, key),
        bond_order_overrides: remove_bond_key(edit_state.bond_order_overrides, key),
      },
    }
  }
  const calculated = find_bond_by_key(calculated_bonds, key)
  if (!calculated || includes_bond_key(edit_state.removed_bonds, key)) {
    return { action: `not-visible`, changed: false, state: edit_state }
  }
  return {
    action: `deleted-calculated`,
    changed: true,
    state: {
      ...edit_state,
      removed_bonds: replace_bond(edit_state.removed_bonds, {
        ...record,
        order: get_bond_order(calculated),
      }),
      bond_order_overrides: remove_bond_key(edit_state.bond_order_overrides, key),
    },
  }
}

export function set_bond_order(
  edit_state: BondEditState,
  bond: BondKeyTarget,
  calculated_bonds: BondOrderTarget[],
  order: BondOrder,
): BondEditResult {
  const record = make_bond_record(bond, order)
  const key = bond_key_for(record)
  const calculated = find_bond_by_key(calculated_bonds, key)
  if (calculated) {
    const visible_order = get_bond_order(calculated)
    const has_existing_edit =
      includes_bond_key(edit_state.added_bonds, key) ||
      includes_bond_key(edit_state.removed_bonds, key) ||
      includes_bond_key(edit_state.bond_order_overrides, key)
    const next_overrides =
      order === visible_order
        ? remove_bond_key(edit_state.bond_order_overrides, key)
        : replace_bond(edit_state.bond_order_overrides, record)
    const next_state = {
      added_bonds: remove_bond_key(edit_state.added_bonds, key),
      removed_bonds: remove_bond_key(edit_state.removed_bonds, key),
      bond_order_overrides: next_overrides,
    }
    return {
      action: `ordered-calculated`,
      changed: has_existing_edit || order !== visible_order,
      state: next_state,
    }
  }
  return {
    action: `ordered-added`,
    changed: true,
    state: {
      ...edit_state,
      added_bonds: replace_bond(edit_state.added_bonds, record),
      bond_order_overrides: remove_bond_key(edit_state.bond_order_overrides, key),
    },
  }
}

export const merge_bond_edits = (
  base_bonds: StructureBond[],
  added: StructureBond[],
  removed: StructureBond[],
  overrides: StructureBond[],
): StructureBond[] => {
  const key_for = (bond: StructureBond): string =>
    get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)
  const normalize_record = (bond: StructureBond): StructureBond =>
    normalize_structure_bond(bond.site_idx_1, bond.site_idx_2, bond.order, bond.cell_shift)
  const removed_keys = new Set(removed.map(key_for))
  const merged = new Map(
    base_bonds
      .filter((bond) => !removed_keys.has(key_for(bond)))
      .map((bond) => [key_for(bond), normalize_record(bond)]),
  )
  // Apply additions before overrides so user-set bond orders win even if
  // callers accidentally pass overlapping edit lists.
  for (const bond of added) {
    if (!removed_keys.has(key_for(bond))) merged.set(key_for(bond), normalize_record(bond))
  }
  for (const bond of overrides) {
    if (!removed_keys.has(key_for(bond))) merged.set(key_for(bond), normalize_record(bond))
  }
  return [...merged.values()]
}

const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === `object` && value !== null

export function normalize_bond_order(order: unknown): BondOrder | null {
  if (order === `aromatic`) return order
  if (order === 1 || order === 1.5 || order === 2 || order === 3) return order
  return null
}

function normalize_cell_shift(cell_shift: unknown): Vec3 | undefined | null {
  if (cell_shift === undefined) return undefined
  if (!Array.isArray(cell_shift) || cell_shift.length !== 3) return null
  return cell_shift.some((val) => typeof val !== `number` || !Number.isInteger(val))
    ? null
    : [cell_shift[0], cell_shift[1], cell_shift[2]]
}

function lattice_translation(structure: AnyStructure, cell_shift: Vec3 | undefined): Vec3 {
  if (cell_shift === undefined || is_zero_cell_shift(cell_shift)) return [0, 0, 0]
  if (!(`lattice` in structure)) {
    throw new Error(`Explicit bond cell_shift requires a crystal lattice`)
  }
  const [shift_a, shift_b, shift_c] = cell_shift
  const [vec_a, vec_b, vec_c] = structure.lattice.matrix
  return math.add(
    math.scale(vec_a, shift_a),
    math.scale(vec_b, shift_b),
    math.scale(vec_c, shift_c),
  )
}

export function structure_bond_to_bond_pair(
  structure: AnyStructure,
  bond: StructureBond,
): BondPair {
  const { site_idx_1, site_idx_2, order, cell_shift } = bond
  const site_1 = structure.sites[site_idx_1]
  const site_2 = structure.sites[site_idx_2]
  if (!site_1 || !site_2) {
    throw new Error(
      `Cannot create bond pair for invalid site indices ${site_idx_1}, ${site_idx_2}`,
    )
  }
  const pos_1 = site_1.xyz
  const pos_2 = math.add(site_2.xyz, lattice_translation(structure, cell_shift))
  return {
    pos_1,
    pos_2,
    site_idx_1,
    site_idx_2,
    bond_length: math.euclidean_dist(pos_1, pos_2),
    strength: 1,
    bond_order: order,
    cell_shift,
    transform_matrix: compute_bond_transform(pos_1, pos_2),
  }
}

export function get_explicit_bond_metadata(structure: AnyStructure): StructureBond[] {
  const raw_bonds = structure.properties?.bonds
  if (raw_bonds === undefined) return []
  if (!Array.isArray(raw_bonds)) {
    console.warn(`Ignoring structure.properties.bonds because it is not an array`)
    return []
  }

  const explicit_bonds = new Map<string, StructureBond>()
  for (const [entry_idx, raw_bond] of raw_bonds.entries()) {
    if (!is_record(raw_bond)) {
      console.warn(`Ignoring invalid explicit bond at index ${entry_idx}: expected object`)
      continue
    }
    const { order } = raw_bond
    const site_idx_1 = raw_bond.site_idx_1
    const site_idx_2 = raw_bond.site_idx_2
    if (
      typeof site_idx_1 !== `number` ||
      typeof site_idx_2 !== `number` ||
      !Number.isInteger(site_idx_1) ||
      !Number.isInteger(site_idx_2)
    ) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: site indices must be integers`,
      )
      continue
    }
    if (
      site_idx_1 < 0 ||
      site_idx_2 < 0 ||
      site_idx_1 >= structure.sites.length ||
      site_idx_2 >= structure.sites.length
    ) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: site indices ${
          site_idx_1
        }, ${site_idx_2} are out of range for ${structure.sites.length} sites`,
      )
      continue
    }
    const bond_order = normalize_bond_order(order)
    if (bond_order === null) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: unsupported order ${String(
          order,
        )}`,
      )
      continue
    }
    const cell_shift = normalize_cell_shift(raw_bond.cell_shift)
    if (cell_shift === null) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: cell_shift must be three integers`,
      )
      continue
    }
    if (site_idx_1 === site_idx_2 && is_zero_cell_shift(cell_shift)) {
      console.warn(`Ignoring invalid explicit bond at index ${entry_idx}: endpoints match`)
      continue
    }
    if (
      cell_shift !== undefined &&
      !is_zero_cell_shift(cell_shift) &&
      !(`lattice` in structure)
    ) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: cell_shift requires a crystal lattice`,
      )
      continue
    }

    const key = get_bond_key(site_idx_1, site_idx_2, cell_shift)
    if (explicit_bonds.has(key)) {
      console.warn(
        `Duplicate explicit bond definition at index ${entry_idx} for site indices ${
          site_idx_1
        }, ${site_idx_2} with order ${bond_order}; will overwrite the previous entry`,
      )
    }
    explicit_bonds.set(
      key,
      normalize_structure_bond(site_idx_1, site_idx_2, bond_order, cell_shift),
    )
  }
  return [...explicit_bonds.values()]
}

export function apply_explicit_bond_metadata(
  structure: AnyStructure,
  bonds: BondPair[],
): BondPair[] {
  const explicit_bonds = get_explicit_bond_metadata(structure)
  if (explicit_bonds.length === 0) return bonds

  const explicit_by_key = new Map(
    explicit_bonds.map((bond) => [
      get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift),
      bond,
    ]),
  )
  const merged = bonds.map((bond) => {
    const key = get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)
    const explicit = explicit_by_key.get(key)
    if (!explicit) return bond
    explicit_by_key.delete(key)
    return { ...bond, bond_order: explicit.order }
  })

  for (const explicit_bond of explicit_by_key.values()) {
    merged.push(structure_bond_to_bond_pair(structure, explicit_bond))
  }

  return merged
}

export function scale_and_offset_bond_matrix(
  transform_matrix: Float32Array,
  offset: number,
  radius_scale: number,
): Float32Array {
  const matrix = new Float32Array(transform_matrix)
  // Column-major 4x4 layout: 0-2 are the right vector, 8-10 are the forward
  // vector. Scale orientation columns for cylinder radius, not translation.
  for (const matrix_idx of [0, 1, 2, 8, 9, 10]) {
    matrix[matrix_idx] *= radius_scale
  }

  const right_len = Math.hypot(matrix[0], matrix[1], matrix[2]) || 1
  const offset_dir: Vec3 = [
    matrix[0] / right_len,
    matrix[1] / right_len,
    matrix[2] / right_len,
  ]
  matrix[12] += offset_dir[0] * offset
  matrix[13] += offset_dir[1] * offset
  matrix[14] += offset_dir[2] * offset
  return matrix
}

export function get_bond_render_matrices(
  bond: BondPair,
  bond_thickness: number,
): Float32Array[] {
  const order = bond.bond_order ?? 1
  const gap = bond_thickness * 1.8
  // Parallel cylinder [offset, radius_scale] pairs per bond order; empty → a single
  // full-width bond (handled by the fallback below)
  let offsets_and_scales: Vec2[] = []
  if (order === 2)
    offsets_and_scales = [
      [-gap / 2, 0.65],
      [gap / 2, 0.65],
    ]
  else if (order === 3)
    offsets_and_scales = [
      [-gap, 0.55],
      [0, 0.55],
      [gap, 0.55],
    ]
  else if (order === 1.5 || order === `aromatic`) {
    offsets_and_scales = [
      [-gap / 2, 0.75],
      [gap / 2, 0.4],
    ]
  }
  return offsets_and_scales.length === 0
    ? [bond.transform_matrix]
    : offsets_and_scales.map(([offset, radius_scale]) =>
        scale_and_offset_bond_matrix(bond.transform_matrix, offset, radius_scale),
      )
}

// Helper to extract numeric index from site properties
function get_orig_idx(site: Site, fallback: number): number {
  const props = site.properties
  if (!props) return fallback

  const raw = props.orig_unit_cell_idx ?? props.orig_site_idx
  if (raw === undefined) return fallback

  const num = Number(raw)
  return Number.isFinite(num) ? num : fallback
}

// Compute 4x4 transformation matrix for bond cylinder between two positions.
// Uses Y-up, right-handed coordinate system convention for Three.js compatibility.
export function compute_bond_transform(pos_1: Vec3, pos_2: Vec3): Float32Array {
  const [dx, dy, dz] = math.subtract(pos_2, pos_1)
  const height = Math.hypot(dx, dy, dz)

  if (height < 1e-10) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  }

  const [dir_x, dir_y, dir_z] = [dx / height, dy / height, dz / height]
  let [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [0, 0, 0, 0, 0, 0, 0, 0, 0]

  // Special case: bond pointing straight up (+Y)
  if (Math.abs(dir_y - 1.0) < 1e-10) {
    ;[m00, m01, m02, m10, m11, m12, m20, m21, m22] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  } else if (Math.abs(dir_y + 1.0) < 1e-10) {
    // Special case: bond pointing straight down (-Y)
    ;[m00, m01, m02, m10, m11, m12, m20, m21, m22] = [1, 0, 0, 0, -1, 0, 0, 0, 1]
  } else {
    // General case: construct orthonormal basis (right, dir, up)
    // Right vector: perpendicular to dir in XZ plane
    const [rx, rz] = [-dir_z, dir_x]
    const r_len = Math.hypot(rx, rz)
    const [right_x, right_z] = [rx / r_len, rz / r_len]
    // Up vector: cross product of dir and right
    const [up_x, up_y, up_z] = [
      dir_y * right_z,
      dir_z * right_x - dir_x * right_z,
      -dir_y * right_x,
    ]
    ;[m00, m01, m02, m10, m11, m12, m20, m21, m22] = [
      right_x,
      dir_x,
      up_x,
      0,
      dir_y,
      up_y,
      right_z,
      dir_z,
      up_z,
    ]
  }

  // Position at midpoint between the two atoms
  const [px, py, pz] = [
    (pos_1[0] + pos_2[0]) / 2,
    (pos_1[1] + pos_2[1]) / 2,
    (pos_1[2] + pos_2[2]) / 2,
  ]

  return new Float32Array([
    // Return flattened column-major 4x4 matrix for Three.js
    m00,
    m10,
    m20,
    0,
    m01 * height,
    m11 * height,
    m21 * height,
    0,
    m02,
    m12,
    m22,
    0,
    px,
    py,
    pz,
    1,
  ])
}

// Build a BondPair between two sites (shared by electroneg_ratio and solid_angle)
const make_bond = (
  sites: Site[],
  idx_1: number,
  idx_2: number,
  bond_length: number,
  strength: number,
): BondPair => ({
  pos_1: sites[idx_1].xyz,
  pos_2: sites[idx_2].xyz,
  site_idx_1: idx_1,
  site_idx_2: idx_2,
  bond_length,
  strength,
  transform_matrix: compute_bond_transform(sites[idx_1].xyz, sites[idx_2].xyz),
})

// Pack quantized cell coordinates into one integer key (exact for cell coords in
// [-512, 511], i.e. structures up to ~1000 cells per axis - far beyond any real
// case). Integer Map keys avoid per-lookup string building in the hot pair loop.
const CELL_OFFSET = 512
const pack_cell_key = (x: number, y: number, z: number): number =>
  (x + CELL_OFFSET) * 1048576 + (y + CELL_OFFSET) * 1024 + (z + CELL_OFFSET)

// Build spatial grid by dividing 3D space into cubic cells.
function build_spatial_grid(sites: Site[], cell_size: number): SpatialGrid {
  const grid: SpatialGrid = new Map()
  for (let idx = 0; idx < sites.length; idx++) {
    const key = pack_cell_key(
      Math.floor(sites[idx].xyz[0] / cell_size),
      Math.floor(sites[idx].xyz[1] / cell_size),
      Math.floor(sites[idx].xyz[2] / cell_size),
    )
    const cell = grid.get(key)
    if (cell) cell.push(idx)
    else grid.set(key, [idx])
  }
  return grid
}

// Get all site indices in 3x3x3 cube of cells around position.
function get_neighbors_from_grid(pos: Vec3, grid: SpatialGrid, cell_size: number): number[] {
  const [cx, cy, cz] = [
    Math.floor(pos[0] / cell_size),
    Math.floor(pos[1] / cell_size),
    Math.floor(pos[2] / cell_size),
  ]
  const neighbors: number[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(pack_cell_key(cx + dx, cy + dy, cz + dz))
        if (cell) for (const idx of cell) neighbors.push(idx)
      }
    }
  }
  return neighbors
}

// Setup spatial decomposition for structures with >50 atoms.
function setup_spatial_grid(sites: Site[], cutoff: number) {
  const use_grid = sites.length > 50
  return use_grid ? { grid: build_spatial_grid(sites, cutoff), cell_size: cutoff } : null
}

// Get candidate neighbor indices using spatial grid or all sites.
const get_candidates = (
  pos: Vec3,
  sites: Site[],
  spatial: ReturnType<typeof setup_spatial_grid>,
): number[] =>
  spatial
    ? get_neighbors_from_grid(pos, spatial.grid, spatial.cell_size)
    : Array.from({ length: sites.length }, (_, idx) => idx)

export const BONDING_STRATEGIES = { electroneg_ratio, solid_angle } as const
export type BondingStrategy = keyof typeof BONDING_STRATEGIES
export type BondingAlgo = (typeof BONDING_STRATEGIES)[BondingStrategy]

// Electronegativity-based bonding with chemical preferences.
// This algorithm considers electronegativity differences between atoms, metal/nonmetal
// properties, and distance to determine bond strength. Bonds are only created if the
// computed strength exceeds the strength_threshold parameter (default: 0.3).
export function electroneg_ratio(
  structure: AnyStructure,
  {
    electronegativity_threshold = 1.7, // Max electronegativity difference for bonding
    max_distance_ratio = 2.0, // Max distance as multiple of sum of covalent radii
    min_bond_dist = 0.4, // Minimum bond distance in Angstroms
    metal_metal_penalty = 0.7, // Strength penalty for metal-metal bonds
    metal_nonmetal_bonus = 1.5, // Strength bonus for metal-nonmetal bonds
    similar_electronegativity_bonus = 1.2, // Bonus for similar electronegativity
    same_species_penalty = 0.5, // Penalty for bonds between same element
    strength_threshold = 0.3, // Minimum bond strength to include in results
  } = {},
): BondPair[] {
  const { sites } = structure
  if (sites.length < 2) return []

  const bonds: BondPair[] = []
  const min_dist_sq = min_bond_dist ** 2

  // Per-site properties in flat typed arrays - the pair loop below visits
  // millions of candidate pairs in large supercells, so object property chains
  // and Map lookups are replaced with indexed array reads.
  const n_sites = sites.length
  const electronegs = new Float64Array(n_sites)
  const radii = new Float64Array(n_sites) // 0 = no covalent radius known
  const metal_flags = new Uint8Array(n_sites)
  const nonmetal_flags = new Uint8Array(n_sites)
  const elem_ids = new Int32Array(n_sites) // same-species check via integer ids
  const orig_idxs = new Int32Array(n_sites)
  const elem_id_lookup = new Map<string, number>()
  for (let idx = 0; idx < n_sites; idx++) {
    const elem = get_majority_element(sites[idx])
    const data = elem ? element_lookup.get(elem) : undefined
    electronegs[idx] = data?.electronegativity ?? 2.0
    metal_flags[idx] = data?.metal ? 1 : 0
    nonmetal_flags[idx] = data?.nonmetal ? 1 : 0
    radii[idx] = (elem ? covalent_radii.get(elem) : undefined) ?? 0
    let elem_id = elem_id_lookup.get(elem ?? ``)
    if (elem_id === undefined) {
      elem_id = elem_id_lookup.size
      elem_id_lookup.set(elem ?? ``, elem_id)
    }
    elem_ids[idx] = elem_id
    // Valid orig indices always reference a site in this structure; fall back to
    // the site's own index on malformed orig_*_idx properties so the typed
    // `closest` array below stays bounded by n_sites
    const orig_idx = get_orig_idx(sites[idx], idx)
    orig_idxs[idx] =
      Number.isInteger(orig_idx) && orig_idx >= 0 && orig_idx < n_sites ? orig_idx : idx
  }
  // Closest normalized bond distance per original atom (typed array instead of Map)
  const closest = new Float64Array(n_sites).fill(Infinity)

  let max_radius = 0
  for (const radius of covalent_radii.values()) {
    if (radius > max_radius) max_radius = radius
  }
  const max_cutoff = max_radius * 2 * max_distance_ratio
  const spatial = setup_spatial_grid(sites, max_cutoff)

  // Two-pass approach to ensure symmetry between original and image atoms:
  // 1. Collect all potential bonds and determine closest neighbor distance for each unique atom (orig_idx)
  // 2. Filter bonds based on penalties using the fully populated closest distances

  interface PotentialBond {
    site_idx_1: number
    site_idx_2: number
    dist: number
    expected_dist: number
    base_strength: number
    orig_idx_a: number
    orig_idx_b: number
  }

  const potential_bonds: PotentialBond[] = []

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const radius_a = radii[idx_a]
    if (radius_a === 0) continue // no covalent radius -> no pairs (symmetric: idx_b skips too)
    const [x1, y1, z1] = sites[idx_a].xyz
    const electroneg_a = electronegs[idx_a]
    const is_metal_a = metal_flags[idx_a] === 1
    const is_nonmetal_a = nonmetal_flags[idx_a] === 1
    const elem_id_a = elem_ids[idx_a]

    for (const idx_b of get_candidates(sites[idx_a].xyz, sites, spatial)) {
      if (idx_b <= idx_a) continue

      const radius_b = radii[idx_b]
      if (radius_b === 0) continue
      const [x2, y2, z2] = sites[idx_b].xyz
      const dx = x2 - x1
      const dy = y2 - y1
      const dz = z2 - z1
      const dist_sq = dx * dx + dy * dy + dz * dz
      if (dist_sq < min_dist_sq) continue

      // Compare squared distances to defer the sqrt until a pair survives the
      // cutoff (the vast majority of candidate pairs are rejected here)
      const expected = radius_a + radius_b
      const max_dist = expected * max_distance_ratio
      if (dist_sq > max_dist * max_dist) continue
      const dist = Math.sqrt(dist_sq)

      const electroneg_b = electronegs[idx_b]
      const electroneg_diff = Math.abs(electroneg_a - electroneg_b)
      const electroneg_balance = electroneg_diff / (electroneg_a + electroneg_b)

      const is_metal_b = metal_flags[idx_b] === 1
      const is_nonmetal_b = nonmetal_flags[idx_b] === 1
      let bond_strength = 1.0
      if (is_metal_a && is_metal_b) {
        bond_strength *= metal_metal_penalty
      } else if ((is_metal_a && is_nonmetal_b) || (is_nonmetal_a && is_metal_b)) {
        bond_strength *= metal_nonmetal_bonus
        if (electroneg_diff > electronegativity_threshold) bond_strength *= 1.3
      } else if (electroneg_diff < 0.5) {
        bond_strength *= similar_electronegativity_bonus
      }

      const dist_weight = Math.exp(-((dist / expected - 1) ** 2) / 0.18)
      const electroneg_weight = 1.0 - 0.3 * electroneg_balance
      let strength = bond_strength * dist_weight * electroneg_weight

      if (elem_id_a === elem_ids[idx_b]) strength *= same_species_penalty

      // If raw strength is already too low, we can skip early
      // (penalty will only reduce it further)
      if (strength <= strength_threshold) continue

      // Use precomputed original-site indices to handle supercell and image atoms
      const orig_idx_a = orig_idxs[idx_a]
      const orig_idx_b = orig_idxs[idx_b]

      // Update closest known normalized distance (dist / expected) for original atoms
      // Normalized distance handles atoms of different sizes better than raw distance
      // (e.g. C-H is short but C-C is longer; we don't want C-H to penalize C-C just because H is small)
      const norm_dist = dist / expected
      if (norm_dist < closest[orig_idx_a]) closest[orig_idx_a] = norm_dist
      if (norm_dist < closest[orig_idx_b]) closest[orig_idx_b] = norm_dist

      potential_bonds.push({
        site_idx_1: idx_a,
        site_idx_2: idx_b,
        dist,
        expected_dist: expected,
        base_strength: strength,
        orig_idx_a,
        orig_idx_b,
      })
    }
  }

  // Second pass: Apply penalties and filter
  for (const bond of potential_bonds) {
    const {
      site_idx_1,
      site_idx_2,
      dist,
      expected_dist,
      base_strength,
      orig_idx_a,
      orig_idx_b,
    } = bond

    const closest_dist_a = closest[orig_idx_a]
    const closest_dist_b = closest[orig_idx_b]
    const norm_dist = dist / expected_dist

    let strength = base_strength

    // Apply penalty if this bond is much longer (relative to radii) than the closest known bond
    if (norm_dist > closest_dist_a) {
      strength *= Math.exp(-(norm_dist / closest_dist_a - 1) / 0.5)
    }
    if (orig_idx_b !== orig_idx_a && norm_dist > closest_dist_b) {
      strength *= Math.exp(-(norm_dist / closest_dist_b - 1) / 0.5)
    }

    if (strength > strength_threshold) {
      bonds.push(make_bond(sites, site_idx_1, site_idx_2, dist, strength))
    }
  }

  return apply_explicit_bond_metadata(structure, bonds)
}

// Solid angle-based bonding using geometric proximity heuristics.
// Inspired by Voronoi tessellation without having to actually compute Voronoi cells.
// This algorithm computes bond strength based on the solid angle subtended by atoms
// and their distance penalty. Bonds are only created if the computed strength exceeds
// the strength_threshold parameter.
export function solid_angle(
  structure: AnyStructure,
  {
    min_solid_angle = 0.01,
    min_face_area = 0.05,
    max_distance = 5.0,
    min_bond_dist = 0.4,
    strength_threshold = 0.05,
  } = {},
): BondPair[] {
  const { sites } = structure
  if (sites.length < 2) return []

  const bonds: BondPair[] = []
  const min_dist_sq = min_bond_dist ** 2
  const max_dist_sq = max_distance ** 2
  const spatial = setup_spatial_grid(sites, max_distance)

  for (let idx_a = 0; idx_a < sites.length - 1; idx_a++) {
    const [x1, y1, z1] = sites[idx_a].xyz
    const elem_a = get_majority_element(sites[idx_a])
    const radius_a = elem_a ? covalent_radii.get(elem_a) : undefined

    for (const idx_b of get_candidates(sites[idx_a].xyz, sites, spatial)) {
      if (idx_b <= idx_a) continue

      const [x2, y2, z2] = sites[idx_b].xyz
      const elem_b = get_majority_element(sites[idx_b])
      const radius_b = elem_b ? covalent_radii.get(elem_b) : undefined

      const [dx, dy, dz] = [x2 - x1, y2 - y1, z2 - z1]
      const dist_sq = dx * dx + dy * dy + dz * dz
      const dist = Math.sqrt(dist_sq)

      if (dist_sq < min_dist_sq || dist_sq > max_dist_sq || !radius_a || !radius_b) {
        continue
      }

      const avg_radius = (radius_a + radius_b) / 2.0
      const face_area = Math.PI * avg_radius * avg_radius
      const bond_solid_angle = face_area / dist_sq

      if (bond_solid_angle < min_solid_angle || face_area < min_face_area) continue

      const dist_penalty = Math.exp(-((dist / (radius_a + radius_b) - 1) ** 2) / 0.4)
      const angle_strength = Math.min(bond_solid_angle / (4.0 * Math.PI), 1.0)
      const strength = angle_strength * dist_penalty

      if (strength > strength_threshold) {
        bonds.push(make_bond(sites, idx_a, idx_b, dist, strength))
      }
    }
  }
  return apply_explicit_bond_metadata(structure, bonds)
}
