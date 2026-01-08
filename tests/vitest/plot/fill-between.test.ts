// Tests for fill-between: utility functions and type structures
import type { Vec2 } from '$lib/math'
import {
  apply_range_constraints,
  apply_where_condition,
  clamp_for_log_scale,
  convert_error_band_to_fill_region,
  generate_fill_path,
  interpolate_series,
  is_fill_gradient,
  LOG_EPSILON,
  resolve_boundary,
  resolve_series_ref,
} from '$lib/plot/fill-utils'
import type {
  DataSeries,
  FillBoundary,
  FillEdgeStyle,
  FillGradient,
  FillHandlerEvent,
  FillHoverStyle,
  FillRegion,
  LegendItem,
} from '$lib/plot/types'
import { FILL_CURVE_TYPES } from '$lib/plot/types'
import { describe, expect, it } from 'vitest'

// Interpolation tests
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

// Boundary resolution tests
describe(`resolve_series_ref`, () => {
  const mock_series: DataSeries[] = [
    { x: [1, 2, 3], y: [10, 20, 30], id: `series-a` },
    { x: [1, 2, 3], y: [5, 15, 25], id: `series-b` },
    { x: [1, 2, 3], y: [100, 200, 300] },
  ]

  it.each([
    [`by index`, { type: `series` as const, series_idx: 1 }, `series-b`],
    [`by string id`, { type: `series` as const, series_id: `series-a` }, `series-a`],
  ])(`resolves series %s`, (_, ref, expected_id) => {
    expect(resolve_series_ref(ref, mock_series)?.id).toBe(expected_id)
  })

  it.each([
    [`invalid index`, { type: `series` as const, series_idx: 99 }],
    [`non-existent id`, { type: `series` as const, series_id: `non-existent` }],
    [`negative index`, { type: `series` as const, series_idx: -1 }],
  ])(`returns null for %s`, (_, ref) => {
    expect(resolve_series_ref(ref, mock_series)).toBeNull()
  })
})

describe(`resolve_boundary`, () => {
  const mock_series: DataSeries[] = [{ x: [1, 2, 3], y: [10, 20, 30], id: `test` }]
  const x_values = [1, 2, 3]
  const scales = {
    x_scale: (val: number) => val * 10,
    y_scale: (val: number) => val * 10,
    x_domain: [1, 3] as Vec2,
    y_domain: [0, 100] as Vec2,
  }

  it.each([
    [`number shorthand`, 42 as FillBoundary, [42, 42, 42]],
    [`constant`, { type: `constant`, value: 50 } as FillBoundary, [50, 50, 50]],
    [`series`, { type: `series`, series_idx: 0 } as FillBoundary, [10, 20, 30]],
    [`function`, { type: `function`, fn: (c: number) => c * 5 } as FillBoundary, [
      5,
      10,
      15,
    ]],
    [`data`, { type: `data`, values: [100, 200, 300] } as FillBoundary, [100, 200, 300]],
    [`axis`, { type: `axis`, axis: `y`, value: 0 } as FillBoundary, [0, 0, 0]],
  ])(`resolves %s boundary`, (_, boundary, expected) => {
    expect(resolve_boundary(boundary, mock_series, x_values, scales)).toEqual(expected)
  })

  it(`returns null for unresolvable series reference`, () => {
    expect(
      resolve_boundary({ type: `series`, series_idx: 99 }, mock_series, x_values, scales),
    ).toBeNull()
  })
})

describe(`apply_range_constraints`, () => {
  it(`filters points outside x_range`, () => {
    const x_values = [1, 2, 3, 4, 5]
    const y1_values = [10, 20, 30, 40, 50]
    const y2_values = [5, 15, 25, 35, 45]
    const region = { x_range: [2, 4] as Vec2 }

    const result = apply_range_constraints(x_values, y1_values, y2_values, region)

    expect(result.x).toEqual([2, 3, 4])
    expect(result.y1).toEqual([20, 30, 40])
    expect(result.y2).toEqual([15, 25, 35])
  })

  it(`clamps y values to y_range`, () => {
    const x_values = [1, 2, 3]
    const y1_values = [10, 50, 90]
    const y2_values = [5, 40, 80]
    const region = { y_range: [20, 60] as Vec2 }

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
    const region = { x_range: [2, 4] as Vec2 }

    const result = apply_range_constraints(x_values, y1_values, y2_values, region)

    expect(result.original_indices).toEqual([1, 2, 3])
  })
})

// Where condition tests
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
  it(`clamps non-positive y values for log scale and tracks indices`, () => {
    const result = clamp_for_log_scale([1, 2, 3], [10, -5, 0], [20, 0, 5], `log`)

    expect(result.y1).toEqual([10, LOG_EPSILON, LOG_EPSILON])
    expect(result.y2).toEqual([20, LOG_EPSILON, 5])
    expect(result.clamped_indices).toContain(1)
  })

  it(`clamps non-positive x values when x-axis is log`, () => {
    const result = clamp_for_log_scale(
      [-1, 0, 1],
      [10, 20, 30],
      [5, 15, 25],
      `linear`,
      `log`,
    )
    expect(result.x).toEqual([LOG_EPSILON, LOG_EPSILON, 1])
  })

  it(`leaves values unchanged for linear scale`, () => {
    const result = clamp_for_log_scale([1, 2, 3], [10, -5, 0], [20, 0, 5], `linear`)
    expect(result.y1).toEqual([10, -5, 0])
    expect(result.clamped_indices).toEqual([])
  })
})

// Path generation tests
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
  const mock_series: DataSeries[] = [{ x: [1, 2, 3], y: [10, 20, 30], id: `test-series` }]
  const base_ref = { type: `series` as const, series_idx: 0 }

  it.each([
    [`symmetric constant`, { error: 5 }, [15, 25, 35], [5, 15, 25]],
    [`symmetric per-point`, { error: [1, 2, 3] }, [11, 22, 33], [9, 18, 27]],
    [`asymmetric`, { error: { upper: 10, lower: 5 } }, [20, 30, 40], [5, 15, 25]],
  ])(`converts %s error`, (_, extra, upper, lower) => {
    const result = convert_error_band_to_fill_region(
      { series: base_ref, ...extra },
      mock_series,
    )
    expect(result?.upper).toEqual({ type: `data`, values: upper })
    expect(result?.lower).toEqual({ type: `data`, values: lower })
  })

  it(`uses provided fill color and opacity`, () => {
    const result = convert_error_band_to_fill_region(
      { series: base_ref, error: 5, fill: `#ff0000`, fill_opacity: 0.5 },
      mock_series,
    )
    expect(result).toMatchObject({ fill: `#ff0000`, fill_opacity: 0.5 })
  })

  it(`returns null for invalid series reference`, () => {
    expect(
      convert_error_band_to_fill_region(
        { series: { type: `series`, series_idx: 99 }, error: 5 },
        mock_series,
      ),
    ).toBeNull()
  })

  it(`resolves series by id and includes label/id`, () => {
    const result = convert_error_band_to_fill_region(
      {
        series: { type: `series`, series_id: `test-series` },
        error: 5,
        id: `eb-1`,
        label: `Error`,
      },
      mock_series,
    )
    expect(result).toMatchObject({ id: `eb-1`, label: `Error` })
  })
})

describe(`is_fill_gradient`, () => {
  it.each<[string, unknown, boolean]>([
    [`linear gradient`, { type: `linear`, stops: [[0, `red`], [1, `blue`]] }, true],
    [`radial gradient`, { type: `radial`, stops: [[0, `white`], [1, `black`]] }, true],
    [`string color`, `steelblue`, false],
    [`undefined`, undefined, false],
    [`null`, null, false],
    [`object without type`, { stops: [[0, `red`]] }, false],
    [`object without stops`, { type: `linear` }, false],
  ])(`%s → %s`, (_, value, expected) => {
    expect(is_fill_gradient(value as string | FillGradient | undefined)).toBe(expected)
  })
})

// Type structure validation tests
describe(`FILL_CURVE_TYPES`, () => {
  it(`contains exactly 10 expected curve types`, () => {
    expect(FILL_CURVE_TYPES).toEqual([
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
    ])
  })
})

describe(`Fill type structures`, () => {
  it.each<[string, FillBoundary, Record<string, unknown>]>([
    [`number shorthand`, 42, {}],
    [`series reference`, { type: `series`, series_idx: 0 }, { type: `series` }],
    [`constant`, { type: `constant`, value: 50 }, { type: `constant` }],
    [`function`, { type: `function`, fn: (x: number) => x * 2 }, { type: `function` }],
  ])(`FillBoundary accepts %s`, (_, boundary, expected_match) => {
    if (Object.keys(expected_match).length > 0) {
      expect(boundary).toMatchObject(expected_match)
    }
    // Function boundary executes correctly
    if (typeof boundary === `object` && boundary.type === `function`) {
      expect(boundary.fn(5)).toBe(10)
    }
  })

  it.each<[string, FillGradient]>([
    [`linear`, { type: `linear`, angle: 45, stops: [[0, `red`], [1, `blue`]] }],
    [`radial`, {
      type: `radial`,
      center: { x: 0.5, y: 0.5 },
      stops: [[0, `white`], [1, `black`]],
    }],
  ])(`FillGradient supports %s type`, (type, gradient) => {
    expect(gradient.type).toBe(type)
    expect(gradient.stops.length).toBe(2)
  })

  it(`FillEdgeStyle and FillHoverStyle work correctly`, () => {
    const empty_edge: FillEdgeStyle = {}
    expect(empty_edge.color).toBeUndefined()

    const hover: FillHoverStyle = { fill: `orange`, edge: { color: `red`, width: 2 } }
    expect(hover.edge?.color).toBe(`red`)
  })

  it(`FillHandlerEvent contains required fields`, () => {
    const event: FillHandlerEvent = {
      event: new MouseEvent(`click`),
      region_idx: 0,
      x: 10,
      y: 20,
      px: 100,
      py: 200,
    }
    expect(event).toMatchObject({ region_idx: 0, x: 10, px: 100 })
  })

  it(`FillRegion accepts minimal and full configurations`, () => {
    const minimal: FillRegion = { upper: { type: `series`, series_idx: 0 }, lower: 0 }
    expect(minimal.upper).toMatchObject({ type: `series` })

    const full: FillRegion = {
      id: `test`,
      label: `Test Region`,
      upper: { type: `data`, values: [1, 2, 3] },
      lower: { type: `constant`, value: 0 },
      x_range: [0, 10],
      y_range: [null, 100],
      where: (_x, y1, y2) => y1 > y2,
      fill: { type: `linear`, stops: [[0, `red`], [1, `blue`]] },
      fill_opacity: 0.5,
      curve: `monotoneX`,
      z_index: `below-lines`,
      visible: true,
      hover_style: { cursor: `pointer` },
      show_in_legend: true,
      metadata: { custom: `data` },
    }
    expect(full).toMatchObject({ id: `test`, curve: `monotoneX`, z_index: `below-lines` })
  })

  it(`LegendItem supports series and fill item types`, () => {
    const series: LegendItem = {
      label: `S`,
      visible: true,
      series_idx: 0,
      display_style: { symbol_type: `Circle` },
    }
    expect(series.item_type).toBeUndefined()

    const fill: LegendItem = {
      label: `F`,
      visible: true,
      series_idx: -1,
      item_type: `fill`,
      fill_idx: 0,
      display_style: { fill_color: `steelblue`, fill_opacity: 0.3, edge_color: `navy` },
    }
    expect(fill).toMatchObject({ item_type: `fill`, fill_idx: 0 })
    expect(fill.display_style.fill_color).toBe(`steelblue`)
  })
})
