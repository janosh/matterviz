// Headless viewer state over a TrajectoryRun: the frame cache, latest-request-wins frame
// loading, scrub (rAF-coalesced) vs commit (settled) stepping, prefetch, playback (through
// the shared sequence player) and the imperative controller hosts use. No DOM, so it is
// unit-testable on its own; Trajectory.svelte only renders what it exposes.
import { create_sequence_player } from '$lib/layout/sequence-player.svelte'
import { clamp } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { to_error } from '$lib/utils'
import { untrack } from 'svelte'
import type { TrajectoryController, TrajectoryFrame, TrajectoryMetadata } from './index'
import type { TrajectoryRun } from './run'

interface TrajectorySessionInputs {
  run: () => TrajectoryRun | undefined
  // The bound step index (current_step_idx) and its writer
  index: () => number
  set_index: (idx: number) => void
  fps: () => number
  set_fps: (fps: number) => void
  fps_range: () => readonly [number, number]
  should_auto_play: () => boolean
  on_play?: () => void
  on_pause?: () => void
  on_end?: () => void
  on_loop?: () => void
  // Fired after every committed index change (slider, keyboard, plot click, controller, clamp)
  on_step_change?: (idx: number) => void
  on_frame_error?: (frame_idx: number, error: Error) => void
}

interface TrajectorySessionOptions {
  // LRU bounds: frame count AND total atoms (cache many tiny frames or few huge ones)
  cache_max_frames?: number
  cache_max_atoms?: number
  scrub_settle_ms?: number
  prefetch_delay_ms?: number
}

const is_promise = <Value>(value: Value | Promise<Value>): value is Promise<Value> =>
  value instanceof Promise

// One rounding for every index reaching a run (a raw 2.6 tripped read_frame's RangeError);
// null means "no frame". Non-finite resolves to 0 rather than null: null left `loaded` cleared
// AND the correction effect with nothing to write back, so the viewer stayed blank for good.
const normalize_idx = (idx: number, frame_count: number): number | null => {
  if (frame_count <= 0) return null
  return Number.isFinite(idx) ? clamp(Math.floor(idx), 0, frame_count - 1) : 0
}

export function create_trajectory_session(
  inputs: TrajectorySessionInputs,
  options: TrajectorySessionOptions = {},
) {
  const {
    cache_max_frames = 64,
    cache_max_atoms = 200_000,
    scrub_settle_ms = 80,
    prefetch_delay_ms = 40,
  } = options

  const frame_count = $derived(inputs.run()?.frame_count ?? 0)

  // === property rows mirrored into state (runs themselves are rune-free) ===
  let property_rows = $state.raw<readonly TrajectoryMetadata[]>([])
  let properties_complete = $state(true)
  $effect(() => {
    const run = inputs.run()
    if (!run) {
      property_rows = []
      properties_complete = true
      return undefined
    }
    property_rows = run.properties.rows
    properties_complete = run.properties.complete
    return run.properties.subscribe((_batch, complete) => {
      property_rows = run.properties.rows
      properties_complete = complete || run.properties.complete
    })
  })

  // === frame cache (per run; swapping runs drops it) ===
  // Plain Map: nothing reactive reads it, and a SvelteMap would mint a signal per frame index
  const cache = new Map<number, TrajectoryFrame>()
  let cache_owner: TrajectoryRun | undefined
  let cache_atoms = 0
  const claim_cache = (run: TrajectoryRun): void => {
    if (cache_owner === run) return
    cache.clear()
    cache_atoms = 0
    cache_owner = run
  }
  const cache_get = (frame_idx: number): TrajectoryFrame | undefined => {
    const hit = cache.get(frame_idx)
    if (!hit) return undefined
    cache.delete(frame_idx) // re-insert refreshes recency
    cache.set(frame_idx, hit)
    return hit
  }
  const cache_put = (run: TrajectoryRun, frame_idx: number, frame: TrajectoryFrame): void => {
    if (cache_owner !== run) return
    const previous = cache.get(frame_idx)
    if (previous) {
      cache_atoms -= previous.structure.sites.length
      cache.delete(frame_idx)
    }
    cache.set(frame_idx, frame)
    cache_atoms += frame.structure.sites.length
    while (
      cache.size > 1 &&
      (cache.size > cache_max_frames || cache_atoms > cache_max_atoms)
    ) {
      const oldest_idx = cache.keys().next().value
      if (oldest_idx === undefined) break
      cache_atoms -= cache.get(oldest_idx)?.structure.sites.length ?? 0
      cache.delete(oldest_idx)
    }
  }

  // === current frame: latest request wins, stale async reads are aborted ===
  // Raw: frames can hold thousands of sites and deep-proxying each one makes scrubbing pay
  // proxy traps throughout structure normalization, bonding and scene-buffer updates.
  let loaded = $state.raw<{ run: TrajectoryRun; idx: number; frame: TrajectoryFrame } | null>(
    null,
  )
  let loading = $state(false)
  let in_flight: AbortController | undefined
  let prefetch_timer: ReturnType<typeof setTimeout> | undefined
  let prefetching = false

  const cancel_in_flight = (): void => {
    in_flight?.abort(new DOMException(`Superseded by a newer frame request`, `AbortError`))
    in_flight = undefined
    loading = false
  }
  const cancel_prefetch = (): void => {
    if (prefetch_timer !== undefined) clearTimeout(prefetch_timer)
    prefetch_timer = undefined
  }

  const settle = (run: TrajectoryRun, frame_idx: number, frame: TrajectoryFrame): void => {
    cache_put(run, frame_idx, frame)
    loaded = { run, idx: frame_idx, frame }
  }

  function request_frame(run: TrajectoryRun | undefined, requested_idx: number): void {
    cancel_in_flight()
    cancel_prefetch()
    const frame_idx = run ? normalize_idx(requested_idx, run.frame_count) : null
    if (!run || frame_idx === null) {
      loaded = null
      return
    }
    claim_cache(run)
    const cached = cache_get(frame_idx)
    if (cached) {
      loaded = { run, idx: frame_idx, frame: cached }
      schedule_prefetch(run, frame_idx)
      return
    }
    let pending: Promise<TrajectoryFrame>
    const controller = new AbortController()
    try {
      const result = run.read_frame(frame_idx, controller.signal)
      if (!is_promise(result)) return settle(run, frame_idx, result)
      pending = result
    } catch (error) {
      inputs.on_frame_error?.(frame_idx, to_error(error))
      return
    }
    in_flight = controller
    loading = true
    pending.then(
      (frame) => {
        // Cache even a superseded frame: it is still valid data for that index
        cache_put(run, frame_idx, frame)
        if (in_flight !== controller) return
        in_flight = undefined
        loading = false
        loaded = { run, idx: frame_idx, frame }
        schedule_prefetch(run, frame_idx)
      },
      (error: unknown) => {
        if (in_flight !== controller) return
        in_flight = undefined
        loading = false
        inputs.on_frame_error?.(frame_idx, to_error(error))
      },
    )
  }

  // Warm the next frame or two once a step has settled. The delay lets a slider burst cancel
  // speculative work before it occupies the read lane; at most one async read is in flight.
  function schedule_prefetch(run: TrajectoryRun, from_idx: number): void {
    if (scrubbing || prefetching) return
    cancel_prefetch()
    prefetch_timer = setTimeout(() => {
      prefetch_timer = undefined
      for (const ahead of [1, 2]) {
        const idx = from_idx + ahead
        if (idx >= run.frame_count || cache.has(idx) || cache_owner !== run) continue
        try {
          const result = run.read_frame(idx)
          if (!is_promise(result)) {
            cache_put(run, idx, result)
            continue
          }
          prefetching = true
          result
            .then((frame) => cache_put(run, idx, frame))
            .catch((error: unknown) => console.warn(`Prefetch of frame ${idx} failed:`, error))
            .finally(() => {
              prefetching = false
            })
        } catch (error) {
          console.warn(`Prefetch of frame ${idx} failed:`, error)
        }
        break
      }
    }, prefetch_delay_ms)
  }

  // Normalize out-of-range and fractional indices (Number.MAX_SAFE_INTEGER means "last frame"
  // for hosts restoring viewer position across reloads); hosts hear about the correction.
  // Must precede the request effect below: effects flush in creation order.
  $effect(() => {
    const idx = inputs.index()
    const clamped = normalize_idx(idx, frame_count)
    if (clamped === null || clamped === idx) return
    untrack(() => {
      inputs.set_index(clamped)
      inputs.on_step_change?.(clamped)
    })
  })

  $effect(() => {
    const run = inputs.run()
    const frame_idx = inputs.index()
    untrack(() => request_frame(run, frame_idx))
  })

  const current_frame = $derived.by((): TrajectoryFrame | null => {
    const run = inputs.run()
    const idx = inputs.index()
    return loaded && loaded.run === run && loaded.idx === idx ? loaded.frame : null
  })

  // Structure on display: holds the last resolved structure of the SAME run so the 3D view
  // does not blank while an uncached frame loads. A swapped run shows its preview frame until
  // the requested frame lands — derived, not effect-written, so the scene fits its camera to
  // the new run's coordinates in the same pass that changes its series key, never to the old
  // run's.
  let displayed: { run: TrajectoryRun | undefined; structure: AnyStructure | undefined } = {
    run: undefined,
    structure: undefined,
  }
  const current_structure = $derived.by((): AnyStructure | undefined => {
    const run = inputs.run()
    const frame = current_frame
    if (frame) displayed = { run, structure: frame.structure }
    else if (displayed.run !== run) displayed = { run, structure: run?.preview.structure }
    return displayed.structure
  })

  // === scrub vs commit ===
  let scrubbing = $state(false)
  let scrub_raf: number | undefined
  let scrub_settle: ReturnType<typeof setTimeout> | undefined
  let pending_scrub: number | undefined

  // Not normalize_idx's map-to-0: `scrub(NaN)` must not silently jump the viewer to frame 0
  function commit_index(idx: number): void {
    if (!Number.isFinite(idx)) return
    const bounded = normalize_idx(idx, frame_count)
    if (bounded === null || bounded === inputs.index()) return
    inputs.set_index(bounded)
    inputs.on_step_change?.(bounded)
  }

  const end_scrub = (): void => {
    if (scrub_raf !== undefined) cancelAnimationFrame(scrub_raf)
    if (scrub_settle !== undefined) clearTimeout(scrub_settle)
    scrub_raf = undefined
    scrub_settle = undefined
    pending_scrub = undefined
  }

  // Slider/pointer bursts: one index write per animation frame, "scrubbing" stays on until
  // the burst has been quiet for scrub_settle_ms so consumers can defer expensive work.
  function scrub(idx: number): void {
    if (idx === pending_scrub) return
    pending_scrub = idx
    if (scrub_raf !== undefined) return
    scrubbing = true
    cancel_prefetch()
    if (scrub_settle !== undefined) clearTimeout(scrub_settle)
    scrub_settle = undefined
    scrub_raf = requestAnimationFrame(() => {
      scrub_raf = undefined
      const next = pending_scrub
      pending_scrub = undefined
      try {
        if (next !== undefined) commit_index(next)
      } finally {
        scrub_settle = setTimeout(() => {
          scrub_settle = undefined
          scrubbing = false
          const run = inputs.run()
          if (run) schedule_prefetch(run, inputs.index())
        }, scrub_settle_ms)
      }
    })
  }

  // Explicit navigation (keys, buttons, plot click, controller): settle immediately
  function commit(idx = pending_scrub): void {
    end_scrub()
    scrubbing = false
    if (idx !== undefined) commit_index(idx)
  }

  const player = create_sequence_player({
    count: () => frame_count,
    index: inputs.index,
    set_index: commit,
    fps: inputs.fps,
    set_fps: inputs.set_fps,
    fps_range: inputs.fps_range,
    should_auto_play: () => inputs.should_auto_play() && inputs.run() !== undefined,
    on_play: inputs.on_play,
    on_pause: inputs.on_pause,
    on_end: inputs.on_end,
    on_loop: inputs.on_loop,
  })

  const controller: TrajectoryController = {
    set_step: (step_idx) => {
      if (!Number.isFinite(step_idx)) {
        throw new TypeError(`Step index must be finite, got ${step_idx}`)
      }
      const bounded = normalize_idx(step_idx, frame_count) ?? 0
      player.go_to(bounded)
      return bounded
    },
    state: () => ({ current_step_idx: inputs.index(), total_frames: frame_count }),
    play: player.play,
    pause: player.pause,
  }

  // Any frame, for export: cached when available, otherwise read through the run without
  // disturbing the displayed frame. A run swap mid-export must not emit the old run's frames
  // into the new one's file, so the frame is only returned while the run is still current.
  async function resolve_frame(frame_idx: number): Promise<TrajectoryFrame | null> {
    const run = inputs.run()
    if (!run || frame_idx < 0 || frame_idx >= run.frame_count) return null
    claim_cache(run)
    const cached = cache_get(frame_idx)
    if (cached) return cached
    const frame = await run.read_frame(frame_idx)
    if (inputs.run() !== run) return null
    cache_put(run, frame_idx, frame) // so re-exporting a range does not re-parse it
    return frame
  }

  $effect(() => () => dispose())

  function dispose(): void {
    end_scrub()
    cancel_in_flight()
    cancel_prefetch()
    cache.clear()
    cache_atoms = 0
    cache_owner = undefined
  }

  return {
    get frame_count() {
      return frame_count
    },
    get current_frame() {
      return current_frame
    },
    get current_structure() {
      return current_structure
    },
    get loading() {
      return loading
    },
    get scrubbing() {
      return scrubbing
    },
    get property_rows() {
      return property_rows
    },
    get properties_complete() {
      return properties_complete
    },
    get cached_frames() {
      return cache.size
    },
    player,
    controller,
    scrub,
    commit,
    resolve_frame,
    dispose,
  }
}
