// Pure screen-space geometry for BarPlot rendering: line-series point
// construction and per-bar rect computation. Extracted from BarPlot.svelte's
// template so the coordinate math is unit-testable.

import { process_prop } from '$lib/plot/core/data-transform'
import type { BarMode, InternalPoint, Orientation } from '$lib/plot/core/types'
import type { GroupInfo, NumericBarSeries } from './data'

// Point with computed screen coordinates plus original data values
export type LineSeriesPoint<Metadata = Record<string, unknown>> = InternalPoint<Metadata> & {
  x: number // Screen x coordinate
  y: number // Screen y coordinate
  data_x: number // Original data x value
  data_y: number // Original data y value
  idx: number // Index in series
}

// Build screen-space points for a line series (lines don't stack - they show
// absolute values). Non-finite points (NaN/Infinity coords) are dropped.
export function compute_line_points<Metadata = Record<string, unknown>>(opts: {
  series: NumericBarSeries<Metadata>
  series_idx: number
  orientation: Orientation
  x_scale: (val: number) => number // the series' x scale (x or x2); carries values in horizontal mode
  y_scale: (val: number) => number // the series' y scale (y or y2)
  cat_y_scale: (val: number) => number // primary y scale (carries categories in horizontal mode)
}): LineSeriesPoint<Metadata>[] {
  const { series: srs, series_idx, orientation, x_scale, y_scale, cat_y_scale } = opts
  return srs.x
    .map((x_val, idx) => {
      const y_val = srs.y[idx]
      const plot_x = orientation === `vertical` ? x_scale(x_val) : x_scale(y_val)
      const plot_y = orientation === `vertical` ? y_scale(y_val) : cat_y_scale(x_val)
      const metadata = Array.isArray(srs.metadata) ? srs.metadata[idx] : srs.metadata
      return {
        x: plot_x,
        y: plot_y,
        data_x: x_val,
        data_y: y_val,
        idx,
        color_value: srs.color_values?.[idx] ?? null,
        size_value: srs.size_values?.[idx] ?? null,
        point_style: process_prop(srs.point_style, idx),
        point_hover: process_prop(srs.point_hover, idx),
        point_label: process_prop(srs.point_label, idx),
        point_offset: process_prop(srs.point_offset, idx),
        metadata,
        series_idx,
        point_idx: idx,
      } as LineSeriesPoint<Metadata>
    })
    .filter((pt) => isFinite(pt.x) && isFinite(pt.y))
}

export interface BarRect {
  c0: number // category-axis screen coord of bar start
  c1: number // category-axis screen coord of bar end
  v0: number // value-axis screen coord of bar base
  v1: number // value-axis screen coord of bar tip
  rect_x: number
  rect_y: number
  rect_w: number
  rect_h: number
}

// Screen-space rect for one bar: category extent (c0/c1) from bar width +
// grouped offset, value extent (v0/v1) from stacked base to base + value.
// Rects get min 1px width so thin bars stay visible.
export function compute_bar_rect(opts: {
  cat_val: number
  val: number
  base: number // stacked baseline in data units (0 unless stacked)
  bar_width_val: number
  series_idx: number
  mode: BarMode
  orientation: Orientation
  group_info: GroupInfo
  cat_scale: (val: number) => number
  val_scale: (val: number) => number
}): BarRect {
  const { cat_val, val, base, bar_width_val, series_idx, mode, group_info } = opts
  const { cat_scale, val_scale } = opts
  const is_vertical = opts.orientation === `vertical`
  const grouped = mode === `grouped` && group_info.bar_series_count > 1
  const half = grouped ? bar_width_val / (2 * group_info.bar_series_count) : bar_width_val / 2
  // Offset uses the series' slot among visible bar series (original-index lookup)
  const group_offset = grouped
    ? (group_info.bar_series_indices.indexOf(series_idx) -
        (group_info.bar_series_count - 1) / 2) *
      (bar_width_val / group_info.bar_series_count)
    : 0
  const c0 = cat_scale(cat_val + group_offset - half)
  const c1 = cat_scale(cat_val + group_offset + half)
  const v0 = val_scale(base)
  const v1 = val_scale(base + val)
  const [rect_x, rect_y] = is_vertical
    ? [Math.min(c0, c1), Math.min(v0, v1)]
    : [Math.min(v0, v1), Math.min(c0, c1)]
  const [rect_w, rect_h] = is_vertical
    ? [Math.max(1, Math.abs(c1 - c0)), Math.max(0, Math.abs(v1 - v0))]
    : [Math.max(1, Math.abs(v1 - v0)), Math.max(0, Math.abs(c1 - c0))]
  return { c0, c1, v0, v1, rect_x, rect_y, rect_w, rect_h }
}
