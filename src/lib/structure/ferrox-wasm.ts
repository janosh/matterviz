// TypeScript wrapper for @matterviz/wasm WASM bindings
//
// Provides lazy initialization, typed wrappers, and result handling utilities
// for the matterviz WASM module (structure matching, analysis, etc).

import type { Crystal } from '$lib/structure'
import type {
  MatcherOptions,
  NeighborListResult,
  ReductionAlgorithm,
  StructureFormat,
  WasmResult,
} from './ferrox-wasm-types'
import { is_ok } from './ferrox-wasm-types'

// Re-export all types and utilities (no WASM side effects)
export * from './ferrox-wasm-types'

// WASM Module Types (from wasm-bindgen generated types)
interface WasmStructureMatcherClass {
  new (): WasmStructureMatcherInstance
}

interface WasmStructureMatcherInstance {
  with_latt_len_tol(tol: number): WasmStructureMatcherInstance
  with_site_pos_tol(tol: number): WasmStructureMatcherInstance
  with_angle_tol(tol: number): WasmStructureMatcherInstance
  with_primitive_cell(val: boolean): WasmStructureMatcherInstance
  with_scale(val: boolean): WasmStructureMatcherInstance
  with_element_comparator(val: boolean): WasmStructureMatcherInstance
  fit(struct1: unknown, struct2: unknown): WasmResult<boolean>
  fit_anonymous(struct1: unknown, struct2: unknown): WasmResult<boolean>
  get_rms_dist(
    struct1: unknown,
    struct2: unknown,
  ): WasmResult<{ rms: number; max_dist: number } | null>
  deduplicate(structures: unknown[]): WasmResult<number[]>
  find_matches(
    new_structures: unknown[],
    existing: unknown[],
  ): WasmResult<(number | null)[]>
}

// WASM module exports
interface FerroxWasmModule {
  default: (options?: { module_or_path?: string | URL }) => Promise<void>
  WasmStructureMatcher: WasmStructureMatcherClass
  // Parsing
  parse_structure: (input: unknown) => WasmResult<Crystal>
  parse_cif: (content: string) => WasmResult<Crystal>
  parse_poscar: (content: string) => WasmResult<Crystal>
  // Supercell and reduction
  make_supercell_diag: (
    structure: unknown,
    nx: number,
    ny: number,
    nz: number,
  ) => WasmResult<Crystal>
  make_supercell: (structure: unknown, matrix: number[][]) => WasmResult<Crystal>
  get_reduced_structure: (structure: unknown, algo: string) => WasmResult<Crystal>
  get_primitive: (structure: unknown, symprec: number) => WasmResult<Crystal>
  get_spacegroup_number: (structure: unknown, symprec: number) => WasmResult<number>
  structure_to_json: (structure: unknown) => WasmResult<string>
  // Physical properties
  get_volume: (structure: unknown) => WasmResult<number>
  get_total_mass: (structure: unknown) => WasmResult<number>
  get_density: (structure: unknown) => WasmResult<number>
  // Neighbor finding
  get_neighbor_list: (
    structure: unknown,
    r: number,
    numerical_tol: number,
    exclude_self: boolean,
  ) => WasmResult<NeighborListResult>
  get_distance: (structure: unknown, i: number, j: number) => WasmResult<number>
  get_distance_matrix: (structure: unknown) => WasmResult<number[][]>
  // Sorting
  get_sorted_structure: (structure: unknown, reverse: boolean) => WasmResult<Crystal>
  get_sorted_by_electronegativity: (
    structure: unknown,
    reverse: boolean,
  ) => WasmResult<Crystal>
  // Interpolation
  interpolate_structures: (
    start: unknown,
    end: unknown,
    n_images: number,
    interpolate_lattices: boolean,
    use_pbc: boolean,
  ) => WasmResult<Crystal[]>
  // Copy and wrap
  copy_structure: (structure: unknown, sanitize: boolean) => WasmResult<Crystal>
  wrap_to_unit_cell: (structure: unknown) => WasmResult<Crystal>
  // Site manipulation
  translate_sites: (
    structure: unknown,
    indices: number[],
    vector: number[],
    frac_coords: boolean,
  ) => WasmResult<Crystal>
  perturb_structure: (
    structure: unknown,
    distance: number,
    min_distance?: number,
    seed?: number,
  ) => WasmResult<Crystal>
  // Element info
  get_atomic_mass: (symbol: string) => WasmResult<number>
  get_electronegativity: (symbol: string) => WasmResult<number>
}

// Lazy Initialization
let wasm_module: FerroxWasmModule | null = null
let init_promise: Promise<FerroxWasmModule> | null = null

// Ensure the WASM module is loaded and initialized.
// Memoizes the init promise to prevent concurrent callers from racing and
// triggering duplicate WASM initialization.
export function ensure_ferrox_wasm_ready(): Promise<FerroxWasmModule> {
  // WASM only works in browser
  if (typeof window === `undefined`) {
    return Promise.reject(new Error(`ferrox-wasm can only be used in the browser`))
  }

  // Fast path: already initialized
  if (wasm_module) return Promise.resolve(wasm_module)

  // Memoize the init promise to prevent race conditions where concurrent
  // callers both start initialization before the first one completes
  if (!init_promise) {
    init_promise = (async () => {
      try {
        // Dynamic import to avoid loading WASM until needed
        // @vite-ignore prevents Vite from trying to resolve this during SSR
        const { default: init } = (await import(
          /* @vite-ignore */ `@matterviz/wasm`
        )) as unknown as {
          default: (
            options?: { module_or_path?: string | URL },
          ) => Promise<FerroxWasmModule>
        }

        // Get the WASM binary URL and initialize
        const wasm_url_module = await import(
          /* @vite-ignore */ `@matterviz/wasm/ferrox_bg.wasm?url`
        )
        const wasm_url = wasm_url_module.default as string

        // init() loads pkg/ferrox.js, initializes WASM, and returns the module
        const mod = await init({ module_or_path: wasm_url })
        wasm_module = mod as FerroxWasmModule
        return wasm_module
      } catch (err) {
        // Clear the promise on failure so retry is possible
        init_promise = null
        throw new Error(
          `Failed to load @matterviz/wasm. Install with: pnpm add @matterviz/wasm. Original error: ${err}`,
        )
      }
    })()
  }

  return init_promise
}

// Check if the module is already initialized
export function is_wasm_ready(): boolean {
  return wasm_module !== null
}

// Typed Wrapper Functions

// Create a configured matcher instance with builder pattern
function create_matcher(
  mod: FerroxWasmModule,
  opts?: MatcherOptions,
): WasmStructureMatcherInstance {
  let m = new mod.WasmStructureMatcher()
  if (!opts) return m
  if (opts.latt_len_tol !== undefined) m = m.with_latt_len_tol(opts.latt_len_tol)
  if (opts.site_pos_tol !== undefined) m = m.with_site_pos_tol(opts.site_pos_tol)
  if (opts.angle_tol !== undefined) m = m.with_angle_tol(opts.angle_tol)
  if (opts.primitive_cell !== undefined) m = m.with_primitive_cell(opts.primitive_cell)
  if (opts.scale !== undefined) m = m.with_scale(opts.scale)
  if (opts.element_only !== undefined) m = m.with_element_comparator(opts.element_only)
  return m
}

// Check if two structures are equivalent
export async function match_structures(
  struct1: Crystal,
  struct2: Crystal,
  options?: MatcherOptions,
): Promise<WasmResult<boolean>> {
  const mod = await ensure_ferrox_wasm_ready()
  const matcher = create_matcher(mod, options)
  return matcher.fit(struct1, struct2)
}

// Check if two structures match under any species permutation
export async function match_structures_anonymous(
  struct1: Crystal,
  struct2: Crystal,
  options?: MatcherOptions,
): Promise<WasmResult<boolean>> {
  const mod = await ensure_ferrox_wasm_ready()
  const matcher = create_matcher(mod, options)
  return matcher.fit_anonymous(struct1, struct2)
}

// Get RMS distance between two structures
export async function get_structure_rms_dist(
  struct1: Crystal,
  struct2: Crystal,
  options?: MatcherOptions,
): Promise<WasmResult<{ rms: number; max_dist: number } | null>> {
  const mod = await ensure_ferrox_wasm_ready()
  const matcher = create_matcher(mod, options)
  return matcher.get_rms_dist(struct1, struct2)
}

// Find a matching structure from a database
export async function find_matching_structure(
  query: Crystal,
  database: Crystal[],
  options?: MatcherOptions,
): Promise<WasmResult<number | null>> {
  const mod = await ensure_ferrox_wasm_ready()
  const matcher = create_matcher(mod, options)
  const results = matcher.find_matches([query], database)
  if (is_ok(results)) {
    return { ok: results.ok[0] ?? null }
  }
  return results
}

// Deduplicate a set of structures
export async function deduplicate_structures(
  structures: Crystal[],
  options?: MatcherOptions,
): Promise<WasmResult<number[]>> {
  const mod = await ensure_ferrox_wasm_ready()
  const matcher = create_matcher(mod, options)
  return matcher.deduplicate(structures)
}

// Parse structure from file content
export async function parse_structure_file(
  content: string,
  format: StructureFormat,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  switch (format) {
    case `cif`:
      return mod.parse_cif(content)
    case `poscar`:
      return mod.parse_poscar(content)
    case `json`: {
      let parsed: unknown
      try {
        parsed = JSON.parse(content)
      } catch (exc) {
        const msg = exc instanceof Error ? exc.message : String(exc)
        return { error: `Invalid JSON: ${msg}` }
      }
      return mod.parse_structure(parsed)
    }
    default:
      return { error: `Unknown structure format: ${format}` }
  }
}

// Create a supercell with diagonal scaling matrix
export async function create_supercell(
  structure: Crystal,
  nx: number,
  ny: number,
  nz: number,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.make_supercell_diag(structure, nx, ny, nz)
}

// Reduce lattice using Niggli or LLL algorithm
export async function reduce_lattice(
  structure: Crystal,
  algo: ReductionAlgorithm = `niggli`,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_reduced_structure(structure, algo)
}

// Get the primitive cell of a structure
export async function get_primitive_cell(
  structure: Crystal,
  symprec: number = 1e-4,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_primitive(structure, symprec)
}

// Get the spacegroup number of a structure
export async function get_spacegroup(
  structure: Crystal,
  symprec: number = 1e-4,
): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_spacegroup_number(structure, symprec)
}

// Serialize structure to pymatgen-compatible JSON string
export async function serialize_structure(
  structure: Crystal,
): Promise<WasmResult<string>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.structure_to_json(structure)
}

// Physical Properties
export async function get_volume(structure: Crystal): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_volume(structure)
}

// Get total mass in atomic mass units (u)
export async function get_total_mass(structure: Crystal): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_total_mass(structure)
}

// Get density in g/cm^3
export async function get_density(structure: Crystal): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_density(structure)
}

// Neighbor Finding
export async function get_neighbor_list(
  structure: Crystal,
  cutoff_radius: number,
  numerical_tol: number = 1e-8,
  exclude_self: boolean = true,
): Promise<WasmResult<NeighborListResult>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_neighbor_list(structure, cutoff_radius, numerical_tol, exclude_self)
}

// Get minimum image distance between two sites
export async function get_distance(
  structure: Crystal,
  i: number,
  j: number,
): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_distance(structure, i, j)
}

// Get full NxN distance matrix
export async function get_distance_matrix(
  structure: Crystal,
): Promise<WasmResult<number[][]>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_distance_matrix(structure)
}

// Sorting
export async function get_sorted_structure(
  structure: Crystal,
  reverse: boolean = false,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_sorted_structure(structure, reverse)
}

// Get structure sorted by electronegativity
export async function get_sorted_by_electronegativity(
  structure: Crystal,
  reverse: boolean = false,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_sorted_by_electronegativity(structure, reverse)
}

// Interpolation
export async function interpolate_structures(
  start: Crystal,
  end: Crystal,
  n_images: number,
  options?: { interpolate_lattices?: boolean; use_pbc?: boolean },
): Promise<WasmResult<Crystal[]>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.interpolate_structures(
    start,
    end,
    n_images,
    options?.interpolate_lattices ?? false,
    options?.use_pbc ?? true,
  )
}

// Copy and Wrap
export async function copy_structure(
  structure: Crystal,
  sanitize: boolean = false,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.copy_structure(structure, sanitize)
}

// Wrap all fractional coordinates to [0, 1)
export async function wrap_to_unit_cell(
  structure: Crystal,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.wrap_to_unit_cell(structure)
}

// Supercell with Full Matrix
export async function create_supercell_matrix(
  structure: Crystal,
  matrix: [[number, number, number], [number, number, number], [number, number, number]],
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.make_supercell(structure, matrix)
}

// Site Manipulation
export async function translate_sites(
  structure: Crystal,
  indices: number[],
  vector: [number, number, number],
  frac_coords: boolean = false,
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.translate_sites(structure, indices, vector, frac_coords)
}

// Perturb all sites by random vectors
export async function perturb_structure(
  structure: Crystal,
  distance: number,
  options?: { min_distance?: number; seed?: number },
): Promise<WasmResult<Crystal>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.perturb_structure(
    structure,
    distance,
    options?.min_distance,
    options?.seed,
  )
}

// Element Information
export async function get_atomic_mass(symbol: string): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_atomic_mass(symbol)
}

// Get electronegativity of an element by symbol
export async function get_electronegativity(
  symbol: string,
): Promise<WasmResult<number>> {
  const mod = await ensure_ferrox_wasm_ready()
  return mod.get_electronegativity(symbol)
}
