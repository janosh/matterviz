import { describe, expect, test } from 'vitest'
import {
  build_bar_series,
  build_histogram_series,
  build_scatter3d_series,
  build_scatter_series,
  col_keys,
  extract_columns,
  suggest_mapping,
} from '$lib/file-viewer/plot-utils'

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
    const data = { empty: [], scalar: 1, x: [1, 2, 3], y: [4, 5], label: [`a`, `b`, `c`] }
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

  test(`row-based: tolerates null and non-object rows`, () => {
    const cols = extract_columns([{ value: 1 }, null, 42, `text`, { value: 2 }])

    expect(cols.get(`value`)).toEqual({
      values: [1, undefined, undefined, undefined, 2],
      type: `numeric`,
    })
  })

  test.each([null, `hello`, 42, [null, { x: 1 }]])(
    `returns empty map for non-tabular data: %j`,
    (data) => expect(extract_columns(data).size).toBe(0),
  )

  // type follows the 80% numeric threshold over the non-null entries
  test.each([
    [`nulls`, [1, null, 3], `numeric`],
    [`>= 80% numbers`, [1, 2, 3, 4, `outlier`], `numeric`],
    [`< 80% numbers`, [1, `two`, 3, `four`, 5], `mixed`],
    [`all null`, [null, undefined], `mixed`],
  ])(`classifies column with %s`, (_label, values, type) => {
    const cols = extract_columns({ val: values, idx: values.map((_, idx) => idx) })
    expect(cols.get(`val`)?.type).toBe(type)
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
  // oxfmt-ignore
  test.each([
    [`first numeric columns`, { a: [1, 2], b: [3, 4], c: [5, 6] },
      { plot_type: `scatter`, mapping: { x: `a`, y: `b`, color: `c` } }],
    [`well-known axis names`, { energy: [1, 2], time: [3, 4], force: [5, 6] },
      { mapping: { x: `time`, y: `energy` } }],
    [`bar (string + 2 numeric)`, { material: [`Si`, `Ge`, `C`], energy: [-5.4, -4.6, -7.4], volume: [20.5, 22.7, 11.2] },
      { plot_type: `bar`, mapping: { x: `material` } }],
    [`bar (string + 1 numeric)`, { name: [`Si`, `Ge`, `C`], energy: [-5.4, -4.6, -7.4] },
      { plot_type: `bar`, mapping: { x: `name` } }],
    [`scatter3d (x/y/z columns)`, { x: [1, 2], y: [3, 4], z: [5, 6] },
      { plot_type: `scatter3d`, mapping: { x: `x` } }],
    [`first unused numeric color`, { x: [1, 2], y: [3, 4], temp: [5, 6], sz: [7, 8] },
      { mapping: { color: `temp` } }],
    [`single numeric column`, { a: [1, 2, 3] },
      { plot_type: `histogram`, mapping: { x: `a` } }],
    [`empty columns`, {}, { plot_type: `table`, mapping: { x: undefined, y: undefined } }],
  ])(`suggests mapping for %s`, (_label, data, expected) => {
    const columns = extract_columns(data)
    expect(columns.size).toBe(Object.keys(data).length)
    expect(suggest_mapping(columns)).toMatchObject(expected)
  })
})

describe(`build scatter series`, () => {
  // oxfmt-ignore
  test.each([
    [`2d`, build_scatter_series,
      { x: [1, 2, 3], y: [4, 5, 6] }, { x: `x`, y: `y` },
      { x: [1, 2, 3], y: [4, 5, 6] }],
    [`2d with color only`, build_scatter_series,
      { x: [1, 2], y: [3, 4], extra: [5, 6] }, { x: `x`, y: `y`, color: `extra` },
      { x: [1, 2], y: [3, 4], color_values: [5, 6] }],
    [`2d with size only`, build_scatter_series,
      { x: [1, 2], y: [3, 4], extra: [5, 6] }, { x: `x`, y: `y`, size: `extra` },
      { x: [1, 2], y: [3, 4], size_values: [5, 6] }],
    [`2d with non-finite coordinates`, build_scatter_series,
      { x: [1, null, 3], y: [4, 5, 6], c: [10, 20, 30] }, { x: `x`, y: `y`, color: `c` },
      { x: [1, 3], y: [4, 6], color_values: [10, 30] }],
    [`2d without coercing mixed values`, build_scatter_series,
      { x: [1, `2`, true, null, undefined, NaN, Infinity, -Infinity, -0], y: Array(9).fill(4), c: [10, 20, 30, 40, 50, 60, 70, 80, 90] },
      { x: `x`, y: `y`, color: `c` }, { x: [1, -0], y: [4, 4], color_values: [10, 90] }],
    [`3d with color and size`, build_scatter3d_series,
      { x: [1, 2], y: [3, 4], z: [5, 6], c: [7, 8], sz: [9, 10] },
      { x: `x`, y: `y`, z: `z`, color: `c`, size: `sz` },
      { x: [1, 2], y: [3, 4], z: [5, 6], color_values: [7, 8], size_values: [9, 10] }],
    [`3d with non-finite coordinates`, build_scatter3d_series,
      { x: [1, null, 3, 4], y: [5, 6, 7, 8], z: [9, 10, null, 12], c: [100, 200, 300, 400], sz: [10, 20, 30, 40] },
      { x: `x`, y: `y`, z: `z`, color: `c`, size: `sz` },
      { x: [1, 4], y: [5, 8], z: [9, 12], color_values: [100, 400], size_values: [10, 40] }],
  ])(`builds %s, keeping color and size aligned`, (_label, build, data, mapping, expected) => {
    const series = build(extract_columns(data), mapping)
    expect(series).toMatchObject(expected)
    if (build === build_scatter_series)
      expect(series).toHaveProperty(`point_style`, { fill: `#4c6ef5` })
  })
})

describe(`build_bar_series`, () => {
  test(`builds bar series with string x`, () => {
    const cols = extract_columns({
      material: [`Si`, `Ge`, `null`, `boolean`, `numeric string`, `NaN`, `Infinity`],
      energy: [-5.4, -4.6, null, true, `2`, NaN, Infinity],
    })
    const series = build_bar_series(cols, { x: `material`, y: `energy` })
    expect(series.x).toEqual([`Si`, `Ge`])
    expect(series.y).toEqual([-5.4, -4.6])
  })
})

describe(`build functions return empty on missing columns`, () => {
  const cols = extract_columns({ x: [1, 2], y: [3, 4] })

  // oxfmt-ignore
  test.each([
    [`scatter`, () => build_scatter_series(cols, { x: `x`, y: `missing` }), { x: [], y: [] }],
    [`scatter3d`, () => build_scatter3d_series(cols, { x: `x`, y: `y`, z: `missing` }), { x: [], y: [], z: [] }],
    [`bar`, () => build_bar_series(cols, { x: `missing`, y: `y` }), { x: [], y: [] }],
    [`histogram`, () => build_histogram_series(cols, { y: `missing` }), { values: [] }],
  ] as const)(`%s returns empty arrays`, (_name, build, expected) => {
    expect(build()).toEqual(expected)
  })
})

describe(`build_histogram_series`, () => {
  // oxfmt-ignore
  test.each([
    [`y column`, { values: [1.5, 2.3, 3.1, 4.7], idx: [0, 1, 2, 3] }, { y: `values` }, [1.5, 2.3, 3.1, 4.7]],
    [`x column`, { energy: [1.5, 2.3, 3.1], idx: [0, 1, 2] }, { x: `energy` }, [1.5, 2.3, 3.1]],
    [`non-numeric values`, { values: [1, null, 3, `2`, 5, NaN, true, Infinity, -Infinity, -0] }, { y: `values` }, [1, 3, 5, -0]],
  ])(`builds histogram from %s`, (_label, data, mapping, expected) => {
    expect(build_histogram_series(extract_columns(data), mapping).values).toEqual(expected)
  })
})
