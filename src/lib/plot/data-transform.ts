import type { D3SymbolName } from '$lib/labels'
import type { DataSeries, Point } from '$lib/plot'
import { DEFAULT_SERIES_COLORS, DEFAULT_SERIES_SYMBOLS } from '$lib/plot/types'
import { DEFAULTS } from '$lib/settings'

// Get auto-cycling color for series at given index (wraps every 10)
export const get_series_color = (series_idx: number): string =>
  DEFAULT_SERIES_COLORS[series_idx % DEFAULT_SERIES_COLORS.length]

// Get auto-cycling symbol for series at given index (wraps every 7)
export const get_series_symbol = (series_idx: number): D3SymbolName =>
  DEFAULT_SERIES_SYMBOLS[series_idx % DEFAULT_SERIES_SYMBOLS.length]

// Extract the primary color from a series data object.
// Checks line stroke, then point fill (handling arrays), with fallback to default blue.
export const extract_series_color = (series_data: DataSeries): string =>
  series_data.line_style?.stroke ||
  (Array.isArray(series_data.point_style)
    ? series_data.point_style[0]?.fill
    : series_data.point_style?.fill) ||
  `#4A9EFF`

// Prepare legend data from series array
export const prepare_legend_data = (series: DataSeries[]): {
  series_idx: number
  label: string
  visible: boolean
  display_style: { symbol_type: D3SymbolName; symbol_color: string }
}[] =>
  series.map((series_data, series_idx) => ({
    series_idx,
    label: series_data.label ?? `Series ${series_idx + 1}`,
    visible: series_data.visible ?? true,
    display_style: { // Prefer the series’ symbol when present, falling back to settings
      symbol_type: !Array.isArray(series_data.point_style)
        ? (series_data.point_style?.symbol_type ?? DEFAULTS.scatter.symbol_type)
        : DEFAULTS.scatter.symbol_type,
      symbol_color: extract_series_color(series_data),
    },
  }))

// Create data points from series for analysis
export const create_data_points = (
  series: DataSeries[],
  filter_fn?: (series: DataSeries) => boolean,
): Point[] =>
  series
    .filter(filter_fn || ((srs) => srs.visible ?? true))
    .flatMap(({ x: xs, y: ys }, series_idx) => {
      const length = Math.min(xs.length, ys.length)
      if (xs.length !== ys.length) {
        console.warn(
          `length mismatch in series ${series_idx}: x.length=${xs.length} vs y.length=${ys.length}`,
        )
      }
      return xs.slice(0, length).map((x, idx) => ({ x, y: ys[idx] }))
    })

// Process array or scalar properties for indexed access.
// If prop is an array, returns the element at the given index.
// If prop is a scalar, returns the scalar (applied to all indices).
// Returns undefined if prop is null/undefined.
export function process_prop<T>(
  prop: T[] | T | undefined | null,
  idx: number,
): T | undefined {
  if (prop === null || prop === undefined) return undefined
  return Array.isArray(prop) ? prop[idx] : prop
}
