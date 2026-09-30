import type {
  DecorationItem,
  DecorationScene,
  DecorationSize,
} from '$lib/plot/core/decorations'
import {
  build_obstacles_norm,
  bar_obstacles,
  clip_segment_to_unit_square,
  get_outside_placement,
  place_outside_decorations,
} from '$lib/plot/core/decorations'
import type { Vec2 } from '$lib/math'
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

// Outside placement over the shared plot box; tests override only what they vary (obstacles
// default to the fully-dense field that forces every interior decoration to overlap data)
const place = ({
  legend,
  colorbar,
  ...overrides
}: Partial<Omit<DecorationScene, `items`>> & {
  legend?: { footprint: DecorationSize }
  colorbar?: { footprint: DecorationSize; horizontal?: boolean }
} = {}) => {
  const items: DecorationItem[] = []
  if (legend) items.push({ id: `legend`, kind: `legend`, ...legend })
  if (colorbar) items.push({ id: `colorbar`, kind: `colorbar`, ...colorbar })
  return place_outside_decorations({
    base_pad,
    width,
    height,
    obstacles_norm: dense,
    items,
    ...overrides,
  })
}

// A legend wider than ~45% of the plot (a phone-width frame) goes below the plot even when
// nothing is crowded: inside it would cover most of the data, on the right it would leave no
// plot width
test(`a legend too wide for its frame always goes below the plot`, () => {
  const legend = { footprint: { width: 140, height: 40 } }
  const roomy = place({ legend, obstacles_norm: [] }) // 140 / 330 = 42%: stays interior
  expect(roomy.pad).toEqual(base_pad)
  const narrow = place({ legend, obstacles_norm: [], width: 360 }) // 140 / 290 = 48%
  expect(narrow.pad.b).toBeGreaterThan(base_pad.b)
  expect(narrow.pad.r).toBe(base_pad.r)
})

describe(`place_outside_decorations`, () => {
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

  // BandsAndDos pads both panels to the larger resolved bottom; without this the panel that
  // owns the legend would add it again on top and the shared axis could never converge
  test(`a bottom legend fits inside caller padding that already clears the axis band`, () => {
    const legend = { footprint: { width: 120, height: 60 } }
    const stacked = place({ legend })
    expect(stacked.pad.b).toBe(base_pad.b + 60 + 8)
    const roomy = place({
      legend,
      base_pad: { ...base_pad, b: stacked.pad.b },
      axis_pad: base_pad,
    })
    expect(roomy.pad.b).toBe(stacked.pad.b)
    // the padding did not grow, yet the legend still sits below: the side is not inferred from it
    const roomy_scene: DecorationScene = {
      base_pad: { ...base_pad, b: stacked.pad.b },
      width,
      height,
      obstacles_norm: dense,
      items: [{ id: `legend`, kind: `legend`, ...legend }],
    }
    const placement = get_outside_placement(roomy_scene.items[0], roomy_scene, roomy)
    expect(placement).toMatchObject({ side: `bottom`, ...roomy.legend_pos })
    // a caller padding short of the band still grows to fit the legend
    const short = place({ legend, base_pad: { ...base_pad, b: 60 }, axis_pad: base_pad })
    expect(short.pad.b).toBe(stacked.pad.b)
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

  // Crowding counts the samples under the chosen spot: a pile of samples elsewhere used to
  // raise a plot-wide threshold until a spot over a line passed as sparse
  test.each([0, 2000])(
    `a legend over data moves outside with %i samples elsewhere`,
    (n_pile) => {
      // lines at every quarter of the 330px width leave no gap for a 120px legend
      const lines = [0.25, 0.5, 0.75].flatMap((line_x) =>
        Array.from({ length: 21 }, (_, idx) => ({ x: line_x, y: idx / 20 })),
      )
      const pile = Array.from({ length: n_pile }, () => ({ x: 0.5, y: 0.5 }))
      const layout = place({
        obstacles_norm: [...lines, ...pile],
        legend: { footprint: { width: 120, height: 60 } },
      })
      expect(layout.legend_outside).toBe(true)
    },
  )

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

describe(`bar_obstacles`, () => {
  const crosses = (vertical: boolean, cross: Vec2, span: Vec2): number[] =>
    bar_obstacles(vertical, cross, span).map(({ points }) => points[0][vertical ? `x` : `y`])

  test.each<[string, Vec2, Vec2]>([
    [`off-plot to the left`, [-0.4, -0.2], [0, 1]],
    [`off-plot to the right`, [1.2, 1.5], [0, 1]],
    [`fully above`, [0.4, 0.6], [-0.8, -0.2]],
    [`a NaN span`, [0.4, 0.6], [NaN, 0.5]],
  ])(`returns no segments when %s`, (_name, cross, span) => {
    expect(bar_obstacles(true, cross, span)).toEqual([])
  })

  // a lone center line let an auto-placed legend sit over a wide bar's sides
  test.each([
    [`vertical`, true, { x: 0.4, y: 0 }, { x: 0.4, y: 1 }],
    [`horizontal`, false, { x: 0, y: 0.4 }, { x: 1, y: 0.4 }],
  ] as const)(
    `clamps a %s bar to the visible box and traces both edges and its center`,
    (_name, vertical, start, end) => {
      const segments = bar_obstacles(vertical, [0.4, 0.6], [-0.4, 1.6])
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ points: [start, end], draws_line: true })
      expect(crosses(vertical, [0.4, 0.6], [-0.4, 1.6])).toEqual([0.4, 0.5, 0.6])
    },
  )

  // bars flush to a plot edge (first/last bar or bin) keep their edge at 0 or 1; a bar past the
  // plot is traced over its visible part (a zoomed-in bar covering the view still counts); a
  // wide bar gets interior lines so no legend fits between them; a zero-width bar (a whisker)
  // is a single segment
  test.each<[string, boolean, Vec2, number[]]>([
    [`left edge`, true, [0, 0.2], [0, 0.1, 0.2]],
    [`right edge`, true, [0.8, 1], [0.8, 0.9, 1]],
    [`bottom edge`, false, [0, 0.2], [0, 0.1, 0.2]],
    [`partly off-plot`, true, [-0.25, 0.5], [0, 0.25, 0.5]],
    [`covering the whole view`, true, [-3, 2], [0, 0.25, 0.5, 0.75, 1]],
    [`wide`, false, [0.25, 1], [0.25, 0.5, 0.75, 1]],
    [`zero width`, false, [0.7, 0.7], [0.7]],
  ])(`keeps the in-plot segments (%s)`, (_name, vertical, cross, expected) => {
    expect(crosses(vertical, cross, [0, 1])).toEqual(expected)
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
    const segs = bar_obstacles(true, [0.5, 0.5], [-1000, 1000]) // huge span clamps to [0,1]
    expect(segs).toHaveLength(1)
    const pts = build_obstacles_norm(segs, 300, 200)
    expect(pts.length).toBeGreaterThan(0)
    expect(pts.length).toBeLessThan(100)
    expect(pts.every((point) => isFinite(point.x) && isFinite(point.y))).toBe(true)
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
    const all_visible = obstacles.every(
      ({ x: coord_x, y: coord_y }) =>
        coord_x >= 0 && coord_x <= 1 && coord_y >= 0 && coord_y <= 1,
    )
    expect(all_visible).toBe(true)
  })
})
