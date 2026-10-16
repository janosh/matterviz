// d3 color scheme names and the ColorScale data guard, kept free of Svelte modules so worker
// bundles (settings validation in parse workers) can import them
import * as d3_sc from 'd3-scale-chromatic'
import type { Vec2 } from '#lib/math.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import { is_plain_object } from '#lib/utils.js'

// Extract color scheme interpolate function names from d3-scale-chromatic
// Color scale names are always the prefixed d3 export name (`interpolateViridis`), which
// is what get_d3_interpolator, the settings defaults and every dropdown value use. Bare
// names are a display concern only -- strip the prefix at render time.
export type D3InterpolateName = keyof typeof d3_sc & `interpolate${string}`
const d3_interpolators = Object.fromEntries(
  Object.entries(d3_sc).filter(
    ([name, candidate]) => name.startsWith(`interpolate`) && typeof candidate === `function`,
  ),
) as Record<D3InterpolateName, (fraction: number) => string>
export const is_d3_interpolate_name = (name: string): name is D3InterpolateName =>
  Object.hasOwn(d3_interpolators, name)

const is_pair = (
  value: unknown,
  is_item: (item: unknown) => boolean,
): value is [unknown, unknown] =>
  Array.isArray(value) && value.length === 2 && value.every(is_item)
// A palette slice: two distinct fractions in [0, 1], descending to run the scheme backwards
export const is_palette_range = (value: unknown): value is Vec2 =>
  is_pair(value, (end) => typeof end === `number` && end >= 0 && end <= 1) &&
  value[0] !== value[1]
const is_scale_type = (type: unknown): boolean =>
  [`linear`, `log`, `arcsinh`, `time`].some((name) => name === type) ||
  (is_plain_object(type) &&
    type.type === `arcsinh` &&
    Object.keys(type).every((key) => key === `type` || key === `threshold`) &&
    (type.threshold === undefined ||
      (typeof type.threshold === `number` && type.threshold > 0)))

// A valid ColorScale (saved settings, VS Code settings.json, untyped props): a scheme name or
// a { type, scheme, value_range, palette_range } config whose scheme is a name or a function
export function is_color_scale(value: unknown): value is ColorScale {
  if (typeof value === `string`) return is_d3_interpolate_name(value)
  if (!is_plain_object(value)) return false
  const { type, scheme, value_range, palette_range, ...unknown_keys } = value
  return (
    Object.keys(unknown_keys).length === 0 &&
    (type === undefined || is_scale_type(type)) &&
    (scheme === undefined ||
      typeof scheme === `function` ||
      (typeof scheme === `string` && is_d3_interpolate_name(scheme))) &&
    (value_range === undefined ||
      is_pair(value_range, (end) => end === null || Number.isFinite(end))) &&
    (palette_range === undefined || is_palette_range(palette_range))
  )
}
export const get_d3_interpolator = (
  name: D3InterpolateName,
): ((fraction: number) => string) => {
  const interpolator = d3_interpolators[name]
  if (!interpolator) throw new Error(`Unknown D3 color interpolator: ${name}`)
  return interpolator
}
