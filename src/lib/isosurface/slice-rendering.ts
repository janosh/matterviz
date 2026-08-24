import type { D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { rgb } from 'd3-color'
import type { ColorRangeSymmetry } from './coloring'
import { build_colormap_lut, COLORMAP_LUT_SIZE, fit_color_range } from './coloring'
import type { SliceResult } from './slice'

export type VolumeSliceMode = `both` | `contours` | `filled`

const MAX_CONTOUR_LEVELS = 256
const slice_lut_cache = new Map<D3InterpolateName, Uint8ClampedArray>()

// Canvas pixels want 8-bit sRGB, so the slice LUT keeps d3's sRGB output as is
const get_slice_lut = (colormap: D3InterpolateName): Uint8ClampedArray =>
  build_colormap_lut(colormap, slice_lut_cache, Uint8ClampedArray, (css) => {
    const { r: red, g: green, b: blue } = rgb(css)
    return [red, green, blue]
  })

// Resolve an explicit or automatic slice color range. `auto` symmetry (the default) centres
// the range on zero only when the slice straddles it.
export function resolve_slice_color_range(
  slice: Pick<SliceResult, `min` | `max`>,
  color_range?: Vec2,
  symmetric: ColorRangeSymmetry = `auto`,
): Vec2 {
  if (color_range) return [...color_range]
  return fit_color_range(slice.min, slice.max, symmetric)
}

// Convert a sampled slice to browser-sRGB RGBA pixels, preserving its exact mask. Rows are
// flipped so the slice's +v axis points up on the canvas. Pass `out` of the right size to
// fill it in place.
export function slice_to_rgba(
  slice: Pick<SliceResult, `data` | `mask` | `width` | `height`>,
  colormap: D3InterpolateName,
  color_range: Vec2,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const pixels =
    out?.length === slice.data.length * 4 ? out : new Uint8ClampedArray(slice.data.length * 4)
  const lut = get_slice_lut(colormap)
  const [range_min, range_max] = color_range
  const span = range_max - range_min
  const inv_span = span === 0 ? 0 : 1 / span

  for (let row_idx = 0; row_idx < slice.height; row_idx++) {
    const target_row = slice.height - 1 - row_idx
    for (let col_idx = 0; col_idx < slice.width; col_idx++) {
      const source_idx = row_idx * slice.width + col_idx
      const pixel_idx = (target_row * slice.width + col_idx) * 4
      if (!slice.mask[source_idx] || !Number.isFinite(slice.data[source_idx])) {
        pixels[pixel_idx] = 0
        pixels[pixel_idx + 1] = 0
        pixels[pixel_idx + 2] = 0
        pixels[pixel_idx + 3] = 0
        continue
      }
      const normalized =
        span === 0
          ? 0.5
          : Math.max(0, Math.min(1, (slice.data[source_idx] - range_min) * inv_span))
      const lut_idx = Math.round(normalized * (COLORMAP_LUT_SIZE - 1)) * 3
      pixels[pixel_idx] = lut[lut_idx]
      pixels[pixel_idx + 1] = lut[lut_idx + 1]
      pixels[pixel_idx + 2] = lut[lut_idx + 2]
      pixels[pixel_idx + 3] = 255
    }
  }
  return pixels
}

// Resolve a contour count or explicit threshold list against a color range.
export function resolve_contour_thresholds(
  color_range: Vec2,
  contour_levels: number | number[],
): number[] {
  if (Array.isArray(contour_levels)) {
    // Sort before truncating so the cap keeps the lowest thresholds deterministically
    // regardless of input order
    const thresholds = contour_levels.filter(Number.isFinite)
    // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- filter() returns a fresh array
    thresholds.sort((left, right) => left - right)
    return thresholds.slice(0, MAX_CONTOUR_LEVELS)
  }
  const count = Number.isFinite(contour_levels)
    ? Math.min(MAX_CONTOUR_LEVELS, Math.max(0, Math.floor(contour_levels)))
    : 0
  const [range_min, range_max] = color_range
  if (count === 0 || range_min === range_max) return []
  const lower_bound = Math.min(range_min, range_max)
  const range_span = Math.abs(range_max - range_min)
  return Array.from(
    { length: count },
    (_, level_idx) => lower_bound + ((level_idx + 1) / (count + 1)) * range_span,
  )
}
