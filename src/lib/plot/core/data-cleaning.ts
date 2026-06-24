// Data cleaning utilities for plot data
// Enforces physical bounds, handles invalid values, and cleans multi-dimensional datasets.
// Signal-processing primitives (variance, instability detection, smoothing, outlier removal)
// live in ./data-cleaning-signal and are re-exported here so the public API is unchanged.

import type { Vec2 } from '$lib/math'
import type { DataSeries } from '$lib/plot/core/types'
import { apply_gaussian_smearing } from '$lib/spectral/helpers'
import {
  detect_instability,
  type LocalOutlierConfig,
  type OscillationWeights,
  remove_local_outliers,
  type SmoothingConfig,
  smooth_moving_average,
  smooth_savitzky_golay,
} from '$lib/plot/core/data-cleaning-signal'

export * from '$lib/plot/core/data-cleaning-signal'

// --- Data Cleaning Types ---

// How to handle invalid values (NaN, Infinity)
export type InvalidValueMode = `remove` | `propagate` | `interpolate`

// Truncation strategy when instability detected
export type TruncationMode = `hard_cut` | `mark_unstable`

// Physical bounds configuration
export interface PhysicalBounds {
  min?: number | ((x: number) => number) // Static or x-dependent minimum
  max?: number | ((x: number) => number) // Static or x-dependent maximum
  mode?: `clamp` | `filter` | `null` // How to handle violations
}

// Main cleaning configuration
export interface CleaningConfig {
  // Oscillation detection
  oscillation_threshold?: number // Combined score threshold (default: 3.0)
  oscillation_weights?: OscillationWeights // Method weights
  window_size?: number // Rolling window for detection (default: 5)

  // Data handling
  invalid_values?: InvalidValueMode // NaN/Infinity handling (default: 'remove')
  bounds?: PhysicalBounds // Physical constraints
  smooth?: SmoothingConfig // Optional smoothing
  local_outliers?: LocalOutlierConfig // Local sliding window outlier removal

  // Truncation
  truncation_mode?: TruncationMode // 'hard_cut' or 'mark_unstable' (default: 'mark_unstable')

  // Performance
  in_place?: boolean // Mutate input arrays (default: true)
}

// Quality report from cleaning operation
export interface CleaningQuality {
  points_removed: number
  invalid_values_found: number // NaN/Infinity count
  oscillation_detected: boolean
  oscillation_score?: number // Combined weighted score
  bounds_violations: number
  outliers_removed?: number // Count of local outliers removed
  stable_range?: Vec2 // [start_x, end_x] if mark_unstable mode
  truncated_at_x?: number // x value if hard_cut mode
}

// Result of a cleaning operation
export interface CleaningResult<T = DataSeries> {
  series: T // Cleaned data (same ref if in_place)
  quality: CleaningQuality
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
    // omit polynomial_order so smooth_savitzky_golay applies its own default
    return smooth_savitzky_golay(y_values, config.window, config.polynomial_order)
  } else if (config.type === `gaussian`) {
    return apply_gaussian_smearing(x_values, y_values, config.sigma)
  }
  return y_values
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
        const frac = (idx - left_idx) / (right_idx - left_idx)
        cleaned[idx] = cleaned[left_idx] + frac * (cleaned[right_idx] - cleaned[left_idx])
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
const filter_by_indices = <T>(arr: readonly T[], kept_indices: number[]): T[] =>
  kept_indices.map((idx) => arr[idx])

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
  const result_series = in_place ? series : { ...series }
  result_series.x = x_arr
  result_series.y = y_arr
  if (metadata !== undefined) result_series.metadata = metadata
  if (color_values) result_series.color_values = color_values
  if (size_values) result_series.size_values = size_values

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
      y_arrays.every((y_arr) => Number.isFinite(y_arr[idx])),
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
      all_arrays.every((arr) => Number.isFinite(arr[idx])),
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
      // Use x-axis value for dynamic bounds computation (e.g., max: (x_val) => x_val * 2)
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
      entries.every(([, arr]) => Number.isFinite(arr[idx])),
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
