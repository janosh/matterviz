// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Fermi surface extraction off the main thread: 5-30 ms per mu on a typical grid is too slow
// for a band-plot hover or mu drag extracting every frame
import { is_plain_object } from '#lib/utils.js'
import { can_create_worker, create_worker_client } from '#lib/worker-client.svelte.js'
import { extract_fermi_surface, PREPARED_FACTORS_PER_BAND, resolved_factor } from './compute'
import type { BandGridData, FermiSurfaceData, FermiSurfaceOptions } from './types'

// Svelte $state proxies are not structured-cloneable, but their typed arrays read back raw, so
// only the plain arrays and objects around the megabyte buffers are rebuilt
const unproxied = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(unproxied)
  if (!is_plain_object(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, unproxied(val)]))
}

// Sets key as the newest entry, evicting the oldest (first iterated) past max_size
const lru_set = <K, V>(map: Map<K, V>, key: K, value: V, max_size: number): V => {
  map.delete(key)
  map.set(key, value)
  const [oldest] = map.keys()
  if (map.size > max_size) map.delete(oldest)
  return value
}

// The worker keeps the newest grids sent (enough for a page of viewers): a grid crosses once
// and later extractions name it, so its upsampled copies (cached by identity) persist
const run_extraction = create_worker_client<
  BandGridData,
  FermiSurfaceOptions,
  FermiSurfaceData
>({
  label: `Fermi surface extraction`,
  create_worker: () =>
    new Worker(new URL(`./extract-worker.js`, import.meta.url), { type: `module` }),
  // on the main thread compute.ts caches its upsampling by the grid's own identity
  compute_sync: extract_fermi_surface,
  build_payload: unproxied,
  retained_inputs: 4,
})

// Interpolation factors a grid is upsampled at (FIFO as compute.ts), meaningful only while
// those copies are around: in the worker as long as it retains the grid, on the main thread
// (no workers) with the grid itself
const upsampled_factors = new WeakMap<BandGridData, Set<number>>()
const upsampling_kept = (grid: BandGridData): boolean =>
  !can_create_worker() || run_extraction.holds(grid)

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
  upsampling_kept(grid) &&
  (upsampled_factors.get(grid)?.has(resolved_factor(grid, interpolation_factor)) ?? false)

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
  // A worker that lost the grid (evicted, or a replacement worker) upsamples it afresh
  if (!upsampling_kept(grid)) upsampled_factors.delete(grid)
  n_in_flight++
  const result = await run_extraction(grid, options).finally(() => {
    n_in_flight--
    if (release_deferred) release_if_unused()
  })
  const factors = upsampled_factors.get(grid) ?? new Set<number>()
  upsampled_factors.set(grid, factors)
  factors.add(resolved_factor(grid, options.interpolation_factor ?? 1))
  if (factors.size > PREPARED_FACTORS_PER_BAND) factors.delete([...factors][0])
  // A structured clone gives each μ its own lattice, so every zone drawn from it would rebuild:
  // results of one grid share the first one's
  result.k_lattice = cache.values().next().value?.k_lattice ?? result.k_lattice
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
