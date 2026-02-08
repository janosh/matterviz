// Tests for marching cubes via fermi-surface re-export (backward compatibility)
import { marching_cubes } from '$lib/fermi-surface/marching-cubes'
import type { Matrix3x3 } from '$lib/math'
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
const create_gradient_grid = (
  nx: number,
  ny: number,
  nz: number,
  axis: `x` | `y` | `z`,
  min_val: number,
  max_val: number,
): number[][][] => {
  const n_axis = axis === `x` ? nx : axis === `y` ? ny : nz
  return Array.from(
    { length: nx },
    (_, x_idx) =>
      Array.from({ length: ny }, (_, y_idx) =>
        Array.from({ length: nz }, (_, z_idx) => {
          const t_val = axis === `x` ? x_idx : axis === `y` ? y_idx : z_idx
          const denom = n_axis > 1 ? n_axis - 1 : 1
          return min_val + (t_val / denom) * (max_val - min_val)
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

// Note: compute_vertex_normals tests are in tests/vitest/marching-cubes.test.ts
// (fermi-surface re-exports from the same module)

describe(`marching_cubes (fermi-surface re-export)`, () => {
  const identity_lattice: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]

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

    for (const face of result.faces) {
      expect(face).toHaveLength(3)
      for (const vertex_idx of face) {
        expect(vertex_idx).toBeGreaterThanOrEqual(0)
        expect(vertex_idx).toBeLessThan(result.vertices.length)
      }
    }
  })

  test.each([
    [1, [-0.501, 0.501]],
    [2, [-1.01, 1.01]],
  ])(`vertices within bounds with scale=%d`, (scale, [min_bound, max_bound]) => {
    const lattice: Matrix3x3 = [[scale, 0, 0], [0, scale, 0], [0, 0, scale]]
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

    expect(result.normals.length).toBeGreaterThan(0)
    expect(result.normals.length).toBe(result.vertices.length)
    for (const normal of result.normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1.0, 3)
    }
  })

  test(`spherical isosurface produces closed surface with consistent vertex distances`, () => {
    const grid = create_spherical_grid(10)
    const result = marching_cubes(grid, 9, identity_lattice) // radius² = 9

    expect(result.vertices.length).toBeGreaterThan(10)
    expect(result.faces.length).toBeGreaterThan(10)
    // All vertices should be at roughly the same distance from the centroid
    // (a sphere's isosurface has uniform radius)
    const centroid = result.vertices.reduce(
      (acc, vert) => [acc[0] + vert[0], acc[1] + vert[1], acc[2] + vert[2]],
      [0, 0, 0],
    ).map((val) => val / result.vertices.length)
    const dists = result.vertices.map((vert) =>
      Math.hypot(vert[0] - centroid[0], vert[1] - centroid[1], vert[2] - centroid[2])
    )
    const mean_dist = dists.reduce((sum, dist) => sum + dist, 0) / dists.length
    // All distances should be within 15% of the mean (tight for a sphere)
    for (const dist of dists) {
      expect(Math.abs(dist - mean_dist) / mean_dist).toBeLessThan(0.15)
    }
  })

  test.each([
    [3, 3, 3],
    [5, 4, 3],
  ])(`handles non-cubic grid %dx%dx%d`, (nx, ny, nz) => {
    const grid = create_gradient_grid(nx, ny, nz, `x`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)
    expect(result.vertices.length).toBeGreaterThan(0)
    expect(result.faces.length).toBeGreaterThan(0)
  })
})
