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

  test(`displacement_pbc edge cases`, () => {
    const lat = cubic(10)

    // Test identical positions
    const pos: Vec3 = [5.0, 5.0, 5.0]
    const disp_identical = displacement_pbc(pos, pos, lat)
    expect(disp_identical).toEqual([0, 0, 0])

    // Test positions at exact cell boundaries
    const boundary_cases = [
      {
        from: [0.0, 0.0, 0.0] as Vec3,
        to: [10.0, 0.0, 0.0] as Vec3,
        expected: [0, 0, 0],
      },
      {
        from: [0.0, 0.0, 0.0] as Vec3,
        to: [0.0, 10.0, 0.0] as Vec3,
        expected: [0, 0, 0],
      },
      {
        from: [0.0, 0.0, 0.0] as Vec3,
        to: [0.0, 0.0, 10.0] as Vec3,
        expected: [0, 0, 0],
      },
    ]

    for (const { from, to, expected } of boundary_cases) {
      const disp = displacement_pbc(from, to, lat)
      expect(disp).toEqual(expected)
    }

    // Test very small displacements
    const small_cases = [
      { from: [5.0, 5.0, 5.0] as Vec3, to: [5.000001, 5.000001, 5.000001] as Vec3 },
      { from: [5.0, 5.0, 5.0] as Vec3, to: [4.999999, 4.999999, 4.999999] as Vec3 },
    ]

    for (const { from, to } of small_cases) {
      const disp = displacement_pbc(from, to, lat)
      const direct = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
      expect(disp[0]).toBeCloseTo(direct[0], 6)
      expect(disp[1]).toBeCloseTo(direct[1], 6)
      expect(disp[2]).toBeCloseTo(direct[2], 6)
    }

    // Test non-cubic lattice
    const triclinic_lat: Matrix3x3 = [[5.0, 0.0, 0.0], [2.5, 4.33, 0.0], [1.0, 1.0, 4.0]]
    const tric_pos1: Vec3 = [0.2, 0.2, 0.2]
    const tric_pos2: Vec3 = [4.8, 4.1, 3.8]
    const tric_disp = displacement_pbc(tric_pos1, tric_pos2, triclinic_lat)

    // Verify the displacement is reasonable
    expect(Math.hypot(...tric_disp)).toBeGreaterThan(0)
    expect(Math.hypot(...tric_disp)).toBeLessThan(10) // Should be less than cell size
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

  test(`angle_between_vectors zero vector handling`, () => {
    // Test zero vectors (should return 0 as per implementation)
    expect(angle_between_vectors([0, 0, 0], [1, 0, 0], `degrees`)).toBe(0)
    expect(angle_between_vectors([1, 0, 0], [0, 0, 0], `degrees`)).toBe(0)
    expect(angle_between_vectors([0, 0, 0], [0, 0, 0], `degrees`)).toBe(0)

    // Test very small vectors (near zero)
    const tiny = 1e-15
    expect(angle_between_vectors([tiny, 0, 0], [1, 0, 0], `degrees`)).toBeCloseTo(0, 10)
    expect(angle_between_vectors([1, 0, 0], [0, tiny, 0], `degrees`)).toBeCloseTo(90, 10)

    // Test orthogonal vectors
    expect(angle_between_vectors([1, 0, 0], [0, 1, 0], `degrees`)).toBeCloseTo(90, 10)
    expect(angle_between_vectors([1, 0, 0], [0, 0, 1], `degrees`)).toBeCloseTo(90, 10)
    expect(angle_between_vectors([0, 1, 0], [0, 0, 1], `degrees`)).toBeCloseTo(90, 10)

    // Test parallel vectors
    expect(angle_between_vectors([1, 0, 0], [2, 0, 0], `degrees`)).toBeCloseTo(0, 10)
    expect(angle_between_vectors([1, 1, 1], [2, 2, 2], `degrees`)).toBeCloseTo(0, 10)

    // Test antiparallel vectors
    expect(angle_between_vectors([1, 0, 0], [-1, 0, 0], `degrees`)).toBeCloseTo(180, 10)
    expect(angle_between_vectors([1, 1, 1], [-1, -1, -1], `degrees`)).toBeCloseTo(180, 10)
  })

  test(`angle_at_center without pbc`, () => {
    const center: Vec3 = [0, 0, 0]
    const a: Vec3 = [1, 0, 0]
    const b: Vec3 = [0, 1, 0]
    expect(angle_at_center(center, a, b, undefined, undefined, `degrees`)).toBeCloseTo(
      90,
      10,
    )
  })

  test(`angle_at_center with pbc uses minimum image vectors`, () => {
    const lat = cubic(10)
    const center: Vec3 = [0.2, 0.2, 0.2]
    const a: Vec3 = [9.8, 0.2, 0.2] // effectively -0.4 along x from center
    const b: Vec3 = [0.2, 9.8, 0.2] // effectively -0.4 along y from center
    expect(angle_at_center(center, a, b, lat, undefined, `degrees`)).toBeCloseTo(90, 10)
  })

  test(`angle_at_center edge cases`, () => {
    const lat = cubic(10)

    // Test center at origin
    const center_origin: Vec3 = [0, 0, 0]
    const a_origin: Vec3 = [1, 0, 0]
    const b_origin: Vec3 = [0, 1, 0]
    expect(
      angle_at_center(center_origin, a_origin, b_origin, undefined, undefined, `degrees`),
    )
      .toBeCloseTo(90, 10)

    // Test center at cell boundary
    const center_boundary: Vec3 = [5, 5, 5]
    const a_boundary: Vec3 = [6, 5, 5]
    const b_boundary: Vec3 = [5, 6, 5]
    expect(
      angle_at_center(
        center_boundary,
        a_boundary,
        b_boundary,
        undefined,
        undefined,
        `degrees`,
      ),
    )
      .toBeCloseTo(90, 10)

    // Test with PBC where vectors wrap around
    const center_wrap: Vec3 = [0.1, 0.1, 0.1]
    const a_wrap: Vec3 = [9.9, 0.1, 0.1] // wraps to -0.1
    const b_wrap: Vec3 = [0.1, 9.9, 0.1] // wraps to -0.1
    expect(angle_at_center(center_wrap, a_wrap, b_wrap, lat, undefined, `degrees`))
      .toBeCloseTo(
        90,
        10,
      )

    // Test very small angles
    const center_small: Vec3 = [5, 5, 5]
    const a_small: Vec3 = [5.001, 5, 5]
    const b_small: Vec3 = [5, 5.001, 5]
    const small_angle = angle_at_center(
      center_small,
      a_small,
      b_small,
      undefined,
      undefined,
      `degrees`,
    )
    expect(small_angle).toBeGreaterThan(0)
    expect(small_angle).toBeCloseTo(90, 1) // Should be close to 90 degrees for orthogonal vectors

    // Test radians mode
    const angle_rad = angle_at_center(
      center_origin,
      a_origin,
      b_origin,
      undefined,
      undefined,
      `radians`,
    )
    expect(angle_rad).toBeCloseTo(Math.PI / 2, 10)
  })
})
