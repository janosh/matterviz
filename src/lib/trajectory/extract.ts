// Data extraction functions for trajectory analysis and plotting
import { get_density } from '$lib/structure/index'
import { calc_force_stats, copy_numeric_fields } from './helpers'
import type { TrajectoryDataExtractor, TrajectoryFrame, TrajectoryType } from './index'

// Common data extractor that extracts energy and structural properties
export const energy_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = {
    Step: frame.step,
  }

  if (frame.metadata) {
    // Extract energy-related properties
    copy_numeric_fields(data, frame.metadata, [
      `energy`,
      `energy_per_atom`,
      `potential_energy`,
      `kinetic_energy`,
      `total_energy`,
    ])
  }

  return data
}

// Data extractor for forces and stresses
export const force_stress_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = {
    Step: frame.step,
  }

  if (frame.metadata) {
    // Calculate force properties from forces array if available (preferred)
    if (frame.metadata.forces && Array.isArray(frame.metadata.forces)) {
      // Object.assign ignores the null calc_force_stats returns for empty forces
      Object.assign(data, calc_force_stats(frame.metadata.forces as number[][]))
    } else {
      // Fallback to metadata values if forces array not available
      if (frame.metadata.force_max && typeof frame.metadata.force_max === `number`) {
        data.force_max = frame.metadata.force_max
      }
      // Prefer force_norm if available, fall back to force_rms
      if (frame.metadata.force_norm && typeof frame.metadata.force_norm === `number`) {
        data.force_norm = frame.metadata.force_norm
      } else if (frame.metadata.force_rms && typeof frame.metadata.force_rms === `number`) {
        data.force_norm = frame.metadata.force_rms // Use force_rms as fallback
      }
    }

    // Extract other stress and pressure properties (no duplicates expected)
    copy_numeric_fields(data, frame.metadata, [
      `stress_max`,
      `stress_frobenius`,
      `stress_trace`,
      `pressure`,
    ])
  }

  return data
}

// Data extractor for structural properties
export const structural_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = {
    Step: frame.step,
  }

  // Extract lattice properties (preferred source for volume)
  if (`lattice` in frame.structure) {
    const lattice = frame.structure.lattice
    data.volume = lattice.volume // Use consistent lowercase naming
    data.a = lattice.a
    data.b = lattice.b
    data.c = lattice.c
    data.alpha = lattice.alpha
    data.beta = lattice.beta
    data.gamma = lattice.gamma
  }

  if (frame.metadata) {
    // Extract other structural properties, avoiding volume duplicate
    copy_numeric_fields(data, frame.metadata, [`temperature`])

    // Prefer metadata density (fall back to calculating from structure below).
    // Finite-number check (not truthiness) so a legitimate density of 0 is kept.
    if (
      typeof frame.metadata.density === `number` &&
      Number.isFinite(frame.metadata.density)
    ) {
      data.density = frame.metadata.density
    }

    // Only use metadata volume if lattice volume is not available
    if (!data.volume && frame.metadata.volume && typeof frame.metadata.volume === `number`) {
      data.volume = frame.metadata.volume
    }

    // Note: pressure is handled by force_stress_data_extractor to avoid duplication
  }

  if (data.density === undefined && `lattice` in frame.structure) {
    try {
      data.density = get_density(frame.structure)
    } catch (error) {
      console.warn(`Failed to calculate density for frame ${frame.step}:`, error)
    }
  }

  return data
}

const LATTICE_PARAMS = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const

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
    const lattice =
      `lattice` in frame.structure
        ? (frame.structure.lattice as Record<string, unknown>)
        : null
    for (const param of LATTICE_PARAMS) {
      if (varies.has(param)) continue // already known to vary, skip

      const lattice_value = lattice?.[param]
      const value = typeof lattice_value === `number` ? lattice_value : frame.metadata?.[param]
      if (typeof value !== `number`) continue

      const first = first_values.get(param)
      if (first === undefined) first_values.set(param, value)
      else if (Math.abs(value - first) > tolerance) varies.add(param)
    }
  }

  // only params observed in ≥1 frame; a never-present param is not "constant"
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
    ...structural_data_extractor(frame, trajectory),
  }

  // Mark individual lattice parameters that don't vary across the trajectory
  for (const param of get_constant_lattice_params(trajectory)) {
    result[`constant_${param}`] = 1
  }

  return result
}
