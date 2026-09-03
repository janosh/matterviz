// Isosurface geometry extraction shared by the worker and the main-thread fallback, plus
// the create_worker_client wiring (happy-dom has no Worker, so a stub is installed before
// the client module is imported to exercise the real postMessage plumbing)
import type { compute_geometries_async as ComputeGeometriesAsync } from '$lib/isosurface/async-geometry.svelte'
import type { GeometryInput } from '$lib/isosurface/geometry'
import {
  compute_isosurface_geometries,
  geometry_result_transferables,
} from '$lib/isosurface/geometry'
import { create_volume_sampler, prepare_geometry_grid } from '$lib/isosurface/sampling'
import { make_volume as make_flat_volume, MAX_GRID_POINTS } from '$lib/isosurface/types'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import { cubic_matrix, install_stub_worker, make_grid, make_volume } from '../setup'

// Periodic Gaussian blob centred in a 10 A cubic cell
const blob_volume = (n_pts = 16) =>
  make_volume(
    make_grid(n_pts, n_pts, n_pts, (ix, iy, iz) => {
      const dist = (idx: number) =>
        Math.min(Math.abs(idx / n_pts - 0.5), 1 - Math.abs(idx / n_pts - 0.5))
      return Math.exp(-(dist(ix) ** 2 + dist(iy) ** 2 + dist(iz) ** 2) / 0.03)
    }),
    { lattice: cubic_matrix(10), periodic: true },
  )

const blob_input = (volume = blob_volume()): GeometryInput => ({
  volumes: [
    {
      token: 7,
      volume,
      range: [
        [0, 2],
        [0, 1],
        [0, 1],
      ],
      reference_origin: [1, 2, 3],
      surfaces: [
        { token: `0:1`, isovalue: 0.5 },
        { token: `1:1`, isovalue: 0.2 },
      ],
    },
  ],
})

describe(`compute_isosurface_geometries`, () => {
  test(`extracts a display window and one mesh per isovalue in the scene frame`, () => {
    const volume = blob_volume()
    const [result] = compute_isosurface_geometries(blob_input(volume)).volumes
    expect(result.token).toBe(7)
    // 2x1x1 window at source density, endpoint inclusive
    expect(result.grid.dims).toEqual([33, 17, 17])
    expect(result.lattice[0][0]).toBeCloseTo(20, 12)
    expect(result.origin).toEqual([0, 0, 0])
    expect(result.surfaces.map((surface) => surface.token)).toEqual([`0:1`, `1:1`])

    const sample = create_volume_sampler(volume)
    for (const [surface_idx, surface] of result.surfaces.entries()) {
      const isovalue = [0.5, 0.2][surface_idx]
      expect(surface.positions.length).toBeGreaterThan(300)
      expect(surface.indices.length % 3).toBe(0)
      expect(Math.max(...surface.indices)).toBeLessThan(surface.positions.length / 3)
      // Vertices are shifted by origin - reference_origin; shifting back and sampling the
      // source field recovers the isovalue (trilinear on the same lattice)
      for (let vert = 0; vert < surface.positions.length; vert += 3 * 37) {
        const position: [number, number, number] = [
          surface.positions[vert] + 1,
          surface.positions[vert + 1] + 2,
          surface.positions[vert + 2] + 3,
        ]
        expect(sample(position)).toBeCloseTo(isovalue, 4)
      }
    }
    // The lower isovalue encloses the higher one: more surface, never less
    expect(result.surfaces[1].positions.length).toBeGreaterThan(
      result.surfaces[0].positions.length,
    )
  })

  test(`no range and within budget: the source grid is resampled without interpolation`, () => {
    // a periodic [0, 1] window is endpoint-inclusive: an 8-point axis becomes 9 samples whose
    // last repeats the first, so no value is blended
    const volume = blob_volume(8)
    const input: GeometryInput = {
      volumes: [{ ...blob_input(volume).volumes[0], range: null }],
    }
    const [result] = compute_isosurface_geometries(input).volumes
    expect(result.grid.dims).toEqual([9, 9, 9])
    expect(result.lattice).toEqual(volume.lattice)
    for (const [idx, val] of result.grid.values.entries()) {
      // oxfmt-ignore
      const [ix, iy, iz] = [Math.floor(idx / 81) % 8, (Math.floor(idx / 9) % 9) % 8, (idx % 9) % 8]
      expect(val).toBe(volume.values[(ix * 8 + iy) * 8 + iz])
    }
  })

  // block averaging read output sample k at source fraction (s_k + e_k - 1)/2/(N - 1) while
  // marching cubes places it at k/(M - 1), moving an f = x_frac 0.3 isosurface in a 20 Å cell
  // from x = 6.000 Å to 5.900 Å with the atoms staying put
  test(`over budget: the resampled grid keeps its endpoints exact`, () => {
    const n_pts = 101
    const values = new Float64Array(n_pts ** 3)
    for (let ix = 0; ix < n_pts; ix++) {
      values.fill(ix / (n_pts - 1), ix * n_pts * n_pts, (ix + 1) * n_pts * n_pts)
    }
    const volume = make_flat_volume(values, [n_pts, n_pts, n_pts], {
      lattice: cubic_matrix(20),
      origin: [0, 0, 0],
      periodic: false,
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

  test(`transferables list every output buffer exactly once`, () => {
    const result = compute_isosurface_geometries(blob_input())
    const buffers = geometry_result_transferables(result)
    const [volume] = result.volumes
    expect(buffers).toHaveLength(1 + 2 * volume.surfaces.length)
    expect(new Set(buffers).size).toBe(buffers.length)
    expect(buffers[0]).toBe(volume.grid.values.buffer)
  })
})

// === Worker client wiring ===
// Abort/teardown/dedupe rules of the shared client are covered by worker-client.test.ts

const stub = install_stub_worker<{ id: number; input: GeometryInput }>(({ input }) =>
  compute_isosurface_geometries(input),
)
let compute_geometries_async: typeof ComputeGeometriesAsync

beforeAll(async () => {
  ;({ compute_geometries_async } = await import(`$lib/isosurface/async-geometry.svelte`))
})
afterEach(stub.reset)

test(`compute_geometries_async posts a cloneable payload and returns the worker result`, async () => {
  const volume = blob_volume()
  const result = await compute_geometries_async(blob_input(volume))
  expect(stub.posted).toHaveLength(1)
  const payload = stub.posted[0].message.input.volumes[0]
  expect(payload.volume.values).toBeInstanceOf(Float64Array)
  expect(payload.volume.values).toHaveLength(volume.values.length)
  expect(payload.volume.lattice).toEqual(volume.lattice)
  // Value buffers stay owned by the caller (copied, not transferred)
  expect(stub.posted[0].transfer).toEqual([])
  expect(volume.values).toHaveLength(16 ** 3)

  const sync = compute_isosurface_geometries(blob_input(volume))
  expect(result.volumes[0].grid.dims).toEqual(sync.volumes[0].grid.dims)
  expect(result.volumes[0].surfaces[0].positions).toEqual(
    sync.volumes[0].surfaces[0].positions,
  )
})
