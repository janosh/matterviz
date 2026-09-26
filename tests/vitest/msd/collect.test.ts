import { calc_msd, collect_msd_positions, MsdPlot } from '$lib/msd'
import TrajectoryMsdPane from '$lib/msd/TrajectoryMsdPane.svelte'
import type {
  CollectPositionsOptions,
  ParseProgress,
  TrajectoryPositionStream,
  TrajectoryRun,
} from '$lib/trajectory'
import { suggest_analysis_frame_stride, trajectory_from_frames } from '$lib/trajectory'
import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { doc_query } from '../setup'
import { make_frame } from '../test-fixtures'
import { drift_positions, max_rel_error, on_x_axis } from './helpers'

const drift_per_frame = 0.13
const make_run = (n_frames: number): TrajectoryRun =>
  trajectory_from_frames(
    Array.from({ length: n_frames }, (_unused, frame_idx) => {
      const drift = drift_per_frame * frame_idx
      return make_frame(frame_idx, on_x_axis(drift, 1 + drift))
    }),
  )

const mounted: ReturnType<typeof mount>[] = []
afterEach(async () => {
  for (const component of mounted.splice(0)) await unmount(component)
})

describe(`collect_msd_positions`, () => {
  it.each([
    [1, 20, 0, 20],
    [2, 10, 0, 20],
    [3, 7, 0, 20],
    [3, 3, 4, 13],
  ])(
    `collects a memory run at stride %s`,
    async (frame_stride, expected_frames, start_frame, end_frame) => {
      const collected = await collect_msd_positions(make_run(20), {
        frame_stride,
        start_frame,
        end_frame,
      })
      expect(collected.steps).toEqual(
        Array.from(
          { length: expected_frames },
          (_unused, idx) => start_frame + idx * frame_stride,
        ),
      )
      expect(collected).toMatchObject({
        n_frames: expected_frames,
        n_atoms: 2,
        frame_stride,
        elements: [`H`, `H`],
        coords_unwrapped: false,
      })
      expect(collected.positions).toHaveLength(expected_frames * 2 * 3)
      const result = calc_msd(collected)
      const step = drift_per_frame * frame_stride
      expect(
        max_rel_error(
          result.curves[0].msd,
          result.lags.map((lag) => (step * lag) ** 2),
        ),
      ).toBeLessThan(1e-12)
    },
  )

  it(`forwards collection options, progress, and cancellation to the run`, async () => {
    const backing = make_run(4)
    const progress = vi.fn<(update: ParseProgress) => void>()
    const controller = new AbortController()
    const collect_positions = vi.fn(async (options?: CollectPositionsOptions) => {
      options?.on_progress?.({ current: 1, total: 4, stage: `Collecting` })
      return backing.collect_positions?.({
        ...options,
        on_progress: undefined,
      }) as Promise<TrajectoryPositionStream>
    })
    const run = { ...backing, collect_positions }
    await collect_msd_positions(run, {
      frame_stride: 2,
      max_bytes: 4096,
      on_progress: progress,
      signal: controller.signal,
    })
    expect(collect_positions).toHaveBeenCalledWith({
      frame_stride: 2,
      max_bytes: 4096,
      on_progress: progress,
      signal: controller.signal,
    })
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 4, stage: `Collecting` })
  })

  it.each([
    [`a single-frame run`, () => make_run(1), `need at least 2 frames`],
    [
      `a host run without a full position pass`,
      () => {
        const { collect_positions: _collect_positions, ...frame_only } = make_run(4)
        return frame_only
      },
      `only serves frames one at a time`,
    ],
  ])(`rejects %s`, async (_label, run, error) => {
    await expect(collect_msd_positions(run())).rejects.toThrow(error)
  })

  it(`enforces the memory budget and suggests the minimum fitting stride`, async () => {
    const run = make_run(100)
    expect(suggest_analysis_frame_stride(run, 1000)).toBe(5)
    expect(suggest_analysis_frame_stride(run, 1000, 1, 10)).toBe(1)
    expect(
      (await collect_msd_positions(run, { max_bytes: 1000, start_frame: 10, end_frame: 20 }))
        .n_frames,
    ).toBe(10)
    await expect(
      collect_msd_positions(run, { start_frame: 10, end_frame: 12, frame_stride: 2 }),
    ).rejects.toThrow(`need at least 2 frames, got 1`)
    await expect(collect_msd_positions(run, { max_bytes: 1000 })).rejects.toThrow(
      `Use frame_stride >= 5`,
    )
  })
})

describe(`MSD components`, () => {
  it.each([
    [undefined, `R²`],
    // 40 frames give lags 1..19: fractions 0.5-1 of the largest lag pick lags 10-19
    [{ start_fraction: 0.5, end_fraction: 1 }, `10–19`],
    [{ start_fraction: 0.8, end_fraction: 0.2 }, `must be below end_fraction`],
  ])(`renders a curve and its Einstein fit for %o`, async (fit_options, expected) => {
    const result = calc_msd(drift_positions(40))
    mounted.push(
      mount(MsdPlot, {
        target: document.body,
        props: { result, fit_options, style: `width: 400px; height: 300px` },
      }),
    )
    await tick()
    expect(document.querySelector(`.scatter`)).not.toBeNull()
    expect(document.body.textContent).toContain(expected)
  })

  it(`collects through TrajectoryMsdPane and carries the run timestep into units`, async () => {
    const run = make_run(20)
    mounted.push(
      mount(TrajectoryMsdPane, {
        target: document.body,
        props: {
          run,
          pane_open: true,
          default_dt: 2,
          default_time_unit: `fs`,
        },
      }),
    )
    await tick()
    const button = doc_query<HTMLButtonElement>(`.trajectory-msd-controls button`)
    button.click()
    await vi.waitFor(() => expect(document.body.textContent).toContain(`Å²/fs`))
    expect(button.disabled).toBe(false)
    expect(document.body.textContent).toContain(`2 fs per collected frame`)
  })
})
