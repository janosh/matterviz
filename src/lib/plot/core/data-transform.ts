import type { D3SymbolName } from '$lib/labels'
import type { DataSeries, LegendItem, PointStyle } from '$lib/plot/core/types'
import { DEFAULT_SERIES_SYMBOLS } from '$lib/plot/core/types'
import { DEFAULTS } from '$lib/settings'

// Get auto-cycling symbol for series at given index (wraps every 7)
export const get_series_symbol = (series_idx: number): D3SymbolName =>
  DEFAULT_SERIES_SYMBOLS[series_idx % DEFAULT_SERIES_SYMBOLS.length]

// The style a series shows as a whole: its single PointStyle, or the first entry of a
// per-point array (nullish series yield undefined)
export const first_point_style = (
  series_data: { point_style?: PointStyle[] | PointStyle } | null | undefined,
): PointStyle | undefined =>
  Array.isArray(series_data?.point_style)
    ? series_data.point_style[0]
    : series_data?.point_style

// Extract the primary color from a series data object.
// Checks line stroke, then point fill (handling arrays), with fallback to default blue.
export const extract_series_color = (series_data: DataSeries): string =>
  series_data.line_style?.stroke ??
  first_point_style(series_data)?.fill ??
  DEFAULTS.scatter.point.color

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

// Swatch for charts whose legend shows a single symbol per series (Histogram, ...).
export const series_symbol_swatch = (
  series_data: DataSeries,
): { symbol_type: D3SymbolName; symbol_color: string } => ({
  // Prefer the series' symbol when present, falling back to settings. Per-point style
  // arrays have no single symbol to show, so they always take the default.
  symbol_type:
    (Array.isArray(series_data.point_style) ? null : series_data.point_style?.symbol_type) ??
    DEFAULTS.scatter.symbol_type,
  symbol_color: extract_series_color(series_data),
})

// Per-point value of an array-or-scalar prop: the element at idx, or the scalar for every idx
export const process_prop = <T>(
  prop: T[] | T | undefined | null,
  idx: number,
): T | undefined => (Array.isArray(prop) ? prop[idx] : (prop ?? undefined))
