import type { LatticeParams, Pbc } from '$lib/structure/index'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]
export type Vec9 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]
export type Matrix3x3 = [Vec3, Vec3, Vec3]
export type Matrix4x4 = [Vec4, Vec4, Vec4, Vec4]
export type NdVector = number[]

// Column-major 4x4 matrix as flat 16-element tuple (for Three.js/WebGL)
// deno-fmt-ignore
export type Matrix4Tuple = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
]

// Generate all k-element combinations from an array.
export function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (arr.length < k) return []
  const [first, ...rest] = arr
  return [
    ...combinations(rest, k - 1).map((combo) => [first, ...combo]),
    ...combinations(rest, k),
  ]
}

export const LOG_EPS = 1e-9
export const EPS = 1e-10
export const RAD_TO_DEG = 180 / Math.PI
export const DEG_TO_RAD = Math.PI / 180

export const to_degrees = (radians: number): number => radians * RAD_TO_DEG
export const to_radians = (degrees: number): number => degrees * DEG_TO_RAD

// Calculate all lattice parameters in a single efficient pass
export function calc_lattice_params(
  matrix: Matrix3x3,
): LatticeParams & { volume: number } {
  const [a_vec, b_vec, c_vec] = matrix

  // Calculate vector lengths (lattice parameters a, b, c)
  const a = Math.hypot(a_vec[0], a_vec[1], a_vec[2])
  const b = Math.hypot(b_vec[0], b_vec[1], b_vec[2])
  const c = Math.hypot(c_vec[0], c_vec[1], c_vec[2])

  // Calculate volume using scalar triple product
  const volume = Math.abs(
    a_vec[0] * (b_vec[1] * c_vec[2] - b_vec[2] * c_vec[1]) +
      a_vec[1] * (b_vec[2] * c_vec[0] - b_vec[0] * c_vec[2]) +
      a_vec[2] * (b_vec[0] * c_vec[1] - b_vec[1] * c_vec[0]),
  )

  // Calculate dot products for angles (only once each)
  const dot_ab = a_vec[0] * b_vec[0] + a_vec[1] * b_vec[1] + a_vec[2] * b_vec[2]
  const dot_ac = a_vec[0] * c_vec[0] + a_vec[1] * c_vec[1] + a_vec[2] * c_vec[2]
  const dot_bc = b_vec[0] * c_vec[0] + b_vec[1] * c_vec[1] + b_vec[2] * c_vec[2]

  // Convert to angles in degrees
  const alpha = Math.acos(dot_bc / (b * c)) * RAD_TO_DEG
  const beta = Math.acos(dot_ac / (a * c)) * RAD_TO_DEG
  const gamma = Math.acos(dot_ab / (a * b)) * RAD_TO_DEG

  return { a, b, c, alpha, beta, gamma, volume }
}

export const scale = <T extends NdVector>(vec: T, factor: number): T =>
  vec.map((component) => component * factor) as T

export const euclidean_dist = (vec1: NdVector, vec2: NdVector): number => {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vectors must be of same length`)
  }
  return Math.hypot(...vec1.map((x, idx) => x - vec2[idx]))
}

// Calculate the minimum distance between two points considering periodic boundary conditions.
export function pbc_dist(
  pos1: Vec3, // First position vector (Cartesian coordinates)
  pos2: Vec3, // Second position vector (Cartesian coordinates)
  lattice_matrix: Matrix3x3, // 3x3 lattice matrix where each row is a lattice vector
  lattice_inv?: Matrix3x3, // Optional pre-computed inverse matrix for optimization (since lattice is usually constant and repeatedly inverting matrix is expensive)
  pbc: Pbc = [true, true, true],
): number {
  const inv_matrix = lattice_inv ?? matrix_inverse_3x3(lattice_matrix)

  // Convert Cartesian coordinates to fractional coordinates
  const [fx1, fy1, fz1] = mat3x3_vec3_multiply(inv_matrix, pos1)
  const [fx2, fy2, fz2] = mat3x3_vec3_multiply(inv_matrix, pos2)

  // Apply minimum image convention only for periodic axes
  const wrapped_frac_diff = [fx1 - fx2, fy1 - fy2, fz1 - fz2].map((diff, idx) =>
    pbc[idx] ? diff - Math.round(diff) : diff
  ) as Vec3

  // Convert back to Cartesian coordinates
  const cart_diff = mat3x3_vec3_multiply(lattice_matrix, wrapped_frac_diff)

  return Math.hypot(...cart_diff)
}

export function matrix_inverse_3x3(matrix: Matrix3x3): Matrix3x3 {
  const [[m11, m12, m13], [m21, m22, m23], [m31, m32, m33]] = matrix

  const det = det_3x3(matrix)

  if (!Number.isFinite(det) || Math.abs(det) < EPS) {
    throw new Error(`Matrix is singular or ill-conditioned; cannot invert`)
  }

  const inv_det = 1 / det

  return [
    [
      (m22 * m33 - m23 * m32) * inv_det,
      (m13 * m32 - m12 * m33) * inv_det,
      (m12 * m23 - m13 * m22) * inv_det,
    ],
    [
      (m23 * m31 - m21 * m33) * inv_det,
      (m11 * m33 - m13 * m31) * inv_det,
      (m13 * m21 - m11 * m23) * inv_det,
    ],
    [
      (m21 * m32 - m22 * m31) * inv_det,
      (m12 * m31 - m11 * m32) * inv_det,
      (m11 * m22 - m12 * m21) * inv_det,
    ],
  ]
}

// Multiply a 3x3 matrix by a 3D vector
export function mat3x3_vec3_multiply(matrix: Matrix3x3, vector: Vec3): Vec3 {
  const [a, b, c] = matrix
  const [x, y, z] = vector
  const a_new = a[0] * x + a[1] * y + a[2] * z
  const b_new = b[0] * x + b[1] * y + b[2] * z
  const c_new = c[0] * x + c[1] * y + c[2] * z
  return [a_new, b_new, c_new]
}

export function add<T extends NdVector>(...vecs: T[]): T {
  // add up any number of same-length vectors
  if (vecs.length === 0) throw new Error(`Cannot add zero vectors`)

  const first_vec = vecs[0]
  const length = first_vec.length

  // Validate all vectors have the same length
  for (const vec of vecs) {
    if (vec.length !== length) {
      throw new Error(`All vectors must have the same length`)
    }
  }

  const result = new Array(length).fill(0)
  for (const vec of vecs) {
    for (let idx = 0; idx < length; idx++) {
      result[idx] += vec[idx]
    }
  }
  return result as T
}

export function subtract<T extends NdVector>(vec1: T, vec2: T): T {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vectors must be of same length`)
  }
  return vec1.map((val, idx) => val - vec2[idx]) as T
}

// Validate matrix structure and return column count
function validate_matrix(mat: number[][], name: string): number {
  // Check for empty matrix (no rows)
  if (mat.length === 0) {
    throw new Error(`${name} must have at least one row`)
  }

  if (!mat.every((row) => Array.isArray(row))) {
    throw new Error(
      `${name} must contain only array rows (no undefined/non-array elements)`,
    )
  }

  const cols = mat[0]?.length
  if (!Number.isFinite(cols)) throw new Error(`${name} has no columns`)

  // Check for zero columns
  if (cols === 0) {
    throw new Error(`${name} must have at least one column`)
  }

  if (!mat.every((row) => row.length === cols)) {
    throw new Error(`${name} must be rectangular`)
  }
  return cols
}

export function dot(
  vec1: NdVector | NdVector[],
  vec2: NdVector | NdVector[],
): number | number[] | number[][] {
  const vec1_is_matrix = vec1.some((entry) => Array.isArray(entry))
  const vec2_is_matrix = vec2.some((entry) => Array.isArray(entry))

  // Vector dot product
  if (!vec1_is_matrix && !vec2_is_matrix) {
    const left_vec = vec1 as number[]
    const right_vec = vec2 as number[]
    if (left_vec.length !== right_vec.length) {
      throw new Error(`Vectors must be of same length`)
    }
    return left_vec.reduce((sum, val, idx) => sum + val * right_vec[idx], 0)
  }

  // Matrix-vector multiplication
  if (vec1_is_matrix && !vec2_is_matrix) {
    const mat = vec1 as number[][]
    const vec = vec2 as number[]
    const cols = validate_matrix(mat, `Matrix`)
    if (cols !== vec.length) {
      throw new Error(`Matrix columns must equal vector length`)
    }
    return mat.map((row) => row.reduce((sum, val, idx) => sum + val * vec[idx], 0))
  }

  // Matrix-matrix multiplication
  if (vec1_is_matrix && vec2_is_matrix) {
    const mat1 = vec1 as number[][]
    const mat2 = vec2 as number[][]
    const mat1_cols = validate_matrix(mat1, `First matrix`)
    const mat2_cols = validate_matrix(mat2, `Second matrix`)
    if (mat1_cols !== mat2.length) {
      throw new Error(`First matrix columns must equal second matrix rows`)
    }
    return mat1.map((_, ii) =>
      Array.from(
        { length: mat2_cols },
        (_, jj) =>
          mat1[ii].reduce((sum, _val, kk) => sum + mat1[ii][kk] * mat2[kk][jj], 0),
      )
    )
  }

  throw new Error(`Unsupported input types for dot product`)
}

// Conversion utilities for vectors and tensors below

// Convert 3x3 symmetric tensor to 6-element Voigt notation vector
// Voigt notation maps: (1,1)->1, (2,2)->2, (3,3)->3, (2,3)->4, (1,3)->5, (1,2)->6
export function to_voigt(tensor: number[][]): number[] {
  if (tensor.length !== 3 || !tensor.every((row) => row.length === 3)) {
    throw new Error(
      `Expected 3x3 tensor, got ${tensor.length}x${tensor[0]?.length ?? `n/a`}`,
    )
  }
  const [t11, t12, t13, _t21, t22, t23, _t31, _t32, t33] = tensor.flat()
  return [t11, t22, t33, t23, t13, t12]
}

// Convert 6-element Voigt notation vector to 3x3 symmetric tensor
export function from_voigt(voigt: number[]): number[][] {
  if (voigt.length !== 6) {
    throw new Error(`Expected 6-element Voigt vector, got ${voigt.length} elements`)
  }
  const [v1, v2, v3, v4, v5, v6] = voigt

  return [[v1, v6, v5], [v6, v2, v4], [v5, v4, v3]]
}

// Convert flat 9-element array to 3x3 tensor (row-major order)
export function vec9_to_mat3x3(flat_array: number[]): number[][] {
  if (flat_array.length !== 9) {
    throw new Error(`Expected 9-element array, got ${flat_array.length} elements`)
  }
  const [a1, a2, a3, a4, a5, a6, a7, a8, a9] = flat_array
  return [[a1, a2, a3], [a4, a5, a6], [a7, a8, a9]]
}

// Convert 3x3 tensor to flat 9-element array (row-major order)
export function tensor_to_flat_array(tensor: number[][]): number[] {
  if (tensor.length !== 3 || !tensor.every((row) => row.length === 3)) {
    throw new Error(
      `Expected 3x3 tensor, got ${tensor.length}x${tensor[0]?.length ?? `n/a`}`,
    )
  }

  const [t11, t12, t13, t21, t22, t23, t31, t32, t33] = tensor.flat()
  return [t11, t12, t13, t21, t22, t23, t31, t32, t33]
}

// Transpose a 3x3 matrix
export const transpose_3x3_matrix = (matrix: Matrix3x3): Matrix3x3 => [
  [matrix[0][0], matrix[1][0], matrix[2][0]],
  [matrix[0][1], matrix[1][1], matrix[2][1]],
  [matrix[0][2], matrix[1][2], matrix[2][2]],
]

// Curried fractional→Cartesian converter (caches transposed matrix)
export const create_frac_to_cart = (lattice: Matrix3x3) => {
  const transposed = transpose_3x3_matrix(lattice)
  return (frac: Vec3) => mat3x3_vec3_multiply(transposed, frac)
}

// Curried Cartesian→fractional converter (caches inverse transpose)
export const create_cart_to_frac = (lattice: Matrix3x3) => {
  const inv_transposed = matrix_inverse_3x3(transpose_3x3_matrix(lattice))
  return (cart: Vec3) => mat3x3_vec3_multiply(inv_transposed, cart)
}

// Convert unit cell parameters to lattice matrix (crystallographic convention)
export function cell_to_lattice_matrix(
  a: number,
  b: number,
  c: number,
  alpha: number,
  beta: number,
  gamma: number,
): Matrix3x3 {
  // Convert angles to radians
  const alpha_rad = alpha * DEG_TO_RAD
  const beta_rad = beta * DEG_TO_RAD
  const gamma_rad = gamma * DEG_TO_RAD

  const cos_alpha = Math.cos(alpha_rad)
  const cos_beta = Math.cos(beta_rad)
  const cos_gamma = Math.cos(gamma_rad)
  const sin_gamma = Math.sin(gamma_rad)

  // Calculate volume factor for triclinic system
  const vol_factor = Math.sqrt(
    1 -
      cos_alpha ** 2 -
      cos_beta ** 2 -
      cos_gamma ** 2 +
      2 * cos_alpha * cos_beta * cos_gamma,
  )

  // Standard crystallographic lattice vectors
  const c_x = c * cos_beta
  const c_y = (c * (cos_alpha - cos_beta * cos_gamma)) / sin_gamma
  const c_z = (c * vol_factor) / sin_gamma
  return [
    [a, 0, 0],
    [b * cos_gamma, b * sin_gamma, 0],
    [c_x, c_y, c_z],
  ]
}

export function det_3x3(matrix: Matrix3x3): number {
  // |A| = a(ei − fh) − b(di − fg) + c(dh − eg)
  // where matrix = [[a, b, c], [d, e, f], [g, h, i]]
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = matrix
  return (m00 * (m11 * m22 - m12 * m21) - m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20))
}

export function get_coefficient_of_variation(values: number[]): number {
  if (values.length <= 1) return 0
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length
  const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length
  return Math.abs(mean) > 1e-10
    ? Math.sqrt(variance) / Math.abs(mean)
    : Math.sqrt(variance)
}

// Compute 4x4 determinant (used for 4D barycentric coordinates)
export function det_4x4(matrix: Matrix4x4): number {
  const [a_row, b_row, c_row, d_row] = matrix
  const [a0, a1, a2, a3] = a_row
  const [b0, b1, b2, b3] = b_row
  const [c0, c1, c2, c3] = c_row
  const [d0, d1, d2, d3] = d_row
  return (a0 *
      (b1 * (c2 * d3 - c3 * d2) - b2 * (c1 * d3 - c3 * d1) + b3 * (c1 * d2 - c2 * d1)) -
    a1 *
      (b0 * (c2 * d3 - c3 * d2) - b2 * (c0 * d3 - c3 * d0) + b3 * (c0 * d2 - c2 * d0)) +
    a2 *
      (b0 * (c1 * d3 - c3 * d1) - b1 * (c0 * d3 - c3 * d0) + b3 * (c0 * d1 - c1 * d0)) -
    a3 * (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)))
}

// Compute NxN determinant using LU decomposition with partial pivoting
// More numerically stable than cofactor expansion for N > 4
// Returns 0 for singular/near-singular matrices (pivot < EPS ≈ 1e-10)
export function det_nxn(matrix: number[][]): number {
  const n = matrix.length
  if (n === 0) return 1
  if (!matrix.every((row) => row.length === n)) {
    throw new Error(`det_nxn requires a square matrix`)
  }

  // Fast paths for small matrices
  if (n === 1) return matrix[0][0]
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
  if (n === 3) return det_3x3(matrix as Matrix3x3)
  if (n === 4) return det_4x4(matrix as Matrix4x4)

  // LU decomposition with partial pivoting
  // Create a working copy to avoid mutating input
  const lu = matrix.map((row) => [...row])
  let swaps = 0

  for (let col = 0; col < n; col++) {
    // Find pivot (largest absolute value in column)
    let max_row = col
    let max_val = Math.abs(lu[col][col])
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(lu[row][col])
      if (val > max_val) {
        max_val = val
        max_row = row
      }
    }

    // Singular matrix (or nearly so)
    if (max_val < EPS) return 0

    // Swap rows if needed
    if (max_row !== col) {
      ;[lu[col], lu[max_row]] = [lu[max_row], lu[col]]
      swaps++
    }

    // Eliminate below pivot
    const pivot = lu[col][col]
    for (let row = col + 1; row < n; row++) {
      const factor = lu[row][col] / pivot
      lu[row][col] = 0
      for (let k = col + 1; k < n; k++) {
        lu[row][k] -= factor * lu[col][k]
      }
    }
  }

  // Determinant is product of diagonal elements × (-1)^swaps
  let det = swaps % 2 === 0 ? 1 : -1
  for (let idx = 0; idx < n; idx++) {
    det *= lu[idx][idx]
  }
  return det
}

// 3D cross product
export const cross_3d = (
  vec1: Vec3,
  vec2: Vec3,
): Vec3 => [
  vec1[1] * vec2[2] - vec1[2] * vec2[1],
  vec1[2] * vec2[0] - vec1[0] * vec2[2],
  vec1[0] * vec2[1] - vec1[1] * vec2[0],
]

// Scalar linear interpolation
export const lerp = (start: number, end: number, t: number): number =>
  start + t * (end - start)

// Vec3 linear interpolation
export const lerp_vec3 = (
  start: Vec3,
  end: Vec3,
  t: number,
): Vec3 => [
  start[0] + t * (end[0] - start[0]),
  start[1] + t * (end[1] - start[1]),
  start[2] + t * (end[2] - start[2]),
]

// Centered fractional part: offset from nearest integer, returns value in [-0.5, 0.5)
// Useful for wrapping coordinates to first Brillouin zone or similar periodic domains
export const centered_frac = (val: number): number => {
  let wrapped = val - Math.round(val)
  // Handle floating point edge cases at boundaries (range is [-0.5, 0.5), exclusive at +0.5)
  if (wrapped < -0.5) wrapped += 1
  if (wrapped >= 0.5) wrapped -= 1
  return wrapped || 0 // normalize -0 to 0
}

// Normalize a Vec3 to unit length, returns zero vector if input is zero
export function normalize_vec3(vec: Vec3, fallback?: Vec3): Vec3 {
  const len = Math.hypot(vec[0], vec[1], vec[2])
  if (len < EPS) return fallback ?? [0, 0, 0]
  return [vec[0] / len, vec[1] / len, vec[2] / len]
}

// Compute orthonormal basis vectors in a plane perpendicular to `normal`.
// Uses Gram-Schmidt orthogonalization + cross product.
export function compute_in_plane_basis(normal: Vec3): [Vec3, Vec3] {
  let ref_vec: Vec3 = [1, 0, 0]
  if (Math.abs(normal[0]) > 0.9) ref_vec = [0, 1, 0]

  const dot_nr = dot(normal, ref_vec) as number
  const u_raw: Vec3 = [
    ref_vec[0] - dot_nr * normal[0],
    ref_vec[1] - dot_nr * normal[1],
    ref_vec[2] - dot_nr * normal[2],
  ]
  const u_vec = normalize_vec3(u_raw, [0, 1, 0])
  const v_vec = cross_3d(normal, u_vec)
  return [u_vec, v_vec]
}

// Check whether N 3D points all lie on the same plane within tolerance.
// Fewer than 3 points are trivially coplanar.
// Uses cross product to find a plane normal from non-collinear edges,
// then checks all remaining points have zero distance to that plane.
export function are_coplanar(points: number[][], tolerance = 1e-6): boolean {
  if (points.length < 3) return true
  const origin = points[0]
  // Find first pair of edges from origin that are not collinear
  let normal: Vec3 | null = null
  for (let idx = 1; idx < points.length - 1; idx++) {
    const edge_a: Vec3 = [
      points[idx][0] - origin[0],
      points[idx][1] - origin[1],
      points[idx][2] - origin[2],
    ]
    for (let jdx = idx + 1; jdx < points.length; jdx++) {
      const edge_b: Vec3 = [
        points[jdx][0] - origin[0],
        points[jdx][1] - origin[1],
        points[jdx][2] - origin[2],
      ]
      const cross = cross_3d(edge_a, edge_b)
      const len = Math.hypot(cross[0], cross[1], cross[2])
      if (len > tolerance) {
        normal = [cross[0] / len, cross[1] / len, cross[2] / len]
        break
      }
    }
    if (normal) break
  }
  // All edges are collinear -> all points lie on a line -> coplanar
  if (!normal) return true
  const plane_d = dot(normal, origin) as number
  for (let idx = 1; idx < points.length; idx++) {
    const dist = Math.abs((dot(normal, points[idx]) as number) - plane_d)
    if (dist > tolerance) return false
  }
  return true
}

// Merge coplanar adjacent triangles in a flat non-indexed position array.
// Takes 9 floats per triangle (3 vertices x 3 coords), groups adjacent coplanar
// triangles via union-find, then re-triangulates each group with fan triangulation
// to eliminate internal diagonal edges.
export function merge_coplanar_triangles(
  positions: Float32Array,
  tolerance = 1e-4,
): Float32Array {
  const n_triangles = Math.floor(positions.length / 9)
  if (n_triangles === 0) return new Float32Array(positions)

  // === Step 1: Extract triangles and compute plane for each ===
  type TriPlane = {
    verts: [Vec3, Vec3, Vec3]
    normal: Vec3
    plane_d: number
    degenerate: boolean
  }
  const tri_planes: TriPlane[] = []
  for (let tri_idx = 0; tri_idx < n_triangles; tri_idx++) {
    const base = tri_idx * 9
    const va: Vec3 = [positions[base], positions[base + 1], positions[base + 2]]
    const vb: Vec3 = [positions[base + 3], positions[base + 4], positions[base + 5]]
    const vc: Vec3 = [positions[base + 6], positions[base + 7], positions[base + 8]]
    const edge_ab: Vec3 = [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]]
    const edge_ac: Vec3 = [vc[0] - va[0], vc[1] - va[1], vc[2] - va[2]]
    const raw_normal = cross_3d(edge_ab, edge_ac)
    const len = Math.hypot(raw_normal[0], raw_normal[1], raw_normal[2])
    if (len < tolerance) {
      tri_planes.push({
        verts: [va, vb, vc],
        normal: [0, 0, 0],
        plane_d: 0,
        degenerate: true,
      })
      continue
    }
    // Normalize and canonicalize: first non-zero component must be positive
    let normal: Vec3 = [raw_normal[0] / len, raw_normal[1] / len, raw_normal[2] / len]
    const CANON_EPS = 1e-12
    const first_nonzero = Math.abs(normal[0]) > CANON_EPS
      ? normal[0]
      : Math.abs(normal[1]) > CANON_EPS
      ? normal[1]
      : normal[2]
    if (first_nonzero < 0) normal = [-normal[0], -normal[1], -normal[2]]
    const plane_d = dot(normal, va) as number
    tri_planes.push({ verts: [va, vb, vc], normal, plane_d, degenerate: false })
  }

  // === Step 2: Build adjacency via edge hash map ===
  // Quantize vertex to integer grid for hashing (only used for equality, not coords)
  const vert_key = (v: Vec3): string =>
    `${Math.round(v[0] / tolerance)},${Math.round(v[1] / tolerance)},${
      Math.round(v[2] / tolerance)
    }`
  const edge_key = (va: Vec3, vb: Vec3): string => {
    const ka = vert_key(va)
    const kb = vert_key(vb)
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
  }
  // Map edge -> list of triangle indices sharing that edge
  const edge_to_tris = new Map<string, number[]>()
  for (let tri_idx = 0; tri_idx < n_triangles; tri_idx++) {
    const { verts, degenerate } = tri_planes[tri_idx]
    if (degenerate) continue
    const edges = [
      edge_key(verts[0], verts[1]),
      edge_key(verts[1], verts[2]),
      edge_key(verts[0], verts[2]),
    ]
    for (const ek of edges) {
      const existing = edge_to_tris.get(ek)
      if (existing) existing.push(tri_idx)
      else edge_to_tris.set(ek, [tri_idx])
    }
  }

  // === Step 3: Union-Find grouping of coplanar adjacent triangles ===
  const parent = new Int32Array(n_triangles)
  const rank = new Int32Array(n_triangles)
  for (let idx = 0; idx < n_triangles; idx++) parent[idx] = idx
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]] // path compression
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b)
    if (ra === rb) return
    if (rank[ra] < rank[rb]) parent[ra] = rb
    else if (rank[ra] > rank[rb]) parent[rb] = ra
    else {
      parent[rb] = ra
      rank[ra]++
    }
  }
  for (const tri_list of edge_to_tris.values()) {
    if (tri_list.length !== 2) continue
    const [idx_a, idx_b] = tri_list
    const pa = tri_planes[idx_a]
    const pb = tri_planes[idx_b]
    if (pa.degenerate || pb.degenerate) continue
    // Check coplanarity: same canonical normal direction AND same plane distance
    const normal_dot = pa.normal[0] * pb.normal[0] + pa.normal[1] * pb.normal[1] +
      pa.normal[2] * pb.normal[2]
    if (Math.abs(normal_dot) < 1 - tolerance) continue
    if (Math.abs(pa.plane_d - pb.plane_d) > tolerance) continue
    union(idx_a, idx_b)
  }

  // === Step 4: Collect groups ===
  const groups = new Map<number, number[]>()
  for (let idx = 0; idx < n_triangles; idx++) {
    const root = find(idx)
    const group = groups.get(root)
    if (group) group.push(idx)
    else groups.set(root, [idx])
  }

  // === Step 5: Merge each group and re-triangulate ===
  const output: number[] = []
  // Push a triangle's 3 vertices (9 floats) to the output
  const emit_tri = (va: Vec3, vb: Vec3, vc: Vec3): void => {
    output.push(va[0], va[1], va[2], vb[0], vb[1], vb[2], vc[0], vc[1], vc[2])
  }
  const emit_original = (members: number[]): void => {
    for (const tri_idx of members) {
      const { verts } = tri_planes[tri_idx]
      emit_tri(verts[0], verts[1], verts[2])
    }
  }
  for (const members of groups.values()) {
    if (members.length === 1) {
      emit_original(members)
      continue
    }

    const { normal } = tri_planes[members[0]]
    // Collect all unique vertices from the group
    const seen_keys = new Map<string, Vec3>()
    for (const tri_idx of members) {
      for (const vert of tri_planes[tri_idx].verts) {
        const key = vert_key(vert)
        if (!seen_keys.has(key)) seen_keys.set(key, vert)
      }
    }
    const unique_verts = [...seen_keys.values()]
    if (unique_verts.length < 3) {
      emit_original(members)
      continue
    }

    // Project to 2D using in-plane basis
    const [u_vec, v_vec] = compute_in_plane_basis(normal)
    const pts_2d: Vec2[] = unique_verts.map((vert) =>
      [dot(u_vec, vert) as number, dot(v_vec, vert) as number] as Vec2
    )

    const hull = convex_hull_2d(pts_2d)
    if (hull.length < 3) {
      emit_original(members)
      continue
    }

    // Map 2D hull vertices back to nearest 3D vertex
    const hull_3d: Vec3[] = hull.map((pt) => {
      let best_dist = Infinity
      let best_idx = 0
      for (let idx = 0; idx < pts_2d.length; idx++) {
        const du = pts_2d[idx][0] - pt[0]
        const dv = pts_2d[idx][1] - pt[1]
        const dist = du * du + dv * dv
        if (dist < best_dist) {
          best_dist = dist
          best_idx = idx
        }
      }
      return unique_verts[best_idx]
    })

    // Fan-triangulate from hull vertex 0
    for (let idx = 1; idx < hull_3d.length - 1; idx++) {
      emit_tri(hull_3d[0], hull_3d[idx], hull_3d[idx + 1])
    }
  }

  return new Float32Array(output)
}

// Compute axis-aligned bounding box of Vec3 vertices
export function compute_bounding_box(vertices: Vec3[]): { min: Vec3; max: Vec3 } {
  if (vertices.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] }
  }

  const min: Vec3 = [...vertices[0]]
  const max: Vec3 = [...vertices[0]]

  for (const vert of vertices) {
    if (vert[0] < min[0]) min[0] = vert[0]
    if (vert[1] < min[1]) min[1] = vert[1]
    if (vert[2] < min[2]) min[2] = vert[2]
    if (vert[0] > max[0]) max[0] = vert[0]
    if (vert[1] > max[1]) max[1] = vert[1]
    if (vert[2] > max[2]) max[2] = vert[2]
  }

  return { min, max }
}

// Check if a matrix is square with dimension NxN
export function is_square_matrix(matrix: unknown, dim: number): boolean {
  if (!Array.isArray(matrix)) return false
  if (matrix.length !== dim) return false
  return matrix.every((row) => Array.isArray(row) && row.length === dim)
}

// --- 2D Geometry Utilities ---

// Point-in-polygon test using ray casting algorithm
// Returns true if point (x, y) is inside the polygon defined by vertices
export function point_in_polygon(
  point_x: number,
  point_y: number,
  vertices: Vec2[],
): boolean {
  if (vertices.length < 3) return false
  let [inside, prev_idx] = [false, vertices.length - 1]

  for (let idx = 0; idx < vertices.length; idx++) {
    const [x_i, y_i] = vertices[idx]
    const [x_j, y_j] = vertices[prev_idx]

    // Check if horizontal ray from point crosses this edge
    if (y_i !== y_j && (y_i > point_y) !== (y_j > point_y)) {
      const x_intersect = ((x_j - x_i) * (point_y - y_i)) / (y_j - y_i) + x_i
      if (point_x < x_intersect) inside = !inside
    }
    prev_idx = idx
  }

  return inside
}

// Compute axis-aligned bounding box of 2D vertices
export function compute_bounding_box_2d(vertices: Vec2[]): {
  min: Vec2
  max: Vec2
  width: number
  height: number
} {
  if (vertices.length === 0) {
    return { min: [0, 0], max: [0, 0], width: 0, height: 0 }
  }

  let [min_x, min_y] = vertices[0]
  let [max_x, max_y] = vertices[0]

  for (const [x, y] of vertices) {
    if (x < min_x) min_x = x
    if (x > max_x) max_x = x
    if (y < min_y) min_y = y
    if (y > max_y) max_y = y
  }

  const width = max_x - min_x
  const height = max_y - min_y
  return { min: [min_x, min_y], max: [max_x, max_y], width, height }
}

// Calculate true geometric centroid of a polygon using shoelace formula
// Falls back to vertex average for degenerate cases (< 3 vertices or zero area)
export function polygon_centroid(vertices: Vec2[]): Vec2 {
  if (vertices.length === 0) return [0, 0]
  if (vertices.length < 3) {
    const sum_x = vertices.reduce((acc, [x]) => acc + x, 0)
    const sum_y = vertices.reduce((acc, [, y]) => acc + y, 0)
    return [sum_x / vertices.length, sum_y / vertices.length]
  }

  let [signed_area, cx, cy] = [0, 0, 0]

  for (let idx = 0; idx < vertices.length; idx++) {
    const [x0, y0] = vertices[idx]
    const [x1, y1] = vertices[(idx + 1) % vertices.length]
    const cross = x0 * y1 - x1 * y0
    signed_area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }

  signed_area *= 0.5

  // Fall back to vertex average for degenerate polygons
  if (Math.abs(signed_area) < EPS) {
    const sum_x = vertices.reduce((acc, [x]) => acc + x, 0)
    const sum_y = vertices.reduce((acc, [, y]) => acc + y, 0)
    return [sum_x / vertices.length, sum_y / vertices.length]
  }

  const factor = 1 / (6 * signed_area)
  return [cx * factor, cy * factor]
}

// Solve linear system Ax = b via LU decomposition with partial pivoting.
// Returns null if the system is singular (no unique solution).
// Fast-paths for 2x2 (Cramer's rule) and 3x3 (matrix inverse).
export function solve_linear_system(
  A: number[][], // NxN coefficient matrix
  b: number[], // N-element right-hand side
): number[] | null {
  const n = A.length
  if (n === 0 || b.length !== n || !A.every((row) => row.length === n)) return null

  // 2x2 fast path via Cramer's rule
  if (n === 2) {
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0]
    if (Math.abs(det) < EPS) return null
    return [
      (b[0] * A[1][1] - b[1] * A[0][1]) / det,
      (A[0][0] * b[1] - A[1][0] * b[0]) / det,
    ]
  }

  // 3x3 fast path via matrix inverse
  if (n === 3) {
    const det = det_3x3(A as Matrix3x3)
    if (Math.abs(det) < EPS) return null
    const inv = matrix_inverse_3x3(A as Matrix3x3)
    return mat3x3_vec3_multiply(inv, b as Vec3) as number[]
  }

  // General NxN: LU decomposition with partial pivoting + forward/back substitution
  const lu = A.map((row) => [...row])
  const perm = Array.from({ length: n }, (_, idx) => idx)

  for (let col = 0; col < n; col++) {
    // Find pivot
    let max_row = col
    let max_val = Math.abs(lu[col][col])
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(lu[row][col])
      if (val > max_val) {
        max_val = val
        max_row = row
      }
    }
    if (max_val < EPS) return null // singular

    // Swap rows
    if (max_row !== col) {
      ;[lu[col], lu[max_row]] = [lu[max_row], lu[col]]
      ;[perm[col], perm[max_row]] = [perm[max_row], perm[col]]
    }

    // Eliminate below pivot
    const pivot = lu[col][col]
    for (let row = col + 1; row < n; row++) {
      const factor = lu[row][col] / pivot
      lu[row][col] = factor // store L factor in lower triangle
      for (let k = col + 1; k < n; k++) {
        lu[row][k] -= factor * lu[col][k]
      }
    }
  }

  // Apply permutation to b
  const pb = perm.map((idx) => b[idx])

  // Forward substitution (Ly = Pb)
  for (let row = 1; row < n; row++) {
    for (let col = 0; col < row; col++) {
      pb[row] -= lu[row][col] * pb[col]
    }
  }

  // Back substitution (Ux = y)
  const x = new Array(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = pb[row]
    for (let col = row + 1; col < n; col++) {
      sum -= lu[row][col] * x[col]
    }
    x[row] = sum / lu[row][row]
  }

  return x
}

// Full 2D convex hull via Andrew's monotone chain algorithm.
// Returns vertices in counter-clockwise order.
export function convex_hull_2d(points: Vec2[]): Vec2[] {
  if (points.length < 3) return [...points]

  const sorted = [...points].sort(
    (a, b) => (a[0] - b[0]) || (a[1] - b[1]),
  )

  const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  // Lower hull
  const lower: Vec2[] = []
  for (const pt of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0
    ) {
      lower.pop()
    }
    lower.push(pt)
  }

  // Upper hull
  const upper: Vec2[] = []
  for (let idx = sorted.length - 1; idx >= 0; idx--) {
    const pt = sorted[idx]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0
    ) {
      upper.pop()
    }
    upper.push(pt)
  }

  // Remove last point of each half (it's the first point of the other)
  lower.pop()
  upper.pop()

  return [...lower, ...upper]
}
