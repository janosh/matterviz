export type Vector = [number, number, number]
export type NdVector = number[]

export function norm(vec: NdVector): number {
  return Math.sqrt(vec.reduce((acc, val) => acc + val ** 2, 0))
}

export function scale(vec: NdVector, factor: number): NdVector {
  return vec.map((val) => val * factor)
}

export function euclidean_dist(vec1: Vector, vec2: Vector): number {
  return norm(add(vec1, scale(vec2, -1)))
}

export function add(...vecs: NdVector[]): NdVector {
  // add up any number of same-length vectors
  const result = vecs[0].slice()
  for (const vec of vecs.slice(1)) {
    for (const [idx, val] of vec.entries()) {
      result[idx] += val
    }
  }
  return result
}

export function dot(x1: NdVector, x2: NdVector): number | number[] {
  // Handle the case where both inputs are scalars
  if (typeof x1 === `number` && typeof x2 === `number`) {
    return x1 * x2
  }

  // Handle the case where one input is a scalar and the other is a vector
  if (typeof x1 === `number` && Array.isArray(x2)) {
    throw new Error(`Scalar and vector multiplication is not supported`)
  }
  if (Array.isArray(x1) && typeof x2 === `number`) {
    throw new Error(`Vector and scalar multiplication is not supported`)
  }

  // At this point, we know that both inputs are arrays
  const vec1 = x1 as number[]
  const vec2 = x2 as number[]

  // Handle the case where both inputs are vectors
  if (!Array.isArray(vec1[0]) && !Array.isArray(vec2[0])) {
    if (vec1.length !== vec2.length) {
      throw new Error(`Vectors must be of same length`)
    }
    return vec1.reduce((sum, val, index) => sum + val * vec2[index], 0)
  }

  // Handle the case where the first input is a matrix and the second is a vector
  if (Array.isArray(vec1[0]) && !Array.isArray(vec2[0])) {
    const mat1 = vec1 as number[][]
    if (mat1[0].length !== vec2.length) {
      throw new Error(
        `Number of columns in matrix must be equal to number of elements in vector`,
      )
    }
    return mat1.map((row) =>
      row.reduce((sum, val, index) => sum + val * vec2[index], 0),
    )
  }

  // Handle the case where both inputs are matrices
  if (Array.isArray(vec1[0]) && Array.isArray(vec2[0])) {
    const mat1 = vec1 as number[][]
    const mat2 = vec2 as number[][]
    if (mat1[0].length !== mat2.length) {
      throw new Error(
        `Number of columns in first matrix must be equal to number of rows in second matrix`,
      )
    }
    return mat1.map((row, i) =>
      mat2[0].map((_, j) =>
        row.reduce((sum, _, k) => sum + mat1[i][k] * mat2[k][j], 0),
      ),
    )
  }

  // Handle any other cases
  throw new Error(
    `Unsupported input dimensions. Inputs must be scalars, vectors, or matrices.`,
  )
}
