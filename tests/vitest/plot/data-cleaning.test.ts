// Tests for data cleaning utilities
import type {
  CleaningConfig,
  CleaningResult,
  DataSeries,
  InstabilityResult,
  InvalidValueMode,
  OscillationWeights,
  PhysicalBounds,
  SmoothingConfig,
  TruncationMode,
} from '$lib/plot'
import {
  apply_bounds,
  clean_multi_series,
  clean_series,
  clean_trajectory_props,
  clean_xyz,
  compute_local_variance,
  detect_instability,
  handle_invalid_values,
  smooth_moving_average,
  smooth_savitzky_golay,
  sync_metadata,
} from '$lib/plot'
import { describe, expect, it } from 'vitest'

// --- Test Data Generators ---

function generate_linear_data(
  length: number,
  slope = 1,
  noise = 0,
): { x: number[]; y: number[] } {
  const x = Array.from({ length }, (_, idx) => idx)
  const y = x.map((val) => slope * val + (noise > 0 ? (Math.random() - 0.5) * noise : 0))
  return { x, y }
}

function generate_unstable_data(
  stable_length: number,
  unstable_length: number,
  growth_rate = 0.1,
): { x: number[]; y: number[] } {
  const total = stable_length + unstable_length
  const x = Array.from({ length: total }, (_, idx) => idx)
  const y = x.map((val, idx) => {
    if (idx < stable_length) return val * 0.1
    const unstable_idx = idx - stable_length
    return val * 0.1 + Math.exp(growth_rate * unstable_idx) * Math.sin(unstable_idx * 2)
  })
  return { x, y }
}

describe(`compute_local_variance`, () => {
  it.each([
    { input: [], window: 5, expected: [], desc: `empty array` },
    { input: [42], window: 5, expected: [0], desc: `single value` },
  ])(`returns $expected for $desc`, ({ input, window, expected }) => {
    expect(compute_local_variance(input, window)).toEqual(expected)
  })

  it(`returns zero for constant values`, () => {
    expect(compute_local_variance([5, 5, 5, 5, 5], 3).every((v) => v === 0)).toBe(true)
  })

  it(`computes higher variance for oscillating vs stable data`, () => {
    const stable_var = compute_local_variance([1, 1.1, 0.9, 1, 1.1], 3)
    const oscillating_var = compute_local_variance([1, -1, 1, -1, 1], 3)
    expect(Math.max(...oscillating_var)).toBeGreaterThan(Math.max(...stable_var))
  })

  it(`handles NaN values gracefully`, () => {
    const result = compute_local_variance([1, 2, NaN, 4, 5], 3)
    expect(result.length).toBe(5)
    expect(result.every((v) => Number.isFinite(v))).toBe(true)
  })

  it(`handles different window sizes`, () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(compute_local_variance(values, 3).length).toBe(10)
    expect(compute_local_variance(values, 7).length).toBe(10)
  })
})

describe(`detect_instability`, () => {
  it(`returns no detection for stable linear data`, () => {
    const { x, y } = generate_linear_data(100, 0.5)
    const result = detect_instability(x, y)
    expect(result.detected).toBe(false)
    expect(result.onset_index).toBe(-1)
    expect(Number.isNaN(result.onset_x)).toBe(true)
  })

  it(`detects instability in oscillating data with growing amplitude`, () => {
    const { x, y } = generate_unstable_data(50, 50, 0.2)
    const result = detect_instability(x, y, { oscillation_threshold: 2.0 })

    expect(result.detected).toBe(true)
    expect(result.onset_index).toBeGreaterThanOrEqual(20)
    expect(result.onset_index).toBeLessThan(80)
    expect(Number.isFinite(result.onset_x)).toBe(true)
    expect(result.onset_x).toBeGreaterThanOrEqual(x[0])
  })

  it(`respects oscillation weights and returns method_scores`, () => {
    const { x, y } = generate_unstable_data(30, 30, 0.3)

    const deriv_only = detect_instability(x, y, {
      oscillation_weights: {
        derivative_variance: 1,
        amplitude_growth: 0,
        sign_changes: 0,
      },
    })
    const amp_only = detect_instability(x, y, {
      oscillation_weights: {
        derivative_variance: 0,
        amplitude_growth: 1,
        sign_changes: 0,
      },
    })

    expect(deriv_only.method_scores.derivative_variance).toBeGreaterThan(0)
    expect(amp_only.method_scores.amplitude_growth).toBeGreaterThan(0)
    expect(deriv_only.method_scores).toHaveProperty(`sign_changes`)
  })

  it(`handles data with NaN values and returns combined_score`, () => {
    const { x, y } = generate_linear_data(50)
    y[25] = NaN
    y[26] = NaN

    const result = detect_instability(x, y)
    expect(result.detected).toBe(false)
    expect(typeof result.combined_score).toBe(`number`)
    expect(result.combined_score).toBeGreaterThanOrEqual(0)
  })
})

describe(`handle_invalid_values`, () => {
  it.each([
    {
      mode: `remove` as const,
      y: [0, NaN, 4, Infinity, 8],
      expectedLen: 3,
      invalidCount: 2,
    },
    { mode: `propagate` as const, y: [0, NaN, 4, 6, 8], expectedLen: 5, invalidCount: 1 },
  ])(
    `$mode mode handles invalid values correctly`,
    ({ mode, y, expectedLen, invalidCount }) => {
      const result = handle_invalid_values([...y], mode)
      expect(result.cleaned.length).toBe(expectedLen)
      expect(result.invalid_count).toBe(invalidCount)
      if (mode === `remove`) {
        expect(result.cleaned.every((v) => Number.isFinite(v)))
          .toBe(true)
      }
      if (mode === `propagate`) expect(result.removed_indices).toEqual([])
    },
  )

  it(`interpolate mode fills NaN with linear interpolation`, () => {
    expect(handle_invalid_values([0, 2, NaN, 6, 8], `interpolate`).cleaned[2])
      .toBeCloseTo(4, 5)
  })

  it(`interpolate handles edge and consecutive NaN values`, () => {
    // Edge NaN
    const edge = handle_invalid_values([NaN, 2, 4, 6, NaN], `interpolate`)
    expect(edge.cleaned[0]).toBe(2)
    expect(edge.cleaned[4]).toBe(6)

    // Consecutive NaN
    const consec = handle_invalid_values([0, NaN, NaN, NaN, 8], `interpolate`)
    expect(consec.cleaned[1]).toBeCloseTo(2, 5)
    expect(consec.cleaned[2]).toBeCloseTo(4, 5)
    expect(consec.cleaned[3]).toBeCloseTo(6, 5)
    expect(consec.invalid_count).toBe(3)

    // All invalid fallback
    const all = handle_invalid_values([NaN, NaN, NaN], `interpolate`)
    expect(all.cleaned.length).toBe(3)
  })

  it(`handles ±Infinity correctly`, () => {
    expect(handle_invalid_values([1, -Infinity, 3], `remove`).cleaned).toEqual([1, 3])
    expect(handle_invalid_values([1, Infinity, 3], `remove`).invalid_count).toBe(1)
  })
})

describe(`apply_bounds`, () => {
  const x = [0, 1, 2, 3, 4]
  const y = [-5, 0, 5, 10, 15]

  it.each([
    { mode: `clamp` as const, expected_y: [0, 0, 5, 10, 10], filtered: [] },
    { mode: `filter` as const, expected_y: [-5, 0, 5, 10, 15], filtered: [0, 4] },
  ])(`$mode mode works correctly`, ({ mode, expected_y, filtered }) => {
    const result = apply_bounds(x, y, { min: 0, max: 10, mode })
    if (mode === `clamp`) expect(result.y).toEqual(expected_y)
    expect(result.filtered_indices).toEqual(filtered)
    expect(result.violations).toBe(2)
  })

  it(`null mode replaces violations with NaN`, () => {
    const result = apply_bounds(x, y, { min: 0, mode: `null` })
    expect(Number.isNaN(result.y[0])).toBe(true)
    expect(result.y[1]).toBe(0)
  })

  it(`supports x-dependent bounds`, () => {
    const result_max = apply_bounds(x, [0, 2, 4, 6, 8], {
      max: (v) => v * 1.5,
      mode: `clamp`,
    })
    expect(result_max.y[1]).toBe(1.5)
    expect(result_max.y[2]).toBe(3)

    const result_min = apply_bounds(x, [0, 0, 0, 0, 0], {
      min: (v) => v * 0.5,
      mode: `clamp`,
    })
    expect(result_min.y[1]).toBe(0.5)
    expect(result_min.y[2]).toBe(1)
  })

  it(`default mode is clamp`, () => {
    expect(apply_bounds([0, 1], [-10, 20], { min: 0, max: 10 }).y).toEqual([0, 10])
  })
})

describe(`smooth_moving_average`, () => {
  it(`returns copy for window <= 1 and smooths noisy data`, () => {
    const values = [1, 2, 3, 4, 5]
    const copy = smooth_moving_average(values, 1)
    expect(copy).toEqual(values)
    expect(copy).not.toBe(values)

    const noisy = smooth_moving_average([1, 10, 1, 10, 1, 10, 1], 3)
    expect(noisy[1]).toBeCloseTo(4, 1)
    expect(noisy[3]).toBeCloseTo(4, 1)
  })

  it(`handles NaN in window`, () => {
    expect(Number.isFinite(smooth_moving_average([1, 2, NaN, 4, 5], 3)[2])).toBe(true)
  })
})

describe(`smooth_savitzky_golay`, () => {
  it.each([
    { input: [], window: 5, desc: `empty input` },
    { input: [1, 2], window: 5, desc: `small array` },
  ])(`handles $desc`, ({ input, window }) => {
    const result = smooth_savitzky_golay(input, window)
    expect(result.length).toBe(input.length)
  })

  it(`preserves linear trends and smooths oscillations`, () => {
    const linear = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
    const smoothed_linear = smooth_savitzky_golay(linear, 5, 2)
    for (let idx = 2; idx < linear.length - 2; idx++) {
      expect(smoothed_linear[idx]).toBeCloseTo(linear[idx], 0)
    }

    const oscillating = [0, 2, 0, 2, 0, 2, 0, 2, 0]
    const smoothed_osc = smooth_savitzky_golay(oscillating, 5, 2)
    const orig_var = oscillating.reduce((s, v) => s + (v - 1) ** 2, 0) /
      oscillating.length
    const smooth_var = smoothed_osc.reduce((s, v) => s + (v - 1) ** 2, 0) /
      smoothed_osc.length
    expect(smooth_var).toBeLessThan(orig_var)
  })

  it(`handles different polynomial orders and NaN values`, () => {
    const quadratic = [0, 1, 4, 9, 16, 25, 36, 49, 64]
    expect(smooth_savitzky_golay(quadratic, 5, 1).length).toBe(9)
    expect(smooth_savitzky_golay(quadratic, 5, 2).length).toBe(9)
    expect(smooth_savitzky_golay([1, 2, NaN, 4, 5, 6, 7], 5, 2).length).toBe(7)
  })
})

describe(`sync_metadata`, () => {
  it(`returns undefined for undefined input`, () => {
    expect(sync_metadata(undefined, [0, 1, 2])).toBeUndefined()
  })

  it(`returns scalar metadata unchanged`, () => {
    const meta = { key: `value` }
    expect(sync_metadata(meta, [0, 1])).toBe(meta)
  })

  it(`filters array metadata by kept indices`, () => {
    const meta = [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }, { id: `e` }]
    expect(sync_metadata(meta, [0, 2, 4])).toEqual([{ id: `a` }, { id: `c` }, {
      id: `e`,
    }])
  })
})

describe(`clean_series`, () => {
  it(`handles empty series`, () => {
    const result = clean_series({ x: [], y: [] })
    expect(result.series.x).toEqual([])
    expect(result.quality.points_removed).toBe(0)
  })

  it(`removes invalid values by default and syncs metadata`, () => {
    const series: DataSeries = {
      x: [0, 1, 2, 3, 4],
      y: [0, NaN, 4, 6, 8],
      metadata: [{ id: `a` }, { id: `b` }, { id: `c` }, { id: `d` }, { id: `e` }],
    }
    const result = clean_series(series, { in_place: false })

    expect(result.series.x.length).toBe(4)
    expect(result.quality.invalid_values_found).toBe(1)
    expect(result.series.metadata).toEqual([{ id: `a` }, { id: `c` }, { id: `d` }, {
      id: `e`,
    }])
  })

  it(`applies physical bounds with different modes`, () => {
    const series: DataSeries = { x: [0, 1, 2, 3, 4], y: [-10, 5, 10, 15, 100] }

    const clamp = clean_series({ ...series, x: [...series.x], y: [...series.y] }, {
      bounds: { min: 0, mode: `clamp` },
      in_place: false,
    })
    expect(clamp.series.y[0]).toBe(0)

    const filter = clean_series({ ...series, x: [...series.x], y: [...series.y] }, {
      bounds: { min: 0, max: 20, mode: `filter` },
      in_place: false,
    })
    expect(filter.series.x).toEqual([1, 2, 3])
    expect(filter.quality.points_removed).toBe(2)

    const nullMode = clean_series({ ...series, x: [...series.x], y: [...series.y] }, {
      bounds: { min: 0, max: 20, mode: `null` },
      in_place: false,
    })
    expect(Number.isNaN(nullMode.series.y[0])).toBe(true)
    expect(Number.isNaN(nullMode.series.y[4])).toBe(true)
  })

  it.each([
    { type: `moving_avg` as const, window: 3 },
    { type: `gaussian` as const, window: 5, sigma: 1 },
  ])(`applies $type smoothing`, ({ type, window, sigma }) => {
    const y = [0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10, 0, 10]
    const series: DataSeries = { x: y.map((_, i) => i), y }
    const result = clean_series(series, {
      smooth: { type, window, sigma },
      in_place: false,
    })
    const orig_var = y.reduce((s, v) => s + (v - 5) ** 2, 0) / y.length
    const smooth_var = result.series.y.reduce((s, v) => s + (v - 5) ** 2, 0) /
      result.series.y.length
    expect(smooth_var).toBeLessThan(orig_var)
  })

  it.each([
    { mode: `mark_unstable` as const, shouldTruncate: false },
    { mode: `hard_cut` as const, shouldTruncate: true },
  ])(`handles instability with $mode truncation mode`, ({ mode, shouldTruncate }) => {
    const { x, y } = generate_unstable_data(40, 40, 0.3)
    const result = clean_series({ x, y }, {
      oscillation_threshold: 2.0,
      truncation_mode: mode,
      in_place: false,
    })

    expect(result.quality.oscillation_detected).toBe(true)
    expect(typeof result.quality.oscillation_score).toBe(`number`)
    if (shouldTruncate) {
      expect(result.quality.truncated_at_x).toBeDefined()
      expect(result.series.x.length).toBeLessThan(80)
    } else {
      expect(result.quality.stable_range).toBeDefined()
      expect(result.series.x.length).toBe(80)
    }
  })

  it(`respects in_place option`, () => {
    const series: DataSeries = { x: [0, 1, 2, 3, 4], y: [0, NaN, 4, 6, 8] }

    const in_place_result = clean_series(series, { invalid_values: `interpolate` })
    expect(in_place_result.series).toBe(series)
    expect(series.y[1]).toBeCloseTo(2, 5)

    const copy_series: DataSeries = { x: [0, 1, 2], y: [0, NaN, 4] }
    const copy_result = clean_series(copy_series, {
      invalid_values: `interpolate`,
      in_place: false,
    })
    expect(copy_result.series).not.toBe(copy_series)
    expect(Number.isNaN(copy_series.y[1])).toBe(true)
  })

  it(`handles propagate mode for invalid values`, () => {
    const result = clean_series(
      { x: [0, 1, 2, 3, 4], y: [0, NaN, 4, Infinity, 8] },
      { invalid_values: `propagate`, in_place: false },
    )
    expect(result.series.x.length).toBe(5)
    expect(Number.isNaN(result.series.y[1])).toBe(true)
    expect(result.series.y[3]).toBe(Infinity)
    expect(result.quality.points_removed).toBe(0)
  })
})

describe(`clean_multi_series`, () => {
  it(`cleans multiple y-series independently`, () => {
    const result = clean_multi_series(
      [0, 1, 2, 3, 4],
      [[0, NaN, 4, 6, 8], [10, 12, NaN, 16, 18]],
      { invalid_values: `interpolate` },
    )
    expect(result.cleaned_y.length).toBe(2)
    expect(result.quality[0].invalid_values_found).toBe(1)
    expect(result.quality[1].invalid_values_found).toBe(1)
  })

  it.each([
    { y_series: [] as number[][], desc: `empty array` },
    { y_series: [[NaN, 2, 4]], desc: `single series` },
  ])(`handles $desc`, ({ y_series }) => {
    const result = clean_multi_series([0, 1, 2], y_series, {
      invalid_values: `interpolate`,
    })
    expect(result.cleaned_y.length).toBe(y_series.length)
    expect(result.quality.length).toBe(y_series.length)
  })

  it(`applies bounds to all series`, () => {
    const result = clean_multi_series([0, 1, 2], [[-5, 5, 15], [0, 10, 20]], {
      bounds: { min: 0, max: 10, mode: `clamp` },
    })
    expect(result.cleaned_y[0]).toEqual([0, 5, 10])
    expect(result.cleaned_y[1]).toEqual([0, 10, 10])
  })

  // Regression test: x and all cleaned_y must have same length after filtering
  it(`maintains x and y alignment when filtering removes points`, () => {
    // NaN at different positions in each y series
    const result = clean_multi_series(
      [0, 1, 2, 3, 4],
      [[0, NaN, 4, 6, 8], [10, 12, NaN, 16, 18]],
      { invalid_values: `remove` },
    )
    // Both NaN positions removed - only indices 0, 3, 4 should remain
    expect(result.x.length).toBe(3)
    expect(result.cleaned_y[0].length).toBe(result.x.length)
    expect(result.cleaned_y[1].length).toBe(result.x.length)
    // Verify correct values remain aligned
    expect(result.x).toEqual([0, 3, 4])
    expect(result.cleaned_y[0]).toEqual([0, 6, 8])
    expect(result.cleaned_y[1]).toEqual([10, 16, 18])
  })

  it(`filter mode bounds removes points consistently across all series`, () => {
    const result = clean_multi_series(
      [0, 1, 2, 3, 4],
      [[-10, 5, 10, 15, 100], [0, 5, 10, 15, 20]],
      { bounds: { min: 0, max: 20, mode: `filter` } },
    )
    // First series: -10 and 100 out of bounds -> indices 1, 2, 3 kept
    // All series filtered to intersection of valid indices
    expect(result.x.length).toBe(3)
    expect(result.cleaned_y[0].length).toBe(result.x.length)
    expect(result.cleaned_y[1].length).toBe(result.x.length)
    expect(result.x).toEqual([1, 2, 3])
  })
})

describe(`clean_xyz`, () => {
  it(`cleans 3D correlated data with interpolation`, () => {
    const result = clean_xyz([0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, NaN, 4, 6, 8], {
      invalid_values: `interpolate`,
    })
    expect(result.x.length).toBe(5)
    expect(result.y.length).toBe(5)
    expect(result.z.length).toBe(5)
  })

  it.each([`x`, `y`, `z`] as const)(`respects primary_axis=%s option`, (axis) => {
    const result = clean_xyz([0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], {
      primary_axis: axis,
    })
    expect(result.x.length).toBe(5)
    expect(result.quality).toBeDefined()
  })

  it(`handles empty inputs and mismatched lengths`, () => {
    const empty = clean_xyz([], [], [])
    expect(empty.x).toEqual([])

    const mismatch = clean_xyz([0, 1, 2, 3, 4], [0, 1, 2], [0, 1, 2, 3])
    expect(mismatch.x.length).toBeLessThanOrEqual(3)
  })

  // Regression test: all three arrays must remain aligned after filtering
  it(`maintains x/y/z alignment when removing invalid values`, () => {
    // NaN at position 2 in z only - should remove that index from all arrays
    const result = clean_xyz(
      [0, 1, 2, 3, 4],
      [10, 11, 12, 13, 14],
      [100, 101, NaN, 103, 104],
      { invalid_values: `remove` },
    )
    expect(result.x.length).toBe(4)
    expect(result.y.length).toBe(result.x.length)
    expect(result.z.length).toBe(result.x.length)
    // Verify correct values at correct positions
    expect(result.x).toEqual([0, 1, 3, 4])
    expect(result.y).toEqual([10, 11, 13, 14])
    expect(result.z).toEqual([100, 101, 103, 104])
  })

  it(`filters all arrays when NaN appears in any coordinate`, () => {
    // NaN in different positions across x, y, z
    const result = clean_xyz(
      [0, NaN, 2, 3, 4],
      [10, 11, NaN, 13, 14],
      [100, 101, 102, NaN, 104],
      { invalid_values: `remove` },
    )
    // Only indices 0 and 4 are valid across all three arrays
    expect(result.x.length).toBe(2)
    expect(result.y.length).toBe(2)
    expect(result.z.length).toBe(2)
    expect(result.x).toEqual([0, 4])
    expect(result.y).toEqual([10, 14])
    expect(result.z).toEqual([100, 104])
  })
})

describe(`clean_trajectory_props`, () => {
  it(`cleans multiple named properties with custom independent axis`, () => {
    const result = clean_trajectory_props(
      {
        Step: [0, 1, 2, 3, 4],
        energy: [10, NaN, 30, 40, 50],
        volume: [100, 110, NaN, 130, 140],
      },
      { invalid_values: `interpolate`, independent_axis: `Step` },
    )
    expect(Object.keys(result.props)).toEqual([`Step`, `energy`, `volume`])
    expect(result.quality.energy.invalid_values_found).toBe(1)
    expect(result.quality.volume.invalid_values_found).toBe(1)
  })

  it(`uses Step as default and handles missing independent axis`, () => {
    const with_step = clean_trajectory_props({ Step: [0, 1, 2], energy: [10, 20, 30] })
    expect(with_step.props.Step).toEqual([0, 1, 2])

    const without_step = clean_trajectory_props({
      energy: [10, 20, 30],
      volume: [100, 110, 120],
    })
    expect(Object.keys(without_step.props)).toContain(`energy`)
  })

  it(`handles empty props and applies smoothing`, () => {
    expect(clean_trajectory_props({}).props).toEqual({})

    const smoothed = clean_trajectory_props(
      { Step: [0, 1, 2, 3, 4, 5, 6], energy: [0, 10, 0, 10, 0, 10, 0] },
      { smooth: { type: `moving_avg`, window: 3 } },
    )
    const orig_range = 10 - 0
    const smooth_range = Math.max(...smoothed.props.energy) -
      Math.min(...smoothed.props.energy)
    expect(smooth_range).toBeLessThan(orig_range)
  })

  // Regression test: all properties including independent axis must have same length
  it(`maintains all property lengths in sync when filtering`, () => {
    // NaN at different positions in different properties
    const result = clean_trajectory_props(
      {
        Step: [0, 1, 2, 3, 4],
        energy: [10, NaN, 30, 40, 50],
        volume: [100, 110, NaN, 130, 140],
        pressure: [1, 2, 3, NaN, 5],
      },
      { invalid_values: `remove`, independent_axis: `Step` },
    )
    // Only indices 0 and 4 are valid across all properties
    const expected_len = 2
    expect(result.props.Step.length).toBe(expected_len)
    expect(result.props.energy.length).toBe(expected_len)
    expect(result.props.volume.length).toBe(expected_len)
    expect(result.props.pressure.length).toBe(expected_len)
    // Verify correct values remain
    expect(result.props.Step).toEqual([0, 4])
    expect(result.props.energy).toEqual([10, 50])
    expect(result.props.volume).toEqual([100, 140])
    expect(result.props.pressure).toEqual([1, 5])
  })

  it(`filters independent axis together with other properties`, () => {
    // NaN in Step (independent axis) should also trigger filtering
    const result = clean_trajectory_props(
      {
        Step: [0, NaN, 2, 3, 4],
        energy: [10, 20, 30, 40, 50],
      },
      { invalid_values: `remove`, independent_axis: `Step` },
    )
    expect(result.props.Step.length).toBe(4)
    expect(result.props.energy.length).toBe(4)
    expect(result.props.Step).toEqual([0, 2, 3, 4])
    expect(result.props.energy).toEqual([10, 30, 40, 50])
  })
})

describe(`Performance`, () => {
  it.each([
    { length: 100000, smooth: { type: `moving_avg` as const, window: 11 }, maxMs: 500 },
    {
      length: 10000,
      smooth: { type: `savgol` as const, window: 11, polynomial_order: 3 },
      maxMs: 2000,
    },
  ])(
    `handles $length points with $smooth.type in <$maxMs ms`,
    ({ length, smooth, maxMs }) => {
      const { x, y } = generate_linear_data(length, 0.1, 0.01)
      const start = performance.now()
      const result = clean_series({ x, y }, { smooth, in_place: false })
      expect(result.series.x.length).toBe(length)
      expect(performance.now() - start).toBeLessThan(maxMs)
    },
  )
})

describe(`Type Exports`, () => {
  it(`exports all cleaning types correctly`, () => {
    // CleaningConfig
    const config: CleaningConfig = {
      oscillation_threshold: 2.0,
      window_size: 5,
      in_place: false,
    }
    expect(config.oscillation_threshold).toBe(2.0)

    // PhysicalBounds
    const bounds: PhysicalBounds = { min: 0, max: (x) => x * 2, mode: `clamp` }
    expect(typeof bounds.max).toBe(`function`)

    // OscillationWeights
    const weights: OscillationWeights = {
      derivative_variance: 1.0,
      amplitude_growth: 0.5,
      sign_changes: 0.3,
    }
    expect(weights.derivative_variance).toBe(1.0)

    // SmoothingConfig
    const smooth: SmoothingConfig = { type: `savgol`, window: 11, polynomial_order: 3 }
    expect(smooth.type).toBe(`savgol`)

    // CleaningResult & CleaningQuality
    const result: CleaningResult = {
      series: { x: [], y: [] },
      quality: {
        points_removed: 0,
        invalid_values_found: 0,
        oscillation_detected: false,
        bounds_violations: 0,
      },
    }
    expect(result.quality.points_removed).toBe(0)

    // InstabilityResult
    const instability: InstabilityResult = {
      detected: true,
      onset_index: 50,
      onset_x: 50.5,
      combined_score: 2.3,
      method_scores: {
        derivative_variance: 1.5,
        amplitude_growth: 2.0,
        sign_changes: 1.2,
      },
    }
    expect(instability.detected).toBe(true)

    // Mode types
    const invalid_modes: InvalidValueMode[] = [`remove`, `propagate`, `interpolate`]
    const trunc_modes: TruncationMode[] = [`hard_cut`, `mark_unstable`]
    expect(invalid_modes).toContain(`remove`)
    expect(trunc_modes).toContain(`hard_cut`)
  })
})

describe(`Edge Cases`, () => {
  it.each([
    { x: [0], y: [10], desc: `single point`, expectedLen: 1 },
    { x: [0, 1, 2], y: [NaN, NaN, NaN], desc: `all-NaN`, expectedLen: 0 },
    {
      x: [0, 1, 2],
      y: [Infinity, -Infinity, Infinity],
      desc: `all-Infinity`,
      expectedLen: 0,
    },
    {
      x: [0, 1, 2, 3, 4],
      y: [NaN, 1, 2, 3, NaN],
      desc: `NaN at boundaries`,
      expectedLen: 3,
    },
  ])(`handles $desc`, ({ x, y, expectedLen }) => {
    const result = clean_series({ x, y }, { invalid_values: `remove`, in_place: false })
    expect(result.series.x.length).toBe(expectedLen)
  })

  it(`preserves color_values and size_values during filtering`, () => {
    const result = clean_series({
      x: [0, 1, 2, 3, 4],
      y: [0, NaN, 4, 6, 8],
      color_values: [1, 2, 3, 4, 5],
      size_values: [10, 20, 30, 40, 50],
    }, { invalid_values: `remove`, in_place: false })

    expect(result.series.color_values).toEqual([1, 3, 4, 5])
    expect(result.series.size_values).toEqual([10, 30, 40, 50])
  })

  it(`handles null color_values`, () => {
    const result = clean_series({ x: [0, 1, 2], y: [0, NaN, 4], color_values: null }, {
      invalid_values: `remove`,
      in_place: false,
    })
    expect(result.series.color_values).toBeNull()
  })

  it(`combines multiple cleaning operations`, () => {
    const result = clean_series(
      { x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], y: [-10, NaN, 5, 10, 15, 100, 8, 6, 4, 2] },
      {
        invalid_values: `remove`,
        bounds: { min: 0, max: 20, mode: `clamp` },
        smooth: { type: `moving_avg`, window: 3 },
        in_place: false,
      },
    )
    expect(result.series.x.length).toBe(9)
    expect(result.quality.invalid_values_found).toBe(1)
    expect(result.quality.bounds_violations).toBeGreaterThan(0)
  })

  it(`handles very large datasets without stack overflow`, () => {
    const length = 50000
    const x = Array.from({ length }, (_, i) => i)
    const y = x.map((v) => Math.sin(v / 100) * 10)
    const result = clean_series({ x, y }, {
      bounds: { min: -5, max: 5, mode: `clamp` },
      in_place: false,
    })
    expect(result.series.x.length).toBe(length)
    expect(result.quality.bounds_violations).toBeGreaterThan(0)
  })
})
