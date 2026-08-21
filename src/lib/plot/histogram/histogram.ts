// Pure binning/range helpers for Histogram.svelte (no reactivity, no pixel scales). Bins are
// uniform in the x scale's transformed space (linear, log10, arcsinh) and counted in one pass
// into typed arrays, so a million samples bin in a few milliseconds.

import { LOG_EPS, type Vec2 } from '$lib/math'
import { accumulate_extent, empty_extent, nice_range_from_extent } from '$lib/plot/core/scales'
import type { AxisConfig, DataSeries, ScaleType } from '$lib/plot/core/types'
import { get_arcsinh_threshold, get_scale_type_name } from '$lib/plot/core/types'

// [min, max] range where either bound may be null (unset)
type RangeLimit = [number | null, number | null]

// How bar heights are scaled: raw counts, fraction of in-domain samples, or probability density
// (count / (total * bin width in data units), so the bars integrate to 1 even on log-spaced bins)
export const HISTOGRAM_NORMALIZE = [`count`, `probability`, `density`] as const
export type HistogramNormalize = (typeof HISTOGRAM_NORMALIZE)[number]

export interface HistogramBin {
  x0: number // lower edge (data units)
  x1: number // upper edge (data units)
  count: number // samples in [x0, x1) — the last bin also takes x1
  value: number // bar height after normalization (== count for `count`)
}

export interface BinnedSeries {
  id: string | number
  series_idx: number
  label: string
  color: string
  bins: HistogramBin[]
  x_axis?: `x1` | `x2`
  y_axis?: `y1` | `y2`
  max_value: number // tallest bar (0 when every bin is empty)
  min_value: number // shortest non-empty bar (Infinity when every bin is empty)
}

// Map data values into the space where bins are uniform and back. Log bins are uniform in
// log10(x), arcsinh bins in asinh(x / threshold); linear and time scales use the identity.
const bin_transform = (
  scale_type: ScaleType,
): { fwd: (val: number) => number; inv: (pos: number) => number } => {
  const name = get_scale_type_name(scale_type)
  if (name === `log`) return { fwd: Math.log10, inv: (pos) => 10 ** pos }
  if (name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    return {
      fwd: (val) => Math.asinh(val / threshold),
      inv: (pos) => Math.sinh(pos) * threshold,
    }
  }
  return { fwd: (val) => val, inv: (pos) => pos }
}

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

// Count `values` into `n_bins` uniform bins over `domain` (either order) in the scale's bin
// space. Values outside the domain and non-finite values are dropped; the upper bound lands in
// the last bin (numpy convention). On a log scale the domain is clamped to positive values. A
// collapsed domain yields one bin holding every sample equal to it. Returns `n_bins + 1` edges.
export function bin_values(
  values: ArrayLike<number>,
  domain: Vec2,
  n_bins: number,
  scale_type: ScaleType = `linear`,
): { edges: Float64Array; counts: Uint32Array } {
  let lo = Math.min(domain[0], domain[1])
  let hi = Math.max(domain[0], domain[1])
  const type_name = get_scale_type_name(scale_type)
  if (type_name === `log`) {
    lo = Math.max(lo, LOG_EPS)
    hi = Math.max(hi, LOG_EPS)
  }
  const n_values = values.length
  // Identity transform inlined on the linear path: the closure call costs ~70% on 1e6 samples
  const is_linear = type_name === `linear`
  const { fwd, inv } = bin_transform(scale_type)
  const pos_lo = fwd(lo)
  const pos_hi = fwd(hi)
  // A domain that is collapsed, invalid, or so narrow that it rounds to one point in bin space
  // (log10 of two adjacent doubles) gets one bin holding the samples inside it
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi) || !(pos_hi > pos_lo)) {
    let count = 0
    for (let idx = 0; idx < n_values; idx++) {
      if (values[idx] >= lo && values[idx] <= hi) count++
    }
    return { edges: Float64Array.of(lo, hi), counts: Uint32Array.of(count) }
  }
  const n = Math.max(1, Math.floor(n_bins))
  const scale = n / (pos_hi - pos_lo)
  const edges = new Float64Array(n + 1)
  for (let idx = 1; idx < n; idx++) {
    edges[idx] = is_linear ? lo + idx / scale : inv(pos_lo + idx / scale)
  }
  edges[0] = lo
  edges[n] = hi
  const counts = new Uint32Array(n)
  for (let idx = 0; idx < n_values; idx++) {
    const val = values[idx]
    // NaN fails both comparisons, so this also filters non-finite input
    if (!(val >= lo && val <= hi)) continue
    const pos = is_linear ? val : fwd(val)
    // clamp covers val === hi (-> last bin), then snap to the materialized edges so a value
    // sitting exactly on an edge lands in the upper bin even when fwd() rounds (log10(1000) < 3)
    let bin_idx = Math.min(n - 1, Math.max(0, Math.floor((pos - pos_lo) * scale)))
    if (val >= edges[bin_idx + 1] && bin_idx < n - 1) bin_idx++
    else if (val < edges[bin_idx] && bin_idx > 0) bin_idx--
    counts[bin_idx]++
  }
  return { edges, counts }
}

// Scale raw counts into bar heights. `probability` and `density` divide by the in-domain total,
// density additionally by each bin's width in data units.
export function normalize_counts(
  edges: Float64Array,
  counts: Uint32Array,
  normalize: HistogramNormalize,
): HistogramBin[] {
  let total = 0
  for (const count of counts) total += count
  return Array.from(counts, (count, idx) => {
    const [x0, x1] = [edges[idx], edges[idx + 1]]
    const value =
      normalize === `count` || total === 0
        ? count
        : normalize === `probability`
          ? count / total
          : count / (total * (x1 - x0 || 1))
    return { x0, x1, count, value }
  })
}

interface HistogramBinConfig {
  x_domain: Vec2
  x2_domain: Vec2
  x_scale_type?: ScaleType
  x2_scale_type?: ScaleType
  bins: number
  normalize?: HistogramNormalize
  series_color: (series_data: DataSeries) => string
}

// Bin each series over the domain of the x axis it renders on. Pad-independent so the legend
// obstacle field can reuse it.
export function compute_histogram_bins(
  entries: readonly { series_data: DataSeries; series_idx: number }[],
  config: HistogramBinConfig,
): BinnedSeries[] {
  const { bins: n_bins, normalize = `count`, series_color } = config
  return entries.map(({ series_data, series_idx }) => {
    const use_x2 = series_data.x_axis === `x2`
    const { edges, counts } = bin_values(
      series_data.y,
      use_x2 ? config.x2_domain : config.x_domain,
      n_bins,
      use_x2 ? config.x2_scale_type : config.x_scale_type,
    )
    const bins = normalize_counts(edges, counts, normalize)
    let max_value = 0
    let min_value = Infinity
    for (const { count, value } of bins) {
      if (count === 0) continue
      if (value > max_value) max_value = value
      if (value < min_value) min_value = value
    }
    return {
      id: series_data.id ?? series_idx,
      series_idx,
      label: series_data.label ?? `Series ${series_idx + 1}`,
      color: series_color(series_data),
      bins,
      x_axis: series_data.x_axis,
      y_axis: series_data.y_axis,
      max_value,
      min_value,
    }
  })
}

// Nice [min, max] value-axis range spanning a set of binned series. Linear/arcsinh axes start
// at 0; on a log axis the lower bound sits just below the shortest non-empty bar so singleton
// tail bins keep visible height.
export function compute_count_range(
  histograms: readonly Pick<BinnedSeries, `max_value` | `min_value`>[],
  {
    scale_type,
    y_limit,
    range_padding,
  }: { scale_type: ScaleType; y_limit: RangeLimit; range_padding: number },
): Vec2 {
  const type_name = get_scale_type_name(scale_type)
  let max_value = 0
  let min_value = Infinity
  for (const hist of histograms) {
    if (hist.max_value > max_value) max_value = hist.max_value
    if (hist.min_value < min_value) min_value = hist.min_value
  }
  // no-data fallback: a positive floor on log (counts can't be <= 0), else 0
  if (max_value === 0) return [type_name === `log` ? 1 : 0, 1]

  const min_count = type_name === `log` ? min_value : 0
  const [y0, y1] = nice_range_from_extent(
    accumulate_extent(empty_extent(), [min_count, max_value]),
    y_limit,
    scale_type,
    range_padding,
  )
  // Keep singleton log bins visible; a missing lower limit falls back to the positive minimum.
  if (type_name === `log`) return [y_limit[0] ?? min_count / 1.1, y1]
  return [Math.max(0, y0), y1]
}
