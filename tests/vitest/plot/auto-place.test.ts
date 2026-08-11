import {
  build_obstacles_norm,
  clip_bar,
  clip_segment_to_unit_square,
  place_decorations,
} from '$lib/plot/core/auto-place'
import { describe, expect, test } from 'vitest'

const base_pad = { t: 5, b: 50, l: 50, r: 20 }
const width = 400
const height = 300

// obstacle field filling the whole [0,1] plot so any interior decoration unavoidably overlaps data
const dense: { x: number; y: number }[] = []
for (let x_idx = 0; x_idx <= 20; x_idx++) {
  for (let y_idx = 0; y_idx <= 20; y_idx++) {
    dense.push({ x: x_idx / 20, y: y_idx / 20 })
  }
}

// place_decorations over the shared plot box; tests override only what they vary (obstacles default
// to the fully-dense field that forces every interior decoration to overlap data)
const place = (overrides: Partial<Parameters<typeof place_decorations>[0]> = {}) =>
  place_decorations({ base_pad, width, height, obstacles_norm: dense, ...overrides })

describe(`place_decorations`, () => {
  test.each([
    { horizontal: true, edge: `top` },
    { horizontal: false, edge: `right` },
  ])(
    `crowded colorbar (horizontal=$horizontal) moves to the $edge margin`,
    ({ horizontal }) => {
      const layout = place({ colorbar: { footprint: { width: 220, height: 56 }, horizontal } })
      expect(layout.colorbar_outside).toBe(true)
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

  test.each([
    [`wide/short`, { width: 120, height: 60 }, { b: 118, r: 20 }, { x: 155, y: 232 }],
    [`narrow/tall`, { width: 80, height: 200 }, { b: 50, r: 96 }, { x: 312 }],
  ])(`crowded %s legend reserves its cheaper margin`, (_name, footprint, pad, legend_pos) => {
    const layout = place({ legend: { footprint } })
    expect(layout).toMatchObject({ legend_outside: true, pad, legend_pos })
  })

  test(`decorations stay interior when a sparse region is available`, () => {
    const layout = place({
      obstacles_norm: [{ x: 0.05, y: 0.95 }], // single point in a corner
      legend: { footprint: { width: 120, height: 60 } },
      colorbar: { footprint: { width: 220, height: 56 }, horizontal: true },
    })
    expect(layout.legend_outside).toBe(false)
    expect(layout.colorbar_outside).toBe(false)
    expect(layout.pad).toEqual(base_pad)
  })

  test(`never reduces a large base padding when reserving a right legend`, () => {
    const large_right_pad = { ...base_pad, r: 180 }
    const layout = place({
      base_pad: large_right_pad,
      legend: { footprint: { width: 80, height: 200 } },
    })
    expect(layout.legend_outside).toBe(true)
    expect(layout.pad).toMatchObject(large_right_pad)
  })

  test(`a decoration larger than the plot moves outside even over sparse data`, () => {
    // footprint wider than the plot area can't fit inside regardless of how empty the plot is,
    // so it's "crowded out" purely by size (not by overlapping the single obstacle point)
    const layout = place({
      obstacles_norm: [{ x: 0.5, y: 0.5 }],
      colorbar: { footprint: { width: 500, height: 56 }, horizontal: true },
    })
    expect(layout.colorbar_outside).toBe(true)
    expect(layout.pad.t).toBeGreaterThan(base_pad.t)
  })
})

describe(`clip_bar`, () => {
  test.each([
    [`off-plot to the left`, -0.2, 0, 1],
    [`off-plot to the right`, 1.5, 0, 1],
    [`fully above`, 0.5, -0.8, -0.2],
  ] as const)(`returns null when %s`, (_name, cross, span_start, span_end) => {
    expect(clip_bar(true, cross, span_start, span_end)).toBeNull()
  })

  test.each([
    [
      `vertical`,
      true,
      0.5,
      -0.4,
      1.6,
      [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
    ],
    [
      `horizontal`,
      false,
      0.3,
      -0.5,
      0.7,
      [
        { x: 0, y: 0.3 },
        { x: 0.7, y: 0.3 },
      ],
    ],
  ] as const)(
    `clamps a %s bar segment to the visible box`,
    (_name, vertical, cross, span_start, span_end, points) => {
      expect(clip_bar(vertical, cross, span_start, span_end)).toEqual({
        points,
        draws_line: true,
      })
    },
  )

  // bars flush to a plot edge (first/last bar or bin) have cross exactly at 0 or 1 and must be
  // kept as obstacles, else the legend could land on top of an edge bar
  test.each([
    [`vertical bar at the left edge`, true, 0],
    [`vertical bar at the right edge`, true, 1],
    [`horizontal bar at the bottom edge`, false, 0],
    [`horizontal bar at the top edge`, false, 1],
  ] as const)(`keeps an edge bar (%s)`, (_name, vertical, cross) => {
    const seg = clip_bar(vertical, cross, 0, 1)
    expect(seg).not.toBeNull()
    const fixed_axis = vertical ? `x` : `y`
    expect(seg?.points.every((pt) => pt[fixed_axis] === cross)).toBe(true)
  })
})

describe(`clip_segment_to_unit_square`, () => {
  test.each([
    [`x`, { x: -Number.MAX_VALUE, y: 0.5 }, { x: Number.MAX_VALUE, y: 0.5 }],
    [`y`, { x: 0.5, y: -Number.MAX_VALUE }, { x: 0.5, y: Number.MAX_VALUE }],
  ])(`rejects finite endpoints whose %s delta overflows`, (_axis, start, end) =>
    expect(clip_segment_to_unit_square(start, end)).toBeNull(),
  )
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
    expect(pts).toEqual([{ x: 0.5, y: 0.5 }])
  })

  test(`samples the visible portion of extreme offscreen line segments`, () => {
    const obstacles = build_obstacles_norm(
      [
        {
          points: [
            { x: -1000, y: 0.5 },
            { x: 1000, y: 0.5 },
          ],
          draws_line: true,
        },
      ],
      300,
      200,
    )
    expect(obstacles.length).toBeGreaterThan(20)
    const all_visible = obstacles.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1)
    expect(all_visible).toBe(true)
  })
})
