import { type D3InterpolateName, get_d3_interpolator } from '$lib/colors'
import { scaleSequential } from 'd3-scale'

/** Resolve D3 interpolator with optional reverse for chempot color scales. */
export function get_chempot_interpolator(
  name: D3InterpolateName,
  reverse: boolean,
): (t: number) => string {
  const raw = get_d3_interpolator(name)
  return reverse ? (t: number) => raw(1 - t) : raw
}

/** Build sequential color scale from values and D3 interpolator name. */
export function make_chempot_color_scale(
  values: number[],
  interpolator_name: D3InterpolateName,
  reverse: boolean,
): ((val: number) => string) | null {
  const finite_values = values.filter(Number.isFinite)
  if (finite_values.length === 0) return null
  let min_value = finite_values[0]
  let max_raw_value = finite_values[0]
  for (let idx = 1; idx < finite_values.length; idx++) {
    if (finite_values[idx] < min_value) min_value = finite_values[idx]
    if (finite_values[idx] > max_raw_value) max_raw_value = finite_values[idx]
  }
  const max_value = Math.max(max_raw_value, min_value + 1e-6)
  return scaleSequential(get_chempot_interpolator(interpolator_name, reverse)).domain([
    min_value,
    max_value,
  ])
}

/** Resolve color bar props for chempot diagrams (interpolator + domain). */
export function get_chempot_color_bar_config(
  color_scale: D3InterpolateName,
  reverse: boolean,
): { color_scale_fn: (t: number) => string; color_scale_domain: [number, number] } {
  return {
    color_scale_fn: get_chempot_interpolator(color_scale, reverse),
    color_scale_domain: [0, 1],
  }
}
