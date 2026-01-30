// Type definitions for @matterviz/ferrox-wasm
// These are hand-maintained and won't be overwritten by wasm-pack

export default function init(
  options?: { module_or_path?: string | URL },
): Promise<void>

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

export function parse_structure(input: unknown): Promise<unknown>
export function parse_cif(content: string): Promise<unknown>
export function parse_poscar(content: string): Promise<unknown>
export function make_supercell_diag(
  structure: unknown,
  nx: number,
  ny: number,
  nz: number,
): Promise<unknown>
export function make_supercell(
  structure: unknown,
  matrix: number[][],
): Promise<unknown>
export function get_reduced_structure(
  structure: unknown,
  algo: string,
): Promise<unknown>
export function get_primitive(
  structure: unknown,
  symprec: number,
): Promise<unknown>
export function get_spacegroup_number(
  structure: unknown,
  symprec: number,
): Promise<unknown>
export function structure_to_json(structure: unknown): Promise<unknown>
export function get_volume(structure: unknown): Promise<unknown>
export function get_total_mass(structure: unknown): Promise<unknown>
export function get_density(structure: unknown): Promise<unknown>
export function get_neighbor_list(
  structure: unknown,
  r: number,
  exclude_self: boolean,
): Promise<unknown>
export function get_distance(
  structure: unknown,
  i: number,
  j: number,
): Promise<unknown>
export function get_distance_matrix(structure: unknown): Promise<unknown>
export function get_sorted_structure(
  structure: unknown,
  reverse: boolean,
): Promise<unknown>
export function get_sorted_by_electronegativity(
  structure: unknown,
  reverse: boolean,
): Promise<unknown>
export function interpolate_structures(
  start: unknown,
  end: unknown,
  n_images: number,
  interpolate_lattices: boolean,
  use_pbc: boolean,
): Promise<unknown>
export function copy_structure(
  structure: unknown,
  sanitize: boolean,
): Promise<unknown>
export function wrap_to_unit_cell(structure: unknown): Promise<unknown>
export function translate_sites(
  structure: unknown,
  indices: number[],
  vector: number[],
  frac_coords: boolean,
): Promise<unknown>
export function perturb_structure(
  structure: unknown,
  distance: number,
  min_distance?: number,
  seed?: number,
): Promise<unknown>
export function get_atomic_mass(symbol: string): Promise<unknown>
export function get_electronegativity(symbol: string): Promise<unknown>
export function getModule(): Promise<unknown>
