import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import * as math from '$lib/math'
import type { Point, ScaleType, TimeInterval } from '$lib/plot'
import { get_arcsinh_threshold, get_scale_type_name } from '$lib/plot/types'
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
  domain(): [number, number]
  domain(domain: [number, number]): ArcsinhScale
  range(): [number, number]
  range(range: [number, number]): ArcsinhScale
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
  let _domain: [number, number] = [0, 1]
  let _range: [number, number] = [0, 1]

  // Forward transform: data value → arcsinh-space
  const arcsinh_transform = (x: number): number => Math.asinh(x / threshold)

  // Inverse transform: arcsinh-space → data value
  const sinh_transform = (y: number): number => Math.sinh(y) * threshold

  // Map from data domain to output range
  // Accepts Date for compatibility with D3 time scales
  const scale = ((value: number | Date): number => {
    const num_value = value instanceof Date ? value.getTime() : value
    const [d_min, d_max] = _domain
    const [r_min, r_max] = _range

    // Transform domain endpoints
    const t_min = arcsinh_transform(d_min)
    const t_max = arcsinh_transform(d_max)

    // Transform input value
    const t_val = arcsinh_transform(num_value)

    // Linear interpolation in transformed space
    if (t_max === t_min) return (r_min + r_max) / 2
    const t = (t_val - t_min) / (t_max - t_min)
    return r_min + t * (r_max - r_min)
  }) as ArcsinhScale

  // Domain getter/setter
  scale.domain = function (domain?: [number, number]): [number, number] | ArcsinhScale {
    if (domain === undefined) return _domain
    _domain = domain
    return scale
  } as ArcsinhScale[`domain`]

  // Range getter/setter
  scale.range = function (range?: [number, number]): [number, number] | ArcsinhScale {
    if (range === undefined) return _range
    _range = range
    return scale
  } as ArcsinhScale[`range`]

  // Invert: screen position → data value
  scale.invert = (value: number): number => {
    const [d_min, d_max] = _domain
    const [r_min, r_max] = _range

    // Transform domain endpoints
    const t_min = arcsinh_transform(d_min)
    const t_max = arcsinh_transform(d_max)

    // Inverse linear interpolation
    if (r_max === r_min) return (d_min + d_max) / 2
    const t = (value - r_min) / (r_max - r_min)
    const t_val = t_min + t * (t_max - t_min)

    // Inverse transform
    return sinh_transform(t_val)
  }

  // Copy the scale
  scale.copy = (): ArcsinhScale => {
    const copy = scale_arcsinh(threshold)
    copy.domain(_domain)
    copy.range(_range)
    return copy
  }

  // Generate nice ticks for arcsinh scale
  scale.ticks = (count = 10): number[] => {
    return generate_arcsinh_ticks(_domain[0], _domain[1], threshold, count)
  }

  scale.threshold = threshold

  return scale
}

// Generate nice tick values for arcsinh scale
// Strategy: symmetric around zero when possible, with powers of 10 for large values
export function generate_arcsinh_ticks(
  min: number,
  max: number,
  threshold = 1,
  count = 10,
): number[] {
  // For purely positive or purely negative ranges, use log-like spacing
  if (min >= 0) {
    return generate_positive_arcsinh_ticks(min, max, threshold, count)
  }
  if (max <= 0) {
    // Negative range: mirror the positive logic
    return generate_positive_arcsinh_ticks(-max, -min, threshold, count)
      .map((t) => -t)
      .reverse()
  }

  // Mixed range: symmetric ticks around zero (includes_zero is always true here)
  const half_count = Math.floor((count - 1) / 2)
  const ticks: number[] = [0]

  // Add positive ticks
  const pos_ticks = generate_positive_arcsinh_ticks(0, max, threshold, half_count)
  ticks.push(...pos_ticks.filter((t) => t > 0))

  // Add negative ticks (mirror of positive)
  const neg_ticks = generate_positive_arcsinh_ticks(0, -min, threshold, half_count)
  ticks.push(...neg_ticks.filter((t) => t > 0).map((t) => -t))

  return dedupe_sort(ticks)
}

// Generate positive arcsinh ticks (helper)
function generate_positive_arcsinh_ticks(
  min: number,
  max: number,
  threshold: number,
  count: number,
): number[] {
  if (count <= 0 || max <= min) return []

  const ticks: number[] = []

  // For values near threshold, use linear-like spacing
  // For values >> threshold, use log-like spacing (powers of 10)

  if (max <= threshold * 2) {
    // Small range: use linear ticks
    const step = (max - min) / count
    for (let idx = 0; idx <= count; idx++) {
      const val = min + step * idx
      if (val >= min && val <= max) ticks.push(val)
    }
  } else {
    // Large range: combine linear near zero with powers of 10

    // Add threshold as a tick if in range
    if (threshold >= min && threshold <= max) ticks.push(threshold)

    // Add powers of 10 that are in range
    const min_power = Math.floor(Math.log10(Math.max(min, threshold / 10)))
    const max_power = Math.ceil(Math.log10(max))

    for (let power = min_power; power <= max_power; power++) {
      const val = Math.pow(10, power)
      if (val >= min && val <= max) ticks.push(val)
    }

    // Add intermediate values (2x, 5x) for sparser regions
    if (ticks.length < count) {
      for (let power = min_power; power < max_power; power++) {
        const base = Math.pow(10, power)
        for (const mult of [2, 5]) {
          const val = base * mult
          if (val >= min && val <= max) ticks.push(val)
        }
      }
    }
  }

  return dedupe_sort(ticks)
}

// Create a scale function based on type, domain, and range
export function create_scale(
  scale_type: ScaleType,
  domain: [number, number],
  range: [number, number],
): ScaleContinuousNumeric<number, number> | ArcsinhScale {
  const [min_val, max_val] = domain
  const type_name = get_scale_type_name(scale_type)

  if (type_name === `log`) {
    return scaleLog().domain([Math.max(min_val, math.LOG_EPS), max_val]).range(range)
  }
  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    return scale_arcsinh(threshold).domain(domain).range(range)
  }
  return scaleLinear().domain(domain).range(range)
}

// Create a time scale for time-based data
export function create_time_scale(
  domain: [number, number],
  range: [number, number],
) {
  return scaleTime()
    .domain([new Date(domain[0]), new Date(domain[1])])
    .range(range)
}

// Unified tick generation function
export function generate_ticks(
  domain: [number, number],
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

  // Time-based ticks (ScatterPlot specific logic)
  if (format?.startsWith(`%`)) {
    const time_scale = scaleTime().domain([new Date(min_val), new Date(max_val)])

    let count = 10 // default
    if (typeof ticks_option === `number`) {
      count = ticks_option < 0
        ? Math.ceil((max_val - min_val) / Math.abs(ticks_option) / 86_400_000) // milliseconds per day
        : ticks_option
    } else if (typeof ticks_option === `string`) {
      count = ticks_option === `day` ? 30 : ticks_option === `month` ? 12 : 10
    }

    const ticks = time_scale.ticks(count)

    if (typeof ticks_option === `string`) {
      if (ticks_option === `month`) {
        return ticks.filter((d: Date) => d.getDate() === 1).map((d: Date) => d.getTime())
      }
      if (ticks_option === `year`) {
        return ticks
          .filter((d: Date) => d.getMonth() === 0 && d.getDate() === 1)
          .map((d: Date) => d.getTime())
      }
    }
    return ticks.map((d: Date) => d.getTime())
  }

  const type_name = get_scale_type_name(scale_type)

  // Log scale ticks
  if (type_name === `log`) return generate_log_ticks(min_val, max_val, ticks_option)

  // Arcsinh scale ticks
  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    const tick_count = typeof ticks_option === `number` && ticks_option > 0
      ? ticks_option
      : default_count
    return generate_arcsinh_ticks(min_val, max_val, threshold, tick_count)
  }

  // Linear scale with interval (negative number indicates interval)
  if (typeof ticks_option === `number` && ticks_option < 0) {
    const interval = Math.abs(ticks_option)
    const start = Math.ceil(min_val / interval) * interval
    return range(start, max_val + interval * interval_padding, interval)
  }

  // Default ticks using scale function
  const tick_count = typeof ticks_option === `number` && ticks_option > 0
    ? ticks_option
    : default_count

  const ticks = scale_fn.ticks(tick_count)
  return ticks.map(Number)
}

// Calculate domain from array of values (simple version)
export function calculate_domain(
  values: number[],
  scale_type: ScaleType = `linear`,
): [number, number] {
  const [min_val, max_val] = extent(values)
  if (min_val === undefined || max_val === undefined) return [0, 1]

  const type_name = get_scale_type_name(scale_type)
  // Only log scale needs domain clamping to positive values
  // Arcsinh and linear can handle any values
  return type_name === `log`
    ? [Math.max(min_val, math.LOG_EPS), max_val]
    : [min_val, max_val]
}

// Advanced domain calculation with padding and nice boundaries (from ScatterPlot)
export function get_nice_data_range(
  points: Point[],
  get_value: (p: Point) => number,
  range: [number | null, number | null],
  scale_type: ScaleType,
  padding_factor: number,
  is_time = false,
): [number, number] {
  const [min, max] = range
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
        data_min = data_min - padding_ms
        data_max = data_max + padding_ms
      } else if (type_name === `log`) {
        const log_min = Math.log10(Math.max(data_min, math.LOG_EPS))
        const log_max = Math.log10(Math.max(data_max, math.LOG_EPS))
        const log_span = log_max - log_min
        data_min = Math.pow(10, log_min - log_span * padding_factor)
        data_max = Math.pow(10, log_max + log_span * padding_factor)
      } else if (type_name === `arcsinh`) {
        // Arcsinh: apply padding in arcsinh-transformed space
        const threshold = get_arcsinh_threshold(scale_type)
        const asinh_min = Math.asinh(data_min / threshold)
        const asinh_max = Math.asinh(data_max / threshold)
        const asinh_span = asinh_max - asinh_min
        data_min = Math.sinh(asinh_min - asinh_span * padding_factor) * threshold
        data_max = Math.sinh(asinh_max + asinh_span * padding_factor) * threshold
      } else {
        // Linear scale
        const padding_abs = span * padding_factor
        data_min = data_min - padding_abs
        data_max = data_max + padding_abs
      }
    } else {
      // Handle single data point case with fixed relative padding
      if (is_time) {
        const one_day = 86_400_000 // milliseconds in a day
        data_min = data_min - one_day
        data_max = data_max + one_day
      } else if (type_name === `log`) {
        data_min = Math.max(math.LOG_EPS, data_min / 1.1) // 10% multiplicative padding
        data_max = data_max * 1.1
      } else if (type_name === `arcsinh`) {
        // Arcsinh: 10% padding in transformed space
        const threshold = get_arcsinh_threshold(scale_type)
        const asinh_val = Math.asinh(data_min / threshold)
        const padding = Math.abs(asinh_val) * 0.1 || 0.1 // Use 0.1 if value is 0
        data_min = Math.sinh(asinh_val - padding) * threshold
        data_max = Math.sinh(asinh_val + padding) * threshold
      } else {
        const padding_abs = data_min === 0 ? 1 : Math.abs(data_min * 0.1) // 10% additive padding, or 1 if value is 0
        data_min = data_min - padding_abs
        data_max = data_max + padding_abs
      }
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
  const scale = type_name === `log`
    ? scaleLog().domain([
      Math.max(data_min, math.LOG_EPS),
      Math.max(data_max, data_min * 1.1),
    ]) // Ensure log domain > 0
    : scaleLinear().domain([data_min, data_max])

  scale.nice()
  return scale.domain() as Vec2
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
  const extended_min_power = range_size <= 2
    ? min_power - 1
    : min_power - Math.max(1, Math.floor(range_size / 4))
  const extended_max_power = range_size <= 2 ? max_power + 1 : max_power

  const powers = range(extended_min_power, extended_max_power + 1).map((p: number) =>
    Math.pow(10, p)
  )

  // For narrow ranges, include intermediate values
  if (
    max_power - min_power < 3 &&
    typeof ticks_option === `number` &&
    ticks_option > 5
  ) {
    const detailed_ticks: number[] = []
    powers.forEach((power: number) => {
      detailed_ticks.push(power)
      if (power * 2 <= Math.pow(10, extended_max_power)) detailed_ticks.push(power * 2)
      if (power * 5 <= Math.pow(10, extended_max_power)) detailed_ticks.push(power * 5)
    })
    return detailed_ticks.filter((t) => t >= min && t <= max)
  }

  return powers.filter((p) => p >= min && p <= max)
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
      value_range?: [number, number]
    }
    | string,
  auto_color_range: [number, number],
) {
  const scheme = typeof color_scale_config === `string`
    ? color_scale_config
    : color_scale_config.scheme
  const interpolator =
    (typeof d3_sc[scheme as keyof typeof d3_sc] === `function`
      ? d3_sc[scheme as keyof typeof d3_sc]
      : d3_sc.interpolateViridis) as (t: number) => string
  const [min_val, max_val] =
    (typeof color_scale_config === `string`
      ? undefined
      : color_scale_config.value_range) ?? auto_color_range
  const scale_type = typeof color_scale_config === `string`
    ? undefined
    : color_scale_config.type

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
function create_arcsinh_color_scale(
  interpolator: (t: number) => string,
  domain: [number, number],
  threshold: number,
) {
  const [d_min, d_max] = domain
  const t_min = Math.asinh(d_min / threshold)
  const t_max = Math.asinh(d_max / threshold)

  type ArcsinhColorScale = ((value: number) => string) & {
    domain: () => [number, number]
  }

  const scale = ((value: number): string => {
    const t_val = Math.asinh(value / threshold)
    // Normalize to [0, 1]
    const normalized = t_max === t_min ? 0.5 : (t_val - t_min) / (t_max - t_min)
    return interpolator(Math.max(0, Math.min(1, normalized)))
  }) as ArcsinhColorScale

  scale.domain = () => domain
  return scale
}

// Create a size scale function from configuration
export function create_size_scale(
  config: {
    type?: ScaleType
    radius_range?: [number, number]
    value_range?: [number, number]
  },
  all_size_values: (number | null)[],
) {
  const [min_radius, max_radius] = config.radius_range ?? [2, 10]
  const auto_range = all_size_values.length > 0
    ? extent(all_size_values.filter((v): v is number => v !== null))
    : [0, 1]
  const [min_val, max_val] = config.value_range ?? (auto_range as Vec2)
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
      domain: () => [number, number]
      range: () => [number, number]
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

  return scaleLinear().domain([safe_min, safe_max]).range([min_radius, max_radius]).clamp(
    true,
  )
}
