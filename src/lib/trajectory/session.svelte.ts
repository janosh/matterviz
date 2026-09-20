import { cache_prepared_bonds } from '$lib/structure/bonding'
import { cache_prepared_polyhedra } from '$lib/structure/polyhedra'
import { BondFrame } from '$lib/structure/bond-rendering'
import { numeric_sites } from '$lib/structure/site'
import {
  display_cache_budget,
  display_frame_bytes,
  type DisplayFrame,
  type FramePreparation,
} from './prepare'
import {
  encode_frame,
  FrameView,
  materialize_frame,
  type NumericFrame,
  type FrameChannels,
} from './frame'
// Headless viewer state over a TrajectoryRun: the frame cache, latest-request-wins frame
// loading, scrub (rAF-coalesced) vs commit (settled) stepping, prefetch, playback (through
// the shared sequence player) and the imperative controller hosts use. No DOM, so it is
// unit-testable on its own; Trajectory.svelte only renders what it exposes.
import { create_sequence_player } from '$lib/layout/sequence-player.svelte'
import { clamp } from '$lib/math'
import { to_error } from '$lib/utils'
import { untrack } from 'svelte'
import type { TrajectoryController, TrajectoryFrame, TrajectoryMetadata } from './index'
import type { TrajectoryRun } from './run'

// Playback inputs bind current_step_idx through index and set_index.
interface TrajectorySessionInputs extends Omit<
  Parameters<typeof create_sequence_player>[0],
  'count'
> {
  run: () => TrajectoryRun | undefined
  // A visible renderer acknowledges complete scene submission before playback advances.
  wait_for_render?: () => boolean
  preparation?: () => FramePreparation | undefined
  channels?: () => FrameChannels | undefined
  // Fired after every committed index change (slider, keyboard, plot click, controller, clamp)
  on_step_change?: (idx: number) => void
  on_frame_error?: (frame_idx: number, error: Error) => void
}

type SessionFrame = DisplayFrame & { request_key: string }

interface TrajectorySessionOptions {
  // Bound both numeric buffers and the number of materialized site records.
  cache_max_frames?: number
  cache_max_site_records?: number
  cache_max_bytes?: number
  scrub_settle_ms?: number
  prefetch_delay_ms?: number
}

const site_record_count = ({ frame }: DisplayFrame): number =>
  Array.isArray(frame.sites) ? frame.sites.length : 0

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
    cache_max_site_records = 200_000,
    // Numeric playback can retain several prepared frames; this bounds their buffers,
    // independently of decoder heaps and GPU resources.
    cache_max_bytes = display_cache_budget(),
    scrub_settle_ms = 80,
    prefetch_delay_ms = 40,
  } = options

  const frame_count = $derived(inputs.run()?.frame_count ?? 0)
  const frame_view = new FrameView()
  let rendered: unknown
  let frame_failure: Error | undefined
  let disposed = false
  const render_waiters = new Set<{
    run: TrajectoryRun
    idx: number
    settle: (error?: Error) => void
  }>()
  const cancel_render_waiters = (error: Error): void => {
    for (const waiter of render_waiters) waiter.settle(error)
  }
  const channels = $derived(inputs.channels?.())
  const preparation = $derived.by(() => {
    const settings = inputs.preparation?.()
    return settings && channels ? { ...settings, channels } : settings
  })
  const request_key = $derived(JSON.stringify(preparation ?? { channels }))
  const matches_request = (frame: SessionFrame): boolean => frame.request_key === request_key
  const read_display = (
    run: TrajectoryRun,
    idx: number,
    signal: AbortSignal,
  ): SessionFrame | Promise<SessionFrame> => {
    const key = request_key
    if (preparation) {
      if (!run.prepare_frame) throw new Error(`Trajectory source cannot prepare frames`)
      return run
        .prepare_frame(idx, preparation, signal)
        .then((frame) => ({ ...frame, request_key: key }))
    }
    const frame = run.read_frame(idx, signal, channels)
    return is_promise(frame)
      ? frame.then((received) => ({ frame: received, request_key: key }))
      : { frame, request_key: key }
  }

  // === property rows mirrored into state (runs themselves are rune-free) ===
  let properties = $state.raw<{ rows: readonly TrajectoryMetadata[]; complete: boolean }>({
    rows: [],
    complete: true,
  })
  $effect(() => {
    const source = inputs.run()?.properties
    const update = () => {
      properties = { rows: source?.rows ?? [], complete: source?.complete ?? true }
    }
    update()
    return source?.subscribe(update)
  })

  // === frame cache (per run; swapping runs drops it) ===
  // Plain Map: nothing reactive reads it, and a SvelteMap would mint a signal per frame index
  const cache = new Map<number, SessionFrame>()
  let cache_owner: TrajectoryRun | undefined
  let cache_site_records = 0
  let cache_bytes = 0
  const clear_frames = (owner?: TrajectoryRun): void => {
    cache.clear()
    frame_view.clear()
    loaded = null
    rendered = undefined
    cache_site_records = 0
    cache_bytes = 0
    cache_owner = owner
  }
  const claim_cache = (run: TrajectoryRun): void => {
    if (cache_owner !== run) clear_frames(run)
  }
  const cache_get = (frame_idx: number): SessionFrame | undefined => {
    const hit = cache.get(frame_idx)
    if (!hit) return undefined
    cache.delete(frame_idx) // re-insert refreshes recency
    cache.set(frame_idx, hit)
    return hit
  }
  const trim_cache = (
    protected_idx: number | undefined,
    reserved_frames = 0,
    reserved_bytes = 0,
    reserved_records = 0,
    protected_frames?: ReadonlySet<number>,
  ): boolean => {
    const fits = () =>
      cache.size + reserved_frames <= cache_max_frames &&
      cache_bytes + reserved_bytes <= cache_max_bytes &&
      cache_site_records + reserved_records <= cache_max_site_records
    for (const [idx, frame] of cache) {
      if (fits()) break
      if (idx === protected_idx || protected_frames?.has(idx)) continue
      cache.delete(idx)
      cache_bytes -= display_frame_bytes(frame)
      cache_site_records -= site_record_count(frame)
    }
    return fits()
  }
  const cache_put = (
    run: TrajectoryRun,
    frame_idx: number,
    frame: SessionFrame,
    protected_idx = frame_idx,
    protected_frames?: ReadonlySet<number>,
  ): void => {
    if (cache_owner !== run) return
    const previous = cache.get(frame_idx)
    if (previous) {
      cache_site_records -= site_record_count(previous)
      cache_bytes -= display_frame_bytes(previous)
      cache.delete(frame_idx)
    }
    cache.set(frame_idx, frame)
    cache_site_records += site_record_count(frame)
    cache_bytes += display_frame_bytes(frame)
    trim_cache(protected_idx, 0, 0, 0, protected_frames)
  }

  // === current frame: latest request wins, stale async reads are aborted ===
  // Raw: frames can hold thousands of sites and deep-proxying each one makes scrubbing pay
  // proxy traps throughout structure normalization, bonding and scene-buffer updates.
  let loaded = $state.raw<(SessionFrame & { run: TrajectoryRun; idx: number }) | null>(null)
  let in_flight = $state.raw<AbortController>()
  let prefetch_timer: ReturnType<typeof setTimeout> | undefined
  type PrefetchRequest = {
    run: TrajectoryRun
    key: string
    bytes: number
    records: number
    controller: AbortController
    result: SessionFrame | Promise<SessionFrame>
  }
  const prefetched = new Map<number, PrefetchRequest>()

  const cancel_in_flight = (): void => {
    in_flight?.abort(new DOMException(`Superseded by a newer frame request`, `AbortError`))
    in_flight = undefined
  }
  const cancel_prefetch = (): void => {
    if (prefetch_timer !== undefined) clearTimeout(prefetch_timer)
    prefetch_timer = undefined
    for (const request of prefetched.values())
      request.controller.abort(new DOMException(`Prefetch cancelled`, `AbortError`))
    prefetched.clear()
  }

  const reserve_prefetch = (
    frames = 0,
    bytes = 0,
    records = 0,
    protected_frames?: ReadonlySet<number>,
  ): boolean => {
    for (const request of prefetched.values()) {
      frames++
      bytes += request.bytes
      records += request.records
    }
    return trim_cache(loaded?.idx, frames, bytes, records, protected_frames)
  }
  const trim_prefetch = (limit = Infinity): void => {
    const minimum = Math.min(player.is_playing ? 1 : 0, limit)
    for (const [idx, request] of [...prefetched].toReversed()) {
      if (prefetched.size <= limit && (reserve_prefetch() || prefetched.size <= minimum)) break
      prefetched.delete(idx)
      request.controller.abort(new DOMException(`Prefetch cache limit`, `AbortError`))
    }
  }

  const settle = (run: TrajectoryRun, frame_idx: number, frame: SessionFrame): void => {
    cache_put(run, frame_idx, frame)
    loaded = { run, idx: frame_idx, ...frame }
  }
  const fail_frame = (frame_idx: number, error: unknown): void => {
    player.pause()
    frame_failure = to_error(error)
    cancel_render_waiters(frame_failure)
    inputs.on_frame_error?.(frame_idx, frame_failure)
  }

  function request_frame(run: TrajectoryRun | undefined, requested_idx: number): void {
    cancel_in_flight()
    frame_failure = undefined
    const frame_idx = run ? normalize_idx(requested_idx, run.frame_count) : null
    for (const waiter of render_waiters) {
      // Initial mounting can refine geometry settings while the first frame is loading.
      // Keep waiting for that frame's current scene; only navigation supersedes the wait.
      if (waiter.run !== run || waiter.idx !== frame_idx)
        waiter.settle(new DOMException(`Displayed frame request superseded`, `AbortError`))
    }
    const candidate = frame_idx === null ? undefined : prefetched.get(frame_idx)
    const next =
      candidate?.run === run && candidate?.key === request_key ? candidate : undefined
    const cached = frame_idx !== null && cache_owner === run ? cache_get(frame_idx) : undefined
    const cache_hit = cached && matches_request(cached)
    if (next && frame_idx !== null) prefetched.delete(frame_idx)
    // Sequential playback retains the remainder of its pipeline. Seeks and settings/run
    // changes cancel it immediately, including work still opening a preparation worker.
    if (
      (!next && !cache_hit) ||
      !player.is_playing ||
      !loaded ||
      loaded.run !== run ||
      frame_idx !== (loaded.idx + 1) % (run?.frame_count ?? 1)
    )
      cancel_prefetch()
    if (!run || frame_idx === null) {
      clear_frames()
      // These lazy derived values can retain frames after their renderer stops reading them.
      current_frame = null
      scene_frame = null
      displayed_frame = null
      return
    }
    claim_cache(run)
    if (cache_hit) {
      loaded = { run, idx: frame_idx, ...cached }
      schedule_prefetch(run, frame_idx)
      return
    }
    let pending: Promise<SessionFrame>
    const controller = next?.controller ?? new AbortController()
    try {
      const result = next?.result ?? read_display(run, frame_idx, controller.signal)
      if (!is_promise(result)) {
        settle(run, frame_idx, result)
        if (player.is_playing) schedule_prefetch(run, frame_idx)
        return
      }
      pending = result
    } catch (error) {
      return fail_frame(frame_idx, error)
    }
    in_flight = controller
    pending.then(
      (frame) => {
        // Cancelled preparation may still finish on the primary worker; never retain it.
        if (!controller.signal.aborted && matches_request(frame))
          cache_put(run, frame_idx, frame)
        if (in_flight !== controller) return
        in_flight = undefined
        loaded = { run, idx: frame_idx, ...frame }
        schedule_prefetch(run, frame_idx)
      },
      (error: unknown) => {
        if (in_flight !== controller) return
        in_flight = undefined
        fail_frame(frame_idx, error)
      },
    )
  }

  // During playback, overlap bounded preparation with rendering and adopt it on advance.
  // Keep the pipeline outside the LRU so it cannot evict the displayed frame.
  // Paused navigation retains its delay and cache budget so slider bursts cancel speculation.
  function schedule_prefetch(run: TrajectoryRun, from_idx: number): void {
    if (scrubbing) return
    if (prefetch_timer !== undefined) clearTimeout(prefetch_timer)
    prefetch_timer = undefined
    const current = cache.get(from_idx)
    const records = current ? site_record_count(current) : run.atom_count
    // Read a second ahead to absorb variable decoding and neighbor-list rebuild costs.
    // Keep at least two waves busy; reservations bound both pending and completed frames.
    const playback_window =
      preparation && run.preparation_concurrency
        ? Math.max(2 * run.preparation_concurrency, Math.ceil(player.fps))
        : 1
    const prefetch_limit = Math.min(
      player.is_playing ? playback_window : 2,
      cache_max_frames - 1,
      run.frame_count - 1,
    )
    trim_prefetch(prefetch_limit)
    if (prefetch_limit < 1) return
    const read_ahead = () => {
      prefetch_timer = undefined
      const protected_frames = new Set<number>()
      let bytes: number | undefined
      for (let ahead = 1; ahead <= prefetch_limit; ahead++) {
        const idx = (from_idx + ahead) % run.frame_count
        if (idx === from_idx || prefetched.has(idx) || cache_owner !== run) continue
        const cached = cache.get(idx)
        if (cached && matches_request(cached)) {
          protected_frames.add(idx)
          continue
        }
        // Reserve only missing frames: a complete loop that fits remains reusable.
        // Playback permits one next frame even when the current frame exceeds its budget.
        bytes ??= current ? display_frame_bytes(current) : 0
        if (
          !reserve_prefetch(1, bytes, records, protected_frames) &&
          (!player.is_playing || prefetched.size > 0 || protected_frames.size > 0)
        )
          break
        const controller = new AbortController()
        try {
          const result = read_display(run, idx, controller.signal)
          if (!is_promise(result)) {
            cache_put(run, idx, result, from_idx, protected_frames)
            if (cache.has(idx)) protected_frames.add(idx)
            continue
          }
          const request: PrefetchRequest = {
            run,
            key: request_key,
            controller,
            result,
            bytes,
            records,
          }
          prefetched.set(idx, request)
          result
            .then((frame) => {
              if (prefetched.get(idx) !== request) return
              request.result = frame
              request.bytes = display_frame_bytes(frame)
              request.records = site_record_count(frame)
              // Actual vector/bond output may exceed the current frame's estimate.
              trim_prefetch()
              if (prefetched.get(idx) !== request || player.is_playing) return
              prefetched.delete(idx)
              cache_put(run, idx, frame, from_idx)
            })
            .catch((error: unknown) => {
              if (prefetched.get(idx) !== request) return
              prefetched.delete(idx)
              if (!controller.signal.aborted)
                console.warn(`Prefetch of frame ${idx} failed:`, error)
            })
        } catch (error) {
          console.warn(`Prefetch of frame ${idx} failed:`, error)
        }
        if (!player.is_playing) break
      }
    }
    if (player.is_playing) read_ahead()
    else prefetch_timer = setTimeout(read_ahead, prefetch_delay_ms)
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
    void request_key
    untrack(() => request_frame(run, frame_idx))
  })

  let current_frame = $derived.by((): NumericFrame | null => {
    const run = inputs.run()
    const idx = inputs.index()
    return loaded && loaded.run === run && loaded.idx === idx && matches_request(loaded)
      ? loaded.frame
      : null
  })

  // Keep the last loaded snapshot while another index is requested. All scene consumers
  // share this identity; a new run gets its own preview rather than the previous run's frame.
  const preview_frame = $derived.by(
    (): (DisplayFrame & { run: TrajectoryRun; idx: number }) | null => {
      const run = inputs.run()
      return run && !run.preview.metadata?.render_sample
        ? { run, idx: 0, frame: encode_frame(run.preview) }
        : null
    },
  )
  let scene_frame = $derived(loaded?.run === inputs.run() ? loaded : preview_frame)
  let displayed_frame = $derived.by(() => {
    if (!scene_frame) return null
    const frame = frame_view.update(scene_frame.frame)
    const columns = numeric_sites.get(frame.structure)
    if (columns) {
      columns.display_metrics = scene_frame.metrics
      columns.vector_geometry = scene_frame.vector_geometry
    }
    const { bonds, bond_placements, preparation: prepared_with } = scene_frame
    if (bonds && prepared_with) {
      const bond_frame = new BondFrame(frame.structure, bonds, bond_placements)
      cache_prepared_bonds(
        frame.structure,
        prepared_with.bonding_strategy,
        prepared_with.bonding_options,
        bond_frame,
      )
      if (scene_frame.polyhedra && prepared_with.polyhedra)
        cache_prepared_polyhedra(bond_frame, prepared_with.polyhedra, scene_frame.polyhedra)
    }
    return frame
  })
  const mark_rendered = (snapshot: unknown): boolean => {
    if (!snapshot || snapshot !== scene_frame || snapshot === rendered || !current_frame)
      return false
    rendered = snapshot
    for (const waiter of render_waiters) {
      if (waiter.run === scene_frame?.run && waiter.idx === scene_frame.idx) waiter.settle()
    }
    return true
  }

  // Exporters wait for the requested scene submission, not just a completed source read.
  function wait_for_frame(idx: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const run = inputs.run()
    if (frame_failure) return Promise.reject(frame_failure)
    if (disposed || !run || idx !== inputs.index())
      return Promise.reject(new Error(`Frame ${idx} is not the requested display frame`))
    if (
      current_frame &&
      scene_frame?.run === run &&
      scene_frame.idx === idx &&
      rendered === scene_frame
    )
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      const finish = (error?: Error): void => {
        render_waiters.delete(waiter)
        signal.removeEventListener(`abort`, abort)
        if (error) reject(error)
        else resolve()
      }
      const abort = () => finish(to_error(signal.reason))
      const waiter = { run, idx, settle: finish }
      render_waiters.add(waiter)
      signal.addEventListener(`abort`, abort, { once: true })
    })
  }

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
    can_advance: () =>
      inputs.can_advance?.() !== false &&
      current_frame !== null &&
      (!inputs.wait_for_render?.() || rendered === scene_frame),
    on_play: () => {
      inputs.on_play?.()
      const run = inputs.run()
      if (!run) return
      if (current_frame) schedule_prefetch(run, inputs.index())
      else if (!in_flight) request_frame(run, inputs.index())
    },
    on_pause: () => {
      cancel_prefetch()
      inputs.on_pause?.()
    },
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

  // Export complete source frames: reuse only unwrapped cache entries, otherwise read
  // without changing the display cache. Run changes and disposal invalidate pending exports.
  async function resolve_frame(
    frame_idx: number,
    signal?: AbortSignal,
  ): Promise<TrajectoryFrame | null> {
    signal?.throwIfAborted()
    const run = inputs.run()
    if (disposed || !run || frame_idx < 0 || frame_idx >= run.frame_count) return null
    claim_cache(run)
    const cached = cache_get(frame_idx)
    if (
      cached &&
      !cached.frame.wrapped &&
      !cached.frame.available_vector_keys?.some(
        (key) => !cached.frame.vector_keys.includes(key),
      )
    )
      return materialize_frame(cached.frame)
    const frame = await run.read_frame(frame_idx, signal)
    signal?.throwIfAborted()
    if (disposed || inputs.run() !== run) return null
    // Source exports must not replace prepared display packets or evict the visible frame.
    return materialize_frame(frame)
  }

  $effect(() => () => dispose())

  function dispose(): void {
    disposed = true
    cancel_render_waiters(new DOMException(`Trajectory display disposed`, `AbortError`))
    end_scrub()
    cancel_in_flight()
    cancel_prefetch()
    clear_frames()
    displayed_frame = null
  }

  return {
    get frame_count() {
      return frame_count
    },
    get current_frame() {
      return current_frame ? displayed_frame : null
    },
    get numeric_frame() {
      return current_frame
    },
    get current_structure() {
      return displayed_frame?.structure
    },
    get scene_frame() {
      return scene_frame
    },
    mark_rendered,
    wait_for_frame,
    get loading() {
      return in_flight !== undefined
    },
    get scrubbing() {
      return scrubbing
    },
    get property_rows() {
      return properties.rows
    },
    get properties_complete() {
      return properties.complete
    },
    get cached_frames() {
      return cache.size
    },
    get cached_bytes() {
      return cache_bytes
    },
    player,
    controller,
    scrub,
    commit,
    resolve_frame,
    dispose,
  }
}
