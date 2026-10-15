import { get_d3_interpolator, type D3InterpolateName } from '#lib/colors/index.js'
import type { Vec2 } from '#lib/math.js'
import * as math from '#lib/math.js'
import {
  axis_transform,
  range_bounds,
  resolve_axis_range,
  validate_log_range,
} from '#lib/plot/core/interactions.js'
import type {
  ColorScaleConfig,
  ScaleType,
  SizeScaleConfig,
  TimeInterval,
} from '#lib/plot/core/types.js'
import {
  get_arcsinh_threshold,
  get_scale_type_name,
  is_time_scale,
  SCALE_DEFAULTS,
} from '#lib/plot/core/types.js'
import { clamp01 } from '#lib/utils.js'
import { range } from 'd3-array'
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

// A value -> label mapping (as opposed to a tick count, positions or a time interval). The
// `& object` keeps TS from narrowing interval strings away (they have a numeric index too).
export const is_tick_label_map = (
  ticks: TicksOption | null | undefined,
): ticks is Record<number, string> & object =>
  ticks != null && typeof ticks === `object` && !Array.isArray(ticks)

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
const dedupe_sort = (arr: number[]): number[] => math.sorted_numbers(new Set(arr))

// Formats that print every value as an integer: `d` types (`d`, `,d`, `~d`) and zero-precision
// fixed point (`.0f`, `,.0f`), but no time (`%d`) or percent (`.0%`) format
export const is_integer_format = (format: string | null | undefined): boolean =>
  typeof format === `string` &&
  !format.includes(`%`) &&
  (format.endsWith(`d`) || format.endsWith(`.0f`))

// Tick positions an integer format can label: each tick rounded to the integer its label
// reads, without repeats or values outside the domain (input order kept). A domain no
// integer fits (zoomed below one unit) keeps the plain ticks, which tick_label_format then
// labels as decimals instead of leaving the axis empty.
export const integer_ticks = (ticks: readonly number[], domain: Vec2): number[] => {
  const ints = [...new Set(ticks.map(Math.round))].filter((tick) =>
    math.in_range(tick, domain),
  )
  return ints.length > 0 ? ints : [...ticks]
}

// Format for tick labels: an integer format can't label the all-fractional ticks
// integer_ticks falls back to (0.2, 0.4 would all read `0`), so those get the default
// decimal labels. Ticks with any integer among them (incl. explicit arrays) keep the format.
export const tick_label_format = (
  ticks: readonly number[],
  format: string | undefined,
): string | undefined =>
  is_integer_format(format) && ticks.length > 0 && !ticks.some(Number.isInteger)
    ? undefined
    : format

// --- Arcsinh Scale Implementation ---
// The arcsinh scale provides smooth transition between linear (near zero) and
// logarithmic (for large |x|) behavior. Unlike log, it handles negative values.
// Formula: y = asinh(x / threshold) = ln(x/c + sqrt((x/c)² + 1))

export interface ArcsinhScale {
  (value: number): number
  domain(): Vec2
  domain(domain: Vec2): ArcsinhScale
  range(): Vec2
  range(range: Vec2): ArcsinhScale
  invert(value: number): number
  ticks(count?: number): number[]
}

export type PlotScaleFn =
  | ScaleContinuousNumeric<number, number>
  | ScaleTime<number, number>
  | ArcsinhScale

export function scale_arcsinh(threshold = 1): ArcsinhScale {
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error(`arcsinh threshold must be a positive finite number, got ${threshold}`)
  }

  let current_domain: Vec2 = [0, 1]
  let current_range: Vec2 = [0, 1]

  const arcsinh_transform = (coord_x: number): number => Math.asinh(coord_x / threshold)
  const transformed_domain = (): Vec2 => [
    arcsinh_transform(current_domain[0]),
    arcsinh_transform(current_domain[1]),
  ]

  const scale = ((value: number): number => {
    const [r_min, r_max] = current_range
    const [t_min, t_max] = transformed_domain()
    // A degenerate domain maps to the range midpoint
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
    return Math.sinh(t_min + frac * (t_max - t_min)) * threshold
  }

  scale.ticks = (count = 10): number[] =>
    generate_arcsinh_ticks(current_domain[0], current_domain[1], threshold, count)

  return scale
}

// Arcsinh ticks: symmetric around zero when possible, with powers of 10 for large values.
// On mixed ranges, count=1 yields just [0]; count>=2 yields zero plus symmetric powers per side.
export function generate_arcsinh_ticks(
  min: number,
  max: number,
  threshold = 1,
  count = 10,
): number[] {
  // Normalize reversed domains (min > max)
  const [lower, upper] = min <= max ? [min, max] : [max, min]

  // For purely positive or purely negative ranges, use log-like spacing
  if (lower >= 0) return generate_positive_arcsinh_ticks(lower, upper, threshold, count)
  if (upper <= 0) {
    // Negative range: mirror the positive logic
    return generate_positive_arcsinh_ticks(-upper, -lower, threshold, count)
      .map((tick) => -tick)
      .toReversed()
  }

  // Mixed range: symmetric ticks around zero (includes_zero is always here). Split the budget
  // across both sides (zero is shared/free) so e.g. count=4 yields ~5 ticks (0, ±a, ±b) rather
  // than collapsing to 3 — matching how linear/log colorbars render a similar count.
  const half_count = Math.floor(count / 2)
  // Positive ticks up to `bound`; the negative side mirrors them
  const side = (bound: number) =>
    generate_positive_arcsinh_ticks(0, bound, threshold, half_count).filter((tick) => tick > 0)
  return dedupe_sort([0, ...side(upper), ...side(-lower).map((tick) => -tick)])
}

function generate_positive_arcsinh_ticks(
  min: number,
  max: number,
  threshold: number,
  count: number,
): number[] {
  if (count <= 0 || max <= min) return []
  const in_range = (val: number): boolean => val >= min && val <= max

  // Small range near threshold: use linear-like spacing
  if (max <= threshold * 2) {
    const step = (max - min) / count
    const ticks = range(Math.floor(count) + 1).map((idx) => min + step * idx)
    return dedupe_sort(ticks.filter(in_range))
  }

  // Large range: the threshold plus powers of 10 (and 2x/5x multiples), never the raw domain
  // endpoints, which render as unrounded labels (e.g. 1325.8239811994677). Powers start at the
  // threshold: below it arcsinh is near-linear, so e.g. ±1 at threshold=10 would pile onto 0.
  const min_power = Math.floor(Math.log10(Math.max(min, threshold)))
  const powers = range(min_power, Math.ceil(Math.log10(max)) + 1).map((power) => 10 ** power)
  const ticks = [threshold, ...powers].filter(in_range)
  // Intermediate values (2x, 5x) for sparser regions
  if (ticks.length < count) {
    ticks.push(
      ...powers
        .slice(0, -1)
        .flatMap((base) => [base * 2, base * 5])
        .filter(in_range),
    )
  }

  const result = dedupe_sort(ticks)
  // Respect `count` by dropping near-zero ticks first: they crowd together in arcsinh space,
  // while the largest-magnitude ones anchor the range extent
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
    // Recover non-positive bounds without flooring valid small values. A fully invalid
    // domain stays finite and recoverable, without widening a collapsed view.
    return scaleLog()
      .domain(positive_log_domain(min_val, max_val, 1))
      .range(output_range)
  }
  if (type_name === `arcsinh`) {
    return scale_arcsinh(get_arcsinh_threshold(scale_type)).domain(domain).range(output_range)
  }
  return scaleLinear().domain(domain).range(output_range)
}

// Build the four axis scales for a 2D plot in one call: x/x2 share the horizontal pixel span,
// y/y2 the inverted vertical one. Shared by cartesian-frame and BarPlot/BoxPlot/Histogram.
export function create_axis_scales<A extends { scale_type?: ScaleType }>(
  axes: { x: A; x2: A; y: A; y2: A },
  ranges: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 },
  pad: { l: number; r: number; t: number; b: number },
  width: number,
  height: number,
) {
  const x_px: Vec2 = [pad.l, width - pad.r]
  const y_px: Vec2 = [height - pad.b, pad.t]
  const scale = (axis: A, domain: Vec2, pixel_x: Vec2) =>
    create_scale(axis.scale_type ?? `linear`, domain, pixel_x)
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
  options: { default_count?: number; format?: string } = {},
): number[] {
  const { default_count = 8, format } = options
  // Descending domains (e.g. [10, 0]) are a supported axis mode and every branch below wants
  // ascending bounds (a raw max_val < min_val collapses interval counts to zero ticks). Tick
  // order is irrelevant to rendering, so ascending output is fine.
  const [min_val, max_val] = range_bounds(domain)
  const positive_count =
    typeof ticks_option === `number` && ticks_option > 0 ? ticks_option : undefined
  if (positive_count) {
    assert_tick_count(positive_count, `a tick count of ${positive_count}`, max_val - min_val)
  }

  if (is_tick_label_map(ticks_option)) {
    return Object.keys(ticks_option)
      .map(Number)
      .filter((val) => Number.isFinite(val) && val >= min_val && val <= max_val)
      .toSorted((left_value, right_value) => left_value - right_value)
  }

  if (Array.isArray(ticks_option)) return ticks_option

  // Integer formats round each generated label: 0.5 steps read `0, 1, 1, 2`. Explicit
  // positions and label maps returned above are the caller's.
  if (is_integer_format(format)) {
    const ticks = generate_ticks(domain, scale_type, ticks_option, scale_fn, { default_count })
    return math.sorted_numbers(integer_ticks(ticks, domain))
  }

  if (is_time_scale(scale_type)) {
    // Interval requests (`day`/`month`/`year` or a negative day count) ask d3 for one tick per
    // interval in the domain, so it picks that interval; a positive number is a plain count.
    const INTERVAL_DAYS: Record<string, number> = { day: 1, month: 30, year: 365 }
    const interval_days: number | undefined =
      typeof ticks_option === `number` && ticks_option < 0
        ? -ticks_option
        : typeof ticks_option === `string`
          ? INTERVAL_DAYS[ticks_option]
          : undefined
    const count =
      interval_days !== undefined
        ? Math.max(1, Math.ceil((max_val - min_val) / (interval_days * MS_PER_DAY)))
        : (positive_count ?? 10)
    // Interval counts ride on the domain: `day` over two centuries asks for 73k ticks
    if (interval_days !== undefined) {
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

  if (type_name === `log`) return generate_log_ticks(min_val, max_val, positive_count)

  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    return generate_arcsinh_ticks(min_val, max_val, threshold, positive_count ?? default_count)
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

  return scale_fn.ticks(positive_count ?? default_count).map(Number)
}

// Finite raw-array extent with a count for padding and renderability checks.
export type RunningExtent = {
  min?: number
  max?: number
  min_positive?: number
  n_finite: number
}

export const empty_extent = (): RunningExtent => ({ n_finite: 0 })

// Fold values into acc without concatenating series or allocating point objects. count may
// exceed values.length so paired x/y axes retain the same point count.
export function accumulate_extent(
  acc: RunningExtent,
  values: ArrayLike<number | null | undefined>,
  count = values.length,
): RunningExtent {
  const n_values = Math.max(0, count)
  let min_positive = acc.min_positive ?? Infinity
  for (let idx = 0; idx < n_values; idx++) {
    const val = values[idx]
    if (typeof val !== `number` || !Number.isFinite(val)) continue
    acc.n_finite++
    if (acc.min === undefined || val < acc.min) acc.min = val
    if (acc.max === undefined || val > acc.max) acc.max = val
    if (val > 0 && val < min_positive) min_positive = val
  }
  if (min_positive < Infinity) acc.min_positive = min_positive
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

// Collect only the channel a caller needs; color-only hosts must not scan size samples.
export function collect_series_extent(
  series: readonly ScaleValueSeries[],
  channel: `color_values` | `size_values`,
): RunningExtent {
  const extent = empty_extent()
  for (const srs of series) {
    const values = srs?.[channel]
    if (values) accumulate_extent(extent, values)
  }
  return extent
}

// Auto [min, max] of a colour/size extent, [0, 1] when no finite value was seen. On log
// scales the smallest positive value stands in for a non-positive min: it has no log image,
// and flooring it at LOG_EPS instead would squash every positive value into the ramp's top.
export const auto_scale_range = (
  { min = 0, max = 1, min_positive }: RunningExtent,
  scale_type?: ScaleType,
): Vec2 => [get_scale_type_name(scale_type) === `log` ? (min_positive ?? min) : min, max]

// Finite colour and size extents without concatenating series. NaN/null entries
// fall back to the series colour/radius per point, so they must not widen either scale.
// Ranges follow auto_scale_range for the given colour/size scale types.
export function collect_scale_ranges(
  series: readonly ScaleValueSeries[],
  scale_types: { color?: ScaleType; size?: ScaleType } = {},
): {
  color_extent: RunningExtent
  color_range: Vec2
  size_range: Vec2
} {
  const color_extent = collect_series_extent(series, `color_values`)
  return {
    color_extent,
    color_range: auto_scale_range(color_extent, scale_types.color),
    size_range: collect_size_range(series, scale_types.size),
  }
}

// Size bounds without retaining a copy of every sample. Reuse across radius/type changes.
export const collect_size_range = (
  series: readonly ScaleValueSeries[],
  scale_type?: ScaleType,
): Vec2 => auto_scale_range(collect_series_extent(series, `size_values`), scale_type)

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

// Preserve positive bounds and direction. Replace a non-positive lower bound below the
// positive upper bound, using LOG_EPS only when no smaller recovery value is needed.
// `widen` expands collapsed domains for automatic ranges, but stays 1 for exact views.
export const positive_log_domain = (lower: number, upper: number, widen = 1.1): Vec2 => {
  const descending = lower > upper
  const [low, high] = descending ? [upper, lower] : [lower, upper]
  const floor =
    low > 0
      ? low
      : high > 0
        ? Math.min(math.LOG_EPS, Math.max(Number.MIN_VALUE, high / 10))
        : math.LOG_EPS
  const ceiling = high > floor ? high : floor * widen
  return validate_log_range(descending ? [ceiling, floor] : [floor, ceiling])
}

export function nice_range_from_extent(
  { min: min_ext, max: max_ext, min_positive, n_finite }: RunningExtent,
  limits: [number | null, number | null],
  scale_type: ScaleType,
  padding_factor: number,
  is_time = false,
): Vec2 {
  const [min, max] = limits
  const type_name = get_scale_type_name(scale_type)
  // Invalid log samples must not hide a smaller positive sample in the same series.
  if (!is_time && type_name === `log`) min_ext = min_positive ?? min_ext
  let [data_min, data_max] = resolve_axis_range(
    { range: limits, scale_type: is_time ? `time` : scale_type },
    [min_ext ?? 0, max_ext ?? 1],
  )
  const can_snap_zero =
    min_ext !== undefined &&
    max_ext !== undefined &&
    min_ext < max_ext &&
    !is_time &&
    type_name !== `log`
  const snap_zero_min = can_snap_zero && min === null && min_ext === 0 && data_min === 0
  const snap_zero_max = can_snap_zero && max === null && max_ext === 0 && data_max === 0

  // Apply padding *only if* limits were NOT provided
  if (min === null && max === null && n_finite > 0) {
    const { forward, inverse } =
      !is_time && type_name === `log`
        ? { forward: Math.log10, inverse: (value: number) => 10 ** value }
        : axis_transform(is_time ? `time` : scale_type)
    if (data_min !== data_max) {
      if (!is_time && type_name === `log`)
        [data_min, data_max] = positive_log_domain(data_min, data_max)
      // Pad in the scale's metric; linear and time transforms are identity functions.
      const lower = forward(data_min)
      const upper = forward(data_max)
      const padding = (upper - lower) * padding_factor
      data_min = inverse(lower - padding)
      data_max = inverse(upper + padding)
      // Handle single data point case with fixed relative padding
    } else if (is_time) {
      data_min -= MS_PER_DAY
      data_max += MS_PER_DAY
    } else if (type_name === `log`) {
      ;[data_min, data_max] = positive_log_domain(data_min, data_max, 1)
      data_min = Math.max(Number.MIN_VALUE, data_min / 1.1)
      data_max *= 1.1
    } else if (type_name === `arcsinh`) {
      // Arcsinh: 10% padding in transformed space
      const asinh_val = forward(data_min)
      const padding = Math.abs(asinh_val) * 0.1 || 0.1 // Use 0.1 if transformed value is 0 (i.e. data_min = 0)
      data_min = inverse(asinh_val - padding)
      data_max = inverse(asinh_val + padding)
    } else {
      const padding_abs = data_min === 0 ? 1 : Math.abs(data_min * 0.1) // 10% additive padding, or 1 if value is 0
      data_min -= padding_abs
      data_max += padding_abs
    }
    if (!is_time && type_name === `log`) validate_log_range([data_min, data_max])
  }

  // If time or no range after padding, return the (potentially padded) domain directly
  if (is_time || data_min === data_max) return [data_min, data_max]

  // D3's nice() for pretty boundaries, except arcsinh which keeps the padded domain
  if (type_name === `arcsinh`) {
    return [snap_zero_min ? 0 : data_min, snap_zero_max ? 0 : data_max]
  }

  const scale =
    type_name === `log`
      ? scaleLog().domain(positive_log_domain(data_min, data_max))
      : scaleLinear().domain([data_min, data_max])

  scale.nice()
  const [nice_min = data_min, nice_max = data_max] = scale.domain()
  // Nice ticks may expand automatic endpoints, but must not round a valid explicit bound.
  const result: Vec2 = [
    min !== null && (type_name !== `log` || min > 0) ? min : snap_zero_min ? 0 : nice_min,
    max !== null && (type_name !== `log` || max > 0) ? max : snap_zero_max ? 0 : nice_max,
  ]
  return type_name === `log` ? validate_log_range(result) : result
}

// d3's fine log ticks step through every mantissa 1-9 whatever the count (17 ticks on
// [0.0184, 0.993] for 6 requested). Keep the set closest to the count among all ticks and the
// 1-2-5 or 1 mantissas (ties keep the denser, a thinned set needs two ticks), then every n-th
// tick of it if that still overshoots by more than one ([2..8] -> [2, 4, 6, 8] for 5).
const thin_log_ticks = (ticks: number[], count: number): number[] => {
  const mantissa = (tick: number): number => tick / 10 ** Math.floor(Math.log10(tick) + 1e-9)
  const has_mantissa = (digits: number[]) => (tick: number) =>
    digits.some((digit) => Math.abs(mantissa(tick) - digit) < 1e-9)
  const best = [[1, 2, 5], [1]]
    .map((digits) => ticks.filter(has_mantissa(digits)))
    .filter((subset) => subset.length >= 2)
    .reduce(
      (closest, subset) =>
        Math.abs(subset.length - count) < Math.abs(closest.length - count) ? subset : closest,
      ticks,
    )
  if (best.length <= count + 1) return best
  const stride = Math.ceil(best.length / (count + 1))
  return best.filter((_, idx) => idx % stride === 0)
}

// Logarithmic ticks: powers of 10 inside the domain; 1-2-5 mantissas when the domain spans
// under three decades and the caller asked for more than 5 ticks; d3's mantissa ticks (thinned
// toward the count) for sub-decade domains (e.g. after zooming) where fewer than two powers fit.
export function generate_log_ticks(min: number, max: number, count?: number): number[] {
  ;[min, max] = positive_log_domain(Math.min(min, max), Math.max(min, max))
  const min_power = Math.floor(Math.log10(min))
  const max_power = Math.ceil(Math.log10(max))
  const in_range = (tick: number): boolean => tick >= min && tick <= max
  const powers = range(min_power, max_power + 1).map((power: number) => 10 ** power)
  const in_range_powers = powers.filter(in_range)
  const tick_count = count !== undefined && count > 0 ? count : 5
  // Powers of ten, or d3's fine mantissa ticks when fewer than two powers fall in range
  const fine_ticks =
    in_range_powers.length < 2
      ? thin_log_ticks(scaleLog().domain([min, max]).ticks(tick_count), tick_count)
      : []
  const base_ticks = fine_ticks.length > 0 ? fine_ticks : in_range_powers
  // Decades the domain actually spans: floor/ceil of the bounds would count [0.5, 50] as three
  if (Math.log10(max / min) < 3 && tick_count > 5) {
    const mantissa_ticks = powers
      .flatMap((power) => [power, power * 2, power * 5])
      .filter(in_range)
    // A generous count densifies sparse powers with 1-2-5 mantissas, but never swaps in fewer
    // ticks than a smaller count gets (e.g. [2, 5] instead of d3's [2..8] on [2, 8])
    if (mantissa_ticks.length > base_ticks.length) return mantissa_ticks
  }
  return base_ticks
}

export const get_tick_label = (
  tick_value: number,
  ticks_option: TicksOption | undefined,
): string | null =>
  is_tick_label_map(ticks_option) ? (ticks_option[tick_value] ?? null) : null

// Log domain for colour ramps, shared by every colour-scale builder so they agree on the
// floor: non-positive bounds fall back to LOG_EPS (a domain entirely <= 0 collapses to one
// colour instead of going NaN), positive bounds are kept however small (diffusivities, rates
// sit far below LOG_EPS) and in the caller's order (a descending range runs
// high-to-low). Equal bounds widen by 10% so the scale isn't degenerate.
export const log_color_domain = ([lower, upper]: Vec2): Vec2 => {
  const safe_lo = lower > 0 ? lower : math.LOG_EPS
  const safe_hi = upper > 0 ? upper : math.LOG_EPS
  return validate_log_range(
    safe_lo === safe_hi ? [safe_lo, safe_lo * 1.1] : [safe_lo, safe_hi],
  )
}

// Shared by density cells and legend ramps so clipped palettes stay identical.
export function color_interpolator(config: ColorScaleConfig | D3InterpolateName) {
  const { scheme = SCALE_DEFAULTS.scheme, color_range = [0, 1] } =
    typeof config === `string` ? { scheme: config } : config
  const [start, end] = color_range
  if (!(start >= 0 && end <= 1 && start < end))
    throw new Error(`Invalid color_range: ${color_range}`)
  const interpolate = get_d3_interpolator(scheme)
  return (fraction: number): string => interpolate(start + fraction * (end - start))
}

export function create_color_scale(
  color_scale_config: ColorScaleConfig | D3InterpolateName,
  auto_color_range: Vec2,
) {
  const config =
    typeof color_scale_config === `string`
      ? { scheme: color_scale_config }
      : color_scale_config
  const { value_range = auto_color_range, type: scale_type } = config
  const interpolator = color_interpolator(config)
  const type_name = get_scale_type_name(scale_type)
  if (type_name === `log`) {
    return scaleSequentialLog(interpolator).domain(log_color_domain(value_range))
  }
  if (type_name === `arcsinh`) {
    const threshold = get_arcsinh_threshold(scale_type)
    return create_arcsinh_color_scale(interpolator, [...value_range], threshold)
  }
  return scaleSequential(interpolator).domain(value_range)
}

// D3-compatible arcsinh colour scale whose domain getter/setter keeps one stable instance
function create_arcsinh_color_scale(
  interpolator: (fraction: number) => string,
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

  const scale = ((value: number): string => {
    const [d_min, d_max] = current_domain
    const t_min = Math.asinh(d_min / threshold)
    const t_max = Math.asinh(d_max / threshold)
    const t_val = Math.asinh(value / threshold)
    const normalized = t_max === t_min ? 0.5 : (t_val - t_min) / (t_max - t_min)
    return interpolator(clamp01(normalized))
  }) as ArcsinhColorScale

  scale.domain = function (new_domain?: Vec2) {
    if (new_domain === undefined) return current_domain
    current_domain = new_domain
    return scale
  } as ArcsinhColorScale[`domain`]

  return scale
}

export function create_size_scale(config: SizeScaleConfig, auto_range: Vec2) {
  const [min_radius, max_radius] = config.radius_range ?? SCALE_DEFAULTS.radius
  const [min_val, max_val] = config.value_range ?? auto_range

  const type_name = get_scale_type_name(config.type)

  if (type_name === `log`) {
    return scaleLog()
      .domain(positive_log_domain(min_val, max_val))
      .range([min_radius, max_radius])
      .clamp(true)
  }
  if (type_name === `arcsinh`) {
    const arcsinh_scale = scale_arcsinh(get_arcsinh_threshold(config.type))
      .domain([min_val, max_val])
      .range([min_radius, max_radius])

    type ClampedSizeScale = ((value: number) => number) & {
      domain: () => Vec2
      range: () => Vec2
      ticks: (count?: number) => number[]
    }

    // Order the bounds first: a descending radius_range would otherwise collapse the scale to
    // the constant min_radius (this branch clamps by hand, unlike d3's .clamp(true) below).
    const [lo_radius, hi_radius] =
      min_radius <= max_radius ? [min_radius, max_radius] : [max_radius, min_radius]
    const clamped_scale = ((value: number): number =>
      math.clamp(arcsinh_scale(value), lo_radius, hi_radius)) as ClampedSizeScale

    clamped_scale.domain = () => arcsinh_scale.domain()
    clamped_scale.range = () => arcsinh_scale.range()
    // Size legends pick their values from these
    clamped_scale.ticks = (count) => arcsinh_scale.ticks(count)
    return clamped_scale
  }

  return scaleLinear().domain([min_val, max_val]).range([min_radius, max_radius]).clamp(true)
}
