// moyo-wasm bridge: the one place the WASM module is initialized and a structure is handed
// to moyo's analyze_cell, plus thin wrappers over its space-group database lookups.
import { element_from_atomic_number, symbol_to_atomic_number } from '$lib/element/helpers'
import * as math from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, Crystal, Site } from '$lib/structure'
import { merge_split_partial_sites } from '$lib/structure/partial-occupancy'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import { is_identity, mat3_from_flat_col_major } from './symmetry-elements'
import type {
  InitInput,
  MoyoCell,
  MoyoDataset,
  MoyoHallSymbolEntry,
  MoyoWyckoffPosition,
} from '@spglib/moyo-wasm'
import init, {
  analyze_cell,
  hall_symbol_entries_from_number,
  wyckoff_positions,
} from '@spglib/moyo-wasm'

export type SymmetrySettings = {
  symprec: number
  algo: `Moyo` | `Spglib`
}
export const default_sym_settings = {
  symprec: DEFAULTS.symmetry.symprec,
  algo: DEFAULTS.symmetry.algo,
} as const satisfies SymmetrySettings

// moyo's per-site arrays (wyckoffs, orbits, site_symmetry_symbols) index the merged input
// cell that was fed to analyze_cell, not std_cell. The dataset therefore carries that cell
// plus the map from each of its sites back to the original structure's site indices (one
// input site -> many originals for merged disordered sites).
export type SymmetryDataset = MoyoDataset & {
  input_cell: Pick<MoyoCell, `positions` | `numbers`>
  orig_site_indices_by_input_idx: number[][]
}

// Memoized so concurrent first callers share one instantiation; a failed attempt is
// forgotten so the next call can retry (e.g. after a transient fetch error).
let init_promise: Promise<unknown> | null = null
let wasm_ready = false
export function ensure_moyo_wasm_ready(source?: InitInput): Promise<void> {
  // wasm-bindgen resolves the default .wasm relative to its glue module
  init_promise ??= init(source === undefined ? undefined : { module_or_path: source })
    .then(() => {
      wasm_ready = true
    })
    .catch((err: unknown) => {
      init_promise = null
      throw err
    })
  return init_promise.then(() => undefined)
}

const OCCUPANCY_EPS = 1e-8

// Atomic number of the majority species (ties resolve alphabetically) of a site
function site_atomic_number(site: Site, site_idx: number): number {
  const occupancy_by_element = new Map<string, number>()
  for (const { element, occu } of site.species) {
    if (occu <= OCCUPANCY_EPS) continue
    occupancy_by_element.set(element, (occupancy_by_element.get(element) ?? 0) + occu)
  }
  let selected: string | undefined = site.species[0]?.element
  let best_occupancy = -Infinity
  for (const [element, occupancy] of occupancy_by_element) {
    if (
      occupancy > best_occupancy ||
      (occupancy === best_occupancy && element.localeCompare(selected ?? ``) < 0)
    ) {
      selected = element
      best_occupancy = occupancy
    }
  }
  const atomic_number = symbol_to_atomic_number(selected)
  if (atomic_number === undefined) {
    throw new Error(`Unknown element at site ${site_idx}: ${selected}`)
  }
  return atomic_number
}

export async function analyze_structure_symmetry(
  structure: AnyStructure,
  settings: Partial<SymmetrySettings> = {},
): Promise<SymmetryDataset> {
  if (!(`lattice` in structure)) {
    throw new Error(`Symmetry analysis requires a periodic structure with a lattice`)
  }
  await ensure_moyo_wasm_ready()
  const merged = merge_split_partial_sites(structure.sites)
  const positions = merged.map(({ site }) => site.abc)
  const numbers = merged.map(({ site, site_idx }) => site_atomic_number(site, site_idx))
  // nalgebra Matrix3 deserializes as a flat list in COLUMN-MAJOR of the internal basis B;
  // internal B = transpose(row-basis RB), so column-major(B) == row-major(RB): supply the
  // pymatgen-style lattice.matrix (rows = lattice vectors) flattened as is
  const cell: MoyoCell = {
    lattice: { basis: structure.lattice.matrix.flat() as MoyoCell[`lattice`][`basis`] },
    positions,
    numbers,
  }
  const { symprec, algo } = { ...default_sym_settings, ...settings }
  const sym_data = analyze_cell(
    JSON.stringify(cell),
    symprec,
    algo === `Moyo` ? `Standard` : algo,
  )
  return {
    ...sym_data,
    input_cell: { positions, numbers },
    orig_site_indices_by_input_idx: merged.map(
      ({ source_site_indices }) => source_site_indices,
    ),
  }
}

// Operations split into pure translations, translation-free rotations and the rest
export function count_symmetry_op_kinds(
  operations: MoyoDataset[`operations`],
): Record<`translations` | `rotations` | `roto_translations`, number> {
  const counts = { translations: 0, rotations: 0, roto_translations: 0 }
  for (const { rotation, translation } of operations) {
    const has_translation = translation.some((coord) => Math.abs(coord) > 1e-10)
    if (!has_translation) counts.rotations++
    else if (is_identity(mat3_from_flat_col_major(rotation))) counts.translations++
    else counts.roto_translations++
  }
  return counts
}

// Whether `value` is an integer in [min, max]. The WASM entry points below take a u32/i32 and
// panic (not throw) on a fractional, negative or NaN number, which SymmetryStats would hit
// inside a $derived from a malformed public `sym_data` prop, so every number is range-checked
// here first and the lookups return [] instead.
const is_int_in_range = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max

// All Wyckoff positions of the space-group setting given by hall_number (1-530), ordered
// general-position-first. Returns [] for a hall number outside that range and before the WASM
// module is initialized (SSR, component tests) — callers treat the database as an optional
// enrichment, never a hard requirement. Anything moyo itself throws propagates.
export const spacegroup_wyckoff_positions = (hall_number: number): MoyoWyckoffPosition[] =>
  wasm_ready && is_int_in_range(hall_number, 1, 530) ? wyckoff_positions(hall_number) : []

// All Hall-symbol entries (settings) of the ITA space group `spacegroup_number` (1-230),
// ordered by Hall number. Returns [] for a number outside that range and before the WASM
// module is initialized.
export const spacegroup_settings = (spacegroup_number: number): MoyoHallSymbolEntry[] =>
  wasm_ready && is_int_in_range(spacegroup_number, 1, 230)
    ? hall_symbol_entries_from_number(spacegroup_number)
    : []

// Cell described by a MoyoCell (std_cell or prim_std_cell) as a Crystal. moyo-wasm uses the
// same row-major serialization for output as for input, so the flat basis is row-major with
// each row a lattice vector. `bonds` are dropped: site indices change under any cell
// transform, so stale bond indices would mis-render.
const moyo_cell_to_structure = (cell: MoyoCell, original: Crystal): Crystal => {
  const matrix = math.vec9_to_mat3x3([...cell.lattice.basis])
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const sites = cell.positions.map((abc, idx) => {
    const element = element_from_atomic_number(cell.numbers[idx])
    if (!element) throw new Error(`Unknown atomic number: ${cell.numbers[idx]}`)
    // moyo may return coordinates outside [0, 1)
    const wrapped_abc = wrap_to_unit_cell(abc)
    return make_site(element, wrapped_abc, frac_to_cart(wrapped_abc), element)
  })
  const { bonds: _bonds, ...properties } = original.properties ?? {}
  return {
    lattice: { matrix, pbc: original.lattice.pbc, ...math.calc_lattice_params(matrix) },
    sites,
    charge: original.charge,
    id: original.id,
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
  }
}

export type CellType = `original` | `conventional` | `primitive`

// The structure in the requested cell. Unchanged for `original` and while no symmetry data is
// available yet. Persisted settings are validated in $lib/settings/viewer-state, so any other
// cell_type reaching here is a caller bug.
export const transform_cell = (
  structure: Crystal,
  cell_type: CellType,
  sym_data: MoyoDataset | null,
): Crystal => {
  if (!sym_data || cell_type === `original`) return structure
  const cell = { conventional: sym_data.std_cell, primitive: sym_data.prim_std_cell }[
    cell_type
  ]
  if (!cell) throw new Error(`Unknown cell_type "${cell_type}"`)
  return moyo_cell_to_structure(cell, structure)
}
