// Pure binning/range helpers extracted from Histogram.svelte (no reactivity, no pixel scales) so the numeric logic is unit-testable.

import { bin, max } from 'd3-array'
import type { Vec2 } from '$lib/math'
import { get_nice_data_range } from '$lib/plot/core/scales'
import type { AxisConfig, DataSeries, ScaleType } from '$lib/plot/core/types'
import { get_scale_type_name } from '$lib/plot/core/types'

// [min, max] range where either bound may be null (unset)
type RangeLimit = [number | null, number | null]
// Shared x-domain + bin-count config for the binning helpers below
type BinConfig = { x_domain: Vec2; x2_domain: Vec2; bin_count: number }

// On a log axis any bound <= 0 is invalid, so treat it as unset (null): callers then fall back to
// the positive count-based bound rather than pinning the log domain at <= 0 (a broken scale).
export function log_safe_range(axis: Pick<AxisConfig, `range` | `scale_type`>): RangeLimit {
  const [lo, hi] = axis.range ?? [null, null]
  if (get_scale_type_name(axis.scale_type ?? `linear`) !== `log`) return [lo, hi]
  // drop any bound <= 0 (guard the type first: `null <= 0` is true in JS)
  const drop_non_positive = (bound: number | null) =>
    typeof bound === `number` && bound <= 0 ? null : bound
  return [drop_non_positive(lo), drop_non_positive(hi)]
}

// Bin each selected series over the domain of the x-axis it renders on (d3 bin() drops
// out-of-domain values). Pad-independent so the obstacle field can reuse it.
export function compute_histogram_bins(
  entries: readonly { series_data: DataSeries; series_idx: number }[],
  {
    x_domain,
    x2_domain,
    has_x2,
    bin_count,
    series_color,
  }: BinConfig & {
    has_x2: boolean
    series_color: (series_data: DataSeries) => string
  },
) {
  const hist_generator = bin().domain([x_domain[0], x_domain[1]]).thresholds(bin_count)
  const x2_hist_generator = has_x2
    ? bin().domain([x2_domain[0], x2_domain[1]]).thresholds(bin_count)
    : null
  return entries.map(({ series_data, series_idx }) => {
    const use_x2 = series_data.x_axis === `x2`
    const active_hist = use_x2 && x2_hist_generator ? x2_hist_generator : hist_generator
    const bins_arr = active_hist(series_data.y)
    return {
      id: series_data.id ?? series_idx,
      series_idx,
      label: series_data.label ?? `Series ${series_idx + 1}`,
      color: series_color(series_data),
      bins: bins_arr,
      max_count: max(bins_arr, (data) => data.length) ?? 0,
      x_axis: series_data.x_axis,
      y_axis: series_data.y_axis,
    }
  })
}

// Compute a nice [min, max] count range for a set of series, binning each over its own x-domain.
// On log count axes the lower bound sits just below the smallest non-empty bin so singleton tail
// bins don't collapse to zero height; linear/arcsinh axes start from 0.
export function compute_count_range(
  series_list: readonly DataSeries[],
  {
    x_domain,
    x2_domain,
    bin_count,
    scale_type,
    y_limit,
    range_padding,
  }: BinConfig & {
    scale_type: ScaleType
    y_limit: RangeLimit
    range_padding: number
  },
): Vec2 {
  const type_name = get_scale_type_name(scale_type)
  // no-data fallback: a positive floor on log (counts can't be <= 0), else 0
  const empty_range: Vec2 = [type_name === `log` ? 1 : 0, 1]
  if (series_list.length === 0) return empty_range
  const counts = series_list.flatMap((srs) => {
    const hist = bin()
      .domain(srs.x_axis === `x2` ? x2_domain : x_domain)
      .thresholds(bin_count)
    return hist(srs.y)
      .map((data) => data.length)
      .filter((count) => count > 0)
  })
  const max_count = Math.max(0, ...counts)

  if (max_count <= 0) return empty_range

  const min_count = type_name === `log` ? Math.min(...counts) : 0
  const [y0, y1] = get_nice_data_range(
    [
      { x: min_count, y: 0 },
      { x: max_count, y: 0 },
    ],
    ({ x }) => x,
    y_limit,
    scale_type,
    range_padding,
    false,
  )
  // For log count axes, start just below the smallest non-empty bin so singleton tail bins
  // don't collapse to zero height at the baseline. y_limit is pre-sanitized log-safe, so a null
  // (incl. dropped non-positive) lower correctly falls back to the positive minimum.
  if (type_name === `log`) return [y_limit[0] ?? min_count / 1.1, y1]

  // For linear/arcsinh, start from 0
  return [Math.max(0, y0), y1]
}
