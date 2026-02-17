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

interface ResolvedTempFilterOptions {
  interpolate: boolean
  max_interpolation_gap: number
}

export interface TempFilterPayload {
  has_temp_data: boolean
  available_temperatures: number[]
  temp_filtered_entries: PhaseData[]
}

export function get_projection_source_entries(
  entries: PhaseData[],
  temp_filtered_entries: PhaseData[],
): PhaseData[] {
  return temp_filtered_entries.length > 0 ? temp_filtered_entries : entries
}

function resolve_temp_filter_options(
  config: ChemPotDiagramConfig,
  props: TempFilterProps,
): ResolvedTempFilterOptions {
  return {
    interpolate: config.interpolate_temperature ?? props.interpolate_temperature ??
      CHEMPOT_DEFAULTS.interpolate_temperature,
    max_interpolation_gap: config.max_interpolation_gap ??
      props.max_interpolation_gap ??
      CHEMPOT_DEFAULTS.max_interpolation_gap,
  }
}

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
  const filter_options = resolve_temp_filter_options(config, props)
  const temp_filtered_entries = filter_entries_at_temperature(
    entries,
    temperature,
    filter_options,
  )
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
