import { compute_box_stats, is_whisker_mode, WHISKER_MODES } from '$lib/plot'
import type { WhiskerMode } from '$lib/plot'
import { describe, expect, test } from 'vitest'

// d3 quantile uses type-7 (linear) interpolation, matching numpy/pandas defaults.
// Reference values below are hand-computed for 1..10 (n=10):
//   q1 = 3.25, median = 5.5, q3 = 7.75, IQR = 4.5
const one_to_ten = Array.from({ length: 10 }, (_, idx) => idx + 1)

describe(`compute_box_stats`, () => {
  test(`quartiles match d3 type-7 interpolation`, () => {
    const stats = compute_box_stats(one_to_ten, { whisker_mode: `tukey` })
    expect(stats.n).toBe(10)
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(10)
    expect(stats.q1).toBeCloseTo(3.25, 12)
    expect(stats.median).toBeCloseTo(5.5, 12)
    expect(stats.q3).toBeCloseTo(7.75, 12)
    expect(stats.mean).toBeCloseTo(5.5, 12)
    // tukey bounds: [-3.5, 14.5] => no outliers, whiskers at data extremes
    expect(stats.whisker_low).toBe(1)
    expect(stats.whisker_high).toBe(10)
    expect(stats.outliers).toEqual([])
  })

  test(`tukey flags a high outlier and shrinks the upper whisker`, () => {
    const stats = compute_box_stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], {
      whisker_mode: `tukey`,
    })
    // q3 = 7.75, IQR = 4.5, high_bound = 14.5 => 100 is an outlier, whisker at 9
    expect(stats.outliers).toEqual([100])
    expect(stats.whisker_high).toBe(9)
    expect(stats.whisker_low).toBe(1)
  })

  test(`can skip outlier materialization while preserving whiskers`, () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
    const full = compute_box_stats(values, { whisker_mode: `tukey` })
    const skipped = compute_box_stats(values, {
      whisker_mode: `tukey`,
      collect_outliers: false,
    })
    expect(skipped.outliers).toEqual([])
    expect(skipped.whisker_low).toBe(full.whisker_low)
    expect(skipped.whisker_high).toBe(full.whisker_high)
    expect(skipped.q1).toBe(full.q1)
    expect(skipped.median).toBe(full.median)
    expect(skipped.q3).toBe(full.q3)
  })

  test(`minmax: whiskers reach data extremes, no outliers`, () => {
    const stats = compute_box_stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], {
      whisker_mode: `minmax`,
    })
    expect(stats.whisker_low).toBe(1)
    expect(stats.whisker_high).toBe(100)
    expect(stats.outliers).toEqual([])
  })

  // The 5-percentile bridge: passing [p05, p25, p50, p75, p95] with minmax reproduces the box
  test(`five precomputed percentiles reproduce a box exactly (minmax)`, () => {
    const stats = compute_box_stats([10, 20, 30, 40, 50], { whisker_mode: `minmax` })
    expect(stats.q1).toBeCloseTo(20, 12)
    expect(stats.median).toBeCloseTo(30, 12)
    expect(stats.q3).toBeCloseTo(40, 12)
    expect(stats.whisker_low).toBe(10)
    expect(stats.whisker_high).toBe(50)
    expect(stats.outliers).toEqual([])
  })

  test(`percentile mode uses 5th/95th by default and is order-insensitive`, () => {
    const data = Array.from({ length: 100 }, (_, idx) => idx + 1) // 1..100
    const stats = compute_box_stats(data, { whisker_mode: `percentile` })
    // p05 index = 4.95 => 5.95 ; p95 index = 94.05 => 95.05
    expect(stats.whisker_low).toBeCloseTo(5.95, 10)
    expect(stats.whisker_high).toBeCloseTo(95.05, 10)
    // values <5.95 (1..5) and >95.05 (96..100) => 10 outliers
    expect(stats.outliers).toHaveLength(10)
    expect(stats.outliers).toEqual([1, 2, 3, 4, 5, 96, 97, 98, 99, 100])
    // reversed [95, 5] yields the same box as the default ordered pair
    expect(
      compute_box_stats(data, { whisker_mode: `percentile`, whisker_percentiles: [95, 5] }),
    ).toEqual(stats)
  })

  test(`percentile mode honors custom whisker_percentiles`, () => {
    const data = Array.from({ length: 100 }, (_, idx) => idx + 1)
    const stats = compute_box_stats(data, {
      whisker_mode: `percentile`,
      whisker_percentiles: [10, 90],
    })
    // p10 index = 9.9 => 10.9 ; p90 index = 89.1 => 90.1
    expect(stats.whisker_low).toBeCloseTo(10.9, 10)
    expect(stats.whisker_high).toBeCloseTo(90.1, 10)
    expect(stats.outliers).toHaveLength(20) // 1..10 (<10.9) and 91..100 (>90.1)
  })

  test(`std mode clamps whiskers to data extent`, () => {
    // mean = 5.5, sample std ≈ 3.0277 => bounds ≈ [0.96, 10.04], clamped to [1, 10]
    const stats = compute_box_stats(one_to_ten, { whisker_mode: `std`, whisker_range: 1.5 })
    expect(stats.whisker_low).toBe(1)
    expect(stats.whisker_high).toBe(10)
    expect(stats.outliers).toEqual([])
  })

  test(`std mode flags points beyond mean ± range*std`, () => {
    const stats = compute_box_stats([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], {
      whisker_mode: `std`,
      whisker_range: 1,
    })
    expect(stats.outliers).toContain(100)
    expect(stats.whisker_high).toBeLessThan(100)
  })

  test.each<[string, number[], number]>([
    [`empty`, [], 0],
    [`single`, [42], 1],
    [`all equal`, [3, 3, 3, 3], 4],
  ])(`edge case: %s`, (_label, values, expected_n) => {
    const stats = compute_box_stats(values)
    expect(stats.n).toBe(expected_n)
    if (expected_n === 0) {
      expect(Number.isNaN(stats.median)).toBe(true)
      expect(stats.outliers).toEqual([])
    } else {
      expect(stats.outliers).toEqual([])
      expect(stats.whisker_low).toBe(values[0])
      expect(stats.whisker_high).toBe(values[values.length - 1])
    }
  })

  test(`degenerate single value yields a flat box`, () => {
    const stats = compute_box_stats([42])
    expect(stats.q1).toBe(42)
    expect(stats.median).toBe(42)
    expect(stats.q3).toBe(42)
    expect(stats.mean).toBe(42)
    expect(stats.whisker_low).toBe(42)
    expect(stats.whisker_high).toBe(42)
  })

  test(`filters non-finite values and does not mutate input`, () => {
    const input = [3, NaN, 1, Infinity, 2, -Infinity]
    const snapshot = [...input]
    const stats = compute_box_stats(input)
    expect(stats.n).toBe(3) // only 1, 2, 3 are finite
    expect(stats.min).toBe(1)
    expect(stats.max).toBe(3)
    expect(stats.median).toBeCloseTo(2, 12)
    expect(input).toEqual(snapshot) // input untouched
  })

  test(`per-mode whisker ordering stays consistent`, () => {
    const data = [...one_to_ten, 50]
    for (const mode of WHISKER_MODES) {
      const stats = compute_box_stats(data, { whisker_mode: mode as WhiskerMode })
      expect(stats.whisker_low).toBeLessThanOrEqual(stats.q1)
      expect(stats.q1).toBeLessThanOrEqual(stats.median)
      expect(stats.median).toBeLessThanOrEqual(stats.q3)
      expect(stats.q3).toBeLessThanOrEqual(stats.whisker_high)
    }
  })
})

describe(`is_whisker_mode`, () => {
  test.each([`tukey`, `minmax`, `percentile`, `std`])(`accepts %s`, (mode) => {
    expect(is_whisker_mode(mode)).toBe(true)
  })

  test.each([`box`, ``, `Tukey`, `iqr`])(`rejects %s`, (mode) => {
    expect(is_whisker_mode(mode)).toBe(false)
  })
})
