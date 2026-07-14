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

const mean_axis = (verts: Vec3[], axis: 0 | 1 | 2): number =>
  verts.reduce((sum, vertex) => sum + vertex[axis], 0) / verts.length

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

  test(`Gaussian blob: topology, normals, caching, isovalue, buffers`, () => {
    const grid = gaussian_grid(8)
    const result = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
    expect(result.vertices.length).toBeGreaterThan(0)
    expect(result.faces.length).toBeGreaterThan(0)
    expect(result.normals).toHaveLength(result.vertices.length)
    for (const face of result.faces) {
      expect(face).toHaveLength(3)
      expect(new Set(face).size).toBe(3)
      for (const idx of face) {
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(result.vertices.length)
      }
    }
    for (const normal of result.normals) expect(Math.hypot(...normal)).toBeCloseTo(1, 3)
    expect(result.vertices.length).toBeLessThan(result.faces.length * 3)
    expect(
      new Set(
        result.vertices.map((vertex) => vertex.map((coord) => coord.toFixed(12)).join(`,`)),
      ).size,
    ).toBe(result.vertices.length)
    expect(marching_cubes(grid, 0.7, IDENTITY, NON_PERIODIC).faces.length).toBeLessThanOrEqual(
      result.faces.length,
    )

    const buffers = marching_cubes_buffers(grid, 0.5, IDENTITY, {
      ...NON_PERIODIC,
      normals: true,
    })
    expect(Array.from(buffers.indices)).toEqual(result.faces.flat())
    expect_array_close(buffers.positions, result.vertices.flat())
    expect_array_close(buffers.normals, result.normals.flat())
  })

  test(`centered=true shifts vertices relative to uncentered`, () => {
    const grid = gaussian_grid(8)
    const centered = marching_cubes(grid, 0.5, IDENTITY, { ...NON_PERIODIC, centered: true })
    const uncentered = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
    expect(centered.faces).toHaveLength(uncentered.faces.length)
    expect(mean_axis(centered.vertices, 0)).toBeLessThan(mean_axis(uncentered.vertices, 0))
  })

  test(`periodic wraps boundaries without cell-spanning triangles`, () => {
    const corner_grid = make_grid(4, 4, 4, (ix, iy, iz) =>
      (ix === 0 && iy === 0 && iz === 0) || (ix === 3 && iy === 3 && iz === 3) ? 2 : 0,
    )
    expect(
      marching_cubes(corner_grid, 1, IDENTITY, PERIODIC).faces.length,
    ).toBeGreaterThanOrEqual(
      marching_cubes(corner_grid, 1, IDENTITY, NON_PERIODIC).faces.length,
    )

    // Gaussian at frac (0,0,0): regression for edge-cache keys merging opposite faces
    const min_frac = (idx: number) => Math.min(idx / 8, 1 - idx / 8)
    const wrap_grid = make_grid(8, 8, 8, (ix, iy, iz) =>
      Math.exp(-(min_frac(ix) ** 2 + min_frac(iy) ** 2 + min_frac(iz) ** 2) / 0.045),
    )
    const { vertices, faces } = marching_cubes(wrap_grid, 0.3, IDENTITY, PERIODIC)
    expect(faces.length).toBeGreaterThan(0)
    const edge_len = (idx_a: number, idx_b: number) =>
      Math.hypot(...vertices[idx_a].map((coord, axis) => coord - vertices[idx_b][axis]))
    const max_edge = Math.max(
      ...faces.flatMap(([a, b, c]) => [edge_len(a, b), edge_len(b, c), edge_len(c, a)]),
    )
    expect(max_edge).toBeLessThan(0.5)
  })

  test(`interpolate=false places vertices differently than interpolated`, () => {
    const grid = make_grid(4, 4, 4, (ix) => ix * ix)
    const interp = marching_cubes(grid, 2, IDENTITY, { ...NON_PERIODIC, interpolate: true })
    const no_interp = marching_cubes(grid, 2, IDENTITY, {
      ...NON_PERIODIC,
      interpolate: false,
    })
    expect(no_interp.vertices.length).toBeGreaterThan(0)
    expect(no_interp.faces).toHaveLength(interp.faces.length)
    expect(
      no_interp.vertices.some(
        (vertex, idx) => Math.abs(vertex[0] - interp.vertices[idx][0]) > 1e-6,
      ),
    ).toBe(true)
  })

  test.each([
    {
      label: `uniform scale 10×`,
      lattice: cubic_matrix(10),
      assert: (
        unit: ReturnType<typeof marching_cubes>,
        out: ReturnType<typeof marching_cubes>,
      ) => {
        expect(out.vertices).toHaveLength(unit.vertices.length)
        expect(unit.vertices.some((vertex) => Math.abs(vertex[1]) > 1e-6)).toBe(true)
        for (let idx = 0; idx < unit.vertices.length; idx++) {
          for (let dim = 0; dim < 3; dim++) {
            expect(out.vertices[idx][dim]).toBeCloseTo(unit.vertices[idx][dim] * 10, 5)
          }
        }
      },
    },
    {
      label: `shear`,
      lattice: [
        [1, 0, 0],
        [0.5, 0.866, 0],
        [0, 0, 1],
      ] as Matrix3x3,
      assert: (
        unit: ReturnType<typeof marching_cubes>,
        out: ReturnType<typeof marching_cubes>,
      ) => {
        expect(out.vertices.length).toBeGreaterThan(0)
        expect(
          out.vertices.some(
            (vertex, idx) => Math.abs(vertex[1] - unit.vertices[idx][1]) > 1e-6,
          ),
        ).toBe(true)
      },
    },
  ])(`lattice $label transforms vertices`, ({ lattice, assert }) => {
    const grid = gaussian_grid(6)
    assert(
      marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC),
      marching_cubes(grid, 0.5, lattice, NON_PERIODIC),
    )
  })

  test.each([
    {
      label: `skewed constant-x surface`,
      lattice: [
        [1, 0, 0],
        [0.5, Math.sqrt(3) / 2, 0],
        [0, 0, 1],
      ] as Matrix3x3,
      grid: Array.from({ length: 4 }, (_, ix) =>
        Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => ix)),
      ),
      iso: 1.5,
      check: (normal: Vec3, lattice: Matrix3x3) => {
        expect(normal[0]).toBeLessThan(0)
        expect(normal[0] * lattice[1][0] + normal[1] * lattice[1][1]).toBeCloseTo(0, 6)
        expect(normal[2]).toBeCloseTo(0, 6)
        expect(Math.hypot(...normal)).toBeCloseTo(1, 6)
      },
    },
    {
      label: `unequal grid spacing`,
      lattice: IDENTITY,
      grid: Array.from({ length: 3 }, (_x, ix) =>
        Array.from({ length: 5 }, (_y, iy) =>
          Array.from({ length: 4 }, () => ix / 2 + iy / 4),
        ),
      ),
      iso: 0.75,
      check: ([x, y, z]: Vec3) => {
        expect(Math.abs(x)).toBeCloseTo(Math.SQRT1_2, 5)
        expect(Math.abs(y)).toBeCloseTo(Math.SQRT1_2, 5)
        expect(z).toBeCloseTo(0, 5)
      },
    },
  ])(`normals: $label`, ({ lattice, grid, iso, check }) => {
    const { normals } = marching_cubes(grid, iso, lattice, NON_PERIODIC)
    expect(normals.length).toBeGreaterThan(0)
    for (const normal of normals) check(normal, lattice)
  })

  test.each([false, true])(
    `singular lattice still extracts mesh when normals=%s`,
    (normals) => {
      const singular_lattice: Matrix3x3 = [
        [1, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
      ]
      const grid = Array.from({ length: 4 }, (_x, ix) =>
        Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ix)),
      )
      const result = marching_cubes(grid, 1.5, singular_lattice, {
        ...NON_PERIODIC,
        normals,
      })
      expect(result.vertices.length).toBeGreaterThan(0)
      expect(result.faces.length).toBeGreaterThan(0)
      if (!normals) {
        expect(result.normals).toEqual([])
        return
      }
      expect(result.normals).toHaveLength(result.vertices.length)
      for (const normal of result.normals) expect(Math.hypot(...normal)).toBeCloseTo(1, 6)
      // Index-space gradient scaling: mean normal stable across anisotropic resolutions
      const mean_x = (n: number) => {
        const { normals: ns } = marching_cubes(
          Array.from({ length: n }, (_x, ix) =>
            Array.from({ length: 2 * n }, () =>
              Array.from({ length: 2 * n }, () => ix / (n - 1)),
            ),
          ),
          0.5,
          singular_lattice,
          { ...NON_PERIODIC, normals: true },
        )
        return ns.reduce((sum, normal) => sum + normal[0], 0) / ns.length
      }
      expect(mean_x(4)).toBeCloseTo(mean_x(8), 2)
    },
  )
})

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
    expect(compute_vertex_normals(vertices, faces)).toEqual(vertices.map(() => [0, 0, 0]))
  })

  test(`averages normals from shared vertices`, () => {
    const normals = compute_vertex_normals(
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      [
        [0, 1, 2],
        [0, 1, 3],
      ],
    )
    const shared = normals[0]
    expect(Math.hypot(...shared)).toBeCloseTo(1, 5)
    expect(Math.abs(shared[1])).toBeGreaterThan(0.1)
    expect(Math.abs(shared[2])).toBeGreaterThan(0.1)
  })
})
