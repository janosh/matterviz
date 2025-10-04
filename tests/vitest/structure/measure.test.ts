import type { Vec3 } from '$lib'
import type { Matrix3x3 } from '$lib/math'
import {
  angle_between_vectors,
  displacement_pbc,
  distance_pbc,
} from '$lib/structure/measure'
import { describe, expect, test } from 'vitest'

const cubic = (a: number): Matrix3x3 => [[a, 0, 0], [0, a, 0], [0, 0, a]]

describe(`measure: distances`, () => {
  test(`pbc distance and displacement`, () => {
    const lat = cubic(10)

    // Test basic PBC distance
    const a: Vec3 = [0.5, 0.5, 0.5]
    const b: Vec3 = [9.8, 9.6, 9.5]
    const disp = displacement_pbc(a, b, lat)
    expect(disp[0]).toBeCloseTo(-0.7, 10)
    expect(disp[1]).toBeCloseTo(-0.9, 10)
    expect(disp[2]).toBeCloseTo(-1.0, 10)
    expect(distance_pbc(a, b, lat)).toBeCloseTo(Math.hypot(0.7, 0.9, 1.0), 10)

    // Test edge cases
    const pos: Vec3 = [5.0, 5.0, 5.0]
    expect(displacement_pbc(pos, pos, lat)).toEqual([0, 0, 0])

    // Test boundary wrapping
    expect(displacement_pbc([0, 0, 0], [10, 0, 0], lat)).toEqual([0, 0, 0])

    const disp2 = displacement_pbc([0, 0, 0], [9.5, 8.5, 7.5], lat)
    expect(disp2[0]).toBeCloseTo(-0.5, 10)
    expect(disp2[1]).toBeCloseTo(-1.5, 10)
    expect(disp2[2]).toBeCloseTo(-2.5, 10)
  })
})

describe(`measure: angles`, () => {
  test.each([
    { v1: [1, 0, 0] as Vec3, v2: [0, 1, 0] as Vec3, deg: 90, desc: `x and y axes` },
    { v1: [1, 0, 0] as Vec3, v2: [0, 0, 1] as Vec3, deg: 90, desc: `x and z axes` },
    { v1: [0, 1, 0] as Vec3, v2: [0, 0, 1] as Vec3, deg: 90, desc: `y and z axes` },
    {
      v1: [1, 0, 0] as Vec3,
      v2: [0.5, Math.sqrt(3) / 2, 0] as Vec3,
      deg: 60,
      desc: `60° angle`,
    },
    {
      v1: [1, 0, 0] as Vec3,
      v2: [Math.sqrt(3) / 2, 0.5, 0] as Vec3,
      deg: 30,
      desc: `30° angle`,
    },
    {
      v1: [1, 0, 0] as Vec3,
      v2: [-1, 0, 0] as Vec3,
      deg: 180,
      desc: `opposite directions`,
    },
    { v1: [1, 0, 0] as Vec3, v2: [2, 0, 0] as Vec3, deg: 0, desc: `same direction` },
    { v1: [1, 1, 0] as Vec3, v2: [-1, 1, 0] as Vec3, deg: 90, desc: `diagonal vectors` },
    { v1: [1, 1, 1] as Vec3, v2: [1, 1, 1] as Vec3, deg: 0, desc: `identical vectors` },
  ] as { v1: Vec3; v2: Vec3; deg: number; desc: string }[])(
    `basic angles: $desc`,
    ({ v1, v2, deg }) => {
      expect(angle_between_vectors(v1, v2, `degrees`)).toBeCloseTo(deg, 10)
    },
  )

  test.each([
    { v1: [1, 0, 0] as Vec3, v2: [0, 1, 0] as Vec3, desc: `x ⊥ y` },
    { v1: [1, 0, 0] as Vec3, v2: [0, 0, 1] as Vec3, desc: `x ⊥ z` },
    { v1: [0, 1, 0] as Vec3, v2: [0, 0, 1] as Vec3, desc: `y ⊥ z` },
    { v1: [1, 1, 0] as Vec3, v2: [-1, 1, 0] as Vec3, desc: `diagonal` },
    { v1: [1, 0, 1] as Vec3, v2: [-1, 0, 1] as Vec3, desc: `3D diagonal` },
    { v1: [2, 3, 0] as Vec3, v2: [0, 0, 5] as Vec3, desc: `scaled` },
    { v1: [1, 2, 3] as Vec3, v2: [-2, 1, 0] as Vec3, desc: `dot=0` },
  ])(`orthogonality: $desc`, ({ v1, v2 }) => {
    expect(angle_between_vectors(v1, v2, `degrees`)).toBeCloseTo(90, 10)
  })

  test(`triangle angle sum property: angles in any triangle sum to 180°`, () => {
    // Test multiple triangles with different shapes
    const triangles = [
      {
        name: `equilateral`,
        vertices: [
          [0, 0, 0] as Vec3,
          [1, 0, 0] as Vec3,
          [0.5, Math.sqrt(3) / 2, 0] as Vec3,
        ],
        expected_angles: [60, 60, 60],
      },
      {
        name: `right triangle`,
        vertices: [[0, 0, 0] as Vec3, [3, 0, 0] as Vec3, [0, 4, 0] as Vec3],
        expected_angles: [
          90,
          Math.atan(4 / 3) * 180 / Math.PI,
          Math.atan(3 / 4) * 180 / Math.PI,
        ],
      },
      {
        name: `isosceles`,
        vertices: [[0, 0, 0] as Vec3, [2, 0, 0] as Vec3, [1, 2, 0] as Vec3],
      },
      {
        name: `scalene`,
        vertices: [[0, 0, 0] as Vec3, [3, 0, 0] as Vec3, [1, 2, 0] as Vec3],
      },
      {
        name: `3D triangle`,
        vertices: [[0, 0, 0] as Vec3, [1, 0, 0] as Vec3, [0, 1, 1] as Vec3],
      },
    ]

    for (const triangle of triangles) {
      const [a, b, c] = triangle.vertices

      // Calculate angle at vertex a (between vectors ab and ac)
      const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const angle_a = angle_between_vectors(ab, ac, `degrees`)

      // Calculate angle at vertex b (between vectors ba and bc)
      const ba: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const bc: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
      const angle_b = angle_between_vectors(ba, bc, `degrees`)

      // Calculate angle at vertex c (between vectors ca and cb)
      const ca: Vec3 = [a[0] - c[0], a[1] - c[1], a[2] - c[2]]
      const cb: Vec3 = [b[0] - c[0], b[1] - c[1], b[2] - c[2]]
      const angle_c = angle_between_vectors(ca, cb, `degrees`)

      // Sum should be 180° for any triangle
      const sum = angle_a + angle_b + angle_c
      expect(sum).toBeCloseTo(180, 8)

      // If expected angles provided, check them too
      if (triangle.expected_angles) {
        expect(angle_a).toBeCloseTo(triangle.expected_angles[0], 5)
        expect(angle_b).toBeCloseTo(triangle.expected_angles[1], 5)
        expect(angle_c).toBeCloseTo(triangle.expected_angles[2], 5)
      }
    }
  })

  test.each([
    [[1, 0, 0] as Vec3, [0, 1, 0] as Vec3],
    [[1, 2, 3] as Vec3, [4, 5, 6] as Vec3],
    [[1, 1, 1] as Vec3, [-1, -1, -1] as Vec3],
    [[2, 0, 0] as Vec3, [1, 1, 0] as Vec3],
  ])(`angle symmetry: angle(v1,v2) = angle(v2,v1)`, (v1, v2) => {
    const angle_12 = angle_between_vectors(v1, v2, `degrees`)
    const angle_21 = angle_between_vectors(v2, v1, `degrees`)
    expect(angle_12).toBeCloseTo(angle_21, 12)
  })

  test(`angle scaling invariance: angle independent of vector magnitude`, () => {
    const v1: Vec3 = [1, 2, 3]
    const v2: Vec3 = [4, 5, 6]
    const base_angle = angle_between_vectors(v1, v2, `degrees`)

    // Scale vectors by various factors
    for (const scale of [0.1, 0.5, 2, 10, 100]) {
      const scaled_v1: Vec3 = [v1[0] * scale, v1[1] * scale, v1[2] * scale]
      const scaled_v2: Vec3 = [v2[0] * scale, v2[1] * scale, v2[2] * scale]

      expect(angle_between_vectors(scaled_v1, v2, `degrees`)).toBeCloseTo(base_angle, 10)
      expect(angle_between_vectors(v1, scaled_v2, `degrees`)).toBeCloseTo(base_angle, 10)
      expect(angle_between_vectors(scaled_v1, scaled_v2, `degrees`)).toBeCloseTo(
        base_angle,
        10,
      )
    }
  })

  test(`angle edge cases`, () => {
    // Zero vectors
    expect(angle_between_vectors([0, 0, 0], [1, 0, 0])).toBe(0)

    // Radians mode
    expect(angle_between_vectors([1, 0, 0], [0, 1, 0], `radians`)).toBeCloseTo(
      Math.PI / 2,
      10,
    )

    // Collinear precision
    expect(angle_between_vectors([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 12)
    expect(angle_between_vectors([1, 2, 3], [-2, -4, -6])).toBeCloseTo(180, 12)

    // Nearly collinear
    const eps = 1e-10
    expect(angle_between_vectors([1, 0, 0], [1, eps, 0])).toBeCloseTo(0, 6)
    expect(angle_between_vectors([1, 0, 0], [-1, eps, 0])).toBeCloseTo(180, 6)
  })

  test(`PBC distance regression: opposing corners of cubic cell`, () => {
    // Test the new bug: opposing corners should have PBC distance 0
    const cubic_lattice: Matrix3x3 = [
      [5, 0, 0],
      [0, 5, 0],
      [0, 0, 5],
    ]

    // Atoms at opposing corners of the unit cell
    const corner1: Vec3 = [0, 0, 0]
    const corner2: Vec3 = [5, 5, 5] // This is the same as [0,0,0] under PBC

    const pbc_dist = distance_pbc(corner1, corner2, cubic_lattice)
    const direct_dist = Math.hypot(5, 5, 5)

    // PBC distance should be 0 (same site), direct should be non-zero
    expect(pbc_dist).toBeCloseTo(0, 10)
    expect(direct_dist).toBeGreaterThan(8)

    // Additional test cases
    expect(distance_pbc([0, 0, 0], [5, 0, 0], cubic_lattice)).toBeCloseTo(0, 10)
    expect(distance_pbc([0, 0, 0], [0, 5, 0], cubic_lattice)).toBeCloseTo(0, 10)
    expect(distance_pbc([0, 0, 0], [0, 0, 5], cubic_lattice)).toBeCloseTo(0, 10)
  })

  test(`PBC distance invariant: PBC ≤ direct distance`, () => {
    // Test various lattice types to ensure PBC never violates minimum image
    const test_cases = [
      {
        name: `cubic`,
        lattice: [[3, 0, 0], [0, 3, 0], [0, 0, 3]] as Matrix3x3,
        pos1: [0, 0, 0] as Vec3,
        pos2: [1.5, 1.5, 1.5] as Vec3,
      },
      {
        name: `triclinic (original bug case)`,
        lattice: [[6.038698, 0, 0], [0, 6.038698, 0], [
          3.019349,
          3.019349,
          4.167943,
        ]] as Matrix3x3,
        pos1: [0, 0, 0] as Vec3,
        pos2: [3.019349, 3.019349, 0] as Vec3,
      },
    ]

    for (const { lattice, pos1, pos2 } of test_cases) {
      const direct_dist = Math.hypot(
        pos2[0] - pos1[0],
        pos2[1] - pos1[1],
        pos2[2] - pos1[2],
      )
      const pbc_dist = distance_pbc(pos1, pos2, lattice)

      // The fundamental PBC invariant: PBC distance ≤ direct distance
      expect(pbc_dist).toBeLessThanOrEqual(direct_dist + 1e-10)
    }
  })
})
