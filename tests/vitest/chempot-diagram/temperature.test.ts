import { formula_key_from_composition } from '$lib/chempot-diagram/compute'
import {
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

const has_formula = (entries: PhaseData[], formula: string): boolean =>
  entries.some((entry) => formula_key_from_composition(entry.composition) === formula)

const get_formula_entry = (entries: PhaseData[], formula: string): PhaseData | undefined =>
  entries.find((entry) => formula_key_from_composition(entry.composition) === formula)

const get_formula_set = (entries: PhaseData[]): Set<string> =>
  new Set(entries.map((entry) => formula_key_from_composition(entry.composition)))

const get_payload_at_700 = (config: Parameters<typeof get_temp_filter_payload>[2] = {}) =>
  get_temp_filter_payload(temp_entries_fixture, 700, config)

describe(`get_temp_filter_payload`, () => {
  test(`returns no-temp analysis and original entries when dataset has no temperature data`, () => {
    const payload = get_temp_filter_payload(static_entries_fixture, 700, {})
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
    const payload = get_temp_filter_payload(temp_entries_fixture, undefined, {})
    expect(payload.temp_filtered_entries).toEqual(temp_entries_fixture)
    expect(get_formula_set(payload.temp_filtered_entries)).toEqual(
      get_formula_set(temp_entries_fixture),
    )
  })

  // Li's bracket around 700 K spans 300 -> 900 K, i.e. a 600 K gap: it survives only by
  // interpolation across a gap at least that wide
  test.each([
    { config: { interpolate_temperature: false, max_interpolation_gap: 1000 }, li: false },
    { config: { interpolate_temperature: true, max_interpolation_gap: 599 }, li: false },
    { config: { interpolate_temperature: true, max_interpolation_gap: 600 }, li: true }, // inclusive
    { config: { interpolate_temperature: true, max_interpolation_gap: 1000 }, li: true },
  ])(`$config keeps Li: $li`, ({ config, li }) => {
    const payload = get_payload_at_700(config)
    expect(has_formula(payload.temp_filtered_entries, `Li`)).toBe(li)
    // Guard against creating spurious formulas during temperature filtering/interpolation.
    expect(has_formula(payload.temp_filtered_entries, `LiO2`)).toBe(false)
  })

  test(`unset config keys fall back to CHEMPOT_DEFAULTS`, () => {
    const defaults_used = get_payload_at_700()
    const explicit_defaults = get_payload_at_700({
      interpolate_temperature: CHEMPOT_DEFAULTS.interpolate_temperature,
      max_interpolation_gap: CHEMPOT_DEFAULTS.max_interpolation_gap,
    })
    expect(get_formula_set(defaults_used.temp_filtered_entries)).toEqual(
      get_formula_set(explicit_defaults.temp_filtered_entries),
    )
  })

  // filter_entries_at_temperature writes the per-atom G(T) into energy_per_atom and the
  // total into energy; entries without temperature arrays (Li2O) are preserved unchanged
  test.each([
    { formula: `Li`, energy: -0.9333333333, energy_per_atom: -0.9333333333 },
    { formula: `O`, energy: -2.0, energy_per_atom: -2.0 },
    { formula: `LiO`, energy: -3.4, energy_per_atom: -1.7 },
    { formula: `Li2O`, energy: -5.1, energy_per_atom: -1.7 },
  ])(`energy fields at 700 K for $formula`, ({ formula, energy, energy_per_atom }) => {
    const payload = get_payload_at_700({
      interpolate_temperature: true,
      max_interpolation_gap: 1000,
    })
    const entry = get_formula_entry(payload.temp_filtered_entries, formula)
    expect(entry).toBeDefined()
    expect(entry?.energy).toBeCloseTo(energy, 8)
    expect(entry?.energy_per_atom).toBeCloseTo(energy_per_atom, 8)
  })
})

describe(`get_valid_temperature`, () => {
  const available_temperatures = [300, 700, 900]

  test.each([
    {
      label: `returns existing value when no temperature data exists`,
      temperature: 700,
      available: [],
      expected_temperature: 700,
    },
    {
      label: `returns existing value when temperature is available`,
      temperature: 700,
      available: available_temperatures,
      expected_temperature: 700,
    },
    {
      label: `falls back to first available temperature when value is undefined`,
      temperature: undefined,
      available: available_temperatures,
      expected_temperature: 300,
    },
    {
      label: `keeps non-exact temperature inside available range`,
      temperature: 500,
      available: available_temperatures,
      expected_temperature: 500,
    },
    {
      label: `falls back to first available temperature when value is out of range`,
      temperature: 1200,
      available: available_temperatures,
      expected_temperature: 300,
    },
  ])(`$label`, ({ temperature, available, expected_temperature }) => {
    expect(get_valid_temperature(temperature, available)).toBe(expected_temperature)
  })
})
