import { clamp, partition_point, LOG_EPS, type Point2D, type Vec2 } from '$lib/math'
import { range_bounds } from '$lib/plot/core/interactions'
import type { ScaleType } from '$lib/plot/core/types'
import {
  assert_series_lengths,
  get_arcsinh_threshold,
  get_scale_type_name,
} from '$lib/plot/core/types'

export type NumericArray = ArrayLike<number>

export interface DensePointSeries<Metadata = Record<string, unknown>> {
  id?: string | number
  label?: string
  x: NumericArray
  y: NumericArray
  metadata?: Metadata[] | Metadata
  point_ids?: ArrayLike<string | number>
  size_values?: ArrayLike<number | null>
  color?: string
}

export interface DenseInternalPoint<Metadata = Record<string, unknown>> {
  x: number
  y: number
  series_idx: number
  point_idx: number
  metadata?: Metadata
  point_id?: string | number
  size_value?: number | null
  cx: number
  cy: number
}

// Cache once per dataset. Unordered/non-finite x values use the ordinary range scan.
export const series_x_order = (series: readonly DensePointSeries<unknown>[]): (-1 | 0 | 1)[] =>
  series.map(({ x: coord_x }) => {
    if (!coord_x.length) return 0
    let previous = coord_x[0]
    if (!Number.isFinite(previous)) return 0
    let ascending = true
    let descending = true
    for (let idx = 1; idx < coord_x.length; idx++) {
      const value = coord_x[idx]
      if (!Number.isFinite(value)) return 0
      ascending &&= value >= previous
      descending &&= value <= previous
      previous = value
      if (!ascending && !descending) return 0
    }
    return ascending ? 1 : -1
  })

const x_window = (values: NumericArray, min: number, max: number, order: -1 | 0 | 1): Vec2 =>
  order === 0 || Number.isNaN(min) || Number.isNaN(max)
    ? [0, values.length]
    : [
        partition_point(values, (value) => (order > 0 ? value < min : value > max)),
        partition_point(values, (value) => (order > 0 ? value <= max : value >= min)),
      ]

interface DensityBinResult {
  counts: Uint32Array
  first_point_idxs: Int32Array
  first_series_idxs: Int32Array
  max_count: number
  visible_count: number
  x_bins: number
  y_bins: number
}

export interface DensityBin {
  x_bin: number
  y_bin: number
  count: number
  x_range: Vec2
  y_range: Vec2
}

export interface PlotRect {
  x: number
  y: number
  width: number
  height: number
}

// Monotonic transform pair: density bins are uniform in transformed (scale) space so
// they align with the axis pixel grid on log/arcsinh axes
interface BinTransform {
  forward: (value: number) => number
  inverse: (value: number) => number
}
type BinTransforms = { x?: BinTransform; y?: BinTransform }

const identity: BinTransform = { forward: (val) => val, inverse: (val) => val }

// Map an axis scale_type to the transform density binning should happen in
export function scale_bin_transform(scale_type?: ScaleType): BinTransform {
  const type_name = get_scale_type_name(scale_type)
  if (type_name === `log`) {
    // Clamp to LOG_EPS (same floor as the rendered log scale) so bin edges align with the
    // axis; non-positive samples are already dropped by the range filter in bin_points
    return { forward: (val) => Math.log(Math.max(val, LOG_EPS)), inverse: Math.exp }
  }
  if (type_name !== `arcsinh`) return identity
  const threshold = get_arcsinh_threshold(scale_type)
  return {
    forward: (val) => Math.asinh(val / threshold),
    inverse: (val) => Math.sinh(val) * threshold,
  }
}

// Data range of one bin: edges are uniform in transformed space, mapped back via inverse
const bin_range = (
  txf: BinTransform | undefined,
  range: Vec2,
  bin: number,
  n_bins: number,
) => {
  const transform = txf ?? identity
  const [t_min, t_max] = range_bounds(range).map(transform.forward)
  const step = (t_max - t_min || 1) / n_bins
  return [
    transform.inverse(t_min + bin * step),
    transform.inverse(t_min + (bin + 1) * step),
  ] as Vec2
}

const get_metadata_at = <Metadata>(
  metadata: DensePointSeries<Metadata>[`metadata`],
  point_idx: number,
): Metadata | undefined => (Array.isArray(metadata) ? metadata[point_idx] : metadata)

const in_bounds = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max

const value_bin = (value: number, min: number, span: number, bins: number): number =>
  clamp(Math.floor(((value - min) / span) * bins), 0, bins - 1)

const padded_extent = (
  min: number,
  max: number,
  scale_type?: ScaleType,
  range_padding = 0.05,
): Vec2 => {
  const log_scale = get_scale_type_name(scale_type) === `log`
  if (!Number.isFinite(min) || !Number.isFinite(max)) return log_scale ? [1, 10] : [0, 1]

  const { forward, inverse } = scale_bin_transform(scale_type)
  const t_min = forward(min)
  const t_max = forward(max)
  if (t_min === t_max) {
    if (log_scale) {
      const center = Math.max(min, LOG_EPS)
      return [Math.max(LOG_EPS, center / Math.sqrt(10)), center * Math.sqrt(10)]
    }
    return [inverse(t_min - 0.5), inverse(t_max + 0.5)]
  }
  const padding = (t_max - t_min) * range_padding
  const finite = (val: number) => clamp(val, -Number.MAX_VALUE, Number.MAX_VALUE)
  return [finite(inverse(t_min - padding)), finite(inverse(t_max + padding))]
}

export function series_extents(
  series: readonly DensePointSeries[],
  x_scale_type?: ScaleType,
  y_scale_type?: ScaleType,
  range_padding = 0.05,
): { x: Vec2; y: Vec2 } {
  series.forEach(assert_series_lengths)
  let x_min = Infinity
  let x_max = -Infinity
  let y_min = Infinity
  let y_max = -Infinity
  const log_x = get_scale_type_name(x_scale_type) === `log`
  const log_y = get_scale_type_name(y_scale_type) === `log`

  for (const srs of series) {
    const n_points = srs.x.length
    for (let idx = 0; idx < n_points; idx++) {
      const coord_x = srs.x[idx]
      const coord_y = srs.y[idx]
      if (!Number.isFinite(coord_x) || !Number.isFinite(coord_y)) continue
      // Align with bin_points / log scale floor so sub-LOG_EPS samples don't widen extent
      if ((log_x && coord_x < LOG_EPS) || (log_y && coord_y < LOG_EPS)) continue
      if (coord_x < x_min) x_min = coord_x
      if (coord_x > x_max) x_max = coord_x
      if (coord_y < y_min) y_min = coord_y
      if (coord_y > y_max) y_max = coord_y
    }
  }

  return {
    x: padded_extent(x_min, x_max, x_scale_type, range_padding),
    y: padded_extent(y_min, y_max, y_scale_type, range_padding),
  }
}

// Both bin counts are plot_px / density.bin_px, so a sub-pixel bin_px squares up: 0.1 on a
// 1200x800 plot is 12000 x 8000 = 9.6e7 cells, 1152 MB. 2e7 still admits an 8K plot at 2.8 px.
const MAX_DENSITY_CELLS = 2e7
const BYTES_PER_CELL = 12 // Uint32Array counts + two Int32Array first-hit indices

export function bin_points(
  series: readonly DensePointSeries[],
  x_range: Vec2,
  y_range: Vec2,
  x_bins: number,
  y_bins: number,
  transforms?: BinTransforms,
  x_order: readonly (-1 | 0 | 1)[] = [],
): DensityBinResult {
  series.forEach(assert_series_lengths)
  const cells = x_bins * y_bins
  if (!Number.isFinite(cells) || cells > MAX_DENSITY_CELLS) {
    const megabytes = Math.round((cells * BYTES_PER_CELL) / 1e6)
    throw new Error(
      `bin_points: a ${x_bins} x ${y_bins} grid is ${cells} cells (${megabytes} MB), past the ${MAX_DENSITY_CELLS} cap. Raise density.bin_px or shrink the plot.`,
    )
  }
  const counts = new Uint32Array(cells)
  const first_point_idxs = new Int32Array(counts.length)
  const first_series_idxs = new Int32Array(counts.length)
  const [x_min, x_max] = range_bounds(x_range)
  const [y_min, y_max] = range_bounds(y_range)
  // Bin in transformed (scale) space so bins align with the axis pixel grid
  const x_fwd = transforms?.x?.forward ?? identity.forward
  const y_fwd = transforms?.y?.forward ?? identity.forward
  const t_x_min = x_fwd(x_min)
  const t_y_min = y_fwd(y_min)
  const x_bin_scale = x_bins / (x_fwd(x_max) - t_x_min || 1)
  const y_bin_scale = y_bins / (y_fwd(y_max) - t_y_min || 1)
  const last_x_bin = x_bins - 1
  const last_y_bin = y_bins - 1
  let visible_count = 0
  let max_count = 0

  for (let series_idx = 0; series_idx < series.length; series_idx++) {
    const srs = series[series_idx]
    const [start, end] = x_window(srs.x, x_min, x_max, x_order[series_idx] ?? 0)
    for (let point_idx = start; point_idx < end; point_idx++) {
      const coord_x = srs.x[point_idx]
      const coord_y = srs.y[point_idx]
      if (
        !Number.isFinite(coord_x) ||
        !Number.isFinite(coord_y) ||
        coord_x < x_min ||
        coord_x > x_max ||
        coord_y < y_min ||
        coord_y > y_max
      )
        continue

      const raw_x_bin = Math.floor((x_fwd(coord_x) - t_x_min) * x_bin_scale)
      const raw_y_bin = Math.floor((y_fwd(coord_y) - t_y_min) * y_bin_scale)
      const x_bin = raw_x_bin < 0 ? 0 : raw_x_bin > last_x_bin ? last_x_bin : raw_x_bin
      const y_bin = raw_y_bin < 0 ? 0 : raw_y_bin > last_y_bin ? last_y_bin : raw_y_bin
      const idx = y_bin * x_bins + x_bin
      const count = ++counts[idx]
      if (count === 1) {
        first_series_idxs[idx] = series_idx
        first_point_idxs[idx] = point_idx
      }
      visible_count++
      if (count > max_count) max_count = count
    }
  }

  return {
    counts,
    first_point_idxs,
    first_series_idxs,
    max_count,
    visible_count,
    x_bins,
    y_bins,
  }
}

// Bin indices are canonical — bin 0 is the DATA MINIMUM, since bin_points sorts the range
// through range_bounds — but the canvas grid is purely positional, so a descending range
// (e.g. [10, 0]) mirrors the bins against their own axis. Screen rows additionally run
// opposite to ascending data Y. Self-inverse, so the same call maps a bin to its screen cell
// and a hit-tested screen cell back to its bin.
export const density_screen_cell = (
  x_bin: number,
  y_bin: number,
  x_bins: number,
  y_bins: number,
  x_range: Vec2,
  y_range: Vec2,
): Vec2 => [
  x_range[0] > x_range[1] ? x_bins - 1 - x_bin : x_bin,
  y_range[0] > y_range[1] ? y_bin : y_bins - 1 - y_bin,
]

export function density_bin_at_point(
  density: DensityBinResult,
  pointer: Point2D,
  plot_rect: PlotRect,
  x_range: Vec2,
  y_range: Vec2,
  transforms?: BinTransforms,
): DensityBin | null {
  const rel_x = pointer.x - plot_rect.x
  const rel_y = pointer.y - plot_rect.y
  if (rel_x < 0 || rel_y < 0 || rel_x >= plot_rect.width || rel_y >= plot_rect.height) {
    return null
  }

  const [x_bin, y_bin] = density_screen_cell(
    value_bin(rel_x, 0, plot_rect.width || 1, density.x_bins),
    value_bin(rel_y, 0, plot_rect.height || 1, density.y_bins),
    density.x_bins,
    density.y_bins,
    x_range,
    y_range,
  )
  const count = density.counts[y_bin * density.x_bins + x_bin]
  if (!count) return null

  return {
    x_bin,
    y_bin,
    count,
    x_range: bin_range(transforms?.x, x_range, x_bin, density.x_bins),
    y_range: bin_range(transforms?.y, y_range, y_bin, density.y_bins),
  }
}

export const should_render_points = (
  visible_count: number,
  plot_area_px: number,
  max_points: number,
  max_points_per_px: number,
): boolean =>
  visible_count <= max_points ||
  (plot_area_px > 0 && visible_count / plot_area_px <= max_points_per_px)

const internal_point = <Metadata>(
  srs: DensePointSeries<Metadata>,
  series_idx: number,
  point_idx: number,
  x_scale: (value: number) => number,
  y_scale: (value: number) => number,
): DenseInternalPoint<Metadata> => {
  const coord_x = srs.x[point_idx]
  const coord_y = srs.y[point_idx]
  return {
    x: coord_x,
    y: coord_y,
    cx: x_scale(coord_x),
    cy: y_scale(coord_y),
    series_idx,
    point_idx,
    metadata: get_metadata_at(srs.metadata, point_idx),
    point_id: srs.point_ids?.[point_idx],
    size_value: srs.size_values?.[point_idx],
  }
}

// Finite in-range points of every series, streamed so consumers that stop early (label
// budgets) or feed a grid never materialize the full visible set
export function* visible_points<Metadata>(
  series: readonly DensePointSeries<Metadata>[],
  x_range: Vec2,
  y_range: Vec2,
  x_scale: (value: number) => number,
  y_scale: (value: number) => number,
  x_order: readonly (-1 | 0 | 1)[] = [],
): Generator<DenseInternalPoint<Metadata>> {
  const [x_min, x_max] = range_bounds(x_range)
  const [y_min, y_max] = range_bounds(y_range)
  for (let series_idx = 0; series_idx < series.length; series_idx++) {
    const srs = series[series_idx]
    const [start, end] = x_window(srs.x, x_min, x_max, x_order[series_idx] ?? 0)
    for (let point_idx = start; point_idx < end; point_idx++) {
      const coord_x = srs.x[point_idx]
      const coord_y = srs.y[point_idx]
      if (!in_bounds(coord_x, x_min, x_max) || !in_bounds(coord_y, y_min, y_max)) continue
      yield internal_point(srs, series_idx, point_idx, x_scale, y_scale)
    }
  }
}

export function first_point_in_bin<Metadata>(
  series: readonly DensePointSeries<Metadata>[],
  density: DensityBinResult,
  bin: Pick<DensityBin, `x_bin` | `y_bin`>,
  x_scale: (value: number) => number,
  y_scale: (value: number) => number,
): DenseInternalPoint<Metadata> | null {
  const idx = bin.y_bin * density.x_bins + bin.x_bin
  if (!density.counts[idx]) return null
  const series_idx = density.first_series_idxs[idx]
  const point_idx = density.first_point_idxs[idx]
  const srs = series[series_idx]
  return srs ? internal_point(srs, series_idx, point_idx, x_scale, y_scale) : null
}
