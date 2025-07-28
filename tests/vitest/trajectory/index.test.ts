import type { ElementSymbol, Vec3 } from '$lib'
import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import { get_trajectory_stats, validate_trajectory } from '$lib/trajectory'
import { describe, expect, it } from 'vitest'

// Helper to create a basic site
const create_site = (
  element: ElementSymbol,
  abc: Vec3,
  xyz: Vec3,
  label: string,
) => ({
  species: [{ element, occu: 1, oxidation_state: 0 }],
  abc,
  xyz,
  label,
  properties: {},
})

// Helper to create a basic frame
const create_frame = (
  step: number,
  sites: ReturnType<typeof create_site>[],
  metadata: Record<string, unknown> = {},
) => ({ structure: { sites, charge: 0 }, step, metadata })

describe(`Trajectory Validation`, () => {
  it.each([
    {
      name: `validate correct trajectory`,
      trajectory: {
        frames: [create_frame(0, [create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`)])],
        metadata: {},
      },
      expected_errors: [],
    },
    {
      name: `detect missing frames`,
      trajectory: { frames: [], metadata: {} },
      expected_errors: [`Trajectory must have at least one frame`],
    },
    {
      name: `detect missing structure`,
      // @ts-expect-error Testing invalid structure
      trajectory: {
        frames: [{ structure: null, step: 0, metadata: {} }],
        metadata: {},
      } as TrajectoryType,
      expected_errors: [`Frame 0 missing structure or sites`],
    },
    {
      name: `detect empty sites`,
      trajectory: { frames: [create_frame(0, [])], metadata: {} },
      expected_errors: [`Frame 0 missing structure or sites`],
    },
    {
      name: `detect invalid step numbers`,
      // @ts-expect-error Testing invalid step type
      trajectory: {
        frames: [{
          structure: { sites: [create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`)], charge: 0 },
          step: `invalid`,
          metadata: {},
        }],
        metadata: {},
      } as TrajectoryType,
      expected_errors: [`Frame 0 missing or invalid step number`],
    },
  ])(`should $name`, ({ trajectory, expected_errors }) => {
    const errors = validate_trajectory(trajectory)
    expect(errors).toEqual(expected_errors)
  })
})

describe(`Trajectory Streaming Validation`, () => {
  const base_frame = create_frame(0, [create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`)])

  it.each([
    {
      name: `validate trajectory with streaming properties`,
      trajectory: {
        frames: [base_frame],
        total_frames: 1,
        indexed_frames: [{ frame_number: 0, byte_offset: 0, estimated_size: 100 }],
        plot_metadata: [{ frame_number: 0, step: 0, properties: { energy: -1.0 } }],
        is_indexed: true,
      },
      expected_errors: [],
    },
    {
      name: `detect invalid total_frames type`,
      trajectory: {
        frames: [base_frame],
        total_frames: `invalid`,
      } as unknown as TrajectoryType,
      expected_errors: [`total_frames must be a positive number, got invalid`],
    },
    {
      name: `detect negative total_frames`,
      trajectory: {
        frames: [base_frame],
        total_frames: -5,
      },
      expected_errors: [`total_frames must be a positive number, got -5`],
    },
    {
      name: `detect total_frames inconsistent with indexed_frames length`,
      trajectory: {
        frames: [base_frame],
        total_frames: 5,
        indexed_frames: [
          { frame_number: 0, byte_offset: 0, estimated_size: 100 },
          { frame_number: 1, byte_offset: 200, estimated_size: 100 },
        ],
      },
      expected_errors: [`total_frames (5) inconsistent with indexed_frames length (2)`],
    },
    {
      name: `detect is_indexed true but no indexed_frames`,
      trajectory: {
        frames: [base_frame],
        is_indexed: true,
      },
      expected_errors: [`is_indexed is true but indexed_frames is missing or empty`],
    },
    {
      name: `detect is_indexed true with empty indexed_frames`,
      trajectory: {
        frames: [base_frame],
        is_indexed: true,
        indexed_frames: [],
      },
      expected_errors: [`is_indexed is true but indexed_frames is missing or empty`],
    },
    {
      name: `detect invalid indexed_frames type`,
      trajectory: {
        frames: [base_frame],
        indexed_frames: `not_array`,
      } as unknown as TrajectoryType,
      expected_errors: [`indexed_frames must be an array`],
    },
    {
      name: `detect missing frame_number in indexed_frames`,
      trajectory: {
        frames: [base_frame],
        indexed_frames: [
          { byte_offset: 0, estimated_size: 100 },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`indexed_frames[0] missing or invalid frame_number`],
    },
    {
      name: `detect missing byte_offset in indexed_frames`,
      trajectory: {
        frames: [base_frame],
        indexed_frames: [
          { frame_number: 0, estimated_size: 100 },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`indexed_frames[0] missing or invalid byte_offset`],
    },
    {
      name: `detect missing estimated_size in indexed_frames`,
      trajectory: {
        frames: [base_frame],
        indexed_frames: [
          { frame_number: 0, byte_offset: 0 },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`indexed_frames[0] missing or invalid estimated_size`],
    },
    {
      name: `detect non-sequential frame_number in indexed_frames`,
      trajectory: {
        frames: [base_frame],
        indexed_frames: [
          { frame_number: 5, byte_offset: 0, estimated_size: 100 },
        ],
      },
      expected_errors: [`indexed_frames[0] frame_number (5) should equal index (0)`],
    },
    {
      name: `detect invalid plot_metadata type`,
      trajectory: {
        frames: [base_frame],
        plot_metadata: `not_array`,
      } as unknown as TrajectoryType,
      expected_errors: [`plot_metadata must be an array`],
    },
    {
      name: `detect missing frame_number in plot_metadata`,
      trajectory: {
        frames: [base_frame],
        plot_metadata: [
          { step: 0, properties: { energy: -1.0 } },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`plot_metadata[0] missing or invalid frame_number`],
    },
    {
      name: `detect missing step in plot_metadata`,
      trajectory: {
        frames: [base_frame],
        plot_metadata: [
          { frame_number: 0, properties: { energy: -1.0 } },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`plot_metadata[0] missing or invalid step`],
    },
    {
      name: `detect missing properties in plot_metadata`,
      trajectory: {
        frames: [base_frame],
        plot_metadata: [
          { frame_number: 0, step: 0 },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`plot_metadata[0] missing or invalid properties object`],
    },
    {
      name: `detect invalid properties type in plot_metadata`,
      trajectory: {
        frames: [base_frame],
        plot_metadata: [
          { frame_number: 0, step: 0, properties: `not_object` },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [`plot_metadata[0] missing or invalid properties object`],
    },
    {
      name: `collect multiple streaming validation errors`,
      trajectory: {
        frames: [base_frame],
        total_frames: -1,
        is_indexed: true,
        indexed_frames: [
          { frame_number: 5 },
        ],
        plot_metadata: [
          { frame_number: 0 },
        ],
      } as unknown as TrajectoryType,
      expected_errors: [
        `total_frames must be a positive number, got -1`,
        `indexed_frames[0] frame_number (5) should equal index (0)`,
        `indexed_frames[0] missing or invalid byte_offset`,
        `indexed_frames[0] missing or invalid estimated_size`,
        `plot_metadata[0] missing or invalid step`,
        `plot_metadata[0] missing or invalid properties object`,
      ],
    },
  ])(`should $name`, ({ trajectory, expected_errors }) => {
    const errors = validate_trajectory(trajectory)
    expect(errors).toEqual(expected_errors)
  })
})

describe(`Trajectory Statistics`, () => {
  it.each([
    {
      name: `calculate correct statistics for simple trajectory`,
      trajectory: {
        frames: [
          create_frame(1, [
            create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`),
            create_site(`O`, [0.5, 0.5, 0.5], [1, 1, 1], `O1`),
          ]),
          create_frame(2, [
            create_site(`H`, [0.1, 0, 0], [0.1, 0, 0], `H1`),
            create_site(`O`, [0.6, 0.5, 0.5], [1.1, 1, 1], `O1`),
          ]),
          create_frame(5, [
            create_site(`H`, [0.2, 0, 0], [0.2, 0, 0], `H1`),
            create_site(`O`, [0.7, 0.5, 0.5], [1.2, 1, 1], `O1`),
          ]),
        ],
        metadata: {},
      },
      expected: {
        frame_count: 3,
        steps: [1, 2, 5],
        step_range: [1, 5],
        total_atoms: 2,
        constant_atom_count: true,
        atom_count_range: undefined,
      },
    },
    {
      name: `handle variable atom counts`,
      trajectory: {
        frames: [
          create_frame(0, [create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`)]),
          create_frame(1, [
            create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`),
            create_site(`H`, [0.5, 0.5, 0.5], [1, 1, 1], `H2`),
          ]),
          create_frame(2, [
            create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`),
            create_site(`H`, [0.3, 0.3, 0.3], [0.6, 0.6, 0.6], `H2`),
            create_site(`O`, [0.7, 0.7, 0.7], [1.4, 1.4, 1.4], `O1`),
          ]),
        ],
        metadata: {},
      },
      expected: {
        frame_count: 3,
        steps: [0, 1, 2],
        step_range: [0, 2],
        constant_atom_count: false,
        atom_count_range: [1, 3],
        total_atoms: undefined,
      },
    },
    {
      name: `handle single frame trajectory`,
      trajectory: {
        frames: [create_frame(42, [create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`)])],
        metadata: {},
      },
      expected: {
        frame_count: 1,
        steps: [42],
        step_range: [42, 42],
        total_atoms: 1,
        constant_atom_count: true,
        atom_count_range: undefined,
      },
    },
    {
      name: `handle empty trajectory gracefully`,
      trajectory: { frames: [], metadata: {} },
      expected: {
        frame_count: 0,
        steps: [],
        step_range: undefined,
        total_atoms: undefined,
        constant_atom_count: undefined,
        atom_count_range: undefined,
      },
    },
  ])(`should $name`, ({ trajectory, expected }) => {
    const stats = get_trajectory_stats(trajectory)

    expect(stats.frame_count).toBe(expected.frame_count)
    expect(stats.steps).toEqual(expected.steps)
    expect(stats.step_range).toEqual(expected.step_range)
    expect(stats.total_atoms).toBe(expected.total_atoms)
    expect(stats.constant_atom_count).toBe(expected.constant_atom_count)
    expect(stats.atom_count_range).toEqual(expected.atom_count_range)
  })
})

describe(`Trajectory Statistics Optimization`, () => {
  it(`should optimize atom count calculation for large trajectories`, () => {
    // Create a large trajectory with constant atom count
    const large_frames: TrajectoryFrame[] = []
    for (let idx = 0; idx < 1000; idx++) {
      large_frames.push(create_frame(idx, [
        create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`),
        create_site(`H`, [1, 0, 0], [1, 0, 0], `H2`),
      ]))
    }

    const large_trajectory: TrajectoryType = { frames: large_frames }
    const stats = get_trajectory_stats(large_trajectory)

    // Should correctly identify constant atom count despite large size
    expect(stats.constant_atom_count).toBe(true)
    expect(stats.total_atoms).toBe(2) // Each frame has 2 atoms by default
    expect(stats.frame_count).toBe(1000)
  })

  it(`should detect variable atom counts efficiently in large trajectories`, () => {
    // Create large trajectory with varying atom counts
    const large_frames: TrajectoryFrame[] = []
    for (let idx = 0; idx < 1000; idx++) {
      // Every 100th frame has different atom count
      const sites = idx % 100 === 0
        ? [create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`)] // 1 atom
        : [
          create_site(`H`, [0, 0, 0], [0, 0, 0], `H1`),
          create_site(`H`, [1, 0, 0], [1, 0, 0], `H2`),
        ] // 2 atoms

      large_frames.push({
        structure: { sites, charge: 0 },
        step: idx,
        metadata: {},
      })
    }

    const large_trajectory: TrajectoryType = { frames: large_frames }
    const stats = get_trajectory_stats(large_trajectory)

    // Should correctly detect variable atom count
    expect(stats.constant_atom_count).toBe(false)
    expect(stats.atom_count_range).toEqual([1, 2])
    expect(stats.frame_count).toBe(1000)
  })
})
