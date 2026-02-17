import {
  analyze_temperature_data,
  filter_entries_at_temperature,
} from '$lib/convex-hull/helpers'
import type { PhaseData } from '$lib/convex-hull/types'
import { CHEMPOT_DEFAULTS } from './types'
import type { ChemPotDiagramConfig } from './types'

interface Temp_control_props {
  interpolate_temperature?: boolean
  max_interpolation_gap?: number
}

interface Resolved_temp_filter_options {
  interpolate: boolean
  max_interpolation_gap: number
}

export interface Temp_filter_payload {
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
  props: Temp_control_props,
): Resolved_temp_filter_options {
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
  props: Temp_control_props,
): Temp_filter_payload {
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
  if (temperature !== undefined && available_temperatures.includes(temperature)) {
    return temperature
  }
  return available_temperatures[0]
}
