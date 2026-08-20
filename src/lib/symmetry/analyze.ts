// moyo-wasm bridge: the one place the WASM module is initialized and a structure is handed
// to moyo's analyze_cell, plus thin wrappers over its space-group database lookups.
import { ELEM_SYMBOLS } from '$lib/element/types'
import * as math from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import type { AnyStructure, Crystal, Site } from '$lib/structure'
import { merge_split_partial_sites } from '$lib/structure/partial-occupancy'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
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
export function ensure_moyo_wasm_ready(source?: InitInput): Promise<void> {
  // wasm-bindgen resolves the default .wasm relative to its glue module
  init_promise ??= init(source === undefined ? undefined : { module_or_path: source }).catch(
    (err: unknown) => {
      init_promise = null
      throw err
    },
  )
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
  const atomic_number = ELEM_SYMBOLS.indexOf(selected as (typeof ELEM_SYMBOLS)[number]) + 1
  if (atomic_number === 0) throw new Error(`Unknown element at site ${site_idx}: ${selected}`)
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

// All Wyckoff positions of the space-group setting given by hall_number (1-530), ordered
// general-position-first. moyo returns [] for out-of-range hall numbers. Returns [] when the
// WASM module is not initialized (SSR, unit tests) — callers treat the database as an optional
// enrichment, never a hard requirement.
export function spacegroup_wyckoff_positions(hall_number: number): MoyoWyckoffPosition[] {
  try {
    return wyckoff_positions(hall_number)
  } catch {
    return []
  }
}

// All Hall-symbol entries (settings) of the ITA space group `spacegroup_number` (1-230),
// ordered by Hall number. Returns [] when the WASM module is not initialized.
export function spacegroup_settings(spacegroup_number: number): MoyoHallSymbolEntry[] {
  try {
    return hall_symbol_entries_from_number(spacegroup_number)
  } catch {
    return []
  }
}

// Cell described by a MoyoCell (std_cell or prim_std_cell) as a Crystal. moyo-wasm uses the
// same row-major serialization for output as for input, so the flat basis is row-major with
// each row a lattice vector. `bonds` are dropped: site indices change under any cell
// transform, so stale bond indices would mis-render.
const moyo_cell_to_structure = (cell: MoyoCell, original: Crystal): Crystal => {
  const matrix = math.vec9_to_mat3x3([...cell.lattice.basis])
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const sites = cell.positions.map((abc, idx) => {
    const element = ELEM_SYMBOLS[cell.numbers[idx] - 1]
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

// The structure in the requested cell. Unchanged for `original`, when no symmetry data is
// available yet, or for an unknown runtime cell_type (stale persisted settings).
export const transform_cell = (
  structure: Crystal,
  cell_type: CellType,
  sym_data: MoyoDataset | null,
): Crystal => {
  if (!sym_data) return structure
  if (cell_type === `conventional`) return moyo_cell_to_structure(sym_data.std_cell, structure)
  if (cell_type === `primitive`) {
    return moyo_cell_to_structure(sym_data.prim_std_cell, structure)
  }
  return structure
}
