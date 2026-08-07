import {
  build_legend_items,
  extract_series_color,
  series_symbol_swatch,
} from '$lib/plot/core/data-transform'
import { DEFAULTS } from '$lib/settings'
import { describe, expect, test } from 'vitest'

describe(`data-transform utility functions`, () => {
  describe(`extract_series_color`, () => {
    test.each([
      {
        name: `extracts color from line_style.stroke`,
        series: { x: [1, 2, 3], y: [1, 2, 3], line_style: { stroke: `red` } },
        expected: `red`,
      },
      {
        name: `extracts color from point_style.fill when no line_style`,
        series: { x: [1, 2, 3], y: [1, 2, 3], point_style: { fill: `blue` } },
        expected: `blue`,
      },
      {
        name: `extracts color from first point_style when array`,
        series: {
          x: [1, 2, 3],
          y: [1, 2, 3],
          point_style: [{ fill: `green` }, { fill: `yellow` }],
        },
        expected: `green`,
      },
      {
        name: `line_style.stroke takes precedence over point_style.fill`,
        series: {
          x: [1, 2, 3],
          y: [1, 2, 3],
          line_style: { stroke: `red` },
          point_style: { fill: `blue` },
        },
        expected: `red`,
      },
      {
        name: `returns default color when no styles defined`,
        series: { x: [1, 2, 3], y: [1, 2, 3] },
        expected: `#4A9EFF`,
      },
      {
        name: `returns default color when styles exist but no color`,
        series: {
          x: [1, 2, 3],
          y: [1, 2, 3],
          line_style: { stroke_width: 2 },
          point_style: { radius: 5 },
        },
        expected: `#4A9EFF`,
      },
      {
        name: `handles empty point_style array`,
        series: { x: [1, 2, 3], y: [1, 2, 3], point_style: [] },
        expected: `#4A9EFF`,
      },
      {
        name: `handles undefined stroke color`,
        series: { x: [1, 2, 3], y: [1, 2, 3], line_style: { stroke: undefined } },
        expected: `#4A9EFF`,
      },
      {
        name: `handles undefined fill color`,
        series: { x: [1, 2, 3], y: [1, 2, 3], point_style: { fill: undefined } },
        expected: `#4A9EFF`,
      },
    ])(`$name`, ({ series, expected }) => {
      expect(extract_series_color(series)).toBe(expected)
    })
  })

  describe(`build_legend_items`, () => {
    const legend_item = (
      series_idx: number,
      label: string,
      symbol_color: string,
      options: {
        visible?: boolean
        has_explicit_label?: boolean
        legend_group?: string
        symbol_type?: string
      } = {},
    ) => ({
      series_idx,
      label,
      visible: options.visible ?? true,
      has_explicit_label: options.has_explicit_label ?? false,
      legend_group: options.legend_group,
      display_style: {
        symbol_type: options.symbol_type ?? DEFAULTS.scatter.symbol_type,
        symbol_color,
      },
    })
    // Every chart gets the same envelope: generated label fallback, visible default,
    // legend_group passthrough and an explicit-label flag.
    test.each([
      {
        name: `falls back to generated labels and visible=true`,
        series: [
          { x: [1, 2], y: [1, 2], point_style: { fill: `red` } },
          { x: [3, 4], y: [3, 4], line_style: { stroke: `blue` } },
          { x: [5, 6], y: [5, 6] },
        ],
        expected: [
          legend_item(0, `Series 1`, `red`),
          legend_item(1, `Series 2`, `blue`),
          legend_item(2, `Series 3`, `#4A9EFF`),
        ],
      },
      {
        name: `keeps explicit labels, visibility and groups`,
        series: [
          {
            x: [1, 2],
            y: [1, 2],
            label: `Custom`,
            visible: false,
            legend_group: `A`,
            point_style: { fill: `green` },
          },
          { x: [3, 4], y: [3, 4], label: `Another`, point_style: { fill: `purple` } },
        ],
        expected: [
          legend_item(0, `Custom`, `green`, {
            visible: false,
            has_explicit_label: true,
            legend_group: `A`,
          }),
          legend_item(1, `Another`, `purple`, {
            has_explicit_label: true,
          }),
        ],
      },
      { name: `handles empty series array`, series: [], expected: [] },
    ])(`$name`, ({ series, expected }) => {
      expect(build_legend_items(series, series_symbol_swatch)).toEqual(expected)
    })

    test(`honors a chart-specific generated label and swatch`, () => {
      expect(
        build_legend_items(
          [
            { x: [1], y: [1] },
            { x: [2], y: [2], label: `Named` },
          ],
          (_srs, idx) => ({ symbol_type: `Square` as const, symbol_color: `c${idx}` }),
          { default_label: (idx) => `Box ${idx + 1}` },
        ),
      ).toEqual([
        legend_item(0, `Box 1`, `c0`, { symbol_type: `Square` }),
        legend_item(1, `Named`, `c1`, {
          has_explicit_label: true,
          symbol_type: `Square`,
        }),
      ])
    })
  })
})
