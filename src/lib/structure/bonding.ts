// Bonding algorithms for structure visualization

import { value_key } from '#lib/utils.js'
import { display_idx } from '#lib/labels.js'
import { element_by_symbol } from '../element/data'
import { element_from_atomic_number, is_elem_symbol } from '../element/helpers'
import type { ChemicalElement, ElementSymbol } from '#lib/element/index.js'
import type { Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import type {
  AnyStructure,
  BondOrder,
  BondPair,
  Crystal,
  Pbc,
  Site,
  StructureBond,
} from '#lib/structure/index.js'
import {
  get_image_source_idx,
  get_orig_site_idx,
  get_site,
  numeric_sites,
  NumericSites,
  site_count,
} from '#lib/structure/site.js'
import { BOND_ORDERS, BondFrame, pack_bonds, type BondColumns } from './bond-rendering'
import {
  bin_points,
  bounding_box,
  grow,
  lattice_pbc_or_throw,
  MAX_NEIGHBOR_PAIRS,
  MAX_PAIRS_PER_SITE,
  neighbor_query_cutoff,
  NO_PBC,
  site_positions,
  type NeighborList,
  type PairBand,
} from './neighbor-list'

// Expected bond length of an element pair in Angstrom, or null when a radius is unknown.
// Two metals measure against their 12-coordinate metallic radii: covalent radii are fit to
// compounds and undershoot the metals themselves (fcc Al 2.86 A is 1.18x the covalent sum,
// 1.00x the metallic one), which broke intermetallics. Elements without a tabulated
// metallic radius (Sn, Pb, Bi, Ac, ...) keep the covalent one. Every other pair uses
// covalent radii.
const expected_bond_length = (
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
        throw new Error(
          `Invalid atomic number ${sites.numbers[idx]} at site ${display_idx(idx)}`,
        )
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

// the ternaries never yield -0, which Object.is-based equality (Svelte, toEqual) tells from 0
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
  const swap = site_idx_1 > site_idx_2
  const ordered = swap
    ? { site_idx_1: site_idx_2, site_idx_2: site_idx_1 }
    : { site_idx_1, site_idx_2 }
  if (!cell_shift || is_zero_cell_shift(cell_shift)) return ordered
  if (site_idx_1 === site_idx_2) cell_shift = canonical_self_bond_shift(cell_shift)
  else if (swap) cell_shift = negate_cell_shift(cell_shift)
  return { ...ordered, cell_shift }
}

export const normalize_structure_bond = (
  site_idx_1: number,
  site_idx_2: number,
  order: BondOrder,
  cell_shift?: Vec3,
): StructureBond => ({
  ...normalize_bond_endpoints(site_idx_1, site_idx_2, cell_shift),
  order,
})

// Explicit bonds after site i moved by whole lattice vectors `site_shift(i)` (undefined =
// unmoved): bond i -> j + S keeps its geometry as i -> j + (S + k_i - k_j)
export function shift_bonds_for_moved_sites(
  bonds: readonly StructureBond[],
  site_shift: (site_idx: number) => Vec3 | undefined,
): StructureBond[] {
  return bonds.map((bond) => {
    const [shift_1, shift_2] = [site_shift(bond.site_idx_1), site_shift(bond.site_idx_2)]
    if (!shift_1 && !shift_2) return bond
    const cell_shift = bond.cell_shift ?? [0, 0, 0]
    const moved = [0, 1, 2].map(
      (axis) => cell_shift[axis] + (shift_1?.[axis] ?? 0) - (shift_2?.[axis] ?? 0),
    ) as Vec3
    return normalize_structure_bond(bond.site_idx_1, bond.site_idx_2, bond.order, moved)
  })
}

// normalize_bond_endpoints drops zero shifts, so only a real image gets the `@` suffix
export const get_bond_key = (idx_1: number, idx_2: number, cell_shift?: Vec3): string => {
  const normalized = normalize_bond_endpoints(idx_1, idx_2, cell_shift)
  const shift_suffix = normalized.cell_shift ? `@${normalized.cell_shift.join(`,`)}` : ``
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
  const sorted = math.sorted_numbers(deleted_indices)
  const shift = (idx: number) => {
    let [lower, upper] = [0, sorted.length]
    while (lower < upper) {
      const mid = (lower + upper) >> 1
      if (sorted[mid] < idx) lower = mid + 1
      else upper = mid
    }
    return idx - lower // lower == count of deleted indices < idx
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

// The integer lattice shift from fractional coords `abc` to those of its image `image_abc`
export const lattice_shift = (image_abc: readonly number[], abc: Vec3): Vec3 =>
  abc.map((coord, axis) => Math.round(image_abc[axis] - coord)) as Vec3

const site_image_shift = (sites: Site[] | undefined, site_idx: number): Vec3 => {
  const site = sites?.[site_idx]
  const orig_site_idx = site?.provenance?.image_of
  if (orig_site_idx === undefined) return [0, 0, 0]
  const orig_site = sites?.[orig_site_idx]
  if (!site?.abc || !orig_site?.abc) return [0, 0, 0]
  return lattice_shift(site.abc, orig_site.abc)
}

export const canonicalize_bond_target = (
  bond: BondKeyTarget,
  sites: Site[] | undefined,
): BondKeyTarget => {
  const shift_1 = site_image_shift(sites, bond.site_idx_1)
  const shift_2 = site_image_shift(sites, bond.site_idx_2)
  const base_shift = bond.cell_shift ?? [0, 0, 0]
  const cell_shift = base_shift.map(
    (shift, axis) => shift + shift_2[axis] - shift_1[axis],
  ) as Vec3
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

const replace_bond = (bonds: StructureBond[], next_bond: StructureBond): StructureBond[] => [
  ...remove_bond_key(bonds, rendered_bond_key_for(next_bond)),
  next_bond,
]

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
  // A removal names a bond the strategy found. Once it finds it no more (bonding settings
  // changed), lifting the removal alone would leave the pair unbonded, so it is added instead.
  if (removed_bond && includes_bond_key(calculated_bonds, key)) {
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
  if (!removed_bond && has_visible_bond(edit_state, record, calculated_bonds)) {
    return { action: `already-visible`, changed: false, state: edit_state }
  }
  return {
    action: `added`,
    changed: true,
    state: {
      added_bonds: replace_bond(edit_state.added_bonds, record),
      removed_bonds: remove_bond_key(edit_state.removed_bonds, key),
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
  const calculated = find_bond_by_key(calculated_bonds, key)
  if (includes_bond_key(edit_state.added_bonds, key)) {
    // An added bond the strategy now also finds must leave the calculated set too
    const removed_bonds =
      calculated && !includes_bond_key(edit_state.removed_bonds, key)
        ? replace_bond(edit_state.removed_bonds, {
            ...record,
            order: get_bond_order(calculated),
          })
        : edit_state.removed_bonds
    return {
      action: `deleted-added`,
      changed: true,
      state: {
        ...edit_state,
        added_bonds: remove_bond_key(edit_state.added_bonds, key),
        removed_bonds,
        bond_order_overrides: remove_bond_key(edit_state.bond_order_overrides, key),
      },
    }
  }
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
    return {
      action: `ordered-calculated`,
      changed: has_existing_edit || order !== visible_order,
      state: {
        added_bonds: remove_bond_key(edit_state.added_bonds, key),
        removed_bonds: remove_bond_key(edit_state.removed_bonds, key),
        bond_order_overrides:
          order === visible_order
            ? remove_bond_key(edit_state.bond_order_overrides, key)
            : replace_bond(edit_state.bond_order_overrides, record),
      },
    }
  }
  // a stale removal (see add_or_restore_bond) would hide the added bond
  return {
    action: `ordered-added`,
    changed: true,
    state: {
      added_bonds: replace_bond(edit_state.added_bonds, record),
      removed_bonds: remove_bond_key(edit_state.removed_bonds, key),
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
  let pos_2 = site_2.xyz
  // In-cell bonds (the vast majority) skip the translation allocation
  if (cell_shift && !is_zero_cell_shift(cell_shift)) {
    if (!(`lattice` in structure)) {
      throw new Error(`Explicit bond cell_shift requires a crystal lattice`)
    }
    const [vec_a, vec_b, vec_c] = structure.lattice.matrix
    const [shift_a, shift_b, shift_c] = cell_shift
    const translation = math.add(
      math.scale(vec_a, shift_a),
      math.scale(vec_b, shift_b),
      math.scale(vec_c, shift_c),
    )
    pos_2 = math.add(pos_2, translation)
  }
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
  const is_int = (val: unknown): val is number => Number.isInteger(val)
  for (const [entry_idx, raw_bond] of raw_bonds.entries()) {
    const reject = (reason: string) =>
      console.warn(`Ignoring invalid explicit bond at index ${entry_idx}: ${reason}`)
    if (typeof raw_bond !== `object` || raw_bond === null) {
      reject(`expected object`)
      continue
    }
    const {
      site_idx_1,
      site_idx_2,
      order,
      cell_shift: raw_shift,
    } = raw_bond as Record<string, unknown>
    if (!is_int(site_idx_1) || !is_int(site_idx_2)) {
      reject(`site indices must be integers`)
      continue
    }
    if (site_idx_1 < 0 || site_idx_2 < 0 || site_idx_1 >= n_sites || site_idx_2 >= n_sites) {
      reject(`site indices ${site_idx_1}, ${site_idx_2} are out of range for ${n_sites} sites`)
      continue
    }
    const bond_order = normalize_bond_order(order)
    if (bond_order === null) {
      reject(`unsupported order ${String(order)}`)
      continue
    }
    const cell_shift = normalize_cell_shift(raw_shift)
    if (cell_shift === null) {
      reject(`cell_shift must be three integers`)
      continue
    }
    if (site_idx_1 === site_idx_2 && is_zero_cell_shift(cell_shift)) {
      reject(`endpoints match`)
      continue
    }
    if (!is_zero_cell_shift(cell_shift) && !has_lattice) {
      reject(`cell_shift requires a crystal lattice`)
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

export const BONDING_STRATEGIES = {
  electroneg_ratio,
  pair_cutoffs,
  explicit_only,
} as const satisfies Record<string, (structure: AnyStructure) => BondPair[]>
export type BondingStrategy = keyof typeof BONDING_STRATEGIES

// Tuning of electroneg_ratio's distance and strength model (see perceive_bonds for each)
const ELECTRONEG_OPTION_KEYS = [
  `electronegativity_threshold`,
  `max_distance_ratio`,
  `min_bond_dist`,
  `metal_metal_penalty`,
  `cation_cation_penalty`,
  `metal_nonmetal_bonus`,
  `similar_electronegativity_bonus`,
  `strength_threshold`,
] as const
type ElectronegRatioOptions = Partial<Record<(typeof ELECTRONEG_OPTION_KEYS)[number], number>>
// VESTA-style bond search: every contact whose length lies in its element pair's [min, max] Å
// (inclusive), e.g. { 'Si-O': [0, 1.9] }. Either element order names a pair (but not both).
// Unlisted pairs never bond. Sites bond as their majority element.
export type PairCutoffs = Readonly<Record<string, readonly [number, number]>>
// `pbc`: the periodic axes to bond across (none by default, see perceive_bonds). explicit_only
// draws the same bonds either way: explicit bonds name their periodic images by cell_shift.
type CommonBondingOptions = { pbc?: Pbc }
type BondingOptionsMap = {
  electroneg_ratio: CommonBondingOptions & ElectronegRatioOptions
  pair_cutoffs: CommonBondingOptions & { pair_cutoffs?: PairCutoffs }
  explicit_only: CommonBondingOptions
}
export type BondingOptions<Strategy extends BondingStrategy = BondingStrategy> =
  BondingOptionsMap[Strategy]
// A viewer's options per strategy, so switching never hands one strategy another's options
export type BondingOptionsByStrategy = Partial<BondingOptionsMap>

// pair_cutoffs as [elem_a, elem_b, min, max] rows (elements sorted), or what makes them malformed
export function read_pair_cutoffs(
  value: unknown,
): [ElementSymbol, ElementSymbol, number, number][] | string {
  if (value === null || typeof value !== `object` || Array.isArray(value))
    return `expected an object mapping 'A-B' element pairs to [min, max] in Å, got ${JSON.stringify(value)}`
  const rows: [ElementSymbol, ElementSymbol, number, number][] = []
  const key_of_pair = new Map<string, string>()
  for (const [key, range] of Object.entries(value)) {
    const [elem_a, elem_b, ...rest] = key.split(`-`).map((part) => part.trim())
    if (rest.length > 0 || !is_elem_symbol(elem_a) || !is_elem_symbol(elem_b))
      return `'${key}' is not an element pair like 'Si-O'`
    const pair: [ElementSymbol, ElementSymbol] =
      elem_a <= elem_b ? [elem_a, elem_b] : [elem_b, elem_a]
    const pair_key = pair.join(`-`)
    const previous = key_of_pair.get(pair_key)
    if (previous !== undefined) return `'${previous}' and '${key}' name the same pair`
    key_of_pair.set(pair_key, key)
    const [min, max] = Array.isArray(range) && range.length === 2 ? range : []
    if (
      typeof min !== `number` ||
      typeof max !== `number` ||
      !(min >= 0 && min <= max && max > 0 && max < Infinity)
    )
      return `'${key}' must be [min, max] in Å with 0 <= min <= max and max > 0, got ${JSON.stringify(range)}`
    rows.push([...pair, min, max])
  }
  return rows
}

// Every option key each strategy reads, and what makes its value invalid (undefined: valid)
type OptionCheck = (value: unknown) => string | undefined
const finite_number: OptionCheck = (value) =>
  Number.isFinite(value) ? undefined : `expected a finite number, got ${JSON.stringify(value)}`
const COMMON_OPTION_CHECKS = {
  pbc: (value) =>
    math.is_pbc(value)
      ? undefined
      : `expected three booleans [a, b, c], got ${JSON.stringify(value)}`,
} satisfies Record<keyof CommonBondingOptions, OptionCheck>
const BONDING_OPTION_CHECKS: Record<BondingStrategy, Record<string, OptionCheck>> = {
  electroneg_ratio: {
    ...COMMON_OPTION_CHECKS,
    ...Object.fromEntries(ELECTRONEG_OPTION_KEYS.map((key) => [key, finite_number])),
  },
  pair_cutoffs: {
    ...COMMON_OPTION_CHECKS,
    pair_cutoffs: (value) => {
      const rows = read_pair_cutoffs(value)
      return typeof rows === `string` ? rows : undefined
    },
  },
  explicit_only: COMMON_OPTION_CHECKS,
}

// `options` as `strategy` reads them. Options arrive untyped from hosts, settings and workers,
// and a misspelled key would otherwise be silently ignored, so an unknown key or an invalid
// value (a string threshold, a 2-axis pbc) throws. An undefined value counts as unset.
export function validate_bonding_options<Strategy extends BondingStrategy>(
  strategy: Strategy,
  options: object,
): BondingOptions<Strategy> {
  const checks = BONDING_OPTION_CHECKS[strategy]
  for (const [key, value] of Object.entries(options)) {
    if (!Object.hasOwn(checks, key)) {
      const allowed = Object.keys(checks).join(`, `)
      throw new Error(
        `Unknown ${strategy} bonding option '${key}', expected one of ${allowed}`,
      )
    }
    const problem = value === undefined ? undefined : checks[key](value)
    if (problem) throw new Error(`Invalid ${strategy} bonding option ${key}: ${problem}`)
  }
  return options
}

// The options a viewer's per-strategy settings hold for `strategy`
export const strategy_bonding_options = (
  by_strategy: BondingOptionsByStrategy | undefined,
  strategy: BondingStrategy,
): BondingOptions => by_strategy?.[strategy] ?? {}

// Memo for the costly neighbor search: WeakMap keyed by structure (GC'd with it), each holding a
// per-signature (strategy + value_key of the options) map of results. The multi-side view's 4 panes share one
// search (identical inputs, one flush); the per-signature map also lets alternating
// strategies/options on the same structure reuse earlier results instead of thrashing one slot.
const bond_memo = new WeakMap<AnyStructure, Map<string, BondPair[] | BondFrame>>()
const bond_sig = (strategy: BondingStrategy, options: BondingOptions): string =>
  `${strategy}:${value_key(options)}`

// Store bonds for this exact structure + signature in bond_memo: the one write path, used both
// by get_bond_data to memoize its own search and to install bonds the source worker computed.
export function cache_prepared_bonds<Strategy extends BondingStrategy>(
  structure: AnyStructure,
  strategy: Strategy,
  options: BondingOptions<Strategy>,
  bonds: BondPair[] | BondFrame,
): void {
  let by_sig = bond_memo.get(structure)
  if (!by_sig) bond_memo.set(structure, (by_sig = new Map()))
  by_sig.set(bond_sig(strategy, options), bonds)
}

type BondNeighborList = Pick<NeighborList, 'offsets' | 'neighbors' | 'distances'> & {
  image_geometry?: Pick<NeighborList, 'images' | 'deltas'>
}
// Every contact within `cutoff` whose distance lies in its element pair's band, listed once
// from its lower site index (a site's own periodic image under its canonical shift only).
export type BondNeighborQuery = (
  structure: AnyStructure,
  cutoff: number,
  pbc: Pbc,
  band: PairBand,
) => BondNeighborList

const query_bond_neighbors: BondNeighborQuery = (structure, cutoff, pbc, band) => {
  const image_geometry = pbc.some(Boolean)
  const list = neighbor_query_cutoff(structure, cutoff, {
    pbc,
    unique_pairs: true,
    image_geometry,
    band,
  })
  return image_geometry ? { ...list, image_geometry: list } : list
}

// === Incremental finite bond search ===
// Atom drags re-bond the finite displayed structure on every pointer move, few sites moved.
// Contacts between unmoved sites keep their distances bit for bit, so only moved sites'
// contacts are searched again, with the full query's arithmetic and filters (same contacts,
// another order within a center's block). Perception still runs on the whole list: its shells
// pool every copy of a unit-cell atom. Two searches are kept so two bonding settings coexist.
const MIN_INCREMENTAL_SITES = 1000
const MAX_MOVED_FRACTION = 1 / 8
type FiniteSearch = { band: PairBand; coords: Float64Array; list: BondNeighborList }
// A viewer's own query, so its cached searches and perception scratch go with it
export function create_bond_query(): BondNeighborQuery {
  const searches: FiniteSearch[] = [] // most recent first
  return (structure, cutoff, pbc, band) =>
    pbc.some(Boolean)
      ? query_bond_neighbors(structure, cutoff, pbc, band)
      : finite_bond_neighbors(structure, cutoff, band, searches)
}

// Equal bands imply equal sites (elem_ids) and cutoff (the longest reach in band.hi)
const same_band = (left: PairBand, right: PairBand): boolean =>
  math.same_values(left.elem_ids, right.elem_ids) &&
  math.same_values(left.lo, right.lo) &&
  math.same_values(left.hi, right.hi)

// Site positions as packed xyz triples, written into `out` when its length fits
const packed_positions = (structure: AnyStructure, out?: Float64Array): Float64Array => {
  const { sites, n_sites, coordinates, stride } = site_positions(structure)
  const xyz = out?.length === n_sites * 3 ? out : new Float64Array(n_sites * 3)
  for (let idx = 0; idx < n_sites; idx++)
    for (let axis = 0; axis < 3; axis++)
      xyz[idx * 3 + axis] = coordinates
        ? coordinates[idx * stride + axis]
        : sites[idx].xyz[axis]
  return xyz
}

function finite_bond_neighbors(
  structure: AnyStructure,
  cutoff: number,
  band: PairBand,
  finite_searches: FiniteSearch[],
): BondNeighborList {
  const query = () => query_bond_neighbors(structure, cutoff, NO_PBC, band)
  if (site_count(structure) < MIN_INCREMENTAL_SITES) return query()
  const coords = packed_positions(structure)
  const match = finite_searches.findIndex((search) => same_band(search.band, band))
  const search = match === -1 ? undefined : finite_searches.splice(match, 1)[0]
  const list = search && moved_site_contacts(search, coords, cutoff)
  finite_searches.unshift(search && list ? search : { band, coords, list: query() })
  finite_searches.length = Math.min(finite_searches.length, 2)
  return list ?? finite_searches[0].list
}

// The search's contacts at `coords`, or undefined when too many sites moved. Non-finite
// positions and pair-budget overruns are left to the full query, which reports them.
function moved_site_contacts(
  { band, coords: reference, list }: FiniteSearch,
  coords: Float64Array,
  cutoff: number,
): BondNeighborList | undefined {
  const n_sites = coords.length / 3
  const is_moved = new Uint8Array(n_sites)
  const moved: number[] = []
  for (let idx = 0; idx < n_sites; idx++) {
    const offset = idx * 3
    if (
      coords[offset] === reference[offset] &&
      coords[offset + 1] === reference[offset + 1] &&
      coords[offset + 2] === reference[offset + 2]
    )
      continue
    if (moved.length >= n_sites * MAX_MOVED_FRACTION) return undefined
    if (!coords.subarray(offset, offset + 3).every(Number.isFinite)) return undefined
    is_moved[idx] = 1
    moved.push(idx)
  }
  if (!moved.length) return list
  // Bins wider than `cutoff` plus the binning round-off put a site's partners within one bin
  // of it per axis
  const bounds = bounding_box(coords, n_sites)
  const [mins, maxs] = bounds
  const widths = mins.map(
    (min, axis) => cutoff + 8 * Number.EPSILON * (maxs[axis] - min + cutoff),
  ) as Vec3
  const { n_axis, bin_of, bin_start, bin_items } = bin_points(coords, n_sites, bounds, widths)
  const [n_x, n_y, n_z] = n_axis
  // Contacts of moved sites, each once: [lower site, higher site, distance] triples
  const found: number[] = []
  const cutoff_sq = cutoff * cutoff
  const { elem_ids, n_elem } = band
  for (const site of moved) {
    const bin = bin_of[site]
    const cell_x = bin % n_x
    const cell_y = Math.floor(bin / n_x) % n_y
    const cell_z = Math.floor(bin / (n_x * n_y))
    for (let bin_z = cell_z - 1; bin_z <= cell_z + 1; bin_z++) {
      for (let bin_y = cell_y - 1; bin_y <= cell_y + 1; bin_y++) {
        if (bin_z < 0 || bin_z >= n_z || bin_y < 0 || bin_y >= n_y) continue
        const row = n_x * (bin_y + n_y * bin_z)
        const item_end = bin_start[row + Math.min(cell_x + 1, n_x - 1) + 1]
        for (let item = bin_start[row + Math.max(cell_x - 1, 0)]; item < item_end; item++) {
          const partner = bin_items[item]
          if (is_moved[partner] && partner <= site) continue
          // neighbor_query_cutoff's arithmetic and filters (a delta's sign leaves its square)
          const delta_x = coords[partner * 3] - coords[site * 3]
          const delta_y = coords[partner * 3 + 1] - coords[site * 3 + 1]
          const delta_z = coords[partner * 3 + 2] - coords[site * 3 + 2]
          const dist_sq = delta_x * delta_x + delta_y * delta_y + delta_z * delta_z
          if (dist_sq > cutoff_sq) continue
          const distance = Math.sqrt(dist_sq)
          const pair = elem_ids[site] * n_elem + elem_ids[partner]
          if (distance > band.hi[pair] || distance < band.lo[pair]) continue
          found.push(Math.min(site, partner), Math.max(site, partner), distance)
        }
      }
    }
  }
  // Unmoved contacts keep their slots' order, then the moved ones follow per center
  const { offsets: old_offsets, neighbors: old_neighbors, distances: old_distances } = list
  const offsets = new Int32Array(n_sites + 1)
  const kept = (center: number, slot: number) =>
    !is_moved[center] && !is_moved[old_neighbors[slot]]
  for (let center = 0; center < n_sites; center++)
    for (let slot = old_offsets[center]; slot < old_offsets[center + 1]; slot++)
      if (kept(center, slot)) offsets[center + 1]++
  for (let idx = 0; idx < found.length; idx += 3) offsets[found[idx] + 1]++
  for (let center = 0; center < n_sites; center++) offsets[center + 1] += offsets[center]
  if (offsets[n_sites] > Math.max(MAX_NEIGHBOR_PAIRS, MAX_PAIRS_PER_SITE * n_sites))
    return undefined
  const neighbors = new Int32Array(offsets[n_sites])
  const distances = new Float64Array(offsets[n_sites])
  const cursor = offsets.slice(0, n_sites)
  const append = (center: number, partner: number, distance: number) => {
    neighbors[cursor[center]] = partner
    distances[cursor[center]++] = distance
  }
  for (let center = 0; center < n_sites; center++)
    for (let slot = old_offsets[center]; slot < old_offsets[center + 1]; slot++)
      if (kept(center, slot)) append(center, old_neighbors[slot], old_distances[slot])
  for (let idx = 0; idx < found.length; idx += 3)
    append(found[idx], found[idx + 1], found[idx + 2])
  return { offsets, neighbors, distances }
}

// Verlet skin (A) of trajectory candidate lists. On a 186k-atom fcc frame a plain search takes
// ~190 ms, a skinned rebuild 310-390 ms and a reuse 95-120 ms: a list pays off after ~2 reuses.
// 0.3-0.5 A skins keep fcc's 9.3 candidates per site; 1 A pulls in the third shell (21.6 per
// site, past the pair budget at 500k atoms).
const BOND_SKIN = 0.5
const MIN_REUSES = 2

// A Verlet list for finite displayed sites: candidates are all contacts within the skin of
// their pair's band (chemistry filters them per frame), rebuilt once an endpoint could have
// crossed the skin; periodic image bond queries always run the full search. A list rebuilt
// before serving MIN_REUSES frames cost more than plain searches, so the next frames search
// plain until per-frame motion falls below skin / (2 * MIN_REUSES), where even steady drift
// lets a list survive MIN_REUSES frames.
export class BondSearch {
  private candidates: BondNeighborList | undefined
  // Positions at the last candidate build, or of the previous frame after a plain search
  private reference: Float64Array = new Float64Array(0)
  private reuses = 0 // frames the current candidates served after their build
  private cell_key = ``
  private band: PairBand | undefined

  // Whether any site moved at least `limit` from `this.reference` (min-image displacement
  // across `periodic` axes, where wrapping makes a boundary crossing a lattice jump).
  private moved_beyond(
    structure: AnyStructure,
    limit: number,
    periodic: Crystal['lattice'] | undefined,
  ): boolean {
    const { sites, n_sites, coordinates, stride } = site_positions(structure)
    const to_frac = periodic ? math.create_cart_to_frac(periodic.matrix) : undefined
    const to_cart = periodic ? math.create_frac_to_cart(periodic.matrix) : undefined
    const delta: Vec3 = [0, 0, 0]
    const fractional: Vec3 = [0, 0, 0]
    // This box fits strictly inside the limit sphere (sqrt(3)/2 < 1), so ordinary small
    // MD displacements need no square root.
    const small_move = limit / 2
    for (let idx = 0; idx < n_sites; idx++) {
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
      if (Math.hypot(delta[0], delta[1], delta[2]) < limit) continue
      if (periodic && to_frac && to_cart) {
        to_frac(delta, fractional)
        for (let axis = 0; axis < 3; axis++)
          if (periodic.pbc[axis]) fractional[axis] -= Math.round(fractional[axis])
        to_cart(fractional, delta)
      }
      if (!(Math.hypot(delta[0], delta[1], delta[2]) < limit)) return true
    }
    return false
  }

  private readonly query: BondNeighborQuery = (structure, cutoff, pbc, band) => {
    if (pbc.some(Boolean)) return query_bond_neighbors(structure, cutoff, pbc, band)
    const lattice = `lattice` in structure ? structure.lattice : undefined
    // Validated here since finite queries never reach lattice_pbc_or_throw
    const lattice_pbc = lattice_pbc_or_throw(structure)
    const cell_key = JSON.stringify(lattice)
    // A periodic candidate superset survives wrapping, used only while every site pair (a site
    // with itself included) has at most one image in reach. The output still bonds finite sites.
    const periodic =
      lattice &&
      lattice_pbc.some(Boolean) &&
      math
        .cell_heights(lattice.matrix)
        .every((height, axis) => !lattice_pbc[axis] || height > 2 * (cutoff + BOND_SKIN))
        ? lattice
        : undefined
    const { band: last, candidates } = this
    const same_inputs =
      cell_key === this.cell_key && last !== undefined && same_band(last, band)
    // Compare against the build frame, not the last frame; cumulative drift counts.
    if (same_inputs && candidates && !this.moved_beyond(structure, BOND_SKIN / 2, periodic)) {
      this.reuses++
      return this.refresh_candidates(structure, candidates)
    }
    // After a plain search `reference` holds the previous frame
    const plain =
      same_inputs &&
      (candidates
        ? this.reuses < MIN_REUSES
        : this.moved_beyond(structure, BOND_SKIN / (2 * MIN_REUSES), periodic))
    this.cell_key = cell_key
    this.band = band // perceive_bonds allocates fresh tables per call
    this.reuses = 0
    this.reference = packed_positions(structure, this.reference)
    if (plain) {
      this.candidates = undefined
      return query_bond_neighbors(structure, cutoff, pbc, band)
    }
    // Any contact that can enter the band before an endpoint moves skin/2 lies within skin
    // of it now. 1e-6 A absorbs the round-off between wrapped and finite distances.
    const slack = BOND_SKIN + 1e-6
    const list = neighbor_query_cutoff(structure, cutoff + BOND_SKIN, {
      pbc: periodic?.pbc ?? pbc,
      unique_pairs: true,
      band: {
        ...band,
        lo: band.lo.map((dist) => dist - slack),
        hi: band.hi.map((dist) => dist + slack),
      },
    })
    const { offsets, neighbors, distances } = list
    this.candidates = { offsets, neighbors, distances }
    return this.refresh_candidates(structure, this.candidates)
  }

  // Finite-site distances of every candidate at the current positions
  private refresh_candidates(
    structure: AnyStructure,
    list: BondNeighborList,
  ): BondNeighborList {
    const { sites, n_sites, coordinates, stride } = site_positions(structure)
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
    options: BondingOptions<`electroneg_ratio`> = {},
  ): BondColumns {
    if (!site_count(structure)) return pack_bonds([])
    return bond_columns(structure, perceive_bonds(structure, options, this.query))
  }
}

export function compute_bonds<Strategy extends BondingStrategy>(
  structure: AnyStructure,
  strategy: Strategy,
  options: BondingOptions<Strategy> = {},
): BondPair[] {
  const data = get_bond_data(structure, strategy, options)
  return data instanceof BondFrame ? data.materialize() : data
}

export function get_bond_data<Strategy extends BondingStrategy>(
  structure: AnyStructure,
  strategy: Strategy,
  options: BondingOptions<Strategy> = {},
  query?: BondNeighborQuery, // electroneg_ratio's neighbor search
): BondPair[] | BondFrame {
  const cached = bond_memo.get(structure)?.get(bond_sig(strategy, options))
  if (cached) return cached
  // Strategy names arrive as plain strings from widgets and saved settings
  if (!Object.hasOwn(BONDING_STRATEGIES, strategy)) {
    const valid = Object.keys(BONDING_STRATEGIES).join(`, `)
    throw new Error(`Unknown bonding strategy '${strategy}', expected one of ${valid}`)
  }
  // Perceived bonds stay packed: materializing 285k records cost ~17 ms per search, and most
  // consumers (rendering, polyhedra, image completion) read the columns
  // the searches validate their own options, explicit_only reads none of its own
  if (strategy === `explicit_only`) validate_bonding_options(strategy, options)
  const bonds =
    strategy === `electroneg_ratio`
      ? contacts_frame(structure, () => perceive_bonds(structure, options, query))
      : strategy === `pair_cutoffs`
        ? contacts_frame(structure, () => cutoff_contacts(structure, options, query))
        : explicit_only(structure)
  cache_prepared_bonds(structure, strategy, options, bonds)
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
  options: BondingOptions<`electroneg_ratio`> = {},
  query?: BondNeighborQuery,
): BondPair[] {
  return contacts_frame(structure, () =>
    perceive_bonds(structure, options, query),
  ).materialize()
}
// Bonds over a structure's accepted contacts (none in an empty structure)
const contacts_frame = (structure: AnyStructure, contacts: () => PerceivedBonds): BondFrame =>
  new BondFrame(
    structure,
    site_count(structure) ? bond_columns(structure, contacts()) : pack_bonds([]),
  )

// Both public records and worker columns consume the same accepted contacts in discovery order.
function bond_columns(
  structure: AnyStructure,
  { centers, slots, count, neighbors, image_geometry, distances }: PerceivedBonds,
): BondColumns {
  const explicit = new Map(
    get_explicit_bond_metadata(structure).map((bond) => [rendered_bond_key_for(bond), bond]),
  )
  const matched_keys = new Set<string>()
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
      // Explicit bonds name unit-cell sites: key a bond ending on a PBC image atom by its
      // source site so the explicit bond tags every copy it draws as instead of adding one
      const cell_shift: Vec3 | undefined = shifted ? [shift_a, shift_b, shift_c] : undefined
      const target = canonicalize_bond_target(
        { site_idx_1, site_idx_2, cell_shift },
        structure.sites,
      )
      const key = rendered_bond_key_for(target)
      const metadata = explicit.get(key)
      if (metadata) {
        orders[bond_count] = BOND_ORDERS.indexOf(metadata.order)
        matched_keys.add(key)
      }
    }
  }
  for (const [key, metadata] of explicit) {
    if (matched_keys.has(key)) continue
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

// VESTA-style bonds: every contact in its element pair's [min, max] range (see PairCutoffs),
// plus explicit bonds tagged like electroneg_ratio's
export function pair_cutoffs(
  structure: AnyStructure,
  options: BondingOptions<`pair_cutoffs`> = {},
  query?: BondNeighborQuery,
): BondPair[] {
  return contacts_frame(structure, () =>
    cutoff_contacts(structure, options, query),
  ).materialize()
}

function cutoff_contacts(
  structure: AnyStructure,
  options: BondingOptions<`pair_cutoffs`>,
  query: BondNeighborQuery = query_bond_neighbors,
): PerceivedBonds {
  const { pair_cutoffs: cutoffs = {}, pbc = NO_PBC } = validate_bonding_options(
    `pair_cutoffs`,
    options,
  )
  const rows = read_pair_cutoffs(cutoffs)
  if (typeof rows === `string`) throw new TypeError(rows) // unreachable once validated: narrows
  const { symbols, site_elem_ids: elem_ids } = intern_site_elements(
    numeric_sites.get(structure) ?? structure.sites,
  )
  const n_elem = symbols.length
  // an empty range (hi < lo) for every pair no row names
  const lo = new Float64Array(n_elem * n_elem)
  const hi = new Float64Array(n_elem * n_elem).fill(-1)
  const elem_id = new Map(symbols.map((symbol, idx) => [symbol, idx]))
  let max_reach = 0
  for (const [elem_a, elem_b, min, max] of rows) {
    const [id_a, id_b] = [elem_id.get(elem_a), elem_id.get(elem_b)]
    if (id_a === undefined || id_b === undefined) continue // pair absent from this structure
    for (const pair of [id_a * n_elem + id_b, id_b * n_elem + id_a]) {
      lo[pair] = min
      hi[pair] = max
    }
    max_reach = Math.max(max_reach, max)
  }
  // the band keeps exactly the in-range contacts, each pair once from its lower site
  const { offsets, neighbors, image_geometry, distances } =
    max_reach > 0
      ? query(structure, max_reach, pbc, { elem_ids, n_elem, lo, hi })
      : {
          offsets: new Int32Array(1),
          neighbors: new Int32Array(0),
          image_geometry: undefined,
          distances: new Float64Array(0),
        }
  const count = offsets[offsets.length - 1]
  const centers = new Int32Array(count)
  const slots = new Int32Array(count)
  for (let center = 0; center + 1 < offsets.length; center++)
    for (let slot = offsets[center]; slot < offsets[center + 1]; slot++) {
      centers[slot] = center
      slots[slot] = slot
    }
  return { centers, slots, count, neighbors, image_geometry, distances }
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
// One per query, shared by its perceptions (bond_columns copies out before the next can run):
// reallocating 28 B x 4 per site on every drag frame of a 100k-atom structure kept the GC busy
const scratches = new WeakMap<BondNeighborQuery, BondScratch>()

function perceive_bonds(
  structure: AnyStructure,
  options: BondingOptions<`electroneg_ratio`>,
  query: BondNeighborQuery = query_bond_neighbors,
): PerceivedBonds {
  const {
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
  } = validate_bonding_options(`electroneg_ratio`, options)
  const columns = numeric_sites.get(structure)
  const sites = columns ?? structure.sites
  const n_sites = sites.length
  // Per-site properties in flat typed arrays - the candidate loop below visits every
  // contact within reach in large supercells, so object property chains and Map lookups
  // are replaced with indexed array reads.
  const { symbols, site_elem_ids: elem_ids, elem_data } = intern_site_elements(sites)
  const orig_idxs = new Int32Array(n_sites)
  for (let idx = 0; idx < n_sites; idx++) {
    // Valid orig indices always reference a site in this structure; fall back to
    // the site's own index on out-of-range provenance so the typed
    // `closest` array below stays bounded by n_sites
    const orig_idx = sites instanceof NumericSites ? idx : get_orig_site_idx(sites[idx], idx)
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
  // true reach instead of max_distance_ratio: 4.2 A rather than 6.6 for rocksalt. The
  // ceiling stays zero for a pair with an unknown radius, which drops it without a special case.
  const pair_expected = new Float64Array(n_elem * n_elem)
  const pair_factor = new Float64Array(n_elem * n_elem)
  const pair_metallic = new Uint8Array(n_elem * n_elem)
  const reach_hi = new Float64Array(n_elem * n_elem)
  // Floors include min_bond_dist, also for pairs that cannot bond at all
  const reach_lo = new Float64Array(n_elem * n_elem).fill(min_bond_dist)
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
      reach_lo[pair] = Math.max(min_bond_dist, spread >= 1 ? 0 : expected * (1 - spread))
      if (reach_hi[pair] > max_reach) max_reach = reach_hi[pair]
    }
  }
  // The query drops contacts outside their pair's band while sweeping (a lone cutoff at the
  // longest reach stored 2x the bondable pairs in rocksalt); pass 1 re-tests the band since
  // BondSearch candidates carry a wider one. A zero/non-finite reach still needs a cutoff.
  const { offsets, neighbors, image_geometry, distances } = query(
    structure,
    max_reach > 0 && Number.isFinite(max_reach) ? max_reach : 1,
    pbc,
    { elem_ids, n_elem, lo: reach_lo, hi: reach_hi },
  )

  // Candidate bonds as struct-of-arrays typed buffers (neighbor slot, center, normalized
  // distance, metallic-pair flag, strength): no per-candidate object in the hot loop, and
  // passes 2-4 read the pair's class and normalized distance instead of recomputing them
  // Only a viewer's own query keeps its scratch: the module-level default would pin one
  // sized to the largest structure ever perceived for the page's lifetime
  let scratch = query === query_bond_neighbors ? undefined : scratches.get(query)
  if (!scratch || scratch.slots.length < n_sites * 4) {
    scratch = create_bond_scratch(Math.max(256, n_sites * 4))
    if (query !== query_bond_neighbors) scratches.set(query, scratch)
  }
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
      const dist = distances[slot]
      // Two table reads replace min_bond_dist, the radius sum, the ratio cutoff and the
      // whole metal/nonmetal/electronegativity branch chain
      const pair = pair_row + elem_ids[partner]
      if (dist > reach_hi[pair] || dist < reach_lo[pair]) continue

      // Normalized distance handles atoms of different sizes better than raw distance
      // (C-H is short but C-C is longer; C-H must not penalize C-C just because H is small)
      const norm_dist = dist / pair_expected[pair]
      const shell = pair_metallic[pair] ? closest_metallic : closest
      if (norm_dist < shell[orig_idxs[center]]) shell[orig_idxs[center]] = norm_dist
      if (norm_dist < shell[orig_idxs[partner]]) shell[orig_idxs[partner]] = norm_dist

      if (n_cand === cand_slot.length) {
        cand_slot = grow(cand_slot, n_cand + 1)
        cand_center = grow(cand_center, n_cand + 1)
        cand_norm = grow(cand_norm, n_cand + 1)
        cand_metallic = grow(cand_metallic, n_cand + 1)
        cand_strength = grow(cand_strength, n_cand + 1)
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
