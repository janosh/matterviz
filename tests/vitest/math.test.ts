import type { NdVector, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import { describe, expect, it, test } from 'vitest'

test(`norm of vector`, () => {
  expect(math.norm([3, 4])).toEqual(5)
})

test(`scale vector`, () => {
  expect(math.scale([1, 2, 3], 3)).toEqual([3, 6, 9])
})

test(`euclidean_dist between two vectors`, () => {
  expect(math.euclidean_dist([1, 2, 3], [4, 5, 6])).toEqual(Math.sqrt(27))
})

test.each([
  [[1, 2], [3, 4], [4, 6]],
  [[1, 2, 3], [4, 5, 6], [5, 7, 9]],
  [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], [8, 10, 12, 14, 16, 18]],
])(`add vectors`, (vec1, vec2, expected) => {
  expect(math.add(vec1, vec2)).toEqual(expected)
  expect(math.norm(math.add(vec1, vec2, math.scale(expected, -1)))).toEqual(0)
})

test.each([
  [[1, 2], [3, 4], 11],
  [[1, 2, 3], [4, 5, 6], 32],
])(`dot product`, (vec1, vec2, expected) => {
  expect(math.dot(vec1, vec2)).toEqual(expected)
})

test.each([
  // Identity matrix - should return the same vector
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [3, 4, 5], [3, 4, 5]],
  // Zero matrix - should return zero vector
  [[[0, 0, 0], [0, 0, 0], [0, 0, 0]], [1, 2, 3], [0, 0, 0]],
  // Zero vector - should return zero vector
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [0, 0, 0], [0, 0, 0]],
  // Basic multiplication
  [[[1, 2, 3], [4, 5, 6], [7, 8, 9]], [1, 2, 3], [14, 32, 50]],
  // Scaling matrix
  [[[2, 0, 0], [0, 3, 0], [0, 0, 4]], [1, 2, 3], [2, 6, 12]],
  // Rotation around z-axis (90 degrees)
  [[[0, -1, 0], [1, 0, 0], [0, 0, 1]], [1, 0, 0], [0, 1, 0]],
  // Complex example
  [[[1, 2, 3], [0, 1, 4], [5, 6, 0]], [2, 3, 1], [11, 7, 28]],
])(`mat3x3_vec3_multiply`, (matrix, vector, expected) => {
  expect(math.mat3x3_vec3_multiply(matrix as math.Matrix3x3, vector as math.Vec3))
    .toEqual(expected)
})

test(`dot matrix operations`, () => {
  const matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 9]] as unknown as NdVector
  const vector: NdVector = [2, 3, 4]
  expect(math.dot(matrix, vector)).toEqual([20, 47, 74])

  const matrix1 = [[1, 2, 3], [4, 5, 6]] as unknown as NdVector
  const matrix2 = [[7, 8], [9, 10], [11, 12]] as unknown as NdVector
  expect(math.dot(matrix1, matrix2)).toEqual([[58, 64], [139, 154]])
})

test.each([
  // Cubic lattices
  [[[5, 0, 0], [0, 5, 0], [0, 0, 5]], {
    a: 5,
    b: 5,
    c: 5,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 125,
  }],
  [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], {
    a: 1,
    b: 1,
    c: 1,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 1,
  }],
  // Tetragonal
  [[[3, 0, 0], [0, 3, 0], [0, 0, 6]], {
    a: 3,
    b: 3,
    c: 6,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 54,
  }],
  // Orthorhombic
  [[[4, 0, 0], [0, 5, 0], [0, 0, 6]], {
    a: 4,
    b: 5,
    c: 6,
    alpha: 90,
    beta: 90,
    gamma: 90,
    volume: 120,
  }],
  // Hexagonal (60° angle)
  [[[4, 0, 0], [2, 2 * Math.sqrt(3), 0], [0, 0, 8]], {
    a: 4,
    b: 4,
    c: 8,
    alpha: 90,
    beta: 90,
    gamma: 60,
    volume: 110.85,
  }],
  // Triclinic
  [[[3, 0, 0], [1, 2, 0], [0.5, 1, 2]], {
    a: 3,
    b: Math.sqrt(5),
    c: Math.sqrt(5.25),
    alpha: 60.79,
    beta: 77.40,
    gamma: 63.43,
    volume: 12,
  }],
])(`calc_lattice_params`, (matrix, expected) => {
  const result = math.calc_lattice_params(matrix as [Vec3, Vec3, Vec3])
  expect(result.a).toBeCloseTo(expected.a, 2)
  expect(result.b).toBeCloseTo(expected.b, 2)
  expect(result.c).toBeCloseTo(expected.c, 2)
  expect(result.alpha).toBeCloseTo(expected.alpha, 1)
  expect(result.beta).toBeCloseTo(expected.beta, 1)
  expect(result.gamma).toBeCloseTo(expected.gamma, 1)
  expect(result.volume).toBeCloseTo(expected.volume, 1)
})

test(`pbc_dist`, () => {
  const cubic_lattice: [Vec3, Vec3, Vec3] = [[10, 0, 0], [0, 10, 0], [0, 0, 10]]

  // Opposite corners via PBC
  expect(math.pbc_dist([1, 1, 1], [9, 9, 9], cubic_lattice)).toBeCloseTo(Math.sqrt(12), 3)
  expect(math.euclidean_dist([1, 1, 1], [9, 9, 9])).toBeCloseTo(13.856, 3)

  // Extreme PBC case
  expect(math.pbc_dist([0.5, 0.5, 0.5], [9.7, 9.7, 9.7], cubic_lattice)).toBeCloseTo(
    1.386,
    3,
  )

  // Close points
  const close_direct = math.euclidean_dist([2, 2, 2], [3, 3, 3])
  const close_pbc = math.pbc_dist([2, 2, 2], [3, 3, 3], cubic_lattice)
  expect(close_pbc).toBeCloseTo(close_direct, 5)
  expect(close_pbc).toBeCloseTo(1.732, 3)

  // 1D PBC
  expect(math.pbc_dist([0.5, 5, 5], [9.7, 5, 5], cubic_lattice)).toBeCloseTo(0.8, 5)

  // Hexagonal lattice
  const hex_lattice: [Vec3, Vec3, Vec3] = [[4, 0, 0], [2, 3.464, 0], [0, 0, 8]]
  expect(math.euclidean_dist([0.2, 0.2, 1], [3.8, 3.264, 7])).toBeCloseTo(7.639, 3)
  expect(math.pbc_dist([0.2, 0.2, 1], [3.8, 3.264, 7], hex_lattice)).toBeCloseTo(2.3, 3)
})

describe(`tensor conversion utilities`, () => {
  // Test fixtures
  const symmetric_tensor = [[1, 0.5, 0.3], [0.5, 2, 0.2], [0.3, 0.2, 3]]
  const expected_voigt = [1, 2, 3, 0.2, 0.3, 0.5]
  const flat_array = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  const tensor_3x3 = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]

  describe(`to_voigt`, () => {
    it(`converts symmetric tensor to Voigt notation`, () => {
      expect(math.to_voigt(symmetric_tensor)).toEqual(expected_voigt)
    })

    it.each([
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 1, 1, 0, 0, 0]],
      [`diagonal`, [[2, 0, 0], [0, 3, 0], [0, 0, 4]], [2, 3, 4, 0, 0, 0]],
      [`zero`, [[0, 0, 0], [0, 0, 0], [0, 0, 0]], [0, 0, 0, 0, 0, 0]],
      [`negative`, [[-1, -0.5, -0.3], [-0.5, -2, -0.2], [-0.3, -0.2, -3]], [
        -1,
        -2,
        -3,
        -0.2,
        -0.3,
        -0.5,
      ]],
    ])(`handles %s matrix`, (_, tensor, expected) => {
      expect(math.to_voigt(tensor)).toEqual(expected)
    })

    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`4x4`, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
      [`empty`, []],
      [`inconsistent rows`, [[1, 2], [3, 4, 5], [6, 7, 8]]],
    ])(`throws for %s matrix`, (_, invalid_tensor) => {
      expect(() => math.to_voigt(invalid_tensor as number[][])).toThrow(
        `Expected 3x3 tensor`,
      )
    })

    it(`preserves floating point precision`, () => {
      const precise = [[1.123456789, 0.987654321, 0.555555555], [
        0.987654321,
        2.111111111,
        0.333333333,
      ], [0.555555555, 0.333333333, 3.777777777]]
      const result = math.to_voigt(precise)
      expect(result[0]).toBeCloseTo(1.123456789, 9)
      expect(result[5]).toBeCloseTo(0.987654321, 9)
    })
  })

  describe(`from_voigt`, () => {
    it(`converts Voigt notation to symmetric tensor`, () => {
      expect(math.from_voigt(expected_voigt)).toEqual(symmetric_tensor)
    })

    it(`is inverse of to_voigt`, () => {
      const tensor = [[1.5, 0.7, 0.4], [0.7, 2.5, 0.6], [0.4, 0.6, 3.5]]
      const voigt = math.to_voigt(tensor)
      const reconstructed = math.from_voigt(voigt)

      for (let idx = 0; idx < 3; idx++) {
        for (let j = 0; j < 3; j++) {
          expect(reconstructed[idx][j]).toBeCloseTo(tensor[idx][j], 10)
        }
      }
    })

    it.each([
      [`identity`, [1, 1, 1, 0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`diagonal`, [2, 3, 4, 0, 0, 0], [[2, 0, 0], [0, 3, 0], [0, 0, 4]]],
      [`zero`, [0, 0, 0, 0, 0, 0], [[0, 0, 0], [0, 0, 0], [0, 0, 0]]],
    ])(`handles %s tensor`, (_, voigt, expected) => {
      expect(math.from_voigt(voigt)).toEqual(expected)
    })

    it.each([
      [`empty`, []],
      [`short`, [1, 2, 3]],
      [`long`, [1, 2, 3, 4, 5, 6, 7]],
    ])(`throws for %s array`, (_, invalid_voigt) => {
      expect(() => math.from_voigt(invalid_voigt)).toThrow(
        `Expected 6-element Voigt vector`,
      )
    })

    it(`maintains tensor symmetry`, () => {
      const result = math.from_voigt([1.5, 2.5, 3.5, 0.8, 0.6, 0.4])
      expect(result[0][1]).toBeCloseTo(result[1][0], 10)
      expect(result[0][2]).toBeCloseTo(result[2][0], 10)
      expect(result[1][2]).toBeCloseTo(result[2][1], 10)
    })
  })

  describe(`vec9_to_mat3x3`, () => {
    it(`converts 9-element array to 3x3 tensor`, () => {
      expect(math.vec9_to_mat3x3(flat_array)).toEqual(tensor_3x3)
    })

    it.each([
      [`identity`, [1, 0, 0, 0, 1, 0, 0, 0, 1], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`sequential`, [1, 2, 3, 4, 5, 6, 7, 8, 9], [[1, 2, 3], [4, 5, 6], [7, 8, 9]]],
      [`negative`, [-1, -2, -3, -4, -5, -6, -7, -8, -9], [[-1, -2, -3], [-4, -5, -6], [
        -7,
        -8,
        -9,
      ]]],
      [`float`, [1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9], [[1.1, 2.2, 3.3], [
        4.4,
        5.5,
        6.6,
      ], [7.7, 8.8, 9.9]]],
    ])(`handles %s numbers`, (_, input, expected) => {
      expect(math.vec9_to_mat3x3(input)).toEqual(expected)
    })

    it.each([
      [`empty`, []],
      [`short`, [1, 2, 3]],
      [`long`, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ])(`throws for %s array`, (_, invalid_array) => {
      expect(() => math.vec9_to_mat3x3(invalid_array)).toThrow(
        `Expected 9-element array`,
      )
    })

    it(`preserves row-major order`, () => {
      const input = [11, 12, 13, 21, 22, 23, 31, 32, 33]
      const result = math.vec9_to_mat3x3(input)
      expect(result[0]).toEqual([11, 12, 13])
      expect(result[1]).toEqual([21, 22, 23])
      expect(result[2]).toEqual([31, 32, 33])
    })
  })

  describe(`tensor_to_flat_array`, () => {
    it(`converts 3x3 tensor to 9-element array`, () => {
      expect(math.tensor_to_flat_array(tensor_3x3)).toEqual(flat_array)
    })

    it(`is inverse of vec9_to_mat3x3`, () => {
      const original = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5]
      const tensor = math.vec9_to_mat3x3(original)
      expect(math.tensor_to_flat_array(tensor)).toEqual(original)
    })

    it.each([
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [1, 0, 0, 0, 1, 0, 0, 0, 1]],
      [`symmetric`, [[1, 2, 3], [2, 4, 5], [3, 5, 6]], [1, 2, 3, 2, 4, 5, 3, 5, 6]],
      [`negative`, [[-1, -2, -3], [-4, -5, -6], [-7, -8, -9]], [
        -1,
        -2,
        -3,
        -4,
        -5,
        -6,
        -7,
        -8,
        -9,
      ]],
    ])(`handles %s matrix`, (_, tensor, expected) => {
      expect(math.tensor_to_flat_array(tensor)).toEqual(expected)
    })

    it.each([
      [`2x2`, [[1, 2], [3, 4]]],
      [`4x4`, [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16]]],
      [`empty`, []],
      [`inconsistent`, [[1, 2, 3], [4, 5], [6, 7, 8]]],
    ])(`throws for %s matrix`, (_, invalid_tensor) => {
      expect(() => math.tensor_to_flat_array(invalid_tensor as number[][])).toThrow(
        `Expected 3x3 tensor`,
      )
    })
  })

  describe(`transpose_matrix`, () => {
    it.each([
      [`basic`, [[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[1, 4, 7], [2, 5, 8], [3, 6, 9]]],
      [`identity`, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[1, 0, 0], [0, 1, 0], [0, 0, 1]]],
      [`negative`, [[-1, 2, -3], [4, -5, 6], [-7, 8, -9]], [[-1, 4, -7], [2, -5, 8], [
        -3,
        6,
        -9,
      ]]],
    ])(`%s matrix`, (_, input, expected) => {
      expect(math.transpose_matrix(input as [Vec3, Vec3, Vec3])).toEqual(
        expected,
      )
    })

    it(`is involution (A^T^T = A)`, () => {
      const matrix: [Vec3, Vec3, Vec3] = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
      expect(math.transpose_matrix(math.transpose_matrix(matrix))).toEqual(matrix)
    })
  })

  describe(`cell_to_lattice_matrix`, () => {
    it(`creates orthogonal lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(5, 6, 7, 90, 90, 90)

      expect(matrix[0]).toEqual([5, 0, 0])
      expect(matrix[1][0]).toBeCloseTo(0, 10)
      expect(matrix[1][1]).toBeCloseTo(6, 10)
      expect(matrix[1][2]).toBeCloseTo(0, 10)
      expect(matrix[2][0]).toBeCloseTo(0, 10)
      expect(matrix[2][1]).toBeCloseTo(0, 10)
      expect(matrix[2][2]).toBeCloseTo(7, 10)
    })

    it(`creates hexagonal lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(4, 4, 6, 90, 90, 120)

      expect(matrix[0]).toEqual([4, 0, 0])
      expect(matrix[1][0]).toBeCloseTo(-2, 6) // 4 * cos(120°) = 4 * (-0.5) = -2
      expect(matrix[1][1]).toBeCloseTo(3.464, 3) // 4 * sin(120°) ≈ 3.464
      expect(matrix[1][2]).toBeCloseTo(0, 10)
      expect(matrix[2][0]).toBeCloseTo(0, 10)
      expect(matrix[2][1]).toBeCloseTo(0, 10)
      expect(matrix[2][2]).toBeCloseTo(6, 10)
    })

    it(`creates triclinic lattice matrix`, () => {
      const matrix = math.cell_to_lattice_matrix(5, 6, 7, 80, 85, 95)

      // First vector should be along x-axis
      expect(matrix[0]).toEqual([5, 0, 0])

      // Second vector should be in xy-plane
      expect(matrix[1][0]).toBeCloseTo(6 * Math.cos(95 * Math.PI / 180), 6)
      expect(matrix[1][1]).toBeCloseTo(6 * Math.sin(95 * Math.PI / 180), 6)
      expect(matrix[1][2]).toBeCloseTo(0, 10)

      // Third vector has all three components
      expect(matrix[2][0]).toBeCloseTo(7 * Math.cos(85 * Math.PI / 180), 6)
      expect(matrix[2][1]).not.toBeCloseTo(0, 3) // Should have y-component
      expect(matrix[2][2]).not.toBeCloseTo(0, 3) // Should have z-component
    })

    it(`round-trip consistency with calc_lattice_params`, () => {
      const [a, b, c, alpha, beta, gamma] = [4.5, 5.2, 6.8, 85, 92, 105]
      const matrix = math.cell_to_lattice_matrix(a, b, c, alpha, beta, gamma)
      const params = math.calc_lattice_params(matrix)

      expect(params.a).toBeCloseTo(a, 10)
      expect(params.b).toBeCloseTo(b, 10)
      expect(params.c).toBeCloseTo(c, 10)
      expect(params.alpha).toBeCloseTo(alpha, 6)
      expect(params.beta).toBeCloseTo(beta, 6)
      expect(params.gamma).toBeCloseTo(gamma, 6)
    })
  })

  describe(`Integration & Edge Cases`, () => {
    it(`maintains round-trip consistency`, () => {
      const stress_tensors = [
        [[100, 0, 0], [0, 100, 0], [0, 0, 100]], // hydrostatic
        [[200, 0, 0], [0, 0, 0], [0, 0, 0]], // uniaxial
        [[0, 50, 0], [50, 0, 0], [0, 0, 0]], // shear
        [[150, 75, 25], [75, 200, 50], [25, 50, 300]], // complex
      ]

      const test_arrays = [
        [1, 2, 3, 4, 5, 6, 7, 8, 9],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-1, -2, -3, -4, -5, -6, -7, -8, -9],
        [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5],
      ]

      // Test Voigt round-trip
      stress_tensors.forEach((tensor) => {
        const voigt = math.to_voigt(tensor)
        const reconstructed = math.from_voigt(voigt)
        for (let idx = 0; idx < 3; idx++) {
          for (let j = 0; j < 3; j++) {
            expect(reconstructed[idx][j]).toBeCloseTo(tensor[idx][j], 10)
          }
        }
      })

      // Test flat array round-trip
      test_arrays.forEach((array) => {
        const tensor = math.vec9_to_mat3x3(array)
        const reconstructed = math.tensor_to_flat_array(tensor)
        expect(reconstructed).toEqual(array)
      })
    })

    it(`handles real-world stress calculations`, () => {
      // MD simulation stress tensor (GPa)
      const md_stress = [[0.125, 0.003, -0.012], [0.003, 0.089, 0.007], [
        -0.012,
        0.007,
        0.156,
      ]]
      const voigt = math.to_voigt(md_stress)

      expect(voigt).toEqual([0.125, 0.089, 0.156, 0.007, -0.012, 0.003])
      expect(-(voigt[0] + voigt[1] + voigt[2]) / 3).toBeCloseTo(-0.123333, 5) // pressure

      const reconstructed = math.from_voigt(voigt)
      expect(reconstructed[0][0]).toBeCloseTo(0.125, 10)
      expect(reconstructed[0][1]).toBeCloseTo(reconstructed[1][0], 10) // symmetry
    })

    it(`calculates materials science properties`, () => {
      const stress = [[100, 20, 10], [20, 150, 30], [10, 30, 200]]
      const [s11, s22, s33, s23, s13, s12] = math.to_voigt(stress)

      // von Mises stress
      const von_mises = Math.sqrt(
        0.5 * ((s11 - s22) ** 2 + (s22 - s33) ** 2 + (s33 - s11) ** 2) +
          3 * (s12 ** 2 + s13 ** 2 + s23 ** 2),
      )
      expect(von_mises).toBeCloseTo(108.17, 2)

      // pressure and max shear
      expect(-(s11 + s22 + s33) / 3).toBeCloseTo(-150, 5)
      expect(
        Math.max(
          Math.abs(s11 - s22) / 2,
          Math.abs(s22 - s33) / 2,
          Math.abs(s33 - s11) / 2,
        ),
      ).toBeCloseTo(50, 5)
    })

    it.each([
      [`large numbers`, [[1e10, 1e9, 1e8], [1e9, 1e11, 1e7], [1e8, 1e7, 1e12]]],
      [`small numbers`, [[1e-10, 1e-11, 1e-12], [1e-11, 1e-9, 1e-13], [
        1e-12,
        1e-13,
        1e-8,
      ]]],
      [`NaN values`, [[NaN, 1, 2], [1, NaN, 3], [2, 3, NaN]]],
      [`Infinity values`, [[Infinity, 1, 2], [1, -Infinity, 3], [2, 3, Infinity]]],
    ])(`handles %s`, (_, tensor) => {
      const voigt = math.to_voigt(tensor)
      const reconstructed = math.from_voigt(voigt)

      if (tensor.some((row) => row.some((val) => isNaN(val)))) {
        expect(voigt.some((val) => isNaN(val))).toBe(true)
        expect(reconstructed.some((row) => row.some((val) => isNaN(val)))).toBe(true)
      } else if (tensor.some((row) => row.some((val) => !Number.isFinite(val)))) {
        expect(voigt.some((val) => !Number.isFinite(val))).toBe(true)
      } else {
        expect(reconstructed[0][0]).toBeCloseTo(tensor[0][0], -5)
      }
    })
  })
})
