import type { Matrix3x3, Vec3 } from '$lib/math'
import * as math from '$lib/math'
import {
  clip_frac_plane_to_cell,
  lattice_plane_polygons,
  MAX_AUTO_PLANES,
  polygon_edge_vertices,
  polygon_fan_vertices,
  tile_lattice_planes,
} from '$lib/structure/lattice-planes'
import { describe, expect, test } from 'vitest'

const cubic: Matrix3x3 = [
  [4, 0, 0],
  [0, 4, 0],
  [0, 0, 4],
]
// hexagonal a = 3, c = 5 (gamma = 120°), so plane normals are not along cell vectors
const hexagonal: Matrix3x3 = [
  [3, 0, 0],
  [-1.5, (3 * Math.sqrt(3)) / 2, 0],
  [0, 0, 5],
]
const triclinic = math.cell_to_lattice_matrix(4, 5, 6, 70, 80, 100)

// A valid clipped polygon: every vertex on the plane and inside the cell (fractional), no
// near-duplicate vertices, convex winding order
const expect_valid_polygon = (
  polygon: Vec3[],
  hkl: Vec3,
  offset: number,
  lattice: Matrix3x3,
) => {
  expect(polygon.length).toBeGreaterThanOrEqual(3)
  const to_frac = math.create_cart_to_frac(lattice)
  const normal = math.normalize_vec(math.miller_plane_normal(lattice, hkl))
  const turns = new Set<number>()
  for (const [idx, vert] of polygon.entries()) {
    const frac = to_frac(vert)
    expect(math.dot(hkl, frac)).toBeCloseTo(offset, 8)
    for (const coord of frac) expect(coord).toBeGreaterThanOrEqual(-1e-12)
    for (const coord of frac) expect(coord).toBeLessThanOrEqual(1 + 1e-12)
    const prev = polygon[(idx + polygon.length - 1) % polygon.length]
    const next = polygon[(idx + 1) % polygon.length]
    expect(math.euclidean_dist(vert, next)).toBeGreaterThan(1e-6)
    const turn = math.cross_3d(math.subtract(vert, prev), math.subtract(next, vert))
    turns.add(Math.sign(math.dot(turn, normal)))
  }
  expect(turns.size).toBe(1)
  expect(turns.has(0)).toBe(false)
}

describe(`lattice_plane_polygons`, () => {
  test(`(100) in a cubic cell is the two faces x = 0 and x = a`, () => {
    const polys = lattice_plane_polygons({ hkl: [1, 0, 0] }, cubic)
    expect(polys.map((poly) => poly.offset)).toEqual([0, 1])
    for (const { offset, polygon } of polys) {
      expect(polygon).toHaveLength(4)
      for (const vert of polygon) expect(vert[0]).toBeCloseTo(4 * offset, 10)
    }
  })

  test(`(-100) draws the same two faces as (100)`, () => {
    const faces = (hkl: Vec3) =>
      lattice_plane_polygons({ hkl }, cubic).map(({ polygon }) =>
        polygon.map((vert) => vert[0]).toSorted((val_a, val_b) => val_a - val_b),
      )
    expect(faces([-1, 0, 0]).toReversed()).toEqual(faces([1, 0, 0]))
  })

  // every polygon of a family is valid and the family has the expected offsets (the integer
  // levels h·x + k·y + l·z reaches over the cell, minus corner and edge touches) and vertex
  // counts: faces and diagonals appear exactly once
  test.each<[string, Matrix3x3, Vec3, number[], number[]]>([
    [`cubic`, cubic, [1, 1, 0], [1], [4]],
    [`cubic`, cubic, [1, -1, 0], [0], [4]],
    [`cubic`, cubic, [1, 1, 1], [1, 2], [3, 3]],
    // (222) is the half-spacing stack: indices are used as given, not gcd-reduced
    [`cubic`, cubic, [2, 2, 2], [1, 2, 3, 4, 5], [3, 3, 6, 3, 3]],
    [`cubic`, cubic, [0, 0, -2], [-2, -1, 0], [4, 4, 4]],
    [`cubic`, cubic, [5, 3, 1], [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 4, 4, 4, 4, 4, 3]],
    [`triclinic`, triclinic, [1, 0, 0], [0, 1], [4, 4]],
    [`triclinic`, triclinic, [1, 1, 0], [1], [4]],
    [`triclinic`, triclinic, [5, 3, 1], [1, 2, 3, 4, 5, 6, 7, 8], [3, 4, 4, 4, 4, 4, 4, 3]],
    [`triclinic`, triclinic, [-2, 3, -1], [-2, -1, 0, 1, 2], [3, 4, 4, 4, 3]],
  ])(`%s %j family`, (_label, lattice, hkl, offsets, vertex_counts) => {
    const polys = lattice_plane_polygons({ hkl }, lattice)
    expect(polys.map(({ offset }) => offset)).toEqual(offsets)
    expect(polys.map(({ polygon }) => polygon.length)).toEqual(vertex_counts)
    for (const { offset, polygon } of polys)
      expect_valid_polygon(polygon, hkl, offset, lattice)
  })

  test.each<[string, Matrix3x3]>([
    [`cubic`, cubic],
    [`triclinic`, triclinic],
  ])(`explicit offset: (111) through the %s cell center is a hexagon`, (_label, lattice) => {
    const [{ offset, polygon }] = lattice_plane_polygons(
      { hkl: [1, 1, 1], offsets: [1.5] },
      lattice,
    )
    expect(offset).toBe(1.5)
    expect(polygon).toHaveLength(6)
    expect_valid_polygon(polygon, [1, 1, 1], 1.5, lattice)
  })

  test(`cubic (111) center hexagon is regular`, () => {
    const [{ polygon }] = lattice_plane_polygons({ hkl: [1, 1, 1], offsets: [1.5] }, cubic)
    const center = math.scale(math.add(...cubic), 0.5)
    const radii = polygon.map((vert) => math.euclidean_dist(vert, center))
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 10)
    const edges = polygon.map((vert, idx) =>
      math.euclidean_dist(vert, polygon[(idx + 1) % polygon.length]),
    )
    for (const edge of edges) expect(edge).toBeCloseTo(edges[0], 10)
  })

  test(`hexagonal (110): the planes through the two c-edges touch the cell in a line only`, () => {
    // offsets 0 and 2 are single edges of the cell, so only offset 1 yields a polygon
    const offsets = lattice_plane_polygons({ hkl: [1, 1, 0] }, hexagonal).map(
      (poly) => poly.offset,
    )
    expect(offsets).toEqual([1])
  })

  test(`offsets outside the cell, NaN or empty yield no polygons`, () => {
    const hkl: Vec3 = [1, 0, 0]
    expect(lattice_plane_polygons({ hkl, offsets: [2, -0.5] }, cubic)).toEqual([])
    expect(lattice_plane_polygons({ hkl, offsets: [Number.NaN, Infinity] }, cubic)).toEqual([])
    expect(lattice_plane_polygons({ hkl, offsets: [] }, cubic)).toEqual([])
  })

  test(`a repeated offset is drawn once so coincident fills do not stack up`, () => {
    const polys = lattice_plane_polygons({ hkl: [1, 0, 0], offsets: [0.5, 0.5, 0] }, cubic)
    expect(polys.map(({ offset }) => offset)).toEqual([0.5, 0])
  })

  test.each<[Vec3, string]>([
    [[0, 0, 0], `do not define a plane`],
    [[1, 0.5, 0], `must be integers`],
    [[1, Number.NaN, 0], `must be integers`],
    [[1, 0, 0, 1] as unknown as Vec3, `must be 3 numbers`],
    [[60_000, -60_000, 0], `120001 lattice planes in the cell`],
    [[10 ** 12, 0, 0], `more than the ${MAX_AUTO_PLANES}`], // would exceed the max array length
  ])(`rejects invalid Miller indices %j`, (hkl, message) => {
    expect(() => lattice_plane_polygons({ hkl }, cubic)).toThrow(message)
  })

  test(`explicit offsets bypass the automatic plane-count limit`, () => {
    const hkl: Vec3 = [2 * MAX_AUTO_PLANES, 0, 0]
    const polys = lattice_plane_polygons({ hkl, offsets: [1000] }, cubic)
    expect(polys.map(({ offset }) => offset)).toEqual([1000])
  })
})

describe(`tile_lattice_planes`, () => {
  test.each([[[1, 0, 0]], [[1, 1, 1]], [[2, -1, 0]]] as [Vec3][])(
    `%s keeps its spacing and covers the whole block`,
    (hkl) => {
      const planes = [{ hkl }]
      expect(tile_lattice_planes(planes, [1, 1, 1])).toBe(planes)
      const tiling: Vec3 = [2, 3, 2]
      const block = math.scale_lattice_matrix(cubic, tiling)
      const [tiled] = tile_lattice_planes([{ hkl }], tiling)
      const cell_polys = lattice_plane_polygons({ hkl }, cubic)
      const block_polys = lattice_plane_polygons(tiled, block)

      // same normal direction, so the same family of planes
      const cell_normal = math.normalize_vec(math.miller_plane_normal(cubic, hkl))
      const block_normal = math.normalize_vec(math.miller_plane_normal(block, tiled.hkl))
      for (const [axis, component] of block_normal.entries()) {
        expect(component).toBeCloseTo(cell_normal[axis], 10)
      }
      // every plane of the single cell still lies in the block's set, at the same distance
      // from the origin along that normal
      const distance = (polygon: Vec3[]) => math.dot(block_normal, polygon[0])
      const block_distances = block_polys.map(({ polygon }) => distance(polygon))
      for (const { polygon } of cell_polys) {
        const target = distance(polygon)
        expect(
          block_distances.some((dist) => Math.abs(dist - target) < 1e-9),
          `plane at ${target} missing from the block`,
        ).toBe(true)
      }
      // and the block holds more of them, since it is larger along every normal component
      expect(block_polys.length).toBeGreaterThan(cell_polys.length)
      for (const { offset, polygon } of block_polys) {
        expect_valid_polygon(polygon, tiled.hkl, offset, block)
      }
    },
  )

  // Explicit offsets name specific planes, so tiling extends exactly those across the block
  // rather than filling it with the rest of the family the way auto offsets do
  test(`explicit offsets keep naming the same planes, extended over the block`, () => {
    const tiling: Vec3 = [3, 2, 1]
    const block = math.scale_lattice_matrix(cubic, tiling)
    const [tiled] = tile_lattice_planes([{ hkl: [1, 0, 0], offsets: [1] }], tiling)
    expect(tiled.hkl).toEqual([3, 0, 0])
    expect(tiled.offsets).toEqual([1])

    const polys = lattice_plane_polygons(tiled, block)
    expect(polys).toHaveLength(1) // the one plane asked for, not the block's whole family
    for (const vert of polys[0].polygon) expect(vert[0]).toBeCloseTo(4, 10) // still x = 4 Å
    // it now spans the block, where before it stopped at the first cell
    const spans = [1, 2].map((axis) => Math.max(...polys[0].polygon.map((vert) => vert[axis])))
    expect(spans).toEqual([8, 4])
    // while auto offsets do fill the block
    expect(
      lattice_plane_polygons(tile_lattice_planes([{ hkl: [1, 0, 0] }], tiling)[0], block),
    ).toHaveLength(4)
  })
})

describe(`clip_frac_plane_to_cell`, () => {
  test(`a corner within tolerance of the plane is one vertex, not a sliver`, () => {
    // Plane 3.29e-9 past the corner (0,0,1) along an edge nearly parallel to it (coefficient
    // 6.4e-4 on b), so the edge to (0,1,1) crosses the plane 5e-6 from the snapped corner.
    // Skipping edges with an on-plane endpoint keeps that crossing from becoming a second,
    // near-duplicate vertex (which a string-rounding dedup used to let through).
    const coeffs: Vec3 = [-1.8798189163208008, 0.0006400197744369507, -0.4217844009399414]
    const level = math.dot(coeffs, [0, 0, 1]) + 3.29e-9
    const polygon = clip_frac_plane_to_cell(coeffs, level, cubic)
    expect(polygon).toHaveLength(4)
    expect(polygon).toContainEqual([0, 0, 4])
    for (const [idx, vert] of polygon.entries()) {
      expect(math.euclidean_dist(vert, polygon[(idx + 1) % 4])).toBeGreaterThan(1e-3)
    }
  })

  test(`a plane just outside tolerance of a corner yields no sliver triangle`, () => {
    // (111) at level 3 - 5e-7 misses the corner (1,1,1) by more than the on-plane tolerance,
    // so it crosses all three edges meeting there ~5e-7 apart: one vertex, not a polygon
    expect(clip_frac_plane_to_cell([1, 1, 1], 3 - 5e-7, cubic)).toEqual([])
    // the same plane through the cell interior is unaffected
    expect(clip_frac_plane_to_cell([1, 1, 1], 2.5, cubic)).toHaveLength(3)
  })
})

describe(`polygon_fan_vertices / polygon_edge_vertices`, () => {
  const square: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ]
  test(`fan of an n-gon is n − 2 triangles sharing vertex 0, outline is n edges`, () => {
    const from_indices = (indices: number[]) => indices.map((idx) => square[idx])
    expect(polygon_fan_vertices(square)).toEqual(from_indices([0, 1, 2, 0, 2, 3]))
    expect(polygon_edge_vertices(square)).toEqual(from_indices([0, 1, 1, 2, 2, 3, 3, 0]))
    // the 6-vertex (111) hexagon: 4 triangles, 6 edges
    const hexagon = clip_frac_plane_to_cell([1, 1, 1], 1.5, cubic)
    expect(polygon_fan_vertices(hexagon)).toHaveLength(12)
    expect(polygon_edge_vertices(hexagon)).toHaveLength(12)
  })
})
