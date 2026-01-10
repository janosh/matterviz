import type { Vec2 } from '$lib/math'
import * as math from '$lib/math'
import {
  calculate_domain,
  create_color_scale,
  create_scale,
  create_time_scale,
  generate_arcsinh_ticks,
  generate_log_ticks,
  generate_ticks,
  get_nice_data_range,
  scale_arcsinh,
} from '$lib/plot/scales'
import type { ArcsinhScaleConfig, ScaleType } from '$lib/plot/types'
import { get_arcsinh_threshold, get_scale_type_name } from '$lib/plot/types'
import { scaleLinear, scaleLog, scaleTime } from 'd3-scale'
import { describe, expect, test } from 'vitest'

const sample_points = [
  { x: 1, y: 10 },
  { x: 2, y: 20 },
  { x: 3, y: 30 },
  { x: 4, y: 40 },
  { x: 5, y: 50 },
]

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
      expect(scale).toBeDefined()
      expect(scale.domain()).toEqual(
        scale_type === `log` ? [Math.max(domain[0], math.LOG_EPS), domain[1]] : domain,
      )
      expect(scale.range()).toEqual(range)
    })

    test(`log scale with negative domain`, () => {
      const scale = create_scale(`log`, [-5, 100], [0, 500])
      expect(scale.domain()).toEqual([math.LOG_EPS, 100])
    })

    test(`arcsinh scale with config object`, () => {
      const config: ArcsinhScaleConfig = { type: `arcsinh`, threshold: 10 }
      const scale = create_scale(config, [0, 100], [0, 500])
      expect(scale).toBeDefined()
      expect(scale.domain()).toEqual([0, 100])
      expect(scale.range()).toEqual([0, 500])
    })
  })

  describe(`create_time_scale`, () => {
    test(`creates time scale`, () => {
      const [t1, t2] = [new Date(2023, 0, 1).getTime(), new Date(2023, 11, 31).getTime()]
      const scale = create_time_scale([t1, t2], [0, 500])
      expect(scale.domain()).toEqual([new Date(t1), new Date(t2)])
      expect(scale.range()).toEqual([0, 500])
    })
  })

  describe(`calculate_domain`, () => {
    test.each([
      [[1, 2, 3, 4, 5], `linear`, [1, 5]],
      [[10, 100, 1000], `log`, [10, 1000]],
      [[0.001, 0.1, 1], `log`, [0.001, 1]],
      [[-5, 0, 5], `log`, [math.LOG_EPS, 5]],
      [[], `linear`, [0, 1]],
      [[42], `linear`, [42, 42]],
    ])(`%s %s scale`, (values, scale_type, expected) => {
      const domain = calculate_domain(values, scale_type as ScaleType)
      if (scale_type === `log` && expected[0] === math.LOG_EPS) {
        expect(domain).toEqual([math.LOG_EPS, expected[1]])
      } else {
        expect(domain).toEqual(expected)
      }
    })
  })

  describe(`get_nice_data_range`, () => {
    test.each([
      {
        points: sample_points,
        limits: [null, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: [number, number]) => {
          expect(range[0]).toBeLessThan(1)
          expect(range[1]).toBeGreaterThan(5)
        },
      },
      {
        points: sample_points,
        limits: [0, 10],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: [number, number]) => expect(range).toEqual([0, 10]),
      },
      {
        points: [{ x: 1, y: 10 }, { x: 10, y: 20 }, { x: 100, y: 30 }],
        limits: [null, null],
        scale_type: `log`,
        is_time: false,
        padding: 0.1,
        check: (range: [number, number]) => {
          expect(range[0]).toBeLessThan(1)
          expect(range[1]).toBeGreaterThan(100)
        },
      },
      {
        points: [{ x: new Date(2023, 0, 1).getTime(), y: 10 }, {
          x: new Date(2023, 11, 1).getTime(),
          y: 30,
        }],
        limits: [null, null],
        scale_type: `linear`,
        is_time: true,
        padding: 0.1,
        check: (range: [number, number]) => {
          expect(range[0]).toBeLessThan(new Date(2023, 0, 1).getTime())
          expect(range[1]).toBeGreaterThan(new Date(2023, 11, 1).getTime())
        },
      },
      {
        points: [{ x: 42, y: 100 }],
        limits: [null, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.1,
        check: (range: [number, number]) => {
          expect(range[0]).toBeLessThan(42)
          expect(range[1]).toBeGreaterThan(42)
        },
      },
      {
        points: [],
        limits: [null, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.1,
        check: (range: [number, number]) => expect(range).toEqual([0, 1]),
      },
      {
        points: sample_points,
        limits: [null, 1000],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: [number, number]) => {
          expect(range[0]).toBeLessThan(1)
          expect(range[1]).toBe(1000)
        },
      },
      {
        points: sample_points,
        limits: [0, null],
        scale_type: `linear`,
        is_time: false,
        padding: 0.05,
        check: (range: [number, number]) => {
          expect(range[0]).toBe(0)
          expect(range[1]).toBeGreaterThanOrEqual(5)
        },
      },
    ])(
      `nice range: $scale_type, $points.length points`,
      ({ points, limits, scale_type, is_time, padding, check }) => {
        const range = get_nice_data_range(
          points,
          (p) => p.x,
          limits as [number | null, number | null],
          scale_type as ScaleType,
          padding,
          is_time,
        )
        expect(range).toHaveLength(2)
        check(range)
      },
    )
  })

  describe(`generate_log_ticks`, () => {
    test.each([
      { min: 0.1, max: 1000, ticks: 5, contains: [0.1, 1, 10, 100, 1000] },
      { min: 1, max: 10, ticks: 8, contains: [1, 2, 5, 10] },
      { min: 1e-12, max: 1, ticks: 5, contains: [math.LOG_EPS, 1e-6, 1e-3, 1] },
      { min: 0.5, max: 5, ticks: 10, contains: [0.5, 1, 2, 5] },
      { min: 50, max: 500, ticks: 6, contains: [50, 100, 200, 500] },
    ])(`log ticks: $min to $max`, ({ min, max, ticks, contains }) => {
      const result = generate_log_ticks(min, max, ticks)
      expect(result.length).toBeGreaterThan(0)
      contains.forEach((val) => expect(result).toContain(val))
      // Log ticks may extend beyond the range for better tick placement
      expect(result.some((t) => t >= min && t <= max)).toBe(true)
    })

    test.each([[100], [1], [0.001]])(
      `single value domain %s includes that value`,
      (value) => {
        const result = generate_log_ticks(value, value, 5)
        expect(result).toContain(value)
      },
    )

    test(`negative min clamped to LOG_EPS`, () => {
      const result = generate_log_ticks(-10, 100, 5)
      expect(result.every((t) => t >= math.LOG_EPS)).toBe(true)
    })
  })

  describe(`generate_ticks`, () => {
    test(`array input - uses provided array directly`, () => {
      const domain: [number, number] = [0, 100]
      const scale = scaleLinear().domain(domain).range([0, 500])
      const custom_ticks = [10, 30, 50, 70, 90]
      expect(generate_ticks(domain, `linear`, custom_ticks, scale)).toEqual(custom_ticks)
    })

    test.each([
      {
        name: `filters out-of-domain, sorts`,
        domain: [0, 100] as Vec2,
        ticks: { 50: `A`, 10: `B`, 150: `C`, 90: `D`, [-10]: `E`, 30: `F` } as Record<
          number,
          string
        >,
        expected: [10, 30, 50, 90],
      },
      {
        name: `filters non-finite values`,
        domain: [0, 100] as Vec2,
        ticks: { 25: `A`, 50: `B`, NaN: `C`, 75: `D`, [Infinity]: `E` } as Record<
          number,
          string
        >,
        expected: [25, 50, 75],
      },
      {
        name: `handles reversed domain`,
        domain: [100, 0] as Vec2,
        ticks: { 80: `A`, 20: `B`, 150: `C`, 50: `D` } as Record<number, string>,
        expected: [20, 50, 80],
      },
    ])(`object input - $name`, ({ domain, ticks, expected }) => {
      const scale = scaleLinear().domain(domain).range([0, 500])
      expect(generate_ticks(domain, `linear`, ticks, scale)).toEqual(expected)
    })

    test(`time-based ticks with % format`, () => {
      const start_time = new Date(2023, 0, 1).getTime()
      const end_time = new Date(2023, 2, 15).getTime()
      const domain: [number, number] = [start_time, end_time]
      const scale = scaleTime().domain([new Date(start_time), new Date(end_time)]).range([
        0,
        500,
      ])

      const result = generate_ticks(domain, `linear`, 5, scale, { format: `%Y-%m-%d` })
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((tick) => typeof tick === `number`)).toBe(true)
      expect(result.some((tick) => tick >= start_time && tick <= end_time)).toBe(true)
    })

    test(`logarithmic ticks`, () => {
      const domain: [number, number] = [1, 1000]
      const scale = scaleLog().domain(domain).range([0, 500])

      const result = generate_ticks(domain, `log`, 5, scale)
      expect(result.length).toBeGreaterThan(0)
      expect(result).toContain(1)
      expect(result).toContain(10)
      expect(result).toContain(100)
      expect(result).toContain(1000)
    })

    test(`interval ticks - negative number indicates interval`, () => {
      const domain: [number, number] = [0, 100]
      const scale = scaleLinear().domain(domain).range([0, 500])

      const result = generate_ticks(domain, `linear`, -10, scale) // interval of 10
      expect(result.length).toBeGreaterThan(0)
      expect(result).toContain(0)
      expect(result).toContain(10)
      expect(result).toContain(20)
      expect(result).toContain(30)
      // Check that ticks are spaced by the interval
      for (let idx = 1; idx < result.length; idx++) {
        expect(result[idx] - result[idx - 1]).toBe(10)
      }
    })

    test.each([
      { domain: [0, 100] as Vec2, tick_count: 5, opts: { default_count: 8 } },
      { domain: [0, 50] as Vec2, tick_count: 6, opts: {} },
      { domain: [0, 0] as Vec2, tick_count: 5, opts: {} },
    ])(`linear ticks for domain $domain`, ({ domain, tick_count, opts }) => {
      const scale = scaleLinear().domain(domain).range([0, 500])
      const result = generate_ticks(domain, `linear`, tick_count, scale, opts)
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((tick) => typeof tick === `number`)).toBe(true)
    })

    test(`handles very small intervals`, () => {
      const domain: [number, number] = [0, 1]
      const scale = scaleLinear().domain(domain).range([0, 500])

      const result = generate_ticks(domain, `linear`, -0.2, scale) // interval of 0.2
      expect(result.length).toBeGreaterThan(0)
      expect(result).toContain(0)
      expect(result).toContain(0.2)
      expect(result).toContain(0.4)
      // Use approximate equality for floating point numbers
      expect(result.some((tick) => Math.abs(tick - 0.6) < 1e-10)).toBe(true)
      expect(result).toContain(0.8)
      expect(result).toContain(1)
    })

    test.each([
      {
        interval: `month` as const,
        start: [2022, 0, 1],
        end: [2024, 11, 31],
        check: (d: Date) => d.getDate() === 1,
      },
      {
        interval: `year` as const,
        start: [2020, 5, 15],
        end: [2025, 2, 10],
        check: (d: Date) => d.getMonth() === 0 && d.getDate() === 1,
      },
    ])(`time intervals - $interval filtering`, ({ interval, start, end, check }) => {
      const start_time = new Date(start[0], start[1], start[2]).getTime()
      const end_time = new Date(end[0], end[1], end[2]).getTime()
      const domain: [number, number] = [start_time, end_time]
      const scale = scaleTime().domain([new Date(start_time), new Date(end_time)]).range([
        0,
        500,
      ])

      const result = generate_ticks(domain, `linear`, interval, scale, {
        format: `%Y-%m-%d`,
      })
      expect(result.length).toBeGreaterThan(0)
      result.forEach((tick) => expect(check(new Date(tick))).toBe(true))
    })

    test(`arcsinh ticks`, () => {
      const domain: [number, number] = [-1000, 1000]
      const scale = scale_arcsinh(1).domain(domain).range([0, 500])

      const result = generate_ticks(domain, `arcsinh`, 10, scale)
      expect(result.length).toBeGreaterThan(0)
      expect(result).toContain(0)
      expect(result.filter((t) => t > 0).length).toBeGreaterThan(0)
      expect(result.filter((t) => t < 0).length).toBeGreaterThan(0)
    })
  })

  describe(`scale_arcsinh`, () => {
    test.each([
      {
        domain: [0, 100] as Vec2,
        checks: [[0, 0], [100, 100], [50, `between`]] as const,
      },
      { domain: [-100, 100] as Vec2, checks: [[-100, 0], [0, 50], [100, 100]] as const },
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

    test(`copy creates independent scale`, () => {
      const original = scale_arcsinh(1).domain([0, 100]).range([0, 500])
      const copy = original.copy()

      // Modify copy
      copy.domain([0, 200])

      // Original should be unchanged
      expect(original.domain()).toEqual([0, 100])
      expect(copy.domain()).toEqual([0, 200])
    })

    test(`ticks method`, () => {
      const scale = scale_arcsinh(1).domain([-100, 100]).range([0, 500])
      const ticks = scale.ticks(10)

      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks).toContain(0)
      expect(ticks.every((t) => t >= -100 && t <= 100)).toBe(true)
    })

    test.each([
      [0, `arcsinh threshold must be a positive finite number, got 0`],
      [-1, `arcsinh threshold must be a positive finite number, got -1`],
      [-0.001, `arcsinh threshold must be a positive finite number, got -0.001`],
      [NaN, `arcsinh threshold must be a positive finite number, got NaN`],
      [Infinity, `arcsinh threshold must be a positive finite number, got Infinity`],
      [-Infinity, `arcsinh threshold must be a positive finite number, got -Infinity`],
    ])(`throws for invalid threshold %s`, (threshold, error_msg) => {
      expect(() => scale_arcsinh(threshold)).toThrow(error_msg)
    })
  })

  describe(`generate_arcsinh_ticks`, () => {
    test.each([
      { min: 0, max: 1000, threshold: 1, count: 10, name: `positive range` },
      { min: -1000, max: 0, threshold: 1, count: 10, name: `negative range` },
      { min: 0, max: 1, threshold: 1, count: 5, name: `small range (linear-like)` },
      { min: 0, max: 100, threshold: 100, count: 8, name: `large threshold` },
    ])(`$name: [$min, $max]`, ({ min, max, threshold, count }) => {
      const ticks = generate_arcsinh_ticks(min, max, threshold, count)
      expect(ticks.length).toBeGreaterThan(0)
      expect(ticks.every((t) => t >= min && t <= max)).toBe(true)
    })

    test(`positive range includes powers of 10`, () => {
      const ticks = generate_arcsinh_ticks(0, 1000, 1, 10)
      expect(ticks.some((t) => t === 1 || t === 10 || t === 100 || t === 1000)).toBe(true)
    })

    test(`range starting at exactly zero uses positive path`, () => {
      // When min=0, should use positive tick generation (not mixed with half_count)
      const ticks_from_zero = generate_arcsinh_ticks(0, 1000, 1, 10)
      const ticks_from_positive = generate_arcsinh_ticks(1, 1000, 1, 10)
      expect(ticks_from_zero.length).toBeGreaterThanOrEqual(
        ticks_from_positive.length - 1,
      )
      expect(ticks_from_zero.every((t) => t >= 0)).toBe(true)
      expect(ticks_from_zero[0]).toBeLessThanOrEqual(1)
    })

    test(`mixed range includes zero with symmetric ticks`, () => {
      const ticks = generate_arcsinh_ticks(-100, 100, 1, 10)
      expect(ticks).toContain(0)
      expect(ticks.filter((t) => t > 0).length).toBeGreaterThan(0)
      expect(ticks.filter((t) => t < 0).length).toBeGreaterThan(0)
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
      expect(ticks.every((t) => t >= lo && t <= hi)).toBe(true)
      // Reversed should equal normal order
      expect(ticks).toEqual(generate_arcsinh_ticks(lo, hi, 1, 8))
    })
  })

  describe(`type helpers`, () => {
    test.each([
      [`linear`, `linear`],
      [`log`, `log`],
      [`arcsinh`, `arcsinh`],
      [undefined, `linear`],
      [{ type: `arcsinh`, threshold: 10 } as ArcsinhScaleConfig, `arcsinh`],
    ])(`get_scale_type_name(%s) = %s`, (input, expected) => {
      expect(get_scale_type_name(input as ScaleType | undefined)).toBe(expected)
    })

    test.each([
      [{ type: `arcsinh`, threshold: 42 } as ArcsinhScaleConfig, 42],
      [{ type: `arcsinh` } as ArcsinhScaleConfig, 1],
      [`arcsinh`, 1],
      [`linear`, 1],
      [undefined, 1],
    ])(`get_arcsinh_threshold(%s) = %s`, (input, expected) => {
      expect(get_arcsinh_threshold(input as ScaleType | undefined)).toBe(expected)
    })

    test.each([
      [0, `arcsinh threshold must be a positive finite number, got 0`],
      [-1, `arcsinh threshold must be a positive finite number, got -1`],
      [-0.5, `arcsinh threshold must be a positive finite number, got -0.5`],
      [NaN, `arcsinh threshold must be a positive finite number, got NaN`],
      [Infinity, `arcsinh threshold must be a positive finite number, got Infinity`],
      [-Infinity, `arcsinh threshold must be a positive finite number, got -Infinity`],
    ])(
      `get_arcsinh_threshold throws for invalid threshold %s`,
      (threshold, error_msg) => {
        expect(() =>
          get_arcsinh_threshold({ type: `arcsinh`, threshold } as ArcsinhScaleConfig)
        ).toThrow(error_msg)
      },
    )
  })

  describe(`scale_arcsinh identical domain edge cases`, () => {
    test(`degenerate domain (d_min === d_max) returns midpoints`, () => {
      const scale = scale_arcsinh(1).domain([50, 50]).range([0, 100])
      // Forward: any input → midpoint of range
      for (const val of [0, 50, 100, -100]) expect(scale(val)).toBe(50)
      // Invert: any input → midpoint of domain
      const scale2 = scale_arcsinh(1).domain([42, 42]).range([0, 100])
      for (const val of [0, 50, 100]) expect(scale2.invert(val)).toBe(42)
    })
  })

  describe(`create_color_scale with arcsinh`, () => {
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

    test.each([1e10, -1e10, 1e-10])(`handles extreme value %s`, (value) => {
      const scale = create_color_scale(
        { type: { type: `arcsinh`, threshold: 1 } },
        [-1e12, 1e12],
      )
      expect(typeof scale(value)).toBe(`string`)
    })

    test.each([1e-10, 1e10, 0.001, 1000])(`handles threshold=%s`, (threshold) => {
      const scale = create_color_scale(
        { type: { type: `arcsinh`, threshold } },
        [-100, 100],
      )
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
})
