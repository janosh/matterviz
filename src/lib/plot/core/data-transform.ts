import type { D3SymbolName } from '#lib/labels.js'
import type { DataSeries, LegendItem, PointStyle } from '#lib/plot/core/types.js'
import { DEFAULT_SERIES_SYMBOLS } from '#lib/plot/core/types.js'
import { DEFAULTS } from '#lib/settings.js'
import { html_to_text } from '#lib/utils.js'

// Get auto-cycling symbol for series at given index (wraps every 7)
export const get_series_symbol = (series_idx: number): D3SymbolName =>
  DEFAULT_SERIES_SYMBOLS[series_idx % DEFAULT_SERIES_SYMBOLS.length]

export const is_transparent_or_none = (color: string | undefined | null): boolean =>
  !color ||
  color === `none` ||
  color === `transparent` ||
  /rgba\([^)]+[,/]\s*0(?:\.0*)?\s*\)$/.test(color)

// The point style a series shows as a whole (line colour, legend symbol, style controls): the
// first whose fill shows (unset draws the series colour), else the first. A hollow first point
// (e.g. a flagged one) says nothing about the series' colour. Nullish series yield undefined.
export const shown_point_style = (
  series_data: { point_style?: PointStyle[] | PointStyle } | null | undefined,
): PointStyle | undefined => {
  const styles = [series_data?.point_style ?? []].flat()
  return (
    styles.find((style) => !style?.fill || !is_transparent_or_none(style.fill)) ?? styles[0]
  )
}

// A series' color as a whole: line stroke, else its shown point's fill, else `fallback`
export const extract_series_color = (
  series_data: Pick<DataSeries, `line_style` | `point_style`> | null | undefined,
  fallback: string = DEFAULTS.scatter.point.color,
): string =>
  series_data?.line_style?.stroke ?? shown_point_style(series_data)?.fill ?? fallback

// Minimal series shape every chart's legend entry is derived from.
type LegendSeries = { label?: string | null; visible?: boolean; legend_group?: string }

// One legend-entry envelope for every chart: same label fallback, visibility source and
// group. Charts supply only the swatch (display_style) and, where the domain calls for it, a
// different generated label (e.g. BoxPlot's `Box N`).
export function build_legend_items<Series extends LegendSeries>(
  series: readonly Series[],
  display_style: (series_data: Series, series_idx: number) => LegendItem[`display_style`],
  opts: { default_label?: (series_idx: number) => string } = {},
): LegendItem[] {
  const { default_label = (idx: number) => `Series ${idx + 1}` } = opts
  return series.map((series_data, series_idx) => ({
    series_idx,
    label: series_data?.label ?? default_label(series_idx),
    visible: series_data?.visible ?? true,
    legend_group: series_data?.legend_group,
    display_style: display_style(series_data, series_idx),
  }))
}

// A series' label as plain text (aria labels, select options), else its generated `Series N`
export const series_text = (label: string | null | undefined, series_idx: number): string =>
  label ? html_to_text(label) : `Series ${series_idx + 1}`

// Per-point value of an array-or-scalar prop: the element at idx, or the scalar for every idx
export const process_prop = <T>(
  prop: T[] | T | undefined | null,
  idx: number,
): T | undefined => (Array.isArray(prop) ? prop[idx] : (prop ?? undefined))
