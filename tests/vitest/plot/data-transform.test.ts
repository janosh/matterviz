import { extract_series_color, prepare_legend_data } from '$lib/plot/core/data-transform'
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

  describe(`prepare_legend_data`, () => {
    test.each([
      {
        name: `prepares legend data with default values`,
        series: [
          { x: [1, 2], y: [1, 2], point_style: { fill: `red` } },
          { x: [3, 4], y: [3, 4], point_style: { fill: `blue` } },
        ],
        expected: [
          {
            series_idx: 0,
            label: `Series 1`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `red`,
            },
          },
          {
            series_idx: 1,
            label: `Series 2`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `blue`,
            },
          },
        ],
      },
      {
        name: `uses custom labels and visibility`,
        series: [
          {
            x: [1, 2],
            y: [1, 2],
            label: `Custom Label`,
            visible: false,
            point_style: { fill: `green` },
          },
          {
            x: [3, 4],
            y: [3, 4],
            label: `Another Label`,
            visible: true,
            point_style: { fill: `purple` },
          },
        ],
        expected: [
          {
            series_idx: 0,
            label: `Custom Label`,
            visible: false,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `green`,
            },
          },
          {
            series_idx: 1,
            label: `Another Label`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `purple`,
            },
          },
        ],
      },
      {
        name: `handles empty series array`,
        series: [],
        expected: [],
      },
      {
        name: `handles mixed color sources`,
        series: [
          { x: [1, 2], y: [1, 2], line_style: { stroke: `red` } },
          { x: [3, 4], y: [3, 4], point_style: { fill: `blue` } },
          { x: [5, 6], y: [5, 6] },
        ],
        expected: [
          {
            series_idx: 0,
            label: `Series 1`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `red`,
            },
          },
          {
            series_idx: 1,
            label: `Series 2`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `blue`,
            },
          },
          {
            series_idx: 2,
            label: `Series 3`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `#4A9EFF`,
            },
          },
        ],
      },
      {
        name: `handles single series`,
        series: [
          {
            x: [1, 2],
            y: [1, 2],
            label: `Single`,
            point_style: { fill: `orange` },
          },
        ],
        expected: [
          {
            series_idx: 0,
            label: `Single`,
            visible: true,
            display_style: {
              symbol_type: DEFAULTS.scatter.symbol_type,
              symbol_color: `orange`,
            },
          },
        ],
      },
    ])(`$name`, ({ series, expected }) => {
      expect(prepare_legend_data(series)).toEqual(expected)
    })
  })
})
