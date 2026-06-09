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
  FillEdgeStyle,
  FillGradient,
  FillHandlerEvent,
  FillHoverStyle,
  FillRegion,
  LegendItem,
} from '$lib/plot/core/types'
import { FILL_CURVE_TYPES } from '$lib/plot/core/types'
import { curveMonotoneX, line } from 'd3-shape'
import { describe, expect, it } from 'vitest'

// Reproduce the exact generator Line.svelte uses for series lines
const series_line = (pts: readonly Pt[]): string =>
  line<Pt>()
    .x((pt) => pt.x)
    .y((pt) => pt.y)
    .curve(curveMonotoneX)(pts as Pt[]) ?? ``

const domains = { x_domain: [0, 20] as Vec2, y_domain: [0, 100] as Vec2 }

describe(`monotone_interpolate`, () => {
  it(`returns exact y at knots`, () => {
    const xs = [0, 10, 20, 30]
    const ys = [0, 30, 15, 40]
    for (let idx = 0; idx < xs.length; idx++) {
      expect(monotone_interpolate(xs, ys, xs[idx])).toBeCloseTo(ys[idx], 9)
    }
  })

  it(`clamps to endpoints outside the domain`, () => {
    const xs = [0, 10]
    const ys = [5, 25]
    expect(monotone_interpolate(xs, ys, -5)).toBe(5)
    expect(monotone_interpolate(xs, ys, 15)).toBe(25)
  })

  it(`is linear for collinear points`, () => {
    const xs = [0, 10, 20]
    const ys = [0, 10, 20]
    expect(monotone_interpolate(xs, ys, 5)).toBeCloseTo(5)
    expect(monotone_interpolate(xs, ys, 17)).toBeCloseTo(17)
  })

  it(`stays within neighboring knot bounds (monotonicity)`, () => {
    const xs = [0, 10, 20, 30]
    const ys = [0, 5, 100, 105] // monotone increasing
    const mid = monotone_interpolate(xs, ys, 15)
    expect(mid).toBeGreaterThanOrEqual(5)
    expect(mid).toBeLessThanOrEqual(100)
  })

  // Pin the hand-rolled cubic to d3's actual curveMonotoneX output at a non-knot x. monotone_interpolate
  // re-implements d3 internals, so this guards against drift if d3 changes or the reimpl regresses.
  it(`matches d3 curveMonotoneX between knots`, () => {
    const xs = [0, 10, 20, 30]
    const ys = [0, 30, 15, 40]
    const pts = xs.map((x, idx) => ({ x, y: ys[idx] }))
    // d3 path: "M x0,y0 C c1x,c1y c2x,c2y x1,y1 C ..." — parse the first cubic segment
    const matches = series_line(pts).match(/-?\d+\.?\d*(?:e-?\d+)?/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(8) // guards the 8-part destructure below
    const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = matches.map(Number)
    // d3 places monotoneX x-control points at the 1/3 marks, which makes x linear in the bezier
    // param. d3 rounds path coords to 3 decimals, so compare to 2 (still catches algorithmic drift).
    expect(c1x).toBeCloseTo(x0 + (x1 - x0) / 3, 2)
    expect(c2x).toBeCloseTo(x1 - (x1 - x0) / 3, 2)
    for (const x of [2.5, 5, 7.5]) {
      const frac = (x - x0) / (x1 - x0)
      const mu = 1 - frac
      const d3_y =
        mu ** 3 * y0 + 3 * mu ** 2 * frac * c1y + 3 * mu * frac ** 2 * c2y + frac ** 3 * y1
      expect(monotone_interpolate(xs, ys, x)).toBeCloseTo(d3_y, 2)
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

describe(`resolve_boundary_points`, () => {
  const series: DataSeries[] = [{ x: [0, 10, 20], y: [10, 20, 30], id: `test` }]
  const companion: Pt[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
  ]

  it(`resolves a series boundary to its native points with monotoneX`, () => {
    const result = resolve_boundary_points({ type: `series`, series_idx: 0 }, series, domains)
    expect(result?.curve).toBe(`monotoneX`)
    expect(result?.points).toEqual([
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 30 },
    ])
  })

  it.each([
    [`number shorthand`, 42 as FillBoundary, 42],
    [`constant`, { type: `constant`, value: 50 } as FillBoundary, 50],
    [`axis`, { type: `axis`, axis: `y`, value: 7 } as FillBoundary, 7],
  ])(`resolves %s to a flat linear edge spanning the companion x`, (_, boundary, y) => {
    const result = resolve_boundary_points(boundary, series, domains, companion)
    expect(result?.curve).toBe(`linear`)
    expect(result?.points).toEqual([
      { x: 0, y },
      { x: 20, y },
    ])
  })

  it(`samples a function boundary across the span`, () => {
    const result = resolve_boundary_points(
      { type: `function`, fn: (coord) => coord * 5 },
      series,
      domains,
      companion,
    )
    expect(result?.curve).toBe(`monotoneX`)
    expect(result?.points[0]).toEqual({ x: 0, y: 0 })
    expect(result?.points.at(-1)).toEqual({ x: 20, y: 100 })
  })

  it(`resolves data with explicit x natively`, () => {
    const result = resolve_boundary_points(
      { type: `data`, x: [0, 10, 20], values: [1, 2, 3] },
      series,
      domains,
    )
    expect(result?.points).toEqual([
      { x: 0, y: 1 },
      { x: 10, y: 2 },
      { x: 20, y: 3 },
    ])
  })

  it(`aligns data without x to the companion x positions`, () => {
    const result = resolve_boundary_points(
      { type: `data`, values: [1, 2, 3] },
      series,
      domains,
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ],
    )
    expect(result?.points).toEqual([
      { x: 0, y: 1 },
      { x: 5, y: 2 },
      { x: 10, y: 3 },
    ])
  })

  it(`returns null for an unresolvable series reference`, () => {
    expect(
      resolve_boundary_points({ type: `series`, series_idx: 99 }, series, domains),
    ).toBeNull()
  })
})

describe(`compute_fill_segments`, () => {
  const series: DataSeries[] = [
    { x: [0, 10, 20], y: [10, 12, 11], id: `lower` },
    { x: [0, 10, 20], y: [30, 35, 33], id: `upper` },
  ]

  it(`traces both edges through the series' own points (single segment)`, () => {
    const segments = compute_fill_segments(
      { upper: { type: `series`, series_idx: 1 }, lower: { type: `series`, series_idx: 0 } },
      series,
      domains,
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].upper).toEqual([
      { x: 0, y: 30 },
      { x: 10, y: 35 },
      { x: 20, y: 33 },
    ])
    expect(segments[0].lower).toEqual([
      { x: 0, y: 10 },
      { x: 10, y: 12 },
      { x: 20, y: 11 },
    ])
    expect(segments[0].upper_curve).toBe(`monotoneX`)
  })

  it(`clips to the x-overlap and region.x_range with on-curve endpoints`, () => {
    const segments = compute_fill_segments(
      {
        upper: { type: `series`, series_idx: 1 },
        lower: { type: `series`, series_idx: 0 },
        x_range: [5, 15],
      },
      series,
      domains,
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].upper[0].x).toBe(5)
    expect(segments[0].upper.at(-1)?.x).toBe(15)
  })

  it(`splits into segments where a where-condition toggles`, () => {
    // lower rises above upper only in the middle, so the fill is split
    const cross_series: DataSeries[] = [
      { x: [0, 1, 2, 3, 4], y: [0, 0, 0, 0, 0], id: `lo` },
      { x: [0, 1, 2, 3, 4], y: [1, -1, 1, -1, 1], id: `up` },
    ]
    const segments = compute_fill_segments(
      {
        upper: { type: `series`, series_idx: 1 },
        lower: { type: `series`, series_idx: 0 },
        where: (_x, y_up, y_lo) => y_up > y_lo,
      },
      cross_series,
      { x_domain: [0, 4], y_domain: [-2, 2] },
    )
    expect(segments.length).toBeGreaterThan(1)
  })

  it(`returns no segments when boundaries do not overlap in x`, () => {
    const disjoint: DataSeries[] = [
      { x: [0, 10], y: [0, 0], id: `a` },
      { x: [20, 30], y: [5, 5], id: `b` },
    ]
    const segments = compute_fill_segments(
      { upper: { type: `series`, series_idx: 1 }, lower: { type: `series`, series_idx: 0 } },
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
        upper: { type: `series`, series_idx: 1 },
        lower: { type: `series`, series_idx: 0 },
        curve: `stepAfter`,
        x_range: [5, 15],
      },
      series,
      domains,
    )
    expect(segments[0].upper_curve).toBe(`stepAfter`)
    expect(segments[0].upper[0]).toEqual({ x: 5, y: 30 })
    expect(segments[0].upper.at(-1)).toEqual({ x: 15, y: 35 })
  })
})

describe(`generate_fill_path`, () => {
  const upper: Pt[] = [
    { x: 0, y: 10 },
    { x: 50, y: 5 },
    { x: 100, y: 8 },
  ]
  const lower: Pt[] = [
    { x: 0, y: 40 },
    { x: 50, y: 45 },
    { x: 100, y: 42 },
  ]

  it(`returns empty string when a boundary has fewer than 2 points`, () => {
    expect(generate_fill_path([{ x: 0, y: 0 }], lower)).toBe(``)
    expect(generate_fill_path([], [])).toBe(``)
  })

  it(`makes the upper edge byte-identical to the series line`, () => {
    const path = generate_fill_path(upper, lower, `monotoneX`, `monotoneX`)
    expect(path.startsWith(series_line(upper))).toBe(true)
  })

  it(`makes the lower edge the reversed series line`, () => {
    const path = generate_fill_path(upper, lower, `monotoneX`, `monotoneX`)
    const lower_reversed = series_line(lower.toReversed())
    expect(path.endsWith(`${lower_reversed.slice(1)}Z`)).toBe(true)
  })

  it(`produces a closed path with cubic segments for monotoneX`, () => {
    const path = generate_fill_path(upper, lower, `monotoneX`, `monotoneX`)
    expect(path).toMatch(/^M/)
    expect(path).toMatch(/Z$/)
    expect(path).toContain(`C`)
  })

  it.each(FILL_CURVE_TYPES)(`supports %s curve type`, (curve_type) => {
    const path = generate_fill_path(upper, lower, curve_type, curve_type)
    expect(path.length).toBeGreaterThan(0)
    expect(path).toMatch(/^M/)
    expect(path).toMatch(/Z$/)
  })
})

describe(`convert_error_band_to_fill_region`, () => {
  const mock_series: DataSeries[] = [{ x: [1, 2, 3], y: [10, 20, 30], id: `test-series` }]
  const base_ref = { type: `series` as const, series_idx: 0 }

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
      { x: 1, y: 12 },
      { x: 2, y: 22 },
      { x: 3, y: 32 },
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
    if (Object.keys(expected_match).length > 0) expect(boundary).toMatchObject(expected_match)
    if (typeof boundary === `object` && boundary.type === `function`) {
      expect(boundary.fn(5)).toBe(10)
    }
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
      fill: {
        type: `linear`,
        stops: [
          [0, `red`],
          [1, `blue`],
        ],
      },
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
