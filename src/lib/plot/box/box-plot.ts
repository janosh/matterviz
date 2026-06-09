// Box plot statistics: compute quartiles, whiskers and outliers from a raw distribution.
// Single source of truth for the quantile math used by BoxPlot.svelte.

import { ascending } from 'd3-array'
import type { Vec2 } from '$lib/math'
import { quantile_unordered } from '$lib/plot/box/quantile'
import type { HandlerProps } from '$lib/plot/core/types'
import { DEFAULTS } from '$lib/settings'

// === Box plot types ===
// How box plot whiskers are computed from a raw distribution
export type WhiskerMode = `tukey` | `minmax` | `percentile` | `std`

// Which glyph(s) to draw per series: a box, a violin (KDE density), or both
export type ViolinKind = `box` | `violin` | `violin+box`
// Which half of the category slot a violin occupies (for one-sided / split violins)
export type ViolinSide = `both` | `positive` | `negative`
// Bandwidth selector for the KDE (a number, or a rule-of-thumb name)
export type BandwidthOption = number | `silverman` | `scott`

// One box/violin in a BoxPlot, summarizing a single raw distribution (y)
export interface BoxPlotSeries<Metadata = Record<string, unknown>> {
  id?: string | number // Optional stable identifier (used for keying)
  y: readonly number[] // raw distribution for THIS box (quantiles/KDE computed internally)
  label?: string // category label (axis tick + legend + tooltip title)
  color?: string
  box_width?: number // fraction of the category slot (0..1), default from settings
  visible?: boolean
  // Group name for organizing legend items (same semantics as BarSeries.legend_group)
  legend_group?: string
  metadata?: Metadata
  // Specify which x-axis to use: 'x1' (bottom, default) or 'x2' (top)
  x_axis?: `x1` | `x2`
  // Specify which y-axis to use: 'y1' (left, default) or 'y2' (right)
  y_axis?: `y1` | `y2`
  // Per-series whisker overrides (else fall back to component-level props)
  whisker_mode?: WhiskerMode
  whisker_range?: number
  whisker_percentiles?: Vec2
  // Violin overrides (else fall back to component-level props)
  kind?: ViolinKind // 'box' (default), 'violin', or 'violin+box'
  side?: ViolinSide // 'both' (default), 'positive', or 'negative'
  bandwidth?: BandwidthOption
  violin_width?: number // fraction of the category slot
  clip?: [number | null, number | null] // hard KDE bounds (e.g. [0, null] for RMSD)
  // Series sharing a `category` occupy the same slot (for split/grouped violins).
  // When omitted, each series gets its own slot (default box/violin behavior).
  category?: string
}

export interface BoxHandlerProps<
  Metadata = Record<string, unknown>,
> extends HandlerProps<Metadata> {
  box_idx: number
  stats: BoxStats
  color: string
  category_label?: string
  active_y_axis: `y1` | `y2`
  active_x_axis: `x1` | `x2`
}

// Summary statistics for a single box, in data units.
export interface BoxStats {
  min: number // raw data minimum
  max: number // raw data maximum
  q1: number // lower quartile (25th percentile)
  median: number // 50th percentile
  q3: number // upper quartile (75th percentile)
  mean: number
  whisker_low: number // lower whisker end
  whisker_high: number // upper whisker end
  outliers: number[] // points beyond the whiskers (ascending)
  n: number // number of finite input values
}

export interface BoxStatsOptions {
  whisker_mode?: WhiskerMode // default 'tukey'
  whisker_range?: number // tukey IQR multiple / std multiple (default 1.5)
  whisker_percentiles?: Vec2 // for 'percentile' mode (default [5, 95])
  // Skips materializing outlier arrays when the caller only needs quartiles/whiskers.
  collect_outliers?: boolean
}

export const WHISKER_MODES = [`tukey`, `minmax`, `percentile`, `std`] as const

const WHISKER_MODE_SET = new Set<string>(WHISKER_MODES)
export const is_whisker_mode = (val: string): val is WhiskerMode => WHISKER_MODE_SET.has(val)

const EMPTY_STATS: BoxStats = {
  min: NaN,
  max: NaN,
  q1: NaN,
  median: NaN,
  q3: NaN,
  mean: NaN,
  whisker_low: NaN,
  whisker_high: NaN,
  outliers: [],
  n: 0,
}

const clamp01 = (val: number): number => Math.max(0, Math.min(1, val))

function collect_outliers_by_scan(
  values: readonly number[],
  low_bound: number,
  high_bound: number,
  collect: boolean,
): number[] {
  if (!collect) return []
  const outliers: number[] = []
  for (const val of values) if (val < low_bound || val > high_bound) outliers.push(val)
  outliers.sort(ascending)
  return outliers
}

function tukey_scan(
  values: readonly number[],
  low_bound: number,
  high_bound: number,
  collect: boolean,
  data_min: number,
  data_max: number,
): { whisker_low: number; whisker_high: number; outliers: number[] } {
  let whisker_low = Infinity
  let whisker_high = -Infinity
  const outliers: number[] = []
  for (const val of values) {
    if (val < low_bound || val > high_bound) {
      if (collect) outliers.push(val)
    } else {
      if (val < whisker_low) whisker_low = val
      if (val > whisker_high) whisker_high = val
    }
  }
  if (collect) outliers.sort(ascending)
  return {
    whisker_low: whisker_low === Infinity ? data_min : whisker_low,
    whisker_high: whisker_high === -Infinity ? data_max : whisker_high,
    outliers,
  }
}

// Compute box plot statistics for a raw numeric distribution.
// Quartiles use type-7 linear interpolation, matching d3/numpy/pandas defaults.
// Non-finite values are filtered out; the input array is never mutated.
export function compute_box_stats(
  values: readonly number[],
  opts: BoxStatsOptions = {},
): BoxStats {
  const {
    // Fallback derives from DEFAULTS.box so component and helper defaults can't drift
    whisker_mode = DEFAULTS.box.whisker_mode,
    whisker_range = 1.5,
    whisker_percentiles = [5, 95],
    collect_outliers = true,
  } = opts

  const vals = values.filter((val) => Number.isFinite(val))
  const n_vals = vals.length
  if (n_vals === 0) return { ...EMPTY_STATS, outliers: [] }

  let sum = 0
  let data_min = Infinity
  let data_max = -Infinity
  for (const val of vals) {
    sum += val
    if (val < data_min) data_min = val
    if (val > data_max) data_max = val
  }
  const mean = sum / n_vals

  const qtl = (prob: number): number => quantile_unordered(vals, prob)
  const collect_beyond = (lo: number, hi: number): number[] =>
    collect_outliers_by_scan(vals, lo, hi, collect_outliers)

  const q1 = qtl(0.25)
  const median = qtl(0.5)
  const q3 = qtl(0.75)

  let whisker_low: number
  let whisker_high: number
  let outliers: number[] = []

  if (whisker_mode === `minmax`) {
    whisker_low = data_min
    whisker_high = data_max
  } else if (whisker_mode === `percentile`) {
    // Order-defensively so reversed input like [95, 5] still yields low <= high
    const pct_low = Math.min(...whisker_percentiles)
    const pct_high = Math.max(...whisker_percentiles)
    whisker_low = qtl(clamp01(pct_low / 100))
    whisker_high = qtl(clamp01(pct_high / 100))
    outliers = collect_beyond(whisker_low, whisker_high)
  } else if (whisker_mode === `std`) {
    let variance_sum = 0
    for (const val of vals) {
      const delta = val - mean
      variance_sum += delta * delta
    }
    const std = n_vals > 1 ? Math.sqrt(variance_sum / (n_vals - 1)) : 0
    const low_bound = mean - whisker_range * std
    const high_bound = mean + whisker_range * std
    // Clamp whisker ends to the data extent so they never extend past real values
    whisker_low = Math.max(data_min, low_bound)
    whisker_high = Math.min(data_max, high_bound)
    outliers = collect_beyond(low_bound, high_bound)
  } else {
    // tukey (default): whiskers extend to the most extreme datum within range*IQR of the quartiles
    const iqr = q3 - q1
    ;({ whisker_low, whisker_high, outliers } = tukey_scan(
      vals,
      q1 - whisker_range * iqr,
      q3 + whisker_range * iqr,
      collect_outliers,
      data_min,
      data_max,
    ))
  }

  return {
    min: data_min,
    max: data_max,
    q1,
    median,
    q3,
    mean,
    whisker_low,
    whisker_high,
    outliers,
    n: n_vals,
  }
}
