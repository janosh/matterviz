import type { RadiationType, ScatteringSpecies } from '$lib/scattering'
import {
  electron_form_factor,
  neutron_scattering_length,
  pdf_scattering_weights,
  scattering_length,
  xray_form_factor,
} from '$lib/scattering'
import NEUTRON_SCATTERING_LENGTHS from '$lib/scattering/neutron-scattering-lengths.json' with { type: 'json' }
import { describe, expect, test } from 'vitest'

describe(`neutron_scattering_length`, () => {
  // Reference b_coh in fm from the NIST NCNR table (Sears 1992 compilation). The table quotes
  // at most 4 decimals, so requiring 4 decimals here is an exact-match check, not a fudge.
  const B_COH_DECIMALS = 4

  test.each([
    [`H`, -3.739], // negative: 180 degree phase shift, the classic sign trap
    [`D`, 6.671], // deuterium differs from protium in both sign and magnitude
    [`Ti`, -3.438], // negative
    [`V`, -0.3824], // near-zero and negative, hence V's use as a null-scattering can material
    [`Mn`, -3.73], // negative
    [`C`, 6.646],
    [`O`, 5.803],
    [`Si`, 4.1491],
    [`Fe`, 9.45],
    [`Ni`, 10.3],
    [`Pb`, 9.405],
    [`U`, 8.417],
  ] as [ScatteringSpecies, number][])(`b_coh(%s) = %f fm`, (element, expected) => {
    expect(neutron_scattering_length(element)).toBeCloseTo(expected, B_COH_DECIMALS)
  })

  // The NIST table has no measured natural-abundance b_coh for any of these
  test.each([`Po`, `At`, `Rn`, `Fr`, `Ac`, `Pu`, `Cm`, `Cf`, `Og`] as ScatteringSpecies[])(
    `throws naming %s when absent from the table`,
    (element) => {
      expect(() => neutron_scattering_length(element)).toThrow(
        new RegExp(`No neutron scattering length for ${element}\\b`),
      )
    },
  )

  test(`table covers 89 elements plus deuterium with physically plausible values`, () => {
    const table = NEUTRON_SCATTERING_LENGTHS as Record<string, number>
    expect(Object.keys(table)).toHaveLength(90)
    for (const [element, b_coh] of Object.entries(table)) {
      expect(Number.isFinite(b_coh), `${element} must be finite`).toBe(true)
      // |b_coh| stays well under 20 fm across the whole table; catches unit or parsing slips
      expect(Math.abs(b_coh), `${element} out of physical range`).toBeLessThan(20)
    }
  })
})

// Independent derivation of the Mott-Bethe prefactor m0·e²/(2h²) = m0·e²/(8·pi·eps0·h²) in SI,
// from CODATA 2018, so the constant baked into the module is checked against physics rather
// than against a copy of itself.
const ELECTRON_MASS_KG = 9.1093837015e-31
const ELEMENTARY_CHARGE_C = 1.602176634e-19
const PLANCK_J_S = 6.62607015e-34
const VACUUM_PERMITTIVITY_F_PER_M = 8.8541878128e-12
const MOTT_BETHE_PER_ANGSTROM =
  (ELECTRON_MASS_KG * ELEMENTARY_CHARGE_C ** 2) /
  (8 * Math.PI * VACUUM_PERMITTIVITY_F_PER_M * PLANCK_J_S ** 2) /
  1e10

describe(`electron_form_factor`, () => {
  // The Mott-Bethe divergence trap: a literal f_e = K·(Z − f_x)/s² divides by zero here, but
  // the s² cancels analytically so f_e(0) must come out finite and strictly positive.
  test.each([`H`, `C`, `Si`, `Fe`, `Au`, `U`] as ScatteringSpecies[])(
    `is finite and positive as s -> 0 for %s`,
    (species) => {
      for (const s_val of [0, 1e-12, 1e-8, 1e-4]) {
        const f_e = electron_form_factor(species, s_val)
        expect(Number.isFinite(f_e), `f_e(${s_val}) must be finite`).toBe(true)
        expect(f_e).toBeGreaterThan(0)
      }
      // the limit is approached continuously rather than jumped to
      const at_zero = electron_form_factor(species, 0)
      expect(electron_form_factor(species, 1e-8)).toBeCloseTo(at_zero, 10)
    },
  )

  test.each([`Si`, `Fe`, `Au`, `U`] as ScatteringSpecies[])(
    `decreases monotonically with increasing s for %s`,
    (species) => {
      const s_values = Array.from({ length: 40 }, (_, idx) => idx * 0.05)
      const factors = s_values.map((s_val) => electron_form_factor(species, s_val))
      for (let idx = 1; idx < factors.length; idx++) {
        expect(
          factors[idx],
          `f_e should drop from s=${s_values[idx - 1]} to s=${s_values[idx]}`,
        ).toBeLessThan(factors[idx - 1])
      }
      expect(factors.at(-1)).toBeGreaterThan(0)
    },
  )

  test(`heavier elements scatter electrons more strongly in the forward direction`, () => {
    const species: ScatteringSpecies[] = [`C`, `Si`, `Fe`, `Au`]
    const forward = species.map((element) => electron_form_factor(element, 0))
    for (let idx = 1; idx < forward.length; idx++) {
      expect(forward[idx]).toBeGreaterThan(forward[idx - 1])
    }
  })

  test(`derived constant C = prefactor · 41.78214 is 1 to within 5e-7`, () => {
    // the module hard-codes this same value; deriving it from CODATA here is the actual check
    expect(MOTT_BETHE_PER_ANGSTROM).toBeCloseTo(0.02393366096322682, 15)
    const const_c = MOTT_BETHE_PER_ANGSTROM * 41.78214
    // pymatgen's 41.78214 is the reciprocal of the Mott-Bethe prefactor to 4.3e-7 relative,
    // so C is near but not exactly 1
    expect(Math.abs(const_c - 1)).toBeLessThan(5e-7)
    // f_e(0) = C · Σ aᵢ, tied here to the raw Gaussian amplitudes for carbon in the JSON
    const carbon_amplitudes = 0.731 + 1.195 + 0.456 + 0.125
    expect(electron_form_factor(`C`, 0)).toBeCloseTo(const_c * carbon_amplitudes, 12)
  })

  // Away from s = 0 the naive form is numerically safe, so the two routes must agree there
  // oxfmt-ignore
  test.each([
    [`C`, 0.1], [`C`, 0.5], [`Si`, 0.2], [`Fe`, 0.35], [`Au`, 0.8], [`U`, 1.2],
  ] as [ScatteringSpecies, number][])(
    `matches the naive K·(Z − f_x)/s² form for %s at s = %f`,
    (species, s_val) => {
      const atomic_number = xray_form_factor(species, 0)
      const naive =
        (MOTT_BETHE_PER_ANGSTROM * (atomic_number - xray_form_factor(species, s_val))) /
        (s_val * s_val)
      const rel_err = Math.abs(electron_form_factor(species, s_val) - naive) / Math.abs(naive)
      // the s² cancellation is exact, so the only residual is FP round-off in the subtraction
      // Z − f_x and the division by s². Anything above 1e-12 means the algebra is wrong.
      expect(rel_err).toBeLessThan(1e-12)
    },
  )

  // oxfmt-ignore
  test.each([
    [`H`, 1], [`D`, 1], [`C`, 6], [`Fe`, 26], [`U`, 92],
  ] as [ScatteringSpecies, number][])(
    `xray_form_factor(%s, 0) returns Z = %i`,
    (element, atomic_number) => {
      expect(xray_form_factor(element, 0)).toBeCloseTo(atomic_number, 12)
    },
  )

  test.each([`Es`, `Fm`, `Og`] as ScatteringSpecies[])(
    `throws naming %s when Gaussian params are absent`,
    (element) => {
      expect(() => electron_form_factor(element, 0.3)).toThrow(
        new RegExp(`No atomic scattering coefficients for ${element}\\b`),
      )
    },
  )

  test.each([-0.1, Number.NaN, Number.POSITIVE_INFINITY])(`rejects s = %s`, (s_val) => {
    expect(() => electron_form_factor(`Si`, s_val)).toThrow(/Invalid scattering variable/)
    expect(() => xray_form_factor(`Si`, s_val)).toThrow(/Invalid scattering variable/)
  })
})

describe(`pdf_scattering_weights`, () => {
  const binaries: [string, Record<string, number>][] = [
    [`NaCl`, { Na: 0.5, Cl: 0.5 }],
    [`SiO2`, { Si: 1 / 3, O: 2 / 3 }],
    [`TiO2 with negative b_Ti`, { Ti: 1 / 3, O: 2 / 3 }],
    [`H2O with negative b_H`, { H: 2 / 3, O: 1 / 3 }],
    [`Fe2O3 as raw counts`, { Fe: 2, O: 3 }],
  ]
  const radiations: RadiationType[] = [`xray`, `neutron`, `electron`]

  test.each(
    binaries.flatMap(([name, composition]) =>
      radiations.map((radiation) => ({ name, composition, radiation })),
    ),
  )(
    `$name weights sum to 1 over all ordered pairs ($radiation)`,
    ({ composition, radiation }) => {
      const { pair_weight } = pdf_scattering_weights(composition, radiation)
      const elements = Object.keys(composition)
      let total = 0
      for (const element_a of elements) {
        for (const element_b of elements) total += pair_weight(element_a, element_b)
      }
      // analytically (Σ c_a b_a)² / <b>² = 1, so only FP rounding separates us from exact
      expect(total).toBeCloseTo(1, 12)
    },
  )

  test.each(binaries)(
    `%s unordered pairs with multiplicity 2 for unlike pairs also sum to 1`,
    (_name, composition) => {
      const { pair_weight } = pdf_scattering_weights(composition, `neutron`)
      const elements = Object.keys(composition)
      let total = 0
      for (let idx_a = 0; idx_a < elements.length; idx_a++) {
        for (let idx_b = idx_a; idx_b < elements.length; idx_b++) {
          const multiplicity = idx_a === idx_b ? 1 : 2
          total += multiplicity * pair_weight(elements[idx_a], elements[idx_b])
        }
      }
      expect(total).toBeCloseTo(1, 12)
    },
  )

  test(`reproduces hand-computed neutron weights for equimolar NaCl`, () => {
    const b_na = neutron_scattering_length(`Na`)
    const b_cl = neutron_scattering_length(`Cl`)
    const mean_b = 0.5 * b_na + 0.5 * b_cl
    const weights = pdf_scattering_weights({ Na: 0.5, Cl: 0.5 }, `neutron`)
    expect(weights.mean_scattering_length).toBeCloseTo(mean_b, 12)
    expect(weights.pair_weight(`Na`, `Cl`)).toBeCloseTo(
      (0.25 * b_na * b_cl) / (mean_b * mean_b),
      12,
    )
    expect(weights.pair_weight(`Na`, `Cl`)).toBeCloseTo(weights.pair_weight(`Cl`, `Na`), 15)
  })

  test(`normalizes raw atom counts to fractions`, () => {
    const from_counts = pdf_scattering_weights({ Fe: 2, O: 3 }, `neutron`)
    const from_fractions = pdf_scattering_weights({ Fe: 0.4, O: 0.6 }, `neutron`)
    expect(from_counts.fractions.Fe).toBeCloseTo(0.4, 15)
    expect(from_counts.fractions.O).toBeCloseTo(0.6, 15)
    expect(from_counts.mean_scattering_length).toBeCloseTo(
      from_fractions.mean_scattering_length,
      12,
    )
  })

  test(`cross weight goes negative when one species has negative b_coh`, () => {
    const { pair_weight } = pdf_scattering_weights({ Ti: 1 / 3, O: 2 / 3 }, `neutron`)
    // b_Ti < 0 < b_O, so the cross term is negative while like-pair terms stay positive
    expect(pair_weight(`Ti`, `O`)).toBeLessThan(0)
    expect(pair_weight(`Ti`, `Ti`)).toBeGreaterThan(0)
    expect(pair_weight(`O`, `O`)).toBeGreaterThan(0)
  })

  test(`throws on a null-matrix composition instead of returning Infinity`, () => {
    // Ti/Zr ratio tuned so c_Ti·b_Ti + c_Zr·b_Zr = 0, the classic null-scattering alloy
    const b_ti = neutron_scattering_length(`Ti`)
    const b_zr = neutron_scattering_length(`Zr`)
    const frac_ti = b_zr / (b_zr - b_ti)
    expect(() => pdf_scattering_weights({ Ti: frac_ti, Zr: 1 - frac_ti }, `neutron`)).toThrow(
      /null-matrix/,
    )
    // the same alloy is perfectly well defined for X-rays, where all f are positive
    expect(() =>
      pdf_scattering_weights({ Ti: frac_ti, Zr: 1 - frac_ti }, `xray`),
    ).not.toThrow()
  })

  const invalid_compositions: [Record<string, number>, RegExp][] = [
    [{}, /Empty composition/],
    [{ Na: 0, Cl: 0 }, /sum to 0/],
    [{ Na: -1, Cl: 2 }, /Invalid amount -1 for Na/],
    [{ Na: Number.NaN }, /Invalid amount NaN for Na/],
    [{ Xx: 1 }, /Unknown element symbol Xx/],
    [{ Og: 1 }, /No neutron scattering length for Og/],
  ]
  test.each(invalid_compositions)(
    `rejects invalid composition %j`,
    (composition, expected) => {
      expect(() => pdf_scattering_weights(composition, `neutron`)).toThrow(expected)
    },
  )

  test(`pair_weight throws naming an element outside the composition`, () => {
    const { pair_weight } = pdf_scattering_weights({ Na: 0.5, Cl: 0.5 }, `neutron`)
    expect(() => pair_weight(`Na`, `Fe`)).toThrow(/Fe is not part of the composition/)
    expect(() => pair_weight(`Fe`, `Na`)).toThrow(/Fe is not part of the composition/)
  })
})

describe(`scattering_length dispatch`, () => {
  const cases: [RadiationType, ScatteringSpecies, number][] = [
    [`neutron`, `Fe`, 9.45],
    [`xray`, `Fe`, 26],
    // C · Σ aᵢ with the Doyle-Turner amplitudes for Fe (2.544 + 2.343 + 1.759 + 0.506
    // = 7.152) and C = 0.9999995731, hard-coded so this does not check the function
    // against itself. 6 decimals: the true value is 7.1519969467.
    [`electron`, `Fe`, 7.151997],
  ]
  test.each(cases)(`%s radiation for %s at s = 0`, (radiation, element, expected) => {
    expect(scattering_length(element, radiation)).toBeCloseTo(expected, 6)
  })

  test(`unknown radiation type throws`, () => {
    expect(() => scattering_length(`Fe`, `muon` as unknown as RadiationType)).toThrow(
      /Unknown radiation type muon/,
    )
  })

  test(`neutron scattering ignores s while xray and electron fall off with it`, () => {
    expect(scattering_length(`Fe`, `neutron`, 0)).toBe(scattering_length(`Fe`, `neutron`, 0.7))
    expect(scattering_length(`Fe`, `xray`, 0.7)).toBeLessThan(
      scattering_length(`Fe`, `xray`, 0),
    )
    expect(scattering_length(`Fe`, `electron`, 0.7)).toBeLessThan(
      scattering_length(`Fe`, `electron`, 0),
    )
  })
})
