import type { Vec3 } from '$lib/math'
import type {
  FrameLoader,
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryType,
} from '$lib/trajectory'
import {
  calc_vacf,
  collect_vacf_input,
  suggest_vacf_frame_stride,
  VELOCITY_SITE_PROPERTY,
} from '$lib/vacf'
import { describe, expect, it } from 'vitest'
import { make_crystal } from '../setup'
import { circular_motion, max_abs_error } from './helpers'

// One frame whose sites optionally carry a `velocity` vec3 in site.properties, the shape
// the extXYZ / LAMMPS parsers write per-atom velocities into
function make_frame(
  step: number,
  xyz_list: Vec3[],
  velocities?: (Vec3 | undefined)[],
): TrajectoryFrame {
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

// n_frames of a single orbiting atom, with velocities attached when asked for
function make_trajectory(n_frames: number, with_velocities: boolean): TrajectoryType {
  const { positions, velocities } = circular_motion(n_frames, 0.03, 1.5)
  return {
    frames: positions.map((frame, frame_idx) =>
      make_frame(
        frame_idx,
        frame.map((xyz) => xyz as Vec3),
        with_velocities ? velocities[frame_idx].map((vel) => vel as Vec3) : undefined,
      ),
    ),
  }
}

describe(`in-memory collection`, () => {
  it(`picks up per-atom velocities stored on the sites`, async () => {
    const collected = await collect_vacf_input(make_trajectory(50, true))
    expect(collected.n_frames).toBe(50)
    expect(collected.velocities).toBeInstanceOf(Float64Array)
    expect(collected.velocities).toHaveLength(50 * 1 * 3)
    // Parsers/TrajectoryType expose no velocity unit today, so collect leaves it unset
    expect(collected.velocity_unit).toBeUndefined()
    // Same orbit the fixture built: v(0) = A w (1, 0, 0)
    const omega = 2 * Math.PI * 0.03
    expect(collected.velocities?.[0]).toBeCloseTo(1.5 * omega, 12)
    expect(collected.velocities?.[1]).toBeCloseTo(0, 12)

    const result = calc_vacf(collected, { vdos: { skip: true } })
    expect(result.velocity_source).toBe(`stored`)
    expect(result.velocity_unit).toBe(`(file velocity units)^2`)
    const expected = result.lags.map((lag) => Math.cos(omega * lag))
    expect(max_abs_error(result.curves[0].vacf_normalized, expected)).toBeLessThan(1e-12)
  })

  it(`returns a null velocity buffer when the file stored none`, async () => {
    const collected = await collect_vacf_input(make_trajectory(50, false))
    expect(collected.velocities).toBeNull()
    expect(calc_vacf(collected, { vdos: { skip: true } }).velocity_source).toBe(
      `central_difference`,
    )
  })

  it(`strides velocities in lockstep with positions`, async () => {
    const collected = await collect_vacf_input(make_trajectory(30, true), {
      frame_stride: 3,
    })
    expect(collected.n_frames).toBe(10)
    expect(collected.velocities).toHaveLength(10 * 3)
    // Collected frame 1 is source frame 3
    const omega = 2 * Math.PI * 0.03
    expect(collected.velocities?.[3]).toBeCloseTo(1.5 * omega * Math.cos(omega * 3), 12)
  })

  it(`refuses a trajectory where only some atoms carry velocities`, async () => {
    const { positions, velocities } = circular_motion(10, 0.05, 1)
    const trajectory: TrajectoryType = {
      frames: positions.map((frame, frame_idx) =>
        make_frame(
          frame_idx,
          [frame[0] as Vec3, [5, 5, 5]],
          // Atom 0 has a velocity, atom 1 does not
          [velocities[frame_idx][0] as Vec3, undefined],
        ),
      ),
    }
    await expect(collect_vacf_input(trajectory)).rejects.toThrow(
      /site 0 has a 'velocity' property but site 1 does not/,
    )
  })

  it(`refuses a trajectory where only some frames carry velocities`, async () => {
    const trajectory = make_trajectory(10, true)
    // Strip the velocity off the last frame only
    for (const site of trajectory.frames[9].structure.sites) site.properties = {}
    await expect(collect_vacf_input(trajectory)).rejects.toThrow(
      /Frame 0 stores per-atom velocities but frame 9 does not/,
    )
  })

  it.each([2, 1])(`refuses a %i-frame trajectory`, async (n_frames) => {
    await expect(collect_vacf_input(make_trajectory(n_frames, true))).rejects.toThrow(
      /need at least 3 frames to differentiate velocities/,
    )
  })
})

describe(`indexed trajectories`, () => {
  const loader_methods = (total_frames: number) => ({
    get_total_frames: async () => total_frames,
    build_frame_index: async () => [],
    load_frame: async () => null,
    extract_plot_metadata: async () => [],
  })
  const lazy_trajectory = (loader?: FrameLoader, with_velocities = false): TrajectoryType => ({
    ...make_trajectory(5, with_velocities),
    total_frames: 500,
    is_indexed: true,
    ...(loader ? { frame_loader: loader } : {}),
  })

  const indexed_refusals: { label: string; loader?: FrameLoader; pattern: RegExp }[] = [
    {
      label: `no frame_loader`,
      pattern: /only 5 are in memory and it has no frame_loader/,
    },
    {
      label: `loader without stream_positions`,
      loader: loader_methods(500) satisfies FrameLoader,
      pattern: /does not implement stream_positions/,
    },
    {
      label: `missing raw_data`,
      loader: {
        ...loader_methods(500),
        stream_positions: async () => {
          throw new Error(`should not be reached`)
        },
      } satisfies FrameLoader,
      pattern: /VACF needs the raw file bytes to stream the remaining frames/,
    },
  ]
  it.each(indexed_refusals)(`refuses when $label`, async ({ loader, pattern }) => {
    await expect(collect_vacf_input(lazy_trajectory(loader))).rejects.toThrow(pattern)
  })

  // A loader that streams 40 frames of one atom, handing back whatever velocity channel
  // the test names, and recording the options it was asked with.
  type RecordingLoader = FrameLoader & { requested_options?: PositionStreamOptions }
  const streaming_loader = (velocity_channel: unknown): RecordingLoader => {
    const loader: RecordingLoader = {
      ...loader_methods(40),
      stream_positions: async (
        _data: string | ArrayBuffer,
        stream_options?: PositionStreamOptions,
      ) => {
        loader.requested_options = stream_options
        const vectors: Record<string, Float64Array> = {}
        if (velocity_channel != null)
          Reflect.set(vectors, VELOCITY_SITE_PROPERTY, velocity_channel)
        return {
          positions: Float64Array.from(circular_motion(40, 0.03, 1.5).positions.flat().flat()),
          ...(velocity_channel != null ? { vectors } : {}),
          n_frames: 40,
          n_atoms: 1,
          elements: [`H` as const],
          lattice_matrices: null,
          pbc: null,
          coords_unwrapped: false,
          frame_stride: 1,
          steps: Array.from({ length: 40 }, (_unused, idx) => idx),
        }
      },
    }
    return loader
  }

  it(`requests the velocity channel and reads it back off stream.vectors`, async () => {
    const { velocities } = circular_motion(40, 0.03, 1.5)
    const loader = streaming_loader(Float64Array.from(velocities.flat().flat()))
    // In-memory frames carry velocities, which is what makes the sweep ask for them
    const collected = await collect_vacf_input(lazy_trajectory(loader, true), {
      raw_data: `stub payload`,
    })
    expect(loader.requested_options?.vector_keys).toEqual([VELOCITY_SITE_PROPERTY])
    expect(collected.velocities).toHaveLength(40 * 3)
    expect(calc_vacf(collected, { vdos: { skip: true } }).velocity_source).toBe(`stored`)
  })

  it.each([
    [`with raw bytes`, `stub payload`, undefined],
    [`without raw bytes from a source-independent loader`, undefined, false],
  ])(
    `does not request velocities when the in-memory frames carry none %s`,
    async (_label, raw_data, requires_source) => {
      const loader = streaming_loader(null)
      if (requires_source === false) loader.requires_source = false
      const collected = await collect_vacf_input(lazy_trajectory(loader), { raw_data })
      expect(collected.n_frames).toBe(40)
      expect(loader.requested_options?.vector_keys).toBeUndefined()
      expect(collected.velocities).toBeNull()
    },
  )

  it.each([
    {
      label: `not a Float64Array`,
      channel: new Float32Array(120),
      pattern: /'velocity' channel of type object; VACF needs a Float64Array/,
    },
    {
      label: `length disagreeing with positions`,
      channel: new Float64Array(9),
      pattern: /returned 9 velocity components but the collected positions need 120/,
    },
  ])(`rejects a velocity channel $label`, async ({ channel, pattern }) => {
    const loader = streaming_loader(channel)
    await expect(
      collect_vacf_input(lazy_trajectory(loader, true), { raw_data: `stub payload` }),
    ).rejects.toThrow(pattern)
  })
})

describe(`suggest_vacf_frame_stride`, () => {
  it(`handles missing atom counts and budgets stored velocity buffers`, () => {
    expect(suggest_vacf_frame_stride({ frames: [] })).toBeNull()
    const with_velocities = make_trajectory(1000, true)
    const without = make_trajectory(1000, false)
    // 1000 frames x 1 atom x 3 x f64 = 24 kB of positions; a 30 kB budget fits one buffer
    // at stride 1 but needs stride 2 once velocities double the footprint
    expect(suggest_vacf_frame_stride(without, 30_000)).toBe(1)
    expect(suggest_vacf_frame_stride(with_velocities, 30_000)).toBe(2)
  })
})
