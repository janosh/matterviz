// Pymatgen Trajectory JSON parsing
import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { matrix3x3_from_rows } from '$lib/structure/parsers/shared'
import { calc_force_stats, create_trajectory_frame } from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { is_plain_object } from '$lib/utils'
import type { ParsedTrajectory, WarnFn } from './shared'

// Non-empty array of pymatgen Species-like objects with non-empty string element
// symbols (predicate so callers get narrowing; rejects e.g. { element: null })
const is_species_array = (val: unknown): val is { element: ElementSymbol }[] =>
  Array.isArray(val) &&
  val.length > 0 &&
  val.every(
    (sp) =>
      sp != null &&
      typeof sp === `object` &&
      `element` in sp &&
      typeof sp.element === `string` &&
      sp.element.trim().length > 0,
  )

const frac_coords_of = (value: unknown, frame_idx: number, n_sites: number): Vec3[] => {
  if (!Array.isArray(value) || value.length !== n_sites) {
    throw new Error(
      `Invalid pymatgen Trajectory: coords[${frame_idx}] has ${Array.isArray(value) ? value.length : `no`} sites, expected ${n_sites}`,
    )
  }
  return value.map((abc, site_idx) => {
    if (!math.is_finite_vec3_like(abc)) {
      throw new Error(
        `Invalid pymatgen Trajectory: coords[${frame_idx}][${site_idx}] is not a finite 3-vector`,
      )
    }
    return [abc[0], abc[1], abc[2]] as Vec3
  })
}

// Parse an already-JSON-parsed pymatgen Trajectory object (detected via @class === 'Trajectory' with species/coords/lattice present)
export function parse_pymatgen_trajectory(
  obj: Record<string, unknown>,
  warn: WarnFn,
): ParsedTrajectory {
  // Validate shape upfront so malformed input fails with a clear message
  // (callers gate only on truthiness, not structure) rather than a cryptic `.map` error
  if (!is_species_array(obj.species)) {
    throw new TypeError(
      `Invalid pymatgen Trajectory: 'species' must be a non-empty array of { element } objects`,
    )
  }
  if (!Array.isArray(obj.coords)) {
    throw new TypeError(`Invalid pymatgen Trajectory: 'coords' must be an array of frames`)
  }
  const frame_elements = obj.species.map((specie) => specie.element)
  const n_sites = frame_elements.length
  const n_frames = obj.coords.length
  // `lattice` is one 3x3 matrix when constant_lattice is true, else a [n_frames, 3, 3] stack
  const { lattice } = obj
  const per_frame_lattice =
    Array.isArray(lattice) && Array.isArray(lattice[0]) && Array.isArray(lattice[0][0])
  if (per_frame_lattice && lattice.length !== n_frames) {
    throw new Error(
      `Invalid pymatgen Trajectory: 'lattice' holds ${lattice.length} matrices for ${n_frames} frames`,
    )
  }
  const lattices: Matrix3x3[] = per_frame_lattice
    ? lattice.map((matrix) => matrix3x3_from_rows(matrix, `lattice matrix`))
    : Array(n_frames).fill(matrix3x3_from_rows(lattice, `lattice matrix`))
  const frame_properties = Array.isArray(obj.frame_properties)
    ? (obj.frame_properties as Record<string, unknown>[])
    : []
  // site_properties: one {name: per-site values} dict per frame (a single dict applies to all)
  const site_property_frames: unknown[] = Array.isArray(obj.site_properties)
    ? obj.site_properties
    : is_plain_object(obj.site_properties)
      ? [obj.site_properties]
      : []
  const site_properties_for = (frame_idx: number): Record<string, unknown>[] | undefined => {
    const per_site = site_property_frames[site_property_frames.length === 1 ? 0 : frame_idx]
    if (!is_plain_object(per_site)) return undefined
    const bags = Array.from({ length: n_sites }, (): Record<string, unknown> => ({}))
    for (const [key, values] of Object.entries(per_site)) {
      if (!Array.isArray(values) || values.length !== n_sites) continue
      for (const [site_idx, value] of values.entries()) bags[site_idx][key] = value
    }
    return bags
  }

  // coords_are_displacement: coords[i] is the fractional displacement since frame i-1 and
  // positions[i] = base_positions + cumsum(coords[0..i]) (pymatgen Trajectory.to_positions)
  let cumulative: Vec3[] | null = null
  if (obj.coords_are_displacement === true) {
    cumulative = frac_coords_of(obj.base_positions, -1, n_sites)
  }

  const frames: TrajectoryFrame[] = obj.coords.map((frame_coords, idx) => {
    let frac_coords = frac_coords_of(frame_coords, idx, n_sites)
    if (cumulative) {
      cumulative = cumulative.map(
        (base, site_idx) =>
          [
            base[0] + frac_coords[site_idx][0],
            base[1] + frac_coords[site_idx][1],
            base[2] + frac_coords[site_idx][2],
          ] as Vec3,
      )
      frac_coords = cumulative
    }
    const frac_to_cart = math.create_frac_to_cart(lattices[idx])
    const positions = frac_coords.map((abc) => frac_to_cart(abc))

    // Unwrap pymatgen's numpy-array wrappers ({"@class": "array", "data": [...]})
    const processed_properties: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(frame_properties[idx] ?? {})) {
      if (!(is_plain_object(value) && value[`@class`] === `array`)) {
        processed_properties[key] = value
        continue
      }
      processed_properties[key] = value.data
      if (key === `forces` && Array.isArray(value.data)) {
        // Object.assign ignores the null calc_force_stats returns for empty forces
        Object.assign(processed_properties, calc_force_stats(value.data as number[][]))
      }
      if (key === `stress` && Array.isArray(value.data)) {
        const stress_tensor = value.data
        if (!math.is_square_matrix(stress_tensor, 3)) {
          warn(`Invalid stress tensor structure in frame ${idx}`)
        } else {
          // Normal stresses are the diagonal; pressure is minus their mean
          const normal_stresses = stress_tensor.map((row, dim) => row[dim])
          processed_properties.stress_max = Math.max(...normal_stresses.map(Math.abs))
          processed_properties.pressure =
            -(normal_stresses[0] + normal_stresses[1] + normal_stresses[2]) / 3
        }
      }
    }

    return create_trajectory_frame(
      positions,
      frame_elements,
      lattices[idx],
      [true, true, true],
      idx,
      processed_properties,
      site_properties_for(idx),
      warn,
    )
  })

  // pymatgen records time_step in femtoseconds
  const time_step =
    typeof obj.time_step === `number` && obj.time_step > 0 ? obj.time_step : null
  return {
    format: `pymatgen-json`,
    frames,
    ...(time_step === null ? {} : { time_step: { value: time_step, unit: `fs` } }),
    metadata: {},
  }
}
