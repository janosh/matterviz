import type { SunburstNode } from '$lib/plot'
import { arc_label_slots, compute_sunburst_layout, project_arcs } from '$lib/plot'
import type { ScreenArc, ScreenGeometry, ViewWindow } from '$lib/plot/sunburst/render'
import { annular_sector_path, hover_veil_path, rect_path } from '$lib/plot/sunburst/render'
import { describe, expect, test, vi } from 'vitest'

const TWO_PI = 2 * Math.PI
// pre-order: root=0, a=1 (x [0, 0.25]), a1=2 (x [0, 0.25]), b=3 (x [0.25, 1])
const tree: SunburstNode[] = [
  { label: `a`, children: [{ label: `a1`, value: 1 }] },
  { label: `b`, value: 3 },
]
const { arcs } = compute_sunburst_layout(tree)
const grouped_tree: SunburstNode[] = [`A`, `B`].map((label) => ({
  label,
  children: [1, 2].map((child_idx) => ({ label: `${label}${child_idx}`, value: 1 })),
}))
const { arcs: grouped_arcs } = compute_sunburst_layout(grouped_tree)

const sun_geom: ScreenGeometry = {
  shape: `sunburst`,
  inner_width: 400,
  inner_height: 400,
  radius: 200,
  hole_r: 20,
}
const full_win: ViewWindow = { x0: 0, x1: 1, y0: 0, n_rings: 2 }
const angular_span = (screen: { a0: number; a1: number }): number => screen.a1 - screen.a0
const screens_by_label = (screens: ScreenArc[]): Record<string, ScreenArc> =>
  Object.fromEntries(screens.map((screen) => [screen.arc.label, screen]))

describe(`project_arcs`, () => {
  test(`sunburst full view: angles span [0, 2π], radii start at hole_r, root excluded`, () => {
    const { all, visible } = project_arcs(arcs, full_win, sun_geom)
    expect(all.map((screen) => screen.arc.node_idx)).toEqual([0, 1, 2, 3]) // indexed by node_idx
    expect(visible.map((screen) => screen.arc.label)).toEqual([`a`, `a1`, `b`])
    const [, scr_a, scr_a1, scr_b] = all
    expect(scr_a.a0).toBeCloseTo(0, 9)
    expect(scr_a.a1).toBeCloseTo(TWO_PI / 4, 9)
    expect(scr_b.a1).toBeCloseTo(TWO_PI, 9)
    expect(scr_a.r0).toBe(20) // hole_r
    expect(scr_a.r1).toBeCloseTo(110, 9) // hole_r + (radius - hole_r) / n_rings
    expect(scr_a1.r1).toBeCloseTo(200, 9) // outer radius
  })

  test(`group gaps align selected subtree boundaries across rings`, () => {
    const { all } = project_arcs(grouped_arcs, full_win, sun_geom, {
      group_gap: {
        select: (arc) => arc.depth === 1,
        gap_px: 20,
        max_fraction: 0.5,
      },
    })
    const screen_by_label = screens_by_label(all)
    expect((screen_by_label.B.a0 - screen_by_label.A.a1) * sun_geom.radius).toBeCloseTo(20, 9)
    expect(screen_by_label.A1.a0).toBeCloseTo(screen_by_label.A.a0, 9)
    expect(screen_by_label.A2.a1).toBeCloseTo(screen_by_label.A.a1, 9)
    expect(screen_by_label.B1.a0).toBeCloseTo(screen_by_label.B.a0, 9)
    expect(screen_by_label.B2.a1).toBeCloseTo(screen_by_label.B.a1, 9)
  })

  test(`composes nested group gaps while preserving each subtree's boundaries`, () => {
    const { arcs: nested_arcs } = compute_sunburst_layout([
      {
        label: `A`,
        children: [
          {
            label: `A1`,
            children: [
              { label: `A1a`, value: 1 },
              { label: `A1b`, value: 1 },
            ],
          },
          { label: `A2`, value: 2 },
        ],
      },
      { label: `B`, value: 4 },
    ])
    const { all } = project_arcs(nested_arcs, { ...full_win, n_rings: 3 }, sun_geom, {
      group_gap: {
        select: (arc) => arc.label === `A` || arc.label === `A1`,
        gap_px: 20,
      },
    })
    const screen_by_label = screens_by_label(all)

    expect((screen_by_label.A1.a0 - screen_by_label.A.a0) * sun_geom.radius).toBeCloseTo(10, 9)
    expect((screen_by_label.A2.a0 - screen_by_label.A1.a1) * sun_geom.radius).toBeCloseTo(
      10,
      9,
    )
    expect(screen_by_label.A1a.a0).toBeCloseTo(screen_by_label.A1.a0, 9)
    expect(screen_by_label.A1b.a1).toBeCloseTo(screen_by_label.A1.a1, 9)
    expect(screen_by_label.A2.a1).toBeCloseTo(screen_by_label.A.a1, 9)
  })

  test(`keeps selected sibling gaps aligned after zooming their parent`, () => {
    const { arcs: zoom_arcs } = compute_sunburst_layout([
      { label: `user`, children: grouped_tree },
    ])
    const user = zoom_arcs.find((arc) => arc.label === `user`)
    if (!user) throw new Error(`expected user arc`)
    const zoom_win: ViewWindow = {
      x0: user.x0,
      x1: user.x1,
      y0: user.y0,
      n_rings: 2,
    }
    const { all } = project_arcs(zoom_arcs, zoom_win, sun_geom, {
      group_gap: { select: (arc) => arc.depth === 2, gap_px: 20 },
    })
    const screen_by_label = screens_by_label(all)

    expect((screen_by_label.B.a0 - screen_by_label.A.a1) * sun_geom.radius).toBeCloseTo(20, 9)
    expect(screen_by_label.A1.a0).toBeCloseTo(screen_by_label.A.a0, 9)
    expect(screen_by_label.B2.a1).toBeCloseTo(screen_by_label.B.a1, 9)
  })

  test(`removes a selected group's gap when that group becomes the zoom root`, () => {
    const group_a = grouped_arcs.find((arc) => arc.label === `A`)
    if (!group_a) throw new Error(`expected group A`)
    const mid_zoom = project_arcs(grouped_arcs, { ...full_win, y0: 0.5 }, sun_geom, {
      group_gap: { select: (arc) => arc.depth === 1, gap_px: 20 },
    })
    const mid_screen_by_label = screens_by_label(mid_zoom.all)
    expect(
      (mid_screen_by_label.B.a0 - mid_screen_by_label.A.a1) * sun_geom.radius,
    ).toBeCloseTo(10, 9)

    const { all } = project_arcs(
      grouped_arcs,
      { x0: group_a.x0, x1: group_a.x1, y0: group_a.y0, n_rings: 1 },
      sun_geom,
      { group_gap: { select: (arc) => arc.depth === 1, gap_px: 20 } },
    )
    const screen_by_label = screens_by_label(all)

    expect(screen_by_label.A1.a0).toBeCloseTo(0, 9)
    expect(screen_by_label.A2.a1).toBeCloseTo(TWO_PI, 9)
  })

  test(`capped group gaps scale rather than erase tiny boundary leaves`, () => {
    const tiny_tree: SunburstNode[] = [
      {
        label: `A`,
        children: [
          { label: `tiny`, value: 0.001 },
          { label: `rest`, value: 49.999 },
        ],
      },
      { label: `B`, value: 50 },
    ]
    const { arcs: tiny_arcs } = compute_sunburst_layout(tiny_tree)
    const plain = project_arcs(tiny_arcs, full_win, sun_geom).all
    const grouped = project_arcs(tiny_arcs, full_win, sun_geom, {
      group_gap: {
        select: (arc) => arc.label === `A`,
        gap_px: 10_000,
        max_fraction: 0.5,
      },
    }).all
    const plain_by_label = screens_by_label(plain)
    const grouped_by_label = screens_by_label(grouped)
    expect(angular_span(grouped_by_label.A)).toBeCloseTo(angular_span(plain_by_label.A) / 2, 9)
    expect(angular_span(grouped_by_label.tiny)).toBeCloseTo(
      angular_span(plain_by_label.tiny) / 2,
      9,
    )
    expect(grouped_by_label.tiny.visible).toBe(true)
  })

  test(`zoomed window: the zoom root's child fills the circle, everything else collapses`, () => {
    const win = { x0: arcs[1].x0, x1: arcs[1].x1, y0: arcs[1].y0, n_rings: 1 } // zoom to a
    const { all, visible } = project_arcs(arcs, win, sun_geom)
    expect(visible.map((screen) => screen.arc.label)).toEqual([`a1`])
    const [, scr_a, scr_a1, scr_b] = all
    expect(scr_a1.a0).toBe(0)
    expect(scr_a1.a1).toBeCloseTo(TWO_PI, 9)
    expect(scr_a1.r0).toBe(20)
    expect(scr_a1.r1).toBeCloseTo(200, 9)
    expect(scr_a.visible).toBe(false) // zoom root collapses into the hole
    expect(scr_a.r1 - scr_a.r0).toBe(0)
    expect(scr_b.visible).toBe(false) // outside the window -> clamped to zero extent
    expect(scr_b.a1 - scr_b.a0).toBe(0)
  })

  test(`icicle: x in [0, inner_width], rows top-down`, () => {
    const geom: ScreenGeometry = {
      shape: `icicle`,
      inner_width: 400,
      inner_height: 300,
      radius: 0,
      hole_r: 0,
    }
    const projection = project_arcs(arcs, full_win, geom)
    const select_group = vi.fn(() => true)
    expect(
      project_arcs(arcs, full_win, geom, {
        group_gap: { select: select_group, gap_px: 20 },
      }),
    ).toEqual(projection)
    expect(select_group).not.toHaveBeenCalled()
    expect(
      projection.visible.map(({ arc, a0, a1, r0, r1 }) => [arc.label, a0, a1, r0, r1]),
    ).toEqual([
      [`a`, 0, 100, 0, 150],
      [`a1`, 0, 100, 150, 300],
      [`b`, 100, 400, 0, 150],
    ])
  })
})

describe(`annular_sector_path`, () => {
  // Split path data into its command letters and numbers (rounded to kill trig round-off;
  // the `+ 0` turns -0 into 0 so toEqual matches)
  const tokens = (path: string) =>
    path
      .match(/[A-Z]|-?[\d.e-]+/g)
      ?.map((tok) => (/[A-Z]/.test(tok) ? tok : Number(Number(tok).toFixed(9)) + 0))

  test.each([
    [
      `quarter sector`,
      [0, Math.PI / 2, 20, 100],
      [
        `M`,
        0,
        -100,
        `A`,
        100,
        100,
        0,
        0,
        1,
        100,
        0,
        `L`,
        20,
        0,
        `A`,
        20,
        20,
        0,
        0,
        0,
        0,
        -20,
        `Z`,
      ],
    ],
    [
      // sweeps past 180° set the large-arc flag on both boundaries
      `three-quarter sector`,
      [0, 1.5 * Math.PI, 20, 100],
      [
        `M`,
        0,
        -100,
        `A`,
        100,
        100,
        0,
        1,
        1,
        -100,
        0,
        `L`,
        -20,
        0,
        `A`,
        20,
        20,
        0,
        1,
        0,
        0,
        -20,
        `Z`,
      ],
    ],
    [
      `wedge from the center`,
      [0, Math.PI / 2, 0, 100],
      [`M`, 0, -100, `A`, 100, 100, 0, 0, 1, 100, 0, `L`, 0, 0, `A`, 0, 0, 0, 0, 0, 0, 0, `Z`],
    ],
  ])(`%s`, (_label, [a0, a1, r0, r1], expected) => {
    expect(tokens(annular_sector_path(a0, a1, r0, r1))).toEqual(expected)
  })

  test(`full ring: two half-circle outer arcs plus a counter-clockwise inner hole`, () => {
    const ring = annular_sector_path(0, TWO_PI, 20, 100)
    // outer: two sweep=1 arcs of radius 100; inner: two sweep=0 arcs of radius 20
    expect(ring.match(/A100,100,0,1,1/g)).toHaveLength(2)
    expect(ring.match(/A20,20,0,1,0/g)).toHaveLength(2)
    expect(ring.match(/M/g)).toHaveLength(2)
    // no hole for a disk
    expect(annular_sector_path(0, TWO_PI, 0, 100).match(/M/g)).toHaveLength(1)
  })
})

describe(`hover_veil_path`, () => {
  const subpaths = (path: string | null) => path?.match(/M/g)?.length ?? 0

  test(`sunburst: disk minus hovered wedge (to the rim) minus visible ancestors`, () => {
    const { all } = project_arcs(arcs, full_win, sun_geom)
    // hovering the leaf a1 (idx 2): disk + wedge + parent a; the collapsed root is skipped
    const veil = hover_veil_path(all, 2, sun_geom)
    expect(subpaths(veil)).toBe(3)
    // the hovered wedge spans from its own inner radius out to the chart rim
    expect(veil).toContain(annular_sector_path(all[2].a0, all[2].a1, all[2].r0, 200))
    expect(veil).toContain(annular_sector_path(all[1].a0, all[1].a1, all[1].r0, all[1].r1))
    // hovering a depth-1 node cuts out only that wedge
    expect(subpaths(hover_veil_path(all, 3, sun_geom))).toBe(2)
  })

  test(`icicle: rectangles instead of sectors`, () => {
    const geom: ScreenGeometry = {
      shape: `icicle`,
      inner_width: 400,
      inner_height: 300,
      radius: 0,
      hole_r: 0,
    }
    const { all } = project_arcs(arcs, full_win, geom)
    expect(hover_veil_path(all, 2, geom)).toBe(
      rect_path(0, 400, 0, 300) + rect_path(0, 100, 150, 300) + rect_path(0, 100, 0, 150),
    )
  })

  test(`returns null for an index that is not projected (stale hover after a data swap)`, () => {
    const { all } = project_arcs(arcs, full_win, sun_geom)
    expect(hover_veil_path(all, 99, sun_geom)).toBeNull()
  })
})

describe(`arc_label_slots`, () => {
  // Sunburst.svelte takes the first slot with room for the label; no src caller wants that
  // one-liner, so it lives here - text_w leads so the rest are arc_label_slots' own args
  const arc_label_transform = (text_w: number, ...args: Parameters<typeof arc_label_slots>) =>
    arc_label_slots(...args).find((slot) => text_w <= slot.room)?.transform ?? null

  test.each([
    [
      `icicle wide cell: plain translate`,
      { a0: 0, a1: 200, r0: 0, r1: 20 },
      50,
      `icicle`,
      /^translate\(100, 10\)$/,
    ],
    [
      `icicle narrow-but-tall: rotated 90°`,
      { a0: 0, a1: 20, r0: 0, r1: 200 },
      50,
      `icicle`,
      /rotate\(-90\)$/,
    ],
    [`icicle too small both ways`, { a0: 0, a1: 20, r0: 0, r1: 20 }, 50, `icicle`, null],
    [
      `sunburst radial left half: flipped 180°`,
      { a0: Math.PI, a1: 1.5 * Math.PI, r0: 50, r1: 150 },
      50,
      `sunburst`,
      /rotate\(180\)$/,
    ],
    [
      `sunburst text too long`,
      { a0: Math.PI, a1: 1.5 * Math.PI, r0: 50, r1: 150 },
      500,
      `sunburst`,
      null,
    ],
  ] as const)(`%s`, (_name, datum, text_w, shape, expected) => {
    const rotation = shape === `sunburst` ? `radial` : `auto`
    const transform = arc_label_transform(text_w, datum, shape, rotation)
    if (expected === null) expect(transform).toBeNull()
    else expect(transform).toMatch(expected)
  })

  test(`max_radius clips straight labels that would extend past the chart circle`, () => {
    // Wide shallow outer arc -> tangential text. Arc length at mid radius
    // (~149px) fits 120px of text, but the straight tangent line from a label
    // centered at r=95 reaches hypot(95, 60) ~= 112px from the center.
    const wide_outer = { a0: 0, a1: Math.PI / 2, r0: 88, r1: 102 }
    expect(arc_label_transform(120, wide_outer, `sunburst`, `tangential`)).not.toBeNull()
    expect(arc_label_transform(120, wide_outer, `sunburst`, `tangential`, 100)).toBeNull()
    // Shorter text stays within the circle and keeps its label
    expect(arc_label_transform(40, wide_outer, `sunburst`, `tangential`, 100)).not.toBeNull()
    // Radial labels are bounded by their ring already: max_radius is a no-op
    const tall = { a0: 0, a1: 0.4, r0: 50, r1: 150 }
    expect(arc_label_transform(80, tall, `sunburst`, `radial`, 150)).not.toBeNull()
    // Horizontal at 3 o'clock reads along the radius: the far end lands
    // sqrt(95^2 + 60^2 + 120*95) ~= 155px from the center, past radius 100
    const east = { a0: Math.PI / 2 - 0.7, a1: Math.PI / 2 + 0.7, r0: 88, r1: 102 }
    expect(arc_label_transform(120, east, `sunburst`, `horizontal`, 100)).toBeNull()
  })

  test(`auto rotation falls back to the other orientation before hiding`, () => {
    // Wide shallow arc: tangential preferred (angular 149 > radial 14) but the
    // text is too long for the tangent line, so auto falls back to radial —
    // which also fails here (radial 14) -> null...
    const wide_outer = { a0: 0, a1: Math.PI / 2, r0: 88, r1: 102 }
    expect(arc_label_transform(200, wide_outer, `sunburst`, `auto`)).toBeNull()
    // ...but a THICK wide arc (radial 120) keeps its label by reading radially
    // when the tangent line would poke past the chart circle (max_radius 110 <
    // hypot(100, 55) ~= 114)
    const thick_wide = { a0: 0, a1: Math.PI / 2, r0: 40, r1: 160 }
    expect(arc_label_transform(110, thick_wide, `sunburst`, `auto`, 110)).toMatch(
      /translate\(100, 0\)/,
    )
  })

  test(`arc_label_slots reports the room each orientation has for text`, () => {
    // Tangential room is the arc length minus the 6px margin, capped by the chord
    // that keeps the straight tangent inside the chart: 2*sqrt(100^2 - 95^2) ~= 62.4px
    const wide_outer = { a0: 0, a1: Math.PI / 2, r0: 88, r1: 102 }
    const [tangential] = arc_label_slots(wide_outer, `sunburst`, `tangential`)
    expect(tangential.room).toBeCloseTo((Math.PI / 2) * 95 - 6, 6)
    const [clipped] = arc_label_slots(wide_outer, `sunburst`, `tangential`, 100)
    expect(clipped.room).toBeCloseTo(2 * Math.sqrt(100 ** 2 - 95 ** 2), 6)
    // and the transform for text of exactly that width agrees with the room
    expect(arc_label_transform(clipped.room, wide_outer, `sunburst`, `tangential`, 100)).toBe(
      clipped.transform,
    )
    expect(
      arc_label_transform(clipped.room + 1, wide_outer, `sunburst`, `tangential`, 100),
    ).toBeNull()
    // Radial room is the ring thickness minus the margin, roomiest orientation first
    const tall = { a0: 0, a1: 0.4, r0: 50, r1: 150 }
    expect(arc_label_slots(tall, `sunburst`, `auto`).map((slot) => slot.room)).toEqual([
      94,
      0.4 * 100 - 6,
    ])
    // a slice thinner than one line height offers no slot at all
    expect(
      arc_label_slots({ a0: 0, a1: 0.05, r0: 50, r1: 150 }, `sunburst`, `radial`),
    ).toEqual([])
  })

  test(`font_scale relaxes the one-line-height across requirement`, () => {
    // 10px-across slice: full-size labels need >= 12.1px -> hidden; at 0.7 scale
    // the requirement drops to 8.47px and the (scaled) text fits radially
    const thin = { a0: 0, a1: 10 / 95, r0: 50, r1: 140 }
    expect(arc_label_transform(70, thin, `sunburst`, `radial`)).toBeNull()
    expect(
      arc_label_transform(70 * 0.7, thin, `sunburst`, `radial`, undefined, 0.7),
    ).not.toBeNull()
  })

  // The across requirement is the label's RESOLVED line height (what CSS leads it to), not a
  // private 1.1x ratio on the font size: `line-height: 1.6` needs far more room than 1.1x
  test(`the across requirement follows the resolved line height`, () => {
    const row = { a0: 0, a1: 200, r0: 0, r1: 15 }
    const room_at = (line_height: number) =>
      arc_label_slots(row, `icicle`, `auto`, undefined, 1, line_height).map(
        (slot) => slot.room,
      )
    // 14px of leading fits the 15px-tall row upright (194px of room, then the rotated slot);
    // at 22px only the rotated one is left. A private 1.1x ratio would lead 14px to 15.4px
    // and drop the upright slot. 14 is load-bearing: it is the only probe in the 13.6-15
    // band that separates the two, which is why the original 12.1 passed under both.
    expect(room_at(14)).toEqual([194, 9])
    expect(room_at(22)).toEqual([9])
  })
})
