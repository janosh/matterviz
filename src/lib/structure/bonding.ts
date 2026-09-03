// Bonding algorithms for structure visualization

import { element_by_symbol } from '../element/data'
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
import { get_image_source_idx, get_orig_site_idx } from '$lib/structure/site'

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
  sites: readonly Site[],
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
    const symbol = get_majority_element(sites[idx]) ?? unknown_label
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
  const site_1 = structure.sites[site_idx_1]
  const site_2 = structure.sites[site_idx_2]
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
  const n_sites = structure.sites.length
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
  const bonds = [...explicit_bonds.values()]
  explicit_bond_memo.set(raw_bonds, { n_sites, has_lattice, bonds })
  return bonds
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

// The 13 lexicographically "forward" bin offsets. Each unordered pair of adjacent bins is
// seen from exactly one side, so with own-bin pairs taken only for larger slot indices the
// sweep below computes every pair once.
const FORWARD_BIN_OFFSETS: [number, number, number][] = []
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx * 9 + dy * 3 + dz > 0) FORWARD_BIN_OFFSETS.push([dx, dy, dz])
    }
  }
}

// Fixed-radius query. Base positions are wrapped into the cell on periodic axes (a
// trajectory frame may sit far outside it) and only images that can reach within `cutoff`
// of the cell are generated, so the cloud grows with the boundary shell, not 27x. Image
// shifts are reported relative to the ORIGINAL (unwrapped) coordinates.
function neighbor_query_cutoff(
  structure: AnyStructure,
  cutoff: number,
  pbc_override: Pbc | undefined,
  sorted: boolean,
): NeighborList {
  const { sites } = structure
  const n_sites = sites.length
  if (!(cutoff > 0) || !Number.isFinite(cutoff)) {
    throw new Error(`neighbor_query: cutoff must be a positive finite number, got ${cutoff}`)
  }
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
    const { xyz } = sites[idx]
    if (!(Number.isFinite(xyz[0]) && Number.isFinite(xyz[1]) && Number.isFinite(xyz[2]))) {
      throw new Error(
        `neighbor_query: site ${idx} has a non-finite position (${xyz.join(`, `)})`,
      )
    }
    cloud_pos[idx * 3] = xyz[0]
    cloud_pos[idx * 3 + 1] = xyz[1]
    cloud_pos[idx * 3 + 2] = xyz[2]
    cloud_src[idx] = idx
  }
  if (lattice && pbc.some(Boolean)) {
    const heights = math.cell_heights(lattice)
    if (pbc.some((flag, axis) => flag && !(heights[axis] > 0 && heights[axis] < Infinity))) {
      throw new Error(
        `neighbor_query: periodic lattice is degenerate (cell heights ${heights.join(`, `)} A)`,
      )
    }
    const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = lattice
    const { cart_to_frac } = math.create_lattice_converters(lattice)
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
    // exact image count = product over axes of the shifts in reach, minus the site itself
    let n_images = 0
    for (let idx = 0; idx < n_sites; idx++) {
      const site_frac = cart_to_frac(sites[idx].xyz)
      let n_site_images = 1
      for (let axis = 0; axis < 3; axis++) {
        const at = idx * 3 + axis
        wrap[at] = pbc[axis] ? -Math.floor(site_frac[axis]) : 0
        frac[at] = site_frac[axis] + wrap[at]
        let lo = -max_shift[axis]
        let hi = max_shift[axis]
        while (lo < 0 && !in_reach(frac[at], lo, axis)) lo++
        while (hi > 0 && !in_reach(frac[at], hi, axis)) hi--
        shift_lo[at] = lo
        shift_hi[at] = hi
        n_site_images *= hi - lo + 1
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
      const fa = frac[idx * 3] + shift_a
      const fb = frac[idx * 3 + 1] + shift_b
      const fc = frac[idx * 3 + 2] + shift_c
      cloud_pos[slot * 3] = fa * ax + fb * bx + fc * cx
      cloud_pos[slot * 3 + 1] = fa * ay + fb * by + fc * cy
      cloud_pos[slot * 3 + 2] = fa * az + fb * bz + fc * cz
      cloud_src[slot] = idx
      cloud_shift[slot * 3] = wrap[idx * 3] + shift_a
      cloud_shift[slot * 3 + 1] = wrap[idx * 3 + 1] + shift_b
      cloud_shift[slot * 3 + 2] = wrap[idx * 3 + 2] + shift_c
      slot++
    }
    // Base slots first so cloud index === site index for the centers
    for (let idx = 0; idx < n_sites; idx++) push_cloud(idx, 0, 0, 0)
    for (let idx = 0; idx < n_sites; idx++) {
      const at = idx * 3
      for (let shift_a = shift_lo[at]; shift_a <= shift_hi[at]; shift_a++) {
        for (let shift_b = shift_lo[at + 1]; shift_b <= shift_hi[at + 1]; shift_b++) {
          for (let shift_c = shift_lo[at + 2]; shift_c <= shift_hi[at + 2]; shift_c++) {
            if (shift_a === 0 && shift_b === 0 && shift_c === 0) continue
            push_cloud(idx, shift_a, shift_b, shift_c)
          }
        }
      }
    }
  }

  if (n_cloud === 0) {
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
  // contiguous slice of `bin_items` (ascending slot, so base sites precede images). Bins are
  // `cutoff` wide unless that would make the grid much larger than the cloud, in which case
  // they widen; either way a neighbor can only sit in the 27 bins around the center's.
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
    const ix = Math.floor((cloud_pos[slot * 3] - mins[0]) / bin[0])
    const iy = Math.floor((cloud_pos[slot * 3 + 1] - mins[1]) / bin[1])
    const iz = Math.floor((cloud_pos[slot * 3 + 2] - mins[2]) / bin[2])
    const bin_idx = ix + n_x * (iy + n_y * iz)
    bin_of[slot] = bin_idx
    bin_start[bin_idx + 1]++
  }
  for (let bin_idx = 0; bin_idx < n_bins; bin_idx++)
    bin_start[bin_idx + 1] += bin_start[bin_idx]
  const bin_items = new Int32Array(n_cloud)
  const item_of = new Int32Array(n_cloud) // slot -> its index in bin_items
  const bin_cursor = bin_start.slice(0, n_bins)
  for (let slot = 0; slot < n_cloud; slot++) {
    item_of[slot] = bin_cursor[bin_of[slot]]
    bin_items[bin_cursor[bin_of[slot]]++] = slot
  }

  // Pair sweep: every pair within cutoff once, from the lexicographically lower bin (own
  // bin: from the lower slot). Pairs between two images are skipped, since images are never
  // centers - `bin_items` lists base slots first, so an image center stops at the first
  // image it meets. Pairs are stored once (struct of arrays) and counted towards each base
  // endpoint; the per-center lists are assembled from them below.
  const cutoff_sq = cutoff * cutoff
  let pair_a: Int32Array = new Int32Array(Math.max(256, n_sites * 8))
  let pair_b: Int32Array = new Int32Array(pair_a.length)
  let pair_dist_sq: Float64Array = new Float64Array(pair_a.length)
  const offsets = new Int32Array(n_sites + 1) // per-center counts until the prefix sum below
  let n_pairs = 0
  // the 14 bin ranges to scan per slot, own bin first (starting just past the slot itself)
  const range_start = new Int32Array(14)
  const range_end = new Int32Array(14)
  for (let slot_a = 0; slot_a < n_cloud; slot_a++) {
    const pos_x = cloud_pos[slot_a * 3]
    const pos_y = cloud_pos[slot_a * 3 + 1]
    const pos_z = cloud_pos[slot_a * 3 + 2]
    const bin_idx = bin_of[slot_a]
    const ix = bin_idx % n_x
    const iy = Math.floor(bin_idx / n_x) % n_y
    const iz = Math.floor(bin_idx / (n_x * n_y))
    const stop_at_images = slot_a >= n_sites
    let n_ranges = 0
    // own bin: only the slots after this one (all images when this one is an image)
    if (!stop_at_images) {
      range_start[0] = item_of[slot_a] + 1
      range_end[0] = bin_start[bin_idx + 1]
      n_ranges = 1
    }
    for (const [dx, dy, dz] of FORWARD_BIN_OFFSETS) {
      const jx = ix + dx
      const jy = iy + dy
      const jz = iz + dz
      if (jx < 0 || jx >= n_x || jy < 0 || jy >= n_y || jz < 0 || jz >= n_z) continue
      const other = jx + n_x * (jy + n_y * jz)
      range_start[n_ranges] = bin_start[other]
      range_end[n_ranges] = bin_start[other + 1]
      n_ranges++
    }
    for (let range = 0; range < n_ranges; range++) {
      const item_end = range_end[range]
      for (let item = range_start[range]; item < item_end; item++) {
        const slot_b = bin_items[item]
        if (stop_at_images && slot_b >= n_sites) break
        const delta_x = cloud_pos[slot_b * 3] - pos_x
        const delta_y = cloud_pos[slot_b * 3 + 1] - pos_y
        const delta_z = cloud_pos[slot_b * 3 + 2] - pos_z
        const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
        if (dist_sq > cutoff_sq) continue
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
        if (slot_a < n_sites) offsets[slot_a + 1]++
        if (slot_b < n_sites) offsets[slot_b + 1]++
        n_pairs++
      }
    }
  }

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
    if (slot_a < n_sites) entry_at[center_cursor[slot_a]++] = pair * 2
    if (slot_b < n_sites) entry_at[center_cursor[slot_b]++] = pair * 2 + 1
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
  const { k, pbc } = options
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`neighbor_query: k must be a positive integer, got ${k}`)
  }
  const n_sites = structure.sites.length
  if (n_sites === 0) return neighbor_query_cutoff(structure, 1, pbc, true)
  const { total_volume, max_cutoff } = k_search_bounds(structure)
  const atom_volume = total_volume / n_sites
  // radius of the sphere holding k+1 atoms at the mean density, widened 30% so the first
  // pass usually suffices even for an anisotropic first shell
  let cutoff = 1.3 * ((3 * (k + 1) * atom_volume) / (4 * Math.PI)) ** (1 / 3)
  for (;;) {
    const list = neighbor_query_cutoff(structure, cutoff, pbc, true)
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
export function electroneg_ratio(
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
): BondPair[] {
  const { sites } = structure
  const n_sites = sites.length
  if (n_sites === 0) return []

  // Per-site properties in flat typed arrays - the candidate loop below visits every
  // contact within reach in large supercells, so object property chains and Map lookups
  // are replaced with indexed array reads.
  const { symbols, site_elem_ids: elem_ids, elem_data } = intern_site_elements(sites)
  const orig_idxs = new Int32Array(n_sites)
  for (let idx = 0; idx < n_sites; idx++) {
    // Valid orig indices always reference a site in this structure; fall back to
    // the site's own index on out-of-range orig_*_idx properties so the typed
    // `closest` array below stays bounded by n_sites
    const orig_idx = get_orig_site_idx(sites[idx], idx)
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
  const { offsets, neighbors, images, deltas, distances } = neighbor_query(structure, {
    cutoff: max_reach > 0 && Number.isFinite(max_reach) ? max_reach : 1,
    pbc,
    sorted: false, // every contact is filtered through the reach band below regardless
  })

  // Candidate bonds as struct-of-arrays typed buffers (neighbor slot, center, normalized
  // distance, metallic-pair flag, strength): no per-candidate object in the hot loop, and
  // passes 2-4 read the pair's class and normalized distance instead of recomputing them
  let cand_slot: Int32Array = new Int32Array(Math.max(256, n_sites * 4))
  let cand_center: Int32Array = new Int32Array(cand_slot.length)
  let cand_norm: Float64Array = new Float64Array(cand_slot.length)
  let cand_metallic: Int32Array = new Int32Array(cand_slot.length)
  let cand_strength: Float64Array = new Float64Array(cand_slot.length)
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
      if (partner === center && !is_canonical_self_image(images, slot)) continue
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

  const bonds: BondPair[] = []
  for (let cand = 0; cand < n_cand; cand++) {
    if (cand_strength[cand] <= strength_threshold) continue
    const slot = cand_slot[cand]
    const site_idx_1 = cand_center[cand]
    const site_idx_2 = neighbors[slot]
    const pos_1 = sites[site_idx_1].xyz
    const bond: BondPair = {
      pos_1,
      pos_2: sites[site_idx_2].xyz,
      site_idx_1,
      site_idx_2,
      bond_length: distances[slot],
    }
    const shift_a = images[slot * 3]
    const shift_b = images[slot * 3 + 1]
    const shift_c = images[slot * 3 + 2]
    if (shift_a !== 0 || shift_b !== 0 || shift_c !== 0) {
      // periodic partner: its image position is the center plus the query's displacement
      bond.cell_shift = [shift_a, shift_b, shift_c]
      bond.pos_2 = [
        pos_1[0] + deltas[slot * 3],
        pos_1[1] + deltas[slot * 3 + 1],
        pos_1[2] + deltas[slot * 3 + 2],
      ]
    }
    bonds.push(bond)
  }

  return apply_explicit_bond_metadata(structure, bonds)
}
