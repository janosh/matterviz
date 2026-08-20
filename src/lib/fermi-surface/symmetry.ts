// Point group symmetry operations for Fermi surface tiling
import * as math from '$lib/math'
import type { Matrix3x3, Matrix4Tuple } from '$lib/math'
import { SvelteMap } from 'svelte/reactivity'

// Identity 4x4 matrix (column-major for Three.js)
// oxfmt-ignore
export const IDENTITY_4x4: Matrix4Tuple = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

// Cartesian rotations R that map a set of vertices onto itself within this tolerance
const ORTHOGONALITY_TOLERANCE = 1e-6

// Row-major 3x3 acting on column vectors (k' = R·k) → column-major 4x4 for three.js, where
// element (row, col) lives at index col * 4 + row
const to_matrix4 = (rot: Matrix3x3): Matrix4Tuple => {
  const mat: number[] = Array(16).fill(0)
  mat[15] = 1
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) mat[col * 4 + row] = rot[row][col]
  }
  return mat as Matrix4Tuple
}

// Enumerate every integer matrix M with entries in {-1, 0, 1} (3^9 = 19683 candidates).
// Point-group operations of a lattice in a reduced basis always have entries in this
// range, so these candidates cover every Bravais lattice holohedry.
function* unimodular_candidates(): Generator<Matrix3x3> {
  const entries = new Int8Array(9)
  for (let code = 0; code < 19683; code++) {
    let rest = code
    for (let idx = 0; idx < 9; idx++) {
      entries[idx] = (rest % 3) - 1
      rest = Math.trunc(rest / 3)
    }
    const mat: Matrix3x3 = [
      [entries[0], entries[1], entries[2]],
      [entries[3], entries[4], entries[5]],
      [entries[6], entries[7], entries[8]],
    ]
    if (Math.abs(math.det_3x3(mat)) === 1) yield mat
  }
}

const is_orthogonal = (rot: Matrix3x3): boolean => {
  const gram = math.dot(math.transpose_3x3_matrix(rot), rot)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (Math.abs(gram[row][col] - (row === col ? 1 : 0)) > ORTHOGONALITY_TOLERANCE) {
        return false
      }
    }
  }
  return true
}

const point_group_cache = new SvelteMap<string, Matrix4Tuple[]>()

// Cartesian point-group operations (the holohedry) of the reciprocal lattice whose rows are
// k_lattice, as column-major 4x4 matrices for mesh tiling. A Cartesian R is a lattice
// symmetry iff it maps every reciprocal lattice vector onto another one, i.e. R·Bᵀ = Bᵀ·M
// for some integer unimodular M, so R = Bᵀ·M·B^{-T} must come out orthogonal. Enumerating
// M (rather than guessing R) makes the result exact for any lattice: 48 ops for cubic,
// 24 hexagonal, 16 tetragonal, 8 orthorhombic, 4 monoclinic, 2 triclinic. The identity is
// always first. Results are cached per k_lattice.
export function lattice_point_group_matrices(k_lattice: Matrix3x3): Matrix4Tuple[] {
  const cache_key = k_lattice.flat().join(`,`)
  const cached = point_group_cache.get(cache_key)
  if (cached) return cached

  const basis_t = math.transpose_3x3_matrix(k_lattice)
  const basis_t_inv = math.matrix_inverse_3x3(basis_t)
  const rotations: Matrix3x3[] = []
  for (const int_mat of unimodular_candidates()) {
    const rot = math.dot(math.dot(basis_t, int_mat), basis_t_inv)
    if (is_orthogonal(rot)) rotations.push(rot)
  }

  // Identity first so symmetry_index 0 is the untransformed copy; the rest in a stable order
  const is_identity = (rot: Matrix3x3) =>
    rot.every((row, row_idx) =>
      row.every((val, col_idx) => Math.abs(val - (row_idx === col_idx ? 1 : 0)) < 1e-9),
    )
  const matrices = rotations
    .toSorted((rot_a, rot_b) => Number(is_identity(rot_b)) - Number(is_identity(rot_a)))
    .map(to_matrix4)
  point_group_cache.set(cache_key, matrices)
  return matrices
}
