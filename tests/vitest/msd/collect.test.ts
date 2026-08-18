import type { ElementSymbol } from '$lib/element'
import type { MsdPositions, MsdResult } from '$lib/msd'
import { calc_msd, collect_msd_positions, MsdPlot, suggest_msd_frame_stride } from '$lib/msd'
import * as async_compute from '$lib/msd/async-compute.svelte'
import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
import type { FrameLoader, TrajectoryType } from '$lib/trajectory'
import { has_all_frames_in_memory } from '$lib/trajectory/analysis'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import { join } from 'node:path'
import process from 'node:process'
import { type Component, type ComponentProps, mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { describe, expect, it, vi } from 'vitest'
import { cubic_matrix, read_maybe_gz } from '../setup'
import { drift_positions, make_frame, max_rel_error, on_x_axis } from './helpers'

const TRAJECTORY_DIR = `src/site/trajectories`
const load_fixture = (filename: string) =>
  read_maybe_gz(join(process.cwd(), TRAJECTORY_DIR, filename))

// A drifting single atom per frame, so MSD over N frames is analytically (v * lag)^2
const drift_per_frame = 0.13
const make_drift_trajectory = (n_frames: number): TrajectoryType => ({
  frames: Array.from({ length: n_frames }, (_unused, frame_idx) => {
    const drift = drift_per_frame * frame_idx
    return make_frame(frame_idx, on_x_axis(drift, 1 + drift))
  }),
})

// Multi-frame XYZ where every atom drifts along x at a constant rate
const synthetic_drift_xyz = (n_frames: number, n_atoms = 4): string =>
  Array.from({ length: n_frames }, (_unused, frame_idx) =>
    [
      `${n_atoms}`,
      `Lattice="20 0 0 0 20 0 0 0 20" Properties=species:S:1:pos:R:3 frame=${frame_idx}`,
      ...Array.from(
        { length: n_atoms },
        (_atom, atom_idx) => `H ${atom_idx + drift_per_frame * frame_idx} 0.0 0.0`,
      ),
    ].join(`\n`),
  ).join(`\n`)

const indexed = (xyz: string) =>
  parse_trajectory_async(xyz, `drift.xyz`, undefined, {
    use_indexing: true,
    index_sample_rate: 1,
  })

describe(`in-memory collection`, () => {
  it(`packs frames into a flat buffer with stable element order`, async () => {
    const trajectory = make_drift_trajectory(12)
    const collected = await collect_msd_positions(trajectory)
    expect(collected.n_frames).toBe(12)
    expect(collected.n_atoms).toBe(2)
    expect(collected.positions).toHaveLength(12 * 2 * 3)
    expect(collected.elements).toEqual([`H`, `H`])
    expect(collected.frame_stride).toBe(1)
    expect(collected.steps).toEqual(Array.from({ length: 12 }, (_unused, idx) => idx))
    expect(collected.lattice_matrices).toBeNull()
    expect(collected.coords_unwrapped).toBe(false)
    expect(collected.positions[1 * 2 * 3]).toBeCloseTo(drift_per_frame, 12)
  })

  it.each([
    [1, 20, 20],
    [2, 20, 10],
    [3, 20, 7],
  ])(`frame_stride %s collects %s -> %s frames`, async (frame_stride, n_frames, expected) => {
    const collected = await collect_msd_positions(make_drift_trajectory(n_frames), {
      frame_stride,
    })
    expect(collected.n_frames).toBe(expected)
    expect(collected.frame_stride).toBe(frame_stride)
    // Striding multiplies the per-collected-frame displacement by the stride
    const result = calc_msd(collected)
    const step = drift_per_frame * frame_stride
    const expected_msd = result.lags.map((lag) => (step * lag) ** 2)
    expect(max_rel_error(result.curves[0].msd, expected_msd)).toBeLessThan(1e-12)
  })

  it(`reports the raw lattice and pbc when frames are periodic`, async () => {
    const trajectory: TrajectoryType = {
      frames: Array.from({ length: 4 }, (_unused, idx) =>
        make_frame(idx, [[0.1 * idx, 0, 0]], { box_length: 6 }),
      ),
    }
    const collected = await collect_msd_positions(trajectory)
    expect(collected.lattice_matrices).toHaveLength(4)
    expect(collected.lattice_matrices?.[0]).toEqual(cubic_matrix(6))
    expect(collected.pbc).toEqual([true, true, true])
  })
})

describe(`atom-identity invariants fail loudly`, () => {
  it(`rejects a changing atom count`, async () => {
    const frames = [make_frame(0, on_x_axis(0, 1)), make_frame(1, on_x_axis(0))]
    await expect(collect_msd_positions({ frames })).rejects.toThrow(
      /Atom count changed at frame 1: expected 2 atoms, got 1/,
    )
  })

  it(`rejects reordered atoms even when the count is constant`, async () => {
    const elements = [`Li`, `O`] as ElementSymbol[]
    const frames = [elements, elements.toReversed()].map((els, idx) =>
      make_frame(idx, on_x_axis(0, 1), { elements: els }),
    )
    await expect(collect_msd_positions({ frames })).rejects.toThrow(
      /Atom ordering changed at frame 1/,
    )
  })

  // Element symbols cannot detect permutations within one species, and the accumulator does
  // not validate LAMMPS `id` properties. Four immobile H atoms in alternating order used to
  // report MSD(lag 1) = 46.5 A² and D = 0.664 instead of an identically zero curve.
  it(`rejects a single-species permutation the symbol check cannot see`, async () => {
    // oxfmt-ignore
    const sorted = [[1, 1, 1], [1, 1, 8], [8, 1, 1], [8, 8, 8]]
    const permuted = [sorted[2], sorted[3], sorted[0], sorted[1]]
    const six_frames = (pick: (idx: number) => number[][]): TrajectoryType => ({
      frames: Array.from({ length: 6 }, (_unused, idx) =>
        make_frame(idx, pick(idx), { box_length: 10 }),
      ),
    })
    await expect(
      collect_msd_positions(six_frames((idx) => (idx % 2 === 0 ? sorted : permuted))),
    ).rejects.toThrow(
      /Frame 1: 4 of 4 atoms moved more than a quarter of the cell.*preserved IDs are not checked here/s,
    )
    // The same frames in a stable order are immobile, so MSD is identically zero
    const result = calc_msd(await collect_msd_positions(six_frames(() => sorted)))
    expect(result.curves[0].msd.every((value) => value === 0)).toBe(true)
  })

  // ...but the same threshold has no meaning for sub-sampled UNWRAPPED coordinates: their
  // displacement is not folded into the cell, so it grows as sqrt(stride) without bound and
  // a clean diffusive run trips it on its own. Nothing needs unwrapping there either.
  it(`does not reject a strided unwrapped run whose atoms cross the cell`, async () => {
    // 4 atoms marching a full cell per collected frame — far past the quarter-cell bar
    const frames = Array.from({ length: 8 }, (_unused, idx) =>
      make_frame(
        idx,
        Array.from({ length: 4 }, (_atom, atom_idx) => [atom_idx + 12 * idx, 0, 0]),
        { box_length: 10, coords_unwrapped: true },
      ),
    )
    await expect(collect_msd_positions({ frames }, { frame_stride: 2 })).resolves.toBeDefined()
    // stride 1 keeps the guard, since there a jump that large really is implausible
    await expect(collect_msd_positions({ frames })).rejects.toThrow(
      /moved more than a quarter/,
    )
  })

  it(`rejects a trajectory whose coords_unwrapped flag flips mid-run`, async () => {
    const trajectory: TrajectoryType = {
      frames: [
        make_frame(0, [[0, 0, 0]], { coords_unwrapped: true }),
        make_frame(1, [[1, 0, 0]], { coords_unwrapped: false }),
      ],
    }
    await expect(collect_msd_positions(trajectory)).rejects.toThrow(
      /coords_unwrapped flipped to false at frame 1/,
    )
  })

  it.each([
    [`single frame`, 1],
    [`zero frames`, 0],
  ])(`rejects %s`, async (_label, n_frames) => {
    await expect(collect_msd_positions(make_drift_trajectory(n_frames))).rejects.toThrow(
      /at least 2 frames/,
    )
  })

  it(`refuses to allocate past the memory budget and names a workable stride`, async () => {
    const trajectory = make_drift_trajectory(100)
    // 100 frames x 2 atoms x 3 x f64 = 4800 bytes. A 1000 byte cap fits 20 frames, so
    // the smallest workable stride is ceil(100 / 20) = 5.
    await expect(collect_msd_positions(trajectory, { max_bytes: 1000 })).rejects.toThrow(
      /needs 4800 bytes, over the 1000 byte budget\. Use frame_stride >= 5/,
    )
    // ...and that stride does go through
    const collected = await collect_msd_positions(trajectory, {
      max_bytes: 1000,
      frame_stride: 5,
    })
    expect(collected.n_frames).toBe(20)
  })
})

describe(`indexed trajectories never silently compute over the loaded window`, () => {
  const loader_stub = {
    get_total_frames: () => Promise.resolve(50),
    build_frame_index: () => Promise.resolve([]),
    load_frame: () => Promise.resolve(null),
    extract_plot_metadata: () => Promise.resolve([]),
  } satisfies FrameLoader
  // Shared streamed fixtures: 50-frame (window trap + no-raw-bytes) and 1500-frame (progress)
  const streamed_xyz_50 = synthetic_drift_xyz(50, 4)
  const streamed_xyz_1500 = synthetic_drift_xyz(1500, 2)

  it(`sees through total_frames vs frames.length`, () => {
    const stub = { ...make_drift_trajectory(10), total_frames: 50, is_indexed: true }
    expect(has_all_frames_in_memory(stub)).toBe(false)
    expect(has_all_frames_in_memory(make_drift_trajectory(10))).toBe(true)
  })

  it.each([
    // total_frames missing is not reachable through today's parser, but assuming
    // frames.length is complete is exactly the silent truncation this module prevents
    [`is_indexed but no total_frames`, { is_indexed: true }, /reports no total_frames/],
    [`a frame_loader but no total_frames`, { frame_loader: loader_stub }, /no total_frames/],
    [
      `no frame_loader at all`,
      { total_frames: 50, is_indexed: true },
      /only 10 are in memory and it has no frame_loader/,
    ],
    [
      `a frame_loader without stream_positions`,
      { total_frames: 50, is_indexed: true, frame_loader: loader_stub },
      /does not implement stream_positions/,
    ],
  ])(`throws for a trajectory with %s`, async (_label, overrides, pattern) => {
    const trajectory: TrajectoryType = { ...make_drift_trajectory(10), ...overrides }
    await expect(collect_msd_positions(trajectory, { raw_data: `x` })).rejects.toThrow(pattern)
  })

  it.each([
    [`missing`, null],
    [`empty buffer`, new ArrayBuffer(0)],
  ])(`throws when the raw payload is %s`, async (_label, raw_data) => {
    const trajectory = await indexed(streamed_xyz_50)
    expect(trajectory.frame_loader?.stream_positions).toBeTypeOf(`function`)
    await expect(collect_msd_positions(trajectory, { raw_data })).rejects.toThrow(
      /MSD needs the raw file bytes/,
    )
  })

  // The whole point of the module: an indexed trajectory holds 10 of 50 frames, and a
  // naive loop over `trajectory.frames` would compute MSD over those 10 with nothing
  // catching it. Streaming must recover all 50 and the full lag range.
  it(`streams the full payload instead of the 10-frame window`, async () => {
    const trajectory = await indexed(streamed_xyz_50)
    expect(trajectory.frames).toHaveLength(10)
    expect(trajectory.total_frames).toBe(50)

    const collected = await collect_msd_positions(trajectory, { raw_data: streamed_xyz_50 })
    expect(collected.n_frames).toBe(50)
    expect(collected.n_atoms).toBe(4)

    const result = calc_msd(collected)
    // max lag is 24 for 50 frames; a 10-frame silent truncation would cap it at 4
    expect(result.lags[result.lags.length - 1]).toBe(24)
    const expected = result.lags.map((lag) => (drift_per_frame * lag) ** 2)
    expect(max_rel_error(result.curves[0].msd, expected)).toBeLessThan(1e-9)
  })

  it(`streams from a source-independent loader without raw file bytes`, async () => {
    const stream_positions = vi.fn(async (_data: string | ArrayBuffer) =>
      collect_msd_positions(make_drift_trajectory(50)),
    )
    const trajectory: TrajectoryType = {
      ...make_drift_trajectory(10),
      total_frames: 50,
      is_indexed: true,
      frame_loader: {
        ...loader_stub,
        requires_source: false,
        stream_positions,
      },
    }

    const collected = await collect_msd_positions(trajectory)

    expect(collected.n_frames).toBe(50)
    expect(stream_positions).toHaveBeenCalledWith(``, expect.any(Object), undefined)
  })

  it(`matches a fully-parsed run frame for frame`, async () => {
    const xyz = synthetic_drift_xyz(30, 3)
    const [streamed_positions, memory_positions] = await Promise.all([
      indexed(xyz).then((traj) => collect_msd_positions(traj, { raw_data: xyz })),
      parse_trajectory_async(xyz, `drift.xyz`).then((traj) => collect_msd_positions(traj)),
    ])
    expect(streamed_positions.n_frames).toBe(memory_positions.n_frames)
    expect([...streamed_positions.positions]).toEqual([...memory_positions.positions])
    expect(calc_msd(streamed_positions).curves[0].msd).toEqual(
      calc_msd(memory_positions).curves[0].msd,
    )
  })

  // The interval counts COLLECTED frames, not source frame numbers: with stride 3 only
  // every 1500th source frame is both collected and a multiple of 500, so a source-number
  // interval would report a third as often for no reason the caller can see
  it.each([
    [1, 3], // 1500 collected frames -> reports at 500, 1000, 1500
    [3, 1], // 500 collected frames -> one report
    [500, 0], // 3 collected frames -> silent, where a source-number interval fired twice
  ])(
    `reports progress every 500 collected frames at stride %i`,
    async (frame_stride, expected_reports) => {
      const trajectory = await indexed(streamed_xyz_1500)
      const stages: string[] = []
      await collect_msd_positions(trajectory, {
        raw_data: streamed_xyz_1500,
        frame_stride,
        on_progress: (progress) => stages.push(progress.stage),
      })
      // report k fires on the 500k-th collected frame, i.e. source frame (500k - 1) * stride
      expect(stages).toEqual(
        Array.from(
          { length: expected_reports },
          (_unused, idx) => `Reading positions: ${(500 * (idx + 1) - 1) * frame_stride}/1500`,
        ),
      )
    },
  )

  it(`suggests a frame stride that fits the budget`, () => {
    const trajectory = { ...make_drift_trajectory(10), total_frames: 100_000 }
    // 2 atoms x 3 x f64 = 48 bytes per frame; a 4800 byte cap fits 100 frames
    expect(suggest_msd_frame_stride(trajectory, 4800)).toBe(1000)
    expect(suggest_msd_frame_stride({ frames: [] })).toBeNull()
  })
})

describe(`real MD fixtures`, () => {
  // Shared sanity checks for a real collected trajectory (finite, growing, origin falloff)
  const expect_sane_msd = (collected: MsdPositions): MsdResult => {
    expect(collected.lattice_matrices).not.toBeNull()
    const result = calc_msd(collected)
    expect(result.curves[0].label).toBe(`Total`)
    for (const curve of result.curves) {
      expect(curve.msd.every((value) => Number.isFinite(value) && value >= 0)).toBe(true)
      expect(curve.msd[curve.msd.length - 1]).toBeGreaterThan(curve.msd[0])
      expect(curve.n_origins[0]).toBeGreaterThan(curve.n_origins[curve.n_origins.length - 1])
    }
    return result
  }

  // Also covers the per-element/sanity checks that used to re-parse this same dump
  it(`honours the coords_unwrapped flag on a LAMMPS xu/yu/zu dump`, async () => {
    const filename = `mdanalysis-chain-dump.lammpstrj`
    const trajectory = await parse_trajectory_async(load_fixture(filename), filename)
    const collected = await collect_msd_positions(trajectory)
    expect(collected.coords_unwrapped).toBe(true)
    expect(collected.n_atoms).toBe(22)

    const honoured = expect_sane_msd(collected)
    expect(honoured.unwrapped).toBe(false)

    // The dump's real 10 A cell is larger than any per-frame displacement here, so the
    // minimum image convention would be a no-op and the flag would look harmless. Shrink
    // the cell below the largest real step and the two paths must diverge.
    let max_step = 0
    for (let frame = 1; frame < collected.n_frames; frame++) {
      for (let atom = 0; atom < collected.n_atoms; atom++) {
        const prev = ((frame - 1) * collected.n_atoms + atom) * 3
        const curr = (frame * collected.n_atoms + atom) * 3
        for (let axis = 0; axis < 3; axis++) {
          const step = collected.positions[curr + axis] - collected.positions[prev + axis]
          max_step = Math.max(max_step, Math.abs(step))
        }
      }
    }
    expect(max_step).toBeGreaterThan(0)
    const tight_cell = collected.lattice_matrices?.map(() => cubic_matrix(max_step)) ?? null

    const still_honoured = calc_msd({ ...collected, lattice_matrices: tight_cell })
    const wrongly_unwrapped = calc_msd({
      ...collected,
      lattice_matrices: tight_cell,
      coords_unwrapped: false,
    })
    expect(still_honoured.unwrapped).toBe(false)
    expect(wrongly_unwrapped.unwrapped).toBe(true)
    // Folding real displacements back into a max_step-wide box destroys the answer
    expect(wrongly_unwrapped.curves[0].msd[0]).toBeLessThan(
      still_honoured.curves[0].msd[0] * 0.9,
    )
  })

  it(`fails loudly on an unsorted LAMMPS dump instead of tracking the wrong atoms`, async () => {
    // Real dump written without `dump_modify sort id`: atom order changes between frames,
    // so index-based displacements would silently pair up unrelated atoms.
    const filename = `cell_0_T_800.0_dmu_0.3129032258064516.lammpstrj.gz`
    const trajectory = await parse_trajectory_async(load_fixture(filename), filename)
    expect(trajectory.frames.length).toBeGreaterThan(1)
    expect(trajectory.frames[0].structure.sites).toHaveLength(864)
    await expect(collect_msd_positions(trajectory)).rejects.toThrow(
      /Atom ordering changed at frame 1.*dump_modify/s,
    )
  })

  it(`computes a per-element MSD for vasp-XDATCAR.MD.gz`, async () => {
    const filename = `vasp-XDATCAR.MD.gz`
    const trajectory = await parse_trajectory_async(load_fixture(filename), filename)
    const collected = await collect_msd_positions(trajectory)
    expect(collected.n_atoms).toBe(80)
    const result = expect_sane_msd(collected)
    expect(result.curves.slice(1).map((curve) => curve.label)).toEqual([`Fe`, `O`])
  })
})

// Ticks and microtasks enough for the $effect to run, the (synchronous, since happy-dom
// has no Worker) compute promise to settle and the result to render.
const settle = async () => {
  for (let round = 0; round < 2; round++) {
    await tick()
    await Promise.resolve()
    await tick()
  }
}

// Click Compute/Recollect and drain it: collect() awaits a microtask per frame, so a
// single settle() leaves it mid-sweep. The button re-enables once collecting AND the
// downstream MsdPlot compute have both finished.
const run_collect = async () => {
  const button = document.querySelector<HTMLButtonElement>(`.msd-controls button`)
  if (!button) throw new Error(`no compute button in the MSD pane`)
  button.click()
  for (let round = 0; round < 40; round++) {
    await settle()
    if (!button.disabled) return
  }
  throw new Error(`collect never finished: button still disabled`)
}

const mount_and_read = async <Props extends Record<string, unknown>>(
  component: Component<Props>,
  props: Props,
): Promise<string> => {
  mount(component, { target: document.body, props })
  await settle()
  return document.body.textContent ?? ``
}

describe(`MsdPlot`, () => {
  const mount_plot = (props: ComponentProps<typeof MsdPlot>): Promise<string> =>
    mount_and_read(MsdPlot, { style: `width: 400px; height: 300px`, ...props })

  it(`renders a curve per result series plus its Einstein fit`, async () => {
    const text = await mount_plot({ result: calc_msd(drift_positions(40)) })
    expect(document.querySelector(`.scatter`)).not.toBeNull()
    // Single species: one MSD curve plus one dashed fit line
    expect(text).toContain(`Total`)
    expect(text).toContain(`R²`)
  })

  it(`reports the sub-sampling actually used`, async () => {
    const result = calc_msd(drift_positions(200), { origin_stride: 3 })
    expect(await mount_plot({ result })).toContain(`1 in 3 time origins`)
  })

  it(`shows the empty state without positions`, async () => {
    expect(await mount_plot({})).toContain(`No MSD data to display`)
  })

  // The empty state owns the message area, so a failed recompute has to drop the previous
  // curves — otherwise `series` stays non-empty and the error is never rendered
  it(`replaces stale curves with the error when a recompute fails`, async () => {
    const stale = calc_msd(drift_positions(20))
    // max_lag_fraction outside (0, 1] makes calc_msd (and so the worker) reject
    const text = await mount_plot({
      result: stale,
      positions: drift_positions(20),
      msd_options: { max_lag_fraction: 5 },
    })
    expect(text).toContain(`max_lag_fraction must be in (0, 1]`)
    expect(text).not.toContain(`R²`)
  })

  it(`discards a pending compute when positions are cleared`, async () => {
    const pending_compute = Promise.withResolvers<MsdResult>()
    const compute_spy = vi
      .spyOn(async_compute, `compute_msd_async`)
      .mockReturnValue(pending_compute.promise)
    const positions = drift_positions(20)
    const state = new SvelteMap<string, MsdPositions | MsdResult | boolean | undefined>([
      [`positions`, positions],
      [`result`, undefined],
      [`loading`, false],
    ])
    const component = mount(MsdPlot, {
      target: document.body,
      props: {
        get positions() {
          return state.get(`positions`) as MsdPositions | undefined
        },
        get result() {
          return state.get(`result`) as MsdResult | undefined
        },
        set result(value: MsdResult | undefined) {
          state.set(`result`, value)
        },
        get loading() {
          return state.get(`loading`) as boolean
        },
        set loading(value: boolean) {
          state.set(`loading`, value)
        },
      },
    })
    try {
      await tick()
      expect(state.get(`loading`)).toBe(true)
      state.set(`positions`, undefined)
      await tick()
      expect(state.get(`loading`)).toBe(false)

      pending_compute.resolve(calc_msd(positions))
      await settle()
      expect(state.get(`result`)).toBeUndefined()
    } finally {
      compute_spy.mockRestore()
      await unmount(component)
    }
  })
})

describe(`TrajectoryMsdPane`, () => {
  const in_memory = make_drift_trajectory(20)
  const lazy = { ...in_memory, total_frames: 500, is_indexed: true }

  const mount_pane = (trajectory: TrajectoryType): Promise<string> =>
    mount_and_read(TrajectoryMsdPane, { trajectory, pane_open: true })

  const type_stride = async (raw_stride: string) => {
    // the only whole-number input in the pane; the others step in fractions
    const stride_input = document.querySelector<HTMLInputElement>(
      `.msd-controls input[min='1'][step='1']`,
    )
    if (!stride_input) throw new Error(`no frame-stride input in the MSD pane`)
    stride_input.value = raw_stride
    stride_input.dispatchEvent(new Event(`input`))
    await settle()
  }

  it.each([
    [`in-memory trajectory`, in_memory, false],
    [`indexed trajectory`, lazy, true],
  ])(`warns only for an %s`, async (_label, trajectory, expects_warning) => {
    const text = await mount_pane(trajectory)
    expect(text).toContain(`Mean Squared Displacement`)
    expect(text.includes(`of 500 frames are in memory`)).toBe(expects_warning)
  })

  it(`surfaces the lazy-loading error instead of computing over the loaded window`, async () => {
    await mount_pane(lazy)
    document.querySelector<HTMLButtonElement>(`.msd-controls button`)?.click()
    await settle()
    expect(document.body.textContent).toContain(`no frame_loader`)
  })

  it(`does not claim raw bytes are unavailable for a source-independent loader`, async () => {
    const text = await mount_pane({
      ...lazy,
      frame_loader: {
        requires_source: false,
        get_total_frames: async () => 500,
        build_frame_index: async () => [],
        load_frame: async () => null,
        extract_plot_metadata: async () => [],
        stream_positions: async () => collect_msd_positions(make_drift_trajectory(500)),
      },
    })

    expect(text).toContain(`MSD streams the full payload`)
    expect(text).not.toContain(`raw file bytes are unavailable`)
  })

  // trajectory_total_frames throws here, and is_lazy/the stride suggestion both route
  // through it, so an unguarded derived would take the whole pane down
  it(`renders the pane when the frame count cannot be determined`, async () => {
    const text = await mount_pane({ ...in_memory, is_indexed: true })
    expect(text).toContain(`Mean Squared Displacement`)
    expect(text).toContain(`reports no total_frames`)
  })

  // A fraction is the case that bit: `Math.max(1, stride)` passed 2.5 straight through to
  // accumulate_positions, which rejects any non-integer stride. Cleared/zero input was
  // already coerced to 1, so those rows only pin that behaviour against regressions.
  it.each([``, `0`, `2.5`])(`normalises a frame stride of %j`, async (raw_stride) => {
    await mount_pane(in_memory)
    await type_stride(raw_stride)
    const hint = document.querySelector(`.msd-controls p.hint`)?.textContent ?? ``
    expect(hint).not.toContain(`NaN`)
    // stride 2.5 floors to 2, everything invalid falls back to 1
    expect(hint).toContain(`${raw_stride === `2.5` ? 10 : 20} frames`)
  })

  // ...and the stride the hint advertises has to be the one collection actually uses,
  // else accumulate_positions rejects the fraction outright
  it(`collects with a floored stride rather than rejecting a fractional one`, async () => {
    await mount_pane(in_memory)
    await type_stride(`2.5`)
    await run_collect()
    expect(document.body.textContent).not.toContain(`must be a positive integer`)
    expect(document.body.textContent).toContain(`1 in 2 frames`)
  })

  // Same defect MsdPlot had: clearing only `positions` leaves its effect early-returning,
  // so the old curves stay up and the message area never shows the failure
  it(`drops stale curves when a recollect fails`, async () => {
    const trajectory = { ...make_drift_trajectory(20) }
    await mount_pane(trajectory)
    await run_collect()
    expect(document.body.textContent).toContain(`R²`)
    // mutated in place so the trajectory-swap effect (which compares by reference, and
    // would reset `result` for us) does not fire
    trajectory.total_frames = 500
    await run_collect()
    expect(document.body.textContent).toContain(`only 20 are in memory`)
    expect(document.body.textContent).not.toContain(`R²`)
  })
})
