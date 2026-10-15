// Headless color-ramp helpers shared by ColorBar, HeatmapMatrix, PeriodicTable and
// TernaryPlot: position colors and ticks along a ramp and sample it evenly in scale space
// (linear, log or arcsinh spacing) for a CSS gradient.
import type { Vec2 } from '#lib/math.js'
import {
  color_interpolator,
  create_scale,
  log_color_domain,
  to_color_scale_config,
} from '#lib/plot/core/scales.js'
import type { ColorScale, ColorScaleConfig, ScaleType } from '#lib/plot/core/types.js'
import { get_scale_type_name } from '#lib/plot/core/types.js'
import { clamp01 } from '#lib/utils.js'
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

// Value -> color along a ramp over `range` (positions from color_ramp_scale, clamped to the
// ends), plus the ColorBar color_scale drawing the same colors. The lower bound always takes
// the palette start, so a descending range only flips the bar: its bar_scale reverses
// palette_range too, as ColorBar maps value_range[0] to the palette start.
export const resolve_color_ramp = (
  color_scale: ColorScale,
  range: Vec2,
): { color_fn: (value: number) => string; bar_scale: ColorScaleConfig } => {
  const config = to_color_scale_config(color_scale)
  const [start, end] = range
  const [palette_start, palette_end] = config.palette_range ?? [0, 1]
  const descending = start > end
  const position = color_ramp_scale(
    config.type ?? `linear`,
    descending ? [end, start] : range,
    [0, 1],
  )
  const interpolate = color_interpolator(config)
  return {
    color_fn: (value) => interpolate(clamp01(position(value))),
    bar_scale: {
      ...config,
      value_range: range,
      palette_range: descending ? [palette_end, palette_start] : [palette_start, palette_end],
    },
  }
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
