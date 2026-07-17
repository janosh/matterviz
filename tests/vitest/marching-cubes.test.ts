// Tests for the marching cubes algorithm and vertex normal computation
import {
  compute_vertex_normals,
  marching_cubes,
  marching_cubes_buffers,
  type ScalarGrid3D,
  type ScalarGridArray,
  type ScalarGridOrder,
} from '$lib/marching-cubes'
import { flatten_grid } from '$lib/isosurface/grid'
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

const indexed_grid = (nx: number, ny: number, nz: number): number[][][] =>
  make_grid(nx, ny, nz, (x_idx, y_idx, z_idx) => 100 * x_idx + 10 * y_idx + z_idx)

const as_scalar_grid = (
  grid: number[][][],
  order: ScalarGridOrder,
  precision: `f32` | `f64` = `f64`,
): ScalarGrid3D => {
  const dimensions: Vec3 = [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0]
  const [nx, ny, nz] = dimensions
  const data: ScalarGridArray =
    precision === `f32` ? new Float32Array(nx * ny * nz) : new Float64Array(nx * ny * nz)
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const offset =
          order === `x_fastest` ? ix + nx * (iy + ny * iz) : iz + nz * (iy + ny * ix)
        data[offset] = grid[ix][iy][iz]
      }
    }
  }
  return { values: data, dims: dimensions, order }
}

const expect_result_parity = (
  actual: ReturnType<typeof marching_cubes>,
  expected: ReturnType<typeof marching_cubes>,
): void => {
  expect(actual.faces).toEqual(expected.faces)
  expect_array_close(actual.vertices.flat(), expected.vertices.flat())
  expect_array_close(actual.normals.flat(), expected.normals.flat())
}

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

  test(`flatten_grid returns canonical z-fastest marching-cubes input`, () => {
    const nested = indexed_grid(3, 2, 4)
    const flattened = flatten_grid(nested)
    expect(flattened).toEqual({
      values: new Float64Array([
        0, 1, 2, 3, 10, 11, 12, 13, 100, 101, 102, 103, 110, 111, 112, 113, 200, 201, 202, 203,
        210, 211, 212, 213,
      ]),
      dims: [3, 2, 4],
      order: `z_fastest`,
    })
  })

  test(`ScalarGrid3D x_fastest and z_fastest match nested grids`, () => {
    const grid = make_grid(5, 4, 6, (ix, iy, iz) => {
      const [dx, dy, dz] = [(ix - 2) / 2, (iy - 1.5) / 1.5, (iz - 2.5) / 2.5]
      return Math.exp(-(dx * dx + dy * dy + dz * dz))
    })
    const expected = marching_cubes(grid, 0.45, IDENTITY, NON_PERIODIC)
    expect(expected.faces.length).toBeGreaterThan(0)

    for (const [order, precision] of [
      [`x_fastest`, `f32`],
      [`x_fastest`, `f64`],
      [`z_fastest`, `f32`],
      [`z_fastest`, `f64`],
    ] as const) {
      const scalar_grid = as_scalar_grid(grid, order, precision)
      const original_values = scalar_grid.values.slice()
      expect_result_parity(marching_cubes(scalar_grid, 0.45, IDENTITY, NON_PERIODIC), expected)

      const buffers = marching_cubes_buffers(scalar_grid, 0.45, IDENTITY, {
        ...NON_PERIODIC,
        normals: true,
      })
      expect(Array.from(buffers.indices)).toEqual(expected.faces.flat())
      expect_array_close(buffers.positions, expected.vertices.flat())
      expect_array_close(buffers.normals, expected.normals.flat())
      expect(scalar_grid.values).toEqual(original_values)
    }
  })

  test(`ScalarGrid3D preserves periodic wrapped geometry`, () => {
    const min_frac = (idx: number, size: number) => Math.min(idx / size, 1 - idx / size)
    const grid = make_grid(5, 4, 6, (ix, iy, iz) => {
      const radius = min_frac(ix, 5) ** 2 + min_frac(iy, 4) ** 2 + min_frac(iz, 6) ** 2
      return Math.exp(-radius / 0.04)
    })
    const expected = marching_cubes(grid, 0.35, IDENTITY, PERIODIC)
    expect(expected.faces.length).toBeGreaterThan(0)

    for (const [order, precision] of [
      [`x_fastest`, `f32`],
      [`z_fastest`, `f64`],
    ] as const) {
      expect_result_parity(
        marching_cubes(as_scalar_grid(grid, order, precision), 0.35, IDENTITY, PERIODIC),
        expected,
      )
    }
  })

  test.each([
    { dimensions: [0, 0, 0] as Vec3 },
    { dimensions: [0, 3, 3] as Vec3 },
    { dimensions: [1, 3, 3] as Vec3 },
    { dimensions: [3, 0, 3] as Vec3 },
    { dimensions: [3, 1, 3] as Vec3 },
    { dimensions: [3, 3, 0] as Vec3 },
    { dimensions: [3, 3, 1] as Vec3 },
  ])(
    `ScalarGrid3D degenerate dimensions $dimensions return empty geometry`,
    ({ dimensions }) => {
      const grid: ScalarGrid3D = {
        values: new Float64Array(dimensions[0] * dimensions[1] * dimensions[2]),
        dims: dimensions,
        order: `z_fastest`,
      }
      const result = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
      expect([result.vertices, result.faces, result.normals]).toEqual([[], [], []])
      const buffers = marching_cubes_buffers(grid, 0.5, IDENTITY, NON_PERIODIC)
      expect([
        buffers.positions.length,
        buffers.indices.length,
        buffers.normals.length,
      ]).toEqual([0, 0, 0])
    },
  )

  const valid_scalar_grid = {
    values: new Float64Array(8),
    dims: [2, 2, 2],
    order: `z_fastest`,
  } satisfies ScalarGrid3D
  const { values: data, dims: dimensions, order } = valid_scalar_grid

  test.each([
    [
      `values length mismatch`,
      { ...valid_scalar_grid, values: new Float64Array(7) },
      RangeError,
    ],
    [`legacy field names`, { data, dimensions, order }, TypeError],
    [`negative dimension`, { ...valid_scalar_grid, dims: [-1, 2, 2] }, RangeError],
    [`fractional dimension`, { ...valid_scalar_grid, dims: [2, 2, 1.5] }, RangeError],
    [`missing dimension`, { ...valid_scalar_grid, dims: [2, 2] }, RangeError],
    [`extra dimension`, { ...valid_scalar_grid, dims: [2, 2, 2, 4] }, RangeError],
    [`unsupported order`, { ...valid_scalar_grid, order: `y_fastest` }, RangeError],
    [
      `unsupported typed array`,
      { ...valid_scalar_grid, values: new Int32Array(8) },
      TypeError,
    ],
  ] satisfies [string, unknown, ErrorConstructor][])(
    `ScalarGrid3D rejects %s`,
    (_label, grid, error) => {
      expect(() => marching_cubes(grid as ScalarGrid3D, 0.5, IDENTITY)).toThrow(error)
    },
  )

  test(`centered=true shifts vertices relative to uncentered`, () => {
    const grid = gaussian_grid(8)
    const centered = marching_cubes(grid, 0.5, IDENTITY, { ...NON_PERIODIC, centered: true })
    const uncentered = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
    expect(centered.faces).toHaveLength(uncentered.faces.length)
    expect(mean_axis(centered.vertices, 0)).toBeLessThan(mean_axis(uncentered.vertices, 0))
  })

  test(`position_offset translates buffer vertices and is skipped when unset`, () => {
    const grid = gaussian_grid(6)
    const offset: Vec3 = [1.5, -2, 0.25]
    const base = marching_cubes_buffers(grid, 0.5, IDENTITY, {
      ...NON_PERIODIC,
      normals: false,
    })
    const shifted = marching_cubes_buffers(grid, 0.5, IDENTITY, {
      ...NON_PERIODIC,
      normals: false,
      position_offset: offset,
    })
    expect(shifted.indices).toEqual(base.indices)
    expect(shifted.positions).toHaveLength(base.positions.length)
    for (let idx = 0; idx < base.positions.length; idx += 3) {
      expect(shifted.positions[idx]).toBeCloseTo(base.positions[idx] + offset[0], 6)
      expect(shifted.positions[idx + 1]).toBeCloseTo(base.positions[idx + 1] + offset[1], 6)
      expect(shifted.positions[idx + 2]).toBeCloseTo(base.positions[idx + 2] + offset[2], 6)
    }
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

  test.each([
    [1, 0.501],
    [2, 1.01],
  ])(
    `default centered=true keeps vertices within half-lattice bounds at scale=%d`,
    (scale, bound) => {
      const lattice: Matrix3x3 = [
        [scale, 0, 0],
        [0, scale, 0],
        [0, 0, scale],
      ]
      const grid = make_grid(4, 4, 4, (ix) => (ix / 3) * 2)
      const result = marching_cubes(grid, 1.0, lattice, { periodic: false })
      expect(result.vertices.length).toBeGreaterThan(0)
      for (const vert of result.vertices) {
        for (const coord of vert) expect(Math.abs(coord)).toBeLessThanOrEqual(bound)
      }
    },
  )

  test(`spherical isosurface has uniform vertex distance from centroid`, () => {
    const center = (10 - 1) / 2
    const grid = make_grid(
      10,
      10,
      10,
      (ix, iy, iz) => (ix - center) ** 2 + (iy - center) ** 2 + (iz - center) ** 2,
    )
    const { vertices } = marching_cubes(grid, 9, IDENTITY) // radius² = 9
    expect(vertices.length).toBeGreaterThan(10)
    const centroid = vertices
      .reduce((acc, vert) => [acc[0] + vert[0], acc[1] + vert[1], acc[2] + vert[2]], [0, 0, 0])
      .map((sum) => sum / vertices.length)
    const dists = vertices.map((vert) =>
      Math.hypot(vert[0] - centroid[0], vert[1] - centroid[1], vert[2] - centroid[2]),
    )
    const mean_dist = dists.reduce((sum, dist) => sum + dist, 0) / dists.length
    // All distances within 15% of the mean (tight for a sphere)
    for (const dist of dists) {
      expect(Math.abs(dist - mean_dist) / mean_dist).toBeLessThan(0.15)
    }
  })

  test.each([
    [3, 3, 3],
    [5, 4, 3],
  ])(`handles non-cubic grid %dx%dx%d`, (nx, ny, nz) => {
    const grid = make_grid(nx, ny, nz, (ix) => (ix / (nx - 1)) * 2)
    const result = marching_cubes(grid, 1.0, IDENTITY)
    expect(result.vertices.length).toBeGreaterThan(0)
    expect(result.faces.length).toBeGreaterThan(0)
  })
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
