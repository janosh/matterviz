import {
  analyze_gas_data,
  apply_gas_corrections,
  compute_gas_chemical_potential,
  compute_gas_correction,
  DEFAULT_ELEMENT_TO_GAS,
  format_chemical_potential,
  GAS_STOICHIOMETRY,
  get_default_gas_provider,
  get_effective_pressures,
  P_REF,
  R_EV_PER_K,
} from '$lib/convex-hull/gas-thermodynamics'
import type { GasSpecies, GasThermodynamicsConfig, PhaseData } from '$lib/convex-hull/types'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'
import { make_phase } from '../setup'

describe(`gas-thermodynamics: physical data tables`, () => {
  // pin the stoichiometry/gas-mapping tables — a typo here silently skews all corrections
  test.each([
    [`O2`, { O: 2 }],
    [`N2`, { N: 2 }],
    [`H2`, { H: 2 }],
    [`F2`, { F: 2 }],
    [`CO`, { C: 1, O: 1 }],
    [`CO2`, { C: 1, O: 2 }],
    [`H2O`, { H: 2, O: 1 }],
  ] as const)(`GAS_STOICHIOMETRY[%s] has correct atom counts`, (gas, expected) => {
    expect(GAS_STOICHIOMETRY[gas]).toEqual(expected)
  })

  test(`DEFAULT_ELEMENT_TO_GAS maps elements to their standard gas sources`, () => {
    expect(DEFAULT_ELEMENT_TO_GAS).toEqual({ O: `O2`, N: `N2`, H: `H2`, F: `F2`, C: `CO2` })
  })
})

describe(`gas-thermodynamics: default provider`, () => {
  test(`get_default_gas_provider returns singleton supporting all gases at 0-2000K`, () => {
    const provider = get_default_gas_provider()
    expect(get_default_gas_provider()).toBe(provider)
    expect(provider.get_supported_gases()).toEqual([...GAS_SPECIES])
    expect(provider.get_temperature_range()).toEqual([0, 2000])
  })

  test(`μ°(T=0) equals formation enthalpy: 0 for elemental gases, negative otherwise`, () => {
    const provider = get_default_gas_provider()
    for (const gas of [`O2`, `N2`, `H2`] as const) {
      expect(provider.get_standard_chemical_potential(gas, 0)).toBe(0)
    }
    for (const gas of [`CO`, `CO2`, `H2O`] as const) {
      expect(provider.get_standard_chemical_potential(gas, 0)).toBeLessThan(0)
    }
  })

  test(`μ°(T) decreases with increasing T (entropy term)`, () => {
    const provider = get_default_gas_provider()
    for (const gas of [`O2`, `N2`, `H2`] as GasSpecies[]) {
      const mu_300 = provider.get_standard_chemical_potential(gas, 300)
      const mu_600 = provider.get_standard_chemical_potential(gas, 600)
      const mu_1000 = provider.get_standard_chemical_potential(gas, 1000)
      // μ°(T) = H_f - T*S, so higher T → lower μ°
      expect(mu_600).toBeLessThan(mu_300)
      expect(mu_1000).toBeLessThan(mu_600)
    }
  })
})

describe(`gas-thermodynamics: chemical potential calculations`, () => {
  const provider = get_default_gas_provider()

  test(`compute_gas_chemical_potential at P=P_REF equals μ°(T)`, () => {
    const T = 500
    for (const gas of GAS_SPECIES) {
      const mu_standard = provider.get_standard_chemical_potential(gas, T)
      const mu_computed = compute_gas_chemical_potential(provider, gas, T, P_REF)
      expect(mu_computed).toBeCloseTo(mu_standard, 10)
    }
  })

  test(`RT*ln(P) contribution is correct (per-atom)`, () => {
    const T = 1000
    const P = 0.1 // One order of magnitude below P_REF
    const mu = compute_gas_chemical_potential(provider, `O2`, T, P)
    const mu_ref = provider.get_standard_chemical_potential(`O2`, T)

    // μ_per_atom(T,P) - μ°_per_atom(T) = RT*ln(P/P_REF) / num_atoms
    // For O2, num_atoms = 2
    const expected_delta = (R_EV_PER_K * T * Math.log(P / P_REF)) / 2
    expect(mu - mu_ref).toBeCloseTo(expected_delta, 10)
  })
})

describe(`gas-thermodynamics: analyze_gas_data`, () => {
  test.each([
    {
      label: `no gas elements when config has no enabled gases`,
      composition: { Fe: 1, O: 2 },
      config: {},
      gas_elements: [],
      relevant_gases: [],
    },
    {
      label: `detects O from O2 when O2 is enabled`,
      composition: { Fe: 2, O: 3 },
      config: { enabled_gases: [`O2`] },
      gas_elements: [`O`],
      relevant_gases: [`O2`],
    },
    {
      label: `detects multiple gas elements`,
      composition: { Fe: 1, O: 1, N: 1 },
      config: { enabled_gases: [`O2`, `N2`] },
      gas_elements: [`O`, `N`],
      relevant_gases: [`O2`, `N2`],
    },
    {
      label: `ignores elements not from enabled gases`,
      composition: { Fe: 1, O: 1 },
      config: { enabled_gases: [`N2`] },
      gas_elements: [],
      relevant_gases: [],
    },
    {
      label: `respects a custom element_to_gas mapping (Xe from O2)`,
      composition: { Fe: 1, Xe: 1 },
      config: { enabled_gases: [`O2`], element_to_gas: { Xe: `O2` } },
      gas_elements: [`Xe`],
      relevant_gases: [`O2`],
    },
    {
      label: `quaternary system with three gas elements`,
      composition: { Fe: 0.5, O: 0.25, N: 0.25, H: 0.1 },
      config: { enabled_gases: [`O2`, `N2`, `H2`] },
      gas_elements: [`O`, `N`, `H`],
      relevant_gases: [`O2`, `N2`, `H2`],
    },
  ] as {
    label: string
    composition: Record<string, number>
    config: GasThermodynamicsConfig
    gas_elements: string[]
    relevant_gases: GasSpecies[]
  }[])(`$label`, ({ composition, config, gas_elements, relevant_gases }) => {
    const result = analyze_gas_data([make_phase(composition)], config)
    expect(result.has_gas_dependent_elements).toBe(gas_elements.length > 0)
    expect(result.gas_elements.toSorted()).toEqual(gas_elements.toSorted())
    expect(result.relevant_gases.toSorted()).toEqual(relevant_gases.toSorted())
  })
})

describe(`gas-thermodynamics: get_effective_pressures`, () => {
  test(`config pressures override the defaults gas by gas`, () => {
    expect(get_effective_pressures({})).toEqual(DEFAULT_GAS_PRESSURES)
    expect(get_effective_pressures({ pressures: { O2: 0.5, N2: 0.1 } })).toEqual({
      ...DEFAULT_GAS_PRESSURES,
      O2: 0.5,
      N2: 0.1,
    })
  })

  test.each([
    [`negative`, -1],
    [`zero`, 0],
    [`NaN`, NaN],
    [`Infinity`, Infinity],
    [`-Infinity`, -Infinity],
  ])(`ignores %s pressure values`, (_, invalid_value) => {
    const pressures = get_effective_pressures({ pressures: { O2: invalid_value } })
    expect(pressures.O2).toBe(DEFAULT_GAS_PRESSURES.O2)
  })
})

describe(`gas-thermodynamics: apply_gas_corrections`, () => {
  test.each([
    [`no gas config`, undefined],
    [`no enabled gases`, { enabled_gases: [] }],
  ])(`returns the same entries array when %s`, (_label, config) => {
    const entries = [make_phase({ Fe: 2, O: 3 }, -2)]
    expect(apply_gas_corrections(entries, config, 500)).toBe(entries)
  })

  test(`only applies correction to unary (elemental) entries`, () => {
    const entries = [
      make_phase({ O: 1 }), // Unary O - should be corrected
      make_phase({ Fe: 1 }), // Unary Fe - no O, no correction
      make_phase({ Fe: 2, O: 3 }, -2), // Binary Fe2O3 - should NOT be corrected
    ]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      pressures: { O2: 0.21 },
    }
    const result = apply_gas_corrections(entries, config, 500)

    expect(result).toHaveLength(3)
    expect(result[0].energy).not.toBe(0) // O reference modified
    expect(result[1].energy).toBe(0) // Fe reference unchanged (no O)
    expect(result[2].energy).toBe(-10) // Compound unchanged
  })

  test(`per-atom correction scales total energy by atom count for O2-style refs`, () => {
    // {O: 2} entry: 2 atoms, energy_per_atom = energy / 2
    const entry: PhaseData = { composition: { O: 2 }, energy: -9.86, energy_per_atom: -4.93 }
    const config: GasThermodynamicsConfig = { enabled_gases: [`O2`], pressures: { O2: 1.0 } }
    const pressures = get_effective_pressures(config)
    const correction = compute_gas_correction(entry, config, 1000, pressures)
    expect(correction).toBeCloseTo(-1.2623, 4) // -T*S(O2, 1000K) per atom at P_REF

    const [result] = apply_gas_corrections([entry], config, 1000)
    // correction is PER-ATOM: energy_per_atom shifts by it, total energy by 2x
    expect(result.energy_per_atom).toBeCloseTo(-4.93 + correction, 10)
    expect(result.energy).toBeCloseTo((-4.93 + correction) * 2, 10)
  })

  test(`correction to O reference changes with pressure`, () => {
    const entries = [make_phase({ O: 1 })]
    const config_low_P: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      pressures: { O2: 0.001 }, // Low pressure
    }
    const config_high_P: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      pressures: { O2: 1.0 }, // High pressure
    }
    const T = 500

    const [result_low_P] = apply_gas_corrections(entries, config_low_P, T)
    const [result_high_P] = apply_gas_corrections(entries, config_high_P, T)

    // Higher pressure → higher chemical potential (less negative correction)
    expect(result_high_P.energy).toBeGreaterThan(result_low_P.energy)
  })
})

describe(`gas-thermodynamics: formatting`, () => {
  test.each([
    [-1.234, 3, `-1.234 eV`],
    [0.5, 3, `+0.500 eV`],
    [0, 3, `+0.000 eV`],
    [-1.23456, 2, `-1.23 eV`],
    [-1.23456, 4, `-1.2346 eV`],
  ])(`format_chemical_potential(%s, %s) = %s`, (mu, decimals, expected) => {
    expect(format_chemical_potential(mu, decimals)).toBe(expected)
  })
})

describe(`gas-thermodynamics: multi-gas scenarios`, () => {
  test(`apply_gas_corrections applies to both O and N unary references`, () => {
    const entries = [make_phase({ O: 1 }), make_phase({ N: 1 }), make_phase({ Fe: 1 })]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`, `N2`],
      pressures: { O2: 0.21, N2: 0.78 },
    }
    const T = 500
    const result = apply_gas_corrections(entries, config, T)

    // Both O and N references should be corrected
    expect(result[0].energy).not.toBe(0) // O reference
    expect(result[1].energy).not.toBe(0) // N reference
    // Fe should remain unchanged (not a gas element)
    expect(result[2].energy).toBe(0)
  })
})

describe(`gas-thermodynamics: boundary pressures`, () => {
  const provider = get_default_gas_provider()

  // Slider range: 10^-10 to 10^2 bar
  const P_MIN = 1e-10
  const P_MAX = 1e2

  test(`μ is finite and increases monotonically from P_MIN to P_MAX`, () => {
    const pressures = [P_MIN, 1e-8, 1e-6, 1e-4, 1e-2, 1, P_MAX]
    const mus = pressures.map((P) => compute_gas_chemical_potential(provider, `O2`, 300, P))
    expect(mus.every(Number.isFinite)).toBe(true)
    for (let idx = 1; idx < mus.length; idx++) expect(mus[idx]).toBeGreaterThan(mus[idx - 1])
    // the -RT ln(P) term makes μ strongly negative at low pressure and lifts it at high pressure
    expect(mus[0]).toBeLessThan(-0.5)
    expect(mus.at(-1)).toBeGreaterThan(-0.5)
  })

  test.each([
    [`zero`, 0],
    [`negative`, -1],
    [`NaN`, NaN],
    [`Infinity`, Infinity],
    [`-Infinity`, -Infinity],
  ])(`handles %s pressure gracefully (falls back to P_REF)`, (_, invalid_P) => {
    const mu_ref = compute_gas_chemical_potential(provider, `O2`, 300, P_REF)
    const mu_invalid = compute_gas_chemical_potential(provider, `O2`, 300, invalid_P)
    expect(mu_invalid).toBe(mu_ref)
  })
})
