import {
  analyze_temperature_data,
  filter_entries_at_temperature,
} from '$lib/convex-hull/helpers'
import type { PhaseData } from '$lib/convex-hull/types'
import { CHEMPOT_DEFAULTS, type ChemPotDiagramConfig } from './types'

interface TempFilterPayload {
  has_temp_data: boolean
  available_temperatures: number[]
  temp_filtered_entries: PhaseData[]
}

// Entries evaluated at `temperature` (interpolated per config) when the dataset carries G(T)
// tables and a temperature is set; otherwise the entries unchanged
export function get_temp_filter_payload(
  entries: PhaseData[],
  temperature: number | undefined,
  config: ChemPotDiagramConfig,
): TempFilterPayload {
  const { has_temp_data, available_temperatures } = analyze_temperature_data(entries)
  const temp_filtered_entries =
    has_temp_data && temperature !== undefined
      ? filter_entries_at_temperature(entries, temperature, {
          interpolate:
            config.interpolate_temperature ?? CHEMPOT_DEFAULTS.interpolate_temperature,
          max_interpolation_gap:
            config.max_interpolation_gap ?? CHEMPOT_DEFAULTS.max_interpolation_gap,
        })
      : entries
  return { has_temp_data, available_temperatures, temp_filtered_entries }
}

// Keep a bound temperature inside the data: with no temperature data it is left alone, an
// unset or out-of-range value snaps to the lowest sampled temperature, anything in range
// (sampled or interpolated) stays
export function get_valid_temperature(
  temperature: number | undefined,
  available_temperatures: number[],
): number | undefined {
  if (available_temperatures.length === 0) return temperature
  const min_temperature = available_temperatures[0]
  const max_temperature = available_temperatures.at(-1) ?? min_temperature
  if (temperature === undefined) return min_temperature
  return temperature >= min_temperature && temperature <= max_temperature
    ? temperature
    : min_temperature
}
