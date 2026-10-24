import type { Vec2 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { accumulate_error_extent, error_bar_path } from '#lib/plot/core/error-bars.js'
import type { ErrorValues } from '#lib/plot/core/error-bars.js'
import {
  accumulate_extent,
  collect_scale_ranges,
  collect_series_extent,
  collect_size_range,
  color_interpolator,
  resolve_color_scale,
  resolve_value_range,
  scheme_name,
  to_color_scale_config,
  with_scheme,
  create_scale,
  empty_extent,
  generate_arcsinh_ticks,
  generate_log_ticks,
  generate_ticks,
  create_size_scale,
  log_floor_scale,
  nice_range_from_extent,
  scale_arcsinh,
  tick_label_format,
} from '#lib/plot/core/scales.js'
import type { TicksOption } from '#lib/plot/core/scales.js'
import type { ColorScale, ScaleType } from '#lib/plot/core/types.js'
import {
  get_arcsinh_threshold,
  get_scale_type_name,
  is_scale_type_name,
  is_time_scale,
} from '#lib/plot/core/types.js'
import { scaleLinear, scaleLog, scaleTime } from 'd3-scale'
import { describe, expect, test, vi } from 'vitest'

type Limits = [number | null, number | null]
const sample_values = [1, 2, 3, 4, 5]
const nice_range = (
  values: number[],
  limits: Limits,
  scale_type: ScaleType,
  padding: number,
  is_time = false,
): Vec2 =>
  nice_range_from_extent(
    accumulate_extent(empty_extent(), values),
    limits,
    scale_type,
    padding,
    is_time,
  )

describe(`scales`, () => {
  describe(`create_scale`, () => {
    test.each<[ScaleType, Vec2, Vec2]>([
      [`linear`, [0, 100], [0, 500]],
      [`log`, [1, 1000], [0, 300]],
      [`log`, [0.1, 100], [50, 350]],
      [`log`, [1e-20, 1e-10], [0, 100]],
      [`log`, [1e-10, 1e-20], [0, 100]],
      [`arcsinh`, [-100, 100], [0, 500]],
      [`arcsinh`, [0, 1000], [0, 300]],
      [{ type: `arcsinh`, threshold: 10 }, [0, 100], [0, 500]],
    ])(`%j scale`, (scale_type, domain, range) => {
      const scale = create_scale(scale_type, domain, range)
      expect(scale.domain()).toEqual(domain)
      expect(scale.range()).toEqual(range)
      expect(scale(domain[0])).toBe(range[0])
      expect(scale(domain[1])).toBe(range[1])
    })

    test.each([
      { name: `negative min`, domain: [-5, 100] as Vec2, expected: [math.LOG_EPS, 100] },
      // panning a log axis past zero arrives with max <= 0: an unclamped max would make
      // every output/invert NaN (blank chart); clamping keeps the scale finite/recoverable
      {
        name: `non-positive min and max`,
        domain: [-1000, -5] as Vec2,
        expected: [math.LOG_EPS, math.LOG_EPS],
      },
    ])(
      `log scale clamps non-positive domain ($name) and stays finite`,
      ({ domain, expected }) => {
        const scale = create_scale(`log`, domain, [0, 500])
        expect(scale.domain()).toEqual(expected)
        expect(Number.isFinite(scale(10))).toBe(true)
        expect(Number.isFinite(scale.invert(250))).toBe(true)
      },
    )
  })

  describe(`nice_range_from_extent`, () => {
    test.each<[number[], ScaleType, number, boolean]>([
      [sample_values, `linear`, 0.05, false],
      [[1, 10, 100], `log`, 0.1, false],
      [[1e-20, 1e-10], `log`, 0.1, false],
      [[1e-20], `log`, 0.1, false],
      [[0, 1e-30, 1e-20], `log`, 0.05, false],
      [[-1, 1e-30, 1e-20], `log`, 0.05, false],
      [[new Date(2023, 0, 1).getTime(), new Date(2023, 11, 1).getTime()], `linear`, 0.1, true],
      [[42], `linear`, 0.1, false],
      // one point in log10 (nice() collapsed it to [1e15, 1e15]), and on arcsinh
      [[1e15, 1e15 + 1], `log`, 0.05, false],
      [[1e15, 1e15 + 1], `arcsinh`, 0.05, false],
    ])(`pads %j on a %s scale`, (values, scale_type, padding, is_time) => {
      const range = nice_range(values, [null, null], scale_type, padding, is_time)
      const domain = scale_type === `log` ? values.filter((value) => value > 0) : values
      expect(range).toHaveLength(2)
      expect(range[0]).toBeLessThan(Math.min(...domain))
      expect(range[1]).toBeGreaterThan(Math.max(...domain))
      if (scale_type === `log`) expect(range[0]).toBeGreaterThan(0)
    })

    // Unpadded (ScatterPlot's default) asinh/sinh round trips used to land an ulp inside these
    test.each([
      [-17.1393039778679, 13049.493724387714],
      [14.555529952936858, -6042.3967554855035],
    ])(`unpadded arcsinh range keeps the data ends %d, %d`, (...values) => {
      const [lower, upper] = nice_range(values, [null, null], `arcsinh`, 0)
      expect(lower).toBeLessThanOrEqual(Math.min(...values))
      expect(upper).toBeGreaterThanOrEqual(Math.max(...values))
    })

    test.each([-0.1, NaN])(`rejects range_padding %s`, (padding) => {
      expect(() => nice_range([0, 1], [null, null], `linear`, padding)).toThrow(
        `range_padding`,
      )
    })

    test.each([0.09, 0.9, 9, 90])(`pads log singleton %s only once before nicing`, (value) => {
      const upper = 10 ** Math.round(Math.log10(value))
      expect(nice_range([value], [null, null], `log`, 0.05)).toEqual([upper / 10, upper])
    })

    test.each([
      { values: [1e-300, 1e300], max: null },
      { values: [1e-300, 1e300], max: 1e-301 },
      { values: [1e308], max: null },
    ])(
      `rejects unrepresentable log ranges for $values with upper bound $max`,
      ({ values, max }) => {
        expect(() => nice_range(values, [null, max], `log`, 0.05)).toThrow(/log.*range/i)
      },
    )

    test.each<Limits>([
      [0, 10],
      [0.123, 4.987],
      [4.987, 0.123],
      [null, 1000],
      [0, null],
    ])(`respects explicit bounds [%s, %s]`, (lower, upper) => {
      const range = nice_range(sample_values, [lower, upper], `linear`, 0.05)
      expect(range).toHaveLength(2)
      if (lower === null) expect(range[0]).toBeLessThan(1)
      else expect(range[0]).toBe(lower)
      if (upper === null) expect(range[1]).toBeGreaterThanOrEqual(5)
      else expect(range[1]).toBe(upper)
    })

    test(`empty input uses the unit range`, () => {
      expect(nice_range([], [null, null], `linear`, 0.1)).toEqual([0, 1])
    })

    test.each([3_600_000, 0])(
      `crossed time limits preserve the data duration (%s ms), or use one day`,
      (duration) => {
        const epoch = Date.UTC(2026, 0, 1)
        const day = 86_400_000
        const values = [epoch, epoch + duration]
        for (const scale_type of [`linear`, `time`] as const) {
          expect(nice_range(values, [epoch + day, null], scale_type, 0.05, true)).toEqual([
            epoch + day,
            epoch + day + (duration || day),
          ])
          expect(nice_range(values, [null, epoch - day], scale_type, 0.05, true)).toEqual([
            epoch - day - (duration || day),
            epoch - day,
          ])
        }
      },
    )

    test.each<{ values: number[]; limits: Limits }>([
      { values: [0, 5], limits: [100, null] },
      { values: [0, 5], limits: [null, -100] },
      { values: [0, 5], limits: [5, null] },
      { values: [0, 5], limits: [null, 0] },
      { values: [0], limits: [0, null] },
      { values: [0], limits: [null, 0] },
      { values: [], limits: [100, null] },
      { values: [], limits: [null, -100] },
      { values: [1, 10], limits: [100.123, null] },
      { values: [1, 10], limits: [null, 0.0123] },
      { values: [1, 10], limits: [null, 1e-9] },
      { values: [1, 10], limits: [null, 1e-20] },
      { values: [1e-20, 1e-10], limits: [1e-9, null] },
    ])(`keeps one-sided bounds ordered for $values and $limits`, ({ values, limits }) => {
      for (const scale_type of [`linear`, `time`, `arcsinh`, `log`] as const) {
        // Log limits must be positive; non-positive log bounds have separate coverage.
        if (scale_type === `log` && limits.some((bound) => bound !== null && bound <= 0))
          continue
        const [lower, upper] = nice_range(
          values,
          limits,
          scale_type,
          0.05,
          scale_type === `time`,
        )
        expect(Number.isFinite(lower) && Number.isFinite(upper)).toBe(true)
        expect(lower).toBeLessThan(upper)
        if (limits[0] !== null) expect(lower).toBe(limits[0])
        if (limits[1] !== null) expect(upper).toBe(limits[1])
        if (scale_type === `log`) expect(lower).toBeGreaterThan(0)
      }
    })

    // a log axis given a non-positive bound (explicit negative min, all data <= 0) must still
    // come out ascending and strictly positive instead of the inverted [LOG_EPS, 0]
    test.each<{ values: number[]; limits: Limits }>([
      { values: [0, 0], limits: [-5, null] },
      { values: [-3, -1], limits: [-2, 0] },
      { values: [-3, 1], limits: [-2, null] },
    ])(
      `log range stays positive and ascending for $values with limits $limits`,
      ({ values, limits }) => {
        const [lower, upper] = nice_range(values, limits, `log`, 0.05)
        expect(lower).toBeGreaterThan(0)
        expect(upper).toBeGreaterThan(lower)
      },
    )

    // an observed zero edge snaps to exactly 0 despite padding; an all-zero range still widens
    test.each([
      { xs: [0, 4.7], padding: 0.05, check: ([min, max]: Vec2) => min === 0 && max >= 4.7 },
      { xs: [-4.7, 0], padding: 0.05, check: ([min, max]: Vec2) => min <= -4.7 && max === 0 },
      { xs: [0], padding: 0, check: ([min, max]: Vec2) => min < 0 && max > 0 },
    ])(`snaps observed zero edges for x=$xs`, ({ xs: x_values, padding, check }) => {
      expect(check(nice_range(x_values, [null, null], `linear`, padding))).toBe(true)
    })
  })

  describe(`accumulate_extent / nice_range_from_extent`, () => {
    test.each<{
      values: number[]
      error: ErrorValues | undefined
      expected: ReturnType<typeof empty_extent>
    }>([
      {
        values: [0, 2, 5],
        error: [-1, 0, 2],
        expected: { min: -1, max: 7, min_positive: 1, n_finite: 6 },
      },
      {
        values: [2, 8],
        error: { lower: [3, NaN], upper: 4 },
        expected: { min: -1, max: 12, min_positive: 6, n_finite: 4 },
      },
      {
        values: [NaN, Infinity, -Infinity, 1, -0, 0],
        error: Infinity,
        expected: { min: -0, max: 1, min_positive: 1, n_finite: 6 },
      },
      {
        values: [Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE],
        error: Number.MAX_VALUE,
        expected: {
          min: -Number.MAX_VALUE,
          max: Number.MAX_VALUE,
          min_positive: Number.MAX_VALUE,
          n_finite: 4,
        },
      },
      {
        values: [1, 2, 3],
        error: 1,
        expected: { min: 0, max: 4, min_positive: 1, n_finite: 6 },
      },
      { values: [-0], error: 0, expected: { min: -0, max: -0, n_finite: 2 } },
      { values: [1, 2], error: undefined, expected: { n_finite: 0 } },
      // a null gap is no point, though null - 1 is a finite -1
      {
        values: [100, null, 102] as number[],
        error: 1,
        expected: { min: 99, max: 103, min_positive: 99, n_finite: 4 },
      },
    ])(`accumulates error-bar bounds for %j`, ({ values, error, expected }) => {
      const extent = empty_extent()
      accumulate_error_extent(extent, values, error)
      expect(extent).toEqual(expected)
      accumulate_extent(extent, [-10, 100])
      expect(extent).toEqual({
        min: expected.min === undefined || expected.min > -10 ? -10 : expected.min,
        max: expected.max === undefined || expected.max < 100 ? 100 : expected.max,
        min_positive: Math.min(expected.min_positive ?? Infinity, 100),
        n_finite: expected.n_finite + 2,
      })
    })

    // untyped hosts can send one side of an asymmetric error, which crashed per point
    test(`rejects a one-sided asymmetric error`, () => {
      const error = { upper: 1 } as unknown as ErrorValues
      expect(() => accumulate_error_extent(empty_extent(), [1], error)).toThrow(
        `Asymmetric error needs both upper and lower, got {"upper":1}`,
      )
    })

    // Three strokes (cap, bar, cap) with the two coordinates' roles swapped between axes
    test.each([
      [false, 3, `M10,47V53M10,50H30M30,47V53`],
      [true, 3, `M47,10H53M50,10V30M47,30H53`],
      [true, 0, `M50,10H50M50,10V30M50,30H50`],
    ])(`error_bar_path(vertical=%s, cap=%d)`, (vertical, cap, expected) => {
      expect(error_bar_path([10, 30], 50, vertical, cap)).toBe(expected)
    })

    test(`tracks finite extent; multi-pass; every niced range is finite`, () => {
      for (const values of [
        [3, 1, 4, 1, 5],
        [-2, 7, -9, 0, 3],
        [1, NaN, 5],
        [1, null, 5, undefined],
        [1, Infinity, 5],
        [1, -Infinity, 5],
        [NaN, Infinity, -Infinity],
        [42],
        [0, 0, 0],
      ]) {
        const acc = accumulate_extent(empty_extent(), values)
        const finite_values = values.filter(
          (value): value is number => typeof value === `number` && Number.isFinite(value),
        )
        const positive_values = finite_values.filter((value) => value > 0)
        expect(acc).toEqual({
          ...(finite_values.length > 0 && {
            min: Math.min(...finite_values),
            max: Math.max(...finite_values),
          }),
          n_finite: finite_values.length,
          ...(positive_values.length && { min_positive: Math.min(...positive_values) }),
        })
      }
      const acc = accumulate_extent(empty_extent(), [4, 8])
      accumulate_extent(acc, [-1, 2])
      expect(acc).toEqual({ min: -1, max: 8, min_positive: 2, n_finite: 4 })

      for (const scale_type of [`linear`, `log`, `arcsinh`] as const) {
        for (const padding of scale_type === `log` ? [0, 0.1] : [0, 0.05]) {
          for (const values of [
            [],
            [7],
            [0, 4.7],
            [-4.7, 0],
            [1, 2, 3, 4, 5],
            [0.001, 1000],
            [3, NaN, 9],
            [1, Infinity, 5],
            [NaN, Infinity],
          ]) {
            for (const limits of [
              [null, null],
              [0, 10],
              [-5, null],
            ] as Limits[]) {
              // Non-positive log bounds are clamped, so only finiteness is fixed here.
              const [low, high] = nice_range(values, limits, scale_type, padding)
              expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true)
            }
          }
        }
      }
    })
  })

  // A descending range is a supported axis mode; a collapsed [1000, 1000] log domain would put
  // every value on one pixel and break invert (hover, tooltips, rect-zoom).
  test(`mirrors a log axis on a descending domain instead of collapsing it`, () => {
    const values = [1, 10, 100, 1000]
    const ascending = create_scale(`log`, [1, 1000], [0, 300])
    const descending = create_scale(`log`, [1000, 1], [0, 300])
    const px_of = (scale: (val: number) => number) => values.map((val) => scale(val))
    // decade-per-100px, to float dust: d3's log scale does not land exactly on 100
    for (const [idx, pixel_x] of px_of(ascending).entries())
      expect(pixel_x).toBeCloseTo(idx * 100, 9)
    const mirrored = px_of(ascending).toReversed()
    for (const [idx, pixel_x] of px_of(descending).entries())
      expect(pixel_x).toBeCloseTo(mirrored[idx], 9)
    // invert has to stay live too: the geometric midpoint of the decade span sits mid-range
    expect(descending.invert(150)).toBeCloseTo(Math.sqrt(1000), 10)
  })

  // A descending value_range asks for the largest value to draw the smallest marker
  test(`inverts the radius encoding on a descending log value_range`, () => {
    const radii = (value_range: Vec2) =>
      [1, 10, 100].map(
        create_size_scale({ type: `log`, value_range, radius_range: [2, 10] }, [0, 1]),
      )
    expect(radii([1, 100])).toEqual([2, 6, 10])
    expect(radii([100, 1])).toEqual([10, 6, 2])
  })

  // The arcsinh branch clamps by hand, not through d3's .clamp(true), so descending bounds
  // collapsed it to a constant
  test.each([`linear`, `arcsinh`, `log`] as const)(
    `%s honors a descending radius_range`,
    (type) => {
      const radius = create_size_scale(
        { type, value_range: [1, 100], radius_range: [10, 2] },
        [0, 1],
      )
      // the last one is out of domain: it clamps to the end, not past it
      expect([radius(1), radius(100), radius(1000)]).toEqual([10, 2, 2])
    },
  )

  describe(`log_floor_scale`, () => {
    test(`returns non-log scales untouched`, () => {
      const scale = scaleLinear().domain([-5, 5]).range([0, 100])
      for (const scale_type of [`linear`, `arcsinh`] as const) {
        expect(log_floor_scale(scale, scale_type, scale.domain())).toBe(scale)
      }
    })

    test.each([
      [`in range`, 10, 10],
      [`at floor`, 1, 1],
      [`below floor`, 0.5, 1],
      [`zero`, 0, 1],
      [`negative`, -3, 1],
    ])(`log: %s value %d maps like %d`, (_desc, value, clamped) => {
      const scale = scaleLog().domain([1, 1000]).range([300, 0])
      expect(log_floor_scale(scale, `log`, scale.domain())(value)).toBe(scale(clamped))
    })

    test(`takes the floor from an unordered domain`, () => {
      const scale = scaleLog().domain([1000, 1]).range([0, 300])
      expect(log_floor_scale(scale, `log`, [1000, 1])(0)).toBe(scale(1))
    })
  })

  describe(`collect_scale_ranges / collect_size_range`, () => {
    test.each([
      [`plain arrays`, [{ size_values: [1, 2, 3] }, { size_values: [4] }], [1, 4]],
      [`skips null/NaN/Infinity`, [{ size_values: [1, null, NaN, Infinity, 5] }], [1, 5]],
      [`typed arrays`, [{ size_values: new Float32Array([2, 8]) }], [2, 8]],
      [`null series and missing sizes`, [null, undefined, {}, { size_values: null }], [0, 1]],
    ])(`%s`, (_desc, series, expected) => {
      expect(collect_size_range(series)).toEqual(expected)
      // the size-only pass matches the combined colour+size pass
      expect(collect_scale_ranges(series).size_range).toEqual(expected)
    })

    test(`colour extent ignores nulls and non-finite values`, () => {
      const read_sizes = vi.fn(() => [2, 4])
      const series = [
        {
          color_values: [3, null, NaN, 9],
          get size_values() {
            return read_sizes()
          },
        },
        null,
        { color_values: new Float64Array([-1, Infinity]) },
      ]
      const color_only = collect_series_extent(series, `color_values`)
      expect(read_sizes).not.toHaveBeenCalled()
      const { color_extent, color_range } = collect_scale_ranges(series)
      expect(color_only).toEqual(color_extent)
      expect(color_extent).toEqual({ min: -1, max: 9, min_positive: 3, n_finite: 3 })
      expect(color_range).toEqual([-1, 9])
      expect(collect_scale_ranges([{}]).color_range).toEqual([0, 1])
      // log scales floor at the smallest positive value, not the non-positive min
      expect(collect_scale_ranges(series, { color: `log` }).color_range).toEqual([3, 9])
      expect(collect_scale_ranges([{}], { color: `log` }).color_range).toEqual([0, 1])
    })

    test.each([
      [`log`, [0, 1, 100], [1, 100]],
      [`log`, [-5, 0], [-5, 0]],
      [`linear`, [0, 1, 100], [0, 100]],
      [{ type: `arcsinh`, threshold: 1 }, [0, 1, 100], [0, 100]],
    ] as const)(`%o size range of %j is %j`, (scale_type, size_values, expected) => {
      const series = [{ size_values: [...size_values] }]
      expect(collect_size_range(series, scale_type)).toEqual(expected)
      expect(collect_scale_ranges(series, { size: scale_type }).size_range).toEqual(expected)
    })
  })

  describe(`generate_log_ticks`, () => {
    // oxfmt-ignore
    test.each([
      { min: 0.1, max: 1000, ticks: 5, expected: [0.1, 1, 10, 100, 1000] },
      // under three decades with a generous count: 1-2-5 mantissas
      { min: 1, max: 10, ticks: 8, expected: [1, 2, 5, 10] },
      { min: 1, max: 50, ticks: 8, expected: [1, 2, 5, 10, 20, 50] },
      // decades are counted from the bounds' ratio, not their rounded-out powers of ten
      { min: 0.5, max: 50, ticks: 10, expected: [0.5, 1, 2, 5, 10, 20, 50] },
      { min: 2, max: 400, ticks: 8, expected: [2, 5, 10, 20, 50, 100, 200] },
      // same span, small count: powers of ten only
      { min: 1, max: 50, ticks: 5, expected: [1, 10] },
      // sub-decade domains fall back to d3 mantissa ticks inside the domain, every other one
      // when all of them overshoot the count by more than one
      { min: 2, max: 8, ticks: 5, expected: [2, 4, 6, 8] },
      { min: 0.2, max: 0.8, ticks: 5, expected: [0.2, 0.4, 0.6, 0.8] },
      { min: 1.5, max: 1.6, ticks: 5, expected: [1.5, 1.52, 1.54, 1.56, 1.58, 1.6] },
      // under two powers of ten in range, d3's fine ticks or their 1-2-5 mantissas, whichever
      // is closer to the count (d3 alone gave 17 ticks on [0.0184, 0.993] for 6 or even 2)
      { min: 0.5, max: 5, ticks: 10, expected: [0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 3, 4, 5] },
      { min: 50, max: 500, ticks: 6, expected: [50, 100, 200, 500] },
      { min: 0.0184, max: 0.993, ticks: 6, expected: [0.02, 0.05, 0.1, 0.2, 0.5] },
      { min: 0.0184, max: 0.993, ticks: 2, expected: [0.02, 0.1, 0.5] },
      // narrow domains straddling a power of ten must not emit ticks past max
      { min: 0.92, max: 0.99, ticks: 5, expected: [0.92, 0.94, 0.96, 0.98] },
      // a generous count on a domain holding fewer than two 1-2-5 mantissas must still
      // produce ticks (the mantissa list alone was [] for [0.92, 0.99] and [7, 8], [2] for [2, 3])
      { min: 0.92, max: 0.99, ticks: 8, expected: [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99] },
      { min: 7, max: 8, ticks: 8, expected: [7, 7.2, 7.4, 7.6, 7.8, 8] },
      { min: 2, max: 3, ticks: 8, expected: [2, 2.2, 2.4, 2.6, 2.8, 3] },
      // non-positive bounds clamp to LOG_EPS before the power scan
      { min: -10, max: 100, ticks: 5, expected: [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 1, 10, 100] },
      { min: 1e-12, max: 1, ticks: 5, expected: [1e-12, 1e-11, 1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 1] },
      { min: 1e-20, max: 1e-18, ticks: 5, expected: [1e-20, 1e-19, 1e-18] },
    ])(`log ticks: $min to $max (ticks=$ticks)`, ({ min, max, ticks, expected }) => {
      const result = generate_log_ticks(min, max, ticks)
      expect(result).toHaveLength(expected.length)
      result.forEach((tick, idx) =>
        expect(Math.abs(tick - expected[idx])).toBeLessThanOrEqual(
          32 * Number.EPSILON * expected[idx],
        ),
      )
    })

    // 1-2-5 mantissas only replace sparser ticks: [2, 8] with 10 ticks gave [2, 5] while 5
    // gave [2..8], and [0.3, 3] with 10 gave [0.5, 1, 2]
    test.each([
      [2, 8],
      [0.3, 3],
      [0.5, 5],
      [50, 500],
      [1, 50],
      [1, 10],
      [0.92, 0.99],
    ])(`asking for more ticks on [%s, %s] never returns fewer`, (min, max) => {
      const counts = [2, 4, 5, 6, 8, 10, 12].map(
        (count) => generate_log_ticks(min, max, count).length,
      )
      expect(counts).toEqual(counts.toSorted((count_a, count_b) => count_a - count_b))
    })

    test.each([100, 1, 0.001])(
      `degenerate domain [%s, %s] widens to include the value`,
      (value) => {
        const result = generate_log_ticks(value, value, 5)
        expect(result[0]).toBe(value)
        expect(result.every((tick) => tick >= value && tick <= value * 1.1)).toBe(true)
      },
    )
  })

  describe(`generate_ticks`, () => {
    test(`array input is used as-is, even under an integer format`, () => {
      const scale = scaleLinear().domain([0, 100]).range([0, 500])
      expect(generate_ticks([0, 100], `linear`, [10, 30, 50], scale)).toEqual([10, 30, 50])
      const opts = { format: `d` }
      expect(generate_ticks([0, 2], `linear`, [0.5, 1.5], scale, opts)).toEqual([0.5, 1.5])
    })

    test.each([
      {
        name: `filters out-of-domain, sorts`,
        domain: [0, 100] as Vec2,
        ticks: { 50: `A`, 10: `B`, 150: `C`, 90: `D`, [-10]: `E`, 30: `F` },
        expected: [10, 30, 50, 90],
      },
      {
        name: `filters non-finite values`,
        domain: [0, 100] as Vec2,
        ticks: { 25: `A`, 50: `B`, NaN: `C`, 75: `D`, [Infinity]: `E` },
        expected: [25, 50, 75],
      },
      {
        name: `handles reversed domain`,
        domain: [100, 0] as Vec2,
        ticks: { 80: `A`, 20: `B`, 150: `C`, 50: `D` },
        expected: [20, 50, 80],
      },
    ])(`object input - $name`, ({ domain, ticks, expected }) => {
      const scale = scaleLinear().domain(domain).range([0, 500])
      expect(generate_ticks(domain, `linear`, ticks as Record<number, string>, scale)).toEqual(
        expected,
      )
    })

    type Ymd = [number, number, number]
    type TimeTickCase = { ticks: TicksOption; start: Ymd; end: Ymd; expected: Ymd[] }
    const weekly: Ymd[] = [1, 8, 15, 22, 29].map((day) => [2023, 0, day])
    // oxfmt-ignore
    test.each<TimeTickCase>([
      // count request: d3 picks a nice interval, here monthly over 2.5 months
      { ticks: 5, start: [2023, 0, 1], end: [2023, 2, 15], expected: [[2023, 0, 1], [2023, 1, 1], [2023, 2, 1]] },
      { ticks: `month`, start: [2023, 0, 15], end: [2023, 5, 10], expected: [1, 2, 3, 4, 5].map((month) => [2023, month, 1]) },
      { ticks: `year`, start: [2020, 5, 15], end: [2025, 2, 10], expected: [2021, 2022, 2023, 2024, 2025].map((year) => [year, 0, 1]) },
      { ticks: `day`, start: [2023, 0, 30], end: [2023, 1, 3], expected: [[2023, 0, 30], [2023, 0, 31], [2023, 1, 1], [2023, 1, 2], [2023, 1, 3]] },
      // negative number: interval in days
      { ticks: -7, start: [2023, 0, 1], end: [2023, 0, 29], expected: weekly },
      // reversed domain: the interval count must come from the sorted span, not domain[1]-domain[0]
      { ticks: -7, start: [2023, 0, 29], end: [2023, 0, 1], expected: weekly },
    ])(`time ticks for ticks=$ticks from $start`, ({ ticks, start, end, expected }) => {
      const domain: Vec2 = [new Date(...start).getTime(), new Date(...end).getTime()]
      const scale = scaleTime().domain(domain).range([0, 500])
      const result = generate_ticks(domain, `time`, ticks, scale)
      expect(result.map((tick) => new Date(tick))).toEqual(
        expected.map((parts) => new Date(...parts)),
      )
    })

    // Stepping overshoots by float dust (3 * 0.1 = 0.30000000000000004), which PlotAxis's
    // in-domain check would hide, and a whole step past max is no tick
    test.each<[Vec2, number, number[]]>([
      [[0, 0.3], -0.1, [0, 0.1, 0.2, 0.3]],
      // the min bound on a step multiple keeps its tick: -0.3 / 0.1 rounds to -2.9999999999999996
      [[-0.3, 0], -0.1, [-0.3, -0.2, -0.1, 0]],
      [[0.7, 1.3], -0.3, [0.9, 1.2]],
      [[0.7, 1], -0.1, [0.7, 0.8, 0.9, 1]],
      [[-1000, -997.001], -1, [-1000, -999, -998]],
      [[-2, -0.001], -1, [-2, -1]],
    ])(`interval ticks stay inside %j at step %d`, (domain, ticks, expected) => {
      const scale = scaleLinear().domain(domain).range([0, 500])
      const result = generate_ticks(domain, `linear`, ticks, scale)
      expect(result.every((tick) => math.in_range(tick, domain))).toBe(true)
      expect(result.map((tick) => Number(tick.toFixed(12)))).toEqual(expected)
    })

    const fine_steps = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]
    // Ticks are rounded to 12 places so 0.6000000000000001 from interval stepping compares as 0.6
    type TickOptions = Parameters<typeof generate_ticks>[4]
    type TickCase = [string, Vec2, ScaleType, number | undefined, TickOptions, number[]]
    // only all-fractional ticks drop an integer format, so explicit mixed arrays keep it
    test.each([
      [[0.2, 0.4], `d`, undefined],
      [[0.25, 0.5], `,.0f`, undefined],
      [[0, 1, 2], `d`, `d`],
      [[0.1, 1, 1.1], `d`, `d`],
      [[0.2, 0.4], `.1f`, `.1f`],
      [[], `d`, `d`],
    ])(`tick_label_format(%j, %s) = %s`, (ticks, format, expected) => {
      expect(tick_label_format(ticks, format)).toBe(expected)
    })

    // oxfmt-ignore
    test.each<TickCase>([
      [`log powers of 10`, [1, 1000], `log`, 5, undefined, [1, 10, 100, 1000]],
      [`negative count is a fixed interval`, [0, 100], `linear`, -10, undefined, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]],
      [`fractional interval`, [0, 1], `linear`, -0.2, undefined, [0, 0.2, 0.4, 0.6, 0.8, 1]],
      // reversed (descending) domains are first-class: an interval must still emit ticks
      [`interval on a descending domain`, [10, 0], `linear`, -2, undefined, [0, 2, 4, 6, 8, 10]],
      [`explicit count wins over default_count`, [0, 100], `linear`, 5, { default_count: 2 }, [0, 20, 40, 60, 80, 100]],
      [`default_count applies without a ticks option`, [0, 100], `linear`, undefined, { default_count: 2 }, [0, 50, 100]],
      // an integer format rounds every label, so generated half steps would read `0, 1, 1, 2, 2`
      [`integer format keeps distinct integer ticks`, [0, 2], `linear`, 10, { format: `d` }, [0, 1, 2]],
      [`grouped integer format`, [0, 1], `linear`, 10, { format: `,d` }, [0, 1]],
      [`integer format on a descending domain`, [2, 0], `linear`, 10, { format: `d` }, [0, 1, 2]],
      // no integer fits a domain zoomed below one unit: keep the plain (decimal) ticks
      [`integer format with no integer to label`, [0.2, 0.8], `linear`, 6, { format: `d` }, [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]],
      // zero-precision fixed point prints integers too
      [`.0f is an integer format`, [0, 2], `linear`, 10, { format: `.0f` }, [0, 1, 2]],
      [`grouped .0f is an integer format`, [0, 1], `linear`, 10, { format: `,.0f` }, [0, 1]],
      [`.0% percent is not an integer format`, [0, 2], `linear`, 10, { format: `.0%` }, fine_steps],
      [`decimal format keeps fine steps`, [0, 2], `linear`, 10, { format: `.1f` }, fine_steps],
      [`time-style %d is not an integer format`, [0, 2], `linear`, 10, { format: `%d` }, fine_steps],
      [`linear count`, [0, 50], `linear`, 6, undefined, [0, 10, 20, 30, 40, 50]],
      [`degenerate linear domain`, [0, 0], `linear`, 5, undefined, [0]],
      [`arcsinh mixed range is symmetric around 0`, [-1000, 1000], `arcsinh`, 10, undefined, [-1000, -100, -10, -1, 0, 1, 10, 100, 1000]],
    ])(`%s`, (_name, domain, type, ticks, opts, expected) => {
      const range: Vec2 = [0, 500]
      const scale =
        type === `log`
          ? scaleLog().domain(domain).range(range)
          : type === `arcsinh`
            ? scale_arcsinh(1).domain(domain).range(range)
            : scaleLinear().domain(domain).range(range)
      const result = generate_ticks(domain, type, ticks, scale, opts)
      expect(result.map((tick) => Number(tick.toFixed(12)))).toEqual(expected)
    })

    // A negative ticks option is a STEP, so its count rides on the domain: `ticks: -1` over
    // [0, 1e8] built 100,000,001 entries (~800 MB). Time intervals take the same step -> count
    // path. Local, not UTC: d3's year ticks land on local year starts, so 201 holds in any TZ.
    const centuries: Vec2 = [new Date(1900, 0, 1).getTime(), new Date(2100, 0, 1).getTime()]
    // oxfmt-ignore
    // last column: the exact tick count when the option is within the cap, else the throw
    test.each<[string, Vec2, TicksOption, ScaleType, string | number]>([
      [`interval past the cap`, [0, 1e8], -1, `linear`, `a tick interval of 1`],
      [`count past the cap`, [0, 1e8], 5e6, `linear`, `a tick count of 5000000`],
      [`interval within the cap`, [0, 1e8], -1e5, `linear`, 1001],
      [`time day interval past the cap`, centuries, `day`, `time`, `a tick interval of 1 day(s)`],
      [`time fractional day step past the cap`, centuries, -0.001, `time`, `a tick interval of 0.001 day(s)`],
      [`time year interval within the cap`, centuries, `year`, `time`, 201],
    ])(`%s`, (_name, domain, ticks, scale_type, expected) => {
      const scale = scaleLinear().domain(domain).range([0, 500])
      const generate = () => generate_ticks(domain, scale_type, ticks, scale)
      if (typeof expected === `number`) expect(generate()).toHaveLength(expected)
      else expect(generate).toThrow(expected)
    })
  })

  describe(`scale_arcsinh`, () => {
    test(`forward transform maps domain ends to range ends and 0 to the symmetric midpoint`, () => {
      const positive = scale_arcsinh(1).domain([0, 100]).range([0, 100])
      expect([positive(0), positive(100)]).toEqual([0, 100])
      expect(positive(50)).toBeGreaterThan(0)
      expect(positive(50)).toBeLessThan(100)
      const symmetric = scale_arcsinh(1).domain([-100, 100]).range([0, 100])
      expect([symmetric(-100), symmetric(0), symmetric(100)]).toEqual([0, 50, 100])
    })

    // oxfmt-ignore
    test.each([
      { threshold: 1, domain: [0, 100] as Vec2, values: [0, 1, 10, 50, 100] },
      { threshold: 1, domain: [-100, 100] as Vec2, values: [-100, -10, -1, 0, 1, 10, 100] },
      { threshold: 10, domain: [0, 1000] as Vec2, values: [0, 10, 100, 500, 1000] },
    ])(
      `inverse transform (threshold=$threshold, domain=$domain)`,
      ({ threshold, domain, values }) => {
        const scale = scale_arcsinh(threshold).domain(domain).range([0, 500])
        values.forEach((val) => {
          expect(scale.invert(scale(val))).toBeCloseTo(val, 8)
        })
      },
    )

    test(`a smaller threshold puts a value deeper into the log region`, () => {
      const pos_of_10 = (threshold: number) =>
        scale_arcsinh(threshold).domain([0, 1000]).range([0, 100])(10)
      expect(pos_of_10(1)).toBeGreaterThan(pos_of_10(100))
    })

    test(`ticks method delegates to generate_arcsinh_ticks with the scale threshold`, () => {
      const scale = scale_arcsinh(1).domain([-100, 100]).range([0, 500])
      const expected = [-100, -50, -20, -10, -5, 0, 5, 10, 20, 50, 100]
      expect(scale.ticks(10)).toEqual(expected)
      expect(generate_arcsinh_ticks(-100, 100, 1, 10)).toEqual(expected)
    })

    // scale_arcsinh and get_arcsinh_threshold share the validation, so one table covers both
    test.each([0, -1, NaN, Infinity])(`throws for invalid threshold %s`, (threshold) => {
      const error_msg = `arcsinh threshold must be a positive finite number, got ${threshold}`
      expect(() => scale_arcsinh(threshold)).toThrow(error_msg)
      expect(() => get_arcsinh_threshold({ type: `arcsinh`, threshold })).toThrow(error_msg)
    })

    test(`degenerate domain (d_min === d_max) returns midpoints`, () => {
      const scale = scale_arcsinh(1).domain([50, 50]).range([0, 100])
      for (const val of [0, 50, 100, -100]) expect(scale(val)).toBe(50) // range midpoint
      const scale2 = scale_arcsinh(1).domain([42, 42]).range([0, 100])
      for (const val of [0, 50, 100]) expect(scale2.invert(val)).toBe(42) // domain midpoint
    })
  })

  describe(`generate_arcsinh_ticks`, () => {
    // Ticks are rounded to 12 places so 0.6000000000000001 from linear stepping compares as 0.6
    // oxfmt-ignore
    test.each<[string, number, number, number, number, number[]]>([
      [`positive range: decades plus 2x/5x fill to reach count`, 0, 1000, 1, 10, [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]],
      [`negative range mirrors the positive path`, -1000, 0, 1, 10, [-1000, -500, -200, -100, -50, -20, -10, -5, -2, -1]],
      [`range within 2x threshold is spaced linearly`, 0, 1, 1, 5, [0, 0.2, 0.4, 0.6, 0.8, 1]],
      [`large threshold keeps the whole range linear`, 0, 100, 100, 8, [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100]],
      // a low count over a wide mixed range keeps the outermost decades, not every one
      [`small count keeps spread-out outer ticks`, -100, 100, 1, 4, [-100, -10, 0, 10, 100]],
    ])(`%s`, (_name, min, max, threshold, count, expected) => {
      const ticks = generate_arcsinh_ticks(min, max, threshold, count)
      expect(ticks.map((tick) => Number(tick.toFixed(12)))).toEqual(expected)
    })

    // raw domain extremes must not become ticks (long labels like 1325.8239811994677)
    test(`emits clean round ticks for a non-round domain, at any count`, () => {
      const [min, max] = [-1515.343730040983, 1325.8239811994677]
      const ticks = generate_arcsinh_ticks(min, max, 10, 10)
      for (const tick of ticks) expect(`${tick}`.length).toBeLessThanOrEqual(6)
      // still covers the range with powers of 10 on both sides of zero
      expect(Math.max(...ticks)).toBeGreaterThanOrEqual(1000)
      expect(Math.min(...ticks)).toBeLessThanOrEqual(-1000)
      // a small count snaps the larger-magnitude boundary to the nearest power of 10
      const few = generate_arcsinh_ticks(-1500, 1300, 10, 2)
      expect(few).not.toContain(-1500)
      expect(few).toEqual(expect.arrayContaining([-1000, 0]))
    })

    // ±1 sit almost on 0 in arcsinh space, so their labels would overlap the zero tick
    test(`omits sub-threshold powers that would overlap the zero tick`, () => {
      const ticks = generate_arcsinh_ticks(-1000, 1000, 10, 10)
      expect(ticks).toContain(0)
      const min_nonzero = Math.min(...ticks.filter((tick) => tick !== 0).map(Math.abs))
      expect(min_nonzero).toBeGreaterThanOrEqual(10)
    })

    test.each([
      { min: 1000, max: -100, name: `mixed` },
      { min: 100, max: 0, name: `positive` },
      { min: 0, max: -100, name: `negative` },
      { min: 500, max: -500, name: `symmetric` },
    ])(`reversed domain ($name) [$min, $max] normalizes correctly`, ({ min, max }) => {
      const ticks = generate_arcsinh_ticks(min, max, 1, 8)
      const [lower, upper] = [Math.min(min, max), Math.max(min, max)]
      expect(ticks.every((tick) => tick >= lower && tick <= upper)).toBe(true)
      expect(ticks).toEqual(generate_arcsinh_ticks(lower, upper, 1, 8))
    })
  })

  describe(`type helpers`, () => {
    test.each([
      [`linear`, `linear`, false],
      [`log`, `log`, false],
      [`arcsinh`, `arcsinh`, false],
      [`time`, `time`, true],
      [undefined, `linear`, false],
      [{ type: `arcsinh`, threshold: 10 }, `arcsinh`, false],
    ])(`get_scale_type_name(%s) = %s`, (input, expected, expected_is_time) => {
      const scale_type = input as ScaleType | undefined
      expect(get_scale_type_name(scale_type)).toBe(expected)
      expect(is_time_scale(scale_type)).toBe(expected_is_time)
    })

    test.each([
      [`linear`, true],
      [`log`, true],
      [`arcsinh`, true],
      [`time`, true],
      [`foo`, false],
      [``, false],
      [`Linear`, false],
    ])(`is_scale_type_name(%s) = %s`, (input, expected) => {
      expect(is_scale_type_name(input)).toBe(expected)
    })

    test.each([
      [{ type: `arcsinh`, threshold: 42 }, 42],
      [{ type: `arcsinh` }, 1],
      [`arcsinh`, 1],
      [`linear`, 1],
      [undefined, 1],
    ])(`get_arcsinh_threshold(%s) = %s`, (input, expected) => {
      expect(get_arcsinh_threshold(input as ScaleType | undefined)).toBe(expected)
    })
  })

  describe(`resolve_color_scale with arcsinh`, () => {
    const color_fn = (color_scale: ColorScale, auto_range: Vec2) =>
      resolve_color_scale(color_scale, auto_range).color_fn

    test(`rejects bare interpolator names`, () => {
      expect(() => color_fn(`Viridis` as never, [0, 1])).toThrow(
        `Unknown D3 color interpolator: Viridis`,
      )
    })

    test(`returns one color when domain min equals max`, () => {
      const scale = color_fn(
        { type: `arcsinh`, scheme: `interpolateViridis`, value_range: [50, 50] },
        [0, 100], // auto_color_range is ignored when value_range is provided
      )
      expect(new Set([0, 50, 100].map((val) => scale(val))).size).toBe(1)
    })

    test(`maps extreme values to distinct hex colors and near-zero to the midpoint`, () => {
      const scale = color_fn({ type: { type: `arcsinh`, threshold: 1 } }, [-1e12, 1e12])
      const [high, low, tiny, zero] = [1e10, -1e10, 1e-10, 0].map((val) => scale(val))
      for (const color of [high, low, tiny]) expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(high).not.toBe(low)
      expect(tiny).toBe(zero) // 1e-10 is indistinguishable from 0 in arcsinh space
      // values around the threshold spread over distinct colors
      const spread = color_fn({ type: { type: `arcsinh`, threshold: 1 } }, [0, 1000])
      const colors = [0, 1, 10, 100, 1000].map((val) => spread(val))
      expect(new Set(colors).size).toBe(colors.length)
    })

    test.each([1e-10, 1e10, 0.001, 1000])(`handles threshold=%s`, (threshold) => {
      const scale = color_fn({ type: { type: `arcsinh`, threshold } }, [-100, 100])
      expect(scale(-100)).not.toBe(scale(100)) // boundaries differ
    })
  })

  // all-negative auto-range would otherwise produce an inverted [LOG_EPS, max<0] domain that
  // makes scaleSequentialLog return undefined for every value
  test.each([
    [[10, 1000], `all-positive`],
    [[-10, -1], `all-negative`],
    [[-5, 50], `mixed sign`],
  ] as [Vec2, string][])(`log color scale stays renderable over %j (%s)`, (values) => {
    const { color_fn } = resolve_color_scale({ type: `log` }, values)
    for (const val of [0, 1, Math.max(values[1], 1), 1e6])
      expect(color_fn(val)).toMatch(/^#[0-9a-f]{6}$/)
  })
})

test.each([`linear`, `log`, `arcsinh`] as const)(
  `clipped %s color scale matches legend endpoints, both ways round`,
  (type) => {
    const config = {
      scheme: `interpolateBlues`,
      palette_range: [0.3, 1] as Vec2,
      type,
    } as const
    const { color_fn: scale } = resolve_color_scale(config, [1, 100])
    const interpolate = color_interpolator(config)
    expect(scale(1)).toBe(interpolate(0))
    expect(scale(100)).toBe(interpolate(1))
    // out-of-range values clamp to the clipped ends instead of extrapolating past them
    expect([scale(0.5), scale(1e3)]).toEqual([interpolate(0), interpolate(1)])
    // a descending palette_range runs the scheme backwards
    const reversed = resolve_color_scale({ ...config, palette_range: [1, 0.3] }, [1, 100])
    expect([reversed.color_fn(1), reversed.color_fn(100)]).toEqual([
      interpolate(1),
      interpolate(0),
    ])
    // so does a descending value_range: its first end takes the palette start
    const descending = resolve_color_scale({ ...config, value_range: [100, 1] }, [0, 1])
    expect([descending.color_fn(100), descending.color_fn(1)]).toEqual([
      interpolate(0),
      interpolate(1),
    ])
    expect(descending.color_scale.value_range).toEqual([100, 1])
    // a degenerate range maps to the palette middle on every scale type
    const flat = resolve_color_scale({ ...config, value_range: [5, 5] }, [0, 1]).color_fn
    expect(flat(5)).toBe(interpolate(0.5))
    for (const palette_range of [
      [0.5, 0.5],
      [-0.1, 1],
      [0, 1.1],
    ] as Vec2[])
      expect(() => color_interpolator({ palette_range })).toThrow(`Invalid palette_range`)
  },
)

test.each<[ColorScale, Vec2]>([
  [`interpolateViridis`, [1, 9]],
  [{ value_range: [2, 5] }, [2, 5]],
  [{ value_range: [null, 5] }, [1, 5]],
  [{ value_range: [2, null] }, [2, 9]],
  [{ value_range: [null, null] }, [1, 9]],
  [{ value_range: [-2, 5] }, [-2, 5]],
  // log scales treat non-positive ends as unset: they have no log image
  [{ type: `log`, value_range: [0, 5] }, [1, 5]],
  [{ type: `log`, value_range: [5, -2] }, [5, 9]],
])(`resolve_value_range(%j) fills unset ends from the data`, (color_scale, expected) => {
  expect(resolve_value_range(color_scale, [1, 9])).toEqual(expected)
  // a thunk auto range is computed only when an end is unset
  const auto_range = vi.fn((): Vec2 => [1, 9])
  expect(resolve_value_range(color_scale, auto_range)).toEqual(expected)
  const fully_set =
    typeof color_scale === `object` &&
    color_scale.type !== `log` &&
    !color_scale.value_range?.includes(null)
  expect(auto_range).toHaveBeenCalledTimes(fully_set ? 0 : 1)
  // resolve_color_scale maps the resolved ends to the palette ends
  const { color_fn, color_scale: resolved } = resolve_color_scale(color_scale, [1, 9])
  expect(resolved.value_range).toEqual(expected)
  const interpolate = color_interpolator(color_scale)
  expect([color_fn(expected[0]), color_fn(expected[1])]).toEqual([
    interpolate(0),
    interpolate(1),
  ])
})

const red_ramp = (fraction: number) => `rgb(${Math.round(fraction * 255)}, 0, 0)`
test.each<[ColorScale, string | undefined, ColorScale]>([
  [`interpolateViridis`, `interpolateViridis`, `interpolatePlasma`],
  [{ type: `log` }, `interpolateViridis`, { type: `log`, scheme: `interpolatePlasma` }],
  [
    { scheme: `interpolateBlues`, value_range: [0, 1] },
    `interpolateBlues`,
    { scheme: `interpolatePlasma`, value_range: [0, 1] },
  ],
  [{ scheme: red_ramp }, undefined, { scheme: `interpolatePlasma` }],
])(`scheme_name(%j) = %s; with_scheme swaps in Plasma`, (color_scale, name, swapped) => {
  expect(scheme_name(color_scale)).toBe(name)
  expect(with_scheme(color_scale, `interpolatePlasma`)).toEqual(swapped)
})

test(`function schemes and bare names normalize to one config`, () => {
  expect(to_color_scale_config(`interpolateBlues`)).toEqual({ scheme: `interpolateBlues` })
  const interpolate = color_interpolator({ scheme: red_ramp, palette_range: [0.5, 1] })
  expect([interpolate(0), interpolate(1)]).toEqual([`rgb(128, 0, 0)`, `rgb(255, 0, 0)`])
})
