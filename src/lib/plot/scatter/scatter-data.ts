// Pure data-transform helpers extracted from ScatterPlot.svelte. Everything here is
// stateless: component $state/$derived values are passed in as parameters.
import type { D3SymbolName } from '$lib/labels'
import { symbol_names } from '$lib/labels'
import type { DataSeries, FillRegion, InternalPoint, LegendItem, PointStyle } from '$lib/plot'
import {
  get_series_color,
  get_series_symbol,
  process_prop,
} from '$lib/plot/core/data-transform'
import { is_fill_gradient } from '$lib/plot/core/fill-utils'
import { type AxisRanges, DEFAULT_MARKERS } from '$lib/plot/core/types'

export { type AxisRanges } from '$lib/plot/core/types'

const in_range = (val: number | null | undefined, lo: number, hi: number) =>
  val != null && !isNaN(val) && val >= Math.min(lo, hi) && val <= Math.max(lo, hi)

// Filter series data to only include points within bounds and augment with internal data.
// Full x/y arrays are kept on each returned series (via spread) so connecting lines can
// continue through off-range points; only filtered_data (rendered markers) is range-limited.
export function filter_series_to_ranges<Metadata = Record<string, unknown>>(
  series: readonly DataSeries<Metadata>[],
  ranges: AxisRanges,
): (DataSeries<Metadata> & { filtered_data: InternalPoint<Metadata>[] })[] {
  const [x_min, x_max] = ranges.x
  const [x2_min, x2_max] = ranges.x2
  const [y_min, y_max] = ranges.y
  const [y2_min, y2_max] = ranges.y2

  return (
    series
      .map((data_series: DataSeries<Metadata>, series_idx): DataSeries<Metadata> => {
        if (!data_series) {
          return {
            x: [],
            y: [],
            visible: true,
            filtered_data: [],
            _id: series_idx,
            orig_series_idx: series_idx,
          }
        }
        if (!(data_series.visible ?? true)) {
          return {
            ...data_series,
            visible: false,
            filtered_data: [],
            orig_series_idx: series_idx,
          }
        }

        const { x: xs, y: ys, color_values, size_values, ...series_rest } = data_series
        const processed_points: InternalPoint<Metadata>[] = xs.map(
          (x_val: number, point_idx: number) => ({
            x: x_val,
            y: ys[point_idx],
            color_value: color_values?.[point_idx],
            metadata: process_prop(series_rest.metadata, point_idx),
            point_style: process_prop(series_rest.point_style, point_idx),
            point_hover: process_prop(series_rest.point_hover, point_idx),
            point_label: process_prop(series_rest.point_label, point_idx),
            point_offset: process_prop(series_rest.point_offset, point_idx),
            series_idx,
            point_idx,
            size_value: size_values?.[point_idx],
          }),
        )

        // Filter to plot bounds using the series' assigned axes (in_range handles
        // inverted ranges like [3.5, 1.4])
        const [series_x_min, series_x_max] =
          (data_series.x_axis ?? `x1`) === `x2` ? [x2_min, x2_max] : [x_min, x_max]
        const [series_y_min, series_y_max] =
          (data_series.y_axis ?? `y1`) === `y2` ? [y2_min, y2_max] : [y_min, y_max]
        const filtered_data = processed_points.filter(
          ({ x, y }) =>
            in_range(x, series_x_min, series_x_max) && in_range(y, series_y_min, series_y_max),
        )

        // orig_series_idx keeps auto-cycled colors/symbols stable across filtering
        return { ...data_series, visible: true, filtered_data, orig_series_idx: series_idx }
      })
      // Drop series left completely empty after point filtering
      .filter(
        (srs): srs is DataSeries<Metadata> & { filtered_data: InternalPoint<Metadata>[] } =>
          (srs.filtered_data?.length ?? 0) > 0,
      )
  )
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

    if (series_markers?.includes(`points`)) {
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

    if (series_markers?.includes(`line`)) {
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
  if (series_markers?.includes(`points`)) {
    const stroke_color = point_style?.stroke
    if (is_opaque_color(stroke_color)) return stroke_color
  }
  if (series_markers?.includes(`line`)) {
    const line_style = series?.line_style ?? {}
    const first_point_style = Array.isArray(series?.point_style)
      ? series?.point_style[0]
      : series?.point_style
    const first_color_value = series?.color_values?.[0]
    let line_color_candidate = line_style.stroke
    if (is_transparent_or_none(line_color_candidate)) {
      line_color_candidate = first_point_style?.fill
    }
    if (is_transparent_or_none(line_color_candidate) && first_color_value != null)
      line_color_candidate = color_scale_fn(first_color_value)
    if (is_transparent_or_none(line_color_candidate) && series_markers?.includes(`points`))
      line_color_candidate = first_point_style?.stroke
    if (is_opaque_color(line_color_candidate)) return line_color_candidate
  }
  return `rgba(0, 0, 0, 0.7)`
}
