import * as math from '$lib/math'
import {
  calculate_domain,
  create_scale,
  create_time_scale,
  generate_log_ticks,
  generate_ticks,
  get_nice_data_range,
} from '$lib/plot/scales'
import type { ScaleType } from '$lib/plot/types'
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
    ])(`%s scale`, (scale_type, domain, range) => {
      const scale = create_scale(
        scale_type as ScaleType,
        domain as [number, number],
        range as [number, number],
      )

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

    test.each([
      [100],
      [1],
      [0.001],
    ])(`single value domain: %s`, (value) => {
      const result = generate_log_ticks(value, value, 5)
      expect(result).toContain(value)
      expect(result.length).toBeGreaterThan(0)
    })

    test(`negative values clamped`, () => {
      const result = generate_log_ticks(-10, 100, 5)
      expect(result.some((t) => t >= math.LOG_EPS)).toBe(true)
      expect(result).toContain(100)
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
        domain: [0, 100] as [number, number],
        ticks: { 50: `A`, 10: `B`, 150: `C`, 90: `D`, [-10]: `E`, 30: `F` } as Record<
          number,
          string
        >,
        expected: [10, 30, 50, 90],
      },
      {
        name: `filters non-finite values`,
        domain: [0, 100] as [number, number],
        ticks: { 25: `A`, 50: `B`, NaN: `C`, 75: `D`, [Infinity]: `E` } as Record<
          number,
          string
        >,
        expected: [25, 50, 75],
      },
      {
        name: `handles reversed domain`,
        domain: [100, 0] as [number, number],
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

    test(`default linear ticks with default_count`, () => {
      const domain: [number, number] = [0, 100]
      const scale = scaleLinear().domain(domain).range([0, 500])

      const result = generate_ticks(domain, `linear`, 5, scale, { default_count: 8 })
      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThanOrEqual(8) // Should respect the tick count
      expect(result[0]).toBeLessThanOrEqual(0)
      expect(result[result.length - 1]).toBeGreaterThanOrEqual(100)
    })

    test(`default linear ticks without options`, () => {
      const domain: [number, number] = [0, 50]
      const scale = scaleLinear().domain(domain).range([0, 300])

      const result = generate_ticks(domain, `linear`, 6, scale)
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((tick) => typeof tick === `number`)).toBe(true)
    })

    test(`handles edge case - empty domain`, () => {
      const domain: [number, number] = [0, 0]
      const scale = scaleLinear().domain(domain).range([0, 100])

      const result = generate_ticks(domain, `linear`, 5, scale)
      expect(result.length).toBeGreaterThan(0)
      expect(result).toContain(0)
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

    test(`time intervals - month filtering`, () => {
      const start_time = new Date(2022, 0, 1).getTime() // Jan 1, 2022
      const end_time = new Date(2024, 11, 31).getTime() // Dec 31, 2024
      const domain: [number, number] = [start_time, end_time]
      const scale = scaleTime().domain([new Date(start_time), new Date(end_time)]).range([
        0,
        500,
      ])

      const result = generate_ticks(domain, `linear`, `month`, scale, {
        format: `%Y-%m-%d`,
      })
      expect(result.length).toBeGreaterThan(0)
      // All ticks should be at the start of months (day 1)
      result.forEach((tick) => {
        const date = new Date(tick)
        expect(date.getDate()).toBe(1)
      })
    })

    test(`time intervals - year filtering`, () => {
      const start_time = new Date(2020, 5, 15).getTime()
      const end_time = new Date(2025, 2, 10).getTime()
      const domain: [number, number] = [start_time, end_time]
      const scale = scaleTime().domain([new Date(start_time), new Date(end_time)]).range([
        0,
        500,
      ])

      const result = generate_ticks(domain, `linear`, `year`, scale, {
        format: `%Y-%m-%d`,
      })
      expect(result.length).toBeGreaterThan(0)
      // All ticks should be at the start of years (Jan 1)
      result.forEach((tick) => {
        const date = new Date(tick)
        expect(date.getMonth()).toBe(0)
        expect(date.getDate()).toBe(1)
      })
    })
  })
})
