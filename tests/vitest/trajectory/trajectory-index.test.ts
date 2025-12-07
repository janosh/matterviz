import type { AnyStructure, ElementSymbol, Vec3 } from '$lib'
import type {
  FrameIndex,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryType,
} from '$lib/trajectory'
import { get_trajectory_stats, validate_trajectory } from '$lib/trajectory'
import { describe, expect, test } from 'vitest'

// Factory for trajectory frames
function make_frame(step: number, site_count = 3): TrajectoryFrame {
  const structure: AnyStructure = {
    sites: Array.from({ length: site_count }, (_, idx) => ({
      species: [{ element: `H` as ElementSymbol, occu: 1, oxidation_state: 0 }],
      xyz: [idx, 0, 0] as Vec3,
      abc: [idx / 10, 0, 0] as Vec3,
      label: `H${idx + 1}`,
      properties: {},
    })),
  }
  return { structure, step, metadata: {} }
}

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
    const atoms = typeof atoms_per_frame === `number`
      ? atoms_per_frame
      : atoms_per_frame[idx] ?? 3
    return make_frame(idx * 10, atoms)
  })

  const trajectory: TrajectoryType = { frames }
  if (total_frames !== undefined) trajectory.total_frames = total_frames
  if (with_indexed_frames) {
    trajectory.indexed_frames = frames.map((_, idx): FrameIndex => ({
      frame_number: idx,
      byte_offset: idx * 1000,
      estimated_size: 1000,
    }))
    trajectory.is_indexed = true
  }
  if (with_plot_metadata) {
    trajectory.plot_metadata = frames.map((frame, idx): TrajectoryMetadata => ({
      frame_number: idx,
      step: frame.step,
      properties: { energy: -idx * 0.1, temperature: 300 + idx },
    }))
  }
  return trajectory
}

describe(`validate_trajectory`, () => {
  test(`valid trajectory returns empty errors`, () => {
    expect(validate_trajectory(make_trajectory(5))).toEqual([])
  })

  test.each([
    [{ frames: [] }, `Trajectory must have at least one frame`, `empty frames`],
    [
      { frames: [{ step: 0 } as TrajectoryFrame] },
      `Frame 0 missing structure or sites`,
      `no structure`,
    ],
    [
      { frames: [{ structure: { sites: [] }, step: 0 }] },
      `Frame 0 missing structure or sites`,
      `empty sites`,
    ],
  ])(`returns error for %s`, (trajectory, expected_error) => {
    expect(validate_trajectory(trajectory as TrajectoryType)).toContain(expected_error)
  })

  test(`returns error for frame without step`, () => {
    const frame = make_frame(0)
    // @ts-expect-error intentionally removing step
    delete frame.step
    expect(validate_trajectory({ frames: [frame] })).toContain(
      `Frame 0 missing or invalid step number`,
    )
  })

  describe(`streaming properties`, () => {
    test.each([
      [(traj: TrajectoryType) => {
        traj.total_frames = -1
      }, `total_frames must be a positive`],
      [(traj: TrajectoryType) => {
        traj.total_frames = 5
        traj.indexed_frames =
          make_trajectory(3, { with_indexed_frames: true }).indexed_frames
      }, `inconsistent with indexed_frames`],
      [(traj: TrajectoryType) => {
        traj.is_indexed = true
      }, `is_indexed is true but indexed_frames is missing`],
    ])(`validates streaming property errors`, (mutate, expected_substr) => {
      const traj = make_trajectory(3)
      mutate(traj)
      expect(validate_trajectory(traj).some((err) => err.includes(expected_substr))).toBe(
        true,
      )
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
      [`frame_number`, 0, `missing or invalid frame_number`],
      [`byte_offset`, 0, `missing or invalid byte_offset`],
      [`estimated_size`, 0, `missing or invalid estimated_size`],
    ])(`validates %s field`, (field, idx, expected_substr) => {
      const traj = make_trajectory(3, { with_indexed_frames: true })
      const indexed = traj.indexed_frames
      if (!indexed) throw new Error(`indexed_frames should exist`)
      // @ts-expect-error intentionally removing field
      delete indexed[idx][field]
      expect(validate_trajectory(traj).some((err) => err.includes(expected_substr))).toBe(
        true,
      )
    })

    test(`validates frame_number equals index`, () => {
      const traj = make_trajectory(3, { with_indexed_frames: true })
      const indexed = traj.indexed_frames
      if (!indexed) throw new Error(`indexed_frames should exist`)
      indexed[1].frame_number = 5
      expect(
        validate_trajectory(traj).some((err) =>
          err.includes(`frame_number (5) should equal index (1)`)
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
      [`frame_number`, `plot_metadata[0] missing or invalid frame`],
      [`step`, `plot_metadata[0] missing or invalid step`],
      [`properties`, `plot_metadata[0] missing or invalid properties`],
    ])(`validates %s field`, (field, expected_substr) => {
      const traj = make_trajectory(3, { with_plot_metadata: true })
      const metadata = traj.plot_metadata
      if (!metadata) throw new Error(`plot_metadata should exist`)
      if (field === `properties`) {
        // @ts-expect-error intentionally setting invalid type
        metadata[0].properties = `not an object`
      } else {
        // @ts-expect-error intentionally removing field
        delete metadata[0][field]
      }
      expect(validate_trajectory(traj).some((err) => err.includes(expected_substr))).toBe(
        true,
      )
    })
  })

  test(`returns all errors found`, () => {
    const traj: TrajectoryType = {
      frames: [
        { structure: { sites: [] }, step: 0 },
        make_frame(10),
        { step: 20 } as TrajectoryFrame,
      ],
      is_indexed: true,
      plot_metadata: `invalid` as unknown as TrajectoryMetadata[],
    }
    expect(validate_trajectory(traj).length).toBeGreaterThanOrEqual(4)
  })
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
    [5, { atoms_per_frame: 10 }, true, 10, undefined, `constant`],
    [5, { atoms_per_frame: [3, 5, 4, 6, 3] }, false, undefined, [3, 6], `variable`],
    [1, { atoms_per_frame: 5 }, true, 5, undefined, `single frame`],
  ])(
    `atom count: %s`,
    (_frame_count, options, const_count, total_atoms, range, _desc) => {
      const stats = get_trajectory_stats(make_trajectory(_frame_count, options))
      expect(stats.constant_atom_count).toBe(const_count)
      if (total_atoms !== undefined) expect(stats.total_atoms).toBe(total_atoms)
      if (range !== undefined) expect(stats.atom_count_range).toEqual(range)
    },
  )

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

test(`TrajectoryFormat type values`, () => {
  const formats: Array<`hdf5` | `json` | `xyz` | `xdatcar` | `traj` | `unknown`> = [
    `hdf5`,
    `json`,
    `xyz`,
    `xdatcar`,
    `traj`,
    `unknown`,
  ]
  expect(formats).toHaveLength(6)
})
