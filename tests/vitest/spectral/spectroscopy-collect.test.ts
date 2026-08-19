import type { PositionStreamOptions, TrajectoryFrame, TrajectoryType } from '$lib/trajectory'
import { accumulate_positions } from '$lib/trajectory/frame-reader'
import { create_packed_frame_loader } from '$lib/trajectory/helpers'
import {
  calc_trajectory_spectroscopy,
  collect_trajectory_spectroscopy_input,
  type RamanSignal,
} from '$lib/spectral'
import { describe, expect, it } from 'vitest'

const make_frame = (step: number): TrajectoryFrame => ({
  step,
  structure: {
    sites: [
      {
        species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
        xyz: [0.01 * step, 0, 0],
        abc: [0.01 * step, 0, 0],
        label: `H1`,
        properties: { velocity: [1, 0, 0], mass: 1.5 },
      },
    ],
  },
  metadata: {
    dipole: [Math.sin(step), 0, 0],
    polarizability: [
      [1 + Math.cos(step), 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ],
  },
})

const make_trajectory = (): TrajectoryType => ({
  frames: Array.from({ length: 8 }, (_unused, frame_idx) => make_frame(frame_idx)),
  time_step: 0.5,
  time_unit: `fs`,
})

describe(`collect_trajectory_spectroscopy_input`, () => {
  it(`streams scalar, vector, tensor, and per-atom numeric metadata signals`, async () => {
    const frames = Array.from({ length: 4 }, (_unused, frame_idx) => {
      const frame = make_frame(frame_idx)
      frame.structure.sites = Array.from({ length: 4 }, (_site, atom_idx) => ({
        ...frame.structure.sites[0],
        label: `H${atom_idx + 1}`,
        xyz: [atom_idx, 0, 0],
        abc: [atom_idx, 0, 0],
      }))
      frame.metadata = {
        scalar: frame_idx,
        dipole: [frame_idx, 0, 0],
        polarizability: Array.from({ length: 9 }, (_value, value_idx) => value_idx),
        charges: [1, -1, 1, -1],
        atom_vectors: Array.from({ length: 4 }, (_atom, atom_idx) => [atom_idx, 0, 0]),
      }
      return frame
    })
    const stream = await accumulate_positions(
      frames.length,
      (frame_idx) => frames[frame_idx],
      {
        signal_keys: [`scalar`, `dipole`, `polarizability`, `charges`, `atom_vectors`],
      },
    )
    expect(stream.signals?.scalar.sample_shape).toEqual([])
    expect(stream.signals?.dipole.sample_shape).toEqual([3])
    expect(stream.signals?.dipole.values).toHaveLength(12)
    expect(stream.signals?.polarizability.sample_shape).toEqual([3, 3])
    expect(stream.signals?.charges.sample_shape).toEqual([4])
    expect(stream.signals?.atom_vectors.sample_shape).toEqual([4, 3])
  })

  it(`collects frame response signals, site velocities, masses, and time provenance together`, async () => {
    const input = await collect_trajectory_spectroscopy_input(make_trajectory())
    expect(input.positions.n_frames).toBe(8)
    expect(input.velocities?.sample_shape).toEqual([1, 3])
    expect(input.velocities?.values).toHaveLength(24)
    expect(input.masses).toEqual(Float64Array.from([1.5]))
    expect(input.infrared_signal?.kind).toBe(`dipole`)
    expect(input.infrared_signal?.series.sample_shape).toEqual([3])
    expect(input.raman_signal?.kind).toBe(`polarizability`)
    if (input.raman_signal?.kind === `polarizability`) {
      expect(input.raman_signal.series.sample_shape).toEqual([3, 3])
    }
    expect(input.time_step).toBe(0.5)
    expect(input.time_unit).toBe(`fs`)
    expect(input.metadata?.mass_source).toBe(`recorded`)
  })

  it(`infers custom IR response keys case-insensitively`, async () => {
    const trajectory = make_trajectory()
    for (const frame of trajectory.frames) {
      const dipole = frame.metadata?.dipole
      delete frame.metadata?.dipole
      if (frame.metadata) frame.metadata.Polarization = dipole
    }
    const input = await collect_trajectory_spectroscopy_input(trajectory, {
      infrared_key: `Polarization`,
      polarization_branch_continuous: true,
    })
    expect(input.infrared_signal?.kind).toBe(`polarization`)
  })

  it.each([
    [
      { time_step: 0.5, time_unit: undefined },
      /time_step and time_unit must be supplied together/,
    ],
    [
      { time_step: undefined, time_unit: `fs` },
      /time_step and time_unit must be supplied together/,
    ],
    [{ time_step: 0.5, time_unit: ` ` }, /time_unit must be a non-empty string/],
  ])(
    `forwards incomplete time metadata so calculation rejects it`,
    async (metadata, error) => {
      const trajectory = Object.assign(make_trajectory(), metadata)
      const input = await collect_trajectory_spectroscopy_input(trajectory)
      expect(input.time_step).toBe(metadata.time_step)
      expect(input.time_unit).toBe(metadata.time_unit)
      expect(() =>
        calc_trajectory_spectroscopy(input, {
          preprocessing: `raw`,
          frequency_unit: `1/frame`,
        }),
      ).toThrow(error)
    },
  )

  it(`rejects invalid recorded masses unless standard masses are explicitly selected`, async () => {
    const trajectory = make_trajectory()
    trajectory.frames[0].structure.sites[0].properties.mass = Number.POSITIVE_INFINITY
    await expect(collect_trajectory_spectroscopy_input(trajectory)).rejects.toThrow(
      /Recorded mass 0 must be finite and > 0/,
    )
    const input = await collect_trajectory_spectroscopy_input(trajectory, {
      mass_source: `standard`,
    })
    expect(input.masses[0]).toBeCloseTo(1.008, 12)
    expect(input.metadata?.mass_source).toBe(`standard`)
  })

  it(`preserves independent-cadence trajectory signals instead of intersecting them`, async () => {
    const trajectory = make_trajectory()
    trajectory.signals = {
      dipole: {
        values: Float64Array.from([1, 0, 0, 0, 1, 0]),
        sample_shape: [3],
        steps: [0, 4],
      },
      polarizability: {
        values: Float64Array.from(
          Array.from({ length: 3 }, (_unused, idx) => [
            1 + idx,
            0,
            0,
            0,
            2,
            0,
            0,
            0,
            3,
          ]).flat(),
        ),
        sample_shape: [3, 3],
        steps: [0, 2, 4],
      },
    }
    const input = await collect_trajectory_spectroscopy_input(trajectory)
    expect(input.infrared_signal?.series.steps).toEqual([0, 4])
    if (input.raman_signal?.kind === `polarizability`) {
      expect(input.raman_signal.series.steps).toEqual([0, 2, 4])
    }
    expect(input.positions.steps).toHaveLength(8)
  })

  it(`does not collect lower-priority frame or site channels when explicit signals win`, async () => {
    const trajectory = make_trajectory()
    trajectory.signals = {
      velocity: {
        values: new Float64Array(8 * 3),
        sample_shape: [1, 3],
        steps: Array.from({ length: 8 }, (_unused, frame_idx) => frame_idx),
      },
    }
    const explicit_raman: RamanSignal = {
      kind: `polarizability`,
      series: {
        values: new Float64Array(8 * 9),
        sample_shape: [3, 3],
        steps: Array.from({ length: 8 }, (_unused, frame_idx) => frame_idx),
      },
    }
    trajectory.frames[1].structure.sites[0].properties.velocity = `invalid`
    trajectory.frames[1].metadata = {
      ...trajectory.frames[1].metadata,
      polarizability: `invalid`,
    }
    const input = await collect_trajectory_spectroscopy_input(trajectory, {
      raman_signal: explicit_raman,
    })
    expect(input.velocities).toBe(trajectory.signals.velocity)
    expect(input.raman_signal).toBe(explicit_raman)
    expect(input.metadata?.signal_sources).toMatchObject({
      velocity: `velocity`,
      raman: { key: null, kind: `polarizability` },
    })
  })

  it(`requires explicit continuity before accepting polarization as IR input`, async () => {
    const trajectory = make_trajectory()
    trajectory.signals = {
      polarization: {
        values: new Float64Array(24),
        sample_shape: [3],
        steps: Array.from({ length: 8 }, (_unused, frame_idx) => frame_idx),
      },
    }
    await expect(
      collect_trajectory_spectroscopy_input(trajectory, {
        infrared_key: `polarization`,
        infrared_kind: `polarization`,
      }),
    ).rejects.toThrow(/must be explicitly marked branch_continuous/)
    const input = await collect_trajectory_spectroscopy_input(trajectory, {
      infrared_key: `polarization`,
      infrared_kind: `polarization`,
      polarization_branch_continuous: true,
    })
    expect(input.infrared_signal).toMatchObject({
      kind: `polarization`,
      branch_continuous: true,
    })
  })

  it(`forwards response signal keys to an indexed streaming loader`, async () => {
    const trajectory = make_trajectory()
    let requested_options: PositionStreamOptions | undefined
    trajectory.is_indexed = true
    trajectory.total_frames = 50
    trajectory.frame_loader = {
      get_total_frames: async () => 50,
      build_frame_index: async () => [],
      load_frame: async () => null,
      extract_plot_metadata: async () => [],
      stream_positions: async (_raw_data, options) => {
        requested_options = options
        return {
          positions: new Float64Array(50 * 3),
          n_frames: 50,
          n_atoms: 1,
          elements: [`H`],
          lattice_matrices: null,
          pbc: null,
          coords_unwrapped: false,
          frame_stride: 1,
          steps: Array.from({ length: 50 }, (_unused, frame_idx) => frame_idx),
          signals: {
            dipole: {
              values: new Float64Array(50 * 3),
              sample_shape: [3],
              steps: Array.from({ length: 50 }, (_unused, frame_idx) => frame_idx),
            },
            polarizability: {
              values: new Float64Array(50 * 9),
              sample_shape: [3, 3],
              steps: Array.from({ length: 50 }, (_unused, frame_idx) => frame_idx),
            },
          },
        }
      },
    }
    const input = await collect_trajectory_spectroscopy_input(trajectory, {
      raw_data: `fixture`,
    })
    expect(requested_options?.signal_keys).toEqual([`dipole`, `polarizability`])
    expect(input.infrared_signal?.series.steps).toHaveLength(50)
  })

  it(`collects indexed packed trajectories without retaining the raw payload`, async () => {
    const trajectory = make_trajectory()
    trajectory.frames = trajectory.frames.slice(0, 1)
    trajectory.is_indexed = true
    trajectory.total_frames = 4
    trajectory.frame_store = {
      positions: new Float64Array(12),
      elements: [`H`],
      coords_unwrapped: false,
      steps: [0, 1, 2, 3],
      metadata: [{}, {}, {}, {}],
      plot_metadata: [0, 1, 2, 3].map((frame_number) => ({
        frame_number,
        step: frame_number,
        properties: {},
      })),
    }
    trajectory.frame_loader = create_packed_frame_loader(trajectory.frame_store)

    const input = await collect_trajectory_spectroscopy_input(trajectory, {
      velocity_key: null,
      infrared_key: null,
      raman_key: null,
    })

    expect(input.positions).toMatchObject({ n_frames: 4, steps: [0, 1, 2, 3] })
  })
})
