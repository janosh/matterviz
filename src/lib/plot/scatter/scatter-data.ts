// Pure data-transform helpers for ScatterPlot.svelte. Everything here is stateless:
// component $state/$derived values are passed in as parameters.
import { partition_point, type Vec2 } from '#lib/math.js'
import { error_getter } from '#lib/plot/core/error-bars.js'
import { plot_color } from '#lib/colors/index.js'
import { symbol_names } from '#lib/labels.js'
import { DEFAULTS } from '#lib/settings.js'
import { first_duplicate } from '#lib/utils.js'
import {
  get_series_symbol,
  is_transparent_or_none,
  shown_point_style,
} from '#lib/plot/core/data-transform.js'
import { is_fill_gradient } from '#lib/plot/core/fill-utils.js'
import { range_bounds } from '#lib/plot/core/interactions.js'
import type {
  AxisKey,
  AxisRanges,
  DataSeries,
  FillRegion,
  InternalPoint,
  LegendItem,
  LineCurve,
  PointStyle,
  StyleOverrides,
} from '#lib/plot/core/types.js'
import { assert_series_lengths, has_marker } from '#lib/plot/core/types.js'

// A colour/size value a scale can map: NaN, ±Infinity and null fall back to the series style
// like a missing value (d3 scales map NaN to undefined: a black marker at the default size)
export const is_finite_num = (val: number | null | undefined): val is number =>
  typeof val === `number` && Number.isFinite(val)
export const finite_or_null = (val: number | null | undefined): number | null =>
  is_finite_num(val) ? val : null

// Resolve an indexed-or-scalar series prop into a per-point getter. Hoisting the
// null/Array.isArray branch out of the point loop matters at 100k points, where these
// five props would otherwise cost 10 redundant checks per point.
const prop_getter = <T>(
  prop: T[] | T | undefined | null,
): ((idx: number) => T | undefined) => {
  if (prop == null) return () => undefined
  if (Array.isArray(prop)) return (idx) => prop[idx]
  return () => prop
}

// A series with every finite point materialized once (see materialize_series_points)
export type MaterializedSeries<Metadata = Record<string, unknown>> = DataSeries<Metadata> & {
  points: InternalPoint<Metadata>[]
  x_direction: -1 | 0 | 1
  line_direction: -1 | 0 | 1
  point_bounds: { x: Vec2; y: Vec2 }
  _id: string | number
  orig_series_idx: number
}

// Build the InternalPoints of every visible, well-formed series once per data change. Points
// with a non-finite x or y are dropped here (Number.isFinite also rejects null/undefined/NaN).
// Range filtering happens on every pan/zoom/resize tick, so it must not re-allocate these:
// filter_series_to_ranges only picks from this list, which also keeps point identity stable
// across frames (hover/selection compare logical keys, but fewer allocations is still the
// difference between a smooth and a stuttering pan at 100k points).
export function materialize_series_points<Metadata = Record<string, unknown>>(
  series: readonly (DataSeries<Metadata> | null | undefined)[],
): MaterializedSeries<Metadata>[] {
  const out: MaterializedSeries<Metadata>[] = []
  for (let series_idx = 0; series_idx < series.length; series_idx++) {
    const data_series = series[series_idx]
    // Missing series yield no points, and empty series are dropped when filtering
    if (!data_series) continue
    const { x: x_values, y: y_values, color_values, size_values, point_ids } = data_series
    if (!Array.isArray(x_values) || !Array.isArray(y_values)) continue
    assert_series_lengths(data_series, series_idx)
    if (!(data_series.visible ?? true)) continue

    const get_x_error = error_getter(data_series.x_error)
    const get_y_error = error_getter(data_series.y_error)
    const get_metadata = prop_getter(data_series.metadata)
    const get_point_style = prop_getter(data_series.point_style)
    const get_point_hover = prop_getter(data_series.point_hover)
    const get_point_label = prop_getter(data_series.point_label)
    const get_point_offset = prop_getter(data_series.point_offset)

    const points: InternalPoint<Metadata>[] = []
    let x_min = Infinity
    let x_max = -Infinity
    let y_min = Infinity
    let y_max = -Infinity
    for (let point_idx = 0; point_idx < x_values.length; point_idx++) {
      const coord_x = x_values[point_idx]
      const coord_y = y_values[point_idx]
      if (!Number.isFinite(coord_x) || !Number.isFinite(coord_y)) continue
      if (coord_x < x_min) x_min = coord_x
      if (coord_x > x_max) x_max = coord_x
      if (coord_y < y_min) y_min = coord_y
      if (coord_y > y_max) y_max = coord_y
      const point: InternalPoint<Metadata> = {
        x: coord_x,
        y: coord_y,
        color_value: color_values?.[point_idx],
        metadata: get_metadata(point_idx),
        point_style: get_point_style(point_idx),
        point_hover: get_point_hover(point_idx),
        point_label: get_point_label(point_idx),
        point_offset: get_point_offset(point_idx),
        series_idx,
        point_idx,
        size_value: size_values?.[point_idx],
      }
      if (point_ids) point.point_id = point_ids[point_idx]
      if (get_x_error) point.x_error = get_x_error(point_idx)
      if (get_y_error) point.y_error = get_y_error(point_idx)
      points.push(point)
    }
    // orig_series_idx keeps auto-cycled colors/symbols stable across filtering
    out.push({
      ...data_series,
      visible: true,
      points,
      x_direction: points.every((point, idx) => idx === 0 || point.x >= points[idx - 1].x)
        ? 1
        : points.every((point, idx) => idx === 0 || point.x <= points[idx - 1].x)
          ? -1
          : 0,
      line_direction: strict_x_direction(x_values),
      point_bounds: { x: [x_min, x_max], y: [y_min, y_max] },
      _id: data_series.id ?? series_idx,
      orig_series_idx: series_idx,
    })
  }
  return out
}

// A layer's coordinates with each point missing either one masked to NaN: such a point is not
// drawn (materialize_series_points drops it), so neither coordinate nor its error bar may widen
// an axis. The masked copies are made at the first gap, so gap-free layers come back as given.
export function drawn_xy(
  xs: readonly number[],
  ys: readonly number[],
): { x: readonly number[]; y: readonly number[]; n_drawn: number } {
  let masked: { x: number[]; y: number[] } | null = null
  let n_drawn = 0
  for (let idx = 0; idx < xs.length; idx++) {
    if (Number.isFinite(xs[idx]) && Number.isFinite(ys[idx])) {
      n_drawn++
      continue
    }
    masked ??= { x: xs.slice(), y: ys.slice() }
    masked.x[idx] = NaN
    masked.y[idx] = NaN
  }
  return { ...(masked ?? { x: xs, y: ys }), n_drawn }
}

// Filter materialized series to the points within bounds. Full x/y arrays are kept on each
// returned series (via spread) so connecting lines can continue through off-range points;
// only filtered_data (rendered markers) is range-limited. Takes the output of
// materialize_series_points so callers cache it across pan/zoom frames.
type PreparedSeries<Metadata> = Omit<MaterializedSeries<Metadata>, `points`> & {
  filtered_data: InternalPoint<Metadata>[]
}

export function filter_series_to_ranges<Metadata = Record<string, unknown>>(
  materialized: readonly MaterializedSeries<Metadata>[],
  ranges: AxisRanges,
): PreparedSeries<Metadata>[] {
  const x_bounds = range_bounds(ranges.x)
  const x2_bounds = range_bounds(ranges.x2)
  const y_bounds = range_bounds(ranges.y)
  const y2_bounds = range_bounds(ranges.y2)

  const out: PreparedSeries<Metadata>[] = []
  for (const data_series of materialized) {
    const [x_lo, x_hi] = (data_series.x_axis ?? `x`) === `x2` ? x2_bounds : x_bounds
    const [y_lo, y_hi] = (data_series.y_axis ?? `y`) === `y2` ? y2_bounds : y_bounds
    const { points, x_direction, point_bounds } = data_series
    // Panning a padded view often leaves every point visible. Reuse the immutable point
    // array until a bound actually clips the dataset instead of allocating it every frame.
    const all_visible =
      point_bounds.x[0] >= x_lo &&
      point_bounds.x[1] <= x_hi &&
      point_bounds.y[0] >= y_lo &&
      point_bounds.y[1] <= y_hi
    const filtered_data: InternalPoint<Metadata>[] = all_visible ? points : []
    // Sorted curves/time series often show a tiny window of a long recording. Locate
    // that window once rather than scanning off-screen history on every pan frame.
    let start = 0
    let end = all_visible ? 0 : points.length
    if (!all_visible && x_direction !== 0) {
      start = partition_point(points, (point) =>
        x_direction > 0 ? point.x < x_lo : point.x > x_hi,
      )
      end = partition_point(points, (point) =>
        x_direction > 0 ? point.x <= x_hi : point.x >= x_lo,
      )
    }
    for (let point_idx = start; point_idx < end; point_idx++) {
      const point = points[point_idx]
      // NaN bounds fail both comparisons, so they reject every point
      if (point.x >= x_lo && point.x <= x_hi && point.y >= y_lo && point.y <= y_hi) {
        filtered_data.push(point)
      }
    }
    if (filtered_data.length > 0 || has_marker(data_series, `line`)) {
      const { points: _points, ...rest } = data_series
      out.push({ ...rest, filtered_data })
    }
  }
  return out
}

// Whether a series' line can reach the view: one whose vertices' bounding box misses it draws
// nothing there when its curve stays inside that box (linear, monotone, step and basis curves
// do; natural and Catmull-Rom ones overshoot). Underlays have vertices of their own, so a
// series with any is kept. A band structure's bands far from the shown energies are such lines.
export function line_reaches_view(
  series: Pick<MaterializedSeries, `x_axis` | `y_axis` | `line_style` | `line_underlays`> & {
    point_bounds: { x: Vec2; y: Vec2 }
  },
  ranges: AxisRanges,
  log_axes: ReadonlySet<AxisKey>,
): boolean {
  const curve = series.line_style?.curve
  if (curve === `natural` || curve === `catmull-rom` || series.line_underlays?.length)
    return true
  const x_key = series.x_axis === `x2` ? `x2` : `x`
  const y_key = series.y_axis === `y2` ? `y2` : `y`
  const [x_lo, x_hi] = range_bounds(ranges[x_key])
  const [y_lo, y_hi] = range_bounds(ranges[y_key])
  const { x, y } = series.point_bounds
  // NaN bounds fail every comparison, keeping the line. A log y axis draws lines below its
  // floor at the floor (log_floor_scale), so a line under it still shows along that edge; x
  // is not floored (series_projector.line), so a line left of a log x view draws nothing.
  const below_y = y[1] < y_lo && !log_axes.has(y_key)
  return !(x[1] < x_lo || x[0] > x_hi || below_y || y[0] > y_hi)
}

// Display style attached to each legend item (matches PlotLegend expectations)
type LegendDisplayStyle = LegendItem[`display_style`]

// Minimal shape of a computed fill region needed for legend entries
export type LegendFill = FillRegion & {
  idx: number
  source_type: `fill_region` | `error_band`
  source_idx: number
}

// Legend label of a series (legend and CSV export): its label, else a series-level
// `metadata: { label }` (scatter only), else `Series N` by input position.
export const scatter_series_label = <Metadata>(
  data_series: DataSeries<Metadata>,
  series_idx: number,
): string =>
  data_series.label ??
  (typeof data_series.metadata === `object` &&
  data_series.metadata !== null &&
  `label` in data_series.metadata &&
  typeof data_series.metadata.label === `string`
    ? data_series.metadata.label
    : `Series ${series_idx + 1}`)

// Legend rows in render order, for both the rendered legend and the solver's footprint tracker.
// A null series keeps its index (points and styles are looked up by it) but contributes no row,
// else the legend shows a phantom `Series N`.
export const scatter_legend_rows = <Metadata>(
  series: readonly DataSeries<Metadata>[],
): {
  series_idx: number
  label: string
  legend_group: string | undefined
  legend_key: string
}[] =>
  series.flatMap((data_series, series_idx) => {
    if (!data_series) return []
    const { legend_id, id: identifier, legend_group } = data_series
    const key = legend_id ?? identifier ?? series_idx
    return {
      series_idx,
      legend_key: JSON.stringify([legend_id != null ? `legend` : `id`, typeof key, key]),
      label: scatter_series_label(data_series, series_idx),
      legend_group,
    }
  })

// Shared legend IDs combine drawings; explicit series IDs otherwise stay separate.
export const legend_row_dedupe = () => {
  const seen = new Set<string>()
  return ({
    label,
    legend_group,
    legend_key,
  }: {
    label?: string
    legend_group?: string
    legend_key?: string
  }): boolean => {
    const key = legend_key ?? JSON.stringify([legend_group ?? ``, label ?? ``])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

// Shared by drawing and legend swatches, including the fallback when no stroke is authored.
export function scatter_line_style<Metadata>(
  series: DataSeries<Metadata>,
  series_idx: number,
  color_scale: (value: number) => string,
  override?: StyleOverrides[`line`],
) {
  const fill = shown_point_style(series)?.fill
  let color =
    override?.color ??
    series.line_style?.stroke ??
    (is_transparent_or_none(fill) ? undefined : fill)
  if (color == null) {
    const value = series.color_values?.find(is_finite_num)
    color = value != null ? color_scale(value) : plot_color(series_idx)
  }
  return {
    color,
    width: override?.width ?? series.line_style?.stroke_width ?? 2,
    dash: override?.dash ?? series.line_style?.line_dash,
    opacity: override?.opacity,
  }
}

// Legend rows of the series, first matching identity wins. Their legend_key never collides
// with a fill row's key, so they dedupe apart from the fills.
export function build_series_legend_items<Metadata = Record<string, unknown>>(
  series: readonly DataSeries<Metadata>[],
  color_scale_fn: (value: number) => string,
  styles: StyleOverrides = {},
  selected_series_idx = 0,
): LegendItem[] {
  const display_style_for = (
    data_series: DataSeries<Metadata>,
    series_idx: number,
  ): LegendDisplayStyle => {
    const series_default_color = plot_color(series_idx)
    const display_style: LegendDisplayStyle = {}
    const point_style = shown_point_style(data_series)
    const point_override = series_idx === selected_series_idx ? styles.point : undefined

    if (has_marker(data_series, `points`) && styles.show_points !== false) {
      display_style.symbol_type = styles.point?.symbol_type ?? get_series_symbol(series_idx)
      if (
        !Array.isArray(data_series.point_style) &&
        typeof point_style?.symbol_type === `string` &&
        symbol_names.includes(point_style.symbol_type)
      ) {
        display_style.symbol_type = point_style.symbol_type
      }
      const color_value = data_series.color_values?.[0]
      display_style.symbol_color = is_finite_num(color_value)
        ? color_scale_fn(color_value)
        : (point_override?.color ?? point_style?.fill ?? series_default_color)
      display_style.symbol_opacity = point_override?.opacity ?? point_style?.fill_opacity
      // Fall back to stroke when the fill is missing, none or fully transparent (zero alpha)
      const stroke = point_override?.stroke_color ?? point_style?.stroke
      const stroke_only = [`Plus`, `Times`, `Asterisk`].includes(display_style.symbol_type)
      if (stroke_only || (stroke && is_transparent_or_none(display_style.symbol_color))) {
        display_style.symbol_color = stroke ?? `currentColor`
        display_style.symbol_opacity =
          point_override?.stroke_opacity ??
          point_style?.stroke_opacity ??
          (stroke == null ? DEFAULTS.scatter.point.stroke_opacity : 1)
      }
    }

    if (has_marker(data_series, `line`) && styles.show_lines !== false) {
      const line = scatter_line_style(
        data_series,
        series_idx,
        color_scale_fn,
        series_idx === selected_series_idx ? styles.line : undefined,
      )
      display_style.line_color = line.color
      display_style.line_dash = line.dash
      display_style.line_opacity = line.opacity
    }

    return display_style
  }

  return scatter_legend_rows(series)
    .filter(legend_row_dedupe())
    .map((row) => ({
      ...row,
      visible: series[row.series_idx]?.visible ?? true,
      display_style: display_style_for(series[row.series_idx], row.series_idx),
    }))
}

// Legend rows of the labeled computed fills, first matching label and group wins
export const build_fill_legend_items = (computed_fills: readonly LegendFill[]): LegendItem[] =>
  computed_fills
    .filter((fill) => fill.show_in_legend !== false && fill.label)
    .filter(legend_row_dedupe())
    .map((fill) => {
      // Pass gradient for swatch rendering, or solid color as fallback
      const fill_gradient = is_fill_gradient(fill.fill) ? fill.fill : undefined
      const fill_color = typeof fill.fill === `string` ? fill.fill : undefined

      return {
        series_idx: -1, // Not a series
        fill_idx: fill.idx,
        fill_source_type: fill.source_type,
        fill_source_idx: fill.source_idx,
        item_type: `fill` as const,
        label: fill.label ?? ``,
        visible: fill.visible !== false,
        legend_group: fill.legend_group,
        display_style: {
          fill_color,
          fill_opacity: fill.fill_opacity ?? 0.3,
          edge_color: fill.edge_upper?.color,
          fill_gradient,
          pattern: fill.pattern,
        },
      }
    })

// Label of the first series row matching an earlier one in group, label and swatch, so readers
// can't tell them apart: usually one entry drawn as several series lacking a shared legend_id
export const lookalike_legend_label = (
  series_items: readonly LegendItem[],
): string | undefined =>
  first_duplicate(series_items, ({ label, legend_group, display_style }) =>
    JSON.stringify([legend_group, label, display_style]),
  )?.label

// The hovered point's visible color for its tooltip: color-scale value, then point fill, then
// point stroke (points marker), then the line color cascade (line marker: series stroke, first
// point fill, first color value, first point stroke). Undefined: PlotTooltip's neutral chip.
export function pick_tooltip_bg<Metadata = Record<string, unknown>>(
  point: { color_value?: number | null; point_style?: PointStyle },
  series: DataSeries<Metadata> | undefined,
  color_scale_fn: (value: number) => string,
): string | undefined {
  const { color_value, point_style } = point
  const scale = (value: number | null | undefined) =>
    value == null ? undefined : color_scale_fn(value)
  const candidates = [scale(color_value), point_style?.fill]
  const has_points = has_marker(series, `points`)
  if (has_points) candidates.push(point_style?.stroke)
  if (has_marker(series, `line`)) {
    const series_style = shown_point_style(series)
    candidates.push(
      series?.line_style?.stroke,
      series_style?.fill,
      scale(series?.color_values?.[0]),
    )
    if (has_points) candidates.push(series_style?.stroke)
  }
  return candidates.find((color): color is string => !is_transparent_or_none(color))
}

// Strict ordering enables bounded spline context. Duplicate/non-finite x values keep
// their original full path because d3 can coalesce those vertices internally.
export const strict_x_direction = (values: readonly number[]): -1 | 0 | 1 => {
  let previous = values[0]
  if (values.length < 2 || !Number.isFinite(previous)) return 0
  const direction = values[1] > previous ? 1 : -1
  for (let idx = 1; idx < values.length; idx++) {
    const value = values[idx]
    if (!Number.isFinite(value) || (direction > 0 ? value <= previous : value >= previous))
      return 0
    previous = value
  }
  return direction
}

// Retain boundary-crossing segments and enough neighboring vertices for d3's local
// monotone tangents. Natural/basis/Catmull–Rom curves retain their complete path.
export function project_line_points(
  data: Pick<DataSeries, `x` | `y` | `line_breaks`>,
  x_scale: (value: number) => number,
  y_scale: (value: number) => number,
  x_range: Vec2,
  direction: -1 | 0 | 1,
  curve: LineCurve = `monotone`,
): Vec2[] {
  const { x: coord_x, y: coord_y } = data
  let start = 0
  let end = coord_x.length
  const local_curve = curve === `linear` || curve === `step` || curve === `monotone`
  const [lower, upper] = [Math.min(...x_range), Math.max(...x_range)]
  const finite_at = (idx: number) =>
    Number.isFinite(x_scale(coord_x[idx])) && Number.isFinite(y_scale(coord_y[idx]))
  if (direction && local_curve && Number.isFinite(lower) && Number.isFinite(upper)) {
    const context = curve === `linear` ? 1 : 2
    const first = partition_point(coord_x, (value) =>
      direction > 0 ? value < lower : value > upper,
    )
    const last = partition_point(coord_x, (value) =>
      direction > 0 ? value <= upper : value >= lower,
    )
    // Count finite context vertices, since invalid projected points do not reach d3.
    start = first
    for (let count = 0; start > 0 && count < context;) if (finite_at(--start)) count++
    end = last
    for (let count = 0; end < coord_x.length && count < context; end++)
      if (finite_at(end)) count++
  }
  const points: Vec2[] = []
  // a NaN vertex before each break's first point ends the subpath there (Line skips it)
  const breaks = data.line_breaks ?? []
  let next_break = partition_point(breaks, (break_idx) => break_idx <= start)
  for (let idx = start; idx < end; idx++) {
    if (breaks[next_break] <= idx) {
      while (breaks[next_break] <= idx) next_break++ // repeated breaks (an empty branch)
      if (points.length > 0 && Number.isFinite(points.at(-1)?.[0])) points.push([NaN, NaN])
    }
    const pixel_x = x_scale(coord_x[idx])
    const pixel_y = y_scale(coord_y[idx])
    if (Number.isFinite(pixel_x) && Number.isFinite(pixel_y)) points.push([pixel_x, pixel_y])
  }
  return points
}
