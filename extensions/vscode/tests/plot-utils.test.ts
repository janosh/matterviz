import { describe, expect, test } from 'vitest'
import {
  build_bar_series,
  build_histogram_series,
  build_scatter3d_series,
  build_scatter_series,
  col_keys,
  extract_columns,
  suggest_mapping,
} from '../src/webview/plot-utils'

describe(`extract_columns`, () => {
  test(`column-based: extracts numeric and string columns`, () => {
    const data = { x: [1, 2, 3], y: [4, 5, 6], label: [`a`, `b`, `c`] }
    const cols = extract_columns(data)
    expect(cols.size).toBe(3)
    expect(cols.get(`x`)?.type).toBe(`numeric`)
    expect(cols.get(`y`)?.type).toBe(`numeric`)
    expect(cols.get(`label`)?.type).toBe(`string`)
    expect(cols.get(`x`)?.values).toEqual([1, 2, 3])
  })

  test(`column-based: skips columns with different lengths`, () => {
    const data = { x: [1, 2, 3], y: [4, 5], label: [`a`, `b`, `c`] }
    const cols = extract_columns(data)
    expect(cols.has(`y`)).toBe(false)
    expect(cols.size).toBe(2)
  })

  test(`row-based: extracts from array of objects`, () => {
    const data = [
      { energy: -5.4, volume: 20.5, name: `Si` },
      { energy: -4.6, volume: 22.7, name: `Ge` },
      { energy: -7.4, volume: 11.2, name: `C` },
    ]
    const cols = extract_columns(data)
    expect(cols.size).toBe(3)
    expect(cols.get(`energy`)?.type).toBe(`numeric`)
    expect(cols.get(`volume`)?.type).toBe(`numeric`)
    expect(cols.get(`name`)?.type).toBe(`string`)
    expect(cols.get(`energy`)?.values).toEqual([-5.4, -4.6, -7.4])
  })

  test.each([null, `hello`, 42, { single: [1, 2] }])(
    `returns empty map for non-tabular data: %j`,
    (data) => expect(extract_columns(data).size).toBe(0),
  )

  test(`handles null values in columns`, () => {
    const data = { x: [1, null, 3], y: [4, 5, null] }
    const cols = extract_columns(data)
    expect(cols.get(`x`)?.n_valid).toBe(2)
    expect(cols.get(`y`)?.n_valid).toBe(2)
  })

  test(`classifies mixed-type columns when below 80% threshold`, () => {
    const data = [
      { val: 1 },
      { val: `two` },
      { val: 3 },
      { val: `four` },
      { val: 5 },
    ]
    const cols = extract_columns(data)
    expect(cols.get(`val`)?.type).toBe(`mixed`)
  })

  test(`classifies as numeric when >= 80% are numbers`, () => {
    const data = { val: [1, 2, 3, 4, `outlier`], idx: [0, 1, 2, 3, 4] }
    const cols = extract_columns(data)
    expect(cols.get(`val`)?.type).toBe(`numeric`)
    expect(cols.get(`val`)?.n_valid).toBe(5)
  })

  test(`classifies all-null column as mixed with n_valid=0`, () => {
    const data = { x: [1, 2], y: [null, undefined] }
    const cols = extract_columns(data)
    expect(cols.get(`y`)?.type).toBe(`mixed`)
    expect(cols.get(`y`)?.n_valid).toBe(0)
  })
})

describe(`col_keys`, () => {
  test(`filters columns by type`, () => {
    const cols = extract_columns({ x: [1, 2], name: [`a`, `b`], y: [3, 4] })
    expect(col_keys(cols, `numeric`)).toEqual([`x`, `y`])
    expect(col_keys(cols, `string`)).toEqual([`name`])
    expect(col_keys(cols, `mixed`)).toEqual([])
  })
})

describe(`suggest_mapping`, () => {
  test(`assigns x and y to first two numeric columns`, () => {
    const cols = extract_columns({ a: [1, 2], b: [3, 4], c: [5, 6] })
    const { plot_type, mapping } = suggest_mapping(cols)
    expect(plot_type).toBe(`scatter`)
    expect(mapping.x).toBe(`a`)
    expect(mapping.y).toBe(`b`)
    expect(mapping.color).toBe(`c`)
  })

  test(`prefers well-known names for x/y`, () => {
    const cols = extract_columns({ energy: [1, 2], time: [3, 4], force: [5, 6] })
    const { mapping } = suggest_mapping(cols)
    expect(mapping.x).toBe(`time`)
    expect(mapping.y).toBe(`energy`)
  })

  test.each(
    [
      [`bar (string + 2 numeric)`, `bar`, `material`, {
        material: [`Si`, `Ge`, `C`],
        energy: [-5.4, -4.6, -7.4],
        volume: [20.5, 22.7, 11.2],
      }],
      [`bar (string + 1 numeric)`, `bar`, `name`, {
        name: [`Si`, `Ge`, `C`],
        energy: [-5.4, -4.6, -7.4],
      }],
      [`scatter3d (x/y/z columns)`, `scatter3d`, `x`, {
        x: [1, 2],
        y: [3, 4],
        z: [5, 6],
      }],
    ] as const,
  )(`suggests %s`, (_, expected_type, expected_x, data) => {
    const { plot_type, mapping } = suggest_mapping(extract_columns(data))
    expect(plot_type).toBe(expected_type)
    expect(mapping.x).toBe(expected_x)
  })

  test(`assigns color to first unassigned numeric column`, () => {
    const cols = extract_columns({ x: [1, 2], y: [3, 4], temp: [5, 6], sz: [7, 8] })
    const { mapping } = suggest_mapping(cols)
    expect(mapping.color).toBe(`temp`)
  })

  test(`single numeric column defaults to scatter (y assigned, x empty)`, () => {
    const cols = new Map([[`a`, {
      values: [1, 2, 3],
      type: `numeric` as const,
      n_valid: 3,
    }]])
    const { plot_type, mapping } = suggest_mapping(cols)
    expect(plot_type).toBe(`scatter`)
    expect(mapping.y).toBe(`a`)
    expect(mapping.x).toBeUndefined()
  })

  test(`empty columns map falls back to histogram`, () => {
    const { plot_type, mapping } = suggest_mapping(new Map())
    expect(plot_type).toBe(`histogram`)
    expect(mapping.x).toBeUndefined()
    expect(mapping.y).toBeUndefined()
  })
})

describe(`build_scatter_series`, () => {
  test(`builds series from columns`, () => {
    const cols = extract_columns({ x: [1, 2, 3], y: [4, 5, 6] })
    const series = build_scatter_series(cols, { x: `x`, y: `y` })
    expect(series.x).toEqual([1, 2, 3])
    expect(series.y).toEqual([4, 5, 6])
  })

  test.each(
    [
      [`color`, { x: `x`, y: `y`, color: `extra` }, `color_values`],
      [`size`, { x: `x`, y: `y`, size: `extra` }, `size_values`],
    ] as const,
  )(`includes %s_values when mapped`, (_, axis_mapping, prop) => {
    const cols = extract_columns({ x: [1, 2], y: [3, 4], extra: [5, 6] })
    const series = build_scatter_series(cols, axis_mapping)
    expect(series[prop]).toEqual([5, 6])
  })

  test(`filters out points with non-finite x or y`, () => {
    const cols = extract_columns({ x: [1, null, 3], y: [4, 5, 6], c: [10, 20, 30] })
    const series = build_scatter_series(cols, { x: `x`, y: `y`, color: `c` })
    expect(series.x).toEqual([1, 3])
    expect(series.y).toEqual([4, 6])
    expect(series.color_values).toEqual([10, 30])
  })
})

describe(`build_scatter3d_series`, () => {
  test(`builds 3d series`, () => {
    const cols = extract_columns({ x: [1, 2], y: [3, 4], z: [5, 6] })
    const series = build_scatter3d_series(cols, { x: `x`, y: `y`, z: `z` })
    expect(series.x).toEqual([1, 2])
    expect(series.y).toEqual([3, 4])
    expect(series.z).toEqual([5, 6])
  })

  test(`includes color and size values when mapped`, () => {
    const cols = extract_columns({
      x: [1, 2],
      y: [3, 4],
      z: [5, 6],
      c: [7, 8],
      sz: [9, 10],
    })
    const series = build_scatter3d_series(cols, {
      x: `x`,
      y: `y`,
      z: `z`,
      color: `c`,
      size: `sz`,
    })
    expect(series.color_values).toEqual([7, 8])
    expect(series.size_values).toEqual([9, 10])
  })
})

describe(`build_bar_series`, () => {
  test(`builds bar series with string x`, () => {
    const cols = extract_columns({
      material: [`Si`, `Ge`],
      energy: [-5.4, -4.6],
    })
    const series = build_bar_series(cols, { x: `material`, y: `energy` })
    expect(series.x).toEqual([`Si`, `Ge`])
    expect(series.y).toEqual([-5.4, -4.6])
  })
})

describe(`build functions return empty on missing columns`, () => {
  const cols = extract_columns({ x: [1, 2], y: [3, 4] })

  test.each([
    [`scatter`, () => build_scatter_series(cols, { x: `x`, y: `missing` })],
    [`scatter3d`, () => build_scatter3d_series(cols, { x: `x`, y: `y`, z: `missing` })],
    [`bar`, () => build_bar_series(cols, { x: `missing`, y: `y` })],
    [`histogram`, () => build_histogram_series(cols, { y: `missing` })],
  ])(`%s returns empty arrays`, (_, build) => {
    const series = build()
    expect(series.x).toEqual([])
    expect(series.y).toEqual([])
  })
})

describe(`build_histogram_series`, () => {
  test(`builds histogram from y column`, () => {
    const cols = extract_columns({ values: [1.5, 2.3, 3.1, 4.7], idx: [0, 1, 2, 3] })
    const series = build_histogram_series(cols, { y: `values` })
    expect(series.y).toEqual([1.5, 2.3, 3.1, 4.7])
    expect(series.x.length).toBe(4)
  })

  test(`falls back to x mapping when y is absent`, () => {
    const cols = extract_columns({ energy: [1.5, 2.3, 3.1], idx: [0, 1, 2] })
    const series = build_histogram_series(cols, { x: `energy` })
    expect(series.y).toEqual([1.5, 2.3, 3.1])
  })

  test(`filters non-numeric values`, () => {
    const cols = extract_columns({
      values: [1, null, 3, `bad`, 5, NaN],
      idx: [0, 1, 2, 3, 4, 5],
    })
    const series = build_histogram_series(cols, { y: `values` })
    expect(series.y).toEqual([1, 3, 5])
  })
})
