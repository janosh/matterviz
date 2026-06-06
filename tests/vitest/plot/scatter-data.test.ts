import type { DataSeries } from '$lib/plot'
import { get_series_color, get_series_symbol } from '$lib/plot/core/data-transform'
import type { AxisRanges, LegendFill } from '$lib/plot/scatter/scatter-data'
import {
  build_legend_data,
  filter_series_to_ranges,
  pick_tooltip_bg,
} from '$lib/plot/scatter/scatter-data'
import { describe, expect, test } from 'vitest'

const color_scale = (val: number) => `scale(${val})`
const ranges: AxisRanges = { x: [0, 10], x2: [100, 200], y: [0, 10], y2: [-50, 50] }

describe(`filter_series_to_ranges`, () => {
  test(`includes points exactly on range edges, excludes outside`, () => {
    const series: DataSeries[] = [{ x: [0, 5, 10, 10.001, -0.001], y: [0, 5, 10, 5, 5] }]
    const [result] = filter_series_to_ranges(series, ranges)
    expect(result.filtered_data.map((pt) => pt.x)).toEqual([0, 5, 10])
    expect(result.filtered_data[2]).toMatchObject({ x: 10, y: 10, point_idx: 2 })
    // full x array preserved so connecting lines can continue off-range
    expect(result).toMatchObject({ visible: true, x: [0, 5, 10, 10.001, -0.001] })
  })

  test(`drops series whose points are all filtered out (and hidden series)`, () => {
    const series: DataSeries[] = [
      { x: [20, 30], y: [5, 5], label: `off-range` },
      { x: [1, 2], y: [1, 2], label: `in-range` },
      { x: [3], y: [3], label: `hidden`, visible: false },
    ]
    const result = filter_series_to_ranges(series, ranges)
    // orig_series_idx 1 (not 0) keeps color cycling stable after dropping series
    expect(result).toMatchObject([{ label: `in-range`, orig_series_idx: 1 }])
  })

  test(`y2-axis series filters against y2 range, x2 series against x2 range`, () => {
    // y=40 outside y range [0,10] but inside y2 [-50,50]; x=150 outside x but inside x2
    const series: DataSeries[] = [
      { x: [1, 2, 3], y: [40, -40, 60], y_axis: `y2` },
      { x: [150, 250], y: [5, 5], x_axis: `x2` },
    ]
    const [y2_series, x2_series] = filter_series_to_ranges(series, ranges)
    expect(y2_series.filtered_data.map((pt) => pt.y)).toEqual([40, -40]) // 60 > 50 excluded
    expect(x2_series.filtered_data.map((pt) => pt.x)).toEqual([150]) // 250 > 200 excluded
  })

  test(`handles inverted ranges and skips NaN/null coords`, () => {
    const series: DataSeries[] = [{ x: [1, 5, NaN], y: [2, 8, 3] }]
    const [result] = filter_series_to_ranges(series, { ...ranges, x: [10, 0], y: [10, 0] })
    expect(result.filtered_data.map((pt) => pt.x)).toEqual([1, 5])
  })

  test(`augments points with per-point styles, color and size values`, () => {
    const series: DataSeries[] = [
      {
        x: [1, 2],
        y: [3, 4],
        color_values: [0.1, 0.9],
        size_values: [7, 9],
        point_style: [{ fill: `red` }, { fill: `blue` }],
        metadata: [{ tag: `a` }, { tag: `b` }],
      },
    ]
    const pt = filter_series_to_ranges(series, ranges)[0].filtered_data[1]
    expect(pt).toMatchObject({ x: 2, y: 4, color_value: 0.9, size_value: 9, point_idx: 1 })
    expect(pt).toMatchObject({ point_style: { fill: `blue` }, metadata: { tag: `b` } })
  })
})

describe(`build_legend_data`, () => {
  test(`multi-series with fills: labels, default styles, fill entries`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [1], label: `alpha` },
      { x: [2], y: [2] }, // unlabeled -> default label
    ]
    const fills = [
      { idx: 0, source_type: `fill_region`, source_idx: 0, label: `band`, fill: `orange` },
    ] as unknown as LegendFill[]
    expect(build_legend_data(series, fills, color_scale)).toMatchObject([
      {
        series_idx: 0,
        label: `alpha`,
        visible: true,
        has_explicit_label: true,
        display_style: {
          symbol_type: get_series_symbol(0),
          symbol_color: get_series_color(0),
          line_color: get_series_color(0),
        },
      },
      {
        series_idx: 1,
        label: `Series 2`,
        has_explicit_label: false,
        display_style: { symbol_color: get_series_color(1) },
      },
      {
        series_idx: -1,
        item_type: `fill`,
        fill_idx: 0,
        fill_source_type: `fill_region`,
        fill_source_idx: 0,
        label: `band`,
        visible: true,
        display_style: { fill_color: `orange`, fill_opacity: 0.3 },
      },
    ])
  })

  test(`dedupes by legend_group::label across series and fills, keeping first occurrence`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [1], label: `dup`, point_style: { fill: `red` } },
      { x: [2], y: [2], label: `dup`, point_style: { fill: `blue` } }, // same key -> dropped
      { x: [3], y: [3], label: `dup`, legend_group: `g1` }, // different group -> kept
    ]
    const fills = [
      { idx: 0, source_type: `fill_region`, source_idx: 0, label: `dup` }, // dup of series label
      { idx: 1, label: `hidden`, show_in_legend: false },
      { idx: 2, source_type: `error_band`, source_idx: 0 }, // no label -> dropped
      { idx: 3, source_type: `error_band`, source_idx: 1, label: `kept`, visible: false },
    ] as unknown as LegendFill[]
    const items = build_legend_data(series, fills, color_scale)
    expect(items.map((item) => item.label)).toEqual([`dup`, `dup`, `kept`])
    expect(items[0]).toMatchObject({ series_idx: 0, display_style: { symbol_color: `red` } })
    expect(items[1]).toMatchObject({ series_idx: 2, legend_group: `g1` })
    expect(items[2]).toMatchObject({ item_type: `fill`, visible: false })
  })

  test(`markers control which styles appear; line color cascades`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [1], markers: `points`, point_style: { fill: `red` } },
      { x: [2], y: [2], markers: `line`, line_style: { stroke: `green`, line_dash: `4 2` } },
      // no line stroke -> first non-null color_value through the scale
      { x: [3], y: [3], markers: `line`, color_values: [null, 0.5] },
    ]
    const styles = build_legend_data(series, [], color_scale).map((item) => item.display_style)
    // toEqual ignores undefined-valued keys, so it pins the other marker's styles as unset
    expect(styles[0]).toEqual({ symbol_type: get_series_symbol(0), symbol_color: `red` })
    expect(styles[1]).toEqual({ line_color: `green`, line_dash: `4 2` })
    expect(styles[2].line_color).toBe(`scale(0.5)`)
  })

  test(`point stroke replaces transparent/none fill for symbol color`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [1], point_style: { fill: `none`, stroke: `purple` } },
      { x: [2], y: [2], point_style: [{ fill: `rgba(0, 0, 0, 0.5)`, stroke: `teal` }] },
    ]
    const items = build_legend_data(series, [], color_scale)
    expect(items[0].display_style.symbol_color).toBe(`purple`)
    expect(items[1].display_style.symbol_color).toBe(`teal`) // rgba( prefix counts as transparent
  })
})

describe(`pick_tooltip_bg`, () => {
  const base: DataSeries = { x: [1], y: [1] }
  // fill is transparent so the cascade must move past it to the point stroke
  const see_thru = { point_style: { fill: `rgba(0, 0, 0, 0)`, stroke: `blue` } }
  const dark = `rgba(0, 0, 0, 0.7)` // ultimate fallback

  // cascade: color_value -> point fill -> point stroke (points marker only) -> series
  // line cascade (stroke -> first point fill -> first color value -> first point stroke)
  // oxfmt-ignore
  test.each<[string, Parameters<typeof pick_tooltip_bg>[0], DataSeries | undefined, string]>([
    [`color_value through scale wins over point fill`, { color_value: 0.7, point_style: { fill: `red` } }, base, `scale(0.7)`],
    [`point_style fill wins when no color_value`, { point_style: { fill: `red` } }, base, `red`],
    [`transparent fill falls through to point stroke`, see_thru, base, `blue`],
    [`line-only markers skip point stroke`, see_thru, { ...base, markers: `line` }, dark],
    [`line cascade: series stroke`, {}, { ...base, line_style: { stroke: `green` } }, `green`],
    [`line cascade: first point fill`, {}, { ...base, point_style: [{ fill: `gold` }] }, `gold`],
    [`line cascade: first color value`, {}, { ...base, color_values: [0.2] }, `scale(0.2)`],
    [`line cascade: first point stroke`, {}, { ...base, point_style: { stroke: `navy` } }, `navy`],
    [`dark default when nothing usable`, {}, base, dark],
    [`dark default for undefined series`, {}, undefined, dark],
    [`dark default for transparent point fill`, { point_style: { fill: `transparent` } }, base, dark],
  ])(`%s`, (_desc, point, series, expected) => {
    expect(pick_tooltip_bg(point, series, color_scale)).toBe(expected)
  })
})
