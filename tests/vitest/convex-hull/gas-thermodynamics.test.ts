import type { GasSpecies, GasThermodynamicsConfig, PhaseData } from '$lib/convex-hull/types'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from '$lib/convex-hull/types'
import {
  analyze_gas_data,
  apply_gas_corrections,
  compute_element_chemical_potential,
  compute_gas_chemical_potential,
  create_default_gas_provider,
  DEFAULT_ELEMENT_TO_GAS,
  format_chemical_potential,
  format_pressure,
  GAS_STOICHIOMETRY,
  get_default_gas_provider,
  get_effective_pressures,
  P_REF,
  R_EV_PER_K,
} from '$lib/convex-hull/gas-thermodynamics'
import { describe, expect, test } from 'vitest'

describe(`gas-thermodynamics: constants`, () => {
  test(`R_EV_PER_K is the Boltzmann constant in eV/K`, () => {
    // k_B ≈ 8.617e-5 eV/K
    expect(R_EV_PER_K).toBeCloseTo(8.617333262e-5, 10)
  })

  test(`P_REF is 1 bar`, () => {
    expect(P_REF).toBe(1.0)
  })

  test(`GAS_SPECIES contains all expected gases`, () => {
    expect(GAS_SPECIES).toContain(`O2`)
    expect(GAS_SPECIES).toContain(`N2`)
    expect(GAS_SPECIES).toContain(`H2`)
    expect(GAS_SPECIES).toContain(`CO`)
    expect(GAS_SPECIES).toContain(`CO2`)
    expect(GAS_SPECIES).toContain(`H2O`)
    expect(GAS_SPECIES).toContain(`F2`)
    expect(GAS_SPECIES).toHaveLength(7)
  })

  test(`GAS_STOICHIOMETRY has correct atom counts`, () => {
    expect(GAS_STOICHIOMETRY.O2.O).toBe(2)
    expect(GAS_STOICHIOMETRY.N2.N).toBe(2)
    expect(GAS_STOICHIOMETRY.H2.H).toBe(2)
    expect(GAS_STOICHIOMETRY.CO.C).toBe(1)
    expect(GAS_STOICHIOMETRY.CO.O).toBe(1)
    expect(GAS_STOICHIOMETRY.CO2.C).toBe(1)
    expect(GAS_STOICHIOMETRY.CO2.O).toBe(2)
    expect(GAS_STOICHIOMETRY.H2O.H).toBe(2)
    expect(GAS_STOICHIOMETRY.H2O.O).toBe(1)
    expect(GAS_STOICHIOMETRY.F2.F).toBe(2)
  })

  test(`DEFAULT_ELEMENT_TO_GAS maps common elements correctly`, () => {
    expect(DEFAULT_ELEMENT_TO_GAS.O).toBe(`O2`)
    expect(DEFAULT_ELEMENT_TO_GAS.N).toBe(`N2`)
    expect(DEFAULT_ELEMENT_TO_GAS.H).toBe(`H2`)
    expect(DEFAULT_ELEMENT_TO_GAS.F).toBe(`F2`)
    expect(DEFAULT_ELEMENT_TO_GAS.C).toBe(`CO2`)
  })

  test(`DEFAULT_GAS_PRESSURES has reasonable atmospheric values`, () => {
    expect(DEFAULT_GAS_PRESSURES.O2).toBeCloseTo(0.21, 2)
    expect(DEFAULT_GAS_PRESSURES.N2).toBeCloseTo(0.78, 2)
    expect(DEFAULT_GAS_PRESSURES.CO2).toBeLessThan(0.001) // ~400 ppm
  })
})

describe(`gas-thermodynamics: default provider`, () => {
  test(`create_default_gas_provider returns a valid provider`, () => {
    const provider = create_default_gas_provider()
    expect(provider).toBeDefined()
    expect(typeof provider.get_standard_chemical_potential).toBe(`function`)
    expect(typeof provider.get_supported_gases).toBe(`function`)
    expect(typeof provider.get_temperature_range).toBe(`function`)
  })

  test(`get_default_gas_provider returns singleton`, () => {
    const p1 = get_default_gas_provider()
    const p2 = get_default_gas_provider()
    expect(p1).toBe(p2)
  })

  test(`provider returns all gas species as supported`, () => {
    const provider = get_default_gas_provider()
    const supported = provider.get_supported_gases()
    expect(supported).toEqual(expect.arrayContaining([...GAS_SPECIES]))
  })

  test(`provider temperature range is 0-2000K`, () => {
    const provider = get_default_gas_provider()
    const [T_min, T_max] = provider.get_temperature_range()
    expect(T_min).toBe(0)
    expect(T_max).toBe(2000)
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

  test(`pressure dependence: μ increases with P`, () => {
    const T = 500
    const mu_low = compute_gas_chemical_potential(provider, `O2`, T, 0.01)
    const mu_atm = compute_gas_chemical_potential(provider, `O2`, T, 0.21)
    const mu_high = compute_gas_chemical_potential(provider, `O2`, T, 1.0)

    expect(mu_atm).toBeGreaterThan(mu_low)
    expect(mu_high).toBeGreaterThan(mu_atm)
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
  const make_entry = (comp: Record<string, number>): PhaseData => ({
    composition: comp,
    energy: 0,
  })

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
    const entries = [make_entry({ Fe: 1, X: 1 })]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      element_to_gas: { X: `O2` }, // Custom: X comes from O2
    }
    const result = analyze_gas_data(entries, config)

    expect(result.gas_elements).toContain(`X`)
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

  test(`ignores invalid pressure values`, () => {
    const config: GasThermodynamicsConfig = {
      pressures: { O2: -1, N2: 0 },
    }
    const pressures = get_effective_pressures(config)

    expect(pressures.O2).toBe(DEFAULT_GAS_PRESSURES.O2) // Invalid, use default
    expect(pressures.N2).toBe(DEFAULT_GAS_PRESSURES.N2) // Zero is invalid
  })
})

describe(`gas-thermodynamics: apply_gas_corrections`, () => {
  const make_entry = (
    comp: Record<string, number>,
    energy: number,
  ): PhaseData => ({
    composition: comp,
    energy,
  })

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
  test(`format_chemical_potential includes sign and units`, () => {
    expect(format_chemical_potential(-1.234)).toBe(`-1.234 eV`)
    expect(format_chemical_potential(0.5)).toBe(`+0.500 eV`)
    expect(format_chemical_potential(0)).toBe(`+0.000 eV`)
  })

  test(`format_chemical_potential respects decimals`, () => {
    expect(format_chemical_potential(-1.23456, 2)).toBe(`-1.23 eV`)
    expect(format_chemical_potential(-1.23456, 4)).toBe(`-1.2346 eV`)
  })

  test(`format_pressure uses bar units`, () => {
    expect(format_pressure(0.21)).toMatch(/bar/)
    expect(format_pressure(1.0)).toMatch(/bar/)
  })

  test(`format_pressure uses scientific notation for extreme values`, () => {
    expect(format_pressure(1e-6)).toMatch(/e/)
    expect(format_pressure(1e5)).toMatch(/e/)
  })

  test(`format_pressure uses decimal for normal range`, () => {
    expect(format_pressure(0.5)).not.toMatch(/e/)
    expect(format_pressure(10)).not.toMatch(/e/)
  })
})
