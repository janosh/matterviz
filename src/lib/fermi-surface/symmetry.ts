// Point group symmetry operations for Fermi surface tiling
import { reduce_basis } from '$lib/brillouin/compute'
import * as math from '$lib/math'
import type { Matrix3x3, Matrix4Tuple } from '$lib/math'
import { DEFAULTS } from '$lib/settings'
import { is_identity } from '$lib/symmetry/symmetry-elements'

// Identity 4x4 matrix (column-major for Three.js)
// oxfmt-ignore
export const IDENTITY_4x4: Matrix4Tuple = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

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
// range, so these candidates cover every Bravais lattice holohedry (callers reduce first).
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

// Largest |(RᵀR)ᵢⱼ − δᵢⱼ|. R = Bᵀ·M·B^{-T} is dimensionless, so this is the RELATIVE
// distortion of the lattice away from the one that would carry M exactly.
const orthogonality_deviation = (rot: Matrix3x3): number => {
  const gram = math.dot(math.transpose_3x3_matrix(rot), rot)
  return math.array_max(
    gram.flatMap((row, idx) => row.map((val, jdx) => Math.abs(val - (idx === jdx ? 1 : 0)))),
  )
}

const point_group_cache = new Map<string, Matrix4Tuple[]>()

// Cartesian point-group operations (the holohedry) of the reciprocal lattice whose rows are
// k_lattice, as column-major 4x4 matrices for mesh tiling. A Cartesian R is a lattice
// symmetry iff it maps every reciprocal lattice vector onto another one, i.e. R·Bᵀ = Bᵀ·M
// for some integer unimodular M, so R = Bᵀ·M·B^{-T} must come out orthogonal. Enumerating
// M (rather than guessing R) makes the result exact for any lattice: 48 ops for cubic,
// 24 hexagonal, 16 tetragonal, 8 orthorhombic, 4 monoclinic, 2 triclinic.
// `symprec` bounds that relative deviation, replacing a fixed 1e-6 that real files trip: a
// hexagonal cell rounded to 4 decimals deviates by 7.2e-6, dropping 24 ops to 8.
// The identity is always first. Results are cached per (k_lattice, symprec).
export function lattice_point_group_matrices(
  k_lattice: Matrix3x3,
  symprec: number = DEFAULTS.symmetry.symprec,
): Matrix4Tuple[] {
  const cache_key = `${k_lattice.flat().join(`,`)}|${symprec}`
  const cached = point_group_cache.get(cache_key)
  if (cached) return cached

  // The Cartesian R does not depend on the basis, but the {-1,0,1} search for M does: a
  // non-reduced basis (sheared supercell) expresses most operations with larger entries
  const basis_t = math.transpose_3x3_matrix(reduce_basis(k_lattice))
  const basis_t_inv = math.matrix_inverse_3x3(basis_t)
  const matrices: Matrix4Tuple[] = []
  for (const int_mat of unimodular_candidates()) {
    const rot = math.dot(math.dot(basis_t, int_mat), basis_t_inv)
    if (orthogonality_deviation(rot) > symprec) continue
    // M = I (the one candidate whose R is the identity) goes first so symmetry_index 0 is
    // the untransformed copy; the rest keep enumeration order
    if (is_identity(int_mat)) matrices.unshift(to_matrix4(rot))
    else matrices.push(to_matrix4(rot))
  }
  point_group_cache.set(cache_key, matrices)
  return matrices
}
