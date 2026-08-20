// Data extraction functions for trajectory analysis and plotting
import { get_density } from '$lib/structure/index'
import { calc_force_stats, copy_numeric_fields } from './helpers'
import type { TrajectoryDataExtractor, TrajectoryFrame, TrajectoryType } from './index'

// Build an extractor that copies the listed numeric metadata fields (plus Step)
const make_metadata_extractor =
  (fields: readonly string[]): TrajectoryDataExtractor =>
  (frame: TrajectoryFrame): Record<string, number> => {
    const data: Record<string, number> = { Step: frame.step }
    if (frame.metadata) copy_numeric_fields(data, frame.metadata, fields)
    return data
  }

export const energy_data_extractor: TrajectoryDataExtractor = make_metadata_extractor([
  `energy`,
  `energy_per_atom`,
  `potential_energy`,
  `kinetic_energy`,
  `total_energy`,
])

// Force statistics from the per-atom forces array when present (preferred), else whatever
// scalar summaries the parser recorded. A relaxed structure legitimately has force_max 0.
export const force_stress_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = { Step: frame.step }
  const { metadata } = frame
  if (!metadata) return data
  if (Array.isArray(metadata.forces)) {
    // Object.assign ignores the null calc_force_stats returns for empty forces
    Object.assign(data, calc_force_stats(metadata.forces as number[][]))
  } else copy_numeric_fields(data, metadata, [`force_max`, `force_norm`])
  // pressure lives here, not in structural_data_extractor, so full_data_extractor gets it once
  copy_numeric_fields(data, metadata, [
    `stress_max`,
    `stress_frobenius`,
    `stress_trace`,
    `pressure`,
  ])
  return data
}

// SCF/electronic-convergence properties, emitted per frame by e.g. the vaspout.h5 parser
const scf_data_extractor: TrajectoryDataExtractor = make_metadata_extractor([
  `n_scf_steps`,
  `scf_energy_delta`,
  `scf_rms`,
  `scf_charge_rms`,
])

const LATTICE_PARAMS = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const

export const structural_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = { Step: frame.step }
  const { metadata, structure } = frame
  const lattice = `lattice` in structure ? structure.lattice : null
  if (lattice) {
    data.volume = lattice.volume
    for (const param of LATTICE_PARAMS) data[param] = lattice[param]
  }
  if (metadata) {
    copy_numeric_fields(data, metadata, [`temperature`])
    // Finite-number check (not truthiness) so a legitimate density of 0 is kept
    if (typeof metadata.density === `number` && Number.isFinite(metadata.density)) {
      data.density = metadata.density
    }
    if (!lattice) copy_numeric_fields(data, metadata, [`volume`])
  }
  if (data.density === undefined && `lattice` in structure) {
    try {
      data.density = get_density(structure)
    } catch (error) {
      console.warn(`Failed to calculate density for frame ${frame.step}:`, error)
    }
  }
  return data
}

// Cache per trajectory: full_data_extractor runs once per frame, so without this it
// rescans all frames on every call (O(n²)). WeakMap → GC'd with the trajectory.
const constant_params_cache = new WeakMap<TrajectoryType, Set<string>>()

// Lattice params constant across the trajectory, in a single pass (prefer lattice value,
// else metadata; tol 1e-10). A param must be observed in ≥1 frame to count as constant;
// params absent from every frame are excluded (not silently treated as "constant").
function get_constant_lattice_params(trajectory: TrajectoryType): Set<string> {
  const cached = constant_params_cache.get(trajectory)
  if (cached) return cached

  const tolerance = 1e-10
  const first_values = new Map<string, number>()
  const varies = new Set<string>()

  for (const frame of trajectory.frames) {
    const lattice = `lattice` in frame.structure ? frame.structure.lattice : null
    for (const param of LATTICE_PARAMS) {
      if (varies.has(param)) continue
      const value = lattice ? lattice[param] : frame.metadata?.[param]
      // Number.isFinite: NaN is typeof `number` but Math.abs(next-NaN)=NaN → false constant
      if (typeof value !== `number` || !Number.isFinite(value)) continue
      const first = first_values.get(param)
      if (first === undefined) first_values.set(param, value)
      else if (Math.abs(value - first) > tolerance) varies.add(param)
    }
  }

  const constant = new Set([...first_values.keys()].filter((param) => !varies.has(param)))
  constant_params_cache.set(trajectory, constant)
  return constant
}

// Combined data extractor that extracts all common properties
export const full_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
  trajectory: TrajectoryType,
): Record<string, number> => {
  const result: Record<string, number> = {
    ...energy_data_extractor(frame, trajectory),
    ...force_stress_data_extractor(frame, trajectory),
    ...scf_data_extractor(frame, trajectory),
    ...structural_data_extractor(frame, trajectory),
  }
  // Mark individual lattice parameters that don't vary across the trajectory
  for (const param of get_constant_lattice_params(trajectory)) result[`constant_${param}`] = 1
  return result
}
