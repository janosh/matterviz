// Tests for fill-utils.ts - fill region utility functions
import { describe, expect, it } from 'vitest'

import {
  apply_range_constraints,
  apply_where_condition,
  clamp_for_log_scale,
  convert_error_band_to_fill_region,
  generate_fill_path,
  interpolate_series,
  LOG_EPSILON,
  resolve_boundary,
  resolve_series_ref,
} from '$lib/plot/fill-utils'
import type { DataSeries, ErrorBand, FillBoundary } from '$lib/plot/types'

// C13: Interpolation tests
describe(`interpolate_series`, () => {
  it(`handles identical x-values`, () => {
    const series_a = { x: [1, 2, 3], y: [10, 20, 30] }
    const series_b = { x: [1, 2, 3], y: [5, 15, 25] }
    const result = interpolate_series(series_a, series_b)

    expect(result.x).toEqual([1, 2, 3])
    expect(result.y_a).toEqual([10, 20, 30])
    expect(result.y_b).toEqual([5, 15, 25])
  })

  it(`interpolates mismatched x-values with linear interpolation`, () => {
    const series_a = { x: [1, 3], y: [10, 30] }
    const series_b = { x: [1, 2, 3], y: [5, 15, 25] }
    const result = interpolate_series(series_a, series_b)

    expect(result.x).toEqual([1, 2, 3])
    expect(result.y_a[0]).toBe(10)
    expect(result.y_a[1]).toBeCloseTo(20) // interpolated
    expect(result.y_a[2]).toBe(30)
    expect(result.y_b).toEqual([5, 15, 25])
  })

  it(`handles non-overlapping ranges with extrapolation`, () => {
    const series_a = { x: [1, 2], y: [10, 20] }
    const series_b = { x: [3, 4], y: [30, 40] }
    const result = interpolate_series(series_a, series_b)

    // Should use nearest value for extrapolation
    expect(result.x).toEqual([1, 2, 3, 4])
    // series_a extrapolates last value for x=3,4
    expect(result.y_a[2]).toBe(20) // extrapolated from last value
    expect(result.y_a[3]).toBe(20)
    // series_b extrapolates first value for x=1,2
    expect(result.y_b[0]).toBe(30) // extrapolated from first value
    expect(result.y_b[1]).toBe(30)
  })

  it(`handles step interpolation mode`, () => {
    const series_a = { x: [1, 3], y: [10, 30] }
    const series_b = { x: [1, 2, 3], y: [5, 15, 25] }
    const result = interpolate_series(series_a, series_b, `step`)

    expect(result.x).toEqual([1, 2, 3])
    // Step interpolation holds previous value
    expect(result.y_a[1]).toBe(10) // step holds value at x=1
  })

  it(`handles empty series`, () => {
    const series_a = { x: [], y: [] }
    const series_b = { x: [1, 2], y: [10, 20] }
    const result = interpolate_series(series_a, series_b)

    expect(result.x).toEqual([1, 2])
  })

  it(`handles single point series`, () => {
    const series_a = { x: [2], y: [20] }
    const series_b = { x: [1, 2, 3], y: [10, 20, 30] }
    const result = interpolate_series(series_a, series_b)

    expect(result.x).toEqual([1, 2, 3])
    expect(result.y_a[0]).toBe(20) // extrapolated
    expect(result.y_a[1]).toBe(20) // exact match
    expect(result.y_a[2]).toBe(20) // extrapolated
  })
})

// C14: Boundary resolution tests
describe(`resolve_series_ref`, () => {
  const mock_series: DataSeries[] = [
    { x: [1, 2, 3], y: [10, 20, 30], id: `series-a` },
    { x: [1, 2, 3], y: [5, 15, 25], id: `series-b` },
    { x: [1, 2, 3], y: [100, 200, 300] },
  ]

  it(`resolves series by index`, () => {
    const ref = { type: `series` as const, series_idx: 1 }
    const result = resolve_series_ref(ref, mock_series)
    expect(result?.id).toBe(`series-b`)
  })

  it(`resolves series by string id`, () => {
    const ref = { type: `series` as const, series_id: `series-a` }
    const result = resolve_series_ref(ref, mock_series)
    expect(result?.id).toBe(`series-a`)
  })

  it(`returns null for invalid index`, () => {
    const ref = { type: `series` as const, series_idx: 99 }
    const result = resolve_series_ref(ref, mock_series)
    expect(result).toBeNull()
  })

  it(`returns null for non-existent id`, () => {
    const ref = { type: `series` as const, series_id: `non-existent` }
    const result = resolve_series_ref(ref, mock_series)
    expect(result).toBeNull()
  })

  it(`handles negative index`, () => {
    const ref = { type: `series` as const, series_idx: -1 }
    const result = resolve_series_ref(ref, mock_series)
    expect(result).toBeNull()
  })
})

describe(`resolve_boundary`, () => {
  const mock_series: DataSeries[] = [
    { x: [1, 2, 3], y: [10, 20, 30], id: `test` },
  ]
  const x_values = [1, 2, 3]
  const scales = {
    x_scale: (val: number) => val * 10,
    y_scale: (val: number) => val * 10,
    x_domain: [1, 3] as [number, number],
    y_domain: [0, 100] as [number, number],
  }

  it(`resolves number shorthand to constant`, () => {
    const result = resolve_boundary(42, mock_series, x_values, scales)
    expect(result).toEqual([42, 42, 42])
  })

  it(`resolves constant boundary`, () => {
    const boundary: FillBoundary = { type: `constant`, value: 50 }
    const result = resolve_boundary(boundary, mock_series, x_values, scales)
    expect(result).toEqual([50, 50, 50])
  })

  it(`resolves series boundary`, () => {
    const boundary: FillBoundary = { type: `series`, series_idx: 0 }
    const result = resolve_boundary(boundary, mock_series, x_values, scales)
    expect(result).toEqual([10, 20, 30])
  })

  it(`resolves function boundary`, () => {
    const boundary: FillBoundary = { type: `function`, fn: (coord) => coord * 5 }
    const result = resolve_boundary(boundary, mock_series, x_values, scales)
    expect(result).toEqual([5, 10, 15])
  })

  it(`resolves data boundary`, () => {
    const boundary: FillBoundary = { type: `data`, values: [100, 200, 300] }
    const result = resolve_boundary(boundary, mock_series, x_values, scales)
    expect(result).toEqual([100, 200, 300])
  })

  it(`resolves axis boundary`, () => {
    const boundary: FillBoundary = { type: `axis`, axis: `y`, value: 0 }
    const result = resolve_boundary(boundary, mock_series, x_values, scales)
    expect(result).toEqual([0, 0, 0])
  })

  it(`returns null for unresolvable series reference`, () => {
    const boundary: FillBoundary = { type: `series`, series_idx: 99 }
    const result = resolve_boundary(boundary, mock_series, x_values, scales)
    expect(result).toBeNull()
  })
})

describe(`apply_range_constraints`, () => {
  it(`filters points outside x_range`, () => {
    const x_values = [1, 2, 3, 4, 5]
    const y1_values = [10, 20, 30, 40, 50]
    const y2_values = [5, 15, 25, 35, 45]
    const region = { x_range: [2, 4] as [number, number] }

    const result = apply_range_constraints(x_values, y1_values, y2_values, region)

    expect(result.x).toEqual([2, 3, 4])
    expect(result.y1).toEqual([20, 30, 40])
    expect(result.y2).toEqual([15, 25, 35])
  })

  it(`clamps y values to y_range`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, 50, 90]
    const y2_values = [5, 40, 80]
    const region = { y_range: [20, 60] as [number, number] }

    const result = apply_range_constraints(x_values, y1_values, y2_values, region)

    // Points where fill region completely outside y_range are filtered out
    // Points within or overlapping are kept and clamped
    expect(result.y1.every((val) => val >= 20 && val <= 60)).toBe(true)
    expect(result.y2.every((val) => val >= 20 && val <= 60)).toBe(true)
  })

  it(`handles null range values`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, 20, 30]
    const y2_values = [5, 15, 25]
    const region = { x_range: [null, 2] as [number | null, number | null] }

    const result = apply_range_constraints(x_values, y1_values, y2_values, region)

    expect(result.x).toEqual([1, 2])
  })

  it(`returns original indices for mapping back`, () => {
    const x_values = [1, 2, 3, 4, 5]
    const y1_values = [10, 20, 30, 40, 50]
    const y2_values = [5, 15, 25, 35, 45]
    const region = { x_range: [2, 4] as [number, number] }

    const result = apply_range_constraints(x_values, y1_values, y2_values, region)

    expect(result.original_indices).toEqual([1, 2, 3])
  })
})

// C16: Where condition tests
describe(`apply_where_condition`, () => {
  it(`returns single segment when no condition`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, 20, 30]
    const y2_values = [5, 15, 25]
    const region = {}

    const result = apply_where_condition(x_values, y1_values, y2_values, region)

    expect(result.segments.length).toBe(1)
    expect(result.segments[0].length).toBe(3)
  })

  it(`filters points based on condition`, () => {
    const x_values = [1, 2, 3, 4, 5]
    const y1_values = [10, 20, 30, 40, 50]
    const y2_values = [15, 15, 25, 45, 45]
    // Condition: y1 > y2 (fill only where upper boundary is above lower)
    const region = {
      where: (_x: number, y1: number, y2: number) => y1 > y2,
    }

    const result = apply_where_condition(x_values, y1_values, y2_values, region)

    // Check that all points in segments satisfy condition
    for (const segment of result.segments) {
      for (const point of segment) {
        expect(point.y1).toBeGreaterThan(point.y2)
      }
    }
  })

  it(`creates multiple segments when condition changes`, () => {
    // y1 > y2 only at x=2 and x=4
    const x_values = [1, 2, 3, 4, 5]
    const y1_values = [5, 20, 10, 40, 15]
    const y2_values = [10, 10, 20, 20, 30]
    const region = {
      where: (_x: number, y1: number, y2: number) => y1 > y2,
    }

    const result = apply_where_condition(x_values, y1_values, y2_values, region)

    // Should have multiple segments where condition is true
    expect(result.segments.length).toBeGreaterThan(0)
  })

  it(`interpolates at crossing points`, () => {
    // Linear crossing between x=1 and x=2
    const x_values = [1, 2]
    const y1_values = [5, 15] // crosses y2 at midpoint
    const y2_values = [15, 5]
    const region = {
      where: (_x: number, y1: number, y2: number) => y1 > y2,
    }

    const result = apply_where_condition(x_values, y1_values, y2_values, region)

    // Should have at least one segment with an interpolated crossing point
    expect(result.segments.length).toBeGreaterThanOrEqual(1)
    // The first segment should start at or after the crossing
    if (result.segments.length > 0 && result.segments[0].length > 0) {
      const first_point = result.segments[0][0]
      expect(first_point.x).toBeGreaterThanOrEqual(1)
      expect(first_point.x).toBeLessThanOrEqual(2)
    }
  })
})

describe(`clamp_for_log_scale`, () => {
  it(`clamps non-positive y values for log scale`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, -5, 0]
    const y2_values = [20, 0, 5]

    const result = clamp_for_log_scale(x_values, y1_values, y2_values, `log`)

    expect(result.y1[0]).toBe(10) // unchanged
    expect(result.y1[1]).toBe(LOG_EPSILON) // clamped
    expect(result.y1[2]).toBe(LOG_EPSILON) // clamped
    expect(result.y2[0]).toBe(20) // unchanged
    expect(result.y2[1]).toBe(LOG_EPSILON) // clamped
    expect(result.y2[2]).toBe(5) // unchanged
  })

  it(`clamps non-positive x values when x-axis is log`, () => {
    const x_values = [-1, 0, 1]
    const y1_values = [10, 20, 30]
    const y2_values = [5, 15, 25]

    const result = clamp_for_log_scale(x_values, y1_values, y2_values, `linear`, `log`)

    expect(result.x[0]).toBe(LOG_EPSILON) // clamped
    expect(result.x[1]).toBe(LOG_EPSILON) // clamped
    expect(result.x[2]).toBe(1) // unchanged
  })

  it(`tracks clamped indices`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, -5, 30]
    const y2_values = [20, 15, 25]

    const result = clamp_for_log_scale(x_values, y1_values, y2_values, `log`)

    expect(result.clamped_indices).toContain(1)
  })

  it(`leaves values unchanged for linear scale`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, -5, 0]
    const y2_values = [20, 0, 5]

    const result = clamp_for_log_scale(x_values, y1_values, y2_values, `linear`)

    expect(result.y1).toEqual([10, -5, 0])
    expect(result.y2).toEqual([20, 0, 5])
    expect(result.clamped_indices).toEqual([])
  })
})

// C15: Path generation tests
describe(`generate_fill_path`, () => {
  it(`generates valid SVG path for linear curve`, () => {
    const data = [
      { x: 0, y1: 0, y2: 10 },
      { x: 100, y1: 0, y2: 10 },
    ]
    const path = generate_fill_path(data, `linear`)

    expect(path).toMatch(/^M/) // starts with moveto
    expect(path).toMatch(/Z$/) // ends with closepath
    expect(path.length).toBeGreaterThan(0)
  })

  it(`returns empty string for empty data`, () => {
    const path = generate_fill_path([], `linear`)
    expect(path).toBe(``)
  })

  it(`generates path for monotoneX curve`, () => {
    const data = [
      { x: 0, y1: 0, y2: 10 },
      { x: 50, y1: 5, y2: 15 },
      { x: 100, y1: 0, y2: 10 },
    ]
    const path = generate_fill_path(data, `monotoneX`)

    expect(path).toMatch(/^M/)
    expect(path).toMatch(/Z$/)
    // monotoneX uses cubic curves, so should contain C commands
    expect(path).toContain(`C`)
  })

  it(`generates path for step curve`, () => {
    const data = [
      { x: 0, y1: 0, y2: 10 },
      { x: 50, y1: 0, y2: 20 },
      { x: 100, y1: 0, y2: 10 },
    ]
    const path = generate_fill_path(data, `step`)

    expect(path).toMatch(/^M/)
    expect(path).toMatch(/Z$/)
  })

  it.each(
    [
      `linear`,
      `monotoneX`,
      `monotoneY`,
      `step`,
      `stepBefore`,
      `stepAfter`,
      `basis`,
      `cardinal`,
      `catmullRom`,
      `natural`,
    ] as const,
  )(`supports %s curve type`, (curve_type) => {
    const data = [
      { x: 0, y1: 0, y2: 10 },
      { x: 50, y1: 5, y2: 15 },
      { x: 100, y1: 0, y2: 10 },
    ]
    const path = generate_fill_path(data, curve_type)

    expect(path.length).toBeGreaterThan(0)
    expect(path).toMatch(/^M/)
  })
})

describe(`convert_error_band_to_fill_region`, () => {
  const mock_series: DataSeries[] = [
    { x: [1, 2, 3], y: [10, 20, 30], id: `test-series` },
  ]

  it(`converts symmetric constant error`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_idx: 0 },
      error: 5,
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result).not.toBeNull()
    expect(result?.upper).toEqual({ type: `data`, values: [15, 25, 35] })
    expect(result?.lower).toEqual({ type: `data`, values: [5, 15, 25] })
  })

  it(`converts symmetric per-point error`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_idx: 0 },
      error: [1, 2, 3],
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result).not.toBeNull()
    expect(result?.upper).toEqual({ type: `data`, values: [11, 22, 33] })
    expect(result?.lower).toEqual({ type: `data`, values: [9, 18, 27] })
  })

  it(`converts asymmetric error`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_idx: 0 },
      error: { upper: 10, lower: 5 },
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result).not.toBeNull()
    expect(result?.upper).toEqual({ type: `data`, values: [20, 30, 40] })
    expect(result?.lower).toEqual({ type: `data`, values: [5, 15, 25] })
  })

  it(`uses provided fill color`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_idx: 0 },
      error: 5,
      fill: `#ff0000`,
      fill_opacity: 0.5,
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result?.fill).toBe(`#ff0000`)
    expect(result?.fill_opacity).toBe(0.5)
  })

  it(`returns null for invalid series reference`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_idx: 99 },
      error: 5,
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result).toBeNull()
  })

  it(`resolves series by id`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_id: `test-series` },
      error: 5,
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result).not.toBeNull()
  })

  it(`includes label and id from error band`, () => {
    const error_band: ErrorBand = {
      series: { type: `series`, series_idx: 0 },
      error: 5,
      id: `error-band-1`,
      label: `Error Range`,
    }

    const result = convert_error_band_to_fill_region(error_band, mock_series)

    expect(result?.id).toBe(`error-band-1`)
    expect(result?.label).toBe(`Error Range`)
  })
})
