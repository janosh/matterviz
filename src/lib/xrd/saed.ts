// Selected-area electron diffraction (SAED): the 2D spot pattern seen down a zone axis.
//
// BEAM CONVENTION: k0 = +(1/λ)·zone_hat, electrons travel ALONG +[uvw]. Williams & Carter and
// De Graef point B back toward the gun (k0 = −(1/λ)·B̂), so down cubic [001] this module puts
// the FOLZ at l = −1 where they put it at l = +1. Positions, intensities and laue_zone are
// unaffected; only higher-order-zone hkl labels flip sign. Flip zone_hat to switch.
import * as math from '#lib/math.js'
import type { Vec2, Vec3 } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
import {
  electron_wavelength,
  enumerate_reciprocal_points,
  require_positive,
  resolve_wavelength,
  structure_factor_noise_floor,
  structure_factors_squared,
} from './calc-xrd'
import type { RecipPoint, SaedOptions, SaedPatternData, SaedSpot } from './index'

// sin(πx)/(πx), the Fourier transform of a unit-thickness slab
const sinc = (x_val: number): number =>
  x_val === 0 ? 1 : Math.sin(Math.PI * x_val) / (Math.PI * x_val)

export const laue_zone_label = (laue_zone: number): string =>
  laue_zone === 0 ? `ZOLZ` : laue_zone === 1 ? `FOLZ` : `HOLZ${laue_zone}`

// Electron diffraction spots for a crystal viewed down the direct-lattice direction [u, v, w].
// With a_i · b_j = δ_ij (no 2π), g's out-of-plane component in zone-axis units is the integer
// n = h·u + k·v + l·w.
export function compute_saed_pattern(
  structure: Crystal,
  options: SaedOptions = {},
): SaedPatternData {
  const zone_axis: Vec3 = options.zone_axis ?? [0, 0, 1]
  // A zone axis is a direct-lattice translation: a fractional one names no lattice row
  if (zone_axis.length !== 3 || zone_axis.some((comp) => !Number.isInteger(comp))) {
    throw new Error(
      `Invalid zone axis [${zone_axis}]. Expected three integer components [u v w].`,
    )
  }

  // Same rules as the powder path, plus a default 200 kV beam
  const wavelength =
    options.wavelength === undefined && options.accelerating_voltage === undefined
      ? electron_wavelength(200)
      : resolve_wavelength(`electron`, options.wavelength, options.accelerating_voltage)

  const max_g = require_positive(`max_g`, options.max_g ?? 2, ` of 1/Angstrom`)
  const crystal_thickness = require_positive(
    `crystal_thickness`,
    options.crystal_thickness ?? 50,
    ` of Angstrom`,
  )

  const direct_rows = structure.lattice.matrix
  const [row_a, row_b, row_c] = direct_rows
  const zone_cart: Vec3 = math.add(
    math.scale(row_a, zone_axis[0]),
    math.scale(row_b, zone_axis[1]),
    math.scale(row_c, zone_axis[2]),
  )
  const zone_length = Math.hypot(...zone_cart)
  if (zone_length === 0) {
    throw new Error(`Zone axis [${zone_axis}] maps to a zero-length direct-lattice vector.`)
  }
  const zone_hat = math.scale(zone_cart, 1 / zone_length)

  // Orthonormal frame perpendicular to the beam that every position_2d is expressed in
  const in_plane_basis = math.compute_in_plane_basis(zone_hat)
  const [in_plane_u, in_plane_v] = in_plane_basis

  // Ewald radius 1/λ (39.9 1/Å at 200 kV vs ~0.2 1/Å spacings): the sphere is nearly flat,
  // which is why a zone-axis pattern lights up a whole reciprocal plane at once
  const ewald_radius = 1 / wavelength
  // Beyond 1/λ no reflection can reach the sphere, and sqrt(K² − g_perp²) would go complex
  if (max_g >= ewald_radius) {
    throw new Error(`max_g ${max_g} must stay below the Ewald radius 1/λ = ${ewald_radius}.`)
  }
  // First zero of the relrod: a slab of thickness t smears points into rods of half-length 1/t
  const excitation_cutoff = 1 / crystal_thickness

  // |g_parallel| cannot exceed the sphere's sagitta K − sqrt(K² − g_perp²) plus the relrod
  // half-length, which caps the Laue index: only ~1% of a max_g = 2 sphere can light up
  const max_g_parallel =
    ewald_radius - Math.sqrt(ewald_radius * ewald_radius - max_g * max_g) + excitation_cutoff
  const recip_rows = math.reciprocal_lattice(direct_rows)
  const [recip_b1, recip_b2, recip_b3] = recip_rows
  const recip_points = enumerate_reciprocal_points(recip_rows, direct_rows, max_g, 0, {
    zone_axis,
    max_laue: zone_length * max_g_parallel,
  })

  // Select excited reflections first so |F|² is only summed for that thin shell
  const excited: { point: RecipPoint; position_2d: Vec2; excitation_error: number }[] = []

  for (const point of recip_points) {
    const [h_idx, k_idx, l_idx] = point.hkl
    const g_x = h_idx * recip_b1[0] + k_idx * recip_b2[0] + l_idx * recip_b3[0]
    const g_y = h_idx * recip_b1[1] + k_idx * recip_b2[1] + l_idx * recip_b3[1]
    const g_z = h_idx * recip_b1[2] + k_idx * recip_b2[2] + l_idx * recip_b3[2]
    const g_parallel = g_x * zone_hat[0] + g_y * zone_hat[1] + g_z * zone_hat[2]
    const g_perp_u = g_x * in_plane_u[0] + g_y * in_plane_u[1] + g_z * in_plane_u[2]
    const g_perp_v = g_x * in_plane_v[0] + g_y * in_plane_v[1] + g_z * in_plane_v[2]
    const g_perp_sq = g_perp_u * g_perp_u + g_perp_v * g_perp_v

    // Exact excitation error along the beam from |k0 + g + s·ẑ| = 1/λ (no small-angle expansion)
    const excitation_error =
      Math.sqrt(ewald_radius * ewald_radius - g_perp_sq) - (ewald_radius + g_parallel)
    if (Math.abs(excitation_error) >= excitation_cutoff) continue

    excited.push({ point, position_2d: [g_perp_u, g_perp_v], excitation_error })
  }

  const f_squared = structure_factors_squared(
    structure,
    `electron`,
    options.debye_waller_factors ?? {},
    excited.map((entry) => entry.point),
  )

  // Laue order is measured against the primitive direction: [002] has the same FOLZ as [001]
  const [zone_u, zone_v, zone_w] = math.reduce_miller_indices(zone_axis)

  const raw_spots: SaedSpot[] = excited.map(
    ({ point: { hkl, g_norm }, position_2d, excitation_error }, spot_idx) => {
      // Relrod shape factor: |sin(π·t·s)/(π·t·s)|², normalized to 1 at s = 0
      const shape = sinc(crystal_thickness * excitation_error)
      return {
        hkl,
        position_2d,
        intensity: f_squared[spot_idx] * shape * shape,
        // the sign (which side of the zone) stays readable from hkl
        laue_zone: Math.abs(hkl[0] * zone_u + hkl[1] * zone_v + hkl[2] * zone_w),
        d_spacing: 1 / g_norm,
        excitation_error,
      }
    },
  )
  const max_intensity = raw_spots.reduce((peak, spot) => Math.max(peak, spot.intensity), 0)

  // Scaled to a maximum of 100, then strongest first so renderers can draw large spots
  // underneath small ones. Same |F|² floor as compute_xrd_pattern: the relrod shape factor ≤ 1.
  const intensity_tol = options.intensity_tol ?? 1e-3
  const spots =
    max_intensity < structure_factor_noise_floor(structure, `electron`)
      ? []
      : raw_spots
          .map((spot) => ({ ...spot, intensity: (spot.intensity / max_intensity) * 100 }))
          .filter((spot) => spot.intensity > intensity_tol)
          .toSorted((spot_a, spot_b) => spot_b.intensity - spot_a.intensity)

  return { spots, zone_axis, wavelength, max_g, in_plane_basis }
}

// Camera pose matching the drawn pattern: SaedPattern draws basis u right and v up with u × v
// = +zone toward the viewer, so the camera sits on +zone with v up, putting u on screen right
export const saed_camera_pose = (
  pattern: Pick<SaedPatternData, `in_plane_basis`>,
): { direction: Vec3; up: Vec3 } => {
  const [basis_u, basis_v] = pattern.in_plane_basis
  return { direction: math.cross_3d(basis_u, basis_v), up: basis_v }
}

// Largest |position_2d|, i.e. the radius a view has to cover (0 for an empty pattern)
export const saed_pattern_radius = (pattern: SaedPatternData): number =>
  pattern.spots.reduce((radius, spot) => Math.max(radius, Math.hypot(...spot.position_2d)), 0)
