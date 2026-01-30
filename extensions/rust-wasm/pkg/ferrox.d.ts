// Stub type definitions - overwritten when WASM is built

export default function init(options?: { module_or_path?: string | URL }): Promise<void>

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

export function parse_structure(input: unknown): unknown
export function parse_cif(content: string): unknown
export function parse_poscar(content: string): unknown
export function make_supercell_diag(
  structure: unknown,
  nx: number,
  ny: number,
  nz: number,
): unknown
export function make_supercell(structure: unknown, matrix: number[][]): unknown
export function get_reduced_structure(structure: unknown, algo: string): unknown
export function get_primitive(structure: unknown, symprec: number): unknown
export function get_spacegroup_number(structure: unknown, symprec: number): unknown
export function structure_to_json(structure: unknown): unknown
export function get_volume(structure: unknown): unknown
export function get_total_mass(structure: unknown): unknown
export function get_density(structure: unknown): unknown
export function get_neighbor_list(
  structure: unknown,
  r: number,
  exclude_self: boolean,
): unknown
export function get_distance(structure: unknown, i: number, j: number): unknown
export function get_distance_matrix(structure: unknown): unknown
export function get_sorted_structure(structure: unknown, reverse: boolean): unknown
export function get_sorted_by_electronegativity(
  structure: unknown,
  reverse: boolean,
): unknown
export function interpolate_structures(
  start: unknown,
  end: unknown,
  n_images: number,
  interpolate_lattices: boolean,
  use_pbc: boolean,
): unknown
export function copy_structure(structure: unknown, sanitize: boolean): unknown
export function wrap_to_unit_cell(structure: unknown): unknown
export function translate_sites(
  structure: unknown,
  indices: number[],
  vector: number[],
  frac_coords: boolean,
): unknown
export function perturb_structure(
  structure: unknown,
  distance: number,
  min_distance?: number,
  seed?: number,
): unknown
export function get_atomic_mass(symbol: string): unknown
export function get_electronegativity(symbol: string): unknown
