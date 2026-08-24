// Pure data-shaping logic for BarPlot: categorical x-value normalization,
// auto-range computation (incl. stacked totals + zero-clamping), stacked-bar
// offsets and grouped-bar layout info. Extracted from BarPlot.svelte so the
// math is unit-testable without mounting the component.

import type { Vec2 } from '$lib/math'
import { accumulate_extent, empty_extent, nice_range_from_extent } from '$lib/plot/core/scales'
import type {
  AxisConfig,
  BarMode,
  BarSeries,
  Orientation,
  ScaleType,
} from '$lib/plot/core/types'
import {
  assert_series_lengths,
  get_scale_type_name,
  is_time_scale,
} from '$lib/plot/core/types'

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
  series.forEach(assert_series_lengths)
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
      Array.isArray(prop) ? (remap<T | undefined>(prop, undefined) as T[]) : prop
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
    }
  })
  return { category_list, internal_series }
}

// Which series draw against the secondary value axis: y2 for vertical bars, x2 for horizontal
export const on_secondary_value_axis = (
  srs: Pick<BarSeries, `x_axis` | `y_axis`>,
  orientation: Orientation,
): boolean => (orientation === `vertical` ? srs.y_axis === `y2` : srs.x_axis === `x2`)

type AxisLimit = [number | null, number | null]
type RangeAxis = Pick<AxisConfig, `range` | `scale_type`>

export interface BarAutoRangeOpts<Metadata = Record<string, unknown>> {
  visible_series: readonly NumericBarSeries<Metadata>[]
  mode: BarMode
  orientation: Orientation
  range_padding: number
  category_count: number // > 0 gives the category axis a base range of [-0.5, count - 0.5]
  // Explicit ranges pin an axis; scale types pick log-safe fallbacks and time padding
  axes: Record<`x` | `x2` | `y` | `y2`, RangeAxis>
}

const empty_axis_range = (
  [lower, upper]: AxisLimit,
  scale_type: ScaleType,
  is_time = false,
): Vec2 => {
  if (get_scale_type_name(scale_type) === `log`) {
    if (lower !== null && lower > 0)
      return [lower, upper !== null && upper > 0 ? upper : lower * 10]
    if (upper !== null && upper > 0) return [upper / 10, upper]
    return [1, 10]
  }
  if (lower !== null && upper !== null) return [lower, upper]
  const span = is_time ? 86_400_000 : 1
  if (lower !== null) return [lower, lower + span]
  if (upper !== null) return [upper - span, upper]
  return [0, 1]
}

// Compute data-driven ranges for all four axes. Vertical bars put categories on x/x2 and
// values on y/y2, horizontal bars put categories on y and values on x/x2 (y2 is unused). In
// stacked mode the value range covers per-category stacked totals (positive and negative
// stacks separately); linear/arcsinh value axes are clamped to include 0 when all values
// share one sign and no explicit range is set.
export function compute_bar_auto_ranges<Metadata = Record<string, unknown>>(
  opts: BarAutoRangeOpts<Metadata>,
): { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 } {
  const { visible_series, mode, orientation, range_padding, category_count, axes } = opts
  const vertical = orientation === `vertical`
  // One axis's values of the points finite on both axes
  const finite_values = (series: NumericBarSeries<Metadata>, axis: `x` | `y`): number[] =>
    series.x.flatMap((x_value, point_idx) => {
      const y_value = series.y[point_idx]
      if (!Number.isFinite(x_value) || !Number.isFinite(y_value)) return []
      return [axis === `x` ? x_value : y_value]
    })
  const nice_range = (
    values: number[],
    limit: [number | null, number | null],
    scale_type: ScaleType,
    is_time = false,
  ): Vec2 =>
    nice_range_from_extent(
      accumulate_extent(empty_extent(), values),
      limit,
      scale_type,
      range_padding,
      is_time,
    )

  const get_bar_edge_range = (
    series_list: readonly NumericBarSeries<Metadata>[],
    scale_type: ScaleType,
  ): Vec2 | null => {
    let min_bar_edge = Number.POSITIVE_INFINITY
    let max_bar_edge = Number.NEGATIVE_INFINITY
    const is_log = get_scale_type_name(scale_type) === `log`
    for (const series of series_list) {
      if (series.render_mode === `line`) continue
      series.x.forEach((x_val, bar_idx) => {
        if (!Number.isFinite(x_val) || !Number.isFinite(series.y[bar_idx])) return
        const bar_width = Array.isArray(series.bar_width)
          ? (series.bar_width[bar_idx] ?? 0.5)
          : (series.bar_width ?? 0.5)
        const half_width = Math.abs(bar_width) / 2
        const left_edge = x_val - half_width
        const right_edge = x_val + half_width
        if (Number.isFinite(left_edge) && (!is_log || left_edge > 0)) {
          min_bar_edge = Math.min(min_bar_edge, left_edge)
        }
        if (Number.isFinite(right_edge) && (!is_log || right_edge > 0)) {
          max_bar_edge = Math.max(max_bar_edge, right_edge)
        }
      })
    }
    return Number.isFinite(min_bar_edge) && Number.isFinite(max_bar_edge)
      ? [min_bar_edge, max_bar_edge]
      : null
  }

  const calc_value_range = (
    series_list: readonly NumericBarSeries<Metadata>[],
    { range: limit = [null, null], scale_type = `linear` }: RangeAxis,
  ): Vec2 => {
    const type_name = get_scale_type_name(scale_type)
    let values = series_list.flatMap((srs) => finite_values(srs, `y`))

    // In stacked mode, calculate stacked totals for accurate range (only for bars on the same axis)
    if (mode === `stacked`) {
      const stacked_totals = new Map<number, { pos: number; neg: number }>()

      // Only include visible bar series (not lines) in stacking
      series_list
        .filter((srs) => srs.render_mode !== `line`)
        .forEach((srs) =>
          srs.x.forEach((x_val, idx) => {
            const y_val = srs.y[idx]
            if (!Number.isFinite(x_val) || !Number.isFinite(y_val)) return
            const totals = stacked_totals.get(x_val) ?? { pos: 0, neg: 0 }
            if (y_val >= 0) totals.pos += y_val
            else totals.neg += y_val
            stacked_totals.set(x_val, totals)
          }),
        )

      // Replace values with stacked totals + line series (which don't stack)
      values = [
        ...Array.from(stacked_totals.values()).flatMap(({ pos, neg }) => [
          ...(pos > 0 ? [pos] : []),
          ...(neg < 0 ? [neg] : []),
        ]),
        ...series_list
          .filter((srs) => srs.render_mode === `line`)
          .flatMap((srs) => finite_values(srs, `y`)),
      ]
    }

    // Zero and negative bars have no log image; they'd otherwise drag the range to LOG_EPS
    if (type_name === `log`) values = values.filter((val) => val > 0)
    if (values.length === 0) return empty_axis_range(limit, scale_type)

    let computed_range = nice_range(values, limit, scale_type)

    // Bar value axes include 0 when all values share one sign - unless an explicit
    // range is set or the scale is log (where 0 is invalid)
    if (
      (type_name === `linear` || type_name === `arcsinh`) &&
      limit[0] == null &&
      limit[1] == null
    ) {
      const has_negative = values.some((val) => val < 0)
      const has_positive = values.some((val) => val > 0)
      if (has_positive && !has_negative) computed_range = [0, computed_range[1]]
      else if (has_negative && !has_positive) computed_range = [computed_range[0], 0]
    }

    return computed_range
  }

  const calc_category_range = (
    series_list: readonly NumericBarSeries<Metadata>[],
    { range: limit = [null, null], scale_type = `linear` }: RangeAxis,
  ): Vec2 => {
    const is_time = is_time_scale(scale_type)
    const values = series_list.flatMap((srs) => finite_values(srs, `x`))
    if (values.length === 0) return empty_axis_range(limit, scale_type, is_time)
    const range = nice_range(values, limit, scale_type, is_time)
    // Numeric category ranges are based on bar centers, so include each bar's
    // outer edges to keep the first and last bars inside the chart clip.
    const bar_edges = get_bar_edge_range(series_list, scale_type)
    if (!bar_edges) return range
    return [
      limit[0] === null ? Math.min(range[0], bar_edges[0]) : range[0],
      limit[1] === null ? Math.max(range[1], bar_edges[1]) : range[1],
    ]
  }

  // Horizontal bars carry every category on y; vertical bars may split them across x and x2.
  const cat_series = vertical
    ? visible_series.filter((srs) => srs.x_axis !== `x2`)
    : visible_series
  const cat_axis = vertical ? axes.x : axes.y
  // Categorical axes reserve one unit per slot, expanding for explicitly wider bars.
  const categorical_edges = get_bar_edge_range(cat_series, `linear`)
  const cat_range: Vec2 =
    category_count > 0
      ? [
          Math.min(-0.5, categorical_edges?.[0] ?? -0.5),
          Math.max(category_count - 0.5, categorical_edges?.[1] ?? category_count - 0.5),
        ]
      : calc_category_range(cat_series, cat_axis)
  const val_range = calc_value_range(
    visible_series.filter((srs) => !on_secondary_value_axis(srs, orientation)),
    vertical ? axes.y : axes.x,
  )
  const val2_range = calc_value_range(
    visible_series.filter((srs) => on_secondary_value_axis(srs, orientation)),
    vertical ? axes.y2 : axes.x2,
  )
  if (!vertical) return { x: val_range, x2: val2_range, y: cat_range, y2: [0, 1] }
  const cat2_range = calc_category_range(
    visible_series.filter((srs) => srs.x_axis === `x2`),
    axes.x2,
  )
  return { x: cat_range, x2: cat2_range, y: val_range, y2: val2_range }
}

// Stack offsets indexed by [original series idx][bar idx] (only bar series in
// stacked mode contribute; hidden and line series get all-zero rows).
export function compute_stacked_offsets<Metadata = Record<string, unknown>>(
  internal_series: readonly NumericBarSeries<Metadata>[],
  mode: BarMode,
  orientation: Orientation = `vertical`,
): number[][] {
  if (mode !== `stacked`) return []
  const offsets = internal_series.map((srs) => Array.from(srs.x, () => 0))
  // Cumulative totals keyed by value axis/sign/category so series with misaligned x grids
  // stack on the correct baseline (matching stacked totals in compute_bar_auto_ranges)
  const acc = new Map<string, number>()
  internal_series.forEach((srs, series_idx) => {
    if (!(srs?.visible ?? true) || srs.render_mode === `line`) return
    const axis = on_secondary_value_axis(srs, orientation) ? `2` : `1`
    srs.x.forEach((x_val, bar_idx) => {
      const y_val = srs.y[bar_idx]
      if (!Number.isFinite(x_val) || !Number.isFinite(y_val)) return
      const key = `${axis}:${y_val >= 0 ? `+` : `-`}:${x_val}`
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
