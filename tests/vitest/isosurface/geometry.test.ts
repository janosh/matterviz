// Isosurface geometry extraction shared by the worker and the main-thread fallback, plus
// the create_worker_client wiring (happy-dom has no Worker, so a stub is installed before
// the client module is imported to exercise the real postMessage plumbing)
import type { compute_geometries_async as ComputeGeometriesAsync } from '#lib/isosurface/async-geometry.svelte'
import type { GeometryInput } from '#lib/isosurface/geometry'
import {
  compute_isosurface_geometries,
  geometry_result_transferables,
  MAX_SORTED_LOBES,
  split_lobes,
} from '#lib/isosurface/geometry'
import {
  create_volume_sampler,
  type DisplayRange,
  extract_volume_range,
  prepare_geometry_grid,
  resolve_volume_window,
  UNIT_CELL_RANGE,
} from '#lib/isosurface/sampling'
import { cubic_surface_volume } from '#lib/isosurface/spline'
import {
  make_volume as make_flat_volume,
  MAX_CUBIC_GRID_POINTS,
  MAX_GRID_POINTS,
  type VolumetricData,
} from '#lib/isosurface/types'
import { cross_3d, dot, IDENTITY_3X3, type Matrix3x3, subtract, type Vec3 } from '#lib/math'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vite-plus/test'
import { install_stub_worker } from '../setup'
import { draw_range_views } from '#lib/scene/geometry.svelte'
import { BufferAttribute, BufferGeometry } from 'three/webgpu'
import { cubic_matrix, make_grid, make_volume } from '../test-fixtures'

// Periodic Gaussian blob centred in a 10 A cubic cell
const blob_volume = (n_pts = 16) =>
  make_volume(
    make_grid(n_pts, n_pts, n_pts, (idx_x, idx_y, idx_z) => {
      const dist = (idx: number) =>
        Math.min(Math.abs(idx / n_pts - 0.5), 1 - Math.abs(idx / n_pts - 0.5))
      return Math.exp(-(dist(idx_x) ** 2 + dist(idx_y) ** 2 + dist(idx_z) ** 2) / 0.03)
    }),
    { lattice: cubic_matrix(10), periodic: true },
  )

const two_cells: DisplayRange = [
  [0, 2],
  [0, 1],
  [0, 1],
]
const blob_input = (
  volume = blob_volume(),
  surfaces = [
    { token: `0:1`, isovalue: 0.5 },
    { token: `1:1`, isovalue: 0.2 },
  ],
  range: DisplayRange | null = two_cells,
): GeometryInput => ({
  volumes: [{ ...prepare_geometry_grid(volume, range && { range }), surfaces }],
})

describe(`compute_isosurface_geometries`, () => {
  test(`extracts a display window and one mesh per isovalue in the scene frame`, () => {
    const volume = { ...blob_volume(), origin: [1, 2, 3] as Vec3 }
    const input = blob_input(volume)
    const [{ grid, lattice, origin, clip }] = input.volumes
    // the unit cell's source voxels, tiled over the window's 2 x 1 x 1 cells
    expect(grid.values).toBe(volume.values)
    expect([lattice, origin, clip?.cells]).toEqual([
      volume.lattice,
      volume.origin,
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
    ])
    const result = compute_isosurface_geometries(input)
    expect(result.surfaces.map((surface) => surface.token)).toEqual([`0:1`, `1:1`])

    const sample = create_volume_sampler(volume)
    for (const [surface_idx, surface] of result.surfaces.entries()) {
      const isovalue = [0.5, 0.2][surface_idx]
      expect(surface.positions.length).toBeGreaterThan(300)
      expect(surface.indices.length % 3).toBe(0)
      expect(Math.max(...surface.indices)).toBeLessThan(surface.positions.length / 3)
      // Sampling vertices directly in the structure frame recovers each isovalue.
      for (let vert = 0; vert < surface.positions.length; vert += 3 * 37) {
        const position = [...surface.positions.subarray(vert, vert + 3)] as Vec3
        expect(sample(position)).toBeCloseTo(isovalue, 4)
      }
    }
    // The lower isovalue encloses the higher one: more surface, never less
    expect(result.surfaces[1].positions.length).toBeGreaterThan(
      result.surfaces[0].positions.length,
    )
  })

  // periodic: marching cubes runs on the source voxels themselves in budget, else on a
  // resampled unit cell, tiled over the one cell of a windowless volume
  test.each([8, 81])(`no window, periodic %i³: the unit cell is tiled once`, (n_pts) => {
    const volume = blob_volume(n_pts)
    const { grid, lattice, clip } = prepare_geometry_grid(volume, null)
    expect([lattice, clip]).toEqual([
      volume.lattice,
      { frame: IDENTITY_3X3, range: UNIT_CELL_RANGE, cells: [[0, 0, 0]] },
    ])
    if (n_pts ** 3 <= MAX_GRID_POINTS)
      expect(grid).toEqual({ values: volume.values, dims: volume.dims, order: volume.order })
    else {
      expect(grid.dims).toEqual([79, 79, 79]) // ∛(500k / 81³) of 81 per axis
      expect(grid.values[0]).toBe(volume.values[0])
    }
  })

  test.each([false, true])(
    `cubic refinement reduces sphere facet error (periodic=%s)`,
    (periodic) => {
      const size = 13
      const intervals = periodic ? size : size - 1
      const radius = 0.3
      const volume = make_volume(
        make_grid(
          size,
          size,
          size,
          (...coords) =>
            0.5 - coords.reduce((sum, coord) => sum + (coord / intervals - 0.5) ** 2, 0),
        ),
        { lattice: cubic_matrix(1), periodic },
      )
      const refined = cubic_surface_volume(volume)
      expect(cubic_surface_volume(volume)).toBe(refined) // shared by all panes
      const count = periodic ? 2 * size : 2 * size - 1
      expect(refined.dims).toEqual([count, count, count])
      const [native, fine] = [volume, refined].map((source) => {
        const [{ positions, indices }] = compute_isosurface_geometries(
          blob_input(source, [{ token: `sphere`, isovalue: 0.5 - radius ** 2 }], null),
        ).surfaces
        let max_error = 0
        for (let tri = 0; tri < indices.length; tri += 3) {
          const corners = indices.subarray(tri, tri + 3)
          const centroid = [0, 1, 2].map(
            (axis) =>
              corners.reduce((sum, vert) => sum + positions[3 * vert + axis], 0) / 3 - 0.5,
          )
          max_error = Math.max(max_error, Math.abs(Math.hypot(...centroid) - radius))
        }
        return { triangles: indices.length / 3, max_error }
      })
      expect(fine.triangles).toBeGreaterThan(3 * native.triangles)
      expect(fine.max_error).toBeLessThan(native.max_error / 2)
    },
  )

  test(`focused finite meshes retain between-knot and boundary lobes in the original frame`, () => {
    const size = 53
    const values = new Float64Array(size ** 3)
    for (const [idx_x, value] of [
      [4, 0.84],
      [5, 0.84],
      [23, 1],
      [52, -1],
    ]) {
      values[(idx_x * size + 25) * size + 22] = value
    }
    const volume = make_flat_volume(values, [size, size, size], {
      id: `field`,
      origin: [2, -4, 9],
      lattice: [
        [52, 0, 0],
        [26, 52, 0],
        [0, 13, 52],
      ],
      periodic: false,
      units: null,
    })
    const fine = cubic_surface_volume(volume, 0.9)
    expect(fine.values.length).toBeLessThanOrEqual(MAX_CUBIC_GRID_POINTS)
    expect(fine.dims[0] - 1).toBe(fine.lattice[0][0] * 4) // four samples per native interval
    expect(fine.origin).not.toEqual(volume.origin)
    expect(cubic_surface_volume(volume, 0.901)).toBe(fine)
    // Interleaved levels A, B, A reuse A's grid, so one rebuild submits it once.
    const wider = cubic_surface_volume(volume, 0.3)
    expect(wider.dims).not.toEqual(fine.dims)
    expect(cubic_surface_volume(volume, 0.9)).toBe(fine)
    const sample = create_volume_sampler(fine)
    // The first lobe rises above 0.9 strictly between the two 0.84 native samples.
    const at_knot = (coord_x: number): Vec3 => [2 + coord_x + 25 / 2, -4 + 25 + 22 / 4, 9 + 22]
    expect(sample(at_knot(4.5))).toBeGreaterThan(0.9)
    for (const [coord, measured] of [
      [4, 0.84],
      [5, 0.84],
      [23, 1],
      [52, -1],
    ])
      expect(sample(at_knot(coord))).toBeCloseTo(measured, 12)
    const { surfaces } = compute_isosurface_geometries(
      blob_input(
        fine,
        [
          { token: `between knots and interior peak`, isovalue: 0.9 },
          { token: `boundary peak`, isovalue: -0.9 },
        ],
        null,
      ),
    )
    expect(surfaces[0].lobes?.offsets).toHaveLength(3) // two disconnected positive lobes
    expect(surfaces[1].indices.length).toBeGreaterThan(0)
    expect(cubic_surface_volume(volume, 0)).toBe(cubic_surface_volume(volume))
  })

  // Mirrors Isosurface.svelte's prepared_grid: a window keeps the original frame (level 0).
  const cubic_mesh = (volume: VolumetricData, isovalue: number, range?: DisplayRange) => {
    const window = range ? resolve_volume_window(volume, { display_range: range }) : null
    const source = cubic_surface_volume(volume, window ? 0 : Math.abs(isovalue))
    const prepared = prepare_geometry_grid(source, window, MAX_CUBIC_GRID_POINTS)
    const [surface] = compute_isosurface_geometries({
      volumes: [{ ...prepared, surfaces: [{ token: `level`, isovalue }] }],
    }).surfaces
    return { prepared, surface }
  }
  const unit_lattice = (scales: Vec3): Matrix3x3 => [
    [scales[0], 0, 0],
    [0, scales[1], 0],
    [0, 0, scales[2]],
  ]

  // A full [0, 1]³ display range forced the coarse 2× grid, which stepped over the
  // between-knot crossing the focused grid finds near x = 10.25.
  test.each([undefined, UNIT_CELL_RANGE])(`finite crossing kept with range=%j`, (range) => {
    const values = new Float64Array(33 * 4)
    for (const [idx_x, value] of [
      [10, 1],
      [11, 0.8],
      [28, 2],
    ])
      values.fill(value, idx_x * 4, idx_x * 4 + 4)
    const volume = make_flat_volume(values, [33, 2, 2], {
      id: `ridge`,
      origin: [0, 0, 0],
      lattice: unit_lattice([32, 1, 1]),
      periodic: false,
      units: null,
    })
    const { positions } = cubic_mesh(volume, 1.09, range).surface
    const near_ridge = positions.filter((coord, idx) => idx % 3 === 0 && coord < 15)
    expect(near_ridge.length).toBeGreaterThan(0)
    for (const coord of near_ridge) expect(Math.abs(coord - 10.29)).toBeLessThan(0.07)
  })

  // Clamping the z pass's 1.25 overshoot to the data max before refining x moved the nodal
  // surface: the x midpoint read (1 - 1.1) / 2 = -0.05 instead of (1.25 - 1.1) / 2 = 0.075.
  test(`cubic passes clamp only after the last spline pass`, () => {
    const lines = [
      [0, 1, 1, 0],
      [-1.1, -1.1, -1.1, -1.1],
    ]
    const values = Float64Array.from({ length: 16 }, (_, idx) => lines[idx >> 3][idx % 4])
    const volume = make_flat_volume(values, [2, 2, 4], {
      id: `nodal`,
      origin: [0, 0, 0],
      lattice: unit_lattice([1, 1, 30]), // widest z spacing: refined first
      periodic: false,
      units: null,
    })
    const fine = cubic_surface_volume(volume, 0)
    expect(fine.dims).toEqual([3, 3, 7])
    const sample = create_volume_sampler(fine)
    expect(sample([0, 0, 15])).toBe(1) // the final pass still clamps to the data range
    expect(sample([0.5, 0, 15])).toBeCloseTo(0.075, 12)
  })

  // Finite z-fastest field from a function of the native sample indices.
  const finite_field = (size: number, fn: (...coords: Vec3) => number, id = `field`) => {
    const values = new Float64Array(size ** 3)
    let idx = 0
    for (let idx_x = 0; idx_x < size; idx_x++)
      for (let idx_y = 0; idx_y < size; idx_y++)
        for (let idx_z = 0; idx_z < size; idx_z++) values[idx++] = fn(idx_x, idx_y, idx_z)
    return make_flat_volume(values, [size, size, size], {
      id,
      origin: [0, 0, 0],
      lattice: unit_lattice([1, 1, 1]),
      periodic: false,
      units: null,
    })
  }
  const time_ms = (fn: () => unknown): number => {
    const start = performance.now()
    fn()
    return performance.now() - start
  }

  // An over-budget finite source returned before focusing, so geometry preparation coarsened
  // x to 90 samples (max 0.438) and the 0.9 surface around the lone peak vanished.
  test(`over-budget finite source focuses on a lone peak`, () => {
    const volume = finite_field(101, (...coords) => Number(coords.every((idx) => idx === 50)))
    const { prepared, surface } = cubic_mesh(volume, 0.9)
    expect(prepared.grid.dims).toEqual([25, 25, 25]) // planes 47..53 at 4 samples per interval
    expect(Math.max(...prepared.grid.values)).toBe(1)
    expect(surface.indices.length).toBeGreaterThan(0)
  })

  // A focus whose native-sample crop already misses the budget must skip the whole-source
  // spline-coefficient pass, which costs ~10x a native plane scan.
  test(`failed focus on an over-budget source skips the coefficient scan`, () => {
    const size = 125
    const peak = finite_field(size, (...coords) => Number(coords.every((idx) => idx === 62)))
    const broad = finite_field(size, (...coords) =>
      Math.exp(-coords.reduce((sum, idx) => sum + (idx - 62) ** 2, 0) / 2000),
    )
    const focused_ms = time_ms(() => expect(cubic_surface_volume(peak, 0.9).dims[0]).toBe(25))
    const failed_ms = time_ms(() => expect(cubic_surface_volume(broad, 0.05)).toBe(broad))
    expect(failed_ms).toBeLessThan(focused_ms / 4)
  })

  // Focused grids are kept by total size: re-reading A makes B least recently used, so
  // adding C (913k + 531k + 754k > 2M points) evicts B rather than A.
  test(`focused grid cache evicts the least recently used grid`, () => {
    const volume = finite_field(51, (...coords) =>
      Math.exp(-coords.reduce((sum, idx) => sum + (idx - 25) ** 2, 0) / 50),
    )
    const [grid_a, grid_b] = [0.1, 0.2].map((level) => cubic_surface_volume(volume, level))
    expect([grid_a.dims, grid_b.dims]).toEqual([
      [97, 97, 97],
      [81, 81, 81],
    ])
    expect(cubic_surface_volume(volume, 0.1)).toBe(grid_a)
    const grid_c = cubic_surface_volume(volume, 0.02)
    expect(grid_c.dims).toEqual([91, 91, 91])
    expect(cubic_surface_volume(volume, 0.1)).toBe(grid_a)
    expect(cubic_surface_volume(volume, 0.02)).toBe(grid_c)
    const rebuilt_b = cubic_surface_volume(volume, 0.2)
    expect(rebuilt_b).not.toBe(grid_b)
    expect(rebuilt_b.values).toEqual(grid_b.values)
  })

  // Fractional resampling under the budget missed the native peak, erasing its entire surface.
  test.each([78, 80])(`budgeted cubic refinement keeps native peaks on %i³`, (size) => {
    const peak = 19
    const values = new Float64Array(size ** 3)
    values[(peak * size + peak) * size + peak] = 1
    const volume = make_flat_volume(values, [size, size, size], {
      id: `peak`,
      origin: [0, 0, 0],
      lattice: [
        [1, 0, 0],
        [0, 2, 0],
        [0, 0, 1],
      ],
      periodic: false,
      units: null,
    })
    const fine = cubic_surface_volume(volume)
    const rows = size === 78 ? size * 2 - 1 : size
    expect(fine.dims).toEqual([size, rows, size]) // split only the widest spacing if it fits
    expect(fine.values[(peak * rows + (size === 78 ? 2 : 1) * peak) * size + peak]).toBe(1)
    const prepared = prepare_geometry_grid(fine, null, MAX_CUBIC_GRID_POINTS)
    expect(prepared.grid.values).toBe(fine.values)
    const [{ indices }] = compute_isosurface_geometries({
      volumes: [{ ...prepared, surfaces: [{ token: `peak`, isovalue: 0.8 }] }],
    }).surfaces
    expect(indices).toHaveLength(24)
  })

  // Re-extracting a finite cell copied the whole grid and rescanned its range on every isovalue
  // change; with every axis >= 2 points that copy is exact, so the grid is reused instead
  test.each([
    { dims: [4, 5, 6] as Vec3, reused: true },
    { dims: [1, 5, 6] as Vec3, reused: false }, // a 1-point axis still resamples to 2 points
  ])(`no range on a finite $dims cell: reused=$reused`, ({ dims, reused }) => {
    const values = Float64Array.from({ length: dims[0] * dims[1] * dims[2] }, (_, idx) =>
      Math.sin(idx),
    )
    const volume = make_flat_volume(values, dims, {
      id: `density`,
      lattice: cubic_matrix(3),
      origin: [1, 2, 3],
      periodic: false,
      units: `e/A^3`,
    })
    const prepared = prepare_geometry_grid(volume, null)
    expect(prepared.grid.values === values).toBe(reused)
    const extracted = extract_volume_range(volume, UNIT_CELL_RANGE)
    expect(prepared.grid.values).toEqual(extracted.values)
    expect([prepared.grid.dims, prepared.lattice, prepared.origin]).toEqual([
      extracted.dims,
      extracted.lattice,
      extracted.origin,
    ])
  })

  // block averaging read output sample k at source fraction (s_k + e_k - 1)/2/(N - 1) while
  // marching cubes places it at k/(M - 1), moving an f = x_frac 0.3 isosurface in a 20 Å cell
  // from x = 6.000 Å to 5.900 Å with the atoms staying put
  test(`over budget: the resampled grid keeps its endpoints exact`, () => {
    const n_pts = 101
    const values = new Float64Array(n_pts ** 3)
    for (let idx_x = 0; idx_x < n_pts; idx_x++) {
      values.fill(idx_x / (n_pts - 1), idx_x * n_pts * n_pts, (idx_x + 1) * n_pts * n_pts)
    }
    const volume = make_flat_volume(values, [n_pts, n_pts, n_pts], {
      id: `density`,
      lattice: cubic_matrix(20),
      origin: [0, 0, 0],
      periodic: false,
      units: `e/A^3`,
    })
    const { grid, lattice, origin } = prepare_geometry_grid(volume, null)
    expect(grid.values.length).toBeLessThanOrEqual(MAX_GRID_POINTS)
    expect(lattice).toEqual(volume.lattice)
    expect(origin).toEqual(volume.origin)
    const [out_nx, out_ny, out_nz] = grid.dims
    for (const idx of [0, 1, out_nx >> 1, out_nx - 1]) {
      expect(grid.values[idx * out_ny * out_nz]).toBeCloseTo(idx / (out_nx - 1), 12)
    }
  })

  // Otherwise the transparent back-then-front pass draws negative lobes inside-out
  // a left-handed lattice mirrors the index-space winding marching cubes emits
  test.each([
    [1, 10],
    [-1, 10],
    [1, -10],
  ])(`lobe of sign %i, c = %i Å, gets outward-facing triangles`, (sign, lattice_c) => {
    const blob = blob_volume()
    // oxfmt-ignore
    const lattice: Matrix3x3 = [[10, 0, 0], [0, 10, 0], [0, 0, lattice_c]]
    const volume = { ...blob, lattice, values: blob.values.map((val) => sign * val) }
    const input = blob_input(volume, [{ token: `s`, isovalue: sign * 0.5 }], null)
    const [{ positions, indices }] = compute_isosurface_geometries(input).surfaces
    const vertex = (idx: number) => [...positions.subarray(3 * idx, 3 * idx + 3)] as Vec3
    expect(indices.length).toBeGreaterThan(300)
    for (let tri = 0; tri < indices.length; tri += 3) {
      const [vert_a, vert_b, vert_c] = [0, 1, 2].map((corner) => vertex(indices[tri + corner]))
      const normal = cross_3d(subtract(vert_b, vert_a), subtract(vert_c, vert_a))
      expect(dot(normal, subtract(vert_a, [5, 5, lattice_c / 2]))).toBeGreaterThan(0) // blob centre
    }
  })

  test(`transferables list every output buffer exactly once`, () => {
    const result = compute_isosurface_geometries(blob_input())
    const buffers = geometry_result_transferables(result)
    const expected = result.surfaces.flatMap(({ positions, indices, normals, lobes }) => [
      positions.buffer,
      indices.buffer,
      normals.buffer,
      ...(lobes ? [lobes.offsets.buffer, lobes.spheres.buffer] : []),
    ])
    // the two-cell window tiles each blob twice, so both surfaces split into two lobes
    expect(result.surfaces.map(({ lobes }) => lobes?.offsets.length)).toEqual([3, 3])
    expect(buffers).toHaveLength(expected.length)
    expect(new Set(buffers)).toEqual(new Set(expected))
  })

  test.each([1, -1])(
    `field-gradient normals of sign %i point out of the enclosed lobe and transfer`,
    (sign) => {
      const blob = blob_volume()
      const volume = { ...blob, values: blob.values.map((value) => value * sign) }
      const input = blob_input(volume, [{ token: `lobe`, isovalue: sign * 0.5 }], null)
      const result = compute_isosurface_geometries(input)
      const [{ positions, normals }] = result.surfaces
      expect(normals).toHaveLength(positions.length)
      expect(geometry_result_transferables(result)).toContain(normals.buffer)
      for (let idx = 0; idx < positions.length; idx += 3) {
        const radial = subtract(
          Array.from(positions.subarray(idx, idx + 3)) as Vec3,
          [5, 5, 5],
        )
        const normal = Array.from(normals.subarray(idx, idx + 3)) as Vec3
        expect(dot(radial, normal)).toBeGreaterThan(0)
      }
    },
  )

  test(`tiled copies reuse their unit-cell normals exactly`, () => {
    const input = blob_input(undefined, [{ token: `blob`, isovalue: 0.5 }])
    const [{ positions, normals }] = compute_isosurface_geometries(input).surfaces
    const normal_at = new Map<string, number[]>()
    const key = (x_coord: number, idx: number) =>
      [x_coord, positions[idx + 1], positions[idx + 2]].map((val) => val.toFixed(4)).join(',')
    for (let idx = 0; idx < positions.length; idx += 3)
      normal_at.set(key(positions[idx], idx), Array.from(normals.subarray(idx, idx + 3)))
    let n_pairs = 0
    for (let idx = 0; idx < positions.length; idx += 3) {
      const copy = positions[idx] < 10 && normal_at.get(key(positions[idx] + 10, idx))
      if (!copy) continue
      n_pairs++
      expect(copy).toEqual(Array.from(normals.subarray(idx, idx + 3)))
    }
    expect(n_pairs).toBeGreaterThan(100)
  })

  test.each([0.31, -0.31])(
    `field normals at %f survive clipping a tilted left-handed cell`,
    (isovalue) => {
      const lattice: Matrix3x3 = [
        [4, 0, 0],
        [1, 3, 0],
        [0.5, 0.3, -5],
      ]
      const origin: Vec3 = [0.6, -0.4, 1.1]
      const volume = make_volume(
        make_grid(12, 11, 10, (x) => Math.cos((2 * Math.PI * x) / 12)),
        { lattice, origin, periodic: true },
      )
      const input = blob_input(
        volume,
        [{ token: `plane`, isovalue }],
        [
          [-0.2, 1.4],
          [0.13, 0.89],
          [0.17, 0.79],
        ],
      )
      const [{ positions, normals }] = compute_isosurface_geometries(input).surfaces
      expect(positions.length).toBeGreaterThan(300)
      // A reciprocal vector without the 2π factor; its dot product with r is fractional x.
      const normal = cross_3d(lattice[1], lattice[2])
      const reciprocal = normal.map((comp) => comp / dot(lattice[0], normal)) as Vec3
      for (let idx = 0; idx < positions.length; idx += 3) {
        const rel = subtract(Array.from(positions.subarray(idx, idx + 3)) as Vec3, origin)
        const sign = Math.sign(isovalue * Math.sin(2 * Math.PI * dot(reciprocal, rel)))
        const vertex_normal = Array.from(normals.subarray(idx, idx + 3)) as Vec3
        const alignment = (sign * dot(reciprocal, vertex_normal)) / Math.hypot(...reciprocal)
        expect(alignment).toBeGreaterThan(0.9999)
      }
    },
  )
})

// === Worker client wiring ===
// Abort/teardown/dedupe rules of the shared client are tested in svelte-widgets
const stub = install_stub_worker<{ id: number; input: GeometryInput }>(({ input }) =>
  compute_isosurface_geometries(input),
)
let compute_geometries_async: typeof ComputeGeometriesAsync

beforeAll(async () => {
  ;({ compute_geometries_async } = await import(`#lib/isosurface/async-geometry.svelte`))
})
afterEach(stub.reset)

test(`compute_geometries_async posts the prepared grid and returns the worker result`, async () => {
  const volume = { ...blob_volume(), origin: [1, 2, 3] as Vec3 }
  const input = blob_input(volume)
  const [job] = input.volumes
  const result = await compute_geometries_async(input)
  expect(stub.posted).toHaveLength(1)
  const payload = stub.posted[0].message.input.volumes[0]
  // only the unit grid's values (in budget, the source's), not the whole volume object
  expect(payload.grid).toEqual({
    values: job.grid.values,
    dims: [16, 16, 16],
    order: `z_fastest`,
  })
  expect([payload.lattice, payload.origin]).toEqual([job.lattice, volume.origin])
  // Value buffers stay owned by the caller (copied, not transferred)
  expect(stub.posted[0].transfer).toEqual([])
  expect(job.grid.values).toHaveLength(16 ** 3)

  const sync = compute_isosurface_geometries(input)
  expect(result.surfaces[0].positions).toEqual(sync.surfaces[0].positions)
})

// === Lobe splitting and per-lobe draw ranges ===
// Two triangles sharing an edge at z = 8 and one triangle at z = -3, interleaved in the index
const lobe_positions = () =>
  new Float32Array([0, 0, 8, 1, 0, 8, 0, 1, 8, 1, 1, 8, 0, 0, -3, 1, 0, -3, 0, 1, -3])
const lobe_indices = () => new Uint32Array([0, 1, 2, 4, 6, 5, 2, 1, 3])

describe(`split_lobes`, () => {
  test(`makes each lobe contiguous with its winding and bounds`, () => {
    const indices = lobe_indices()
    const lobes = split_lobes(lobe_positions(), indices)
    expect(Array.from(indices)).toEqual([0, 1, 2, 2, 1, 3, 4, 6, 5])
    expect(Array.from(lobes?.offsets ?? [])).toEqual([0, 6, 9])
    const spheres = Array.from(lobes?.spheres ?? [])
    expect(spheres.slice(0, 3)).toEqual([0.5, 0.5, 8])
    expect(spheres.slice(4, 7)).toEqual([0.5, 0.5, -3])
    expect(spheres[3]).toBeCloseTo(Math.SQRT1_2, 6)
  })

  test.each([
    [`a connected surface`, 1],
    [`more lobes than MAX_SORTED_LOBES`, MAX_SORTED_LOBES + 1],
  ])(`returns null and keeps the indices for %s`, (_desc, n_lobes) => {
    // n_lobes disjoint triangles along x, listed back to front
    // oxfmt-ignore
    const positions = new Float32Array(
      Array.from({ length: n_lobes }, (_, lobe) => [lobe, 0, 0, lobe, 1, 0, lobe, 0, 1]).flat(),
    )
    const indices = Uint32Array.from(
      { length: 3 * n_lobes },
      (_, idx) => 3 * n_lobes - 1 - idx,
    )
    const before = indices.slice()
    expect(split_lobes(positions, indices)).toBeNull()
    expect(indices).toEqual(before)
  })
})

test(`draw_range_views share the surface's buffers and see later attributes, bound each lobe and dispose with it`, () => {
  const indices = lobe_indices()
  const lobes = split_lobes(lobe_positions(), indices)
  if (!lobes) throw new Error(`expected two lobes`)
  const surface = new BufferGeometry()
  surface.setAttribute(`position`, new BufferAttribute(lobe_positions(), 3))
  surface.setIndex(new BufferAttribute(indices, 1))
  const views = draw_range_views(surface, lobes)
  expect(views.map(({ drawRange }) => [drawRange.start, drawRange.count])).toEqual([
    [0, 6],
    [6, 3],
  ])
  // Three depth-sorts transparent meshes by their bounding-sphere centers
  expect(views.map(({ boundingSphere }) => boundingSphere?.center.z)).toEqual([8, -3])
  const colors = new BufferAttribute(new Float32Array(21), 3)
  surface.setAttribute(`color`, colors)
  for (const view of views) {
    expect(view.index).toBe(surface.index)
    expect(view.getAttribute(`position`)).toBe(surface.getAttribute(`position`))
    expect(view.getAttribute(`color`)).toBe(colors)
  }
  surface.deleteAttribute(`color`)
  expect(views.some((view) => view.hasAttribute(`color`))).toBe(false)
  const disposed = vi.fn()
  for (const view of views) view.addEventListener(`dispose`, disposed)
  surface.dispose()
  expect(disposed).toHaveBeenCalledTimes(views.length)
})
