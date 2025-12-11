import type { DataSeries } from '$lib/plot'
import {
  handle_legend_double_click,
  have_compatible_units,
  toggle_group_visibility,
  toggle_series_visibility,
} from '$lib/plot/utils/series-visibility'
import { describe, expect, test } from 'vitest'

describe(`have_compatible_units`, () => {
  test.each([
    { unit1: undefined, unit2: undefined, expected: true, desc: `both have no units` },
    { unit1: `eV`, unit2: undefined, expected: true, desc: `only one has a unit` },
    { unit1: `eV`, unit2: `eV`, expected: true, desc: `both have same unit` },
    { unit1: `eV`, unit2: `GPa`, expected: false, desc: `different units` },
  ])(`returns $expected when $desc`, ({ unit1, unit2, expected }) => {
    const s1: DataSeries = { x: [1], y: [2], unit: unit1 }
    const s2: DataSeries = { x: [3], y: [4], unit: unit2 }
    expect(have_compatible_units(s1, s2)).toBe(expected)
  })
})

describe(`toggle_series_visibility`, () => {
  test(`toggles visibility of a single series`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], visible: true },
      { x: [3], y: [4], visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    expect(result[0].visible).toBe(false)
    expect(result[1].visible).toBe(true)
  })

  test.each([
    { idx: -1, desc: `negative index` },
    { idx: 10, desc: `out of bounds index` },
  ])(`returns original series for $desc`, ({ idx }) => {
    const series: DataSeries[] = [{ x: [1], y: [2] }]
    expect(toggle_series_visibility(series, idx)).toBe(series)
  })

  test(`toggles all series with the same label`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true },
      { x: [3], y: [4], label: `B`, visible: true },
      { x: [5], y: [6], label: `A`, visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    expect(result.map((srs) => srs.visible)).toEqual([false, true, false])
  })

  test(`hides incompatible units when making series visible`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], unit: `eV`, visible: false },
      { x: [3], y: [4], unit: `GPa`, visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    expect(result.map((srs) => srs.visible)).toEqual([true, false])
  })

  test(`keeps compatible units visible when toggling series`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], unit: `eV`, visible: false },
      { x: [3], y: [4], unit: `eV`, visible: true },
      { x: [5], y: [6], unit: `GPa`, visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    expect(result.map((srs) => srs.visible)).toEqual([true, true, false])
  })

  test(`only affects series on same y-axis`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], unit: `eV`, y_axis: `y1`, visible: false },
      { x: [3], y: [4], unit: `eV`, y_axis: `y2`, visible: true },
      { x: [5], y: [6], unit: `GPa`, y_axis: `y1`, visible: true },
    ]
    const result = toggle_series_visibility(series, 0)
    // Series 0 (eV, y1) becomes visible, series 1 (eV, y2) stays visible (different axis),
    // series 2 (GPa, y1) becomes hidden (same axis, incompatible unit)
    expect(result.map((srs) => srs.visible)).toEqual([true, true, false])
  })
})

describe(`toggle_group_visibility`, () => {
  test.each([
    {
      desc: `hides all when all visible`,
      visibilities: [true, true, true],
      indices: [0, 1],
      expected: [false, false, true],
    },
    {
      desc: `shows all when some hidden`,
      visibilities: [false, true, true],
      indices: [0, 1],
      expected: [true, true, true],
    },
    {
      desc: `shows all when all in group hidden`,
      visibilities: [false, false, true],
      indices: [0, 1],
      expected: [true, true, true],
    },
    {
      desc: `handles single index`,
      visibilities: [true, true],
      indices: [0],
      expected: [false, true],
    },
    {
      desc: `handles non-contiguous indices`,
      visibilities: [true, true, true, true],
      indices: [0, 2],
      expected: [false, true, false, true],
    },
    {
      desc: `handles undefined visibility (defaults to true)`,
      visibilities: [undefined, undefined, undefined],
      indices: [0, 1],
      expected: [false, false, undefined],
    },
  ])(`$desc`, ({ visibilities, indices, expected }) => {
    const series: DataSeries[] = visibilities.map((vis, idx) => ({
      x: [idx],
      y: [idx],
      visible: vis,
    }))
    const result = toggle_group_visibility(series, indices)
    expect(result.map((srs) => srs.visible)).toEqual(expected)
  })

  test(`returns original series for empty indices array`, () => {
    const series: DataSeries[] = [{ x: [1], y: [2], visible: true }]
    expect(toggle_group_visibility(series, [])).toBe(series)
  })

  test(`preserves other series properties and handles out-of-bounds indices`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true, unit: `eV` },
      { x: [3], y: [4], label: `B`, visible: true, unit: `GPa` },
    ]
    const result = toggle_group_visibility(series, [0, 5]) // 5 is out of bounds
    expect(result[0]).toMatchObject({ visible: false, unit: `eV`, label: `A` })
    expect(result[1]).toMatchObject({ visible: true, unit: `GPa`, label: `B` })
  })
})

describe(`handle_legend_double_click`, () => {
  test(`isolates a single series`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true },
      { x: [3], y: [4], label: `B`, visible: true },
      { x: [5], y: [6], label: `C`, visible: true },
    ]
    const result = handle_legend_double_click(series, 1, null)
    expect(result.series.map((srs) => srs.visible)).toEqual([false, true, false])
    expect(result.previous_visibility).toEqual([true, true, true])
  })

  test(`restores visibility when already isolated`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: false },
      { x: [3], y: [4], label: `B`, visible: true },
      { x: [5], y: [6], label: `C`, visible: false },
    ]
    const result = handle_legend_double_click(series, 1, [true, true, true])
    expect(result.series.map((srs) => srs.visible)).toEqual([true, true, true])
    expect(result.previous_visibility).toBe(null)
  })

  test.each([
    { new_vis: true, desc: `keeps true visibility` },
    { new_vis: false, desc: `keeps false visibility` },
  ])(
    `handles new series added after isolation - $desc`,
    ({ new_vis }) => {
      const series: DataSeries[] = [
        { x: [1], y: [2], label: `A`, visible: false },
        { x: [3], y: [4], label: `B`, visible: true },
        { x: [5], y: [6], label: `C`, visible: false },
        { x: [7], y: [8], label: `D`, visible: new_vis },
      ]
      const result = handle_legend_double_click(series, 1, [true, true, true])
      expect(result.series.map((srs) => srs.visible)).toEqual([true, true, true, new_vis])
      expect(result.previous_visibility).toBe(null)
    },
  )

  test(`isolates series by label`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true },
      { x: [3], y: [4], label: `B`, visible: true },
      { x: [5], y: [6], label: `A`, visible: true },
    ]
    const result = handle_legend_double_click(series, 0, null)
    expect(result.series.map((srs) => srs.visible)).toEqual([true, false, true])
  })

  test(`does not save previous visibility when only one series is visible`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true },
      { x: [3], y: [4], label: `B`, visible: false },
    ]
    expect(handle_legend_double_click(series, 0, null).previous_visibility).toBe(null)
  })

  test(`isolates series without label by index`, () => {
    const series: DataSeries[] = [
      { x: [1], y: [2], visible: true },
      { x: [3], y: [4], visible: true },
      { x: [5], y: [6], visible: true },
    ]
    const result = handle_legend_double_click(series, 1, null)
    expect(result.series.map((srs) => srs.visible)).toEqual([false, true, false])
  })

  test.each([
    { idx: -1, desc: `negative index` },
    { idx: 10, desc: `out of bounds index` },
  ])(`handles invalid index gracefully - $desc`, ({ idx }) => {
    const series: DataSeries[] = [
      { x: [1], y: [2], label: `A`, visible: true },
      { x: [3], y: [4], label: `B`, visible: true },
    ]
    const result = handle_legend_double_click(series, idx, null)
    // All series should remain visible (no isolation occurs)
    expect(result.series.map((srs) => srs.visible)).toEqual([true, true])
    expect(result.previous_visibility).toBe(null)
  })
})
