import {
  compute_brillouin_zone,
  compute_convex_hull,
  generate_bz_vertices,
  reciprocal_lattice,
} from '$lib/brillouin/compute'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import reference_data from './bz_reference_data.json' with { type: 'json' }

// Helper to check if vertex exists in list
const has_vertex = (vertices: Vec3[], target: Vec3, tol = 1e-8) =>
  vertices.some(
    (vert) =>
      Math.abs(vert[0] - target[0]) < tol &&
      Math.abs(vert[1] - target[1]) < tol &&
      Math.abs(vert[2] - target[2]) < tol,
  )

// Helper to create edge key for deduplication
const edge_key = (v1: Vec3, v2: Vec3) =>
  [v1, v2].map((vert) => vert.map((coord) => coord.toFixed(8)).join(`,`)).sort().join(`|`)

describe(`reciprocal_lattice`, () => {
  test(`correct for all crystal systems`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const computed = reciprocal_lattice(data.real_lattice as Matrix3x3)
      const expected = data.reciprocal_lattice as Matrix3x3
      for (let idx_i = 0; idx_i < 3; idx_i++) {
        for (let idx_j = 0; idx_j < 3; idx_j++) {
          expect(computed[idx_i][idx_j]).toBeCloseTo(expected[idx_i][idx_j], 10)
        }
      }
    }
  })

  test(`double reciprocal preserves structure (orthogonal remains orthogonal)`, () => {
    const real: Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]]
    const double_recip = reciprocal_lattice(reciprocal_lattice(real))

    // Off-diagonal should remain zero
    for (const [idx_i, idx_j] of [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]]) {
      expect(double_recip[idx_i][idx_j]).toBeCloseTo(0, 10)
    }
    // Diagonal should be equal and positive
    expect(double_recip[0][0]).toBeCloseTo(double_recip[1][1], 10)
    expect(double_recip[1][1]).toBeCloseTo(double_recip[2][2], 10)
    expect(double_recip[0][0]).toBeGreaterThan(0)
  })

  test(`simple cubic: b_i = 2π/a`, () => {
    const lattice_constant = 5.0
    const real: Matrix3x3 = [[lattice_constant, 0, 0], [0, lattice_constant, 0], [
      0,
      0,
      lattice_constant,
    ]]
    const recip = reciprocal_lattice(real)
    const expected = (2 * Math.PI) / lattice_constant

    expect(recip[0][0]).toBeCloseTo(expected, 10)
    expect(recip[1][1]).toBeCloseTo(expected, 10)
    expect(recip[2][2]).toBeCloseTo(expected, 10)
    expect(recip[0][1]).toBeCloseTo(0, 10)
    expect(recip[0][2]).toBeCloseTo(0, 10)
  })

  test(`non-orthogonal: a_i · b_j = 2π δ_ij`, () => {
    const real: Matrix3x3 = [[0, 2.5, 2.5], [2.5, 0, 2.5], [2.5, 2.5, 0]] // FCC
    const recip = reciprocal_lattice(real)

    for (let idx_i = 0; idx_i < 3; idx_i++) {
      for (let idx_j = 0; idx_j < 3; idx_j++) {
        const dot = real[idx_i][0] * recip[idx_j][0] + real[idx_i][1] * recip[idx_j][1] +
          real[idx_i][2] * recip[idx_j][2]
        expect(dot).toBeCloseTo(idx_i === idx_j ? 2 * Math.PI : 0, 8)
      }
    }
  })
})

describe(`compute_brillouin_zone`, () => {
  test(`valid BZ for all crystal systems`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      expect(bz.vertices.length).toBeGreaterThan(3)
      expect(bz.faces.length).toBeGreaterThan(3)
      expect(bz.edges.length).toBeGreaterThan(0)
      expect(bz.volume).toBeCloseTo(data.bz_volume_approximation, 6)
    }
  })

  test(`cubic BZ: 8 vertices, 12 triangulated faces, 12 edges`, () => {
    const bz = compute_brillouin_zone(
      reference_data.cubic.reciprocal_lattice as Matrix3x3,
      1,
    )
    expect(bz.vertices.length).toBe(8)
    expect(bz.faces.length).toBe(12)
    expect(bz.edges.length).toBe(12)
  })

  test(`inversion symmetry`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      for (const vert of bz.vertices) {
        expect(has_vertex(bz.vertices, vert.map((coord) => -coord) as Vec3)).toBe(true)
      }
    }
  })
})

describe(`BZ edge filtering`, () => {
  test.each([
    [`cubic`, 12],
    [`tetragonal`, 12],
    [`orthorhombic`, 12],
    [`hexagonal`, 18],
  ] as [keyof typeof reference_data, number][])(
    `%s has %d edges`,
    (name, expected_count) => {
      const bz = compute_brillouin_zone(
        reference_data[name].reciprocal_lattice as Matrix3x3,
        1,
      )
      expect(bz.edges.length).toBe(expected_count)
    },
  )

  test(`valid edge topology: no duplicates, edges shared by 2 faces`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      const keys = new Set<string>()
      const edge_to_faces = new Map<string, number>()

      for (const face of bz.faces) {
        for (let idx = 0; idx < face.length; idx++) {
          const v1 = bz.vertices[face[idx]]
          const v2 = bz.vertices[face[(idx + 1) % face.length]]
          const key = edge_key(v1, v2)
          edge_to_faces.set(key, (edge_to_faces.get(key) || 0) + 1)
        }
      }

      for (const [v1, v2] of bz.edges) {
        expect(has_vertex(bz.vertices, v1)).toBe(true)
        expect(has_vertex(bz.vertices, v2)).toBe(true)
        const key = edge_key(v1, v2)
        expect(keys.has(key)).toBe(false)
        keys.add(key)
        expect(edge_to_faces.get(key)).toBe(2)
      }
      expect(bz.edges.length).toBeLessThan((3 * bz.faces.length) / 2)
    }
  })

  test(`reasonable edge lengths`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      const max_len = Math.cbrt(bz.volume) * 10
      for (const [v1, v2] of bz.edges) {
        const len = Math.sqrt(
          (v2[0] - v1[0]) ** 2 + (v2[1] - v1[1]) ** 2 + (v2[2] - v1[2]) ** 2,
        )
        expect(len).toBeGreaterThan(0)
        expect(len).toBeLessThan(max_len)
      }
    }
  })

  test(`valid face indices`, () => {
    const bz = compute_brillouin_zone(
      reference_data.cubic.reciprocal_lattice as Matrix3x3,
      1,
    )
    for (const face of bz.faces) {
      expect(face.length).toBeGreaterThanOrEqual(3)
      for (const idx of face) {
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(bz.vertices.length)
      }
    }
  })
})

describe(`generate_bz_vertices`, () => {
  const k_lattice = reciprocal_lattice([[5, 0, 0], [0, 5, 0], [0, 0, 5]])

  test(`cubic BZ: 8 vertices at corners`, () => {
    const vertices = generate_bz_vertices(k_lattice, 1)
    expect(vertices.length).toBe(8)
    const k_max = Math.PI / 5
    for (const vert of vertices) {
      expect(Math.abs(vert[0])).toBeCloseTo(k_max, 5)
      expect(Math.abs(vert[1])).toBeCloseTo(k_max, 5)
      expect(Math.abs(vert[2])).toBeCloseTo(k_max, 5)
    }
  })

  test(`higher order generates more vertices`, () => {
    const v1 = generate_bz_vertices(k_lattice, 1)
    const v2 = generate_bz_vertices(k_lattice, 2)
    expect(v2.length).toBeGreaterThan(v1.length)
  })

  test(`max_planes_by_order parameter`, () => {
    const vertices = generate_bz_vertices(k_lattice, 1, { 1: 10, 2: 20, 3: 30 })
    expect(vertices.length).toBeGreaterThanOrEqual(4)
  })
})

describe(`compute_convex_hull`, () => {
  test(`throws for <4 vertices`, () => {
    expect(() => compute_convex_hull([[0, 0, 0], [1, 0, 0], [0, 1, 0]])).toThrow(
      /Need ≥4 vertices/,
    )
  })

  test.each([
    [
      `tetrahedron`,
      [[0, 0, 0], [1, 0, 0], [0.5, Math.sqrt(3) / 2, 0], [
        0.5,
        Math.sqrt(3) / 6,
        Math.sqrt(2 / 3),
      ]],
      4,
      4,
      6,
    ],
    [
      `cube`,
      [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [
        -1,
        1,
        1,
      ], [1, 1, 1]],
      8,
      12,
      12,
    ],
  ] as [string, Vec3[], number, number, number][])(
    `%s: %d vertices, %d faces, %d edges`,
    (_, vertices, v_count, f_count, e_count) => {
      const hull = compute_convex_hull(vertices)
      expect(hull.vertices.length).toBe(v_count)
      expect(hull.faces.length).toBe(f_count)
      expect(hull.edges.length).toBe(e_count)
    },
  )

  test(`edge_sharp_angle_deg controls edge filtering`, () => {
    const cube: Vec3[] = [
      [-1, -1, -1],
      [1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [-1, 1, 1],
      [1, 1, 1],
    ]
    const strict = compute_convex_hull(cube, 1)
    const loose = compute_convex_hull(cube, 45)
    expect(strict.edges.length).toBeGreaterThan(0)
    expect(loose.edges.length).toBeGreaterThan(0)
  })
})

describe(`BZ volume`, () => {
  test.each([
    [5.0, (2 * Math.PI) ** 3 / (5.0 ** 3)],
    [3.0, (2 * Math.PI) ** 3 / (3.0 ** 3)],
  ])(`cubic a=%d → volume ≈ (2π)³/a³`, (lattice_param, expected_vol) => {
    const real: Matrix3x3 = [[lattice_param, 0, 0], [0, lattice_param, 0], [
      0,
      0,
      lattice_param,
    ]]
    const bz = compute_brillouin_zone(reciprocal_lattice(real), 1)
    expect(bz.volume).toBeCloseTo(expected_vol, 4)
  })

  test(`volume = |b1 · (b2 × b3)|`, () => {
    const real: Matrix3x3 = [[4, 0, 0], [0, 5, 0], [0, 0, 6]]
    const k_lattice = reciprocal_lattice(real)
    const bz = compute_brillouin_zone(k_lattice, 1)

    const [b1, b2, b3] = k_lattice
    const cross = [
      b2[1] * b3[2] - b2[2] * b3[1],
      b2[2] * b3[0] - b2[0] * b3[2],
      b2[0] * b3[1] - b2[1] * b3[0],
    ]
    const expected_vol = Math.abs(b1[0] * cross[0] + b1[1] * cross[1] + b1[2] * cross[2])
    expect(bz.volume).toBeCloseTo(expected_vol, 6)
  })
})

describe(`BZ order`, () => {
  test(`higher order → more vertices`, () => {
    const k_lattice = reciprocal_lattice(reference_data.cubic.real_lattice as Matrix3x3)
    const bz1 = compute_brillouin_zone(k_lattice, 1)
    const bz2 = compute_brillouin_zone(k_lattice, 2)
    expect(bz2.vertices.length).toBeGreaterThanOrEqual(bz1.vertices.length)
  })

  test(`order capped at 3`, () => {
    const k_lattice = reciprocal_lattice([[5, 0, 0], [0, 5, 0], [0, 0, 5]])
    const bz = compute_brillouin_zone(k_lattice, 3)
    expect(bz.order).toBe(3)
  })
})

describe(`error handling`, () => {
  test(`throws for degenerate lattice`, () => {
    const degenerate: Matrix3x3 = [[1e-15, 0, 0], [0, 1e-15, 0], [0, 0, 1e-15]]
    expect(() => compute_brillouin_zone(reciprocal_lattice(degenerate), 1)).toThrow()
  })

  test(`handles custom max_planes_by_order`, () => {
    const k_lattice = reciprocal_lattice([[5, 0, 0], [0, 5, 0], [0, 0, 5]])
    const bz = compute_brillouin_zone(k_lattice, 1, 5, { 1: 50, 2: 100, 3: 200 })
    expect(bz.vertices.length).toBeGreaterThan(0)
  })
})
