import type { SunburstNode } from '$lib/plot'
import {
  arc_label_transform,
  arrow_nav_target,
  compute_sunburst_layout,
  project_arcs,
} from '$lib/plot'
import type { ScreenGeometry, ViewWindow } from '$lib/plot/sunburst/render'
import { describe, expect, test } from 'vitest'

const TWO_PI = 2 * Math.PI
// pre-order: root=0, a=1 (x [0, 0.25]), a1=2 (x [0, 0.25]), b=3 (x [0.25, 1])
const tree: SunburstNode[] = [
  { label: `a`, children: [{ label: `a1`, value: 1 }] },
  { label: `b`, value: 3 },
]
const { arcs } = compute_sunburst_layout(tree)

const sun_geom: ScreenGeometry = {
  shape: `sunburst`,
  inner_width: 400,
  inner_height: 400,
  radius: 200,
  hole_r: 20,
}
const full_win: ViewWindow = { x0: 0, x1: 1, y0: 0, n_rings: 2 }

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
    const { visible } = project_arcs(arcs, full_win, geom)
    expect(visible.map(({ arc, a0, a1, r0, r1 }) => [arc.label, a0, a1, r0, r1])).toEqual([
      [`a`, 0, 100, 0, 150],
      [`a1`, 0, 100, 150, 300],
      [`b`, 100, 400, 0, 150],
    ])
  })
})

describe(`arc_label_transform`, () => {
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
    const transform = arc_label_transform(datum, text_w, shape, rotation)
    if (expected === null) expect(transform).toBeNull()
    else expect(transform).toMatch(expected)
  })
})

describe(`arrow_nav_target`, () => {
  // pre-order indices: root=0, a=1, a1=2, a2=3, b=4, b1=5, c=6
  const nav_tree: SunburstNode[] = [
    {
      label: `a`,
      children: [
        { label: `a1`, value: 1 },
        { label: `a2`, value: 2 },
      ],
    },
    { label: `b`, children: [{ label: `b1`, value: 4 }] },
    { label: `c`, value: 8 },
  ]
  const { arcs: nav_arcs } = compute_sunburst_layout(nav_tree)
  const all_visible = () => true

  test.each([
    [`ArrowRight steps to the next sibling`, 1, `ArrowRight`, 4], // a -> b
    [`ArrowRight wraps from the last sibling to the first`, 6, `ArrowRight`, 1], // c -> a
    [`ArrowLeft wraps from the first sibling to the last`, 1, `ArrowLeft`, 6], // a -> c
    [`ArrowDown enters the first visible child`, 1, `ArrowDown`, 2], // a -> a1
    [`ArrowDown on a leaf is a no-op`, 6, `ArrowDown`, null], // c has no children
    [`ArrowUp returns to the parent`, 2, `ArrowUp`, 1], // a1 -> a
    [`ArrowUp never targets the hidden root at depth 0`, 1, `ArrowUp`, null], // a -> root
    [`single visible sibling: left/right are no-ops`, 5, `ArrowRight`, null], // b1 alone
    [`non-arrow keys are ignored`, 1, `Enter`, null],
    [`unknown current index returns null`, 99, `ArrowRight`, null],
  ] as const)(`%s`, (_name, current_idx, key, expected) => {
    expect(arrow_nav_target(nav_arcs, all_visible, current_idx, key)).toBe(expected)
  })

  test(`hidden arcs are skipped when cycling siblings (wrap respects visibility)`, () => {
    const b_hidden = (idx: number) => idx !== 4
    // a -> c directly (b hidden), and c wraps back to a
    expect(arrow_nav_target(nav_arcs, b_hidden, 1, `ArrowRight`)).toBe(6)
    expect(arrow_nav_target(nav_arcs, b_hidden, 6, `ArrowRight`)).toBe(1)
    // only one sibling left visible -> no-op
    const only_a_visible = (idx: number) => idx === 1
    expect(arrow_nav_target(nav_arcs, only_a_visible, 1, `ArrowLeft`)).toBeNull()
  })

  test(`ArrowDown and ArrowUp respect visibility of the target`, () => {
    // a's first child a1 hidden -> ArrowDown is a no-op (no fall-through to a2)
    expect(arrow_nav_target(nav_arcs, (idx) => idx !== 2, 1, `ArrowDown`)).toBeNull()
    // parent a hidden -> ArrowUp from a1 is a no-op
    expect(arrow_nav_target(nav_arcs, (idx) => idx !== 1, 2, `ArrowUp`)).toBeNull()
  })
})
