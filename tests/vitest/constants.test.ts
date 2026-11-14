import * as constants from '#lib/constants.js'
import { describe, expect, test } from 'vite-plus/test'

describe(`derived physical constants`, () => {
  // Pin derived constants to published values (CODATA 2018; ase.units.fs on ASE's CODATA 2014
  // default): consumer tests reuse the constant, so a wrong derivation would pass them all
  test.each([
    [`k_B eV/K`, constants.BOLTZMANN_EV_PER_K, 8.617333262e-5],
    [`eV -> kJ/mol`, constants.EV_TO_KJ_PER_MOL, 96.485332],
    [`eV/A^3 -> GPa`, constants.EV_PER_A3_TO_GPA, 160.2176634],
    [`ase.units.fs`, constants.FS_IN_ASE_TIME, 0.09822694788464063],
  ])(`%s = %f`, (_name, value, reference) => {
    expect(Math.abs(value / reference - 1)).toBeLessThan(1e-8)
  })
})
