import type { Vec3 } from '$lib/math'
import {
  trajectory_from_frames,
  type ParseProgress,
  type PositionStreamOptions,
  type TrajectoryFrame,
  type TrajectoryRun,
} from '$lib/trajectory'
import {
  calc_vacf,
  collect_vacf_input,
  suggest_vacf_frame_stride,
  VELOCITY_SITE_PROPERTY,
} from '$lib/vacf'
import { describe, expect, it, vi } from 'vitest'
import { make_crystal } from '../setup'
import { circular_motion, max_abs_error } from './helpers'

const make_frame = (
  step: number,
  xyz_list: Vec3[],
  velocities?: (Vec3 | undefined)[],
): TrajectoryFrame => {
  const crystal = make_crystal(
    20,
    xyz_list.map((xyz, idx) => ({
      element: `H`,
      xyz,
      ...(velocities?.[idx] ? { properties: { velocity: velocities[idx] } } : {}),
    })),
    { charge: 0 },
  )
  return { step, structure: { charge: 0, sites: crystal.sites } }
}

const make_run = (n_frames: number, with_velocities: boolean): TrajectoryRun => {
  const { positions, velocities } = circular_motion(n_frames, 0.03, 1.5)
  return trajectory_from_frames(
    positions.map((frame, frame_idx) =>
      make_frame(
        frame_idx,
        frame.map((xyz) => xyz as Vec3),
        with_velocities
          ? velocities[frame_idx].map((velocity) => velocity as Vec3)
          : undefined,
      ),
    ),
  )
}

describe(`collect_vacf_input`, () => {
  it(`collects stored per-atom velocities and reproduces the analytic circular VACF`, async () => {
    const collected = await collect_vacf_input(make_run(50, true))
    expect(collected.velocities).toBeInstanceOf(Float64Array)
    expect(collected.velocities).toHaveLength(50 * 3)
    const omega = 2 * Math.PI * 0.03
    expect(collected.velocities?.[0]).toBeCloseTo(1.5 * omega, 12)
    const result = calc_vacf(collected, { vdos: { skip: true } })
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
    expect(calc_vacf(collected, { vdos: { skip: true } }).velocity_source).toBe(
      `central_difference`,
    )
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
    const collect_positions = vi.fn(
      async (
        options?: PositionStreamOptions,
        on_progress?: (progress: ParseProgress) => void,
        signal?: AbortSignal,
      ) => backing_collect(options, on_progress, signal),
    )
    const collected = await collect_vacf_input({ ...backing, collect_positions })
    expect(collect_positions).toHaveBeenCalledWith(
      { frame_stride: 1, max_bytes: 512 * 1024 * 1024, vector_keys: [VELOCITY_SITE_PROPERTY] },
      undefined,
      undefined,
    )
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

  it(`budgets both positions and stored velocities when suggesting a stride`, () => {
    const run = make_run(1000, true)
    expect(suggest_vacf_frame_stride(run, 48_000)).toBe(1)
    expect(suggest_vacf_frame_stride(run, 24_000)).toBe(2)
  })
})
