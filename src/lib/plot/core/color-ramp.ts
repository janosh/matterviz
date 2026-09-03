// Headless color-ramp helpers shared by ColorBar, HeatmapMatrix and PeriodicTable: turn a
// ColorBarScale into a data→color function and sample it evenly in scale space (linear,
// log or arcsinh spacing) for a CSS gradient.
import { get_d3_interpolator } from '$lib/colors'
import type { D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { create_scale, log_color_domain } from '$lib/plot/core/scales'
import type { ColorBarScale, ScaleType } from '$lib/plot/core/types'
import { get_scale_type_name } from '$lib/plot/core/types'
import { clamp01 } from '$lib/utils'
import { scaleLog } from 'd3-scale'

export interface ColorRamp {
  color_fn: (value: number) => string // data value -> color
  domain: Vec2 // data span the ramp covers, in the caller's bound order
}

// Scale for positioning colors and ticks along a ramp. Unlike create_scale's axis floor,
// log uses log_color_domain (keeps tiny positive bounds and their order).
export const color_ramp_scale = (scale_type: ScaleType, domain: Vec2, output: Vec2) => {
  if (get_scale_type_name(scale_type) !== `log`)
    return create_scale(scale_type, domain, output)
  return scaleLog().domain(log_color_domain(domain)).range(output)
}

// A bare interpolator function is not a ColorBarScale; wrap it.
export const to_color_bar_scale = (
  scale: D3InterpolateName | ((t: number) => string),
): ColorBarScale => (typeof scale === `string` ? scale : { interpolator: scale })

// A prebuilt `fn` scale maps data itself over the domain it declares (else `range`);
// interpolator names/functions are stretched across `range` with `scale_type` spacing
// (log floors non-positive bounds at LOG_EPS; equal bounds hit the midpoint). The low
// bound always maps to t=0, so a descending `range` samples high-to-low.
export const resolve_color_ramp = (
  scale: ColorBarScale,
  range: Vec2,
  scale_type: ScaleType = `linear`,
): ColorRamp => {
  if (typeof scale === `object` && `fn` in scale) {
    return { color_fn: scale.fn, domain: scale.domain ?? range }
  }
  const interpolator =
    typeof scale === `object` ? scale.interpolator : get_d3_interpolator(scale)
  const [lo, hi] = range[0] <= range[1] ? range : [range[1], range[0]]
  const position = color_ramp_scale(scale_type, [lo, hi], [0, 1])
  return { color_fn: (value) => interpolator(clamp01(position(value))), domain: range }
}

// `steps` colors at positions evenly spaced in scale space from domain[0] to domain[1]
export const sample_color_ramp = (
  { color_fn, domain }: ColorRamp,
  scale_type: ScaleType = `linear`,
  steps = 50,
): string[] => {
  const n_steps = Math.max(2, Math.floor(steps))
  const position = color_ramp_scale(scale_type, domain, [0, 1])
  return Array.from({ length: n_steps }, (_, idx) =>
    color_fn(position.invert(idx / (n_steps - 1))),
  )
}
