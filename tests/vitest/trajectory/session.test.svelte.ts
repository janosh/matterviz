import {
  create_numeric_md_frame,
  encode_frame,
  materialize_frame_result,
  type FrameChannels,
} from '$lib/trajectory/frame'
import {
  FramePreparer,
  display_frame_bytes,
  type DisplayFrame,
  type FramePreparation,
} from '$lib/trajectory/prepare'
// Headless session: cache LRU + reset on run swap, latest-request-wins with aborted stale
// reads, scrub vs commit, prefetch, controller, property mirroring and playback wrap through
// the shared sequence player (whose own behaviour is covered by sequence-player.test).
import { trajectory_from_frames } from '$lib/trajectory/open'
import {
  summarize_run,
  sync_run,
  TrajectoryProperties,
  type TrajectoryRun,
} from '$lib/trajectory/run'
import { host_run } from '$lib/trajectory/runs/host'
import { create_trajectory_session } from '$lib/trajectory/session.svelte'
import { get_bond_data } from '$lib/structure/bonding'
import { compute_polyhedra } from '$lib/structure/polyhedra'
import type { TrajectoryFrame } from '$lib/trajectory'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { make_trajectory_frame } from '../test-fixtures'

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
        resolve: () => resolve(materialize_frame_result(backing.read_frame(idx))),
        reject,
      }
      pending.push(entry)
      signal?.addEventListener(`abort`, () => {
        const offset = pending.indexOf(entry)
        if (offset !== -1) pending.splice(offset, 1)
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

type Host = {
  run: TrajectoryRun | undefined
  index: number
  fps: number
  auto_play: boolean
  wait_for_render: boolean
  can_advance: boolean
  preparation?: FramePreparation
  channels?: FrameChannels
}

const session_roots: (() => void)[] = []

function make_session(initial: Partial<Host> = {}, options = {}) {
  const host = $state<Host>({
    run: undefined,
    index: 0,
    fps: 10,
    auto_play: false,
    wait_for_render: false,
    can_advance: true,
    ...initial,
  })
  const events: string[] = []
  const errors: string[] = []
  let session!: ReturnType<typeof create_trajectory_session>
  const destroy = $effect.root(() => {
    session = create_trajectory_session(
      {
        run: () => host.run,
        wait_for_render: () => host.wait_for_render,
        can_advance: () => host.can_advance,
        preparation: () => host.preparation,
        channels: () => host.channels,
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
  session_roots.push(destroy)
  flushSync()
  return { host, session, events, errors }
}

beforeEach(() => vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] }))
afterEach(() => {
  for (const destroy of session_roots.splice(0)) destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe(`frame loading`, () => {
  it.each([`geometry`, `channels`])(
    `invalidates prepared prefetch and render acknowledgements when %s change`,
    async (setting) => {
      const run = trajectory_from_frames(frames(3))
      const prepare = new FramePreparer()
      const pending: { idx: number; signal?: AbortSignal; resolve: () => void }[] = []
      run.prepare_frame = (idx, preparation, signal) => {
        const request = Promise.withResolvers<DisplayFrame>()
        const frame = run.read_frame(idx)
        if (frame instanceof Promise) throw new Error(`Expected memory frame`)
        const settings = $state.snapshot(preparation)
        pending.push({
          idx,
          signal,
          resolve: () => request.resolve(prepare.prepare(frame, settings)),
        })
        return request.promise
      }
      const initial = {
        bonding_strategy: `electroneg_ratio`,
        bonding_options: {},
        polyhedra: {},
      } as const
      const { host, session } = make_session({
        run,
        preparation: initial,
        wait_for_render: true,
      })
      const settle = async (idx: number) => {
        pending[idx].resolve()
        await Promise.resolve()
        await Promise.resolve()
        flushSync()
      }
      await settle(0)
      const first = session.scene_frame
      const structure = session.current_structure
      if (!structure || !first?.polyhedra) throw new Error(`Expected prepared polyhedra`)
      const bonds = get_bond_data(structure, initial.bonding_strategy, initial.bonding_options)
      expect(compute_polyhedra(structure, bonds)).toBe(first.polyhedra)
      expect(session.mark_rendered(first)).toBe(true)
      session.player.play()
      expect(pending.map(({ idx }) => idx)).toEqual([0, 1])
      if (setting === `geometry`)
        host.preparation = { ...initial, polyhedra: { min_neighbors: 10 } }
      else host.channels = { vectors: [] }
      flushSync()
      expect(pending[1].signal?.aborted).toBe(true)
      expect(session.mark_rendered(first)).toBe(false)
      expect(session.current_frame).toBeNull()
      const displayed = session.wait_for_frame(0, new AbortController().signal)
      await settle(1) // A superseded prefetch may still finish in a decoder.
      expect(session.scene_frame).toBe(first)
      await settle(2)
      expect(session.scene_frame?.preparation).toMatchObject(
        setting === `geometry`
          ? { polyhedra: { min_neighbors: 10 } }
          : { channels: { vectors: [] } },
      )
      expect(compute_polyhedra(structure, bonds, { min_neighbors: 10 })).not.toBe(
        first.polyhedra,
      )
      expect(session.mark_rendered(session.scene_frame)).toBe(true)
      await displayed
    },
  )
  it(`reloads cached synchronous frames when channels change and exports complete data`, async () => {
    const frame_list = frames(3)
    for (const frame of frame_list)
      for (const site of frame.structure.sites) {
        site.properties.force = [1, 2, 3]
        site.properties.velocity = [4, 5, 6]
      }
    for (const site of frame_list[2].structure.sites) delete site.properties.velocity
    const run = trajectory_from_frames(frame_list)
    const read = vi.spyOn(run, `read_frame`)
    const { host, session } = make_session({ run, channels: { vectors: [] } })
    expect(session.numeric_frame?.vector_keys).toEqual([])
    expect(session.numeric_frame?.available_vector_keys).toEqual([`force`, `velocity`])
    session.commit(1)
    flushSync()
    session.commit(0)
    flushSync()
    const reads = read.mock.calls.length
    host.channels = { vectors: [`velocity`] }
    flushSync()
    expect(read).toHaveBeenCalledTimes(reads + 1)
    expect(session.numeric_frame?.vector_keys).toEqual([`velocity`])
    const displayed = session.numeric_frame
    const exported = await session.resolve_frame(0)
    expect(exported?.structure.sites[0].properties).toMatchObject({
      force: [1, 2, 3],
      velocity: [4, 5, 6],
    })
    expect(session.numeric_frame).toBe(displayed)
    session.commit(2)
    flushSync()
    // Selection allows a channel to be absent at a different step; mandatory analysis
    // channels are validated by the accumulator instead.
    expect(session.numeric_frame?.vector_keys).toEqual([])
    session.commit(0)
    flushSync()
    host.channels = undefined
    flushSync()
    expect(session.numeric_frame?.vector_keys).toEqual([`force`, `velocity`])
  })
  it(`replaces topology when switching equal-size runs with sampled previews`, () => {
    const make_run = (numbers: number[]) =>
      sync_run({
        label: `fixed-order MD`,
        frame_count: 1,
        atom_count: numbers.length,
        preview: { step: 0, metadata: { render_sample: true }, structure: { sites: [] } },
        read: () =>
          create_numeric_md_frame(
            new Float64Array(numbers.length * 3),
            Uint8Array.from(numbers),
            undefined,
            undefined,
            0,
            {},
            [],
          ),
        provenance: {},
        metadata: {},
        warnings: [],
        properties: new TrajectoryProperties(),
      })
    const { host, session } = make_session({ run: make_run([14, 32, 1]) })
    const first = session.current_structure?.sites
    expect(first?.map(({ label }) => label)).toEqual([`Si1`, `Ge2`, `H3`])
    host.run = make_run([1, 8, 6])
    flushSync()
    const second = session.current_structure?.sites
    expect(second).not.toBe(first)
    expect(second?.map(({ label }) => label)).toEqual([`H1`, `O2`, `C3`])
  })

  it(`loads complete frame zero when the host supplies only a sampled preview`, async () => {
    const backing = trajectory_from_frames(frames(2))
    const summary = summarize_run(backing)
    summary.atom_count = 1_000_000
    summary.preview = {
      ...summary.preview,
      metadata: { render_sample: true },
      structure: { ...summary.preview.structure, sites: [] },
    }
    const complete = backing.preview
    const pending = Promise.withResolvers<TrajectoryFrame>()
    const read = vi.fn(() => pending.promise)
    const run = host_run(summary, read)
    expect(run.atom_count).toBe(1_000_000)
    const { session } = make_session({ run })
    expect(read).toHaveBeenCalledWith(0, expect.any(AbortSignal))
    expect(session.current_structure).toBeUndefined()
    pending.resolve(complete)
    await pending.promise
    await Promise.resolve()
    flushSync()
    expect(session.current_frame).toEqual(complete)
    expect(session.current_structure?.sites).toHaveLength(3)
    expect(await session.resolve_frame(0)).toEqual(complete)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it(`serves sync runs immediately and clamps out-of-range indices with a notification`, () => {
    const run = trajectory_from_frames(frames(5))
    const { host, session, events } = make_session({
      run,
      index: Number.MAX_SAFE_INTEGER,
    })
    expect(host.index).toBe(4)
    expect(events).toEqual([`step:4`])
    expect(session.current_frame?.step).toBe(40)
    const last_frame = materialize_frame_result(run.read_frame(4))
    if (last_frame instanceof Promise) throw new Error(`Expected a synchronous memory run`)
    expect(session.current_structure).toEqual(last_frame.structure)
    expect(session.loading).toBe(false)
    host.index = -3
    flushSync()
    expect(host.index).toBe(0)
    expect(session.current_frame?.step).toBe(0)
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
    const { host, session, events, errors } = make_session({ run })
    host.index = index
    flushSync()
    expect(errors).toEqual([])
    expect(reads).toEqual(want_reads)
    expect(host.index).toBe(expected)
    expect(events).toEqual([`step:${expected}`])
    expect(session.current_structure).toBeDefined()
    expect(session.controller.set_step(3.9)).toBe(3)
  })

  it(`latest request wins: a superseded async read is aborted and never displayed`, async () => {
    const { run, pending, reads, resolve_next } = make_async_run(frames(6))
    const { host, session, errors } = make_session({ run })
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
  })

  it.each([false, true])(`reports current frame read failures (sync: %s)`, async (sync) => {
    const { run, pending, resolve_next } = make_async_run(frames(4))
    if (sync) {
      const read_frame = run.read_frame
      run.read_frame = (idx, ...args) => {
        if (idx === 2) throw new Error(`disk on fire`)
        return read_frame(idx, ...args)
      }
    }
    const { host, session, errors } = make_session({ run })
    host.index = 2
    flushSync()
    if (!sync) pending[0].reject(new Error(`disk on fire`))
    await resolve_next()
    expect(errors).toEqual([`2:disk on fire`])
    expect(session.current_frame).toBeNull()
  })

  it(`caches frames per run (LRU by count) and drops the cache on a run swap`, async () => {
    const first = make_async_run(frames(10))
    const { host, session } = make_session({ run: first.run })
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
  })

  it.each([false, true])(
    `bounds rich site records without restricting compact arrays: %s`,
    (compact) => {
      const frame_list = frames(4)
      if (!compact)
        for (const frame of frame_list)
          for (const site of frame.structure.sites) site.properties.custom_label = site.label
      const run = trajectory_from_frames(frame_list)
      const { host, session } = make_session({ run }, { cache_max_site_records: 3 })
      for (const idx of [1, 2, 3]) {
        host.index = idx
        flushSync()
      }
      expect(session.cached_frames).toBe(compact ? 4 : 1)
    },
  )

  it(`evicts vector-heavy frames by bytes and keeps an oversized current frame usable`, async () => {
    const frame_list = frames(3)
    const bytes = display_frame_bytes({ frame: encode_frame(frame_list[0]) })
    for (const site of frame_list[1].structure.sites) {
      site.properties.force = [1, 2, 3]
      site.properties.velocity = [4, 5, 6]
    }
    const run = trajectory_from_frames(frame_list)
    const { host, session } = make_session({ run }, { cache_max_bytes: bytes })
    expect(session.cached_bytes).toBe(bytes)
    host.index = 1
    flushSync()
    expect(session.cached_frames).toBe(1)
    expect(session.cached_bytes).toBeGreaterThan(bytes)
    expect(session.current_frame?.step).toBe(10)
    host.index = 2
    flushSync()
    expect(session.cached_frames).toBe(1)
    expect(session.cached_bytes).toBe(bytes)
    session.dispose()
    expect(session.cached_bytes).toBe(0)
  })

  it.each([
    [false, 3, 4, [2]],
    [false, 5, 4, [2]],
    [false, 6, 4, [2, 3]],
    [false, 200_000, 4, [2, 3]],
    [true, 6, 4, [2, 5, 3]],
    [true, 200_000, 1, [2]],
    [true, 200_000, 2, [2, 5, 3]],
    [true, 200_000, 4, [2, 5, 3, 4]],
    [true, 200_000, 4, [2, 5, 3], 2],
  ] as const)(
    `prefetch preserves the displayed frame: sync=%s, site records=%i, frames=%i`,
    async (
      synchronous,
      cache_max_site_records,
      cache_max_frames,
      expected_reads,
      byte_frames: number = Infinity,
    ) => {
      const frame_list = frames(8)
      for (const frame of frame_list)
        for (const site of frame.structure.sites) site.properties.custom_label = site.label
      const delayed = make_async_run(frame_list)
      const run = synchronous ? trajectory_from_frames(frame_list) : delayed.run
      const read_frame = vi.spyOn(run, `read_frame`)
      const { host, session } = make_session(
        { run },
        {
          cache_max_site_records,
          cache_max_frames,
          cache_max_bytes:
            display_frame_bytes({ frame: encode_frame(run.preview) }) * byte_frames,
        },
      )
      read_frame.mockClear()
      host.index = 2
      flushSync()
      // Revisit a cached frame whose immediate successor has not been loaded yet.
      const revisiting = synchronous && cache_max_frames > 1
      if (revisiting) {
        host.index = 5
        flushSync()
        host.index = 2
        flushSync()
      }
      await delayed.resolve_next()
      expect(read_frame.mock.calls.map(([idx]) => idx)).toEqual(revisiting ? [2, 5] : [2])
      vi.advanceTimersByTime(10)
      await delayed.resolve_next()
      expect((await session.resolve_frame(2))?.step).toBe(20)
      expect(read_frame.mock.calls.map(([idx]) => idx)).toEqual(expected_reads)
      if (expected_reads.some((idx) => idx === 3)) {
        host.index = 3
        flushSync()
        expect(session.current_frame?.step).toBe(30)
        expect(read_frame.mock.calls.map(([idx]) => idx)).toEqual(expected_reads)
      }
    },
  )
})

describe(`scrub vs commit`, () => {
  it(`coalesces a slider burst into one rAF write, settles after the quiet period, and no-ops on a non-finite index`, () => {
    const raf_callbacks: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(globalThis, `requestAnimationFrame`)
      .mockImplementation((callback_fn) => {
        raf_callbacks.push(callback_fn)
        return raf_callbacks.length
      })
    const run = trajectory_from_frames(frames(20))
    const { host, session, events } = make_session({ run })
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
  })
})

describe(`controller and playback`, () => {
  it.each([
    { site_counts: [3, 3, 3, 3], fits: true },
    { site_counts: [3, 9, 3, 6], fits: true },
    { site_counts: [3, 3, 3, 3], fits: false },
    { site_counts: [3, 9, 3, 6], fits: false },
  ])(
    `retains playback history only while its budget fits: %j`,
    async ({ site_counts, fits }) => {
      vi.spyOn(globalThis, `requestAnimationFrame`).mockReturnValue(1)
      vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
      const frame_list = site_counts.map((count, idx) =>
        make_trajectory_frame(idx * 10, count),
      )
      const run = trajectory_from_frames(frame_list)
      Object.defineProperty(run, `preparation_concurrency`, { value: 3 })
      const prepare = vi.fn(async (idx: number, preparation: FramePreparation) => ({
        frame: await run.read_frame(idx),
        preparation,
      }))
      run.prepare_frame = prepare
      const total_bytes = frame_list.reduce(
        (total, frame) => total + display_frame_bytes({ frame: encode_frame(frame) }),
        0,
      )
      const cache_max_bytes = total_bytes / (fits ? 1 : 2)
      const { host, session } = make_session(
        { run, preparation: { bonding_strategy: `electroneg_ratio`, bonding_options: {} } },
        { cache_max_bytes },
      )
      await vi.advanceTimersByTimeAsync(0)
      flushSync()
      const first = session.numeric_frame
      const coordinates = first?.coordinates.slice()
      session.player.play()
      for (let step = 0; step < frame_list.length * 3; step++) {
        host.index = step % frame_list.length
        flushSync()
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
        expect(session.current_frame?.step).toBe(host.index * 10)
        expect(session.cached_bytes).toBeLessThanOrEqual(cache_max_bytes)
      }
      expect(first?.coordinates).toEqual(coordinates)
      if (fits) {
        expect(prepare.mock.calls.map(([idx]) => idx)).toEqual([0, 1, 2, 3])
        expect(session.cached_frames).toBe(frame_list.length)
      } else {
        expect(prepare.mock.calls.length).toBeGreaterThan(frame_list.length)
        expect(session.cached_frames).toBeLessThan(frame_list.length)
      }
    },
  )
  it.each([false, true])(
    `bounds retained prefetch when the next frame grows (playing: %s)`,
    async (playing) => {
      vi.spyOn(globalThis, `requestAnimationFrame`).mockReturnValue(1)
      vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
      const frame_list = frames(5)
      frame_list[1] = make_trajectory_frame(10, 30)
      const run = trajectory_from_frames(frame_list)
      Object.defineProperty(run, `preparation_concurrency`, { value: 3 })
      const requests = new Map<number, { signal?: AbortSignal; resolve: () => void }>()
      run.prepare_frame = (idx, preparation, signal) => {
        const pending = Promise.withResolvers<DisplayFrame>()
        const frame = run.read_frame(idx)
        if (frame instanceof Promise) throw new Error(`Expected memory frame`)
        requests.set(idx, { signal, resolve: () => pending.resolve({ frame, preparation }) })
        signal?.addEventListener(`abort`, () => pending.reject(signal.reason), { once: true })
        return pending.promise
      }
      const bytes = display_frame_bytes({ frame: encode_frame(run.preview) })
      const { host, session } = make_session(
        {
          run,
          preparation: { bonding_strategy: `electroneg_ratio`, bonding_options: {} },
        },
        { cache_max_bytes: bytes * 4 },
      )
      const settle = async (idx: number) => {
        requests.get(idx)?.resolve()
        await vi.advanceTimersByTimeAsync(0)
        flushSync()
      }
      await settle(0)
      if (playing) {
        session.player.play()
        await settle(2)
        await settle(3)
        host.index = 1
        flushSync()
        await settle(1)
        // The adopted oversized frame keeps only its nearest lookahead, including
        // when the farther frames already finished before its size was known.
        expect(requests.get(3)?.signal?.aborted).toBe(true)
        expect(requests.get(2)?.signal?.aborted).toBe(false)
        expect(session.current_frame?.step).toBe(10)
      } else {
        await vi.advanceTimersByTimeAsync(10)
        await settle(1)
        expect(requests.get(1)?.signal?.aborted).toBe(true)
        expect(session.cached_bytes).toBe(bytes)
        expect(session.current_frame?.step).toBe(0)
      }
    },
  )
  it.each([2, 4, 7, 9])(
    `prepares a byte-bounded window of %i frames and cancels it on seek`,
    async (capacity) => {
      vi.spyOn(globalThis, `requestAnimationFrame`).mockReturnValue(1)
      vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
      const { run, pending, reads, resolve_next } = make_async_run(frames(12))
      Object.defineProperty(run, `preparation_concurrency`, { value: 3 })
      run.prepare_frame = async (idx, preparation, signal) => ({
        frame: await run.read_frame(idx, signal),
        preparation,
      })
      const bytes = display_frame_bytes({ frame: encode_frame(run.preview) })
      const { host, session } = make_session(
        {
          run,
          preparation: {
            bonding_strategy: `electroneg_ratio`,
            bonding_options: {},
            bonds: false,
          },
        },
        { cache_max_bytes: bytes * capacity, cache_max_frames: capacity },
      )
      await vi.advanceTimersByTimeAsync(0)
      flushSync()
      session.player.play()
      flushSync()
      expect(reads).toEqual(Array.from({ length: capacity - 1 }, (_, idx) => idx + 1))
      await resolve_next()
      host.index = 1
      flushSync()
      // A completed prefetch is immediately displayable, without another loading cycle.
      expect(session.loading).toBe(false)
      expect(session.current_frame?.step).toBe(10)
      await vi.advanceTimersByTimeAsync(0)
      flushSync()
      expect(session.current_frame?.step).toBe(10)
      expect(reads).toEqual(Array.from({ length: capacity }, (_, idx) => idx + 1))
      expect(session.cached_bytes).toBeLessThanOrEqual(bytes * capacity)
      host.index = 6
      flushSync()
      expect(pending.map(({ idx }) => idx)).toEqual([6])
      expect(session.current_frame).toBeNull()
      expect(session.scene_frame?.idx).toBe(1)
      await resolve_next()
      await vi.advanceTimersByTimeAsync(0)
      flushSync()
      expect(session.current_frame?.step).toBe(60)
      session.player.pause()
      expect(pending).toHaveLength(0)
    },
  )

  it(`adopts large-frame read-ahead without duplicate reads or evicting the display`, async () => {
    let next_frame: FrameRequestCallback | undefined
    vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback) => {
      next_frame = callback
      return 1
    })
    vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
    vi.spyOn(performance, `now`).mockReturnValue(0)
    const { run, pending, reads, resolve_next } = make_async_run(frames(4))
    const cache_max_bytes = display_frame_bytes({ frame: encode_frame(run.preview) })
    const { session } = make_session({ run, fps: 30 }, { cache_max_bytes })
    session.player.play()
    flushSync()
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toEqual([1])
    await resolve_next()
    expect(session.current_frame?.step).toBe(0)
    expect(session.cached_frames).toBe(1)
    next_frame?.(34)
    flushSync()
    await Promise.resolve()
    flushSync()
    expect(session.current_frame?.step).toBe(10)
    expect(reads).toEqual([1, 2])
    session.player.pause()
    flushSync()
    expect(pending).toHaveLength(0)
    expect(session.current_frame?.step).toBe(10)
  })

  it(`advances only after read and render, rejects stale acknowledgements and pauses on failure`, async () => {
    let next_frame: FrameRequestCallback | undefined
    vi.spyOn(globalThis, `requestAnimationFrame`).mockImplementation((callback) => {
      next_frame = callback
      return 1
    })
    vi.spyOn(globalThis, `cancelAnimationFrame`).mockImplementation(() => {})
    vi.spyOn(performance, `now`).mockReturnValue(0)
    const { run, pending, reads, resolve_next } = make_async_run(frames(4))
    const { host, session, errors } = make_session({
      run,
      fps: 30,
      wait_for_render: true,
    })
    const tick = (time: number) => {
      next_frame?.(time)
      flushSync()
    }
    session.player.play()
    flushSync()
    const initial_snapshot = session.scene_frame
    session.mark_rendered(initial_snapshot)
    tick(34)
    expect(reads).toEqual([1])
    for (const time of [68, 102, 500]) tick(time)
    expect(host.index).toBe(1)
    expect(pending.map(({ idx }) => idx)).toEqual([1])
    await resolve_next()
    expect(session.current_frame?.step).toBe(10)
    const exported = vi.fn()
    const capture = session.wait_for_frame(1, new AbortController().signal).then(exported)
    await Promise.resolve()
    expect(exported).not.toHaveBeenCalled()
    tick(520)
    expect(host.index).toBe(1)
    expect(session.mark_rendered(initial_snapshot)).toBe(false)
    const submitted = session.scene_frame
    expect(session.mark_rendered(submitted)).toBe(true)
    expect(session.mark_rendered(submitted)).toBe(false)
    await capture
    expect(exported).toHaveBeenCalledOnce()
    await session.wait_for_frame(1, new AbortController().signal)
    tick(534)
    expect(reads).toEqual([1, 2])
    expect(host.index).toBe(2)
    const failed_capture = session
      .wait_for_frame(2, new AbortController().signal)
      .catch((error: unknown) => error)
    pending[0].reject(new Error(`Read failed`))
    await resolve_next()
    expect(await failed_capture).toMatchObject({ message: `Read failed` })
    await expect(session.wait_for_frame(2, new AbortController().signal)).rejects.toThrow(
      `Read failed`,
    )
    expect(errors).toEqual([`2:Read failed`])
    expect(session.player.is_playing).toBe(false)
    session.player.play()
    flushSync()
    expect(reads).toEqual([1, 2, 2])
    await resolve_next()
    expect(session.current_frame?.step).toBe(20)
  })

  it.each([`abort`, `seek`, `replace`, `dispose`] as const)(
    `rejects a pending capture on %s`,
    async (action) => {
      const { session, host } = make_session({
        run: trajectory_from_frames(frames(3)),
        wait_for_render: true,
      })
      const controller = new AbortController()
      const capture = session
        .wait_for_frame(0, controller.signal)
        .catch((error: unknown) => error)
      if (action === `abort`) controller.abort()
      else if (action === `seek`) session.commit(1)
      else if (action === `replace`) host.run = trajectory_from_frames(frames(3))
      else session.dispose()
      flushSync()
      expect(await capture).toMatchObject({ name: `AbortError` })
    },
  )

  it(`controller bounds the step, reports state and pauses playback on seek`, () => {
    const run = trajectory_from_frames(frames(5))
    const { host, session, events } = make_session({ run })
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
  })

  it(`auto_play starts once a run with more than one frame is present`, () => {
    const { host, session } = make_session({ auto_play: true })
    expect(session.player.is_playing).toBe(false)
    host.run = trajectory_from_frames(frames(3))
    flushSync()
    expect(session.player.is_playing).toBe(true)
  })
})

describe(`property mirroring`, () => {
  it(`tracks progressive property rows of the current run`, async () => {
    const backing = trajectory_from_frames(frames(3))
    const progressive = new TrajectoryProperties()
    const run = host_run(
      { ...summarize_run(backing), properties: { rows: [], complete: false } },
      async (idx) => materialize_frame_result(backing.read_frame(idx)),
    )
    Object.defineProperty(run, `properties`, { value: progressive })
    const { host, session } = make_session({ run })
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
    host.run = undefined
    flushSync()
    expect(session.property_rows).toEqual([])
    expect(session.properties_complete).toBe(true)
  })
})

describe(`resolve_frame`, () => {
  it.each([false, true])(
    `exports source coordinates and vectors (hidden: %s)`,
    async (hidden) => {
      const frame_list = [make_trajectory_frame(0, 3, {}, { a: 10, b: 10, c: 10 })]
      frame_list[0].structure.sites[0].xyz = [12, 0, 0]
      frame_list[0].structure.sites[0].abc = [1.2, 0, 0]
      for (const frame of frame_list)
        for (const site of frame.structure.sites) site.properties.velocity = [1, 2, 3]
      const run = trajectory_from_frames(frame_list)
      const prepare = new FramePreparer()
      run.prepare_frame = async (idx, options, signal) =>
        prepare.prepare(await run.read_frame(idx, signal, options.channels), options)
      const read = vi.spyOn(run, `read_frame`)
      const { session } = make_session({
        run,
        preparation: {
          bonding_strategy: `electroneg_ratio`,
          bonding_options: {},
          bonds: false,
          ...(hidden && { channels: { vectors: [] } }),
        },
      })
      await Promise.resolve()
      await Promise.resolve()
      flushSync()
      const displayed = session.current_frame
      expect(session.numeric_frame?.wrapped).toBe(true)
      // Wrapping 1.2 fractional cells and scaling by 10 incurs 4.44e-16 absolute error.
      expect(Math.abs((session.numeric_frame?.coordinates[0] ?? NaN) - 2)).toBeLessThanOrEqual(
        4 * Number.EPSILON,
      )
      if (hidden)
        expect(displayed?.structure.sites[0].properties).not.toHaveProperty(`velocity`)
      const cached_bytes = session.cached_bytes
      const exported = await session.resolve_frame(0)
      expect(exported?.structure.sites[0].properties.velocity).toEqual([1, 2, 3])
      expect(exported?.structure.sites[0].xyz).toEqual([12, 0, 0])
      expect(exported?.structure.sites[0].abc).toEqual([1.2, 0, 0])
      expect(read.mock.calls.at(-1)).toEqual([0, undefined])
      expect(session.current_frame).toBe(displayed)
      expect(session.cached_bytes).toBe(cached_bytes)
    },
  )
  it(`forwards cancellation to frame reads and allows retry`, async () => {
    const { run, reads, pending, resolve_next } = make_async_run(frames(6))
    const { session } = make_session({ run })
    const controller = new AbortController()
    const cancelled = new Error(`cancelled`)
    const aborted = session.resolve_frame(4, controller.signal)
    controller.abort(cancelled)
    await expect(aborted).rejects.toBe(cancelled)
    expect(pending).toHaveLength(0)
    await expect(session.resolve_frame(4, controller.signal)).rejects.toBe(cancelled)
    const retried = session.resolve_frame(4)
    await resolve_next()
    expect((await retried)?.step).toBe(40)
    expect(reads).toEqual([4, 4])
  })

  it.each([`run swap`, `disposal`])(
    `returns cached source frames and rejects stale export after %s`,
    async (change) => {
      const { run, reads, resolve_next } = make_async_run(frames(6))
      const { host, session } = make_session({ run })
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
      if (change === `run swap`) host.run = trajectory_from_frames(frames(2))
      else session.dispose()
      flushSync()
      await resolve_next()
      expect(await swapped).toBeNull()
      if (change === `disposal`) expect(await session.resolve_frame(0)).toBeNull()
    },
  )
})
