// Crystallographic viewing directions: turn Miller-style indices into the Cartesian
// direction the camera should look ALONG (i.e. the camera sits on this ray from the
// structure center and looks back at it).
//
// The two index families are NOT interchangeable:
//   - a zone axis [uvw] is a DIRECT-lattice direction, u*a + v*b + w*c
//   - a plane normal (hkl) needs the RECIPROCAL lattice, h*b1 + k*b2 + l*b3
// They only coincide for cubic cells, which is exactly why cubic-only testing hides bugs here.
import type { Matrix3x3, Vec3 } from '$lib/math'
import { matrix_inverse_3x3, transpose_3x3_matrix } from '$lib/math'

export type ZoneAxisMode = `uvw` | `hkl`

export const ZONE_AXIS_MODE_LABELS: Readonly<Record<ZoneAxisMode, string>> = {
  uvw: `Zone axis [uvw]`,
  hkl: `Plane normal (hkl)`,
}

// Linear combination of the ROWS of `matrix` (matterviz stores lattice vectors as rows).
const combine_rows = (matrix: Matrix3x3, coeffs: Vec3): Vec3 => [
  coeffs[0] * matrix[0][0] + coeffs[1] * matrix[1][0] + coeffs[2] * matrix[2][0],
  coeffs[0] * matrix[0][1] + coeffs[1] * matrix[1][1] + coeffs[2] * matrix[2][1],
  coeffs[0] * matrix[0][2] + coeffs[1] * matrix[1][2] + coeffs[2] * matrix[2][2],
]

// Reciprocal lattice vectors b1, b2, b3 as ROWS, defined by a_i · b_j = delta_ij.
// Deliberately WITHOUT the 2*pi factor, matching $lib/xrd/calc-xrd.ts (and unlike
// $lib/brillouin/compute.ts, which includes it). A camera only ever consumes the normalized
// direction, so any positive scalar cancels — picking the crystallographic (2*pi-free)
// convention keeps this consistent with the diffraction code it is most likely compared against.
export const reciprocal_lattice_rows = (matrix: Matrix3x3): Matrix3x3 =>
  transpose_3x3_matrix(matrix_inverse_3x3(matrix))

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
  const basis = mode === `hkl` ? reciprocal_lattice_rows(matrix) : matrix
  const direction = combine_rows(basis, indices)
  const length = Math.hypot(direction[0], direction[1], direction[2])
  if (!Number.isFinite(length) || length === 0) {
    const lattice_json = JSON.stringify(matrix)
    throw new Error(
      `Degenerate ${mode} direction for indices ${JSON.stringify(indices)} in lattice ${lattice_json}`,
    )
  }
  return [direction[0] / length, direction[1] / length, direction[2] / length]
}

export const is_valid_zone_axis = (indices: Vec3): boolean =>
  indices.every((index) => Number.isFinite(index)) && indices.some((index) => index !== 0)
