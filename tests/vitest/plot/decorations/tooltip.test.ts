import type { TooltipPlacementConfig } from '$lib/plot/core/decorations'
import { get_tooltip_placement_candidates, place_tooltip } from '$lib/plot/core/decorations'
import { describe, expect, test } from 'vitest'

const base_config: TooltipPlacementConfig = {
  anchor: { x: 50, y: 50 },
  tooltip_size: { width: 20, height: 10 },
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  offset: { x: 5, y: 7 },
}

describe(`tooltip decoration placement`, () => {
  test(`generates the four anchor quadrants in stable order`, () => {
    expect(
      get_tooltip_placement_candidates(base_config).map(({ direction, x, y }) => [
        direction,
        x,
        y,
      ]),
    ).toEqual([
      [`right-below`, 55, 57],
      [`left-below`, 25, 57],
      [`right-above`, 55, 33],
      [`left-above`, 25, 33],
    ])
  })

  test.each([
    {
      name: `right edge`,
      anchor: { x: 95, y: 50 },
      expected: { direction: `left-below`, x: 70, y: 57 },
    },
    {
      name: `bottom edge`,
      anchor: { x: 50, y: 95 },
      expected: { direction: `right-above`, x: 55, y: 78 },
    },
    {
      name: `top-left corner with right-below negative offsets`,
      anchor: { x: 2, y: 2 },
      expected: { direction: `right-below`, x: 7, y: 9 },
      offset: { x: -5, y: -7 },
    },
  ])(`chooses an unclamped candidate at the $name`, ({ anchor, expected, offset }) => {
    expect(
      place_tooltip({ ...base_config, anchor, offset: offset ?? base_config.offset }),
    ).toMatchObject(expected)
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
    expect(candidates.every(({ x, y }) => x === 10 && y === 20)).toBe(true)
    expect(place_tooltip(config)).toMatchObject({ x: 10, y: 20 })
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
