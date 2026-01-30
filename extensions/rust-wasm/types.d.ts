// Type definitions for @matterviz/wasm
// Comprehensive types for ferrox WASM bindings

// =============================================================================
// Result Types
// =============================================================================

// All WASM functions return WasmResult<T> = { ok: T } | { error: string }
export type WasmResult<T> = { ok: T } | { error: string }

// =============================================================================
// Structure Types (pymatgen-compatible)
// =============================================================================

export interface Crystal {
  lattice: Lattice
  sites: Site[]
  properties?: Record<string, unknown>
}

export interface Lattice {
  matrix: [[number, number, number], [number, number, number], [number, number, number]]
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
  pbc: [boolean, boolean, boolean]
  volume: number
}

export interface Site {
  species: SpeciesOccupancy[]
  abc: [number, number, number]
  xyz: [number, number, number]
  label: string
  properties: Record<string, unknown>
}

export interface SpeciesOccupancy {
  element: string
  occu: number
  oxidation_state?: number
}

// =============================================================================
// Neighbor List Result
// =============================================================================

export interface NeighborListResult {
  center_indices: number[]
  neighbor_indices: number[]
  image_offsets: [number, number, number][]
  distances: number[]
}

// =============================================================================
// RMS Distance Result
// =============================================================================

export interface RmsDistResult {
  rms: number
  max_dist: number
}

// =============================================================================
// WasmStructureMatcher Class
// =============================================================================

export class WasmStructureMatcher {
  constructor()
  with_latt_len_tol(tol: number): WasmStructureMatcher
  with_site_pos_tol(tol: number): WasmStructureMatcher
  with_angle_tol(tol: number): WasmStructureMatcher
  with_primitive_cell(val: boolean): WasmStructureMatcher
  with_scale(val: boolean): WasmStructureMatcher
  with_element_comparator(val: boolean): WasmStructureMatcher
  fit(struct1: Crystal, struct2: Crystal): WasmResult<boolean>
  fit_anonymous(struct1: Crystal, struct2: Crystal): WasmResult<boolean>
  get_rms_dist(struct1: Crystal, struct2: Crystal): WasmResult<RmsDistResult | null>
  deduplicate(structures: Crystal[]): WasmResult<number[]>
  find_matches(
    new_structures: Crystal[],
    existing: Crystal[],
  ): WasmResult<(number | null)[]>
}

// =============================================================================
// Element Class
// =============================================================================

export class JsElement {
  constructor(symbol: string)
  static fromAtomicNumber(z: number): JsElement
  readonly symbol: string
  readonly atomicNumber: number
  readonly name: string
  readonly atomicMass: number
  readonly electronegativity: number
  readonly row: number
  readonly group: number
  readonly block: string
  readonly atomicRadius: number
  readonly covalentRadius: number
  readonly maxOxidationState: number
  readonly minOxidationState: number
  isNobleGas(): boolean
  isAlkali(): boolean
  isAlkaline(): boolean
  isHalogen(): boolean
  isChalcogen(): boolean
  isLanthanoid(): boolean
  isActinoid(): boolean
  isTransitionMetal(): boolean
  isPostTransitionMetal(): boolean
  isMetalloid(): boolean
  isMetal(): boolean
  isRadioactive(): boolean
  isRareEarth(): boolean
  isPseudo(): boolean
  oxidationStates(): number[]
  commonOxidationStates(): number[]
  icsdOxidationStates(): number[]
  ionicRadius(oxidation_state: number): number
  shannonIonicRadius(oxidation_state: number, coordination: string, spin: string): number
}

// =============================================================================
// Species Class
// =============================================================================

export class JsSpecies {
  constructor(species_str: string)
  readonly symbol: string
  readonly atomicNumber: number
  readonly oxidationState: number | undefined
  readonly ionicRadius: number
  readonly atomicRadius: number
  readonly electronegativity: number
  readonly covalentRadius: number
  readonly name: string
  toString(): string
  shannonIonicRadius(coordination: string, spin: string): number
}

// =============================================================================
// Structure Parsing Functions
// =============================================================================

export function parse_structure(input: unknown): WasmResult<Crystal>
export function parse_cif(content: string): WasmResult<Crystal>
export function parse_poscar(content: string): WasmResult<Crystal>

// =============================================================================
// Supercell Functions
// =============================================================================

export function make_supercell_diag(
  structure: Crystal,
  nx: number,
  ny: number,
  nz: number,
): WasmResult<Crystal>

export function make_supercell(
  structure: Crystal,
  matrix: [[number, number, number], [number, number, number], [number, number, number]],
): WasmResult<Crystal>

// =============================================================================
// Lattice Reduction Functions
// =============================================================================

export function get_reduced_structure(
  structure: Crystal,
  algo: 'niggli' | 'lll',
): WasmResult<Crystal>

export function get_primitive(structure: Crystal, symprec: number): WasmResult<Crystal>

export function get_spacegroup_number(
  structure: Crystal,
  symprec: number,
): WasmResult<number>

export function structure_to_json(structure: Crystal): WasmResult<string>

// =============================================================================
// Physical Property Functions
// =============================================================================

export function get_volume(structure: Crystal): WasmResult<number>
export function get_total_mass(structure: Crystal): WasmResult<number>
export function get_density(structure: Crystal): WasmResult<number>

// =============================================================================
// Neighbor Finding Functions
// =============================================================================

export function get_neighbor_list(
  structure: Crystal,
  r: number,
  numerical_tol: number,
  exclude_self: boolean,
): WasmResult<NeighborListResult>

export function get_distance(structure: Crystal, i: number, j: number): WasmResult<number>

export function get_distance_matrix(structure: Crystal): WasmResult<number[][]>

// =============================================================================
// Sorting Functions
// =============================================================================

export function get_sorted_structure(
  structure: Crystal,
  reverse: boolean,
): WasmResult<Crystal>

export function get_sorted_by_electronegativity(
  structure: Crystal,
  reverse: boolean,
): WasmResult<Crystal>

// =============================================================================
// Interpolation Functions
// =============================================================================

export function interpolate_structures(
  start: Crystal,
  end: Crystal,
  n_images: number,
  interpolate_lattices: boolean,
  use_pbc: boolean,
): WasmResult<Crystal[]>

// =============================================================================
// Copy and Wrap Functions
// =============================================================================

export function copy_structure(structure: Crystal, sanitize: boolean): WasmResult<Crystal>

export function wrap_to_unit_cell(structure: Crystal): WasmResult<Crystal>

// =============================================================================
// Site Manipulation Functions
// =============================================================================

export function translate_sites(
  structure: Crystal,
  indices: number[],
  vector: [number, number, number],
  fractional: boolean,
): WasmResult<Crystal>

export function perturb_structure(
  structure: Crystal,
  distance: number,
  min_distance?: number | null,
  seed?: bigint | null,
): WasmResult<Crystal>

// =============================================================================
// Element Information Functions
// =============================================================================

export function get_atomic_mass(symbol: string): WasmResult<number>
export function get_electronegativity(symbol: string): WasmResult<number>

// =============================================================================
// WASM Module Interface
// =============================================================================

export interface WasmModule {
  // Default init function
  default: (options?: { module_or_path?: string | URL }) => Promise<void>

  // Classes
  WasmStructureMatcher: typeof WasmStructureMatcher
  JsElement: typeof JsElement
  JsSpecies: typeof JsSpecies

  // Structure parsing
  parse_structure: typeof parse_structure
  parse_cif: typeof parse_cif
  parse_poscar: typeof parse_poscar

  // Supercell
  make_supercell_diag: typeof make_supercell_diag
  make_supercell: typeof make_supercell

  // Lattice reduction
  get_reduced_structure: typeof get_reduced_structure
  get_primitive: typeof get_primitive
  get_spacegroup_number: typeof get_spacegroup_number
  structure_to_json: typeof structure_to_json

  // Physical properties
  get_volume: typeof get_volume
  get_total_mass: typeof get_total_mass
  get_density: typeof get_density

  // Neighbor finding
  get_neighbor_list: typeof get_neighbor_list
  get_distance: typeof get_distance
  get_distance_matrix: typeof get_distance_matrix

  // Sorting
  get_sorted_structure: typeof get_sorted_structure
  get_sorted_by_electronegativity: typeof get_sorted_by_electronegativity

  // Interpolation
  interpolate_structures: typeof interpolate_structures

  // Copy and wrap
  copy_structure: typeof copy_structure
  wrap_to_unit_cell: typeof wrap_to_unit_cell

  // Site manipulation
  translate_sites: typeof translate_sites
  perturb_structure: typeof perturb_structure

  // Element info
  get_atomic_mass: typeof get_atomic_mass
  get_electronegativity: typeof get_electronegativity
}

// =============================================================================
// Default Export (init function)
// =============================================================================

// Init loads pkg/ferrox.js, initializes WASM, and returns the module
declare const init: (options?: { module_or_path?: string | URL }) => Promise<WasmModule>
export default init
