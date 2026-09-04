import type { DataSeries } from '$lib/plot'
import type { InvalidValueMode } from '$lib/plot/core/data-cleaning'
import {
  clean_multi_series,
  clean_series,
  clean_xyz,
  detect_instability,
  smooth_moving_average,
} from '$lib/plot/core/data-cleaning'
import { describe, expect, it, vi } from 'vitest'

const linear = (length: number, slope = 1): { x: number[]; y: number[] } => {
  const x = Array.from({ length }, (_, idx) => idx)
  return { x, y: x.map((val) => slope * val) }
}

// Linear ramp followed by exponentially growing oscillations
const unstable = (stable_length: number, unstable_length: number, growth_rate = 0.1) => {
  const x = Array.from({ length: stable_length + unstable_length }, (_, idx) => idx)
  const y = x.map((val, idx) => {
    if (idx < stable_length) return val * 0.1
    const unstable_idx = idx - stable_length
    return val * 0.1 + Math.exp(growth_rate * unstable_idx) * Math.sin(unstable_idx * 2)
  })
  return { x, y }
}

// Population variance about a known mean: asserts smoothing reduces spread
const variance = (values: readonly number[], mean: number): number =>
  values.reduce((sum, val) => sum + (val - mean) ** 2, 0) / values.length

const alternating = (length: number, high = 10) =>
  Array.from({ length }, (_, idx) => (idx % 2 ? high : 0))

// Series of y against its own index as x
const indexed = (y: number[]) => ({ x: y.map((_, idx) => idx), y })
// Cleans y against its index and returns the x (= original index) values that survived
const kept_indices = (y: number[], config: Parameters<typeof clean_series>[1]) =>
  clean_series(indexed(y), { ...config, in_place: false }).series.x

describe(`detect_instability`, () => {
  // A perfectly linear ramp has zero derivative variance everywhere, so the variance method has
  // no baseline scale: it must opt out rather than divide by an empty-baseline median
  it(`reports no onset for stable linear data, even with NaN holes`, () => {
    const { x, y } = linear(100, 0.5)
    expect(detect_instability(x, y)).toMatchObject({
      detected: false,
      onset_index: -1,
      method_scores: { derivative_variance: 0 },
    })
    y[25] = NaN
    y[26] = NaN
    const with_holes = detect_instability(x, y)
    expect(with_holes.detected).toBe(false)
    expect(with_holes.combined_score).toBeGreaterThanOrEqual(0)
  })

  it.each([
    { y: [], window_size: 5 },
    { y: [42], window_size: 5 },
    { y: [1, 2, NaN, 4, 5, 6, 7, 8, 9], window_size: 5 }, // fewer finite points than 2 windows
  ])(`returns the empty result for $y.length points`, ({ y, window_size }) => {
    const x = y.map((_, idx) => idx)
    expect(detect_instability(x, y, { window_size })).toEqual({
      detected: false,
      onset_index: -1,
      onset_x: NaN,
      combined_score: 0,
      method_scores: { derivative_variance: 0, amplitude_growth: 0, sign_changes: 0 },
    })
  })

  it(`locates the onset of growing oscillations`, () => {
    const { x, y } = unstable(50, 50, 0.2)
    const result = detect_instability(x, y, { oscillation_threshold: 2 })
    expect(result.detected).toBe(true)
    expect(result.onset_index).toBeGreaterThanOrEqual(20)
    expect(result.onset_index).toBeLessThan(80)
    expect(result.onset_x).toBe(x[result.onset_index])
  })

  it(`weights method scores into the combined score`, () => {
    const { x, y } = unstable(30, 30, 0.3)
    expect(
      detect_instability(x, y, {
        oscillation_weights: { derivative_variance: 0, amplitude_growth: 0, sign_changes: 0 },
      }),
    ).toMatchObject({ detected: false, onset_index: -1, combined_score: 0 })
    const only = (method: `derivative_variance` | `amplitude_growth`) =>
      detect_instability(x, y, {
        oscillation_weights: { derivative_variance: 0, amplitude_growth: 0, [method]: 1 },
      })
    const deriv_only = only(`derivative_variance`)
    const amp_only = only(`amplitude_growth`)
    expect(deriv_only.method_scores.derivative_variance).toBeGreaterThan(0)
    expect(amp_only.method_scores.amplitude_growth).toBeGreaterThan(0)
    // sign_changes keeps its default weight of 1 in both calls
    expect(deriv_only.combined_score).toBeCloseTo(
      (deriv_only.method_scores.derivative_variance + deriv_only.method_scores.sign_changes) /
        2,
      12,
    )
  })

  // Regression: `combined_score >= 1.0` was hard-coded instead of the configured threshold
  it(`compares the combined score against oscillation_threshold`, () => {
    // a clean ramp scores 0 on derivative variance (flat baseline) and sign changes, and
    // exactly 1x baseline amplitude (score 1/10), so combined = (0 + 0.1 + 0) / 3. No
    // method reports an onset, so only the threshold comparison can flag it
    const { x, y } = linear(100, 0.5)
    const low = detect_instability(x, y, { oscillation_threshold: 0.0001 })
    expect(low.combined_score).toBeCloseTo(0.1 / 3, 9)
    expect(low).toMatchObject({ detected: true, onset_index: -1 })
    expect(detect_instability(x, y, { oscillation_threshold: 0.05 }).detected).toBe(false)
  })
})

describe(`smooth_moving_average`, () => {
  it.each([
    { values: [1, 2, 3, 4, 5], window: 1, expected: [1, 2, 3, 4, 5] },
    { values: [1, 10, 1, 10, 1], window: 3, expected: [5.5, 4, 7, 4, 5.5] },
    { values: [1, 2, NaN, 4, 5], window: 3, expected: [1.5, 1.5, 3, 4.5, 4.5] },
  ])(`window $window over $values`, ({ values, window, expected }) => {
    const result = smooth_moving_average(values, window)
    expect(result).toEqual(expected)
    expect(result).not.toBe(values)
  })

  it(`stays exact for huge magnitudes and after cancellation`, () => {
    const huge = Array<number>(1000).fill(1e306)
    expect(smooth_moving_average(huge, 3)).toEqual(huge)
    expect(
      smooth_moving_average([1e16, -1e16, 1e16, -1e16, 1, 2, 3, 4, 5], 5).slice(6),
    ).toEqual([3, 3.5, 4])
    expect(smooth_moving_average([1e100, 1e50, 1, -1e100, -1e50], 5)[2]).toBe(0.2)
  })
})

describe(`clean_series`, () => {
  it(`rejects misaligned raw values before cleaning`, () => {
    expect(() => clean_series({ id: `energy`, x: [0, 1], y: [2, 3], raw_y: [2] })).toThrow(
      `aligned arrays`,
    )
  })

  it.each([
    { x: [], y: [], kept_x: [] },
    { x: [0], y: [10], kept_x: [0] },
    { x: [0, 1, 2], y: [NaN, NaN, NaN], kept_x: [] },
    { x: [0, 1, 2], y: [Infinity, -Infinity, Infinity], kept_x: [] },
    { x: [0, 1, 2, 3, 4], y: [NaN, 1, 2, 3, NaN], kept_x: [1, 2, 3] },
  ])(`removes invalid points of y=$y`, ({ x, y, kept_x }) => {
    const { series, quality } = clean_series({ x, y }, { in_place: false })
    expect(series.x).toEqual(kept_x)
    expect(quality).toMatchObject({
      points_removed: x.length - kept_x.length,
      invalid_values_found: x.length - kept_x.length,
    })
  })

  it(`keeps every aligned array in sync when filtering`, () => {
    const series: DataSeries = {
      x: [0, 1, 2, 3, 4],
      y: [0, NaN, 4, 6, 8],
      raw_y: [0, 2, 8, 12, 16],
      metadata: [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }, { id: `e` }],
      color_values: [1, 2, 3, 4, 5],
      size_values: [10, 20, 30, 40, 50],
    }
    const { series: cleaned, quality } = clean_series(series, { in_place: false })
    expect(cleaned).not.toBe(series)
    expect(series.y[1]).toBeNaN() // source untouched
    expect(quality.invalid_values_found).toBe(1)
    expect(cleaned).toMatchObject({
      x: [0, 2, 3, 4],
      y: [0, 4, 6, 8],
      raw_y: [0, 8, 12, 16],
      metadata: [{ id: `a` }, { id: `c` }, { id: `d` }, { id: `e` }],
      color_values: [1, 3, 4, 5],
      size_values: [10, 30, 40, 50],
    })
    const null_colors = clean_series({ x: [0, 1], y: [0, NaN], color_values: null })
    expect(null_colors.series.color_values).toBeNull()
    // scalar (non-array) metadata describes the whole series and passes through by reference
    const scalar = { key: `value` }
    const with_scalar = clean_series({ x: [0, 1], y: [0, NaN], metadata: scalar })
    expect(with_scalar.series.metadata).toBe(scalar)
  })

  it(`mutates in place by default, including interpolated values`, () => {
    const series: DataSeries = { x: [0, 1, 2, 3, 4], y: [0, NaN, 4, 6, 8] }
    expect(clean_series(series, { invalid_values: `interpolate` }).series).toBe(series)
    expect(series.y).toEqual([0, 2, 4, 6, 8])
  })

  // edges hold the nearest finite value; runs interpolate linearly; nothing finite -> 0
  it.each([
    { label: `edges`, y: [NaN, 2, 4, 6, NaN], cleaned: [2, 2, 4, 6, 6], count: 2 },
    { label: `interior`, y: [0, NaN, NaN, NaN, 8], cleaned: [0, 2, 4, 6, 8], count: 3 },
    { label: `all missing`, y: [NaN, NaN], cleaned: [0, 0], count: 2 },
    {
      label: `long gap`,
      y: [7, ...Array<number>(2048).fill(NaN), 7],
      cleaned: Array<number>(2050).fill(7),
      count: 2048,
    },
  ])(`interpolates $label in linear work`, ({ y, cleaned, count }) => {
    const finite_check = vi.spyOn(Number, `isFinite`)
    const { series, quality } = clean_series(indexed(y), {
      invalid_values: `interpolate`,
      in_place: false,
    })
    const checks = finite_check.mock.calls.length
    finite_check.mockRestore()
    // Includes detection/quality passes; rescanning the unfilled tail costs O(gap²).
    expect(checks).toBeLessThan(100 * y.length)
    expect(series.y).toEqual(cleaned)
    expect(quality).toMatchObject({ points_removed: 0, invalid_values_found: count })
  })

  it(`propagates invalid values when asked`, () => {
    const { series, quality } = clean_series(
      { x: [0, 1, 2, 3, 4], y: [0, NaN, 4, Infinity, 8] },
      { invalid_values: `propagate`, in_place: false },
    )
    expect(series.y).toEqual([0, NaN, 4, Infinity, 8])
    expect(quality).toMatchObject({ points_removed: 0, invalid_values_found: 2 })
  })

  it.each([
    { mode: `clamp`, x: [0, 1, 2, 3, 4], y: [0, 5, 10, 15, 20], removed: 0 },
    { mode: undefined, x: [0, 1, 2, 3, 4], y: [0, 5, 10, 15, 20], removed: 0 }, // default clamp
    { mode: `filter`, x: [1, 2, 3], y: [5, 10, 15], removed: 2 },
    { mode: `null`, x: [0, 1, 2, 3, 4], y: [NaN, 5, 10, 15, NaN], removed: 0 },
  ] as const)(`applies $mode bounds`, ({ mode, x, y, removed }) => {
    const { series, quality } = clean_series(
      { x: [0, 1, 2, 3, 4], y: [-10, 5, 10, 15, 100] },
      { bounds: { min: 0, max: 20, mode }, in_place: false },
    )
    expect(series.x).toEqual(x)
    expect(series.y).toEqual(y)
    expect(quality).toMatchObject({ bounds_violations: 2, points_removed: removed })
  })

  it(`resolves x-dependent bounds per point`, () => {
    const x = [0, 1, 2, 3, 4]
    const clamp_max = clean_series(
      { x, y: [0, 2, 4, 6, 8] },
      { bounds: { max: (x_val) => x_val * 1.5 }, in_place: false },
    )
    expect(clamp_max.series.y).toEqual([0, 1.5, 3, 4.5, 6])
    expect(clamp_max.quality.bounds_violations).toBe(4)
    const clamp_min = clean_series(
      { x, y: [0, 0, 0, 0, 0] },
      { bounds: { min: (x_val) => x_val * 0.5 }, in_place: false },
    )
    expect(clamp_min.series.y).toEqual([0, 0.5, 1, 1.5, 2])
  })

  it.each([
    { type: `moving_avg`, window: 3 },
    { type: `savgol`, window: 5 },
    { type: `gaussian`, sigma: 1 },
  ] as const)(`applies $type smoothing`, (smooth) => {
    const y = alternating(20)
    const { series } = clean_series(indexed(y), { smooth, in_place: false })
    expect(variance(series.y, 5)).toBeLessThan(variance(y, 5))
  })

  it(`gaussian smoothing is exact on a constant over a clustered x grid`, () => {
    // Nadaraya-Watson (sum(w*y)/sum(w)), not the DOS convolution: on this irregular grid a
    // density-weighted pass ranged 0.235..1.950 and a measure-weighted one droops at the ends
    const x = [0, 0.1, 0.2, 0.3, 0.4, 2, 4, 6, 8, 9.6, 9.7, 9.8, 9.9, 10]
    const { series } = clean_series(
      { x, y: x.map(() => 1) },
      { smooth: { type: `gaussian`, sigma: 1 }, in_place: false },
    )
    for (const val of series.y) expect(val).toBeCloseTo(1, 12)
  })

  describe(`savgol smoothing`, () => {
    const savgol = (
      y: number[],
      window: number,
      polynomial_order?: number,
      invalid_values?: InvalidValueMode,
    ) =>
      clean_series(indexed(y), {
        smooth: { type: `savgol`, window, polynomial_order },
        invalid_values,
        in_place: false,
      }).series.y

    it.each([{ values: [] }, { values: [1, 2] }])(
      `returns $values unchanged when shorter than a kernel`,
      ({ values }) => expect(savgol(values, 5)).toEqual(values),
    )

    // The odd/min/max window clamps must still leave a symmetric kernel that reproduces
    // polynomials up to `order` at interior points (pre-fix, window=3/order=2 erred by ~11)
    it.each([
      { length: 21, window: 3, order: 2, half: 1 }, // max(window, order + 2) -> even 4 -> 3
      { length: 21, window: 1, order: 2, half: 1 },
      { length: 6, window: 9, order: 2, half: 2 }, // min(window, even length) -> 6 -> 5
      { length: 21, window: 5, order: 2, half: 2 },
      { length: 21, window: 7, order: 3, half: 3 },
    ])(
      `reproduces a quadratic with window=$window order=$order`,
      ({ length, window, order, half }) => {
        const quad = Array.from({ length }, (_, idx) => 2 * idx * idx - 3 * idx + 5)
        const out = savgol(quad, window, order)
        expect(out).toHaveLength(length)
        // interior points only: truncated edge kernels are renormalized, not exact
        for (let idx = half; idx < length - half; idx++)
          expect(out[idx]).toBeCloseTo(quad[idx], 6)
      },
    )

    it(`damps oscillations and renormalizes over finite neighbours`, () => {
      const oscillating = alternating(9, 2)
      expect(variance(savgol(oscillating, 5, 2), 1)).toBeLessThan(variance(oscillating, 1))
      // invalid_values: propagate keeps the NaN in place so the kernel has to skip it
      const smoothed = savgol([1, 2, NaN, 4, 5, 6, 7], 5, 2, `propagate`)
      expect(smoothed).toHaveLength(7)
      expect(smoothed.slice(0, 2).concat(smoothed.slice(3)).every(Number.isFinite)).toBe(true)
      // A fully determined fit (window = order + 1) has no neighbours to smooth a NaN center with
      expect(savgol([1, 2, NaN, 4, 5], 3, 2, `propagate`)[2]).toBeNaN()
    })
  })

  describe(`local outliers`, () => {
    const outliers = { window_half: 5, mad_threshold: 2 }

    it.each([
      { y: [] },
      { y: [1, 2, 3] }, // below window size
      { y: Array.from({ length: 30 }, (_, idx) => idx * 0.5) },
      { y: Array<number>(30).fill(5) }, // zero MAD
      // Regression: one-sided edge windows flagged the endpoints of every monotonic series
      { y: Array.from({ length: 30 }, (_, idx) => idx * 50) },
    ])(`keeps every point of $y.length smooth values`, ({ y }) => {
      const { series, quality } = clean_series(indexed(y), {
        local_outliers: outliers,
        in_place: false,
      })
      expect(series.y).toEqual(y)
      expect(quality).toMatchObject({ outliers_removed: 0, points_removed: 0 })
    })

    it.each([
      { spikes: { 15: 100 }, length: 30 },
      { spikes: { 10: 100, 25: -100, 40: 50 }, length: 50 },
      { spikes: { 20: 50, 21: -30, 22: 60 }, length: 50 }, // cluster needs iterations
    ])(`removes exactly the spiked indices $spikes`, ({ spikes, length }) => {
      const y = Array.from({ length }, (_, idx) => idx * 0.5)
      for (const [idx, val] of Object.entries(spikes)) y[Number(idx)] = val
      const kept = new Set(kept_indices(y, { local_outliers: outliers }))
      const removed = y.map((_, idx) => idx).filter((idx) => !kept.has(idx))
      expect(removed).toEqual(Object.keys(spikes).map(Number))
    })

    it(`skips NaN, respects mad_threshold and tolerates regular oscillation`, () => {
      const with_nan = Array.from({ length: 20 }, (_, idx) => (idx === 2 ? NaN : idx + 1))
      const { quality } = clean_series(indexed(with_nan), {
        local_outliers: {},
        in_place: false,
      })
      expect(quality).toMatchObject({ invalid_values_found: 1, outliers_removed: 0 })

      const bumped = Array.from({ length: 50 }, (_, idx) => idx + Math.sin(idx) * 2)
      bumped[25] += 10
      expect(kept_indices(bumped, { local_outliers: { mad_threshold: 1.5 } })).not.toContain(
        25,
      )
      expect(kept_indices(bumped, { local_outliers: { mad_threshold: 5 } })).toHaveLength(50)

      const sine = Array.from({ length: 100 }, (_, idx) => Math.sin(idx / 10) * 5)
      expect(
        kept_indices(sine, { local_outliers: { window_half: 10, mad_threshold: 3 } }),
      ).toHaveLength(100)
    })
  })

  it.each([
    { truncation_mode: `mark_unstable`, length: 80 },
    { truncation_mode: `hard_cut`, length: undefined },
  ] as const)(`$truncation_mode on unstable data`, ({ truncation_mode, length }) => {
    const { x, y } = unstable(40, 40, 0.3)
    const { series, quality } = clean_series(
      { x, y },
      { oscillation_threshold: 2, truncation_mode, in_place: false },
    )
    expect(quality.oscillation_detected).toBe(true)
    if (truncation_mode === `hard_cut`) {
      expect(series.x).toHaveLength(80 - quality.points_removed)
      expect(series.x.length).toBeLessThan(80)
      expect(quality.truncated_at_x).toBe(x[series.x.length])
    } else {
      expect(series.x).toHaveLength(length)
      expect(quality.stable_range?.[0]).toBe(0)
      expect(quality.stable_range?.[1]).toBeGreaterThan(0)
    }
  })

  it(`removes local outliers after invalid values, keeping aux arrays aligned`, () => {
    const { x, y } = linear(100, 0.5)
    y[20] = NaN
    y[50] = 500
    const { series, quality } = clean_series(
      { x, y, raw_y: x.map((val) => val * 4), metadata: x.map((id) => ({ id })) },
      { local_outliers: { window_half: 5, mad_threshold: 3 }, in_place: false },
    )
    expect(quality).toMatchObject({ invalid_values_found: 1, outliers_removed: 1 })
    expect(series.x).toHaveLength(98)
    expect(series.x).not.toContain(50)
    expect(series.raw_y).not.toContain(200)
    expect((series.metadata as { id: number }[]).map(({ id }) => id)).not.toContain(50)
  })

  it(`composes removal, clamping and smoothing`, () => {
    const { series, quality } = clean_series(
      { x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], y: [-10, NaN, 5, 10, 15, 100, 8, 6, 4, 2] },
      {
        bounds: { min: 0, max: 20, mode: `clamp` },
        smooth: { type: `moving_avg`, window: 3 },
        in_place: false,
      },
    )
    expect(series.x).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(quality).toMatchObject({ invalid_values_found: 1, bounds_violations: 2 })
    // clamped to [0, 5, 10, 15, 20, 8, 6, 4, 2] before the 3-point average
    expect(series.y[0]).toBe(2.5)
    expect(series.y[4]).toBeCloseTo((15 + 20 + 8) / 3, 12)
  })

  it(`handles 50k points without recursion limits`, () => {
    const { x } = linear(50_000)
    const y = x.map((val) => Math.sin(val / 100) * 10)
    const { series, quality } = clean_series(
      { x, y },
      {
        bounds: { min: -5, max: 5 },
        smooth: { type: `moving_avg`, window: 11 },
        in_place: false,
      },
    )
    expect(series.x).toHaveLength(50_000)
    expect(quality.bounds_violations).toBeGreaterThan(0)
  })
})

describe(`clean_multi_series`, () => {
  it(`filters every series to the shared valid indices`, () => {
    const result = clean_multi_series(
      [0, 1, 2, 3, 4],
      [
        [0, NaN, 4, 6, 8],
        [10, 12, NaN, 16, 18],
      ],
    )
    expect(result.x).toEqual([0, 3, 4])
    expect(result.cleaned_y).toEqual([
      [0, 6, 8],
      [10, 16, 18],
    ])
    expect(result.quality.map(({ points_removed }) => points_removed)).toEqual([2, 2])
  })

  it(`interpolates per series and applies bounds to all of them`, () => {
    const interpolated = clean_multi_series(
      [0, 1, 2, 3, 4],
      [
        [0, NaN, 4, 6, 8],
        [10, 12, NaN, 16, 18],
      ],
      { invalid_values: `interpolate` },
    )
    expect(interpolated.cleaned_y).toEqual([
      [0, 2, 4, 6, 8],
      [10, 12, 14, 16, 18],
    ])
    expect(
      interpolated.quality.map(({ invalid_values_found }) => invalid_values_found),
    ).toEqual([1, 1])
    const clamped = clean_multi_series(
      [0, 1, 2],
      [
        [-5, 5, 15],
        [0, 10, 20],
      ],
      { bounds: { min: 0, max: 10 } },
    )
    expect(clamped.cleaned_y).toEqual([
      [0, 5, 10],
      [0, 10, 10],
    ])
    const filtered = clean_multi_series(
      [0, 1, 2, 3, 4],
      [
        [-10, 5, 10, 15, 100],
        [0, 5, 10, 15, 20],
      ],
      { bounds: { min: 0, max: 20, mode: `filter` } },
    )
    expect(filtered.x).toEqual([1, 2, 3])
    expect(filtered.cleaned_y[1]).toEqual([5, 10, 15])
  })

  it(`handles empty input and counts invalid values only inside the aligned prefix`, () => {
    expect(clean_multi_series([0, 1, 2], [])).toEqual({
      x: [0, 1, 2],
      cleaned_y: [],
      quality: [],
    })
    const result = clean_multi_series(
      [0, 1, 2],
      [
        [0, NaN, 4, NaN, NaN],
        [10, 12, 14, NaN, NaN],
      ],
    )
    expect(result.quality.map(({ invalid_values_found }) => invalid_values_found)).toEqual([
      1, 0,
    ])
    expect(result.quality[0].points_removed).toBe(1)
  })
})

describe(`clean_xyz`, () => {
  it(`drops an index when any coordinate is invalid`, () => {
    const result = clean_xyz(
      [0, NaN, 2, 3, 4],
      [10, 11, NaN, 13, 14],
      [100, 101, 102, NaN, 104],
    )
    expect(result).toMatchObject({ x: [0, 4], y: [10, 14], z: [100, 104] })
    expect(result.quality).toMatchObject({ points_removed: 3, invalid_values_found: 3 })
  })

  it(`interpolates each coordinate, truncates to the shortest array and handles empties`, () => {
    const interpolated = clean_xyz(
      [0, NaN, 2, 3, 4],
      [0, Infinity, 2, 3, 4],
      [0, NaN, 4, 6, 8],
      {
        invalid_values: `interpolate`,
      },
    )
    expect(interpolated).toMatchObject({
      x: [0, 1, 2, 3, 4],
      y: [0, 1, 2, 3, 4],
      z: [0, 2, 4, 6, 8],
    })
    expect(interpolated.quality.invalid_values_found).toBe(3)
    expect(clean_xyz([], [], []).x).toEqual([])
    expect(clean_xyz([0, 1, 2, 3, 4], [0, 1, 2], [0, 1, 2, 3]).x).toEqual([0, 1, 2])
  })

  it(`smooths only the dependent y/z axes`, () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const y = alternating(10)
    const z = alternating(10).toReversed()
    const result = clean_xyz(x, y, z, { smooth: { type: `moving_avg`, window: 3 } })
    expect(result.x).toEqual(x)
    expect(variance(result.y, 5)).toBeLessThan(variance(y, 5))
    expect(variance(result.z, 5)).toBeLessThan(variance(z, 5))
  })

  // Regression: x-dependent bounds resolve against x even when filtering on another axis
  it(`filters on primary_axis using x for dynamic bounds`, () => {
    const result = clean_xyz([1, 2, 3, 4, 5], [1, 5, 4, 10, 8], [0, 0, 0, 0, 0], {
      primary_axis: `y`,
      bounds: { max: (x_val) => x_val * 2, mode: `filter` }, // max = 2, 4, 6, 8, 10
    })
    expect(result).toMatchObject({ x: [1, 3, 5], y: [1, 4, 8], z: [0, 0, 0] })
    expect(result.quality).toMatchObject({ bounds_violations: 2, points_removed: 2 })
  })
})
