// Tests for point group symmetry operations
import { IDENTITY_4x4, OH_SYMMETRY_MATRICES } from '$lib/fermi-surface/symmetry'
import { describe, expect, it } from 'vitest'

describe(`symmetry module`, () => {
  describe(`OH_SYMMETRY_MATRICES`, () => {
    it(`should have exactly 48 symmetry operations`, () => {
      expect(OH_SYMMETRY_MATRICES).toHaveLength(48)
    })

    it(`should include the identity matrix`, () => {
      const identity_found = OH_SYMMETRY_MATRICES.some(
        (mat) => JSON.stringify(mat) === JSON.stringify(IDENTITY_4x4),
      )
      expect(identity_found).toBe(true)
    })

    it(`should have all matrices with determinant ±1`, () => {
      for (const mat of OH_SYMMETRY_MATRICES) {
        // Extract 3x3 rotation part (column-major)
        const det = mat[0] * (mat[5] * mat[10] - mat[6] * mat[9]) -
          mat[4] * (mat[1] * mat[10] - mat[2] * mat[9]) +
          mat[8] * (mat[1] * mat[6] - mat[2] * mat[5])

        expect(Math.abs(Math.abs(det) - 1)).toBeLessThan(1e-10)
      }
    })

    it(`should have all unique matrices`, () => {
      const unique_strs = new Set(OH_SYMMETRY_MATRICES.map((mat) => JSON.stringify(mat)))
      expect(unique_strs.size).toBe(48)
    })
  })
})
