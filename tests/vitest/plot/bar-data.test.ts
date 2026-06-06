import type { BarAutoRangeOpts, NumericBarSeries } from '$lib/plot/bar/data'
import {
  compute_bar_auto_ranges,
  compute_group_info,
  compute_stacked_offsets,
  normalize_categorical,
} from '$lib/plot/bar/data'
import type { BarSeries } from '$lib/plot'
import { describe, expect, test, vi } from 'vitest'

const bar = (overrides: Partial<NumericBarSeries> = {}): NumericBarSeries => ({
  x: [0, 1],
  y: [1, 2],
  ...overrides,
})

const make_opts = (overrides: Partial<BarAutoRangeOpts> = {}): BarAutoRangeOpts => ({
  visible_series: [],
  y1_series: [],
  y2_series: [],
  x2_series: [],
  mode: `overlay`,
  orientation: `vertical`,
  range_padding: 0,
  category_count: 0,
  x_range: [null, null],
  x_scale_type: `linear`,
  x_is_time: false,
  x2_range: [null, null],
  x2_scale_type: `linear`,
  x2_is_time: false,
  y_range: [null, null],
  y_scale_type: `linear`,
  y2_range: [null, null],
  y2_scale_type: `linear`,
  ...overrides,
})

const auto_ranges = (series: NumericBarSeries[], overrides: Partial<BarAutoRangeOpts> = {}) =>
  compute_bar_auto_ranges(
    make_opts({ visible_series: series, y1_series: series, ...overrides }),
  )

describe(`normalize_categorical`, () => {
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
      },
      { x: [`a`, `b`, `c`], y: [1, 2, 3], metadata: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    ]
    const { internal_series } = normalize_categorical(series)
    // categories: ['b', 'c', 'a'] (first-seen order across series)
    const [s1, s2] = internal_series
    expect(s1.labels).toEqual([`B`, `C`, null])
    expect(s1.bar_width).toEqual([0.2, 0.4, 0.5])
    expect(s1.color_values).toEqual([7, 8, null])
    expect(s1.size_values).toEqual([5, 6, null])
    // scalar metadata is replicated for present categories, undefined for missing
    expect(s1.metadata).toEqual([{ tag: `scalar` }, { tag: `scalar` }, undefined])
    expect(s2.metadata).toEqual([{ id: 2 }, { id: 3 }, { id: 1 }])
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

  test(`stacked mode lets line series contribute absolute (unstacked) values`, () => {
    const series = [bar({ y: [3, 4] }), bar({ y: [10, 10], render_mode: `line` })]
    expect(auto_ranges(series, { mode: `stacked` }).y).toEqual([0, 10]) // line max not stacked
  })

  test(`log scale skips zero-clamping`, () => {
    const series = [bar({ y: [4, 5] })]
    expect(auto_ranges(series).y[0]).toBe(0)
    expect(auto_ranges(series, { y_scale_type: `log` }).y[0]).toBeGreaterThan(0)
  })

  test(`explicit y_range disables zero-clamping`, () => {
    expect(auto_ranges([bar({ y: [4, 5] })], { y_range: [2, 6] }).y).toEqual([2, 6])
  })

  test(`categorical data fixes x range to [-0.5, count - 0.5]`, () => {
    const series = [bar({ x: [0, 1, 2], y: [1, 2, 3] })]
    expect(auto_ranges(series, { category_count: 3 }).x).toEqual([-0.5, 2.5])
  })

  test(`horizontal orientation swaps category and value axes`, () => {
    const series = [bar({ x: [0, 10], y: [1, 5] })]
    expect(auto_ranges(series)).toMatchObject({ x: [0, 10], y: [0, 5] })
    expect(auto_ranges(series, { orientation: `horizontal` })).toMatchObject({
      x: [0, 5],
      y: [0, 10],
    })
  })

  test(`empty series fall back to [0, 1] sentinels`, () => {
    expect(auto_ranges([])).toEqual({ x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] })
  })

  test(`x2 series get their own range; x stays sentinel without x1 series`, () => {
    const x2_srs = bar({ x: [100, 200], y: [1, 2], x_axis: `x2` })
    const result = auto_ranges([x2_srs], { x2_series: [x2_srs] })
    expect(result.x2).toEqual([100, 200])
    expect(result.x).toEqual([0, 1])
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
  ])(`offsets $desc`, ({ series, expected }) => {
    expect(compute_stacked_offsets(series, `stacked`)).toEqual(expected)
  })
})

describe(`compute_group_info`, () => {
  test.each([`overlay`, `stacked`] as const)(`returns empty info for %s mode`, (mode) => {
    expect(compute_group_info([bar(), bar()], mode)).toEqual({
      bar_series_count: 0,
      bar_series_indices: [],
    })
  })

  test(`indices are original series indices, skipping hidden and line series`, () => {
    const series = [bar(), bar({ visible: false }), bar({ render_mode: `line` }), bar()]
    expect(compute_group_info(series, `grouped`)).toEqual({
      bar_series_count: 2,
      bar_series_indices: [0, 3],
    })
  })
})
