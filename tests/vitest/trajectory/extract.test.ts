import {
  energy_data_extractor,
  force_stress_data_extractor,
  full_data_extractor,
  structural_data_extractor,
} from '$lib/trajectory/extract'
import { open_trajectory } from '$lib/trajectory/open'
import { describe, expect, it } from 'vitest'
import { make_trajectory_frame, read_binary_test_file } from '../setup'

describe(`trajectory data extractors`, () => {
  it(`extracts all supported energy fields and keeps zeroes`, () => {
    const frame = make_trajectory_frame(5, 1, {
      energy: -10.5,
      energy_per_atom: -5.25,
      potential_energy: -12,
      kinetic_energy: 1.5,
      total_energy: 0,
    })
    expect(energy_data_extractor(frame)).toEqual({
      Step: 5,
      energy: -10.5,
      energy_per_atom: -5.25,
      potential_energy: -12,
      kinetic_energy: 1.5,
      total_energy: 0,
    })
  })

  it(`calculates force statistics and copies stress metadata`, () => {
    const frame = make_trajectory_frame(1, 1, {
      forces: [
        [1, 0, 0],
        [0, 2, 0],
        [0, 0, 3],
      ],
      stress_max: 2.1,
      pressure: 0,
    })
    expect(force_stress_data_extractor(frame)).toEqual({
      Step: 1,
      force_max: 3,
      force_norm: expect.closeTo(Math.sqrt(14 / 3), 12),
      stress_max: 2.1,
      pressure: 0,
    })
  })

  it(`uses scalar force summaries when no force array is present`, () => {
    expect(
      force_stress_data_extractor(
        make_trajectory_frame(2, 1, { force_max: 0, force_norm: 3.5 }),
      ),
    ).toEqual({ Step: 2, force_max: 0, force_norm: 3.5 })
  })

  it(`extracts lattice geometry and prefers an explicit density`, () => {
    const frame = make_trajectory_frame(
      4,
      1,
      { density: 0, temperature: 300 },
      { a: 2, b: 2, c: 2, alpha: 90, beta: 90, gamma: 90, volume: 8 },
    )
    expect(structural_data_extractor(frame)).toMatchObject({
      Step: 4,
      a: 2,
      b: 2,
      c: 2,
      alpha: 90,
      beta: 90,
      gamma: 90,
      volume: 8,
      density: 0,
      temperature: 300,
    })
  })

  it(`combines energy, force, SCF, and structural fields`, () => {
    const frame = make_trajectory_frame(
      0,
      1,
      { energy: -10, force_max: 2, n_scf_steps: 8, scf_energy_delta: 1e-6, density: 2.5 },
      { a: 1, b: 1, c: 1, volume: 1 },
    )
    expect(full_data_extractor(frame)).toMatchObject({
      Step: 0,
      energy: -10,
      force_max: 2,
      n_scf_steps: 8,
      scf_energy_delta: 1e-6,
      volume: 1,
      density: 2.5,
    })
  })

  it(`extracts every frame of a lazy HDF5 run`, async () => {
    const run = await open_trajectory(
      read_binary_test_file(`flame-gold-cluster-55-atoms.h5`),
      { filename: `flame-gold-cluster-55-atoms.h5` },
    )
    try {
      const rows = await Promise.all(
        Array.from({ length: run.frame_count }, async (_unused, frame_idx) =>
          full_data_extractor(await run.read_frame(frame_idx)),
        ),
      )
      // 20 frames written every 25 steps in a fixed 25.8165 A cubic box
      expect(rows.map((row) => row.Step)).toEqual(
        Array.from({ length: 20 }, (_unused, idx) => 25 * (idx + 1)),
      )
      for (const row of rows) expect(row.volume).toBeCloseTo(17206.47404956977, 6)
    } finally {
      run.dispose()
    }
  })
})
