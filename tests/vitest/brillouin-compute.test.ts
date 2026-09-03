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
} from '$lib/brillouin/compute'
import { DEFAULT_FIT_PADDING } from '$lib/structure/camera-fit'
import {
  bz_fit_extent,
  cartesian_to_fractional,
  default_camera_position,
  k_cell_fit_extent,
  k_lattice_inverse,
  k_space_size,
  polyhedron_centroid,
  polyhedron_geometry,
} from '$lib/brillouin'
import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { MoyoDataset } from '@spglib/moyo-wasm'
import { describe, expect, test } from 'vitest'
import { col_major, cubic_matrix, IDENTITY_MATRIX3 as IDENTITY_MAT, load_json } from './setup'

const recip_2pi = (lattice: Matrix3x3) => math.reciprocal_lattice(lattice, { two_pi: true })

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
const CUBIC_5 = cubic_matrix(5)
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
  vertices.some((vertex) => vertex.every((coord, idx) => Math.abs(coord - target[idx]) < tol))

const edge_key = (v1: Vec3, v2: Vec3) =>
  [v1, v2]
    .map((vertex) => vertex.map((coord) => coord.toFixed(8)).join(`,`))
    .toSorted()
    .join(`|`)

// Real-space lattice from cell parameters (a along x, b in the xy plane), angles in degrees
const lattice_from_params = (
  a_len: number,
  b_len: number,
  c_len: number,
  alpha: number,
  beta: number,
  gamma: number,
): Matrix3x3 => {
  const to_rad = Math.PI / 180
  const [cos_a, cos_b, cos_g, sin_g] = [
    Math.cos(alpha * to_rad),
    Math.cos(beta * to_rad),
    Math.cos(gamma * to_rad),
    Math.sin(gamma * to_rad),
  ]
  const c_x = c_len * cos_b
  const c_y = (c_len * (cos_a - cos_b * cos_g)) / sin_g
  return [
    [a_len, 0, 0],
    [b_len * cos_g, b_len * sin_g, 0],
    [c_x, c_y, Math.sqrt(c_len ** 2 - c_x ** 2 - c_y ** 2)],
  ]
}

const A_CUBIC = 4 // conventional cube edge shared by the cubic, fcc and bcc cells below
const HEX_A = 3
const HEX_C = 5
// Real-space lattices (rows) whose first Brillouin zones have known shapes. The non-reduced
// row basis spans the same lattice as [[4,0,0],[-0.5,1,0],[0,0,4]] but its ±1 reciprocal
// shell misses one ± pair of the zone's side faces, which used to inflate the volume by 3.5%.
const REAL_LATTICES: Record<string, Matrix3x3> = {
  cubic: cubic_matrix(A_CUBIC),
  fcc: [
    [0, A_CUBIC / 2, A_CUBIC / 2],
    [A_CUBIC / 2, 0, A_CUBIC / 2],
    [A_CUBIC / 2, A_CUBIC / 2, 0],
  ],
  bcc: [
    [-A_CUBIC / 2, A_CUBIC / 2, A_CUBIC / 2],
    [A_CUBIC / 2, -A_CUBIC / 2, A_CUBIC / 2],
    [A_CUBIC / 2, A_CUBIC / 2, -A_CUBIC / 2],
  ],
  hexagonal: lattice_from_params(HEX_A, HEX_A, HEX_C, 90, 90, 120),
  orthorhombic: lattice_from_params(4, 5, 6, 90, 90, 90),
  triclinic: lattice_from_params(4, 5, 6, 80, 85, 70),
  non_reduced: [
    [4, 0, 0],
    [3.5, 1, 0],
    [0, 0, 4],
  ],
  // simple cubic lattice in a [[1,0,0],[10,1,0],[0,0,1]] supercell setting: its reciprocal
  // basis is a sliver whose ±1 Bragg shell bounds a cell ~100× too large along one axis
  sheared_cubic: [
    [A_CUBIC, 0, 0],
    [10 * A_CUBIC, A_CUBIC, 0],
    [0, 0, A_CUBIC],
  ],
}

type Polygon = { normal: Vec3; dist: number; vertex_ids: Set<number> }
// Group the hull's triangles into planar polygons: same outward unit normal and plane offset
// within 1e-8 (the hull is unit-scale, so this is ~1e8 × f64 eps and far below any dihedral)
const polygon_faces = (vertices: Vec3[], faces: number[][]): Polygon[] => {
  const polygons: Polygon[] = []
  for (const face of faces) {
    const [v0, v1, v2] = face.map((idx) => vertices[idx])
    const normal = math.normalize_vec(
      math.cross_3d(math.subtract(v1, v0), math.subtract(v2, v0)),
      [0, 0, 0],
    )
    const dist = math.dot(normal, v0)
    const match = polygons.find(
      (poly) =>
        Math.abs(poly.dist - dist) < 1e-8 && math.euclidean_dist(poly.normal, normal) < 1e-8,
    )
    if (match) face.forEach((idx) => match.vertex_ids.add(idx))
    else polygons.push({ normal, dist, vertex_ids: new Set(face) })
  }
  return polygons
}
// polygon side count → number of such faces, e.g. { 4: 6, 6: 8 } for a truncated octahedron
const polygon_histogram = (polygons: Polygon[]): Record<number, number> => {
  const hist: Record<number, number> = {}
  for (const poly of polygons)
    hist[poly.vertex_ids.size] = (hist[poly.vertex_ids.size] ?? 0) + 1
  return hist
}
const polygon_centroid = (vertices: Vec3[], poly: Polygon): Vec3 =>
  math.scale(
    [...poly.vertex_ids].reduce<Vec3>((acc, idx) => math.add(acc, vertices[idx]), [0, 0, 0]),
    1 / poly.vertex_ids.size,
  )
const min_dist_to = (points: Vec3[], target: Vec3) =>
  Math.min(...points.map((point) => math.euclidean_dist(point, target)))
const edge_midpoints = (edges: Vec3[][]) =>
  edges.map(([from, to]) => math.scale(math.add(from, to), 0.5))
// Number of sharp edges meeting at `point` (vertex degree)
const vertex_degree = (edges: Vec3[][], point: Vec3) =>
  edges.filter((edge) => edge.some((end) => math.euclidean_dist(end, point) < 1e-9)).length

// a_i · b_j = 2π δ_ij itself is covered in math.test.ts; this pins the 2π convention the BZ
// reference data (numpy) was generated with
test(`reciprocal_lattice with two_pi matches the reference data for all crystal systems`, () => {
  for (const data of Object.values(reference_data)) {
    const computed = recip_2pi(data.real_lattice as Matrix3x3)
    expect(computed).toEqual(
      data.reciprocal_lattice.map((row) => row.map((val) => expect.closeTo(val, 10))),
    )
  }
})

describe(`compute_brillouin_zone`, () => {
  test(`valid BZ + inversion symmetry for all crystal systems`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      expect(bz.vertices.length).toBeGreaterThan(3)
      expect(bz.faces.length).toBeGreaterThan(3)
      expect(bz.edges.length).toBeGreaterThan(0)
      expect(bz.volume).toBeCloseTo(data.bz_volume_approximation, 6)
      for (const vert of bz.vertices) {
        expect(has_vertex(bz.vertices, vert.map((coord) => -coord) as Vec3)).toBe(true)
      }
    }
  })

  // The first zone is the Wigner-Seitz cell of the reciprocal lattice, so its volume is exactly
  // (2π)³/V_real. 1e-12 relative is ~5000 f64 ulps: the hull vertices are f64 three-plane
  // intersections, so anything looser would hide a float32 round trip (8e-8) or a missing face.
  test.each(Object.entries(REAL_LATTICES))(
    `%s: first BZ volume = (2π)³/|det(real)| to 1e-12 relative`,
    (_name, real) => {
      const bz = compute_brillouin_zone(recip_2pi(real), 1)
      const expected = (2 * Math.PI) ** 3 / Math.abs(math.det_3x3(real))
      expect(Math.abs(bz.volume - expected)).toBeLessThan(1e-12 * expected)
    },
  )

  // Polygonal faces (coplanar hull triangles merged), distinct vertices and sharp edges of the
  // textbook zone shapes. Euler: V − E + F = 2 for each row.
  test.each([
    [`cubic`, `cube`, { 4: 6 }, 8, 12],
    [`fcc`, `truncated octahedron`, { 4: 6, 6: 8 }, 24, 36],
    [`bcc`, `rhombic dodecahedron`, { 4: 12 }, 14, 24],
    [`hexagonal`, `hexagonal prism`, { 4: 6, 6: 2 }, 12, 18],
    [`orthorhombic`, `cuboid`, { 4: 6 }, 8, 12],
    // generic lattice: the 14-faced Wigner-Seitz cell (8 hexagons + 6 parallelograms)
    [`triclinic`, `truncated octahedron (generic)`, { 4: 6, 6: 8 }, 24, 36],
    // oblique 2D lattice × c axis: hexagonal prism, not the parallelepiped the ±1 shell gives
    [`non_reduced`, `hexagonal prism`, { 4: 6, 6: 2 }, 12, 18],
    // same cube as `cubic`: the basis is reduced first, so this takes ~1 ms rather than the
    // hours an unreduced radius-bounded G search needs (47 s already at shear 3)
    [`sheared_cubic`, `cube`, { 4: 6 }, 8, 12],
  ] as [string, string, Record<number, number>, number, number][])(
    `%s: %s with faces %o, %d vertices, %d edges`,
    (name, _shape, face_hist, n_vertices, n_edges) => {
      const bz = compute_brillouin_zone(recip_2pi(REAL_LATTICES[name]), 1)
      const polygons = polygon_faces(bz.vertices, bz.faces)
      expect(polygon_histogram(polygons)).toEqual(face_hist)
      expect(bz.vertices).toHaveLength(n_vertices)
      expect(bz.edges).toHaveLength(n_edges)
      // every hull vertex is a corner of some polygon (no stray coplanar points)
      expect(new Set(polygons.flatMap((poly) => [...poly.vertex_ids])).size).toBe(n_vertices)
    },
  )

  // Setyawan–Curtarolo high-symmetry points in Cartesian k-space (a = conventional cube edge)
  describe(`high-symmetry points sit on the zone`, () => {
    const two_pi_a = (2 * Math.PI) / A_CUBIC
    const pi_a = Math.PI / A_CUBIC
    const hex_k = (4 * Math.PI) / (3 * HEX_A) // |ΓK| of the hexagonal zone
    const pi_c = Math.PI / HEX_C

    test.each([
      // cubic zone is the cube [−π/a, π/a]³: R corner, X face centre, M edge midpoint
      [`cubic`, `R`, `vertex`, [pi_a, pi_a, pi_a], 3],
      [`cubic`, `X`, `face`, [pi_a, 0, 0], 4],
      [`cubic`, `M`, `edge`, [pi_a, pi_a, 0], null],
      // fcc: squares from G = (2π/a)(±2,0,0) centred on X, hexagons from (2π/a)(±1,±1,±1)
      // centred on L, W where a square meets two hexagons, K/U on hexagon-hexagon/-square edges
      [`fcc`, `W`, `vertex`, [two_pi_a, two_pi_a / 2, 0], 3],
      [`fcc`, `X`, `face`, [two_pi_a, 0, 0], 4],
      [`fcc`, `L`, `face`, [pi_a, pi_a, pi_a], 6],
      [`fcc`, `K`, `edge`, [(3 / 4) * two_pi_a, (3 / 4) * two_pi_a, 0], null],
      [`fcc`, `U`, `edge`, [two_pi_a, two_pi_a / 4, two_pi_a / 4], null],
      // bcc: rhombi from G = (2π/a)(±1,±1,0) perms centred on N; H is the 4-fold corner on
      // the axis, P the 3-fold corner on the body diagonal
      [`bcc`, `H`, `vertex`, [0, 0, two_pi_a], 4],
      [`bcc`, `P`, `vertex`, [two_pi_a / 2, two_pi_a / 2, two_pi_a / 2], 3],
      [`bcc`, `N`, `face`, [two_pi_a / 2, two_pi_a / 2, 0], 4],
      // hexagonal prism: K = (b₁+b₂)/3 on a vertical edge, H above it, M = b₁/2 centres a
      // side rectangle, A = b₃/2 centres a hexagonal cap, L = M + b₃/2 on a cap edge
      [`hexagonal`, `H`, `vertex`, [hex_k / 2, (hex_k * Math.sqrt(3)) / 2, pi_c], 3],
      [`hexagonal`, `K`, `edge`, [hex_k / 2, (hex_k * Math.sqrt(3)) / 2, 0], null],
      [`hexagonal`, `M`, `face`, [Math.PI / HEX_A, Math.PI / (HEX_A * Math.sqrt(3)), 0], 4],
      [`hexagonal`, `A`, `face`, [0, 0, pi_c], 6],
      [
        `hexagonal`,
        `L`,
        `edge`,
        [Math.PI / HEX_A, Math.PI / (HEX_A * Math.sqrt(3)), pi_c],
        null,
      ],
    ] as [string, string, `vertex` | `face` | `edge`, Vec3, number | null][])(
      `%s %s is a %s point`,
      (name, _label, kind, point, count) => {
        const bz = compute_brillouin_zone(recip_2pi(REAL_LATTICES[name]), 1)
        if (kind === `vertex`) {
          expect(min_dist_to(bz.vertices, point)).toBeLessThan(1e-9)
          expect(vertex_degree(bz.edges, point)).toBe(count)
        } else if (kind === `face`) {
          const polygons = polygon_faces(bz.vertices, bz.faces)
          const centroids = polygons.map((poly) => polygon_centroid(bz.vertices, poly))
          const face_idx = centroids.findIndex((ctr) => math.euclidean_dist(ctr, point) < 1e-9)
          expect(face_idx, `no face centred on the point`).toBeGreaterThanOrEqual(0)
          expect(polygons[face_idx].vertex_ids.size).toBe(count)
          // on the surface: exactly on that face's plane, inside every other
          expect(
            Math.abs(math.dot(polygons[face_idx].normal, point) - polygons[face_idx].dist),
          ).toBeLessThan(1e-9)
          for (const poly of polygons) {
            expect(math.dot(poly.normal, point) - poly.dist).toBeLessThan(1e-9)
          }
        } else {
          expect(min_dist_to(edge_midpoints(bz.edges), point)).toBeLessThan(1e-9)
        }
      },
    )
  })

  // A coplanar real lattice has no reciprocal lattice; the error must surface, not NaN geometry
  test(`singular real or reciprocal lattice throws`, () => {
    const coplanar: Matrix3x3 = [
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ]
    expect(() => recip_2pi(coplanar)).toThrow(/singular/)
    expect(() => compute_brillouin_zone(coplanar, 1)).toThrow(/singular/)
    expect(() =>
      compute_brillouin_zone(
        [
          [1, 0, 0],
          [0, NaN, 0],
          [0, 0, 1],
        ],
        1,
      ),
    ).toThrow(/non-finite/)
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

  test(`valid edge topology, lengths, and face indices`, () => {
    for (const [_type, data] of Object.entries(reference_data)) {
      const bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      const keys = new Set<string>()
      const edge_to_faces = new Map<string, number>()
      const max_len = Math.cbrt(bz.volume) * 10

      for (const face of bz.faces) {
        expect(face.length).toBeGreaterThanOrEqual(3)
        for (const idx of face) {
          expect(idx).toBeGreaterThanOrEqual(0)
          expect(idx).toBeLessThan(bz.vertices.length)
        }
        for (let idx = 0; idx < face.length; idx++) {
          const key = edge_key(
            bz.vertices[face[idx]],
            bz.vertices[face[(idx + 1) % face.length]],
          )
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
        const len = Math.hypot(v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2])
        expect(len).toBeGreaterThan(0)
        expect(len).toBeLessThan(max_len)
      }
      expect(bz.edges.length).toBeLessThan((3 * bz.faces.length) / 2)
    }
  })
})

describe(`generate_bz_vertices`, () => {
  const k_lattice = recip_2pi(CUBIC_5)

  test(`cubic BZ: 8 vertices at corners`, () => {
    const vertices = generate_bz_vertices(k_lattice, 1)
    expect(vertices).toHaveLength(8)
    const k_max = Math.PI / 5
    vertices.forEach((vertex) =>
      vertex.forEach((coord) => expect(Math.abs(Math.abs(coord) - k_max)).toBeLessThan(1e-14)),
    )
  })

  test(`max_planes_by_order parameter`, () => {
    const skew_lattice = recip_2pi([
      [3, 0.5, 0.2],
      [0.1, 4, 0.3],
      [0.2, 0.4, 5],
    ])
    expect(generate_bz_vertices(skew_lattice, 2, { 1: 8, 2: 15, 3: 20 }).length).toBeLessThan(
      generate_bz_vertices(skew_lattice, 2).length,
    )
  })

  test(`clamps unchecked orders above 3`, () => {
    const max_planes_by_order = { 1: 10, 2: 10, 3: 10, 4: 4 }
    const third_order = generate_bz_vertices(k_lattice, 3, max_planes_by_order)
    expect(generate_bz_vertices(k_lattice, 4 as 3, max_planes_by_order)).toEqual(third_order)
  })
})

describe(`compute_convex_hull`, () => {
  // The count check ran before dedup and never looked at rank, so a vertex set that cannot
  // define a solid slipped through: 4 coincident points came back as a silently empty hull,
  // and 4 collinear ones reached three.js and surfaced as a bare
  // "Cannot read properties of undefined (reading 'point')". An IBZ clip can produce either.
  test.each([
    [
      `coincident`,
      [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
      /≥4 distinct vertices/,
    ],
    [
      `collinear`,
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [3, 0, 0],
      ],
      /vertices spanning 3D/,
    ],
  ] as [string, Vec3[], RegExp][])(
    `throws a descriptive error for 4 %s vertices`,
    (_case, vertices, message) => {
      expect(() => compute_convex_hull(vertices)).toThrow(message)
    },
  )

  // a flat but genuinely 2D set still builds, as the IBZ code relies on
  test(`still accepts a coplanar quad`, () => {
    const hull = compute_convex_hull([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ])
    expect(hull.vertices).toHaveLength(4)
  })

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
    // Flattened tetrahedron so face angles straddle 1° vs 45° (cube does not)
    const pyramid: Vec3[] = [...tetrahedron_verts.slice(0, 3), [0.5, Math.sqrt(3) / 6, 0.1]]
    expect(compute_convex_hull(pyramid, 1).edges.length).toBeGreaterThan(
      compute_convex_hull(pyramid, 45).edges.length,
    )
  })
})

describe(`BZ order`, () => {
  // Higher orders return the convex hull of zones 1..n. For the simple cubic lattice the union
  // of zones 1+2 is the rhombic dodecahedron |kx|+|ky| ≤ 2π/a (& perms): 14 vertices, 24 edges,
  // volume exactly 2·V₁. The union of zones 1..3 is not convex, so its hull overshoots 3·V₁
  // (measured 4·V₁); only the volume is pinned since coplanar points on the hull's faces make
  // its vertex/edge counts a triangulation detail.
  test.each([
    [2, 2, 14, 24],
    [3, 4, null, null],
  ])(`cubic order %d: hull volume = %d·V₁`, (order, ratio, n_verts, n_edges) => {
    const k_lattice = recip_2pi(CUBIC_5)
    const bz = compute_brillouin_zone(k_lattice, order as 2 | 3)
    const vol_1 = (2 * Math.PI) ** 3 / 125
    expect(Math.abs(bz.volume - ratio * vol_1)).toBeLessThan(1e-12 * vol_1)
    expect(bz.order).toBe(order)
    if (n_verts !== null) expect(bz.vertices).toHaveLength(n_verts)
    if (n_edges !== null) expect(bz.edges).toHaveLength(n_edges)
  })

  test(`order >3 clamps to 3`, () => {
    expect(compute_brillouin_zone(recip_2pi(CUBIC_5), 4 as 3).order).toBe(3)
  })
})

// Fractional rotation matrices (row-major) for mock moyo operations
const ROT_Z_90 = math.vec9_to_mat3x3([0, -1, 0, 1, 0, 0, 0, 0, 1])
const ROT_Z_180 = math.vec9_to_mat3x3([-1, 0, 0, 0, -1, 0, 0, 0, 1])
const ROT_Z_270 = math.vec9_to_mat3x3([0, 1, 0, -1, 0, 0, 0, 0, 1])
const MIRROR_Z = math.vec9_to_mat3x3([1, 0, 0, 0, 1, 0, 0, 0, -1])

// moyo-wasm serializes nalgebra Matrix3 rotations as flat 9-arrays in COLUMN-major order
// (number[] substitutes for Float64Array in tests)
const make_op = (rot: Matrix3x3, translation: Vec3 = [0, 0, 0]) =>
  ({
    rotation: col_major(rot),
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
    expect(extract_point_group_from_operations(rots.map((rot) => make_op(rot)))).toHaveLength(
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
  // one plane per non-identity op (through the origin), minus duplicates
  test.each([
    [`identity only`, [IDENTITY_MAT], 0],
    [`C4z generator`, [IDENTITY_MAT, ROT_Z_90], 1],
    [`C4 group`, [IDENTITY_MAT, ROT_Z_90, ROT_Z_180, ROT_Z_270], 3],
  ] as [string, Matrix3x3[], number][])(
    `%s → %d planes through the origin`,
    (_label, ops, n_planes) => {
      const planes = compute_ibz_clipping_planes(ops)
      expect(planes).toHaveLength(n_planes)
      for (const plane of planes) {
        expect(plane.dist).toBe(0)
        expect(Math.hypot(...plane.normal)).toBeCloseTo(1, 10)
      }
    },
  )

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

// Closure of integer generator matrices under multiplication (finite point groups only)
const group_closure = (generators: Matrix3x3[]): Matrix3x3[] => {
  const key = (mat: Matrix3x3) => mat.flat().map(Math.round).join(`,`)
  const ops = new Map<string, Matrix3x3>([[key(IDENTITY_MAT), IDENTITY_MAT]])
  let frontier: Matrix3x3[] = [IDENTITY_MAT]
  while (frontier.length > 0) {
    const next: Matrix3x3[] = []
    for (const op of frontier) {
      for (const gen of generators) {
        const prod = math.dot(op, gen)
        if (ops.has(key(prod))) continue
        ops.set(key(prod), prod)
        next.push(prod)
      }
    }
    frontier = next
  }
  return [...ops.values()]
}

// Hexagonal point group D6h in fractional coordinates of a₁ = (a,0,0), a₂ = a(−½, √3/2, 0):
// the 60° rotation sends a₁ → a₁+a₂ and a₂ → −a₁ (columns of W), C2 about a₁ sends
// a₂ → −a₁−a₂ and a₃ → −a₃, plus the horizontal mirror.
const C6_HEX: Matrix3x3 = [
  [1, -1, 0],
  [1, 0, 0],
  [0, 0, 1],
]
const C2_HEX_A1: Matrix3x3 = [
  [1, -1, 0],
  [0, -1, 0],
  [0, 0, -1],
]
const MIRROR_Z_MAT: Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
]
const D6H_OPS = group_closure([C6_HEX, C2_HEX_A1, MIRROR_Z_MAT])

describe(`compute_irreducible_bz`, () => {
  const bz = compute_brillouin_zone(recip_2pi(CUBIC_5), 1)

  // All 48 signed permutation matrices (proper + improper rotations of the cube)
  const oh_ops: Matrix3x3[] = []
  for (const perm of [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]) {
    for (let signs = 0; signs < 8; signs++) {
      const mat: Matrix3x3 = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ]
      for (let row = 0; row < 3; row++) mat[row][perm[row]] = signs & (1 << row) ? -1 : 1
      oh_ops.push(mat)
    }
  }

  test(`generated point groups have the right order`, () => {
    expect(group_closure(oh_ops)).toHaveLength(48)
    expect(D6H_OPS).toHaveLength(24)
    // fcc Oh ops are integer in the primitive basis and still form a 48-element group
    for (const w_frac of fcc_oh_frac) {
      for (const val of w_frac.flat())
        expect(Math.abs(val - Math.round(val))).toBeLessThan(1e-12)
    }
    expect(group_closure(fcc_oh_ops)).toHaveLength(48)
    // C6 really is a 60° rotation of the hexagonal reciprocal lattice: trace = 1 + 2cos60° = 2
    const rot = fractional_to_cartesian_rotation(C6_HEX, recip_2pi(REAL_LATTICES.hexagonal))
    expect(rot[0][0] + rot[1][1] + rot[2][2]).toBeCloseTo(2, 12)
  })

  // Oh in the fractional basis of the fcc primitive cell: W = B·R·B⁻¹ inverts
  // fractional_to_cartesian_rotation (R orthogonal), and must come out integer
  const fcc_k = recip_2pi(REAL_LATTICES.fcc)
  const fcc_k_inv = math.matrix_inverse_3x3(fcc_k)
  const fcc_oh_frac = oh_ops.map((rot) => math.dot(math.dot(fcc_k, rot), fcc_k_inv))
  const fcc_oh_ops = fcc_oh_frac.map(
    (w_frac) => w_frac.map((row) => row.map(Math.round)) as Matrix3x3,
  )

  // The Dirichlet wedge is an exact fundamental domain: V_IBZ = V_BZ/|G|. 1e-8 relative leaves
  // room for the clip-then-rehull rounding while catching a single dropped plane (factor 2).
  test.each([
    [`cubic Oh`, 48, REAL_LATTICES.cubic, oh_ops],
    [`fcc Oh (primitive basis)`, 48, REAL_LATTICES.fcc, fcc_oh_ops],
    [`hexagonal D6h`, 24, REAL_LATTICES.hexagonal, D6H_OPS],
  ] as [string, number, Matrix3x3, Matrix3x3[]][])(
    `%s: IBZ volume = BZ volume / %i`,
    (_label, order, real, ops) => {
      const full_bz = compute_brillouin_zone(recip_2pi(real), 1)
      const ibz = compute_irreducible_bz(full_bz, ops)
      expect(Math.abs(ibz.volume * order - full_bz.volume)).toBeLessThan(1e-8 * full_bz.volume)
    },
  )

  test(`P1 (identity only) → full BZ`, () => {
    const ibz = compute_irreducible_bz(bz, [IDENTITY_MAT])
    expect(ibz.vertices).toHaveLength(bz.vertices.length)
    expect(ibz.volume).toBeCloseTo(bz.volume, 6)
  })

  test.each([
    {
      label: `inversion`,
      ops: [IDENTITY_MAT, INVERSION_MAT],
      ratio: 1 / 2,
      digits: 5,
    },
    {
      label: `mirror`,
      ops: [IDENTITY_MAT, MIRROR_Z],
      ratio: 1 / 2,
      digits: 6,
      check_faces: true,
    },
    {
      label: `C4`,
      ops: [IDENTITY_MAT, ROT_Z_90, ROT_Z_180, ROT_Z_270],
      ratio: 1 / 4,
      digits: 6,
    },
  ])(`$label → volume ratio $ratio`, ({ ops, ratio, digits, check_faces }) => {
    const ibz = compute_irreducible_bz(bz, ops)
    expect(ibz.volume / bz.volume).toBeCloseTo(ratio, digits)
    expect(ibz.vertices.length).toBeGreaterThanOrEqual(4)
    if (check_faces) {
      expect(ibz.faces.length).toBeGreaterThanOrEqual(4)
      expect(ibz.edges.length).toBeGreaterThan(0)
      ibz.faces.flat().forEach((idx) => {
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(ibz.vertices.length)
      })
    }
  })

  // inversion halves the BZ for every crystal system: IBZ is a fundamental domain of volume V_BZ/|G|
  test.each(Object.keys(reference_data))(
    `%s with inversion → half the BZ volume`,
    (system) => {
      const data = reference_data[system]
      const crystal_bz = compute_brillouin_zone(data.reciprocal_lattice as Matrix3x3, 1)
      const ibz = compute_irreducible_bz(crystal_bz, [IDENTITY_MAT, INVERSION_MAT])
      expect(ibz.volume / crystal_bz.volume).toBeCloseTo(0.5, 10)
      expect(ibz.vertices.length).toBeGreaterThanOrEqual(4)
    },
  )

  test(`hexagonal C3 group uses W^{-T} correctly`, () => {
    const hex_bz = compute_brillouin_zone(
      reference_data.hexagonal.reciprocal_lattice as Matrix3x3,
      1,
    )
    const ibz = compute_irreducible_bz(hex_bz, [IDENTITY_MAT, C3_HEX, C3_HEX_SQ])
    expect(ibz.volume / hex_bz.volume).toBeCloseTo(1 / 3, 6)
  })
})

describe(`fractional_to_cartesian_rotation`, () => {
  const k_lattice = reference_data.hexagonal.reciprocal_lattice as Matrix3x3

  // The old convention R = B·W^{-T}·B^{-1} gave non-orthogonal "rotations" (row norm
  // 1.1547 for hex C3) — assert physical invariants instead of hardcoded matrix elements
  test.each([
    [`hexagonal C3 (120°)`, C3_HEX, k_lattice, 0],
    [`hexagonal C3² (240°)`, C3_HEX_SQ, k_lattice, 0],
    [`cubic C4z (90°)`, ROT_Z_90, recip_2pi(CUBIC_5), 1],
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
  // rotations are never singular, so a failed inversion is corrupt input, not a case to
  // paper over with an identity (which would silently drop that op's IBZ clipping plane)
  test.each([
    [`singular W`, singular_w, k_lattice],
    [`singular k_lattice`, IDENTITY_MAT, zero_mat],
  ] as [string, Matrix3x3, Matrix3x3][])(`throws for %s`, (_, w_matrix, k_matrix) => {
    expect(() => fractional_to_cartesian_rotation(w_matrix, k_matrix)).toThrow(/singular/)
  })
})

const cube_vertices: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
]

describe(`polyhedron_geometry`, () => {
  // faces -> expected position-attribute count; null when no valid triangle remains
  // (degenerate <3-vertex faces and out-of-bounds indices are skipped; quads fan-triangulate)
  test.each<[string, number[][], number | null]>([
    [`empty faces`, [], null],
    [`degenerate face (<3 vertices)`, [[0, 1]], null],
    [`out-of-bounds vertex index`, [[0, 1, 99]], null],
    [`quad fan-triangulates into 2 triangles`, [[0, 1, 2, 3]], 6],
    [
      `keeps valid triangle, drops invalid faces`,
      [
        [0, 1],
        [0, 1, 99],
        [0, 1, 2],
      ],
      3,
    ],
  ])(`%s`, (_label, faces, expected_count) => {
    const geometry = polyhedron_geometry(cube_vertices, faces)
    if (expected_count === null) expect(geometry).toBeNull()
    else expect(geometry?.getAttribute(`position`).count).toBe(expected_count)
    geometry?.dispose()
  })

  test(`computes +z per-face normals and a bounding sphere for a CCW xy-plane quad`, () => {
    const geometry = polyhedron_geometry(cube_vertices, [[0, 1, 2, 3]])
    const normals = geometry?.getAttribute(`normal`)
    expect([normals?.getX(0), normals?.getY(0), normals?.getZ(5)]).toEqual([0, 0, 1])
    expect(geometry?.boundingSphere).not.toBeNull()
    geometry?.dispose()
  })
})

describe(`k_lattice_inverse + cartesian_to_fractional`, () => {
  const k_lattice: Matrix3x3 = [
    [2, 0, 0],
    [0, 4, 0],
    [0, 0, 8],
  ]

  test(`round-trips Cartesian to fractional coordinates`, () => {
    const inv = k_lattice_inverse(k_lattice)
    expect(cartesian_to_fractional(inv, [2, 4, 8])).toEqual([1, 1, 1])
    expect(cartesian_to_fractional(inv, [1, 1, 1])).toEqual([0.5, 0.25, 0.125])
  })

  test(`round-trips coordinates for a non-orthogonal row lattice`, () => {
    const skewed: Matrix3x3 = [
      [1, 0, 0],
      [0.5, Math.sqrt(3) / 2, 0],
      [0, 0, 1],
    ]
    const inverse = k_lattice_inverse(skewed)
    const fractional = cartesian_to_fractional(inverse, [0.5, Math.sqrt(3) / 2, 0])
    expect(fractional?.[0]).toBeCloseTo(0, 12)
    expect(fractional?.[1]).toBeCloseTo(1, 12)
    expect(fractional?.[2]).toBeCloseTo(0, 12)
  })

  test(`returns null for missing or singular lattice`, () => {
    expect(k_lattice_inverse(undefined)).toBeNull()
    expect(
      k_lattice_inverse([
        [1, 0, 0],
        [2, 0, 0],
        [0, 0, 1],
      ]),
    ).toBeNull()
    expect(cartesian_to_fractional(null, [1, 2, 3])).toBeNull()
  })
})

describe(`scene sizing helpers`, () => {
  test(`polyhedron_centroid averages vertices, falls back to origin`, () => {
    expect(polyhedron_centroid(cube_vertices)).toEqual([0.5, 0.5, 0])
    expect(polyhedron_centroid(undefined)).toEqual([0, 0, 0])
    expect(polyhedron_centroid([])).toEqual([0, 0, 0])
  })

  test(`k_space_size is the mean k-vector magnitude, 10 when missing`, () => {
    const k_lattice: Matrix3x3 = [
      [3, 0, 0],
      [0, 6, 0],
      [0, 0, 9],
    ]
    expect(k_space_size(k_lattice)).toBe(6)
    expect(k_space_size(undefined)).toBe(10)
  })

  // `size` is a mean |b| in 1/A, ~0.5 for a 12 A cell. It used to be floored at 1, parking the
  // camera at a fixed real-space distance for every cell wider than 12 A instead of the zone.
  test.each([
    [`scales [10, 3, 8] by the size`, 2, [20, 6, 16]],
    [`keeps scaling below 1`, 0.5, [5, 1.5, 4]],
    [`falls back to the placeholder size with nothing to frame`, 0, [100, 30, 80]],
  ])(`default_camera_position %s`, (_desc, size, expected) => {
    expect(default_camera_position(size)).toEqual(expected)
  })

  describe(`bz_fit_extent`, () => {
    const k_lattice: Matrix3x3 = [
      [4, 0, 0],
      [0, 4, 0],
      [0, 0, 4],
    ]
    // a cube of side 2 centered on the origin: the enclosing sphere has diameter 2*sqrt(3)
    const cube: Vec3[] = [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) => [-1, 1].map((z): Vec3 => [x, y, z])),
    )
    const tiny = cube.map((vert) => math.scale(vert, 0.02))
    const coincident = Array.from({ length: 4 }, (): Vec3 => [0.1, 0.1, 0.1])

    test.each([
      [`spans the enclosing sphere of the vertices`, cube, 1, 2 * Math.sqrt(3)],
      [`scales with padding`, cube, 2, 4 * Math.sqrt(3)],
      // the default padding must exceed the bare diameter or the zone touches the frame edge
      [
        `pads to 92% of the shorter edge by default`,
        cube,
        undefined,
        (2 * Math.sqrt(3)) / 0.92,
      ],
      // Without vertices the zone is framed by the cell it is inscribed in: a cubic lattice of
      // side 4 gives a cell diagonal of 4*sqrt(3). Using 2*k_space_size = 8 instead would frame
      // the zone too loosely and then jump when the vertices arrive.
      [
        `falls back to the cell without vertices`,
        undefined,
        undefined,
        (4 * Math.sqrt(3)) / 0.92,
      ],
      [`falls back on empty vertices too`, [], undefined, (4 * Math.sqrt(3)) / 0.92],
      // Framing must stay scale-free: a zone 50x smaller is 50x smaller on screen. A 1 A floor
      // exceeded the true extent below ~0.29 here and drew every such zone against a constant.
      [`scales down to a 0.02 1/A zone`, tiny, 1, 2 * Math.sqrt(3) * 0.02],
      // coincident vertices leave nothing to frame, so the enclosing cell decides
      [`falls back on coincident vertices`, coincident, 1, 4 * Math.sqrt(3)],
    ] as [string, Vec3[] | undefined, number | undefined, number][])(
      `%s`,
      (_desc, vertices, padding, expected) =>
        expect(bz_fit_extent(vertices, k_lattice, padding)).toBeCloseTo(expected, 10),
    )

    // the fallback and the vertices branch must frame a cubic zone identically, or the view
    // visibly rescales the moment the computed vertices land
    test(`the cubic fallback matches what its own vertices would give`, () => {
      // Wigner-Seitz zone of the cubic reciprocal lattice above: a cube of side 4
      const zone: Vec3[] = [-2, 2].flatMap((x) =>
        [-2, 2].flatMap((y) => [-2, 2].map((z): Vec3 => [x, y, z])),
      )
      expect(bz_fit_extent(undefined, k_lattice)).toBeCloseTo(
        bz_fit_extent(zone, k_lattice),
        10,
      )
    })

    test(`an anisotropic cell is framed by its longest diagonal, not its mean vector`, () => {
      // mean |b| is 34, so a k_space_size-based fallback would frame 100 units of cell at 68
      const stretched: Matrix3x3 = [
        [100, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]
      expect(k_cell_fit_extent(stretched, 1)).toBeCloseTo(Math.hypot(100, 1, 1), 10)
      // and the same cell 1000x smaller, which a 1 A floor used to round up to a flat 1
      const shrunk = stretched.map((row) => math.scale(row, 1e-3)) as Matrix3x3
      expect(k_cell_fit_extent(shrunk, 1)).toBeCloseTo(Math.hypot(0.1, 1e-3, 1e-3), 10)
    })

    // keeps this module's private FIT_PADDING from drifting away from camera-fit's constant
    // without importing element data into every consumer of brillouin/geometry
    test(`default padding matches structure_fit_frame`, () => {
      expect(bz_fit_extent(cube, k_lattice)).toBe(
        bz_fit_extent(cube, k_lattice, DEFAULT_FIT_PADDING),
      )
    })

    // k_space_size has its own placeholder |b| when there is no reciprocal lattice either
    test(`falls back twice without a lattice`, () =>
      expect(bz_fit_extent(undefined, undefined)).toBeCloseTo((Math.sqrt(3) * 10) / 0.92, 10))
  })
})
