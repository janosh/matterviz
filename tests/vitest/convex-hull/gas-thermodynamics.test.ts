import {
  analyze_gas_data,
  apply_gas_corrections,
  compute_element_chemical_potential,
  compute_gas_chemical_potential,
  compute_gas_correction,
  DEFAULT_ELEMENT_TO_GAS,
  format_chemical_potential,
  format_pressure,
  GAS_STOICHIOMETRY,
  get_default_gas_provider,
  get_effective_pressures,
  P_REF,
  R_EV_PER_K,
} from '$lib/convex-hull/gas-thermodynamics'
import type { GasSpecies, GasThermodynamicsConfig, PhaseData } from '$lib/convex-hull/types'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'

// Helper to create test entries with default energy=0
const make_entry = (comp: Record<string, number>, energy = 0): PhaseData => ({
  composition: comp,
  energy,
})

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

  test(`μ°(T=0) equals formation enthalpy for non-elemental gases`, () => {
    const provider = get_default_gas_provider()
    // For O2, N2, H2, F2: H_f = 0, so μ°(0) = 0
    expect(provider.get_standard_chemical_potential(`O2`, 0)).toBe(0)
    expect(provider.get_standard_chemical_potential(`N2`, 0)).toBe(0)
    expect(provider.get_standard_chemical_potential(`H2`, 0)).toBe(0)

    // For CO, CO2, H2O: H_f ≠ 0
    const mu_CO = provider.get_standard_chemical_potential(`CO`, 0)
    const mu_CO2 = provider.get_standard_chemical_potential(`CO2`, 0)
    const mu_H2O = provider.get_standard_chemical_potential(`H2O`, 0)
    expect(mu_CO).toBeLessThan(0)
    expect(mu_CO2).toBeLessThan(0)
    expect(mu_H2O).toBeLessThan(0)
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

  test(`compute_element_chemical_potential converts per-atom-gas to per-atom-element`, () => {
    const T = 500
    const P = 0.21
    const mu_O2_per_atom = compute_gas_chemical_potential(provider, `O2`, T, P)
    const mu_O = compute_element_chemical_potential(provider, `O2`, `O`, T, P)

    // For O2: μ(O) = μ(O2)_per_atom * num_atoms(O2) / stoich(O in O2) = μ(O2)_per_atom * 2 / 2
    // So μ(O) = μ(O2)_per_atom for homonuclear diatomics
    expect(mu_O).toBeCloseTo(mu_O2_per_atom, 10)
  })

  test(`element chemical potential for multi-atom gases`, () => {
    const T = 500
    const P = 1.0
    const mu_H2O_per_atom = compute_gas_chemical_potential(provider, `H2O`, T, P)

    // H2O has 3 atoms total, 2 H atoms
    // μ(H from H2O) = μ(H2O)_per_atom * 3 / 2
    const mu_H = compute_element_chemical_potential(provider, `H2O`, `H`, T, P)
    expect(mu_H).toBeCloseTo((mu_H2O_per_atom * 3) / 2, 10)

    // H2O has 3 atoms total, 1 O atom
    // μ(O from H2O) = μ(H2O)_per_atom * 3 / 1
    const mu_O = compute_element_chemical_potential(provider, `H2O`, `O`, T, P)
    expect(mu_O).toBeCloseTo(mu_H2O_per_atom * 3, 10)
  })
})

describe(`gas-thermodynamics: analyze_gas_data`, () => {
  test(`returns no gas elements when config has no enabled gases`, () => {
    const entries = [make_entry({ Fe: 1, O: 2 })]
    const config: GasThermodynamicsConfig = {}
    const result = analyze_gas_data(entries, config)

    expect(result.has_gas_dependent_elements).toBe(false)
    expect(result.gas_elements).toEqual([])
    expect(result.relevant_gases).toEqual([])
  })

  test(`detects O from O2 when O2 is enabled`, () => {
    const entries = [make_entry({ Fe: 2, O: 3 })]
    const config: GasThermodynamicsConfig = { enabled_gases: [`O2`] }
    const result = analyze_gas_data(entries, config)

    expect(result.has_gas_dependent_elements).toBe(true)
    expect(result.gas_elements).toContain(`O`)
    expect(result.relevant_gases).toContain(`O2`)
  })

  test(`detects multiple gas elements`, () => {
    const entries = [make_entry({ Fe: 1, O: 1, N: 1 })]
    const config: GasThermodynamicsConfig = { enabled_gases: [`O2`, `N2`] }
    const result = analyze_gas_data(entries, config)

    expect(result.has_gas_dependent_elements).toBe(true)
    expect(result.gas_elements).toContain(`O`)
    expect(result.gas_elements).toContain(`N`)
    expect(result.relevant_gases).toContain(`O2`)
    expect(result.relevant_gases).toContain(`N2`)
  })

  test(`ignores elements not from enabled gases`, () => {
    const entries = [make_entry({ Fe: 1, O: 1 })]
    const config: GasThermodynamicsConfig = { enabled_gases: [`N2`] } // O2 not enabled
    const result = analyze_gas_data(entries, config)

    expect(result.has_gas_dependent_elements).toBe(false)
    expect(result.gas_elements).not.toContain(`O`)
  })

  test(`respects custom element_to_gas mapping`, () => {
    // Use Xe (xenon) as a custom element mapped to O2 for testing
    const entries = [make_entry({ Fe: 1, Xe: 1 })]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      element_to_gas: { Xe: `O2` }, // Custom: Xe comes from O2
    }
    const result = analyze_gas_data(entries, config)

    expect(result.gas_elements).toContain(`Xe`)
  })
})

describe(`gas-thermodynamics: get_effective_pressures`, () => {
  test(`returns defaults when no config pressures`, () => {
    const config: GasThermodynamicsConfig = {}
    const pressures = get_effective_pressures(config)

    expect(pressures.O2).toBe(DEFAULT_GAS_PRESSURES.O2)
    expect(pressures.N2).toBe(DEFAULT_GAS_PRESSURES.N2)
  })

  test(`overrides defaults with config pressures`, () => {
    const config: GasThermodynamicsConfig = {
      pressures: { O2: 0.5, N2: 0.1 },
    }
    const pressures = get_effective_pressures(config)

    expect(pressures.O2).toBe(0.5)
    expect(pressures.N2).toBe(0.1)
    expect(pressures.H2).toBe(DEFAULT_GAS_PRESSURES.H2) // Not overridden
  })

  test.each([
    [`negative`, -1],
    [`zero`, 0],
    [`NaN`, NaN],
    [`Infinity`, Infinity],
    [`-Infinity`, -Infinity],
  ])(`ignores %s pressure values`, (_, invalid_value) => {
    const config: GasThermodynamicsConfig = { pressures: { O2: invalid_value } }
    const pressures = get_effective_pressures(config)
    expect(pressures.O2).toBe(DEFAULT_GAS_PRESSURES.O2)
  })
})

describe(`gas-thermodynamics: apply_gas_corrections`, () => {
  test(`returns entries unchanged when no gas config`, () => {
    const entries = [make_entry({ Fe: 2, O: 3 }, -10)]
    const result = apply_gas_corrections(entries, undefined, 500)
    expect(result).toBe(entries)
  })

  test(`returns entries unchanged when no enabled gases`, () => {
    const entries = [make_entry({ Fe: 2, O: 3 }, -10)]
    const config: GasThermodynamicsConfig = { enabled_gases: [] }
    const result = apply_gas_corrections(entries, config, 500)
    expect(result).toBe(entries)
  })

  test(`only applies correction to unary (elemental) entries`, () => {
    const entries = [
      make_entry({ O: 1 }, 0), // Unary O - should be corrected
      make_entry({ Fe: 1 }, 0), // Unary Fe - no O, no correction
      make_entry({ Fe: 2, O: 3 }, -10), // Binary Fe2O3 - should NOT be corrected
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

  test(`leaves compound entries unchanged`, () => {
    const entries = [make_entry({ Fe: 1, O: 1 }, -5)] // FeO compound
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      pressures: { O2: 0.21 },
    }
    const result = apply_gas_corrections(entries, config, 500)

    expect(result).toHaveLength(1)
    expect(result[0].energy).toBe(-5) // Compound unchanged
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
    const entries = [make_entry({ O: 1 }, 0)]
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

  test.each([
    [0.21, /bar/, true],
    [1e-6, /e/, true],
    [1e5, /e/, true],
    [0.5, /e/, false],
    [10, /e/, false],
  ])(`format_pressure(%s) %s pattern`, (P, pattern, should_match) => {
    const result = format_pressure(P)
    expect(result).toMatch(/bar/)
    if (should_match) expect(result).toMatch(pattern)
    else expect(result).not.toMatch(pattern)
  })
})

describe(`gas-thermodynamics: multi-gas scenarios`, () => {
  test(`apply_gas_corrections applies to both O and N unary references`, () => {
    const entries = [make_entry({ O: 1 }), make_entry({ N: 1 }), make_entry({ Fe: 1 })]
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

  test(`quaternary system with multiple gas elements`, () => {
    const entries = [
      make_entry({ Fe: 1 }),
      make_entry({ O: 1 }),
      make_entry({ N: 1 }),
      make_entry({ H: 1 }),
      make_entry({ Fe: 0.5, O: 0.25, N: 0.25 }),
    ]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`, `N2`, `H2`],
    }
    const result = analyze_gas_data(entries, config)

    expect(result.gas_elements).toHaveLength(3)
    expect(result.gas_elements).toContain(`O`)
    expect(result.gas_elements).toContain(`N`)
    expect(result.gas_elements).toContain(`H`)
    expect(result.relevant_gases).toHaveLength(3)
  })
})

describe(`gas-thermodynamics: boundary pressures`, () => {
  const provider = get_default_gas_provider()

  // Slider range: 10^-10 to 10^2 bar
  const P_MIN = 1e-10
  const P_MAX = 1e2

  test(`chemical potential is finite at minimum pressure (10^-10 bar)`, () => {
    const mu = compute_gas_chemical_potential(provider, `O2`, 300, P_MIN)
    expect(Number.isFinite(mu)).toBe(true)
    // At very low pressure, μ should be strongly negative due to -RT*ln(P) term
    expect(mu).toBeLessThan(-0.5)
  })

  test(`chemical potential is finite at maximum pressure (10^2 bar)`, () => {
    const mu = compute_gas_chemical_potential(provider, `O2`, 300, P_MAX)
    expect(Number.isFinite(mu)).toBe(true)
    // At high pressure, μ should be less negative than at low pressure
    expect(mu).toBeGreaterThan(-0.5)
  })

  test(`monotonic increase in μ across full pressure range`, () => {
    const pressures = [1e-10, 1e-8, 1e-6, 1e-4, 1e-2, 1, 100]
    const mus = pressures.map((P) => compute_gas_chemical_potential(provider, `O2`, 500, P))
    // Each subsequent μ should be greater (less negative)
    for (let idx = 1; idx < mus.length; idx++) {
      expect(mus[idx]).toBeGreaterThan(mus[idx - 1])
    }
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
