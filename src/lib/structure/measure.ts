import type { Vec3 } from '$lib'
import { mat3x3_vec3_multiply, type Matrix3x3, matrix_inverse_3x3 } from '$lib/math'

// This module centralizes measurement utilities for structures: distances and angles

export type AngleMode = `degrees` | `radians`

export const MAX_SELECTED_SITES = 8

export function displacement_pbc(
  from: Vec3,
  to: Vec3,
  lattice_matrix: Matrix3x3,
  lattice_inv?: Matrix3x3,
): Vec3 {
  const inv_mat = lattice_inv ?? matrix_inverse_3x3(lattice_matrix)
  const frac_from = mat3x3_vec3_multiply(inv_mat, from)
  const frac_to = mat3x3_vec3_multiply(inv_mat, to)

  // Wrap fractional coordinates to [0,1) for easier boundary checking
  const frac_from_wrapped: Vec3 = [
    frac_from[0] - Math.floor(frac_from[0]),
    frac_from[1] - Math.floor(frac_from[1]),
    frac_from[2] - Math.floor(frac_from[2]),
  ]
  const frac_to_wrapped: Vec3 = [
    frac_to[0] - Math.floor(frac_to[0]),
    frac_to[1] - Math.floor(frac_to[1]),
    frac_to[2] - Math.floor(frac_to[2]),
  ]

  // Find minimum image by testing all nearby lattice translations
  let min_dist_sq = Infinity
  let best_displacement: Vec3 = [0, 0, 0]

  // Test lattice images in a 3x3x3 neighborhood (sufficient for minimum image)
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        // Fractional displacement with lattice translation
        const frac_diff: Vec3 = [
          frac_to_wrapped[0] - frac_from_wrapped[0] + i,
          frac_to_wrapped[1] - frac_from_wrapped[1] + j,
          frac_to_wrapped[2] - frac_from_wrapped[2] + k,
        ]

        // Convert to cartesian
        const cart_diff = mat3x3_vec3_multiply(lattice_matrix, frac_diff)
        const dist_sq = cart_diff[0] ** 2 + cart_diff[1] ** 2 + cart_diff[2] ** 2

        // Keep the shortest displacement
        if (dist_sq < min_dist_sq) {
          min_dist_sq = dist_sq
          best_displacement = cart_diff
        }
      }
    }
  }

  return best_displacement
}

export function distance_pbc(a: Vec3, b: Vec3, lattice_matrix: Matrix3x3): number {
  const inv_mat = matrix_inverse_3x3(lattice_matrix)
  const [dx, dy, dz] = displacement_pbc(a, b, lattice_matrix, inv_mat)
  return Math.hypot(dx, dy, dz)
}

export function angle_between_vectors(
  v1: Vec3,
  v2: Vec3,
  mode: AngleMode = `degrees`,
): number {
  const n1 = Math.hypot(v1[0], v1[1], v1[2])
  const n2 = Math.hypot(v2[0], v2[1], v2[2])
  if (n1 === 0 || n2 === 0) return 0

  // Normalize vectors
  const u1: Vec3 = [v1[0] / n1, v1[1] / n1, v1[2] / n1]
  const u2: Vec3 = [v2[0] / n2, v2[1] / n2, v2[2] / n2]

  // Dot product of normalized vectors
  const dot = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2]

  // Cross product magnitude for better numerical stability near 0° and 180°
  const cross_x = u1[1] * u2[2] - u1[2] * u2[1]
  const cross_y = u1[2] * u2[0] - u1[0] * u2[2]
  const cross_z = u1[0] * u2[1] - u1[1] * u2[0]
  const cross_mag = Math.hypot(cross_x, cross_y, cross_z)

  // Use atan2 for better numerical stability
  const ang = Math.atan2(cross_mag, dot)

  return mode === `degrees` ? (ang * 180) / Math.PI : ang
}

// Smart displacement selection: chooses between direct and PBC vectors
// to avoid issues with collinear atoms and unit cell geometries
export function smart_displacement_vectors(
  center: Vec3,
  a: Vec3,
  b: Vec3,
  lattice_matrix?: Matrix3x3,
  center_abc?: Vec3,
  a_abc?: Vec3,
  b_abc?: Vec3,
): [Vec3, Vec3] {
  // Direct vectors (no PBC)
  const v1_direct: Vec3 = [a[0] - center[0], a[1] - center[1], a[2] - center[2]]
  const v2_direct: Vec3 = [b[0] - center[0], b[1] - center[1], b[2] - center[2]]

  // If no lattice, use direct vectors
  if (!lattice_matrix) return [v1_direct, v2_direct]

  // PBC vectors
  const v1_pbc = displacement_pbc(center, a, lattice_matrix)
  const v2_pbc = displacement_pbc(center, b, lattice_matrix)

  // Check collinearity using direct vectors
  const dist1 = Math.hypot(...v1_direct)
  const dist2 = Math.hypot(...v2_direct)
  if (dist1 === 0 || dist2 === 0) return [v1_direct, v2_direct]

  const cross = [
    v1_direct[1] * v2_direct[2] - v1_direct[2] * v2_direct[1],
    v1_direct[2] * v2_direct[0] - v1_direct[0] * v2_direct[2],
    v1_direct[0] * v2_direct[1] - v1_direct[1] * v2_direct[0],
  ]
  const cross_mag = Math.hypot(...cross)
  const is_collinear = cross_mag / (dist1 * dist2) < 0.05

  // If collinear, prefer direct vectors
  if (is_collinear) return [v1_direct, v2_direct]

  // Check if all atoms are in unit cell and direct vectors are reasonable
  if (center_abc && a_abc && b_abc) {
    const all_in_cell = [center_abc, a_abc, b_abc].every((abc) =>
      abc.every((coord) => coord >= -0.1 && coord <= 1.1)
    )

    if (all_in_cell) {
      const pbc_dist1 = Math.hypot(...v1_pbc)
      const pbc_dist2 = Math.hypot(...v2_pbc)
      const direct_reasonable = dist1 <= pbc_dist1 * 1.1 && dist2 <= pbc_dist2 * 1.1

      if (direct_reasonable) return [v1_direct, v2_direct]
    }
  }

  // Default to PBC vectors
  return [v1_pbc, v2_pbc]
}
