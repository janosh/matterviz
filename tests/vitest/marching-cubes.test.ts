// Tests for the marching cubes algorithm and vertex normal computation
import {
  compute_vertex_normals,
  marching_cubes,
  marching_cubes_buffers,
} from '$lib/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'
import { cubic_matrix, make_grid } from './setup'

const IDENTITY = cubic_matrix(1)
const NON_PERIODIC = { periodic: false, centered: false }
const PERIODIC = { periodic: true, centered: false }

// Gaussian blob centered in grid, values ~0 at edges to ~1 at center
const gaussian_grid = (size: number): number[][][] => {
  const center = (size - 1) / 2
  const sigma = size / 4
  return make_grid(size, size, size, (ix, iy, iz) => {
    const [dx, dy, dz] = [ix - center, iy - center, iz - center]
    return Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sigma * sigma))
  })
}

const expect_array_close = (actual: ArrayLike<number>, expected: number[]): void => {
  expect(actual).toHaveLength(expected.length)
  for (let idx = 0; idx < actual.length; idx++) {
    expect(actual[idx]).toBeCloseTo(expected[idx], 6)
  }
}

// === marching_cubes ===

describe(`marching_cubes`, () => {
  test.each([
    { dims: [1, 1, 1], iso: 0.5, label: `1×1×1 grid` },
    { dims: [1, 3, 3], iso: 0.5, label: `1×3×3 grid` },
    { dims: [3, 1, 3], iso: 0.5, label: `3×1×3 grid` },
    { dims: [3, 3, 1], iso: 0.5, label: `3×3×1 grid` },
    { dims: [0, 0, 0], iso: 0.5, label: `empty grid` },
    { dims: [4, 4, 4], iso: 2, label: `isovalue above all values` },
    { dims: [4, 4, 4], iso: 0.5, label: `isovalue below all values` },
  ])(`returns empty result for $label`, ({ dims: [nx, ny, nz], iso }) => {
    const result = marching_cubes(make_grid(nx, ny, nz, 1), iso, IDENTITY)
    expect([result.vertices, result.faces, result.normals]).toEqual([[], [], []])
  })

  test(`Gaussian blob produces valid geometry: triangles, indices, normals`, () => {
    const result = marching_cubes(gaussian_grid(8), 0.5, IDENTITY, NON_PERIODIC)

    // Produces non-empty output with matching vertex/normal counts
    expect(result.vertices.length).toBeGreaterThan(0)
    expect(result.faces.length).toBeGreaterThan(0)
    expect(result.normals).toHaveLength(result.vertices.length)

    for (const face of result.faces) {
      // All faces are triangles with 3 distinct indices in valid range
      expect(face).toHaveLength(3)
      expect(new Set(face).size).toBe(3)
      for (const idx of face) {
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(result.vertices.length)
      }
    }

    // Normals are unit length
    for (const normal of result.normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1.0, 3)
    }

    // Vertex caching: shared vertices across adjacent cubes
    expect(result.vertices.length).toBeLessThan(result.faces.length * 3)
    const vertex_keys = result.vertices.map((vertex) =>
      vertex.map((coord) => coord.toFixed(12)).join(`,`),
    )
    expect(new Set(vertex_keys).size).toBe(result.vertices.length)
  })

  test(`buffer path preserves compatibility topology and values`, () => {
    const grid = gaussian_grid(8)
    const options = { ...NON_PERIODIC, normals: true }
    const compatibility = marching_cubes(grid, 0.5, IDENTITY, options)
    const buffers = marching_cubes_buffers(grid, 0.5, IDENTITY, options)

    expect(Array.from(buffers.indices)).toEqual(compatibility.faces.flat())
    expect_array_close(buffers.positions, compatibility.vertices.flat())
    expect_array_close(buffers.normals, compatibility.normals.flat())
  })

  test(`centered=true shifts vertices relative to uncentered`, () => {
    const grid = gaussian_grid(8)
    const centered = marching_cubes(grid, 0.5, IDENTITY, { ...NON_PERIODIC, centered: true })
    const uncentered = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)

    expect(centered.faces).toHaveLength(uncentered.faces.length)
    // Centered vertices have lower mean position (shifted by -0.5)
    const mean_x = (verts: Vec3[]) =>
      verts.reduce((sum, vertex) => sum + vertex[0], 0) / verts.length
    expect(mean_x(centered.vertices)).toBeLessThan(mean_x(uncentered.vertices))
  })

  test(`periodic=true wraps boundaries and produces more faces`, () => {
    const grid = make_grid(4, 4, 4, (ix, iy, iz) => {
      // High at origin and opposite corner, low in middle
      return (ix === 0 && iy === 0 && iz === 0) || (ix === 3 && iy === 3 && iz === 3)
        ? 2.0
        : 0.0
    })
    const periodic = marching_cubes(grid, 1.0, IDENTITY, PERIODIC)
    const non_periodic = marching_cubes(grid, 1.0, IDENTITY, NON_PERIODIC)
    expect(periodic.faces.length).toBeGreaterThanOrEqual(non_periodic.faces.length)
  })

  test(`periodic boundary-crossing isosurface has no cell-spanning triangles`, () => {
    // Gaussian at frac (0,0,0) wraps all cell boundaries. Regression: edge cache keys
    // used wrapped grid coords, merging opposite-face vertices into spanning triangles.
    const min_frac = (idx: number) => Math.min(idx / 8, 1 - idx / 8)
    const grid = make_grid(8, 8, 8, (ix, iy, iz) =>
      Math.exp(-(min_frac(ix) ** 2 + min_frac(iy) ** 2 + min_frac(iz) ** 2) / 0.045),
    )
    const { vertices, faces } = marching_cubes(grid, 0.3, IDENTITY, PERIODIC)
    expect(faces.length).toBeGreaterThan(0)
    const edge_len = (i1: number, i2: number) =>
      Math.hypot(...vertices[i1].map((coord, axis) => coord - vertices[i2][axis]))
    const max_edge = Math.max(
      ...faces.flatMap(([vert_a, vert_b, vert_c]) => [
        edge_len(vert_a, vert_b),
        edge_len(vert_b, vert_c),
        edge_len(vert_c, vert_a),
      ]),
    )
    // No triangle edge should span more than half the unit cell
    expect(max_edge).toBeLessThan(0.5)
  })

  test(`interpolate=false places vertices at different positions than interpolated`, () => {
    // Quadratic gradient: interpolation won't land at midpoints
    const grid = make_grid(4, 4, 4, (ix) => ix * ix)
    const interp = marching_cubes(grid, 2.0, IDENTITY, {
      ...NON_PERIODIC,
      interpolate: true,
    })
    const no_interp = marching_cubes(grid, 2.0, IDENTITY, {
      ...NON_PERIODIC,
      interpolate: false,
    })
    expect(no_interp.vertices.length).toBeGreaterThan(0)
    expect(no_interp.faces).toHaveLength(interp.faces.length)
    // Non-linear gradient means interpolated positions differ from midpoints
    expect(
      no_interp.vertices.some(
        (vertex, idx) => Math.abs(vertex[0] - interp.vertices[idx][0]) > 1e-6,
      ),
    ).toBe(true)
  })

  test(`lattice transformation scales vertices`, () => {
    const grid = gaussian_grid(6)
    const scaled_lattice = cubic_matrix(10)
    const unit = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
    const scaled = marching_cubes(grid, 0.5, scaled_lattice, NON_PERIODIC)

    expect(scaled.vertices).toHaveLength(unit.vertices.length)
    // Guard: unit result has non-zero y-coordinates
    expect(unit.vertices.some((vertex) => Math.abs(vertex[1]) > 1e-6)).toBe(true)
    // Scaled vertices should be 10x unit vertices
    for (let idx = 0; idx < unit.vertices.length; idx++) {
      for (let dim = 0; dim < 3; dim++) {
        expect(scaled.vertices[idx][dim]).toBeCloseTo(unit.vertices[idx][dim] * 10, 5)
      }
    }
  })

  test(`non-orthogonal lattice transforms vertices differently from identity`, () => {
    const grid = gaussian_grid(6)
    const sheared: Matrix3x3 = [
      [1, 0, 0],
      [0.5, 0.866, 0],
      [0, 0, 1],
    ]
    const result = marching_cubes(grid, 0.5, sheared, NON_PERIODIC)
    const identity = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)

    expect(result.vertices.length).toBeGreaterThan(0)
    expect(
      result.vertices.some(
        (vertex, idx) => Math.abs(vertex[1] - identity.vertices[idx][1]) > 1e-6,
      ),
    ).toBe(true)
  })

  test(`higher isovalue produces fewer faces for a blob`, () => {
    const grid = gaussian_grid(8)
    const low = marching_cubes(grid, 0.3, IDENTITY, NON_PERIODIC)
    const high = marching_cubes(grid, 0.7, IDENTITY, NON_PERIODIC)
    expect(high.faces.length).toBeLessThanOrEqual(low.faces.length)
  })
})

// === compute_vertex_normals ===

describe(`compute_vertex_normals`, () => {
  const xy_triangle: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ]
  const xy_quad: Vec3[] = [...xy_triangle, [1, 1, 0]]

  test.each([
    { label: `xy-plane triangle`, vertices: xy_triangle, face: [0, 1, 2] },
    { label: `quad via fan triangulation`, vertices: xy_quad, face: [0, 1, 3, 2] },
  ])(`$label produces z-direction unit normals`, ({ vertices, face }) => {
    const normals = compute_vertex_normals(vertices, [face])
    expect(normals).toHaveLength(vertices.length)
    for (const normal of normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5)
      expect(Math.abs(normal[2])).toBeCloseTo(1, 5)
    }
  })

  test.each([
    { label: `empty inputs`, vertices: [] as Vec3[], faces: [] as number[][] },
    { label: `face with fewer than 3 indices`, vertices: xy_triangle, faces: [[0, 1]] },
    { label: `face with out-of-bounds index`, vertices: xy_triangle, faces: [[0, 1, 99]] },
    { label: `face with negative index`, vertices: xy_triangle, faces: [[-1, 1, 2]] },
  ])(`returns zero normals for $label`, ({ vertices, faces }) => {
    // All normals remain at zero (invalid faces are skipped)
    expect(compute_vertex_normals(vertices, faces)).toEqual(vertices.map(() => [0, 0, 0]))
  })

  test(`averages normals from shared vertices`, () => {
    // Two triangles meeting at 90° sharing edge (0-1)
    const vertices: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const normals = compute_vertex_normals(vertices, [
      [0, 1, 2],
      [0, 1, 3],
    ])

    // Shared vertex 0: averaged normal has both y and z components
    const shared = normals[0]
    expect(Math.hypot(...shared)).toBeCloseTo(1.0, 5)
    expect(Math.abs(shared[1])).toBeGreaterThan(0.1)
    expect(Math.abs(shared[2])).toBeGreaterThan(0.1)
  })
})
