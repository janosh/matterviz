// Bonding algorithms for structure visualization

import { element_by_symbol } from '../element/data'
import { element_from_atomic_number } from '../element/helpers'
import type { ChemicalElement, ElementSymbol } from '$lib/element'
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
import {
  get_image_source_idx,
  get_orig_site_idx,
  get_site,
  numeric_sites,
  NumericSites,
  site_count,
} from '$lib/structure/site'
import { BOND_ORDERS, BondFrame, pack_bonds, type BondColumns } from './bond-rendering'

// Expected bond length of an element pair in Angstrom, or null when a radius is unknown.
// Two metals measure against their 12-coordinate metallic radii: covalent radii are fit to
// compounds and undershoot the metals themselves (fcc Al 2.86 A is 1.18x the covalent sum,
// 1.00x the metallic one), which broke intermetallics. Elements without a tabulated
// metallic radius (Sn, Pb, Bi, Ac, ...) keep the covalent one. Every other pair uses
// covalent radii. Shared with find_image_atoms so boundary completion reaches exactly as
// far as the bond detector does.
export const expected_bond_length = (
  elem_a: ChemicalElement | undefined,
  elem_b: ChemicalElement | undefined,
): number | null => {
  if (!elem_a || !elem_b) return null
  const metallic = elem_a.metal === true && elem_b.metal === true
  const radius_of = (elem: ChemicalElement) =>
    (metallic ? elem.metallic_radius : undefined) ?? elem.covalent_radius
  const [r_a, r_b] = [radius_of(elem_a), radius_of(elem_b)]
  return r_a === null || r_b === null ? null : r_a + r_b
}

// Majority-occupancy element of a (possibly disordered) site
export const get_majority_element = (site: Site | undefined): ElementSymbol | null => {
  const species = site?.species
  if (!species?.length) return null
  // ordered-site shortcut: bonding, PBC image search and polyhedra each call this once per
  // site, i.e. tens of thousands of times per supercell rebuild
  if (species.length === 1) return species[0].element
  return species.reduce((max, spec) => (spec.occu > max.occu ? spec : max)).element
}

// Intern distinct majority-element symbols as small integer ids so hot loops index flat arrays
// and element data resolves once per element, not per site (a 10k-atom MD frame has a handful
// of elements and this runs every frame). `unknown_label` stands in for unresolvable.
export function intern_site_elements(
  sites: readonly Site[] | NumericSites,
  unknown_label = ``,
): {
  symbols: string[]
  site_elem_ids: Int32Array
  elem_data: (ChemicalElement | undefined)[]
} {
  const symbols: string[] = []
  const elem_data: (ChemicalElement | undefined)[] = []
  const elem_id_of = new Map<string, number>()
  const site_elem_ids = new Int32Array(sites.length)
  for (let idx = 0; idx < sites.length; idx++) {
    let symbol: string
    if (sites instanceof NumericSites) {
      const element = element_from_atomic_number(sites.numbers[idx])
      if (element === undefined)
        throw new Error(`Invalid atomic number ${sites.numbers[idx]} at site ${idx}`)
      symbol = element
    } else symbol = get_majority_element(sites[idx]) ?? unknown_label
    let elem_id = elem_id_of.get(symbol)
    if (elem_id === undefined) {
      elem_id = symbols.length
      elem_id_of.set(symbol, elem_id)
      symbols.push(symbol)
      elem_data.push(element_by_symbol.get(symbol as ElementSymbol))
    }
    site_elem_ids[idx] = elem_id
  }
  return { symbols, site_elem_ids, elem_data }
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
  for (const element of els) {
    const energy = element_by_symbol.get(element as ElementSymbol)?.electronegativity
    if (energy != null && energy > max_en) max_en = energy
  }
  return els.some((element) => {
    if (is_spectator_center(element)) return false
    const energy = element_by_symbol.get(element as ElementSymbol)?.electronegativity
    return energy != null && energy < max_en
  })
}

const is_zero_cell_shift = (cell_shift: Vec3 | undefined): boolean =>
  cell_shift === undefined || cell_shift.every((val) => val === 0)

// the ternaries never yield -0, so a reversed shift keys as its forward twin (`-0` stringifies
// differently from `0`)
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

// Whether the image shift at neighbor-list `slot` is the canonical one of a self-image
// pair (first non-zero component positive), i.e. the one canonical_self_bond_shift keeps.
// A site's periodic image appears in its own list under both s and -s.
const is_canonical_self_image = (images: Int32Array, slot: number): boolean => {
  for (let axis = 0; axis < 3; axis++) {
    const shift = images[slot * 3 + axis]
    if (shift !== 0) return shift > 0
  }
  return false // the unshifted self is never listed, so this is unreachable
}

const NO_PBC: Pbc = [false, false, false]

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
    let [lower, upper] = [0, sorted.length]
    while (lower < upper) {
      const mid = (lower + upper) >> 1
      if (sorted[mid] < idx) lower = mid + 1
      else upper = mid
    }
    return idx - lower // lo == count of deleted indices < idx
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
    get_image_source_idx(sites?.[bond.site_idx_1], bond.site_idx_1),
    get_image_source_idx(sites?.[bond.site_idx_2], bond.site_idx_2),
    cell_shift,
  )
}

// Key of a bond exactly as its endpoints are given (no canonicalisation)
export const rendered_bond_key_for = (bond: BondKeyTarget): string =>
  get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift)

const matches_bond_key = (bond: BondKeyTarget, key: string): boolean =>
  rendered_bond_key_for(bond) === key

const replace_bond = (bonds: StructureBond[], next_bond: StructureBond): StructureBond[] => {
  const key = rendered_bond_key_for(next_bond)
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
  const key = rendered_bond_key_for(bond)
  if (includes_bond_key(edit_state.removed_bonds, key)) return false
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
  const key = rendered_bond_key_for(record)
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
  const key = rendered_bond_key_for(record)
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
  const key = rendered_bond_key_for(record)
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
  const removed_keys = new Set(removed.map(rendered_bond_key_for))
  const merged = new Map<string, StructureBond>()
  // Base first, then additions, then overrides, so user-set bond orders win even if callers
  // accidentally pass overlapping edit lists
  for (const bond of [...base_bonds, ...added, ...overrides]) {
    const key = rendered_bond_key_for(bond)
    if (!removed_keys.has(key)) merged.set(key, make_bond_record(bond, bond.order))
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
  const site_1 = get_site(structure, site_idx_1)
  const site_2 = get_site(structure, site_idx_2)
  if (!site_1 || !site_2) {
    throw new Error(
      `Cannot create bond pair for invalid site indices ${site_idx_1}, ${site_idx_2}`,
    )
  }
  const pos_1 = site_1.xyz
  // In-cell bonds (the vast majority) skip the translation allocation
  const pos_2 =
    cell_shift === undefined || is_zero_cell_shift(cell_shift)
      ? site_2.xyz
      : math.add(site_2.xyz, lattice_translation(structure, cell_shift))
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

// Validated bonds per raw `properties.bonds` array: trajectory frames (and synthesised phonon
// frames) share one bonds array across thousands of structures, and only the site count and
// lattice presence can change what passes validation.
const explicit_bond_memo = new WeakMap<
  object,
  { n_sites: number; has_lattice: boolean; bonds: StructureBond[] }
>()

export function get_explicit_bond_metadata(structure: AnyStructure): StructureBond[] {
  const raw_bonds = structure.properties?.bonds
  if (raw_bonds === undefined) return []
  if (!Array.isArray(raw_bonds)) {
    console.warn(`Ignoring structure.properties.bonds because it is not an array`)
    return []
  }
  const n_sites = site_count(structure)
  const has_lattice = `lattice` in structure
  const memo = explicit_bond_memo.get(raw_bonds)
  if (memo?.n_sites === n_sites && memo.has_lattice === has_lattice) return memo.bonds

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
    if (site_idx_1 < 0 || site_idx_2 < 0 || site_idx_1 >= n_sites || site_idx_2 >= n_sites) {
      console.warn(
        `Ignoring invalid explicit bond at index ${entry_idx}: site indices ${
          site_idx_1
        }, ${site_idx_2} are out of range for ${n_sites} sites`,
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
  const bonds = [...explicit_bonds.values()]
  explicit_bond_memo.set(raw_bonds, { n_sites, has_lattice, bonds })
  return bonds
}

// Render exactly the bonds declared in structure.properties.bonds, running no proximity
// search. Formats like PDB/MOL/MOL2/SDF carry authoritative bond blocks, for which
// covalent-radius perception both invents spurious bonds and misses coordination bonds.
// Structures without declared bonds yield no bonds — falling back to a perception
// strategy here would hide a missing or unparsed bond block.
export const explicit_only = (structure: AnyStructure): BondPair[] =>
  get_explicit_bond_metadata(structure).map((bond) =>
    structure_bond_to_bond_pair(structure, bond),
  )

// === Geometric PBC neighbor query ===
// Purely geometric fixed-radius / k-nearest neighbor lists with periodic images. The single
// neighbor-search primitive: RDF, coordination, bond angles, structure identification and
// the chemical bond perception below (electroneg_ratio) all start from this list and layer
// their own filters on top.
//
// Layout: neighbors of center `idx` occupy slots [offsets[idx], offsets[idx + 1]), sorted by
// ascending distance unless the query opted out. For slot `slot`: `neighbors[slot]` is the partner's site index,
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

export type NeighborQueryOptions = (
  | {
      cutoff: number
      // Sort each center's block by distance (default true). Callers that filter every
      // contact anyway (bond perception) skip it: on a 10k-atom cell the sort is a third of
      // the query. `k` queries are always sorted, they take the prefix of each block.
      sorted?: boolean
    }
  | { k: number }
) & {
  // Defaults to the lattice's own pbc (see lattice_pbc_or_throw); molecules are never periodic.
  pbc?: Pbc
}

// Refuse to materialize an image cloud (base sites + periodic images within `cutoff` of the
// cell) bigger than this: a cutoff of many cell lengths on a large cell is almost always a
// unit mix-up. The check counts the images that will actually be built, not a 27x bound, so
// a 15 A cutoff on a 160k-atom / 120 A box (~312k positions) passes.
const MAX_IMAGE_CLOUD = 4_000_000
// The image cloud bounds the search space, not the result: a 64k-atom cell at the RDF's 15 A
// default holds ~40M pairs (2.6 GB of lists), a large-cell k query can grow its radius into
// the same. Refuse past this many pairs (~1.2 GB peak) instead of exhausting memory on the
// main thread; a 10k-atom MD frame at 15 A is ~3M pairs.
const MAX_NEIGHBOR_PAIRS = 10_000_000
// The dense grid holds at most this many bins per cloud position; sparser clouds (a tiny
// cutoff on a far-flung cluster) get bins wider than `cutoff`, which stays correct since a
// neighbor is then still within the 27 surrounding bins.
const MAX_BINS_PER_POSITION = 2

// Amortized doubling, never past `cap` (so a capped buffer fills exactly to its budget)
const grow_f64 = (buffer: Float64Array, needed: number, cap = Infinity): Float64Array => {
  if (needed <= buffer.length) return buffer
  const next = new Float64Array(Math.min(cap, Math.max(needed, buffer.length * 2)))
  next.set(buffer)
  return next
}
const grow_i32 = (buffer: Int32Array, needed: number, cap = Infinity): Int32Array => {
  if (needed <= buffer.length) return buffer
  const next = new Int32Array(Math.min(cap, Math.max(needed, buffer.length * 2)))
  next.set(buffer)
  return next
}

// Forward offsets for cutoff-wide bins (13 neighbors) and half-width bins (62).
// Each unordered pair of bins is searched once; own-bin pairs use increasing slots.
type BinOffset = [...Vec3, opposite_mask: number]
const FORWARD_BIN_OFFSETS: BinOffset[] = []
const FINE_BIN_OFFSETS: BinOffset[] = []
for (let delta_x = -2; delta_x <= 2; delta_x++) {
  for (let delta_y = -2; delta_y <= 2; delta_y++) {
    for (let delta_z = -2; delta_z <= 2; delta_z++) {
      if (delta_x * 25 + delta_y * 5 + delta_z <= 0) continue
      const offset: BinOffset = [delta_x, delta_y, delta_z, 0]
      FINE_BIN_OFFSETS.push(offset)
      if (Math.max(Math.abs(delta_x), Math.abs(delta_y), Math.abs(delta_z)) <= 1)
        FORWARD_BIN_OFFSETS.push(offset)
    }
  }
}

// Each mask uses the original 13 neighbors first, then matching nonadjacent bins.
// Lower/upper edge bits are paired for x, y, then z; the fourth offset field selects
// the opposite edges that must be occupied in the destination bin.
const BOUNDARY_BIN_OFFSETS = Array.from({ length: 64 }, () => [...FORWARD_BIN_OFFSETS])
for (const [delta_x, delta_y, delta_z] of FINE_BIN_OFFSETS) {
  const delta: Vec3 = [delta_x, delta_y, delta_z]
  const facing = delta.reduce(
    (bits, step, axis) =>
      bits | (Math.abs(step) === 2 ? 1 << (2 * axis + (step > 0 ? 1 : 0)) : 0),
    0,
  )
  if (!facing) continue
  const offset: BinOffset = [...delta, ((facing & 21) << 1) | ((facing & 42) >> 1)]
  for (const [mask, offsets] of BOUNDARY_BIN_OFFSETS.entries()) {
    if ((mask & facing) === facing) offsets.push(offset)
  }
}

// Keep coarse bin assignments unchanged so existing contacts retain their discovery order.
// Only pairs within the rounding error of facing edges can cross two cutoff-wide bins.
function coarse_boundary_masks(
  cloud_pos: Float64Array,
  bin_of: Int32Array,
  widths: Vec3,
  shape: Vec3,
  mins: Vec3,
  maxs: Vec3,
  cutoff: number,
): Uint8Array | undefined {
  if (shape.every((count) => count < 3)) return undefined
  const masks = new Uint8Array(shape[0] * shape[1] * shape[2])
  let upper_boundary = false
  for (let axis = 0; axis < 3; axis++) {
    if (shape[axis] < 3) continue
    const tolerance = (4 * Number.EPSILON * (maxs[axis] - mins[axis] + cutoff)) / widths[axis]
    const lower = 1 << (2 * axis)
    const upper = lower << 1
    for (let slot = 0; slot < bin_of.length; slot++) {
      const frac = (cloud_pos[slot * 3 + axis] - mins[axis]) / widths[axis]
      const remainder = frac - Math.floor(frac)
      if (remainder <= tolerance) masks[bin_of[slot]] |= lower
      if (1 - remainder <= tolerance) {
        masks[bin_of[slot]] |= upper
        upper_boundary = true
      }
    }
  }
  return upper_boundary ? masks : undefined
}

type NeighborDistanceVisitor = (center: number, neighbor: number, distance: number) => void

// Fixed-radius query. Base positions are wrapped into the cell on periodic axes (a
// trajectory frame may sit far outside it) and only images that can reach within `cutoff`
// of the cell are generated, so the cloud grows with the boundary shell, not 27x. Image
// shifts are reported relative to the ORIGINAL (unwrapped) coordinates.
function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  pbc_override: Pbc | undefined,
  sorted: boolean,
  unique_pairs?: boolean,
): NeighborList
function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  pbc_override: Pbc | undefined,
  sorted: boolean,
  unique_pairs: boolean,
  visit: NeighborDistanceVisitor,
): void
function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  pbc_override: Pbc | undefined,
  sorted: boolean,
  unique_pairs = false,
  visit?: NeighborDistanceVisitor,
): NeighborList | void {
  const columns = numeric_sites.get(structure)
  const sites = columns ? [] : structure.sites
  const n_sites = columns?.length ?? sites.length
  const coordinates = columns?.coordinates
  const stride = columns?.stride ?? 0
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    throw new Error(`neighbor_query: cutoff must be a positive finite number, got ${cutoff}`)
  }
  const cutoff_sq = cutoff * cutoff
  const normal_cutoff =
    Number.isFinite(cutoff_sq) && cutoff_sq >= Number.MIN_VALUE / Number.EPSILON
  const lattice = `lattice` in structure ? structure.lattice.matrix : null
  const pbc = lattice_pbc_or_throw(structure, pbc_override)

  // Cloud = wrapped base sites (first n_sites slots, index-aligned) + periodic images.
  // cloud_src maps a cloud slot to its site; cloud_shift holds the integer lattice shift
  // from that site's ORIGINAL position (wrap + replica shift).
  let n_cloud = n_sites
  let cloud_pos: Float64Array = new Float64Array(n_sites * 3)
  let cloud_src: Int32Array = new Int32Array(n_sites)
  let cloud_shift: Int32Array = new Int32Array(n_sites * 3)
  for (let idx = 0; idx < n_sites; idx++) {
    const coord_x = coordinates ? coordinates[idx * stride] : sites[idx].xyz[0]
    const coord_y = coordinates ? coordinates[idx * stride + 1] : sites[idx].xyz[1]
    const coord_z = coordinates ? coordinates[idx * stride + 2] : sites[idx].xyz[2]
    if (!(Number.isFinite(coord_x) && Number.isFinite(coord_y) && Number.isFinite(coord_z))) {
      throw new Error(
        `neighbor_query: site ${idx} has a non-finite position (${coord_x}, ${coord_y}, ${coord_z})`,
      )
    }
    cloud_pos[idx * 3] = coord_x
    cloud_pos[idx * 3 + 1] = coord_y
    cloud_pos[idx * 3 + 2] = coord_z
    cloud_src[idx] = idx
  }
  if (lattice && pbc.some(Boolean)) {
    const heights = math.cell_heights(lattice)
    if (pbc.some((flag, axis) => flag && !(heights[axis] > 0 && heights[axis] < Infinity))) {
      throw new Error(
        `neighbor_query: periodic lattice is degenerate (cell heights ${heights.join(`, `)} A)`,
      )
    }
    const [
      [axis_x, axis_y, axis_z],
      [basis_x, basis_y, basis_z],
      [center_x, center_y, center_z],
    ] = lattice
    const cart_to_frac = math.create_cart_to_frac(lattice)
    // An image shifted by s along a periodic axis can reach the cell only if frac + s lands
    // within pad = cutoff / height of [0, 1]
    const pad: Vec3 = [0, 0, 0]
    const max_shift: Vec3 = [0, 0, 0]
    for (let axis = 0; axis < 3; axis++) {
      if (!pbc[axis]) continue
      pad[axis] = cutoff / heights[axis]
      max_shift[axis] = Math.ceil(pad[axis])
    }
    const in_reach = (frac: number, shift: number, axis: number): boolean =>
      !pbc[axis] || (frac + shift >= -pad[axis] && frac + shift <= 1 + pad[axis])
    // Wrapped fractional coords of every site plus the integer wrap shift applied, and per
    // axis the contiguous range [shift_lo, shift_hi] of image shifts in reach (0 always is:
    // the wrapped coordinate sits inside the cell)
    const frac = new Float64Array(n_sites * 3)
    const wrap = new Int32Array(n_sites * 3)
    const shift_lo = new Int32Array(n_sites * 3)
    const shift_hi = new Int32Array(n_sites * 3)
    const xyz: Vec3 = [0, 0, 0]
    const site_frac: Vec3 = [0, 0, 0]
    // exact image count = product over axes of the shifts in reach, minus the site itself
    let n_images = 0
    for (let idx = 0; idx < n_sites; idx++) {
      for (let axis = 0; axis < 3; axis++) xyz[axis] = cloud_pos[idx * 3 + axis]
      cart_to_frac(xyz, site_frac)
      let n_site_images = 1
      for (let axis = 0; axis < 3; axis++) {
        const offset = idx * 3 + axis
        wrap[offset] = pbc[axis] ? -Math.floor(site_frac[axis]) : 0
        frac[offset] = site_frac[axis] + wrap[offset]
        let lower = -max_shift[axis]
        let upper = max_shift[axis]
        while (lower < 0 && !in_reach(frac[offset], lower, axis)) lower++
        while (upper > 0 && !in_reach(frac[offset], upper, axis)) upper--
        shift_lo[offset] = lower
        shift_hi[offset] = upper
        n_site_images *= upper - lower + 1
      }
      n_images += n_site_images - 1
    }
    if (n_sites + n_images > MAX_IMAGE_CLOUD) {
      throw new Error(
        `neighbor_query: cutoff ${cutoff} A reaches ${max_shift.join(`, `)} cells along a, b, c ` +
          `(cell heights ${heights.map((val) => val.toFixed(2)).join(`, `)} A) and needs ` +
          `${n_images} periodic images of ${n_sites} sites; refusing to build more than ` +
          `${MAX_IMAGE_CLOUD} positions, a cutoff this far past the cell is almost always a ` +
          `unit mix-up`,
      )
    }
    n_cloud = n_sites + n_images
    cloud_pos = grow_f64(cloud_pos, n_cloud * 3)
    cloud_src = grow_i32(cloud_src, n_cloud)
    cloud_shift = grow_i32(cloud_shift, n_cloud * 3)
    let slot = 0
    const push_cloud = (idx: number, shift_a: number, shift_b: number, shift_c: number) => {
      const face_a = frac[idx * 3] + shift_a
      const face_b = frac[idx * 3 + 1] + shift_b
      const face_c = frac[idx * 3 + 2] + shift_c
      cloud_pos[slot * 3] = face_a * axis_x + face_b * basis_x + face_c * center_x
      cloud_pos[slot * 3 + 1] = face_a * axis_y + face_b * basis_y + face_c * center_y
      cloud_pos[slot * 3 + 2] = face_a * axis_z + face_b * basis_z + face_c * center_z
      cloud_src[slot] = idx
      cloud_shift[slot * 3] = wrap[idx * 3] + shift_a
      cloud_shift[slot * 3 + 1] = wrap[idx * 3 + 1] + shift_b
      cloud_shift[slot * 3 + 2] = wrap[idx * 3 + 2] + shift_c
      slot++
    }
    // Base slots first so cloud index === site index for the centers
    for (let idx = 0; idx < n_sites; idx++) push_cloud(idx, 0, 0, 0)
    for (let idx = 0; idx < n_sites; idx++) {
      const offset = idx * 3
      for (let shift_a = shift_lo[offset]; shift_a <= shift_hi[offset]; shift_a++) {
        for (let shift_b = shift_lo[offset + 1]; shift_b <= shift_hi[offset + 1]; shift_b++) {
          for (
            let shift_c = shift_lo[offset + 2];
            shift_c <= shift_hi[offset + 2];
            shift_c++
          ) {
            if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
            push_cloud(idx, shift_a, shift_b, shift_c)
          }
        }
      }
    }
  }

  if (n_cloud === 0) {
    if (visit) return
    return {
      n_centers: 0,
      cutoff,
      offsets: new Int32Array(1),
      neighbors: new Int32Array(0),
      images: new Int32Array(0),
      deltas: new Float64Array(0),
      distances: new Float64Array(0),
    }
  }

  // Dense bins over the cloud's bounding box, filled by counting sort so each bin is one
  // contiguous slice of `bin_items` (ascending slot, so base sites precede images).
  // Fine bins reduce candidate pairs in dense clouds; sparse grids widen to fit the cloud.
  // The selected forward stencil spans at least the cutoff along every axis.
  const mins: Vec3 = [Infinity, Infinity, Infinity]
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let slot = 0; slot < n_cloud; slot++) {
    for (let axis = 0; axis < 3; axis++) {
      const coord = cloud_pos[slot * 3 + axis]
      if (coord < mins[axis]) mins[axis] = coord
      if (coord > maxs[axis]) maxs[axis] = coord
    }
  }
  const bins_along = (width: number, axis: number) =>
    Math.floor((maxs[axis] - mins[axis]) / width) + 1
  const max_bins = MAX_BINS_PER_POSITION * n_cloud + 1
  // One width per axis, doubling the most-binned axis until the grid fits. A cloud with one
  // far-flung atom (an MD blow-up) spans ~10 A in two axes and 1e9+ A in the third: widening
  // that axis alone keeps the cluster spread over the other two instead of collapsing it
  // into a single O(n^2) bin, as one shared width (cubic bins) would. An isotropic sparse
  // cloud ends within 2x of the ideal width, which holds under 0.5 atoms per cutoff-bin.
  const bin: Vec3 = [cutoff, cutoff, cutoff]
  const n_axis: Vec3 = [bins_along(cutoff, 0), bins_along(cutoff, 1), bins_along(cutoff, 2)]
  // Dense RDF queries spend most of their time rejecting pairs outside the cutoff.
  // Finer bins reduce these candidates; sparse clouds and small cells keep cheap setup.
  const fine_bins =
    Boolean(visit) &&
    n_sites >= 2000 &&
    normal_cutoff &&
    n_cloud / (n_axis[0] * n_axis[1] * n_axis[2]) >= 32
  if (fine_bins) {
    for (let axis = 0; axis < 3; axis++) {
      // Subtracting the origin and dividing into bins each round both endpoints. Include
      // their span-scaled errors and the rounded distance comparison, so a cutoff pair
      // cannot straddle three half-width bins. Distance and cutoff arithmetic is unchanged.
      bin[axis] = cutoff / 2 + 4 * Number.EPSILON * (maxs[axis] - mins[axis] + cutoff)
      n_axis[axis] = bins_along(bin[axis], axis)
    }
  }
  const forward_offsets = fine_bins ? FINE_BIN_OFFSETS : FORWARD_BIN_OFFSETS
  while (n_axis[0] * n_axis[1] * n_axis[2] > max_bins) {
    const widest = n_axis.indexOf(Math.max(...n_axis))
    bin[widest] *= 2
    n_axis[widest] = bins_along(bin[widest], widest)
  }
  const [n_x, n_y, n_z] = n_axis
  const n_bins = n_x * n_y * n_z
  const bin_of = new Int32Array(n_cloud)
  const bin_start = new Int32Array(n_bins + 1)
  for (let slot = 0; slot < n_cloud; slot++) {
    const idx_x = Math.floor((cloud_pos[slot * 3] - mins[0]) / bin[0])
    const idx_y = Math.floor((cloud_pos[slot * 3 + 1] - mins[1]) / bin[1])
    const idx_z = Math.floor((cloud_pos[slot * 3 + 2] - mins[2]) / bin[2])
    const bin_idx = idx_x + n_x * (idx_y + n_y * idx_z)
    bin_of[slot] = bin_idx
    bin_start[bin_idx + 1]++
  }
  const boundary_masks =
    !fine_bins && normal_cutoff
      ? coarse_boundary_masks(cloud_pos, bin_of, bin, n_axis, mins, maxs, cutoff)
      : undefined
  for (let bin_idx = 0; bin_idx < n_bins; bin_idx++)
    bin_start[bin_idx + 1] += bin_start[bin_idx]
  // Counting sort keeps base sites before images. Remember their boundary in each bin so
  // image centers scan only base endpoints, without testing the boundary for every pair.
  const bin_base_end = bin_start.slice(0, n_bins)
  for (let slot = 0; slot < n_sites; slot++) bin_base_end[bin_of[slot]]++
  const bin_items = new Int32Array(n_cloud)
  const item_of = new Int32Array(visit ? 0 : n_cloud)
  const bin_cursor = bin_start.slice(0, n_bins)
  for (let slot = 0; slot < n_cloud; slot++) {
    const item = bin_cursor[bin_of[slot]]++
    bin_items[item] = slot
    if (!visit) item_of[slot] = item
  }

  // Pair sweep: every pair within cutoff once, from the lexicographically lower bin (own
  // bin: from the lower slot). Pairs between two images are skipped, since images are never
  // centers. Streaming histograms reuse adjacent ranges for every slot in an occupied bin.
  // Materialized lists keep their original slot discovery order: bond consumers use that
  // order for geometric deduplication and hull construction. Image-only bins can skip
  // every range that contains no base endpoints.
  // Pairs are stored once (struct of arrays) and counted towards each base
  // endpoint; the per-center lists are assembled from them below.
  let pair_a: Int32Array = new Int32Array(visit ? 0 : Math.max(256, n_sites * 8))
  let pair_b: Int32Array = new Int32Array(pair_a.length)
  let pair_dist_sq: Float64Array = new Float64Array(pair_a.length)
  const offsets = new Int32Array(n_sites + 1) // per-center counts until the prefix sum below
  let n_pairs = 0
  // Scan own bin first (starting just past the slot itself), then forward neighbors.
  const range_count = (boundary_masks ? FINE_BIN_OFFSETS : forward_offsets).length + 1
  // Each range stores its start, end, and end of base (non-image) positions.
  const scratch_ranges = new Int32Array(range_count * 3)
  // Reuse ranges when materialized queries revisit a bin in site discovery order.
  const ranges_by_bin = Array.from<Int32Array | undefined>({ length: visit ? 0 : n_bins })
  const n_groups = visit ? n_bins : n_cloud
  for (let group_idx = 0; group_idx < n_groups; group_idx++) {
    const bin_idx = visit ? group_idx : bin_of[group_idx]
    const bin_first = bin_start[bin_idx]
    const bin_end = bin_start[bin_idx + 1]
    if (bin_first === bin_end) continue
    const images_only = bin_base_end[bin_idx] === bin_first
    let ranges = ranges_by_bin[bin_idx]
    if (!ranges) {
      const idx_x = bin_idx % n_x
      const idx_y = Math.floor(bin_idx / n_x) % n_y
      const idx_z = Math.floor(bin_idx / (n_x * n_y))
      let range_size = 3
      scratch_ranges[1] = bin_end
      scratch_ranges[2] = bin_base_end[bin_idx]
      const bin_mask = boundary_masks?.[bin_idx] ?? 0
      const bin_offsets = bin_mask ? BOUNDARY_BIN_OFFSETS[bin_mask] : forward_offsets
      for (const [delta_x, delta_y, delta_z, opposite] of bin_offsets) {
        const neighbor_x = idx_x + delta_x
        const neighbor_y = idx_y + delta_y
        const neighbor_z = idx_z + delta_z
        if (
          neighbor_x < 0 ||
          neighbor_x >= n_x ||
          neighbor_y < 0 ||
          neighbor_y >= n_y ||
          neighbor_z < 0 ||
          neighbor_z >= n_z
        )
          continue
        const other = neighbor_x + n_x * (neighbor_y + n_y * neighbor_z)
        if (opposite && ((boundary_masks?.[other] ?? 0) & opposite) !== opposite) continue
        if (
          bin_start[other] === bin_start[other + 1] ||
          (images_only && bin_base_end[other] === bin_start[other])
        )
          continue
        scratch_ranges[range_size++] = bin_start[other]
        scratch_ranges[range_size++] = bin_start[other + 1]
        scratch_ranges[range_size++] = bin_base_end[other]
      }
      ranges = scratch_ranges.subarray(0, range_size)
      if (!visit && bin_end - bin_first > 1) {
        ranges = ranges.slice()
        ranges_by_bin[bin_idx] = ranges
      }
    }
    if (images_only && ranges.length === 3) continue
    const center_first = visit ? bin_first : item_of[group_idx]
    const center_end = visit ? bin_end : center_first + 1
    for (let center_item = center_first; center_item < center_end; center_item++) {
      const slot_a = bin_items[center_item]
      const pos_x = cloud_pos[slot_a * 3]
      const pos_y = cloud_pos[slot_a * 3 + 1]
      const pos_z = cloud_pos[slot_a * 3 + 2]
      const stop_at_images = slot_a >= n_sites
      for (let range = stop_at_images ? 3 : 0; range < ranges.length; range += 3) {
        const item_start = range === 0 ? center_item + 1 : ranges[range]
        const item_end = ranges[range + (stop_at_images ? 2 : 1)]
        for (let item = item_start; item < item_end; item++) {
          const slot_b = bin_items[item]
          const delta_x = cloud_pos[slot_b * 3] - pos_x
          const delta_y = cloud_pos[slot_b * 3 + 1] - pos_y
          const delta_z = cloud_pos[slot_b * 3 + 2] - pos_z
          const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
          if (dist_sq > cutoff_sq) continue
          // Histogram consumers need neither directed lists nor image/displacement buffers.
          // Keep the exact distance arithmetic while streaming each base endpoint once.
          if (visit) {
            const distance = Math.sqrt(dist_sq)
            if (slot_a < n_sites) visit(slot_a, cloud_src[slot_b], distance)
            if (slot_b < n_sites) visit(slot_b, cloud_src[slot_a], distance)
            continue
          }
          if (n_pairs === pair_a.length) {
            if (n_pairs >= MAX_NEIGHBOR_PAIRS) {
              throw new Error(
                `neighbor_query: more than ${MAX_NEIGHBOR_PAIRS.toLocaleString()} pairs within ` +
                  `${cutoff} A of ${n_sites} sites; the neighbor lists would not fit in memory, ` +
                  `lower the cutoff or the site count`,
              )
            }
            pair_a = grow_i32(pair_a, n_pairs + 1, MAX_NEIGHBOR_PAIRS)
            pair_b = grow_i32(pair_b, n_pairs + 1, MAX_NEIGHBOR_PAIRS)
            pair_dist_sq = grow_f64(pair_dist_sq, n_pairs + 1, MAX_NEIGHBOR_PAIRS)
          }
          pair_a[n_pairs] = slot_a
          pair_b[n_pairs] = slot_b
          pair_dist_sq[n_pairs] = dist_sq
          if (slot_a < n_sites && (!unique_pairs || slot_a < slot_b)) offsets[slot_a + 1]++
          if (slot_b < n_sites && (!unique_pairs || slot_b < slot_a)) offsets[slot_b + 1]++
          n_pairs++
        }
      }
    }
  }
  if (visit) return

  // Scatter each pair to its base endpoint(s) as a directed entry (2*pair for endpoint a,
  // 2*pair + 1 for endpoint b), then sort every center's block by distance (ties by partner
  // slot, so the order is deterministic) and emit the partner as seen from that center. The
  // displacement is recomputed from the cloud positions rather than stored per pair: it is
  // the same subtraction either way, and not carrying 24 B per pair through the sweep is
  // what keeps the hot loop's working set small.
  for (let center = 0; center < n_sites; center++) offsets[center + 1] += offsets[center]
  const total = offsets[n_sites]
  const entry_at = new Int32Array(total)
  const center_cursor = offsets.slice(0, n_sites)
  for (let pair = 0; pair < n_pairs; pair++) {
    const slot_a = pair_a[pair]
    const slot_b = pair_b[pair]
    if (slot_a < n_sites && (!unique_pairs || slot_a < slot_b))
      entry_at[center_cursor[slot_a]++] = pair * 2
    if (slot_b < n_sites && (!unique_pairs || slot_b < slot_a))
      entry_at[center_cursor[slot_b]++] = pair * 2 + 1
  }
  const neighbors = new Int32Array(total)
  const images = new Int32Array(total * 3)
  const deltas = new Float64Array(total * 3)
  const distances = new Float64Array(total)
  // per-block scratch: sort keys copied out so the insertion sort touches contiguous memory
  let block_partner: Int32Array = new Int32Array(256)
  let block_dist_sq: Float64Array = new Float64Array(256)
  let block_perm: Int32Array = new Int32Array(256)
  for (let center = 0; center < n_sites; center++) {
    const start = offsets[center]
    const count = offsets[center + 1] - start
    if (count > block_partner.length) {
      block_partner = grow_i32(block_partner, count)
      block_dist_sq = grow_f64(block_dist_sq, count)
      block_perm = grow_i32(block_perm, count)
    }
    for (let rank = 0; rank < count; rank++) {
      const entry = entry_at[start + rank]
      block_partner[rank] = entry & 1 ? pair_a[entry >> 1] : pair_b[entry >> 1]
      block_dist_sq[rank] = pair_dist_sq[entry >> 1]
      block_perm[rank] = rank
    }
    // Unsorted blocks keep sweep order (deterministic, not by distance). Insertion sort for
    // the usual handful of neighbors, comparator sort for wide cutoffs.
    if (sorted && count <= 64) {
      for (let idx = 1; idx < count; idx++) {
        const rank = block_perm[idx]
        const dist_sq = block_dist_sq[rank]
        const partner = block_partner[rank]
        let pos = idx - 1
        while (pos >= 0) {
          const prev = block_perm[pos]
          const prev_dist_sq = block_dist_sq[prev]
          if (
            prev_dist_sq < dist_sq ||
            (prev_dist_sq === dist_sq && block_partner[prev] < partner)
          )
            break
          block_perm[pos + 1] = prev
          pos--
        }
        block_perm[pos + 1] = rank
      }
    } else if (sorted) {
      block_perm
        .subarray(0, count)
        .sort(
          (rank_a, rank_b) =>
            block_dist_sq[rank_a] - block_dist_sq[rank_b] ||
            block_partner[rank_a] - block_partner[rank_b],
        )
    }
    const center_shift_a = cloud_shift[center * 3]
    const center_shift_b = cloud_shift[center * 3 + 1]
    const center_shift_c = cloud_shift[center * 3 + 2]
    const center_x = cloud_pos[center * 3]
    const center_y = cloud_pos[center * 3 + 1]
    const center_z = cloud_pos[center * 3 + 2]
    for (let idx = 0; idx < count; idx++) {
      const rank = block_perm[idx]
      const partner = block_partner[rank]
      const out = start + idx
      neighbors[out] = cloud_src[partner]
      // image = partner's total shift - center's wrap shift, so that
      // sites[partner].xyz + image·L - sites[center].xyz === delta
      images[out * 3] = cloud_shift[partner * 3] - center_shift_a
      images[out * 3 + 1] = cloud_shift[partner * 3 + 1] - center_shift_b
      images[out * 3 + 2] = cloud_shift[partner * 3 + 2] - center_shift_c
      deltas[out * 3] = cloud_pos[partner * 3] - center_x
      deltas[out * 3 + 1] = cloud_pos[partner * 3 + 1] - center_y
      deltas[out * 3 + 2] = cloud_pos[partner * 3 + 2] - center_z
      distances[out] = Math.sqrt(block_dist_sq[rank])
    }
  }
  return { n_centers: n_sites, cutoff, offsets, neighbors, images, deltas, distances }
}

// Search bounds of the k-nearest query. The seed radius comes from the mean volume per atom;
// the radius stops growing at `max_cutoff`: a few cell heights for a crystal (whose images
// are endless), the bounding-box diagonal for a finite cluster, within which every pair of
// its sites lies, so each site can always reach its n - 1 partners. The cube root of the box
// volume fell short of that on an elongated cluster (a 100 A chain of 3 atoms: 9 A). A planar
// or linear cluster has a zero-thickness box; 1 A per axis keeps its volume finite.
const k_search_bounds = (
  structure: AnyStructure,
): { total_volume: number; max_cutoff: number } => {
  if (`lattice` in structure) {
    const { volume, matrix } = structure.lattice
    return { total_volume: volume, max_cutoff: 4 * Math.max(...math.cell_heights(matrix)) }
  }
  const mins: Vec3 = [Infinity, Infinity, Infinity]
  const maxs: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const { xyz } of structure.sites) {
    for (let axis = 0; axis < 3; axis++) {
      if (xyz[axis] < mins[axis]) mins[axis] = xyz[axis]
      if (xyz[axis] > maxs[axis]) maxs[axis] = xyz[axis]
    }
  }
  const extents = [0, 1, 2].map((axis) => Math.max(maxs[axis] - mins[axis], 1))
  return {
    total_volume: extents[0] * extents[1] * extents[2],
    max_cutoff: Math.hypot(...extents),
  }
}

// The periodic axes an analysis should bond across when the caller gives none: the lattice's
// own pbc. LatticeType.pbc is required, so a crystal without it is malformed input (hand-built
// props); falling through to a finite pass would silently under-count every coordination
// number and angle, so it throws instead.
export function lattice_pbc_or_throw(structure: AnyStructure, override?: Pbc): Pbc {
  if (override) return override
  if (!(`lattice` in structure)) return NO_PBC
  const { pbc } = structure.lattice
  if (!Array.isArray(pbc) || pbc.length !== 3) {
    throw new Error(
      `lattice.pbc must be a [boolean, boolean, boolean], got ${JSON.stringify(pbc)}`,
    )
  }
  return pbc
}

// Visit each directed neighbor without retaining pair records or constructing result
// arrays. Repeated periodic images are separate visits, including a site's own images.
// This lets histograms process large cutoffs with memory proportional to the image cloud.
export function visit_neighbor_distances(
  structure: AnyStructure,
  { cutoff, pbc }: { cutoff: number; pbc?: Pbc },
  visit: NeighborDistanceVisitor,
): void {
  neighbor_query_cutoff(structure, cutoff, pbc, false, false, visit)
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
  if (`cutoff` in options) {
    return neighbor_query_cutoff(
      structure,
      options.cutoff,
      options.pbc,
      options.sorted ?? true,
    )
  }
  const { k: order, pbc } = options
  if (!Number.isInteger(order) || order < 1) {
    throw new Error(`neighbor_query: k must be a positive integer, got ${order}`)
  }
  const n_sites = structure.sites.length
  if (n_sites === 0) return neighbor_query_cutoff(structure, 1, pbc, true)
  const { total_volume, max_cutoff } = k_search_bounds(structure)
  const atom_volume = total_volume / n_sites
  // radius of the sphere holding k+1 atoms at the mean density, widened 30% so the first
  // pass usually suffices even for an anisotropic first shell
  let cutoff = 1.3 * ((3 * (order + 1) * atom_volume) / (4 * Math.PI)) ** (1 / 3)
  for (;;) {
    const list = neighbor_query_cutoff(structure, cutoff, pbc, true)
    let short = false
    for (let center = 0; center < n_sites && !short; center++) {
      short = list.offsets[center + 1] - list.offsets[center] < order
    }
    if (short && cutoff < max_cutoff) {
      cutoff = Math.min(cutoff * 1.4, max_cutoff)
      continue
    }
    // keep the k nearest per center (prefix of each sorted block)
    const offsets = new Int32Array(n_sites + 1)
    for (let center = 0; center < n_sites; center++) {
      const count = list.offsets[center + 1] - list.offsets[center]
      offsets[center + 1] = offsets[center] + Math.min(order, count)
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

// Anion neighbours a metal needs before its metal-metal contacts count as second shell.
// Matches DEFAULTS.structure.polyhedra_min_neighbors: a tetrahedron is the smallest real
// coordination environment, so anything below it is an unsaturated (metal-rich) atom whose
// metal-metal contacts are structural (Ti2O, Hg2Cl2, Li3N).
const MIN_ANION_SHELL = 4

// Width of the first-shell test for metal-metal contacts, relative to the atom's shortest
// metal-metal contact: half weight 12% out. bcc's second shell sits 15.5% out and must
// fail; the split shells of Laves phases (~6%) and of distorted high-entropy alloys (first
// shells spread over ~10%) must pass.
const METAL_SHELL_WIDTH = 0.12 / Math.sqrt(Math.LN2)

// Width of the one-sided "no longer than the radii sum" test applied to contacts between
// atoms that already sit inside a coordination shell (see `stretch` below). It has to
// reject Li-P in phosphates (1.13x) and Cu-Cu in Cu2O (1.18x) while keeping Si-Si in
// siloxanes (1.06x) and Ti-Ti in Ti2O (1.01x).
const STRETCH_WIDTH = 0.08

type BondingStrategyFn = (
  structure: AnyStructure,
  options?: Record<string, unknown>,
) => BondPair[]
export const BONDING_STRATEGIES = {
  electroneg_ratio,
  explicit_only,
} as const satisfies Record<string, BondingStrategyFn>
export type BondingStrategy = keyof typeof BONDING_STRATEGIES

// Memo for the costly neighbor search: WeakMap keyed by structure (GC'd with it), each holding a
// per-signature (strategy + JSON options) map of results. The multi-side view's 4 panes share one
// search (identical inputs, one flush); the per-signature map also lets alternating
// strategies/options on the same structure reuse earlier results instead of thrashing one slot.
const bond_memo = new WeakMap<AnyStructure, Map<string, BondPair[] | BondFrame>>()

// Install geometry computed by the source worker for this exact displayed structure.
export function cache_prepared_bonds(
  structure: AnyStructure,
  strategy: BondingStrategy,
  options: Record<string, unknown>,
  bonds: BondPair[] | BondFrame,
): void {
  let by_sig = bond_memo.get(structure)
  if (!by_sig) bond_memo.set(structure, (by_sig = new Map()))
  by_sig.set(`${strategy}:${JSON.stringify(options)}`, bonds)
}

type BondNeighborList = Pick<NeighborList, 'offsets' | 'neighbors' | 'distances'> & {
  image_geometry?: Pick<NeighborList, 'images' | 'deltas'>
}
type BondNeighborQuery = (
  structure: AnyStructure,
  cutoff: number,
  pbc: Pbc,
  sorted: boolean,
  unique_pairs: boolean,
) => BondNeighborList

const query_bond_neighbors: BondNeighborQuery = (...args) => {
  const { offsets, neighbors, distances, images, deltas } = neighbor_query_cutoff(...args)
  return { offsets, neighbors, distances, image_geometry: { images, deltas } }
}

// A Verlet list for finite displayed sites. Keep geometric candidates, including contacts
// rejected by chemistry, and rebuild when either endpoint could cross the extra skin.
// Queries that explicitly request periodic image bonds retain their complete image search.
export class BondSearch {
  private readonly scratch = create_bond_scratch()
  private candidates: BondNeighborList | undefined
  private reference = new Float64Array(0)
  private cutoff = 0
  private skin = 0
  private cell_key = ``

  private readonly query: BondNeighborQuery = (structure, cutoff, pbc, sorted, unique) => {
    if (pbc.some(Boolean) || sorted || !unique) {
      this.candidates = undefined
      return query_bond_neighbors(structure, cutoff, pbc, sorted, unique)
    }
    const columns = numeric_sites.get(structure)
    const sites = columns ? [] : structure.sites
    const n_sites = columns?.length ?? sites.length
    const coordinates = columns?.coordinates
    const stride = columns?.stride ?? 0
    // Inline column reads avoid millions of accessor calls during candidate reuse.
    const lattice = `lattice` in structure ? structure.lattice : undefined
    const cell_key = JSON.stringify(lattice)
    const skin = Math.min(1.5, cutoff / 2)
    // A periodic candidate superset survives wrapping. Use it only when each source pair
    // has at most one image inside the search radius; the output still bonds finite sites.
    const periodic =
      lattice?.pbc.some(Boolean) &&
      math
        .cell_heights(lattice.matrix)
        .every((height, axis) => !lattice.pbc[axis] || height > 2 * (cutoff + skin))
        ? lattice
        : undefined
    const to_frac = periodic ? math.create_cart_to_frac(periodic.matrix) : undefined
    const to_cart = periodic ? math.create_frac_to_cart(periodic.matrix) : undefined
    const delta: Vec3 = [0, 0, 0]
    const fractional: Vec3 = [0, 0, 0]
    let rebuild =
      !this.candidates ||
      cutoff !== this.cutoff ||
      cell_key !== this.cell_key ||
      n_sites * 3 !== this.reference.length
    // This box fits strictly inside the skin/2 sphere (sqrt(3)/4 < 1/2), so
    // ordinary small MD displacements need no square root.
    const small_move = this.skin / 4
    for (let idx = 0; idx < n_sites && !rebuild; idx++) {
      for (let axis = 0; axis < 3; axis++)
        delta[axis] =
          (coordinates ? coordinates[idx * stride + axis] : sites[idx].xyz[axis]) -
          this.reference[idx * 3 + axis]
      if (
        Math.abs(delta[0]) < small_move &&
        Math.abs(delta[1]) < small_move &&
        Math.abs(delta[2]) < small_move
      )
        continue
      if (Math.hypot(delta[0], delta[1], delta[2]) < this.skin / 2) continue
      if (periodic && to_frac && to_cart) {
        to_frac(delta, fractional)
        for (let axis = 0; axis < 3; axis++)
          if (periodic.pbc[axis]) fractional[axis] -= Math.round(fractional[axis])
        to_cart(fractional, delta)
      }
      // Compare against the rebuild frame, not the last frame; cumulative drift counts.
      if (!(Math.hypot(delta[0], delta[1], delta[2]) < this.skin / 2)) rebuild = true
    }
    if (rebuild) {
      this.cutoff = cutoff
      this.skin = skin
      this.cell_key = cell_key
      const list = neighbor_query_cutoff(
        structure,
        cutoff + skin,
        periodic?.pbc ?? pbc,
        false,
        true,
      )
      if (periodic) {
        let read_start = 0
        let write_slot = 0
        for (let center = 0; center < n_sites; center++) {
          const read_end = list.offsets[center + 1]
          list.offsets[center] = write_slot
          for (let slot = read_start; slot < read_end; slot++)
            if (list.neighbors[slot] > center)
              list.neighbors[write_slot++] = list.neighbors[slot]
          read_start = read_end
        }
        list.offsets[n_sites] = write_slot
      }
      // Finite candidates need only pair identity and distance. Image displacements from
      // the periodic superset are discarded before recomputing finite-site distances.
      const { offsets, neighbors, distances } = list
      this.candidates = { offsets, neighbors, distances }
      this.reference = new Float64Array(n_sites * 3)
      for (let idx = 0; idx < n_sites; idx++)
        for (let axis = 0; axis < 3; axis++)
          this.reference[idx * 3 + axis] = coordinates
            ? coordinates[idx * stride + axis]
            : sites[idx].xyz[axis]
    }
    const list = this.candidates
    if (!list) throw new Error(`Missing bond candidates for cutoff ${cutoff}`)
    const { offsets, neighbors, distances } = list
    for (let center = 0; center < n_sites; center++) {
      const origin_x = coordinates ? coordinates[center * stride] : sites[center].xyz[0]
      const origin_y = coordinates ? coordinates[center * stride + 1] : sites[center].xyz[1]
      const origin_z = coordinates ? coordinates[center * stride + 2] : sites[center].xyz[2]
      for (let slot = offsets[center]; slot < offsets[center + 1]; slot++) {
        const partner = neighbors[slot]
        const delta_x =
          (coordinates ? coordinates[partner * stride] : sites[partner].xyz[0]) - origin_x
        const delta_y =
          (coordinates ? coordinates[partner * stride + 1] : sites[partner].xyz[1]) - origin_y
        const delta_z =
          (coordinates ? coordinates[partner * stride + 2] : sites[partner].xyz[2]) - origin_z
        // Match the full finite query's arithmetic, including its subnormal-distance path.
        // oxlint-disable-next-line eslint-plugin-unicorn/prefer-modern-math-apis -- same arithmetic as full query
        distances[slot] = Math.sqrt(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z)
      }
    }
    return list
  }

  compute_columns(
    structure: AnyStructure,
    options: Parameters<typeof electroneg_ratio>[1] = {},
  ): BondColumns {
    if (!site_count(structure)) return pack_bonds([])
    return bond_columns(
      structure,
      perceive_bonds(structure, options, this.query, this.scratch),
    )
  }
}

export function compute_bonds(
  structure: AnyStructure,
  strategy: BondingStrategy,
  options: Record<string, unknown> = {},
): BondPair[] {
  const data = get_bond_data(structure, strategy, options)
  return data instanceof BondFrame ? data.materialize() : data
}

export function get_bond_data(
  structure: AnyStructure,
  strategy: BondingStrategy,
  options: Record<string, unknown> = {},
): BondPair[] | BondFrame {
  const sig = `${strategy}:${JSON.stringify(options)}`
  let by_sig = bond_memo.get(structure)
  const cached = by_sig?.get(sig)
  if (cached) return cached
  const strategy_fn: BondingStrategyFn = BONDING_STRATEGIES[strategy]
  const bonds = strategy_fn(structure, options)
  if (!by_sig) bond_memo.set(structure, (by_sig = new Map()))
  by_sig.set(sig, bonds)
  return bonds
}

// Electronegativity-based bonding with chemical preferences.
// Candidates come from neighbor_query at the longest reach any element pair present can
// bond over; everything below is chemistry layered on that geometric list. Contacts fall
// in three classes with their own distance model:
//   metallic  (metal-metal): expected length from 12-coordinate metallic radii, kept only
//             in the atom's first metal-metal shell (bcc's second shell is 15% out and is
//             rejected; Laves phases and alloys with split shells pass). Once a metal has
//             a full anion shell its metal-metal contacts are second-shell artifacts
//             (Na-Na in NaCl, Sr-Ti in SrTiO3) and are dropped.
//   lenient   (any contact to a terminal anion - an anion-former with no more
//             electronegative partner, like O in a phosphate or C in methane): covalent
//             radii with a wide distance window, because ionic bonds stretch a lot
//             (Ti-O 1.82 and 2.39 A both bond in tetragonal BaTiO3).
//   tight     (everything else: Li-P in phosphates, Ca-N in nitrates, Si-Si in siloxanes,
//             Mn-C in carbonyls): both atoms are inner atoms of some coordination
//             environment, so a contact longer than the radii sum is a second-shell
//             contact across that environment, not a bond.
// Bonds are only created if the computed strength exceeds strength_threshold.
type PerceivedBonds = Omit<BondNeighborList, 'offsets'> & {
  centers: Int32Array
  slots: Int32Array
  count: number
}

export function electroneg_ratio(
  structure: AnyStructure,
  options: Parameters<typeof perceive_bonds>[1] = {},
): BondPair[] {
  if (!site_count(structure)) return []
  return new BondFrame(
    structure,
    bond_columns(structure, perceive_bonds(structure, options)),
  ).materialize()
}

// Both public records and worker columns consume the same accepted contacts in discovery order.
function bond_columns(
  structure: AnyStructure,
  { centers, slots, count, neighbors, image_geometry, distances }: PerceivedBonds,
): BondColumns {
  const explicit = new Map(
    get_explicit_bond_metadata(structure).map((bond) => [
      get_bond_key(bond.site_idx_1, bond.site_idx_2, bond.cell_shift),
      bond,
    ]),
  )
  const indices = new Uint32Array((count + explicit.size) * 2)
  const lengths = new Float64Array(count + explicit.size)
  const orders = new Uint8Array(count + explicit.size)
  let image_count = 0
  if (image_geometry)
    for (let idx = 0; idx < count; idx++) {
      const slot = slots[idx] * 3
      const { images } = image_geometry
      if (images[slot] || images[slot + 1] || images[slot + 2]) image_count++
    }
  for (const bond of explicit.values()) if (bond.cell_shift) image_count++
  const image_columns = new Float64Array(image_count * 7)
  let image_offset = 0
  let bond_count = 0
  for (; bond_count < count; bond_count++) {
    const slot = slots[bond_count]
    const site_idx_1 = centers[bond_count]
    const site_idx_2 = neighbors[slot]
    indices[bond_count * 2] = site_idx_1
    indices[bond_count * 2 + 1] = site_idx_2
    lengths[bond_count] = distances[slot]
    const shift_a = image_geometry ? image_geometry.images[slot * 3] : 0
    const shift_b = image_geometry ? image_geometry.images[slot * 3 + 1] : 0
    const shift_c = image_geometry ? image_geometry.images[slot * 3 + 2] : 0
    const shifted = shift_a !== 0 || shift_b !== 0 || shift_c !== 0
    if (image_geometry && shifted) {
      const origin =
        numeric_sites.get(structure)?.position(site_idx_1) ?? structure.sites[site_idx_1].xyz
      image_columns[image_offset++] = bond_count
      image_columns[image_offset++] = origin[0] + image_geometry.deltas[slot * 3]
      image_columns[image_offset++] = origin[1] + image_geometry.deltas[slot * 3 + 1]
      image_columns[image_offset++] = origin[2] + image_geometry.deltas[slot * 3 + 2]
      image_columns[image_offset++] = shift_a
      image_columns[image_offset++] = shift_b
      image_columns[image_offset++] = shift_c
    }
    if (explicit.size) {
      const key = get_bond_key(
        site_idx_1,
        site_idx_2,
        shifted ? [shift_a, shift_b, shift_c] : undefined,
      )
      const metadata = explicit.get(key)
      if (metadata) {
        orders[bond_count] = BOND_ORDERS.indexOf(metadata.order)
        explicit.delete(key)
      }
    }
  }
  for (const metadata of explicit.values()) {
    const bond = structure_bond_to_bond_pair(structure, metadata)
    indices[bond_count * 2] = bond.site_idx_1
    indices[bond_count * 2 + 1] = bond.site_idx_2
    lengths[bond_count] = bond.bond_length
    orders[bond_count] = BOND_ORDERS.indexOf(bond.bond_order)
    if (bond.cell_shift) {
      image_columns.set([bond_count, ...bond.pos_2, ...bond.cell_shift], image_offset)
      image_offset += 7
    }
    bond_count++
  }
  // Only explicit overrides leave spare capacity; each result owns new backing buffers.
  return {
    indices: indices.subarray(0, bond_count * 2),
    lengths: lengths.subarray(0, bond_count),
    orders: orders.subarray(0, bond_count),
    images: image_columns.subarray(0, image_offset),
  }
}

type BondScratch = {
  slots: Int32Array
  centers: Int32Array
  normalized: Float64Array
  metallic: Int32Array
  strengths: Float64Array
}
// Private candidates are overwritten on each preparation. Public columns copy their
// selected results, so retaining this workspace cannot mutate previously displayed frames.
const create_bond_scratch = (capacity = 0): BondScratch => ({
  slots: new Int32Array(capacity),
  centers: new Int32Array(capacity),
  normalized: new Float64Array(capacity),
  metallic: new Int32Array(capacity),
  strengths: new Float64Array(capacity),
})

function perceive_bonds(
  structure: AnyStructure,
  {
    electronegativity_threshold = 1.7, // Max electronegativity difference for bonding
    max_distance_ratio = 2.0, // Max distance as multiple of the expected bond length
    min_bond_dist = 0.4, // Minimum bond distance in Angstroms
    metal_metal_penalty = 0.7, // Strength penalty for metal-metal bonds
    // Strength factor for metal-metal contacts that are second-shell contacts across an
    // anion sublattice: either metal already has a full anion shell (MIN_ANION_SHELL), or
    // one of them is an alkali/heavy alkaline-earth cation carrying any anion at all
    // (those never metal-metal bond in their compounds, however short the contact: K-K in
    // KCl is 0.98x the metallic sum). 0 drops them; 1 keeps the metal cluster bonds of
    // e.g. Mo6S8 or NbO at the price of drawing every Na-Na contact in rocksalt.
    cation_cation_penalty = 0,
    metal_nonmetal_bonus = 1.5, // Strength bonus for metal-nonmetal bonds
    similar_electronegativity_bonus = 1.2, // Bonus for similar electronegativity
    strength_threshold = 0.3, // Minimum bond strength to include in results
    // Periodic axes to bond across. Off by default: the site list is bonded as the finite
    // set of atoms it is, which is what the renderer wants (it appends the image atoms it
    // draws, see get_pbc_image_sites, and bonds must join drawn atoms). Analyses that want
    // the infinite crystal (coordination, bond angles) pass the lattice's pbc and get bonds
    // to periodic images with `cell_shift` set and `pos_2` at the image position.
    pbc = NO_PBC,
  } = {},
  query: BondNeighborQuery = query_bond_neighbors,
  scratch = create_bond_scratch(),
): PerceivedBonds {
  const columns = numeric_sites.get(structure)
  const sites = columns ?? structure.sites
  const n_sites = sites.length
  // Per-site properties in flat typed arrays - the candidate loop below visits every
  // contact within reach in large supercells, so object property chains and Map lookups
  // are replaced with indexed array reads.
  const { symbols, site_elem_ids: elem_ids, elem_data } = intern_site_elements(sites)
  const orig_idxs = new Int32Array(n_sites)
  const scalar_columns = columns?.scalar_columns
  const unit_cell_indices =
    scalar_columns && Object.hasOwn(scalar_columns, `orig_unit_cell_idx`)
      ? scalar_columns.orig_unit_cell_idx
      : undefined
  const image_indices =
    scalar_columns && Object.hasOwn(scalar_columns, `orig_site_idx`)
      ? scalar_columns.orig_site_idx
      : undefined
  for (let idx = 0; idx < n_sites; idx++) {
    // Valid orig indices always reference a site in this structure; fall back to
    // the site's own index on out-of-range orig_*_idx properties so the typed
    // `closest` array below stays bounded by n_sites
    const orig_idx =
      sites instanceof NumericSites
        ? (unit_cell_indices?.[idx] ?? image_indices?.[idx] ?? idx)
        : get_orig_site_idx(sites[idx], idx)
    orig_idxs[idx] = orig_idx >= 0 && orig_idx < n_sites ? orig_idx : idx
  }
  const n_elem = symbols.length
  const elem_en = new Float64Array(n_elem)
  const elem_metal = new Uint8Array(n_elem)
  const elem_nonmetal = new Uint8Array(n_elem)
  const elem_anion_former = new Uint8Array(n_elem) // nonmetal or metalloid
  const elem_spectator = new Uint8Array(n_elem)
  for (const [elem_id, symbol] of symbols.entries()) {
    const data = elem_data[elem_id]
    elem_en[elem_id] = data?.electronegativity ?? 2.0
    elem_metal[elem_id] = data?.metal ? 1 : 0
    elem_nonmetal[elem_id] = data?.nonmetal ? 1 : 0
    elem_anion_former[elem_id] = data?.nonmetal || data?.metalloid ? 1 : 0
    elem_spectator[elem_id] = is_spectator_center(symbol) ? 1 : 0
  }

  // Per-element-pair acceptance table. pair_factor depends only on the element pair, and
  // dist_weight = exp(-((d/expected - 1)^2)/0.18) is at most 1, so the whole pair is
  // unreachable when pair_factor <= threshold, and otherwise passes only while
  // (d/expected - 1)^2 < -0.18*ln(threshold / pair_factor). That is a band around
  // `expected`, not just a ceiling: dist_weight is a Gaussian in (ratio - 1), so an
  // over-SHORT contact fails too, and dropping the floor would let one into `closest` and
  // over-penalize every real bond on that atom. Inverting both edges to distances turns the
  // candidate loop's cutoff into two array reads and lets the neighbor search run at the
  // true reach instead of max_distance_ratio: 4.2 A rather than 6.6 for rocksalt. Both
  // bounds stay zero for a pair with an unknown radius, so it falls out of the ceiling test
  // in pass 1 without a special case.
  const pair_expected = new Float64Array(n_elem * n_elem)
  const pair_factor = new Float64Array(n_elem * n_elem)
  const pair_metallic = new Uint8Array(n_elem * n_elem)
  const reach_hi = new Float64Array(n_elem * n_elem)
  const reach_lo = new Float64Array(n_elem * n_elem)
  let max_reach = 0
  for (let id_a = 0; id_a < n_elem; id_a++) {
    for (let id_b = 0; id_b < n_elem; id_b++) {
      const pair = id_a * n_elem + id_b
      const expected = expected_bond_length(elem_data[id_a], elem_data[id_b])
      if (expected === null) continue
      const metallic = elem_metal[id_a] === 1 && elem_metal[id_b] === 1
      pair_metallic[pair] = metallic ? 1 : 0
      pair_expected[pair] = expected
      const en_diff = Math.abs(elem_en[id_a] - elem_en[id_b])
      let strength = 1
      if (metallic) strength *= metal_metal_penalty
      else if (
        (elem_metal[id_a] && elem_nonmetal[id_b]) ||
        (elem_nonmetal[id_a] && elem_metal[id_b])
      ) {
        strength *= metal_nonmetal_bonus
        if (en_diff > electronegativity_threshold) strength *= 1.3
      } else if (en_diff < 0.5) strength *= similar_electronegativity_bonus
      strength *= 1 - 0.3 * (en_diff / (elem_en[id_a] + elem_en[id_b]))
      pair_factor[pair] = strength
      // dist_weight <= 1, so nothing in this pair can clear the threshold
      if (strength <= strength_threshold) continue
      const spread = Math.sqrt(-0.18 * Math.log(strength_threshold / strength))
      reach_hi[pair] = expected * Math.min(1 + spread, max_distance_ratio)
      reach_lo[pair] = spread >= 1 ? 0 : expected * (1 - spread)
      if (reach_hi[pair] > max_reach) max_reach = reach_hi[pair]
    }
  }
  // A zero/non-finite reach (no known radius, or a degenerate ratio) still needs a
  // positive cutoff for the query to be well-formed.
  // Finite bonds use each pair once; avoid allocating the discarded reverse neighbors.
  const { offsets, neighbors, image_geometry, distances } = query(
    structure,
    max_reach > 0 && Number.isFinite(max_reach) ? max_reach : 1,
    pbc,
    false,
    !pbc.some(Boolean),
  )

  // Candidate bonds as struct-of-arrays typed buffers (neighbor slot, center, normalized
  // distance, metallic-pair flag, strength): no per-candidate object in the hot loop, and
  // passes 2-4 read the pair's class and normalized distance instead of recomputing them
  if (scratch.slots.length < n_sites * 4)
    Object.assign(scratch, create_bond_scratch(Math.max(256, n_sites * 4)))
  let {
    slots: cand_slot,
    centers: cand_center,
    normalized: cand_norm,
    metallic: cand_metallic,
    strengths: cand_strength,
  } = scratch
  let n_cand = 0
  // Closest normalized contact per ORIGINAL atom, so image atoms and their originals see
  // the same shell. Metal-metal contacts have their own tracker: their normalization
  // (metallic radii) is not comparable to the covalent one, and a metal's first anion
  // shell must not disqualify its metal neighbours (Ti2O) nor vice versa (CsCl).
  const closest = new Float64Array(n_sites).fill(Infinity)
  const closest_metallic = new Float64Array(n_sites).fill(Infinity)

  // Pass 1: collect every contact inside its pair's reach band and record the shells
  for (let center = 0; center < n_sites; center++) {
    const pair_row = elem_ids[center] * n_elem
    for (let slot = offsets[center]; slot < offsets[center + 1]; slot++) {
      const partner = neighbors[slot]
      // The list holds both ends of every pair; take each unordered pair once, from its
      // lower site index. A site's own periodic image shows up twice (shift s and -s),
      // so only the shift normalize_bond_endpoints calls canonical is kept.
      if (partner < center) continue
      if (
        partner === center &&
        (!image_geometry || !is_canonical_self_image(image_geometry.images, slot))
      )
        continue
      const dist = distances[slot]
      if (dist < min_bond_dist) continue
      // Two table reads replace the radius sum, the ratio cutoff and the whole
      // metal/nonmetal/electronegativity branch chain
      const pair = pair_row + elem_ids[partner]
      if (dist > reach_hi[pair] || dist < reach_lo[pair]) continue

      // Normalized distance handles atoms of different sizes better than raw distance
      // (C-H is short but C-C is longer; C-H must not penalize C-C just because H is small)
      const norm_dist = dist / pair_expected[pair]
      const shell = pair_metallic[pair] ? closest_metallic : closest
      if (norm_dist < shell[orig_idxs[center]]) shell[orig_idxs[center]] = norm_dist
      if (norm_dist < shell[orig_idxs[partner]]) shell[orig_idxs[partner]] = norm_dist

      if (n_cand === cand_slot.length) {
        cand_slot = grow_i32(cand_slot, n_cand + 1)
        cand_center = grow_i32(cand_center, n_cand + 1)
        cand_norm = grow_f64(cand_norm, n_cand + 1)
        cand_metallic = grow_i32(cand_metallic, n_cand + 1)
        cand_strength = grow_f64(cand_strength, n_cand + 1)
      }
      cand_slot[n_cand] = slot
      cand_center[n_cand] = center
      cand_norm[n_cand] = norm_dist
      cand_metallic[n_cand] = pair_metallic[pair]
      cand_strength[n_cand] = pair_factor[pair] * Math.exp(-((norm_dist - 1) ** 2) / 0.18)
      n_cand++
    }
  }

  // A contact between two atoms that both already sit inside a coordination environment
  // is a bond only if it is no longer than the radii sum: anything longer is a contact
  // across that environment. One-sided so short multiple bonds (M-CO, C=C) pass untouched.
  const stretch = (norm_dist: number): number =>
    norm_dist <= 1 ? 1 : Math.exp(-(((norm_dist - 1) / STRETCH_WIDTH) ** 2))

  // Pass 2: shell-aware strength for every non-metallic contact. A contact much longer
  // (relative to radii) than the atom's closest one is penalized at each end. Provisional:
  // pass 3 tightens contacts between inner atoms once it knows which atoms those are.
  for (let cand = 0; cand < n_cand; cand++) {
    if (cand_metallic[cand]) continue
    const orig_a = orig_idxs[cand_center[cand]]
    const orig_b = orig_idxs[neighbors[cand_slot[cand]]]
    const norm_dist = cand_norm[cand]
    let strength = cand_strength[cand]
    if (norm_dist > closest[orig_a]) {
      strength *= Math.exp(-(norm_dist / closest[orig_a] - 1) / 0.5)
    }
    if (orig_b !== orig_a && norm_dist > closest[orig_b]) {
      strength *= Math.exp(-(norm_dist / closest[orig_b] - 1) / 0.5)
    }
    cand_strength[cand] = strength
  }

  // Roles from the provisional bond graph, reduced per original atom (a boundary copy sees
  // only part of its shell; the interior copy sees all of it, and every copy must get the
  // same verdict or images and originals would bond differently):
  //   terminal - an anion-former with no more electronegative anion-former partner, i.e.
  //              the outer atom of its environment (O in phosphate, C in methane, H in
  //              a hydride). Contacts to it use the lenient ionic distance window.
  //   n_anion  - anion-former partners of a metal (its coordination shell), for the
  //              metallic gate. Counted from the final non-metallic bonds in pass 3.
  // A single nonmetallic anion-former has neither unequal-electronegativity partners
  // nor metal contacts: every atom is terminal, so all role-dependent penalties are 1.
  if (n_elem !== 1 || !elem_anion_former[0] || elem_metal[0]) {
    const has_upper = new Uint8Array(n_sites) // per orig: bonded to a more electronegative anion-former
    for (let cand = 0; cand < n_cand; cand++) {
      if (cand_strength[cand] <= strength_threshold) continue
      const site_a = cand_center[cand]
      const site_b = neighbors[cand_slot[cand]]
      const id_a = elem_ids[site_a]
      const id_b = elem_ids[site_b]
      if (!elem_anion_former[id_a] || !elem_anion_former[id_b]) continue
      if (elem_en[id_b] > elem_en[id_a]) has_upper[orig_idxs[site_a]] = 1
      else if (elem_en[id_a] > elem_en[id_b]) has_upper[orig_idxs[site_b]] = 1
    }
    const is_terminal = (site: number): boolean =>
      elem_anion_former[elem_ids[site]] === 1 && has_upper[orig_idxs[site]] === 0

    // Pass 3: tighten contacts between two inner atoms, then count each metal's anion shell.
    // Per SITE first: unlike `closest` (a min, idempotent under duplication) a count
    // aggregated over every periodic image of an atom would multiply by the copy count.
    const site_n_anion = new Int32Array(n_sites)
    for (let cand = 0; cand < n_cand; cand++) {
      if (cand_metallic[cand]) continue
      const site_a = cand_center[cand]
      const site_b = neighbors[cand_slot[cand]]
      if (!is_terminal(site_a) && !is_terminal(site_b)) {
        cand_strength[cand] *= stretch(cand_norm[cand])
      }
      if (cand_strength[cand] <= strength_threshold) continue
      if (elem_anion_former[elem_ids[site_b]]) site_n_anion[site_a]++
      if (elem_anion_former[elem_ids[site_a]]) site_n_anion[site_b]++
    }
    const n_anion = new Int32Array(n_sites)
    for (let idx = 0; idx < n_sites; idx++) {
      const orig = orig_idxs[idx]
      if (site_n_anion[idx] > n_anion[orig]) n_anion[orig] = site_n_anion[idx]
    }

    // Pass 4: metallic contacts. Kept while it lies in the first metal-metal shell of at
    // least one end (min over the two ends: a big atom's first shell may be the small atom's
    // second); then, for metals that carry any anion, the second-shell gate
    // (see cation_cation_penalty) or, for unsaturated d/p-block metals, the same "no longer
    // than in the element" test as pass 3 (Ti-Ti in Ti2O is 1.01x the metallic sum and
    // bonds, Cu-Cu in Cu2O is 1.18x and does not).
    for (let cand = 0; cand < n_cand; cand++) {
      if (!cand_metallic[cand]) continue
      const site_a = cand_center[cand]
      const site_b = neighbors[cand_slot[cand]]
      const orig_a = orig_idxs[site_a]
      const orig_b = orig_idxs[site_b]
      const norm_dist = cand_norm[cand]
      let strength = cand_strength[cand]
      const shell_a = norm_dist / closest_metallic[orig_a] - 1
      const shell_b = norm_dist / closest_metallic[orig_b] - 1
      strength *= Math.exp(-((Math.min(shell_a, shell_b) / METAL_SHELL_WIDTH) ** 2))
      const max_anion = Math.max(n_anion[orig_a], n_anion[orig_b])
      if (max_anion > 0) {
        const spectator = elem_spectator[elem_ids[site_a]] || elem_spectator[elem_ids[site_b]]
        if (max_anion >= MIN_ANION_SHELL || spectator) strength *= cation_cation_penalty
        else strength *= stretch(norm_dist)
      }
      cand_strength[cand] = strength
    }
  }

  let count = 0
  for (let cand = 0; cand < n_cand; cand++) {
    if (cand_strength[cand] <= strength_threshold) continue
    cand_center[count] = cand_center[cand]
    cand_slot[count++] = cand_slot[cand]
  }
  Object.assign(scratch, {
    slots: cand_slot,
    centers: cand_center,
    normalized: cand_norm,
    metallic: cand_metallic,
    strengths: cand_strength,
  })
  return {
    centers: cand_center,
    slots: cand_slot,
    count,
    neighbors,
    image_geometry,
    distances,
  }
}
