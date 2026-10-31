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
import { afterEach, expect, test } from 'vitest'
import {
  expect_module_worker,
  expect_worker_safe_import_graph,
  import_without_workers,
  install_stub_worker,
} from '../setup'
import { read_maybe_gz } from '../test-fixtures'

// the stub plays the worker entry: its own grid store, extraction and transfer list
const worker_grid_of = create_grid_store()
const transfers: ArrayBuffer[][] = []
type Message = { id: number; input: ExtractPayload; options: FermiSurfaceOptions }
const stub = install_stub_worker<Message>(({ input, options }) => {
  const result = extract_fermi_surface(worker_grid_of(input), options)
  transfers.push(fermi_surface_transferables(result))
  return result
})
const {
  create_latest_extractor,
  extract_fermi_surface_async,
  fermi_extraction_warm,
  register_fermi_viewer,
} = await import(`#lib/fermi-surface/extract-async.js`)
afterEach(stub.reset)

const cu_path = `src/site/fermi-surfaces/cu_fcc_bands.bxsf.gz`
const load_cu = () => parse_fermi_file(read_maybe_gz(cu_path), `cu.bxsf`) as BandGridData
// whether each post so far carried its grid, and the mu each asked for
const sent_grids = () => stub.posted.map(({ message }) => message.input.grid !== undefined)
const posted_mus = () => stub.posted.map(({ message }) => message.options.mu)
const warm = (grid: BandGridData, factors: number[]) =>
  factors.map((factor) => fermi_extraction_warm(grid, factor))

test(`worker extraction matches the main thread, sends each grid once, caches results`, async () => {
  const grid = $state(load_cu()) // a viewer's grid: deeply proxied, so not structured-cloneable
  expect(fermi_extraction_warm(grid, 0)).toBe(false)
  const lattices = []
  for (const mu of [0, -2.5]) {
    const options = { mu, interpolation_factor: 0, wigner_seitz: true }
    const result = await extract_fermi_surface_async(grid, options)
    lattices.push(result.k_lattice)
    // d bands at −2.5 eV give several sheets, folded and clipped into the zone
    expect(result).toEqual(extract_fermi_surface(grid, options))
    expect(result.isosurfaces.length).toBeGreaterThan(0)
    // same options, and the auto factor spelled out: served from the cache without a request
    for (const interpolation_factor of [0, 48 / 25]) {
      const cached = await extract_fermi_surface_async(grid, {
        ...options,
        interpolation_factor,
      })
      expect(cached).toBe(result)
    }
  }
  // one lattice identity per grid, so a zone drawn from it isn't rebuilt per μ
  expect(lattices[1]).toBe(lattices[0])
  expect_module_worker(stub.instances, `src/lib/fermi-surface/extract-worker.ts`)
  expect_worker_safe_import_graph([`src/lib/fermi-surface/extract-worker.ts`], 5) // no Svelte
  // every mesh buffer is moved, none twice
  for (const buffers of transfers) {
    expect(buffers.length).toBeGreaterThan(0)
    expect(new Set(buffers).size).toBe(buffers.length)
  }
  // other folding and another grid object extract anew; the grid crosses with its first
  // request only, later ones name its token
  await extract_fermi_surface_async(grid, { mu: 0, interpolation_factor: 0 })
  await extract_fermi_surface_async(load_cu(), { mu: 0, interpolation_factor: 0 })
  expect(sent_grids()).toEqual([true, false, false, true])
  expect(new Set(stub.posted.slice(0, 3).map(({ message }) => message.input.token)).size).toBe(
    1,
  )
  // the auto factor resolves to the same grid whether requested as 0 or as its value
  expect(warm(grid, [0, 48 / 25, 3])).toEqual([true, true, false])
  // the worker keeps two upsampled grids per band, oldest out: a third factor evicts the auto one
  for (const interpolation_factor of [1, 1.5]) {
    await extract_fermi_surface_async(grid, { mu: 0, interpolation_factor })
  }
  expect(warm(grid, [0, 1, 1.5])).toEqual([false, true, true])
})

test(`latest-wins: one extraction in flight, newer requests replace waiting ones`, async () => {
  const grid = load_cu()
  const extract = create_latest_extractor()
  const request = (mu: number) => extract(grid, { mu, interpolation_factor: 1 })
  const results = await Promise.all([0.1, 0.2, 0.3, 0.4].map(request))
  // the first runs at once, 0.4 replaces 0.2 then 0.3 while it waits
  expect(results.map((result) => result === null)).toEqual([false, true, true, false])
  expect(posted_mus()).toEqual([0.1, 0.4])
  // a cached result resolves without waiting behind an extraction in flight, and supersedes
  // the waiting request: 0.6 never posts
  const [pending, superseded] = [request(0.5), request(0.6)]
  expect(await request(0.1)).toBe(results[0])
  expect(await pending).not.toBeNull()
  expect(await superseded).toBeNull()
  expect(posted_mus()).toEqual([0.1, 0.4, 0.5])
  // an unmounting viewer cancels its waiting request: it resolves null and never posts
  const [running, cancelled] = [request(0.7), request(0.8)]
  extract.cancel()
  expect(await cancelled).toBeNull()
  expect(await running).not.toBeNull()
  expect(posted_mus()).toEqual([0.1, 0.4, 0.5, 0.7])
})

test(`warmth follows the grids the worker holds, and a lost grid is re-sent once`, async () => {
  const grids = [1, 2, 3, 4, 5].map(() => load_cu())
  // a viewer unmounting keeps the worker and its grids warm for the others still mounted
  const unregister = [register_fermi_viewer(), register_fermi_viewer()]
  await extract_fermi_surface_async(grids[0], { mu: 0.1 })
  unregister[0]()
  expect(fermi_extraction_warm(grids[0])).toBe(true)
  // the last one unmounting mid-extraction ends the worker once that extraction lands, and
  // its replacement holds no grids
  const in_flight = extract_fermi_surface_async(grids[0], { mu: 0.15 })
  unregister[1]()
  const worker = stub.instances.at(-1)
  expect([worker?.terminated, fermi_extraction_warm(grids[0])]).toEqual([0, true])
  expect((await in_flight).isosurfaces.length).toBeGreaterThan(0)
  expect([worker?.terminated, fermi_extraction_warm(grids[0])]).toEqual([1, false])
  await extract_fermi_surface_async(grids[0], { mu: 0.2 })
  expect(fermi_extraction_warm(grids[0])).toBe(true)
  // the worker keeps 4 grids: a fifth evicts the first, which is then sent again up front
  for (const grid of grids.slice(1)) await extract_fermi_surface_async(grid, { mu: 0.1 })
  expect(grids.map((grid) => Number(fermi_extraction_warm(grid)))).toEqual([0, 1, 1, 1, 1])
  stub.reset()
  await extract_fermi_surface_async(grids[0], { mu: 0.3 })
  expect(sent_grids()).toEqual([true])
  // the worker evicts or loses the grid (e.g. a replacement worker): its error reply triggers
  // one retry that carries the grid
  stub.fail_next(`Fermi extraction worker holds no band grid`)
  const result = await extract_fermi_surface_async(grids[0], { mu: 0.4 })
  expect(result.isosurfaces.length).toBeGreaterThan(0)
  expect(sent_grids()).toEqual([true, false, true])
  expect(fermi_extraction_warm(grids[4])).toBe(false) // every other grid is sent afresh
})

// The fresh module graph it imports takes seconds on shared CI runners
test(
  `extracts on the main thread where workers are disabled`,
  { timeout: 20_000 },
  async () => {
    const main_thread_module = await import_without_workers(
      () => import(`#lib/fermi-surface/extract-async.js`),
    )
    const grid = load_cu()
    const options = { mu: -2.5, interpolation_factor: 0, wigner_seitz: true }
    const result = await main_thread_module.extract_fermi_surface_async(grid, options)
    expect(result).toEqual(extract_fermi_surface(grid, options))
    expect(result.isosurfaces.length).toBeGreaterThan(0)
    expect(stub.posted).toHaveLength(0)
  },
)

test(`grid store keeps the newest grids sent and names a missing one`, () => {
  const grid_of = create_grid_store(2)
  const grids = [0, 1, 2, 3].map(() => load_cu())
  for (const idx of [0, 1, 2, 1, 3]) {
    expect(grid_of({ token: idx, grid: grids[idx] })).toBe(grids[idx])
  }
  // re-sending 1 made it newer than 2, which 3 then evicted
  expect([grid_of({ token: 1 }), grid_of({ token: 3 })]).toEqual([grids[1], grids[3]])
  expect(() => grid_of({ token: 2 })).toThrow(/holds no band grid 2 \(2 held\)/)
})
