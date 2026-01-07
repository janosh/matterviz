// Tests for fill-between types - validates type structures compile correctly
import type {
  FillBoundary,
  FillEdgeStyle,
  FillGradient,
  FillHandlerEvent,
  FillHoverStyle,
  FillRegion,
  FillZIndex,
  LegendItem,
} from '$lib/plot/types'
import { FILL_CURVE_TYPES } from '$lib/plot/types'
import { describe, expect, it } from 'vitest'

describe(`FILL_CURVE_TYPES`, () => {
  it(`contains exactly 10 expected curve types`, () => {
    expect(FILL_CURVE_TYPES).toEqual([
      `linear`,
      `monotoneX`,
      `monotoneY`,
      `step`,
      `stepBefore`,
      `stepAfter`,
      `basis`,
      `cardinal`,
      `catmullRom`,
      `natural`,
    ])
  })
})

describe(`Fill type structures`, () => {
  it.each<[string, FillBoundary, Record<string, unknown>]>([
    [`number shorthand`, 42, {}],
    [`series reference`, { type: `series`, series_idx: 0 }, { type: `series` }],
    [`constant`, { type: `constant`, value: 50 }, { type: `constant` }],
    [`function`, { type: `function`, fn: (x: number) => x * 2 }, { type: `function` }],
  ])(`FillBoundary accepts %s`, (_, boundary, expected_match) => {
    if (Object.keys(expected_match).length > 0) {
      expect(boundary).toMatchObject(expected_match)
    }
    // Function boundary executes correctly
    if (typeof boundary === `object` && boundary.type === `function`) {
      expect(boundary.fn(5)).toBe(10)
    }
  })

  it.each<[string, FillGradient]>([
    [`linear`, { type: `linear`, angle: 45, stops: [[0, `red`], [1, `blue`]] }],
    [`radial`, {
      type: `radial`,
      center: { x: 0.5, y: 0.5 },
      stops: [[0, `white`], [1, `black`]],
    }],
  ])(`FillGradient supports %s type`, (type, gradient) => {
    expect(gradient.type).toBe(type)
    expect(gradient.stops.length).toBe(2)
  })

  it(`FillEdgeStyle and FillHoverStyle work correctly`, () => {
    const empty_edge: FillEdgeStyle = {}
    expect(empty_edge.color).toBeUndefined()

    const hover: FillHoverStyle = { fill: `orange`, edge: { color: `red`, width: 2 } }
    expect(hover.edge?.color).toBe(`red`)
  })

  it(`FillHandlerEvent contains required fields`, () => {
    const event: FillHandlerEvent = {
      event: new MouseEvent(`click`),
      region_idx: 0,
      x: 10,
      y: 20,
      px: 100,
      py: 200,
    }
    expect(event).toMatchObject({ region_idx: 0, x: 10, px: 100 })
  })

  it(`FillZIndex accepts all valid positions`, () => {
    const positions: FillZIndex[] = [
      `below-grid`,
      `below-lines`,
      `below-points`,
      `above-all`,
    ]
    expect(positions).toHaveLength(4)
  })

  it(`FillRegion accepts minimal and full configurations`, () => {
    const minimal: FillRegion = { upper: { type: `series`, series_idx: 0 }, lower: 0 }
    expect(minimal.upper).toMatchObject({ type: `series` })

    const full: FillRegion = {
      id: `test`,
      label: `Test Region`,
      upper: { type: `data`, values: [1, 2, 3] },
      lower: { type: `constant`, value: 0 },
      x_range: [0, 10],
      y_range: [null, 100],
      where: (_x, y1, y2) => y1 > y2,
      fill: { type: `linear`, stops: [[0, `red`], [1, `blue`]] },
      fill_opacity: 0.5,
      curve: `monotoneX`,
      z_index: `below-lines`,
      visible: true,
      hover_style: { cursor: `pointer` },
      show_in_legend: true,
      metadata: { custom: `data` },
    }
    expect(full).toMatchObject({ id: `test`, curve: `monotoneX`, z_index: `below-lines` })
  })

  it(`LegendItem supports series and fill item types`, () => {
    const series: LegendItem = {
      label: `S`,
      visible: true,
      series_idx: 0,
      display_style: { symbol_type: `Circle` },
    }
    expect(series.item_type).toBeUndefined()

    const fill: LegendItem = {
      label: `F`,
      visible: true,
      series_idx: -1,
      item_type: `fill`,
      fill_idx: 0,
      display_style: { fill_color: `steelblue`, fill_opacity: 0.3, edge_color: `navy` },
    }
    expect(fill).toMatchObject({ item_type: `fill`, fill_idx: 0 })
    expect(fill.display_style.fill_color).toBe(`steelblue`)
  })
})
