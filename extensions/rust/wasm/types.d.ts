// Type declarations for matterviz-wasm
// Uses Crystal type from matterviz as single source of truth for structure types

export type { Crystal } from 'matterviz'
export * from './pkg/ferrox.d.ts'

import type { Crystal } from 'matterviz'
import type {
  InitInput,
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

// === Interatomic Potentials ===

export interface JsPotentialResult {
  energy: number
  forces: number[] // flat [Fx0, Fy0, Fz0, Fx1, Fy1, Fz1, ...]
  stress: [number, number, number, number, number, number] | null // Voigt: xx, yy, zz, yz, xz, xy
}

// Lennard-Jones: V(r) = 4ε[(σ/r)¹² - (σ/r)⁶]
export function compute_lennard_jones(
  positions: number[], // flat [x0, y0, z0, x1, y1, z1, ...]
  cell: number[] | null, // flat 9-element row-major cell matrix
  pbc_x: boolean,
  pbc_y: boolean,
  pbc_z: boolean,
  sigma: number, // Angstrom
  epsilon: number, // eV
  cutoff: number | null, // Angstrom
  compute_stress: boolean,
): WasmResult<JsPotentialResult>

// Morse: V(r) = D * (1 - exp(-α(r - r₀)))² - D
export function compute_morse(
  positions: number[],
  cell: number[] | null,
  pbc_x: boolean,
  pbc_y: boolean,
  pbc_z: boolean,
  d: number, // well depth in eV
  alpha: number, // 1/Angstrom
  r0: number, // equilibrium distance in Angstrom
  cutoff: number, // Angstrom
  compute_stress: boolean,
): WasmResult<JsPotentialResult>

// Soft Sphere: V(r) = ε(σ/r)^α
export function compute_soft_sphere(
  positions: number[],
  cell: number[] | null,
  pbc_x: boolean,
  pbc_y: boolean,
  pbc_z: boolean,
  sigma: number, // Angstrom
  epsilon: number, // eV
  alpha: number, // exponent
  cutoff: number, // Angstrom
  compute_stress: boolean,
): WasmResult<JsPotentialResult>

// Harmonic bonds: V = 0.5 * k * (r - r₀)²
export function compute_harmonic_bonds(
  positions: number[],
  bonds: number[], // flat [i0, j0, k0, r0_0, i1, j1, k1, r0_1, ...]
  cell: number[] | null,
  pbc_x: boolean,
  pbc_y: boolean,
  pbc_z: boolean,
  compute_stress: boolean,
): WasmResult<JsPotentialResult>

// Lennard-Jones forces only
export function compute_lennard_jones_forces(
  positions: number[],
  cell: number[] | null,
  pbc_x: boolean,
  pbc_y: boolean,
  pbc_z: boolean,
  sigma: number,
  epsilon: number,
  cutoff: number | null,
): WasmResult<number[]>

// === MD Integrators ===

// MD simulation state
export class JsMDState {
  constructor(positions: number[], masses: number[])
  get positions(): number[]
  set positions(positions: number[])
  get velocities(): number[]
  set velocities(velocities: number[])
  get forces(): number[]
  set forces(forces: number[])
  get masses(): number[]
  get num_atoms(): number
  init_velocities(temperature_k: number, seed?: bigint | null): void
  kinetic_energy(): number
  temperature(): number
  set_cell(cell: number[], pbc_x: boolean, pbc_y: boolean, pbc_z: boolean): void
}

// Velocity Verlet integrator functions
export function md_velocity_verlet_step(
  state: JsMDState,
  forces: number[],
  dt_fs: number,
): WasmResult<void>

export function md_velocity_verlet_finalize(
  state: JsMDState,
  new_forces: number[],
  dt_fs: number,
): WasmResult<void>

// Langevin dynamics integrator (NVT)
export class JsLangevinIntegrator {
  constructor(temperature_k: number, friction: number, dt: number, seed?: bigint | null)
  set_temperature(temperature_k: number): void
  set_friction(friction: number): void
  set_dt(dt: number): void
}

export function langevin_step_with_forces(
  integrator: JsLangevinIntegrator,
  state: JsMDState,
  forces: number[],
): WasmResult<void>

// === Thermostats ===

// Nose-Hoover chain thermostat (NVT)
export class JsNoseHooverChain {
  constructor(target_temp: number, tau: number, dt: number, n_dof: number)
  set_temperature(target_temp: number): void
}

export function nose_hoover_step_with_forces(
  thermostat: JsNoseHooverChain,
  state: JsMDState,
  forces: number[],
): WasmResult<void>

// Velocity rescaling thermostat (stochastic, canonical)
export class JsVelocityRescale {
  constructor(
    target_temp: number,
    tau: number,
    dt: number,
    n_dof: number,
    seed?: bigint | null,
  )
  set_temperature(target_temp: number): void
}

export function velocity_rescale_step_with_forces(
  thermostat: JsVelocityRescale,
  state: JsMDState,
  forces: number[],
): WasmResult<void>

// === NPT Ensemble ===

// NPT state with variable cell
export class JsNPTState {
  constructor(
    positions: number[],
    masses: number[],
    cell: number[],
    pbc_x: boolean,
    pbc_y: boolean,
    pbc_z: boolean,
  )
  get positions(): number[]
  get velocities(): number[]
  get cell(): number[]
  get num_atoms(): number
  volume(): number
  kinetic_energy(): number
  temperature(): number
}

// NPT integrator (Parrinello-Rahman barostat)
export class JsNPTIntegrator {
  constructor(
    temperature: number, // Kelvin
    pressure: number, // GPa
    tau_t: number, // thermostat time constant (fs)
    tau_p: number, // barostat time constant (fs)
    dt: number, // timestep (fs)
    n_atoms: number,
    total_mass: number, // amu
  )
  pressure(stress: number[]): WasmResult<number>
}

export function npt_step_with_forces_and_stress(
  integrator: JsNPTIntegrator,
  state: JsNPTState,
  forces: number[],
  stress: number[], // 9-element stress tensor (row-major)
): WasmResult<void>

// === FIRE Optimizer ===

// FIRE configuration
export class JsFireConfig {
  constructor()
  set_dt_start(dt_start: number): void
  set_dt_max(dt_max: number): void
  set_n_min(n_min: number): void
  set_max_step(max_step: number): void
}

// FIRE optimizer state
export class JsFireState {
  constructor(positions: number[], config?: JsFireConfig | null)
  get positions(): number[]
  get num_atoms(): number
  get dt(): number
  max_force(): number
  is_converged(fmax: number): boolean
}

export function fire_step_with_forces(
  state: JsFireState,
  forces: number[],
): WasmResult<void>

// FIRE optimizer with cell optimization
export class JsCellFireState {
  constructor(
    positions: number[],
    cell: number[],
    config?: JsFireConfig | null,
    cell_factor?: number | null,
  )
  get positions(): number[]
  get cell(): number[]
  get num_atoms(): number
  max_force(): number
  max_stress(): number
  is_converged(fmax: number, smax: number): boolean
}

export function cell_fire_step_with_forces_and_stress(
  state: JsCellFireState,
  forces: number[],
  stress: number[],
): WasmResult<void>

// === WasmStructureMatcher Method Return Types ===

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
