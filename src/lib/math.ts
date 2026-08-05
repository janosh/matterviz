import type { LatticeParams, Pbc } from '$lib/structure/index'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]
export type Vec5 = [number, number, number, number, number]
export type Vec9 = [number, number, number, number, number, number, number, number, number]
export type Point2D = { x: number; y: number }
export type Point3D = Point2D & { z: number }
export type Matrix3x3 = [Vec3, Vec3, Vec3]
export type Matrix4x4 = [Vec4, Vec4, Vec4, Vec4]
export type NdVector = number[]

export const is_finite_vec3_like = (
  values: ArrayLike<unknown> | undefined,
): values is ArrayLike<number> => {
  if (values?.length !== 3) return false
  return [0, 1, 2].every(
    (idx) => typeof values[idx] === `number` && Number.isFinite(values[idx]),
  )
}

export const finite_vec3_from_values = (
  values: ArrayLike<unknown> | undefined,
): Vec3 | undefined => {
  if (!is_finite_vec3_like(values)) return undefined
  return [values[0], values[1], values[2]]
}

// Column-major 4x4 matrix as flat 16-element tuple (for Three.js/WebGL)
// oxfmt-ignore
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
const MAX_MIN_IMAGE_CANDIDATES = 100_000

export const to_degrees = (radians: number): number => radians * RAD_TO_DEG
export const to_radians = (degrees: number): number => degrees * DEG_TO_RAD

// Calculate all lattice parameters in a single efficient pass
export function calc_lattice_params(matrix: Matrix3x3): LatticeParams & { volume: number } {
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

  // Convert to angles in degrees. Two ways this yields NaN without the guard: parallel
  // vectors, where the dot product and the two hypot calls round differently and the
  // ratio exceeds 1 (a_vec = b_vec = (1,1,1) gives 1.0000000000000002), and a zero-length
  // vector giving 0/0 - which is exactly what 2D/slab/molecule parse paths produce. The
  // NaN then propagates silently into every derived quantity. angle_between_vectors in
  // measure.ts needs the same [-1, 1] clamp for the same reason.
  //
  // Its zero-length sentinel is 0, not 90, and the difference is deliberate: for bond
  // vectors 0 means "no direction", but a slab reported as alpha = beta = 0 drives the
  // triclinic volume radicand 1 - cos²α - cos²β - cos²γ + 2cosαcosβcosγ to -1, so
  // cell_to_lattice_matrix rejects the cell. 90 keeps it at 1 and round-trips.
  const safe_angle = (dot: number, len_1: number, len_2: number): number => {
    const denom = len_1 * len_2
    if (denom === 0) return 90 // degenerate axis: orthogonal keeps the cell round-trippable
    return Math.acos(Math.max(-1, Math.min(1, dot / denom))) * RAD_TO_DEG
  }
  const alpha = safe_angle(dot_bc, b, c)
  const beta = safe_angle(dot_ac, a, c)
  const gamma = safe_angle(dot_ab, a, b)

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

const vec3_norm_sq = (vec: Vec3): number => vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2

// Exact minimum-image displacement for row-vector lattices.
// Rounded fractional wrapping is only approximate for highly skewed cells, so
// we use it as a starting guess and then search the small set of shifts that
// can still beat that Cartesian radius.
export function min_image_displacement(
  from: Vec3,
  to: Vec3,
  lattice_matrix: Matrix3x3,
  converters?: LatticeConverters,
  pbc: Pbc = [true, true, true],
): Vec3 {
  const { cart_to_frac, frac_to_cart, reciprocal_axis_norms } =
    converters ?? create_lattice_converters(lattice_matrix)
  const frac_from = cart_to_frac(from)
  const frac_to = cart_to_frac(to)
  const frac_diff: Vec3 = [
    frac_to[0] - frac_from[0],
    frac_to[1] - frac_from[1],
    frac_to[2] - frac_from[2],
  ]
  const wrapped_frac_diff: Vec3 = [
    pbc[0] ? frac_diff[0] - Math.round(frac_diff[0]) : frac_diff[0],
    pbc[1] ? frac_diff[1] - Math.round(frac_diff[1]) : frac_diff[1],
    pbc[2] ? frac_diff[2] - Math.round(frac_diff[2]) : frac_diff[2],
  ]

  let best_displacement = frac_to_cart(wrapped_frac_diff)
  let best_dist_sq = vec3_norm_sq(best_displacement)
  const search_radius = Math.sqrt(best_dist_sq) + EPS
  const candidate_shift_ranges = ([0, 1, 2] as const).map((axis_idx) => {
    if (!pbc[axis_idx]) return [0, 0] as const
    const axis_bound = reciprocal_axis_norms[axis_idx] * search_radius
    return [
      Math.ceil(-frac_diff[axis_idx] - axis_bound),
      Math.floor(-frac_diff[axis_idx] + axis_bound),
    ] as const
  })
  let candidate_count = 1
  for (const [shift_min, shift_max] of candidate_shift_ranges) {
    candidate_count *= shift_max - shift_min + 1
    if (candidate_count > MAX_MIN_IMAGE_CANDIDATES) {
      throw new Error(
        `Minimum-image search would test >${MAX_MIN_IMAGE_CANDIDATES} candidates ` +
          `for lattice ${JSON.stringify(lattice_matrix)}; reciprocal norms=` +
          `${JSON.stringify(reciprocal_axis_norms)} ranges=${JSON.stringify(candidate_shift_ranges)}`,
      )
    }
  }
  const [[i_min, i_max], [j_min, j_max], [k_min, k_max]] = candidate_shift_ranges

  // Only test integer shifts that reciprocal-space bounds say could still win.
  for (let ii = i_min; ii <= i_max; ii++) {
    for (let jj = j_min; jj <= j_max; jj++) {
      for (let kk = k_min; kk <= k_max; kk++) {
        const candidate_frac_diff: Vec3 = [
          frac_diff[0] + ii,
          frac_diff[1] + jj,
          frac_diff[2] + kk,
        ]
        const candidate_displacement = frac_to_cart(candidate_frac_diff)
        const candidate_dist_sq = vec3_norm_sq(candidate_displacement)
        if (candidate_dist_sq < best_dist_sq) {
          best_dist_sq = candidate_dist_sq
          best_displacement = candidate_displacement
        }
      }
    }
  }

  return best_displacement
}

// Calculate the minimum distance between two points considering periodic boundary conditions.
export const pbc_dist = (
  pos1: Vec3,
  pos2: Vec3,
  lattice_matrix: Matrix3x3,
  converters?: LatticeConverters,
  pbc: Pbc = [true, true, true],
): number => Math.hypot(...min_image_displacement(pos1, pos2, lattice_matrix, converters, pbc))

// Shared shape guard for the matrix-taking entry points below. Names the offender and
// dumps its value so a malformed cell is identifiable from the message alone.
const assert_finite_3x3 = (matrix: Matrix3x3, name: string): void => {
  if (!is_square_matrix(matrix, 3)) {
    throw new Error(`${name} must be a finite 3x3 matrix, got ${JSON.stringify(matrix)}`)
  }
}

// A single frame's cell, or nothing when that frame has no periodicity to undo
export type FrameLattice = Matrix3x3 | null | undefined
// Either one fixed cell for the whole run, or one cell per frame (NPT)
export type UnwrapLattices = Matrix3x3 | FrameLattice[] | null | undefined

// A Matrix3x3's entries are Vec3s of numbers; a per-frame list's entries are
// matrices or nullish. Only a list whose every entry is a numeric row is a single
// fixed cell, so an all-null per-frame list stays per-frame instead of being fed
// to the fixed-cell validator.
const is_per_frame_lattices = (
  lattices: NonNullable<UnwrapLattices>,
): lattices is FrameLattice[] =>
  !lattices.every((entry) => Array.isArray(entry) && typeof entry[0] === `number`)

// Turn per-frame WRAPPED Cartesian positions into a continuous unwrapped trajectory
// by accumulating minimum-image displacements between consecutive frames. Atom
// order is the atom identity, so it must be identical in every frame.
//
// CALLER BEWARE: the input must be wrapped coordinates. Feeding coordinates that
// are ALREADY unwrapped (e.g. a LAMMPS dump with xu/yu/zu columns, which the
// parser flags as `coords_unwrapped: true` on the frame metadata) re-applies the
// minimum image convention and silently truncates every real displacement longer
// than half a cell — check that flag before calling this.
//
// `lattice_matrices` takes a single fixed cell or one cell per frame (NPT runs
// where the box fluctuates). A null/undefined cell means nothing was wrapped, so
// we fall through to plain subtraction the way `displacement_pbc` does.
export function unwrap_positions(
  frames: Vec3[][],
  lattice_matrices: UnwrapLattices,
  pbc: Pbc = [true, true, true],
): Vec3[][] {
  if (frames.length === 0) return []

  // Split in an if/else so the guard's false branch narrows to the fixed cell.
  // Deriving one from the other keeps the whole union on both.
  let per_frame_lattices: FrameLattice[] | null = null
  let fixed_lattice: Matrix3x3 | null = null
  if (lattice_matrices != null) {
    if (is_per_frame_lattices(lattice_matrices)) per_frame_lattices = lattice_matrices
    else fixed_lattice = lattice_matrices
  }
  if (fixed_lattice != null) assert_finite_3x3(fixed_lattice, `unwrap_positions lattice`)
  if (per_frame_lattices && per_frame_lattices.length !== frames.length) {
    throw new Error(
      `unwrap_positions: got ${per_frame_lattices.length} lattice matrices for ` +
        `${frames.length} frames; per-frame lattices must be one per frame`,
    )
  }
  // Built once for a fixed cell: each rebuild inverts a 3x3, and the atom loop
  // below runs O(n_frames * n_atoms) times.
  const fixed_converters = fixed_lattice ? create_lattice_converters(fixed_lattice) : null

  // Copy frame 0 verbatim so the output never aliases the input
  const unwrapped: Vec3[][] = [frames[0].map((pos): Vec3 => [pos[0], pos[1], pos[2]])]
  // Frame 0's own cell is never seen by the per-frame check below, since the loop starts at
  // 1, yet later frames with a missing lattice fall back to it. Unchecked, a NaN here would
  // propagate through every one of them.
  const frame_0_lattice = per_frame_lattices?.[0] ?? null
  if (frame_0_lattice != null) {
    assert_finite_3x3(frame_0_lattice, `unwrap_positions frame 0 lattice`)
  }
  // Most recent non-null cell, used for frames whose own lattice entry is missing
  let last_lattice: Matrix3x3 | null = frame_0_lattice ?? fixed_lattice

  for (let frame_idx = 1; frame_idx < frames.length; frame_idx++) {
    const prev_frame = frames[frame_idx - 1]
    const curr_frame = frames[frame_idx]
    if (curr_frame.length !== prev_frame.length) {
      throw new Error(
        `unwrap_positions: atom count changed at frame ${frame_idx} ` +
          `(${prev_frame.length} atoms in frame ${frame_idx - 1}, ${curr_frame.length} in ` +
          `frame ${frame_idx}); unwrapping needs a fixed atom ordering across frames`,
      )
    }
    const frame_lattice = per_frame_lattices ? per_frame_lattices[frame_idx] : fixed_lattice
    if (frame_lattice != null) {
      assert_finite_3x3(frame_lattice, `unwrap_positions frame ${frame_idx} lattice`)
      last_lattice = frame_lattice
    }
    // Carry the last known cell into frames whose own lattice is missing: a null entry
    // mid-trajectory is a parse gap, not an aperiodic frame, and its neighbours ARE
    // wrapped, so a plain difference there admits a jump of up to one box length that
    // then propagates through the whole cumulative unwrap.
    const lattice = frame_lattice ?? last_lattice
    // Hoisted out of the atom loop; reuses the cached converters for a fixed cell
    const converters = lattice
      ? (fixed_converters ?? create_lattice_converters(lattice))
      : null

    const prev_unwrapped = unwrapped[frame_idx - 1]
    const curr_unwrapped: Vec3[] = Array.from({ length: curr_frame.length })
    for (let atom_idx = 0; atom_idx < curr_frame.length; atom_idx++) {
      const from = prev_frame[atom_idx]
      const to = curr_frame[atom_idx]
      const step =
        lattice && converters
          ? min_image_displacement(from, to, lattice, converters, pbc)
          : subtract(to, from)
      const base = prev_unwrapped[atom_idx]
      curr_unwrapped[atom_idx] = [base[0] + step[0], base[1] + step[1], base[2] + step[2]]
    }
    unwrapped.push(curr_unwrapped)
  }

  return unwrapped
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
  return [
    a[0] * x + a[1] * y + a[2] * z,
    b[0] * x + b[1] * y + b[2] * z,
    c[0] * x + c[1] * y + c[2] * z,
  ]
}

// Add up any number of same-length vectors
export function add<T extends NdVector>(...vecs: T[]): T {
  if (vecs.length === 0) throw new Error(`Cannot add zero vectors`)

  const length = vecs[0].length
  if (vecs.some((vec) => vec.length !== length)) {
    throw new Error(`All vectors must have the same length`)
  }

  const result = Array.from<number>({ length }).fill(0)
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
  if (mat.length === 0) throw new Error(`${name} must have at least one row`)
  if (!mat.every((row) => Array.isArray(row))) {
    throw new Error(`${name} must contain only array rows (no undefined/non-array elements)`)
  }
  const cols = mat[0].length
  if (cols === 0) throw new Error(`${name} must have at least one column`)
  if (!mat.every((row) => row.length === cols)) {
    throw new Error(`${name} must be rectangular`)
  }
  return cols
}

// Tuple-preserving overloads first: 3x3 inputs keep their Matrix3x3/Vec3 shape
export function dot(vec1: Matrix3x3, vec2: Matrix3x3): Matrix3x3
export function dot(vec1: Matrix3x3, vec2: Vec3): Vec3
export function dot(vec1: NdVector, vec2: NdVector): number
export function dot(vec1: NdVector[], vec2: NdVector): number[]
export function dot(vec1: NdVector[], vec2: NdVector[]): number[][]
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
    return mat1.map((_row, ii) =>
      Array.from({ length: mat2_cols }, (_col, jj) =>
        mat1[ii].reduce((sum, _val, kk) => sum + mat1[ii][kk] * mat2[kk][jj], 0),
      ),
    )
  }

  throw new Error(`Unsupported input types for dot product`)
}

// Conversion utilities for vectors and tensors below

// Convert 3x3 symmetric tensor to 6-element Voigt notation vector
// Voigt notation maps: (1,1)->1, (2,2)->2, (3,3)->3, (2,3)->4, (1,3)->5, (1,2)->6
export function to_voigt(tensor: number[][]): number[] {
  if (tensor.length !== 3 || !tensor.every((row) => row.length === 3)) {
    throw new Error(`Expected 3x3 tensor, got ${tensor.length}x${tensor[0]?.length ?? `n/a`}`)
  }
  const [t11, t12, t13, _t21, t22, t23, _t31, _t32, t33] = tensor.flat()
  return [t11, t22, t33, t23, t13, t12]
}

// Convert 6-element Voigt notation vector to 3x3 symmetric tensor
export function from_voigt(voigt: number[]): Matrix3x3 {
  if (voigt.length !== 6) {
    throw new Error(`Expected 6-element Voigt vector, got ${voigt.length} elements`)
  }
  const [v1, v2, v3, v4, v5, v6] = voigt

  return [
    [v1, v6, v5],
    [v6, v2, v4],
    [v5, v4, v3],
  ]
}

// Convert flat 9-element array to 3x3 tensor (row-major order)
export function vec9_to_mat3x3(flat_array: number[]): Matrix3x3 {
  if (flat_array.length !== 9) {
    throw new Error(`Expected 9-element array, got ${flat_array.length} elements`)
  }
  const [a1, a2, a3, a4, a5, a6, a7, a8, a9] = flat_array
  return [
    [a1, a2, a3],
    [a4, a5, a6],
    [a7, a8, a9],
  ]
}

// Convert 3x3 tensor to flat 9-element array (row-major order)
export function tensor_to_flat_array(tensor: number[][]): number[] {
  if (tensor.length !== 3 || !tensor.every((row) => row.length === 3)) {
    throw new Error(`Expected 3x3 tensor, got ${tensor.length}x${tensor[0]?.length ?? `n/a`}`)
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

// Scale each row of a 3x3 matrix by the corresponding element of a Vec3.
// Used to scale lattice vectors by supercell factors.
export function scale_lattice_matrix(
  orig_matrix: Matrix3x3,
  scaling_factors: Vec3,
): Matrix3x3 {
  const [nx, ny, nz] = scaling_factors
  const [a, b, c] = orig_matrix
  return [
    [a[0] * nx, a[1] * nx, a[2] * nx],
    [b[0] * ny, b[1] * ny, b[2] * ny],
    [c[0] * nz, c[1] * nz, c[2] * nz],
  ]
}

// Matrix mapping Cartesian coords to fractional (inverse of transposed
// row-vector lattice). Prefer create_cart_to_frac unless the raw matrix is
// needed, e.g. for allocation-free scalar arithmetic in hot loops.
export const create_cart_to_frac_matrix = (lattice: Matrix3x3): Matrix3x3 =>
  matrix_inverse_3x3(transpose_3x3_matrix(lattice))

// Curried fractional→Cartesian converter (caches transposed matrix)
export const create_frac_to_cart = (lattice: Matrix3x3) => {
  const transposed = transpose_3x3_matrix(lattice)
  return (frac: Vec3): Vec3 => mat3x3_vec3_multiply(transposed, frac)
}

// Curried Cartesian→fractional converter (caches inverse transpose)
export const create_cart_to_frac = (lattice: Matrix3x3) => {
  const cart_to_frac_mat = create_cart_to_frac_matrix(lattice)
  return (cart: Vec3): Vec3 => mat3x3_vec3_multiply(cart_to_frac_mat, cart)
}

// Paired converters for a lattice — the safe way to do cart↔frac conversion.
// Encapsulates the transpose convention so callers never touch raw matrices.
export type LatticeConverters = {
  cart_to_frac: (v: Vec3) => Vec3
  frac_to_cart: (v: Vec3) => Vec3
  reciprocal_axis_norms: Vec3
}

export const create_lattice_converters = (lattice: Matrix3x3): LatticeConverters => {
  const cart_to_frac_mat = create_cart_to_frac_matrix(lattice)
  return {
    cart_to_frac: (cart: Vec3): Vec3 => mat3x3_vec3_multiply(cart_to_frac_mat, cart),
    frac_to_cart: create_frac_to_cart(lattice),
    reciprocal_axis_norms: cart_to_frac_mat.map((row) => Math.hypot(...row)) as Vec3,
  }
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

  // Calculate volume factor for triclinic system. The radicand goes negative whenever the
  // angle triple violates the triclinic inequality, and sin_gamma is zero at gamma 0/180.
  // Both used to sail through as NaN: (3,3,3,170,170,170) returned a c vector of
  // [-2.95, -33.77, NaN] - already nonsense at c_y, which should have length 3 - so one
  // mistyped CIF angle turned every derived Cartesian coordinate into NaN with no
  // diagnostic anywhere. Fail here instead, naming the offending parameters.
  const radicand =
    1 - cos_alpha ** 2 - cos_beta ** 2 - cos_gamma ** 2 + 2 * cos_alpha * cos_beta * cos_gamma
  const cell_desc = `a=${a} b=${b} c=${c} alpha=${alpha} beta=${beta} gamma=${gamma}`
  // sin_gamma first: at gamma = 180° the radicand also lands (just) below zero, and
  // "a and b are collinear" is the more actionable of the two diagnoses
  // Tolerance, not === 0: Math.sin(Math.PI) is 1.22e-16, so gamma = 180° would slip past
  // an exact test and surface as the less useful "not realizable" error below
  if (Math.abs(sin_gamma) < 1e-12) {
    throw new Error(
      `Cell has gamma=${gamma}° (${cell_desc}), making the a and b axes collinear and the ` +
        `cell degenerate. Lattice vectors are undefined.`,
    )
  }
  if (radicand < 0) {
    throw new Error(
      `Cell angles do not describe a realizable lattice (${cell_desc}): the triclinic ` +
        `volume factor 1 - cos²α - cos²β - cos²γ + 2cosαcosβcosγ is ${radicand}, which ` +
        `must be >= 0. Check for a mistyped angle.`,
    )
  }
  const vol_factor = Math.sqrt(radicand)

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
  return (
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20)
  )
}

// === Integer lattice transformations ===

// Validate an integer 3x3 matrix and return its determinant. Entries must be integers
// (fractional entries do not map a lattice onto a commensurate lattice) and the
// determinant must be non-zero (a singular matrix collapses the cell to zero volume and
// leaves a Hermite pivot undefined). BigInt because each cofactor term multiplies three
// entries, so a float determinant stops being exact past entries of cbrt(2^53) ~ 2e5 and
// rounds some singular matrices to non-zero, handing hermite_normal_form a zero pivot.
// Stays a bigint on the way out: only transformation_cell_multiplicity needs a number, and
// narrowing here would also reject the large-determinant matrices hermite_normal_form handles.
function validate_int_matrix_3x3(matrix: Matrix3x3, name: string): bigint {
  assert_finite_3x3(matrix, name)
  const non_integer = matrix.flat().filter((val) => !Number.isSafeInteger(val))
  if (non_integer.length > 0) {
    throw new Error(
      `${name} must have integer entries, got ${JSON.stringify(non_integer)} ` +
        `in ${JSON.stringify(matrix)}`,
    )
  }
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = matrix.map((row) =>
    row.map(BigInt),
  )
  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20)
  if (det === 0n) {
    throw new Error(`${name} is singular (determinant 0): ${JSON.stringify(matrix)}`)
  }
  return det
}

// Transform a lattice by an integer matrix P: M_new = P · M_old. Under the
// row-vector convention that means a' = P[0][0]·a + P[0][1]·b + P[0][2]·c, so an
// integer P maps the lattice onto a commensurate super- or sub-lattice.
// Replicating the sites into the new cell is the caller's job — see
// transformation_cell_multiplicity for how many copies that takes.
export function apply_transformation_matrix(
  transform: Matrix3x3,
  lattice_matrix: Matrix3x3,
): Matrix3x3 {
  validate_int_matrix_3x3(transform, `Transformation matrix`)
  assert_finite_3x3(lattice_matrix, `Lattice matrix`)
  return dot(transform, lattice_matrix)
}

// Number of primitive cells inside a cell transformed by P, i.e. |det(P)|. This is
// the factor the site count grows by under apply_transformation_matrix.
export function transformation_cell_multiplicity(transform: Matrix3x3): number {
  const det = validate_int_matrix_3x3(transform, `Transformation matrix`)
  const abs_det = det < 0n ? -det : det
  const multiplicity = Number(abs_det)
  // The determinant is exact, so this conversion is the only place that precision can be
  // lost. A rounded count would misreport how many site copies the transform takes.
  if (!Number.isSafeInteger(multiplicity)) {
    throw new RangeError(
      `Transformation matrix has |determinant| ${abs_det}, beyond the safe integer ` +
        `range: ${JSON.stringify(transform)}`,
    )
  }
  return multiplicity
}

// Greatest common divisor of two integers, taken on absolute values. gcd(0, 0) = 0.
export function gcd(val_a: number, val_b: number): number {
  if (!Number.isSafeInteger(val_a) || !Number.isSafeInteger(val_b)) {
    throw new TypeError(`gcd requires safe integers, got (${val_a}, ${val_b})`)
  }
  let [left, right] = [Math.abs(val_a), Math.abs(val_b)]
  while (right !== 0) [left, right] = [right, left % right]
  return left
}

// n-ary gcd. Empty input gives 0, gcd's identity element (consistent with gcd(0, 0)).
export const gcd_all = (values: number[]): number =>
  values.reduce((acc, val) => gcd(acc, val), 0)

// Reduce Miller indices to the smallest equivalent integer triple, e.g. (2,2,0) →
// (1,1,0). (0,0,0) picks out no plane, so it is returned unchanged instead of
// dividing by zero. Signs are kept: (h,k,l) and (-h,-k,-l) are opposite surfaces.
export function reduce_miller_indices(hkl: Vec3): Vec3 {
  const divisor = gcd_all(hkl)
  if (divisor === 0) return [hkl[0], hkl[1], hkl[2]]
  return [hkl[0] / divisor, hkl[1] / divisor, hkl[2] / divisor]
}

// hnf is upper triangular with a positive diagonal and every entry above a pivot
// reduced into [0, pivot); transform is unimodular (integer, |det| = 1) and
// satisfies transform · matrix = hnf.
export type HermiteNormalForm = { hnf: Matrix3x3; transform: Matrix3x3 }

// Row-style Hermite Normal Form of an integer 3x3 matrix. With row-vector lattices
// the HNF rows are integer combinations of the input lattice vectors, so hnf is a
// canonical cell for the very same lattice — the usual starting point for building
// a Miller-index slab. Feed transform to apply_transformation_matrix to get there.
// All arithmetic runs in BigInt because the intermediates outgrow float64's exact
// integer range: `factor * work[source][col]` in the above-pivot reduction exceeds
// 2^53 once entries reach ~1e3, and past that Number rounds and the result is wrong.
// Requires a non-singular matrix: a zero pivot has no well-defined reduction.
export function hermite_normal_form(matrix: Matrix3x3): HermiteNormalForm {
  validate_int_matrix_3x3(matrix, `hermite_normal_form matrix`)

  const work = matrix.map((row) => row.map(BigInt))
  const uni = [
    [1n, 0n, 0n],
    [0n, 1n, 0n],
    [0n, 0n, 1n],
  ]
  const swap_rows = (row_a: number, row_b: number): void => {
    ;[work[row_a], work[row_b]] = [work[row_b], work[row_a]]
    ;[uni[row_a], uni[row_b]] = [uni[row_b], uni[row_a]]
  }
  const negate_row = (row_idx: number): void => {
    for (let col = 0; col < 3; col++) {
      work[row_idx][col] = -work[row_idx][col]
      uni[row_idx][col] = -uni[row_idx][col]
    }
  }
  // row_target -= factor * row_source, applied to both matrices in lockstep so the
  // invariant uni · matrix === work holds after every operation
  const reduce_row = (row_target: number, row_source: number, factor: bigint): void => {
    if (factor === 0n) return
    for (let col = 0; col < 3; col++) {
      work[row_target][col] -= factor * work[row_source][col]
      uni[row_target][col] -= factor * uni[row_source][col]
    }
  }
  const abs_big = (val: bigint): bigint => (val < 0n ? -val : val)

  // Clear each column below the diagonal by the Euclidean algorithm on rows
  for (let col = 0; col < 3; col++) {
    for (let row = col + 1; row < 3; row++) {
      while (work[row][col] !== 0n) {
        // Keep the larger magnitude in the lower row so the quotient is non-zero and
        // the remainder strictly shrinks each pass, which is what makes this terminate
        if (work[col][col] === 0n || abs_big(work[col][col]) > abs_big(work[row][col])) {
          swap_rows(col, row)
        }
        if (work[row][col] === 0n) break
        reduce_row(row, col, work[row][col] / work[col][col]) // BigInt / truncates toward zero
      }
    }
    // Non-singular input guarantees a non-zero pivot in every column
    if (work[col][col] < 0n) negate_row(col)
  }

  // Reduce entries above each pivot into [0, pivot) using floor division
  for (let col = 1; col < 3; col++) {
    const pivot = work[col][col]
    for (let row = 0; row < col; row++) {
      const numerator = work[row][col]
      let quotient = numerator / pivot
      // pivot is positive here, so only a negative numerator needs the floor correction
      if (numerator < 0n && numerator % pivot !== 0n) quotient -= 1n
      reduce_row(row, col, quotient)
    }
  }

  const to_matrix = (rows: bigint[][], name: string): Matrix3x3 =>
    rows.map((row) =>
      row.map((val) => {
        const as_number = Number(val)
        if (!Number.isSafeInteger(as_number)) {
          throw new TypeError(
            `hermite_normal_form ${name} entry ${val} exceeds safe integer range`,
          )
        }
        return as_number
      }),
    ) as Matrix3x3

  return { hnf: to_matrix(work, `hnf`), transform: to_matrix(uni, `transform`) }
}

export function get_coefficient_of_variation(values: number[]): number {
  if (values.length <= 1) return 0
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length
  const variance = values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length
  return Math.abs(mean) > 1e-10 ? Math.sqrt(variance) / Math.abs(mean) : Math.sqrt(variance)
}

// Compute 4x4 determinant (used for 4D barycentric coordinates)
export function det_4x4(matrix: Matrix4x4): number {
  const [a_row, b_row, c_row, d_row] = matrix
  const [a0, a1, a2, a3] = a_row
  const [b0, b1, b2, b3] = b_row
  const [c0, c1, c2, c3] = c_row
  const [d0, d1, d2, d3] = d_row
  return (
    a0 * (b1 * (c2 * d3 - c3 * d2) - b2 * (c1 * d3 - c3 * d1) + b3 * (c1 * d2 - c2 * d1)) -
    a1 * (b0 * (c2 * d3 - c3 * d2) - b2 * (c0 * d3 - c3 * d0) + b3 * (c0 * d2 - c2 * d0)) +
    a2 * (b0 * (c1 * d3 - c3 * d1) - b1 * (c0 * d3 - c3 * d0) + b3 * (c0 * d1 - c1 * d0)) -
    a3 * (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0))
  )
}

// Compute NxN determinant using LU decomposition with partial pivoting
// More numerically stable than cofactor expansion for N > 4
// Returns 0 for singular/near-singular matrices (pivot < EPS ≈ 1e-10)
export function det_nxn(matrix: number[][]): number {
  const mat_size = matrix.length
  if (mat_size === 0) return 1
  if (!matrix.every((row) => row.length === mat_size)) {
    throw new Error(`det_nxn requires a square matrix`)
  }

  // Fast paths for small matrices
  if (mat_size === 1) return matrix[0][0]
  if (mat_size === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]
  if (mat_size === 3) return det_3x3(matrix as Matrix3x3)
  if (mat_size === 4) return det_4x4(matrix as Matrix4x4)

  // LU decomposition with partial pivoting
  // Create a working copy to avoid mutating input
  const lu = matrix.map((row) => [...row])
  let swaps = 0

  for (let col = 0; col < mat_size; col++) {
    // Find pivot (largest absolute value in column)
    let [max_row, max_val] = [col, Math.abs(lu[col][col])]
    for (let row = col + 1; row < mat_size; row++) {
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
    for (let row = col + 1; row < mat_size; row++) {
      const factor = lu[row][col] / pivot
      lu[row][col] = 0
      for (let k = col + 1; k < mat_size; k++) {
        lu[row][k] -= factor * lu[col][k]
      }
    }
  }

  // Determinant is product of diagonal elements × (-1)^swaps
  let det = swaps % 2 === 0 ? 1 : -1
  for (let idx = 0; idx < mat_size; idx++) {
    det *= lu[idx][idx]
  }
  return det
}

// 3D cross product
export const cross_3d = (vec1: Vec3, vec2: Vec3): Vec3 => [
  vec1[1] * vec2[2] - vec1[2] * vec2[1],
  vec1[2] * vec2[0] - vec1[0] * vec2[2],
  vec1[0] * vec2[1] - vec1[1] * vec2[0],
]

// Perpendicular distance between opposite cell faces per axis: volume / opposite-
// face area. This (not the lattice vector length) is the correct denominator for
// per-axis fractional reach in oblique cells. Degenerate (zero-volume) cells →
// Infinity so callers' `dist / height` collapses to 0.
export function cell_heights(matrix: Matrix3x3): Vec3 {
  const [a_vec, b_vec, c_vec] = matrix
  const cross_bc = cross_3d(b_vec, c_vec)
  const volume = Math.abs(dot(a_vec, cross_bc))
  if (volume === 0) return [Infinity, Infinity, Infinity]
  // height along axis k = volume / area of the face spanned by the OTHER two vectors
  const height_a = volume / Math.hypot(...cross_bc) // face b×c ⟂ a
  const height_b = volume / Math.hypot(...cross_3d(a_vec, c_vec)) // face a×c ⟂ b
  const height_c = volume / Math.hypot(...cross_3d(a_vec, b_vec)) // face a×b ⟂ c
  return [height_a, height_b, height_c]
}

// `dist` Å of real-space reach as a fractional pad per axis (via cell heights,
// correct for oblique cells). Degenerate cells → 0 (no images).
export const frac_cutoff_per_axis = (matrix: Matrix3x3, dist: number): Vec3 =>
  cell_heights(matrix).map((height) => dist / height) as Vec3

// Scalar linear interpolation
export const lerp = (start: number, end: number, t: number): number =>
  start + t * (end - start)

// Vec3 linear interpolation
export const lerp_vec3 = (start: Vec3, end: Vec3, t: number): Vec3 => [
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

// Element-wise equality check for two optional Vec3s.
// Returns true if both are the same reference, or both are defined with equal components.
export const vecs_equal = (vec_a?: Vec3, vec_b?: Vec3): boolean =>
  vec_a === vec_b ||
  (vec_a != null &&
    vec_b != null &&
    vec_a[0] === vec_b[0] &&
    vec_a[1] === vec_b[1] &&
    vec_a[2] === vec_b[2])

// Vec3 -> Vec3, number[] -> number[] (same length, mutable)
type Normalized<T extends readonly number[]> = { -readonly [K in keyof T]: number }

// Normalize a vector of any length to unit length; returns `fallback` (or zeros) when ~zero.
export function normalize_vec<T extends readonly number[]>(
  vec: T,
  fallback?: NoInfer<T>,
): Normalized<T> {
  let sum_sq = 0
  for (const coord of vec) sum_sq += coord * coord
  const len = Math.sqrt(sum_sq)
  const unit = len < EPS ? (fallback ?? vec.map(() => 0)) : vec.map((coord) => coord / len)
  return unit as Normalized<T>
}

// Compute orthonormal basis vectors in a plane perpendicular to `normal`.
// Uses Gram-Schmidt orthogonalization + cross product.
export function compute_in_plane_basis(normal: Vec3): [Vec3, Vec3] {
  let ref_vec: Vec3 = [1, 0, 0]
  if (Math.abs(normal[0]) > 0.9) ref_vec = [0, 1, 0]

  const dot_nr = dot(normal, ref_vec)
  const u_raw: Vec3 = [
    ref_vec[0] - dot_nr * normal[0],
    ref_vec[1] - dot_nr * normal[1],
    ref_vec[2] - dot_nr * normal[2],
  ]
  const u_vec = normalize_vec(u_raw, [0, 1, 0])
  const v_vec = cross_3d(normal, u_vec)
  return [u_vec, v_vec] // u, v basis vectors
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
  const plane_d = dot(normal, origin)
  for (let idx = 1; idx < points.length; idx++) {
    const dist = Math.abs(dot(normal, points[idx]) - plane_d)
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
    const first_nonzero =
      Math.abs(normal[0]) > CANON_EPS
        ? normal[0]
        : Math.abs(normal[1]) > CANON_EPS
          ? normal[1]
          : normal[2]
    if (first_nonzero < 0) normal = [-normal[0], -normal[1], -normal[2]]
    const plane_d = dot(normal, va)
    tri_planes.push({ verts: [va, vb, vc], normal, plane_d, degenerate: false })
  }

  // === Step 2: Build adjacency via edge hash map ===
  // Quantize vertex to integer grid for hashing (only used for equality, not coords)
  const vert_key = (v: Vec3): string =>
    `${Math.round(v[0] / tolerance)},${Math.round(v[1] / tolerance)},${Math.round(
      v[2] / tolerance,
    )}`
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
    const ra = find(a),
      rb = find(b)
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
    const normal_dot =
      pa.normal[0] * pb.normal[0] + pa.normal[1] * pb.normal[1] + pa.normal[2] * pb.normal[2]
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
  const tri_area = (va: Vec3, vb: Vec3, vc: Vec3): number =>
    0.5 * Math.hypot(...cross_3d(subtract(vb, va), subtract(vc, va)))
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
    const pts_2d = unique_verts.map((vertex): Vec2 => [dot(u_vec, vertex), dot(v_vec, vertex)])

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

    // Convex hull fills notches of concave patches, inventing area — keep originals then
    let group_area = 0
    let fan_area = 0
    for (const tri_idx of members) group_area += tri_area(...tri_planes[tri_idx].verts)
    for (let idx = 1; idx < hull_3d.length - 1; idx++) {
      fan_area += tri_area(hull_3d[0], hull_3d[idx], hull_3d[idx + 1])
    }
    if (Math.abs(fan_area - group_area) > Math.max(group_area, 1e-12) * 1e-6) {
      emit_original(members)
      continue
    }

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

// Check if a matrix is a finite-numeric square matrix of dimension NxN (type predicate
// so callers get number[][] narrowing without assertions). Rejects NaN/Infinity entries.
export function is_square_matrix(matrix: unknown, dim: number): matrix is number[][] {
  if (!Array.isArray(matrix)) return false
  if (matrix.length !== dim) return false
  return matrix.every(
    (row) =>
      Array.isArray(row) && row.length === dim && row.every((val) => Number.isFinite(val)),
  )
}

// --- 2D Geometry Utilities ---

// Point-in-polygon test using ray casting algorithm
// Returns true if point (x, y) is inside the polygon defined by vertices
export function point_in_polygon(point_x: number, point_y: number, vertices: Vec2[]): boolean {
  if (vertices.length < 3) return false
  let [inside, prev_idx] = [false, vertices.length - 1]

  for (let idx = 0; idx < vertices.length; idx++) {
    const [x_i, y_i] = vertices[idx]
    const [x_j, y_j] = vertices[prev_idx]

    // Check if horizontal ray from point crosses this edge
    if (y_i !== y_j && y_i > point_y !== y_j > point_y) {
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
  const vertex_average = (): Vec2 => [
    vertices.reduce((acc, [x]) => acc + x, 0) / vertices.length,
    vertices.reduce((acc, [, y]) => acc + y, 0) / vertices.length,
  ]
  if (vertices.length < 3) return vertex_average()

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
  if (Math.abs(signed_area) < EPS) return vertex_average()

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
    return [(b[0] * A[1][1] - b[1] * A[0][1]) / det, (A[0][0] * b[1] - A[1][0] * b[0]) / det]
  }

  // 3x3 fast path via matrix inverse
  if (n === 3) {
    const det = det_3x3(A as Matrix3x3)
    if (Math.abs(det) < EPS) return null
    const inv = matrix_inverse_3x3(A as Matrix3x3)
    return mat3x3_vec3_multiply(inv, b as Vec3)
  }

  // General NxN: LU decomposition with partial pivoting + forward/back substitution
  const lu = A.map((row) => [...row])
  const perm = Array.from({ length: n }, (_, idx) => idx)

  for (let col = 0; col < n; col++) {
    // Find pivot
    let [max_row, max_val] = [col, Math.abs(lu[col][col])]

    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(lu[row][col])
      if (val > max_val) [max_val, max_row] = [val, row]
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
  const x = Array.from<number>({ length: n }).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let sum = pb[row]
    for (let col = row + 1; col < n; col++) {
      sum -= lu[row][col] * x[col]
    }
    x[row] = sum / lu[row][row]
  }

  return x
}

export const cross_2d = (origin: Vec2, point_a: Vec2, point_b: Vec2): number =>
  (point_a[0] - origin[0]) * (point_b[1] - origin[1]) -
  (point_a[1] - origin[1]) * (point_b[0] - origin[0])

// One half of Andrew's monotone chain built from x-then-y *pre-sorted* points
// (lower chain; pass reversed input for the upper chain).
export const monotone_chain = (sorted: Vec2[], tolerance = 0): Vec2[] => {
  const chain: Vec2[] = []
  for (const pt of sorted) {
    while (
      chain.length >= 2 &&
      cross_2d(chain[chain.length - 2], chain[chain.length - 1], pt) <= tolerance
    ) {
      chain.pop()
    }
    chain.push(pt)
  }
  return chain
}

// Full 2D convex hull via Andrew's monotone chain algorithm.
// Returns vertices in counter-clockwise order.
export function convex_hull_2d(points: Vec2[], tolerance = 0): Vec2[] {
  if (points.length < 3) return [...points]

  const sorted = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])
  const lower = monotone_chain(sorted, tolerance)
  const upper = monotone_chain(sorted.toReversed(), tolerance)

  // Remove last point of each half (it's the first point of the other)
  lower.pop()
  upper.pop()

  return [...lower, ...upper]
}
// Shared quantile + selection helpers used by box-plot.ts and kde.ts.
// quickselect partially sorts in place; quantile_unordered mutates its input
// (quantile_sorted assumes an already-ascending array and never mutates).
//
// Unguarded contract: quickselect, quantile_sorted and quantile_unordered all assume
// values.length > 0 and 0 <= p <= 1. Out-of-range inputs index past the array and
// yield undefined/NaN — callers (box-plot.ts, kde.ts) must length- and p-range-check
// before calling.

export function quickselect(values: number[], kth: number): number {
  let left = 0
  let right = values.length - 1
  while (left < right) {
    const pivot = values[(left + right) >>> 1]
    let scan_lo = left
    let scan_hi = right
    while (scan_lo <= scan_hi) {
      while (values[scan_lo] < pivot) scan_lo++
      while (values[scan_hi] > pivot) scan_hi--
      if (scan_lo <= scan_hi) {
        const tmp = values[scan_lo]
        values[scan_lo] = values[scan_hi]
        values[scan_hi] = tmp
        scan_lo++
        scan_hi--
      }
    }
    if (kth <= scan_hi) right = scan_hi
    else if (kth >= scan_lo) left = scan_lo
    else return values[kth]
  }
  return values[kth]
}

export function quantile_sorted(values: readonly number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = values[lo]
  return hi === lo ? lo_val : lo_val + (values[hi] - lo_val) * frac
}

export function quantile_unordered(values: number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = quickselect(values, lo)
  return hi === lo ? lo_val : lo_val + (quickselect(values, hi) - lo_val) * frac
}
