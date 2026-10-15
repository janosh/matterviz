// Fermi surface extraction through its Web Worker boundary: worker results match the main-thread
// extraction exactly, a band grid crosses once per worker, results are cached per grid and
// options, and a viewer's requests are scheduled latest-wins
import { extract_fermi_surface } from '#lib/fermi-surface/compute.js'
import type { ExtractPayload } from '#lib/fermi-surface/extract-job.js'
import {
  create_grid_store,
  fermi_surface_transferables,
} from '#lib/fermi-surface/extract-job.js'
import { parse_fermi_file } from '#lib/fermi-surface/parse.js'
import type { BandGridData, FermiSurfaceOptions } from '#lib/fermi-surface/types.js'
import { afterEach, expect, test, vi } from 'vitest'
import {
  expect_module_worker,
  expect_worker_safe_import_graph,
  install_stub_worker,
} from '../setup'
import { read_maybe_gz } from '../test-fixtures'

// the stub plays the worker entry: its own grid store, extraction and transfer list
const worker_grid_of = create_grid_store()
const transfers: ArrayBuffer[][] = []
const stub = install_stub_worker<{
  id: number
  input: ExtractPayload
  options: FermiSurfaceOptions
}>(({ input, options }) => {
  const result = extract_fermi_surface(worker_grid_of(input), options)
  transfers.push(fermi_surface_transferables(result))
  return result
})
const {
  create_latest_extractor,
  extract_fermi_surface_async,
  fermi_extraction_warm,
  release_fermi_worker,
} = await import(`#lib/fermi-surface/extract-async.js`)
afterEach(stub.reset)

const cu_path = `src/site/fermi-surfaces/cu_fcc_bands.bxsf.gz`
const load_cu = () => parse_fermi_file(read_maybe_gz(cu_path), `cu.bxsf`) as BandGridData

test(`worker extraction matches the main thread and sends each grid once`, async () => {
  const grid = load_cu()
  expect(fermi_extraction_warm(grid, 0)).toBe(false)
  for (const mu of [0, -2.5]) {
    const options = { mu, interpolation_factor: 0, wigner_seitz: true }
    const result = await extract_fermi_surface_async(grid, options)
    const expected = extract_fermi_surface(grid, options)
    // d bands at −2.5 eV give several sheets, folded and clipped into the zone
    expect(result.isosurfaces).toHaveLength(expected.isosurfaces.length)
    expect(result.isosurfaces.length).toBeGreaterThan(0)
    for (const [idx, surface] of result.isosurfaces.entries()) {
      const { positions, normals, indices, band_index } = expected.isosurfaces[idx]
      expect(surface.band_index).toBe(band_index)
      expect(surface.positions).toEqual(positions)
      expect(surface.normals).toEqual(normals)
      expect(surface.indices).toEqual(indices)
    }
  }
  expect_module_worker(stub.instances, `src/lib/fermi-surface/extract-worker.ts`)
  expect_worker_safe_import_graph([`src/lib/fermi-surface/extract-worker.ts`], 5) // no Svelte
  // the grid crosses with the first request only; the second names its token
  expect(stub.posted.map(({ message }) => message.input.grid !== undefined)).toEqual([
    true,
    false,
  ])
  expect(new Set(stub.posted.map(({ message }) => message.input.token)).size).toBe(1)
  // every mesh buffer is moved, none twice
  for (const buffers of transfers) {
    expect(buffers.length).toBeGreaterThan(0)
    expect(new Set(buffers).size).toBe(buffers.length)
  }
  // the auto factor resolves to the same grid whether requested as 0 or as its value
  expect(fermi_extraction_warm(grid, 0)).toBe(true)
  expect(fermi_extraction_warm(grid, 48 / 25)).toBe(true)
  expect(fermi_extraction_warm(grid, 3)).toBe(false)
  // the worker keeps two upsampled grids per band, oldest out: a third factor evicts the auto one
  for (const interpolation_factor of [1, 1.5]) {
    await extract_fermi_surface_async(grid, { mu: 0, interpolation_factor })
  }
  expect([0, 1, 1.5].map((factor) => fermi_extraction_warm(grid, factor))).toEqual([
    false,
    true,
    true,
  ])
})

test(`results are cached per grid and resolved options`, async () => {
  const grid = load_cu()
  const first = await extract_fermi_surface_async(grid, { mu: -1, interpolation_factor: 0 })
  // same options, and the auto factor spelled out: served from the cache without a request
  expect(await extract_fermi_surface_async(grid, { mu: -1, interpolation_factor: 0 })).toBe(
    first,
  )
  expect(
    await extract_fermi_surface_async(grid, { mu: -1, interpolation_factor: 48 / 25 }),
  ).toBe(first)
  expect(stub.posted).toHaveLength(1)
  // a different mu, folding or grid object each extract anew
  await extract_fermi_surface_async(grid, { mu: -1.5, interpolation_factor: 0 })
  await extract_fermi_surface_async(grid, {
    mu: -1,
    interpolation_factor: 0,
    wigner_seitz: true,
  })
  await extract_fermi_surface_async(load_cu(), { mu: -1, interpolation_factor: 0 })
  expect(stub.posted).toHaveLength(4)
})

test(`latest-wins: one extraction in flight, newer requests replace waiting ones`, async () => {
  const grid = load_cu()
  const extract = create_latest_extractor()
  const mus = [0.1, 0.2, 0.3, 0.4]
  const results = await Promise.all(
    mus.map((mu) => extract(grid, { mu, interpolation_factor: 1 })),
  )
  // the first runs at once, 0.4 replaces 0.2 then 0.3 while it waits
  expect(results.map((result) => result === null)).toEqual([false, true, true, false])
  expect(stub.posted.map(({ message }) => message.options.mu)).toEqual([0.1, 0.4])
  // a cached result resolves without waiting behind an extraction in flight, and supersedes
  // the waiting request: 0.6 never posts
  const pending = extract(grid, { mu: 0.5, interpolation_factor: 1 })
  const superseded = extract(grid, { mu: 0.6, interpolation_factor: 1 })
  expect(await extract(grid, { mu: 0.1, interpolation_factor: 1 })).toBe(results[0])
  expect(await pending).not.toBeNull()
  expect(await superseded).toBeNull()
  expect(stub.posted.map(({ message }) => message.options.mu)).toEqual([0.1, 0.4, 0.5])
})

test(`warmth follows the grids the worker holds`, async () => {
  const grids = [1, 2, 3, 4, 5].map(() => load_cu())
  await extract_fermi_surface_async(grids[0], { mu: 0.1 })
  expect(fermi_extraction_warm(grids[0])).toBe(true)
  // a released worker is replaced by one holding no grids
  release_fermi_worker()
  expect(fermi_extraction_warm(grids[0])).toBe(false)
  await extract_fermi_surface_async(grids[0], { mu: 0.2 })
  expect(fermi_extraction_warm(grids[0])).toBe(true)
  // the worker keeps 4 grids: a fifth evicts the first, which is then sent again up front
  for (const grid of grids.slice(1)) await extract_fermi_surface_async(grid, { mu: 0.1 })
  expect(grids.map((grid) => fermi_extraction_warm(grid))).toEqual([
    false,
    true,
    true,
    true,
    true,
  ])
  stub.reset()
  await extract_fermi_surface_async(grids[0], { mu: 0.3 })
  expect(stub.posted.map(({ message }) => message.input.grid !== undefined)).toEqual([true])
})

test(`extracts on the main thread where the worker URL cannot resolve`, async () => {
  // anywidget imports the single-file bundle from a blob: URL, against which no relative
  // worker URL resolves (new URL throws)
  const can_parse = URL.canParse
  const spy = vi
    .spyOn(URL, `canParse`)
    .mockImplementation((url, base) => can_parse(url, `blob:${String(base)}`))
  vi.resetModules()
  const blob_module = await import(`#lib/fermi-surface/extract-async.js`)
  spy.mockRestore()
  const n_workers = stub.instances.length
  const grid = load_cu()
  const options = { mu: -2.5, interpolation_factor: 0, wigner_seitz: true }
  const result = await blob_module.extract_fermi_surface_async(grid, options)
  expect(result).toEqual(extract_fermi_surface(grid, options))
  expect(result.isosurfaces.length).toBeGreaterThan(0)
  expect([stub.instances.length, stub.posted.length]).toEqual([n_workers, 0])
})

test(`a worker that lost a grid gets it re-sent once`, async () => {
  const grid = load_cu()
  await extract_fermi_surface_async(grid, { mu: 0.2 })
  // the worker evicts or loses the grid (e.g. a replacement worker): its error reply triggers
  // one retry that carries the grid
  stub.fail_next(`Fermi extraction worker holds no band grid`)
  const result = await extract_fermi_surface_async(grid, { mu: 0.3 })
  expect(result.isosurfaces.length).toBeGreaterThan(0)
  expect(stub.posted.map(({ message }) => message.input.grid !== undefined)).toEqual([
    true,
    false,
    true,
  ])
})

test(`grid store keeps the newest grids and names a missing one`, () => {
  const grid_of = create_grid_store(2)
  const grids = [1, 2, 3].map(() => load_cu())
  for (const [idx, grid] of grids.entries()) expect(grid_of({ token: idx, grid })).toBe(grid)
  expect(grid_of({ token: 2 })).toBe(grids[2])
  expect(grid_of({ token: 1 })).toBe(grids[1])
  expect(() => grid_of({ token: 0 })).toThrow(/holds no band grid 0 \(2 held\)/)
})
