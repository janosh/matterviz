import type { LatticeParams, Pbc } from '$lib/structure/index'

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]
export type Vec4 = [number, number, number, number]
export type Point2D = { x: number; y: number }
export type Point3D = Point2D & { z: number }
export type Matrix3x3 = [Vec3, Vec3, Vec3]
type Matrix4x4 = [Vec4, Vec4, Vec4, Vec4]

// Any array-like (Array, typed array, arguments) holding exactly three finite numbers
export const is_finite_vec3_like = (values: unknown): values is ArrayLike<number> => {
  if (typeof values !== `object` || values === null) return false
  const array_like = values as ArrayLike<unknown>
  // Number.isFinite does not coerce, so non-numbers fail too
  return array_like.length === 3 && [0, 1, 2].every((idx) => Number.isFinite(array_like[idx]))
}

export const finite_vec3_from_values = (values: unknown): Vec3 | undefined => {
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
  // Neither base case catches a negative k (`arr.length < k` is false for one), so the
  // recursion ran away into a stack overflow instead of reporting the caller's bad argument
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`combinations needs a non-negative integer k, got ${k}`)
  }
  if (k === 0) return [[]]
  if (arr.length < k) return []
  // Backtracking, same lexicographic order. The recursive spread/concat form allocated two
  // arrays plus a spread per sub-combination per level: 12x slower (n=30 k=5, 53 -> 4.5 ms).
  const out: T[][] = []
  const combo: T[] = Array.from({ length: k })
  const walk = (start: number, depth: number): void => {
    if (depth === k) {
      out.push(combo.slice())
      return
    }
    // stop once too few elements remain to fill the rest of the combination
    for (let idx = start; idx <= arr.length - (k - depth); idx++) {
      combo[depth] = arr[idx]
      walk(idx + 1, depth + 1)
    }
  }
  walk(0, 0)
  return out
}

export const LOG_EPS = 1e-9
export const EPS = 1e-10
const RAD_TO_DEG = 180 / Math.PI
export const DEG_TO_RAD = Math.PI / 180
const MAX_MIN_IMAGE_CANDIDATES = 100_000

export const to_degrees = (radians: number): number => radians * RAD_TO_DEG
export const to_radians = (degrees: number): number => degrees * DEG_TO_RAD

// Clamp value into [lo, hi]. NaN passes through (Math.min/max propagate it), so callers
// that need a finite result must check first.
export const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value))

// Index of the first value for which an initial-prefix predicate is false.
export const partition_point = <Value>(
  values: readonly Value[],
  comes_before: (value: Value) => boolean,
): number => {
  let lower_idx = 0
  let upper_idx = values.length
  while (lower_idx < upper_idx) {
    const middle_idx = Math.floor((lower_idx + upper_idx) / 2)
    if (comes_before(values[middle_idx])) lower_idx = middle_idx + 1
    else upper_idx = middle_idx
  }
  return lower_idx
}

// Index of the first entry that is not strictly greater than its predecessor (a NaN fails
// the comparison too), or null when the sequence increases strictly. Step axes, time axes
// and sorted grids all need this check and the offending index for their error message.
export const first_non_increasing_index = (values: ArrayLike<number>): number | null => {
  for (let idx = 1; idx < values.length; idx++) {
    if (!(values[idx] > values[idx - 1])) return idx
  }
  return null
}

// Calculate all lattice parameters in a single efficient pass
export function calc_lattice_params(matrix: Matrix3x3): LatticeParams & { volume: number } {
  const [a_vec, b_vec, c_vec] = matrix
  const [a, b, c] = matrix.map((vec) => Math.hypot(...vec))
  const volume = Math.abs(det_3x3(matrix))

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
    return Math.acos(clamp(dot / denom, -1, 1)) * RAD_TO_DEG
  }
  const alpha = safe_angle(dot(b_vec, c_vec), b, c)
  const beta = safe_angle(dot(a_vec, c_vec), a, c)
  const gamma = safe_angle(dot(a_vec, b_vec), a, b)

  return { a, b, c, alpha, beta, gamma, volume }
}

export const scale = <T extends number[]>(vec: T, factor: number): T =>
  vec.map((component) => component * factor) as T

export function euclidean_dist(vec1: readonly number[], vec2: readonly number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vectors must be of same length`)
  }
  let sum_sq = 0
  for (let idx = 0; idx < vec1.length; idx++) {
    const delta = vec1[idx] - vec2[idx]
    sum_sq += delta * delta
  }
  return Math.sqrt(sum_sq)
}

// Exact minimum-image displacement `to - from` for row-vector lattices. Rounded
// fractional wrapping is only approximate for skewed cells, so it is the starting guess
// and the integer shifts that reciprocal-space bounds say could still beat that Cartesian
// radius are then searched. Runs per atom pair in RDF/MSD/bonding loops, so it works in
// scalars and allocates only the returned Vec3.
export const min_image_displacement = (
  from: Vec3,
  to: Vec3,
  lattice_matrix: Matrix3x3,
  converters?: LatticeConverters,
  pbc: Pbc = [true, true, true],
): Vec3 => min_image_displacement_into(from, to, lattice_matrix, converters, pbc, [0, 0, 0])

// Allocation-free variant for frame-major unwrap loops: writes the displacement into `out`
// and returns it
export function min_image_displacement_into(
  from: Vec3,
  to: Vec3,
  lattice_matrix: Matrix3x3,
  converters: LatticeConverters | undefined,
  pbc: Pbc,
  out: Vec3,
): Vec3 {
  const delta_x = to[0] - from[0]
  const delta_y = to[1] - from[1]
  const delta_z = to[2] - from[2]
  if (!pbc[0] && !pbc[1] && !pbc[2]) {
    out[0] = delta_x
    out[1] = delta_y
    out[2] = delta_z
    return out
  }

  const { lattice, reciprocal, reciprocal_axis_norms } =
    converters ?? create_lattice_converters(lattice_matrix)
  const [[ax, ay, az], [bx, by, bz], [cx, cy, cz]] = lattice
  const [[ra0, ra1, ra2], [rb0, rb1, rb2], [rc0, rc1, rc2]] = reciprocal
  // fractional displacement: frac_i = b_i · delta
  const frac_a = ra0 * delta_x + ra1 * delta_y + ra2 * delta_z
  const frac_b = rb0 * delta_x + rb1 * delta_y + rb2 * delta_z
  const frac_c = rc0 * delta_x + rc1 * delta_y + rc2 * delta_z

  const wrapped_a = pbc[0] ? frac_a - Math.round(frac_a) : frac_a
  const wrapped_b = pbc[1] ? frac_b - Math.round(frac_b) : frac_b
  const wrapped_c = pbc[2] ? frac_c - Math.round(frac_c) : frac_c
  let best_x = wrapped_a * ax + wrapped_b * bx + wrapped_c * cx
  let best_y = wrapped_a * ay + wrapped_b * by + wrapped_c * cy
  let best_z = wrapped_a * az + wrapped_b * bz + wrapped_c * cz
  let best_dist_sq = best_x * best_x + best_y * best_y + best_z * best_z
  const search_radius = Math.sqrt(best_dist_sq) + EPS

  // |frac_i + shift_i| <= |b_i| * radius for any candidate within the radius
  const bound_a = pbc[0] ? reciprocal_axis_norms[0] * search_radius : 0
  const bound_b = pbc[1] ? reciprocal_axis_norms[1] * search_radius : 0
  const bound_c = pbc[2] ? reciprocal_axis_norms[2] * search_radius : 0
  const a_min = pbc[0] ? Math.ceil(-frac_a - bound_a) : 0
  const a_max = pbc[0] ? Math.floor(-frac_a + bound_a) : 0
  const b_min = pbc[1] ? Math.ceil(-frac_b - bound_b) : 0
  const b_max = pbc[1] ? Math.floor(-frac_b + bound_b) : 0
  const c_min = pbc[2] ? Math.ceil(-frac_c - bound_c) : 0
  const c_max = pbc[2] ? Math.floor(-frac_c + bound_c) : 0
  const candidate_count = (a_max - a_min + 1) * (b_max - b_min + 1) * (c_max - c_min + 1)
  if (!(candidate_count <= MAX_MIN_IMAGE_CANDIDATES)) {
    const norms = JSON.stringify(reciprocal_axis_norms)
    throw new Error(
      `Minimum-image search would test ${candidate_count} > ${MAX_MIN_IMAGE_CANDIDATES} ` +
        `candidates for lattice ${JSON.stringify(lattice_matrix)}; reciprocal norms=${norms}`,
    )
  }

  for (let shift_a = a_min; shift_a <= a_max; shift_a++) {
    const cand_a = frac_a + shift_a
    for (let shift_b = b_min; shift_b <= b_max; shift_b++) {
      const cand_b = frac_b + shift_b
      for (let shift_c = c_min; shift_c <= c_max; shift_c++) {
        const cand_c = frac_c + shift_c
        const cand_x = cand_a * ax + cand_b * bx + cand_c * cx
        const cand_y = cand_a * ay + cand_b * by + cand_c * cy
        const cand_z = cand_a * az + cand_b * bz + cand_c * cz
        const cand_dist_sq = cand_x * cand_x + cand_y * cand_y + cand_z * cand_z
        if (cand_dist_sq < best_dist_sq) {
          best_dist_sq = cand_dist_sq
          best_x = cand_x
          best_y = cand_y
          best_z = cand_z
        }
      }
    }
  }
  out[0] = best_x
  out[1] = best_y
  out[2] = best_z
  return out
}

// Minimum distance between two points under periodic boundary conditions.
export const pbc_dist = (
  pos1: Vec3,
  pos2: Vec3,
  lattice_matrix: Matrix3x3,
  converters?: LatticeConverters,
  pbc: Pbc = [true, true, true],
): number => {
  const [dx, dy, dz] = min_image_displacement(pos1, pos2, lattice_matrix, converters, pbc)
  return Math.hypot(dx, dy, dz)
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

// Inverse, or null when the rows are (numerically) linearly dependent. The test is
// |det| relative to the product of row norms, i.e. the volume of the parallelepiped the
// unit rows span, so it is scale-invariant: a lattice in nm or a reciprocal lattice of a
// large supercell (entries ~1e-3) is just as invertible as one in Å. An absolute |det|
// threshold would reject those while accepting a genuinely ill-conditioned cell with
// large entries.
const invert_3x3 = (matrix: Matrix3x3): Matrix3x3 | null => {
  const [[m11, m12, m13], [m21, m22, m23], [m31, m32, m33]] = matrix
  const det = det_3x3(matrix)
  const row_norm_product =
    Math.hypot(m11, m12, m13) * Math.hypot(m21, m22, m23) * Math.hypot(m31, m32, m33)
  if (!Number.isFinite(det) || Math.abs(det) <= EPS * row_norm_product) return null
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

export function matrix_inverse_3x3(matrix: Matrix3x3): Matrix3x3 {
  const inverse = invert_3x3(matrix)
  if (!inverse) {
    throw new Error(
      `Matrix is singular or ill-conditioned; cannot invert: ${JSON.stringify(matrix)}`,
    )
  }
  return inverse
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
export function add<T extends number[]>(...vecs: T[]): T {
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

export function subtract<T extends number[]>(vec1: T, vec2: T): T {
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
export function dot(vec1: readonly number[], vec2: readonly number[]): number
export function dot(vec1: number[][], vec2: readonly number[]): number[]
export function dot(vec1: number[][], vec2: number[][]): number[][]
export function dot(
  vec1: readonly number[] | number[][],
  vec2: readonly number[] | number[][],
): number | number[] | number[][] {
  const vec1_is_matrix = Array.isArray(vec1[0])
  const vec2_is_matrix = Array.isArray(vec2[0])

  // Vector dot product: the per-site hot path, so a plain loop rather than reduce
  if (!vec1_is_matrix && !vec2_is_matrix) {
    const left_vec = vec1 as readonly number[]
    const right_vec = vec2 as readonly number[]
    if (left_vec.length !== right_vec.length) {
      throw new Error(`Vectors must be of same length`)
    }
    let sum = 0
    for (let idx = 0; idx < left_vec.length; idx++) sum += left_vec[idx] * right_vec[idx]
    return sum
  }

  // Matrix-vector multiplication
  if (vec1_is_matrix && !vec2_is_matrix) {
    const mat = vec1 as number[][]
    const vec = vec2 as readonly number[]
    const cols = validate_matrix(mat, `Matrix`)
    if (cols !== vec.length) {
      throw new Error(`Matrix columns must equal vector length`)
    }
    return mat.map((row) => dot(row, vec))
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
    return mat1.map((row) =>
      Array.from({ length: mat2_cols }, (_col, col_idx) => {
        let sum = 0
        for (let idx = 0; idx < mat1_cols; idx++) sum += row[idx] * mat2[idx][col_idx]
        return sum
      }),
    )
  }

  throw new Error(`Unsupported input types for dot product`)
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

// Shared instance, aliased not copied by callers: never mutate, build a literal instead
// oxfmt-ignore
export const IDENTITY_3X3: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

// Transpose a 3x3 matrix
export const transpose_3x3_matrix = (matrix: Matrix3x3): Matrix3x3 => [
  [matrix[0][0], matrix[1][0], matrix[2][0]],
  [matrix[0][1], matrix[1][1], matrix[2][1]],
  [matrix[0][2], matrix[1][2], matrix[2][2]],
]

// Scale each row of a 3x3 matrix by the corresponding element of a Vec3.
// Used to scale lattice vectors by supercell factors.
export const scale_lattice_matrix = (orig_matrix: Matrix3x3, scaling_factors: Vec3) =>
  orig_matrix.map((row, idx) => scale(row, scaling_factors[idx])) as Matrix3x3

// Reciprocal lattice of a row-vector lattice A (rows a_i), returned as rows b_i with
// a_i · b_j = δ_ij (crystallographic convention, the default) or 2π δ_ij (`two_pi`, the
// solid-state convention Brillouin zones and band paths use). B = (A⁻¹)ᵀ = (Aᵀ)⁻¹, so the
// 2π-free form is also the Cartesian→fractional matrix: frac_i = b_i · cart.
export function reciprocal_lattice(
  lattice: Matrix3x3,
  options: { two_pi?: boolean } = {},
): Matrix3x3 {
  const factor = options.two_pi ? 2 * Math.PI : 1
  const inverse_transposed = transpose_3x3_matrix(matrix_inverse_3x3(lattice))
  return inverse_transposed.map((row) => scale(row, factor)) as Matrix3x3
}

// Curried fractional→Cartesian converter: cart = frac · lattice (row-vector convention)
export const create_frac_to_cart = (lattice: Matrix3x3) => {
  const transposed = transpose_3x3_matrix(lattice)
  return (frac: Vec3): Vec3 => mat3x3_vec3_multiply(transposed, frac)
}

// Curried Cartesian→fractional converter: frac_i = b_i · cart with b_i the reciprocal rows
export const create_cart_to_frac = (lattice: Matrix3x3) => {
  const reciprocal = reciprocal_lattice(lattice)
  return (cart: Vec3): Vec3 => mat3x3_vec3_multiply(reciprocal, cart)
}

// Paired converters for a lattice, built once and reused across every site or frame.
// The raw matrices are exposed for allocation-free scalar arithmetic in hot loops
// (min_image_displacement); reciprocal_axis_norms[i] = |b_i| bounds how far a Cartesian
// radius can reach along fractional axis i.
export type LatticeConverters = {
  lattice: Matrix3x3
  reciprocal: Matrix3x3
  reciprocal_axis_norms: Vec3
  cart_to_frac: (cart: Vec3) => Vec3
  frac_to_cart: (frac: Vec3) => Vec3
}

export const create_lattice_converters = (lattice: Matrix3x3): LatticeConverters => {
  const reciprocal = reciprocal_lattice(lattice)
  return {
    lattice,
    reciprocal,
    reciprocal_axis_norms: reciprocal.map((row) => Math.hypot(row[0], row[1], row[2])) as Vec3,
    cart_to_frac: (cart: Vec3): Vec3 => mat3x3_vec3_multiply(reciprocal, cart),
    frac_to_cart: create_frac_to_cart(lattice),
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
  const cos_alpha = Math.cos(alpha * DEG_TO_RAD)
  const cos_beta = Math.cos(beta * DEG_TO_RAD)
  const cos_gamma = Math.cos(gamma * DEG_TO_RAD)
  const sin_gamma = Math.sin(gamma * DEG_TO_RAD)

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

// Miller indices that pick out a plane: three safe integers, not all zero. Not gcd-reduced
// here: (222) is a valid half-spacing stack for lattice planes.
export function validate_miller_indices(hkl: Vec3): void {
  if (hkl?.length !== 3) {
    throw new Error(`Miller indices must be 3 numbers, got ${JSON.stringify(hkl)}`)
  }
  const non_integer = hkl.filter((val) => !Number.isSafeInteger(val))
  if (non_integer.length > 0) {
    throw new Error(
      `Miller indices must be integers, got ${JSON.stringify(non_integer)} in ${JSON.stringify(hkl)}`,
    )
  }
  if (hkl.every((val) => val === 0)) {
    throw new Error(`Miller indices (0, 0, 0) do not define a plane`)
  }
}

// Normal of the (hkl) planes of a row-vector lattice A: the reciprocal vector
// G = h·b1 + k·b2 + l·b3, which with the rows b_i of transpose(inv(A)) is inv(A) · hkl. Not
// normalized: |G| = 1 / d_hkl.
export const miller_plane_normal = (lattice: Matrix3x3, hkl: Vec3): Vec3 =>
  dot(matrix_inverse_3x3(lattice), hkl)

// === Descriptive statistics ===
// Plain loops, not reduce: these run over per-frame trajectory series and box-plot samples.

// Arithmetic mean; NaN for empty input (0/0), matching the mathematical convention.
export function mean(values: readonly number[]): number {
  let sum = 0
  for (const value of values) sum += value
  return sum / values.length
}

// Sample standard deviation (n - 1 denominator); 0 for fewer than two values.
export function sample_std(values: readonly number[]): number {
  const n_vals = values.length
  if (n_vals < 2) return 0
  const avg = mean(values)
  let variance_sum = 0
  for (const value of values) {
    const delta = value - avg
    variance_sum += delta * delta
  }
  return Math.sqrt(variance_sum / (n_vals - 1))
}

// Median without mutating the input; NaN for empty input.
export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN
  return quantile_unordered([...values], 0.5)
}

export function get_coefficient_of_variation(values: number[]): number {
  if (values.length <= 1) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, val) => sum + (val - avg) ** 2, 0) / values.length
  return Math.abs(avg) > 1e-10 ? Math.sqrt(variance) / Math.abs(avg) : Math.sqrt(variance)
}

// Compute 4x4 determinant (used for 4D barycentric coordinates)
function det_4x4(matrix: Matrix4x4): number {
  const [[a0, a1, a2, a3], [b0, b1, b2, b3], [c0, c1, c2, c3], [d0, d1, d2, d3]] = matrix
  return (
    a0 * (b1 * (c2 * d3 - c3 * d2) - b2 * (c1 * d3 - c3 * d1) + b3 * (c1 * d2 - c2 * d1)) -
    a1 * (b0 * (c2 * d3 - c3 * d2) - b2 * (c0 * d3 - c3 * d0) + b3 * (c0 * d2 - c2 * d0)) +
    a2 * (b0 * (c1 * d3 - c3 * d1) - b1 * (c0 * d3 - c3 * d0) + b3 * (c0 * d1 - c1 * d0)) -
    a3 * (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0))
  )
}

// LU decomposition with partial pivoting on a working copy: L's factors land below the
// diagonal, U on and above it, `perm` is the row order applied and `n_swaps` its parity.
// Returns null when a pivot is <= EPS * largest |entry|, so a matrix and its scalar
// multiples get the same singular/non-singular verdict.
const lu_decompose = (
  matrix: number[][],
): { lu: number[][]; perm: number[]; n_swaps: number } | null => {
  const size = matrix.length
  const lu = matrix.map((row) => [...row])
  const perm = Array.from({ length: size }, (_, idx) => idx)
  // array_max skips NaN, so one stray entry cannot poison the floor the way a Math.max scan
  // does (a NaN floor makes every `max_val <= pivot_floor` false, so no column is ever called
  // singular). That keeps the check able to fire, not guaranteed to: whether it fires before
  // elimination smears the NaN across rows depends on the matrix. An Infinity floor calls
  // everything singular on column 0 - right outcome, incidental reason. Neither form validates
  // its input. flat().map() copies n^2 twice, which the scan avoids, but callers are 4x4 down.
  const pivot_floor = EPS * array_max(matrix.flat().map(Math.abs))
  let n_swaps = 0

  for (let col = 0; col < size; col++) {
    let [max_row, max_val] = [col, Math.abs(lu[col][col])]
    for (let row = col + 1; row < size; row++) {
      const val = Math.abs(lu[row][col])
      if (val > max_val) [max_val, max_row] = [val, row]
    }
    if (max_val <= pivot_floor) return null // singular

    if (max_row !== col) {
      ;[lu[col], lu[max_row]] = [lu[max_row], lu[col]]
      ;[perm[col], perm[max_row]] = [perm[max_row], perm[col]]
      n_swaps++
    }

    // Eliminate below pivot
    const pivot = lu[col][col]
    for (let row = col + 1; row < size; row++) {
      const factor = lu[row][col] / pivot
      lu[row][col] = factor
      for (let inner = col + 1; inner < size; inner++) {
        lu[row][inner] -= factor * lu[col][inner]
      }
    }
  }
  return { lu, perm, n_swaps }
}

// Compute NxN determinant using LU decomposition with partial pivoting
// More numerically stable than cofactor expansion for N > 4
// Returns 0 for singular/near-singular matrices (pivot <= EPS * largest entry)
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

  const decomposed = lu_decompose(matrix)
  if (!decomposed) return 0
  // Determinant is product of diagonal elements × (-1)^swaps
  let det = decomposed.n_swaps % 2 === 0 ? 1 : -1
  for (let idx = 0; idx < mat_size; idx++) det *= decomposed.lu[idx][idx]
  return det
}

// 3D cross product. ArrayLike so typed-array subarrays from flat position buffers work.
export const cross_3d = (vec1: ArrayLike<number>, vec2: ArrayLike<number>): Vec3 => [
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

  const u_raw = subtract(ref_vec, scale(normal, dot(normal, ref_vec)))
  const u_vec = normalize_vec(u_raw, [0, 1, 0])
  const v_vec = cross_3d(normal, u_vec)
  return [u_vec, v_vec] // u, v basis vectors
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
    // whether canonicalizing `normal` negated it, i.e. the face's real outward normal is -normal
    canon_flipped: boolean
  }
  const tri_planes: TriPlane[] = []
  for (let tri_idx = 0; tri_idx < n_triangles; tri_idx++) {
    const base = tri_idx * 9
    const vert_a: Vec3 = [positions[base], positions[base + 1], positions[base + 2]]
    const vert_b: Vec3 = [positions[base + 3], positions[base + 4], positions[base + 5]]
    const vert_c: Vec3 = [positions[base + 6], positions[base + 7], positions[base + 8]]
    const raw_normal = cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a))
    const len = Math.hypot(raw_normal[0], raw_normal[1], raw_normal[2])
    if (len < tolerance) {
      tri_planes.push({
        verts: [vert_a, vert_b, vert_c],
        normal: [0, 0, 0],
        plane_d: 0,
        degenerate: true,
        canon_flipped: false,
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
    const canon_flipped = first_nonzero < 0
    if (canon_flipped) normal = [-normal[0], -normal[1], -normal[2]]
    const plane_d = dot(normal, vert_a)
    // oxfmt-ignore
    tri_planes.push({ verts: [vert_a, vert_b, vert_c], normal, plane_d, degenerate: false, canon_flipped })
  }

  // === Step 2: Build adjacency via edge hash map ===
  // Quantize vertex to integer grid for hashing (only used for equality, not coords)
  const vert_key = (vert: Vec3): string =>
    `${Math.round(vert[0] / tolerance)},${Math.round(vert[1] / tolerance)},${Math.round(
      vert[2] / tolerance,
    )}`
  const edge_key = (vert_a: Vec3, vert_b: Vec3): string => {
    const key_a = vert_key(vert_a)
    const key_b = vert_key(vert_b)
    return key_a < key_b ? `${key_a}|${key_b}` : `${key_b}|${key_a}`
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
    for (const edge of edges) {
      const existing = edge_to_tris.get(edge)
      if (existing) existing.push(tri_idx)
      else edge_to_tris.set(edge, [tri_idx])
    }
  }

  // === Step 3: Union-Find grouping of coplanar adjacent triangles ===
  const parent = new Int32Array(n_triangles)
  const rank = new Int32Array(n_triangles)
  for (let idx = 0; idx < n_triangles; idx++) parent[idx] = idx
  const find = (start: number): number => {
    let node = start
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]] // path compression
      node = parent[node]
    }
    return node
  }
  const union = (idx_a: number, idx_b: number): void => {
    const root_a = find(idx_a)
    const root_b = find(idx_b)
    if (root_a === root_b) return
    if (rank[root_a] < rank[root_b]) parent[root_a] = root_b
    else if (rank[root_a] > rank[root_b]) parent[root_b] = root_a
    else {
      parent[root_b] = root_a
      rank[root_a]++
    }
  }
  for (const tri_list of edge_to_tris.values()) {
    if (tri_list.length !== 2) continue
    const [idx_a, idx_b] = tri_list
    const plane_a = tri_planes[idx_a]
    const plane_b = tri_planes[idx_b]
    // Check coplanarity: same canonical normal direction AND same plane distance
    if (Math.abs(dot(plane_a.normal, plane_b.normal)) < 1 - tolerance) continue
    if (Math.abs(plane_a.plane_d - plane_b.plane_d) > tolerance) continue
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
  const emit_tri = (vert_a: Vec3, vert_b: Vec3, vert_c: Vec3): void => {
    output.push(...vert_a, ...vert_b, ...vert_c)
  }
  const emit_original = (members: number[]): void => {
    for (const tri_idx of members) emit_tri(...tri_planes[tri_idx].verts)
  }
  const tri_area = (vert_a: Vec3, vert_b: Vec3, vert_c: Vec3): number =>
    0.5 * Math.hypot(...cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a)))
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
        const dist = (pts_2d[idx][0] - pt[0]) ** 2 + (pts_2d[idx][1] - pt[1]) ** 2
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

    // Fan-triangulate from hull vertex 0. Reversed when canonicalizing the plane normal negated
    // it: the 2D basis is built from the canonical normal, so convex_hull_2d winds CCW about
    // that rather than about the face's real outward normal. On a closed mesh that is every
    // face whose normal leads with a negative component - half a cube's - and their fans came
    // out wound inward. DoubleSide rendering hid it; exported geometry kept the bad winding.
    const reverse = tri_planes[members[0]].canon_flipped
    for (let idx = 1; idx < hull_3d.length - 1; idx++) {
      if (reverse) emit_tri(hull_3d[0], hull_3d[idx + 1], hull_3d[idx])
      else emit_tri(hull_3d[0], hull_3d[idx], hull_3d[idx + 1])
    }
  }

  return new Float32Array(output)
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

// === 2D geometry ===

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

// Solve the linear system `coefficients · x = rhs` via LU decomposition with partial
// pivoting. Returns null if the system is singular (no unique solution). Singularity is
// judged relative to the largest coefficient so scaling the system does not change the
// verdict. Fast-paths for 2x2 (Cramer's rule) and 3x3 (matrix inverse).
export function solve_linear_system(
  coefficients: number[][], // NxN coefficient matrix
  rhs: number[], // N-element right-hand side
): number[] | null {
  const size = coefficients.length
  if (size === 0 || rhs.length !== size || !coefficients.every((row) => row.length === size)) {
    return null
  }

  // 2x2 fast path via Cramer's rule
  if (size === 2) {
    const [[m00, m01], [m10, m11]] = coefficients
    const det = m00 * m11 - m01 * m10
    if (Math.abs(det) <= EPS * Math.hypot(m00, m01) * Math.hypot(m10, m11)) return null
    return [(rhs[0] * m11 - rhs[1] * m01) / det, (m00 * rhs[1] - m10 * rhs[0]) / det]
  }

  // 3x3 fast path via matrix inverse
  if (size === 3) {
    const inverse = invert_3x3(coefficients as Matrix3x3)
    return inverse && mat3x3_vec3_multiply(inverse, rhs as Vec3)
  }

  // General NxN: LU decomposition with partial pivoting + forward/back substitution
  const decomposed = lu_decompose(coefficients)
  if (!decomposed) return null
  const { lu, perm } = decomposed

  // Apply permutation to rhs, then forward substitution (L y = P rhs)
  const solution = perm.map((idx) => rhs[idx])
  for (let row = 1; row < size; row++) {
    for (let col = 0; col < row; col++) {
      solution[row] -= lu[row][col] * solution[col]
    }
  }

  // Back substitution (U x = y), in place
  for (let row = size - 1; row >= 0; row--) {
    for (let col = row + 1; col < size; col++) {
      solution[row] -= lu[row][col] * solution[col]
    }
    solution[row] /= lu[row][row]
  }

  return solution
}

const cross_2d = (origin: Vec2, point_a: Vec2, point_b: Vec2): number =>
  (point_a[0] - origin[0]) * (point_b[1] - origin[1]) -
  (point_a[1] - origin[1]) * (point_b[0] - origin[0])

// One half of Andrew's monotone chain built from x-then-y *pre-sorted* points
// (lower chain; pass reversed input for the upper chain).
const monotone_chain = (sorted: Vec2[], tolerance = 0): Vec2[] => {
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

  const sorted = points.toSorted((pt_a, pt_b) => pt_a[0] - pt_b[0] || pt_a[1] - pt_b[1])
  const lower = monotone_chain(sorted, tolerance)
  const upper = monotone_chain(sorted.toReversed(), tolerance)

  // Remove last point of each half (it's the first point of the other)
  lower.pop()
  upper.pop()

  return [...lower, ...upper]
}

// Loop-based min/max — Math.min/max(...arr) throws RangeError past ~125k arguments, which
// is reachable for per-frame trajectory metadata and phase-diagram entry lists. Empty input
// yields the identity element (±Infinity), so callers needing a real value must length-check.
export const array_min = (values: readonly number[]): number => array_extent(values)[0]

export const array_max = (values: readonly number[]): number => array_extent(values)[1]

// Single pass for callers that need both ends. NaN never wins either comparison, so it is
// skipped rather than poisoning the result the way a values[0] seed would.
export function array_extent(values: readonly number[]): Vec2 {
  let [min, max] = [Infinity, -Infinity]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return [min, max]
}

// Shared quantile + selection helpers used by box-plot.ts and kde.ts. quickselect partially
// sorts in place, so quantile_unordered mutates its input.
//
// Unguarded contract: both assume values.length > 0 and 0 <= p <= 1. Out-of-range inputs
// index past the array and yield undefined/NaN — callers (box-plot.ts, kde.ts) must length-
// and p-range-check before calling.

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

// Interpolate between the bracketing order statistics. Weighting both ends rather than
// adding `(hi - lo) * frac` keeps the result finite when the two straddle zero at a
// magnitude where their difference overflows, and still returns each endpoint exactly.
const lerp_quantile = (lo_val: number, hi_val: number, frac: number): number =>
  frac === 0 ? lo_val : lo_val * (1 - frac) + hi_val * frac

export function quantile_unordered(values: number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const lo_val = quickselect(values, lo)
  return hi === lo ? lo_val : lerp_quantile(lo_val, quickselect(values, hi), idx - lo)
}

// === Linear programming ===

export type LinearProgramStatus = `optimal` | `infeasible` | `unbounded`

export interface LinearProgramResult {
  status: LinearProgramStatus
  // Primal solution (length = number of columns); all zeros unless status is `optimal`
  solution: number[]
  // Objective value c · x at the solution (NaN unless `optimal`)
  objective: number
}

// Solve the linear program `minimize c · x subject to A x = b, x >= 0` with a dense two-phase
// tableau simplex using Bland's rule (smallest-index entering/leaving variable), which cannot
// cycle. Sized for small problems (a few constraints, up to a few thousand columns) such as
// convex-hull decompositions and reaction balancing. Rows of `A` that turn out linearly
// dependent are dropped during phase 1 when consistent and flagged infeasible otherwise.
export function solve_linear_program(
  objective: number[], // c, one entry per column
  constraints: number[][], // A, one row per equality constraint
  rhs: number[], // b, one entry per row
  tolerance = 1e-9,
): LinearProgramResult {
  const n_cols = objective.length
  const n_rows = constraints.length
  if (rhs.length !== n_rows || constraints.some((row) => row.length !== n_cols)) {
    throw new Error(
      `solve_linear_program: shape mismatch (c: ${n_cols}, A: ${n_rows}x${
        constraints[0]?.length ?? 0
      }, b: ${rhs.length})`,
    )
  }
  const zeros = () => Array.from({ length: n_cols }, () => 0)
  if (n_rows === 0) {
    // Only x >= 0 remains: unbounded if any cost is negative, else x = 0 is optimal
    if (objective.some((cost) => cost < -tolerance)) {
      return { status: `unbounded`, solution: zeros(), objective: NaN }
    }
    return { status: `optimal`, solution: zeros(), objective: 0 }
  }

  // Tableau columns: [original (n_cols) | artificial (n_rows) | rhs]. Rows flipped so b >= 0.
  // Each row is also divided by its largest coefficient, which leaves the feasible set alone
  // (scaling an equality by a positive constant is the same constraint) and puts every row on
  // the same order of magnitude. `tolerance` is applied as an absolute cutoff in the ratio test
  // and the linear-dependence check below, so without this a small but perfectly good pivot was
  // read as zero: `s*x0 + s*x1 = s` reported `unbounded` from s = 1e-9 down, and a two-row
  // problem whose second row carried 1e-10 coefficients had that row dropped as dependent and
  // returned a confidently wrong optimum.
  const n_art = n_rows
  const rhs_col = n_cols + n_art
  const tableau = constraints.map((row, row_idx) => {
    let row_scale = 0
    for (const value of row) row_scale = Math.max(row_scale, Math.abs(value))
    const sign =
      (rhs[row_idx] < 0 ? -1 : 1) / (row_scale > 0 && isFinite(row_scale) ? row_scale : 1)
    const full = Array.from({ length: rhs_col + 1 }, () => 0)
    for (let col = 0; col < n_cols; col++) full[col] = sign * row[col]
    full[n_cols + row_idx] = 1
    full[rhs_col] = sign * rhs[row_idx]
    return full
  })
  const basis = Array.from({ length: n_rows }, (_, row_idx) => n_cols + row_idx)

  const pivot = (pivot_row: number, pivot_col: number): void => {
    const row = tableau[pivot_row]
    const inv = 1 / row[pivot_col]
    for (let col = 0; col <= rhs_col; col++) row[col] *= inv
    for (let other_idx = 0; other_idx < tableau.length; other_idx++) {
      if (other_idx === pivot_row) continue
      const other = tableau[other_idx]
      const factor = other[pivot_col]
      if (factor === 0) continue
      for (let col = 0; col <= rhs_col; col++) other[col] -= factor * row[col]
    }
    basis[pivot_row] = pivot_col
  }

  // Reduced costs for a cost vector over the active columns: z_j = c_j - c_B · B^-1 A_j
  const reduced_costs = (costs: number[], active_cols: number): number[] => {
    const reduced = costs.slice(0, active_cols)
    for (let row_idx = 0; row_idx < tableau.length; row_idx++) {
      const basic_cost = costs[basis[row_idx]]
      if (basic_cost === 0) continue
      const row = tableau[row_idx]
      for (let col = 0; col < active_cols; col++) reduced[col] -= basic_cost * row[col]
    }
    return reduced
  }

  // Run simplex iterations for `costs` over the first `active_cols` columns (Bland's rule).
  // Returns false if the problem is unbounded in that direction.
  const iterate = (costs: number[], active_cols: number): boolean => {
    for (let iteration = 0; iteration < 50_000; iteration++) {
      const reduced = reduced_costs(costs, active_cols)
      const entering = reduced.findIndex((cost) => cost < -tolerance)
      if (entering === -1) return true
      let leaving = -1
      let best_ratio = Infinity
      for (let row_idx = 0; row_idx < tableau.length; row_idx++) {
        const coeff = tableau[row_idx][entering]
        if (coeff <= tolerance) continue
        const ratio = tableau[row_idx][rhs_col] / coeff
        if (
          ratio < best_ratio - tolerance ||
          (leaving !== -1 &&
            Math.abs(ratio - best_ratio) <= tolerance &&
            basis[row_idx] < basis[leaving])
        ) {
          best_ratio = ratio
          leaving = row_idx
        }
      }
      if (leaving === -1) return false
      pivot(leaving, entering)
    }
    throw new Error(`solve_linear_program: simplex did not converge within 50000 pivots`)
  }

  // Phase 1: minimize the sum of artificial variables
  const phase1_costs = Array.from({ length: rhs_col }, (_, col) => (col >= n_cols ? 1 : 0))
  iterate(phase1_costs, rhs_col)
  const infeasibility = tableau.reduce(
    (sum, row, row_idx) => sum + (basis[row_idx] >= n_cols ? row[rhs_col] : 0),
    0,
  )
  if (infeasibility > tolerance * Math.max(1, n_rows)) {
    return { status: `infeasible`, solution: zeros(), objective: NaN }
  }

  // Drive remaining (zero-level) artificials out of the basis; rows with no original column to
  // pivot on are linearly dependent on the others and can be dropped.
  for (let row_idx = tableau.length - 1; row_idx >= 0; row_idx--) {
    if (basis[row_idx] < n_cols) continue
    const pivot_col = tableau[row_idx].findIndex(
      (value, col) => col < n_cols && Math.abs(value) > tolerance,
    )
    if (pivot_col === -1) {
      tableau.splice(row_idx, 1)
      basis.splice(row_idx, 1)
    } else pivot(row_idx, pivot_col)
  }

  // Phase 2: minimize the real objective over the original columns only
  const phase2_costs = [...objective, ...Array.from({ length: n_art }, () => 0)]
  if (!iterate(phase2_costs, n_cols)) {
    return { status: `unbounded`, solution: zeros(), objective: NaN }
  }
  const solution = zeros()
  for (let row_idx = 0; row_idx < tableau.length; row_idx++) {
    const value = tableau[row_idx][rhs_col]
    solution[basis[row_idx]] = Math.abs(value) <= tolerance ? 0 : value
  }
  const objective_value = solution.reduce((sum, value, col) => sum + value * objective[col], 0)
  return { status: `optimal`, solution, objective: objective_value }
}
