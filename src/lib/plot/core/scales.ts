import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import * as math from '$lib/math'
import type { Point, ScaleType, TimeInterval } from '$lib/plot'
import {
  get_arcsinh_threshold,
  get_scale_type_name,
  is_time_scale,
} from '$lib/plot/core/types'
import { extent, range } from 'd3-array'
import type { ScaleContinuousNumeric, ScaleTime } from 'd3-scale'
import {
  scaleLinear,
  scaleLog,
  scaleSequential,
  scaleSequentialLog,
  scaleTime,
} from 'd3-scale'
import * as d3_sc from 'd3-scale-chromatic'

// Type for ticks parameter - can be count, array of values, time interval, or object mapping values to labels
export type TicksOption = number | number[] | TimeInterval | Record<number, string>

// Dedupe and sort numeric array (used in tick generation)
const dedupe_sort = (arr: number[]): number[] => [...new Set(arr)].sort((a, b) => a - b)

// --- Arcsinh Scale Implementation ---
// The arcsinh scale provides smooth transition between linear (near zero) and
// logarithmic (for large |x|) behavior. Unlike log, it handles negative values.
// Formula: y = asinh(x / threshold) = ln(x/c + sqrt((x/c)² + 1))

// Interface for arcsinh scale (D3-compatible)
// Accepts both number and Date for compatibility with time-based data
export interface ArcsinhScale {
  (value: number | Date): number
  domain(): Vec2
  domain(domain: Vec2): ArcsinhScale
  range(): Vec2
  range(range: Vec2): ArcsinhScale
  invert(value: number): number
  copy(): ArcsinhScale
  ticks(count?: number): number[]
  threshold: number
}

// Union type for all scale functions used in plots
export type PlotScaleFn =
  | ScaleContinuousNumeric<number, number>
  | ScaleTime<number, number>
  | ArcsinhScale

// Create an arcsinh scale with configurable threshold
export function scale_arcsinh(threshold = 1): ArcsinhScale {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(`arcsinh threshold must be a positive finite number, got ${threshold}`)
  }

  let current_domain: Vec2 = [0, 1]
  let current_range: Vec2 = [0, 1]

  // Forward transform: data value → arcsinh-space
  const arcsinh_transform = (x: number): number => Math.asinh(x / threshold)

  // Inverse transform: arcsinh-space → data value
  const sinh_transform = (y: number): number => Math.sinh(y) * threshold

  // Map from data domain to output range
  // Accepts Date for compatibility with D3 time scales
  const scale = ((value: number | Date): number => {
    const num_value = value instanceof Date ? value.getTime() : value
    const [d_min, d_max] = current_domain
    const [r_min, r_max] = current_range

    // Handle identical domain endpoints (degenerate case)
    if (d_max === d_min) return (r_min + r_max) / 2

    // Transform domain endpoints
    const t_min = arcsinh_transform(d_min)
    const t_max = arcsinh_transform(d_max)

    // Transform input value
    const t_val = arcsinh_transform(num_value)

    // Linear interpolation in transformed space
    if (t_max === t_min) return (r_min + r_max) / 2
    const frac = (t_val - t_min) / (t_max - t_min)
    return r_min + frac * (r_max - r_min)
  }) as ArcsinhScale

  // Domain getter/setter
  scale.domain = function (domain?: Vec2): Vec2 | ArcsinhScale {
    if (domain === undefined) return current_domain
    current_domain = domain
    return scale
  } as ArcsinhScale[`domain`]

  // Range getter/setter
  scale.range = function (output_range?: Vec2): Vec2 | ArcsinhScale {
    if (output_range === undefined) return current_range
    current_range = output_range
    return scale
  } as ArcsinhScale[`range`]

  // Invert: screen position → data value
  scale.invert = (value: number): number => {
    const [d_min, d_max] = current_domain
    const [r_min, r_max] = current_range

    // Handle identical domain endpoints (degenerate case)
    if (d_max === d_min) return (d_min + d_max) / 2

    // Transform domain endpoints
    const t_min = arcsinh_transform(d_min)
    const t_max = arcsinh_transform(d_max)

    // Inverse linear interpolation
    if (r_max === r_min) return (d_min + d_max) / 2
    const frac = (value - r_min) / (r_max - r_min)
    const t_val = t_min + frac * (t_max - t_min)

    // Inverse transform
    return sinh_transform(t_val)
  }

  // Copy the scale
  scale.copy = (): ArcsinhScale => {
    const copy = scale_arcsinh(threshold)
    copy.domain(current_domain)
    copy.range(current_range)
    return copy
  }

  // Generate nice ticks for arcsinh scale
  scale.ticks = (count = 10): number[] => {
    return generate_arcsinh_ticks(current_domain[0], current_domain[1], threshold, count)
  }

  scale.threshold = threshold

  return scale
}

// Generate nice tick values for arcsinh scale
// Strategy: symmetric around zero when possible, with powers of 10 for large values.
// On mixed ranges, count=1 yields just [0]; count>=2 yields zero plus symmetric powers per side.
export function generate_arcsinh_ticks(
  min: number,
  max: number,
  threshold = 1,
  count = 10,
): number[] {
  // Guard against invalid/non-positive threshold to prevent division issues
  const safe_threshold = Math.max(threshold, Number.EPSILON)
  // Normalize reversed domains (min > max)
  const [lo, hi] = min <= max ? [min, max] : [max, min]

  // For purely positive or purely negative ranges, use log-like spacing
  if (lo >= 0) {
    return generate_positive_arcsinh_ticks(lo, hi, safe_threshold, count)
  }
  if (hi <= 0) {
    // Negative range: mirror the positive logic
    return generate_positive_arcsinh_ticks(-hi, -lo, safe_threshold, count)
      .map((tick) => -tick)
      .toReversed()
  }

  // Mixed range: symmetric ticks around zero (includes_zero is always here). Split the budget
  // across both sides (zero is shared/free) so e.g. count=4 yields ~5 ticks (0, ±a, ±b) rather
  // than collapsing to 3 — matching how linear/log colorbars render a similar count.
  const half_count = Math.floor(count / 2)
  const ticks: number[] = [0]

  // Add positive ticks
  const pos_ticks = generate_positive_arcsinh_ticks(0, hi, safe_threshold, half_count)
  ticks.push(...pos_ticks.filter((tick) => tick > 0))

  // Add negative ticks (mirror of positive)
  const neg_ticks = generate_positive_arcsinh_ticks(0, -lo, safe_threshold, half_count)
  ticks.push(...neg_ticks.filter((tick) => tick > 0).map((tick) => -tick))

  return dedupe_sort(ticks)
}

// Generate positive arcsinh ticks (helper)
// Ensures domain boundaries (min, max) are included when they provide meaningful
// visual anchors that powers-of-10 alone might miss.
function generate_positive_arcsinh_ticks(
  min: number,
  max: number,
  threshold: number,
  count: number,
): number[] {
  if (count <= 0 || max <= min) return []

  const ticks: number[] = []

  // Small range near threshold: use linear-like spacing
  if (max <= threshold * 2) {
    const step = (max - min) / count
    for (let idx = 0; idx <= count; idx++) {
      const val = min + step * idx
      if (val >= min && val <= max) ticks.push(val)
    }
    return dedupe_sort(ticks)
  }

  // Large range: log-like spacing via powers of 10.
  // Domain endpoints are intentionally NOT added as ticks: raw extremes render as long
  // unrounded labels (e.g. 1325.8239811994677). Powers of 10 plus 2x/5x multiples below
  // already give clean round ticks; pass axis.ticks/axis.format for custom labels.

  // Add threshold as a tick if in range
  if (threshold >= min && threshold <= max) ticks.push(threshold)

  // Add powers of 10 that are in range. Start at the threshold (not a decade below): values
  // below it sit in arcsinh's near-linear region and map almost onto 0, so sub-threshold powers
  // (e.g. ±1 when threshold=10) would pile up on the zero tick and overlap.
  const min_power = Math.floor(Math.log10(Math.max(min, threshold)))
  const max_power = Math.ceil(Math.log10(max))

  for (let power = min_power; power <= max_power; power++) {
    const val = 10 ** power
    if (val >= min && val <= max) ticks.push(val)
  }

  // Add intermediate values (2x, 5x) for sparser regions
  if (ticks.length < count) {
    for (let power = min_power; power < max_power; power++) {
      const base = 10 ** power
      for (const mult of [2, 5]) {
        const val = base * mult
        if (val >= min && val <= max) ticks.push(val)
      }
    }
  }

  const result = dedupe_sort(ticks)
  // Respect `count`: surplus small powers sit near zero in arcsinh space (their values map almost
  // onto 0) and crowd the labels. Keep the largest-magnitude ticks — they anchor the range extent
  // and are the most spread out — dropping near-zero ones first.
  return result.length > count ? result.slice(-count) : result
}

// Create a scale function based on type, domain, and range
// Note: Time scales are handled separately via create_time_scale() since ScaleTime
// has incompatible types (invert returns Date, not number). Use is_time_scale()
// to detect time mode and call create_time_scale() directly when needed.
export function create_scale(
  scale_type: ScaleType,
  domain: Vec2,
  output_range: Vec2,
): ScaleContinuousNumeric<number, number> | ArcsinhScale {
  const [min_val, max_val] = domain
  const type_name = get_scale_type_name(scale_type)

  if (type_name === `log`) {
    // Clamp BOTH ends to the positive floor: panning shifts ranges linearly, so a
    // log axis panned past zero can arrive with max <= 0 — an unclamped max makes
    // every scale output (and invert) NaN, blanking the chart and polluting axis
    // ranges. A clamped degenerate domain just renders flat and stays recoverable.
    const lo = Math.max(min_val, math.LOG_EPS)
    return scaleLog()
      .domain([lo, Math.max(max_val, lo)])
      .range(output_range)
  }
  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    return scale_arcsinh(threshold).domain(domain).range(output_range)
  }
  // For 'time' or 'linear', return linear scale (time scales need create_time_scale())
  return scaleLinear().domain(domain).range(output_range)
}

// Create a time scale for time-based data
export const create_time_scale = (domain: Vec2, output_range: Vec2) =>
  scaleTime()
    .domain([new Date(domain[0]), new Date(domain[1])])
    .range(output_range)

// Unified tick generation function
export function generate_ticks(
  domain: Vec2,
  scale_type: ScaleType,
  ticks_option: TicksOption | undefined,
  scale_fn: PlotScaleFn, // D3 scale function with .ticks() method
  options: {
    format?: string // For detecting time format
    default_count?: number // Default tick count
    interval_padding?: number // Padding for interval mode
  } = {},
): number[] {
  const { format, default_count = 8, interval_padding = 0.1 } = options
  const [min_val, max_val] = domain

  // If ticks_option is an object (value-to-label mapping), extract values
  if (ticks_option && typeof ticks_option === `object` && !Array.isArray(ticks_option)) {
    const [domain_min, domain_max] = [Math.min(...domain), Math.max(...domain)]
    return Object.keys(ticks_option)
      .map(Number)
      .filter((val) => Number.isFinite(val) && val >= domain_min && val <= domain_max)
      .sort((a, b) => a - b)
  }

  // If ticks_option is already an array, use it directly
  if (Array.isArray(ticks_option)) return ticks_option

  // Time-based ticks (explicit scale_type: 'time' or format heuristic for backwards compatibility)
  if (is_time_scale(scale_type, format)) {
    const time_scale = scaleTime().domain([new Date(min_val), new Date(max_val)])

    let count = 10 // default
    if (typeof ticks_option === `number`) {
      count =
        ticks_option < 0
          ? Math.ceil((max_val - min_val) / Math.abs(ticks_option) / 86_400_000) // milliseconds per day
          : ticks_option
    } else if (typeof ticks_option === `string`) {
      count = ticks_option === `day` ? 30 : ticks_option === `month` ? 12 : 10
    }

    const ticks = time_scale.ticks(count)

    if (typeof ticks_option === `string`) {
      if (ticks_option === `month`) {
        return ticks
          .filter((date: Date) => date.getDate() === 1)
          .map((date: Date) => date.getTime())
      }
      if (ticks_option === `year`) {
        return ticks
          .filter((date: Date) => date.getMonth() === 0 && date.getDate() === 1)
          .map((date: Date) => date.getTime())
      }
    }
    return ticks.map((date: Date) => date.getTime())
  }

  const type_name = get_scale_type_name(scale_type)

  // Log scale ticks
  if (type_name === `log`) return generate_log_ticks(min_val, max_val, ticks_option)

  // Arcsinh scale ticks
  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    const tick_count =
      typeof ticks_option === `number` && ticks_option > 0 ? ticks_option : default_count
    return generate_arcsinh_ticks(min_val, max_val, threshold, tick_count)
  }

  // Linear scale with interval (negative number indicates interval)
  if (typeof ticks_option === `number` && ticks_option < 0) {
    const interval = Math.abs(ticks_option)
    const start = Math.ceil(min_val / interval) * interval
    return range(start, max_val + interval * interval_padding, interval)
  }

  // Default ticks using scale function
  const tick_count =
    typeof ticks_option === `number` && ticks_option > 0 ? ticks_option : default_count

  const ticks = scale_fn.ticks(tick_count)
  return ticks.map(Number)
}

// Calculate domain from array of values (simple version)
export function calculate_domain(values: number[], scale_type: ScaleType = `linear`): Vec2 {
  const [min_val, max_val] = extent(values)
  if (min_val === undefined || max_val === undefined) return [0, 1]

  const type_name = get_scale_type_name(scale_type)
  // Only log scale needs domain clamping to positive values
  // Arcsinh and linear can handle any values
  return type_name === `log` ? [Math.max(min_val, math.LOG_EPS), max_val] : [min_val, max_val]
}

// Advanced domain calculation with padding and nice boundaries (from ScatterPlot)
export function get_nice_data_range(
  points: Point[],
  get_value: (point: Point) => number,
  limits: [number | null, number | null],
  scale_type: ScaleType,
  padding_factor: number,
  is_time = false,
): Vec2 {
  const [min, max] = limits
  const [min_ext, max_ext] = extent(points, get_value)
  let data_min = min ?? min_ext ?? 0
  let data_max = max ?? max_ext ?? 1
  const type_name = get_scale_type_name(scale_type)

  // Apply padding *only if* limits were NOT provided
  if (min === null && max === null && points.length > 0) {
    if (data_min !== data_max) {
      // Apply percentage padding based on scale type if there's a range
      const span = data_max - data_min
      if (is_time) {
        const padding_ms = span * padding_factor
        data_min -= padding_ms
        data_max += padding_ms
      } else if (type_name === `log`) {
        const log_min = Math.log10(Math.max(data_min, math.LOG_EPS))
        const log_max = Math.log10(Math.max(data_max, math.LOG_EPS))
        const log_span = log_max - log_min
        data_min = 10 ** (log_min - log_span * padding_factor)
        data_max = 10 ** (log_max + log_span * padding_factor)
      } else if (type_name === `arcsinh`) {
        // Arcsinh: apply padding in arcsinh-transformed space
        // Guard against extremely small thresholds that could cause precision issues
        const threshold = Math.max(get_arcsinh_threshold(scale_type), Number.EPSILON)
        const asinh_min = Math.asinh(data_min / threshold)
        const asinh_max = Math.asinh(data_max / threshold)
        const asinh_span = asinh_max - asinh_min
        data_min = Math.sinh(asinh_min - asinh_span * padding_factor) * threshold
        data_max = Math.sinh(asinh_max + asinh_span * padding_factor) * threshold
      } else {
        // Linear scale
        const padding_abs = span * padding_factor
        data_min -= padding_abs
        data_max += padding_abs
      }
      // Handle single data point case with fixed relative padding
    } else if (is_time) {
      const one_day = 86_400_000 // milliseconds in a day
      data_min -= one_day
      data_max += one_day
    } else if (type_name === `log`) {
      data_min = Math.max(math.LOG_EPS, data_min / 1.1) // 10% multiplicative padding
      data_max *= 1.1
    } else if (type_name === `arcsinh`) {
      // Arcsinh: 10% padding in transformed space
      // Guard against extremely small thresholds that could cause precision issues
      const threshold = Math.max(get_arcsinh_threshold(scale_type), Number.EPSILON)
      const asinh_val = Math.asinh(data_min / threshold)
      const padding = Math.abs(asinh_val) * 0.1 || 0.1 // Use 0.1 if transformed value is 0 (i.e. data_min = 0)
      data_min = Math.sinh(asinh_val - padding) * threshold
      data_max = Math.sinh(asinh_val + padding) * threshold
    } else {
      const padding_abs = data_min === 0 ? 1 : Math.abs(data_min * 0.1) // 10% additive padding, or 1 if value is 0
      data_min -= padding_abs
      data_max += padding_abs
    }
  }

  // If time or no range after padding, return the (potentially padded) domain directly
  if (is_time || data_min === data_max) return [data_min, data_max]

  // Use D3's nice() to create pretty boundaries
  // For arcsinh, we don't use D3's nice() - just return padded domain
  if (type_name === `arcsinh`) {
    return [data_min, data_max]
  }

  // Create the scale with the *padded* data domain
  const scale =
    type_name === `log`
      ? scaleLog().domain([
          Math.max(data_min, math.LOG_EPS),
          Math.max(data_max, data_min * 1.1),
        ]) // Ensure log domain > 0
      : scaleLinear().domain([data_min, data_max])

  scale.nice()
  const [nice_min = data_min, nice_max = data_max] = scale.domain()
  return [nice_min, nice_max]
}

// Generate logarithmic ticks (from ScatterPlot)
export function generate_log_ticks(
  min: number,
  max: number,
  ticks_option?: TicksOption,
): number[] {
  // If ticks_option is already an array, use it directly
  if (Array.isArray(ticks_option)) return ticks_option
  min = Math.max(min, math.LOG_EPS)
  // Ensure a strictly increasing domain for tick generation
  max = Math.max(max, min * 1.1)

  const min_power = Math.floor(Math.log10(min))
  const max_power = Math.ceil(Math.log10(max))

  // For very wide ranges, extend the range to include more ticks
  const range_size = max_power - min_power
  const extended_min_power =
    range_size <= 2 ? min_power - 1 : min_power - Math.max(1, Math.floor(range_size / 4))
  const extended_max_power = range_size <= 2 ? max_power + 1 : max_power

  const powers = range(extended_min_power, extended_max_power + 1).map(
    (power: number) => 10 ** power,
  )

  // For narrow ranges, include intermediate values
  if (max_power - min_power < 3 && typeof ticks_option === `number` && ticks_option > 5) {
    const detailed_ticks: number[] = []
    powers.forEach((power: number) => {
      detailed_ticks.push(power)
      if (power * 2 <= 10 ** extended_max_power) detailed_ticks.push(power * 2)
      if (power * 5 <= 10 ** extended_max_power) detailed_ticks.push(power * 5)
    })
    return detailed_ticks.filter((tick) => tick >= min && tick <= max)
  }

  const filtered_powers = powers.filter((power) => power >= min && power <= max)
  if (filtered_powers.length >= 2) return filtered_powers

  // Sub-decade domains (e.g. after zoom) have <2 powers of 10 — use d3's mantissa log ticks
  const tick_count = typeof ticks_option === `number` && ticks_option > 0 ? ticks_option : 5
  const fallback = scaleLog().domain([min, max]).ticks(tick_count)
  return fallback.length > 0 ? fallback : filtered_powers
}

// Get custom label for a tick value if provided, otherwise return null
export function get_tick_label(
  tick_value: number,
  ticks_option: TicksOption | undefined,
): string | null {
  if (ticks_option && typeof ticks_option === `object` && !Array.isArray(ticks_option)) {
    return ticks_option[tick_value] ?? null
  }
  return null
}

// Create a color scale function from configuration
export function create_color_scale(
  color_scale_config:
    | {
        type?: ScaleType
        scheme?: D3ColorSchemeName | D3InterpolateName
        value_range?: Vec2
      }
    | string,
  auto_color_range: Vec2,
) {
  const scheme =
    typeof color_scale_config === `string` ? color_scale_config : color_scale_config.scheme
  const candidate_interpolator = Object.entries(d3_sc).find(([key]) => key === scheme)?.[1]
  const interpolator =
    typeof candidate_interpolator === `function`
      ? candidate_interpolator
      : d3_sc.interpolateViridis
  const [min_val, max_val] =
    (typeof color_scale_config === `string` ? undefined : color_scale_config.value_range) ??
    auto_color_range
  const scale_type =
    typeof color_scale_config === `string` ? undefined : color_scale_config.type

  const type_name = get_scale_type_name(scale_type)

  if (type_name === `log`) {
    return scaleSequentialLog(interpolator).domain([
      Math.max(min_val, math.LOG_EPS),
      Math.max(max_val, min_val * 1.1),
    ])
  }
  if (type_name === `arcsinh`) {
    // For arcsinh color scale, we create a custom scale that wraps the interpolator
    const threshold = get_arcsinh_threshold(scale_type)
    return create_arcsinh_color_scale(interpolator, [min_val, max_val], threshold)
  }
  return scaleSequential(interpolator).domain([min_val, max_val])
}

// Create an arcsinh-based color scale (custom sequential scale)
// Returns a D3-compatible scale with both getter and setter for domain
// Scale function reads from closure state on each call for stable identity
function create_arcsinh_color_scale(
  interpolator: (t: number) => string,
  initial_domain: Vec2,
  threshold: number,
) {
  // Guard against extremely small thresholds that could cause precision issues
  const safe_threshold = Math.max(threshold, Number.EPSILON)
  let current_domain = initial_domain

  type ArcsinhColorScale = ((value: number) => string) & {
    domain: {
      (): Vec2
      (new_domain: Vec2): ArcsinhColorScale
    }
  }

  // Single scale function that reads current domain on each call
  const scale = ((value: number): string => {
    const [d_min, d_max] = current_domain
    // Handle identical domain endpoints - return middle of color range
    if (d_max === d_min) return interpolator(0.5)

    const t_min = Math.asinh(d_min / safe_threshold)
    const t_max = Math.asinh(d_max / safe_threshold)
    const t_val = Math.asinh(value / safe_threshold)
    // Normalize to [0, 1]
    const normalized = t_max === t_min ? 0.5 : (t_val - t_min) / (t_max - t_min)
    return interpolator(Math.max(0, Math.min(1, normalized)))
  }) as ArcsinhColorScale

  // Domain getter/setter for D3 compatibility - returns same scale instance
  scale.domain = function (new_domain?: Vec2) {
    if (new_domain === undefined) return current_domain
    current_domain = new_domain
    return scale
  } as ArcsinhColorScale[`domain`]

  return scale
}

// Create a size scale function from configuration
export function create_size_scale(
  config: {
    type?: ScaleType
    radius_range?: Vec2
    value_range?: Vec2
  },
  all_size_values: (number | null)[],
) {
  const [min_radius, max_radius] = config.radius_range ?? [2, 10]
  const auto_range =
    all_size_values.length > 0
      ? extent(all_size_values.filter((val): val is number => val !== null))
      : [0, 1]
  const [min_val, max_val] = config.value_range ?? auto_range
  const safe_min = min_val ?? 0
  const safe_max = max_val ?? (safe_min > 0 ? safe_min * 1.1 : 1)

  const type_name = get_scale_type_name(config.type)

  if (type_name === `log`) {
    return scaleLog()
      .domain([Math.max(safe_min, math.LOG_EPS), Math.max(safe_max, safe_min * 1.1)])
      .range([min_radius, max_radius])
      .clamp(true)
  }
  if (type_name === `arcsinh`) {
    // Create arcsinh-based size scale
    const threshold = get_arcsinh_threshold(config.type)
    const arcsinh_scale = scale_arcsinh(threshold)
      .domain([safe_min, safe_max])
      .range([min_radius, max_radius])

    type ClampedSizeScale = ((value: number) => number) & {
      domain: () => Vec2
      range: () => Vec2
    }

    // Wrap with clamping
    const clamped_scale = ((value: number): number => {
      const result = arcsinh_scale(value)
      return Math.max(min_radius, Math.min(max_radius, result))
    }) as ClampedSizeScale

    clamped_scale.domain = () => arcsinh_scale.domain()
    clamped_scale.range = () => arcsinh_scale.range()
    return clamped_scale
  }

  return scaleLinear().domain([safe_min, safe_max]).range([min_radius, max_radius]).clamp(true)
}
