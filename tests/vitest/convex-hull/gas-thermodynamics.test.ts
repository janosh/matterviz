import { BOLTZMANN_EV_PER_K } from '#lib/constants.js'
import {
  analyze_gas_data,
  apply_gas_corrections,
  compute_gas_chemical_potential,
  compute_element_mu_shift,
  compute_gas_correction,
  DEFAULT_ELEMENT_TO_GAS,
  format_chemical_potential,
  GAS_STOICHIOMETRY,
  gas_pressure_term,
  get_default_gas_provider,
  get_effective_pressures,
  P_REF,
} from '#lib/convex-hull/gas-thermodynamics.js'
import { filter_entries_at_temperature } from '#lib/convex-hull/helpers.js'
import { compute_hull_model } from '#lib/convex-hull/model.js'
import type { GasSpecies, GasThermodynamicsConfig, PhaseData } from '#lib/convex-hull/types.js'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from '#lib/convex-hull/types.js'
import type { ElementSymbol } from '#lib/element/index.js'
import { build_free_energy_model } from '#lib/phase-diagram/ternary/free-energy.js'
import { describe, expect, test } from 'vitest'
import { make_phase } from '../test-fixtures'

// pin the stoichiometry/gas-mapping tables: a typo here silently skews all corrections
test(`GAS_STOICHIOMETRY and DEFAULT_ELEMENT_TO_GAS hold the standard gas data`, () => {
  expect(GAS_STOICHIOMETRY).toEqual({
    O2: { O: 2 },
    N2: { N: 2 },
    H2: { H: 2 },
    F2: { F: 2 },
    CO: { C: 1, O: 1 },
    CO2: { C: 1, O: 2 },
    H2O: { H: 2, O: 1 },
  })
  expect(DEFAULT_ELEMENT_TO_GAS).toEqual({ O: `O2`, N: `N2`, H: `H2`, F: `F2`, C: `CO2` })
})

describe(`gas-thermodynamics: default provider`, () => {
  test(`get_default_gas_provider returns singleton supporting all gases at 0-2000K`, () => {
    const provider = get_default_gas_provider()
    expect(get_default_gas_provider()).toBe(provider)
    expect(provider.get_supported_gases()).toEqual([...GAS_SPECIES])
    expect(provider.get_temperature_range()).toEqual([0, 2000])
  })

  // μ°(T) = H_f - T*S: the formation enthalpy at 0 K (0 for elemental gases), falling with T
  test(`μ°(T=0) equals formation enthalpy and μ°(T) decreases with T`, () => {
    const provider = get_default_gas_provider()
    for (const gas of [`O2`, `N2`, `H2`] as const) {
      expect(provider.get_standard_chemical_potential(gas, 0)).toBe(0)
      const [mu_300, mu_600, mu_1000] = [300, 600, 1000].map((temp) =>
        provider.get_standard_chemical_potential(gas, temp),
      )
      expect(mu_600).toBeLessThan(mu_300)
      expect(mu_1000).toBeLessThan(mu_600)
    }
    for (const gas of [`CO`, `CO2`, `H2O`] as const) {
      expect(provider.get_standard_chemical_potential(gas, 0)).toBeLessThan(0)
    }
  })
})

describe(`gas-thermodynamics: chemical potential calculations`, () => {
  const provider = get_default_gas_provider()

  test(`compute_gas_chemical_potential at P=P_REF equals μ°(T)`, () => {
    const temperature = 500
    for (const gas of GAS_SPECIES) {
      const mu_standard = provider.get_standard_chemical_potential(gas, temperature)
      const mu_computed = compute_gas_chemical_potential(provider, gas, temperature, P_REF)
      expect(mu_computed).toBeCloseTo(mu_standard, 10)
    }
  })

  test(`RT*ln(P) contribution is correct (per-atom)`, () => {
    const temperature = 1000
    const pressure_2 = 0.1 // One order of magnitude below P_REF
    const mean = compute_gas_chemical_potential(provider, `O2`, temperature, pressure_2)
    const mu_ref = provider.get_standard_chemical_potential(`O2`, temperature)

    // μ_per_atom(T,P) - μ°_per_atom(T) = RT*ln(P/P_REF) / num_atoms
    // For O2, num_atoms = 2
    const expected_delta =
      (BOLTZMANN_EV_PER_K * temperature * Math.log(pressure_2 / P_REF)) / 2
    expect(mean - mu_ref).toBeCloseTo(expected_delta, 10)
    expect(gas_pressure_term(`O2`, temperature, pressure_2)).toBeCloseTo(expected_delta, 14)
    // per atom: a triatomic gas spreads the same molecular term over three atoms
    expect(gas_pressure_term(`CO2`, temperature, pressure_2)).toBeCloseTo(
      (expected_delta * 2) / 3,
      14,
    )
    expect(gas_pressure_term(`O2`, temperature, P_REF)).toBe(0)
  })
})

describe(`gas-thermodynamics: analyze_gas_data`, () => {
  test.each([
    [`no enabled gases`, { Fe: 1, O: 2 }, {}, [], []],
    [`O from enabled O2`, { Fe: 2, O: 3 }, { enabled_gases: [`O2`] }, [`O`], [`O2`]],
    [
      `multiple gas elements`,
      { Fe: 1, O: 1, N: 1 },
      { enabled_gases: [`O2`, `N2`] },
      [`O`, `N`],
      [`O2`, `N2`],
    ],
    [
      `elements not from enabled gases ignored`,
      { Fe: 1, O: 1 },
      { enabled_gases: [`N2`] },
      [],
      [],
    ],
    [
      `custom element_to_gas mapping (Xe from O2)`,
      { Fe: 1, Xe: 1 },
      { enabled_gases: [`O2`], element_to_gas: { Xe: `O2` } },
      [`Xe`],
      [`O2`],
    ],
    [
      `three gas elements in a quaternary`,
      { Fe: 0.5, O: 0.25, N: 0.25, H: 0.1 },
      { enabled_gases: [`O2`, `N2`, `H2`] },
      [`O`, `N`, `H`],
      [`O2`, `N2`, `H2`],
    ],
  ] as [string, Record<string, number>, GasThermodynamicsConfig, string[], GasSpecies[]][])(
    `%s`,
    (_label, composition, config, gas_elements, relevant_gases) => {
      const result = analyze_gas_data([make_phase(composition)], config)
      expect(result.has_gas_dependent_elements).toBe(gas_elements.length > 0)
      expect(result.gas_elements.toSorted()).toEqual(gas_elements.toSorted())
      expect(result.relevant_gases.toSorted()).toEqual(relevant_gases.toSorted())
    },
  )
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
})

describe(`gas-thermodynamics: apply_gas_corrections`, () => {
  test.each([
    [`no gas config`, undefined],
    [`no enabled gases`, { enabled_gases: [] }],
  ])(`returns the same entries array when %s`, (_label, config) => {
    const entries = [make_phase({ Fe: 2, O: 3 }, -2)]
    expect(apply_gas_corrections(entries, config, 500)).toBe(entries)
  })

  test(`only corrects unary references of enabled gases, each by its own -T*S at P_REF`, () => {
    const entries = [
      make_phase({ O: 1 }), // -T*S(O2, 500 K) per atom
      make_phase({ N: 1 }), // -T*S(N2, 500 K) per atom
      make_phase({ Fe: 1 }), // not a gas element
      make_phase({ Fe: 2, O: 3 }, -2), // compounds are never corrected
    ]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`, `N2`],
      pressures: { O2: 1, N2: 1 },
    }
    const result = apply_gas_corrections(entries, config, 500)
    expect(result.map((entry) => entry.energy)).toEqual([
      expect.closeTo(-0.5718, 4),
      expect.closeTo(-0.5356, 4),
      0,
      -10,
    ])
  })

  // Shifting the O reference changes every oxide's formation energy, but the oxides come back
  // untouched and their cached e_form_per_atom would make the gas correction a hull no-op.
  test(`a shifted reference clears formation energies cached against the old one`, () => {
    const entries: PhaseData[] = [
      { composition: { Fe: 1 }, energy: -8, energy_per_atom: -8, e_form_per_atom: 0 },
      { composition: { O: 2 }, energy: -10, energy_per_atom: -5, e_form_per_atom: 0 },
      {
        composition: { Fe: 2, O: 3 },
        energy: -34,
        energy_per_atom: -6.8,
        e_form_per_atom: -1.5, // against the uncorrected O reference
        e_above_hull: 0.1,
        is_stable: false,
      },
    ]
    const config: GasThermodynamicsConfig = {
      enabled_gases: [`O2`],
      pressures: { O2: 1e-10 },
    }

    const [iron, oxygen, oxide] = apply_gas_corrections(entries, config, 1000)

    expect(oxygen.energy_per_atom).not.toBeCloseTo(-5, 6) // the reference moved
    // so the oxide's cached hull data went with it, though its energy is untouched
    expect(oxide.energy_per_atom).toBe(-6.8)
    for (const key of [`e_form_per_atom`, `e_above_hull`, `is_stable`] as const) {
      expect(oxide[key], key).toBeUndefined()
    }
    // Fe contains no shifted element, so its own cache is still good
    expect(iron.e_form_per_atom).toBe(0)
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
    // lower pressure → lower chemical potential, by the per-atom RT ln(P) term
    const [low_p] = apply_gas_corrections(
      [entry],
      { ...config, pressures: { O2: 1e-3 } },
      1000,
    )
    expect(low_p.energy_per_atom).toBeCloseTo(
      -4.93 + correction + gas_pressure_term(`O2`, 1000, 1e-3),
      10,
    )
  })
})

// A tabulated O2 G(T) already holds -T*S, so the atmosphere only adds k_B T ln(p/p0); the full
// mu(T, p) - mu(0 K, 1 bar) shift counted the entropy twice: O at -7.4939 instead of -6.2316
// eV/atom and Li2O dG_f -1.1020 instead of -1.5228 = (1/3) * 1.2623 too high
test(`a tabulated O2 reference only gets the pressure term, matching the ternary model`, () => {
  const temperature = 1000
  const g_o2 = -4.9 - 1.2623 // G(1000 K) per atom: 0 K energy - T*S
  const tabulated = (composition: Record<string, number>, g_per_atom: number) =>
    make_phase(composition, -1, {
      entry_id: Object.keys(composition).join(``),
      temperatures: [300, temperature],
      free_energies: [-1, g_per_atom],
    })
  const entries = [
    tabulated({ Li: 1 }, -2.1),
    tabulated({ O: 2 }, g_o2),
    tabulated({ Li: 2, O: 1 }, -5),
  ]
  const gas_config: GasThermodynamicsConfig = {
    enabled_gases: [`O2`],
    pressures: { O2: 0.2 },
  }
  const at_temperature = filter_entries_at_temperature(entries, temperature)
  const corrected = apply_gas_corrections(at_temperature, gas_config, temperature)
  const o_ref = g_o2 + gas_pressure_term(`O2`, temperature, 0.2)
  expect(o_ref).toBeCloseTo(-6.2316, 4)
  expect(corrected[1].energy_per_atom).toBeCloseTo(o_ref, 12)
  const expected_dg = -5 - (2 / 3) * -2.1 - (1 / 3) * o_ref
  expect(expected_dg).toBeCloseTo(-1.5228, 4)
  const hull = compute_hull_model(corrected, { energy_source_mode: `on-the-fly` })
  const li2o = hull.entries.find((entry) => entry.entry_id === `LiO`)
  expect(li2o?.e_form_per_atom).toBeCloseTo(expected_dg, 12)
  const ternary = build_free_energy_model(entries, [`Li`, `O`], { gas_config })
  expect(ternary.phases[2].dg_form(temperature)).toBeCloseTo(expected_dg, 12)
})

describe(`gas-thermodynamics: multi-element gas reservoirs`, () => {
  const provider = get_default_gas_provider()
  const setup = (config: GasThermodynamicsConfig, temperature: number) => {
    const pressures = get_effective_pressures(config)
    const shift = (element: string) =>
      compute_element_mu_shift(element as ElementSymbol, config, temperature, pressures)
    // Δμ of a whole molecule at (T, P) relative to (0 K, 1 bar)
    const molecule_shift = (gas: GasSpecies) =>
      (compute_gas_chemical_potential(provider, gas, temperature, pressures[gas]) -
        provider.get_standard_chemical_potential(gas, 0)) *
      Object.values(GAS_STOICHIOMETRY[gas]).reduce((sum, count) => sum + count, 0)
    return { shift, molecule_shift }
  }

  // A gas fixes only the stoichiometric sum of its elements' shifts (Δμ_C + 2 Δμ_O = Δμ(CO2)):
  // a partner pinned by its own reservoir (O by O2) leaves the element the remainder
  test.each<[GasSpecies[], GasThermodynamicsConfig[`element_to_gas`], number]>([
    [[`O2`, `CO2`], {}, 1000],
    [[`CO2`], {}, 1000],
    [[`O2`, `H2O`], { H: `H2O` }, 800],
  ])(`sum rule holds for %o (%o) at %d K`, (enabled_gases, element_to_gas, temperature) => {
    const { shift, molecule_shift } = setup({ enabled_gases, element_to_gas }, temperature)
    for (const gas of enabled_gases) {
      const sum = Object.entries(GAS_STOICHIOMETRY[gas]).reduce(
        (acc, [element, count]) => acc + count * shift(element),
        0,
      )
      expect(sum).toBeCloseTo(molecule_shift(gas), 12)
    }
  })

  test.each([
    [`C`, { O: `CO2`, C: `CO2` }, /depend on each other/],
    [`N`, { N: `O2` }, /maps N to O2, which has no N/],
  ] as const)(`%s: rejects element_to_gas %o`, (element, element_to_gas, message) => {
    const { shift } = setup({ enabled_gases: [`O2`, `CO2`], element_to_gas }, 1000)
    expect(() => shift(element)).toThrow(message)
  })
})

describe(`gas-thermodynamics: formatting`, () => {
  // format_num renders the typographic minus (U+2212) and trims trailing zeros, so `decimals`
  // is a maximum, not a fixed width
  test.each([
    [-1.234, 3, `\u22121.234 eV`],
    [0.5, 3, `+0.5 eV`],
    [0, 3, `+0 eV`],
    [-1.23456, 2, `\u22121.23 eV`],
    [-1.23456, 4, `\u22121.2346 eV`],
  ])(`format_chemical_potential(%s, %s) = %s`, (mean, decimals, expected) => {
    expect(format_chemical_potential(mean, decimals)).toBe(expected)
  })
})

describe(`gas-thermodynamics: boundary pressures`, () => {
  const provider = get_default_gas_provider()

  // Slider range: 10^-10 to 10^2 bar
  const P_MIN = 1e-10
  const P_MAX = 1e2

  test(`μ is finite and increases monotonically from P_MIN to P_MAX`, () => {
    const pressures = [P_MIN, 1e-8, 1e-6, 1e-4, 1e-2, 1, P_MAX]
    const mus = pressures.map((pressure_2) =>
      compute_gas_chemical_potential(provider, `O2`, 300, pressure_2),
    )
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
  ])(
    `%s pressure: effective pressure keeps the default, μ falls back to P_REF`,
    (_, invalid_P) => {
      expect(get_effective_pressures({ pressures: { O2: invalid_P } }).O2).toBe(
        DEFAULT_GAS_PRESSURES.O2,
      )
      const mu_ref = compute_gas_chemical_potential(provider, `O2`, 300, P_REF)
      expect(compute_gas_chemical_potential(provider, `O2`, 300, invalid_P)).toBe(mu_ref)
    },
  )
})
