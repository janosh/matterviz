import { build_obstacles_norm, clip_bar, place_decorations } from '$lib/plot/auto-place'
import { describe, expect, test } from 'vitest'

const base_pad = { t: 5, b: 50, l: 50, r: 20 }

// obstacle field filling the whole [0,1] plot so any interior decoration unavoidably overlaps data
const dense: { x: number; y: number }[] = []
for (let ix = 0; ix <= 20; ix++) {
  for (let iy = 0; iy <= 20; iy++) dense.push({ x: ix / 20, y: iy / 20 })
}

describe(`place_decorations`, () => {
  test.each([
    { horizontal: true, edge: `top`, inset: `inset-inline` },
    { horizontal: false, edge: `right`, inset: `inset-block` },
  ])(
    `crowded colorbar (horizontal=$horizontal) moves to the $edge margin`,
    ({ horizontal, edge, inset }) => {
      const layout = place_decorations({
        base_pad,
        width: 400,
        height: 300,
        obstacles_norm: dense,
        colorbar: { footprint: { width: 220, height: 56 }, horizontal },
      })
      expect(layout.colorbar_outside).toBe(true)
      expect(layout.colorbar_style).toContain(`${edge}:`)
      expect(layout.colorbar_style).toContain(inset)
      // horizontal reserves top padding; vertical reserves right padding
      if (horizontal) {
        expect(layout.pad.t).toBeGreaterThan(base_pad.t)
        expect(layout.pad.r).toBe(base_pad.r)
      } else {
        expect(layout.pad.r).toBeGreaterThan(base_pad.r)
        expect(layout.pad.t).toBe(base_pad.t)
      }
    },
  )

  test(`crowded wide/short legend drops into the bottom margin`, () => {
    const layout = place_decorations({
      base_pad,
      width: 400,
      height: 300,
      obstacles_norm: dense,
      legend: { footprint: { width: 120, height: 60 } },
    })
    expect(layout.legend_outside).toBe(true)
    expect(layout.legend_pos.y).toBeGreaterThan(150) // lower half, not the top-left interior default
    expect(layout.pad.b).toBeGreaterThan(base_pad.b) // reserves bottom, not right
    expect(layout.pad.r).toBe(base_pad.r)
  })

  test(`crowded narrow/tall legend moves to the right margin`, () => {
    const layout = place_decorations({
      base_pad,
      width: 400,
      height: 300,
      obstacles_norm: dense,
      legend: { footprint: { width: 80, height: 200 } },
    })
    expect(layout.legend_outside).toBe(true)
    expect(layout.pad.r).toBeGreaterThan(base_pad.r) // reserves right, not bottom
    expect(layout.pad.b).toBe(base_pad.b)
    expect(layout.legend_pos.x).toBeCloseTo(400 - 80 - 8) // flush to the right edge
  })

  test(`narrow/tall legend falls back to bottom when a vertical colorbar took the right`, () => {
    const layout = place_decorations({
      base_pad,
      width: 400,
      height: 300,
      obstacles_norm: dense,
      legend: { footprint: { width: 80, height: 200 } },
      colorbar: { footprint: { width: 56, height: 150 }, horizontal: false },
    })
    expect(layout.legend_outside).toBe(true)
    expect(layout.colorbar_outside).toBe(true)
    // colorbar owns the right; legend must drop to the bottom to avoid colliding
    expect(layout.pad.b).toBeGreaterThan(base_pad.b) // legend reserved at the bottom
    expect(layout.pad.r).toBeCloseTo(base_pad.r + 56 + 8) // right reserves the colorbar only
  })

  test(`decorations stay interior when a sparse region is available`, () => {
    const layout = place_decorations({
      base_pad,
      width: 400,
      height: 300,
      obstacles_norm: [{ x: 0.05, y: 0.95 }], // single point in a corner
      legend: { footprint: { width: 120, height: 60 } },
      colorbar: { footprint: { width: 220, height: 56 }, horizontal: true },
    })
    expect(layout.legend_outside).toBe(false)
    expect(layout.colorbar_outside).toBe(false)
    expect(layout.colorbar_style).toBe(``)
    expect(layout.pad).toEqual(base_pad)
  })

  test(`no decorations -> padding unchanged`, () => {
    const layout = place_decorations({
      base_pad,
      width: 400,
      height: 300,
      obstacles_norm: dense,
    })
    expect(layout).toMatchObject({ legend_outside: false, colorbar_outside: false })
    expect(layout.pad).toEqual(base_pad)
  })
})

describe(`clip_bar`, () => {
  test.each([
    { name: `off-plot to the left`, vertical: true, cross: -0.2, a: 0, b: 1, expected: null },
    { name: `off-plot to the right`, vertical: true, cross: 1.5, a: 0, b: 1, expected: null },
    { name: `fully above`, vertical: true, cross: 0.5, a: -0.8, b: -0.2, expected: null },
  ])(`returns null when $name`, ({ vertical, cross, a, b, expected }) => {
    expect(clip_bar(vertical, cross, a, b)).toBe(expected)
  })

  test(`clamps a vertical bar segment to the visible box`, () => {
    const seg = clip_bar(true, 0.5, -0.4, 1.6)
    expect(seg).not.toBeNull()
    expect(seg?.points).toEqual([
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
    ])
    expect(seg?.draws_line).toBe(true)
  })

  test(`clamps a horizontal bar segment to the visible box`, () => {
    const seg = clip_bar(false, 0.3, -0.5, 0.7)
    expect(seg?.points).toEqual([
      { x: 0, y: 0.3 },
      { x: 0.7, y: 0.3 },
    ])
  })
})

describe(`build_obstacles_norm`, () => {
  test(`samples a long line without overflowing (clip prevents runaway point counts)`, () => {
    // a near-vertical segment clipped to [0,1] should yield a bounded number of samples
    const seg = clip_bar(true, 0.5, -1000, 1000) // huge span clamps to [0,1]
    expect(seg).not.toBeNull()
    const pts = build_obstacles_norm(seg ? [seg] : [], 300, 200)
    expect(pts.length).toBeGreaterThan(0)
    expect(pts.length).toBeLessThan(100)
    expect(pts.every((pt) => isFinite(pt.x) && isFinite(pt.y))).toBe(true)
  })

  test(`drops non-finite points`, () => {
    const pts = build_obstacles_norm(
      [
        {
          points: [
            { x: NaN, y: 0.5 },
            { x: 0.5, y: 0.5 },
          ],
        },
      ],
      300,
      200,
    )
    expect(pts.every((pt) => isFinite(pt.x) && isFinite(pt.y))).toBe(true)
  })
})
