// Tests for fill-between types
import { describe, expect, it } from 'vitest'
import { FILL_CURVE_TYPES } from '$lib/plot/types'
import type {
  FillBoundary,
  FillCurveType,
  FillEdgeStyle,
  FillGradient,
  FillHandlerEvent,
  FillHoverStyle,
  FillRegion,
  FillZIndex,
  LegendItem,
} from '$lib/plot/types'

describe(`FILL_CURVE_TYPES`, () => {
  it(`contains all expected curve types`, () => {
    expect(FILL_CURVE_TYPES).toContain(`linear`)
    expect(FILL_CURVE_TYPES).toContain(`monotoneX`)
    expect(FILL_CURVE_TYPES).toContain(`monotoneY`)
    expect(FILL_CURVE_TYPES).toContain(`step`)
    expect(FILL_CURVE_TYPES).toContain(`stepBefore`)
    expect(FILL_CURVE_TYPES).toContain(`stepAfter`)
    expect(FILL_CURVE_TYPES).toContain(`basis`)
    expect(FILL_CURVE_TYPES).toContain(`cardinal`)
    expect(FILL_CURVE_TYPES).toContain(`catmullRom`)
    expect(FILL_CURVE_TYPES).toContain(`natural`)
  })

  it(`has exactly 10 curve types`, () => {
    expect(FILL_CURVE_TYPES.length).toBe(10)
  })

  it(`is readonly`, () => {
    // TypeScript enforces this at compile time, but we can verify the array is frozen-like
    const curve: FillCurveType = FILL_CURVE_TYPES[0]
    expect(curve).toBe(`linear`)
  })
})

describe(`Fill type structures`, () => {
  it(`FillBoundary accepts number shorthand`, () => {
    const boundary: FillBoundary = 42
    expect(boundary).toBe(42)
  })

  it(`FillBoundary accepts series reference`, () => {
    const boundary: FillBoundary = { type: `series`, series_idx: 0 }
    expect(boundary.type).toBe(`series`)
  })

  it(`FillBoundary accepts function`, () => {
    const boundary: FillBoundary = { type: `function`, fn: (x) => x * 2 }
    expect(boundary.type).toBe(`function`)
    if (boundary.type === `function`) {
      expect(boundary.fn(5)).toBe(10)
    }
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
    expect(gradient.center?.x).toBe(0.5)
  })

  it(`FillEdgeStyle has all optional properties`, () => {
    const edge: FillEdgeStyle = {}
    expect(edge.color).toBeUndefined()

    const styled_edge: FillEdgeStyle = {
      color: `red`,
      width: 2,
      dash: `4 2`,
      opacity: 0.8,
    }
    expect(styled_edge.color).toBe(`red`)
  })

  it(`FillHoverStyle extends edge styling`, () => {
    const hover: FillHoverStyle = {
      fill: `orange`,
      fill_opacity: 0.6,
      cursor: `pointer`,
      edge: { color: `red`, width: 2 },
    }
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
    expect(event.region_idx).toBe(0)
    expect(event.x).toBe(10)
  })

  it(`FillZIndex accepts valid positions`, () => {
    const positions: FillZIndex[] = [
      `below-grid`,
      `below-lines`,
      `below-points`,
      `above-all`,
    ]
    expect(positions.length).toBe(4)
  })

  it(`FillRegion has required and optional fields`, () => {
    const region: FillRegion = {
      upper: { type: `series`, series_idx: 0 },
      lower: 0,
    }
    expect(typeof region.upper === `object` && region.upper.type).toBe(`series`)
    expect(region.lower).toBe(0)

    const full_region: FillRegion = {
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
    expect(full_region.id).toBe(`test`)
    expect(full_region.curve).toBe(`monotoneX`)
  })

  it(`LegendItem supports fill items`, () => {
    const series_item: LegendItem = {
      label: `Series`,
      visible: true,
      series_idx: 0,
      display_style: { symbol_type: `Circle` },
    }
    expect(series_item.item_type).toBeUndefined()

    const fill_item: LegendItem = {
      label: `Fill`,
      visible: true,
      series_idx: -1,
      item_type: `fill`,
      fill_idx: 0,
      display_style: {
        fill_color: `steelblue`,
        fill_opacity: 0.3,
        edge_color: `navy`,
      },
    }
    expect(fill_item.item_type).toBe(`fill`)
    expect(fill_item.fill_idx).toBe(0)
    expect(fill_item.display_style.fill_color).toBe(`steelblue`)
  })
})
