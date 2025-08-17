import type { Vec3 } from '$lib'
import {
  euclidean_dist,
  mat3x3_vec3_multiply,
  type Matrix3x3,
  matrix_inverse_3x3,
} from '$lib/math'

// This module centralizes measurement utilities for structures: distances and angles

export type AngleMode = `degrees` | `radians`

export function distance_direct(a: Vec3, b: Vec3): number {
  return euclidean_dist(a, b)
}

export function displacement_pbc(from: Vec3, to: Vec3, lattice_matrix: Matrix3x3): Vec3 {
  const inv = matrix_inverse_3x3(lattice_matrix)
  const frac_from = mat3x3_vec3_multiply(inv, from)
  const frac_to = mat3x3_vec3_multiply(inv, to)
  const frac_diff: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < 3; idx++) {
    const dist = frac_to[idx] - frac_from[idx]
    // Minimal image in fractional coordinates: wrap to [-0.5, 0.5)
    frac_diff[idx] = dist - Math.round(dist)
  }
  return mat3x3_vec3_multiply(lattice_matrix, frac_diff)
}

export function distance_pbc(a: Vec3, b: Vec3, lattice_matrix: Matrix3x3): number {
  const [dx, dy, dz] = displacement_pbc(a, b, lattice_matrix)
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
  let cos_ang = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / (n1 * n2)
  cos_ang = Math.max(-1, Math.min(1, cos_ang))
  const ang = Math.acos(cos_ang)
  return mode === `degrees` ? (ang * 180) / Math.PI : ang
}

export function angle_at_center(
  center: Vec3,
  a: Vec3,
  b: Vec3,
  lattice_matrix?: Matrix3x3,
  mode: AngleMode = `degrees`,
): number {
  const v1 = lattice_matrix
    ? displacement_pbc(center, a, lattice_matrix)
    : ([a[0] - center[0], a[1] - center[1], a[2] - center[2]] as Vec3)
  const v2 = lattice_matrix
    ? displacement_pbc(center, b, lattice_matrix)
    : ([b[0] - center[0], b[1] - center[1], b[2] - center[2]] as Vec3)
  return angle_between_vectors(v1, v2, mode)
}
