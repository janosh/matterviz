import type { Vec3 } from '$lib/math'
import { create_frac_to_cart } from '$lib/math'
import type { AnyStructure, Crystal } from '$lib/structure'
import type { StructureIdOptions } from '$lib/structure-id'
import type * as AsyncCompute from '$lib/structure-id/async-compute.svelte'
import {
  collect_structure_id_sweep,
  DEFAULT_MAX_SWEEP_FRAMES,
  sweep_frame_plan,
} from '$lib/structure-id/collect'
import type { FrameLoader, TrajectoryType } from '$lib/trajectory'
import { describe, expect, it, vi } from 'vitest'
import { make_fcc, with_vacancy } from './lattices'

// Records every structure the sweep hands to the analysis, which is the only place the
// wrapped copy is observable: a wrapped and an unwrapped periodic crystal produce the SAME
// CNA result (build_neighbor_list wraps into the cell itself), so the result cannot prove it.
const analysis_spy = vi.hoisted(() => ({ structures: [] as AnyStructure[] }))
vi.mock(`$lib/structure-id/async-compute.svelte`, async (import_original) => {
  const actual = await import_original<typeof AsyncCompute>()
  return {
    ...actual,
    compute_structure_id_async: (structure: AnyStructure, options: StructureIdOptions) => {
      analysis_spy.structures.push(structure)
      return actual.compute_structure_id_async(structure, options)
    },
  }
})

const translate = (crystal: Crystal, offset: Vec3): Crystal => {
  const frac_to_cart = create_frac_to_cart(crystal.lattice.matrix)
  return {
    ...crystal,
    sites: crystal.sites.map((site) => {
      const abc = site.abc.map((coord, axis) => coord + offset[axis]) as Vec3
      return { ...site, abc, xyz: frac_to_cart(abc) }
    }),
  }
}

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

  it(`wraps each frame into the cell and never reuses a frame's own structure`, async () => {
    analysis_spy.structures.length = 0
    // 1.4 cells along a and -2.7 along b puts every site outside [0, 1)
    const frames = [make_fcc([2, 2, 2]), make_fcc([2, 2, 2])].map((crystal) =>
      translate(crystal, [1.4, -2.7, 0]),
    )
    const trajectory = in_memory(frames)
    const outside_before = frames[0].sites.filter((site) =>
      site.abc.some((coord) => coord < 0 || coord >= 1),
    )
    expect(outside_before).toHaveLength(32)

    const sweep = await collect_structure_id_sweep(trajectory, {
      max_frames: 2,
      options: { skip_csp: true },
    })

    expect(analysis_spy.structures).toHaveLength(2)
    for (const [idx, analysed] of analysis_spy.structures.entries()) {
      for (const site of analysed.sites) {
        for (const coord of site.abc) {
          expect(coord).toBeGreaterThanOrEqual(0)
          expect(coord).toBeLessThan(1)
        }
      }
      // create_worker_client dedupes in-flight requests on input object identity, so the
      // analysed structure must be a fresh object rather than the frame's own
      expect(analysed).not.toBe(frames[idx])
      expect(analysed.sites).not.toBe(frames[idx].sites)
    }
    // wrapping a fully periodic cell is a no-op for the classification itself
    expect(sweep.populations[0]).toEqual({ other: 0, fcc: 32, hcp: 0, bcc: 0, ico: 0 })
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
