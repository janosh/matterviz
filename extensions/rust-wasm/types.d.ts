// Type definitions for @matterviz/wasm
// Minimal types for the dynamic loader (index.js)
// For detailed typed wrappers, use $lib/structure/ferrox-wasm.ts in matterviz

// The module returned by init() - all WASM exports are synchronous after init
export interface WasmModule {
  default: (options?: { module_or_path?: string | URL }) => Promise<void>
  WasmStructureMatcher: typeof WasmStructureMatcher
  parse_structure: (input: unknown) => unknown
  parse_cif: (content: string) => unknown
  parse_poscar: (content: string) => unknown
  make_supercell_diag: (structure: unknown, nx: number, ny: number, nz: number) => unknown
  make_supercell: (structure: unknown, matrix: number[][]) => unknown
  get_reduced_structure: (structure: unknown, algo: string) => unknown
  get_primitive: (structure: unknown, symprec: number) => unknown
  get_spacegroup_number: (structure: unknown, symprec: number) => unknown
  structure_to_json: (structure: unknown) => unknown
  get_volume: (structure: unknown) => unknown
  get_total_mass: (structure: unknown) => unknown
  get_density: (structure: unknown) => unknown
  get_neighbor_list: (
    structure: unknown,
    r: number,
    tol: number,
    exclude_self: boolean,
  ) => unknown
  get_distance: (structure: unknown, i: number, j: number) => unknown
  get_distance_matrix: (structure: unknown) => unknown
  get_sorted_structure: (structure: unknown, reverse: boolean) => unknown
  get_sorted_by_electronegativity: (structure: unknown, reverse: boolean) => unknown
  interpolate_structures: (
    start: unknown,
    end: unknown,
    n_images: number,
    interpolate_lattices: boolean,
    use_pbc: boolean,
  ) => unknown
  copy_structure: (structure: unknown, sanitize: boolean) => unknown
  wrap_to_unit_cell: (structure: unknown) => unknown
  translate_sites: (
    structure: unknown,
    indices: number[],
    vector: number[],
    frac_coords: boolean,
  ) => unknown
  perturb_structure: (
    structure: unknown,
    distance: number,
    min_distance?: number,
    seed?: number,
  ) => unknown
  get_atomic_mass: (symbol: string) => unknown
  get_electronegativity: (symbol: string) => unknown
}

export class WasmStructureMatcher {
  constructor()
  with_latt_len_tol(tol: number): WasmStructureMatcher
  with_site_pos_tol(tol: number): WasmStructureMatcher
  with_angle_tol(tol: number): WasmStructureMatcher
  with_primitive_cell(val: boolean): WasmStructureMatcher
  with_scale(val: boolean): WasmStructureMatcher
  with_element_comparator(val: boolean): WasmStructureMatcher
  fit(struct1: unknown, struct2: unknown): unknown
  fit_anonymous(struct1: unknown, struct2: unknown): unknown
  get_rms_dist(struct1: unknown, struct2: unknown): unknown
  deduplicate(structures: unknown[]): unknown
  find_matches(new_structures: unknown[], existing: unknown[]): unknown
}

// Init loads pkg/ferrox.js, initializes WASM, and returns the module
export default function init(
  options?: { module_or_path?: string | URL },
): Promise<WasmModule>
