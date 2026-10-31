// moyo bridge: the one place a structure is handed to moyo's analyze_cell (the WASM build, or
// a host backend running moyo natively), plus thin wrappers over its space-group database.
import { display_idx } from '#lib/labels.js'
import { element_from_atomic_number, symbol_to_atomic_number } from '#lib/element/helpers.js'
import * as math from '#lib/math.js'
import { DEFAULTS } from '#lib/settings.js'
import type { AnyStructure, Crystal, Site } from '#lib/structure/index.js'
import { merge_split_partial_sites } from '#lib/structure/partial-occupancy.js'
import { wrap_to_unit_cell } from '#lib/structure/pbc.js'
import { make_site } from '#lib/structure/site.js'
import { create_worker_client } from '#lib/worker-client.svelte.js'
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

export type SymmetrySettings = { symprec: number; algo: `Moyo` | `Spglib` }
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

// A host that runs moyo itself (e.g. a desktop shell with moyo compiled in) instead of the
// WASM build. Both functions return moyo-wasm's own JSON shapes, so everything downstream of
// analyze_structure_symmetry is unchanged; a host can then drop @spglib/moyo-wasm entirely.
export interface SymmetryBackend {
  analyze_cell: (
    cell: MoyoCell,
    symprec: number,
    setting: `Standard` | `Spglib`,
  ) => Promise<MoyoDataset>
  // Settings of the ITA space group `number` and each setting's Wyckoff positions, keyed by
  // Hall number (moyo-wasm's hall_symbol_entries_from_number and wyckoff_positions).
  space_group_database: (number: number) => Promise<{
    settings: MoyoHallSymbolEntry[]
    wyckoff_positions: Record<number, MoyoWyckoffPosition[]>
  }>
}

let symmetry_backend: SymmetryBackend | null = null
// The backend's database answers, fetched with each analysis so the synchronous lookups below
// (read inside $derived) can serve them.
const backend_settings = new Map<number, MoyoHallSymbolEntry[]>()
const backend_wyckoffs = new Map<number, MoyoWyckoffPosition[]>()

// Register before the first analysis; null restores the WASM build.
export function set_symmetry_backend(backend: SymmetryBackend | null): void {
  symmetry_backend = backend
  backend_settings.clear()
  backend_wyckoffs.clear()
}

// Memoized so concurrent first callers share one instantiation; a failed attempt is
// forgotten so the next call can retry (e.g. after a transient fetch error).
let init_promise: Promise<unknown> | null = null
let wasm_ready = false
// Where hosts serving the WASM elsewhere (the VS Code webview) keep it. Registering it fetches
// nothing: the first analysis does, and a retry after a failed fetch reuses it.
let registered_source: InitInput | undefined
// null forgets it: the WASM is served next to the glue module again
export const set_moyo_wasm_source = (source: InitInput | null): void => {
  registered_source = source ?? undefined
}
export function ensure_moyo_wasm_ready(source?: InitInput): Promise<void> {
  if (symmetry_backend) return Promise.resolve()
  // a source given here is where this host serves the WASM, as if registered
  if (source !== undefined) registered_source = source
  // wasm-bindgen resolves the default .wasm relative to its glue module
  const module_or_path = registered_source
  init_promise ??= init(module_or_path === undefined ? undefined : { module_or_path })
    .then(() => {
      wasm_ready = true
    })
    .catch((err: unknown) => {
      init_promise = null
      throw err
    })
  return init_promise.then(() => undefined)
}

// What the moyo worker needs besides the cell
export type MoyoWorkerOptions = { symprec: number; setting: `Standard` | `Spglib` }

// moyo's analyze_cell in a Web Worker (a 47k-site supercell held the main thread for 16-19 s).
// The worker loads the WASM from its default location, so a host serving it elsewhere (the VS
// Code webview, whose workers fetch nothing, or a relative URL the worker would resolve against
// itself) runs here, as does any host without Worker, once ensure_moyo_wasm_ready is done.
const analyze_cell_async = create_worker_client<
  { cell: MoyoCell },
  MoyoWorkerOptions,
  MoyoDataset
>({
  label: `Symmetry`,
  create_worker: () =>
    // oxlint-disable-next-line eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
    new Worker(new URL(`./moyo-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: ({ cell }, options) => {
    if (!options) throw new Error(`moyo analysis needs symprec and setting`)
    return analyze_cell(JSON.stringify(cell), options.symprec, options.setting)
  },
  // Plain copies: positions are the sites' own abc arrays, $state proxies in a viewer
  build_payload: ({ cell: { lattice, positions, numbers } }) => ({
    cell: {
      lattice: { basis: [...lattice.basis] },
      positions: positions.map(([coord_a, coord_b, coord_c]) => [coord_a, coord_b, coord_c]),
      numbers: [...numbers],
    },
  }),
  requires_main_thread: () => registered_source !== undefined,
})

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
    throw new Error(`Unknown element at site ${display_idx(site_idx)}: ${selected}`)
  }
  return atomic_number
}

// moyo compares sites only by their integer labels. Fully occupied single-element sites keep
// their atomic number; every distinct partial composition gets its own label above the element
// range (as moyopy's MoyoAdapter does), so a Cu0.5Au0.5 site is never mapped onto a pure Cu
// site and no symmetry beyond the disordered crystal's own is found.
const DISORDER_LABEL_BASE = 1000
function moyo_site_labels(sites: Site[], numbers: number[]): number[] {
  const label_by_composition = new Map<string, number>()
  return sites.map((site, site_idx) => {
    const species = site.species.filter(({ occu }) => occu > OCCUPANCY_EPS)
    if (species.length === 1 && Math.abs(species[0].occu - 1) <= OCCUPANCY_EPS) {
      return numbers[site_idx]
    }
    const composition = species
      .map(({ element, occu }) => `${element}:${occu.toFixed(6)}`)
      .toSorted()
      .join(` `)
    let label = label_by_composition.get(composition)
    if (label === undefined) {
      label = DISORDER_LABEL_BASE + label_by_composition.size
      label_by_composition.set(composition, label)
    }
    return label
  })
}

export async function analyze_structure_symmetry(
  structure: AnyStructure,
  settings: Partial<SymmetrySettings> = {},
  // drops a queued or running worker analysis (a superseded or unmounted viewer's)
  signal?: AbortSignal,
): Promise<SymmetryDataset> {
  if (!(`lattice` in structure)) {
    throw new Error(`Symmetry analysis requires a periodic structure with a lattice`)
  }
  if (!symmetry_backend) await ensure_moyo_wasm_ready()
  const merged = merge_split_partial_sites(structure.sites)
  const positions = merged.map(({ site }) => site.abc)
  const numbers = merged.map(({ site, site_idx }) => site_atomic_number(site, site_idx))
  const labels = moyo_site_labels(
    merged.map(({ site }) => site),
    numbers,
  )
  // nalgebra Matrix3 deserializes as a flat list in COLUMN-MAJOR of the internal basis B;
  // internal B = transpose(row-basis RB), so column-major(B) == row-major(RB): supply the
  // pymatgen-style lattice.matrix (rows = lattice vectors) flattened as is
  const cell: MoyoCell = {
    lattice: { basis: structure.lattice.matrix.flat() as MoyoCell[`lattice`][`basis`] },
    positions,
    numbers: labels,
  }
  const { symprec, algo } = { ...default_sym_settings, ...settings }
  const setting = algo === `Moyo` ? `Standard` : algo
  const backend = symmetry_backend
  const sym_data = backend
    ? await backend.analyze_cell(cell, symprec, setting)
    : await analyze_cell_async({ cell }, { symprec, setting }, { signal })
  if (backend && !backend_settings.has(sym_data.number)) {
    const database = await backend.space_group_database(sym_data.number)
    backend_settings.set(sym_data.number, database.settings)
    for (const [hall_number, wyckoffs] of Object.entries(database.wyckoff_positions))
      backend_wyckoffs.set(Number(hall_number), wyckoffs)
  }
  // Standardized cells come back with moyo's labels; display them by majority element
  const number_by_label = new Map(labels.map((label, idx) => [label, numbers[idx]]))
  const to_numbers = (std_cell: MoyoCell): MoyoCell => ({
    ...std_cell,
    numbers: std_cell.numbers.map((label) => {
      const number = number_by_label.get(label)
      if (number === undefined) throw new Error(`moyo returned unknown site label ${label}`)
      return number
    }),
  })
  return {
    ...sym_data,
    std_cell: to_numbers(sym_data.std_cell),
    prim_std_cell: to_numbers(sym_data.prim_std_cell),
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

// Distinct rotation parts W of space-group operations as row-major matrices in the fractional
// basis of the analyzed (input) cell, x' = W·x + w: the crystal's point group in that basis.
// Supercell inputs repeat each W once per lattice translation, hence the dedupe.
export function point_group_rotations(
  operations: MoyoDataset[`operations`],
): math.Matrix3x3[] {
  const by_key = new Map<string, math.Matrix3x3>()
  for (const { rotation } of operations)
    by_key.set(rotation.join(`,`), mat3_from_flat_col_major(rotation))
  return [...by_key.values()]
}

// Whether `value` is an integer in [min, max]. The WASM entry points below take a u32/i32 and
// panic (not throw) on a fractional, negative or NaN number, which SymmetryStats would hit
// inside a $derived from a malformed public `sym_data` prop, so every number is range-checked
// here first and the lookups return [] instead.
const is_int_in_range = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max

// All Wyckoff positions of the space-group setting given by hall_number (1-530), ordered
// general-position-first. Returns [] for a hall number outside that range, before the WASM
// module is initialized (SSR, component tests), and with a host backend for a space group no
// analysis has returned yet — callers treat the database as an optional enrichment, never a
// hard requirement. Anything moyo itself throws propagates.
export const spacegroup_wyckoff_positions = (hall_number: number): MoyoWyckoffPosition[] => {
  if (!is_int_in_range(hall_number, 1, 530)) return []
  if (symmetry_backend) return backend_wyckoffs.get(hall_number) ?? []
  return wasm_ready ? wyckoff_positions(hall_number) : []
}

// All Hall-symbol entries (settings) of the ITA space group `spacegroup_number` (1-230),
// ordered by Hall number. Returns [] in the same cases as spacegroup_wyckoff_positions.
export const spacegroup_settings = (spacegroup_number: number): MoyoHallSymbolEntry[] => {
  if (!is_int_in_range(spacegroup_number, 1, 230)) return []
  if (symmetry_backend) return backend_settings.get(spacegroup_number) ?? []
  return wasm_ready ? hall_symbol_entries_from_number(spacegroup_number) : []
}

export type CellType = `original` | `conventional` | `primitive`

// The structure in the requested cell (moyo's std_cell or prim_std_cell). Unchanged for
// `original` and while no symmetry data is available yet. Persisted settings are validated in
// #lib/settings/viewer-state, so any other cell_type reaching here is a caller bug. moyo-wasm
// serializes the output basis like the input one: row-major, each row a lattice vector.
// `bonds` are dropped: site indices change under any cell transform, so stale bond indices
// would mis-render. `charge` is per cell, so it scales by the new cell's site count relative
// to the analyzed input cell's, which counts merged split-partial sites once as moyo's cells
// do: an exact rational ratio, where the volume ratio carried float noise into the integer
// charge bond-order perception looks up.
export const transform_cell = (
  structure: Crystal,
  cell_type: CellType,
  sym_data: SymmetryDataset | null,
): Crystal => {
  if (!sym_data || cell_type === `original`) return structure
  const cell = { conventional: sym_data.std_cell, primitive: sym_data.prim_std_cell }[
    cell_type
  ]
  if (!cell) throw new Error(`Unknown cell_type "${cell_type}"`)
  const matrix = math.vec9_to_mat3x3([...cell.lattice.basis])
  const frac_to_cart = math.create_frac_to_cart(matrix)
  const sites = cell.positions.map((abc, idx) => {
    const element = element_from_atomic_number(cell.numbers[idx])
    if (!element) throw new Error(`Unknown atomic number: ${cell.numbers[idx]}`)
    // moyo may return coordinates outside [0, 1)
    const wrapped_abc = wrap_to_unit_cell(abc)
    return make_site(element, wrapped_abc, frac_to_cart(wrapped_abc), element)
  })
  const { charge, id, lattice, properties: all_properties } = structure
  const { bonds: _bonds, ...properties } = all_properties ?? {}
  const n_input = sym_data.input_cell.positions.length
  return {
    lattice: { matrix, pbc: lattice.pbc, ...math.calc_lattice_params(matrix) },
    sites,
    charge: charge && (charge * cell.positions.length) / n_input,
    id,
    ...(Object.keys(properties).length > 0 ? { properties } : {}),
  }
}
