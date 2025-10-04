import type { Vec3 } from '$lib'
import { mat3x3_vec3_multiply, type Matrix3x3, matrix_inverse_3x3 } from '$lib/math'

// functions for measuring distances and angles between structure sites

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

export function angle_between_vectors(v1: Vec3, v2: Vec3, mode: AngleMode = `degrees`) {
  const n1 = Math.hypot(v1[0], v1[1], v1[2])
  const n2 = Math.hypot(v2[0], v2[1], v2[2])
  if (n1 === 0 || n2 === 0) return 0

  // Dot product of vectors
  const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]

  // Normalize dot product to get cosine
  const cos_angle = dot / (n1 * n2)

  // Clamp to [-1, 1] to avoid numerical errors with acos
  const clamped = Math.max(-1, Math.min(1, cos_angle))

  // Compute angle using arccos
  const ang = Math.acos(clamped)

  return mode === `degrees` ? (ang * 180) / Math.PI : ang
}
