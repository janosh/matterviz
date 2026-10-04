// Tests for the marching cubes algorithm and vertex normal computation
import {
  compute_vertex_normals,
  marching_cubes as marching_cubes_buffers,
} from '#lib/marching-cubes.js'
import type { ScalarGrid3D, ScalarGridArray, ScalarGridOrder } from '#lib/marching-cubes.js'
import { flatten_grid } from '#lib/isosurface/grid.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import { add, create_frac_to_cart, cross_3d, dot, subtract } from '#lib/math.js'
import { describe, expect, test } from 'vitest'
import { cubic_matrix, make_grid } from './test-fixtures'

const IDENTITY = cubic_matrix(1)
const NON_PERIODIC = { periodic: false }
const PERIODIC = { periodic: true }

const unpack_vec3 = (values: ArrayLike<number>): Vec3[] =>
  Array.from({ length: values.length / 3 }, (_, idx) => [
    values[3 * idx],
    values[3 * idx + 1],
    values[3 * idx + 2],
  ])

// Test-side object view of the typed-array result: nested grids are flattened, positions
// and normals unpacked to Vec3 and the index to triangles, so expectations read naturally
const marching_cubes = (
  grid: number[][][] | ScalarGrid3D,
  isovalue: number,
  lattice: Matrix3x3,
  options: Parameters<typeof marching_cubes_buffers>[3] = {},
) => {
  const raw = marching_cubes_buffers(
    Array.isArray(grid) ? flatten_grid(grid) : grid,
    isovalue,
    lattice,
    options,
  )
  return {
    vertices: unpack_vec3(raw.positions),
    faces: unpack_vec3(raw.indices),
    normals: unpack_vec3(raw.normals),
  }
}

const gaussian_grid = (size: number): number[][][] => {
  const center = (size - 1) / 2
  const sigma = size / 4
  return make_grid(size, size, size, (idx_x, idx_y, idx_z) => {
    const [delta_x, delta_y, delta_z] = [idx_x - center, idx_y - center, idx_z - center]
    return Math.exp(
      -(delta_x * delta_x + delta_y * delta_y + delta_z * delta_z) / (2 * sigma * sigma),
    )
  })
}

const expect_array_close = (actual: ArrayLike<number>, expected: number[]): void => {
  expect(actual).toHaveLength(expected.length)
  for (let idx = 0; idx < actual.length; idx++) {
    expect(actual[idx]).toBeCloseTo(expected[idx], 6)
  }
}

const indexed_grid = (size_x: number, size_y: number, size_z: number): number[][][] =>
  make_grid(size_x, size_y, size_z, (x_idx, y_idx, z_idx) => 100 * x_idx + 10 * y_idx + z_idx)

const as_scalar_grid = (
  grid: number[][][],
  order: ScalarGridOrder,
  precision: `f32` | `f64` = `f64`,
): ScalarGrid3D => {
  const dimensions: Vec3 = [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0]
  const [size_x, size_y, size_z] = dimensions
  const data: ScalarGridArray =
    precision === `f32`
      ? new Float32Array(size_x * size_y * size_z)
      : new Float64Array(size_x * size_y * size_z)
  for (let idx_x = 0; idx_x < size_x; idx_x++) {
    for (let idx_y = 0; idx_y < size_y; idx_y++) {
      for (let idx_z = 0; idx_z < size_z; idx_z++) {
        const offset =
          order === `x_fastest`
            ? idx_x + size_x * (idx_y + size_y * idx_z)
            : idx_z + size_z * (idx_y + size_y * idx_x)
        data[offset] = grid[idx_x][idx_y][idx_z]
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
  // A zero or singleton axis leaves no cells; a constant grid has no crossing
  test.each([
    [[0, 0, 0], 0.5],
    [[0, 3, 3], 0.5],
    [[1, 1, 1], 0.5],
    [[1, 3, 3], 0.5],
    [[3, 0, 3], 0.5],
    [[3, 1, 3], 0.5],
    [[3, 3, 0], 0.5],
    [[3, 3, 1], 0.5],
    [[4, 4, 4], 2],
    [[4, 4, 4], 0.5],
  ] as [Vec3, number][])(`dims %j at isovalue %s give empty geometry`, (dims, isovalue) => {
    const values = new Float64Array(dims[0] * dims[1] * dims[2]).fill(1)
    const buffers = marching_cubes_buffers(
      { values, dims, order: `z_fastest` },
      isovalue,
      IDENTITY,
    )
    expect(
      [buffers.positions, buffers.indices, buffers.normals].map(({ length }) => length),
    ).toEqual([0, 0, 0])
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

  // Flat x- and z-fastest grids of either precision contour exactly like the nested grid,
  // without mutating their values, open or periodically wrapped
  test.each([false, true])(
    `ScalarGrid3D orders and precisions match nested grids (periodic=%s)`,
    (periodic) => {
      const min_frac = (idx: number, size: number) => Math.min(idx / size, 1 - idx / size)
      const grid = make_grid(5, 4, 6, (idx_x, idx_y, idx_z) => {
        const radius =
          min_frac(idx_x, 5) ** 2 + min_frac(idx_y, 4) ** 2 + min_frac(idx_z, 6) ** 2
        return Math.exp(-radius / 0.04)
      })
      const expected = marching_cubes(grid, 0.35, IDENTITY, { periodic })
      expect(expected.faces.length).toBeGreaterThan(0)
      for (const order of [`x_fastest`, `z_fastest`] as const) {
        for (const precision of [`f32`, `f64`] as const) {
          const scalar_grid = as_scalar_grid(grid, order, precision)
          const orig_values = scalar_grid.values.slice()
          expect_result_parity(
            marching_cubes(scalar_grid, 0.35, IDENTITY, { periodic }),
            expected,
          )
          expect(scalar_grid.values).toEqual(orig_values)
        }
      }
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
    [`obsolete field names`, { data, dimensions, order }, TypeError],
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
    [`nested arrays (callers flatten first)`, gaussian_grid(3), TypeError],
  ] satisfies [string, unknown, ErrorConstructor][])(
    `ScalarGrid3D rejects %s`,
    (_label, grid, error) => {
      expect(() => marching_cubes_buffers(grid as ScalarGrid3D, 0.5, IDENTITY)).toThrow(error)
    },
  )

  test(`position_offset translates buffer vertices and is skipped when unset`, () => {
    const grid = flatten_grid(gaussian_grid(6))
    const offset: Vec3 = [1.5, -2, 0.25]
    const options = { ...NON_PERIODIC, normals: false }
    const base = marching_cubes_buffers(grid, 0.5, IDENTITY, options)
    const shifted = marching_cubes_buffers(grid, 0.5, IDENTITY, {
      ...options,
      position_offset: offset,
    })
    expect(shifted.indices).toEqual(base.indices)
    expect_array_close(
      shifted.positions,
      Array.from(base.positions, (coord, idx) => coord + offset[idx % 3]),
    )
  })

  test(`periodic wraps boundaries without cell-spanning triangles`, () => {
    const corner_grid = make_grid(4, 4, 4, (idx_x, idx_y, idx_z) =>
      (idx_x === 0 && idx_y === 0 && idx_z === 0) ||
      (idx_x === 3 && idx_y === 3 && idx_z === 3)
        ? 2
        : 0,
    )
    expect(
      marching_cubes(corner_grid, 1, IDENTITY, PERIODIC).faces.length,
    ).toBeGreaterThanOrEqual(
      marching_cubes(corner_grid, 1, IDENTITY, NON_PERIODIC).faces.length,
    )

    // Gaussian at frac (0,0,0): regression for edge-cache keys merging opposite faces
    const min_frac = (idx: number) => Math.min(idx / 8, 1 - idx / 8)
    const wrap_grid = make_grid(8, 8, 8, (idx_x, idx_y, idx_z) =>
      Math.exp(-(min_frac(idx_x) ** 2 + min_frac(idx_y) ** 2 + min_frac(idx_z) ** 2) / 0.045),
    )
    const { vertices, faces } = marching_cubes(wrap_grid, 0.3, IDENTITY, PERIODIC)
    expect(faces.length).toBeGreaterThan(0)
    const edge_len = (idx_a: number, idx_b: number) =>
      Math.hypot(...vertices[idx_a].map((coord, axis) => coord - vertices[idx_b][axis]))
    const max_edge = Math.max(
      ...faces.flatMap(([idx_a, idx_b, idx_c]) => [
        edge_len(idx_a, idx_b),
        edge_len(idx_b, idx_c),
        edge_len(idx_c, idx_a),
      ]),
    )
    expect(max_edge).toBeLessThan(0.5)
  })

  // value = ix², iso 2 crosses the x-edge between ix=1 (1) and ix=2 (4) at frac 1/3, and
  // vertices stay inside the cell spanned from the origin
  test.each([1, 2])(
    `edge vertices sit at the linearly interpolated crossing (scale=%d)`,
    (scale) => {
      const grid = make_grid(4, 4, 4, (idx_x) => idx_x * idx_x)
      const { vertices } = marching_cubes(grid, 2, cubic_matrix(scale), NON_PERIODIC)
      expect(vertices.length).toBeGreaterThan(0)
      for (const vertex of vertices) {
        expect(vertex[0]).toBeCloseTo((scale * (1 + 1 / 3)) / 3, 6)
        for (const coord of vertex) {
          expect(coord).toBeGreaterThanOrEqual(0)
          expect(coord).toBeLessThanOrEqual(scale + 1e-6)
        }
      }
    },
  )

  // With a unit lattice, vertices are fractional coordinates; any lattice maps them as frac·L
  test.each([
    [`uniform scale 10×`, cubic_matrix(10)],
    [
      `shear`,
      [
        [1, 0, 0],
        [0.5, 0.866, 0],
        [0, 0, 1],
      ],
    ],
  ] as [string, Matrix3x3][])(`lattice %s transforms vertices`, (_label, lattice) => {
    const grid = gaussian_grid(6)
    const unit = marching_cubes(grid, 0.5, IDENTITY, NON_PERIODIC)
    const out = marching_cubes(grid, 0.5, lattice, NON_PERIODIC)
    expect(out.faces).toEqual(unit.faces)
    const frac_to_cart = create_frac_to_cart(lattice)
    expect_array_close(
      out.vertices.flat(),
      unit.vertices.flatMap((vertex) => frac_to_cart(vertex)),
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
      grid: Array.from({ length: 4 }, (_, idx_x) =>
        Array.from({ length: 5 }, () => Array.from({ length: 6 }, () => idx_x)),
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
      grid: Array.from({ length: 3 }, (_unused_coord_x, idx_x) =>
        Array.from({ length: 5 }, (_unused_coord_y, idx_y) =>
          Array.from({ length: 4 }, () => idx_x / 2 + idx_y / 4),
        ),
      ),
      iso: 0.75,
      check: ([coord_x, coord_y, coord_z]: Vec3) => {
        expect(Math.abs(coord_x)).toBeCloseTo(Math.SQRT1_2, 5)
        expect(Math.abs(coord_y)).toBeCloseTo(Math.SQRT1_2, 5)
        expect(coord_z).toBeCloseTo(0, 5)
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
      const grid = Array.from({ length: 4 }, (_unused_coord_x, idx_x) =>
        Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => idx_x)),
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
      const mean_x = (resolution: number) => {
        const { normals: resolution_normals } = marching_cubes(
          Array.from({ length: resolution }, (_unused_coord_x, idx_x) =>
            Array.from({ length: 2 * resolution }, () =>
              Array.from({ length: 2 * resolution }, () => idx_x / (resolution - 1)),
            ),
          ),
          0.5,
          singular_lattice,
          { ...NON_PERIODIC, normals: true },
        )
        return (
          resolution_normals.reduce((sum, normal) => sum + normal[0], 0) /
          resolution_normals.length
        )
      }
      expect(mean_x(4)).toBeCloseTo(mean_x(8), 2)
    },
  )

  // Analytic sphere: value = distance from the grid center, iso = radius in grid units.
  // Values grow outward, so front faces (CCW) and normals point inward, also on a left-handed
  // lattice (which mirrors the winding)
  const left_handed: Matrix3x3 = [
    [0, 10, 0],
    [10, 0, 0],
    [0, 0, 10],
  ]
  test.each([
    [`right`, cubic_matrix(10)],
    [`left`, left_handed],
  ] as const)(
    `analytic sphere (%s-handed): closed mesh, area within 0.5% of 4πr², normals radial and consistent with winding`,
    (_hand, lattice) => {
      const size = 40
      const center = (size - 1) / 2
      const radius_idx = 14
      const grid = make_grid(size, size, size, (idx_x, idx_y, idx_z) =>
        Math.hypot(idx_x - center, idx_y - center, idx_z - center),
      )
      const spacing = 10 / (size - 1)
      const radius = radius_idx * spacing
      const { vertices, faces, normals } = marching_cubes(
        grid,
        radius_idx,
        lattice,
        NON_PERIODIC,
      )

      // Closed genus-0 triangle mesh: V - E + F = 2 with E = 3F/2, so F = 2V - 4
      expect(vertices.length).toBeGreaterThan(1000)
      expect(faces).toHaveLength(2 * vertices.length - 4)

      let area = 0
      let max_normal_error_deg = 0
      for (const [idx_0, idx_1, idx_2] of faces) {
        const [vert_a, vert_b, vert_c] = [vertices[idx_0], vertices[idx_1], vertices[idx_2]]
        const face_normal = cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a))
        area += 0.5 * Math.hypot(...face_normal)
        // Front face (CCW winding) must agree with the gradient normals at its corners
        const corner_normal_sum = add(normals[idx_0], normals[idx_1], normals[idx_2])
        expect(dot(face_normal, corner_normal_sum)).toBeGreaterThan(0)
      }
      expect(area / (4 * Math.PI * radius ** 2)).toBeCloseTo(1, 2)

      const sphere_center = center * spacing
      for (let idx = 0; idx < vertices.length; idx++) {
        const radial = vertices[idx].map((coord) => coord - sphere_center) as Vec3
        const cos_angle = -dot(radial, normals[idx]) / Math.hypot(...radial)
        max_normal_error_deg = Math.max(
          max_normal_error_deg,
          (Math.acos(Math.min(1, cos_angle)) * 180) / Math.PI,
        )
      }
      // Edge-interpolated gradients: measured 0.03°; lower-endpoint-only gradients gave 2.6°
      expect(max_normal_error_deg).toBeLessThan(0.1)
    },
  )
})

describe(`compute_vertex_normals`, () => {
  const xy_triangle = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const xy_quad = new Float32Array([...xy_triangle, 1, 1, 0])

  test.each([
    { label: `xy-plane triangle`, positions: xy_triangle, indices: [0, 1, 2] },
    { label: `quad as two triangles`, positions: xy_quad, indices: [0, 1, 3, 0, 3, 2] },
  ])(`$label produces positive z-direction unit normals`, ({ positions, indices }) => {
    const normals = unpack_vec3(compute_vertex_normals(positions, Uint32Array.from(indices)))
    expect(normals).toHaveLength(positions.length / 3)
    for (const normal of normals) {
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5)
      expect(normal[2]).toBeCloseTo(1, 5)
    }
  })

  test(`empty mesh yields no normals and out-of-range indices throw`, () => {
    expect(compute_vertex_normals(new Float32Array(0), new Uint32Array(0))).toHaveLength(0)
    expect(() => compute_vertex_normals(xy_triangle, Uint32Array.from([0, 1, 99]))).toThrow(
      RangeError,
    )
  })

  test(`averages normals from shared vertices`, () => {
    const normals = unpack_vec3(
      compute_vertex_normals(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
        Uint32Array.from([0, 1, 2, 0, 1, 3]),
      ),
    )
    // face normals are +z (tri 0) and -y (tri 1); vertices 0 and 1 sit on both faces so their
    // normal is the normalized sum, vertices 2 and 3 each keep their single face normal
    const shared = [0, -Math.SQRT1_2, Math.SQRT1_2]
    expect(normals).toEqual(
      [shared, shared, [0, 0, 1], [0, -1, 0]].map((vec) =>
        vec.map((val) => expect.closeTo(val, 6)),
      ),
    )
  })
})
