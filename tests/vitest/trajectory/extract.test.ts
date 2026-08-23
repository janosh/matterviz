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
  const forces = [
    [1, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ]
  const cubic = { a: 2, b: 2, c: 2, alpha: 90, beta: 90, gamma: 90, volume: 8 }
  const energies = {
    energy: -10.5,
    energy_per_atom: -5.25,
    potential_energy: -12,
    kinetic_energy: 1.5,
    total_energy: 0,
  }
  const full = {
    energy: -10,
    force_max: 2,
    n_scf_steps: 8,
    scf_energy_delta: 1e-6,
    density: 2.5,
  }
  // `exact` rows pin the whole record; the others may carry extra derived fields
  it.each([
    [
      `all supported energy fields (keeping zeroes)`,
      energy_data_extractor,
      5,
      energies,
      undefined,
      { Step: 5, ...energies },
      true,
    ],
    [
      `force statistics and copied stress metadata`,
      force_stress_data_extractor,
      1,
      { forces, stress_max: 2.1, pressure: 0 },
      undefined,
      {
        Step: 1,
        force_max: 3,
        force_norm: expect.closeTo(Math.sqrt(14 / 3), 12),
        stress_max: 2.1,
        pressure: 0,
      },
      true,
    ],
    [
      `scalar force summaries when no force array is present`,
      force_stress_data_extractor,
      2,
      { force_max: 0, force_norm: 3.5 },
      undefined,
      { Step: 2, force_max: 0, force_norm: 3.5 },
      true,
    ],
    [
      `lattice geometry, preferring an explicit density`,
      structural_data_extractor,
      4,
      { density: 0, temperature: 300 },
      cubic,
      { Step: 4, ...cubic, density: 0, temperature: 300 },
      false,
    ],
    [
      `combined energy, force, SCF and structural fields`,
      full_data_extractor,
      0,
      full,
      { a: 1, b: 1, c: 1, volume: 1 },
      { Step: 0, ...full, volume: 1 },
      false,
    ],
  ])(`extracts %s`, (_label, extractor, step, metadata, lattice, expected, exact) => {
    const row = extractor(make_trajectory_frame(step, 1, metadata, lattice))
    if (exact) expect(row).toEqual(expected)
    else expect(row).toMatchObject(expected)
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
