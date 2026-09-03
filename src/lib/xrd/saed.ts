// Selected-area electron diffraction (SAED): the 2D spot pattern seen down a zone axis, as
// opposed to the 1D powder trace produced by compute_xrd_pattern.
//
// BEAM CONVENTION: the incident wavevector is k0 = +(1/λ)·ẑ with ẑ = zone_hat, i.e. the
// electrons travel ALONG +[uvw]. Williams & Carter and De Graef instead define the zone axis
// B as pointing from the specimen back toward the gun, so their k0 = −(1/λ)·B̂. The two
// differ by the sign of the out-of-plane index: down cubic [001] this module puts the FOLZ
// at l = −1 where the textbooks put it at l = +1. The zero-order zone is unaffected (l = 0)
// and so are all spot positions, |F|² and intensities — only the hkl label printed on a
// higher-order-zone spot flips sign. Flip zone_hat here (and only here) to adopt the
// textbook convention; laue_zone is |n| and is invariant either way.
import * as math from '$lib/math'
import type { Vec2, Vec3 } from '$lib/math'
import type { Crystal } from '$lib/structure/index'
import {
  electron_wavelength,
  enumerate_reciprocal_points,
  require_positive,
  resolve_wavelength,
  structure_factor_noise_floor,
  structure_factors_squared,
} from './calc-xrd'
import type { RecipPoint, SaedOptions, SaedPatternData, SaedSpot } from './index'

// sin(πx)/(πx), the 1D Fourier transform of a slab of unit thickness. Equals 1 at x = 0.
const sinc = (x_val: number): number =>
  x_val === 0 ? 1 : Math.sin(Math.PI * x_val) / (Math.PI * x_val)

export const laue_zone_label = (laue_zone: number): string => {
  if (laue_zone === 0) return `ZOLZ`
  if (laue_zone === 1) return `FOLZ`
  return `HOLZ${laue_zone}`
}

// Compute the electron diffraction spot pattern for a crystal viewed down [u, v, w].
//
// The zone axis is a DIRECT-lattice direction, so its Cartesian form is u·a + v·b + w·c from
// the row-vector lattice matrix. Because a_i · b_j = δ_ij for this module's reciprocal rows
// (transpose(inverse(A)), no 2π), the out-of-plane component of g in units of the zone axis is
// exactly the integer n = h·u + k·v + l·w. The Laue zone index is n reduced by gcd(u, v, w):
// [002] names the same direction as [001] and must produce the same ZOLZ/FOLZ/HOLZ labels.
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

  // Same wavelength/voltage exclusivity the powder path enforces, except that a TEM has an
  // obvious default beam energy where a diffractometer has no default anode.
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

  // Orthonormal frame in the plane perpendicular to the beam, shared by every spot so the
  // returned 2D coordinates form one consistent picture.
  const in_plane_basis = math.compute_in_plane_basis(zone_hat)
  const [in_plane_u, in_plane_v] = in_plane_basis

  // Ewald sphere radius 1/λ. At 200 kV this is 39.9 1/Å against reciprocal spacings of order
  // 0.2 1/Å, so the sphere is nearly a flat plane over the whole visible pattern — which is
  // precisely why a zone-axis electron pattern lights up an entire plane of reflections at
  // once, while an X-ray Ewald sphere (0.65 1/Å at Cu Kα) can only ever touch a few.
  const ewald_radius = 1 / wavelength
  // Beyond 1/λ no reflection can reach the sphere, and sqrt(K² − g_perp²) would go complex
  if (max_g >= ewald_radius) {
    throw new Error(`max_g ${max_g} must stay below the Ewald radius 1/λ = ${ewald_radius}.`)
  }
  // Excitation error cutoff at the first zero of the relrod: a slab of thickness t smears each
  // reciprocal-lattice point into a rod of half-length 1/t along the beam.
  const excitation_cutoff = 1 / crystal_thickness

  // A point at in-plane radius g_perp lies K − sqrt(K² − g_perp²) below the sphere, so its
  // g_parallel cannot exceed that sagitta plus the relrod half-length before |s_g| passes the
  // cutoff. Since g_parallel = (h·u + k·v + l·w)/|zone_cart|, that caps the Laue index, which
  // lets the enumeration skip the rest of the sphere — only ~1% of a default max_g = 2 sphere
  // can ever light up, and the fraction shrinks as max_g grows.
  const max_g_parallel =
    ewald_radius - Math.sqrt(ewald_radius * ewald_radius - max_g * max_g) + excitation_cutoff
  const recip_rows = math.reciprocal_lattice(direct_rows)
  const [recip_b1, recip_b2, recip_b3] = recip_rows
  const recip_points = enumerate_reciprocal_points(recip_rows, direct_rows, max_g, 0, {
    zone_axis,
    max_laue: zone_length * max_g_parallel,
  })

  // Two passes: select the reflections near the sphere first, then evaluate |F|² for just
  // those. Only a thin shell of the enumerated slab is ever excited, so this avoids the
  // structure-factor sum for the majority of enumerated points.
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

    // Exact excitation error, measured along the beam. Solving |k0 + g + s·ẑ| = 1/λ for
    // k0 = (1/λ)·ẑ gives s = sqrt(K² − g_perp²) − (K + g_parallel), no small-angle expansion.
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

  // Laue order counts planes of the lattice ROW along the axis, so it must be measured
  // against the primitive direction: [002] is the same beam direction as [001] and its FOLZ
  // is one plane away, not two.
  const [zone_u, zone_v, zone_w] = math.reduce_miller_indices(zone_axis)

  const raw_spots: SaedSpot[] = excited.map(
    ({ point: { hkl, g_norm }, position_2d, excitation_error }, spot_idx) => {
      // Relrod shape factor: |sin(π·t·s)/(π·t·s)|², normalized to 1 at s = 0
      const shape = sinc(crystal_thickness * excitation_error)
      return {
        hkl,
        position_2d,
        intensity: f_squared[spot_idx] * shape * shape,
        // Exactly integral; the sign only encodes which side of the zone the reflection sits
        // on, so report the zone order and let callers keep hkl for the sign.
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

// Convenience for renderers: the largest |position_2d| in the pattern, i.e. the radius the
// view has to cover. Returns 0 for an empty pattern.
export const saed_pattern_radius = (pattern: SaedPatternData): number =>
  pattern.spots.reduce((radius, spot) => Math.max(radius, Math.hypot(...spot.position_2d)), 0)
