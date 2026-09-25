// Pymatgen Trajectory JSON parsing
import type { ElementSymbol } from '$lib/element/types'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { matrix3x3_from_rows } from '$lib/structure/parsers/shared'
import { calc_force_stats, create_trajectory_frame } from '$lib/trajectory/helpers'
import type { TrajectoryFrame } from '$lib/trajectory/index'
import { is_plain_object } from '$lib/utils'
import type { ParsedTrajectory, WarnFn } from './shared'

// Element symbol of one pymatgen species entry: an Element/Species dict, or the plain string
// `Trajectory(species=["Si", "O"], ...)` serializes to. Undefined for anything else (including
// a blank or null element), so the caller can reject the whole array with one message.
const species_symbol = (species: unknown): ElementSymbol | undefined => {
  const symbol = is_plain_object(species) ? species.element : species
  return typeof symbol === `string` && symbol.trim().length > 0
    ? (symbol as ElementSymbol)
    : undefined
}

// Replace every numpy array MontyEncoder wrote ({"@module": "numpy", "@class": "array",
// "data": [...]}) by its data, at any depth: base_positions, lattice, site and frame
// properties can each be one, and reading them one field at a time missed some.
const unwrap_numpy_arrays = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(unwrap_numpy_arrays)
  if (!is_plain_object(value)) return value
  if (value[`@class`] === `array` && `data` in value) return unwrap_numpy_arrays(value.data)
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, unwrap_numpy_arrays(entry)]),
  )
}

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

// Parse an already-JSON-parsed pymatgen Trajectory object (detected via @class === 'Trajectory'
// with species and coords present). A `Trajectory.from_molecules` dump has `lattice: null`
// and Cartesian coords; a periodic one fractional coords.
export function parse_pymatgen_trajectory(
  raw: Record<string, unknown>,
  warn: WarnFn,
): ParsedTrajectory {
  const obj = unwrap_numpy_arrays(raw) as Record<string, unknown>
  // Validate shape upfront so malformed input fails with a clear message
  // (callers gate only on truthiness, not structure) rather than a cryptic `.map` error
  const frame_elements = Array.isArray(obj.species) ? obj.species.map(species_symbol) : []
  if (frame_elements.length === 0 || frame_elements.includes(undefined)) {
    throw new TypeError(
      `Invalid pymatgen Trajectory: 'species' must be a non-empty array of element symbols or { element } objects`,
    )
  }
  const elements = frame_elements as ElementSymbol[]
  if (!Array.isArray(obj.coords)) {
    throw new TypeError(`Invalid pymatgen Trajectory: 'coords' must be an array of frames`)
  }
  const n_sites = elements.length
  const n_frames = obj.coords.length
  // `lattice` is one 3x3 matrix when constant_lattice is true, else a [n_frames, 3, 3] stack,
  // and null for a molecule trajectory
  const { lattice } = obj
  const per_frame_lattice =
    Array.isArray(lattice) && Array.isArray(lattice[0]) && Array.isArray(lattice[0][0])
  if (per_frame_lattice && lattice.length !== n_frames) {
    throw new Error(
      `Invalid pymatgen Trajectory: 'lattice' holds ${lattice.length} matrices for ${n_frames} frames`,
    )
  }
  const lattices: (Matrix3x3 | undefined)[] =
    lattice === null
      ? Array(n_frames).fill(undefined)
      : per_frame_lattice
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
  const site_properties_for = (
    frame_idx: number,
    forces: number[][] | null,
  ): Record<string, unknown>[] | undefined => {
    const per_site = site_property_frames[site_property_frames.length === 1 ? 0 : frame_idx]
    if (!is_plain_object(per_site) && !forces) return undefined
    const bags = Array.from({ length: n_sites }, (): Record<string, unknown> => ({}))
    for (const [key, values] of Object.entries(is_plain_object(per_site) ? per_site : {})) {
      if (!Array.isArray(values) || values.length !== n_sites) continue
      for (const [site_idx, value] of values.entries()) bags[site_idx][key] = value
    }
    if (forces) for (const [site_idx, force] of forces.entries()) bags[site_idx].force = force
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
    const frame_lattice = lattices[idx]
    const frac_to_cart = frame_lattice ? math.create_frac_to_cart(frame_lattice) : null
    const positions = frac_to_cart ? frac_coords.map((abc) => frac_to_cart(abc)) : frac_coords

    const processed_properties: Record<string, unknown> = {}
    let forces: number[][] | null = null
    for (const [key, value] of Object.entries(frame_properties[idx] ?? {})) {
      // Per-atom forces go on the sites (`force`), their statistics into the metadata
      if (key === `forces` && Array.isArray(value)) {
        if (
          value.length !== n_sites ||
          !value.every((force) => math.is_finite_vec3_like(force))
        ) {
          warn(
            `Ignoring pymatgen forces of frame ${idx}: expected ${n_sites} finite 3-vectors`,
          )
          continue
        }
        forces = value as number[][]
        Object.assign(processed_properties, calc_force_stats(forces))
        continue
      }
      // Kept raw: pymatgen records no stress unit (VASP kB with compression positive, CHGNet
      // GPa, ...), so deriving a GPa pressure or stress_max from it would guess
      processed_properties[key] = value
    }

    return create_trajectory_frame(
      positions,
      elements,
      frame_lattice,
      frame_lattice && [true, true, true],
      idx,
      processed_properties,
      site_properties_for(idx, forces),
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
