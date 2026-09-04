// Data cleaning for plot series: invalid-value handling, physical bounds, local (MAD) outlier
// removal, smoothing (moving average / Savitzky-Golay / Gaussian) and oscillation/instability
// detection, plus the multi-series, xyz and trajectory-property orchestrators built on them.

import { median, type Vec2 } from '$lib/math'
import { assert_series_lengths, type DataSeries } from '$lib/plot/core/types'
import { gaussian_kernel_smooth } from '$lib/spectral/helpers'
import { Adder } from 'd3-array'

// === Types ===

// How to handle invalid values (NaN, Infinity)
export type InvalidValueMode = `remove` | `propagate` | `interpolate`

// Truncation strategy when instability detected
export type TruncationMode = `hard_cut` | `mark_unstable`

export interface PhysicalBounds {
  min?: number | ((x: number) => number) // Static or x-dependent minimum
  max?: number | ((x: number) => number) // Static or x-dependent maximum
  mode?: `clamp` | `filter` | `null` // How to handle violations (default: clamp)
}

// Oscillation detection weights (all default to 1.0)
export interface OscillationWeights {
  derivative_variance?: number
  amplitude_growth?: number
  sign_changes?: number
}

export type SmoothingConfig =
  | { type: `moving_avg`; window: number }
  | { type: `savgol`; window: number; polynomial_order?: number } // window must be odd
  | { type: `gaussian`; sigma: number } // sigma controls Gaussian kernel width

// Local outlier detection config (sliding window approach)
export interface LocalOutlierConfig {
  window_half?: number // Points on each side for local context (default: 7)
  mad_threshold?: number // MADs from local median to flag outlier (default: 2.0)
  max_iterations?: number // Iterative passes to catch clustered outliers (default: 5)
}

export interface InstabilityResult {
  detected: boolean
  onset_index: number
  onset_x: number
  combined_score: number
  method_scores: {
    derivative_variance: number
    amplitude_growth: number
    sign_changes: number
  }
}

export interface CleaningConfig {
  oscillation_threshold?: number // Combined score threshold (default: 3.0)
  oscillation_weights?: OscillationWeights
  window_size?: number // Rolling window for detection (default: 5)
  invalid_values?: InvalidValueMode // NaN/Infinity handling (default: 'remove')
  bounds?: PhysicalBounds
  smooth?: SmoothingConfig
  local_outliers?: LocalOutlierConfig
  truncation_mode?: TruncationMode // default: 'mark_unstable'
  in_place?: boolean // Mutate the input series object (default: true)
}

export interface CleaningQuality {
  points_removed: number
  invalid_values_found: number // NaN/Infinity count
  oscillation_detected: boolean
  oscillation_score?: number
  bounds_violations: number
  outliers_removed?: number
  stable_range?: Vec2 // [start_x, end_x] if mark_unstable mode
  truncated_at_x?: number // x value if hard_cut mode
}

export interface CleaningResult<T = DataSeries> {
  series: T // Cleaned data (same ref if in_place)
  quality: CleaningQuality
}

const DEFAULT_WINDOW_SIZE = 5
const DEFAULT_OSCILLATION_THRESHOLD = 3.0
const DEFAULT_POLYNOMIAL_ORDER = 2
const DEFAULT_LOCAL_WINDOW_HALF = 7
const DEFAULT_LOCAL_MAD_THRESHOLD = 2.0
const DEFAULT_LOCAL_MAX_ITERATIONS = 5

const index_range = (length: number): number[] => Array.from({ length }, (_, idx) => idx)
const pick = <T>(arr: readonly T[], indices: readonly number[]): T[] =>
  indices.map((idx) => arr[idx])

const create_cleaning_quality = (
  points_removed = 0,
  invalid_values_found = 0,
): CleaningQuality => ({
  points_removed,
  invalid_values_found,
  oscillation_detected: false,
  bounds_violations: 0,
})

// === Instability detection ===

// Sample variance of each point's surrounding window (non-finite values are skipped)
function compute_local_variance(values: number[], window_size: number): number[] {
  const len = values.length
  const half_window = Math.floor(window_size / 2)
  const result: number[] = Array(len)
  for (let idx = 0; idx < len; idx++) {
    const end = Math.min(len, idx + half_window + 1)
    let [mean, m2, count] = [0, 0, 0]
    for (let jdx = Math.max(0, idx - half_window); jdx < end; jdx++) {
      const val = values[jdx]
      if (!Number.isFinite(val)) continue
      count++
      const delta = val - mean
      mean += delta / count
      m2 += delta * (val - mean)
    }
    result[idx] = count > 1 ? m2 / (count - 1) : 0
  }
  return result
}

const compute_derivatives = (values: number[]): number[] =>
  Array.from(
    { length: Math.max(0, values.length - 1) },
    (_, idx) => values[idx + 1] - values[idx],
  )

type MethodResult = { onset_index: number; score: number }
const NO_ONSET: MethodResult = { onset_index: -1, score: 0 }

// Method 1: first point where the rolling derivative variance exceeds threshold x baseline median
function detect_derivative_variance(
  values: number[],
  window_size: number,
  threshold_multiplier: number,
): MethodResult {
  const derivs = compute_derivatives(values)
  if (derivs.length < window_size) return NO_ONSET
  const local_var = compute_local_variance(derivs, window_size)
  const baseline_end = Math.min(Math.floor(derivs.length / 4), 50)
  const baseline_vars = local_var
    .slice(0, Math.max(baseline_end, window_size))
    .filter((val) => val > 0)
  // A flat baseline (every window variance 0) gives no scale to compare against
  if (baseline_vars.length === 0) return NO_ONSET
  const baseline_median = median(baseline_vars)
  let max_score = 0
  for (let idx = baseline_end; idx < local_var.length; idx++) {
    const ratio = local_var[idx] / baseline_median
    if (ratio > max_score) max_score = ratio
    // +1 converts from derivative index to value index
    if (ratio > threshold_multiplier) return { onset_index: idx + 1, score: ratio }
  }
  return { onset_index: -1, score: max_score }
}

// Method 2: local amplitude (max deviation from local mean) growing past 10x its baseline
function detect_amplitude_growth(values: number[], window_size: number): MethodResult {
  if (values.length < window_size * 3) return NO_ONSET
  const half_window = Math.floor(window_size / 2)
  const amplitudes: number[] = []
  for (let idx = half_window; idx < values.length - half_window; idx++) {
    const start = idx - half_window
    const end = idx + half_window + 1
    let sum = 0
    for (let jdx = start; jdx < end; jdx++) sum += values[jdx]
    const local_mean = sum / (end - start)
    let max_deviation = 0
    for (let jdx = start; jdx < end; jdx++) {
      max_deviation = Math.max(max_deviation, Math.abs(values[jdx] - local_mean))
    }
    amplitudes.push(max_deviation)
  }
  if (amplitudes.length < 10) return NO_ONSET
  const baseline_end = Math.floor(amplitudes.length / 4) // >= 2, so the slice is never empty
  const baseline_amp = median(amplitudes.slice(0, baseline_end))
  if (baseline_amp === 0) return NO_ONSET
  let max_score = 0
  for (let idx = baseline_end; idx < amplitudes.length; idx++) {
    const ratio = amplitudes[idx] / baseline_amp
    if (ratio > max_score) max_score = ratio
    if (ratio > 10) return { onset_index: idx + half_window, score: ratio / 10 }
  }
  return { onset_index: -1, score: max_score / 10 }
}

// Method 3: more than max_changes derivative sign changes inside one window
function detect_sign_change_frequency(
  values: number[],
  window_size: number,
  max_changes = 3,
): MethodResult {
  const derivs = compute_derivatives(values)
  if (derivs.length < window_size * 2) return NO_ONSET
  const half_window = Math.floor(window_size / 2)
  let max_score = 0
  for (let idx = half_window; idx < derivs.length - half_window; idx++) {
    let sign_changes = 0
    for (let jdx = idx - half_window + 1; jdx < idx + half_window + 1; jdx++) {
      if (derivs[jdx] * derivs[jdx - 1] < 0) sign_changes++
    }
    const score = sign_changes / max_changes
    if (score > max_score) max_score = score
    if (sign_changes > max_changes) return { onset_index: idx + 1, score }
  }
  return { onset_index: -1, score: max_score }
}

// Combined weighted detection; onset is the earliest onset an enabled method reported
export function detect_instability(
  x_values: readonly number[],
  y_values: readonly number[],
  config: Pick<
    CleaningConfig,
    `oscillation_weights` | `oscillation_threshold` | `window_size`
  > = {},
): InstabilityResult {
  const window_size = config.window_size ?? DEFAULT_WINDOW_SIZE
  const threshold = config.oscillation_threshold ?? DEFAULT_OSCILLATION_THRESHOLD
  const weights = {
    derivative_variance: config.oscillation_weights?.derivative_variance ?? 1,
    amplitude_growth: config.oscillation_weights?.amplitude_growth ?? 1,
    sign_changes: config.oscillation_weights?.sign_changes ?? 1,
  }
  const valid_indices: number[] = []
  const valid_y: number[] = []
  for (let idx = 0; idx < y_values.length; idx++) {
    if (!Number.isFinite(y_values[idx])) continue
    valid_indices.push(idx)
    valid_y.push(y_values[idx])
  }
  if (valid_y.length < window_size * 2) {
    const method_scores = { derivative_variance: 0, amplitude_growth: 0, sign_changes: 0 }
    return { detected: false, onset_index: -1, onset_x: NaN, combined_score: 0, method_scores }
  }
  const results = {
    derivative_variance: detect_derivative_variance(valid_y, window_size, threshold),
    amplitude_growth: detect_amplitude_growth(valid_y, window_size),
    sign_changes: detect_sign_change_frequency(valid_y, window_size),
  }
  const methods = [`derivative_variance`, `amplitude_growth`, `sign_changes`] as const
  const total_weight = methods.reduce((sum, method) => sum + weights[method], 0)
  const combined_score =
    total_weight > 0
      ? methods.reduce((sum, method) => sum + weights[method] * results[method].score, 0) /
        total_weight
      : 0
  const onsets = methods
    .filter((method) => weights[method] > 0)
    .map((method) => results[method].onset_index)
    .filter((idx) => idx >= 0)
  const valid_onset = onsets.length > 0 ? Math.min(...onsets) : -1
  const onset_index = valid_onset >= 0 ? (valid_indices[valid_onset] ?? valid_onset) : -1
  return {
    detected: combined_score >= threshold || onset_index >= 0,
    onset_index,
    onset_x: onset_index >= 0 && onset_index < x_values.length ? x_values[onset_index] : NaN,
    combined_score,
    method_scores: {
      derivative_variance: results.derivative_variance.score,
      amplitude_growth: results.amplitude_growth.score,
      sign_changes: results.sign_changes.score,
    },
  }
}

// === Smoothing ===

// Centered finite-aware moving average
export function smooth_moving_average(values: readonly number[], window: number): number[] {
  if (values.length === 0 || !(window > 1)) return [...values]
  const half_window = Math.floor(window / 2)
  // Scaling by a power of two prevents same-sign windows from overflowing without
  // introducing division roundoff into individual values.
  const normalizer = 2 ** Math.ceil(Math.log2(2 * half_window + 1))
  const result = Array<number>(values.length)
  for (let idx = 0; idx < values.length; idx++) {
    const end = Math.min(values.length, idx + half_window + 1)
    const sum = new Adder()
    let count = 0
    for (let value_idx = Math.max(0, idx - half_window); value_idx < end; value_idx++) {
      if (!Number.isFinite(values[value_idx])) continue
      sum.add(values[value_idx] / normalizer)
      count++
    }
    result[idx] = count > 0 ? (Number(sum) / count) * normalizer : values[idx]
  }
  return result
}

// Solve the square system A x = b in place by Gaussian elimination with partial pivoting.
// Returns null when A is singular.
function solve_linear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length
  const aug = matrix.map((row, idx) => [...row, rhs[idx]])
  for (let col = 0; col < size; col++) {
    let pivot_row = col
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[pivot_row][col])) pivot_row = row
    }
    if (Math.abs(aug[pivot_row][col]) < 1e-10) return null
    ;[aug[col], aug[pivot_row]] = [aug[pivot_row], aug[col]]
    const pivot = aug[col][col]
    for (let jdx = col; jdx <= size; jdx++) aug[col][jdx] /= pivot
    for (let row = 0; row < size; row++) {
      if (row === col) continue
      const factor = aug[row][col]
      if (factor === 0) continue
      for (let jdx = col; jdx <= size; jdx++) aug[row][jdx] -= factor * aug[col][jdx]
    }
  }
  return aug.map((row) => row[size])
}

// Savitzky-Golay smoothing kernel: first row of (V^T V)^-1 V^T for the Vandermonde matrix V of
// window offsets. With A = V^T V symmetric, that row is (A^-1 e0)^T V^T, so one linear solve
// for w = A^-1 e0 gives coefficient_j = sum_k w_k * offset_j^k.
function compute_savgol_coefficients(window: number, order: number): number[] {
  const half = Math.floor(window / 2)
  const offsets = Array.from({ length: 2 * half + 1 }, (_, idx) => idx - half)
  const gram = Array.from({ length: order + 1 }, (_row, row) =>
    Array.from({ length: order + 1 }, (_col, col) =>
      offsets.reduce((sum, offset) => sum + offset ** (row + col), 0),
    ),
  )
  const weights = solve_linear(gram, [1, ...Array(order).fill(0)])
  if (!weights) return offsets.map(() => 1 / offsets.length)
  return offsets.map((offset) =>
    weights.reduce((sum, weight, power) => sum + weight * offset ** power, 0),
  )
}

// Savitzky-Golay filter (derivative-preserving) - O(n * window)
function smooth_savitzky_golay(
  values: number[],
  window: number,
  polynomial_order: number = DEFAULT_POLYNOMIAL_ORDER,
): number[] {
  if (values.length === 0) return []
  // Window must be odd, at least polynomial_order + 2 wide and no wider than the data
  let actual_window = window % 2 === 0 ? window + 1 : window
  actual_window = Math.min(Math.max(actual_window, polynomial_order + 2), values.length)
  if (actual_window % 2 === 0) actual_window -= 1
  if (actual_window < 3) return [...values]

  const coeffs = compute_savgol_coefficients(actual_window, polynomial_order)
  const half = Math.floor(actual_window / 2)
  const coeffs_sum = coeffs.reduce((sum, coeff) => sum + coeff, 0)
  const result: number[] = Array(values.length)
  for (let idx = 0; idx < values.length; idx++) {
    let [sum, weight_sum] = [0, 0]
    for (let jdx = 0; jdx < actual_window; jdx++) {
      const data_idx = idx - half + jdx
      if (data_idx < 0 || data_idx >= values.length || !Number.isFinite(values[data_idx]))
        continue
      sum += coeffs[jdx] * values[data_idx]
      weight_sum += coeffs[jdx]
    }
    // Renormalize over the finite neighbours. A window whose finite coefficients cancel
    // (e.g. a fully-determined fit with a non-finite center) has nothing to smooth with.
    result[idx] = Math.abs(weight_sum) > 1e-9 ? (sum / weight_sum) * coeffs_sum : values[idx]
  }
  return result
}

function apply_smoothing(
  x_values: number[],
  y_values: number[],
  config: SmoothingConfig,
): number[] {
  if (config.type === `moving_avg`) return smooth_moving_average(y_values, config.window)
  if (config.type === `savgol`) {
    return smooth_savitzky_golay(y_values, config.window, config.polynomial_order)
  }
  // Nadaraya-Watson, not the DOS convolution: on the irregular grid outlier removal leaves, a
  // measure-weighted convolution droops at the series ends. NW is exact on constants.
  return gaussian_kernel_smooth(x_values, y_values, config.sigma)
}

// === Local outlier removal ===

// Median and MAD of the finite neighbours of center_idx (the center itself excluded)
function local_median_and_mad(
  values: readonly number[],
  center_idx: number,
  window_half: number,
): { local_median: number; local_mad: number } {
  const neighbours: number[] = []
  const end = Math.min(values.length - 1, center_idx + window_half)
  for (let idx = Math.max(0, center_idx - window_half); idx <= end; idx++) {
    if (idx !== center_idx && Number.isFinite(values[idx])) neighbours.push(values[idx])
  }
  if (neighbours.length === 0) return { local_median: values[center_idx], local_mad: 0 }
  const local_median = median(neighbours)
  const local_mad = median(neighbours.map((val) => Math.abs(val - local_median)))
  return { local_median, local_mad }
}

// Iterative sliding-window MAD outlier detection; returns the indices to drop. Statistics are
// always computed from the original values (not the progressively filtered ones) so one removal
// cannot shift its neighbours' statistics and cascade into false positives. Points within
// window_half of either end are never flagged: their one-sided window makes the local median
// trail any trend, which used to delete the genuine endpoints of every monotonic series.
function remove_local_outliers(
  y_values: readonly number[],
  config: LocalOutlierConfig,
): number[] {
  const window_half = config.window_half ?? DEFAULT_LOCAL_WINDOW_HALF
  const mad_threshold = config.mad_threshold ?? DEFAULT_LOCAL_MAD_THRESHOLD
  const max_iterations = config.max_iterations ?? DEFAULT_LOCAL_MAX_ITERATIONS
  const len = y_values.length
  // Need enough neighbours for meaningful local statistics
  if (len < window_half * 2 + 1) return []
  const kept = Array<boolean>(len).fill(true)
  for (let iter = 0; iter < max_iterations; iter++) {
    let removed_any = false
    for (let idx = window_half; idx < len - window_half; idx++) {
      if (!kept[idx] || !Number.isFinite(y_values[idx])) continue
      const { local_median, local_mad } = local_median_and_mad(y_values, idx, window_half)
      // Cannot compute robust threshold if MAD is zero (all neighbours identical)
      if (local_mad === 0) continue
      if (Math.abs(y_values[idx] - local_median) > local_mad * mad_threshold) {
        kept[idx] = false
        removed_any = true
      }
    }
    if (!removed_any) break
  }
  return index_range(len).filter((idx) => !kept[idx])
}

// === Invalid values and bounds ===

function handle_invalid_values(
  values: number[],
  mode: InvalidValueMode,
): { cleaned: number[]; removed_indices: number[]; invalid_count: number } {
  const removed_indices: number[] = []
  let invalid_count = 0
  if (mode !== `interpolate`) {
    const cleaned: number[] = []
    for (let idx = 0; idx < values.length; idx++) {
      const value = values[idx]
      const is_valid = Number.isFinite(value)
      if (!is_valid) invalid_count++
      if (is_valid || mode === `propagate`) cleaned.push(value)
      else removed_indices.push(idx)
    }
    return { cleaned, removed_indices, invalid_count }
  }
  // Linear interpolation between the nearest finite neighbours; edges hold the nearest value
  const cleaned = [...values]
  let left_idx = -1
  let right_idx = 0
  for (let idx = 0; idx < cleaned.length; idx++) {
    if (Number.isFinite(cleaned[idx])) {
      left_idx = idx
      continue
    }
    invalid_count++
    right_idx = Math.max(right_idx, idx + 1)
    while (right_idx < cleaned.length && !Number.isFinite(cleaned[right_idx])) right_idx++
    const has_left = left_idx >= 0
    const has_right = right_idx < cleaned.length
    if (has_left && has_right) {
      const frac = (idx - left_idx) / (right_idx - left_idx)
      cleaned[idx] = cleaned[left_idx] + frac * (cleaned[right_idx] - cleaned[left_idx])
    } else cleaned[idx] = has_left ? cleaned[left_idx] : has_right ? cleaned[right_idx] : 0
    if (Number.isFinite(cleaned[idx])) left_idx = idx
  }
  return { cleaned, removed_indices: [], invalid_count }
}

// Resolve static or x-dependent bounds at one x. NaN values compare false on both checks and
// therefore count as in-bounds.
const bounds_violation = (
  y_val: number,
  x_val: number,
  bounds: PhysicalBounds,
): { below: number | null; above: number | null } => {
  const min = typeof bounds.min === `function` ? bounds.min(x_val) : bounds.min
  const max = typeof bounds.max === `function` ? bounds.max(x_val) : bounds.max
  return {
    below: min !== undefined && y_val < min ? min : null,
    above: max !== undefined && y_val > max ? max : null,
  }
}

const is_in_bounds = (y_val: number, x_val: number, bounds: PhysicalBounds): boolean => {
  const { below, above } = bounds_violation(y_val, x_val, bounds)
  return below === null && above === null
}

function apply_bounds(
  x_values: readonly number[],
  y_values: number[],
  bounds: PhysicalBounds,
): { y: number[]; violations: number; filtered_indices: number[] } {
  const mode = bounds.mode ?? `clamp`
  const result = [...y_values]
  const filtered_indices: number[] = []
  let violations = 0
  for (let idx = 0; idx < result.length; idx++) {
    const { below, above } = bounds_violation(result[idx], x_values[idx], bounds)
    if (below === null && above === null) continue
    violations++
    if (mode === `clamp`) result[idx] = above ?? below ?? result[idx]
    else if (mode === `filter`) filtered_indices.push(idx)
    else result[idx] = NaN
  }
  return { y: result, violations, filtered_indices }
}

// === Series orchestration ===

export function clean_series<T extends DataSeries>(
  series: T,
  config: CleaningConfig = {},
): CleaningResult<T> {
  assert_series_lengths(series)
  const invalid_mode = config.invalid_values ?? `remove`
  const quality = create_cleaning_quality()

  // `kept` indexes the original arrays; y_arr stays aligned with it so every filter pass
  // touches only those two and the auxiliary arrays are materialized once at the end.
  let kept = index_range(series.y.length)
  let y_arr = [...series.y]
  const drop = (removed: readonly number[]) => {
    if (removed.length === 0) return
    const removed_set = new Set(removed)
    const survivors = kept.map((_, idx) => idx).filter((idx) => !removed_set.has(idx))
    kept = pick(kept, survivors)
    y_arr = pick(y_arr, survivors)
    quality.points_removed += removed.length
  }

  const invalid_result = handle_invalid_values(y_arr, invalid_mode)
  quality.invalid_values_found = invalid_result.invalid_count
  if (invalid_mode === `remove`) drop(invalid_result.removed_indices)
  else y_arr = invalid_result.cleaned

  if (config.bounds) {
    const { y, violations, filtered_indices } = apply_bounds(
      pick(series.x, kept),
      y_arr,
      config.bounds,
    )
    y_arr = y
    quality.bounds_violations = violations
    drop(filtered_indices)
  }

  if (config.local_outliers) {
    const removed_indices = remove_local_outliers(y_arr, config.local_outliers)
    quality.outliers_removed = removed_indices.length
    drop(removed_indices)
  }

  let x_arr = pick(series.x, kept)
  if (config.smooth) y_arr = apply_smoothing(x_arr, y_arr, config.smooth)

  const instability = detect_instability(x_arr, y_arr, config)
  quality.oscillation_detected = instability.detected
  quality.oscillation_score = instability.combined_score
  if (instability.detected && instability.onset_index >= 0) {
    if ((config.truncation_mode ?? `mark_unstable`) === `hard_cut`) {
      quality.truncated_at_x = instability.onset_x
      drop(index_range(x_arr.length).slice(instability.onset_index))
      x_arr = pick(series.x, kept)
    } else quality.stable_range = [x_arr[0], instability.onset_x]
  }

  const result_series = (config.in_place ?? true) ? series : { ...series }
  result_series.x = x_arr
  result_series.y = y_arr
  if (series.raw_y) result_series.raw_y = pick(series.raw_y, kept)
  // Per-point metadata arrays are filtered alongside y; scalar metadata passes through untouched
  if (Array.isArray(series.metadata)) result_series.metadata = pick(series.metadata, kept)
  if (series.color_values) result_series.color_values = pick(series.color_values, kept)
  if (series.size_values) result_series.size_values = pick(series.size_values, kept)
  return { series: result_series, quality }
}

// Clean multiple y-series with shared x, filtering to intersection of valid indices
export function clean_multi_series(
  x_values: readonly number[],
  y_arrays: number[][],
  config: CleaningConfig = {},
): { x: number[]; cleaned_y: number[][]; quality: CleaningQuality[] } {
  const invalid_mode = config.invalid_values ?? `remove`
  const { bounds, smooth } = config
  const length = Math.min(x_values.length, ...y_arrays.map((array) => array.length))
  const kept_indices = index_range(length).filter(
    (idx) =>
      (invalid_mode !== `remove` || y_arrays.every((array) => Number.isFinite(array[idx]))) &&
      (bounds?.mode !== `filter` ||
        y_arrays.every((array) => is_in_bounds(array[idx], x_values[idx], bounds))),
  )
  const x = pick(x_values, kept_indices)
  const quality = y_arrays.map((array) => {
    let invalid_count = 0
    for (let idx = 0; idx < length; idx++) if (!Number.isFinite(array[idx])) invalid_count++
    return create_cleaning_quality(length - kept_indices.length, invalid_count)
  })
  const cleaned_y = y_arrays.map((array, array_idx) => {
    let cleaned = pick(array, kept_indices)
    if (invalid_mode === `interpolate`) {
      cleaned = handle_invalid_values(cleaned, `interpolate`).cleaned
    }
    if (bounds && bounds.mode !== `filter`) {
      const result = apply_bounds(x, cleaned, bounds)
      cleaned = result.y
      quality[array_idx].bounds_violations = result.violations
    }
    return smooth ? apply_smoothing(x, cleaned, smooth) : cleaned
  })
  return { x, cleaned_y, quality }
}

// Clean correlated x/y/z for 3D data. All three arrays are filtered to the intersection of
// valid indices; bounds filter on `primary_axis` (resolved against x for x-dependent bounds).
export function clean_xyz(
  x_values: readonly number[],
  y_values: readonly number[],
  z_values: readonly number[],
  config: CleaningConfig & { primary_axis?: `x` | `y` | `z` } = {},
): { x: number[]; y: number[]; z: number[]; quality: CleaningQuality } {
  const invalid_mode = config.invalid_values ?? `remove`
  const { bounds, smooth, primary_axis = `x` } = config
  const length = Math.min(x_values.length, y_values.length, z_values.length)
  const columns = { x: x_values, y: y_values, z: z_values }
  const axes = [`x`, `y`, `z`] as const
  const pick_rows = (cols: typeof columns, indices: number[]) => ({
    x: pick(cols.x, indices),
    y: pick(cols.y, indices),
    z: pick(cols.z, indices),
  })

  let invalid_count = 0
  const kept_indices: number[] = []
  for (let idx = 0; idx < length; idx++) {
    const invalid_here = axes.filter((axis) => !Number.isFinite(columns[axis][idx])).length
    invalid_count += invalid_here
    if (invalid_here === 0 || invalid_mode !== `remove`) kept_indices.push(idx)
  }
  const quality = create_cleaning_quality(length - kept_indices.length, invalid_count)
  let filtered = pick_rows(columns, kept_indices)
  if (invalid_mode === `interpolate`) {
    for (const axis of axes) {
      filtered[axis] = handle_invalid_values(filtered[axis], `interpolate`).cleaned
    }
  }
  if (bounds?.mode === `filter`) {
    const bounds_kept = index_range(filtered.x.length).filter((idx) =>
      is_in_bounds(filtered[primary_axis][idx], filtered.x[idx], bounds),
    )
    quality.bounds_violations = filtered.x.length - bounds_kept.length
    quality.points_removed += quality.bounds_violations
    filtered = pick_rows(filtered, bounds_kept)
  }
  // x is the independent variable (time, index, ...) and is never smoothed
  if (smooth) {
    filtered.y = apply_smoothing(filtered.x, filtered.y, smooth)
    filtered.z = apply_smoothing(filtered.x, filtered.z, smooth)
  }
  return { ...filtered, quality }
}
