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
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return null
  let lo = finite[0]
  let hi_raw = finite[0]
  for (let idx = 1; idx < finite.length; idx++) {
    if (finite[idx] < lo) lo = finite[idx]
    if (finite[idx] > hi_raw) hi_raw = finite[idx]
  }
  const hi = Math.max(hi_raw, lo + 1e-6)
  return scaleSequential(get_chempot_interpolator(interpolator_name, reverse)).domain([
    lo,
    hi,
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
