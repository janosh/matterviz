import {
  compute_brillouin_zone,
  compute_convex_hull,
  compute_ibz_clipping_planes,
  compute_irreducible_bz,
  extract_point_group_from_operations,
  find_ibz_reference_direction,
  fractional_to_cartesian_rotation,
  generate_bz_vertices,
  IBZ_REFERENCE_DIRECTIONS,
  reciprocal_lattice,
} from '$lib/brillouin/compute'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { load_json } from './setup'

type BzReference = {
  real_lattice: number[][]
  reciprocal_lattice: number[][]
  bz_volume_approximation: number
}
// gzipped to keep the ~32 KB reference data out of the repo as ~3 KB
const reference_data = load_json<Record<string, BzReference>>(
  `${import.meta.dirname}/bz_reference_data.json.gz`,
)

// Common test constants
const CUBIC_5: Matrix3x3 = [
  [5, 0, 0],
  [0, 5, 0],
  [0, 0, 5],
]
const IDENTITY_MAT: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]
const INVERSION_MAT: Matrix3x3 = [
  [-1, 0, 0],
  [0, -1, 0],
  [0, 0, -1],
]

// Hexagonal 3-fold rotation in fractional coords (non-orthogonal: W^T ≠ W^{-1})
const C3_HEX: Matrix3x3 = [
  [0, -1, 0],
  [1, -1, 0],
  [0, 0, 1],
]
const C3_HEX_SQ: Matrix3x3 = [
  [-1, 1, 0],
  [-1, 0, 0],
  [0, 0, 1],
] // C3²

// Helpers
const has_vertex = (vertices: Vec3[], target: Vec3, tol = 1e-8) =>
  vertices.some((v) => v.every((c, idx) => Math.abs(c - target[idx]) < tol))

const edge_key = (v1: Vec3, v2: Vec3) =>
  [v1, v2]
    .map((v) => v.map((c) => c.toFixed(8)).join(`,`))
    .sort()
    .join(`|`)

describe(`reciprocal_lattice`, () => {
  test(`correct for all crystal systems`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const computed = reciprocal_lattice(data.real_lattice as Matrix3x3)
      const expected = data.reciprocal_lattice as Matrix3x3
      computed.forEach((row, idx_i) =>
        row.forEach((val, idx_j) => expect(val).toBeCloseTo(expected[idx_i][idx_j], 10)),
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
    const fcc: Matrix3x3 = [
      [0, 2.5, 2.5],
      [2.5, 0, 2.5],
      [2.5, 2.5, 0],
    ]
    const recip = reciprocal_lattice(fcc)
    for (let idx_i = 0; idx_i < 3; idx_i++) {
      for (let idx_j = 0; idx_j < 3; idx_j++) {
        const dot = fcc[idx_i].reduce((sum, val, idx_k) => sum + val * recip[idx_j][idx_k], 0)
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
    const bz = compute_brillouin_zone(reference_data.cubic.reciprocal_lattice as Matrix3x3, 1)
    expect(bz.vertices).toHaveLength(8)
    expect(bz.faces).toHaveLength(12)
    expect(bz.edges).toHaveLength(12)
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
  ] as [keyof typeof reference_data, number][])(`%s has %d edges`, (name, expected_count) => {
    const bz = compute_brillouin_zone(reference_data[name].reciprocal_lattice as Matrix3x3, 1)
    expect(bz.edges).toHaveLength(expected_count)
  })

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
          edge_to_faces.set(key, (edge_to_faces.get(key) ?? 0) + 1)
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
    const bz = compute_brillouin_zone(reference_data.cubic.reciprocal_lattice as Matrix3x3, 1)
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
    expect(vertices).toHaveLength(8)
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
    expect(() =>
      compute_convex_hull([
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ]),
    ).toThrow(/Need ≥4 vertices/)
  })

  // All 8 corners of the [-1, 1]³ cube
  const cube_verts = [-1, 1].flatMap((z) =>
    [-1, 1].flatMap((y) => [-1, 1].map((x) => [x, y, z] as Vec3)),
  )
  const tetrahedron_verts: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0.5, Math.sqrt(3) / 2, 0],
    [0.5, Math.sqrt(3) / 6, Math.sqrt(2 / 3)],
  ]

  test.each([
    [`tetrahedron`, tetrahedron_verts, 4, 4, 6],
    [`cube`, cube_verts, 8, 12, 12],
  ] as [string, Vec3[], number, number, number][])(
    `%s: %d vertices, %d faces, %d edges`,
    (_, vertices, v_count, f_count, e_count) => {
      const hull = compute_convex_hull(vertices)
      expect(hull.vertices).toHaveLength(v_count)
      expect(hull.faces).toHaveLength(f_count)
      expect(hull.edges).toHaveLength(e_count)
    },
  )

  test(`edge_sharp_angle_deg controls edge filtering`, () => {
    const strict = compute_convex_hull(cube_verts, 1)
    const loose = compute_convex_hull(cube_verts, 45)
    expect(strict.edges.length).toBeGreaterThan(0)
    expect(loose.edges.length).toBeGreaterThan(0)
  })
})

describe(`BZ volume`, () => {
  test.each([5.0, 3.0])(`cubic a=%d → volume ≈ (2π)³/a³`, (a) => {
    const real: Matrix3x3 = [
      [a, 0, 0],
      [0, a, 0],
      [0, 0, a],
    ]
    const bz = compute_brillouin_zone(reciprocal_lattice(real), 1)
    expect(bz.volume).toBeCloseTo((2 * Math.PI) ** 3 / a ** 3, 4)
  })

  test(`volume = |b1 · (b2 × b3)|`, () => {
    const k_lattice = reciprocal_lattice([
      [4, 0, 0],
      [0, 5, 0],
      [0, 0, 6],
    ])
    const bz = compute_brillouin_zone(k_lattice, 1)
    const [b1, b2, b3] = k_lattice
    const cross: Vec3 = [
      b2[1] * b3[2] - b2[2] * b3[1],
      b2[2] * b3[0] - b2[0] * b3[2],
      b2[0] * b3[1] - b2[1] * b3[0],
    ]
    expect(bz.volume).toBeCloseTo(Math.abs(b1.reduce((s, v, idx) => s + v * cross[idx], 0)), 6)
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
    const degenerate: Matrix3x3 = [
      [1e-15, 0, 0],
      [0, 1e-15, 0],
      [0, 0, 1e-15],
    ]
    expect(() => compute_brillouin_zone(reciprocal_lattice(degenerate), 1)).toThrow(
      /singular|Insufficient vertices/,
    )
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

// Fractional rotation matrices (row-major) for mock moyo operations
const ROT_Z_90 = math.vec9_to_mat3x3([0, -1, 0, 1, 0, 0, 0, 0, 1]) as Matrix3x3
const ROT_Z_180 = math.vec9_to_mat3x3([-1, 0, 0, 0, -1, 0, 0, 0, 1]) as Matrix3x3
const ROT_Z_270 = math.vec9_to_mat3x3([0, 1, 0, -1, 0, 0, 0, 0, 1]) as Matrix3x3
const MIRROR_Z = math.vec9_to_mat3x3([1, 0, 0, 0, 1, 0, 0, 0, -1]) as Matrix3x3

// moyo-wasm serializes nalgebra Matrix3 rotations as flat 9-arrays in COLUMN-major order
// (number[] substitutes for Float64Array in tests)
const make_op = (rot: Matrix3x3, translation: Vec3 = [0, 0, 0]) =>
  ({
    rotation: [0, 1, 2].flatMap((col) => rot.map((row) => row[col])),
    translation,
  }) as unknown as MoyoDataset[`operations`][number]

describe(`extract_point_group_from_operations`, () => {
  test(`deduplicates same rotation with different translations`, () => {
    const ops = [make_op(IDENTITY_MAT), make_op(IDENTITY_MAT, [0.5, 0, 0])]
    expect(extract_point_group_from_operations(ops)).toHaveLength(1)
  })

  test.each([
    [`C4 group`, [IDENTITY_MAT, ROT_Z_90, ROT_Z_180, ROT_Z_270], 4],
    [`with inversion/mirror`, [IDENTITY_MAT, INVERSION_MAT, MIRROR_Z], 3],
    [`empty input`, [], 0],
  ] as [string, Matrix3x3[], number][])(`%s → %d unique rotations`, (_, rots, expected) => {
    expect(extract_point_group_from_operations(rots.map((r) => make_op(r)))).toHaveLength(
      expected,
    )
  })

  // Regression: moyo flat arrays are column-major, so a row-major read returns Wᵀ instead
  // of W. Non-symmetric Ws (C4z, hex C3) catch the layout mix-up.
  test(`decodes column-major moyo rotations (round-trip)`, () => {
    for (const rot of [IDENTITY_MAT, ROT_Z_90, C3_HEX, C3_HEX_SQ]) {
      expect(extract_point_group_from_operations([make_op(rot)])).toEqual([rot])
    }
  })
})

describe(`compute_ibz_clipping_planes`, () => {
  test(`identity-only → no planes`, () => {
    expect(compute_ibz_clipping_planes([IDENTITY_MAT])).toHaveLength(0)
  })

  test(`non-trivial symmetry → planes through origin`, () => {
    const planes = compute_ibz_clipping_planes([IDENTITY_MAT, ROT_Z_90])
    expect(planes.length).toBeGreaterThan(0)
    planes.forEach((p) => expect(p.dist).toBe(0))
  })

  test(`C4 group deduplicates planes`, () => {
    const planes = compute_ibz_clipping_planes([IDENTITY_MAT, ROT_Z_90, ROT_Z_180, ROT_Z_270])
    expect(planes.length).toBeLessThanOrEqual(3)
  })

  // Regression: when every curated reference direction is fixed by some operation, the
  // construction must fall back to a generic direction instead of silently reusing a
  // fixed one (which dropped that op's plane and inflated the IBZ volume above V_BZ/|G|).
  test(`finds a generic direction when all curated directions are fixed`, () => {
    // 180° rotation about unit axis u fixes u: R = 2·u·uᵀ − I. One per curated direction
    // fixes EVERY curated direction, forcing the random fallback path.
    const rot180_about = (axis: Vec3): Matrix3x3 => {
      const mag = Math.hypot(...axis)
      const unit = axis.map((coord) => coord / mag) as Vec3
      return [0, 1, 2].map((row) =>
        [0, 1, 2].map((col) => 2 * unit[row] * unit[col] - (row === col ? 1 : 0)),
      ) as Matrix3x3
    }
    const ops = IBZ_REFERENCE_DIRECTIONS.map(rot180_about)
    // every curated direction is fixed by exactly one op, so .find() returns undefined
    for (const dir of IBZ_REFERENCE_DIRECTIONS) {
      const fixed_by = ops.filter(
        (rot) => Math.hypot(...math.subtract(math.mat3x3_vec3_multiply(rot, dir), dir)) < 1e-8,
      ).length
      expect(fixed_by).toBe(1)
    }
    // each of the 3 distinct C2 axes must still contribute its own clipping plane
    expect(compute_ibz_clipping_planes(ops)).toHaveLength(3)
  })

  // find_ibz_reference_direction returns a direction moved by every non-identity op
  test(`find_ibz_reference_direction returns a direction with trivial stabilizer`, () => {
    const ref = find_ibz_reference_direction([ROT_Z_90, ROT_Z_180, MIRROR_Z])
    for (const rot of [ROT_Z_90, ROT_Z_180, MIRROR_Z]) {
      const moved = Math.hypot(...math.subtract(math.mat3x3_vec3_multiply(rot, ref), ref))
      expect(moved).toBeGreaterThan(1e-8)
    }
  })
})

describe(`compute_irreducible_bz`, () => {
  const bz = compute_brillouin_zone(reciprocal_lattice(CUBIC_5), 1)

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
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT, MIRROR_Z])
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
    // The Dirichlet fundamental-domain construction is exact: V_IBZ = V_BZ / |G|
    expect(ibz.volume / hex_bz.volume).toBeCloseTo(1 / 3, 6)
  })

  // Regression: the IBZ construction previously picked a DIFFERENT reference point per
  // rotation, so the clipping half-spaces did not form a consistent fundamental domain
  // and the IBZ volume deviated from V_BZ/|G| for larger point groups.
  test(`C4 group → exactly 1/4 volume`, () => {
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT, ROT_Z_90, ROT_Z_180, ROT_Z_270])
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.volume / bz.volume).toBeCloseTo(1 / 4, 6)
  })

  test(`mirror symmetry → exactly half volume`, () => {
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT, MIRROR_Z])
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.volume / bz.volume).toBeCloseTo(1 / 2, 6)
  })

  test(`full cubic point group Oh (48 ops) → exactly 1/48 volume`, () => {
    // All 48 signed permutation matrices (proper + improper rotations of the cube)
    const oh_ops: Matrix3x3[] = []
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]
    for (const perm of perms) {
      for (let signs = 0; signs < 8; signs++) {
        const mat: Matrix3x3 = [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ]
        for (let row = 0; row < 3; row++) {
          mat[row][perm[row]] = signs & (1 << row) ? -1 : 1
        }
        oh_ops.push(mat)
      }
    }
    expect(oh_ops).toHaveLength(48)

    const ibz = compute_irreducible_bz(bz, oh_ops)
    expect(ibz).not.toBeNull()
    if (!ibz) return
    expect(ibz.volume / bz.volume).toBeCloseTo(1 / 48, 8)
    expect(ibz.vertices.length).toBeGreaterThanOrEqual(4)
  })
})

describe(`fractional_to_cartesian_rotation`, () => {
  const k_lattice = reference_data.hexagonal.reciprocal_lattice as Matrix3x3

  // The old convention R = B·W^{-T}·B^{-1} gave non-orthogonal "rotations" (row norm
  // 1.1547 for hex C3) — assert physical invariants instead of hardcoded matrix elements
  test.each([
    [`hexagonal C3 (120°)`, C3_HEX, k_lattice, 0],
    [`hexagonal C3² (240°)`, C3_HEX_SQ, k_lattice, 0],
    [`cubic C4z (90°)`, ROT_Z_90, reciprocal_lattice(CUBIC_5), 1],
  ] as [string, Matrix3x3, Matrix3x3, number][])(
    `%s: R is a proper rotation mapping the reciprocal lattice onto itself`,
    (_, frac_rot, k_latt, trace) => {
      const R = fractional_to_cartesian_rotation(frac_rot, k_latt)

      // Orthogonal (RᵀR = I), proper (det = +1), right angle (trace = 1 + 2·cosθ — also
      // rules out the identity fallback, which trivially passes the other invariants)
      math
        .dot(math.transpose_3x3_matrix(R), R)
        .forEach((row, ii) =>
          row.forEach((val, jj) =>
            expect(val, `RᵀR[${ii}][${jj}]`).toBeCloseTo(ii === jj ? 1 : 0, 10),
          ),
        )
      expect(math.det_3x3(R)).toBeCloseTo(1, 10)
      expect(R[0][0] + R[1][1] + R[2][2], `trace`).toBeCloseTo(trace, 10)

      // R must map the reciprocal lattice onto itself: coordinates of R·bᵢ in the
      // reciprocal basis (k_cart = Bᵀ·q) must be integers
      const basis_inv = math.matrix_inverse_3x3(math.transpose_3x3_matrix(k_latt))
      for (const b_vec of k_latt) {
        for (const coord of math.dot(basis_inv, math.dot(R, b_vec))) {
          expect(coord, `R·b lattice coords`).toBeCloseTo(Math.round(coord), 8)
        }
      }
    },
  )

  const singular_w: Matrix3x3 = [
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const zero_mat: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  test.each([
    [`singular W`, singular_w, k_lattice],
    [`singular k_lattice`, IDENTITY_MAT, zero_mat],
  ] as [string, Matrix3x3, Matrix3x3][])(`returns identity matrix for %s`, (_, W, k) => {
    expect(fractional_to_cartesian_rotation(W, k)).toEqual(IDENTITY_MAT)
  })
})
