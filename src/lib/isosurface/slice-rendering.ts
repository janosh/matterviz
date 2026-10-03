import type { D3InterpolateName } from '#lib/colors/index.js'
import { clamp, type Vec2 } from '#lib/math.js'
import { clamp01 } from '#lib/utils.js'
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

// The slice LUT as opaque RGBA pixels, written byte-wise and read back as 32-bit words, so
// they come out in the platform's byte order and each canvas pixel is a single store
const slice_pixel_cache = new Map<D3InterpolateName, Uint32Array>()
const get_slice_pixel_lut = (colormap: D3InterpolateName): Uint32Array => {
  const cached = slice_pixel_cache.get(colormap)
  if (cached) return cached
  const rgb_lut = get_slice_lut(colormap)
  const bytes = new Uint8ClampedArray(COLORMAP_LUT_SIZE * 4)
  for (let idx = 0; idx < COLORMAP_LUT_SIZE; idx++) {
    bytes.set(rgb_lut.subarray(idx * 3, idx * 3 + 3), idx * 4)
    bytes[idx * 4 + 3] = 255
  }
  const words = new Uint32Array(bytes.buffer)
  slice_pixel_cache.set(colormap, words)
  return words
}

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
  // `out` is filled through a 32-bit view, which needs a 4-byte aligned offset
  const pixels =
    out?.length === slice.data.length * 4 && out.byteOffset % 4 === 0
      ? out
      : new Uint8ClampedArray(slice.data.length * 4)
  const words = new Uint32Array(pixels.buffer, pixels.byteOffset, slice.data.length)
  const lut = get_slice_pixel_lut(colormap)
  const [range_min, range_max] = color_range
  const span = range_max - range_min
  const inv_span = span === 0 ? 0 : 1 / span
  const { data, mask, width, height } = slice

  for (let row_idx = 0; row_idx < height; row_idx++) {
    const target_row = height - 1 - row_idx
    for (let col_idx = 0; col_idx < width; col_idx++) {
      const source_idx = row_idx * width + col_idx
      const value = data[source_idx]
      // masked and non-finite pixels stay transparent black
      words[target_row * width + col_idx] =
        mask[source_idx] && Number.isFinite(value)
          ? lut[
              Math.round(
                (span === 0 ? 0.5 : clamp01((value - range_min) * inv_span)) *
                  (COLORMAP_LUT_SIZE - 1),
              )
            ]
          : 0
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
    ? clamp(Math.floor(contour_levels), 0, MAX_CONTOUR_LEVELS)
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
  if (thresholds.length === 0) return
  // One-cell border of -Infinity (below every threshold) so corner reads need no bounds checks
  const padded_width = width + 2
  const padded = new Float64Array(padded_width * (height + 2)).fill(Number.NEGATIVE_INFINITY)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      padded[(row + 1) * padded_width + col + 1] = values[row * width + col]
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
  const lowest = thresholds[0]
  const highest = thresholds[thresholds.length - 1]
  for (let cell_y = -1; cell_y < height; cell_y++) {
    // padded index of grid point (cell_x, cell_y) for cell_x = -1
    const bottom_row = (cell_y + 1) * padded_width
    for (let cell_x = -1; cell_x < width; cell_x++) {
      const bottom_idx = bottom_row + cell_x + 1
      const bottom_left = padded[bottom_idx]
      const bottom_right = padded[bottom_idx + 1]
      const top_left = padded[bottom_idx + padded_width]
      const top_right = padded[bottom_idx + padded_width + 1]
      const cell_min = Math.min(top_left, top_right, bottom_right, bottom_left)
      const cell_max = Math.max(top_left, top_right, bottom_right, bottom_left)
      // a level crosses this cell only when some corner reaches it and another does not
      if (cell_max < lowest || cell_min >= highest) continue
      for (const threshold of thresholds) {
        if (threshold <= cell_min) continue
        if (threshold > cell_max) break
        const segments =
          CONTOUR_CASES[
            Number(top_left >= threshold) |
              (Number(top_right >= threshold) << 1) |
              (Number(bottom_right >= threshold) << 2) |
              (Number(bottom_left >= threshold) << 3)
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
