// Tests for point group symmetry operations
import { IDENTITY_4x4, OH_SYMMETRY_MATRICES } from '$lib/fermi-surface/symmetry'
import { describe, expect, it } from 'vitest'

describe(`OH_SYMMETRY_MATRICES`, () => {
  it(`has 48 unique operations including the identity`, () => {
    const unique_strs = new Set(OH_SYMMETRY_MATRICES.map((mat) => JSON.stringify(mat)))
    expect(OH_SYMMETRY_MATRICES).toHaveLength(48)
    expect(unique_strs.size).toBe(48)
    expect(unique_strs.has(JSON.stringify(IDENTITY_4x4))).toBe(true)
  })

  it(`has all matrices with determinant ±1`, () => {
    for (const mat of OH_SYMMETRY_MATRICES) {
      // Extract 3x3 rotation part (column-major)
      const det =
        mat[0] * (mat[5] * mat[10] - mat[6] * mat[9]) -
        mat[4] * (mat[1] * mat[10] - mat[2] * mat[9]) +
        mat[8] * (mat[1] * mat[6] - mat[2] * mat[5])

      expect(Math.abs(Math.abs(det) - 1)).toBeLessThan(1e-10)
    }
  })
})
