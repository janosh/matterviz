import type { ElementSymbol, Vec3 } from '$lib'
import type { TrajectoryType } from '$lib/trajectory'
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
        frames: [
          create_frame(0, [
            create_site(
              `H` as ElementSymbol,
              [0, 0, 0] as Vec3,
              [0, 0, 0] as Vec3,
              `H1`,
            ),
          ]),
        ],
        metadata: {},
      } as TrajectoryType,
      expected_errors: [],
    },
    {
      name: `detect missing frames`,
      trajectory: { frames: [], metadata: {} } as TrajectoryType,
      expected_errors: [`Trajectory must have at least one frame`],
    },
    {
      name: `detect missing structure`,
      // @ts-expect-error Testing invalid structure
      trajectory: {
        frames: [{ structure: null, step: 0, metadata: {} }],
        metadata: {},
      } as TrajectoryType,
      expected_errors: [`Frame 0 missing structure`],
    },
    {
      name: `detect empty sites`,
      trajectory: {
        frames: [create_frame(0, [])],
        metadata: {},
      } as TrajectoryType,
      expected_errors: [`Frame 0 structure has no sites`],
    },
    {
      name: `detect invalid step numbers`,
      // @ts-expect-error Testing invalid step type
      trajectory: {
        frames: [
          {
            structure: {
              sites: [
                create_site(
                  `H` as ElementSymbol,
                  [0, 0, 0] as Vec3,
                  [0, 0, 0] as Vec3,
                  `H1`,
                ),
              ],
              charge: 0,
            },
            step: `invalid`,
            metadata: {},
          },
        ],
        metadata: {},
      } as TrajectoryType,
      expected_errors: [`Frame 0 missing or invalid step number`],
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
            create_site(
              `H` as ElementSymbol,
              [0, 0, 0] as Vec3,
              [0, 0, 0] as Vec3,
              `H1`,
            ),
            create_site(
              `O` as ElementSymbol,
              [0.5, 0.5, 0.5] as Vec3,
              [1, 1, 1] as Vec3,
              `O1`,
            ),
          ]),
          create_frame(2, [
            create_site(
              `H` as ElementSymbol,
              [0.1, 0, 0] as Vec3,
              [0.1, 0, 0] as Vec3,
              `H1`,
            ),
            create_site(
              `O` as ElementSymbol,
              [0.6, 0.5, 0.5] as Vec3,
              [1.1, 1, 1] as Vec3,
              `O1`,
            ),
          ]),
          create_frame(5, [
            create_site(
              `H` as ElementSymbol,
              [0.2, 0, 0] as Vec3,
              [0.2, 0, 0] as Vec3,
              `H1`,
            ),
            create_site(
              `O` as ElementSymbol,
              [0.7, 0.5, 0.5] as Vec3,
              [1.2, 1, 1] as Vec3,
              `O1`,
            ),
          ]),
        ],
        metadata: {},
      } as TrajectoryType,
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
          create_frame(0, [
            create_site(
              `H` as ElementSymbol,
              [0, 0, 0] as Vec3,
              [0, 0, 0] as Vec3,
              `H1`,
            ),
          ]),
          create_frame(1, [
            create_site(
              `H` as ElementSymbol,
              [0, 0, 0] as Vec3,
              [0, 0, 0] as Vec3,
              `H1`,
            ),
            create_site(
              `H` as ElementSymbol,
              [0.5, 0.5, 0.5] as Vec3,
              [1, 1, 1] as Vec3,
              `H2`,
            ),
          ]),
          create_frame(2, [
            create_site(
              `H` as ElementSymbol,
              [0, 0, 0] as Vec3,
              [0, 0, 0] as Vec3,
              `H1`,
            ),
            create_site(
              `H` as ElementSymbol,
              [0.3, 0.3, 0.3] as Vec3,
              [0.6, 0.6, 0.6] as Vec3,
              `H2`,
            ),
            create_site(
              `O` as ElementSymbol,
              [0.7, 0.7, 0.7] as Vec3,
              [1.4, 1.4, 1.4] as Vec3,
              `O1`,
            ),
          ]),
        ],
        metadata: {},
      } as TrajectoryType,
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
        frames: [
          create_frame(42, [
            create_site(
              `H` as ElementSymbol,
              [0, 0, 0] as Vec3,
              [0, 0, 0] as Vec3,
              `H1`,
            ),
          ]),
        ],
        metadata: {},
      } as TrajectoryType,
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
      trajectory: { frames: [], metadata: {} } as TrajectoryType,
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
