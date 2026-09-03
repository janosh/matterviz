// Headless session: cache LRU + reset on run swap, latest-request-wins with aborted stale
// reads, scrub vs commit, prefetch, controller, property mirroring and playback wrap through
// the shared sequence player (whose own behaviour is covered by sequence-player.test).
import { trajectory_from_frames } from '$lib/trajectory/open'
import { summarize_run, TrajectoryProperties, type TrajectoryRun } from '$lib/trajectory/run'
import { host_run } from '$lib/trajectory/runs/host'
import { create_trajectory_session } from '$lib/trajectory/session.svelte'
import type { TrajectoryFrame } from '$lib/trajectory'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { make_trajectory_frame } from '../setup'

const frames = (count: number, site_count = 3): TrajectoryFrame[] =>
  Array.from({ length: count }, (_unused, idx) =>
    make_trajectory_frame(idx * 10, site_count, { energy: -idx }),
  )

// Async run whose reads resolve by hand, to order races deliberately
const make_async_run = (frame_list: TrajectoryFrame[]) => {
  const backing = trajectory_from_frames(frame_list)
  const pending: { idx: number; resolve: () => void; reject: (error: Error) => void }[] = []
  const reads: number[] = []
  const run = host_run(summarize_run(backing), (idx, signal) => {
    reads.push(idx)
    return new Promise<TrajectoryFrame>((resolve, reject) => {
      const entry = {
        idx,
        resolve: () => resolve(backing.read_frame(idx)),
        reject,
      }
      pending.push(entry)
      signal?.addEventListener(`abort`, () => {
        const at = pending.indexOf(entry)
        if (at !== -1) pending.splice(at, 1)
        reject(signal.reason instanceof Error ? signal.reason : new Error(`Read aborted`))
      })
    })
  })
  const resolve_next = async (): Promise<void> => {
    pending.shift()?.resolve()
    await Promise.resolve()
    await Promise.resolve()
    flushSync()
  }
  return { run, pending, reads, resolve_next }
}

type Host = { run: TrajectoryRun | undefined; index: number; fps: number; auto_play: boolean }

function make_session(initial: Partial<Host> = {}, options = {}) {
  const host = $state<Host>({
    run: undefined,
    index: 0,
    fps: 10,
    auto_play: false,
    ...initial,
  })
  const events: string[] = []
  const errors: string[] = []
  let session!: ReturnType<typeof create_trajectory_session>
  const destroy = $effect.root(() => {
    session = create_trajectory_session(
      {
        run: () => host.run,
        index: () => host.index,
        set_index: (idx) => (host.index = idx),
        fps: () => host.fps,
        set_fps: (fps) => (host.fps = fps),
        fps_range: () => [0, 60],
        should_auto_play: () => host.auto_play,
        on_play: () => events.push(`play`),
        on_pause: () => events.push(`pause`),
        on_end: () => events.push(`end`),
        on_loop: () => events.push(`loop`),
        on_step_change: (idx) => events.push(`step:${idx}`),
        on_frame_error: (idx, error) => errors.push(`${idx}:${error.message}`),
      },
      { cache_max_frames: 4, scrub_settle_ms: 50, prefetch_delay_ms: 10, ...options },
    )
  })
  flushSync()
  return { host, session, events, errors, destroy }
}

beforeEach(() => vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] }))
afterEach(() => vi.useRealTimers())

describe(`frame loading`, () => {
  it(`serves sync runs immediately and clamps out-of-range indices with a notification`, () => {
    const run = trajectory_from_frames(frames(5))
    const { host, session, events, destroy } = make_session({
      run,
      index: Number.MAX_SAFE_INTEGER,
    })
    expect(host.index).toBe(4)
    expect(events).toEqual([`step:4`])
    expect(session.current_frame?.step).toBe(40)
    const last_frame = run.read_frame(4)
    if (last_frame instanceof Promise) throw new Error(`Expected a synchronous memory run`)
    expect(session.current_structure).toBe(last_frame.structure)
    expect(session.loading).toBe(false)
    host.index = -3
    flushSync()
    expect(host.index).toBe(0)
    expect(session.current_frame?.step).toBe(0)
    destroy()
  })

  // Effects flush in creation order, so the request effect used to see the raw 2.6 and trip
  // run.read_frame's RangeError; NaN normalized to null, which cleared the displayed frame AND
  // left the correction effect nothing to write back, so the viewer stayed blank with no way out
  // frame 0 is the synchronous preview, so the NaN row corrects without an async read
  it.each([
    [`a fractional`, 2.6, 2, [2]],
    [`a non-finite`, Number.NaN, 0, []],
  ])(`corrects %s host index instead of erroring`, (_label, index, expected, want_reads) => {
    const { run, reads } = make_async_run(frames(5))
    const { host, session, events, errors, destroy } = make_session({ run })
    host.index = index
    flushSync()
    expect(errors).toEqual([])
    expect(reads).toEqual(want_reads)
    expect(host.index).toBe(expected)
    expect(events).toEqual([`step:${expected}`])
    expect(session.current_structure).toBeDefined()
    expect(session.controller.set_step(3.9)).toBe(3)
    destroy()
  })

  it(`latest request wins: a superseded async read is aborted and never displayed`, async () => {
    const { run, pending, reads, resolve_next } = make_async_run(frames(6))
    const { host, session, errors, destroy } = make_session({ run })
    // frame 0 is the preview: shown synchronously
    expect(session.current_frame?.step).toBe(0)
    host.index = 3
    flushSync()
    expect(session.loading).toBe(true)
    expect(session.current_frame).toBeNull()
    // the 3D view keeps this run's structure while the new frame loads (toEqual: the host
    // holds the run in deep $state, so the preview read through it is a proxy)
    expect(session.current_structure).toEqual(run.preview.structure)
    host.index = 5
    flushSync()
    // the read for frame 3 was aborted (removed from pending) before a newer one started
    expect(reads).toEqual([3, 5])
    expect(pending.map(({ idx }) => idx)).toEqual([5])
    await resolve_next()
    expect(session.current_frame?.step).toBe(50)
    expect(session.loading).toBe(false)
    expect(errors).toEqual([])
    destroy()
  })

  it(`reports read failures for the current frame only`, async () => {
    const { run, pending, resolve_next } = make_async_run(frames(4))
    const { host, session, errors, destroy } = make_session({ run })
    host.index = 2
    flushSync()
    pending[0].reject(new Error(`disk on fire`))
    await resolve_next()
    expect(errors).toEqual([`2:disk on fire`])
    expect(session.current_frame).toBeNull()
    destroy()
  })

  it(`caches frames per run (LRU by count) and drops the cache on a run swap`, async () => {
    const first = make_async_run(frames(10))
    const { host, session, destroy } = make_session({ run: first.run })
    for (const idx of [1, 2, 3, 4]) {
      host.index = idx
      flushSync()
      await first.resolve_next()
    }
    expect(session.cached_frames).toBe(4) // cache_max_frames, frame 0 evicted
    expect(first.reads).toEqual([1, 2, 3, 4])
    host.index = 3 // cached: no new read
    flushSync()
    expect(first.reads).toEqual([1, 2, 3, 4])
    expect(session.current_frame?.step).toBe(30)
    const second = make_async_run(frames(10, 2))
    host.run = second.run
    flushSync()
    // index 3 of the new run is not loaded yet: its preview shows meanwhile, never the old run
    expect(session.cached_frames).toBe(0)
    expect(session.current_structure?.sites).toHaveLength(2)
    expect(session.current_frame).toBeNull()
    await second.resolve_next()
    expect(session.current_frame?.structure.sites).toHaveLength(2)
    expect(session.cached_frames).toBe(1)
    destroy()
  })

  it(`prefetches ahead after a settled step, one async read at a time`, async () => {
    const { run, reads, resolve_next } = make_async_run(frames(8))
    const { host, destroy } = make_session({ run })
    host.index = 2
    flushSync()
    await resolve_next()
    expect(reads).toEqual([2])
    vi.advanceTimersByTime(10)
    expect(reads).toEqual([2, 3])
    await resolve_next()
    expect(reads).toEqual([2, 3]) // second frame ahead waits for the next settle
    destroy()
  })
})

describe(`scrub vs commit`, () => {
  it(`coalesces a slider burst into one rAF write, settles after the quiet period, and no-ops on a non-finite index`, () => {
    const raf_callbacks: FrameRequestCallback[] = []
    const raf = vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((cb) => {
      raf_callbacks.push(cb)
      return raf_callbacks.length
    })
    const run = trajectory_from_frames(frames(20))
    const { host, session, events, destroy } = make_session({ run })
    session.scrub(4)
    session.scrub(7)
    session.scrub(9)
    expect(session.scrubbing).toBe(true)
    expect(host.index).toBe(0)
    expect(raf_callbacks).toHaveLength(1)
    raf_callbacks[0](16)
    flushSync()
    expect(host.index).toBe(9)
    expect(events).toEqual([`step:9`])
    expect(session.scrubbing).toBe(true)
    vi.advanceTimersByTime(50)
    flushSync()
    expect(session.scrubbing).toBe(false)
    // commit flushes a pending scrub immediately and clears scrubbing
    session.scrub(12)
    session.commit()
    expect(host.index).toBe(12)
    expect(session.scrubbing).toBe(false)
    session.commit(99)
    expect(host.index).toBe(19)
    session.commit(19) // no-op: no duplicate event
    expect(events).toEqual([`step:9`, `step:12`, `step:19`])
    // A non-finite index (an empty range input's valueAsNumber, or NaN from a zero-width
    // layout) is a no-op, not a silent jump to frame 0
    session.scrub(Number.NaN)
    raf_callbacks.at(-1)?.(16)
    flushSync()
    expect(host.index).toBe(19)
    session.commit(Number.NaN)
    expect(host.index).toBe(19)
    expect(events).toEqual([`step:9`, `step:12`, `step:19`])
    raf.mockRestore()
    destroy()
  })
})

describe(`controller and playback`, () => {
  it(`controller bounds the step, reports state and pauses playback on seek`, () => {
    const run = trajectory_from_frames(frames(5))
    const { host, session, events, destroy } = make_session({ run })
    expect(session.controller.set_step(99)).toBe(4)
    expect(host.index).toBe(4)
    expect(session.controller.set_step(-2.5)).toBe(0)
    expect(() => session.controller.set_step(NaN)).toThrow(/finite/)
    session.controller.play()
    flushSync()
    expect(session.player.is_playing).toBe(true)
    session.controller.set_step(2)
    flushSync()
    expect(session.player.is_playing).toBe(false)
    expect(session.controller.state()).toEqual({ current_step_idx: 2, total_frames: 5 })
    expect(events).toEqual([`step:4`, `step:0`, `play`, `pause`, `step:2`])
    destroy()
  })

  it(`auto_play starts once a run with more than one frame is present`, () => {
    const { host, session, destroy } = make_session({ auto_play: true })
    expect(session.player.is_playing).toBe(false)
    host.run = trajectory_from_frames(frames(3))
    flushSync()
    expect(session.player.is_playing).toBe(true)
    destroy()
  })
})

describe(`property mirroring`, () => {
  it(`tracks progressive property rows of the current run`, async () => {
    const backing = trajectory_from_frames(frames(3))
    const progressive = new TrajectoryProperties()
    const run = host_run(
      { ...summarize_run(backing), properties: { rows: [], complete: false } },
      async (idx) => backing.read_frame(idx),
    )
    Object.defineProperty(run, `properties`, { value: progressive })
    const { host, session, destroy } = make_session({ run })
    expect(session.property_rows).toEqual([])
    expect(session.properties_complete).toBe(false)
    progressive.push([{ frame_number: 0, step: 0, properties: { energy: 1 } }])
    flushSync()
    expect(session.property_rows).toHaveLength(1)
    progressive.finish()
    flushSync()
    expect(session.properties_complete).toBe(true)
    host.run = trajectory_from_frames(frames(2))
    flushSync()
    expect(session.property_rows).toHaveLength(2)
    expect(session.properties_complete).toBe(true)
    destroy()
  })
})

describe(`resolve_frame`, () => {
  it(`reads any frame through the cache and returns null after a run swap`, async () => {
    const { run, reads, resolve_next } = make_async_run(frames(6))
    const { host, session, destroy } = make_session({ run })
    const resolved = session.resolve_frame(4)
    await resolve_next()
    expect((await resolved)?.step).toBe(40)
    // Export reads are deliberately not cached (a whole-range export would evict playback's
    // frames), but frames playback already holds are served from the cache
    host.index = 2
    flushSync()
    await resolve_next()
    expect(await session.resolve_frame(2)).toMatchObject({ step: 20 })
    expect(reads).toEqual([4, 2])
    expect(await session.resolve_frame(6)).toBeNull()
    const swapped = session.resolve_frame(5)
    host.run = trajectory_from_frames(frames(2))
    flushSync()
    await resolve_next()
    expect(await swapped).toBeNull()
    destroy()
  })
})
