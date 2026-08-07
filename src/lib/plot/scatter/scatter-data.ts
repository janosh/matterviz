// Pure data-transform helpers extracted from ScatterPlot.svelte. Everything here is
// stateless: component $state/$derived values are passed in as parameters.
import type { D3SymbolName } from '$lib/labels'
import { symbol_names } from '$lib/labels'
import type { DataSeries, FillRegion, InternalPoint, LegendItem, PointStyle } from '$lib/plot'
import { get_series_color, get_series_symbol } from '$lib/plot/core/data-transform'
import { is_fill_gradient } from '$lib/plot/core/fill-utils'
import { type AxisRanges, DEFAULT_MARKERS } from '$lib/plot/core/types'

export { type AxisRanges } from '$lib/plot/core/types'

// Sort a possibly-inverted range (axes may be reversed, e.g. [3.5, 1.4]) into [lo, hi]
// once per series so the per-point test is two bare comparisons.
const sorted_bounds = ([a, b]: readonly [number, number]): [number, number] =>
  a <= b ? [a, b] : [b, a]

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

// Filter series data to only include points within bounds and augment with internal data.
// Full x/y arrays are kept on each returned series (via spread) so connecting lines can
// continue through off-range points; only filtered_data (rendered markers) is range-limited.
//
// Perf: this runs on every pan/zoom/resize tick, so it tests raw x/y against the bounds
// *before* building an InternalPoint. Allocating first and filtering after made a zoomed-in
// view cost the same as the full view even when it dropped 96% of the points.
export function filter_series_to_ranges<Metadata = Record<string, unknown>>(
  series: readonly DataSeries<Metadata>[],
  ranges: AxisRanges,
): (DataSeries<Metadata> & { filtered_data: InternalPoint<Metadata>[] })[] {
  const x_bounds = sorted_bounds(ranges.x)
  const x2_bounds = sorted_bounds(ranges.x2)
  const y_bounds = sorted_bounds(ranges.y)
  const y2_bounds = sorted_bounds(ranges.y2)

  const out: (DataSeries<Metadata> & { filtered_data: InternalPoint<Metadata>[] })[] = []

  for (let series_idx = 0; series_idx < series.length; series_idx++) {
    const data_series = series[series_idx]
    // Missing and hidden series yield no points, and empty series are dropped below
    if (!data_series || !(data_series.visible ?? true)) continue

    const { x: xs, y: ys, color_values, size_values } = data_series
    const [x_lo, x_hi] = (data_series.x_axis ?? `x1`) === `x2` ? x2_bounds : x_bounds
    const [y_lo, y_hi] = (data_series.y_axis ?? `y1`) === `y2` ? y2_bounds : y_bounds

    const get_metadata = prop_getter(data_series.metadata)
    const get_point_style = prop_getter(data_series.point_style)
    const get_point_hover = prop_getter(data_series.point_hover)
    const get_point_label = prop_getter(data_series.point_label)
    const get_point_offset = prop_getter(data_series.point_offset)

    const filtered_data: InternalPoint<Metadata>[] = []
    for (let point_idx = 0; point_idx < xs.length; point_idx++) {
      // Number.isFinite also rejects null/undefined/NaN, matching the old in_range guard
      const x = xs[point_idx]
      if (!Number.isFinite(x) || !(x >= x_lo && x <= x_hi)) continue
      const y = ys[point_idx]
      if (!Number.isFinite(y) || !(y >= y_lo && y <= y_hi)) continue

      filtered_data.push({
        x,
        y,
        color_value: color_values?.[point_idx],
        metadata: get_metadata(point_idx),
        point_style: get_point_style(point_idx),
        point_hover: get_point_hover(point_idx),
        point_label: get_point_label(point_idx),
        point_offset: get_point_offset(point_idx),
        series_idx,
        point_idx,
        size_value: size_values?.[point_idx],
      })
    }

    // orig_series_idx keeps auto-cycled colors/symbols stable across filtering
    if (
      filtered_data.length > 0 ||
      (data_series.markers ?? DEFAULT_MARKERS).includes(`line`)
    ) {
      out.push({ ...data_series, visible: true, filtered_data, orig_series_idx: series_idx })
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

export type ScatterLegendItem = LegendItem & { has_explicit_label?: boolean }

// Prepare legend items from series + computed fill regions, deduplicated by
// legend_group::label (first occurrence wins across both series and fills)
export function build_legend_data<Metadata = Record<string, unknown>>(
  series: readonly DataSeries<Metadata>[],
  computed_fills: readonly LegendFill[],
  color_scale_fn: (value: number) => string,
): ScatterLegendItem[] {
  const items = series.map((data_series: DataSeries<Metadata>, series_idx: number) => {
    // Prefer top-level label, fall back to metadata label, then a generated default
    const explicit_label =
      data_series?.label ??
      (typeof data_series?.metadata === `object` &&
      data_series.metadata !== null &&
      `label` in data_series.metadata &&
      typeof data_series.metadata.label === `string`
        ? data_series.metadata.label
        : null)

    // Series-index defaults give auto-cycled colors/symbols
    const series_default_color = get_series_color(series_idx)
    const display_style: LegendDisplayStyle = {
      symbol_type: get_series_symbol(series_idx),
      symbol_color: series_default_color,
      line_color: series_default_color,
    }
    const series_markers = data_series?.markers ?? DEFAULT_MARKERS
    const first_point_style = Array.isArray(data_series?.point_style)
      ? data_series.point_style[0]
      : data_series?.point_style

    if (series_markers.includes(`points`)) {
      if (first_point_style) {
        if (
          typeof first_point_style.symbol_type === `string` &&
          symbol_names.includes(first_point_style.symbol_type)
        ) {
          display_style.symbol_type = first_point_style.symbol_type
        }
        if (first_point_style.fill) display_style.symbol_color = first_point_style.fill
        // Fall back to stroke when the fill is missing/none/transparent
        if (
          first_point_style.stroke &&
          (!display_style.symbol_color ||
            display_style.symbol_color === `none` ||
            display_style.symbol_color.startsWith(`rgba(`, 0))
        ) {
          display_style.symbol_color = first_point_style.stroke
        }
      }
    } else {
      // No points marker: no symbol swatch in the legend
      display_style.symbol_type = undefined
      display_style.symbol_color = undefined
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
          first_point_style?.fill ||
          first_point_style?.stroke ||
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

    return {
      series_idx,
      label: explicit_label ?? `Series ${series_idx + 1}`,
      visible: data_series?.visible ?? true,
      display_style,
      has_explicit_label: explicit_label != null,
      legend_group: data_series?.legend_group,
    }
  })

  // Deduplicate by legend_group::label (first occurrence wins, across series + fills)
  const seen_labels = new Set<string>()
  const first_seen = (group: string | undefined, label: string | undefined) => {
    const key = `${group ?? ``}::${label ?? ``}`
    if (seen_labels.has(key)) return false
    seen_labels.add(key)
    return true
  }
  const series_items = items.filter((item) => first_seen(item.legend_group, item.label))

  const fill_items = computed_fills
    .filter((fill) => fill.show_in_legend !== false && fill.label)
    .filter((fill) => first_seen(fill.legend_group, fill.label))
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
        },
      }
    })

  return [...series_items, ...fill_items]
}

const is_transparent_or_none = (color: string | undefined | null): boolean =>
  !color ||
  color === `none` ||
  color === `transparent` ||
  /rgba\([^)]+[,/]\s*0(?:\.0*)?\s*\)$/.test(color)

// Type-guard negation of is_transparent_or_none so usable colors narrow to string
const is_opaque_color = (color: string | undefined | null): color is string =>
  !is_transparent_or_none(color)

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
    const first_point_style = Array.isArray(series?.point_style)
      ? series.point_style[0]
      : series?.point_style
    const first_color_value = series?.color_values?.[0]
    let line_color_candidate = series?.line_style?.stroke
    if (is_transparent_or_none(line_color_candidate))
      line_color_candidate = first_point_style?.fill
    if (is_transparent_or_none(line_color_candidate) && first_color_value != null)
      line_color_candidate = color_scale_fn(first_color_value)
    if (is_transparent_or_none(line_color_candidate) && series_markers.includes(`points`))
      line_color_candidate = first_point_style?.stroke
    if (is_opaque_color(line_color_candidate)) return line_color_candidate
  }
  return `rgba(0, 0, 0, 0.7)`
}
