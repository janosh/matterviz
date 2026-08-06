import {
  assign_facet_panels,
  compute_facet_geometry,
  propagate_facet_range,
  reconcile_facet_padding,
  reconcile_facet_ranges,
  resolve_facet_axis_visibility,
  type FacetAxisMode,
  type FacetPanel,
} from '$lib/plot/core/facets'
import { describe, expect, it } from 'vitest'

const panels = (count: number): FacetPanel<string>[] =>
  Array.from({ length: count }, (_entry, panel_idx) => ({
    key: `panel-${panel_idx}`,
    data: `datum-${panel_idx}`,
  }))

describe(`facet panel assignment`, () => {
  it(`assigns a 1x1 grid`, () => {
    expect(assign_facet_panels(panels(1), 1)).toEqual({
      rows: 1,
      columns: 1,
      panels: [
        {
          key: `panel-0`,
          data: `datum-0`,
          index: 0,
          row: 0,
          column: 0,
          row_span: 1,
          column_span: 1,
        },
      ],
    })
  })

  it(`fills an uneven grid in deterministic row-major order`, () => {
    const layout = assign_facet_panels(panels(5), 3)
    expect(layout.rows).toBe(2)
    expect(layout.panels.map(({ row, column }) => [row, column])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ])
  })

  it(`honors explicit placement and skips occupied spans`, () => {
    const layout = assign_facet_panels(
      [
        { key: `wide`, data: 1, row: 0, column: 0, column_span: 2 },
        { key: `fixed-column`, data: 2, column: 2 },
        { key: `auto`, data: 3 },
      ],
      3,
    )
    expect(layout.panels.map(({ key, row, column }) => [key, row, column])).toEqual([
      [`wide`, 0, 0],
      [`fixed-column`, 0, 2],
      [`auto`, 1, 0],
    ])
  })

  it.each([
    [
      `duplicate keys`,
      [
        { key: `duplicate`, data: 1 },
        { key: `duplicate`, data: 2 },
      ],
      `Duplicate facet key`,
    ],
    [`zero row span`, [{ key: `bad-row`, data: 1, row_span: 0 }], `row_span`],
    [
      `oversized column span`,
      [{ key: `bad-column`, data: 1, column_span: 3 }],
      `exceeds 2 columns`,
    ],
    [
      `overlapping explicit cells`,
      [
        { key: `first`, data: 1, row: 0, column: 0 },
        { key: `second`, data: 2, row: 0, column: 0 },
      ],
      `Cannot place facet`,
    ],
  ] as const)(`rejects %s`, (_name, input, message) => {
    expect(() => assign_facet_panels(input, 2)).toThrow(message)
  })
})

describe(`facet layout reconciliation`, () => {
  const layout = assign_facet_panels(panels(4), 2)
  const reports = layout.panels.map((panel, panel_idx) => ({
    key: panel.key,
    padding: {
      t: 10 + panel_idx,
      b: 20 + 2 * panel_idx,
      l: 30 + 3 * panel_idx,
      r: 40 + 4 * panel_idx,
    },
    ranges: { x: [10 * panel_idx, 10 * panel_idx + 1] as [number, number] },
  }))

  it(`takes the maximum reported value on every padding side`, () => {
    expect(reconcile_facet_padding(layout, reports)).toEqual({
      t: 13,
      b: 26,
      l: 39,
      r: 52,
    })
  })

  it.each([
    {
      mode: `shared`,
      expected: [
        [0, 31],
        [0, 31],
        [0, 31],
        [0, 31],
      ],
    },
    {
      mode: `free`,
      expected: [
        [0, 1],
        [10, 11],
        [20, 21],
        [30, 31],
      ],
    },
    {
      mode: `row`,
      expected: [
        [0, 11],
        [0, 11],
        [20, 31],
        [20, 31],
      ],
    },
    {
      mode: `col`,
      expected: [
        [0, 21],
        [10, 31],
        [0, 21],
        [10, 31],
      ],
    },
  ] as { mode: FacetAxisMode; expected: number[][] }[])(
    `reconciles $mode axis ranges`,
    ({ mode, expected }) => {
      const resolved = reconcile_facet_ranges(layout, reports, { x: mode })
      expect(resolved.map(({ ranges }) => ranges.x)).toEqual(expected)
    },
  )

  it(`reserves explicit shared chrome bands around an uneven panel grid`, () => {
    const uneven_layout = assign_facet_panels(panels(5), 3)
    const geometry = compute_facet_geometry(uneven_layout, {
      width: 520,
      height: 310,
      column_gap: 10,
      row_gap: 10,
      shared_bands: {
        title_height: 30,
        legend_width: 80,
        colorbar_width: 40,
        gap: 10,
      },
    })

    expect(geometry.panel_grid).toEqual({ x: 0, y: 40, width: 380, height: 270 })
    expect(geometry.title).toEqual({
      band: `title`,
      rect: { x: 0, y: 0, width: 520, height: 30 },
    })
    expect(geometry.legend).toEqual({
      band: `legend`,
      rect: { x: 390, y: 40, width: 80, height: 270 },
    })
    expect(geometry.colorbar).toEqual({
      band: `colorbar`,
      rect: { x: 480, y: 40, width: 40, height: 270 },
    })
    expect(geometry.panels.map(({ rect }) => rect)).toEqual([
      { x: 0, y: 40, width: 120, height: 130 },
      { x: 130, y: 40, width: 120, height: 130 },
      { x: 260, y: 40, width: 120, height: 130 },
      { x: 0, y: 180, width: 120, height: 130 },
      { x: 130, y: 180, width: 120, height: 130 },
    ])
  })

  // oxfmt-ignore
  it.each([
    [`shared bands that exceed the grid`, assign_facet_panels(panels(1), 1), { width: 100, height: 100, shared_bands: { title_height: 90, legend_width: 50, gap: 20 } }, `Shared facet bands exceed grid size: 100x100 with title 90, legend 50, colorbar 0, gap 20`],
    [`panel gaps that exceed the grid`, assign_facet_panels(panels(4), 2), { width: 100, height: 100, column_gap: 101, row_gap: 0 }, `Facet gaps exceed panel grid size: 100x100 with gaps 101x0`],
  ] as const)(`rejects %s`, (_name, invalid_layout, options, expected_error) => {
    expect(() => compute_facet_geometry(invalid_layout, options)).toThrow(expected_error)
  })
})

describe(`facet range propagation`, () => {
  const layout = assign_facet_panels(panels(4), 2)
  const reports = layout.panels.map((panel, panel_idx) => ({
    key: panel.key,
    ranges: { x: [10 * panel_idx, 10 * panel_idx + 1] as [number, number] },
  }))

  it.each([
    {
      mode: `shared`,
      expected: [
        [4, 6],
        [4, 6],
        [4, 6],
        [4, 6],
      ],
    },
    { mode: `free`, expected: [[4, 6], undefined, undefined, undefined] },
    { mode: `row`, expected: [[4, 6], [4, 6], undefined, undefined] },
    { mode: `col`, expected: [[4, 6], undefined, [4, 6], undefined] },
  ] as { mode: FacetAxisMode; expected: ([number, number] | undefined)[] }[])(
    `propagates zooms to the $mode group`,
    ({ mode, expected }) => {
      const overrides = propagate_facet_range(layout, [], `panel-0`, `x`, [4, 6], { x: mode })
      expect(overrides.map(({ ranges }) => ranges.x)).toEqual(expected)
    },
  )

  it(`resets a linked zoom back to each group's intrinsic union`, () => {
    const zoomed = propagate_facet_range(layout, [], `panel-0`, `x`, [4, 6], {
      x: `row`,
    })
    const reset = propagate_facet_range(layout, zoomed, `panel-1`, `x`, null, {
      x: `row`,
    })
    expect(reconcile_facet_ranges(layout, reports, { x: `row` }, reset)).toEqual([
      { key: `panel-0`, ranges: { x: [0, 11] } },
      { key: `panel-1`, ranges: { x: [0, 11] } },
      { key: `panel-2`, ranges: { x: [20, 31] } },
      { key: `panel-3`, ranges: { x: [20, 31] } },
    ])
  })
})

describe(`facet axis visibility`, () => {
  const layout = assign_facet_panels(panels(4), 2)
  const [top_left, , , bottom_right] = layout.panels

  it(`shows every outer side of a 1x1 panel`, () => {
    const single_layout = assign_facet_panels(panels(1), 1)
    expect(resolve_facet_axis_visibility(single_layout.panels[0], single_layout)).toEqual({
      x: true,
      x2: true,
      y: true,
      y2: true,
    })
  })

  it(`suppresses inner shared axes and keeps free axes visible`, () => {
    expect(
      resolve_facet_axis_visibility(top_left, layout, {
        x: `shared`,
        x2: `shared`,
        y: `shared`,
        y2: `shared`,
      }),
    ).toEqual({ x: false, x2: true, y: true, y2: false })
    expect(
      resolve_facet_axis_visibility(top_left, layout, {
        x: `free`,
        y: `free`,
      }),
    ).toMatchObject({ x: true, y: true })
    expect(resolve_facet_axis_visibility(top_left, layout, { x: `row` })).toMatchObject({
      x: true,
    })
    expect(resolve_facet_axis_visibility(bottom_right, layout, { y: `col` })).toMatchObject({
      y: true,
    })
    expect(resolve_facet_axis_visibility(bottom_right, layout)).toEqual({
      x: true,
      x2: false,
      y: false,
      y2: true,
    })
  })

  it(`can select only inner axes explicitly`, () => {
    expect(
      resolve_facet_axis_visibility(top_left, layout, {}, { x: `inner`, y: `inner` }),
    ).toMatchObject({ x: true, y: false })
    expect(
      resolve_facet_axis_visibility(bottom_right, layout, {}, { x: `inner`, y: `inner` }),
    ).toMatchObject({ x: false, y: true })
  })

  it(`treats exposed panels in an uneven grid as outer`, () => {
    const uneven_layout = assign_facet_panels(panels(5), 3)
    const [top_left_panel, , top_right_panel, , bottom_right_panel] = uneven_layout.panels
    expect(resolve_facet_axis_visibility(top_left_panel, uneven_layout).x).toBe(false)
    expect(resolve_facet_axis_visibility(top_right_panel, uneven_layout)).toMatchObject({
      x: true,
      y2: true,
    })
    expect(resolve_facet_axis_visibility(bottom_right_panel, uneven_layout).y2).toBe(true)
  })
})
