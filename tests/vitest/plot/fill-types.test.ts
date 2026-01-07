// Tests for fill-between types
import { describe, expect, it } from 'vitest'
import { FILL_CURVE_TYPES } from '$lib/plot/types'
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

describe(`FILL_CURVE_TYPES`, () => {
  const expected_curves = [
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
  ]

  it(`contains exactly 10 expected curve types`, () => {
    expect(FILL_CURVE_TYPES).toEqual(expected_curves)
  })
})

describe(`Fill type structures`, () => {
  it(`FillBoundary accepts number shorthand`, () => {
    const boundary: FillBoundary = 42
    expect(boundary).toBe(42)
  })

  it(`FillBoundary accepts series reference`, () => {
    const boundary: FillBoundary = { type: `series`, series_idx: 0 }
    expect(boundary).toMatchObject({ type: `series` })
  })

  it(`FillBoundary accepts and executes function`, () => {
    const boundary: FillBoundary = { type: `function`, fn: (x) => x * 2 }
    expect(boundary).toMatchObject({ type: `function` })
    if (boundary.type === `function`) expect(boundary.fn(5)).toBe(10)
  })

  it(`FillGradient supports linear type`, () => {
    const gradient: FillGradient = {
      type: `linear`,
      angle: 45,
      stops: [[0, `red`], [1, `blue`]],
    }
    expect(gradient.type).toBe(`linear`)
    expect(gradient.stops.length).toBe(2)
  })

  it(`FillGradient supports radial type`, () => {
    const gradient: FillGradient = {
      type: `radial`,
      center: { x: 0.5, y: 0.5 },
      stops: [[0, `white`], [1, `black`]],
    }
    expect(gradient.type).toBe(`radial`)
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
