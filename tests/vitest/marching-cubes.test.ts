// Tests for the marching cubes algorithm and vertex normal computation
import { compute_vertex_normals, marching_cubes } from '$lib/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import { describe, expect, test } from 'vitest'

const IDENTITY: Matrix3x3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
const NON_PERIODIC = { periodic: false, centered: false }

// Helper: create a 3D grid filled with a function f(ix, iy, iz)
const make_grid = (
  nx: number,
  ny: number,
  nz: number,
  fill_fn: (ix: number, iy: number, iz: number) => number,
): number[][][] =>
  Array.from(
    { length: nx },
    (_, ix) =>
      Array.from(
        { length: ny },
        (_, iy) => Array.from({ length: nz }, (_, iz) => fill_fn(ix, iy, iz)),
      ),
  )

const uniform_grid = (nx: number, ny: number, nz: number, value: number): number[][][] =>
  make_grid(nx, ny, nz, () => value)

// Gaussian blob centered in grid, values ~0 at edges to ~1 at center
const gaussian_grid = (size: number): number[][][] => {
  const center = (size - 1) / 2
  const sigma = size / 4
  return make_grid(size, size, size, (ix, iy, iz) => {
    const [dx, dy, dz] = [ix - center, iy - center, iz - center]
    return Math.exp(-(dx * dx + dy * dy + dz * dz) / (2 * sigma * sigma))
  })
}

// === marching_cubes ===

describe(`marching_cubes`, () => {
  test.each([
    { nx: 1, ny: 1, nz: 1 },
    { nx: 1, ny: 3, nz: 3 },
    { nx: 3, ny: 1, nz: 3 },
    { nx: 3, ny: 3, nz: 1 },
    { nx: 0, ny: 0, nz: 0 },
  ])(
    `returns empty result for grid smaller than 2x2x2: $nx×$ny×$nz`,
    ({ nx, ny, nz }) => {
      const grid = uniform_grid(Math.max(nx, 1), Math.max(ny, 1), Math.max(nz, 1), 1.0)
        .slice(0, nx)
      const result = marching_cubes(grid, 0.5, IDENTITY)
      expect(result.vertices).toHaveLength(0)
      expect(result.faces).toHaveLength(0)
      expect(result.normals).toHaveLength(0)
    },
  )

  test.each([
    { iso: 2.0, label: `above all values` },
    { iso: 0.5, label: `below all values` },
  ])(`returns empty result when isovalue $label`, ({ iso }) => {
    const result = marching_cubes(uniform_grid(4, 4, 4, 1.0), iso, IDENTITY)
    expect(result.faces).toHaveLength(0)
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
  })

  test(`centered=true shifts vertices relative to uncentered`, () => {
    const grid = gaussian_grid(8)
    const centered = marching_cubes(grid, 0.5, IDENTITY, {
      periodic: false,
      centered: true,
    })
    const uncentered = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)

    expect(centered.faces.length).toBe(uncentered.faces.length)
    // Centered vertices have lower mean position (shifted by -0.5)
    const mean_x = (verts: Vec3[]) => verts.reduce((s, v) => s + v[0], 0) / verts.length
    expect(mean_x(centered.vertices)).toBeLessThan(mean_x(uncentered.vertices))
  })

  test(`periodic=true wraps boundaries and produces more faces`, () => {
    const grid = make_grid(4, 4, 4, (ix, iy, iz) => {
      // High at origin and opposite corner, low in middle
      return (ix === 0 && iy === 0 && iz === 0) || (ix === 3 && iy === 3 && iz === 3)
        ? 2.0
        : 0.0
    })
    const periodic = marching_cubes(grid, 1.0, IDENTITY, {
      periodic: true,
      centered: false,
    })
    const non_periodic = marching_cubes(grid, 1.0, IDENTITY, NON_PERIODIC)
    expect(periodic.faces.length).toBeGreaterThanOrEqual(non_periodic.faces.length)
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
    expect(no_interp.faces.length).toBe(interp.faces.length)
    // Non-linear gradient means interpolated positions differ from midpoints
    const any_different = no_interp.vertices.some((vert, idx) =>
      Math.abs(vert[0] - interp.vertices[idx][0]) > 1e-6
    )
    expect(any_different).toBe(true)
  })

  test(`lattice transformation scales vertices`, () => {
    const grid = gaussian_grid(6)
    const scaled_lattice: Matrix3x3 = [[10, 0, 0], [0, 10, 0], [0, 0, 10]]
    const unit = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
    const scaled = marching_cubes(grid, 0.5, scaled_lattice, NON_PERIODIC)

    expect(scaled.vertices.length).toBe(unit.vertices.length)
    // Guard: unit result has non-zero y-coordinates
    expect(unit.vertices.some((v) => Math.abs(v[1]) > 1e-6)).toBe(true)
    // Scaled vertices should be 10x unit vertices
    for (let idx = 0; idx < unit.vertices.length; idx++) {
      for (let dim = 0; dim < 3; dim++) {
        expect(scaled.vertices[idx][dim]).toBeCloseTo(unit.vertices[idx][dim] * 10, 5)
      }
    }
  })

  test(`non-orthogonal lattice transforms vertices differently from identity`, () => {
    const grid = gaussian_grid(6)
    const sheared: Matrix3x3 = [[1, 0, 0], [0.5, 0.866, 0], [0, 0, 1]]
    const result = marching_cubes(grid, 0.5, sheared, NON_PERIODIC)
    const identity = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)

    expect(result.vertices.length).toBeGreaterThan(0)
    const any_different = result.vertices.some((v, idx) =>
      Math.abs(v[1] - identity.vertices[idx][1]) > 1e-6
    )
    expect(any_different).toBe(true)
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
  test(`xy-plane triangle produces z-direction unit normals`, () => {
    const vertices: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    const normals = compute_vertex_normals(vertices, [[0, 1, 2]])

    expect(normals).toHaveLength(3)
    for (const normal of normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1.0, 5)
      expect(Math.abs(normal[2])).toBeCloseTo(1.0, 5)
    }
  })

  test(`returns empty array for empty inputs`, () => {
    expect(compute_vertex_normals([], [])).toHaveLength(0)
  })

  test.each([
    { face: [0, 1], label: `fewer than 3 indices` },
    { face: [0, 1, 99], label: `out-of-bounds index` },
    { face: [-1, 1, 2], label: `negative index` },
  ])(`skips invalid faces: $label`, ({ face }) => {
    const vertices: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    const normals = compute_vertex_normals(vertices, [face])
    // All normals remain at zero (face was skipped)
    for (const normal of normals) {
      expect(Math.hypot(...normal)).toBe(0)
    }
  })

  test(`handles quad faces via fan triangulation`, () => {
    const vertices: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]
    const normals = compute_vertex_normals(vertices, [[0, 1, 2, 3]])

    expect(normals).toHaveLength(4)
    for (const normal of normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1.0, 5)
      expect(Math.abs(normal[2])).toBeCloseTo(1.0, 5)
    }
  })

  test(`averages normals from shared vertices`, () => {
    // Two triangles meeting at 90° sharing edge (0-1)
    const vertices: Vec3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]]
    const normals = compute_vertex_normals(vertices, [[0, 1, 2], [0, 1, 3]])

    // Shared vertex 0: averaged normal has both y and z components
    const shared = normals[0]
    expect(Math.hypot(...shared)).toBeCloseTo(1.0, 5)
    expect(Math.abs(shared[1])).toBeGreaterThan(0.1)
    expect(Math.abs(shared[2])).toBeGreaterThan(0.1)
  })
})
