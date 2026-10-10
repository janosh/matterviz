import { formula_key_from_composition } from '#lib/chempot-diagram/compute.js'
import {
  get_temp_filter_payload,
  get_valid_temperature,
} from '#lib/chempot-diagram/temperature.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
import { describe, expect, test } from 'vitest'
import { make_phase } from '../test-fixtures'

const temp_entries_fixture = [
  make_phase({ Li: 1 }, -1, { temperatures: [300, 900], free_energies: [-1.2, -0.8] }),
  make_phase({ O: 1 }, -2, { temperatures: [700], free_energies: [-2.0] }),
  make_phase({ Li: 1, O: 1 }, -1.6, { temperatures: [700], free_energies: [-1.7] }),
  make_phase({ Li: 2, O: 1 }, -1.7),
]
const static_entries_fixture = [make_phase({ Li: 1 }, -1), make_phase({ O: 1 }, -2)]

const has_formula = (entries: PhaseData[], formula: string): boolean =>
  entries.some((entry) => formula_key_from_composition(entry.composition) === formula)

const get_formula_entry = (entries: PhaseData[], formula: string): PhaseData | undefined =>
  entries.find((entry) => formula_key_from_composition(entry.composition) === formula)

const get_payload_at_700 = (config: Parameters<typeof get_temp_filter_payload>[2] = {}) =>
  get_temp_filter_payload(temp_entries_fixture, 700, config)

describe(`get_temp_filter_payload`, () => {
  test(`without temperature data or a temperature, entries pass through unfiltered`, () => {
    const static_payload = get_temp_filter_payload(static_entries_fixture, 700, {})
    expect(static_payload.has_temp_data).toBe(false)
    expect(static_payload.available_temperatures).toEqual([])
    expect(static_payload.temp_filtered_entries).toEqual(static_entries_fixture)

    const payload = get_temp_filter_payload(temp_entries_fixture, undefined, {})
    expect(payload.has_temp_data).toBe(true)
    expect(payload.available_temperatures).toEqual([300, 700, 900]) // sorted, unique
    expect(payload.temp_filtered_entries).toEqual(temp_entries_fixture)
  })

  // Li's bracket around 700 K spans 300 -> 900 K, i.e. a 600 K gap: it survives only by
  // interpolation across a gap at least that wide
  test.each([
    { config: { interpolate_temperature: false, max_interpolation_gap: 1000 }, li: false },
    { config: { interpolate_temperature: true, max_interpolation_gap: 599 }, li: false },
    { config: { interpolate_temperature: true, max_interpolation_gap: 600 }, li: true }, // inclusive
    { config: { interpolate_temperature: true, max_interpolation_gap: 1000 }, li: true },
    // unset keys fall back to CHEMPOT_DEFAULTS (interpolate across at most 500 K < 600 K)
    { config: {}, li: false },
  ])(`$config keeps Li: $li`, ({ config, li: lithium }) => {
    const payload = get_payload_at_700(config)
    expect(has_formula(payload.temp_filtered_entries, `Li`)).toBe(lithium)
    // Guard against creating spurious formulas during temperature filtering/interpolation.
    expect(has_formula(payload.temp_filtered_entries, `LiO2`)).toBe(false)
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
    expect(entry).toMatchObject({
      energy: expect.closeTo(energy, 8),
      energy_per_atom: expect.closeTo(energy_per_atom, 8),
    })
  })
})

describe(`get_valid_temperature`, () => {
  const available = [300, 700, 900]
  test.each([
    [`keeps the value when there is no temperature data`, 700, [], 700],
    [`keeps an available value`, 700, available, 700],
    [`falls back to the first available temperature for undefined`, undefined, available, 300],
    [`keeps a non-exact value inside the available range`, 500, available, 500],
    [`falls back to the first available temperature out of range`, 1200, available, 300],
  ] as [string, number | undefined, number[], number][])(
    `%s`,
    (_label, temp, temps, expected) => {
      expect(get_valid_temperature(temp, temps)).toBe(expected)
    },
  )
})
