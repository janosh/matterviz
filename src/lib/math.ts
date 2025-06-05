export type Vector = [number, number, number]
export type NdVector = number[]

export function norm(vec: NdVector): number {
  return Math.sqrt(vec.reduce((acc, val) => acc + val ** 2, 0))
}

export function scale(vec: NdVector, factor: number): NdVector {
  return vec.map((component) => component * factor)
}

export function euclidean_dist(vec1: Vector, vec2: Vector): number {
  return norm(add(vec1, scale(vec2, -1)))
}

// Calculate the minimum distance between two points considering periodic boundary conditions.
export function pbc_dist(
  pos1: Vector, // First position vector (Cartesian coordinates)
  pos2: Vector, // Second position vector (Cartesian coordinates)
  lattice_matrix: [Vector, Vector, Vector], // 3x3 lattice matrix where each row is a lattice vector
  lattice_inv?: [Vector, Vector, Vector], // Optional pre-computed inverse matrix for optimization (since lattice is usually constant and repeatedly inverting matrix is expensive)
): number {
  // Use provided inverse or compute it
  const inv_matrix = lattice_inv ?? matrix_inverse_3x3(lattice_matrix)

  // Convert Cartesian coordinates to fractional coordinates
  const frac1 = matrix_vector_multiply(inv_matrix, pos1)
  const frac2 = matrix_vector_multiply(inv_matrix, pos2)

  // Calculate fractional distance vector
  const frac_diff = add(frac1, scale(frac2, -1))

  // Apply minimum image convention: wrap to [-0.5, 0.5)
  const wrapped_frac_diff: Vector = frac_diff.map((x) => {
    // Wrap to [0, 1) first, then shift to [-0.5, 0.5)
    let wrapped = x - Math.floor(x)
    if (wrapped >= 0.5) wrapped -= 1
    return wrapped
  }) as Vector

  // Convert back to Cartesian coordinates
  const cart_diff = matrix_vector_multiply(lattice_matrix, wrapped_frac_diff)

  return norm(cart_diff)
}

function matrix_inverse_3x3(
  matrix: [Vector, Vector, Vector],
): [Vector, Vector, Vector] {
  /** Calculate the inverse of a 3x3 matrix */
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)

  if (Math.abs(det) < 1e-10) {
    throw `Matrix is singular and cannot be inverted`
  }

  const inv_det = 1 / det

  return [
    [
      (e * i - f * h) * inv_det,
      (c * h - b * i) * inv_det,
      (b * f - c * e) * inv_det,
    ],
    [
      (f * g - d * i) * inv_det,
      (a * i - c * g) * inv_det,
      (c * d - a * f) * inv_det,
    ],
    [
      (d * h - e * g) * inv_det,
      (b * g - a * h) * inv_det,
      (a * e - b * d) * inv_det,
    ],
  ]
}

function matrix_vector_multiply(
  matrix: [Vector, Vector, Vector],
  vector: Vector,
): Vector {
  /** Multiply a 3x3 matrix by a 3D vector */
  return [
    matrix[0][0] * vector[0] +
      matrix[0][1] * vector[1] +
      matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] +
      matrix[1][1] * vector[1] +
      matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] +
      matrix[2][1] * vector[1] +
      matrix[2][2] * vector[2],
  ]
}

export function add(...vecs: NdVector[]): NdVector {
  // add up any number of same-length vectors
  if (vecs.length === 0) return []

  const first_vec = vecs[0]
  const length = first_vec.length

  // Validate all vectors have the same length
  for (const vec of vecs) {
    if (vec.length !== length) {
      throw `All vectors must have the same length`
    }
  }

  const result = new Array(length).fill(0)
  for (const vec of vecs) {
    for (let idx = 0; idx < length; idx++) {
      result[idx] += vec[idx]
    }
  }
  return result
}

export function dot(
  x1: NdVector,
  x2: NdVector,
): number | number[] | number[][] {
  // Handle the case where both inputs are scalars
  if (typeof x1 === `number` && typeof x2 === `number`) {
    return x1 * x2
  }

  // Handle the case where one input is a scalar and the other is a vector
  if (typeof x1 === `number` && Array.isArray(x2)) {
    throw `Scalar and vector multiplication is not supported`
  }
  if (Array.isArray(x1) && typeof x2 === `number`) {
    throw `Vector and scalar multiplication is not supported`
  }

  // At this point, we know that both inputs are arrays
  const vec1 = x1 as number[]
  const vec2 = x2 as number[]

  // Handle the case where both inputs are vectors
  if (!Array.isArray(vec1[0]) && !Array.isArray(vec2[0])) {
    if (vec1.length !== vec2.length) {
      throw `Vectors must be of same length`
    }
    return vec1.reduce((sum, val, index) => sum + val * vec2[index], 0)
  }

  // Handle the case where the first input is a matrix and the second is a vector
  if (Array.isArray(vec1[0]) && !Array.isArray(vec2[0])) {
    const mat1 = vec1 as unknown as number[][]
    if (mat1[0].length !== vec2.length) {
      throw `Number of columns in matrix must be equal to number of elements in vector`
    }
    return mat1.map((row) =>
      row.reduce((sum, val, index) => sum + val * vec2[index], 0),
    )
  }

  // Handle the case where both inputs are matrices
  if (Array.isArray(vec1[0]) && Array.isArray(vec2[0])) {
    const mat1 = vec1 as unknown as number[][]
    const mat2 = vec2 as unknown as number[][]
    if (mat1[0].length !== mat2.length) {
      throw `Number of columns in first matrix must be equal to number of rows in second matrix`
    }
    return mat1.map((row, i) =>
      mat2[0].map((_, j) =>
        row.reduce((sum, _, k) => sum + mat1[i][k] * mat2[k][j], 0),
      ),
    )
  }

  // Handle any other cases
  throw `Unsupported input dimensions. Inputs must be scalars, vectors, or matrices.`
}
