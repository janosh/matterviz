import type { Point2D, Vec2 } from '$lib/math'

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

const padded_extent = (min: number, max: number): Vec2 => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) return [min - 0.5, max + 0.5]
  const padding = (max - min) * 0.05
  return [min - padding, max + padding]
}

export function series_extents(series: readonly DensePointSeries[]): { x: Vec2; y: Vec2 } {
  let x_min = Infinity
  let x_max = -Infinity
  let y_min = Infinity
  let y_max = -Infinity

  for (const srs of series) {
    const n_points = series_length(srs)
    for (let idx = 0; idx < n_points; idx++) {
      const x = srs.x[idx]
      const y = srs.y[idx]
      if (Number.isFinite(x)) {
        if (x < x_min) x_min = x
        if (x > x_max) x_max = x
      }
      if (Number.isFinite(y)) {
        if (y < y_min) y_min = y
        if (y > y_max) y_max = y
      }
    }
  }

  return { x: padded_extent(x_min, x_max), y: padded_extent(y_min, y_max) }
}

export function bin_points(
  series: readonly DensePointSeries[],
  x_range: Vec2,
  y_range: Vec2,
  x_bins: number,
  y_bins: number,
): DensityBinResult {
  const counts = new Uint32Array(x_bins * y_bins)
  const first_point_idxs = new Int32Array(counts.length)
  const first_series_idxs = new Int32Array(counts.length)
  const [x_min, x_max] = range_bounds(x_range)
  const [y_min, y_max] = range_bounds(y_range)
  const x_span = x_max - x_min || 1
  const y_span = y_max - y_min || 1
  const x_bin_scale = x_bins / x_span
  const y_bin_scale = y_bins / y_span
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

      const raw_x_bin = Math.floor((x - x_min) * x_bin_scale)
      const raw_y_bin = Math.floor((y - y_min) * y_bin_scale)
      const x_bin = raw_x_bin > last_x_bin ? last_x_bin : raw_x_bin
      const y_bin = raw_y_bin > last_y_bin ? last_y_bin : raw_y_bin
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
): DensityBin | null {
  const rel_x = pointer.x - plot_rect.x
  const rel_y = pointer.y - plot_rect.y
  if (rel_x < 0 || rel_y < 0 || rel_x >= plot_rect.width || rel_y >= plot_rect.height) {
    return null
  }

  const x_bin = value_bin(rel_x, 0, plot_rect.width || 1, density.x_bins)
  const y_bin = density.y_bins - 1 - value_bin(rel_y, 0, plot_rect.height || 1, density.y_bins)
  const count = density.counts[y_bin * density.x_bins + x_bin]
  if (!count) return null

  const [x_min, x_max] = range_bounds(x_range)
  const [y_min, y_max] = range_bounds(y_range)
  const x_step = (x_max - x_min || 1) / density.x_bins
  const y_step = (y_max - y_min || 1) / density.y_bins
  return {
    x_bin,
    y_bin,
    count,
    x_range: [x_min + x_bin * x_step, x_min + (x_bin + 1) * x_step],
    y_range: [y_min + y_bin * y_step, y_min + (y_bin + 1) * y_step],
  }
}

export function should_render_points(
  visible_count: number,
  plot_area_px: number,
  max_points: number,
  max_points_per_px: number,
): boolean {
  return (
    visible_count <= max_points ||
    (plot_area_px > 0 && visible_count / plot_area_px <= max_points_per_px)
  )
}

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
