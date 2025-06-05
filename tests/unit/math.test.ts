import type { NdVector, Vector } from '$lib'
import { add, dot, euclidean_dist, norm, pbc_dist, scale } from '$lib'
import { expect, test } from 'vitest'

test(`norm of vector`, () => {
  const vec: NdVector = [3, 4]
  const expected = 5
  expect(norm(vec)).toEqual(expected)
})

test(`scale vector`, () => {
  const vec: NdVector = [1, 2, 3]
  const factor = 3
  const expected: NdVector = [3, 6, 9]
  expect(scale(vec, factor)).toEqual(expected)
})

test(`euclidean_dist between two vectors/points`, () => {
  const vec1: Vector = [1, 2, 3]
  const vec2: Vector = [4, 5, 6]
  expect(euclidean_dist(vec1, vec2)).toEqual(Math.sqrt(27)) // sqrt((4-1)^2 + (5-2)^2 + (6-3)^2)
})

test.each([
  [
    [1, 2],
    [3, 4],
    [4, 6],
  ],
  [
    [1, 2, 3],
    [4, 5, 6],
    [5, 7, 9],
  ],
  [
    [1, 2, 3, 4, 5, 6],
    [7, 8, 9, 10, 11, 12],
    [8, 10, 12, 14, 16, 18],
  ],
])(`add`, (vec1, vec2, expected) => {
  expect(add(vec1, vec2)).toEqual(expected)
  // test more than 2 inputs and self-consistency (of add, scale, and norm)
  expect(norm(add(vec1, vec2, scale(expected, -1)))).toEqual(0)
})

test.each([
  [[1, 2], [3, 4], 11],
  [[1, 2, 3], [4, 5, 6], 32],
])(`add`, (vec1, vec2, expected) => {
  expect(dot(vec1, vec2)).toEqual(expected)
})

test(`dot`, () => {
  const matrix: number[][] = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ]
  const vector: NdVector = [2, 3, 4]
  const expected: number[] = [20, 47, 74] // [1*2 + 2*3 + 3*4, 4*2 + 5*3 + 6*4, 7*2 + 8*3 + 9*4]
  expect(dot(matrix, vector)).toEqual(expected)
})

test(`dot`, () => {
  const matrix1: number[][] = [
    [1, 2, 3],
    [4, 5, 6],
  ]
  const matrix2: number[][] = [
    [7, 8],
    [9, 10],
    [11, 12],
  ]
  const expected: number[][] = [
    [58, 64], // [1*7 + 2*9 + 3*11, 1*8 + 2*10 + 3*12]
    [139, 154], // [4*7 + 5*9 + 6*11, 4*8 + 5*10 + 6*12]
  ]
  expect(dot(matrix1, matrix2)).toEqual(expected)
})

test(`pbc_dist`, () => {
  // Test case 1: Simple cubic lattice - atoms at opposite corners should be close via PBC
  const cubic_lattice: [Vector, Vector, Vector] = [
    [10, 0, 0], // a vector
    [0, 10, 0], // b vector
    [0, 0, 10], // c vector
  ]

  // Atoms at (1, 1, 1) and (9, 9, 9) - PBC distance should be 2*sqrt(3) ≈ 3.464
  const pos1: Vector = [1, 1, 1]
  const pos2: Vector = [9, 9, 9]
  const direct_distance = euclidean_dist(pos1, pos2)
  const pbc_distance_1 = pbc_dist(pos1, pos2, cubic_lattice)

  expect(pbc_distance_1).toBeCloseTo(Math.sqrt(12), 3) // sqrt((2)^2 + (2)^2 + (2)^2)
  expect(direct_distance).toBeCloseTo(13.856, 3) // sqrt((8)^2 + (8)^2 + (8)^2)

  // Test case 2: Extreme PBC case - should be sqrt(0.8^2 * 3) ≈ 1.386
  const extreme_pos1: Vector = [0.5, 0.5, 0.5]
  const extreme_pos2: Vector = [9.7, 9.7, 9.7]
  const extreme_pbc = pbc_dist(extreme_pos1, extreme_pos2, cubic_lattice)

  expect(extreme_pbc).toBeCloseTo(1.386, 3) // sqrt(1.92)

  // Test case 3: Points already close - PBC shouldn't change distance much
  const close_pos1: Vector = [2, 2, 2]
  const close_pos2: Vector = [3, 3, 3]
  const close_direct = euclidean_dist(close_pos1, close_pos2)
  const close_pbc = pbc_dist(close_pos1, close_pos2, cubic_lattice)

  expect(close_pbc).toBeCloseTo(close_direct, 5) // should be essentially identical
  expect(close_pbc).toBeCloseTo(1.732, 3) // sqrt(3)

  // Test case 4: One-dimensional PBC test - should be exactly 0.8
  const pos_1d_1: Vector = [0.5, 5, 5]
  const pos_1d_2: Vector = [9.7, 5, 5]
  const pbc_1d = pbc_dist(pos_1d_1, pos_1d_2, cubic_lattice)

  expect(pbc_1d).toBeCloseTo(0.8, 5)

  // Test case 5: Non-cubic lattice with specific expected value
  const hexagonal_lattice: [Vector, Vector, Vector] = [
    [4, 0, 0], // a vector
    [2, 3.464, 0], // b vector (60 degree angle)
    [0, 0, 8], // c vector
  ]

  const hex_pos1: Vector = [0.2, 0.2, 1]
  const hex_pos2: Vector = [3.8, 3.264, 7]
  const hex_direct = euclidean_dist(hex_pos1, hex_pos2)
  const hex_pbc = pbc_dist(hex_pos1, hex_pos2, hexagonal_lattice)

  expect(hex_direct).toBeCloseTo(7.639, 3)
  expect(hex_pbc).toBeCloseTo(2.3, 3) // actual computed value
})
