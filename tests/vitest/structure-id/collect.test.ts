import type { AnyStructure } from '$lib/structure'
import {
  collect_structure_id_sweep,
  DEFAULT_MAX_SWEEP_FRAMES,
  sweep_frame_plan,
} from '$lib/structure-id/collect'
import type { FrameLoader, TrajectoryType } from '$lib/trajectory'
import { describe, expect, it } from 'vitest'
import { make_fcc, with_vacancy } from './lattices'

const in_memory = (structures: AnyStructure[]): TrajectoryType => ({
  frames: structures.map((structure, step) => ({ step, structure })),
})

const repeat_fcc = (n_frames: number): TrajectoryType =>
  in_memory(Array.from({ length: n_frames }, () => make_fcc([2, 2, 2])))

// Indexed trajectory: 10 frames in memory out of `total_frames`, like the parser leaves it
const indexed = (total_frames: number, loader?: FrameLoader): TrajectoryType => ({
  ...repeat_fcc(10),
  total_frames,
  is_indexed: true,
  ...(loader ? { frame_loader: loader } : {}),
})

const counting_loader = (): FrameLoader & { requested: number[] } => {
  const loader: FrameLoader & { requested: number[] } = {
    requested: [],
    get_total_frames: async () => 50,
    build_frame_index: async () => [],
    extract_plot_metadata: async () => [],
    load_frame: async (_data, frame_number) => {
      loader.requested.push(frame_number)
      return { step: frame_number, structure: make_fcc([2, 2, 2]) }
    },
  }
  return loader
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
  ])(
    `samples %i frames capped at %i with stride %i`,
    (total, max_frames, frame_stride, frame_numbers) => {
      expect(sweep_frame_plan(total, max_frames)).toEqual({ frame_numbers, frame_stride })
    },
  )

  it(`defaults to DEFAULT_MAX_SWEEP_FRAMES samples`, () => {
    const { frame_numbers } = sweep_frame_plan(10_000)
    expect(frame_numbers).toHaveLength(DEFAULT_MAX_SWEEP_FRAMES)
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
  it(`caps analysed frames, reports stride, and emits progress`, async () => {
    const seen: [number, number][] = []
    const sweep = await collect_structure_id_sweep(repeat_fcc(20), {
      max_frames: 4,
      options: { skip_csp: true },
      on_progress: (done, total) => seen.push([done, total]),
    })
    expect(sweep.frame_stride).toBe(5)
    expect(sweep.frame_numbers).toEqual([0, 5, 10, 15])
    expect(sweep.results).toHaveLength(4)
    expect(sweep.populations).toHaveLength(4)
    expect(sweep.n_atoms).toBe(32)
    expect(sweep.populations[0]).toEqual({ other: 0, fcc: 32, hcp: 0, bcc: 0, ico: 0 })
    // skip_csp leaves no centrosymmetry to average
    expect(sweep.mean_centrosymmetry).toEqual([null, null, null, null])
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ])
  })

  it(`reports mean centrosymmetry per frame when CSP is not skipped`, async () => {
    const sweep = await collect_structure_id_sweep(repeat_fcc(2), { max_frames: 2 })
    expect(sweep.mean_centrosymmetry).toHaveLength(2)
    // ideal fcc is centrosymmetric, so every site's CSP is 0 to round-off
    for (const mean of sweep.mean_centrosymmetry) expect(mean ?? NaN).toBeLessThan(1e-20)
  })

  it(`refuses a sweep whose frames disagree on the atom count`, async () => {
    const trajectory = in_memory([make_fcc([2, 2, 2]), with_vacancy(make_fcc([2, 2, 2]), 0)])
    await expect(
      collect_structure_id_sweep(trajectory, { max_frames: 2, options: { skip_csp: true } }),
    ).rejects.toThrow(/frame 1 has 31 atoms but frame 0 has 32/)
  })
})

describe(`indexed trajectories`, () => {
  it.each([
    [`no loader`, () => indexed(50), /only 10 are in memory and it has no frame_loader/],
    [
      `loader without raw_data`,
      () => indexed(50, counting_loader()),
      /needs the raw file bytes to load the sampled frames/,
    ],
  ])(`refuses when %s`, async (_label, make_trajectory, pattern) => {
    await expect(collect_structure_id_sweep(make_trajectory())).rejects.toThrow(pattern)
  })

  it(`loads exactly the sampled source frames through the loader`, async () => {
    const loader = counting_loader()
    const sweep = await collect_structure_id_sweep(indexed(50, loader), {
      raw_data: `payload`,
      max_frames: 5,
      options: { skip_csp: true },
    })
    expect(loader.requested).toEqual([0, 10, 20, 30, 40])
    expect(sweep.frame_numbers).toEqual([0, 10, 20, 30, 40])
    expect(sweep.frame_stride).toBe(10)
  })
})
