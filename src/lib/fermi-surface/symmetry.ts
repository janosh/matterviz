// Point group symmetry operations for Fermi surface tiling
import * as math from '#lib/math.js'
import type { Matrix3x3, Matrix4Tuple, Vec3 } from '#lib/math.js'
import { DEFAULTS } from '#lib/settings.js'
import { is_identity } from '#lib/symmetry/symmetry-elements.js'

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

// The 27 integer vectors with entries in {-1, 0, 1}, a candidate matrix's possible columns.
// Column code c holds its row-0 entry in the lowest base-3 digit.
const COLUMN_VECTORS: Vec3[] = Array.from({ length: 27 }, (_, code) => [
  (code % 3) - 1,
  (Math.trunc(code / 3) % 3) - 1,
  Math.trunc(code / 9) - 1,
])

// Every unimodular integer matrix M with entries in {-1, 0, 1} that can pass the orthogonality
// test below for `basis` (rows) within `symprec`, in full-scan order (entry (row, col) is base-3
// digit 3·row + col of the scan index). Such M cover every holohedry of a reduced basis.
// R = Bᵀ·M·B^{-T} gives Mᵀ·G·M − G = B·(RᵀR − I)·Bᵀ with metric G = B·Bᵀ, so max |RᵀR − I| ≤
// symprec bounds |(MᵀGM − G)ᵢⱼ| by symprec·sᵢ·sⱼ (sᵢ the L1 norm of basis row i). This
// necessary condition prunes columns, then column pairs, leaving a few hundred of the 6960
// unimodular candidates (25 -> 0.2 ms for fcc); the caller applies the exact test to each.
function unimodular_candidates(basis: Matrix3x3, symprec: number): Matrix3x3[] {
  const metric = math.dot(basis, math.transpose_3x3(basis))
  const row_sums = basis.map((row) => Math.abs(row[0]) + Math.abs(row[1]) + Math.abs(row[2]))
  // slack far above the rounding of the few products below, far below any symprec in use
  const slack = 1e-9 * math.array_max(metric.flat().map(Math.abs))
  // negated, so a NaN bound keeps every candidate for the exact test, as a full scan would
  const within = (value: number, row: number, col: number): boolean =>
    !(Math.abs(value - metric[row][col]) > symprec * row_sums[row] * row_sums[col] + slack)
  // G·c for each possible column c, so (MᵀGM)ᵢⱼ = cᵢ · (G·cⱼ)
  const metric_columns = COLUMN_VECTORS.map((column) => math.mul_3x3_vec3(metric, column))
  const column_dot = (code_i: number, code_j: number): number =>
    math.dot(COLUMN_VECTORS[code_i], metric_columns[code_j])
  const [codes_0, codes_1, codes_2] = [0, 1, 2].map((axis) =>
    COLUMN_VECTORS.flatMap((_, code) =>
      within(column_dot(code, code), axis, axis) ? [code] : [],
    ),
  )
  const found: { scan_idx: number; matrix: Matrix3x3 }[] = []
  for (const code_0 of codes_0) {
    for (const code_1 of codes_1) {
      if (!within(column_dot(code_0, code_1), 0, 1)) continue
      for (const code_2 of codes_2) {
        if (!within(column_dot(code_0, code_2), 0, 2)) continue
        if (!within(column_dot(code_1, code_2), 1, 2)) continue
        const columns = [
          COLUMN_VECTORS[code_0],
          COLUMN_VECTORS[code_1],
          COLUMN_VECTORS[code_2],
        ]
        const matrix = math.transpose_3x3(columns as Matrix3x3)
        if (Math.abs(math.det_3x3(matrix)) !== 1) continue
        const scan_idx = matrix
          .flat()
          .reduce((sum, entry, digit) => sum + (entry + 1) * 3 ** digit, 0)
        found.push({ scan_idx, matrix })
      }
    }
  }
  return found.toSorted((lhs, rhs) => lhs.scan_idx - rhs.scan_idx).map(({ matrix }) => matrix)
}

// Largest |(RᵀR)ᵢⱼ − δᵢⱼ|. R = Bᵀ·M·B^{-T} is dimensionless, so this is the RELATIVE
// distortion of the lattice away from the one that would carry M exactly.
const orthogonality_deviation = (rot: Matrix3x3): number => {
  const gram = math.dot(math.transpose_3x3(rot), rot)
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
  const basis = math.reduce_basis(k_lattice)
  const basis_t = math.transpose_3x3(basis)
  const basis_t_inv = math.reciprocal_lattice(basis)
  const matrices: Matrix4Tuple[] = []
  for (const int_mat of unimodular_candidates(basis, symprec)) {
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
