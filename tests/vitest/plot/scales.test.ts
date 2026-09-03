import type { Vec2 } from '$lib/math'
import * as math from '$lib/math'
import {
  accumulate_extent,
  collect_scale_values,
  collect_size_values,
  create_color_scale,
  create_scale,
  empty_extent,
  generate_arcsinh_ticks,
  generate_log_ticks,
  generate_ticks,
  create_size_scale,
  log_floor_scale,
  nice_range_from_extent,
  scale_arcsinh,
} from '$lib/plot/core/scales'
import type { TicksOption } from '$lib/plot/core/scales'
import type { ArcsinhScaleConfig, ScaleType } from '$lib/plot/core/types'
import {
  get_arcsinh_threshold,
  get_scale_type_name,
  is_scale_type_name,
  is_time_scale,
} from '$lib/plot/core/types'
import { scaleLinear, scaleLog, scaleTime } from 'd3-scale'
import { describe, expect, test } from 'vitest'

const sample_values = [1, 2, 3, 4, 5]
const nice_range = (
  values: number[],
  limits: [number | null, number | null],
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
    test.each([
      [`linear`, [0, 100], [0, 500]],
      [`log`, [1, 1000], [0, 300]],
      [`log`, [0.1, 100], [50, 350]],
      [`arcsinh`, [-100, 100], [0, 500]],
      [`arcsinh`, [0, 1000], [0, 300]],
    ])(`%s scale`, (scale_type, domain, range) => {
      const scale = create_scale(scale_type as ScaleType, domain as Vec2, range as Vec2)
      expect(scale.domain()).toEqual(
        scale_type === `log` ? [Math.max(domain[0], math.LOG_EPS), domain[1]] : domain,
      )
      expect(scale.range()).toEqual(range)
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

    test(`arcsinh scale with config object`, () => {
      const config: ArcsinhScaleConfig = { type: `arcsinh`, threshold: 10 }
      const scale = create_scale(config, [0, 100], [0, 500])
      expect(scale.domain()).toEqual([0, 100])
      expect(scale.range()).toEqual([0, 500])
    })
  })

  describe(`nice_range_from_extent`, () => {
    test.each([
      {
        values: sample_values,
        limits: [null, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: Vec2) => {
          expect(range[0]).toBeLessThan(1)
          expect(range[1]).toBeGreaterThan(5)
        },
      },
      {
        values: sample_values,
        limits: [0, 10],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: Vec2) => expect(range).toEqual([0, 10]),
      },
      {
        values: [1, 10, 100],
        limits: [null, null],
        scale_type: `log`,
        is_time: false,
        padding: 0.1,
        check: (range: Vec2) => {
          expect(range[0]).toBeLessThan(1)
          expect(range[1]).toBeGreaterThan(100)
        },
      },
      {
        values: [new Date(2023, 0, 1).getTime(), new Date(2023, 11, 1).getTime()],
        limits: [null, null],
        scale_type: `linear`,
        is_time: true,
        padding: 0.1,
        check: (range: Vec2) => {
          expect(range[0]).toBeLessThan(new Date(2023, 0, 1).getTime())
          expect(range[1]).toBeGreaterThan(new Date(2023, 11, 1).getTime())
        },
      },
      {
        values: [42],
        limits: [null, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.1,
        check: (range: Vec2) => {
          expect(range[0]).toBeLessThan(42)
          expect(range[1]).toBeGreaterThan(42)
        },
      },
      {
        values: [],
        limits: [null, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.1,
        check: (range: Vec2) => expect(range).toEqual([0, 1]),
      },
      {
        values: sample_values,
        limits: [null, 1000],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: Vec2) => {
          expect(range[0]).toBeLessThan(1)
          expect(range[1]).toBe(1000)
        },
      },
      {
        values: sample_values,
        limits: [0, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: Vec2) => {
          expect(range[0]).toBe(0)
          expect(range[1]).toBeGreaterThanOrEqual(5)
        },
      },
    ])(
      `nice range: $scale_type, $values.length values`,
      ({ values, limits, scale_type, is_time, padding, check }) => {
        const range = nice_range(
          values,
          limits as [number | null, number | null],
          scale_type as ScaleType,
          padding,
          is_time,
        )
        expect(range).toHaveLength(2)
        check(range)
      },
    )

    // a log axis given a non-positive bound (explicit negative min, all data <= 0) must still
    // come out ascending and strictly positive instead of the inverted [LOG_EPS, 0]
    test.each([
      { values: [0, 0], limits: [-5, null] as [number | null, number | null] },
      { values: [-3, -1], limits: [-2, 0] as [number | null, number | null] },
      { values: [-3, 1], limits: [-2, null] as [number | null, number | null] },
    ])(
      `log range stays positive and ascending for $values with limits $limits`,
      ({ values, limits }) => {
        const [lo, hi] = nice_range(values, limits, `log`, 0.05)
        expect(lo).toBeGreaterThan(0)
        expect(hi).toBeGreaterThan(lo)
      },
    )

    // an observed zero edge snaps to exactly 0 despite padding; an all-zero range still widens
    test.each([
      { xs: [0, 4.7], padding: 0.05, check: ([min, max]: Vec2) => min === 0 && max >= 4.7 },
      { xs: [-4.7, 0], padding: 0.05, check: ([min, max]: Vec2) => min <= -4.7 && max === 0 },
      { xs: [0], padding: 0, check: ([min, max]: Vec2) => min < 0 && max > 0 },
    ])(`snaps observed zero edges for x=$xs`, ({ xs, padding, check }) => {
      expect(check(nice_range(xs, [null, null], `linear`, padding))).toBe(true)
    })
  })

  describe(`accumulate_extent / nice_range_from_extent`, () => {
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
        expect(acc).toEqual({
          ...(finite_values.length > 0
            ? { min: Math.min(...finite_values), max: Math.max(...finite_values) }
            : {}),
          n_finite: finite_values.length,
        })
      }
      const acc = accumulate_extent(empty_extent(), [4, 8], 5)
      accumulate_extent(acc, [-1, 2])
      expect(acc).toEqual({ min: -1, max: 8, n_finite: 4 })

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
            ] as [number | null, number | null][]) {
              // limits are niced too (log clamps 0 to LOG_EPS), so only finiteness is fixed; a
              // log axis pinned below zero over non-positive data comes back as [LOG_EPS, 0]
              const [low, high] = nice_range(values, limits, scale_type, padding)
              expect(Number.isFinite(low) && Number.isFinite(high)).toBe(true)
            }
          }
        }
      }
    })
  })

  // A descending range is a supported axis mode. The log branch floored domain[0] and then
  // widened domain[1] against it, so [1000, 1] became [1000, 1000]: every value landed on one
  // pixel and invert returned the same number for every pixel, taking hover, tooltips and
  // rect-zoom on that axis with it. Linear axes always handled the direction correctly.
  test(`mirrors a log axis on a descending domain instead of collapsing it`, () => {
    const values = [1, 10, 100, 1000]
    const ascending = create_scale(`log`, [1, 1000], [0, 300])
    const descending = create_scale(`log`, [1000, 1], [0, 300])
    const px_of = (scale: (val: number) => number) => values.map((val) => scale(val))
    // decade-per-100px, to float dust: d3's log scale does not land exactly on 100
    for (const [idx, px] of px_of(ascending).entries()) expect(px).toBeCloseTo(idx * 100, 9)
    const mirrored = px_of(ascending).toReversed()
    for (const [idx, px] of px_of(descending).entries())
      expect(px).toBeCloseTo(mirrored[idx], 9)
    // invert has to stay live too: the geometric midpoint of the decade span sits mid-range
    expect(descending.invert(150)).toBeCloseTo(Math.sqrt(1000), 10)
  })

  // Same collapse in the size scale: an explicit descending value_range asks for the largest
  // value to draw the smallest marker, and used to give every value the smallest radius.
  test(`inverts the radius encoding on a descending log value_range`, () => {
    const radii = (value_range: Vec2) =>
      [1, 10, 100].map(
        create_size_scale({ type: `log`, value_range, radius_range: [2, 10] }, []),
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
        [],
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

  describe(`collect_scale_values / collect_size_values`, () => {
    test.each([
      [`plain arrays`, [{ size_values: [1, 2, 3] }, { size_values: [4] }], [1, 2, 3, 4]],
      [`skips null/NaN/Infinity`, [{ size_values: [1, null, NaN, Infinity, 5] }], [1, 5]],
      [`typed arrays`, [{ size_values: new Float32Array([2, 8]) }], [2, 8]],
      [`null series and missing sizes`, [null, undefined, {}, { size_values: null }], []],
    ])(`%s`, (_desc, series, expected) => {
      expect(collect_size_values(series)).toEqual(expected)
      // the size-only pass matches the combined colour+size pass
      expect(collect_scale_values(series).size_values).toEqual(expected)
    })

    test(`colour extent ignores nulls and non-finite values`, () => {
      const { color_extent, color_range } = collect_scale_values([
        { color_values: [3, null, NaN, 9] },
        null,
        { color_values: new Float64Array([-1, Infinity]) },
      ])
      expect(color_extent).toEqual({ min: -1, max: 9, n_finite: 3 })
      expect(color_range).toEqual([-1, 9])
      expect(collect_scale_values([{}]).color_range).toEqual([0, 1])
    })
  })

  describe(`generate_log_ticks`, () => {
    test.each([
      { min: 0.1, max: 1000, ticks: 5, expected: [0.1, 1, 10, 100, 1000] },
      // under three decades with a generous count: 1-2-5 mantissas
      { min: 1, max: 10, ticks: 8, expected: [1, 2, 5, 10] },
      { min: 0.5, max: 5, ticks: 10, expected: [0.5, 1, 2, 5] },
      { min: 50, max: 500, ticks: 6, expected: [50, 100, 200, 500] },
      { min: 1, max: 50, ticks: 8, expected: [1, 2, 5, 10, 20, 50] },
      // same span, small count: powers of ten only
      { min: 1, max: 50, ticks: 5, expected: [1, 10] },
      // sub-decade domains fall back to d3 mantissa ticks inside the domain
      { min: 2, max: 8, ticks: 5, expected: [2, 3, 4, 5, 6, 7, 8] },
      { min: 0.2, max: 0.8, ticks: 5, expected: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
      { min: 1.5, max: 1.6, ticks: 5, expected: [1.5, 1.52, 1.54, 1.56, 1.58, 1.6] },
      // narrow domains straddling a power of ten must not emit ticks past max
      {
        min: 0.92,
        max: 0.99,
        ticks: 5,
        expected: [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99],
      },
      // a generous count on a domain holding fewer than two 1-2-5 mantissas must still
      // produce ticks (the mantissa list alone was [] for [0.92, 0.99] and [7, 8], [2] for [2, 3])
      {
        min: 0.92,
        max: 0.99,
        ticks: 8,
        expected: [0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99],
      },
      {
        min: 7,
        max: 8,
        ticks: 8,
        expected: [7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8],
      },
      {
        min: 2,
        max: 3,
        ticks: 8,
        expected: [2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3],
      },
      // non-positive bounds clamp to LOG_EPS before the power scan
      {
        min: -10,
        max: 100,
        ticks: 5,
        expected: [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 1, 10, 100],
      },
      {
        min: 1e-12,
        max: 1,
        ticks: 5,
        expected: [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 0.01, 0.1, 1],
      },
    ])(`log ticks: $min to $max (ticks=$ticks)`, ({ min, max, ticks, expected }) => {
      const result = generate_log_ticks(min, max, ticks)
      expect(result).toHaveLength(expected.length)
      result.forEach((tick, idx) => expect(tick).toBeCloseTo(expected[idx], 12))
    })

    test(`explicit tick arrays pass through untouched`, () => {
      expect(generate_log_ticks(1, 1000, [1, 2, 3])).toEqual([1, 2, 3])
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
    test(`array input - uses provided array directly`, () => {
      const domain: Vec2 = [0, 100]
      const scale = scaleLinear().domain(domain).range([0, 500])
      const custom_ticks = [10, 30, 50, 70, 90]
      expect(generate_ticks(domain, `linear`, custom_ticks, scale)).toEqual(custom_ticks)
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

    test.each([
      // count request: d3 picks a nice interval, here monthly over 2.5 months
      {
        ticks: 5,
        start: [2023, 0, 1],
        end: [2023, 2, 15],
        expected: [
          [2023, 0, 1],
          [2023, 1, 1],
          [2023, 2, 1],
        ],
      },
      {
        ticks: `month`,
        start: [2023, 0, 15],
        end: [2023, 5, 10],
        expected: [
          [2023, 1, 1],
          [2023, 2, 1],
          [2023, 3, 1],
          [2023, 4, 1],
          [2023, 5, 1],
        ],
      },
      {
        ticks: `year`,
        start: [2020, 5, 15],
        end: [2025, 2, 10],
        expected: [
          [2021, 0, 1],
          [2022, 0, 1],
          [2023, 0, 1],
          [2024, 0, 1],
          [2025, 0, 1],
        ],
      },
      {
        ticks: `day`,
        start: [2023, 0, 30],
        end: [2023, 1, 3],
        expected: [
          [2023, 0, 30],
          [2023, 0, 31],
          [2023, 1, 1],
          [2023, 1, 2],
          [2023, 1, 3],
        ],
      },
      // negative number: interval in days
      {
        ticks: -7,
        start: [2023, 0, 1],
        end: [2023, 0, 29],
        expected: [
          [2023, 0, 1],
          [2023, 0, 8],
          [2023, 0, 15],
          [2023, 0, 22],
          [2023, 0, 29],
        ],
      },
      // reversed domain: the interval count must come from the sorted span, not domain[1]-domain[0]
      {
        ticks: -7,
        start: [2023, 0, 29],
        end: [2023, 0, 1],
        expected: [
          [2023, 0, 1],
          [2023, 0, 8],
          [2023, 0, 15],
          [2023, 0, 22],
          [2023, 0, 29],
        ],
      },
    ])(`time ticks for ticks=$ticks from $start`, ({ ticks, start, end, expected }) => {
      const domain: Vec2 = [
        new Date(...(start as [number, number, number])).getTime(),
        new Date(...(end as [number, number, number])).getTime(),
      ]
      const scale = scaleTime()
        .domain([new Date(domain[0]), new Date(domain[1])])
        .range([0, 500])
      const result = generate_ticks(domain, `time`, ticks, scale)
      expect(result.map((tick) => new Date(tick))).toEqual(
        expected.map((parts) => new Date(...(parts as [number, number, number]))),
      )
    })

    // Ticks are rounded to 12 places so 0.6000000000000001 from interval stepping compares as 0.6
    test.each<[string, Vec2, ScaleType, number | undefined, number | undefined, number[]]>([
      [`log powers of 10`, [1, 1000], `log`, 5, undefined, [1, 10, 100, 1000]],
      [
        `negative count is a fixed interval`,
        [0, 100],
        `linear`,
        -10,
        undefined,
        [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      ],
      [`fractional interval`, [0, 1], `linear`, -0.2, undefined, [0, 0.2, 0.4, 0.6, 0.8, 1]],
      // reversed (descending) domains are first-class: an interval must still emit ticks
      [
        `interval on a descending domain`,
        [10, 0],
        `linear`,
        -2,
        undefined,
        [0, 2, 4, 6, 8, 10],
      ],
      [
        `explicit count wins over default_count`,
        [0, 100],
        `linear`,
        5,
        2,
        [0, 20, 40, 60, 80, 100],
      ],
      [
        `default_count applies without a ticks option`,
        [0, 100],
        `linear`,
        undefined,
        2,
        [0, 50, 100],
      ],
      [`linear count`, [0, 50], `linear`, 6, undefined, [0, 10, 20, 30, 40, 50]],
      [`degenerate linear domain`, [0, 0], `linear`, 5, undefined, [0]],
      [
        `arcsinh mixed range is symmetric around 0`,
        [-1000, 1000],
        `arcsinh`,
        10,
        undefined,
        [-1000, -100, -10, -1, 0, 1, 10, 100, 1000],
      ],
    ])(`%s`, (_name, domain, type, ticks, default_count, expected) => {
      const range: Vec2 = [0, 500]
      const scale =
        type === `log`
          ? scaleLog().domain(domain).range(range)
          : type === `arcsinh`
            ? scale_arcsinh(1).domain(domain).range(range)
            : scaleLinear().domain(domain).range(range)
      const opts = default_count === undefined ? undefined : { default_count }
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
    test.each([
      {
        domain: [0, 100] as Vec2,
        checks: [
          [0, 0],
          [100, 100],
          [50, `between`],
        ] as const,
      },
      {
        domain: [-100, 100] as Vec2,
        checks: [
          [-100, 0],
          [0, 50],
          [100, 100],
        ] as const,
      },
    ])(`forward transform (domain=$domain)`, ({ domain, checks }) => {
      const scale = scale_arcsinh(1).domain(domain).range([0, 100])
      checks.forEach(([input, expected]) => {
        if (expected === `between`) {
          expect(scale(input)).toBeGreaterThan(0)
          expect(scale(input)).toBeLessThan(100)
        } else {
          expect(scale(input)).toBe(expected)
        }
      })
    })

    test.each([
      { threshold: 1, domain: [0, 100] as Vec2, values: [0, 1, 10, 50, 100] },
      {
        threshold: 1,
        domain: [-100, 100] as Vec2,
        values: [-100, -10, -1, 0, 1, 10, 100],
      },
      { threshold: 10, domain: [0, 1000] as Vec2, values: [0, 10, 100, 500, 1000] },
    ])(
      `inverse transform (threshold=$threshold, domain=$domain)`,
      ({ threshold, domain, values }) => {
        const scale = scale_arcsinh(threshold).domain(domain).range([0, 500])
        values.forEach((val) => {
          const back = scale.invert(scale(val))
          expect(back).toBeCloseTo(val, 8)
        })
      },
    )

    test(`threshold parameter affects transition`, () => {
      const scale_thresh_1 = scale_arcsinh(1).domain([0, 1000]).range([0, 100])
      const scale_thresh_100 = scale_arcsinh(100).domain([0, 1000]).range([0, 100])

      // At x=10 with threshold=1, we're in the log region (10 >> 1) → higher relative position
      // At x=10 with threshold=100, we're in the linear region (10 << 100) → lower relative position
      const pos_1 = scale_thresh_1(10)
      const pos_100 = scale_thresh_100(10)

      // Smaller threshold puts x=10 deeper into log territory → higher screen position
      expect(pos_1).toBeGreaterThan(pos_100)
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
    test.each<[string, number, number, number, number, number[]]>([
      [
        `positive range: decades plus 2x/5x fill to reach count`,
        0,
        1000,
        1,
        10,
        [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
      ],
      [
        `negative range mirrors the positive path`,
        -1000,
        0,
        1,
        10,
        [-1000, -500, -200, -100, -50, -20, -10, -5, -2, -1],
      ],
      [`range within 2x threshold is spaced linearly`, 0, 1, 1, 5, [0, 0.2, 0.4, 0.6, 0.8, 1]],
      [
        `large threshold keeps the whole range linear`,
        0,
        100,
        100,
        8,
        [0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100],
      ],
    ])(`%s`, (_name, min, max, threshold, count, expected) => {
      const ticks = generate_arcsinh_ticks(min, max, threshold, count)
      expect(ticks.map((tick) => Number(tick.toFixed(12)))).toEqual(expected)
    })

    test(`emits clean round ticks for non-round domain (no raw endpoints)`, () => {
      // Regression: raw domain extremes used to be added as ticks, rendering as long
      // unrounded labels like 1325.8239811994677. Only clean powers of 10 / 2x/5x should show.
      const min = -1515.343730040983
      const max = 1325.8239811994677
      const ticks = generate_arcsinh_ticks(min, max, 10, 10)
      expect(ticks).not.toContain(min)
      expect(ticks).not.toContain(max)
      // no tick renders as a long unrounded float
      for (const tick of ticks) expect(`${tick}`.length).toBeLessThanOrEqual(6)
      // still covers the range with powers of 10 on both sides of zero
      expect(ticks.some((tick) => tick >= 1000)).toBe(true)
      expect(ticks.some((tick) => tick <= -1000)).toBe(true)
    })

    test(`small tick count snaps boundary to a clean power of 10`, () => {
      // count<=3 mixed range previously pushed the raw extreme (e.g. -1500) as a tick
      const ticks = generate_arcsinh_ticks(-1500, 1300, 10, 2)
      expect(ticks).not.toContain(-1500)
      expect(ticks).toContain(0)
      expect(ticks).toContain(-1000) // larger-magnitude boundary snapped to nearest power of 10
    })

    test(`range starting at exactly zero uses positive path`, () => {
      // When min=0, should use positive tick generation (not mixed with half_count)
      const ticks_from_zero = generate_arcsinh_ticks(0, 1000, 1, 10)
      const ticks_from_positive = generate_arcsinh_ticks(1, 1000, 1, 10)
      expect(ticks_from_zero.length).toBeGreaterThanOrEqual(ticks_from_positive.length - 1)
      expect(ticks_from_zero.every((tick) => tick >= 0)).toBe(true)
      expect(ticks_from_zero[0]).toBeLessThanOrEqual(1)
    })

    test(`omits sub-threshold powers that would overlap the zero tick`, () => {
      // Regression: threshold=10 over a wide mixed range used to emit ±1 (a decade below the
      // threshold). In arcsinh space those sit almost on 0, so the −1/0/1 labels overlapped.
      const ticks = generate_arcsinh_ticks(-1000, 1000, 10, 10)
      expect(ticks).toContain(0)
      expect(ticks).not.toContain(1)
      expect(ticks).not.toContain(-1)
      // smallest non-zero tick magnitude is at least the threshold
      const min_nonzero = Math.min(...ticks.filter((tick) => tick !== 0).map(Math.abs))
      expect(min_nonzero).toBeGreaterThanOrEqual(10)
    })

    test(`respects small count, keeping the spread-out outermost ticks`, () => {
      // Regression: a low-count colorbar over a wide mixed range used to ignore count and emit
      // every decade, crowding −1/0/1 near the center. Now it keeps the outermost decades on each
      // side around zero (count=4 -> ~5 ticks), dropping the near-zero ones.
      const ticks = generate_arcsinh_ticks(-100, 100, 1, 4)
      expect(ticks).toEqual([-100, -10, 0, 10, 100])
    })

    test.each([
      { min: 1000, max: -100, name: `mixed` }, // reversed mixed (tests equality with normal)
      { min: 100, max: 0, name: `positive` }, // reversed positive
      { min: 0, max: -100, name: `negative` }, // reversed negative
      { min: 500, max: -500, name: `symmetric` }, // reversed symmetric
    ])(`reversed domain ($name) [$min, $max] normalizes correctly`, ({ min, max }) => {
      const ticks = generate_arcsinh_ticks(min, max, 1, 8)
      const [lo, hi] = [Math.min(min, max), Math.max(min, max)]
      // All ticks within normalized range
      expect(ticks.every((tick) => tick >= lo && tick <= hi)).toBe(true)
      // Reversed should equal normal order
      expect(ticks).toEqual(generate_arcsinh_ticks(lo, hi, 1, 8))
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

  describe(`create_color_scale with arcsinh`, () => {
    test(`rejects bare interpolator names`, () => {
      expect(() => create_color_scale(`Viridis` as never, [0, 1])).toThrow(
        `Unknown D3 color interpolator: Viridis`,
      )
    })

    test(`returns middle color when domain min equals max`, () => {
      const scale = create_color_scale(
        { type: `arcsinh`, scheme: `interpolateViridis`, value_range: [50, 50] },
        [0, 100], // auto_color_range is ignored when value_range is provided
      )
      // All values should map to middle of color scale (0.5)
      const color_at_min = scale(0)
      const color_at_mid = scale(50)
      const color_at_max = scale(100)
      expect(color_at_min).toBe(color_at_mid)
      expect(color_at_mid).toBe(color_at_max)
    })

    test(`maps extreme values to distinct hex colors and near-zero to the midpoint`, () => {
      const scale = create_color_scale(
        { type: { type: `arcsinh`, threshold: 1 } },
        [-1e12, 1e12],
      )
      const [high, low, tiny, zero] = [1e10, -1e10, 1e-10, 0].map((val) => scale(val))
      for (const color of [high, low, tiny]) expect(color).toMatch(/^#[0-9a-f]{6}$/)
      expect(high).not.toBe(low)
      expect(tiny).toBe(zero) // 1e-10 is indistinguishable from 0 in arcsinh space
    })

    test.each([1e-10, 1e10, 0.001, 1000])(`handles threshold=%s`, (threshold) => {
      const scale = create_color_scale({ type: { type: `arcsinh`, threshold } }, [-100, 100])
      expect(scale(-100)).not.toBe(scale(100)) // boundaries differ
    })

    test(`color scale domain method returns correct values`, () => {
      const config: ArcsinhScaleConfig = { type: `arcsinh`, threshold: 5 }
      const scale = create_color_scale(config, [-50, 150])
      expect(scale.domain()).toEqual([-50, 150])
    })

    test(`domain setter returns same scale instance (D3-style mutation)`, () => {
      const scale = create_color_scale({ type: `arcsinh` }, [0, 1])
      const color_before = scale(0.5)
      const returned_scale = scale.domain([0, 100])
      // Should return the same scale instance for chaining
      expect(returned_scale).toBe(scale)
      // Domain should be updated in place
      expect(scale.domain()).toEqual([0, 100])
      // Behavior should change after domain mutation
      const color_after = scale(50)
      expect(color_before).not.toBe(color_after)
    })

    test(`arcsinh color scale produces smooth gradient`, () => {
      const config: ArcsinhScaleConfig = { type: `arcsinh`, threshold: 1 }
      const scale = create_color_scale(config, [0, 1000])
      // Values near threshold should be distinguishable
      const colors = [0, 1, 10, 100, 1000].map((val) => scale(val))
      // All colors should be unique for these spread-out values
      const unique_colors = new Set(colors)
      expect(unique_colors.size).toBe(colors.length)
    })
  })

  describe(`create_color_scale with log`, () => {
    // all-negative auto-range would otherwise produce an inverted [LOG_EPS, max<0] domain that
    // makes scaleSequentialLog return undefined for every value
    test.each([
      { values: [10, 1000] as Vec2, desc: `all-positive` },
      { values: [-10, -1] as Vec2, desc: `all-negative` },
      { values: [-5, 50] as Vec2, desc: `mixed sign` },
    ])(`clamps log domain to a non-inverted positive range ($desc)`, ({ values }) => {
      const scale = create_color_scale({ type: `log`, scheme: `interpolateViridis` }, values)
      const domain = scale.domain()
      const [d_min, d_max] = [domain[0], domain[domain.length - 1]]
      expect(d_min).toBeGreaterThan(0)
      expect(d_min).toBeLessThan(d_max) // never inverted or degenerate
      // a positive in-range value still maps to a real color string (not undefined)
      expect(typeof scale(Math.max(values[1], 1))).toBe(`string`)
    })
  })
})
