import { FS_IN_ASE_TIME } from '#lib/constants.js'
import type { CollectPositionsOptions, TrajectoryRun } from '#lib/trajectory/index.js'
import { open_trajectory } from '#lib/trajectory/open.js'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory.js'
import { calc_vacf } from '#lib/vacf/calc-vacf.js'
import {
  collect_vacf_input,
  suggest_vacf_frame_stride,
  VELOCITY_SITE_PROPERTY,
} from '#lib/vacf/collect.js'
import { describe, expect, it, vi } from 'vitest'
import { make_frame } from '../test-fixtures'
import { make_ase_md_buffer } from '../trajectory/fixtures'
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

  // ASE stores momenta, not velocities, in .traj frames and the extXYZ it writes. Both must
  // reach VACF as stored p/m in Å/fs (atoms.get_velocities() * ase.units.fs), with frame 0's
  // recorded masses (inherited by .traj frames without a topology header) or standard ones.
  const ase_extxyz = (masses: boolean): string =>
    [0, 1]
      .map((frame_idx) =>
        [
          `2`,
          `Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3:momenta:R:3${masses ? `:masses:R:1` : ``} pbc="T T T"`,
          ...[0, 1].map(
            (atom_idx) =>
              `H ${atom_idx + 1} 1 1 ${2 * (frame_idx + 1)} 0 0${masses ? ` 2` : ``}`,
          ),
        ].join(`\n`),
      )
      .join(`\n`)
  it.each([
    [`.traj with recorded masses`, () => make_ase_md_buffer(2), `md.traj`, 2],
    [`.traj with standard masses`, () => make_ase_md_buffer(2, false), `md.traj`, 1.008],
    [`extXYZ with masses`, () => ase_extxyz(true), `md.extxyz`, 2],
    [`extXYZ with standard masses`, () => ase_extxyz(false), `md.extxyz`, 1.008],
  ])(`uses ASE momenta of %s as stored velocities`, async (_label, source, filename, mass) => {
    // eager (in-memory) and indexed runs decode frames through the same readers
    for (const index_above_bytes of [0, Infinity]) {
      const run = await open_trajectory(source(), { filename, index_above_bytes })
      const collected = await collect_vacf_input(run)
      expect(collected.velocity_unit).toBe(`A/fs`)
      expect(collected.velocities).toEqual(
        Float64Array.from(
          [1, 2]
            .flatMap((scale) => [scale, scale])
            .flatMap((scale) => [((2 * scale) / mass) * FS_IN_ASE_TIME, 0, 0]),
        ),
      )
      const result = calc_vacf(collected)
      expect(result).toMatchObject({ velocity_source: `stored`, velocity_unit: `(A/fs)^2` })
      run.dispose()
    }
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

  // calc_vacf needs 2 velocity frames; differentiating positions drops the two endpoints
  it.each([
    [1, true, 2],
    [3, false, 4],
  ])(`rejects %i frames (stored velocities: %s)`, async (n_frames, stored, min_frames) => {
    await expect(collect_vacf_input(make_run(n_frames, stored))).rejects.toThrow(
      `need at least ${min_frames} frames`,
    )
    const shortest = await collect_vacf_input(make_run(min_frames, stored))
    expect(calc_vacf(shortest).lags).toHaveLength(2)
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
