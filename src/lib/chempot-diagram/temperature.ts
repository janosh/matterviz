import {
  analyze_temperature_data,
  filter_entries_at_temperature,
} from '#lib/convex-hull/helpers.js'
import type { PhaseData } from '#lib/convex-hull/types.js'
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
