import type { BarAutoRangeOpts, NumericBarSeries } from '$lib/plot/bar/data'
import {
  compute_bar_auto_ranges,
  compute_group_info,
  compute_stacked_offsets,
  normalize_categorical,
  on_secondary_value_axis,
} from '$lib/plot/bar/data'
import type { AxisConfig } from '$lib/plot/core/types'
import {
  compute_bar_rect,
  compute_line_points,
  nearest_line_point,
} from '$lib/plot/bar/geometry'
import type { BarSeries } from '$lib/plot'
import { describe, expect, test, vi } from 'vitest'

const bar = (overrides: Partial<NumericBarSeries> = {}): NumericBarSeries => ({
  x: [0, 1],
  y: [1, 2],
  ...overrides,
})

type AxisOverrides = Partial<Record<`x` | `x2` | `y` | `y2`, AxisConfig>>
const auto_ranges = (
  series: readonly NumericBarSeries[],
  overrides: Partial<Omit<BarAutoRangeOpts, `axes`>> & { axes?: AxisOverrides } = {},
) =>
  compute_bar_auto_ranges({
    visible_series: series,
    mode: `overlay`,
    orientation: `vertical`,
    range_padding: 0,
    category_count: 0,
    ...overrides,
    axes: { x: {}, x2: {}, y: {}, y2: {}, ...overrides.axes },
  })
const scale_by = (factor: number) => (value: number) => value * factor

describe(`normalize_categorical`, () => {
  test(`rejects a misaligned series`, () => {
    expect(() => normalize_categorical([{ x: [1, 2], y: [3] }])).toThrow(`aligned arrays`)
  })

  test(`passes numeric-only series through with same identity`, () => {
    const series: BarSeries[] = [{ x: [1, 2], y: [3, 4] }]
    const { category_list, internal_series } = normalize_categorical(series)
    expect(category_list).toEqual([])
    expect(internal_series).toBe(series) // no copy when nothing to normalize
  })

  test(`aligns mixed series onto the union of categories with fallbacks`, () => {
    const series: BarSeries[] = [
      { x: [`a`, `b`], y: [1, 2] },
      { x: [`b`, `c`], y: [3, 4] },
      { x: [`c`], y: [9], render_mode: `line` },
    ]
    const { category_list, internal_series } = normalize_categorical(series)
    expect(category_list).toEqual([`a`, `b`, `c`])
    expect(internal_series[0].x).toEqual([0, 1, 2]) // categories map to integer indices
    // bar series get 0 for missing categories
    expect(internal_series[0].y).toEqual([1, 2, 0])
    expect(internal_series[1].y).toEqual([0, 3, 4])
    // line series get NaN for missing categories (gap, not a zero point)
    expect(internal_series[2].y).toEqual([NaN, NaN, 9])
  })

  test(`respects explicit category order and drops absent categories`, () => {
    const series: BarSeries[] = [{ x: [`a`, `b`, `c`], y: [1, 2, 3] }]
    const { category_list, internal_series } = normalize_categorical(series, [`c`, `a`])
    expect(category_list).toEqual([`c`, `a`])
    expect(internal_series[0].x).toEqual([0, 1])
    expect(internal_series[0].y).toEqual([3, 1])
  })

  test(`warns on duplicate x values and keeps last occurrence`, () => {
    const warn_spy = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const series: BarSeries[] = [{ x: [`a`, `a`], y: [1, 2], label: `dupes` }]
    const { internal_series } = normalize_categorical(series)
    expect(internal_series[0].y).toEqual([2])
    expect(warn_spy).toHaveBeenCalledWith(
      `BarPlot: series "dupes" has duplicate x values — last occurrence wins`,
    )
    warn_spy.mockRestore()
  })

  test(`remaps per-point arrays and replicates scalar metadata`, () => {
    const series: BarSeries[] = [
      {
        x: [`b`, `c`],
        y: [2, 3],
        labels: [`B`, `C`],
        bar_width: [0.2, 0.4],
        color_values: [7, 8],
        size_values: [5, 6],
        metadata: { tag: `scalar` },
        // per-point style arrays must follow the category reorder too
        point_style: [{ fill: `red` }, { fill: `blue` }],
        point_offset: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      },
      {
        x: [`a`, `b`, `c`],
        y: [1, 2, 3],
        metadata: [{ id: 1 }, { id: 2 }, { id: 3 }],
        point_style: { fill: `green` }, // scalar: broadcast, must pass through unchanged
      },
    ]
    const { internal_series } = normalize_categorical(series)
    // categories: ['b', 'c', 'a'] (first-seen order across series)
    const [s1, s2] = internal_series
    for (const [prop, expected] of [
      [`labels`, [`B`, `C`, null]],
      [`bar_width`, [0.2, 0.4, 0.5]],
      [`color_values`, [7, 8, null]],
      [`size_values`, [5, 6, null]],
      [`point_style`, [{ fill: `red` }, { fill: `blue` }, undefined]],
      [`point_offset`, [{ x: 1, y: 1 }, { x: 2, y: 2 }, undefined]],
      [`metadata`, [{ tag: `scalar` }, { tag: `scalar` }, undefined]],
    ] as const)
      expect(s1[prop]).toEqual(expected)
    expect(s2.metadata).toEqual([{ id: 2 }, { id: 3 }, { id: 1 }])
    expect(s2.point_style).toEqual({ fill: `green` })
  })
})

describe(`compute_bar_auto_ranges`, () => {
  // stacked totals track pos/neg per x separately; linear scales clamp the value
  // range to include 0 only when all totals share one sign
  test.each([
    { y1: [3, 4], y2: [2, -5], expected: [-5, 5], desc: `mixed signs span totals, no clamp` },
    { y1: [3, 4], y2: [2, 0], expected: [0, 5], desc: `all-positive clamps min to 0` },
    { y1: [-3, -4], y2: [-2, 0], expected: [-5, 0], desc: `all-negative clamps max to 0` },
  ])(`stacked totals: $desc`, ({ y1, y2, expected }) => {
    const series = [bar({ y: y1 }), bar({ y: y2 })]
    expect(auto_ranges(series, { mode: `stacked` }).y).toEqual(expected)
  })

  test.each([
    [
      `stacked line abs`,
      {
        mode: `stacked`,
        series: [bar({ y: [3, 4] }), bar({ y: [10, 10], render_mode: `line` })],
        key: `y`,
        range: [0, 10],
      },
    ],
    [
      `explicit y_range`,
      {
        axes: { y: { range: [2, 6] as [number, number] } },
        series: [bar({ y: [4, 5] })],
        key: `y`,
        range: [2, 6],
      },
    ],
  ] as const)(`$0`, (_desc, options) => {
    const { series, key, range, ...overrides } = options
    expect(auto_ranges(series, overrides)[key]).toEqual(range)
  })

  test(`uses scale-valid fallbacks for axes without finite points`, () => {
    expect(auto_ranges([])).toEqual({ x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] })
    const no_finite_points = [bar({ x: [NaN], y: [Infinity] })]
    expect(
      auto_ranges(no_finite_points, {
        axes: {
          x: { range: [2, null] },
          x2: { range: [null, 20], scale_type: `log` },
          y: { range: [3, 7] },
          y2: { scale_type: `log` },
        },
      }),
    ).toEqual({ x: [2, 3], x2: [2, 20], y: [3, 7], y2: [1, 10] })
    // a time category axis pads a lone point by one day
    const day = 86_400_000
    expect(
      auto_ranges([bar({ x: [NaN], y: [1] })], {
        axes: { x: { range: [day, null], scale_type: `time` } },
      }).x,
    ).toEqual([day, 2 * day])
  })

  test(`log value axis skips zero-clamping and ignores zero bars`, () => {
    const log = auto_ranges([bar({ y: [4, 5] })], { axes: { y: { scale_type: `log` } } })
    expect(log.y[0]).toBeGreaterThan(0)
    // zero-height bars have no log image: the range comes from the positive bars alone
    const with_zeros = auto_ranges([bar({ x: [0, 1, 2], y: [0, 10, 1000] })], {
      axes: { y: { scale_type: `log` } },
    })
    expect(with_zeros.y).toEqual(
      auto_ranges([bar({ x: [1, 2], y: [10, 1000] })], { axes: { y: { scale_type: `log` } } })
        .y,
    )
    expect(with_zeros.y[0]).toBeGreaterThan(0)
  })

  test(`categorical range reserves slots and expands for wider bars`, () => {
    expect(
      auto_ranges([bar({ x: [0, 1, 2], y: [1, 2, 3] })], { category_count: 3 }).x,
    ).toEqual([-0.5, 2.5])
    const series = [bar({ x: [0, 1, 2], y: [1, 2, 3], bar_width: 2 })]
    expect(auto_ranges(series, { category_count: 3 }).x).toEqual([-1, 3])
    expect(auto_ranges(series, { category_count: 3, orientation: `horizontal` }).y).toEqual([
      -1, 3,
    ])
  })

  test(`numeric category range includes the outer bar edges`, () => {
    const series = [bar({ x: [1, 7], bar_width: 0.5 })]
    expect(auto_ranges(series).x).toEqual([0.75, 7.25])
    expect(auto_ranges(series, { axes: { x: { range: [1, 7] } } }).x).toEqual([1, 7])
    expect(auto_ranges([bar({ x: [1, 7], bar_width: 4, render_mode: `line` })]).x).toEqual([
      1, 7,
    ])
  })

  test(`horizontal orientation swaps category and value axes`, () => {
    const series = [bar({ x: [0, 10], y: [1, 5] })]
    expect(auto_ranges(series)).toMatchObject({ x: [-0.25, 10.25], y: [0, 5] })
    expect(auto_ranges(series, { orientation: `horizontal` })).toMatchObject({
      x: [0, 5],
      y: [-0.25, 10.25],
    })
    // horizontal: x2 carries the secondary values and the value axes honour x/x2 limits
    const with_secondary = [...series, bar({ x: [0, 10], y: [-30, -10], x_axis: `x2` })]
    expect(
      auto_ranges(with_secondary, {
        orientation: `horizontal`,
        axes: { x: { range: [null, 8] }, x2: { range: [-40, null] } },
      }),
    ).toEqual({ x: [1, 8], x2: [-40, -10], y: [-0.25, 10.25], y2: [0, 1] })
  })

  test(`vertical x2 series get their own category range; x stays sentinel without x1 series`, () => {
    const x2_srs = bar({ x: [100, 200], y: [1, 2], x_axis: `x2` })
    const result = auto_ranges([x2_srs])
    expect(result.x2).toEqual([99.75, 200.25])
    expect(result.x).toEqual([0, 1])
    expect(result.y).toEqual([0, 2])
    // y2 series drive y2 only
    const y2_srs = bar({ y: [-4, -2], y_axis: `y2` })
    expect(auto_ranges([bar(), y2_srs])).toMatchObject({ y: [0, 2], y2: [-4, 0] })
  })

  test(`non-finite pairs do not affect category or stacked value ranges`, () => {
    const series = [bar({ x: [0, 100], y: [2, NaN] }), bar({ x: [0, 100], y: [3, Infinity] })]
    const result = auto_ranges(series, { mode: `stacked` })
    const valid_only = auto_ranges([bar({ x: [0], y: [2] }), bar({ x: [0], y: [3] })], {
      mode: `stacked`,
    })
    expect(result.x).toEqual(valid_only.x)
    expect(result.y).toEqual(valid_only.y)
  })
})

describe(`compute_stacked_offsets`, () => {
  test.each([`overlay`, `grouped`] as const)(`returns [] for %s mode`, (mode) => {
    expect(compute_stacked_offsets([bar(), bar()], mode)).toEqual([])
  })

  // expected is the offsets matrix, one row per original series index
  // oxfmt-ignore
  test.each([
    {
      desc: `accumulate per x value across visible bar series`,
      series: [bar({ y: [1, 2] }), bar({ y: [3, 4] }), bar({ y: [5, 6] })],
      expected: [[0, 0], [1, 2], [4, 6]],
    },
    {
      // hidden rows are all zeros at their original index so visible rows don't shift
      desc: `skip hidden series but keep original-index rows`,
      series: [bar({ y: [1, 2] }), bar({ y: [10, 10], visible: false }), bar({ y: [3, 4] })],
      expected: [[0, 0], [0, 0], [1, 2]],
    },
    {
      desc: `exclude line series from stacking`,
      series: [bar({ y: [1, 2] }), bar({ y: [10, 10], render_mode: `line` }), bar({ y: [3, 4] })],
      expected: [[0, 0], [0, 0], [1, 2]],
    },
    {
      desc: `stack positive and negative values on separate baselines`,
      series: [bar({ y: [5, -5] }), bar({ y: [3, -2] }), bar({ y: [-1, -3] })],
      expected: [[0, 0], [5, -5], [0, -7]],
    },
    {
      desc: `accumulate y1 and y2 series independently`,
      series: [bar({ y: [1, 1] }), bar({ y: [2, 2], y_axis: `y2` }), bar({ y: [3, 3] })],
      expected: [[0, 0], [0, 0], [1, 1]],
    },
    {
      // second series: x=1 stacks on first series' 2, x=2 starts fresh
      desc: `stack misaligned x grids per x value`,
      series: [bar({ x: [0, 1], y: [1, 2] }), bar({ x: [1, 2], y: [3, 4] })],
      expected: [[0, 0], [2, 0]],
    },
    {
      desc: `skip non-finite values instead of poisoning later offsets`,
      series: [bar({ x: [0], y: [Infinity] }), bar({ x: [0], y: [2] })],
      expected: [[0], [0]],
    },
  ])(`offsets $desc`, ({ series, expected }) => {
    expect(compute_stacked_offsets(series, `stacked`)).toEqual(expected)
  })

  test(`horizontal bars stack per x2/x1 value axis`, () => {
    const series = [bar({ y: [1, 1] }), bar({ y: [2, 2], x_axis: `x2` }), bar({ y: [3, 3] })]
    expect(compute_stacked_offsets(series, `stacked`, `horizontal`)).toEqual([
      [0, 0],
      [0, 0],
      [1, 1],
    ])
    // vertical bars ignore x_axis for stacking (x2 is a second category axis there)
    expect(compute_stacked_offsets(series, `stacked`, `vertical`)).toEqual([
      [0, 0],
      [1, 1],
      [3, 3],
    ])
  })
})

test.each([
  [{ y_axis: `y2` }, `vertical`, true],
  [{ y_axis: `y2` }, `horizontal`, false],
  [{ x_axis: `x2` }, `horizontal`, true],
  [{ x_axis: `x2` }, `vertical`, false],
  [{}, `vertical`, false],
] as const)(`on_secondary_value_axis(%j, %s) -> %s`, (srs, orientation, expected) => {
  expect(on_secondary_value_axis(srs, orientation)).toBe(expected)
})

describe(`compute_group_info`, () => {
  test(`returns slots only for visible bars in grouped mode`, () => {
    const series = [bar(), bar({ visible: false }), bar({ render_mode: `line` }), bar()]
    expect(compute_group_info(series, `grouped`)).toEqual({
      bar_series_count: 2,
      bar_series_indices: [0, 3],
    })
    for (const mode of [`overlay`, `stacked`] as const) {
      expect(compute_group_info(series, mode)).toEqual({
        bar_series_count: 0,
        bar_series_indices: [],
      })
    }
  })
})

describe(`bar geometry`, () => {
  const series: NumericBarSeries = { x: [1, 2, 3], y: [4, 5, 6] }
  const line_points = (overrides: Partial<Parameters<typeof compute_line_points>[0]> = {}) =>
    compute_line_points({
      series,
      series_idx: 0,
      orientation: `vertical`,
      x_scale: scale_by(10),
      y_scale: scale_by(2),
      cat_y_scale: scale_by(3),
      ...overrides,
    })
  const group_info_of = (bar_series_indices: number[]) => ({
    bar_series_count: bar_series_indices.length,
    bar_series_indices,
  })
  const grouped_3 = group_info_of([0, 1, 2])
  const bar_rect = (overrides: Partial<Parameters<typeof compute_bar_rect>[0]> = {}) =>
    compute_bar_rect({
      cat_val: 5,
      val: 10,
      base: 0,
      bar_width_val: 2,
      series_idx: 0,
      mode: `overlay`,
      orientation: `vertical`,
      group_info: group_info_of([]),
      cat_scale: scale_by(10),
      val_scale: scale_by(4),
      ...overrides,
    })

  // oxfmt-ignore
  test.each([
    [`vertical`, {}, [[10, 8], [20, 10], [30, 12]]],
    [`horizontal`, { orientation: `horizontal` as const }, [[40, 3], [50, 6], [60, 9]]],
  ] as const)(`line_points maps %s coordinates`, (_name, overrides, coords) => {
    expect(line_points(overrides).map(({ x, y }) => [x, y])).toEqual(coords)
  })

  test(`line_points keeps source indices and drops non-finite points`, () => {
    // idx stays the position in the input, so a dropped point leaves a gap
    expect(
      line_points({ series_idx: 2, series: { x: [1, 2, 3], y: [4, NaN, 6] } }),
    ).toMatchObject([
      { data_x: 1, data_y: 4, idx: 0, series_idx: 2, point_idx: 0 },
      { data_x: 3, data_y: 6, idx: 2, series_idx: 2, point_idx: 2 },
    ])
  })

  test(`line_points indexes per-point props and broadcasts scalar ones`, () => {
    expect(line_points()[0]).toMatchObject({ color_value: null, size_value: null })
    const indexed = line_points({
      series: {
        ...series,
        color_values: [0.1, 0.2, 0.3],
        size_values: [5, 6, 7],
        point_style: [{ fill: `red` }, { fill: `green` }, { fill: `blue` }],
        metadata: [{ tag: `a` }, { tag: `b` }, { tag: `c` }],
      },
    })
    expect(indexed[1]).toMatchObject({
      color_value: 0.2,
      size_value: 6,
      point_style: { fill: `green` },
      metadata: { tag: `b` },
    })
    const scalar = line_points({
      series: { ...series, metadata: { tag: `all` }, point_style: { fill: `red` } },
    })
    expect(scalar.map((pt) => [pt.metadata, pt.point_style])).toEqual(
      Array.from({ length: 3 }, () => [{ tag: `all` }, { fill: `red` }]),
    )
  })

  type BarRectCase = [
    Partial<Parameters<typeof compute_bar_rect>[0]>,
    Partial<ReturnType<typeof compute_bar_rect>>,
  ]
  // oxfmt-ignore
  const bar_rect_cases: BarRectCase[] = [
    [{}, { c0: 40, c1: 60, v0: 0, v1: 40, rect_w: 20, rect_h: 40 }],
    [{ orientation: `horizontal` }, { rect_x: 0, rect_y: 40, rect_w: 40, rect_h: 20 }],
    [{ base: 3 }, { v0: 12, v1: 52, rect_h: 40 }],
    [{ val: -10 }, { v0: 0, v1: -40, rect_y: -40, rect_h: 40 }],
    // zero-value bars keep zero value extent; tiny ones get floored to 1px at the baseline
    [{ val: 0 }, { rect_w: 20, rect_h: 0 }],
    [{ val: 0, orientation: `horizontal` }, { rect_w: 0, rect_h: 20 }],
    [{ val: 0.001 }, { rect_h: 1 }],
    [{ val: 0.001, orientation: `horizontal` }, { rect_w: 1 }],
    [{ val: -0.001 }, { rect_y: -1, rect_h: 1 }],
    [{ val: -0.001, orientation: `horizontal` }, { rect_x: -1, rect_w: 1 }],
    // tip exactly on the base (clamped log floor): the sign picks the side of the 1px sliver
    [{ val: 5, val_scale: () => 100 }, { rect_y: 99, rect_h: 1 }],
    [{ val: -5, val_scale: () => 100 }, { rect_y: 100, rect_h: 1 }],
    [{ val: 5, val_scale: () => 100, orientation: `horizontal` }, { rect_x: 100, rect_w: 1 }],
    [{ val: -5, val_scale: () => 100, orientation: `horizontal` }, { rect_x: 99, rect_w: 1 }],
    // category thickness has its own 1px floor
    [{ bar_width_val: 0.001 }, { rect_w: 1 }],
    [{ bar_width_val: 0.001, orientation: `horizontal` }, { rect_h: 1 }],
    // grouped: each series takes an evenly divided slot centred on the category
    ...([0, 1, 2] as const).map((series_idx): BarRectCase => [
      { mode: `grouped`, series_idx, bar_width_val: 3, group_info: grouped_3 },
      { c0: 35 + series_idx * 10, c1: 45 + series_idx * 10 },
    ]),
    // a lone bar series spans the full slot, and slots come from original series indices
    [{ mode: `grouped`, group_info: group_info_of([0]) }, { c0: 40, c1: 60 }],
    [{ mode: `grouped`, series_idx: 4, group_info: group_info_of([1, 4]) }, { c0: 50, c1: 60 }],
  ]
  test.each(bar_rect_cases)(`bar_rect %#`, (overrides, expected) => {
    expect(bar_rect(overrides)).toMatchObject(expected)
  })

  // Unbounded so a line's mid-segment cursor still resolves to the nearest vertex.
  test(`nearest_line_point picks the closest vertex at any distance`, () => {
    const points = line_points()
    expect(nearest_line_point(points, { x: 11, y: 8 })?.idx).toBe(0)
    expect(nearest_line_point(points, { x: 29, y: 13 })?.idx).toBe(2)
    expect(nearest_line_point(points, { x: 5000, y: 5000 })?.idx).toBe(2)
    // exact ties keep the earlier vertex
    expect(nearest_line_point(points, { x: 15, y: 9 })?.idx).toBe(0)
    expect(nearest_line_point([], { x: 0, y: 0 })).toBeNull()
  })
})
