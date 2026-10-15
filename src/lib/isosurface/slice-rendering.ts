import { clamp, type Vec2 } from '#lib/math.js'
import { resolve_value_range } from '#lib/plot/core/scales.js'
import type { ColorScale } from '#lib/plot/core/types.js'
import { rgb } from 'd3-color'
import type { ValueRangeSymmetry } from './coloring'
import { fit_value_range, lut_index_fn, palette_lut } from './coloring'
import type { SliceResult } from './slice'

export type VolumeSliceMode = `both` | `contours` | `filled`

const MAX_CONTOUR_LEVELS = 256

// Opaque 8-bit sRGB pixels (canvas wants d3's sRGB output as is), written byte-wise and read
// back as 32-bit words, so they come out in the platform's byte order and each canvas pixel
// is a single store
const slice_pixel_cache = new Map<string, Uint32Array>()
const build_pixel_lut = (colors: string[]): Uint32Array => {
  const bytes = new Uint8ClampedArray(colors.length * 4)
  for (const [idx, color] of colors.entries()) {
    const { r: red, g: green, b: blue } = rgb(color)
    bytes.set([red, green, blue, 255], idx * 4)
  }
  return new Uint32Array(bytes.buffer)
}

// The slice's color value range: set color_scale.value_range ends win, unset ends fit the
// slice. `auto` symmetry (the default) centres the fit on zero only when the slice straddles it.
export const resolve_slice_value_range = (
  slice: Pick<SliceResult, `min` | `max`>,
  color_scale: ColorScale,
  symmetric: ValueRangeSymmetry = `auto`,
): Vec2 => resolve_value_range(color_scale, fit_value_range(slice.min, slice.max, symmetric))

// Convert a sampled slice to browser-sRGB RGBA pixels, preserving its exact mask. Rows are
// flipped so the slice's +v axis points up on the canvas. Pass `out` of the right size to
// fill it in place.
export function slice_to_rgba(
  slice: Pick<SliceResult, `data` | `mask` | `width` | `height`>,
  color_scale: ColorScale,
  value_range: Vec2, // resolved, see resolve_slice_value_range
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  // `out` is filled through a 32-bit view, which needs a 4-byte aligned offset
  const pixels =
    out?.length === slice.data.length * 4 && out.byteOffset % 4 === 0
      ? out
      : new Uint8ClampedArray(slice.data.length * 4)
  const words = new Uint32Array(pixels.buffer, pixels.byteOffset, slice.data.length)
  const lut = palette_lut(slice_pixel_cache, color_scale, build_pixel_lut)
  const lut_index = lut_index_fn(color_scale, value_range)
  const { data, mask, width, height } = slice

  for (let row_idx = 0; row_idx < height; row_idx++) {
    const target_row = height - 1 - row_idx
    for (let col_idx = 0; col_idx < width; col_idx++) {
      const source_idx = row_idx * width + col_idx
      // masked pixels and values with no color stay transparent black
      const lut_idx = mask[source_idx] ? lut_index(data[source_idx]) : -1
      words[target_row * width + col_idx] = lut_idx < 0 ? 0 : lut[lut_idx]
    }
  }
  return pixels
}

// Resolve a contour count or explicit threshold list against a color value range.
export function resolve_contour_thresholds(
  value_range: Vec2,
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
    ? clamp(Math.floor(contour_levels), 0, MAX_CONTOUR_LEVELS)
    : 0
  const [range_min, range_max] = value_range
  if (count === 0 || range_min === range_max) return []
  const lower_bound = Math.min(range_min, range_max)
  const range_span = Math.abs(range_max - range_min)
  return Array.from(
    { length: count },
    (_, level_idx) => lower_bound + ((level_idx + 1) / (count + 1)) * range_span,
  )
}

// d3-contour's marching-squares table: per corner mask (bit 0 = (x, y+1), 1 = (x+1, y+1),
// 2 = (x+1, y), 3 = (x, y)), the isoline segments as [x0, y0, x1, y1] offsets from cell (x, y)
// whose corners are grid points at (x + 0.5, y + 0.5) through (x + 1.5, y + 1.5)
// oxfmt-ignore
const CONTOUR_CASES: readonly (readonly number[])[] = [
  [], [1, 1.5, 0.5, 1], [1.5, 1, 1, 1.5], [1.5, 1, 0.5, 1], [1, 0.5, 1.5, 1],
  [1, 1.5, 0.5, 1, 1, 0.5, 1.5, 1], [1, 0.5, 1, 1.5], [1, 0.5, 0.5, 1], [0.5, 1, 1, 0.5],
  [1, 1.5, 1, 0.5], [0.5, 1, 1, 0.5, 1.5, 1, 1, 1.5], [1.5, 1, 1, 0.5], [0.5, 1, 1.5, 1],
  [1, 1.5, 1.5, 1], [0.5, 1, 1, 1.5], [],
]

// Isoline segments of a row-major `width`×`height` grid of finite values at every threshold,
// in one pass. Coordinates match d3-contour's (grid point (i, j) sits at (i + 0.5, j + 0.5),
// cells past the grid edge count as below every threshold, crossings are linearly
// interpolated), so `emit` receives exactly the segments d3 stitches into rings — without the
// stitching, hole assignment and one grid scan per threshold, which strokes do not need.
// Only where a value equals a threshold exactly can the two differ: d3 drops zero-area rings
// outside any polygon (keeping those inside one), these are drawn as the line they trace.
// `thresholds` must be sorted ascending.
export function contour_segments(
  values: ArrayLike<number>,
  width: number,
  height: number,
  thresholds: readonly number[],
  emit: (x0: number, y0: number, x1: number, y1: number) => void,
): void {
  const n_levels = thresholds.length
  if (n_levels === 0) return
  // Band of each grid point = how many thresholds it reaches (value >= threshold), so a level
  // crosses a cell exactly when its corners' bands straddle it: most cells are skipped with
  // integer compares, and corner states come from the bands instead of re-comparing values.
  // A one-cell border of band 0 (below every threshold, like d3's out-of-grid cells) spares
  // the corner reads any bounds checks.
  const padded_width = width + 2
  const bands = new Uint16Array(padded_width * (height + 2))
  const [lowest, highest] = [thresholds[0], thresholds[n_levels - 1]]
  // evenly spaced levels (the usual case) make a linear guess exact up to rounding; the
  // walks below correct it, so uneven levels stay exact too
  const inv_spacing =
    n_levels > 1 && highest > lowest ? (n_levels - 1) / (highest - lowest) : 0
  for (let row = 0; row < height; row++) {
    const padded_row = (row + 1) * padded_width + 1
    for (let col = 0; col < width; col++) {
      const value = values[row * width + col]
      // NaN reaches no threshold (counts as below every level)
      if (!(value >= lowest)) continue
      let band = value >= highest ? n_levels : Math.floor((value - lowest) * inv_spacing) + 1
      while (band < n_levels && value >= thresholds[band]) band++
      while (band > 0 && value < thresholds[band - 1]) band--
      bands[padded_row + col] = band
    }
  }
  // A crossing on a cell edge moves from the edge midpoint to where the field equals the
  // threshold (d3's smoothLinear); edges on the padded border keep their midpoint.
  const place = (coord_x: number, coord_y: number, threshold: number, out: number[]) => {
    if (Number.isInteger(coord_x)) {
      const row = coord_y - 0.5
      if (coord_x > 0 && coord_x < width) {
        const left = values[row * width + coord_x - 1]
        const right = values[row * width + coord_x]
        coord_x = coord_x + (threshold - left) / (right - left) - 0.5
      }
    } else if (coord_y > 0 && coord_y < height) {
      const col = coord_x - 0.5
      const below = values[(coord_y - 1) * width + col]
      const above = values[coord_y * width + col]
      coord_y = coord_y + (threshold - below) / (above - below) - 0.5
    }
    out[0] = coord_x
    out[1] = coord_y
  }
  const [start, end] = [
    [0, 0],
    [0, 0],
  ]
  for (let cell_y = -1; cell_y < height; cell_y++) {
    // padded index of grid point (cell_x, cell_y) for cell_x = -1
    const bottom_row = (cell_y + 1) * padded_width
    for (let cell_x = -1; cell_x < width; cell_x++) {
      const bottom_idx = bottom_row + cell_x + 1
      const bottom_left = bands[bottom_idx]
      const bottom_right = bands[bottom_idx + 1]
      const top_left = bands[bottom_idx + padded_width]
      const top_right = bands[bottom_idx + padded_width + 1]
      if (
        bottom_left === bottom_right &&
        bottom_left === top_left &&
        bottom_left === top_right
      )
        continue
      // levels k with min band <= k < max band have corners on both sides
      const band_min = Math.min(top_left, top_right, bottom_right, bottom_left)
      const band_max = Math.max(top_left, top_right, bottom_right, bottom_left)
      for (let level = band_min; level < band_max; level++) {
        const threshold = thresholds[level]
        const segments =
          CONTOUR_CASES[
            Number(top_left > level) |
              (Number(top_right > level) << 1) |
              (Number(bottom_right > level) << 2) |
              (Number(bottom_left > level) << 3)
          ]
        for (let seg_idx = 0; seg_idx < segments.length; seg_idx += 4) {
          place(cell_x + segments[seg_idx], cell_y + segments[seg_idx + 1], threshold, start)
          place(cell_x + segments[seg_idx + 2], cell_y + segments[seg_idx + 3], threshold, end)
          // a corner exactly at the threshold collapses a segment to a point (a dot under
          // round caps); d3 folds those into rings that draw nothing
          if (start[0] !== end[0] || start[1] !== end[1])
            emit(start[0], start[1], end[0], end[1])
        }
      }
    }
  }
}
