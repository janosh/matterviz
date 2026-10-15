// Crystallographic viewing directions: turn Miller-style indices into the Cartesian
// direction the camera should look ALONG (i.e. the camera sits on this ray from the
// structure center and looks back at it).
//
// The two index families are NOT interchangeable:
//   - a zone axis [uvw] is a DIRECT-lattice direction, u*a + v*b + w*c
//   - a plane normal (hkl) needs the RECIPROCAL lattice, h*b1 + k*b2 + l*b3
// They only coincide for cubic cells, which is exactly why cubic-only testing hides bugs here.
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { create_frac_to_cart, miller_plane_normal } from '#lib/math.js'

export const ZONE_AXIS_MODE_LABELS = {
  uvw: `Zone axis [uvw]`,
  hkl: `Plane normal (hkl)`,
} as const
export type ZoneAxisMode = keyof typeof ZONE_AXIS_MODE_LABELS

// Unit Cartesian direction for `indices` interpreted per `mode`.
// Throws on all-zero indices (no direction) and on a singular lattice (no reciprocal lattice);
// callers driving this from user input should gate on `is_valid_zone_axis` first.
export function zone_axis_direction(
  matrix: Matrix3x3,
  indices: Vec3,
  mode: ZoneAxisMode,
): Vec3 {
  if (!indices.some((index) => index !== 0)) {
    throw new Error(`Zone axis indices must not be all zero, got ${JSON.stringify(indices)}`)
  }
  // normalized below, so the 2π convention of the reciprocal lattice is immaterial
  const direction =
    mode === `hkl`
      ? miller_plane_normal(matrix, indices)
      : create_frac_to_cart(matrix)(indices)
  const length = Math.hypot(...direction)
  if (!Number.isFinite(length) || length === 0) {
    throw new Error(
      `Degenerate ${mode} direction for indices ${JSON.stringify(indices)} in lattice ${JSON.stringify(matrix)}`,
    )
  }
  return [direction[0] / length, direction[1] / length, direction[2] / length]
}

export const is_valid_zone_axis = (indices: Vec3): boolean =>
  indices.every((index) => Number.isFinite(index)) && indices.some((index) => index !== 0)
