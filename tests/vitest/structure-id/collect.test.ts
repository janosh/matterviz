import type { Vec3 } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { calc_structure_id } from '$lib/structure-id'
import * as async_compute from '$lib/structure-id/async-compute.svelte'
import {
  collect_structure_id_sweep,
  DEFAULT_MAX_SWEEP_FRAMES,
} from '$lib/structure-id/collect'
import { trajectory_from_frames, type FrameRange, type TrajectoryRun } from '$lib/trajectory'
import { sweep_frame_plan } from '$lib/trajectory/analysis'
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
    read_frame: (frame_idx) => ({ step: frame_idx, structure: structures[frame_idx] }),
  }
}

const counting_run = (total_frames: number): TrajectoryRun & { requested: number[] } => {
  const requested: number[] = []
  return Object.assign(
    frame_run(Array.from({ length: total_frames }, () => make_fcc([2, 2, 2]))),
    {
      requested,
      read_frame: (frame_idx: number) => {
        requested.push(frame_idx)
        return { step: frame_idx, structure: make_fcc([2, 2, 2]) }
      },
    },
  )
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
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })

  it(`stops between frames once its signal aborts and hands the signal to every compute`, async () => {
    const controller = new AbortController()
    const compute_spy = vi.spyOn(async_compute, `calc_structure_id_async`)
    const sweep = collect_structure_id_sweep(repeat_fcc(20), {
      max_frames: 4,
      options: { skip_csp: true },
      signal: controller.signal,
      on_progress: (done) => {
        if (done === 2) controller.abort(new Error(`pane closed`))
      },
    })
    await expect(sweep).rejects.toThrow(`pane closed`)
    // frames 0 and 5 were analysed; the abort landed before frame 10 was requested
    expect(compute_spy).toHaveBeenCalledTimes(2)
    for (const call of compute_spy.mock.calls) {
      expect(call[2]).toEqual({ signal: controller.signal })
    }
    compute_spy.mockRestore()
  })

  it(`refuses a sweep whose frames disagree on the atom count`, async () => {
    const trajectory = frame_run([make_fcc([2, 2, 2]), with_vacancy(make_fcc([2, 2, 2]), 0)])
    await expect(
      collect_structure_id_sweep(trajectory, { max_frames: 2, options: { skip_csp: true } }),
    ).rejects.toThrow(/frame 1 has 31 atoms but frame 0 has 32/)
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

describe(`on-demand runs`, () => {
  it(`loads exactly the sampled source frames through read_frame`, async () => {
    const run = counting_run(50)
    const sweep = await collect_structure_id_sweep(run, {
      max_frames: 5,
      options: { skip_csp: true },
    })
    expect([sweep.frame_numbers, sweep.frame_stride]).toEqual([[0, 10, 20, 30, 40], 10])
    expect(run.requested).toEqual(sweep.frame_numbers)
  })
})
