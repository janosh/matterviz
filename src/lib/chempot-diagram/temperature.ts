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

// Last payload per entries array: grid panes share the parent's entries and temperature, so
// they share one filtered array too (and with it get_formula_color_data's memo)
const payload_memo = new WeakMap<PhaseData[], { key: string; payload: TempFilterPayload }>()

// Entries evaluated at `temperature` (interpolated per config) when the dataset carries G(T)
// tables and a temperature is set; otherwise the entries unchanged
export function get_temp_filter_payload(
  entries: PhaseData[],
  temperature: number | undefined,
  config: ChemPotDiagramConfig,
): TempFilterPayload {
  const interpolate =
    config.interpolate_temperature ?? CHEMPOT_DEFAULTS.interpolate_temperature
  const max_interpolation_gap =
    config.max_interpolation_gap ?? CHEMPOT_DEFAULTS.max_interpolation_gap
  // a template, not JSON.stringify: that writes an Infinity gap (no limit) as null
  const key = `${temperature}|${interpolate}|${max_interpolation_gap}`
  const memo = payload_memo.get(entries)
  if (memo?.key === key) return memo.payload
  const { has_temp_data, available_temperatures } = analyze_temperature_data(entries)
  const temp_filtered_entries =
    has_temp_data && temperature !== undefined
      ? filter_entries_at_temperature(entries, temperature, {
          interpolate,
          max_interpolation_gap,
        })
      : entries
  const payload = { has_temp_data, available_temperatures, temp_filtered_entries }
  payload_memo.set(entries, { key, payload })
  return payload
}
