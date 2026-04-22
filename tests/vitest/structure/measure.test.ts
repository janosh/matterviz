import type { Matrix3x3, Vec3 } from '$lib/math'
import { angle_between_vectors, displacement_pbc, distance_pbc } from '$lib/structure/measure'
import { describe, expect, test } from 'vitest'

const cubic = (a: number): Matrix3x3 => [
  [a, 0, 0],
  [0, a, 0],
  [0, 0, a],
]

describe(`measure: distances`, () => {
  test(`pbc distance and displacement`, () => {
    const lat = cubic(10)

    // Test basic PBC distance
    const v1: Vec3 = [0.5, 0.5, 0.5]
    const v2: Vec3 = [9.8, 9.6, 9.5]
    const disp = displacement_pbc(v1, v2, lat)
    expect(disp[0]).toBeCloseTo(-0.7, 10)
    expect(disp[1]).toBeCloseTo(-0.9, 10)
    expect(disp[2]).toBeCloseTo(-1.0, 10)
    expect(distance_pbc(v1, v2, lat)).toBeCloseTo(Math.hypot(0.7, 0.9, 1.0), 10)

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

  test.each([null, undefined])(
    `displacement_pbc with %s lattice returns Euclidean displacement`,
    (lattice_matrix) => {
      const from: Vec3 = [1, 2, 3]
      const to: Vec3 = [4, 7, 8]
      expect(displacement_pbc(from, to, lattice_matrix)).toEqual([3, 5, 5])
    },
  )
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
        vertices: [[0, 0, 0] as Vec3, [1, 0, 0] as Vec3, [0.5, Math.sqrt(3) / 2, 0] as Vec3],
        expected_angles: [60, 60, 60],
      },
      {
        name: `right triangle`,
        vertices: [[0, 0, 0] as Vec3, [3, 0, 0] as Vec3, [0, 4, 0] as Vec3],
        expected_angles: [
          90,
          (Math.atan(4 / 3) * 180) / Math.PI,
          (Math.atan(3 / 4) * 180) / Math.PI,
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
    expect(angle_between_vectors([1, 0, 0], [0, 1, 0], `radians`)).toBeCloseTo(Math.PI / 2, 10)

    // Collinear precision
    expect(angle_between_vectors([1, 2, 3], [2, 4, 6])).toBeCloseTo(0, 12)
    expect(angle_between_vectors([1, 2, 3], [-2, -4, -6])).toBeCloseTo(180, 12)

    // Nearly collinear
    const eps = 1e-10
    expect(angle_between_vectors([1, 0, 0], [1, eps, 0])).toBeCloseTo(0, 6)
    expect(angle_between_vectors([1, 0, 0], [-1, eps, 0])).toBeCloseTo(180, 6)
  })

  // Non-orthogonal lattices where L ≠ L^T — catches missing transpose bugs.
  // Includes a cubic lattice to verify basic opposing-corners-are-equivalent behavior.
  const non_ortho_lattices = [
    {
      name: `cubic`,
      lattice: [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ] as Matrix3x3,
    },
    {
      name: `monoclinic`,
      lattice: [
        [2, 1, 0],
        [0, 2, 0],
        [0, 0, 2],
      ] as Matrix3x3,
    },
    {
      name: `hexagonal`,
      lattice: [
        [4, 0, 0],
        [2, 3.464, 0],
        [0, 0, 8],
      ] as Matrix3x3,
    },
    {
      name: `triclinic`,
      lattice: [
        [5, 0, 0],
        [2.5, 4.33, 0],
        [1, 1, 4],
      ] as Matrix3x3,
    },
    {
      name: `fully skewed`,
      lattice: [
        [3, 0.5, 0.3],
        [0.7, 4, 0.2],
        [0.4, 0.6, 5],
      ] as Matrix3x3,
    },
  ]

  test.each(non_ortho_lattices)(
    `lattice vector equivalence ($name): dist to any lattice translate is 0`,
    ({ lattice }) => {
      const origin: Vec3 = [0, 0, 0]
      // Each row is a lattice vector — displacement by any single vector is the same site
      for (const vec of lattice) {
        expect(distance_pbc(origin, vec as Vec3, lattice)).toBeCloseTo(0, 10)
      }
      // Sum of all three lattice vectors is also an equivalent site
      const all_sum: Vec3 = [
        lattice[0][0] + lattice[1][0] + lattice[2][0],
        lattice[0][1] + lattice[1][1] + lattice[2][1],
        lattice[0][2] + lattice[1][2] + lattice[2][2],
      ]
      expect(distance_pbc(origin, all_sum, lattice)).toBeCloseTo(0, 10)

      // Half a lattice vector is NOT an equivalent site — guard against always-zero bugs
      const half_a: Vec3 = [lattice[0][0] / 2, lattice[0][1] / 2, lattice[0][2] / 2]
      const half_dist = distance_pbc(origin, half_a, lattice)
      expect(half_dist).toBeGreaterThan(0.1)
      expect(Math.hypot(...displacement_pbc(origin, half_a, lattice))).toBeCloseTo(
        half_dist,
        10,
      )
    },
  )

  test.each(non_ortho_lattices)(
    `displacement antisymmetry ($name): disp(a,b) = -disp(b,a)`,
    ({ lattice }) => {
      const pos1: Vec3 = [0.3, 0.7, 1.2]
      const pos2: Vec3 = [2.1, 1.5, 0.8]
      const d_ab = displacement_pbc(pos1, pos2, lattice)
      const d_ba = displacement_pbc(pos2, pos1, lattice)
      for (let idx = 0; idx < 3; idx++) {
        expect(d_ab[idx]).toBeCloseTo(-d_ba[idx], 10)
      }
    },
  )

  test.each(non_ortho_lattices)(`PBC ≤ direct distance ($name)`, ({ lattice }) => {
    const pairs: [Vec3, Vec3][] = [
      [
        [0, 0, 0],
        [1.5, 1.5, 1.5],
      ],
      [
        [0.1, 0.2, 0.3],
        [3.7, 2.9, 3.1],
      ],
    ]
    for (const [pos1, pos2] of pairs) {
      const direct = Math.hypot(pos2[0] - pos1[0], pos2[1] - pos1[1], pos2[2] - pos1[2])
      expect(distance_pbc(pos1, pos2, lattice)).toBeLessThanOrEqual(direct + 1e-10)
    }
  })

  test(`skewed triclinic regression: displacement finds non-local minimum image`, () => {
    const lattice: Matrix3x3 = [
      [1.9705932249259481, -3.955757771584847, 1.6595752827868262],
      [-2.0392732691684845, 3.498999611184008, -1.7465434512400368],
      [3.716215074235551, 3.996782696347811, 1.0904649182023587],
    ]
    const pos1: Vec3 = [3.395535765213964, 4.297261971797731, 0.837260400991752]
    const pos2: Vec3 = [1.6425399077772327, -1.0582437501479167, 0.9390064337754569]
    const expected_disp: Vec3 = [-0.3507742293398103, 0.31324394398281463, -0.9022051740668167]

    const disp = displacement_pbc(pos1, pos2, lattice)
    disp.forEach((val, idx) => expect(val).toBeCloseTo(expected_disp[idx], 12))
    expect(distance_pbc(pos1, pos2, lattice)).toBeCloseTo(Math.hypot(...expected_disp), 12)
    expect(distance_pbc(pos1, pos2, lattice)).toBeCloseTo(
      distance_pbc(pos2, pos1, lattice),
      12,
    )
  })
})
