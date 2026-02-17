import { formula_key_from_composition } from '$lib/chempot-diagram/compute'
import {
  get_projection_source_entries,
  get_temp_filter_payload,
  get_valid_temperature,
} from '$lib/chempot-diagram/temperature'
import { CHEMPOT_DEFAULTS } from '$lib/chempot-diagram/types'
import type { PhaseData } from '$lib/convex-hull/types'
import { describe, expect, test } from 'vitest'

const temp_entries_fixture: PhaseData[] = [
  {
    composition: { Li: 1 },
    energy: -1,
    energy_per_atom: -1,
    temperatures: [300, 900],
    free_energies: [-1.2, -0.8],
  },
  {
    composition: { O: 1 },
    energy: -2,
    energy_per_atom: -2,
    temperatures: [700],
    free_energies: [-2.0],
  },
  {
    composition: { Li: 1, O: 1 },
    energy: -3.2,
    energy_per_atom: -1.6,
    temperatures: [700],
    free_energies: [-1.7],
  },
  {
    composition: { Li: 2, O: 1 },
    energy: -5.1,
    energy_per_atom: -1.7,
  },
]

const static_entries_fixture: PhaseData[] = [
  { composition: { Li: 1 }, energy: -1, energy_per_atom: -1 },
  { composition: { O: 1 }, energy: -2, energy_per_atom: -2 },
]

function has_formula(entries: PhaseData[], formula: string): boolean {
  return entries.some((entry) =>
    formula_key_from_composition(entry.composition) === formula
  )
}

function get_formula_entry(entries: PhaseData[], formula: string): PhaseData | undefined {
  return entries.find((entry) =>
    formula_key_from_composition(entry.composition) === formula
  )
}

function get_formula_set(entries: PhaseData[]): Set<string> {
  return new Set(entries.map((entry) => formula_key_from_composition(entry.composition)))
}

function get_payload_at_700(
  config: Parameters<typeof get_temp_filter_payload>[2] = {},
  props: Parameters<typeof get_temp_filter_payload>[3] = {},
) {
  return get_temp_filter_payload(temp_entries_fixture, 700, config, props)
}

describe(`get_temp_filter_payload`, () => {
  test(`returns no-temp analysis and original entries when dataset has no temperature data`, () => {
    const payload = get_temp_filter_payload(static_entries_fixture, 700, {}, {})
    expect(payload.has_temp_data).toBe(false)
    expect(payload.available_temperatures).toEqual([])
    expect(payload.temp_filtered_entries).toEqual(static_entries_fixture)
    expect(get_formula_set(payload.temp_filtered_entries)).toEqual(new Set([`Li`, `O`]))
  })

  test(`returns sorted unique available temperatures across all entries`, () => {
    const payload = get_payload_at_700()
    expect(payload.has_temp_data).toBe(true)
    expect(payload.available_temperatures).toEqual([300, 700, 900])
  })

  test(`does not filter when temperature is undefined`, () => {
    const payload = get_temp_filter_payload(temp_entries_fixture, undefined, {}, {})
    expect(payload.temp_filtered_entries).toEqual(temp_entries_fixture)
    expect(get_formula_set(payload.temp_filtered_entries)).toEqual(
      get_formula_set(temp_entries_fixture),
    )
  })

  test.each([
    {
      label: `config interpolate=false overrides props interpolate=true`,
      config: { interpolate_temperature: false, max_interpolation_gap: 1000 },
      props: { interpolate_temperature: true, max_interpolation_gap: 1000 },
      expect_li_included: false,
    },
    {
      label: `props interpolate=false applies when config unset`,
      config: {},
      props: { interpolate_temperature: false, max_interpolation_gap: 1000 },
      expect_li_included: false,
    },
    {
      label: `config interpolate=true overrides props interpolate=false`,
      config: { interpolate_temperature: true, max_interpolation_gap: 1000 },
      props: { interpolate_temperature: false, max_interpolation_gap: 1000 },
      expect_li_included: true,
    },
  ])(`$label`, ({ config, props, expect_li_included }) => {
    const payload = get_payload_at_700(config, props)
    expect(has_formula(payload.temp_filtered_entries, `Li`)).toBe(expect_li_included)
    // Guard against creating spurious formulas during temperature filtering/interpolation.
    expect(has_formula(payload.temp_filtered_entries, `LiO2`)).toBe(false)
  })

  test(`max_interpolation_gap uses config first, then props, then defaults`, () => {
    const config_overrides_props = get_payload_at_700(
      { interpolate_temperature: true, max_interpolation_gap: 500 },
      { interpolate_temperature: true, max_interpolation_gap: 1000 },
    )
    const props_used_when_config_unset = get_payload_at_700(
      { interpolate_temperature: true },
      { interpolate_temperature: true, max_interpolation_gap: 1000 },
    )
    const defaults_used_when_both_unset = get_payload_at_700()
    const explicit_defaults = get_payload_at_700({
      interpolate_temperature: CHEMPOT_DEFAULTS.interpolate_temperature,
      max_interpolation_gap: CHEMPOT_DEFAULTS.max_interpolation_gap,
    })

    expect(has_formula(config_overrides_props.temp_filtered_entries, `Li`)).toBe(false)
    expect(has_formula(props_used_when_config_unset.temp_filtered_entries, `Li`)).toBe(
      true,
    )
    expect(
      get_formula_set(defaults_used_when_both_unset.temp_filtered_entries),
    ).toEqual(
      get_formula_set(explicit_defaults.temp_filtered_entries),
    )
  })

  test.each([
    { formula: `Li`, expected_energy: -0.9333333333 },
    { formula: `O`, expected_energy: -2.0 },
    { formula: `LiO`, expected_energy: -1.7 },
  ])(`energy fields are synchronized for $formula`, ({ formula, expected_energy }) => {
    const payload = get_payload_at_700(
      { interpolate_temperature: true, max_interpolation_gap: 1000 },
      {},
    )
    const entry = get_formula_entry(payload.temp_filtered_entries, formula)
    expect(entry).toBeDefined()
    expect(entry?.energy).toBeCloseTo(expected_energy, 8)
    expect(entry?.energy_per_atom).toBeCloseTo(expected_energy, 8)
  })

  test(`entries without temperature arrays are preserved unchanged`, () => {
    const payload = get_payload_at_700()
    const li2o_entry = get_formula_entry(payload.temp_filtered_entries, `Li2O`)
    expect(li2o_entry).toBeDefined()
    expect(li2o_entry?.energy).toBeCloseTo(-5.1, 8)
    expect(li2o_entry?.energy_per_atom).toBeCloseTo(-1.7, 8)
  })
})

describe(`get_projection_source_entries`, () => {
  test.each([
    {
      label: `returns temperature-filtered entries when non-empty`,
      filtered_entries: [temp_entries_fixture[0]],
      expected_entries: [temp_entries_fixture[0]],
    },
    {
      label: `falls back to raw entries when temperature-filtered list is empty`,
      filtered_entries: [],
      expected_entries: temp_entries_fixture,
    },
  ])(`$label`, ({ filtered_entries, expected_entries }) => {
    const projection_entries = get_projection_source_entries(
      temp_entries_fixture,
      filtered_entries,
    )
    expect(projection_entries).toEqual(expected_entries)
  })
})

describe(`get_valid_temperature`, () => {
  const available_temperatures = [300, 700, 900]

  test.each([
    {
      label: `returns existing value when no temperature data exists`,
      temperature: 700,
      has_temp_data: false,
      expected_temperature: 700,
    },
    {
      label: `returns existing value when available temperatures are empty`,
      temperature: 700,
      has_temp_data: true,
      expected_temperature: 700,
      custom_temperatures: [],
    },
    {
      label: `returns existing value when temperature is available`,
      temperature: 700,
      has_temp_data: true,
      expected_temperature: 700,
    },
    {
      label: `falls back to first available temperature when value is undefined`,
      temperature: undefined,
      has_temp_data: true,
      expected_temperature: 300,
    },
    {
      label: `falls back to first available temperature when value is unavailable`,
      temperature: 500,
      has_temp_data: true,
      expected_temperature: 300,
    },
  ])(
    `$label`,
    ({
      temperature,
      has_temp_data,
      expected_temperature,
      custom_temperatures = available_temperatures,
    }) => {
      expect(
        get_valid_temperature(temperature, has_temp_data, custom_temperatures),
      ).toBe(expected_temperature)
    },
  )
})
