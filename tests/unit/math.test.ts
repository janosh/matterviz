import type { NdVector, Vector } from '$lib'
import { add, dot, euclidean_dist, norm, scale } from '$lib'
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
