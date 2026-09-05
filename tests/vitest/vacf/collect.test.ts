import type { CollectPositionsOptions, TrajectoryRun } from '$lib/trajectory'
import {
  calc_vacf,
  collect_vacf_input,
  suggest_vacf_frame_stride,
  VELOCITY_SITE_PROPERTY,
} from '$lib/vacf'
import { describe, expect, it, vi } from 'vitest'
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

  // Stored velocities are used as they are (positions + velocities = 2 trajectory-sized
  // buffers); a file WITHOUT them holds 3, since calc_vacf caches an unwrapped position copy
  // and builds the central-difference series from it. Budgeting that path at 1 told a
  // 20k-frame x 1k-atom run to stride 1 and hold ~1.4 GB against a 512 MB budget.
  it.each([
    [`stored`, true, [1, 1, 2], [1, 1, 1]],
    [`derived`, false, [1, 2, 4], [1, 1, 2]],
  ])(
    `budgets every buffer calc_vacf holds for %s velocities`,
    (_label, has_velocity_columns, strides, window_strides) => {
      const run = make_run(1000, has_velocity_columns)
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
