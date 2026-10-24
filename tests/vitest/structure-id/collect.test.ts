import { encode_frame } from '#lib/trajectory/frame.js'
import type { Vec3 } from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import { calc_structure_id } from '#lib/structure-id/calc-structure-id.js'
import * as async_compute from '#lib/structure-id/async-compute.svelte.js'
import {
  collect_structure_id_sweep,
  DEFAULT_MAX_SWEEP_FRAMES,
} from '#lib/structure-id/collect.js'
import type { FrameRange, TrajectoryRun } from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { sweep_frame_plan, sweep_frames, window_sweep_size } from '#lib/trajectory/analysis.js'
import { describe, expect, it, vi } from 'vitest'
import { make_fcc, with_vacancy } from './lattices'

const in_memory = (structures: AnyStructure[]): TrajectoryRun =>
  trajectory_from_frames(structures.map((structure, step) => ({ step, structure })))

const repeat_fcc = (n_frames: number): TrajectoryRun =>
  in_memory(Array.from({ length: n_frames }, () => make_fcc([2, 2, 2])))

const frame_run = (structures: AnyStructure[]): TrajectoryRun => {
  const run = in_memory([structures[0]])
  return {
    ...run,
    frame_count: structures.length,
    read_frame: (frame_idx) =>
      encode_frame({ step: frame_idx, structure: structures[frame_idx] }),
  }
}

describe(`sweep_frame_plan`, () => {
  it.each([
    [10, 3, 4, [0, 4, 8]],
    [10, 4, 3, [0, 3, 6, 9]],
    [10, 1, 10, [0]],
    [10, 10, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
    // a cap above the frame count never oversamples
    [3, 100, 1, [0, 1, 2]],
    [1, 1, 1, [0]],
    [20, 3, 3, [5, 8, 11], { start_frame: 5, end_frame: 13 }],
  ])(
    `samples %i frames capped at %i with stride %i`,
    (total, max_frames, frame_stride, frame_numbers, range?: FrameRange) => {
      expect(sweep_frame_plan(total, max_frames, range)).toEqual({
        frame_numbers,
        frame_stride,
      })
    },
  )

  it(`caps at DEFAULT_MAX_SWEEP_FRAMES samples`, () => {
    expect(sweep_frame_plan(10_000, DEFAULT_MAX_SWEEP_FRAMES).frame_numbers).toHaveLength(
      DEFAULT_MAX_SWEEP_FRAMES,
    )
  })

  it.each([
    [0, 5, /total_frames must be a positive integer, got 0/],
    [2.5, 5, /total_frames must be a positive integer, got 2.5/],
    [10, 0, /max_frames must be a positive integer, got 0/],
    [10, 1.5, /max_frames must be a positive integer, got 1.5/],
  ])(`rejects total=%s max=%s`, (total, max_frames, pattern) => {
    expect(() => sweep_frame_plan(total, max_frames)).toThrow(pattern)
  })

  // the panes' frame-count hints render before a trajectory or a non-empty window is loaded,
  // where sweep_frame_plan would throw; loaded windows count what sweep_frame_plan would visit
  it.each([
    [0, 5, { n_frames: 0, frame_stride: 1, label: `0 of 0 frames` }],
    [-1, 5, { n_frames: 0, frame_stride: 1, label: `0 of -1 frames` }],
    [10, 3, { n_frames: 3, frame_stride: 4, label: `3 of 10 frames (every 4)` }],
    [20, 20, { n_frames: 20, frame_stride: 1, label: `20 of 20 frames` }],
    [20, 50, { n_frames: 20, frame_stride: 1, label: `20 of 20 frames` }],
    [16, 3, { n_frames: 3, frame_stride: 6, label: `3 of 16 frames (every 6)` }],
    [1, 1, { n_frames: 1, frame_stride: 1, label: `1 of 1 frames` }],
  ])(`window_sweep_size(%i, %i) → %o`, (window_frames, max_frames, expected) => {
    expect(window_sweep_size(window_frames, max_frames)).toEqual(expected)
    if (window_frames < 1) return
    const { frame_numbers, frame_stride } = sweep_frame_plan(window_frames, max_frames)
    expect([frame_numbers.length, frame_stride]).toEqual([
      expected.n_frames,
      expected.frame_stride,
    ])
  })

  it.each([
    [10, 0, `max_frames must be a positive integer, got 0`],
    [10, 1.5, `max_frames must be a positive integer, got 1.5`],
    [2.5, 5, `window_frames must be a positive integer, got 2.5`],
  ])(`window_sweep_size rejects window=%s max=%s`, (window_frames, max_frames, message) => {
    expect(() => window_sweep_size(window_frames, max_frames)).toThrow(
      `window_sweep_size: ${message}`,
    )
  })
})

// A worker-pool visitor (RDF) needs several frames in flight, but its synchronous prefix
// (reference frame, step list) must still see frames in order and results stay ordered
describe(`sweep_frames concurrency`, () => {
  const run = trajectory_from_frames(
    [0, 1, 2, 3, 4, 5].map((step) => ({ step, structure: make_fcc([1, 1, 1]) })),
  )
  it.each([1, 3])(
    `starts visits in order and keeps %i frames in flight`,
    async (concurrency) => {
      const [started, finished]: number[][] = [[], []]
      let [in_flight, peak] = [0, 0]
      const { results } = await sweep_frames(
        run,
        { max_frames: 6, concurrency },
        async (_frame, frame_number) => {
          started.push(frame_number)
          peak = Math.max(peak, ++in_flight)
          await new Promise((resolve) => setTimeout(resolve, frame_number % 2 ? 1 : 6))
          in_flight--
          finished.push(frame_number)
          return frame_number * 10
        },
      )
      expect(started).toEqual([0, 1, 2, 3, 4, 5])
      expect(results).toEqual([0, 10, 20, 30, 40, 50])
      expect(peak).toBe(concurrency)
      if (concurrency > 1) expect(finished).not.toEqual(started) // really overlapped
    },
  )
  it(`stops starting frames after a visit fails`, async () => {
    const started: number[] = []
    const sweep = sweep_frames(
      run,
      { max_frames: 6, concurrency: 2 },
      async (_frame, frame_number) => {
        started.push(frame_number)
        if (frame_number === 1) throw new Error(`bad frame 1`)
        return 0
      },
    )
    await expect(sweep).rejects.toThrow(`bad frame 1`)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(started.length).toBeLessThan(6)
  })
})

describe(`collect_structure_id_sweep`, () => {
  it(`caps analysed frames and reports stride, results and progress`, async () => {
    const seen: [number, number][] = []
    const sweep = await collect_structure_id_sweep(repeat_fcc(20), {
      max_frames: 4,
      options: { skip_csp: true },
      on_progress: (done, total) => seen.push([done, total]),
    })
    expect(sweep.frame_stride).toBe(5)
    expect(sweep.frame_numbers).toEqual([0, 5, 10, 15])
    expect(sweep.results).toHaveLength(4)
    const window = await collect_structure_id_sweep(repeat_fcc(20), {
      start_frame: 3,
      end_frame: 15,
      max_frames: 4,
      options: { skip_csp: true },
    })
    expect(window.frame_numbers).toEqual([3, 6, 9, 12])
    expect(sweep.results[0].n_atoms).toBe(32)
    expect(sweep.results[0].populations).toEqual({ other: 0, fcc: 32, hcp: 0, bcc: 0, ico: 0 })
    // skip_csp is forwarded, so no frame carries centrosymmetry
    expect(sweep.results.every(({ centrosymmetry }) => centrosymmetry === null)).toBe(true)
    expect(seen).toEqual([1, 2, 3, 4].map((done) => [done, 4]))
  })

  it.each([
    [2, `progress`],
    [4, `progress`],
    [4, `compute`],
  ] as const)(
    `stops when frame %i aborts during %s and forwards the signal`,
    async (abort_at, phase) => {
      const controller = new AbortController()
      const compute = async_compute.calc_structure_id_async
      const compute_spy = vi.spyOn(async_compute, `calc_structure_id_async`)
      if (phase === `compute`) {
        compute_spy.mockImplementation(async (...args) => {
          const result = await compute(...args)
          if (compute_spy.mock.calls.length === abort_at)
            controller.abort(new Error(`pane closed`))
          return result
        })
      }
      const progress = vi.fn((done: number) => {
        if (phase === `progress` && done === abort_at)
          controller.abort(new Error(`pane closed`))
      })
      const sweep = collect_structure_id_sweep(repeat_fcc(20), {
        max_frames: 4,
        options: { skip_csp: true },
        signal: controller.signal,
        on_progress: progress,
      })
      await expect(sweep).rejects.toThrow(`pane closed`)
      expect(compute_spy).toHaveBeenCalledTimes(abort_at)
      expect(progress).toHaveBeenCalledTimes(abort_at - Number(phase === `compute`))
      for (const call of compute_spy.mock.calls) {
        expect(call[2]).toEqual({ signal: controller.signal })
      }
      compute_spy.mockRestore()
    },
  )

  it(`loads exactly the sampled source frames through read_frame`, async () => {
    const requested: number[] = []
    const base = frame_run(Array.from({ length: 50 }, () => make_fcc([2, 2, 2])))
    const run = {
      ...base,
      read_frame: (frame_idx: number) => {
        requested.push(frame_idx)
        return base.read_frame(frame_idx)
      },
    }
    const sweep = await collect_structure_id_sweep(run, {
      max_frames: 5,
      options: { skip_csp: true },
    })
    expect([sweep.frame_numbers, sweep.frame_stride]).toEqual([[0, 10, 20, 30, 40], 10])
    expect(requested).toEqual(sweep.frame_numbers)
  })

  it(`refuses a sweep whose frames disagree on the atom count`, async () => {
    const trajectory = frame_run([make_fcc([2, 2, 2]), with_vacancy(make_fcc([2, 2, 2]), 0)])
    await expect(
      collect_structure_id_sweep(trajectory, { max_frames: 2, options: { skip_csp: true } }),
    ).rejects.toThrow(/frame 2 has 31 atoms but frame 1 has 32/)
  })

  it(`preserves out-of-cell coordinates on a non-periodic axis`, async () => {
    const bulk = make_fcc([3, 3, 3])
    const shifted_slab = {
      ...bulk,
      lattice: { ...bulk.lattice, pbc: [true, true, false] as const },
      sites: bulk.sites.map((site, site_idx) => {
        if (site_idx !== 0) return site
        const abc: Vec3 = [site.abc[0], site.abc[1], site.abc[2] - 1]
        const xyz: Vec3 = [site.xyz[0], site.xyz[1], site.xyz[2] - bulk.lattice.c]
        return { ...site, abc, xyz }
      }),
    }
    expect(shifted_slab.sites[0].abc[2]).toBeLessThan(0)

    const wrapped = calc_structure_id(
      { ...shifted_slab, sites: bulk.sites },
      { skip_csp: true },
    )
    const sweep = await collect_structure_id_sweep(in_memory([shifted_slab]), {
      options: { skip_csp: true },
    })
    expect(sweep.results[0].cna_types).not.toEqual(wrapped.cna_types)
  })
})
