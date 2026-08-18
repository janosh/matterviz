import type {
  FrameIndex,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryFrameStore,
  TrajectoryType,
} from '$lib/trajectory'
import {
  get_trajectory_stats,
  pick_pane_orientation,
  validate_trajectory,
} from '$lib/trajectory'
import { create_packed_frame_loader, validate_3x3_matrix } from '$lib/trajectory/helpers'
import { frame_loader_data, has_frame_loader_data } from '$lib/trajectory/analysis'
import { describe, expect, test } from 'vitest'
import { make_trajectory_frame } from '../setup'

// Factory for trajectories
function make_trajectory(
  frame_count: number,
  options: {
    atoms_per_frame?: number | number[]
    with_indexed_frames?: boolean
    with_plot_metadata?: boolean
    total_frames?: number
  } = {},
): TrajectoryType {
  const {
    atoms_per_frame = 3,
    with_indexed_frames = false,
    with_plot_metadata = false,
    total_frames,
  } = options

  const frames = Array.from({ length: frame_count }, (_, idx) => {
    const atoms =
      typeof atoms_per_frame === `number` ? atoms_per_frame : (atoms_per_frame[idx] ?? 3)
    return make_trajectory_frame(idx * 10, atoms)
  })

  const trajectory: TrajectoryType = { frames }
  if (total_frames !== undefined) trajectory.total_frames = total_frames
  if (with_indexed_frames) {
    trajectory.indexed_frames = frames.map(
      (_, idx): FrameIndex => ({
        frame_number: idx,
        byte_offset: idx * 1000,
        estimated_size: 1000,
      }),
    )
    trajectory.is_indexed = true
  }
  if (with_plot_metadata) {
    trajectory.plot_metadata = frames.map(
      (frame, idx): TrajectoryMetadata => ({
        frame_number: idx,
        step: frame.step,
        properties: { energy: -idx * 0.1, temperature: 300 + idx },
      }),
    )
  }
  return trajectory
}

describe(`validate_trajectory`, () => {
  test(`valid trajectory returns empty errors`, () => {
    expect(validate_trajectory(make_trajectory(5))).toEqual([])
  })

  // oxfmt-ignore
  test.each([
    [`empty frames`, { frames: [] }, `Trajectory must have at least one frame`],
    [`no structure`, { frames: [{ step: 0 } as TrajectoryFrame] },
      `Frame 0 missing structure or sites`],
    [`empty sites`, { frames: [{ structure: { sites: [] }, step: 0 }] },
      `Frame 0 missing structure or sites`],
  ])(`returns error for %s`, (_desc, trajectory, expected_error) => {
    expect(validate_trajectory(trajectory as TrajectoryType)).toContain(expected_error)
  })

  test(`returns error for frame without step`, () => {
    const frame = make_trajectory_frame(0)
    // @ts-expect-error intentionally removing step
    delete frame.step
    expect(validate_trajectory({ frames: [frame] })).toContain(
      `Frame 0 missing or invalid step number`,
    )
  })

  test.each([
    [{ atom_masses: `invalid` }, `atom_masses must be an array`],
    [{ signals: [] }, `signals must be an object`],
    [{ signals: { dipole: null } }, `signals.dipole must be an object`],
    [
      {
        signals: {
          dipole: { sample_shape: `3`, values: new Float64Array(3), steps: [0] },
        },
      },
      `signals.dipole.sample_shape must be scalar, [3], [3, 3], [n_atoms], or [n_atoms, 3], got "3"`,
    ],
    [
      { signals: { dipole: { sample_shape: [3], values: [1, 2, 3], steps: [0] } } },
      `signals.dipole.values must be a Float64Array`,
    ],
    [
      {
        signals: {
          dipole: { sample_shape: [3], values: new Float64Array(3), steps: `0` },
        },
      },
      `signals.dipole.steps must be an array`,
    ],
    [
      {
        signals: {
          dipole: {
            sample_shape: [3],
            values: new Float64Array(3),
            steps: [0],
            unit: 4,
          },
        },
      },
      `signals.dipole.unit must be a non-empty string when supplied`,
    ],
  ])(`returns contextual errors for malformed runtime trajectory fields`, (invalid, error) => {
    const trajectory = Object.assign(make_trajectory(1), invalid) as TrajectoryType
    expect(validate_trajectory(trajectory)).toContain(error)
  })

  test.each<[number[], number]>([
    [[], 4],
    [[3], 4],
    [[3, 3], 4],
    [[4], 4],
    [[4, 3], 4],
  ])(`accepts supported trajectory signal shape %j`, (sample_shape, n_atoms) => {
    const sample_size = sample_shape.reduce((total, size) => total * size, 1)
    const trajectory = make_trajectory(1, { atoms_per_frame: n_atoms })
    trajectory.signals = {
      custom: { sample_shape, values: new Float64Array(sample_size), steps: [0] },
    }
    expect(validate_trajectory(trajectory)).toEqual([])
  })

  test.each([
    { sample_shape: [2] },
    { sample_shape: [2, 2] },
    { sample_shape: [3, 2] },
    { sample_shape: [3, 3, 1] },
  ])(`rejects unsupported trajectory signal shape %j`, ({ sample_shape }) => {
    const trajectory = make_trajectory(1)
    trajectory.signals = {
      custom: { sample_shape, values: new Float64Array(1), steps: [0] },
    }
    expect(validate_trajectory(trajectory)).toContainEqual(
      expect.stringContaining(`signals.custom.sample_shape must be scalar`),
    )
  })

  describe(`streaming properties`, () => {
    test(`fully valid streaming trajectory returns no errors`, () => {
      const traj = make_trajectory(3, {
        with_indexed_frames: true,
        with_plot_metadata: true,
        total_frames: 3,
      })
      expect(validate_trajectory(traj)).toEqual([])
    })

    test(`accepts a packed store as the indexed frame representation`, () => {
      const traj = make_trajectory(1)
      traj.total_frames = 2
      traj.is_indexed = true
      traj.frame_store = {
        positions: new Float64Array(18),
        elements: [`H`, `H`, `H`],
        coords_unwrapped: false,
        steps: [0, 1],
        metadata: [{}, {}],
        plot_metadata: [0, 1].map((frame_number) => ({
          frame_number,
          step: frame_number,
          properties: {},
        })),
      }
      expect(validate_trajectory(traj)).toEqual([])
    })

    test.each([
      [
        (traj: TrajectoryType) => {
          traj.total_frames = -1
        },
        `total_frames must be a positive`,
        1,
      ],
      [
        (traj: TrajectoryType) => {
          // @ts-expect-error intentionally setting invalid type
          traj.total_frames = `invalid`
        },
        `total_frames must be a positive number, got invalid`,
        1,
      ],
      [
        (traj: TrajectoryType) => {
          traj.total_frames = 2
          traj.indexed_frames = make_trajectory(3, {
            with_indexed_frames: true,
          }).indexed_frames
        },
        `frame_number >= total_frames`,
        1,
      ],
      [
        (traj: TrajectoryType) => {
          traj.is_indexed = true
        },
        `is_indexed is true but indexed_frames is missing`,
        1,
      ],
      [
        (traj: TrajectoryType) => {
          traj.is_indexed = true
          traj.indexed_frames = []
        },
        `is_indexed is true but indexed_frames is missing or empty`,
        1,
      ],
    ])(`validates streaming property errors`, (mutate, expected_substr, expected_count) => {
      const traj = make_trajectory(3)
      mutate(traj)
      const errors = validate_trajectory(traj)
      expect(errors.some((err) => err.includes(expected_substr))).toBe(true)
      expect(errors).toHaveLength(expected_count)
    })
  })

  describe(`indexed_frames validation`, () => {
    test(`validates array type`, () => {
      const traj = make_trajectory(3)
      // @ts-expect-error intentionally setting invalid type
      traj.indexed_frames = `not an array`
      expect(validate_trajectory(traj)).toContain(`indexed_frames must be an array`)
    })

    test.each([
      [`frame_number`, 0, `missing or invalid frame_number`, 1],
      [`byte_offset`, 0, `missing or invalid byte_offset`, 1],
      [`estimated_size`, 0, `missing or invalid estimated_size`, 1],
    ])(`validates %s field`, (field, idx, expected_substr, expected_count) => {
      const traj = make_trajectory(3, { with_indexed_frames: true })
      const indexed = traj.indexed_frames
      if (!indexed) throw new Error(`indexed_frames should exist`)
      // @ts-expect-error intentionally invalidating field
      indexed[idx][field] = undefined
      const errors = validate_trajectory(traj)
      expect(errors.some((err) => err.includes(expected_substr))).toBe(true)
      expect(errors).toHaveLength(expected_count)
    })

    test(`validates strictly increasing frame_number`, () => {
      const traj = make_trajectory(3, { with_indexed_frames: true })
      const indexed = traj.indexed_frames
      if (!indexed) throw new Error(`indexed_frames should exist`)
      indexed[1].frame_number = 0
      expect(
        validate_trajectory(traj).some((err) =>
          err.includes(`frame_number (0) must be strictly increasing`),
        ),
      ).toBe(true)
    })
  })

  describe(`plot_metadata validation`, () => {
    test(`validates array type`, () => {
      const traj = make_trajectory(3)
      // @ts-expect-error intentionally setting invalid type
      traj.plot_metadata = `not an array`
      expect(validate_trajectory(traj)).toContain(`plot_metadata must be an array`)
    })

    test.each([
      [`frame_number`, `plot_metadata[0] missing or invalid frame`, 1],
      [`step`, `plot_metadata[0] missing or invalid step`, 1],
      [`properties`, `plot_metadata[0] missing or invalid properties`, 1],
    ])(`validates %s field`, (field, expected_substr, expected_count) => {
      const traj = make_trajectory(3, { with_plot_metadata: true })
      const metadata = traj.plot_metadata
      if (!metadata) throw new Error(`plot_metadata should exist`)
      if (field === `properties`) {
        // @ts-expect-error intentionally setting invalid type
        metadata[0].properties = `not an object`
      } else {
        // @ts-expect-error intentionally invalidating field
        metadata[0][field] = undefined
      }
      const errors = validate_trajectory(traj)
      expect(errors.some((err) => err.includes(expected_substr))).toBe(true)
      expect(errors).toHaveLength(expected_count)
    })
  })

  test(`returns all errors found`, () => {
    const traj: TrajectoryType = {
      frames: [
        { structure: { sites: [] }, step: 0 }, // Frame 0: missing sites error
        make_trajectory_frame(10),
        { step: 20 } as TrajectoryFrame, // Frame 2: missing structure error
      ],
      is_indexed: true, // is_indexed without indexed_frames error
      plot_metadata: `invalid` as unknown as TrajectoryMetadata[], // invalid plot_metadata error
    }
    const errors = validate_trajectory(traj)

    // Assert each specific expected error is present
    expect(errors.some((err) => err.includes(`Frame 0`))).toBe(true)
    expect(errors.some((err) => err.includes(`Frame 2`))).toBe(true)
    expect(errors.some((err) => err.includes(`is_indexed`))).toBe(true)
    expect(errors.some((err) => err.includes(`plot_metadata`))).toBe(true)

    // Assert exact error count to catch regressions
    expect(errors).toHaveLength(4)
  })
})

describe(`create_packed_frame_loader`, () => {
  const make_store = (n_frames = 3): TrajectoryFrameStore => ({
    positions: Float64Array.from(
      Array.from({ length: n_frames * 6 }, (_unused, value_idx) => value_idx),
    ),
    elements: [`H`, `He`],
    coords_unwrapped: true,
    steps: Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 2),
    metadata: Array.from({ length: n_frames }, (_unused, frame_idx) => ({ frame_idx })),
    plot_metadata: Array.from({ length: n_frames }, (_unused, frame_number) => ({
      frame_number,
      step: frame_number * 2,
      properties: {},
    })),
    scalars: {
      charge: Float64Array.from(
        Array.from({ length: n_frames * 2 }, (_unused, value_idx) => value_idx + 0.5),
      ),
      spin: Float64Array.from(
        Array.from({ length: n_frames * 2 }, (_unused, value_idx) => -value_idx),
      ),
    },
    vectors: {
      velocity: Float64Array.from(
        Array.from({ length: n_frames * 6 }, (_unused, value_idx) => 100 + value_idx),
      ),
      force: Float64Array.from(
        Array.from({ length: n_frames * 6 }, (_unused, value_idx) => -100 - value_idx),
      ),
    },
  })

  test(`resolves loader data according to source ownership`, () => {
    const packed_loader = create_packed_frame_loader(make_store())
    const source_loader = { ...packed_loader, requires_source: undefined }

    expect(frame_loader_data(packed_loader, null)).toBe(``)
    expect(frame_loader_data(source_loader, null)).toBeNull()
    expect(frame_loader_data(source_loader, ``)).toBeNull()
    expect(frame_loader_data(source_loader, new ArrayBuffer(0))).toBeNull()
    expect(frame_loader_data(source_loader, `trajectory bytes`)).toBe(`trajectory bytes`)
    expect(has_frame_loader_data(undefined, null)).toBe(false)
    expect(
      has_frame_loader_data({ ...make_trajectory(1), frame_loader: packed_loader }, null),
    ).toBe(true)
    expect(
      has_frame_loader_data({ ...make_trajectory(1), frame_loader: source_loader }, null),
    ).toBe(false)
  })

  test(`reconstructs every scalar and vector site property in sync and async frames`, async () => {
    const loader = create_packed_frame_loader(make_store())
    const sync_frame = loader.load_frame_sync?.(1)
    expect(sync_frame?.structure.sites.map(({ properties }) => properties)).toEqual([
      { charge: 2.5, spin: -2, velocity: [106, 107, 108], force: [-106, -107, -108] },
      { charge: 3.5, spin: -3, velocity: [109, 110, 111], force: [-109, -110, -111] },
    ])
    await expect(loader.load_frame(``, 2)).resolves.toMatchObject({
      step: 4,
      metadata: { frame_idx: 2 },
      structure: {
        sites: [
          {
            xyz: [12, 13, 14],
            properties: {
              charge: 4.5,
              spin: -4,
              velocity: [112, 113, 114],
              force: [-112, -113, -114],
            },
          },
          {
            xyz: [15, 16, 17],
            properties: {
              charge: 5.5,
              spin: -5,
              velocity: [115, 116, 117],
              force: [-115, -116, -117],
            },
          },
        ],
      },
    })
  })

  test.each([0, Number.NaN, 1.5])(`rejects invalid packed stride %s`, async (frame_stride) => {
    const loader = create_packed_frame_loader(make_store())
    await expect(loader.stream_positions?.(``, { frame_stride })).rejects.toThrow(
      `frame_stride must be a positive integer`,
    )
  })

  test(`reports the exact affordable-frame stride and honors byte boundaries`, async () => {
    const loader = create_packed_frame_loader({
      ...make_store(10),
      positions: new Float64Array(30),
      elements: [`H`],
      scalars: undefined,
      vectors: undefined,
    })
    await expect(loader.stream_positions?.(``, { max_bytes: 95 })).rejects.toThrow(
      `frame_stride >= 4`,
    )
    await expect(
      loader.stream_positions?.(``, { frame_stride: 4, max_bytes: 72 }),
    ).resolves.toMatchObject({ n_frames: 3, frame_stride: 4 })
    await expect(
      loader.stream_positions?.(``, { frame_stride: 4, max_bytes: 71 }),
    ).rejects.toThrow(`frame_stride >= 5`)
    await expect(loader.stream_positions?.(``, { max_bytes: Number.NaN })).rejects.toThrow(
      `max_bytes must be positive`,
    )
  })
})

describe(`validate_3x3_matrix`, () => {
  test(`accepts finite arrays and typed array rows`, () => {
    const matrix = [[1, 0, 0], new Float64Array([0, 1, 0]), [0, 0, 1]]
    expect(validate_3x3_matrix(matrix)).toEqual(matrix)
  })

  test.each([[[1, 0, Number.NaN]], [[1, 0, Infinity]], [[1, 0, `0`]]])(
    `rejects invalid row %j`,
    (row) => {
      expect(() => validate_3x3_matrix([[1, 0, 0], row, [0, 0, 1]])).toThrow(
        `Invalid 3x3 matrix structure`,
      )
    },
  )
})

describe(`get_trajectory_stats`, () => {
  test(`basic frame statistics`, () => {
    const traj = make_trajectory(5)
    const stats = get_trajectory_stats(traj)
    expect(stats.frame_count).toBe(5)
    expect(stats.step_range).toEqual([0, 40])
    expect(stats.steps).toEqual([0, 10, 20, 30, 40])
  })

  test.each([
    [`constant`, 5, { atoms_per_frame: 10 }, true, 10, undefined],
    [`variable`, 5, { atoms_per_frame: [3, 5, 4, 6, 3] }, false, undefined, [3, 6]],
    [`single frame`, 1, { atoms_per_frame: 5 }, true, 5, undefined],
    // >100 frames exercises the sampled constant-count detection path
    [`large constant (sampled)`, 1000, { atoms_per_frame: 2 }, true, 2, undefined],
  ])(`atom count: %s`, (_desc, frame_count, options, const_count, total_atoms, range) => {
    const stats = get_trajectory_stats(make_trajectory(frame_count, options))
    expect(stats.constant_atom_count).toBe(const_count)
    if (total_atoms !== undefined) expect(stats.total_atoms).toBe(total_atoms)
    if (range !== undefined) expect(stats.atom_count_range).toEqual(range)
  })

  test(`streaming metadata`, () => {
    const traj = make_trajectory(5, {
      total_frames: 100,
      with_indexed_frames: true,
      with_plot_metadata: true,
    })
    const stats = get_trajectory_stats(traj)
    expect(stats.frame_count).toBe(100)
    expect(stats.indexed_frame_count).toBe(5)
    expect(stats.plot_metadata_count).toBe(5)
    expect(stats.is_indexed).toBe(true)
  })

  test(`is_indexed status`, () => {
    expect(
      get_trajectory_stats(make_trajectory(3, { with_indexed_frames: true })).is_indexed,
    ).toBe(true)
    expect(get_trajectory_stats(make_trajectory(3)).is_indexed).toBe(false)
  })

  test(`handles empty trajectory`, () => {
    const stats = get_trajectory_stats({ frames: [] })
    expect(stats.frame_count).toBe(0)
    expect(stats.steps).toEqual([])
    expect(stats.step_range).toBeUndefined()
  })

  test(`large trajectory with variable atom counts`, () => {
    const atoms = Array.from({ length: 150 }, (_, idx) => (idx % 2 === 0 ? 3 : 5))
    const stats = get_trajectory_stats(make_trajectory(150, { atoms_per_frame: atoms }))
    expect(stats.frame_count).toBe(150)
    expect(stats.constant_atom_count).toBe(false)
    expect(stats.atom_count_range).toEqual([3, 5])
  })
})

test.each([
  // Too narrow for 320px side-by-side panes, so these stack whatever their
  // shape. 500 is the real height of a chat sidebar card: .trajectory's
  // min-height floor outranks the host's inline height.
  [`chat sidebar card`, 490, 500, `vertical`],
  [`portrait`, 400, 800, `vertical`],
  [`square`, 600, 600, `vertical`],
  // Short enough that MIN_PANE_SIZE.width, not pane shape, decides
  [`just under the side-by-side pane minimum`, 639, 400, `vertical`],
  [`at the side-by-side pane minimum`, 640, 400, `horizontal`],
  // Tall enough that pane shape decides: panes may be at most 1.4x taller than
  // wide, so side by side needs a container 10/7 as wide as it is tall
  [`just under the side-by-side aspect`, 999, 700, `vertical`],
  [`at the side-by-side aspect`, 1000, 700, `horizontal`],
  // Both splits fit, but side by side would hand each pane 450x800
  [`nearly square dashboard viewer`, 900, 800, `vertical`],
  [`fullscreen on a 4:3 display`, 1440, 1080, `vertical`],
  [`fullscreen on a 16:9 display`, 1920, 1080, `horizontal`],
  [`desktop viewer`, 1200, 600, `horizontal`],
  // stacking a short container would leave both panes unreadably flat
  [`wide and short`, 500, 200, `horizontal`],
] as const)(`pick_pane_orientation %s`, (_label, width, height, expected) => {
  expect(pick_pane_orientation(width, height)).toBe(expected)
})
