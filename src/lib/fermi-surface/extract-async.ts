// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Fermi surface extraction off the main thread. Marching cubes plus zone folding takes 5-30 ms
// per mu on a typical grid, so a band-plot hover or mu drag extracting every frame would drop
// frames on the main thread; the worker keeps rendering and pointer handling smooth. Runs
// synchronously where no worker can start: Worker missing (SSR, tests) or the worker URL not
// resolvable (see module_urls_resolve).
import { create_worker_client } from '#lib/worker-client.svelte.js'
import { extract_fermi_surface, PREPARED_FACTORS_PER_BAND, resolved_factor } from './compute'
import type { ExtractPayload } from './extract-job'
import { cloneable_band_grid, WORKER_GRIDS } from './extract-job'
import type { BandGridData, FermiSurfaceData, FermiSurfaceOptions } from './types'

type ExtractInput = { token: number; grid: BandGridData; send_grid: boolean }

// Bundlers resolve the worker file against this module's URL, which a module imported from a
// blob: or data: URL cannot do (new URL throws): anywidget loads matterviz's single-file
// bundle that way, so there extraction runs on the main thread, as it does without Worker.
const module_urls_resolve = URL.canParse(`./`, import.meta.url)

const run_extraction = create_worker_client<
  ExtractInput,
  FermiSurfaceOptions,
  FermiSurfaceData
>({
  label: `Fermi surface extraction`,
  create_worker: () =>
    new Worker(new URL(`./extract-worker.js`, import.meta.url), { type: `module` }),
  requires_main_thread: () => !module_urls_resolve,
  // on the main thread the grid is at hand, and compute.ts caches its upsampling by identity
  compute_sync: ({ grid }, options) => extract_fermi_surface(grid, options),
  build_payload: ({ token, grid, send_grid }): ExtractPayload => ({
    token,
    grid: send_grid ? cloneable_band_grid(grid) : undefined,
  }),
})

let next_token = 0
const grid_tokens = new WeakMap<BandGridData, number>()
// Tokens whose grid the current worker holds, oldest sent first: mirrors its grid store
// (create_grid_store), and is cleared whenever the worker may be gone
const sent_tokens = new Set<number>()
// Interpolation factors the worker's copy of each grid is upsampled at, evicted oldest first as
// compute.ts evicts them. A grid's set restarts whenever its grid is sent, since the copy
// sent is new and cold; it counts only while sent_tokens holds the grid's token.
const warm_factors = new WeakMap<BandGridData, Set<number>>()

// Recent results per grid by options: hovering back over band points or returning a mu slider
// commits a surface without extracting again. Kept small since one sheet set is ~1 MB.
const RESULT_CACHE_SIZE = 16
const result_cache = new WeakMap<BandGridData, Map<string, FermiSurfaceData>>()
// extract_fermi_surface's own defaults with the factor resolved (0 = auto), so equivalent
// options share an entry, e.g. a hover preview and the full surface at the auto factor
const options_key = (
  grid: BandGridData,
  { mu = 0, interpolation_factor = 1, wigner_seitz = false }: FermiSurfaceOptions,
): string => `${mu}|${resolved_factor(grid, interpolation_factor)}|${wigner_seitz}`

// Whether an extraction at this factor has completed for the grid, i.e. a new one only reruns
// marching cubes instead of upsampling every band first
export const fermi_extraction_warm = (
  grid: BandGridData,
  interpolation_factor = 1,
): boolean => {
  const token = grid_tokens.get(grid)
  if (token === undefined || !sent_tokens.has(token)) return false
  return warm_factors.get(grid)?.has(resolved_factor(grid, interpolation_factor)) ?? false
}

// extract_fermi_surface in the worker. Results are cached per grid (see RESULT_CACHE_SIZE),
// so callers must treat them as read-only. The worker keeps its own copy of each grid and the
// cache keys on grid identity and options (mu, not E_F), so in-place edits of a grid (energies,
// fermi_energy, k_lattice) go unseen: pass a new band grid object instead.
export async function extract_fermi_surface_async(
  grid: BandGridData,
  options: FermiSurfaceOptions = {},
): Promise<FermiSurfaceData> {
  const cache = result_cache.get(grid) ?? new Map<string, FermiSurfaceData>()
  result_cache.set(grid, cache)
  const key = options_key(grid, options)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key) // re-insert as most recent
    cache.set(key, cached)
    return cached
  }
  let token = grid_tokens.get(grid)
  if (token === undefined) {
    token = ++next_token
    grid_tokens.set(grid, token)
  }
  const { mu, interpolation_factor, wigner_seitz } = options
  const request = (send_grid: boolean) => {
    if (send_grid) {
      sent_tokens.delete(token) // re-insert as newest, as the worker's grid store does
      sent_tokens.add(token)
      const [oldest] = sent_tokens // Sets iterate in insertion order
      if (sent_tokens.size > WORKER_GRIDS) sent_tokens.delete(oldest)
      warm_factors.delete(grid)
    }
    return run_extraction(
      { token, grid, send_grid },
      { mu, interpolation_factor, wigner_seitz },
    )
  }
  const send_grid = !sent_tokens.has(token)
  let result: FermiSurfaceData
  try {
    result = await request(send_grid)
  } catch (error) {
    // A failed worker is torn down and its successor holds no grids; a live one may have
    // evicted this grid for newer ones. Either way a request without the grid gets one retry
    // with it, and every other grid is sent afresh next time.
    sent_tokens.clear()
    if (send_grid) throw error
    result = await request(true)
  }
  cache.set(key, result)
  const [oldest] = cache.keys() // Maps iterate in insertion order
  if (cache.size > RESULT_CACHE_SIZE) cache.delete(oldest)
  const factors = warm_factors.get(grid) ?? new Set<number>()
  warm_factors.set(grid, factors.add(resolved_factor(grid, interpolation_factor ?? 1)))
  const [oldest_factor] = factors // Sets iterate in insertion order; a re-add keeps its place
  if (factors.size > PREPARED_FACTORS_PER_BAND) factors.delete(oldest_factor)
  return result
}

// A viewer's unmount path: ends the worker unless another viewer's extraction is in flight.
// A new worker holds no grids, so all are sent again and start cold.
export function release_fermi_worker(): void {
  run_extraction.release()
  sent_tokens.clear()
}

// Latest-wins scheduling for one viewer: at most one extraction in flight, and a request made
// meanwhile waits in place of any request already waiting, so a pointer sweeping energies
// faster than they extract skips the stale ones instead of queueing them all. A replaced
// request resolves null; cached results resolve at once without waiting, and drop the waiting
// request, which they supersede.
export function create_latest_extractor(): (
  grid: BandGridData,
  options: FermiSurfaceOptions,
) => Promise<FermiSurfaceData | null> {
  let busy = false
  let waiting: { run: () => void; drop: () => void } | undefined
  return (grid, options) => {
    if (result_cache.get(grid)?.has(options_key(grid, options))) {
      waiting?.drop()
      waiting = undefined
      return extract_fermi_surface_async(grid, options)
    }
    return new Promise((resolve, reject) => {
      const run = () => {
        busy = true
        extract_fermi_surface_async(grid, options)
          .then(resolve, reject)
          .finally(() => {
            busy = false
            const next = waiting
            waiting = undefined
            next?.run()
          })
      }
      if (!busy) return run()
      waiting?.drop()
      waiting = { run, drop: () => resolve(null) }
    })
  }
}
