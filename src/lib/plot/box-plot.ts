// Box plot statistics: compute quartiles, whiskers and outliers from a raw distribution.
// Single source of truth for the quantile math used by BoxPlot.svelte.

import { ascending } from 'd3-array'
import type { WhiskerMode } from './types'

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
  whisker_percentiles?: [number, number] // for 'percentile' mode (default [5, 95])
  // When true the caller guarantees `values` is already finite-filtered and ascending,
  // so the internal filter+sort is skipped (lets a caller share one sort across helpers).
  presorted?: boolean
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

function lower_bound(values: readonly number[], target: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upper_bound(values: readonly number[], target: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] <= target) lo = mid + 1
    else hi = mid
  }
  return lo
}

function collect_outliers_between(
  sorted: readonly number[],
  low_bound: number,
  high_bound: number,
  collect: boolean,
): number[] {
  if (!collect) return []
  const low_end = lower_bound(sorted, low_bound)
  const high_start = upper_bound(sorted, high_bound)
  const outliers: number[] = []
  for (let idx = 0; idx < low_end; idx++) outliers.push(sorted[idx])
  for (let idx = high_start; idx < sorted.length; idx++) outliers.push(sorted[idx])
  return outliers
}

function quickselect(values: number[], kth: number): number {
  let left = 0
  let right = values.length - 1
  while (left < right) {
    const pivot = values[(left + right) >>> 1]
    let i = left
    let j = right
    while (i <= j) {
      while (values[i] < pivot) i++
      while (values[j] > pivot) j--
      if (i <= j) {
        const tmp = values[i]
        values[i] = values[j]
        values[j] = tmp
        i++
        j--
      }
    }
    if (kth <= j) right = j
    else if (kth >= i) left = i
    else return values[kth]
  }
  return values[kth]
}

function quantile_sorted(values: readonly number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = values[lo]
  return hi === lo ? lo_val : lo_val + (values[hi] - lo_val) * frac
}

function quantile_unordered(values: number[], p: number): number {
  const idx = (values.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  const frac = idx - lo
  const lo_val = quickselect(values, lo)
  return hi === lo ? lo_val : lo_val + (quickselect(values, hi) - lo_val) * frac
}

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
    whisker_mode = `tukey`,
    whisker_range = 1.5,
    whisker_percentiles = [5, 95],
    presorted = false,
    collect_outliers = true,
  } = opts

  const vals: readonly number[] | number[] = presorted
    ? values
    : values.filter((val) => Number.isFinite(val))
  const n_vals = vals.length
  if (n_vals === 0) return { ...EMPTY_STATS }

  let sum = 0
  let data_min = Infinity
  let data_max = -Infinity
  for (const val of vals) {
    sum += val
    if (val < data_min) data_min = val
    if (val > data_max) data_max = val
  }
  const mean = sum / n_vals
  if (presorted) {
    data_min = vals[0]
    data_max = vals[n_vals - 1]
  }

  const q1 = presorted
    ? quantile_sorted(vals, 0.25)
    : quantile_unordered(vals as number[], 0.25)
  const median = presorted
    ? quantile_sorted(vals, 0.5)
    : quantile_unordered(vals as number[], 0.5)
  const q3 = presorted
    ? quantile_sorted(vals, 0.75)
    : quantile_unordered(vals as number[], 0.75)

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
    whisker_low = presorted
      ? quantile_sorted(vals, clamp01(pct_low / 100))
      : quantile_unordered(vals as number[], clamp01(pct_low / 100))
    whisker_high = presorted
      ? quantile_sorted(vals, clamp01(pct_high / 100))
      : quantile_unordered(vals as number[], clamp01(pct_high / 100))
    outliers = presorted
      ? collect_outliers_between(vals, whisker_low, whisker_high, collect_outliers)
      : collect_outliers_by_scan(vals, whisker_low, whisker_high, collect_outliers)
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
    outliers = presorted
      ? collect_outliers_between(vals, low_bound, high_bound, collect_outliers)
      : collect_outliers_by_scan(vals, low_bound, high_bound, collect_outliers)
  } else {
    // tukey (default): whiskers extend to the most extreme datum within range*IQR of the quartiles
    const iqr = q3 - q1
    const low_bound = q1 - whisker_range * iqr
    const high_bound = q3 + whisker_range * iqr
    if (presorted) {
      const low_idx = lower_bound(vals, low_bound)
      const high_idx = upper_bound(vals, high_bound) - 1
      whisker_low = vals[low_idx] ?? data_min
      whisker_high = vals[high_idx] ?? data_max
      outliers = collect_outliers_between(vals, low_bound, high_bound, collect_outliers)
    } else {
      ;({ whisker_low, whisker_high, outliers } = tukey_scan(
        vals,
        low_bound,
        high_bound,
        collect_outliers,
        data_min,
        data_max,
      ))
    }
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
