import { get_d3_interpolator, type D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import * as math from '$lib/math'
import { range_bounds } from '$lib/plot/core/interactions'
import type {
  ColorScaleConfig,
  ScaleType,
  SizeScaleConfig,
  TimeInterval,
} from '$lib/plot/core/types'
import {
  get_arcsinh_threshold,
  get_scale_type_name,
  is_time_scale,
  SCALE_DEFAULTS,
} from '$lib/plot/core/types'
import { clamp01 } from '$lib/utils'
import { extent, range } from 'd3-array'
import type { ScaleContinuousNumeric, ScaleTime } from 'd3-scale'
import {
  scaleLinear,
  scaleLog,
  scaleSequential,
  scaleSequentialLog,
  scaleTime,
} from 'd3-scale'

// Type for ticks parameter - can be count, array of values, time interval, or object mapping values to labels
export type TicksOption = number | number[] | TimeInterval | Record<number, string>

const MS_PER_DAY = 86_400_000

// Every tick is measured and rendered, and a negative `axis.ticks` is a STEP whose count rides
// on the domain: `ticks: -1` over [0, 1e8] built 100,000,001 entries (~800 MB)
const MAX_TICKS = 10_000
const assert_tick_count = (count: number, requested: string, span: number): void => {
  if (count > MAX_TICKS) {
    throw new Error(
      `generate_ticks: ${requested} over a span of ${span} asks for ${Math.ceil(count)} ticks, past the ${MAX_TICKS} cap`,
    )
  }
}

// Dedupe and sort numeric array (used in tick generation)
const dedupe_sort = (arr: number[]): number[] => [...new Set(arr)].toSorted((a, b) => a - b)

// --- Arcsinh Scale Implementation ---
// The arcsinh scale provides smooth transition between linear (near zero) and
// logarithmic (for large |x|) behavior. Unlike log, it handles negative values.
// Formula: y = asinh(x / threshold) = ln(x/c + sqrt((x/c)² + 1))

// Interface for arcsinh scale (D3-compatible)
export interface ArcsinhScale {
  (value: number): number
  domain(): Vec2
  domain(domain: Vec2): ArcsinhScale
  range(): Vec2
  range(range: Vec2): ArcsinhScale
  invert(value: number): number
  ticks(count?: number): number[]
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

  const arcsinh_transform = (x: number): number => Math.asinh(x / threshold)
  const sinh_transform = (y: number): number => Math.sinh(y) * threshold
  const transformed_domain = (): Vec2 => [
    arcsinh_transform(current_domain[0]),
    arcsinh_transform(current_domain[1]),
  ]

  const scale = ((value: number): number => {
    const [d_min, d_max] = current_domain
    const [r_min, r_max] = current_range
    // Identical domain endpoints (degenerate case) map to the range midpoint
    if (d_max === d_min) return (r_min + r_max) / 2

    const [t_min, t_max] = transformed_domain()
    if (t_max === t_min) return (r_min + r_max) / 2
    const frac = (arcsinh_transform(value) - t_min) / (t_max - t_min)
    return r_min + frac * (r_max - r_min)
  }) as ArcsinhScale

  scale.domain = function (domain?: Vec2): Vec2 | ArcsinhScale {
    if (domain === undefined) return current_domain
    current_domain = domain
    return scale
  } as ArcsinhScale[`domain`]

  scale.range = function (output_range?: Vec2): Vec2 | ArcsinhScale {
    if (output_range === undefined) return current_range
    current_range = output_range
    return scale
  } as ArcsinhScale[`range`]

  scale.invert = (value: number): number => {
    const [d_min, d_max] = current_domain
    const [r_min, r_max] = current_range
    // Identical domain endpoints (degenerate case) map to the domain midpoint
    if (d_max === d_min || r_max === r_min) return (d_min + d_max) / 2

    const [t_min, t_max] = transformed_domain()
    const frac = (value - r_min) / (r_max - r_min)
    return sinh_transform(t_min + frac * (t_max - t_min))
  }

  scale.ticks = (count = 10): number[] =>
    generate_arcsinh_ticks(current_domain[0], current_domain[1], threshold, count)

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
  // Normalize reversed domains (min > max)
  const [lo, hi] = min <= max ? [min, max] : [max, min]

  // For purely positive or purely negative ranges, use log-like spacing
  if (lo >= 0) return generate_positive_arcsinh_ticks(lo, hi, threshold, count)
  if (hi <= 0) {
    // Negative range: mirror the positive logic
    return generate_positive_arcsinh_ticks(-hi, -lo, threshold, count)
      .map((tick) => -tick)
      .toReversed()
  }

  // Mixed range: symmetric ticks around zero (includes_zero is always here). Split the budget
  // across both sides (zero is shared/free) so e.g. count=4 yields ~5 ticks (0, ±a, ±b) rather
  // than collapsing to 3 — matching how linear/log colorbars render a similar count.
  const half_count = Math.floor(count / 2)
  const ticks: number[] = [0]

  // Add positive ticks
  const pos_ticks = generate_positive_arcsinh_ticks(0, hi, threshold, half_count)
  ticks.push(...pos_ticks.filter((tick) => tick > 0))

  // Add negative ticks (mirror of positive)
  const neg_ticks = generate_positive_arcsinh_ticks(0, -lo, threshold, half_count)
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

// Create a scale function based on type, domain, and range. Time axes are linear scales over
// epoch milliseconds (tick generation alone is time-aware), so no Date wrapping is needed.
export function create_scale(
  scale_type: ScaleType,
  domain: Vec2,
  output_range: Vec2,
): ScaleContinuousNumeric<number, number> | ArcsinhScale {
  const [min_val, max_val] = domain
  const type_name = get_scale_type_name(scale_type)

  if (type_name === `log`) {
    // Clamp BOTH ends to the positive floor: panning shifts ranges linearly, so a log axis
    // panned past zero can arrive with max <= 0 — an unclamped max makes every scale output
    // (and invert) NaN, blanking the chart and polluting axis ranges. A clamped degenerate
    // domain just renders flat and stays recoverable, so this one does not widen.
    return scaleLog()
      .domain(positive_log_domain(min_val, max_val, 1))
      .range(output_range)
  }
  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    return scale_arcsinh(threshold).domain(domain).range(output_range)
  }
  return scaleLinear().domain(domain).range(output_range)
}

// Build the four axis scales for a 2D plot in one call: x/x2 share the horizontal pixel span,
// y/y2 the inverted vertical one. Shared by BarPlot/BoxPlot/Histogram (identical layout math).
export function create_axis_scales<A extends { scale_type?: ScaleType }>(
  axes: { x: A; x2: A; y: A; y2: A },
  ranges: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 },
  pad: { l: number; r: number; t: number; b: number },
  width: number,
  height: number,
) {
  const x_px: Vec2 = [pad.l, width - pad.r]
  const y_px: Vec2 = [height - pad.b, pad.t]
  const scale = (axis: A, domain: Vec2, px: Vec2) =>
    create_scale(axis.scale_type ?? `linear`, domain, px)
  return {
    x: scale(axes.x, ranges.x, x_px),
    x2: scale(axes.x2, ranges.x2, x_px),
    y: scale(axes.y, ranges.y, y_px),
    y2: scale(axes.y2, ranges.y2, y_px),
  }
}

// Unified tick generation function
export function generate_ticks(
  domain: Vec2,
  scale_type: ScaleType,
  ticks_option: TicksOption | undefined,
  scale_fn: PlotScaleFn, // D3 scale function with .ticks() method
  options: { default_count?: number } = {},
): number[] {
  const { default_count = 8 } = options
  // Descending domains (e.g. [10, 0]) are a supported axis mode and every branch below wants
  // ascending bounds (a raw max_val < min_val collapses interval counts to zero ticks). Tick
  // order is irrelevant to rendering, so ascending output is fine.
  const [min_val, max_val] = range_bounds(domain)
  if (typeof ticks_option === `number` && ticks_option > 0) {
    assert_tick_count(ticks_option, `a tick count of ${ticks_option}`, max_val - min_val)
  }

  // If ticks_option is an object (value-to-label mapping), extract values
  if (ticks_option && typeof ticks_option === `object` && !Array.isArray(ticks_option)) {
    return Object.keys(ticks_option)
      .map(Number)
      .filter((val) => Number.isFinite(val) && val >= min_val && val <= max_val)
      .toSorted((a, b) => a - b)
  }

  // If ticks_option is already an array, use it directly
  if (Array.isArray(ticks_option)) return ticks_option

  if (is_time_scale(scale_type)) {
    // Interval requests (`day`/`month`/`year` or a negative day count) ask d3 for one tick per
    // interval in the domain, so it picks that interval; a positive number is a plain count.
    const INTERVAL_DAYS: Record<string, number> = { day: 1, month: 30, year: 365 }
    const interval_days =
      typeof ticks_option === `number` && ticks_option < 0
        ? -ticks_option
        : ((typeof ticks_option === `string` ? INTERVAL_DAYS[ticks_option] : undefined) ??
          null)
    const count =
      interval_days !== null
        ? Math.max(1, Math.ceil((max_val - min_val) / (interval_days * MS_PER_DAY)))
        : typeof ticks_option === `number` && ticks_option > 0
          ? ticks_option
          : 10
    // Interval counts ride on the domain: `day` over two centuries asks for 73k ticks
    if (interval_days !== null) {
      assert_tick_count(count, `a tick interval of ${interval_days} day(s)`, max_val - min_val)
    }
    const dates = scaleTime()
      .domain([new Date(min_val), new Date(max_val)])
      .ticks(count)
      .filter((date) =>
        ticks_option === `month`
          ? date.getDate() === 1
          : ticks_option === `year`
            ? date.getMonth() === 0 && date.getDate() === 1
            : true,
      )
    return dates.map((date) => date.getTime())
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

  // Linear scale with interval (negative number indicates interval). The end is padded by a
  // tenth of an interval so a max that lands on a tick (modulo float dust) still gets it.
  if (typeof ticks_option === `number` && ticks_option < 0) {
    const interval = Math.abs(ticks_option)
    const start = Math.ceil(min_val / interval) * interval
    assert_tick_count(
      (max_val - start) / interval + 1,
      `a tick interval of ${interval}`,
      max_val - min_val,
    )
    return range(start, max_val + interval * 0.1, interval)
  }

  // Default ticks using scale function
  const tick_count =
    typeof ticks_option === `number` && ticks_option > 0 ? ticks_option : default_count

  const ticks = scale_fn.ticks(tick_count)
  return ticks.map(Number)
}

// Finite raw-array extent with a count for padding and renderability checks.
export type RunningExtent = { min?: number; max?: number; n_finite: number }

export const empty_extent = (): RunningExtent => ({ n_finite: 0 })

// Fold values into acc without concatenating series or allocating point objects. count may
// exceed values.length so paired x/y axes retain the same point count.
export function accumulate_extent(
  acc: RunningExtent,
  values: ArrayLike<number | null | undefined>,
  count = values.length,
): RunningExtent {
  const n_values = Math.max(0, count)
  for (let idx = 0; idx < n_values; idx++) {
    const val = values[idx]
    if (typeof val !== `number` || !Number.isFinite(val)) continue
    acc.n_finite++
    if (acc.min === undefined || val < acc.min) acc.min = val
    if (acc.max === undefined || val > acc.max) acc.max = val
  }
  return acc
}

// Series slice the colour/size scale builders read; null entries are skipped
type ScaleValueSeries =
  | {
      color_values?: ArrayLike<number | null> | null
      size_values?: ArrayLike<number | null> | null
    }
  | null
  | undefined

// Finite colour extent and finite size values across series in one pass. NaN/null entries
// fall back to the series colour/radius per point, so they must not widen either scale.
// `color_range` is [0, 1] when no finite colour value was seen.
export function collect_scale_values(series: readonly ScaleValueSeries[]): {
  color_extent: RunningExtent
  color_range: Vec2
  size_values: number[]
} {
  const color_extent = empty_extent()
  for (const srs of series) {
    if (srs?.color_values) accumulate_extent(color_extent, srs.color_values)
  }
  const { min = 0, max = 1 } = color_extent
  return { color_extent, color_range: [min, max], size_values: collect_size_values(series) }
}

// Finite size values across series, for charts that size points but never colour them
export function collect_size_values(series: readonly ScaleValueSeries[]): number[] {
  const size_values: number[] = []
  for (const srs of series) {
    // index loop: size_values may be a typed array or other non-iterable ArrayLike
    const sizes = srs?.size_values ?? []
    const n_sizes = sizes.length
    for (let idx = 0; idx < n_sizes; idx++) {
      const val = sizes[idx]
      if (typeof val === `number` && Number.isFinite(val)) size_values.push(val)
    }
  }
  return size_values
}

// Pixel scale that holds values below a log axis's domain floor at the floor: 0 and negatives
// (bar baselines, whisker lows, line vertices) have no finite log pixel, so they land on the
// plot edge instead of producing NaN geometry. Non-log scales are returned unchanged.
export const log_floor_scale = (
  scale: (val: number) => number,
  scale_type: ScaleType | undefined,
  domain: readonly number[],
): ((val: number) => number) => {
  if (get_scale_type_name(scale_type) !== `log`) return scale
  const floor = Math.min(...domain)
  return (val) => scale(Math.max(val, floor))
}

// Log domain floored at LOG_EPS, kept in the caller's direction. The upper bound is widened
// from the *floored* lower bound, so a non-positive `lo` (explicit negative range bound,
// all-zero data) cannot leave an inverted [LOG_EPS, hi <= 0] domain behind; `widen` above 1
// additionally keeps equal bounds off a degenerate scale, which a plotted range wants and a
// panned axis does not. Ordering first keeps a deliberately descending range from collapsing:
// a size scale mapping the largest value to the smallest radius, or a descending log axis,
// where flooring lo then widening hi against it turned [1000, 1] into [1000, 1000].
const positive_log_domain = (lo: number, hi: number, widen = 1.1): Vec2 => {
  const descending = lo > hi
  const [low, high] = descending ? [hi, lo] : [lo, hi]
  const floor = Math.max(low, math.LOG_EPS)
  const ceiling = Math.max(high, floor * widen)
  return descending ? [ceiling, floor] : [floor, ceiling]
}

export const nice_range_from_extent = (
  { min, max, n_finite }: RunningExtent,
  limits: [number | null, number | null],
  scale_type: ScaleType,
  padding_factor: number,
  is_time = false,
): Vec2 => nice_range(min, max, n_finite > 0, limits, scale_type, padding_factor, is_time)

function nice_range(
  min_ext: number | undefined,
  max_ext: number | undefined,
  has_points: boolean,
  limits: [number | null, number | null],
  scale_type: ScaleType,
  padding_factor: number,
  is_time: boolean,
): Vec2 {
  const [min, max] = limits
  let data_min = min ?? min_ext ?? 0
  let data_max = max ?? max_ext ?? 1
  const type_name = get_scale_type_name(scale_type)
  const can_snap_zero =
    min_ext !== undefined &&
    max_ext !== undefined &&
    min_ext < max_ext &&
    !is_time &&
    type_name !== `log`
  const snap_zero_min = can_snap_zero && min === null && min_ext === 0
  const snap_zero_max = can_snap_zero && max === null && max_ext === 0

  // Apply padding *only if* limits were NOT provided
  if (min === null && max === null && has_points) {
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
        const threshold = get_arcsinh_threshold(scale_type)
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
      data_min -= MS_PER_DAY
      data_max += MS_PER_DAY
    } else if (type_name === `log`) {
      data_min = Math.max(math.LOG_EPS, data_min / 1.1) // 10% multiplicative padding
      data_max *= 1.1
    } else if (type_name === `arcsinh`) {
      // Arcsinh: 10% padding in transformed space
      const threshold = get_arcsinh_threshold(scale_type)
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
    return [snap_zero_min ? 0 : data_min, snap_zero_max ? 0 : data_max]
  }

  // Create the scale with the *padded* data domain
  const scale =
    type_name === `log`
      ? scaleLog().domain(positive_log_domain(data_min, data_max))
      : scaleLinear().domain([data_min, data_max])

  scale.nice()
  const [nice_min = data_min, nice_max = data_max] = scale.domain()
  return [snap_zero_min ? 0 : nice_min, snap_zero_max ? 0 : nice_max]
}

// Logarithmic ticks: powers of 10 inside the domain; 1-2-5 mantissas when the domain spans
// under three decades and the caller asked for more than 5 ticks; d3's mantissa ticks for
// sub-decade domains (e.g. after zooming) where fewer than two powers of 10 fit.
export function generate_log_ticks(
  min: number,
  max: number,
  ticks_option?: TicksOption,
): number[] {
  if (Array.isArray(ticks_option)) return ticks_option
  min = Math.max(min, math.LOG_EPS)
  // Widen only a collapsed domain; a merely narrow one must not grow ticks past its max
  if (max <= min) max = min * 1.1
  const min_power = Math.floor(Math.log10(min))
  const max_power = Math.ceil(Math.log10(max))
  const in_range = (tick: number): boolean => tick >= min && tick <= max
  const powers = range(min_power, max_power + 1).map((power: number) => 10 ** power)
  if (max_power - min_power < 3 && typeof ticks_option === `number` && ticks_option > 5) {
    const mantissa_ticks = powers
      .flatMap((power) => [power, power * 2, power * 5])
      .filter(in_range)
    // A sub-decade domain between mantissas (e.g. [0.92, 0.99] or [7, 8]) fits fewer than two
    // of them; fall through to d3's fine ticks instead of leaving the axis bare
    if (mantissa_ticks.length >= 2) return mantissa_ticks
  }
  const in_range_powers = powers.filter(in_range)
  if (in_range_powers.length >= 2) return in_range_powers
  const tick_count = typeof ticks_option === `number` && ticks_option > 0 ? ticks_option : 5
  const fallback = scaleLog().domain([min, max]).ticks(tick_count)
  return fallback.length > 0 ? fallback : in_range_powers
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

// Log domain for colour ramps, shared by every colour-scale builder so they agree on the
// floor: non-positive bounds fall back to LOG_EPS (a domain entirely <= 0 collapses to one
// colour instead of going NaN), positive bounds are kept however small (diffusivities, rates
// sit far below the LOG_EPS axis floor) and in the caller's order (a descending range runs
// high-to-low). Equal bounds widen by 10% so the scale isn't degenerate.
export const log_color_domain = ([lo, hi]: Vec2): Vec2 => {
  const safe_lo = lo > 0 ? lo : math.LOG_EPS
  const safe_hi = hi > 0 ? hi : math.LOG_EPS
  return safe_lo === safe_hi ? [safe_lo, safe_lo * 1.1] : [safe_lo, safe_hi]
}

// Create a color scale function from configuration
export function create_color_scale(
  color_scale_config: ColorScaleConfig | D3InterpolateName,
  auto_color_range: Vec2,
) {
  const config =
    typeof color_scale_config === `string`
      ? { scheme: color_scale_config }
      : color_scale_config
  const {
    scheme = SCALE_DEFAULTS.scheme,
    value_range = auto_color_range,
    type: scale_type,
  } = config
  const interpolator = get_d3_interpolator(scheme)
  const [min_val, max_val] = value_range

  const type_name = get_scale_type_name(scale_type)

  if (type_name === `log`) {
    return scaleSequentialLog(interpolator).domain(log_color_domain([min_val, max_val]))
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

    const t_min = Math.asinh(d_min / threshold)
    const t_max = Math.asinh(d_max / threshold)
    const t_val = Math.asinh(value / threshold)
    // Normalize to [0, 1]
    const normalized = t_max === t_min ? 0.5 : (t_val - t_min) / (t_max - t_min)
    return interpolator(clamp01(normalized))
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
  config: SizeScaleConfig,
  all_size_values: (number | null)[],
) {
  const [min_radius, max_radius] = config.radius_range ?? SCALE_DEFAULTS.radius
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
      .domain(positive_log_domain(safe_min, safe_max))
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

    // Order the bounds first: a descending radius_range would otherwise collapse the scale to
    // the constant min_radius (this branch clamps by hand, unlike d3's .clamp(true) below).
    const [lo_radius, hi_radius] =
      min_radius <= max_radius ? [min_radius, max_radius] : [max_radius, min_radius]
    const clamped_scale = ((value: number): number =>
      math.clamp(arcsinh_scale(value), lo_radius, hi_radius)) as ClampedSizeScale

    clamped_scale.domain = () => arcsinh_scale.domain()
    clamped_scale.range = () => arcsinh_scale.range()
    return clamped_scale
  }

  return scaleLinear().domain([safe_min, safe_max]).range([min_radius, max_radius]).clamp(true)
}
