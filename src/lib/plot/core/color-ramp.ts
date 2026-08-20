// Headless color-ramp helpers shared by ColorBar and legend swatches: turn a
// ColorBarScale into a data→color function, sample it evenly in scale space (linear, log
// or arcsinh spacing) and emit the CSS gradient for a swatch or bar.
import { get_d3_interpolator } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { create_scale } from '$lib/plot/core/scales'
import type { ColorBarScale, ScaleType } from '$lib/plot/core/types'
import { clamp01 } from '$lib/utils'

export interface ColorRamp {
  color_fn: (value: number) => string // data value -> color
  domain: Vec2 // ascending data span the ramp covers
}

const ascending = ([start, end]: Vec2): Vec2 => (start <= end ? [start, end] : [end, start])

// A prebuilt `fn` scale maps data itself over the domain it declares (else `range`);
// interpolator names/functions are stretched across `range` with `scale_type` spacing
// (log clamps non-positive bounds like every other log axis; equal bounds hit the midpoint).
// A descending `range` keeps its order in `domain`, so the ramp samples high-to-low.
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
  const position = create_scale(scale_type, ascending(range), [0, 1])
  return { color_fn: (value) => interpolator(clamp01(position(value))), domain: range }
}

// `steps` colors at positions evenly spaced in scale space from domain[0] to domain[1]
export const sample_color_ramp = (
  { color_fn, domain }: ColorRamp,
  scale_type: ScaleType = `linear`,
  steps = 50,
): string[] => {
  const n_steps = Math.max(2, Math.floor(steps))
  const position = create_scale(scale_type, ascending(domain), [0, 1])
  const colors = Array.from({ length: n_steps }, (_, idx) =>
    color_fn(position.invert(idx / (n_steps - 1))),
  )
  return domain[0] <= domain[1] ? colors : colors.toReversed()
}

export const color_ramp_gradient = (
  colors: readonly string[],
  direction: `to right` | `to left` | `to top` | `to bottom` = `to right`,
): string => `linear-gradient(${direction}, ${colors.join(`, `)})`
