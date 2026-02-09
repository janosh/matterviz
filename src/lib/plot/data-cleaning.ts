// Data cleaning utilities for plot data
// Detects oscillations, enforces physical bounds, and handles multi-dimensional datasets

import { apply_gaussian_smearing } from '$lib/spectral/helpers'
import type {
  CleaningConfig,
  CleaningQuality,
  CleaningResult,
  DataSeries,
  InstabilityResult,
  InvalidValueMode,
  LocalOutlierConfig,
  LocalOutlierResult,
  PhysicalBounds,
  SmoothingConfig,
} from './types'

// Default configuration values
const DEFAULT_WINDOW_SIZE = 5
const DEFAULT_OSCILLATION_THRESHOLD = 3.0
const DEFAULT_POLYNOMIAL_ORDER = 2

// --- Core Detection Functions ---

// Compute rolling variance using Welford's online algorithm - O(n)
// Returns variance for each point based on surrounding window
export function compute_local_variance(
  values: number[],
  window_size: number,
): number[] {
  const len = values.length
  if (len === 0) return []
  if (len === 1) return [0]

  const half_window = Math.floor(window_size / 2)
  const result = new Array<number>(len)

  // Single pass for each index, no slice allocation (avoids O(n × window) allocations)
  for (let idx = 0; idx < len; idx++) {
    const start = Math.max(0, idx - half_window)
    const end = Math.min(len, idx + half_window + 1)

    // Welford's online variance calculation
    let mean = 0
    let m2 = 0
    let count = 0

    for (let jdx = start; jdx < end; jdx++) {
      const val = values[jdx]
      if (!Number.isFinite(val)) continue
      count++
      const delta = val - mean
      mean += delta / count
      const delta2 = val - mean
      m2 += delta * delta2
    }

    result[idx] = count > 1 ? m2 / (count - 1) : 0
  }

  return result
}

// Compute first-order finite differences (discrete derivative)
function compute_derivatives(values: number[]): number[] {
  if (values.length < 2) return []
  const derivs = new Array<number>(values.length - 1)
  for (let idx = 0; idx < values.length - 1; idx++) {
    derivs[idx] = values[idx + 1] - values[idx]
  }
  return derivs
}

// Detect derivative variance spikes (method 1)
// Returns onset index where derivative variance exceeds threshold
function detect_derivative_variance(
  values: number[],
  window_size: number,
  threshold_multiplier: number,
): { onset_index: number; score: number } {
  const derivs = compute_derivatives(values)
  if (derivs.length < window_size) {
    return { onset_index: -1, score: 0 }
  }

  const local_var = compute_local_variance(derivs, window_size)

  // Compute baseline variance from first stable portion
  const baseline_end = Math.min(Math.floor(derivs.length / 4), 50)
  const baseline_vars = local_var.slice(0, Math.max(baseline_end, window_size))
  const baseline_median = median(baseline_vars.filter((val) => val > 0))

  if (baseline_median === 0) {
    return { onset_index: -1, score: 0 }
  }

  // Find first point where variance exceeds threshold
  let max_score = 0
  for (let idx = baseline_end; idx < local_var.length; idx++) {
    const ratio = local_var[idx] / baseline_median
    if (ratio > max_score) max_score = ratio
    if (ratio > threshold_multiplier) {
      return { onset_index: idx + 1, score: ratio } // +1 to convert from deriv index to value index
    }
  }

  return { onset_index: -1, score: max_score }
}

// Detect exponential amplitude growth (method 2)
// Looks for values growing exponentially from their mean
function detect_amplitude_growth(
  values: number[],
  window_size: number,
): { onset_index: number; score: number } {
  if (values.length < window_size * 3) {
    return { onset_index: -1, score: 0 }
  }

  // Compute running amplitude (deviation from local mean)
  const amplitudes: number[] = []
  const half_window = Math.floor(window_size / 2)

  for (let idx = half_window; idx < values.length - half_window; idx++) {
    const start = idx - half_window
    const end = idx + half_window + 1
    const window_len = end - start

    // Compute local mean without slice allocation
    let sum = 0
    for (let jdx = start; jdx < end; jdx++) sum += values[jdx]
    const local_mean = sum / window_len

    // Find max deviation without slice allocation
    let max_deviation = 0
    for (let jdx = start; jdx < end; jdx++) {
      const deviation = Math.abs(values[jdx] - local_mean)
      if (deviation > max_deviation) max_deviation = deviation
    }
    amplitudes.push(max_deviation)
  }

  if (amplitudes.length < 10) {
    return { onset_index: -1, score: 0 }
  }

  // Detect exponential growth by checking if amplitude ratio increases
  const baseline_amp = median(amplitudes.slice(0, Math.floor(amplitudes.length / 4)))
  if (baseline_amp === 0) {
    return { onset_index: -1, score: 0 }
  }

  let max_score = 0
  for (let idx = Math.floor(amplitudes.length / 4); idx < amplitudes.length; idx++) {
    const ratio = amplitudes[idx] / baseline_amp
    if (ratio > max_score) max_score = ratio

    // Exponential growth threshold: amplitude 10x baseline
    if (ratio > 10) {
      return { onset_index: idx + half_window, score: ratio / 10 }
    }
  }

  return { onset_index: -1, score: max_score / 10 }
}

// Count derivative sign changes per window (method 3)
// Detects high-frequency oscillations
function detect_sign_change_frequency(
  values: number[],
  window_size: number,
  max_changes_per_window: number = 3,
): { onset_index: number; score: number } {
  const derivs = compute_derivatives(values)
  if (derivs.length < window_size * 2) {
    return { onset_index: -1, score: 0 }
  }

  // Count sign changes in sliding windows
  const half_window = Math.floor(window_size / 2)
  let max_score = 0

  for (let idx = half_window; idx < derivs.length - half_window; idx++) {
    const start = idx - half_window
    const end = idx + half_window + 1
    let sign_changes = 0

    // Count sign changes without slice allocation
    for (let jdx = start + 1; jdx < end; jdx++) {
      if (derivs[jdx] * derivs[jdx - 1] < 0) {
        sign_changes++
      }
    }

    const normalized_score = sign_changes / max_changes_per_window
    if (normalized_score > max_score) max_score = normalized_score

    if (sign_changes > max_changes_per_window) {
      return { onset_index: idx + 1, score: normalized_score }
    }
  }

  return { onset_index: -1, score: max_score }
}

// Combined detection with configurable weights
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
    derivative_variance: config.oscillation_weights?.derivative_variance ?? 1.0,
    amplitude_growth: config.oscillation_weights?.amplitude_growth ?? 1.0,
    sign_changes: config.oscillation_weights?.sign_changes ?? 1.0,
  }

  // Filter out invalid values for detection
  const valid_indices: number[] = []
  const valid_y: number[] = []
  for (let idx = 0; idx < y_values.length; idx++) {
    if (Number.isFinite(y_values[idx])) {
      valid_indices.push(idx)
      valid_y.push(y_values[idx])
    }
  }

  if (valid_y.length < window_size * 2) {
    return {
      detected: false,
      onset_index: -1,
      onset_x: NaN,
      combined_score: 0,
      method_scores: { derivative_variance: 0, amplitude_growth: 0, sign_changes: 0 },
    }
  }

  // Run all three detection methods
  const deriv_result = detect_derivative_variance(valid_y, window_size, threshold)
  const amp_result = detect_amplitude_growth(valid_y, window_size)
  const sign_result = detect_sign_change_frequency(valid_y, window_size)

  const method_scores = {
    derivative_variance: deriv_result.score,
    amplitude_growth: amp_result.score,
    sign_changes: sign_result.score,
  }

  // Compute weighted combined score
  const total_weight = weights.derivative_variance + weights.amplitude_growth +
    weights.sign_changes
  const combined_score = total_weight > 0
    ? (weights.derivative_variance * deriv_result.score +
      weights.amplitude_growth * amp_result.score +
      weights.sign_changes * sign_result.score) / total_weight
    : 0

  // Find earliest onset across all methods that exceeded threshold
  const onset_candidates = [
    {
      idx: deriv_result.onset_index,
      score: deriv_result.score * weights.derivative_variance,
    },
    { idx: amp_result.onset_index, score: amp_result.score * weights.amplitude_growth },
    { idx: sign_result.onset_index, score: sign_result.score * weights.sign_changes },
  ].filter((candidate) => candidate.idx >= 0)

  let onset_index = -1
  if (onset_candidates.length > 0) {
    // Take earliest detected onset
    onset_index = Math.min(...onset_candidates.map((candidate) => candidate.idx))
    // Map back to original index if we filtered values
    if (onset_index >= 0 && onset_index < valid_indices.length) {
      onset_index = valid_indices[onset_index]
    }
  }

  const detected = combined_score >= threshold || onset_index >= 0
  const onset_x = onset_index >= 0 && onset_index < x_values.length
    ? x_values[onset_index]
    : NaN

  return {
    detected,
    onset_index,
    onset_x,
    combined_score,
    method_scores,
  }
}

// --- Smoothing Functions ---

// Moving average - O(n)
export function smooth_moving_average(values: number[], window: number): number[] {
  if (values.length === 0 || window <= 1) return [...values]

  const result = new Array<number>(values.length)
  const half_window = Math.floor(window / 2)

  for (let idx = 0; idx < values.length; idx++) {
    const start = Math.max(0, idx - half_window)
    const end = Math.min(values.length, idx + half_window + 1)
    let sum = 0
    let count = 0

    for (let jdx = start; jdx < end; jdx++) {
      if (Number.isFinite(values[jdx])) {
        sum += values[jdx]
        count++
      }
    }

    result[idx] = count > 0 ? sum / count : values[idx]
  }

  return result
}

// Savitzky-Golay filter coefficients for polynomial smoothing
// Uses least-squares polynomial fitting in each window
function compute_savgol_coefficients(window: number, order: number): number[] {
  // Ensure window is odd
  const half = Math.floor(window / 2)
  const size = 2 * half + 1

  // Build Vandermonde matrix for polynomial fitting
  const vandermonde: number[][] = []
  for (let idx = -half; idx <= half; idx++) {
    const row: number[] = []
    for (let power = 0; power <= order; power++) {
      row.push(Math.pow(idx, power))
    }
    vandermonde.push(row)
  }

  // Compute (V^T V)^-1 V^T using simple pseudoinverse
  // For smoothing, we only need the first row (constant term coefficients)
  const vtv = multiply_matrices(transpose(vandermonde), vandermonde)
  const vtv_inv = invert_matrix(vtv)
  if (!vtv_inv) {
    // Fallback to uniform weights
    return new Array(size).fill(1 / size)
  }

  const vt = transpose(vandermonde)
  const coeffs_matrix = multiply_matrices(vtv_inv, vt)

  // First row gives smoothing coefficients
  return coeffs_matrix[0]
}

// Savitzky-Golay filter (derivative-preserving) - O(n * window)
export function smooth_savitzky_golay(
  values: number[],
  window: number,
  polynomial_order: number = DEFAULT_POLYNOMIAL_ORDER,
): number[] {
  if (values.length === 0) return []

  // Ensure window is odd and >= polynomial_order + 1
  let actual_window = window % 2 === 0 ? window + 1 : window
  actual_window = Math.max(actual_window, polynomial_order + 2)
  actual_window = Math.min(actual_window, values.length)

  if (actual_window < 3) return [...values]

  const coeffs = compute_savgol_coefficients(actual_window, polynomial_order)
  const half = Math.floor(actual_window / 2)
  const result = new Array<number>(values.length)
  // Cache coefficient sum to avoid O(n × window) redundant reductions in loop
  const coeffs_sum = coeffs.reduce((a, b) => a + b, 0)

  for (let idx = 0; idx < values.length; idx++) {
    let sum = 0
    let weight_sum = 0

    for (let jdx = 0; jdx < actual_window; jdx++) {
      const data_idx = idx - half + jdx
      if (
        data_idx >= 0 && data_idx < values.length && Number.isFinite(values[data_idx])
      ) {
        sum += coeffs[jdx] * values[data_idx]
        weight_sum += coeffs[jdx]
      }
    }

    result[idx] = weight_sum !== 0 ? sum / weight_sum * coeffs_sum : values[idx]
  }

  return result
}

// Apply smoothing based on config
function apply_smoothing(
  x_values: number[],
  y_values: number[],
  config: SmoothingConfig,
): number[] {
  if (config.type === `moving_avg`) {
    return smooth_moving_average(y_values, config.window)
  } else if (config.type === `savgol`) {
    return smooth_savitzky_golay(
      y_values,
      config.window,
      config.polynomial_order ?? DEFAULT_POLYNOMIAL_ORDER,
    )
  } else if (config.type === `gaussian`) {
    return apply_gaussian_smearing(x_values, y_values, config.sigma)
  }
  return y_values
}

// --- Local Outlier Detection ---

// Default values for local outlier detection
const DEFAULT_LOCAL_WINDOW_HALF = 7
const DEFAULT_LOCAL_MAD_THRESHOLD = 2.0
const DEFAULT_LOCAL_MAX_ITERATIONS = 5

// Compute local median within a window, excluding the center point
// This allows detecting if the center point is an outlier relative to its neighbors
function compute_local_median_excluding_center(
  values: number[],
  center_idx: number,
  window_half: number,
): number {
  const window_values: number[] = []
  const start = Math.max(0, center_idx - window_half)
  const end = Math.min(values.length - 1, center_idx + window_half)

  for (let idx = start; idx <= end; idx++) {
    if (idx !== center_idx && Number.isFinite(values[idx])) {
      window_values.push(values[idx])
    }
  }

  if (window_values.length === 0) return values[center_idx]
  return median(window_values)
}

// Compute local MAD (median absolute deviation) within a window, excluding center
function compute_local_mad_excluding_center(
  values: number[],
  center_idx: number,
  window_half: number,
  local_median: number,
): number {
  const abs_devs: number[] = []
  const start = Math.max(0, center_idx - window_half)
  const end = Math.min(values.length - 1, center_idx + window_half)

  for (let idx = start; idx <= end; idx++) {
    if (idx !== center_idx && Number.isFinite(values[idx])) {
      abs_devs.push(Math.abs(values[idx] - local_median))
    }
  }

  if (abs_devs.length === 0) return 0
  return median(abs_devs)
}

// Remove local outliers using iterative sliding window MAD-based detection
// Detects points that deviate significantly from their local neighborhood
// Returns only the indices to keep, preserving good data before AND after bad regions
export function remove_local_outliers(
  y_values: readonly number[],
  config: LocalOutlierConfig = {},
): LocalOutlierResult {
  const window_half = config.window_half ?? DEFAULT_LOCAL_WINDOW_HALF
  const mad_threshold = config.mad_threshold ?? DEFAULT_LOCAL_MAD_THRESHOLD
  const max_iterations = config.max_iterations ?? DEFAULT_LOCAL_MAX_ITERATIONS

  const len = y_values.length
  if (len === 0) {
    return { kept_indices: [], removed_indices: [], iterations_used: 0 }
  }

  // Need enough neighbors for meaningful local statistics
  const min_points_needed = window_half * 2 + 1
  if (len < min_points_needed) {
    return {
      kept_indices: Array.from({ length: len }, (_, idx) => idx),
      removed_indices: [],
      iterations_used: 0,
    }
  }

  let kept_mask = new Array<boolean>(len).fill(true)
  let iterations_used = 0

  for (let iter = 0; iter < max_iterations; iter++) {
    let removed_any = false
    const new_kept_mask = [...kept_mask]
    // Note: Local statistics are computed from original values, not filtered values.
    // This prevents cascading removals where one outlier's removal dramatically
    // shifts statistics and causes false positives on neighboring points.
    for (let idx = 0; idx < len; idx++) {
      if (!kept_mask[idx]) continue // Already removed
      if (!Number.isFinite(y_values[idx])) continue // Skip invalid values

      const local_median = compute_local_median_excluding_center(
        y_values as number[],
        idx,
        window_half,
      )
      const local_mad = compute_local_mad_excluding_center(
        y_values as number[],
        idx,
        window_half,
        local_median,
      )

      // Cannot compute robust threshold if MAD is zero (all neighbors identical)
      if (local_mad === 0) continue

      const threshold = local_mad * mad_threshold
      const deviation = Math.abs(y_values[idx] - local_median)

      if (deviation > threshold) {
        new_kept_mask[idx] = false
        removed_any = true
      }
    }

    kept_mask = new_kept_mask
    iterations_used = iter + 1

    if (!removed_any) break
  }

  const kept_indices: number[] = []
  const removed_indices: number[] = []

  for (let idx = 0; idx < len; idx++) {
    if (kept_mask[idx]) {
      kept_indices.push(idx)
    } else {
      removed_indices.push(idx)
    }
  }

  return { kept_indices, removed_indices, iterations_used }
}

// --- Helper Functions ---

// Handle NaN/Infinity based on mode
export function handle_invalid_values(
  values: number[],
  mode: InvalidValueMode,
): { cleaned: number[]; removed_indices: number[]; invalid_count: number } {
  const removed_indices: number[] = []
  let invalid_count = 0

  if (mode === `propagate`) {
    for (const val of values) {
      if (!Number.isFinite(val)) invalid_count++
    }
    return { cleaned: [...values], removed_indices: [], invalid_count }
  }

  if (mode === `remove`) {
    const cleaned: number[] = []
    for (let idx = 0; idx < values.length; idx++) {
      if (Number.isFinite(values[idx])) {
        cleaned.push(values[idx])
      } else {
        removed_indices.push(idx)
        invalid_count++
      }
    }
    return { cleaned, removed_indices, invalid_count }
  }

  // Interpolate mode
  const cleaned = [...values]
  for (let idx = 0; idx < cleaned.length; idx++) {
    if (!Number.isFinite(cleaned[idx])) {
      invalid_count++
      // Find nearest valid neighbors
      let left_idx = idx - 1
      while (left_idx >= 0 && !Number.isFinite(cleaned[left_idx])) left_idx--

      let right_idx = idx + 1
      while (right_idx < cleaned.length && !Number.isFinite(cleaned[right_idx])) {
        right_idx++
      }

      if (left_idx >= 0 && right_idx < cleaned.length) {
        // Linear interpolation
        const t = (idx - left_idx) / (right_idx - left_idx)
        cleaned[idx] = cleaned[left_idx] + t * (cleaned[right_idx] - cleaned[left_idx])
      } else if (left_idx >= 0) {
        cleaned[idx] = cleaned[left_idx]
      } else if (right_idx < cleaned.length) {
        cleaned[idx] = cleaned[right_idx]
      } else {
        cleaned[idx] = 0
      }
    }
  }

  return { cleaned, removed_indices: [], invalid_count }
}

// Apply physical bounds
export function apply_bounds(
  x_values: readonly number[],
  y_values: number[],
  bounds: PhysicalBounds,
): { y: number[]; violations: number; filtered_indices: number[] } {
  const result = [...y_values]
  const filtered_indices: number[] = []
  let violations = 0

  for (let idx = 0; idx < result.length; idx++) {
    const x_val = x_values[idx]
    const y_val = result[idx]

    const min_bound = typeof bounds.min === `function` ? bounds.min(x_val) : bounds.min
    const max_bound = typeof bounds.max === `function` ? bounds.max(x_val) : bounds.max

    let violated = false
    if (min_bound !== undefined && y_val < min_bound) violated = true
    if (max_bound !== undefined && y_val > max_bound) violated = true

    if (violated) {
      violations++
      const mode = bounds.mode ?? `clamp`

      if (mode === `clamp`) {
        if (min_bound !== undefined && y_val < min_bound) result[idx] = min_bound
        if (max_bound !== undefined && y_val > max_bound) result[idx] = max_bound
      } else if (mode === `filter`) {
        filtered_indices.push(idx)
      } else if (mode === `null`) {
        result[idx] = NaN
      }
    }
  }

  return { y: result, violations, filtered_indices }
}

// Sync metadata arrays with filtered data
export function sync_metadata<M>(
  metadata: M[] | M | undefined,
  kept_indices: number[],
): M[] | M | undefined {
  if (metadata === undefined) return undefined
  if (!Array.isArray(metadata)) return metadata // Scalar metadata unchanged

  return kept_indices.map((idx) => metadata[idx])
}

// Filter arrays by kept indices
function filter_by_indices<T>(arr: readonly T[], kept_indices: number[]): T[] {
  return kept_indices.map((idx) => arr[idx])
}

// Check if value is within bounds (static or x-dependent)
function is_in_bounds(val: number, x_val: number, bounds: PhysicalBounds): boolean {
  const min = typeof bounds.min === `function` ? bounds.min(x_val) : bounds.min
  const max = typeof bounds.max === `function` ? bounds.max(x_val) : bounds.max
  if (min !== undefined && val < min) return false
  if (max !== undefined && val > max) return false
  return true
}

// Compute kept indices by excluding removed indices
function kept_indices_excluding(length: number, removed: number[]): number[] {
  const removed_set = new Set(removed)
  return Array.from({ length }, (_, idx) => idx).filter((idx) => !removed_set.has(idx))
}

// --- Main API ---

// Clean a single series - main entry point
export function clean_series<T extends DataSeries>(
  series: T,
  config: CleaningConfig = {},
): CleaningResult<T> {
  const in_place = config.in_place ?? true
  const invalid_mode = config.invalid_values ?? `remove`
  const truncation_mode = config.truncation_mode ?? `mark_unstable`

  // Always work with copies initially
  let x_arr = [...series.x]
  let y_arr = [...series.y]
  let metadata = series.metadata
  let color_values = series.color_values ? [...series.color_values] : undefined
  let size_values = series.size_values ? [...series.size_values] : undefined

  const quality: CleaningQuality = {
    points_removed: 0,
    invalid_values_found: 0,
    oscillation_detected: false,
    bounds_violations: 0,
  }

  // Helper to apply filtering to all arrays
  const apply_filter = (kept: number[], removed_count: number) => {
    x_arr = filter_by_indices(x_arr, kept)
    y_arr = filter_by_indices(y_arr, kept)
    if (Array.isArray(metadata)) {
      metadata = filter_by_indices(metadata, kept)
    }
    if (color_values) color_values = filter_by_indices(color_values, kept)
    if (size_values) size_values = filter_by_indices(size_values, kept)
    quality.points_removed += removed_count
  }

  // Step 1: Handle invalid values
  const invalid_result = handle_invalid_values(y_arr, invalid_mode)
  quality.invalid_values_found = invalid_result.invalid_count

  if (invalid_mode === `remove` && invalid_result.removed_indices.length > 0) {
    const kept = kept_indices_excluding(x_arr.length, invalid_result.removed_indices)
    apply_filter(kept, invalid_result.removed_indices.length)
  } else {
    y_arr = invalid_result.cleaned
  }

  // Step 2: Apply physical bounds
  if (config.bounds) {
    const bounds_result = apply_bounds(x_arr, y_arr, config.bounds)
    y_arr = bounds_result.y
    quality.bounds_violations = bounds_result.violations

    if (config.bounds.mode === `filter` && bounds_result.filtered_indices.length > 0) {
      const kept = kept_indices_excluding(x_arr.length, bounds_result.filtered_indices)
      apply_filter(kept, bounds_result.filtered_indices.length)
    }
  }

  // Step 3: Remove local outliers (if configured)
  if (config.local_outliers) {
    const outlier_result = remove_local_outliers(y_arr, config.local_outliers)
    quality.outliers_removed = outlier_result.removed_indices.length

    if (outlier_result.removed_indices.length > 0) {
      apply_filter(outlier_result.kept_indices, outlier_result.removed_indices.length)
    }
  }

  // Step 4: Apply smoothing
  if (config.smooth) {
    y_arr = apply_smoothing(x_arr, y_arr, config.smooth)
  }

  // Step 5: Detect instability
  const instability = detect_instability(x_arr, y_arr, config)
  quality.oscillation_detected = instability.detected
  quality.oscillation_score = instability.combined_score

  if (instability.detected && instability.onset_index >= 0) {
    if (truncation_mode === `hard_cut`) {
      const kept = Array.from({ length: instability.onset_index }, (_, idx) => idx)
      quality.truncated_at_x = instability.onset_x
      apply_filter(kept, x_arr.length - instability.onset_index)
    } else {
      quality.stable_range = [x_arr[0], instability.onset_x]
    }
  }

  // Build result series
  const result_series = (in_place ? series : { ...series }) as T
  ;(result_series as DataSeries).x = x_arr
  ;(result_series as DataSeries).y = y_arr
  if (metadata !== undefined) (result_series as DataSeries).metadata = metadata
  if (color_values) (result_series as DataSeries).color_values = color_values
  if (size_values) (result_series as DataSeries).size_values = size_values

  return { series: result_series, quality }
}

// Clean multiple y-series with shared x, filtering to intersection of valid indices
export function clean_multi_series(
  x_values: readonly number[],
  y_arrays: number[][],
  config: CleaningConfig = {},
): { x: number[]; cleaned_y: number[][]; quality: CleaningQuality[] } {
  if (y_arrays.length === 0) {
    return { x: [...x_values], cleaned_y: [], quality: [] }
  }

  const invalid_mode = config.invalid_values ?? `remove`
  const length = Math.min(x_values.length, ...y_arrays.map((arr) => arr.length))
  const { bounds, smooth } = config

  // Find indices valid across ALL y series (remove mode filters invalid values)
  let kept_indices = Array.from({ length }, (_, idx) => idx)
  if (invalid_mode === `remove`) {
    kept_indices = kept_indices.filter((idx) =>
      y_arrays.every((y_arr) => Number.isFinite(y_arr[idx]))
    )
  }

  // Apply bounds filter across all series
  if (bounds?.mode === `filter`) {
    kept_indices = kept_indices.filter((idx) => {
      const x_val = x_values[idx]
      return y_arrays.every((y_arr) => is_in_bounds(y_arr[idx], x_val, bounds))
    })
  }

  const filtered_x = kept_indices.map((idx) => x_values[idx])
  const cleaned_y: number[][] = []
  const quality_reports: CleaningQuality[] = []

  for (const y_arr of y_arrays) {
    let filtered_y = kept_indices.map((idx) => y_arr[idx])
    // Count invalid values only in aligned prefix (not beyond length)
    let invalid_count = 0
    for (let idx = 0; idx < length; idx++) {
      if (!Number.isFinite(y_arr[idx])) invalid_count++
    }
    const quality: CleaningQuality = {
      points_removed: length - kept_indices.length,
      invalid_values_found: invalid_count,
      oscillation_detected: false,
      bounds_violations: 0,
    }

    if (invalid_mode === `interpolate`) {
      filtered_y = handle_invalid_values(filtered_y, `interpolate`).cleaned
    }
    if (bounds && bounds.mode !== `filter`) {
      const result = apply_bounds(filtered_x, filtered_y, bounds)
      filtered_y = result.y
      quality.bounds_violations = result.violations
    }
    if (smooth) {
      filtered_y = apply_smoothing(filtered_x, filtered_y, smooth)
    }

    cleaned_y.push(filtered_y)
    quality_reports.push(quality)
  }

  return { x: filtered_x, cleaned_y, quality: quality_reports }
}

// Clean correlated x/y/z for 3D data
// All three arrays are filtered to the intersection of valid indices
export function clean_xyz(
  x_values: readonly number[],
  y_values: readonly number[],
  z_values: readonly number[],
  config: CleaningConfig & { primary_axis?: `x` | `y` | `z` } = {},
): { x: number[]; y: number[]; z: number[]; quality: CleaningQuality } {
  const invalid_mode = config.invalid_values ?? `remove`
  const length = Math.min(x_values.length, y_values.length, z_values.length)

  const all_arrays = [x_values, y_values, z_values] as const
  const { bounds, smooth } = config

  // Count invalid values across all arrays
  let invalid_count = 0
  for (let idx = 0; idx < length; idx++) {
    if (!all_arrays.every((arr) => Number.isFinite(arr[idx]))) invalid_count++
  }

  // Find indices where ALL values are valid (remove mode filters)
  let kept_indices = Array.from({ length }, (_, idx) => idx)
  if (invalid_mode === `remove`) {
    kept_indices = kept_indices.filter((idx) =>
      all_arrays.every((arr) => Number.isFinite(arr[idx]))
    )
  }

  let filtered = {
    x: kept_indices.map((idx) => x_values[idx]),
    y: kept_indices.map((idx) => y_values[idx]),
    z: kept_indices.map((idx) => z_values[idx]),
  }

  const quality: CleaningQuality = {
    points_removed: length - kept_indices.length,
    invalid_values_found: invalid_count,
    oscillation_detected: false,
    bounds_violations: 0,
  }

  if (invalid_mode === `interpolate`) {
    filtered.x = handle_invalid_values(filtered.x, `interpolate`).cleaned
    filtered.y = handle_invalid_values(filtered.y, `interpolate`).cleaned
    filtered.z = handle_invalid_values(filtered.z, `interpolate`).cleaned
  }

  // Apply bounds filter on primary axis
  if (bounds?.mode === `filter`) {
    const primary = config.primary_axis ?? `x`
    const bounds_kept: number[] = []
    for (let idx = 0; idx < filtered.x.length; idx++) {
      const primary_val = filtered[primary][idx]
      // Use x-axis value for dynamic bounds computation (e.g., max: (x) => x * 2)
      if (is_in_bounds(primary_val, filtered.x[idx], bounds)) {
        bounds_kept.push(idx)
      } else {
        quality.bounds_violations++
      }
    }
    filtered = {
      x: bounds_kept.map((idx) => filtered.x[idx]),
      y: bounds_kept.map((idx) => filtered.y[idx]),
      z: bounds_kept.map((idx) => filtered.z[idx]),
    }
    quality.points_removed += kept_indices.length - bounds_kept.length
  }

  // Smooth dependent axes (y, z) using x as independent reference
  // x-axis is never smoothed as it's typically the independent variable (time, index, etc.)
  if (smooth) {
    filtered.y = apply_smoothing(filtered.x, filtered.y, smooth)
    filtered.z = apply_smoothing(filtered.x, filtered.z, smooth)
  }

  return { ...filtered, quality }
}

// Clean trajectory properties, filtering to intersection of valid indices
export function clean_trajectory_props(
  props: Record<string, number[]>,
  config: CleaningConfig & { independent_axis?: string } = {},
): { props: Record<string, number[]>; quality: Record<string, CleaningQuality> } {
  const entries = Object.entries(props)
  if (entries.length === 0) {
    return { props: {}, quality: {} }
  }

  const independent_axis = config.independent_axis ?? `Step`
  const invalid_mode = config.invalid_values ?? `remove`
  const { smooth } = config
  const length = Math.min(...entries.map(([, arr]) => arr.length))

  // Use existing or generate independent axis
  const x_values = props[independent_axis] ?? Array.from({ length }, (_, idx) => idx)

  // Count invalid values per property (only within aligned prefix)
  const invalid_counts: Record<string, number> = Object.fromEntries(
    entries.map(([key, arr]) => {
      let count = 0
      for (let idx = 0; idx < length; idx++) {
        if (!Number.isFinite(arr[idx])) count++
      }
      return [key, count]
    }),
  )

  // Find indices valid across ALL properties (remove mode filters)
  let kept_indices = Array.from({ length }, (_, idx) => idx)
  if (invalid_mode === `remove`) {
    kept_indices = kept_indices.filter((idx) =>
      entries.every(([, arr]) => Number.isFinite(arr[idx]))
    )
  }

  const filtered_x = kept_indices.map((idx) => x_values[idx])
  const result_props: Record<string, number[]> = {}
  const quality_reports: Record<string, CleaningQuality> = {}

  for (const [key, arr] of entries) {
    let filtered = kept_indices.map((idx) => arr[idx])
    const quality: CleaningQuality = {
      points_removed: length - kept_indices.length,
      invalid_values_found: invalid_counts[key],
      oscillation_detected: false,
      bounds_violations: 0,
    }

    if (invalid_mode === `interpolate`) {
      filtered = handle_invalid_values(filtered, `interpolate`).cleaned
    }
    if (smooth && key !== independent_axis) {
      filtered = apply_smoothing(filtered_x, filtered, smooth)
    }

    result_props[key] = filtered
    quality_reports[key] = quality
  }

  // Add independent axis if not in original props
  if (!props[independent_axis]) {
    result_props[independent_axis] = filtered_x
    quality_reports[independent_axis] = {
      points_removed: length - kept_indices.length,
      invalid_values_found: 0,
      oscillation_detected: false,
      bounds_violations: 0,
    }
  }

  return { props: result_props, quality: quality_reports }
}

// --- Utility Functions ---

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Simple matrix operations for Savitzky-Golay
function transpose(matrix: number[][]): number[][] {
  if (matrix.length === 0) return []
  const rows = matrix.length
  const cols = matrix[0].length
  const result: number[][] = Array.from({ length: cols }, () => new Array(rows))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      result[col][row] = matrix[row][col]
    }
  }
  return result
}

function multiply_matrices(a: number[][], b: number[][]): number[][] {
  const rows_a = a.length
  const cols_a = a[0]?.length ?? 0
  const cols_b = b[0]?.length ?? 0

  const result: number[][] = Array.from(
    { length: rows_a },
    () => new Array(cols_b).fill(0),
  )

  for (let row = 0; row < rows_a; row++) {
    for (let col = 0; col < cols_b; col++) {
      for (let k = 0; k < cols_a; k++) {
        result[row][col] += a[row][k] * b[k][col]
      }
    }
  }

  return result
}

function invert_matrix(matrix: number[][]): number[][] | null {
  const n = matrix.length
  if (n === 0 || matrix[0].length !== n) return null

  // Create augmented matrix [A | I]
  const aug: number[][] = matrix.map((row, idx) => [
    ...row,
    ...Array.from({ length: n }, (_, jdx) => (idx === jdx ? 1 : 0)),
  ])

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let max_row = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[max_row][col])) {
        max_row = row
      }
    }

    if (Math.abs(aug[max_row][col]) < 1e-10) {
      return null // Singular
    } // Swap rows

    ;[aug[col], aug[max_row]] = [aug[max_row], aug[col]]

    // Eliminate column
    const pivot = aug[col][col]
    for (let jdx = 0; jdx < 2 * n; jdx++) {
      aug[col][jdx] /= pivot
    }

    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const factor = aug[row][col]
        for (let jdx = 0; jdx < 2 * n; jdx++) {
          aug[row][jdx] -= factor * aug[col][jdx]
        }
      }
    }
  }

  // Extract inverse
  return aug.map((row) => row.slice(n))
}
