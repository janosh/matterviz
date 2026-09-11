import { line } from 'd3-shape'
import { line_curve_factory } from '$lib/plot/core/fill-utils'
import type { Vec2 } from '$lib/math'
import type { AxisRanges, DataSeries } from '$lib/plot'
import { plot_color } from '$lib/colors'
import { get_series_symbol } from '$lib/plot/core/data-transform'
import type { LegendFill } from '$lib/plot/scatter/scatter-data'
import {
  build_legend_data,
  filter_series_to_ranges,
  materialize_series_points,
  pick_tooltip_bg,
  project_line_points,
  strict_x_direction,
} from '$lib/plot/scatter/scatter-data'
import { describe, expect, test } from 'vitest'

const color_scale = (val: number) => `scale(${val})`
const ranges: AxisRanges = { x: [0, 10], x2: [100, 200], y: [0, 10], y2: [-50, 50] }
// materialize + range-filter in one step, the way ScatterPlot chains them per frame
const filter_to_ranges = (
  series: readonly (DataSeries | null | undefined)[],
  axis_ranges: AxisRanges,
) => filter_series_to_ranges(materialize_series_points(series), axis_ranges)

describe(`filter_series_to_ranges`, () => {
  test.each([
    [`unordered`, [0, 5, 10, 10.001, -0.001]],
    [`ascending with ties`, [-0.001, 0, 5, 5, 10, 10.001]],
    [`descending with ties`, [10.001, 10, 5, 5, 0, -0.001]],
    [`constant`, [5, 5, 5]],
    [`empty`, []],
  ] as const)(
    `filters %s points inclusively without changing their order or identity`,
    (_name, x_values) => {
      const series: DataSeries[] = [
        { x: [...x_values], y: x_values.map(() => 5), markers: `line` },
      ]
      const materialized = materialize_series_points(series)
      for (const x_range of [
        [0, 10],
        [10, 0],
        [5, 5],
        [-20, -10],
        [20, 30],
        [NaN, 10],
        [-Infinity, Infinity],
      ]) {
        const [result] = filter_series_to_ranges(materialized, {
          ...ranges,
          x: [x_range[0], x_range[1]],
        })
        const expected = materialized[0].points.filter(
          (point) => point.x >= Math.min(...x_range) && point.x <= Math.max(...x_range),
        )
        expect(result.filtered_data).toEqual(expected)
        for (const [idx, point] of result.filtered_data.entries())
          expect(point).toBe(expected[idx])
        // Connecting lines still receive the complete source arrays outside the marker window.
        expect(result.x).toBe(series[0].x)
      }
    },
  )

  test(`drops series whose points are all filtered out (and hidden series)`, () => {
    const series: DataSeries[] = [
      { x: [20, 30], y: [5, 5], label: `off-range`, markers: `points` },
      { x: [1, 2], y: [1, 2], label: `in-range` },
      { x: [3], y: [3], label: `hidden`, visible: false },
    ]
    const result = filter_to_ranges(series, ranges)
    // orig_series_idx 1 (not 0) keeps color cycling stable after dropping series
    expect(result).toMatchObject([{ label: `in-range`, orig_series_idx: 1 }])
  })

  test(`retains off-range line series with full arrays and no marker data`, () => {
    const series: DataSeries[] = [{ x: [20, 30], y: [4, 6], label: `line`, markers: `line` }]
    const [result] = filter_to_ranges(series, ranges)
    expect(result).toMatchObject({
      x: [20, 30],
      y: [4, 6],
      label: `line`,
      filtered_data: [],
      orig_series_idx: 0,
    })
  })

  test(`y2-axis series filters against y2 range, x2 series against x2 range`, () => {
    // y=40 outside y range [0,10] but inside y2 [-50,50]; x=150 outside x but inside x2
    const series: DataSeries[] = [
      { x: [1, 2, 3], y: [40, -40, 60], y_axis: `y2` },
      { x: [150, 250], y: [5, 5], x_axis: `x2` },
    ]
    const [y2_series, x2_series] = filter_to_ranges(series, ranges)
    expect(y2_series.filtered_data.map((point) => point.y)).toEqual([40, -40]) // 60 > 50 excluded
    expect(x2_series.filtered_data.map((point) => point.x)).toEqual([150]) // 250 > 200 excluded
  })

  test(`handles inverted ranges via min/max of the bounds`, () => {
    const series: DataSeries[] = [{ x: [1, 5, 15], y: [2, 8, 3] }]
    const [result] = filter_to_ranges(series, { ...ranges, x: [10, 0], y: [10, 0] })
    expect(result.filtered_data.map((point) => point.x)).toEqual([1, 5]) // 15 outside effective [0, 10]
  })

  // Non-finite coords must drop even with an infinite range — `!isNaN` misses ±Infinity.
  // Null must not coerce to 0. NaN range bounds reject everything.
  test.each([
    [`NaN`, NaN],
    [`+Infinity`, Infinity],
    [`-Infinity`, -Infinity],
    [`null`, null],
  ] as const)(`excludes %s coords`, (_desc, bad_val) => {
    const axis_ranges: AxisRanges =
      bad_val === null
        ? ranges
        : {
            x: [-Infinity, Infinity],
            x2: [0, 1],
            y: [-Infinity, Infinity],
            y2: [0, 1],
          }
    const series = [{ x: [1, bad_val, 3], y: [2, 2, bad_val] }] as unknown as DataSeries[]
    const [result] = filter_to_ranges(series, axis_ranges)
    expect(result.filtered_data.map((point) => point.x)).toEqual([1])
  })

  test(`rejects NaN range bounds; tolerates missing series arrays`, () => {
    expect(
      filter_to_ranges([{ x: [-1, 1], y: [2, 2], markers: `points` }], {
        ...ranges,
        x: [0, NaN],
      }),
    ).toEqual([])
    const result = filter_to_ranges(
      [undefined, { y: [1] }, { x: [1] }, { x: [1], y: [4] }] as unknown as DataSeries[],
      ranges,
    )
    expect(result).toHaveLength(1)
    expect(result[0].filtered_data.map((point) => [point.x, point.y])).toEqual([[1, 4]])
    expect(result[0].orig_series_idx).toBe(3)
  })

  test.each<[string, DataSeries, string, string?]>([
    [`short y`, { id: `energy`, x: [0, 1], y: [2] }, `x=2, y=1`],
    [`long y`, { id: `energy`, x: [0], y: [1, 2] }, `x=1, y=2`],
    [`short raw_y`, { id: `energy`, x: [0, 1], y: [2, 3], raw_y: [2] }, `x=2, y=2, raw_y=1`],
    [`long raw_y`, { id: `energy`, x: [0], y: [1], raw_y: [1, 2] }, `x=1, y=1, raw_y=2`],
    [`hidden series`, { id: `energy`, x: [0, 1], y: [2], visible: false }, `x=2, y=1`],
    [
      `misaligned underlay`,
      { id: `energy`, x: [0, 1], y: [2, 3], line_underlays: [{ x: [0, 1], y: [2] }] },
      `x=2, y=1`,
      ` line_underlays[0]`,
    ],
  ])(`rejects %s`, (_name, series, lengths, group = ``) => {
    expect(() => filter_to_ranges([series], ranges)).toThrow(
      `Series "energy"${group}: aligned arrays must have equal lengths, got ${lengths}`,
    )
  })

  test(`augments points with array or scalar per-point props`, () => {
    const arrayed = filter_to_ranges(
      [
        {
          x: [1, 2],
          y: [3, 4],
          color_values: [0.1, 0.9],
          size_values: [7, 9],
          point_style: [{ fill: `red` }, { fill: `blue` }],
          metadata: [{ tag: `a` }, { tag: `b` }],
        },
      ],
      ranges,
    )[0].filtered_data[1]
    expect(arrayed).toMatchObject({
      x: 2,
      y: 4,
      color_value: 0.9,
      size_value: 9,
      point_idx: 1,
      point_style: { fill: `blue` },
      metadata: { tag: `b` },
    })
    expect(
      filter_to_ranges(
        [{ x: [1, 2], y: [3, 4], point_style: { fill: `red` }, metadata: { tag: `shared` } }],
        ranges,
      )[0].filtered_data,
    ).toMatchObject([
      { point_style: { fill: `red` }, metadata: { tag: `shared` } },
      { point_style: { fill: `red` }, metadata: { tag: `shared` } },
    ])
  })
})

describe(`build_legend_data`, () => {
  test(`multi-series with fills: labels, default styles, fill entries`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [1], label: `alpha`, point_style: { symbol_type: `Square` } },
      { x: [2], y: [2], point_style: [{ symbol_type: `Triangle` }] }, // unlabeled
    ]
    const fills = [
      { idx: 0, source_type: `fill_region`, source_idx: 0, label: `band`, fill: `orange` },
    ] as unknown as LegendFill[]
    expect(build_legend_data(series, fills, color_scale)).toMatchObject([
      {
        series_idx: 0,
        label: `alpha`,
        visible: true,
        display_style: {
          symbol_type: `Square`,
          symbol_color: plot_color(0),
          line_color: plot_color(0),
        },
      },
      {
        series_idx: 1,
        label: `Series 2`,
        display_style: { symbol_type: get_series_symbol(1) },
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

  test(`labels cannot merge independent series or hide a fill entry`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [1], label: `dup`, point_style: { fill: `red` } },
      { x: [2], y: [2], label: `dup`, point_style: { fill: `blue` } },
      { x: [3], y: [3], label: `dup`, legend_group: `g1` },
    ]
    const fills = [
      { idx: 0, source_type: `fill_region`, source_idx: 0, label: `dup` },
      { idx: 1, label: `hidden`, show_in_legend: false },
      { idx: 2, source_type: `error_band`, source_idx: 0 }, // no label -> dropped
      { idx: 3, source_type: `error_band`, source_idx: 1, label: `kept`, visible: false },
    ] as unknown as LegendFill[]
    const items = build_legend_data(series, fills, color_scale)
    expect(items.map((item) => item.label)).toEqual([`dup`, `dup`, `dup`, `dup`, `kept`])
    expect(items[0]).toMatchObject({ series_idx: 0, display_style: { symbol_color: `red` } })
    expect(items[1]).toMatchObject({ series_idx: 1, display_style: { symbol_color: `blue` } })
    expect(items[2]).toMatchObject({ series_idx: 2, legend_group: `g1` })
    expect(items[3]).toMatchObject({ item_type: `fill`, fill_idx: 0, visible: true })
    expect(items[4]).toMatchObject({ item_type: `fill`, visible: false })
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
      { x: [2], y: [2], point_style: [{ fill: `rgba(0, 0, 0, 0)`, stroke: `teal` }] },
      // alpha, not the `rgba(` prefix, decides: a visible fill is kept over the stroke
      { x: [3], y: [3], point_style: { fill: `rgba(255, 0, 0, 0.5)`, stroke: `teal` } },
    ]
    const items = build_legend_data(series, [], color_scale)
    expect(items.map((item) => item.display_style.symbol_color)).toEqual([
      `purple`,
      `teal`,
      `rgba(255, 0, 0, 0.5)`,
    ])
  })

  test(`a null series holds its index but contributes no legend row`, () => {
    const series = [
      { x: [1], y: [1], label: `A` },
      null,
      { x: [3], y: [3], label: `B` },
    ] as unknown as DataSeries[]
    const items = build_legend_data(series, [], color_scale)
    // no phantom `Series 2` row, and B keeps index 2 so toggling it hits the right series
    expect(items.map((item) => [item.label, item.series_idx])).toEqual([
      [`A`, 0],
      [`B`, 2],
    ])
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

describe(`viewport line projection`, () => {
  test.each([`linear`, `step`, `monotone`] as const)(
    `preserves visible %s segments exactly`,
    (curve) => {
      for (const descending of [false, true]) {
        for (const invalid_y of [false, true]) {
          const x_values = Array.from({ length: 101 }, (_, idx) => idx)
          if (descending) x_values.reverse()
          const data = {
            x: x_values,
            y: x_values.map((value) => (invalid_y && value % 7 === 0 ? NaN : Math.sin(value))),
          }
          const x_scale = (value: number) => value * 10
          const y_scale = (value: number) => value * 20
          for (const range of [
            [30.2, 40.8],
            [40.8, 30.2],
            [30.2, 30.8],
            [-5, 2],
            [98, 110],
          ] as Vec2[]) {
            const cropped = project_line_points(
              data,
              x_scale,
              y_scale,
              range,
              strict_x_direction(data.x),
              curve,
            )
            const full = project_line_points(data, x_scale, y_scale, range, 0, curve)
            const lower = Math.min(...range) * 10
            const upper = Math.max(...range) * 10
            const segments = (points: Vec2[]) => {
              let previous: Vec2 = [NaN, NaN]
              const output: number[][] = []
              const add = (...coords: number[]) => {
                const end: Vec2 = [coords.at(-2) ?? NaN, coords.at(-1) ?? NaN]
                if (
                  Math.max(previous[0], end[0]) >= lower &&
                  Math.min(previous[0], end[0]) <= upper
                )
                  output.push([...previous, ...coords])
                previous = end
              }
              line()
                .curve(line_curve_factory(curve))
                .context({
                  moveTo: (pixel_x: number, pixel_y: number) => {
                    previous = [pixel_x, pixel_y]
                  },
                  lineTo: add,
                  bezierCurveTo: add,
                  closePath: () => {},
                } as unknown as CanvasRenderingContext2D)(points)
              return output
            }
            expect(segments(cropped)).toEqual(segments(full))
            expect(cropped.length).toBeLessThan(full.length)
          }
        }
      }
    },
  )

  test.each([[1, 2, 2, 3], [3, 1, 2], [1, NaN, 3], [1, Infinity], [], [1]])(
    `keeps full paths for non-strict x order %j`,
    (...values) => {
      let reads = 0
      const counted = new Proxy(values, {
        get(target, prop, receiver) {
          if (typeof prop === `string` && /^\d+$/.test(prop)) reads++
          return Reflect.get(target, prop, receiver)
        },
      })
      expect(strict_x_direction(counted)).toBe(0)
      expect(reads).toBeLessThanOrEqual(values.length + 1)
      const data = { x: values, y: values.map(() => 1) }
      const identity = (value: number) => value
      expect(project_line_points(data, identity, identity, [1, 2], 0)).toEqual(
        values.filter(Number.isFinite).map((value) => [value, 1]),
      )
    },
  )
})
