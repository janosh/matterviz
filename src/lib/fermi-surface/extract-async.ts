// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Fermi surface extraction off the main thread: 5-30 ms per mu on a typical grid is too slow
// for a band-plot hover or mu drag extracting every frame
import { is_plain_object } from '#lib/utils.js'
import { create_worker_client } from '#lib/worker-client.svelte.js'
import { extract_fermi_surface, PREPARED_FACTORS_PER_BAND, resolved_factor } from './compute'
import { type ExtractPayload, lru_set, WORKER_GRIDS } from './extract-job'
import type { BandGridData, FermiSurfaceData, FermiSurfaceOptions } from './types'

// Svelte $state proxies are not structured-cloneable, but their typed arrays read back raw, so
// only the plain arrays and objects around the megabyte buffers are rebuilt
const unproxied = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(unproxied)
  if (!is_plain_object(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, unproxied(val)]))
}

type ExtractInput = { token: number; grid: BandGridData; send_grid: boolean }
const run_extraction = create_worker_client({
  label: `Fermi surface extraction`,
  create_worker: () =>
    new Worker(new URL(`./extract-worker.js`, import.meta.url), { type: `module` }),
  // on the main thread the grid is at hand, and compute.ts caches its upsampling by identity
  compute_sync: ({ grid }: ExtractInput, options?: FermiSurfaceOptions) =>
    extract_fermi_surface(grid, options),
  build_payload: ({ token, grid, send_grid }): ExtractPayload => ({
    token,
    grid: send_grid ? (unproxied(grid) as BandGridData) : undefined,
  }),
})

let next_token = 0
const grid_tokens = new WeakMap<BandGridData, number>()
// The current worker's grid store (create_grid_store), cleared whenever the worker may be
// gone: token → interpolation factors its copy of the grid is upsampled at (FIFO as compute.ts)
const worker_grids = new Map<number, Set<number>>()

// Recent results per grid by options, e.g. hovering back over band points (~1 MB each)
const RESULT_CACHE_SIZE = 16
const result_cache = new WeakMap<BandGridData, Map<string, FermiSurfaceData>>()
// extract_fermi_surface's defaults, factor resolved (0 = auto), so equal options share an entry
const options_key = (
  grid: BandGridData,
  { mu = 0, interpolation_factor = 1, wigner_seitz = false }: FermiSurfaceOptions,
): string => `${mu}|${resolved_factor(grid, interpolation_factor)}|${wigner_seitz}`

// Whether the worker holds the grid upsampled at this factor, so a new extraction is quick
export const fermi_extraction_warm = (grid: BandGridData, interpolation_factor = 1): boolean =>
  worker_grids
    .get(grid_tokens.get(grid) ?? 0) // tokens start at 1
    ?.has(resolved_factor(grid, interpolation_factor)) ?? false

// extract_fermi_surface in the worker. Results are cached (read-only) by grid identity, and the
// worker keeps its own grid copy, so in-place grid edits go unseen: pass a new grid object.
export async function extract_fermi_surface_async(
  grid: BandGridData,
  options: FermiSurfaceOptions = {},
): Promise<FermiSurfaceData> {
  const cache = result_cache.get(grid) ?? new Map<string, FermiSurfaceData>()
  result_cache.set(grid, cache)
  const key = options_key(grid, options)
  const cached = cache.get(key)
  if (cached) return lru_set(cache, key, cached, RESULT_CACHE_SIZE)
  const token = grid_tokens.get(grid) ?? ++next_token
  grid_tokens.set(grid, token)
  const request = (send_grid: boolean) => {
    if (send_grid) lru_set(worker_grids, token, new Set<number>(), WORKER_GRIDS)
    return run_extraction({ token, grid, send_grid }, options)
  }
  const send_grid = !worker_grids.has(token)
  n_in_flight++
  const result = await request(send_grid)
    .catch((error: unknown) => {
      // A failed worker's successor holds no grids, a live one may have evicted this one:
      // retry once with the grid, and send every other grid afresh next time
      worker_grids.clear()
      if (send_grid) throw error
      return request(true)
    })
    .finally(() => {
      n_in_flight--
      if (release_deferred) release_if_unused()
    })
  const factors = worker_grids
    .get(token)
    ?.add(resolved_factor(grid, options.interpolation_factor ?? 1))
  if (factors && factors.size > PREPARED_FACTORS_PER_BAND) factors.delete([...factors][0])
  return lru_set(cache, key, result, RESULT_CACHE_SIZE)
}

// Mounted viewers share the worker and its upsampled grids (megabytes each): the last one to
// unmount ends it, once the extractions still in flight have landed
let n_viewers = 0
let n_in_flight = 0
let release_deferred = false
const release_if_unused = (): void => {
  release_deferred = n_viewers === 0 && n_in_flight > 0
  if (n_viewers > 0 || release_deferred) return
  run_extraction.release()
  worker_grids.clear()
}
// A viewer's mount path, returning its unmount path
export function register_fermi_viewer(): () => void {
  n_viewers++
  release_deferred = false
  return () => {
    n_viewers--
    release_if_unused()
  }
}

// Latest-wins scheduling for one viewer: one extraction in flight and only the newest request
// waiting, so a pointer sweep skips stale energies. Replaced requests resolve null; cached
// results resolve at once and supersede the waiting request. `cancel` (on unmount) drops the
// waiting request, resolving it null.
export function create_latest_extractor() {
  let busy = false
  let waiting: { run: () => void; resolve: (result: null) => void } | undefined
  const cancel = (): void => {
    waiting?.resolve(null) // only ever set while busy
    waiting = undefined
  }
  const extract = (grid: BandGridData, options: FermiSurfaceOptions) => {
    cancel()
    if (result_cache.get(grid)?.has(options_key(grid, options))) {
      return extract_fermi_surface_async(grid, options)
    }
    return new Promise<FermiSurfaceData | null>((resolve, reject) => {
      const run = () => {
        busy = true
        waiting = undefined
        extract_fermi_surface_async(grid, options)
          .then(resolve, reject)
          .finally(() => {
            busy = false
            waiting?.run()
          })
      }
      if (busy) waiting = { run, resolve }
      else run()
    })
  }
  return Object.assign(extract, { cancel })
}
