import {
  analyze_temperature_data,
  filter_entries_at_temperature,
} from '$lib/convex-hull/helpers'
import type { PhaseData } from '$lib/convex-hull/types'
import type { ChemPotDiagramConfig } from './types'
import { CHEMPOT_DEFAULTS } from './types'

interface TempFilterProps {
  interpolate_temperature?: boolean
  max_interpolation_gap?: number
}

export interface TempFilterPayload {
  has_temp_data: boolean
  available_temperatures: number[]
  temp_filtered_entries: PhaseData[]
}

export const get_projection_source_entries = (
  entries: PhaseData[],
  temp_filtered_entries: PhaseData[],
): PhaseData[] => (temp_filtered_entries.length > 0 ? temp_filtered_entries : entries)

export function get_temp_filter_payload(
  entries: PhaseData[],
  temperature: number | undefined,
  config: ChemPotDiagramConfig,
  props: TempFilterProps,
): TempFilterPayload {
  const { has_temp_data, available_temperatures } = analyze_temperature_data(entries)
  if (!has_temp_data || temperature === undefined) {
    return { has_temp_data, available_temperatures, temp_filtered_entries: entries }
  }
  // Option resolution order: config beats props beats defaults
  const temp_filtered_entries = filter_entries_at_temperature(entries, temperature, {
    interpolate:
      config.interpolate_temperature ??
      props.interpolate_temperature ??
      CHEMPOT_DEFAULTS.interpolate_temperature,
    max_interpolation_gap:
      config.max_interpolation_gap ??
      props.max_interpolation_gap ??
      CHEMPOT_DEFAULTS.max_interpolation_gap,
  })
  return { has_temp_data, available_temperatures, temp_filtered_entries }
}

export function get_valid_temperature(
  temperature: number | undefined,
  has_temp_data: boolean,
  available_temperatures: number[],
): number | undefined {
  if (!has_temp_data || available_temperatures.length === 0) return temperature
  const min_temperature = available_temperatures[0]
  const max_temperature = available_temperatures.at(-1) ?? min_temperature
  if (temperature === undefined) return min_temperature
  if (available_temperatures.includes(temperature)) return temperature
  if (temperature >= min_temperature && temperature <= max_temperature) {
    return temperature
  }
  return min_temperature
}
