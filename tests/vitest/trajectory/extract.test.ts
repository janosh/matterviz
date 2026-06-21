import type { TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import {
  energy_data_extractor,
  force_stress_data_extractor,
  full_data_extractor,
  structural_data_extractor,
} from '$lib/trajectory/extract'
import { parse_trajectory_data } from '$lib/trajectory/parse'
import { describe, expect, it } from 'vitest'
import { make_trajectory_frame, read_binary_test_file } from '../setup'

const constant_lattice_keys = [
  `constant_a`,
  `constant_b`,
  `constant_c`,
  `constant_alpha`,
  `constant_beta`,
  `constant_gamma`,
] as const

// Helper to create frame with lattice
const create_frame_with_lattice = (
  step: number,
  lattice_params: Record<string, number>,
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => make_trajectory_frame(step, 1, metadata, lattice_params)

describe(`Energy Data Extractor`, () => {
  it.each([
    {
      name: `extracts energy properties from metadata`,
      step: 5,
      metadata: {
        energy: -10.5,
        energy_per_atom: -5.25,
        potential_energy: -12.0,
        kinetic_energy: 1.5,
        total_energy: -10.5,
      },
      expected: {
        Step: 5,
        energy: -10.5,
        energy_per_atom: -5.25,
        potential_energy: -12.0,
        kinetic_energy: 1.5,
        total_energy: -10.5,
      },
    },
    { name: `handles missing metadata`, step: 0, metadata: {}, expected: { Step: 0 } },
  ])(`should $name`, ({ step, metadata, expected }) => {
    const frame = make_trajectory_frame(step, 1, metadata)
    const data = energy_data_extractor(frame, { frames: [], metadata: {} })
    expect(data).toEqual(expected)
  })
})

describe(`Force and Stress Data Extractor`, () => {
  it.each([
    {
      name: `calculate force properties from forces array`,
      step: 1,
      metadata: {
        forces: [
          [1.0, 0.0, 0.0],
          [0.0, 2.0, 0.0],
          [0.0, 0.0, 3.0],
        ],
      },
      expected: {
        Step: 1,
        force_max: 3.0, // max magnitude
        force_norm: expect.closeTo(2.16, 2), // RMS of magnitudes
      },
    },
    {
      name: `use metadata force values as fallback`,
      step: 2,
      metadata: { force_max: 5.0, force_norm: 3.5, stress_max: 2.1, pressure: 1.5 },
      expected: {
        Step: 2,
        force_max: 5.0,
        force_norm: 3.5,
        stress_max: 2.1,
        pressure: 1.5,
      },
    },
    {
      name: `use force_rms as fallback for force_norm`,
      step: 3,
      metadata: { force_rms: 2.8 },
      expected: {
        Step: 3,
        force_norm: 2.8,
      },
    },
  ])(`should $name`, ({ step, metadata, expected }) => {
    const frame = make_trajectory_frame(step, 1, metadata)
    const data = force_stress_data_extractor(frame, { frames: [], metadata: {} })
    expect(data).toEqual(expected)
  })
})

describe(`Structural Data Extractor`, () => {
  it.each([
    {
      name: `extract lattice properties`,
      step: 4,
      lattice_params: {
        a: 1.0,
        b: 1.0,
        c: 1.0,
        alpha: 90,
        beta: 90,
        gamma: 90,
        volume: 1.0,
      },
      metadata: { density: 2.5, temperature: 300 },
      expected: {
        Step: 4,
        volume: 1.0,
        a: 1.0,
        b: 1.0,
        c: 1.0,
        alpha: 90,
        beta: 90,
        gamma: 90,
        density: 2.5,
        temperature: 300,
      },
    },
    {
      name: `use metadata volume as fallback`,
      step: 5,
      lattice_params: null,
      metadata: { volume: 2.5 },
      expected: {
        Step: 5,
        volume: 2.5,
      },
    },
    {
      name: `preserve metadata density of exactly 0`,
      step: 6,
      lattice_params: null,
      metadata: { density: 0 },
      expected: {
        Step: 6,
        density: 0,
      },
    },
  ])(`should $name`, ({ step, lattice_params, metadata, expected }) => {
    const frame = lattice_params
      ? create_frame_with_lattice(step, lattice_params, metadata)
      : make_trajectory_frame(step, 1, metadata)

    const data = structural_data_extractor(frame, { frames: [], metadata: {} })
    expect(data).toEqual(expected)
  })

  it(`should calculate density when not provided in metadata`, () => {
    // Create a simple cubic lattice with known density
    const frame = create_frame_with_lattice(
      0,
      { a: 2.0, b: 2.0, c: 2.0, volume: 8.0 },
      {}, // No density in metadata
    )

    const data = structural_data_extractor(frame, { frames: [], metadata: {} })

    // Should calculate density from structure
    expect(data.density).toBeDefined()
    expect(typeof data.density).toBe(`number`)
    expect(data.density).toBeGreaterThan(0)
  })

  it(`should prefer metadata density over calculated density`, () => {
    const frame = create_frame_with_lattice(
      0,
      { a: 2.0, b: 2.0, c: 2.0, volume: 8.0 },
      { density: 5.0 }, // Explicit density in metadata
    )

    const data = structural_data_extractor(frame, { frames: [], metadata: {} })

    // Should use metadata density
    expect(data.density).toBe(5.0)
  })
})

describe(`Full Data Extractor`, () => {
  it(`should combine all extractors`, () => {
    const trajectory: TrajectoryType = {
      frames: [
        create_frame_with_lattice(
          0,
          { a: 1.0, b: 1.0, c: 1.0, alpha: 90, beta: 90, gamma: 90, volume: 1.0 },
          {
            energy: -10.0,
            force_max: 2.0,
            density: 2.5,
          },
        ),
        create_frame_with_lattice(
          1,
          { a: 1.1, b: 1.1, c: 1.1, alpha: 91, beta: 92, gamma: 93, volume: 1.331 },
          {
            energy: -10.5,
            force_max: 1.5,
            density: 2.3,
          },
        ),
      ],
      metadata: {
        source_format: `test`,
        frame_count: 2,
      },
    }

    const frame1_data = full_data_extractor(trajectory.frames[0], trajectory)
    const frame2_data = full_data_extractor(trajectory.frames[1], trajectory)

    // Should have energy data
    expect(frame1_data.energy).toBe(-10.0)
    expect(frame2_data.energy).toBe(-10.5)

    // Should have force data
    expect(frame1_data.force_max).toBe(2.0)
    expect(frame2_data.force_max).toBe(1.5)

    // Should have structural data
    expect(frame1_data.volume).toBe(1.0)
    expect(frame2_data.volume).toBe(1.331)
    expect(frame1_data.density).toBe(2.5)
    expect(frame2_data.density).toBe(2.3)

    // Should have lattice parameters
    expect(frame1_data.a).toBe(1.0)
    expect(frame2_data.a).toBe(1.1)

    // Should NOT have constant lattice markers (lattice varies)
    for (const key of constant_lattice_keys) {
      expect(frame1_data[key]).toBeUndefined()
      expect(frame2_data[key]).toBeUndefined()
    }
  })

  it(`detects lattice param variation from metadata fallback (single pass)`, () => {
    // No structure lattice → variation is computed from metadata. a varies, b/c constant.
    const traj: TrajectoryType = {
      frames: [
        make_trajectory_frame(0, 1, { a: 5.0, b: 5.0, c: 5.0 }),
        make_trajectory_frame(1, 1, { a: 5.1, b: 5.0, c: 5.0 }),
      ],
      metadata: {},
    }
    const frame0 = full_data_extractor(traj.frames[0], traj)
    const frame1 = full_data_extractor(traj.frames[1], traj)

    expect(frame0.constant_a).toBeUndefined() // a varies
    expect(frame0.constant_b).toBe(1)
    expect(frame0.constant_c).toBe(1)
    // alpha/beta/gamma absent from every frame → NOT constant (never observed)
    for (const key of [`constant_alpha`, `constant_beta`, `constant_gamma`]) {
      expect(frame0[key]).toBeUndefined()
    }
    // Cached result is identical for every frame of the same trajectory
    for (const key of constant_lattice_keys) expect(frame1[key]).toBe(frame0[key])
  })

  it(`should detect constant lattice parameters`, () => {
    const constant_trajectory: TrajectoryType = {
      frames: [
        create_frame_with_lattice(
          0,
          { a: 1.0, b: 1.0, c: 1.0, volume: 1.0 },
          { energy: -10.0 },
        ),
        create_frame_with_lattice(
          1,
          { a: 1.0, b: 1.0, c: 1.0, volume: 1.0 },
          { energy: -10.0 },
        ),
      ],
      metadata: {
        source_format: `test`,
        frame_count: 2,
      },
    }

    const frame1_data = full_data_extractor(constant_trajectory.frames[0], constant_trajectory)
    const frame2_data = full_data_extractor(constant_trajectory.frames[1], constant_trajectory)

    // Should have constant lattice markers for all parameters
    for (const key of constant_lattice_keys) {
      expect(frame1_data[key]).toBe(1)
      expect(frame2_data[key]).toBe(1)
    }

    // All lattice properties should be the same
    expect(frame1_data.a).toBe(frame2_data.a)
    expect(frame1_data.volume).toBe(frame2_data.volume)
  })
})

describe(`Default Plotting Behavior`, () => {
  it.each([
    {
      name: `default to volume and density when no other metadata is available`,
      trajectory_frames: [
        create_frame_with_lattice(0, { a: 1, b: 1, c: 1, volume: 1.0 }, {}),
        create_frame_with_lattice(1, { a: 1.1, b: 1.1, c: 1.1, volume: 1.331 }, {}),
      ],
      expected_volumes: [1.0, 1.331],
      should_vary: true,
    },
    {
      name: `detect constant values in trajectory`,
      trajectory_frames: [
        create_frame_with_lattice(0, { a: 1, b: 1, c: 1, volume: 1.0 }, { energy: -10.0 }),
        create_frame_with_lattice(1, { a: 1, b: 1, c: 1, volume: 1.0 }, { energy: -10.0 }),
      ],
      expected_volumes: [1.0, 1.0],
      should_vary: false,
    },
  ])(`should $name`, ({ trajectory_frames, expected_volumes, should_vary }) => {
    const trajectory: TrajectoryType = {
      frames: trajectory_frames,
      metadata: {
        source_format: `test`,
        frame_count: trajectory_frames.length,
      },
    }

    const frame_data = trajectory_frames.map((frame) => full_data_extractor(frame, trajectory))

    // Should have volume in all frames
    frame_data.forEach((data, idx) => {
      expect(data.volume).toBe(expected_volumes[idx])
    })

    // Check if volumes vary as expected
    if (should_vary) {
      expect(frame_data[0].volume).not.toBe(frame_data[1].volume)
    } else {
      expect(frame_data[0].volume).toBe(frame_data[1].volume)
      expect(frame_data[0].energy).toBe(frame_data[1].energy)
    }
  })
})

describe(`HDF5 Trajectory Data Extraction`, () => {
  it(`should extract data from HDF5 trajectory`, async () => {
    const hdf5_content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(
      hdf5_content,
      `flame-gold-cluster-55-atoms.h5`,
    )
    const first_frame = trajectory.frames[0]

    const energy_data = energy_data_extractor(first_frame, trajectory)
    const structural_data = structural_data_extractor(first_frame, trajectory)
    const full_data = full_data_extractor(first_frame, trajectory)

    expect(energy_data.Step).toBe(0)
    expect(structural_data.Step).toBe(0)
    expect(full_data.Step).toBe(0)
    expect(typeof structural_data.volume).toBe(`number`)
    expect(structural_data.volume).toBeGreaterThan(0)

    if (`lattice` in first_frame.structure) {
      expect(structural_data.a).toBeGreaterThan(0)
      expect(structural_data.b).toBeGreaterThan(0)
      expect(structural_data.c).toBeGreaterThan(0)
    }
  })

  it(`should handle all frames and lattice consistency`, async () => {
    const hdf5_content = read_binary_test_file(`flame-gold-cluster-55-atoms.h5`)
    const trajectory = await parse_trajectory_data(
      hdf5_content,
      `flame-gold-cluster-55-atoms.h5`,
    )

    const all_frame_data = trajectory.frames.map((frame: TrajectoryFrame) =>
      full_data_extractor(frame, trajectory),
    )

    expect(all_frame_data).toHaveLength(20)

    all_frame_data.forEach((data: Record<string, unknown>, idx: number) => {
      expect(data.Step).toBe(idx)
      expect(typeof data.volume).toBe(`number`)
      expect(data.volume).toBeGreaterThan(0)
    })

    // Check lattice consistency
    const volumes = all_frame_data.map((data: Record<string, unknown>) => data.volume)
    const unique_volumes = new Set(volumes)
    const is_constant = unique_volumes.size === 1

    all_frame_data.forEach((data: Record<string, unknown>) => {
      if (is_constant) {
        // Check that all lattice parameters are marked as constant
        for (const key of constant_lattice_keys) expect(data[key]).toBe(1)
      } else {
        // Check that lattice parameters are not marked as constant
        for (const key of constant_lattice_keys) expect(data[key]).toBeUndefined()
      }
    })
  })
})

describe(`regression tests for trajectory plotting integration`, () => {
  it(`should provide consistent units and handle mixed data for plotting`, () => {
    // Test lattice parameters with consistent units
    const lattice_trajectory: TrajectoryType = {
      frames: [
        create_frame_with_lattice(
          0,
          { a: 5.0, b: 5.1, c: 10.0, alpha: 90, beta: 90, gamma: 120, volume: 255.5 },
          {},
        ),
        create_frame_with_lattice(
          1,
          { a: 5.1, b: 5.2, c: 10.1, alpha: 90, beta: 90, gamma: 120, volume: 267.5 },
          {},
        ),
      ],
      metadata: { source_format: `test`, frame_count: 2 },
    }

    const lattice_data = full_data_extractor(lattice_trajectory.frames[0], lattice_trajectory)
    expect(lattice_data.a).toBeDefined()
    expect(lattice_data.b).toBeDefined()
    expect(lattice_data.c).toBeDefined()
    expect(lattice_data.volume).toBeDefined()

    // Test mixed structural and energy data
    const mixed_trajectory: TrajectoryType = {
      frames: [
        create_frame_with_lattice(
          0,
          { a: 5.0, volume: 125.0 },
          { energy: -100.0, force_max: 0.5 },
        ),
        create_frame_with_lattice(
          1,
          { a: 5.1, volume: 132.3 },
          { energy: -101.0, force_max: 0.3 },
        ),
      ],
      metadata: { source_format: `test`, frame_count: 2 },
    }

    const mixed_data = full_data_extractor(mixed_trajectory.frames[0], mixed_trajectory)
    expect(mixed_data.a).toBe(5.0)
    expect(mixed_data.volume).toBe(125.0)
    expect(mixed_data.energy).toBe(-100.0)
    expect(mixed_data.force_max).toBe(0.5)

    // Test data compatibility with trajectory plotting requirements
    const plot_data = mixed_trajectory.frames.map((frame) =>
      full_data_extractor(frame, mixed_trajectory),
    )
    const properties = Object.keys(plot_data[0])
    expect(properties).toContain(`energy`)
    expect(properties).toContain(`force_max`)
    expect(properties).toContain(`a`)
    expect(properties).toContain(`volume`)

    // All values should be numeric for plotting
    plot_data.forEach((frame_data) => {
      Object.values(frame_data).forEach((value) => {
        expect(typeof value).toBe(`number`)
      })
    })
  })

  it(`should handle edge cases for plotting compatibility`, () => {
    // Single varying property
    const single_prop_trajectory: TrajectoryType = {
      frames: [
        create_frame_with_lattice(0, { a: 5.0 }, { energy: -100.0 }),
        create_frame_with_lattice(1, { a: 5.0 }, { energy: -101.0 }), // Only energy varies
      ],
      metadata: { source_format: `test`, frame_count: 2 },
    }

    const single_data = single_prop_trajectory.frames.map((frame) =>
      full_data_extractor(frame, single_prop_trajectory),
    )
    expect(single_data[0].energy).not.toBe(single_data[1].energy) // Energy varies
    expect(single_data[0].a).toBe(single_data[1].a) // Lattice constant

    // Ensure extracted data has consistent structure across frames
    const keys_frame_0 = Object.keys(single_data[0]).sort()
    const keys_frame_1 = Object.keys(single_data[1]).sort()
    expect(keys_frame_0).toEqual(keys_frame_1)
  })
})
