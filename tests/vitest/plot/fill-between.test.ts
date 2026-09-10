// Tests for fill-between: utility functions and type structures
import type { Vec2 } from '$lib/math'
import type { Pt } from '$lib/plot/core/fill-utils'
import {
  compute_fill_segments,
  convert_error_band_to_fill_region,
  generate_fill_path,
  is_fill_gradient,
  monotone_interpolate,
  resolve_boundary_points,
  resolve_series_ref,
} from '$lib/plot/core/fill-utils'
import type {
  DataSeries,
  FillBoundary,
  FillCurveType,
  FillGradient,
  FillRegion,
} from '$lib/plot/core/types'
import { curveMonotoneX, line } from 'd3-shape'
import { describe, expect, it } from 'vitest'

const make_point = (x_value: number, y_value: number): Pt => ({ x: x_value, y: y_value })
const series_ref = (series_idx: number) => ({ type: `series` as const, series_idx })

// Reproduce the exact generator Line.svelte uses for series lines
const series_line = (pts: readonly Pt[]): string =>
  line<Pt>()
    .x((point) => point.x)
    .y((point) => point.y)
    .curve(curveMonotoneX)(pts as Pt[]) ?? ``

const domains = { x_domain: [0, 20] as Vec2, y_domain: [0, 100] as Vec2 }

// trace a fill region to its SVG path and report whether it contains a cubic Bézier (spline `C`)
const fill_path_is_cubic = (region: FillRegion, fill_series: DataSeries[]): boolean => {
  const [segment] = compute_fill_segments(region, fill_series, domains)
  expect(segment).toBeDefined()
  return generate_fill_path(
    segment.upper,
    segment.lower,
    segment.upper_curve,
    segment.lower_curve,
  ).includes(`C`)
}

describe(`monotone_interpolate`, () => {
  it(`returns exact y at knots`, () => {
    const x_values = [0, 10, 20, 30]
    const y_values = [0, 30, 15, 40]
    for (let idx = 0; idx < x_values.length; idx++) {
      expect(monotone_interpolate(x_values, y_values, x_values[idx])).toBeCloseTo(
        y_values[idx],
        9,
      )
    }
  })

  it(`clamps to endpoints outside the domain`, () => {
    const x_values = [0, 10]
    const y_values = [5, 25]
    expect(monotone_interpolate(x_values, y_values, -5)).toBe(5)
    expect(monotone_interpolate(x_values, y_values, 15)).toBe(25)
  })

  it(`is linear for collinear points`, () => {
    const x_values = [0, 10, 20]
    const y_values = [0, 10, 20]
    expect(monotone_interpolate(x_values, y_values, 5)).toBeCloseTo(5)
    expect(monotone_interpolate(x_values, y_values, 17)).toBeCloseTo(17)
  })

  it(`stays within neighboring knot bounds (monotonicity)`, () => {
    const x_values = [0, 10, 20, 30]
    const y_values = [0, 5, 100, 105] // monotone increasing
    const mid = monotone_interpolate(x_values, y_values, 15)
    expect(mid).toBeGreaterThanOrEqual(5)
    expect(mid).toBeLessThanOrEqual(100)
  })

  // Pin the hand-rolled cubic to d3's actual curveMonotoneX output at a non-knot x. monotone_interpolate
  // re-implements d3 internals, so this guards against drift if d3 changes or the reimpl regresses.
  it(`matches d3 curveMonotoneX between knots`, () => {
    const x_values = [0, 10, 20, 30]
    const y_values = [0, 30, 15, 40]
    const pts = x_values.map((coord_x, idx) => make_point(coord_x, y_values[idx]))
    // d3 path: "M x0,y0 C c1x,c1y c2x,c2y x1,y1 C ..." — parse the first cubic segment
    const matches = series_line(pts).match(/-?\d+\.?\d*(?:e-?\d+)?/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(8) // guards the 8-part destructure below
    const [coord_x_0, coord_y_0, c1x, c1y, c2x, c2y, coord_x_1, coord_y_1] =
      matches.map(Number)
    // d3 places monotoneX x-control points at the 1/3 marks, which makes x linear in the bezier
    // param. d3 rounds path coords to 3 decimals, so compare to 2 (still catches algorithmic drift).
    expect(c1x).toBeCloseTo(coord_x_0 + (coord_x_1 - coord_x_0) / 3, 2)
    expect(c2x).toBeCloseTo(coord_x_1 - (coord_x_1 - coord_x_0) / 3, 2)
    for (const coord_x of [2.5, 5, 7.5]) {
      const frac = (coord_x - coord_x_0) / (coord_x_1 - coord_x_0)
      const mean = 1 - frac
      const d3_y =
        mean ** 3 * coord_y_0 +
        3 * mean ** 2 * frac * c1y +
        3 * mean * frac ** 2 * c2y +
        frac ** 3 * coord_y_1
      expect(monotone_interpolate(x_values, y_values, coord_x)).toBeCloseTo(d3_y, 2)
    }
  })
})

describe(`resolve_series_ref`, () => {
  const mock_series: DataSeries[] = [
    { x: [1, 2, 3], y: [10, 20, 30], id: `series-a` },
    { x: [1, 2, 3], y: [5, 15, 25], id: `series-b` },
    { x: [1, 2, 3], y: [100, 200, 300] },
  ]

  it.each([
    [`by index`, series_ref(1), `series-b`],
    [`by string id`, { type: `series` as const, series_id: `series-a` }, `series-a`],
  ])(`resolves series %s`, (_, ref, expected_id) => {
    expect(resolve_series_ref(ref, mock_series)?.id).toBe(expected_id)
  })

  it.each([
    [`invalid index`, series_ref(99)],
    [`non-existent id`, { type: `series` as const, series_id: `non-existent` }],
    [`negative index`, series_ref(-1)],
  ])(`returns null for %s`, (_, ref) => {
    expect(resolve_series_ref(ref, mock_series)).toBeNull()
  })
})

describe(`resolve_boundary_points`, () => {
  const series: DataSeries[] = [{ x: [0, 10, 20], y: [10, 20, 30], id: `test` }]
  const companion: Pt[] = [make_point(0, 0), make_point(20, 0)]

  it(`resolves a series boundary to its native points with monotoneX`, () => {
    const result = resolve_boundary_points(series_ref(0), series, domains)
    expect(result?.curve).toBe(`monotoneX`)
    expect(result?.points).toEqual([make_point(0, 10), make_point(10, 20), make_point(20, 30)])
  })

  it.each([
    [
      series_ref(0),
      [{ id: `fill`, x: [0, 1], y: [2] }],
      `Series "fill": aligned arrays must have equal lengths, got x=2, y=1`,
    ],
    [
      { type: `data`, x: [0, 10], values: [1] },
      series,
      `Fill boundary: aligned arrays must have equal lengths, got x=2, values=1`,
    ],
  ] as const)(`rejects misaligned boundary %#`, (boundary, input_series, message) => {
    expect(() => resolve_boundary_points(boundary, input_series, domains)).toThrow(message)
  })

  // a series fill edge inherits the series' line_style.curve so it matches the rendered line
  it.each([
    [undefined, `monotoneX`], // no curve -> default
    [`monotone`, `monotoneX`], // renamed key (not caught by the undefined default)
    [`linear`, `linear`],
    [`natural`, `natural`],
    [`step`, `step`],
    [`basis`, `basis`],
    [`catmull-rom`, `catmullRom`],
  ] as const)(`series fill edge maps line curve %s -> %s`, (line_curve, expected) => {
    const curved_series: DataSeries[] = [
      { x: [0, 10, 20], y: [10, 20, 30], line_style: line_curve ? { curve: line_curve } : {} },
    ]
    const result = resolve_boundary_points(series_ref(0), curved_series, domains)
    expect(result?.curve).toBe(expected)
  })

  // The series curve survives segment/path generation for both fills and error bands.
  it.each([
    [undefined, true], // default monotone -> cubic fill edge
    [`linear`, false], // straight segments -> no cubic
  ] as const)(`fill and error-band paths inherit line curve %s`, (line_curve, has_cubic) => {
    const curved_series: DataSeries[] = [
      { x: [0, 10, 20], y: [10, 20, 15], line_style: line_curve ? { curve: line_curve } : {} },
    ]
    const band = convert_error_band_to_fill_region(
      { series: series_ref(0), error: 2 },
      curved_series,
    )
    if (!band) throw new Error(`expected an error-band fill region`)
    for (const region of [band, { upper: series_ref(0), lower: 0 }])
      expect(fill_path_is_cubic(region, curved_series)).toBe(has_cubic)
  })

  it.each([
    [`number shorthand`, 42, 42],
    [`constant`, { type: `constant`, value: 50 }, 50],
    [`axis`, { type: `axis`, axis: `y`, value: 7 }, 7],
  ])(`resolves %s to a flat linear edge spanning the companion x`, (_, boundary, coord_y) => {
    const result = resolve_boundary_points(
      boundary as FillBoundary,
      series,
      domains,
      companion,
    )
    expect(result?.curve).toBe(`linear`)
    expect(result?.points).toEqual([make_point(0, coord_y), make_point(20, coord_y)])
  })

  it(`samples a function boundary across the span`, () => {
    const result = resolve_boundary_points(
      { type: `function`, fn: (coord) => coord * 5 },
      series,
      domains,
      companion,
    )
    expect(result?.curve).toBe(`monotoneX`)
    expect(result?.points[0]).toEqual(make_point(0, 0))
    expect(result?.points.at(-1)).toEqual(make_point(20, 100))
  })

  it(`resolves data with explicit x natively`, () => {
    const result = resolve_boundary_points(
      { type: `data`, x: [0, 10, 20], values: [1, 2, 3] },
      series,
      domains,
    )
    expect(result?.points).toEqual([make_point(0, 1), make_point(10, 2), make_point(20, 3)])
  })

  it(`aligns data without x to the companion x positions`, () => {
    const result = resolve_boundary_points(
      { type: `data`, values: [1, 2, 3] },
      series,
      domains,
      [make_point(0, 0), make_point(5, 0), make_point(10, 0)],
    )
    expect(result?.points).toEqual([make_point(0, 1), make_point(5, 2), make_point(10, 3)])
  })

  it(`returns null for an unresolvable series reference`, () => {
    expect(resolve_boundary_points(series_ref(99), series, domains)).toBeNull()
  })
})

describe(`compute_fill_segments`, () => {
  const series: DataSeries[] = [
    { x: [0, 10, 20], y: [10, 12, 11], id: `lower` },
    { x: [0, 10, 20], y: [30, 35, 33], id: `upper` },
  ]

  it(`traces both edges through the series' own points (single segment)`, () => {
    const segments = compute_fill_segments(
      { upper: series_ref(1), lower: series_ref(0) },
      series,
      domains,
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].upper).toEqual([
      make_point(0, 30),
      make_point(10, 35),
      make_point(20, 33),
    ])
    expect(segments[0].lower).toEqual([
      make_point(0, 10),
      make_point(10, 12),
      make_point(20, 11),
    ])
    expect(segments[0].upper_curve).toBe(`monotoneX`)
  })

  it(`clips to the x-overlap and region.x_range with on-curve endpoints`, () => {
    const segments = compute_fill_segments(
      {
        upper: series_ref(1),
        lower: series_ref(0),
        x_range: [5, 15],
      },
      series,
      domains,
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].upper[0].x).toBe(5)
    expect(segments[0].upper.at(-1)?.x).toBe(15)
  })

  it.each([false, true])(
    `clips duplicate knots without including interval endpoints twice (%s)`,
    (reverse) => {
      const pairs = [
        [0, 1],
        [1, 2],
        [1, 2],
        [2, 3],
        [3, 4],
      ]
      if (reverse) pairs.reverse()
      const sampled_x: number[] = []
      const [segment] = compute_fill_segments(
        {
          upper: {
            type: `data`,
            x: pairs.map(([coord_x]) => coord_x),
            values: pairs.map(([, coord_y]) => coord_y),
          },
          lower: 0,
          x_range: [1, 2],
          where: (coord_x) => {
            sampled_x.push(coord_x)
            return true
          },
        },
        [],
        domains,
      )
      expect(segment.upper).toEqual([make_point(1, 2), make_point(2, 3)])
      expect(segment.lower).toEqual([make_point(1, 0), make_point(2, 0)])
      expect(sampled_x).toEqual([1, 2])
    },
  )

  it.each<[Vec2 | undefined, Vec2[]]>([
    [
      undefined,
      [
        [0, 0.5],
        [1.5, 2.5],
        [3.5, 4],
      ],
    ],
    [[1, 3], [[1.5, 2.5]]],
  ])(`splits where-condition intervals within range %j`, (x_range, expected) => {
    // lower rises above upper only in the middle, so the fill is split
    const cross_series: DataSeries[] = [
      { x: [0, 1, 2, 3, 4], y: [0, 0, 0, 0, 0], id: `lo` },
      { x: [0, 1, 2, 3, 4], y: [1, -1, 1, -1, 1], id: `up` },
    ]
    const segments = compute_fill_segments(
      {
        upper: series_ref(1),
        lower: series_ref(0),
        x_range,
        where: (_unused_coord_x, y_up, y_lo) => y_up > y_lo,
      },
      cross_series,
      { x_domain: [0, 4], y_domain: [-2, 2] },
    )
    expect(segments).toHaveLength(expected.length)
    for (const [idx, segment] of segments.entries()) {
      // The 24-step crossing search resolves these unit intervals within 2^-24.
      expect(segment.upper[0].x).toBeCloseTo(expected[idx][0], 6)
      expect(segment.upper.at(-1)?.x).toBeCloseTo(expected[idx][1], 6)
    }
  })

  it(`returns no segments when boundaries do not overlap in x`, () => {
    const disjoint: DataSeries[] = [
      { x: [0, 10], y: [0, 0], id: `a` },
      { x: [20, 30], y: [5, 5], id: `b` },
    ]
    const segments = compute_fill_segments(
      { upper: series_ref(1), lower: series_ref(0) },
      disjoint,
      { x_domain: [0, 30], y_domain: [0, 10] },
    )
    expect(segments).toEqual([])
  })

  it(`clips a stepAfter curve to its held value, not a linear interpolation`, () => {
    // upper series y=[30,35,33] at x=[0,10,20]; clip at x=5 and x=15. stepAfter holds the previous
    // knot's y (30 in [0,10), 35 in [10,20)) — linear interpolation would give 32.5 and 34.
    const segments = compute_fill_segments(
      {
        upper: series_ref(1),
        lower: series_ref(0),
        curve: `stepAfter`,
        x_range: [5, 15],
      },
      series,
      domains,
    )
    expect(segments[0].upper_curve).toBe(`stepAfter`)
    expect(segments[0].upper[0]).toEqual(make_point(5, 30))
    expect(segments[0].upper.at(-1)).toEqual(make_point(15, 35))
  })
})

describe(`generate_fill_path`, () => {
  const upper: Pt[] = [make_point(0, 10), make_point(50, 5), make_point(100, 8)]
  const lower: Pt[] = [make_point(0, 40), make_point(50, 45), make_point(100, 42)]

  it(`returns empty string when a boundary has fewer than 2 points`, () => {
    expect(generate_fill_path([make_point(0, 0)], lower)).toBe(``)
    expect(generate_fill_path([], [])).toBe(``)
  })

  it(`traces the upper series forward and the lower series backward`, () => {
    const path = generate_fill_path(upper, lower, `monotoneX`, `monotoneX`)
    expect(path.startsWith(series_line(upper))).toBe(true)
    const lower_reversed = series_line(lower.toReversed())
    expect(path.endsWith(`${lower_reversed.slice(1)}Z`)).toBe(true)
  })

  it.each([
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
  ] as FillCurveType[])(`supports %s curve type`, (curve_type) => {
    const path = generate_fill_path(upper, lower, curve_type, curve_type)
    expect(path.length).toBeGreaterThan(0)
    expect(path).toMatch(/^M/)
    expect(path).toMatch(/Z$/)
  })
})

describe(`convert_error_band_to_fill_region`, () => {
  const mock_series: DataSeries[] = [{ x: [1, 2, 3], y: [10, 20, 30], id: `test-series` }]
  const base_ref = series_ref(0)

  it.each([
    [`symmetric constant`, { error: 5 }, [15, 25, 35], [5, 15, 25]],
    [`symmetric per-point`, { error: [1, 2, 3] }, [11, 22, 33], [9, 18, 27]],
    [`asymmetric`, { error: { upper: 10, lower: 5 } }, [20, 30, 40], [5, 15, 25]],
  ])(`converts %s error carrying the series x`, (_, extra, upper, lower) => {
    const result = convert_error_band_to_fill_region(
      { series: base_ref, ...extra },
      mock_series,
    )
    expect(result?.upper).toEqual({ type: `data`, x: [1, 2, 3], values: upper })
    expect(result?.lower).toEqual({ type: `data`, x: [1, 2, 3], values: lower })
  })

  it(`returns null for invalid series reference`, () => {
    expect(
      convert_error_band_to_fill_region({ series: series_ref(99), error: 5 }, mock_series),
    ).toBeNull()
  })

  it(`resolves series by id and includes label/id`, () => {
    const result = convert_error_band_to_fill_region(
      {
        series: { type: `series`, series_id: `test-series` },
        error: 5,
        id: `eb-1`,
        label: `Error`,
        fill: `#ff0000`,
        fill_opacity: 0.5,
      },
      mock_series,
    )
    expect(result).toMatchObject({
      id: `eb-1`,
      label: `Error`,
      fill: `#ff0000`,
      fill_opacity: 0.5,
    })
  })

  it(`error band edges coincide with the central series line`, () => {
    // build the band, resolve its boundaries to points, and verify the upper edge path equals the
    // monotoneX line through (x, y+err) -- i.e. it would hug a drawn line of the same values
    const region = convert_error_band_to_fill_region(
      { series: base_ref, error: 2 },
      mock_series,
    )
    if (!region) throw new Error(`expected a fill region`)
    const segments = compute_fill_segments(region, mock_series, {
      x_domain: [1, 3],
      y_domain: [0, 40],
    })
    expect(segments[0].upper).toEqual([
      make_point(1, 12),
      make_point(2, 22),
      make_point(3, 32),
    ])
  })
})

describe(`is_fill_gradient`, () => {
  it.each<[string, unknown, boolean]>([
    [
      `linear gradient`,
      {
        type: `linear`,
        stops: [
          [0, `red`],
          [1, `blue`],
        ],
      },
      true,
    ],
    [
      `radial gradient`,
      {
        type: `radial`,
        stops: [
          [0, `white`],
          [1, `black`],
        ],
      },
      true,
    ],
    [`string color`, `steelblue`, false],
    [`undefined`, undefined, false],
    [`null`, null, false],
    [`object without type`, { stops: [[0, `red`]] }, false],
    [`object without stops`, { type: `linear` }, false],
  ])(`%s -> %s`, (_, value, expected) => {
    expect(is_fill_gradient(value as string | FillGradient | undefined)).toBe(expected)
  })
})
