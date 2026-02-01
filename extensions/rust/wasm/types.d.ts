// Type declarations for matterviz-wasm
// Uses Crystal type from matterviz as single source of truth for structure types

export * from './pkg/ferrox.d.ts'
export type { Crystal } from 'matterviz'

import type { Crystal } from 'matterviz'
import type { InitInput } from './pkg/ferrox.d.ts'
import type {
  JsLocalEnvironment,
  JsNeighborList,
  JsReductionAlgo,
  JsStructureMetadata,
  JsSymmetryDataset,
  JsSymmetryOperation,
  WasmResult,
} from './pkg/ferrox.d.ts'
import * as ferrox from './pkg/ferrox.d.ts'

// The module returned by init() has all exports from pkg/ferrox.js
export type FerroxModule = typeof ferrox

export default function init(
  options?:
    | { module_or_path?: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>,
): Promise<FerroxModule>

// Structure parsing
export function parse_cif(content: string): WasmResult<Crystal>
export function parse_poscar(content: string): WasmResult<Crystal>

// Supercell functions
export function make_supercell_diag(
  structure: Crystal,
  scale_a: number,
  scale_b: number,
  scale_c: number,
): WasmResult<Crystal>
export function make_supercell(
  structure: Crystal,
  matrix: [[number, number, number], [number, number, number], [number, number, number]],
): WasmResult<Crystal>

// Lattice reduction
export function get_reduced_structure(
  structure: Crystal,
  algo: JsReductionAlgo,
): WasmResult<Crystal>
export function get_primitive(
  structure: Crystal,
  symprec: number,
): WasmResult<Crystal>
export function get_conventional(
  structure: Crystal,
  symprec: number,
): WasmResult<Crystal>

// Symmetry analysis
export function get_spacegroup_number(
  structure: Crystal,
  symprec: number,
): WasmResult<number>
export function get_spacegroup_symbol(
  structure: Crystal,
  symprec: number,
): WasmResult<string>
export function get_crystal_system(
  structure: Crystal,
  symprec: number,
): WasmResult<string>
export function get_wyckoff_letters(
  structure: Crystal,
  symprec: number,
): WasmResult<string[]>
export function get_symmetry_operations(
  structure: Crystal,
  symprec: number,
): WasmResult<JsSymmetryOperation[]>
export function get_symmetry_dataset(
  structure: Crystal,
  symprec: number,
): WasmResult<JsSymmetryDataset>

// Physical properties
export function get_volume(structure: Crystal): WasmResult<number>
export function get_total_mass(structure: Crystal): WasmResult<number>
export function get_density(structure: Crystal): WasmResult<number>
export function get_structure_metadata(
  structure: Crystal,
): WasmResult<JsStructureMetadata>

// Neighbor finding
export function get_neighbor_list(
  structure: Crystal,
  cutoff_radius: number,
  numerical_tol: number,
  exclude_self: boolean,
): WasmResult<JsNeighborList>
export function get_distance(
  structure: Crystal,
  site_idx_1: number,
  site_idx_2: number,
): WasmResult<number>
export function get_distance_matrix(structure: Crystal): WasmResult<number[][]>

// Coordination analysis
export function get_coordination_numbers(
  structure: Crystal,
  cutoff: number,
): WasmResult<number[]>
export function get_coordination_number(
  structure: Crystal,
  site_index: number,
  cutoff: number,
): WasmResult<number>
export function get_local_environment(
  structure: Crystal,
  site_index: number,
  cutoff: number,
): WasmResult<JsLocalEnvironment>

// Sorting
export function get_sorted_structure(
  structure: Crystal,
  reverse: boolean,
): WasmResult<Crystal>
export function get_sorted_by_electronegativity(
  structure: Crystal,
  reverse: boolean,
): WasmResult<Crystal>

// Interpolation
export function interpolate_structures(
  start: Crystal,
  end: Crystal,
  n_images: number,
  interpolate_lattices: boolean,
  use_pbc: boolean,
): WasmResult<Crystal[]>

// Copy and wrap
export function copy_structure(
  structure: Crystal,
  sanitize: boolean,
): WasmResult<Crystal>
export function wrap_to_unit_cell(structure: Crystal): WasmResult<Crystal>

// Site manipulation
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

// Element info
export function get_atomic_mass(symbol: string): WasmResult<number>
export function get_electronegativity(symbol: string): WasmResult<number>

// Slab generation
export function make_slab(
  structure: Crystal,
  miller_index: [number, number, number],
  min_slab_size: number,
  min_vacuum_size: number,
  center_slab: boolean,
  in_unit_planes: boolean,
  primitive: boolean,
  symprec: number,
  termination_index?: number | null,
): WasmResult<Crystal>
export function generate_slabs(
  structure: Crystal,
  miller_index: [number, number, number],
  min_slab_size: number,
  min_vacuum_size: number,
  center_slab: boolean,
  in_unit_planes: boolean,
  primitive: boolean,
  symprec: number,
): WasmResult<Crystal[]>

// Transformations
export function apply_operation(
  structure: Crystal,
  rotation: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ],
  translation: [number, number, number],
  fractional: boolean,
): WasmResult<Crystal>
export function apply_inversion(
  structure: Crystal,
  fractional: boolean,
): WasmResult<Crystal>
export function substitute_species(
  structure: Crystal,
  old_species: string,
  new_species: string,
): WasmResult<Crystal>
export function remove_species(
  structure: Crystal,
  species: string[],
): WasmResult<Crystal>
export function remove_sites(
  structure: Crystal,
  indices: number[],
): WasmResult<Crystal>

// I/O
export function structure_to_json(structure: Crystal): WasmResult<string>
export function structure_to_cif(structure: Crystal): WasmResult<string>
export function structure_to_poscar(structure: Crystal): WasmResult<string>

// =============================================================================
// WasmStructureMatcher Method Return Types
// =============================================================================

declare module './pkg/ferrox.d.ts' {
  interface WasmStructureMatcher {
    fit(struct1: Crystal, struct2: Crystal): WasmResult<boolean>
    fit_anonymous(struct1: Crystal, struct2: Crystal): WasmResult<boolean>
    get_rms_dist(
      struct1: Crystal,
      struct2: Crystal,
    ): WasmResult<JsRmsDistResult | null>
    // Universal structure distance - always returns a value (never null)
    // Suitable for consistent ranking of structures by similarity
    get_structure_distance(
      struct1: Crystal,
      struct2: Crystal,
    ): WasmResult<number>
    deduplicate(structures: Crystal[]): WasmResult<number[]>
    find_matches(
      new_structures: Crystal[],
      existing: Crystal[],
    ): WasmResult<(number | null)[]>
  }
}
