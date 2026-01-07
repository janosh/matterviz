// Fill-between utility functions for ScatterPlot fill regions
// Handles interpolation, boundary resolution, and path generation

import type { CurveFactory } from 'd3-shape'
import {
  area,
  curveBasis,
  curveCardinal,
  curveCatmullRom,
  curveLinear,
  curveMonotoneX,
  curveMonotoneY,
  curveNatural,
  curveStep,
  curveStepAfter,
  curveStepBefore,
} from 'd3-shape'
import type {
  DataSeries,
  ErrorBand,
  FillBoundary,
  FillCurveType,
  FillRegion,
  ScaleType,
} from './types'

// Epsilon value for log scale clamping (to avoid log(0) = -Infinity)
export const LOG_EPSILON = 1e-10

// Data point type for fill path generation
export interface FillPathPoint {
  x: number
  y1: number
  y2: number
}

// Result type for interpolated series
export interface InterpolatedSeries {
  x: number[]
  y_a: number[]
  y_b: number[]
}

// Result type for range-filtered data
export interface FilteredFillData {
  x: number[]
  y1: number[]
  y2: number[]
  // Original indices before filtering (for mapping back)
  original_indices: number[]
}

// Result type for where-conditioned data (may have multiple segments)
export interface ConditionedFillData {
  segments: FillPathPoint[][]
}

// Result type for log-scale clamped data
export interface ClampedFillData {
  x: number[]
  y1: number[]
  y2: number[]
  // Track which points were clamped (for optional warnings)
  clamped_indices: number[]
}

// Resolves a series reference (by index or id) to the actual DataSeries
// Returns null if the reference cannot be resolved
export function resolve_series_ref(
  ref: { type: `series`; series_idx?: number; series_id?: string | number },
  series: readonly DataSeries[],
): DataSeries | null {
  if (`series_idx` in ref && typeof ref.series_idx === `number`) {
    const idx = ref.series_idx
    if (idx >= 0 && idx < series.length) {
      return series[idx]
    }
    return null
  }

  if (`series_id` in ref && ref.series_id !== undefined) {
    const found = series.find((data_series) => data_series.id === ref.series_id)
    return found ?? null
  }

  return null
}

// Helper: linear interpolation at a specific x value
function interpolate_at(
  x_values: readonly number[],
  y_values: readonly number[],
  target_x: number,
): number {
  // Find bracketing indices
  let [left_idx, right_idx] = [-1, -1]
  for (let idx = 0; idx < x_values.length; idx++) {
    if (x_values[idx] <= target_x) left_idx = idx
    if (x_values[idx] >= target_x && right_idx === -1) right_idx = idx
  }

  // Handle edge cases: exact match, before all, after all
  if (left_idx >= 0 && x_values[left_idx] === target_x) return y_values[left_idx]
  if (left_idx === -1) return y_values[0]
  if (right_idx === -1) return y_values[y_values.length - 1]

  // Linear interpolation
  const x_left = x_values[left_idx]
  const x_right = x_values[right_idx]
  const y_left = y_values[left_idx]
  const y_right = y_values[right_idx]
  return x_right === x_left
    ? y_left
    : y_left + ((target_x - x_left) / (x_right - x_left)) * (y_right - y_left)
}

// Helper: step interpolation at a specific x value
function step_interpolate_at(
  x_values: readonly number[],
  y_values: readonly number[],
  target_x: number,
): number {
  // Find the last x value <= target_x
  let last_idx = -1
  for (let idx = 0; idx < x_values.length; idx++) {
    if (x_values[idx] <= target_x) last_idx = idx
    else break
  }

  // Before all x values, use first y value
  if (last_idx === -1) return y_values[0]

  return y_values[last_idx]
}

// Interpolates two series to have matching x-values
// Returns arrays with the union of all x-values, sorted
export function interpolate_series(
  series_a: { x: readonly number[]; y: readonly number[] },
  series_b: { x: readonly number[]; y: readonly number[] },
  method: `linear` | `step` = `linear`,
): InterpolatedSeries {
  // Create union of x-values
  const x_set = new Set<number>()
  for (const curr_x of series_a.x) x_set.add(curr_x)
  for (const curr_x of series_b.x) x_set.add(curr_x)

  // Sort x-values
  const all_x = Array.from(x_set).sort((val_a, val_b) => val_a - val_b)

  const interpolate_fn = method === `step` ? step_interpolate_at : interpolate_at

  // Interpolate y values for each x
  const y_a = all_x.map((target_x) => interpolate_fn(series_a.x, series_a.y, target_x))
  const y_b = all_x.map((target_x) => interpolate_fn(series_b.x, series_b.y, target_x))

  return { x: all_x, y_a, y_b }
}

// Domain context for boundary resolution
interface DomainContext {
  y_domain: [number, number]
  y2_domain?: [number, number]
}

// Resolves a FillBoundary definition to an array of y-values at given x positions
// Returns null if the boundary cannot be resolved
export function resolve_boundary(
  boundary: FillBoundary,
  series: readonly DataSeries[],
  x_values: readonly number[],
  domains: DomainContext,
): number[] | null {
  // Handle shorthand number (constant value)
  if (typeof boundary === `number`) {
    return x_values.map(() => boundary)
  }

  switch (boundary.type) {
    case `series`: {
      const resolved = resolve_series_ref(boundary, series)
      if (!resolved) return null
      // Interpolate to match x_values
      const interpolated = interpolate_series(
        { x: x_values, y: x_values.map(() => 0) },
        { x: resolved.x, y: resolved.y },
        `linear`,
      )
      return interpolated.y_b
    }

    case `constant`:
      return x_values.map(() => boundary.value)

    case `axis`: {
      // For axis boundaries, return the edge value of the appropriate axis domain
      let value: number
      if (boundary.value !== undefined) {
        value = boundary.value
      } else if (boundary.axis === `y2` && domains.y2_domain) {
        value = domains.y2_domain[0]
      } else {
        // Default: use bottom of y-domain (works for x-axis and y-axis)
        value = domains.y_domain[0]
      }
      return x_values.map(() => value)
    }

    case `function`:
      return x_values.map((curr_x) => boundary.fn(curr_x))

    case `data`:
      // If lengths match, use directly; otherwise interpolate
      if (boundary.values.length === x_values.length) {
        return [...boundary.values]
      }
      // Lengths don't match: truncate if values is longer, or extend last value if shorter
      return x_values.map((_, idx) =>
        boundary.values[idx] ?? boundary.values[boundary.values.length - 1]
      )

    default:
      return null
  }
}

export function apply_range_constraints(
  x_values: readonly number[],
  y1_values: readonly number[],
  y2_values: readonly number[],
  region: Pick<FillRegion, `x_range` | `y_range`>,
): FilteredFillData {
  const [x_min, x_max] = region.x_range ?? [null, null]
  const [y_min, y_max] = region.y_range ?? [null, null]

  // Helper to clamp value within optional bounds
  const clamp = (val: number) =>
    Math.min(y_max ?? Infinity, Math.max(y_min ?? -Infinity, val))

  const result = {
    x: [] as number[],
    y1: [] as number[],
    y2: [] as number[],
    original_indices: [] as number[],
  }

  for (let idx = 0; idx < x_values.length; idx++) {
    const [curr_x, curr_y1, curr_y2] = [x_values[idx], y1_values[idx], y2_values[idx]]

    // Skip if outside x range
    if ((x_min !== null && curr_x < x_min) || (x_max !== null && curr_x > x_max)) continue

    // Skip if fill region doesn't overlap y range
    const [fill_min, fill_max] = [Math.min(curr_y1, curr_y2), Math.max(curr_y1, curr_y2)]
    if ((y_min !== null && fill_max < y_min) || (y_max !== null && fill_min > y_max)) {
      continue
    }

    result.x.push(curr_x)
    result.y1.push(clamp(curr_y1))
    result.y2.push(clamp(curr_y2))
    result.original_indices.push(idx)
  }

  return result
}

// Helper: find x-coordinate where condition changes (linear interpolation)
function find_crossing(
  x1: number,
  y1_upper: number,
  y1_lower: number,
  x2: number,
  y2_upper: number,
  y2_lower: number,
  condition: (x: number, y_upper: number, y_lower: number) => boolean,
): number | null {
  const cond1 = condition(x1, y1_upper, y1_lower)
  const cond2 = condition(x2, y2_upper, y2_lower)

  if (cond1 === cond2) return null

  // Binary search for crossing point
  let left = x1
  let right = x2
  const tolerance = (x2 - x1) * 0.001

  for (let iter = 0; iter < 20; iter++) {
    const mid = (left + right) / 2
    const weight = (mid - x1) / (x2 - x1)
    const mid_upper = y1_upper + weight * (y2_upper - y1_upper)
    const mid_lower = y1_lower + weight * (y2_lower - y1_lower)
    const mid_cond = condition(mid, mid_upper, mid_lower)

    if (mid_cond === cond1) {
      left = mid
    } else {
      right = mid
    }

    if (right - left < tolerance) break
  }

  return (left + right) / 2
}

export function apply_where_condition(
  x_values: readonly number[],
  y1_values: readonly number[],
  y2_values: readonly number[],
  region: Pick<FillRegion, `where`>,
): ConditionedFillData {
  if (!region.where) {
    // No condition - return single segment with all points
    const points: FillPathPoint[] = x_values.map((curr_x, idx) => ({
      x: curr_x,
      y1: y1_values[idx],
      y2: y2_values[idx],
    }))
    return { segments: [points] }
  }

  const segments: FillPathPoint[][] = []
  let current_segment: FillPathPoint[] = []

  for (let idx = 0; idx < x_values.length; idx++) {
    const curr_x = x_values[idx]
    const curr_y1 = y1_values[idx]
    const curr_y2 = y2_values[idx]
    const passes = region.where(curr_x, curr_y1, curr_y2)

    if (idx > 0) {
      const prev_x = x_values[idx - 1]
      const prev_y1 = y1_values[idx - 1]
      const prev_y2 = y2_values[idx - 1]
      const prev_passes = region.where(prev_x, prev_y1, prev_y2)

      // Check for condition crossing between prev and current
      if (passes !== prev_passes) {
        const crossing_x = find_crossing(
          prev_x,
          prev_y1,
          prev_y2,
          curr_x,
          curr_y1,
          curr_y2,
          region.where,
        )

        if (crossing_x !== null) {
          // Interpolate y values at crossing point
          const weight = (crossing_x - prev_x) / (curr_x - prev_x)
          const crossing_y1 = prev_y1 + weight * (curr_y1 - prev_y1)
          const crossing_y2 = prev_y2 + weight * (curr_y2 - prev_y2)

          if (prev_passes) {
            // End current segment at crossing
            current_segment.push({ x: crossing_x, y1: crossing_y1, y2: crossing_y2 })
            segments.push(current_segment)
            current_segment = []
          } else {
            // Start new segment at crossing
            current_segment.push({ x: crossing_x, y1: crossing_y1, y2: crossing_y2 })
          }
        }
      }
    }

    if (passes) {
      current_segment.push({ x: curr_x, y1: curr_y1, y2: curr_y2 })
    } else if (current_segment.length > 0) {
      segments.push(current_segment)
      current_segment = []
    }
  }

  // Don't forget the last segment
  if (current_segment.length > 0) {
    segments.push(current_segment)
  }

  return { segments }
}

export function clamp_for_log_scale(
  x_values: readonly number[],
  y1_values: readonly number[],
  y2_values: readonly number[],
  y_scale_type: ScaleType,
  x_scale_type: ScaleType = `linear`,
): ClampedFillData {
  const result_x: number[] = []
  const result_y1: number[] = []
  const result_y2: number[] = []
  const clamped_indices: number[] = []

  for (let idx = 0; idx < x_values.length; idx++) {
    let curr_x = x_values[idx]
    let curr_y1 = y1_values[idx]
    let curr_y2 = y2_values[idx]
    let was_clamped = false

    // Clamp x if x-axis is log scale
    if (x_scale_type === `log` && curr_x <= 0) {
      curr_x = LOG_EPSILON
      was_clamped = true
    }

    // Clamp y values if y-axis is log scale
    if (y_scale_type === `log`) {
      if (curr_y1 <= 0) {
        curr_y1 = LOG_EPSILON
        was_clamped = true
      }
      if (curr_y2 <= 0) {
        curr_y2 = LOG_EPSILON
        was_clamped = true
      }
    }

    result_x.push(curr_x)
    result_y1.push(curr_y1)
    result_y2.push(curr_y2)

    if (was_clamped) {
      clamped_indices.push(idx)
    }
  }

  return {
    x: result_x,
    y1: result_y1,
    y2: result_y2,
    clamped_indices,
  }
}

// Map FillCurveType to d3 curve factory
const CURVE_MAP: Record<FillCurveType, CurveFactory> = {
  linear: curveLinear,
  monotoneX: curveMonotoneX,
  monotoneY: curveMonotoneY,
  step: curveStep,
  stepBefore: curveStepBefore,
  stepAfter: curveStepAfter,
  basis: curveBasis,
  cardinal: curveCardinal,
  catmullRom: curveCatmullRom,
  natural: curveNatural,
}

const get_curve = (curve_type: FillCurveType): CurveFactory =>
  CURVE_MAP[curve_type] ?? curveMonotoneX

// Generate SVG path string for a fill region
// data should already be in pixel coordinates
export function generate_fill_path(
  data: readonly FillPathPoint[],
  curve_type: FillCurveType = `monotoneX`,
): string {
  if (data.length === 0) return ``

  const curve = get_curve(curve_type)

  const area_generator = area<FillPathPoint>()
    .x((point) => point.x)
    .y0((point) => point.y1)
    .y1((point) => point.y2)
    .curve(curve)

  return area_generator(data as FillPathPoint[]) ?? ``
}

// Helper to expand error definition to array
function expand_error(
  err: number | readonly number[],
  length: number,
): readonly number[] {
  return typeof err === `number` ? Array(length).fill(err) : err
}

// Convert an ErrorBand convenience type to a full FillRegion
export function convert_error_band_to_fill_region(
  error_band: ErrorBand,
  series: readonly DataSeries[],
  default_color?: string,
): FillRegion | null {
  const resolved = resolve_series_ref(error_band.series, series)
  if (!resolved) return null

  const { y } = resolved
  const { error } = error_band

  // Determine upper/lower error arrays
  const [upper_err, lower_err] = typeof error === `object` && `upper` in error
    ? [expand_error(error.upper, y.length), expand_error(error.lower, y.length)]
    : [expand_error(error, y.length), expand_error(error, y.length)]

  return {
    id: error_band.id,
    label: error_band.label,
    upper: { type: `data`, values: y.map((val, idx) => val + upper_err[idx]) },
    lower: { type: `data`, values: y.map((val, idx) => val - lower_err[idx]) },
    fill: error_band.fill ?? default_color ?? `#4e79a7`,
    fill_opacity: error_band.fill_opacity ?? 0.3,
    edge_upper: error_band.edge_style,
    edge_lower: error_band.edge_style,
    show_in_legend: error_band.show_in_legend ?? true,
  }
}
