// Shared utilities for interactive axis functionality

import type { BarSeries, DataSeries } from './types'

// Generic series type that covers both DataSeries and BarSeries
type AnySeries = DataSeries | BarSeries

// Merge new series with preserved UI state from old series
// Finds matching series by id first, then falls back to index matching
export function merge_series_state<T extends AnySeries>(
  old_series: T[],
  new_series: T[],
): T[] {
  return new_series.map((new_srs, idx) => {
    // Find matching old series by id, then by index
    const old_srs = old_series.find((srs) => srs.id === new_srs.id) ??
      old_series[idx]
    if (!old_srs) return new_srs

    // Preserve visibility and style properties from old series if not specified in new
    return {
      ...new_srs,
      visible: new_srs.visible ?? old_srs.visible,
      // DataSeries properties
      ...(`point_style` in old_srs && {
        point_style: (new_srs as DataSeries).point_style ??
          (old_srs as DataSeries).point_style,
      }),
      ...(`line_style` in old_srs && {
        line_style: (new_srs as DataSeries).line_style ??
          (old_srs as DataSeries).line_style,
      }),
      // BarSeries properties
      ...(`color` in old_srs && {
        color: (new_srs as BarSeries).color ?? (old_srs as BarSeries).color,
      }),
    } as T
  })
}

// Constants for axis label positioning
export const AXIS_LABEL_CONTAINER = {
  width: 200,
  height: 200,
  x_offset: 100, // half of width for centering
  y_offset: 10,
} as const
