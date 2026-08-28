import type { TooltipPlacementConfig } from '$lib/plot/core/decorations'
import {
  DEFAULT_CURSOR_SIZE,
  get_tooltip_placement_candidates,
  place_tooltip,
} from '$lib/plot/core/decorations'
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

  // A tooltip too wide to sit beside its anchor clamps to nearly the same box from
  // either side, and that box runs under the pointer — which for a hover tooltip
  // is the cursor, so it covers the text it just summoned. Nothing in the scoring
  // objected: `exclusion_rects` only ever held the legend and the color bar.
  test(`a clamped wide tooltip is kept out from under the cursor`, () => {
    // The Usage sunburst that reported this: a long breadcrumb in a ~1135px pane.
    const config: TooltipPlacementConfig = {
      anchor: { x: 900, y: 400 },
      tooltip_size: { width: 1030, height: 44 },
      bounds: { x: 0, y: 0, width: 1135, height: 700 },
      offset: { x: 20, y: 5 },
    }
    // The glyph hangs down-right of the hotspot, so it can lie on the tooltip
    // while the hotspot itself sits just outside it.
    const cursor = { x: 900, y: 400, ...DEFAULT_CURSOR_SIZE }
    const cursor_overlap = ({ x, y }: { x: number; y: number }) =>
      Math.max(0, Math.min(x + 1030, cursor.x + cursor.width) - Math.max(x, cursor.x)) *
      Math.max(0, Math.min(y + 44, cursor.y + cursor.height) - Math.max(y, cursor.y))

    // Both horizontal candidates clamp to the full width, so the choice comes
    // down to above/below — and below lands the cursor on the first line.
    const before = place_tooltip(config)
    expect(before.direction).toBe(`left-below`)
    expect(cursor_overlap(before)).toBeGreaterThan(0)

    const after = place_tooltip({ ...config, cursor_size: DEFAULT_CURSOR_SIZE })
    expect(after.direction).toBe(`left-above`)
    expect(cursor_overlap(after)).toBe(0)
    expect(after.y + 44).toBeLessThanOrEqual(400)
  })

  // The offset has to clear a cursor's width on its own, or the preferred
  // placement overlaps from the start and the term flips every tooltip.
  test.each([
    // Room on the preferred side: the glyph is already beyond the tooltip's edge.
    [`the tooltip already sits clear`, { x: 100, y: 100 }, DEFAULT_CURSOR_SIZE],
    // A zero-size glyph has no area to intersect.
    [`the cursor has no size`, { x: 100, y: 100 }, { width: 0, height: 0 }],
    // Anchors can leave the plot box (pointer over a margin); every candidate is
    // clamped back inside, so the glyph is out of reach of all four.
    [`the anchor sits outside the bounds`, { x: -60, y: 700 }, DEFAULT_CURSOR_SIZE],
  ])(`the cursor term is inert when %s`, (_desc, anchor, cursor_size) => {
    const config: TooltipPlacementConfig = {
      anchor,
      tooltip_size: { width: 140, height: 44 },
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      offset: { x: 20, y: 5 },
    }
    const before = place_tooltip(config)
    const after = place_tooltip({ ...config, cursor_size })
    expect(after).toMatchObject({ x: before.x, y: before.y, direction: before.direction })
    expect(after.overlap_area).toBe(0)
  })

  test.each([
    [`bounds`, { bounds: { x: 0, y: 0, width: -1, height: 10 } }, /Tooltip bounds/],
    [
      `an exclusion rectangle`,
      { exclusion_rects: [{ x: 0, y: 0, width: 5, height: NaN }] },
      /Tooltip exclusion rectangle 0/,
    ],
    [`the cursor`, { cursor_size: { width: 18, height: -24 } }, /Tooltip cursor/],
    [`the cursor size`, { cursor_size: { width: NaN, height: 24 } }, /Tooltip cursor/],
  ])(`rejects invalid geometry on %s`, (_desc, overrides, regex) => {
    expect(() => place_tooltip({ ...base_config, ...overrides })).toThrow(regex)
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
