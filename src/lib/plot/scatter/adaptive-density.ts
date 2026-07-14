import { LOG_EPS, type Point2D, type Vec2 } from '$lib/math'
import type { ScaleType } from '$lib/plot/core/types'
import { get_arcsinh_threshold, get_scale_type_name } from '$lib/plot/core/types'

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

export interface DensityBinResult {
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

export interface PickNearestOptions {
  x_range: Vec2
  y_range: Vec2
  x_scale: (value: number) => number
  y_scale: (value: number) => number
  radius_px?: number
}

export interface PickIndex<Metadata = Record<string, unknown>> {
  cells: Map<string, DenseInternalPoint<Metadata>[]>
  cell_size: number
  radius_px: number
}

export interface PlotRect {
  x: number
  y: number
  width: number
  height: number
}

// Monotonic transform pair: density bins are uniform in transformed (scale) space so
// they align with the axis pixel grid on log/arcsinh axes
export interface BinTransform {
  forward: (value: number) => number
  inverse: (value: number) => number
}
export type BinTransforms = { x?: BinTransform; y?: BinTransform }

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

export const get_metadata_at = <Metadata>(
  metadata: DensePointSeries<Metadata>[`metadata`],
  point_idx: number,
): Metadata | undefined => (Array.isArray(metadata) ? metadata[point_idx] : metadata)

const cell_key = (x_bin: number, y_bin: number): string => `${x_bin},${y_bin}`

export const range_bounds = (range: Vec2): Vec2 =>
  range[0] <= range[1] ? range : [range[1], range[0]]

const in_bounds = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max

const value_bin = (value: number, min: number, span: number, bins: number): number =>
  Math.min(bins - 1, Math.max(0, Math.floor(((value - min) / span) * bins)))

const series_length = (srs: Pick<DensePointSeries, `x` | `y`>): number =>
  Math.min(srs.x.length, srs.y.length)

const padded_extent = (min: number, max: number, scale_type?: ScaleType): Vec2 => {
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
  const padding = (t_max - t_min) * 0.05
  const clamp = (val: number) => Math.min(Number.MAX_VALUE, Math.max(-Number.MAX_VALUE, val))
  return [clamp(inverse(t_min - padding)), clamp(inverse(t_max + padding))]
}

export function series_extents(
  series: readonly DensePointSeries[],
  x_scale_type?: ScaleType,
  y_scale_type?: ScaleType,
): { x: Vec2; y: Vec2 } {
  let x_min = Infinity
  let x_max = -Infinity
  let y_min = Infinity
  let y_max = -Infinity
  const log_x = get_scale_type_name(x_scale_type) === `log`
  const log_y = get_scale_type_name(y_scale_type) === `log`

  for (const srs of series) {
    const n_points = series_length(srs)
    for (let idx = 0; idx < n_points; idx++) {
      const x = srs.x[idx]
      const y = srs.y[idx]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      // Align with bin_points / log scale floor so sub-LOG_EPS samples don't widen extent
      if ((log_x && x < LOG_EPS) || (log_y && y < LOG_EPS)) continue
      if (x < x_min) x_min = x
      if (x > x_max) x_max = x
      if (y < y_min) y_min = y
      if (y > y_max) y_max = y
    }
  }

  return {
    x: padded_extent(x_min, x_max, x_scale_type),
    y: padded_extent(y_min, y_max, y_scale_type),
  }
}

export function bin_points(
  series: readonly DensePointSeries[],
  x_range: Vec2,
  y_range: Vec2,
  x_bins: number,
  y_bins: number,
  transforms?: BinTransforms,
): DensityBinResult {
  const counts = new Uint32Array(x_bins * y_bins)
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
    const n_points = series_length(srs)
    for (let point_idx = 0; point_idx < n_points; point_idx++) {
      const x = srs.x[point_idx]
      const y = srs.y[point_idx]
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < x_min ||
        x > x_max ||
        y < y_min ||
        y > y_max
      )
        continue

      const raw_x_bin = Math.floor((x_fwd(x) - t_x_min) * x_bin_scale)
      const raw_y_bin = Math.floor((y_fwd(y) - t_y_min) * y_bin_scale)
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

  const x_bin = value_bin(rel_x, 0, plot_rect.width || 1, density.x_bins)
  // Screen coordinates grow downward, while density bins use bottom-up data Y.
  const y_bin = density.y_bins - 1 - value_bin(rel_y, 0, plot_rect.height || 1, density.y_bins)
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
  const x = srs.x[point_idx]
  const y = srs.y[point_idx]
  return {
    x,
    y,
    cx: x_scale(x),
    cy: y_scale(y),
    series_idx,
    point_idx,
    metadata: get_metadata_at(srs.metadata, point_idx),
    point_id: srs.point_ids?.[point_idx],
    size_value: srs.size_values?.[point_idx],
  }
}

export function build_pick_index<Metadata>(
  series: readonly DensePointSeries<Metadata>[],
  options: PickNearestOptions,
): PickIndex<Metadata> {
  const { x_range, y_range, x_scale, y_scale, radius_px = 12 } = options
  const [x_min, x_max] = range_bounds(x_range)
  const [y_min, y_max] = range_bounds(y_range)
  const cell_size = Math.max(1, radius_px)
  const cells = new Map<string, DenseInternalPoint<Metadata>[]>()

  for (let series_idx = 0; series_idx < series.length; series_idx++) {
    const srs = series[series_idx]
    const n_points = series_length(srs)
    for (let point_idx = 0; point_idx < n_points; point_idx++) {
      const x = srs.x[point_idx]
      const y = srs.y[point_idx]
      if (!in_bounds(x, x_min, x_max) || !in_bounds(y, y_min, y_max)) continue

      const point = internal_point(srs, series_idx, point_idx, x_scale, y_scale)
      const key = cell_key(Math.floor(point.cx / cell_size), Math.floor(point.cy / cell_size))
      const points = cells.get(key)
      if (points) points.push(point)
      else cells.set(key, [point])
    }
  }

  return { cells, cell_size, radius_px }
}

export function pick_from_index<Metadata>(
  index: PickIndex<Metadata>,
  pointer: Point2D,
): DenseInternalPoint<Metadata> | null {
  const radius_sq = index.radius_px ** 2
  const center_x = Math.floor(pointer.x / index.cell_size)
  const center_y = Math.floor(pointer.y / index.cell_size)
  const cell_radius = Math.ceil(index.radius_px / index.cell_size)
  let best: DenseInternalPoint<Metadata> | null = null
  let best_dist_sq = radius_sq

  for (let y_bin = center_y - cell_radius; y_bin <= center_y + cell_radius; y_bin++) {
    for (let x_bin = center_x - cell_radius; x_bin <= center_x + cell_radius; x_bin++) {
      for (const point of index.cells.get(cell_key(x_bin, y_bin)) ?? []) {
        const dx = pointer.x - point.cx
        const dy = pointer.y - point.cy
        const dist_sq = dx * dx + dy * dy
        if (dist_sq > best_dist_sq) continue
        best_dist_sq = dist_sq
        best = point
      }
    }
  }

  return best
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
