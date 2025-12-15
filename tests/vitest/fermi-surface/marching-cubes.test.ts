// Tests for marching cubes isosurface extraction
import { marching_cubes } from '$lib/fermi-surface/marching-cubes'
import type { Matrix3x3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

describe(`marching_cubes`, () => {
  // Simple identity k-lattice
  const identity_lattice: Matrix3x3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]

  test(`returns empty result for grid entirely below iso_value`, () => {
    const grid = create_uniform_grid(3, 3, 3, 0.5)
    const result = marching_cubes(grid, 1.0, identity_lattice)
    expect(result.vertices.length).toBe(0)
    expect(result.faces.length).toBe(0)
  })

  test(`returns empty result for grid entirely above iso_value`, () => {
    const grid = create_uniform_grid(3, 3, 3, 2.0)
    const result = marching_cubes(grid, 1.0, identity_lattice)
    expect(result.vertices.length).toBe(0)
    expect(result.faces.length).toBe(0)
  })

  test(`extracts surface when iso_value crosses through grid`, () => {
    // Create a grid with a gradient: values increase along x
    const grid = create_gradient_grid(5, 5, 5, `x`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)

    expect(result.vertices.length).toBeGreaterThan(0)
    expect(result.faces.length).toBeGreaterThan(0)
  })

  test(`produces vertices on faces of triangles`, () => {
    const grid = create_gradient_grid(4, 4, 4, `x`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)

    // Every face should reference valid vertex indices
    for (const face of result.faces) {
      expect(face.length).toBe(3)
      for (const vertex_idx of face) {
        expect(vertex_idx).toBeGreaterThanOrEqual(0)
        expect(vertex_idx).toBeLessThan(result.vertices.length)
      }
    }
  })

  test(`vertices are within grid bounds`, () => {
    const grid = create_gradient_grid(4, 4, 4, `z`, 0, 2)
    // Use periodic: false to avoid wrap-around cubes that create vertices beyond [-0.5, 0.5]
    const result = marching_cubes(grid, 1.0, identity_lattice, { periodic: false })

    for (const vert of result.vertices) {
      // With identity lattice and centered=true (default), coordinates should be in [-0.5, 0.5]
      for (const coord of vert) {
        expect(coord).toBeGreaterThanOrEqual(-0.51)
        expect(coord).toBeLessThanOrEqual(0.51)
      }
    }
  })

  test(`normals have unit length`, () => {
    const grid = create_gradient_grid(4, 4, 4, `y`, 0, 2)
    const result = marching_cubes(grid, 1.0, identity_lattice)

    for (const normal of result.normals) {
      const length = Math.sqrt(normal[0] ** 2 + normal[1] ** 2 + normal[2] ** 2)
      expect(length).toBeCloseTo(1.0, 3)
    }
  })

  test(`applies k_lattice transformation correctly`, () => {
    const scaled_lattice: Matrix3x3 = [
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 2],
    ]
    const grid = create_gradient_grid(3, 3, 3, `x`, 0, 2)
    // Use periodic: false to avoid wrap-around cubes that create vertices beyond bounds
    const result = marching_cubes(grid, 1.0, scaled_lattice, { periodic: false })

    // With centered=true (default), fractional coords are in [-0.5, 0.5]
    // Scaled by 2, so Cartesian coords should be in [-1, 1]
    for (const vert of result.vertices) {
      for (const coord of vert) {
        expect(coord).toBeGreaterThanOrEqual(-1.01)
        expect(coord).toBeLessThanOrEqual(1.01)
      }
    }
  })

  test(`handles spherical isosurface`, () => {
    // Create grid with values representing distance from center squared
    const size = 10
    const grid: number[][][] = []
    const center = (size - 1) / 2

    for (let x_idx = 0; x_idx < size; x_idx++) {
      grid[x_idx] = []
      for (let y_idx = 0; y_idx < size; y_idx++) {
        grid[x_idx][y_idx] = []
        for (let z_idx = 0; z_idx < size; z_idx++) {
          const dx = x_idx - center
          const dy = y_idx - center
          const dz = z_idx - center
          grid[x_idx][y_idx][z_idx] = dx * dx + dy * dy + dz * dz
        }
      }
    }

    // Isosurface at radius^2 = 9 (radius = 3)
    const result = marching_cubes(grid, 9, identity_lattice)

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

    // Should produce some output if iso_value crosses the gradient
    if (nx > 2) {
      expect(result.vertices.length).toBeGreaterThan(0)
    }
  })
})

// Helper: create uniform grid with constant value
function create_uniform_grid(
  nx: number,
  ny: number,
  nz: number,
  value: number,
): number[][][] {
  const grid: number[][][] = []
  for (let x_idx = 0; x_idx < nx; x_idx++) {
    grid[x_idx] = []
    for (let y_idx = 0; y_idx < ny; y_idx++) {
      grid[x_idx][y_idx] = []
      for (let z_idx = 0; z_idx < nz; z_idx++) {
        grid[x_idx][y_idx][z_idx] = value
      }
    }
  }
  return grid
}

// Helper: create gradient grid along specified axis
function create_gradient_grid(
  nx: number,
  ny: number,
  nz: number,
  axis: `x` | `y` | `z`,
  min_val: number,
  max_val: number,
): number[][][] {
  const grid: number[][][] = []
  const n_axis = axis === `x` ? nx : axis === `y` ? ny : nz

  for (let x_idx = 0; x_idx < nx; x_idx++) {
    grid[x_idx] = []
    for (let y_idx = 0; y_idx < ny; y_idx++) {
      grid[x_idx][y_idx] = []
      for (let z_idx = 0; z_idx < nz; z_idx++) {
        const t_val = axis === `x` ? x_idx : axis === `y` ? y_idx : z_idx
        const normalized = t_val / (n_axis - 1)
        grid[x_idx][y_idx][z_idx] = min_val + normalized * (max_val - min_val)
      }
    }
  }
  return grid
}
