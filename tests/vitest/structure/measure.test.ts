import type { Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import {
  angle_at_center,
  angle_between_vectors,
  displacement_pbc,
  distance_pbc,
} from '$lib/structure/measure'
import { describe, expect, test } from 'vitest'

const cubic = (a: number): Matrix3x3 => [[a, 0, 0], [0, a, 0], [0, 0, a]]

describe(`measure: distances`, () => {
  test(`pbc distance uses minimum image`, () => {
    const L = 10
    const lat = cubic(L)
    const a: Vec3 = [0.5, 0.5, 0.5]
    const b: Vec3 = [9.8, 9.6, 9.5]
    // Direct distance is ~sqrt(9.3^2 + 9.1^2 + 9^2) but minimum image is small
    const disp = displacement_pbc(a, b, lat)
    expect(disp[0]).toBeCloseTo(-0.7, 10)
    expect(disp[1]).toBeCloseTo(-0.9, 10)
    expect(disp[2]).toBeCloseTo(-1.0, 10)
    expect(distance_pbc(a, b, lat)).toBeCloseTo(Math.hypot(0.7, 0.9, 1.0), 10)
  })
})

describe(`measure: angles`, () => {
  test.each([
    { v1: [1, 0, 0] as Vec3, v2: [0.5, Math.sqrt(3) / 2, 0] as Vec3, deg: 60 },
    { v1: [1, 0, 0] as Vec3, v2: [-1, 0, 0] as Vec3, deg: 180 },
    { v1: [0, 0, 0] as Vec3, v2: [1, 0, 0] as Vec3, deg: 0 },
  ] as Array<{ v1: Vec3; v2: Vec3; deg: number }>)(
    `angle_between_vectors %#`,
    ({ v1, v2, deg }: { v1: Vec3; v2: Vec3; deg: number }) => {
      expect(angle_between_vectors(v1, v2, `degrees`)).toBeCloseTo(deg, 10)
    },
  )

  test(`angle_between_vectors in radians mode`, () => {
    expect(angle_between_vectors([1, 0, 0], [0, 1, 0], `radians`)).toBeCloseTo(
      Math.PI / 2,
      10,
    )
  })

  test(`angle_at_center without pbc`, () => {
    const center: Vec3 = [0, 0, 0]
    const a: Vec3 = [1, 0, 0]
    const b: Vec3 = [0, 1, 0]
    expect(angle_at_center(center, a, b, undefined, `degrees`)).toBeCloseTo(90, 10)
  })

  test(`angle_at_center with pbc uses minimum image vectors`, () => {
    const lat = cubic(10)
    const center: Vec3 = [0.2, 0.2, 0.2]
    const a: Vec3 = [9.8, 0.2, 0.2] // effectively -0.4 along x from center
    const b: Vec3 = [0.2, 9.8, 0.2] // effectively -0.4 along y from center
    expect(angle_at_center(center, a, b, lat, `degrees`)).toBeCloseTo(90, 10)
  })
})
