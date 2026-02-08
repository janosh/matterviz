// Tests for marching cubes isosurface extraction
import { compute_vertex_normals, marching_cubes } from '$lib/fermi-surface/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

// Helper: create uniform grid with constant value
const create_uniform_grid = (
  nx: number,
  ny: number,
  nz: number,
  value: number,
): number[][][] =>
  Array.from(
    { length: nx },
    () => Array.from({ length: ny }, () => Array.from({ length: nz }, () => value)),
  )

// Helper: create gradient grid along specified axis
function create_gradient_grid(
  nx: number,
  ny: number,
  nz: number,
  axis: `x` | `y` | `z`,
  min_val: number,
  max_val: number,
): number[][][] {
  const n_axis = axis === `x` ? nx : axis === `y` ? ny : nz
  return Array.from(
    { length: nx },
    (_, x_idx) =>
      Array.from({ length: ny }, (_, y_idx) =>
        Array.from({ length: nz }, (_, z_idx) => {
          const t_val = axis === `x` ? x_idx : axis === `y` ? y_idx : z_idx
          const denom = n_axis > 1 ? n_axis - 1 : 1
          const normalized = t_val / denom
          return min_val + normalized * (max_val - min_val)
        })),
  )
}

// Helper: create spherical grid (distance² from center)
const create_spherical_grid = (size: number): number[][][] => {
  const center = (size - 1) / 2
  return Array.from(
    { length: size },
    (_, x_idx) =>
      Array.from(
        { length: size },
        (_, y_idx) =>
          Array.from({ length: size }, (_, z_idx) => {
            const dx = x_idx - center
            const dy = y_idx - center
            const dz = z_idx - center
            return dx * dx + dy * dy + dz * dz
          }),
      ),
  )
}

describe(`marching_cubes`, () => {
  const identity_lattice: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  test.each([
    [`below`, 0.5, 1.0],
    [`above`, 2.0, 1.0],
  ])(`returns empty result for grid entirely %s iso_value`, (_, grid_val, iso_val) => {
    const grid = create_uniform_grid(3, 3, 3, grid_val)
    const result = marching_cubes(grid, iso_val, identity_lattice)
    expect(result.vertices).toHaveLength(0)
    expect(result.faces).toHaveLength(0)
  })

  test(`extracts surface with valid triangles when iso_value crosses grid`, () => {
    const grid = create_gradient_grid(5, 5, 5, `x`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)

    expect(result.vertices.length).toBeGreaterThan(0)
    expect(result.faces.length).toBeGreaterThan(0)

    // Every face should reference valid vertex indices
    for (const face of result.faces) {
      expect(face).toHaveLength(3)
      for (const vertex_idx of face) {
        expect(vertex_idx).toBeGreaterThanOrEqual(0)
        expect(vertex_idx).toBeLessThan(result.vertices.length)
      }
    }
  })

  test.each([
    [1, [-0.501, 0.501]], // identity: fractional coords in [-0.5, 0.5]
    [2, [-1.01, 1.01]], // scaled 2x: Cartesian coords in [-1, 1]
  ])(`vertices within bounds with scale=%d`, (scale, [min_bound, max_bound]) => {
    const lattice: Matrix3x3 = [
      [scale, 0, 0],
      [0, scale, 0],
      [0, 0, scale],
    ]
    const grid = create_gradient_grid(4, 4, 4, `x`, 0, 2)
    const result = marching_cubes(grid, 1.0, lattice, { periodic: false })

    for (const vert of result.vertices) {
      for (const coord of vert) {
        expect(coord).toBeGreaterThanOrEqual(min_bound)
        expect(coord).toBeLessThanOrEqual(max_bound)
      }
    }
  })

  test(`normals have unit length`, () => {
    const grid = create_gradient_grid(4, 4, 4, `y`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)

    for (const normal of result.normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1.0, 3)
    }
  })

  test(`handles spherical isosurface`, () => {
    const grid = create_spherical_grid(10)
    const result = marching_cubes(grid, 9, identity_lattice) // radius² = 9

    expect(result.vertices.length).toBeGreaterThan(10)
    expect(result.faces.length).toBeGreaterThan(10)
  })

  test.each([
    [2, 2, 2],
    [3, 3, 3],
    [5, 4, 3],
  ])(`handles non-cubic grid %dx%dx%d`, (nx, ny, nz) => {
    const grid = create_gradient_grid(nx, ny, nz, `x`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)

    if (nx > 2) {
      expect(result.vertices.length).toBeGreaterThan(0)
    }
  })
})

describe(`compute_vertex_normals`, () => {
  // CCW triangle in xy plane - reused across tests
  const xy_triangle: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]

  test(`computes unit-length normals pointing in correct direction`, () => {
    const normals = compute_vertex_normals(xy_triangle, [[0, 1, 2]])

    expect(normals).toHaveLength(3)
    for (const normal of normals) {
      // Unit length
      expect(Math.hypot(...normal)).toBeCloseTo(1.0, 5)
      // CCW winding: e1×e2 = (1,0,0)×(0,1,0) = (0,0,1) → +z direction
      expect(normal[0]).toBeCloseTo(0, 5)
      expect(normal[1]).toBeCloseTo(0, 5)
      expect(normal[2]).toBeCloseTo(1.0, 5)
    }
  })

  test(`handles quad faces with fan triangulation`, () => {
    const quad: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]
    const normals = compute_vertex_normals(quad, [[0, 1, 2, 3]])

    expect(normals).toHaveLength(4)
    for (const normal of normals) {
      expect(Math.abs(normal[2])).toBeCloseTo(1.0, 5)
    }
  })

  test.each([
    [`empty input`, [], [], 0],
    [`edge (fewer than 3 vertices)`, [[0, 0, 0], [1, 0, 0]] as Vec3[], [[0, 1]], 2],
    [`out-of-bounds index`, [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as Vec3[], [[0, 1, 99]], 3],
  ])(`returns zero normals for %s`, (_, vertices, faces, expected_len) => {
    const normals = compute_vertex_normals(vertices, faces)

    expect(normals).toHaveLength(expected_len)
    for (const normal of normals) {
      expect(normal).toEqual([0, 0, 0])
    }
  })

  test(`averages normals for shared vertices`, () => {
    // Two triangles sharing edge (0,1), forming a V-shape
    const vertices: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0.5, 1, 0.5],
      [0.5, 1, -0.5],
    ]
    const normals = compute_vertex_normals(vertices, [
      [0, 1, 2],
      [0, 1, 3],
    ])

    expect(normals).toHaveLength(4)
    // Shared vertices (0, 1) should have unit-length averaged normals
    for (const idx of [0, 1]) {
      const len = Math.sqrt(
        normals[idx][0] ** 2 + normals[idx][1] ** 2 + normals[idx][2] ** 2,
      )
      expect(len).toBeCloseTo(1.0, 5)
    }
  })
})
