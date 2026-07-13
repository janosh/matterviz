import { get_d3_interpolator, type D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { rgb } from 'd3-color'
import type { SliceResult } from './slice'

export type VolumeSliceMode = `both` | `contours` | `filled`

const SLICE_LUT_SIZE = 256
const MAX_CONTOUR_LEVELS = 256
const slice_lut_cache = new Map<D3InterpolateName, Uint8ClampedArray>()

const get_slice_lut = (colormap: D3InterpolateName): Uint8ClampedArray => {
  const cached = slice_lut_cache.get(colormap)
  if (cached) return cached
  const interpolator = get_d3_interpolator(colormap)
  const lut = new Uint8ClampedArray(SLICE_LUT_SIZE * 3)
  for (let color_idx = 0; color_idx < SLICE_LUT_SIZE; color_idx++) {
    const color = rgb(interpolator(color_idx / (SLICE_LUT_SIZE - 1)))
    lut[color_idx * 3] = color.r
    lut[color_idx * 3 + 1] = color.g
    lut[color_idx * 3 + 2] = color.b
  }
  slice_lut_cache.set(colormap, lut)
  return lut
}

/** Resolve an explicit or automatic slice color range. */
export function resolve_slice_color_range(
  slice: Pick<SliceResult, `min` | `max`>,
  color_range?: Vec2,
  symmetric: boolean | `auto` = `auto`,
): Vec2 {
  if (color_range) return [...color_range]
  if (symmetric === true || (symmetric === `auto` && slice.min < 0 && slice.max > 0)) {
    const abs_max = Math.max(Math.abs(slice.min), Math.abs(slice.max))
    return [-abs_max, abs_max]
  }
  return [slice.min, slice.max]
}

/** Convert a sampled slice to browser-sRGB RGBA pixels, preserving its exact mask. */
export function slice_to_rgba(
  slice: Pick<SliceResult, `data` | `mask` | `width` | `height`>,
  colormap: D3InterpolateName,
  color_range: Vec2,
  { flip_y = true, out }: { flip_y?: boolean; out?: Uint8ClampedArray } = {},
): Uint8ClampedArray {
  const pixels =
    out?.length === slice.data.length * 4 ? out : new Uint8ClampedArray(slice.data.length * 4)
  const lut = get_slice_lut(colormap)
  const [range_min, range_max] = color_range
  const span = range_max - range_min
  const inv_span = span === 0 ? 0 : 1 / span

  for (let row_idx = 0; row_idx < slice.height; row_idx++) {
    const target_row = flip_y ? slice.height - 1 - row_idx : row_idx
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
      const lut_idx = Math.round(normalized * (SLICE_LUT_SIZE - 1)) * 3
      pixels[pixel_idx] = lut[lut_idx]
      pixels[pixel_idx + 1] = lut[lut_idx + 1]
      pixels[pixel_idx + 2] = lut[lut_idx + 2]
      pixels[pixel_idx + 3] = 255
    }
  }
  return pixels
}

/** Resolve a contour count or explicit threshold list against a color range. */
export function resolve_contour_thresholds(
  color_range: Vec2,
  contour_levels: number | number[],
): number[] {
  if (Array.isArray(contour_levels)) {
    // Sort before truncating so the cap keeps the lowest thresholds deterministically
    // regardless of input order
    return contour_levels
      .filter(Number.isFinite)
      .sort((left, right) => left - right)
      .slice(0, MAX_CONTOUR_LEVELS)
  }
  const count = Number.isFinite(contour_levels)
    ? Math.min(MAX_CONTOUR_LEVELS, Math.max(0, Math.floor(contour_levels)))
    : 0
  const [range_min, range_max] = color_range
  if (count === 0 || range_min === range_max) return []
  return Array.from(
    { length: count },
    (_, level_idx) => range_min + ((level_idx + 1) / (count + 1)) * (range_max - range_min),
  ).sort((left, right) => left - right)
}
