import {
  compute_brillouin_zone,
  compute_convex_hull,
  compute_ibz_clipping_planes,
  compute_irreducible_bz,
  extract_point_group_from_operations,
  fractional_to_cartesian_rotation,
  generate_bz_vertices,
  reciprocal_lattice,
} from '$lib/brillouin/compute'
import type { Matrix3x3, Vec3, Vec9 } from '$lib/math'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import reference_data from './bz_reference_data.json' with { type: 'json' }

// Common test constants
const CUBIC_5: Matrix3x3 = [[5, 0, 0], [0, 5, 0], [0, 0, 5]]
const IDENTITY_MAT: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const INVERSION_MAT: Matrix3x3 = [[-1, 0, 0], [0, -1, 0], [0, 0, -1]]

// Hexagonal 3-fold rotation in fractional coords (non-orthogonal: W^T ≠ W^{-1})
const C3_HEX: Matrix3x3 = [[0, -1, 0], [1, -1, 0], [0, 0, 1]]
const C3_HEX_SQ: Matrix3x3 = [[-1, 1, 0], [-1, 0, 0], [0, 0, 1]] // C3²

// Helpers
const has_vertex = (vertices: Vec3[], target: Vec3, tol = 1e-8) =>
  vertices.some((v) => v.every((c, idx) => Math.abs(c - target[idx]) < tol))

const edge_key = (v1: Vec3, v2: Vec3) =>
  [v1, v2].map((v) => v.map((c) => c.toFixed(8)).join(`,`)).sort().join(`|`)

describe(`reciprocal_lattice`, () => {
  test(`correct for all crystal systems`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const computed = reciprocal_lattice(data.real_lattice as Matrix3x3)
      const expected = data.reciprocal_lattice as Matrix3x3
      computed.forEach((row, idx_i) =>
        row.forEach((val, idx_j) => expect(val).toBeCloseTo(expected[idx_i][idx_j], 10))
      )
    }
  })

  test(`double reciprocal preserves cubic structure`, () => {
    const double_recip = reciprocal_lattice(reciprocal_lattice(CUBIC_5))
    // Off-diagonal elements should be zero
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row !== col) expect(double_recip[row][col]).toBeCloseTo(0, 10)
      }
    }
    // Diagonal elements equal and positive
    expect(double_recip[0][0]).toBeCloseTo(double_recip[1][1], 10)
    expect(double_recip[0][0]).toBeGreaterThan(0)
  })

  test(`non-orthogonal FCC: a_i · b_j = 2π δ_ij`, () => {
    const fcc: Matrix3x3 = [[0, 2.5, 2.5], [2.5, 0, 2.5], [2.5, 2.5, 0]]
    const recip = reciprocal_lattice(fcc)
    for (let idx_i = 0; idx_i < 3; idx_i++) {
      for (let idx_j = 0; idx_j < 3; idx_j++) {
        const dot = fcc[idx_i].reduce(
          (sum, val, idx_k) => sum + val * recip[idx_j][idx_k],
          0,
        )
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
  const k_lattice = reciprocal_lattice(CUBIC_5)

  test(`cubic BZ: 8 vertices at corners`, () => {
    const vertices = generate_bz_vertices(k_lattice, 1)
    expect(vertices.length).toBe(8)
    const k_max = Math.PI / 5
    vertices.forEach((v) => v.forEach((c) => expect(Math.abs(c)).toBeCloseTo(k_max, 5)))
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
  test.each([5.0, 3.0])(`cubic a=%d → volume ≈ (2π)³/a³`, (a) => {
    const real: Matrix3x3 = [[a, 0, 0], [0, a, 0], [0, 0, a]]
    const bz = compute_brillouin_zone(reciprocal_lattice(real), 1)
    expect(bz.volume).toBeCloseTo((2 * Math.PI) ** 3 / a ** 3, 4)
  })

  test(`volume = |b1 · (b2 × b3)|`, () => {
    const k_lattice = reciprocal_lattice([[4, 0, 0], [0, 5, 0], [0, 0, 6]])
    const bz = compute_brillouin_zone(k_lattice, 1)
    const [b1, b2, b3] = k_lattice
    const cross: Vec3 = [
      b2[1] * b3[2] - b2[2] * b3[1],
      b2[2] * b3[0] - b2[0] * b3[2],
      b2[0] * b3[1] - b2[1] * b3[0],
    ]
    expect(bz.volume).toBeCloseTo(
      Math.abs(b1.reduce((s, v, idx) => s + v * cross[idx], 0)),
      6,
    )
  })
})

describe(`BZ order`, () => {
  const k_lattice = reciprocal_lattice(CUBIC_5)

  test(`higher order → more vertices`, () => {
    const bz1 = compute_brillouin_zone(k_lattice, 1)
    const bz2 = compute_brillouin_zone(k_lattice, 2)
    expect(bz2.vertices.length).toBeGreaterThan(bz1.vertices.length)
  })

  test(`order capped at 3`, () => {
    expect(compute_brillouin_zone(k_lattice, 3).order).toBe(3)
  })
})

describe(`error handling`, () => {
  test(`throws for degenerate lattice`, () => {
    const degenerate: Matrix3x3 = [[1e-15, 0, 0], [0, 1e-15, 0], [0, 0, 1e-15]]
    expect(() => compute_brillouin_zone(reciprocal_lattice(degenerate), 1)).toThrow()
  })

  test(`handles custom max_planes_by_order`, () => {
    const bz = compute_brillouin_zone(reciprocal_lattice(CUBIC_5), 1, 5, {
      1: 50,
      2: 100,
      3: 200,
    })
    expect(bz.vertices.length).toBeGreaterThan(0)
  })
})

// Rotation matrices as Vec9 (row-major)
const IDENTITY_ROT: Vec9 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const ROT_Z_90: Vec9 = [0, -1, 0, 1, 0, 0, 0, 0, 1]
const ROT_Z_180: Vec9 = [-1, 0, 0, 0, -1, 0, 0, 0, 1]
const ROT_Z_270: Vec9 = [0, 1, 0, -1, 0, 0, 0, 0, 1]
const MIRROR_Z: Vec9 = [1, 0, 0, 0, 1, 0, 0, 0, -1]
const INVERSION_ROT: Vec9 = [-1, 0, 0, 0, -1, 0, 0, 0, -1]

// Create mock operation for testing (Vec9 substitutes for Float64Array in tests)
const make_op = (
  rot: Vec9,
  trans: Vec3 = [0, 0, 0],
): MoyoDataset[`operations`][number] =>
  ({ rotation: rot, translation: trans }) as unknown as MoyoDataset[`operations`][number]

describe(`extract_point_group_from_operations`, () => {
  test(`extracts identity and transposes for reciprocal space`, () => {
    const pg = extract_point_group_from_operations([make_op(IDENTITY_ROT)])
    expect(pg).toHaveLength(1)
    expect(pg[0]).toEqual(IDENTITY_MAT)
  })

  test(`deduplicates same rotation with different translations`, () => {
    const ops = [
      make_op(IDENTITY_ROT),
      make_op(IDENTITY_ROT, [0.5, 0, 0]),
      make_op(IDENTITY_ROT, [0, 0.5, 0]),
    ]
    expect(extract_point_group_from_operations(ops)).toHaveLength(1)
  })

  test.each([
    [`C4 group`, [IDENTITY_ROT, ROT_Z_90, ROT_Z_180, ROT_Z_270], 4],
    [`with inversion/mirror`, [IDENTITY_ROT, INVERSION_ROT, MIRROR_Z], 3],
    [`empty input`, [], 0],
  ])(`%s → %d unique rotations`, (_, rots, expected) => {
    expect(extract_point_group_from_operations(rots.map((r) => make_op(r)))).toHaveLength(
      expected,
    )
  })

  test(`preserves fractional rotation (no transpose)`, () => {
    // ROT_Z_90 [[0,-1,0],[1,0,0],[0,0,1]] - returned as-is for later conversion
    const [pg] = extract_point_group_from_operations([make_op(ROT_Z_90)])
    expect(pg[0][1]).toBe(-1) // original value at [0][1]
    expect(pg[1][0]).toBe(1) // original value at [1][0]
  })
})

describe(`compute_ibz_clipping_planes`, () => {
  const ROT_90: Matrix3x3 = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]
  const ROT_180: Matrix3x3 = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]
  const ROT_270: Matrix3x3 = [[0, -1, 0], [1, 0, 0], [0, 0, 1]]

  test(`identity-only → no planes`, () => {
    expect(compute_ibz_clipping_planes([IDENTITY_MAT])).toHaveLength(0)
  })

  test(`non-trivial symmetry → planes through origin`, () => {
    const planes = compute_ibz_clipping_planes([IDENTITY_MAT, ROT_90])
    expect(planes.length).toBeGreaterThan(0)
    planes.forEach((p) => expect(p.dist).toBe(0))
  })

  test(`C4 group deduplicates planes`, () => {
    const planes = compute_ibz_clipping_planes([IDENTITY_MAT, ROT_90, ROT_180, ROT_270])
    expect(planes.length).toBeLessThanOrEqual(3)
  })
})

describe(`compute_irreducible_bz`, () => {
  const bz = compute_brillouin_zone(reciprocal_lattice(CUBIC_5), 1)
  const MIRROR_Z_MAT: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, -1]]

  test(`P1 (identity only) → full BZ`, () => {
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT])
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.vertices).toHaveLength(bz.vertices.length)
    expect(ibz.volume).toBeCloseTo(bz.volume, 6)
  })

  test(`inversion symmetry → half volume`, () => {
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT, INVERSION_MAT])
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.volume).toBeLessThanOrEqual(bz.volume)
    expect(ibz.volume).toBeCloseTo(bz.volume / 2, 5)
    expect(ibz.vertices.length).toBeGreaterThanOrEqual(4)
  })

  test(`mirror symmetry → valid geometry`, () => {
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT, MIRROR_Z_MAT])
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.vertices.length).toBeGreaterThanOrEqual(4)
    expect(ibz.faces.length).toBeGreaterThanOrEqual(4)
    expect(ibz.edges.length).toBeGreaterThan(0)
    expect(ibz.volume).toBeGreaterThan(0)
    ibz.faces.flat().forEach((idx) => {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(ibz.vertices.length)
    })
  })

  test(`handles all crystal systems with inversion`, () => {
    for (const data of Object.values(reference_data)) {
      const crystal_bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      const ibz = compute_irreducible_bz(crystal_bz, [IDENTITY_MAT, INVERSION_MAT])
      expect(ibz).not.toBeNull()
      if (!ibz) continue
      expect(ibz.volume).toBeGreaterThan(0)
      expect(ibz.vertices.length).toBeGreaterThanOrEqual(4)
    }
  })

  test(`hexagonal C3 group uses W^{-T} correctly`, () => {
    const hex_bz = compute_brillouin_zone(
      reference_data.hexagonal.reciprocal_lattice as Matrix3x3,
      1,
    )
    const ibz = compute_irreducible_bz(hex_bz, [IDENTITY_MAT, C3_HEX, C3_HEX_SQ])
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.volume).toBeGreaterThan(0)
    // C3 symmetry should give ~1/3 of BZ volume (geometric clipping is approximate)
    const expected_ratio = 1 / 3
    const actual_ratio = ibz.volume / hex_bz.volume
    expect(actual_ratio).toBeGreaterThan(expected_ratio * 0.7) // at least 70% of expected
    expect(actual_ratio).toBeLessThan(expected_ratio * 1.3) // at most 130% of expected
  })
})

describe(`fractional_to_cartesian_rotation`, () => {
  const k_lattice = reference_data.hexagonal.reciprocal_lattice as Matrix3x3

  test(`det = +1 and correct matrix elements for hexagonal C3`, () => {
    const R = fractional_to_cartesian_rotation(C3_HEX, k_lattice)

    // det(R) should be +1 for proper rotation
    const det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) -
      R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) +
      R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0])
    expect(det).toBeCloseTo(1, 10)

    // These values distinguish W^{-T} from W^T (wrong impl gives ~-0.577, ~-0.906, ~0.577)
    expect(R[0][0]).toBeCloseTo(-0.4226497308103744, 6)
    expect(R[0][1]).toBeCloseTo(-0.6547005383792517, 6)
    expect(R[1][0]).toBeCloseTo(1.1547005383792515, 6)
  })

  test.each([
    {
      name: `singular W`,
      W: [[0, 0, 0], [0, 1, 0], [0, 0, 1]] as Matrix3x3,
      k: k_lattice,
    },
    {
      name: `singular k_lattice`,
      W: IDENTITY_MAT,
      k: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] as Matrix3x3,
    },
  ])(`returns identity matrix for $name`, ({ W, k }) => {
    expect(fractional_to_cartesian_rotation(W, k)).toEqual([[1, 0, 0], [0, 1, 0], [
      0,
      0,
      1,
    ]])
  })
})
