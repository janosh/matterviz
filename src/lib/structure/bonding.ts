// Bonding algorithms for structure visualization

import element_data, { element_by_symbol } from '../element/data'
import type { ElementSymbol } from '$lib/element'
import type { Vec2, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, BondOrder, BondPair, Site, StructureBond } from '$lib/structure'

type SpatialGrid = Map<number, number[]>

const covalent_radii = new Map<string, number>(
  element_data.flatMap((el) =>
    el.covalent_radius === null ? [] : [[el.symbol, el.covalent_radius]],
  ),
)

// Majority-occupancy element of a (possibly disordered) site
export const get_majority_element = (site: Site | undefined): ElementSymbol | null => {
  const species = site?.species
  if (!species?.length) return null
  // ordered-site shortcut: bonding, PBC image search and polyhedra each call this once per
  // site, i.e. tens of thousands of times per supercell rebuild
  if (species.length === 1) return species[0].element
  return species.reduce((max, spec) => (spec.occu > max.occu ? spec : max)).element
}

// Large low-valent A-site cations whose coordination polyhedra (CN 8-12) tend to
// obscure the structural framework. VESTA-style figures draw the framework
// (e.g. TiO6 in BaTiO3, FeO6/PO4 in LiFePO4) and leave these as plain spheres.
// They still get polyhedra when they are the only qualifying cations (e.g. NaCl)
// or when force-included via `included_center_elements`. Shared by polyhedra.ts
// (vertex/center selection) and pbc.ts (phase-2 boundary completion) so the bond
// graph and the polyhedra it feeds stay consistent.
const HEAVY_ALKALINE_EARTHS = new Set([`Ca`, `Sr`, `Ba`, `Ra`])

export const is_spectator_center = (element: string): boolean =>
  element_by_symbol.get(element as ElementSymbol)?.category === `alkali metal` ||
  HEAVY_ALKALINE_EARTHS.has(element)

// True if the composition contains a framework cation: a non-spectator element
// strictly less electronegative than the most electronegative element present
// (i.e. one that can coordinate the anions). When true, spectator A-site cations
// are hidden from coordination polyhedra (compute_polyhedra) and skipped by phase-2
// boundary completion (find_image_atoms) - sharing this keeps the bond graph and
// the polyhedra it feeds consistent. Purely ionic binaries (NaCl, Li2O) return
// false, so the spectator IS the framework and keeps its polyhedra/completions.
export function has_framework_potential(elements: Iterable<string>): boolean {
  const els = [...new Set(elements)] // dedupe so callers can pass per-site element lists
  let max_en = -Infinity
  for (const el of els) {
    const en = element_by_symbol.get(el as ElementSymbol)?.electronegativity
    if (en != null && en > max_en) max_en = en
  }
  return els.some((el) => {
    if (is_spectator_center(el)) return false
    const en = element_by_symbol.get(el as ElementSymbol)?.electronegativity
    return en != null && en < max_en
  })
}

const is_zero_cell_shift = (cell_shift: Vec3 | undefined): boolean =>
  cell_shift === undefined || cell_shift.every((val) => val === 0)

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
  const shift_suffix =
    normalized.cell_shift === undefined || is_zero_cell_shift(normalized.cell_shift)
      ? ``
      : `@${normalized.cell_shift.join(`,`)}`
  return `${normalized.site_idx_1}-${normalized.site_idx_2}${shift_suffix}`
}

// Remap explicit bond metadata after site deletion: drop bonds touching deleted
// sites and shift each surviving index down by the number of deleted indices below it.
export function remap_bonds_after_deletion(
  bonds: readonly StructureBond[],
  deleted_indices: ReadonlySet<number>,
): StructureBond[] {
  // Sort the deleted indices once; shift each surviving index down by the count of deleted
  // indices below it via binary search (O(log m) per lookup vs re-filtering the set each call).
  const sorted = [...deleted_indices].toSorted((idx_a, idx_b) => idx_a - idx_b)
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
    if (typeof raw_bond !== `object` || raw_bond === null) {
      console.warn(`Ignoring invalid explicit bond at index ${entry_idx}: expected object`)
      continue
    }
    const bond_record = raw_bond as Record<string, unknown>
    const { order } = bond_record
    const site_idx_1 = bond_record.site_idx_1
    const site_idx_2 = bond_record.site_idx_2
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
    const cell_shift = normalize_cell_shift(bond_record.cell_shift)
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
    if (!is_zero_cell_shift(cell_shift) && !(`lattice` in structure)) {
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

// Render exactly the bonds declared in structure.properties.bonds, running no proximity
// search. Formats like PDB/MOL/MOL2/SDF carry authoritative bond blocks, for which
// covalent-radius perception both invents spurious bonds and misses coordination bonds.
// Structures without declared bonds yield no bonds — falling back to a perception
// strategy here would hide a missing or unparsed bond block.
// `_options` is unused but required: compute_bonds calls the strategy union with two
// arguments, which TS rejects if any registry member has a lower arity.
export const explicit_only = (structure: AnyStructure, _options = {}): BondPair[] =>
  get_explicit_bond_metadata(structure).map((bond) =>
    structure_bond_to_bond_pair(structure, bond),
  )

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

// Build a BondPair between two sites
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
// Also used by pbc.ts for its phase-2 boundary-completion grid.
const CELL_OFFSET = 512
export const pack_cell_key = (x: number, y: number, z: number): number =>
  (x + CELL_OFFSET) * 1048576 + (y + CELL_OFFSET) * 1024 + (z + CELL_OFFSET)

// Cell-key offsets to probe around a bond center, own cell (delta 0) first. pack_cell_key
// is linear in the cell coordinates, so a neighbor's key is the center's key plus a
// constant — no re-packing per probe. The half shell keeps only the 13 lexicographically
// "forward" offsets, so of any two adjacent cells exactly one sees the other; combined
// with taking only larger indices from the own cell it visits each pair once, not twice.
const shell_deltas = (half_shell: boolean): number[] => {
  const deltas: number[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const rank = dx * 9 + dy * 3 + dz // lexicographic order; > 0 is the forward half
        if (!half_shell || rank >= 0) deltas.push(dx * 1048576 + dy * 1024 + dz)
      }
    }
  }
  return deltas
}
const SHELL_DELTAS = { full: shell_deltas(false), half: shell_deltas(true) }

// Positions as a flat [x, y, z, ...] buffer. The pair loops below read these millions of
// times on large supercells, where a typed array beats two object hops per access.
const flatten_positions = (sites: Site[]): Float64Array => {
  const positions = new Float64Array(sites.length * 3)
  for (const [idx, { xyz }] of sites.entries()) {
    positions[idx * 3] = xyz[0]
    positions[idx * 3 + 1] = xyz[1]
    positions[idx * 3 + 2] = xyz[2]
  }
  return positions
}

// Spatial decomposition into cubic cells of `cutoff` size. Skipped below 50 atoms, where
// the all-pairs loop is cheaper than building and probing the grid.
function setup_spatial_grid(positions: Float64Array, n_sites: number, cutoff: number) {
  if (n_sites <= 50) return null
  const grid: SpatialGrid = new Map()
  for (let idx = 0; idx < n_sites; idx++) {
    const key = pack_cell_key(
      Math.floor(positions[idx * 3] / cutoff),
      Math.floor(positions[idx * 3 + 1] / cutoff),
      Math.floor(positions[idx * 3 + 2] / cutoff),
    )
    const cell = grid.get(key)
    if (cell) cell.push(idx)
    else grid.set(key, [idx])
  }
  return { grid, cell_size: cutoff }
}

// Partner indices to test against bond center `idx_a`, already restricted so no pair is
// visited twice. Fills and returns a REUSED module-level array (valid until the next
// call): this runs once per bond center, so per-call allocations would dominate GC
// pressure when computing bonds for large supercells.
const scratch_neighbors: number[] = []
function collect_candidates(
  idx_a: number,
  n_sites: number,
  positions: Float64Array,
  spatial: ReturnType<typeof setup_spatial_grid>,
  half_shell: boolean,
): number[] {
  scratch_neighbors.length = 0
  if (!spatial) {
    for (let idx_b = idx_a + 1; idx_b < n_sites; idx_b++) scratch_neighbors.push(idx_b)
    return scratch_neighbors
  }
  const { grid, cell_size } = spatial
  const base_key = pack_cell_key(
    Math.floor(positions[idx_a * 3] / cell_size),
    Math.floor(positions[idx_a * 3 + 1] / cell_size),
    Math.floor(positions[idx_a * 3 + 2] / cell_size),
  )
  for (const delta of SHELL_DELTAS[half_shell ? `half` : `full`]) {
    const cell = grid.get(base_key + delta)
    if (!cell) continue
    // forward cells contribute everything; the own cell only larger indices, so a pair
    // sitting in a single cell is still taken exactly once
    const take_all = half_shell && delta !== 0
    for (const idx_b of cell) if (take_all || idx_b > idx_a) scratch_neighbors.push(idx_b)
  }
  return scratch_neighbors
}

// Relative slack for "is this contact in the atom's first shell?". Distances within
// 0.1% of the shortest normalized contact count as the same shell, so float noise
// between symmetry-equivalent bonds can't flip one of them into the penalized branch.
const SHELL_TOL = 1.001

export const BONDING_STRATEGIES = { electroneg_ratio, explicit_only } as const
export type BondingStrategy = keyof typeof BONDING_STRATEGIES
export type BondingAlgo = (typeof BONDING_STRATEGIES)[BondingStrategy]

// Memo for the costly neighbor search: WeakMap keyed by structure (GC'd with it), each holding a
// per-signature (strategy + JSON options) map of results. The multi-side view's 4 panes share one
// search (identical inputs, one flush); the per-signature map also lets alternating
// strategies/options on the same structure reuse earlier results instead of thrashing one slot.
const bond_memo = new WeakMap<AnyStructure, Map<string, BondPair[]>>()

export function compute_bonds(
  structure: AnyStructure,
  strategy: BondingStrategy,
  options: Record<string, unknown> = {},
): BondPair[] {
  const sig = `${strategy}:${JSON.stringify(options)}`
  let by_sig = bond_memo.get(structure)
  const cached = by_sig?.get(sig)
  if (cached) return cached
  const bonds = BONDING_STRATEGIES[strategy](structure, options)
  if (!by_sig) bond_memo.set(structure, (by_sig = new Map()))
  by_sig.set(sig, bonds)
  return bonds
}

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
    // Penalty for contacts between two cation-like atoms (metals less electronegative
    // than an anion-former in the composition). Cs-Cs in CsCl and Sr-Ti in SrTiO3 pass
    // the distance model easily, but they are second-shell contacts across the anion
    // sublattice, not bonds - the same distinction is_anion_vertex draws in polyhedra.ts.
    // Elemental metals and intermetallics have no anion-former, so their homoatomic
    // contacts are untouched.
    cation_cation_penalty = 0.3,
    metal_nonmetal_bonus = 1.5, // Strength bonus for metal-nonmetal bonds
    similar_electronegativity_bonus = 1.2, // Bonus for similar electronegativity
    same_species_penalty = 0.5, // Penalty for bonds between same element
    strength_threshold = 0.3, // Minimum bond strength to include in results
    // Only iterate the first `center_count` sites as bond centers (default: all).
    // Coordination coloring sets this to the original-atom count so appended PBC image
    // atoms are used as neighbors but not iterated as centers — identical coordination
    // for the originals (by translational symmetry), far cheaper when images dominate.
    center_count = Infinity,
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
  // Half-shell scanning finds a pair from only one of its two ends, so it needs every
  // site to act as a center; a restricted center_count falls back to the full shell.
  const full_scan = center_count >= n_sites - 1
  const n_center = full_scan ? n_sites : Math.min(center_count, n_sites - 1)
  const electronegs = new Float64Array(n_sites)
  const radii = new Float64Array(n_sites) // 0 = no covalent radius known
  const metal_flags = new Uint8Array(n_sites)
  const nonmetal_flags = new Uint8Array(n_sites)
  const elem_ids = new Int32Array(n_sites) // same-species check via integer ids
  const orig_idxs = new Int32Array(n_sites)
  const elem_id_lookup = new Map<string, number>()
  // Highest electronegativity among anion-formers (nonmetals/metalloids) present. Atoms
  // below it are cation-like; -Infinity in an all-metal composition, so nothing is.
  let max_anion_en = -Infinity
  for (const site of sites) {
    const elem = get_majority_element(site)
    const data = elem ? element_by_symbol.get(elem) : undefined
    if (!data?.nonmetal && !data?.metalloid) continue
    const en = data.electronegativity
    if (en != null && en > max_anion_en) max_anion_en = en
  }
  const cation_flags = new Uint8Array(n_sites)
  for (let idx = 0; idx < n_sites; idx++) {
    const elem = get_majority_element(sites[idx])
    const data = elem ? element_by_symbol.get(elem) : undefined
    electronegs[idx] = data?.electronegativity ?? 2.0
    // Metal only, like is_anion_vertex in polyhedra.ts: "less electronegative than the
    // most electronegative element present" alone would brand C and H as cations in an
    // organic molecule and delete every C-H bond.
    cation_flags[idx] = data?.metal && electronegs[idx] < max_anion_en ? 1 : 0
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

  // Cells must span the longest possible bond, since only a 3x3x3 block is scanned per center.
  // Sizing that off the whole periodic table pins every structure at Cs/Fr (2.6 Å), so an
  // all-carbon cell paid for a 10.4 Å cell where 3.0 Å suffices; `radii` holds only the
  // elements present, making its max an exact bound. Fall back to a positive size when that
  // bound degenerates (no known radius, or a zero/non-finite ratio), since dividing by it
  // would bucket every site under one key and quietly revert to O(N^2).
  let max_radius = 0
  for (const radius of radii) {
    if (radius > max_radius) max_radius = radius
  }
  const bond_reach = max_radius * 2 * max_distance_ratio
  const max_cutoff = bond_reach > 0 && Number.isFinite(bond_reach) ? bond_reach : 1
  const positions = flatten_positions(sites)
  const spatial = setup_spatial_grid(positions, n_sites, max_cutoff)
  const half_shell = full_scan && spatial !== null

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
    same_species: boolean
  }

  const potential_bonds: PotentialBond[] = []

  for (let idx_a = 0; idx_a < n_center; idx_a++) {
    const radius_a = radii[idx_a]
    if (radius_a === 0) continue // no covalent radius -> no pairs (symmetric: idx_b skips too)
    const x1 = positions[idx_a * 3]
    const y1 = positions[idx_a * 3 + 1]
    const z1 = positions[idx_a * 3 + 2]
    const electroneg_a = electronegs[idx_a]
    const is_metal_a = metal_flags[idx_a] === 1
    const is_nonmetal_a = nonmetal_flags[idx_a] === 1
    const elem_id_a = elem_ids[idx_a]

    for (const idx_b of collect_candidates(idx_a, n_sites, positions, spatial, half_shell)) {
      const radius_b = radii[idx_b]
      if (radius_b === 0) continue
      const dx = positions[idx_b * 3] - x1
      const dy = positions[idx_b * 3 + 1] - y1
      const dz = positions[idx_b * 3 + 2] - z1
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
      if (cation_flags[idx_a] === 1 && cation_flags[idx_b] === 1) {
        bond_strength *= cation_cation_penalty
      }

      const dist_weight = Math.exp(-((dist / expected - 1) ** 2) / 0.18)
      const electroneg_weight = 1.0 - 0.3 * electroneg_balance
      let strength = bond_strength * dist_weight * electroneg_weight

      // same_species_penalty is deferred to the second pass, where `closest` is known:
      // it must fire for a second-shell contact like Na-Na in NaCl but NOT when the
      // homoatomic contact IS the atom's primary bond (elemental metals, diamond)
      const same_species = elem_id_a === elem_ids[idx_b]

      // If raw strength is already too low, we can skip early
      // (penalties will only reduce it further)
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

      // min/max: half-shell scanning can reach a lower-indexed partner, but the output
      // keeps the ascending site_idx_1 < site_idx_2 convention
      potential_bonds.push({
        site_idx_1: Math.min(idx_a, idx_b),
        site_idx_2: Math.max(idx_a, idx_b),
        dist,
        expected_dist: expected,
        base_strength: strength,
        orig_idx_a,
        orig_idx_b,
        same_species,
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
      same_species,
    } = bond

    const closest_dist_a = closest[orig_idx_a]
    const closest_dist_b = closest[orig_idx_b]
    const norm_dist = dist / expected_dist

    let strength = base_strength

    // A homoatomic contact is spurious only when the atom has a SHORTER contact of some
    // other kind - Na-Na in NaCl sits in the second shell behind Na-Cl. In an elemental
    // metal or diamond the homoatomic contact IS the primary bond (norm_dist == closest),
    // and penalizing it there stacked with metal_metal_penalty to leave a 0.35 ceiling
    // against a 0.3 threshold, so fcc Al and Pb rendered with no bonds at all.
    if (
      same_species &&
      norm_dist > closest_dist_a * SHELL_TOL &&
      norm_dist > closest_dist_b * SHELL_TOL
    )
      strength *= same_species_penalty

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
