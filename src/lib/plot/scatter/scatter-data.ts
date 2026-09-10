// Pure data-transform helpers extracted from ScatterPlot.svelte. Everything here is
// stateless: component $state/$derived values are passed in as parameters.
import { partition_point, type Vec2 } from '$lib/math'
import { error_getter } from '$lib/plot/core/error-bars'
import type { D3SymbolName } from '$lib/labels'
import { plot_color } from '$lib/colors'
import { symbol_names } from '$lib/labels'
import { first_point_style, get_series_symbol } from '$lib/plot/core/data-transform'
import { is_fill_gradient } from '$lib/plot/core/fill-utils'
import { range_bounds } from '$lib/plot/core/interactions'
import type {
  AxisRanges,
  DataSeries,
  FillRegion,
  InternalPoint,
  LegendItem,
  LineCurve,
  PointStyle,
} from '$lib/plot/core/types'
import { assert_series_lengths, DEFAULT_MARKERS } from '$lib/plot/core/types'

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
    const { x: x_values, y: y_values, color_values, size_values } = data_series
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
    for (let point_idx = 0; point_idx < x_values.length; point_idx++) {
      const coord_x = x_values[point_idx]
      const coord_y = y_values[point_idx]
      if (!Number.isFinite(coord_x) || !Number.isFinite(coord_y)) continue
      points.push({
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
        ...(get_x_error && { x_error: get_x_error(point_idx) }),
        ...(get_y_error && { y_error: get_y_error(point_idx) }),
      })
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
      _id: data_series.id ?? series_idx,
      orig_series_idx: series_idx,
    })
  }
  return out
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
    const filtered_data: InternalPoint<Metadata>[] = []
    const { points, x_direction } = data_series
    // Sorted curves/time series often show a tiny window of a long recording. Locate
    // that window once rather than scanning off-screen history on every pan frame.
    let start = 0
    let end = points.length
    if (x_direction !== 0) {
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
    if (
      filtered_data.length > 0 ||
      (data_series.markers ?? DEFAULT_MARKERS).includes(`line`)
    ) {
      const { points: _points, ...rest } = data_series
      out.push({ ...rest, filtered_data })
    }
  }
  return out
}

// Display style attached to each legend item (matches PlotLegend expectations)
type LegendDisplayStyle = {
  symbol_type?: D3SymbolName
  symbol_color?: string
  line_color?: string
  line_dash?: string
}

// Minimal shape of a computed fill region needed for legend entries
export type LegendFill = FillRegion & {
  idx: number
  source_type: `fill_region` | `error_band`
  source_idx: number
}

// Legend label of a series. Scatter is the only chart that also accepts a label from
// series-level metadata (`metadata: { label }`).
const scatter_series_label = <Metadata>(data_series: DataSeries<Metadata>): string | null =>
  data_series?.label ??
  (typeof data_series?.metadata === `object` &&
  data_series.metadata !== null &&
  `label` in data_series.metadata &&
  typeof data_series.metadata.label === `string`
    ? data_series.metadata.label
    : null)

const is_transparent_or_none = (color: string | undefined | null): boolean =>
  !color ||
  color === `none` ||
  color === `transparent` ||
  /rgba\([^)]+[,/]\s*0(?:\.0*)?\s*\)$/.test(color)

// Type-guard negation of is_transparent_or_none so usable colors narrow to string
const is_opaque_color = (color: string | undefined | null): color is string =>
  !is_transparent_or_none(color)

// Legend rows in render order, for both the rendered legend and the solver's footprint tracker.
// A null series keeps its index (points and styles are looked up by it) but contributes no row,
// else the legend shows a phantom `Series N`.
export const scatter_legend_rows = <Metadata>(
  series: readonly DataSeries<Metadata>[],
): {
  series_idx: number
  label: string
  legend_group: string | undefined
  legend_key?: string
}[] =>
  series.flatMap((data_series, series_idx) => {
    if (!data_series) return []
    const { legend_id, id: identifier, legend_group } = data_series
    const key = legend_id ?? identifier
    return {
      series_idx,
      ...(key != null && {
        legend_key: JSON.stringify([legend_id != null ? `legend` : `id`, typeof key, key]),
      }),
      label: scatter_series_label(data_series) ?? `Series ${series_idx + 1}`,
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

// Prepare legend items from series + computed fill regions; first matching identity wins.
export function build_legend_data<Metadata = Record<string, unknown>>(
  series: readonly DataSeries<Metadata>[],
  computed_fills: readonly LegendFill[],
  color_scale_fn: (value: number) => string,
  // Marker shape override (StyleOverrides.point.symbol_type); swatches must match the markers
  default_symbol?: D3SymbolName,
): LegendItem[] {
  const display_style_for = (
    data_series: DataSeries<Metadata>,
    series_idx: number,
  ): LegendDisplayStyle => {
    // Series-index defaults give auto-cycled colors/symbols
    const series_default_color = plot_color(series_idx)
    const display_style: LegendDisplayStyle = {
      symbol_type: default_symbol ?? get_series_symbol(series_idx),
      symbol_color: series_default_color,
      line_color: series_default_color,
    }
    const series_markers = data_series?.markers ?? DEFAULT_MARKERS
    const point_style = first_point_style(data_series)

    if (!series_markers.includes(`points`)) {
      // No points marker: no symbol swatch in the legend
      display_style.symbol_type = undefined
      display_style.symbol_color = undefined
    } else if (point_style) {
      if (
        !Array.isArray(data_series?.point_style) &&
        typeof point_style.symbol_type === `string` &&
        symbol_names.includes(point_style.symbol_type)
      ) {
        display_style.symbol_type = point_style.symbol_type
      }
      if (point_style.fill) display_style.symbol_color = point_style.fill
      // Fall back to stroke when the fill is missing/none/transparent, by alpha channel: a
      // `startsWith('rgba(')` test called every rgba() color transparent.
      if (point_style.stroke && is_transparent_or_none(display_style.symbol_color)) {
        display_style.symbol_color = point_style.stroke
      }
    }

    if (series_markers.includes(`line`)) {
      // Explicit line stroke, then color scale, then point colors, then series default
      let line_color = data_series?.line_style?.stroke
      if (!line_color) {
        const first_cv = Array.isArray(data_series?.color_values)
          ? data_series?.color_values?.find((color_val: number | null) => color_val != null)
          : undefined
        /* oxlint-disable @typescript-eslint/prefer-nullish-coalescing -- empty-string colors should fall through */
        line_color =
          (first_cv != null ? color_scale_fn(first_cv) : undefined) ||
          point_style?.fill ||
          point_style?.stroke ||
          series_default_color
        /* oxlint-enable @typescript-eslint/prefer-nullish-coalescing */
      }
      display_style.line_color = line_color
      display_style.line_dash = data_series?.line_style?.line_dash
    } else {
      // No line marker: no line swatch in the legend
      display_style.line_dash = undefined
      display_style.line_color = undefined
    }

    return display_style
  }

  const first_seen = legend_row_dedupe()
  const series_items = scatter_legend_rows(series)
    .filter(first_seen)
    .map((row) => ({
      ...row,
      visible: series[row.series_idx]?.visible ?? true,
      display_style: display_style_for(series[row.series_idx], row.series_idx),
    }))

  const fill_items = computed_fills
    .filter((fill) => fill.show_in_legend !== false && fill.label)
    .filter(first_seen)
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

  return [...series_items, ...fill_items]
}

// Resolve tooltip background color: point color-scale value, then point fill, then point
// stroke (points marker), then line color cascade (line marker), then dark fallback
export function pick_tooltip_bg<Metadata = Record<string, unknown>>(
  point: { color_value?: number | null; point_style?: PointStyle },
  series: DataSeries<Metadata> | undefined,
  color_scale_fn: (value: number) => string,
): string {
  const { color_value, point_style } = point
  const series_markers = series?.markers ?? DEFAULT_MARKERS

  const scale_color = color_value != null ? color_scale_fn(color_value) : undefined
  if (is_opaque_color(scale_color)) return scale_color
  const fill_color = point_style?.fill
  if (is_opaque_color(fill_color)) return fill_color
  if (series_markers.includes(`points`)) {
    const stroke_color = point_style?.stroke
    if (is_opaque_color(stroke_color)) return stroke_color
  }
  if (series_markers.includes(`line`)) {
    const series_style = first_point_style(series)
    const first_color_value = series?.color_values?.[0]
    let line_color_candidate = series?.line_style?.stroke
    if (is_transparent_or_none(line_color_candidate)) line_color_candidate = series_style?.fill
    if (is_transparent_or_none(line_color_candidate) && first_color_value != null)
      line_color_candidate = color_scale_fn(first_color_value)
    if (is_transparent_or_none(line_color_candidate) && series_markers.includes(`points`))
      line_color_candidate = series_style?.stroke
    if (is_opaque_color(line_color_candidate)) return line_color_candidate
  }
  return `rgba(0, 0, 0, 0.7)`
}

// Strict ordering enables bounded spline context. Duplicate/non-finite x values keep
// their original full path because d3 can coalesce those vertices internally.
export const strict_x_direction = (values: readonly number[]): -1 | 0 | 1 => {
  if (values.length < 2 || !values.every(Number.isFinite)) return 0
  const direction = values[1] > values[0] ? 1 : -1
  return values.every((value, idx) => idx === 0 || (value - values[idx - 1]) * direction > 0)
    ? direction
    : 0
}

// Retain boundary-crossing segments and enough neighboring vertices for d3's local
// monotone tangents. Natural/basis/Catmull–Rom curves retain their complete path.
export function project_line_points(
  data: Pick<DataSeries, `x` | `y`>,
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
  for (let idx = start; idx < end; idx++) {
    const pixel_x = x_scale(coord_x[idx])
    const pixel_y = y_scale(coord_y[idx])
    if (Number.isFinite(pixel_x) && Number.isFinite(pixel_y)) points.push([pixel_x, pixel_y])
  }
  return points
}
