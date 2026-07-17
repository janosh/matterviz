// Signal-processing primitives for plot data cleaning: rolling variance, instability/oscillation
// detection, smoothing (moving average, Savitzky-Golay) and local (MAD-based) outlier removal.
// Pure numeric helpers with no plot/series dependencies; orchestration lives in ./data-cleaning.

import { median as d3_median } from 'd3-array'

// Oscillation detection weights (all default to 1.0)
export interface OscillationWeights {
  derivative_variance?: number // Weight for derivative variance method
  amplitude_growth?: number // Weight for exponential amplitude growth
  sign_changes?: number // Weight for derivative sign change frequency
}

// Smoothing algorithm configuration (discriminated union for type safety)
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

// Result of local outlier detection
export interface LocalOutlierResult {
  kept_indices: number[]
  removed_indices: number[]
  iterations_used: number
}

// Instability detection result
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

// Default configuration values
const DEFAULT_WINDOW_SIZE = 5
const DEFAULT_OSCILLATION_THRESHOLD = 3.0
const DEFAULT_POLYNOMIAL_ORDER = 2

// --- Core Detection Functions ---

// Compute rolling variance using Welford's online algorithm - O(n)
// Returns variance for each point based on surrounding window
export function compute_local_variance(values: number[], window_size: number): number[] {
  const len = values.length
  if (len === 0) return []
  if (len === 1) return [0]

  const half_window = Math.floor(window_size / 2)
  const result: number[] = Array(len)

  // Single pass for each index, no slice allocation (avoids O(n × window) allocations)
  for (let idx = 0; idx < len; idx++) {
    const start = Math.max(0, idx - half_window)
    const end = Math.min(len, idx + half_window + 1)

    // Welford's online variance calculation
    let [mean, m2, count] = [0, 0, 0]
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
  const derivs: number[] = Array(values.length - 1)
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
  config: {
    oscillation_weights?: OscillationWeights
    oscillation_threshold?: number
    window_size?: number
  } = {},
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
    const method_scores = { derivative_variance: 0, amplitude_growth: 0, sign_changes: 0 }
    const detected = false
    return { detected, onset_index: -1, onset_x: NaN, combined_score: 0, method_scores }
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
  const total_weight =
    weights.derivative_variance + weights.amplitude_growth + weights.sign_changes
  const combined_score =
    total_weight > 0
      ? (weights.derivative_variance * deriv_result.score +
          weights.amplitude_growth * amp_result.score +
          weights.sign_changes * sign_result.score) /
        total_weight
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
  const onset_x =
    onset_index >= 0 && onset_index < x_values.length ? x_values[onset_index] : NaN

  return { detected, onset_index, onset_x, combined_score, method_scores }
}

// --- Smoothing Functions ---

// Moving average - O(n)
export function smooth_moving_average(values: number[], window: number): number[] {
  if (values.length === 0 || window <= 1) return [...values]

  const result: number[] = Array(values.length)
  const half_window = Math.floor(window / 2)

  for (let idx = 0; idx < values.length; idx++) {
    const start = Math.max(0, idx - half_window)
    const end = Math.min(values.length, idx + half_window + 1)
    let [sum, count] = [0, 0]

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
      row.push(idx ** power)
    }
    vandermonde.push(row)
  }

  // Compute (V^T V)^-1 V^T using simple pseudoinverse
  // For smoothing, we only need the first row (constant term coefficients)
  const vtv = multiply_matrices(transpose(vandermonde), vandermonde)
  const vtv_inv = invert_matrix(vtv)
  if (!vtv_inv) {
    // Fallback to uniform weights
    return Array(size).fill(1 / size)
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
  // max/min clamps above can re-even the window (polynomial_order + 2 is even for even orders;
  // values.length may be even). Force odd so the kernel stays symmetric and matches
  // compute_savgol_coefficients' (2 * floor(window / 2) + 1)-length row.
  if (actual_window % 2 === 0) actual_window -= 1

  if (actual_window < 3) return [...values]

  const coeffs = compute_savgol_coefficients(actual_window, polynomial_order)
  const half = Math.floor(actual_window / 2)
  const result: number[] = Array(values.length)
  // Cache coefficient sum to avoid O(n × window) redundant reductions in loop
  const coeffs_sum = coeffs.reduce((sum, coeff) => sum + coeff, 0)

  for (let idx = 0; idx < values.length; idx++) {
    let [sum, weight_sum] = [0, 0]

    for (let jdx = 0; jdx < actual_window; jdx++) {
      const data_idx = idx - half + jdx
      if (data_idx >= 0 && data_idx < values.length && Number.isFinite(values[data_idx])) {
        sum += coeffs[jdx] * values[data_idx]
        weight_sum += coeffs[jdx]
      }
    }

    result[idx] = weight_sum !== 0 ? (sum / weight_sum) * coeffs_sum : values[idx]
  }

  return result
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

  let kept_mask = Array(len).fill(true)
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

// --- Utility Functions ---

function median(values: number[]): number {
  return d3_median(values) ?? 0
}

// Simple matrix operations for Savitzky-Golay
function transpose(matrix: number[][]): number[][] {
  if (matrix.length === 0) return []
  const rows = matrix.length
  const cols = matrix[0].length
  const result: number[][] = Array.from({ length: cols }, () => Array(rows).fill(0))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      result[col][row] = matrix[row][col]
    }
  }
  return result
}

function multiply_matrices(matrix_a: number[][], matrix_b: number[][]): number[][] {
  const rows_a = matrix_a.length
  const cols_a = matrix_a[0]?.length ?? 0
  const cols_b = matrix_b[0]?.length ?? 0

  const result: number[][] = Array.from({ length: rows_a }, () => Array(cols_b).fill(0))

  for (let row = 0; row < rows_a; row++) {
    for (let col = 0; col < cols_b; col++) {
      for (let idx_k = 0; idx_k < cols_a; idx_k++) {
        result[row][col] += matrix_a[row][idx_k] * matrix_b[idx_k][col]
      }
    }
  }

  return result
}

function invert_matrix(matrix: number[][]): number[][] | null {
  const size = matrix.length
  if (size === 0 || matrix[0].length !== size) return null

  // Create augmented matrix [A | I]
  const aug: number[][] = matrix.map((row, idx) => [
    ...row,
    ...Array.from({ length: size }, (_, jdx) => (idx === jdx ? 1 : 0)),
  ])

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < size; col++) {
    // Find pivot
    let max_row = col
    for (let row = col + 1; row < size; row++) {
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
    for (let jdx = 0; jdx < 2 * size; jdx++) {
      aug[col][jdx] /= pivot
    }

    for (let row = 0; row < size; row++) {
      if (row !== col) {
        const factor = aug[row][col]
        for (let jdx = 0; jdx < 2 * size; jdx++) {
          aug[row][jdx] -= factor * aug[col][jdx]
        }
      }
    }
  }

  // Extract inverse
  return aug.map((row) => row.slice(size))
}
