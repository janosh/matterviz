import { full_data_extractor, structural_data_extractor } from '#lib/trajectory/extract.js'
import { describe, expect, it } from 'vitest'
import { make_trajectory_frame } from '../test-fixtures'

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
  const scalars = { stress_max: 2.1, pressure: 0, bandgap: 1.2, ref_energy: -3 }
  // `exact` rows pin the whole record; the others may carry extra derived fields
  // oxfmt-ignore
  it.each([
    [`lattice geometry, preferring an explicit density`, structural_data_extractor, 4,
      { density: 0, temperature: 300 }, cubic, { Step: 4, ...cubic, density: 0, temperature: 300 }, false],
    // every finite metadata scalar (zeroes included), not an allowlist; bookkeeping,
    // non-numbers and per-atom vectors (they belong on the sites) stay out
    [`every finite metadata scalar and nothing else`, full_data_extractor, 3,
      { ...energies, ...scalars, forces, step: 3, total_atoms: 4, label: `x`, converged: true, bad: Number.NaN },
      undefined, { Step: 3, ...energies, ...scalars }, true],
    // the structural fields were copied unfiltered and overrode the finite-only scan
    [`no non-finite structural fields`, full_data_extractor, 5,
      { temperature: Number.NaN, volume: Infinity, density: -Infinity }, undefined, { Step: 5 }, true],
    [`combined energy, force, SCF and structural fields`, full_data_extractor, 0,
      full, { a: 1, b: 1, c: 1, volume: 1 }, { Step: 0, ...full, volume: 1 }, false],
  ])(`extracts %s`, (_label, extractor, step, metadata, lattice, expected, exact) => {
    const row = extractor(make_trajectory_frame(step, 1, metadata, lattice))
    if (exact) expect(row).toEqual(expected)
    else expect(row).toMatchObject(expected)
  })
})
