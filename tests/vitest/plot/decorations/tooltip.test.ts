import type { TooltipPlacementConfig } from '#lib/plot/core/decorations/index.js'
import {
  beside_rect,
  get_tooltip_placement_candidates,
  place_tooltip,
} from '#lib/plot/core/decorations/tooltip.js'
import { describe, expect, test } from 'vite-plus/test'

const base_config: TooltipPlacementConfig = {
  anchor: { x: 50, y: 50 },
  tooltip_size: { width: 20, height: 10 },
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  offset: { x: 5, y: 7 },
}

describe(`tooltip decoration placement`, () => {
  test(`generates the four anchor quadrants in stable order`, () => {
    expect(
      get_tooltip_placement_candidates(base_config).map(
        ({ direction, x: coord_x, y: coord_y }) => [direction, coord_x, coord_y],
      ),
    ).toEqual([
      [`right-below`, 55, 57],
      [`left-below`, 25, 57],
      [`right-above`, 55, 33],
      [`left-above`, 25, 33],
    ])
  })

  // oxfmt-ignore
  test.each([
    [`right edge`, { anchor: { x: 95, y: 50 } }, { direction: `left-below`, x: 70, y: 57 }],
    [`bottom edge`, { anchor: { x: 50, y: 95 } }, { direction: `right-above`, x: 55, y: 78 }],
    [`top-left corner with right-below negative offsets`, { anchor: { x: 2, y: 2 }, offset: { x: -5, y: -7 } }, { direction: `right-below`, x: 7, y: 9 }],
  ])(`chooses an unclamped candidate at the %s`, (_name, overrides, expected) => {
    expect(place_tooltip({ ...base_config, ...overrides })).toMatchObject(expected)
  })

  test(`avoids exclusion rectangles before applying distance preferences`, () => {
    const placement = place_tooltip({
      anchor: { x: 100, y: 100 },
      tooltip_size: { width: 30, height: 20 },
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      offset: { x: 5, y: 5 },
      exclusion_rects: [{ x: 105, y: 105, width: 30, height: 20 }],
    })
    expect(placement).toMatchObject({
      direction: `right-above`,
      x: 105,
      y: 75,
      overlap_area: 0,
    })
  })

  test(`clamps oversized tooltips to the bounds origin`, () => {
    const config = {
      anchor: { x: 50, y: 40 },
      tooltip_size: { width: 140, height: 120 },
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      offset: { x: 5, y: 5 },
    }
    const candidates = get_tooltip_placement_candidates(config)
    expect(
      candidates.every(({ x: coord_x, y: coord_y }) => coord_x === 10 && coord_y === 20),
    ).toBe(true)
    expect(place_tooltip(config)).toMatchObject({ x: 10, y: 20 })
  })

  test.each([
    [`bounds`, { bounds: { x: 0, y: 0, width: -1, height: 10 } }, /Tooltip bounds/],
    [
      `an exclusion rectangle`,
      { exclusion_rects: [{ x: 0, y: 0, width: 5, height: NaN }] },
      /Tooltip exclusion rectangle 0/,
    ],
  ])(`rejects invalid geometry on %s`, (_desc, overrides, regex) => {
    expect(() => place_tooltip({ ...base_config, ...overrides })).toThrow(regex)
  })

  // beside_rect centers the chip along the side it sits on (a 30x10 chip around a 20x20 tile
  // centered at (50, 50), gap 4); a corner placement put its edge at the tile's middle
  const tile = { x: 40, y: 40, width: 20, height: 20 }
  const place_beside = (rect: typeof tile, side: Parameters<typeof beside_rect>[1]) => {
    const { x: coord_x, y: coord_y, ...rest } = beside_rect(rect, side, 4)
    return place_tooltip({
      ...rest,
      anchor: { x: coord_x, y: coord_y },
      tooltip_size: { width: 30, height: 10 },
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    })
  }
  test.each([
    [`bottom`, 35, 64],
    [`top`, 35, 26],
    [`right`, 64, 45],
    [`left`, 6, 45],
  ] as const)(`beside_rect %s centers the chip along that side`, (side, coord_x, coord_y) => {
    expect(place_beside(tile, side)).toMatchObject({ x: coord_x, y: coord_y, overlap_area: 0 })
  })

  // no room below a tile at the bottom edge: it flips above and stays centered
  test(`beside_rect flips across the tile at the bounds and keeps centered`, () => {
    expect(place_beside({ ...tile, y: 180 }, `bottom`)).toMatchObject({
      x: 35,
      y: 166,
      overlap_area: 0,
    })
  })

  test(`breaks exact score ties by candidate order deterministically`, () => {
    const config: TooltipPlacementConfig = {
      anchor: { x: 50, y: 50 },
      tooltip_size: { width: 10, height: 10 },
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      offset: { x: 0, y: 0 },
      exclusion_rects: [
        { x: 50, y: 50, width: 10, height: 10 },
        { x: 40, y: 40, width: 10, height: 10 },
      ],
    }
    const placement = place_tooltip(config)
    const tied_score = get_tooltip_placement_candidates(config).find(
      ({ direction }) => direction === `right-above`,
    )?.score
    expect(placement.direction).toBe(`left-below`)
    expect(placement.score).toBe(tied_score)
  })
})
