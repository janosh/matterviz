// Bonding algorithms for structure visualization

import element_data, { element_by_symbol } from '../element/data'
import type { ElementSymbol } from '$lib/element'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type {
  AnyStructure,
  BondOrder,
  BondPair,
  Pbc,
  Site,
  StructureBond,
} from '$lib/structure'

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

function normalize_bond_order(order: unknown): BondOrder | null {
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
    bond_order: order,
    cell_shift,
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

// Helper to extract numeric index from site properties
function get_orig_idx(site: Site, fallback: number): number {
  const props = site.properties
  if (!props) return fallback

  const raw = props.orig_unit_cell_idx ?? props.orig_site_idx
  if (raw === undefined) return fallback

  const num = Number(raw)
  return Number.isFinite(num) ? num : fallback
}

// Build a BondPair between two sites
const make_bond = (
  sites: Site[],
  idx_1: number,
  idx_2: number,
  bond_length: number,
): BondPair => ({
  pos_1: sites[idx_1].xyz,
  pos_2: sites[idx_2].xyz,
  site_idx_1: idx_1,
  site_idx_2: idx_2,
  bond_length,
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

// === Geometric PBC neighbor query ===
// Purely geometric fixed-radius / k-nearest neighbor lists with periodic images. Shared by
// RDF, coordination, bond-angle and structure-identification analyses, which must not go
// through the chemically filtered bond perception above (it drops second shells and
// metal-metal contacts on purpose).
//
// Layout: neighbors of center `idx` occupy slots [offsets[idx], offsets[idx + 1]), sorted by
// ascending distance. For slot `slot`: `neighbors[slot]` is the partner's site index,
// `images[3*slot..]` the integer lattice shift applied to the partner (so the partner's
// position is `sites[neighbors[slot]].xyz + images · lattice`), `deltas[3*slot..]` that
// shifted position minus the center's and `distances[slot]` its norm. Both ends of a pair
// are listed (from each center once), a site's own periodic images count as neighbors,
// and only the unshifted self is excluded. Coincident sites (distance 0) are reported, not
// dropped: they are in range, and hiding them would mask duplicate-site input.
export type NeighborList = {
  n_centers: number
  cutoff: number // radius actually searched (for `k` queries: the final grown radius)
  offsets: Int32Array
  neighbors: Int32Array
  images: Int32Array
  deltas: Float64Array
  distances: Float64Array
}

export type NeighborQueryOptions = ({ cutoff: number } | { k: number }) & {
  // Defaults to the lattice's pbc (all true when unset); molecules are never periodic.
  pbc?: Pbc
}

// Refuse to materialize an image cloud bigger than this (positions, 24 B each): a cutoff of
// many cell lengths on a large cell is almost always a unit mix-up.
const MAX_IMAGE_CLOUD = 4_000_000
// pack_cell_key is exact only for cell coordinates in [-512, 511]
const MAX_GRID_COORD = 511

const grow_f64 = (buffer: Float64Array, needed: number): Float64Array => {
  if (needed <= buffer.length) return buffer
  const next = new Float64Array(Math.max(needed, buffer.length * 2))
  next.set(buffer)
  return next
}
const grow_i32 = (buffer: Int32Array, needed: number): Int32Array => {
  if (needed <= buffer.length) return buffer
  const next = new Int32Array(Math.max(needed, buffer.length * 2))
  next.set(buffer)
  return next
}

// Fixed-radius query. Base positions are wrapped into the cell on periodic axes (a
// trajectory frame may sit far outside it) and only images that can reach within `cutoff`
// of the cell are generated, so the cloud grows with the boundary shell, not 27x. Image
// shifts are reported relative to the ORIGINAL (unwrapped) coordinates.
function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  pbc_override: Pbc | undefined,
): NeighborList {
  const { sites } = structure
  const n_sites = sites.length
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    throw new Error(`neighbor_query: cutoff must be a positive finite number, got ${cutoff}`)
  }
  const lattice = `lattice` in structure ? structure.lattice.matrix : null
  const pbc: Pbc =
    `lattice` in structure ? (pbc_override ?? structure.lattice.pbc) : [false, false, false]
  const periodic = pbc.some(Boolean)

  // Cloud = wrapped base sites (first n_sites slots, index-aligned) + periodic images.
  // cloud_src maps a cloud slot to its site; cloud_shift holds the integer lattice shift
  // from that site's ORIGINAL position (wrap + replica shift).
  let cloud_pos: Float64Array = new Float64Array(n_sites * 3)
  let cloud_src: Int32Array = new Int32Array(n_sites)
  let cloud_shift: Int32Array = new Int32Array(n_sites * 3)
  let n_cloud = 0
  if (!periodic) {
    for (let idx = 0; idx < n_sites; idx++) {
      cloud_pos.set(sites[idx].xyz, idx * 3)
      cloud_src[idx] = idx
    }
    n_cloud = n_sites
  } else if (lattice) {
    const heights = math.cell_heights(lattice)
    if (pbc.some((flag, axis) => flag && !(heights[axis] > 0 && heights[axis] < Infinity))) {
      throw new Error(
        `neighbor_query: periodic lattice is degenerate (cell heights ${heights.join(`, `)} A)`,
      )
    }
    const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = lattice
    const { cart_to_frac } = math.create_lattice_converters(lattice)
    const pad: Vec3 = [0, 0, 0]
    const max_shift: Vec3 = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      if (!pbc[axis]) continue
      pad[axis] = cutoff / heights[axis]
      max_shift[axis] = Math.ceil(pad[axis])
    }
    const n_replicas = (2 * max_shift[0] + 1) * (2 * max_shift[1] + 1) * (2 * max_shift[2] + 1)
    if (n_sites * n_replicas > MAX_IMAGE_CLOUD) {
      throw new Error(
        `neighbor_query: cutoff ${cutoff} A spans ${max_shift.join(`, `)} cells along a, b, c ` +
          `(cell heights ${heights.map((val) => val.toFixed(2)).join(`, `)} A); refusing to ` +
          `build ${n_replicas} replicas of ${n_sites} sites`,
      )
    }
    // Wrapped fractional coords of every site plus the integer wrap shift applied
    const frac = new Float64Array(n_sites * 3)
    const wrap = new Int32Array(n_sites * 3)
    for (let idx = 0; idx < n_sites; idx++) {
      const site_frac = cart_to_frac(sites[idx].xyz)
      for (let axis = 0; axis < 3; axis++) {
        const shift = pbc[axis] ? -Math.floor(site_frac[axis]) : 0
        wrap[idx * 3 + axis] = shift
        frac[idx * 3 + axis] = site_frac[axis] + shift
      }
    }
    const push_cloud = (idx: number, shift_a: number, shift_b: number, shift_c: number) => {
      const fa = frac[idx * 3] + shift_a
      const fb = frac[idx * 3 + 1] + shift_b
      const fc = frac[idx * 3 + 2] + shift_c
      cloud_pos = grow_f64(cloud_pos, (n_cloud + 1) * 3)
      cloud_src = grow_i32(cloud_src, n_cloud + 1)
      cloud_shift = grow_i32(cloud_shift, (n_cloud + 1) * 3)
      cloud_pos[n_cloud * 3] = fa * ax + fb * bx + fc * cx
      cloud_pos[n_cloud * 3 + 1] = fa * ay + fb * by + fc * cy
      cloud_pos[n_cloud * 3 + 2] = fa * az + fb * bz + fc * cz
      cloud_src[n_cloud] = idx
      cloud_shift[n_cloud * 3] = wrap[idx * 3] + shift_a
      cloud_shift[n_cloud * 3 + 1] = wrap[idx * 3 + 1] + shift_b
      cloud_shift[n_cloud * 3 + 2] = wrap[idx * 3 + 2] + shift_c
      n_cloud++
    }
    // Base slots first so cloud index === site index for the centers
    for (let idx = 0; idx < n_sites; idx++) push_cloud(idx, 0, 0, 0)
    for (let idx = 0; idx < n_sites; idx++) {
      for (let shift_a = -max_shift[0]; shift_a <= max_shift[0]; shift_a++) {
        const fa = frac[idx * 3] + shift_a
        if (pbc[0] && (fa < -pad[0] || fa > 1 + pad[0])) continue
        for (let shift_b = -max_shift[1]; shift_b <= max_shift[1]; shift_b++) {
          const fb = frac[idx * 3 + 1] + shift_b
          if (pbc[1] && (fb < -pad[1] || fb > 1 + pad[1])) continue
          for (let shift_c = -max_shift[2]; shift_c <= max_shift[2]; shift_c++) {
            if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
            const fc = frac[idx * 3 + 2] + shift_c
            if (pbc[2] && (fc < -pad[2] || fc > 1 + pad[2])) continue
            push_cloud(idx, shift_a, shift_b, shift_c)
          }
        }
      }
    }
  }

  // Cubic bins one cutoff wide over the whole cloud: a neighbor can only sit in the 27 cells
  // around the center's
  const grid: SpatialGrid = new Map()
  for (let idx = 0; idx < n_cloud; idx++) {
    const cell_x = Math.floor(cloud_pos[idx * 3] / cutoff)
    const cell_y = Math.floor(cloud_pos[idx * 3 + 1] / cutoff)
    const cell_z = Math.floor(cloud_pos[idx * 3 + 2] / cutoff)
    // Negated comparison so a NaN/Infinity coordinate fails too: Map keys treat NaN as equal,
    // so a NaN position would otherwise bin every NaN image into one cell and the center
    // would collect each of them 27 times with NaN distances
    if (!(Math.max(Math.abs(cell_x), Math.abs(cell_y), Math.abs(cell_z)) < MAX_GRID_COORD)) {
      throw new Error(
        `neighbor_query: position (${cloud_pos[idx * 3]}, ${cloud_pos[idx * 3 + 1]}, ` +
          `${cloud_pos[idx * 3 + 2]}) at cutoff ${cutoff} A is non-finite or exceeds the ` +
          `±${MAX_GRID_COORD} cell window of the spatial grid`,
      )
    }
    const key = pack_cell_key(cell_x, cell_y, cell_z)
    const cell = grid.get(key)
    if (cell) cell.push(idx)
    else grid.set(key, [idx])
  }

  const cutoff_sq = cutoff * cutoff
  const offsets = new Int32Array(n_sites + 1)
  let neighbors: Int32Array = new Int32Array(Math.max(64, n_sites * 12))
  let images: Int32Array = new Int32Array(neighbors.length * 3)
  let deltas: Float64Array = new Float64Array(neighbors.length * 3)
  let distances: Float64Array = new Float64Array(neighbors.length)
  // Per-center scratch: candidate cloud slots + their squared distances, sorted through an
  // index permutation so no per-neighbor objects are allocated
  let cand_slot: Int32Array = new Int32Array(256)
  let cand_dist_sq: Float64Array = new Float64Array(256)
  let cand_delta: Float64Array = new Float64Array(256 * 3)
  let perm: Int32Array = new Int32Array(256)
  const by_dist = (slot_a: number, slot_b: number) =>
    cand_dist_sq[slot_a] - cand_dist_sq[slot_b] || cand_slot[slot_a] - cand_slot[slot_b]
  let total = 0
  for (let center = 0; center < n_sites; center++) {
    const center_x = cloud_pos[center * 3]
    const center_y = cloud_pos[center * 3 + 1]
    const center_z = cloud_pos[center * 3 + 2]
    const base_key = pack_cell_key(
      Math.floor(center_x / cutoff),
      Math.floor(center_y / cutoff),
      Math.floor(center_z / cutoff),
    )
    let n_cand = 0
    for (const delta of SHELL_DELTAS.full) {
      const cell = grid.get(base_key + delta)
      if (!cell) continue
      for (const slot of cell) {
        if (slot === center) continue
        const delta_x = cloud_pos[slot * 3] - center_x
        const delta_y = cloud_pos[slot * 3 + 1] - center_y
        const delta_z = cloud_pos[slot * 3 + 2] - center_z
        const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
        if (dist_sq > cutoff_sq) continue
        if (n_cand === cand_slot.length) {
          cand_slot = grow_i32(cand_slot, n_cand + 1)
          cand_dist_sq = grow_f64(cand_dist_sq, n_cand + 1)
          cand_delta = grow_f64(cand_delta, (n_cand + 1) * 3)
          perm = grow_i32(perm, n_cand + 1)
        }
        cand_slot[n_cand] = slot
        cand_dist_sq[n_cand] = dist_sq
        cand_delta[n_cand * 3] = delta_x
        cand_delta[n_cand * 3 + 1] = delta_y
        cand_delta[n_cand * 3 + 2] = delta_z
        n_cand++
      }
    }
    for (let idx = 0; idx < n_cand; idx++) perm[idx] = idx
    perm.subarray(0, n_cand).sort(by_dist)

    neighbors = grow_i32(neighbors, total + n_cand)
    images = grow_i32(images, (total + n_cand) * 3)
    deltas = grow_f64(deltas, (total + n_cand) * 3)
    distances = grow_f64(distances, total + n_cand)
    const center_wrap_a = cloud_shift[center * 3]
    const center_wrap_b = cloud_shift[center * 3 + 1]
    const center_wrap_c = cloud_shift[center * 3 + 2]
    for (let rank = 0; rank < n_cand; rank++) {
      const cand = perm[rank]
      const slot = cand_slot[cand]
      neighbors[total] = cloud_src[slot]
      // image = partner's total shift - center's wrap shift, so that
      // sites[partner].xyz + image·L - sites[center].xyz === delta
      images[total * 3] = cloud_shift[slot * 3] - center_wrap_a
      images[total * 3 + 1] = cloud_shift[slot * 3 + 1] - center_wrap_b
      images[total * 3 + 2] = cloud_shift[slot * 3 + 2] - center_wrap_c
      deltas[total * 3] = cand_delta[cand * 3]
      deltas[total * 3 + 1] = cand_delta[cand * 3 + 1]
      deltas[total * 3 + 2] = cand_delta[cand * 3 + 2]
      distances[total] = Math.sqrt(cand_dist_sq[cand])
      total++
    }
    offsets[center + 1] = total
  }
  return {
    n_centers: n_sites,
    cutoff,
    offsets,
    neighbors: neighbors.subarray(0, total),
    images: images.subarray(0, total * 3),
    deltas: deltas.subarray(0, total * 3),
    distances: distances.subarray(0, total),
  }
}

// Mean volume per atom, seeding the k-nearest radius search
const volume_per_atom = (structure: AnyStructure): number => {
  if (`lattice` in structure) return structure.lattice.volume / structure.sites.length
  const mins: Vec3 = [Infinity, Infinity, Infinity]
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { xyz } of structure.sites) {
    for (let axis = 0; axis < 3; axis++) {
      if (xyz[axis] < mins[axis]) mins[axis] = xyz[axis]
      if (xyz[axis] > maxs[axis]) maxs[axis] = xyz[axis]
    }
  }
  // a planar or linear cluster has a zero-thickness box; 1 A keeps the seed finite
  const extent = (axis: number) => Math.max(maxs[axis] - mins[axis], 1)
  return (extent(0) * extent(1) * extent(2)) / structure.sites.length
}

// Geometric neighbor query with periodic images.
//   neighbor_query(structure, { cutoff })  every neighbor within `cutoff` A
//   neighbor_query(structure, { k })       the k nearest of each site (fewer only when the
//                                          whole system holds fewer, e.g. a small molecule)
// The k search seeds a radius from the number density and grows it 1.4x per pass until no
// center is short of k or the radius exceeds a few cell heights / the cluster diameter.
export function neighbor_query(
  structure: AnyStructure,
  options: NeighborQueryOptions,
): NeighborList {
  if (`cutoff` in options) return neighbor_query_cutoff(structure, options.cutoff, options.pbc)
  const { k, pbc } = options
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`neighbor_query: k must be a positive integer, got ${k}`)
  }
  const n_sites = structure.sites.length
  if (n_sites === 0) return neighbor_query_cutoff(structure, 1, pbc)
  const atom_volume = volume_per_atom(structure)
  // radius of the sphere holding k+1 atoms at the mean density, widened 30% so the first
  // pass usually suffices even for an anisotropic first shell
  let cutoff = 1.3 * ((3 * (k + 1) * atom_volume) / (4 * Math.PI)) ** (1 / 3)
  const max_cutoff =
    `lattice` in structure
      ? 4 * Math.max(...math.cell_heights(structure.lattice.matrix))
      : 2 * (atom_volume * n_sites) ** (1 / 3)
  for (;;) {
    const list = neighbor_query_cutoff(structure, cutoff, pbc)
    let short = false
    for (let center = 0; center < n_sites && !short; center++) {
      short = list.offsets[center + 1] - list.offsets[center] < k
    }
    if (short && cutoff < max_cutoff) {
      cutoff = Math.min(cutoff * 1.4, max_cutoff)
      continue
    }
    // keep the k nearest per center (prefix of each sorted block)
    const offsets = new Int32Array(n_sites + 1)
    for (let center = 0; center < n_sites; center++) {
      const count = list.offsets[center + 1] - list.offsets[center]
      offsets[center + 1] = offsets[center] + Math.min(k, count)
    }
    const total = offsets[n_sites]
    const neighbors = new Int32Array(total)
    const images = new Int32Array(total * 3)
    const deltas = new Float64Array(total * 3)
    const distances = new Float64Array(total)
    for (let center = 0; center < n_sites; center++) {
      const src = list.offsets[center]
      const dst = offsets[center]
      const count = offsets[center + 1] - dst
      neighbors.set(list.neighbors.subarray(src, src + count), dst)
      images.set(list.images.subarray(src * 3, (src + count) * 3), dst * 3)
      deltas.set(list.deltas.subarray(src * 3, (src + count) * 3), dst * 3)
      distances.set(list.distances.subarray(src, src + count), dst)
    }
    return { n_centers: n_sites, cutoff, offsets, neighbors, images, deltas, distances }
  }
}

// Relative slack for "is this contact in the atom's first shell?". Distances within
// 0.1% of the shortest normalized contact count as the same shell, so float noise
// between symmetry-equivalent bonds can't flip one of them into the penalized branch.
const SHELL_TOL = 1.001

// Anion neighbours a cation needs before its cation-cation contacts count as second shell.
// Matches DEFAULTS.structure.polyhedra_min_neighbors: a tetrahedron is the smallest real
// coordination environment, so anything below it is an unsaturated (metal-rich) cation
// whose metal-metal contacts are structural.
const MIN_ANION_SHELL = 4

export const BONDING_STRATEGIES = { electroneg_ratio, explicit_only } as const
export type BondingStrategy = keyof typeof BONDING_STRATEGIES

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
  // Closest normalized bond distance per original atom (typed array instead of Map).
  // Filled by each sweep, so no initial fill here.
  const closest = new Float64Array(n_sites)
  // Anion-former neighbours, filled during pass 1 (see the cation gate in pass 2)
  const site_anion_neighbors = new Int32Array(n_sites)

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
  // Per-element-pair acceptance table. bond_strength and electroneg_weight depend only on
  // the element pair, and dist_weight = exp(-((d/expected - 1)^2)/0.18) is at most 1, so
  // the whole pair is unreachable when bond_strength * electroneg_weight <= threshold, and
  // otherwise passes only while (d/expected - 1)^2 < -0.18*ln(threshold / that product).
  // That is a band around `expected`, not just a ceiling: dist_weight is a Gaussian in
  // (ratio - 1), so an over-SHORT contact fails too, and dropping the floor would let one
  // into `closest` and over-penalize every real bond on that atom. Inverting both edges to
  // squared distances turns the inner loop's cutoff into two array reads and lets the
  // spatial grid size itself off the true reach instead of max_distance_ratio. For
  // rocksalt that is 4.2 A rather than 6.6, and Na-Na becomes unreachable outright.
  const n_elem = elem_id_lookup.size
  const elem_radius = new Float64Array(n_elem)
  const elem_en = new Float64Array(n_elem)
  const elem_metal = new Uint8Array(n_elem)
  const elem_nonmetal = new Uint8Array(n_elem)
  const elem_cation = new Uint8Array(n_elem)
  for (let idx = 0; idx < n_sites; idx++) {
    const elem_id = elem_ids[idx]
    elem_radius[elem_id] = radii[idx]
    elem_en[elem_id] = electronegs[idx]
    elem_metal[elem_id] = metal_flags[idx]
    elem_nonmetal[elem_id] = nonmetal_flags[idx]
    elem_cation[elem_id] = cation_flags[idx]
  }
  // expected bond length, the distance-independent strength factor, and the squared
  // acceptance radius, per ordered pair (symmetric, but indexing both ways is cheaper)
  const pair_expected = new Float64Array(n_elem * n_elem)
  const pair_factor = new Float64Array(n_elem * n_elem)
  const build_pair_reach = (apply_cation_penalty: boolean) => {
    const reach_hi_sq = new Float64Array(n_elem * n_elem)
    const reach_lo_sq = new Float64Array(n_elem * n_elem)
    let max_reach = 0
    for (let id_a = 0; id_a < n_elem; id_a++) {
      for (let id_b = 0; id_b < n_elem; id_b++) {
        const expected = elem_radius[id_a] + elem_radius[id_b]
        pair_expected[id_a * n_elem + id_b] = expected
        if (elem_radius[id_a] === 0 || elem_radius[id_b] === 0) continue
        const en_diff = Math.abs(elem_en[id_a] - elem_en[id_b])
        let strength = 1
        if (elem_metal[id_a] && elem_metal[id_b]) strength *= metal_metal_penalty
        else if (
          (elem_metal[id_a] && elem_nonmetal[id_b]) ||
          (elem_nonmetal[id_a] && elem_metal[id_b])
        ) {
          strength *= metal_nonmetal_bonus
          if (en_diff > electronegativity_threshold) strength *= 1.3
        } else if (en_diff < 0.5) strength *= similar_electronegativity_bonus
        if (apply_cation_penalty && elem_cation[id_a] && elem_cation[id_b]) {
          strength *= cation_cation_penalty
        }
        strength *= 1 - 0.3 * (en_diff / (elem_en[id_a] + elem_en[id_b]))
        pair_factor[id_a * n_elem + id_b] = strength
        // dist_weight <= 1, so nothing in this pair can clear the threshold
        if (strength <= strength_threshold) continue
        const spread = Math.sqrt(-0.18 * Math.log(strength_threshold / strength))
        const reach = expected * Math.min(1 + spread, max_distance_ratio)
        const floor = spread >= 1 ? 0 : expected * (1 - spread)
        reach_hi_sq[id_a * n_elem + id_b] = reach * reach
        reach_lo_sq[id_a * n_elem + id_b] = floor * floor
        if (reach > max_reach) max_reach = reach
      }
    }
    return { reach_hi_sq, reach_lo_sq, max_reach }
  }
  const grid_cutoff = (max_reach: number) =>
    max_reach > 0 && Number.isFinite(max_reach) ? max_reach : 1
  const positions = flatten_positions(sites)

  // Two-pass approach to ensure symmetry between original and image atoms:
  // 1. Collect all potential bonds and determine closest neighbor distance for each unique atom (orig_idx)
  // 2. Filter bonds based on penalties using the fully populated closest distances

  // Candidate bonds as struct-of-arrays typed buffers (site pair, distance, expected
  // distance, distance-independent strength): no per-candidate object in the hot loop
  let cand_a: Int32Array = new Int32Array(Math.max(256, n_sites * 4))
  let cand_b: Int32Array = new Int32Array(cand_a.length)
  let cand_dist: Float64Array = new Float64Array(cand_a.length)
  let cand_expected: Float64Array = new Float64Array(cand_a.length)
  let cand_strength: Float64Array = new Float64Array(cand_a.length)

  // The cation-cation penalty normally rides in pass 1 so the early strength cutoff can
  // reject a damped contact before it costs a candidate slot. Deferring it wholesale
  // nearly doubled the candidates on a rocksalt supercell (22.8k -> 44.5k), all of them
  // destined for rejection. It only NEEDS deferring when some cation lacks a full anion
  // shell, which is rare (metal-rich compounds) and cannot be known until the shells are
  // counted. So sweep once with the penalty applied, and replay only if that census turns
  // up an unsaturated cation. The census counts cation-anion contacts, which the penalty
  // never touches, so it is identical either way. Returns the candidate count.
  const sweep_candidates = (defer_cation_penalty: boolean): number => {
    // Grid cells span the longest reach of THIS sweep. Rebuilding on the rare replay beats
    // sizing both off the penalty-free table: with the cation penalty on, rocksalt's Na-Na
    // is unreachable and the cell shrinks from 4.6 A to Na-Cl's 4.2, and candidate volume
    // goes as the cube of that.
    const { reach_hi_sq, reach_lo_sq, max_reach } = build_pair_reach(!defer_cation_penalty)
    const spatial = setup_spatial_grid(positions, n_sites, grid_cutoff(max_reach))
    const half_shell = full_scan && spatial !== null
    let n_cand = 0
    site_anion_neighbors.fill(0)
    closest.fill(Infinity)

    for (let idx_a = 0; idx_a < n_center; idx_a++) {
      const radius_a = radii[idx_a]
      if (radius_a === 0) continue // no covalent radius -> no pairs (symmetric: idx_b skips too)
      const x1 = positions[idx_a * 3]
      const y1 = positions[idx_a * 3 + 1]
      const z1 = positions[idx_a * 3 + 2]
      const pair_row = elem_ids[idx_a] * n_elem

      for (const idx_b of collect_candidates(idx_a, n_sites, positions, spatial, half_shell)) {
        const dx = positions[idx_b * 3] - x1
        const dy = positions[idx_b * 3 + 1] - y1
        const dz = positions[idx_b * 3 + 2] - z1
        const dist_sq = dx * dx + dy * dy + dz * dz
        if (dist_sq < min_dist_sq) continue

        // Two table reads replace the radius sum, the ratio cutoff and the whole
        // metal/nonmetal/electronegativity branch chain. Both bounds are zero for pairs no
        // distance can save, so a missing covalent radius falls out of the ceiling test too.
        const pair = pair_row + elem_ids[idx_b]
        if (dist_sq > reach_hi_sq[pair] || dist_sq < reach_lo_sq[pair]) continue

        const expected = pair_expected[pair]
        const dist = Math.sqrt(dist_sq)
        const dist_weight = Math.exp(-((dist / expected - 1) ** 2) / 0.18)
        const strength = pair_factor[pair] * dist_weight

        // same_species_penalty is deferred to the second pass, where `closest` is known:
        // it must fire for a second-shell contact like Na-Na in NaCl but NOT when the
        // homoatomic contact IS the atom's primary bond (elemental metals, diamond)
        //
        // reach_sq already encodes the threshold, so no strength re-check is needed here

        // Use precomputed original-site indices to handle supercell and image atoms
        const orig_idx_a = orig_idxs[idx_a]
        const orig_idx_b = orig_idxs[idx_b]

        // Update closest known normalized distance (dist / expected) for original atoms
        // Normalized distance handles atoms of different sizes better than raw distance
        // (e.g. C-H is short but C-C is longer; we don't want C-H to penalize C-C just because H is small)
        const norm_dist = dist / expected
        if (norm_dist < closest[orig_idx_a]) closest[orig_idx_a] = norm_dist
        if (norm_dist < closest[orig_idx_b]) closest[orig_idx_b] = norm_dist

        // Anion-shell census, read by the cation-cation gate below. Counted per SITE, not
        // per original: unlike `closest` (a min, idempotent under duplication) a count
        // aggregated over every periodic image of an atom would multiply by the copy count.
        // Two typed-array increments per surviving candidate, riding along in pass 1 because
        // the counts must be complete before any gating decision.
        if (cation_flags[idx_a] === 0) site_anion_neighbors[idx_b]++
        if (cation_flags[idx_b] === 0) site_anion_neighbors[idx_a]++

        if (n_cand === cand_a.length) {
          cand_a = grow_i32(cand_a, n_cand + 1)
          cand_b = grow_i32(cand_b, n_cand + 1)
          cand_dist = grow_f64(cand_dist, n_cand + 1)
          cand_expected = grow_f64(cand_expected, n_cand + 1)
          cand_strength = grow_f64(cand_strength, n_cand + 1)
        }
        // min/max: half-shell scanning can reach a lower-indexed partner, but the output
        // keeps the ascending site_idx_1 < site_idx_2 convention
        cand_a[n_cand] = Math.min(idx_a, idx_b)
        cand_b[n_cand] = Math.max(idx_a, idx_b)
        cand_dist[n_cand] = dist
        cand_expected[n_cand] = expected
        cand_strength[n_cand] = strength
        n_cand++
      }
    }
    return n_cand
  }
  let n_cand = sweep_candidates(false)

  // Reduce the per-site census to the best-observed shell per original atom. A boundary
  // atom's own copy may see only part of its shell while an interior copy sees all of it,
  // and the gate has to reach the same verdict for every copy or images and originals
  // would bond differently. One O(n_sites) sweep.
  const anion_neighbors = new Int32Array(n_sites)
  for (let idx = 0; idx < n_sites; idx++) {
    const orig = orig_idxs[idx]
    if (site_anion_neighbors[idx] > anion_neighbors[orig]) {
      anion_neighbors[orig] = site_anion_neighbors[idx]
    }
  }

  // Replay only for metal-rich compositions, where a cation's metal-metal contacts are
  // structural and the first sweep may have discarded them below the strength cutoff
  const has_unsaturated_cation = cation_flags.some(
    (flag, idx) => flag === 1 && anion_neighbors[orig_idxs[idx]] < MIN_ANION_SHELL,
  )
  if (has_unsaturated_cation) n_cand = sweep_candidates(true)

  // Second pass: Apply penalties and filter
  for (let cand = 0; cand < n_cand; cand++) {
    const site_idx_1 = cand_a[cand]
    const site_idx_2 = cand_b[cand]
    const dist = cand_dist[cand]
    const orig_idx_a = orig_idxs[site_idx_1]
    const orig_idx_b = orig_idxs[site_idx_2]
    const closest_dist_a = closest[orig_idx_a]
    const closest_dist_b = closest[orig_idx_b]
    const norm_dist = dist / cand_expected[cand]

    let strength = cand_strength[cand]
    const same_species = elem_ids[site_idx_1] === elem_ids[site_idx_2]
    const cation_cation = cation_flags[site_idx_1] === 1 && cation_flags[site_idx_2] === 1

    // A homoatomic contact is spurious only when the atom has a SHORTER contact of some
    // other kind - Na-Na in NaCl sits in the second shell behind Na-Cl. In an elemental
    // metal or diamond it IS the primary bond, so norm_dist equals closest and the strict
    // comparisons below skip the penalty. That skip is what keeps fcc Al and Pb bonded at
    // all: were it applied there, 0.5 would stack with metal_metal_penalty's 0.7 for a
    // 0.35 ceiling against the 0.3 strength_threshold.
    if (
      same_species &&
      norm_dist > closest_dist_a * SHELL_TOL &&
      norm_dist > closest_dist_b * SHELL_TOL
    )
      strength *= same_species_penalty

    // A cation-cation contact is a second-shell artifact only once BOTH ends already have
    // a real anion coordination shell. Gating on normalized distance the way same_species
    // does cannot work here: for two cations of unequal radius the metric inverts, and
    // Cs-Cs (0.844) reads as shorter than Cs-Cl (1.031) in CsCl, Sr-Ti (0.952) shorter
    // than Sr-O (1.058) in SrTiO3. But applying it unconditionally destroyed metal-rich
    // compounds - Ti2O dropped from Ti CN 15 to 3, erasing the entire hcp Ti framework
    // that IS the structure, because Ti's 3 oxygens never saturate it. MIN_ANION_SHELL is
    // the same threshold polyhedra_min_neighbors uses: below a tetrahedron there is no
    // coordination environment to be a second shell of.
    if (
      cation_cation &&
      anion_neighbors[orig_idx_a] >= MIN_ANION_SHELL &&
      anion_neighbors[orig_idx_b] >= MIN_ANION_SHELL
    )
      strength *= cation_cation_penalty

    // Apply penalty if this bond is much longer (relative to radii) than the closest known bond
    if (norm_dist > closest_dist_a) {
      strength *= Math.exp(-(norm_dist / closest_dist_a - 1) / 0.5)
    }
    if (orig_idx_b !== orig_idx_a && norm_dist > closest_dist_b) {
      strength *= Math.exp(-(norm_dist / closest_dist_b - 1) / 0.5)
    }

    if (strength > strength_threshold) {
      bonds.push(make_bond(sites, site_idx_1, site_idx_2, dist))
    }
  }

  return apply_explicit_bond_metadata(structure, bonds)
}
