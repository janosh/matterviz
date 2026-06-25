// Pure data-shaping logic for BarPlot: categorical x-value normalization,
// auto-range computation (incl. stacked totals + zero-clamping), stacked-bar
// offsets and grouped-bar layout info. Extracted from BarPlot.svelte so the
// math is unit-testable without mounting the component.

import type { Vec2 } from '$lib/math'
import { get_nice_data_range } from '$lib/plot/core/scales'
import type { BarMode, BarSeries, Orientation, ScaleType } from '$lib/plot/core/types'
import { get_scale_type_name } from '$lib/plot/core/types'

// Internal series shape with guaranteed numeric x (string categories mapped to integer indices)
export type NumericBarSeries<Metadata = Record<string, unknown>> = Omit<
  BarSeries<Metadata>,
  `x`
> & { x: readonly number[] }

// Map string x values (categories) to integer indices shared across all series.
// Numeric-only input is passed through unchanged (same array identity).
export function normalize_categorical<Metadata = Record<string, unknown>>(
  series: readonly BarSeries<Metadata>[],
  explicit_categories?: readonly string[],
): { category_list: string[]; internal_series: NumericBarSeries<Metadata>[] } {
  const is_categorical = series.some((srs) => srs.x.some((val) => typeof val === `string`))
  const category_list = !is_categorical
    ? []
    : explicit_categories?.length
      ? [...explicit_categories]
      : [...new Set(series.flatMap((srs) => srs.x.map(String)))]

  if (category_list.length === 0) {
    // safe: when no categories were found, all x values are numeric
    const internal_series = series as NumericBarSeries<Metadata>[]
    return { category_list, internal_series }
  }

  const category_indices = category_list.map((_, idx) => idx)
  const internal_series = series.map((srs) => {
    const orig_map = new Map(srs.x.map((val, idx) => [String(val), idx]))
    if (orig_map.size < srs.x.length) {
      console.warn(
        `BarPlot: series "${srs.label ?? `?`}" has duplicate x values — last occurrence wins`,
      )
    }
    // Resolve original index for each category (undefined if series lacks it)
    const orig_indices = category_list.map((cat) => orig_map.get(cat))
    const remap = <T>(arr: readonly T[] | null | undefined, fallback: T): T[] =>
      orig_indices.map((oi) => (oi != null ? (arr?.[oi] ?? fallback) : fallback))
    // Reorder a per-point prop that may be a single value (broadcast, left as-is) or an
    // array (must follow the category reordering, else point styles misalign with bars)
    const remap_per_point = <T>(prop: T[] | T | undefined): T[] | T | undefined =>
      Array.isArray(prop)
        ? (orig_indices.map((oi) => (oi != null ? prop[oi] : undefined)) as T[])
        : prop
    const bw_arr = Array.isArray(srs.bar_width) ? srs.bar_width : null
    const meta_arr = Array.isArray(srs.metadata) ? srs.metadata : null
    return {
      ...srs,
      x: category_indices,
      y: remap(srs.y, srs.render_mode === `line` ? NaN : 0),
      labels: remap(srs.labels, null),
      metadata: orig_indices.map((oi) =>
        oi != null ? (meta_arr ? meta_arr[oi] : srs.metadata) : undefined,
      ) as Metadata[],
      point_style: remap_per_point(srs.point_style),
      point_hover: remap_per_point(srs.point_hover),
      point_label: remap_per_point(srs.point_label),
      point_offset: remap_per_point(srs.point_offset),
      ...(bw_arr ? { bar_width: remap(bw_arr, 0.5) } : {}),
      ...(srs.color_values ? { color_values: remap(srs.color_values, null) } : {}),
      ...(srs.size_values ? { size_values: remap(srs.size_values, null) } : {}),
    } as NumericBarSeries<Metadata>
  })
  return { category_list, internal_series }
}

export interface BarAutoRangeOpts<Metadata = Record<string, unknown>> {
  visible_series: readonly NumericBarSeries<Metadata>[]
  y1_series: readonly NumericBarSeries<Metadata>[]
  y2_series: readonly NumericBarSeries<Metadata>[]
  x2_series: readonly NumericBarSeries<Metadata>[]
  mode: BarMode
  orientation: Orientation
  range_padding: number
  category_count: number // > 0 fixes the category axis to [-0.5, count - 0.5]
  x_range: [number | null, number | null]
  x_scale_type: ScaleType
  x_is_time: boolean
  x2_range: [number | null, number | null]
  x2_scale_type: ScaleType
  x2_is_time: boolean
  y_range: [number | null, number | null]
  y_scale_type: ScaleType
  y2_range: [number | null, number | null]
  y2_scale_type: ScaleType
}

// Compute data-driven axis ranges for all four axes. In stacked mode the value
// range covers per-x stacked totals (positive and negative stacks separately);
// for linear/arcsinh scales the value axis is clamped to include 0 when all
// values share one sign and no explicit range is set.
export function compute_bar_auto_ranges<Metadata = Record<string, unknown>>(
  opts: BarAutoRangeOpts<Metadata>,
): { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 } {
  const { visible_series, mode, orientation, range_padding, category_count } = opts

  const calc_y_range = (
    series_list: readonly NumericBarSeries<Metadata>[],
    y_limit: [number | null, number | null],
    scale_type: ScaleType,
  ): Vec2 => {
    let points = series_list.flatMap((srs) =>
      srs.x.map((x_val, idx) => ({ x: x_val, y: srs.y[idx] })),
    )

    // In stacked mode, calculate stacked totals for accurate range (only for bars on the same axis)
    if (mode === `stacked`) {
      const stacked_totals = new Map<number, { pos: number; neg: number }>()

      // Only include visible bar series (not lines) in stacking
      series_list
        .filter((srs) => srs.render_mode !== `line`)
        .forEach((srs) =>
          srs.x.forEach((x_val, idx) => {
            const y_val = srs.y[idx] ?? 0
            const totals = stacked_totals.get(x_val) ?? { pos: 0, neg: 0 }
            if (y_val >= 0) totals.pos += y_val
            else totals.neg += y_val
            stacked_totals.set(x_val, totals)
          }),
        )

      // Replace points with stacked totals + line series (which don't stack)
      points = [
        ...Array.from(stacked_totals).flatMap(([x_val, { pos, neg }]) => [
          ...(pos > 0 ? [{ x: x_val, y: pos }] : []),
          ...(neg < 0 ? [{ x: x_val, y: neg }] : []),
        ]),
        ...series_list
          .filter((srs) => srs.render_mode === `line`)
          .flatMap((srs) => srs.x.map((x_val, idx) => ({ x: x_val, y: srs.y[idx] }))),
      ]
    }

    if (points.length === 0) return [0, 1]

    let computed_y_range = get_nice_data_range(
      points,
      (pt) => pt.y,
      y_limit,
      scale_type,
      range_padding,
      false,
    )

    // Bar value axes include 0 when all values share one sign - unless an explicit
    // range is set or the scale is log (where 0 is invalid)
    const type_name = get_scale_type_name(scale_type)
    if (
      (type_name === `linear` || type_name === `arcsinh`) &&
      y_limit[0] == null &&
      y_limit[1] == null
    ) {
      const has_negative = points.some((pt) => pt.y < 0)
      const has_positive = points.some((pt) => pt.y > 0)
      if (has_positive && !has_negative) computed_y_range = [0, computed_y_range[1]]
      else if (has_negative && !has_positive) computed_y_range = [computed_y_range[0], 0]
    }

    return computed_y_range
  }

  const calc_x_range = (
    series_list: readonly NumericBarSeries<Metadata>[],
    limit: [number | null, number | null],
    scale_type: ScaleType,
    is_time: boolean,
  ): Vec2 => {
    const points = series_list.flatMap((srs) => srs.x.map((x_val) => ({ x: x_val, y: 0 })))
    if (points.length === 0) return [0, 1]
    return get_nice_data_range(points, (pt) => pt.x, limit, scale_type, range_padding, is_time)
  }

  // Categorical x axes use a fixed range centered on integer indices
  const x_auto_range: Vec2 =
    category_count > 0
      ? [-0.5, category_count - 0.5]
      : calc_x_range(
          visible_series.filter((srs) => (srs.x_axis ?? `x1`) === `x1`),
          opts.x_range,
          opts.x_scale_type,
          opts.x_is_time,
        )
  const { x2_series, x2_range, x2_scale_type, x2_is_time } = opts
  const x2_auto_range = calc_x_range(x2_series, x2_range, x2_scale_type, x2_is_time)

  const y1_range = calc_y_range(opts.y1_series, opts.y_range, opts.y_scale_type)
  const y2_auto_range = calc_y_range(opts.y2_series, opts.y2_range, opts.y2_scale_type)

  // Map data ranges to axis ranges depending on orientation
  return orientation === `horizontal`
    ? { x: y1_range, x2: x2_auto_range, y: x_auto_range, y2: y2_auto_range }
    : { x: x_auto_range, x2: x2_auto_range, y: y1_range, y2: y2_auto_range }
}

// Stack offsets indexed by [original series idx][bar idx] (only bar series in
// stacked mode contribute; hidden and line series get all-zero rows).
export function compute_stacked_offsets<Metadata = Record<string, unknown>>(
  internal_series: readonly NumericBarSeries<Metadata>[],
  mode: BarMode,
): number[][] {
  if (mode !== `stacked`) return []
  const offsets = internal_series.map((srs) => Array.from(srs.x, () => 0))
  // Cumulative totals keyed by axis/sign/x value so series with misaligned x grids
  // stack on the correct baseline (matching stacked totals in compute_bar_auto_ranges)
  const acc = new Map<string, number>()
  internal_series.forEach((srs, series_idx) => {
    if (!(srs?.visible ?? true) || srs.render_mode === `line`) return
    srs.x.forEach((x_val, bar_idx) => {
      const y_val = srs.y[bar_idx] ?? 0
      const key = `${srs.y_axis === `y2` ? `y2` : `y1`}:${y_val >= 0 ? `+` : `-`}:${x_val}`
      offsets[series_idx][bar_idx] = acc.get(key) ?? 0
      acc.set(key, (acc.get(key) ?? 0) + y_val)
    })
  })
  return offsets
}

export interface GroupInfo {
  bar_series_count: number
  bar_series_indices: number[] // original indices into internal_series of visible bar series
}

// Group positions for grouped mode (side-by-side bars). Indices are original
// series indices so hidden/line series don't shift visible bars' slots.
export function compute_group_info<Metadata = Record<string, unknown>>(
  internal_series: readonly NumericBarSeries<Metadata>[],
  mode: BarMode,
): GroupInfo {
  if (mode !== `grouped`) return { bar_series_count: 0, bar_series_indices: [] }
  const bar_series_indices = internal_series
    .map((srs, idx) => ((srs?.visible ?? true) && srs.render_mode !== `line` ? idx : -1))
    .filter((idx) => idx >= 0)
  return { bar_series_count: bar_series_indices.length, bar_series_indices }
}
