// Type augmentation for @matterviz/wasm
// Auto-generated types in pkg/ferrox.d.ts provide input types,
// this file provides return type information

// Re-export all types from auto-generated file
export * from './pkg/ferrox.d.ts'

// Import types for augmentation
import type {
  JsCrystal,
  JsLocalEnvironment,
  JsNeighborList,
  JsReductionAlgo,
  JsRmsDistResult,
  JsStructureMetadata,
  JsSymmetryDataset,
  JsSymmetryOperation,
  WasmResult,
} from './pkg/ferrox.d.ts'

// =============================================================================
// Function Return Type Declarations
// These augment the auto-generated types with precise return types
// =============================================================================

// Structure parsing
export function parse_cif(content: string): WasmResult<JsCrystal>
export function parse_poscar(content: string): WasmResult<JsCrystal>

// Supercell functions
export function make_supercell_diag(
  structure: JsCrystal,
  nx: number,
  ny: number,
  nz: number,
): WasmResult<JsCrystal>
export function make_supercell(
  structure: JsCrystal,
  matrix: [[number, number, number], [number, number, number], [number, number, number]],
): WasmResult<JsCrystal>

// Lattice reduction
export function get_reduced_structure(
  structure: JsCrystal,
  algo: JsReductionAlgo,
): WasmResult<JsCrystal>
export function get_primitive(
  structure: JsCrystal,
  symprec: number,
): WasmResult<JsCrystal>
export function get_conventional(
  structure: JsCrystal,
  symprec: number,
): WasmResult<JsCrystal>

// Symmetry analysis
export function get_spacegroup_number(
  structure: JsCrystal,
  symprec: number,
): WasmResult<number>
export function get_spacegroup_symbol(
  structure: JsCrystal,
  symprec: number,
): WasmResult<string>
export function get_crystal_system(
  structure: JsCrystal,
  symprec: number,
): WasmResult<string>
export function get_wyckoff_letters(
  structure: JsCrystal,
  symprec: number,
): WasmResult<string[]>
export function get_symmetry_operations(
  structure: JsCrystal,
  symprec: number,
): WasmResult<JsSymmetryOperation[]>
export function get_symmetry_dataset(
  structure: JsCrystal,
  symprec: number,
): WasmResult<JsSymmetryDataset>

// Physical properties
export function get_volume(structure: JsCrystal): WasmResult<number>
export function get_total_mass(structure: JsCrystal): WasmResult<number>
export function get_density(structure: JsCrystal): WasmResult<number>
export function get_structure_metadata(
  structure: JsCrystal,
): WasmResult<JsStructureMetadata>

// Neighbor finding
export function get_neighbor_list(
  structure: JsCrystal,
  r: number,
  numerical_tol: number,
  exclude_self: boolean,
): WasmResult<JsNeighborList>
export function get_distance(
  structure: JsCrystal,
  i: number,
  j: number,
): WasmResult<number>
export function get_distance_matrix(structure: JsCrystal): WasmResult<number[][]>

// Coordination analysis
export function get_coordination_numbers(
  structure: JsCrystal,
  cutoff: number,
): WasmResult<number[]>
export function get_coordination_number(
  structure: JsCrystal,
  site_index: number,
  cutoff: number,
): WasmResult<number>
export function get_local_environment(
  structure: JsCrystal,
  site_index: number,
  cutoff: number,
): WasmResult<JsLocalEnvironment>

// Sorting
export function get_sorted_structure(
  structure: JsCrystal,
  reverse: boolean,
): WasmResult<JsCrystal>
export function get_sorted_by_electronegativity(
  structure: JsCrystal,
  reverse: boolean,
): WasmResult<JsCrystal>

// Interpolation
export function interpolate_structures(
  start: JsCrystal,
  end: JsCrystal,
  n_images: number,
  interpolate_lattices: boolean,
  use_pbc: boolean,
): WasmResult<JsCrystal[]>

// Copy and wrap
export function copy_structure(
  structure: JsCrystal,
  sanitize: boolean,
): WasmResult<JsCrystal>
export function wrap_to_unit_cell(structure: JsCrystal): WasmResult<JsCrystal>

// Site manipulation
export function translate_sites(
  structure: JsCrystal,
  indices: number[],
  vector: [number, number, number],
  fractional: boolean,
): WasmResult<JsCrystal>
export function perturb_structure(
  structure: JsCrystal,
  distance: number,
  min_distance?: number | null,
  seed?: bigint | null,
): WasmResult<JsCrystal>

// Element info
export function get_atomic_mass(symbol: string): WasmResult<number>
export function get_electronegativity(symbol: string): WasmResult<number>

// Slab generation
export function make_slab(
  structure: JsCrystal,
  miller_index: [number, number, number],
  min_slab_size: number,
  min_vacuum_size: number,
  center_slab: boolean,
  in_unit_planes: boolean,
  primitive: boolean,
  symprec: number,
  termination_index?: number | null,
): WasmResult<JsCrystal>
export function generate_slabs(
  structure: JsCrystal,
  miller_index: [number, number, number],
  min_slab_size: number,
  min_vacuum_size: number,
  center_slab: boolean,
  in_unit_planes: boolean,
  primitive: boolean,
  symprec: number,
): WasmResult<JsCrystal[]>

// Transformations
export function apply_operation(
  structure: JsCrystal,
  rotation: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  translation: [number, number, number],
  fractional: boolean,
): WasmResult<JsCrystal>
export function apply_inversion(
  structure: JsCrystal,
  fractional: boolean,
): WasmResult<JsCrystal>
export function substitute_species(
  structure: JsCrystal,
  old_species: string,
  new_species: string,
): WasmResult<JsCrystal>
export function remove_species(
  structure: JsCrystal,
  species: string,
): WasmResult<JsCrystal>
export function remove_sites(
  structure: JsCrystal,
  indices: number[],
): WasmResult<JsCrystal>

// I/O
export function structure_to_json(structure: JsCrystal): WasmResult<string>
export function structure_to_cif(structure: JsCrystal): WasmResult<string>
export function structure_to_poscar(structure: JsCrystal): WasmResult<string>

// =============================================================================
// WasmStructureMatcher Method Return Types
// =============================================================================

declare module './pkg/ferrox.d.ts' {
  interface WasmStructureMatcher {
    fit(struct1: JsCrystal, struct2: JsCrystal): WasmResult<boolean>
    fit_anonymous(struct1: JsCrystal, struct2: JsCrystal): WasmResult<boolean>
    get_rms_dist(
      struct1: JsCrystal,
      struct2: JsCrystal,
    ): WasmResult<JsRmsDistResult | null>
    deduplicate(structures: JsCrystal[]): WasmResult<number[]>
    find_matches(
      new_structures: JsCrystal[],
      existing: JsCrystal[],
    ): WasmResult<(number | null)[]>
  }
}
