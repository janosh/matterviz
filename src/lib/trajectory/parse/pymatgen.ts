// Pymatgen Trajectory JSON parsing
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  calc_force_stats,
  create_trajectory_frame,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type { TrajectoryType } from '$lib/trajectory/index'
import { traj_warn } from './diagnostics'

// Parse an already-JSON-parsed pymatgen Trajectory object
// (detected via @class === 'Trajectory' with species/coords/lattice present)
export function parse_pymatgen_trajectory(
  obj: Record<string, unknown>,
  filename?: string,
): TrajectoryType {
  const species = obj.species as { element: ElementSymbol }[]
  const frame_elements = species.map((specie) => specie.element)
  const coords = obj.coords as number[][][]
  const matrix = validate_3x3_matrix(obj.lattice)
  const frame_properties = (obj.frame_properties as Record<string, unknown>[]) || []
  const frac_to_cart = math.create_frac_to_cart(matrix)

  const frames = coords.map((frame_coords, idx) => {
    const positions = frame_coords.map((abc) => frac_to_cart(abc as Vec3))

    // Process frame properties to extract numpy arrays
    const raw_properties = frame_properties[idx] || {}
    const processed_properties: Record<string, unknown> = {}

    Object.entries(raw_properties).forEach(([key, value]) => {
      if (
        value &&
        typeof value === `object` &&
        (value as Record<string, unknown>)[`@class`] === `array`
      ) {
        // Extract numpy array data
        const array_obj = value as Record<string, unknown>
        processed_properties[key] = array_obj.data

        // Calculate force statistics for forces
        if (key === `forces` && Array.isArray(array_obj.data)) {
          // Object.assign ignores the null calc_force_stats returns for empty forces
          Object.assign(processed_properties, calc_force_stats(array_obj.data as number[][]))
        }

        // Calculate stress statistics for stress tensor
        if (key === `stress` && Array.isArray(array_obj.data)) {
          const stress_tensor = array_obj.data
          if (!math.is_square_matrix(stress_tensor, 3)) {
            traj_warn(`Invalid stress tensor structure in frame ${idx}`)
          } else {
            // Calculate stress components (diagonal elements represent normal stresses)
            const normal_stresses = [
              stress_tensor[0][0],
              stress_tensor[1][1],
              stress_tensor[2][2],
            ]
            processed_properties.stress_max = Math.max(...normal_stresses.map(Math.abs))
            // Calculate hydrostatic pressure (negative of mean normal stress)
            processed_properties.pressure =
              -(normal_stresses[0] + normal_stresses[1] + normal_stresses[2]) / 3
          }
        }
      } else {
        processed_properties[key] = value
      }
    })

    return create_trajectory_frame(
      positions,
      frame_elements,
      matrix,
      [true, true, true],
      idx,
      processed_properties,
    )
  })

  const metadata = {
    filename,
    source_format: `pymatgen_trajectory`,
    frame_count: frames.length,
    species_list: [...new Set(species.map((specie) => specie.element))],
    periodic_boundary_conditions: [true, true, true],
  }
  return { frames, metadata }
}
