import type { DataSeries } from '$lib/plot'
import {
  create_data_points,
  extract_series_color,
  filter_visible_series,
  prepare_legend_data,
} from '$lib/plot/data-transform'
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
        series: [{
          x: [1, 2],
          y: [1, 2],
          label: `Single`,
          point_style: { fill: `orange` },
        }],
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

  describe(`filter_visible_series`, () => {
    test.each([
      {
        name: `filters visible series`,
        series: [
          { x: [1, 2], y: [1, 2], visible: true },
          { x: [3, 4], y: [3, 4], visible: false },
          { x: [5, 6], y: [5, 6], visible: true },
          { x: [7, 8], y: [7, 8] },
        ],
        expected_length: 3,
        expected_indices: [0, 2, 3],
      },
      {
        name: `handles all visible series`,
        series: [
          { x: [1, 2], y: [1, 2], visible: true },
          { x: [3, 4], y: [3, 4], visible: true },
        ],
        expected_length: 2,
        expected_indices: [0, 1],
      },
      {
        name: `handles all hidden series`,
        series: [
          { x: [1, 2], y: [1, 2], visible: false },
          { x: [3, 4], y: [3, 4], visible: false },
        ],
        expected_length: 0,
        expected_indices: [],
      },
      {
        name: `handles empty series array`,
        series: [],
        expected_length: 0,
        expected_indices: [],
      },
      {
        name: `treats undefined visible as true`,
        series: [
          { x: [1, 2], y: [1, 2] },
          { x: [3, 4], y: [3, 4] },
        ],
        expected_length: 2,
        expected_indices: [0, 1],
      },
      {
        name: `handles mixed visibility states`,
        series: [
          { x: [1, 2], y: [1, 2], visible: true },
          { x: [3, 4], y: [3, 4] },
          { x: [5, 6], y: [5, 6], visible: false },
          { x: [7, 8], y: [7, 8], visible: true },
        ],
        expected_length: 3,
        expected_indices: [0, 1, 3],
      },
    ])(`$name`, ({ series, expected_length, expected_indices }) => {
      const result = filter_visible_series(series)
      expect(result).toHaveLength(expected_length)
      expected_indices.forEach((idx, resultIdx) => {
        expect(result[resultIdx]).toBe(series[idx])
      })
    })
  })

  describe(`create_data_points`, () => {
    test.each([
      {
        name: `creates data points from series`,
        series: [
          { x: [1, 2], y: [10, 20] },
          { x: [3, 4], y: [30, 40] },
        ],
        filter_fn: undefined,
        expected: [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 3, y: 30 },
          { x: 4, y: 40 },
        ],
      },
      {
        name: `filters out invisible series by default`,
        series: [
          { x: [1, 2], y: [10, 20], visible: true },
          { x: [3, 4], y: [30, 40], visible: false },
          { x: [5, 6], y: [50, 60] },
        ],
        filter_fn: undefined,
        expected: [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 5, y: 50 },
          { x: 6, y: 60 },
        ],
      },
      {
        name: `uses custom filter function`,
        series: [
          { x: [1, 2], y: [10, 20], label: `keep` },
          { x: [3, 4], y: [30, 40], label: `remove` },
          { x: [5, 6], y: [50, 60], label: `keep` },
        ],
        filter_fn: (s: DataSeries) => s.label === `keep`,
        expected: [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 5, y: 50 },
          { x: 6, y: 60 },
        ],
      },
      {
        name: `handles empty series array`,
        series: [],
        filter_fn: undefined,
        expected: [],
      },
      {
        name: `handles series with mismatched array lengths`,
        series: [
          { x: [1, 2, 3], y: [10, 20] },
          { x: [4], y: [40, 50, 60] },
        ],
        filter_fn: undefined,
        expected: [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 4, y: 40 },
        ],
      },
      {
        name: `handles empty x and y arrays`,
        series: [
          { x: [], y: [] },
          { x: [1, 2], y: [10, 20] },
        ],
        filter_fn: undefined,
        expected: [
          { x: 1, y: 10 },
          { x: 2, y: 20 },
        ],
      },
      {
        name: `handles single data point`,
        series: [{ x: [42], y: [100] }],
        filter_fn: undefined,
        expected: [{ x: 42, y: 100 }],
      },
      {
        name: `handles zero values`,
        series: [{ x: [0, 1], y: [0, 10] }],
        filter_fn: undefined,
        expected: [
          { x: 0, y: 0 },
          { x: 1, y: 10 },
        ],
      },
      {
        name: `handles negative values`,
        series: [{ x: [-1, 0], y: [-10, 5] }],
        filter_fn: undefined,
        expected: [
          { x: -1, y: -10 },
          { x: 0, y: 5 },
        ],
      },
    ])(`$name`, ({ series, filter_fn, expected }) => {
      const result = create_data_points(series, filter_fn)
      expect(result).toEqual(expected)
    })
  })
})
