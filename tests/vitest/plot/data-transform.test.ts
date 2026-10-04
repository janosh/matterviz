import {
  build_legend_items,
  extract_series_color,
  series_symbol_swatch,
} from '#lib/plot/core/data-transform.js'
import { DEFAULTS } from '#lib/settings.js'
import { describe, expect, test } from 'vitest'

describe(`data-transform utility functions`, () => {
  describe(`extract_series_color`, () => {
    const fallback = `#4A9EFF`
    // oxfmt-ignore
    test.each([
      [`extracts color from line_style.stroke`, { line_style: { stroke: `red` } }, `red`],
      [`extracts color from point_style.fill when no line_style`, { point_style: { fill: `blue` } }, `blue`],
      [`extracts color from first point_style when array`, { point_style: [{ fill: `green` }, { fill: `yellow` }] }, `green`],
      [`line_style.stroke takes precedence over point_style.fill`, { line_style: { stroke: `red` }, point_style: { fill: `blue` } }, `red`],
      [`returns default color when no styles defined`, {}, fallback],
      [`returns default color when styles exist but no color`, { line_style: { stroke_width: 2 }, point_style: { radius: 5 } }, fallback],
      [`handles empty point_style array`, { point_style: [] }, fallback],
      [`handles undefined stroke color`, { line_style: { stroke: undefined } }, fallback],
      [`handles undefined fill color`, { point_style: { fill: undefined } }, fallback],
    ])(`%s`, (_name, styles, expected) => {
      expect(extract_series_color({ x: [1, 2, 3], y: [1, 2, 3], ...styles })).toBe(expected)
    })
  })

  describe(`build_legend_items`, () => {
    const legend_item = (
      series_idx: number,
      label: string,
      symbol_color: string,
      options: { visible?: boolean; legend_group?: string; symbol_type?: string } = {},
    ) => ({
      series_idx,
      label,
      visible: options.visible ?? true,
      legend_group: options.legend_group,
      display_style: {
        symbol_type: options.symbol_type ?? DEFAULTS.scatter.symbol_type,
        symbol_color,
      },
    })
    // Every chart gets the same envelope: generated label fallback, visible default,
    // legend_group passthrough.
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
          legend_item(0, `Custom`, `green`, { visible: false, legend_group: `A` }),
          legend_item(1, `Another`, `purple`),
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
        legend_item(1, `Named`, `c1`, { symbol_type: `Square` }),
      ])
    })
  })
})
