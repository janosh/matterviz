import type { D3SymbolName, DataSeries, Point } from '$lib/plot'

// Extract the primary color from a series data object.
// Checks line stroke, then point fill (handling arrays), with fallback to default blue.
export function extract_series_color(series_data: DataSeries): string {
  return series_data.line_style?.stroke ||
    (Array.isArray(series_data.point_style)
      ? series_data.point_style[0]?.fill
      : series_data.point_style?.fill) ||
    `#4682b4`
}

// Prepare legend data from series array
export const prepare_legend_data = (series: DataSeries[]): {
  series_idx: number
  label: string
  visible: boolean
  display_style: { symbol_type?: D3SymbolName; symbol_color: string }
}[] =>
  series.map((series_data, series_idx) => ({
    series_idx,
    label: series_data.label || `Series ${series_idx + 1}`,
    visible: series_data.visible ?? true,
    display_style: {
      symbol_type: `Square` as D3SymbolName,
      symbol_color: extract_series_color(series_data),
    },
  }))

// Filter visible series from series array
export function filter_visible_series(series: DataSeries[]): DataSeries[] {
  return series.filter((s) => s.visible ?? true)
}

// Create data points from series for analysis
export function create_data_points(
  series: DataSeries[],
  filter_fn?: (series: DataSeries) => boolean,
): Point[] {
  return series
    .filter(filter_fn || ((s) => s.visible ?? true))
    .flatMap(({ x: xs, y: ys }) => {
      const length = Math.min(xs.length, ys.length)
      console.error(`length mismatch: x.length=${xs.length} vs y.length=${ys.length}`)
      return xs.slice(0, length).map((x, idx) => ({ x, y: ys[idx] }))
    })
}
