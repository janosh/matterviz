import type { CollectPositionsOptions, TrajectoryRun } from '#lib/trajectory/index.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { calc_vacf } from '#lib/vacf/calc-vacf.js'
import {
  collect_vacf_input,
  suggest_vacf_frame_stride,
  VELOCITY_SITE_PROPERTY,
} from '#lib/vacf/collect.js'
import { describe, expect, it, vi } from 'vitest'
import { make_frame } from '../test-fixtures'
import { max_abs_error, orbit_run } from './helpers'

const make_run = (n_frames: number, with_velocities: boolean): TrajectoryRun =>
  orbit_run(n_frames, 0.03, 1.5, with_velocities)

describe(`collect_vacf_input`, () => {
  it(`collects stored per-atom velocities and reproduces the analytic circular VACF`, async () => {
    const collected = await collect_vacf_input(make_run(50, true))
    expect(collected.velocities).toBeInstanceOf(Float64Array)
    expect(collected.velocities).toHaveLength(50 * 3)
    // text formats record no velocity unit; an HDF5 run declares one on its signal
    expect(collected.velocity_unit).toBeNull()
    const declared = {
      ...make_run(5, true),
      signals: {
        velocity: { sample_shape: [1, 3], sample_count: 5, frame_aligned: true, unit: `A/ps` },
      },
    }
    expect((await collect_vacf_input(declared)).velocity_unit).toBe(`A/ps`)
    const omega = 2 * Math.PI * 0.03
    expect(collected.velocities?.[0]).toBeCloseTo(1.5 * omega, 12)
    const result = calc_vacf(collected)
    expect(result.velocity_source).toBe(`stored`)
    expect(
      max_abs_error(
        result.curves[0].vacf_normalized,
        result.lags.map((lag) => Math.cos(omega * lag)),
      ),
    ).toBeLessThan(1e-12)
  })

  it(`falls back to central differences when no velocities are stored`, async () => {
    const collected = await collect_vacf_input(make_run(50, false))
    expect(collected.velocities).toBeNull()
    expect(calc_vacf(collected).velocity_source).toBe(`central_difference`)
  })

  it(`strides velocities in lockstep with positions`, async () => {
    const collected = await collect_vacf_input(make_run(30, true), { frame_stride: 3 })
    expect(collected).toMatchObject({ n_frames: 10, frame_stride: 3 })
    expect(collected.velocities).toHaveLength(30)
    const omega = 2 * Math.PI * 0.03
    expect(collected.velocities?.[3]).toBeCloseTo(1.5 * omega * Math.cos(omega * 3), 12)
  })

  it.each([1, 2])(`rejects a %i-frame run`, async (n_frames) => {
    await expect(collect_vacf_input(make_run(n_frames, true))).rejects.toThrow(
      `need at least 3 frames`,
    )
  })

  it(`requests the velocity channel from a streaming run`, async () => {
    const backing = make_run(8, true)
    const backing_collect = backing.collect_positions
    if (!backing_collect) throw new Error(`Expected a position collector`)
    const collect_positions = vi.fn(async (options?: CollectPositionsOptions) =>
      backing_collect(options),
    )
    const collected = await collect_vacf_input({ ...backing, collect_positions })
    expect(collect_positions).toHaveBeenCalledWith({ vector_keys: [VELOCITY_SITE_PROPERTY] })
    expect(collected.velocities).toBeInstanceOf(Float64Array)
  })

  it.each([
    [`non-Float64Array`, [1, 2, 3], `needs a Float64Array`],
    [`wrong length`, new Float64Array(1), `must share a layout`],
  ])(`rejects a $label streamed velocity channel`, async (_label, velocity, error) => {
    const backing = make_run(3, true)
    const stream = await backing.collect_positions?.({ vector_keys: [VELOCITY_SITE_PROPERTY] })
    if (!stream) throw new Error(`Expected a position stream`)
    const run = {
      ...backing,
      collect_positions: async () => ({
        ...stream,
        vectors: { [VELOCITY_SITE_PROPERTY]: velocity },
      }),
    } as unknown as TrajectoryRun
    await expect(collect_vacf_input(run)).rejects.toThrow(error)
  })

  // positions + velocities = 2 trajectory-sized buffers, plus the unwrapped copy that deriving
  // velocities from wrapped positions in a cell caches (3). Budgeting that path at 1 told a
  // 20k-frame x 1k-atom run to stride 1 and hold ~1.4 GB against a 512 MB budget.
  it.each([
    [`stored`, { box_length: 5, velocities: [[1, 0, 0]] }, [1, 1, 2], [1, 1, 1]],
    [`molecule-derived`, {}, [1, 1, 2], [1, 1, 1]],
    [`unwrapped-derived`, { box_length: 5, coords_unwrapped: true }, [1, 1, 2], [1, 1, 1]],
    [`cell-derived`, { box_length: 5 }, [1, 2, 4], [1, 1, 2]],
  ])(
    `budgets every buffer calc_vacf holds for %s velocities`,
    (_label, frame_options, strides, window_strides) => {
      const run = trajectory_from_frames(
        Array.from({ length: 1000 }, (_, idx) => make_frame(idx, [[0, 0, 0]], frame_options)),
      )
      const budgets = [72_000, 48_000, 24_000]
      expect(budgets.map((max_bytes) => suggest_vacf_frame_stride(run, max_bytes))).toEqual(
        strides,
      )
      expect(
        budgets.map((max_bytes) => suggest_vacf_frame_stride(run, max_bytes, 500)),
      ).toEqual(window_strides)
    },
  )
})
