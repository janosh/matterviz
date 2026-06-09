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

    // Handle density separately - prefer metadata, but calculate if not available
    if (frame.metadata.density && typeof frame.metadata.density === `number`) {
      data.density = frame.metadata.density
    } else if (`lattice` in frame.structure) {
      try {
        data.density = get_density(frame.structure)
      } catch (error) {
        console.warn(`Failed to calculate density for frame ${frame.step}:`, error)
      }
    }

    // Only use metadata volume if lattice volume is not available
    if (!data.volume && frame.metadata.volume && typeof frame.metadata.volume === `number`) {
      data.volume = frame.metadata.volume
    }

    // Note: pressure is handled by force_stress_data_extractor to avoid duplication
  } else if (`lattice` in frame.structure) {
    // Calculate density even when no metadata is available
    try {
      data.density = get_density(frame.structure)
    } catch (error) {
      console.warn(`Failed to calculate density for frame ${frame.step}:`, error)
    }
  }

  return data
}

// Helper function to check if a property varies across trajectory frames
function property_varies(
  trajectory: TrajectoryType,
  property_key: string,
  tolerance = 1e-10,
): boolean {
  if (trajectory.frames.length <= 1) return false

  const values: number[] = []
  for (const frame of trajectory.frames) {
    // Check both direct structure properties and metadata
    let value: number | undefined

    if (`lattice` in frame.structure) {
      const lattice_value = (frame.structure.lattice as Record<string, unknown>)[property_key]
      if (typeof lattice_value === `number`) value = lattice_value
    }

    if (value === undefined && frame.metadata && property_key in frame.metadata) {
      const metadata_value = frame.metadata[property_key]
      if (typeof metadata_value === `number`) {
        value = metadata_value
      }
    }

    if (value !== undefined) {
      values.push(value)
    }
  }

  if (values.length <= 1) return false

  const first_value = values[0]
  return values.some((value) => Math.abs(value - first_value) > tolerance)
}

// Combined data extractor that extracts all common properties
export const full_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
  trajectory: TrajectoryType,
): Record<string, number> => {
  const base_data = {
    ...energy_data_extractor(frame, trajectory),
    ...force_stress_data_extractor(frame, trajectory),
    ...structural_data_extractor(frame, trajectory),
  }

  // Check which lattice parameters vary
  const lattice_params = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`]
  const result = { ...base_data }

  // Add metadata to specify which properties don't vary
  for (const param of lattice_params) {
    if (!property_varies(trajectory, param)) {
      // Mark individual lattice parameters as constant
      result[`constant_${param}`] = 1
    }
  }

  return result
}
