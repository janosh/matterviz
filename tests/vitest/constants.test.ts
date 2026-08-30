import { BOLTZMANN_EV_PER_K, EV_PER_A3_TO_GPA, EV_TO_KJ_PER_MOL } from '$lib/constants'
import { describe, expect, test } from 'vitest'

describe(`derived physical constants`, () => {
  // Pin the derived constants to their CODATA 2018 values: every consumer test derives its
  // expectation from the same constant, so a wrong derivation would otherwise pass
  test.each([
    [`k_B eV/K`, BOLTZMANN_EV_PER_K, 8.617333262e-5],
    [`eV -> kJ/mol`, EV_TO_KJ_PER_MOL, 96.485332],
    [`eV/A^3 -> GPa`, EV_PER_A3_TO_GPA, 160.2176634],
  ])(`%s = %f`, (_name, value, reference) => {
    expect(Math.abs(value / reference - 1)).toBeLessThan(1e-8)
  })
})
