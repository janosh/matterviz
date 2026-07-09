import type { TreemapNode } from '$lib/plot'
import {
  compute_sunburst_layout,
  compute_treemap_layout,
  lerp_rects,
  sunburst_from_paths,
  tile_rects,
} from '$lib/plot'
import { describe, expect, test } from 'vitest'

const size = { width: 400, height: 300 }
const no_pad = { padding_inner: 0, padding_top: 0, padding_outer: 0 }

// Two-branch tree: A -> {A1: 4, A2: 6}, B: 10. Root total = 20.
const tree: TreemapNode[] = [
  {
    label: `A`,
    children: [
      { label: `A1`, value: 4 },
      { label: `A2`, value: 6 },
    ],
  },
  { label: `B`, value: 10 },
]

const area = (rect: { width: number; height: number }) => rect.width * rect.height
const all_coords_finite = (
  rects: readonly { x: number; y: number; width: number; height: number }[],
) => rects.every((rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))

describe(`compute_treemap_layout`, () => {
  test(`reuses sunburst tree semantics and tiles areas proportional to values`, () => {
    const { arcs, rects, root, max_depth } = compute_treemap_layout(tree, size, no_pad)
    expect(root).toBe(arcs[0])
    expect(max_depth).toBe(2)
    // semantic fields come from the shared sunburst layout (ids, colors, breadcrumbs)
    expect(arcs.map((arc) => arc.id)).toEqual([``, `A`, `A/A1`, `A/A2`, `B`])
    expect(arcs[2]).toMatchObject({
      label_path: [`A`, `A1`],
      fraction: expect.closeTo(0.2, 9),
      parent_fraction: expect.closeTo(0.4, 9),
    })
    // with zero padding, areas are exactly proportional to values
    const total_area = size.width * size.height
    expect(area(rects[0])).toBeCloseTo(total_area, 6)
    expect(area(rects[1])).toBeCloseTo(total_area / 2, 6) // A = 10/20
    expect(area(rects[2])).toBeCloseTo(total_area * 0.2, 6) // A1 = 4/20
    expect(area(rects[4])).toBeCloseTo(total_area / 2, 6) // B = 10/20
    // children nest inside their parent
    const [rect_a, rect_a1] = [rects[1], rects[2]]
    expect(rect_a1.x).toBeGreaterThanOrEqual(rect_a.x)
    expect(rect_a1.y).toBeGreaterThanOrEqual(rect_a.y)
    expect(rect_a1.x + rect_a1.width).toBeLessThanOrEqual(rect_a.x + rect_a.width + 1e-6)
    expect(rect_a1.y + rect_a1.height).toBeLessThanOrEqual(rect_a.y + rect_a.height + 1e-6)
  })

  test(`padding_top reserves a header strip on branches only`, () => {
    const { arcs, rects } = compute_treemap_layout(tree, size, {
      ...no_pad,
      padding_top: 20,
    })
    const [rect_a, rect_a1, rect_a2, rect_b] = [rects[1], rects[2], rects[3], rects[4]]
    // A's children start >= 20px below A's top edge; leaf B reserves nothing
    const child_top = Math.min(rect_a1.y, rect_a2.y)
    expect(child_top - rect_a.y).toBeGreaterThanOrEqual(20)
    expect(area(rect_b)).toBeGreaterThan(
      area({ width: rect_a1.width, height: rect_a1.height }),
    )
    expect(arcs[4].is_leaf).toBe(true)
  })

  test(`padding_outer insets children within their parent's left/right/bottom edges`, () => {
    const inset = 4
    const { rects } = compute_treemap_layout(tree, size, {
      ...no_pad,
      padding_outer: inset,
      padding_top: 20,
    })
    const [rect_a, rect_a1, rect_a2] = [rects[1], rects[2], rects[3]]
    for (const child of [rect_a1, rect_a2]) {
      expect(child.x).toBeGreaterThanOrEqual(rect_a.x + inset)
      expect(child.x + child.width).toBeLessThanOrEqual(rect_a.x + rect_a.width - inset + 1e-6)
      expect(child.y + child.height).toBeLessThanOrEqual(
        rect_a.y + rect_a.height - inset + 1e-6,
      )
      expect(child.y).toBeGreaterThanOrEqual(rect_a.y + 20) // header strip on top
    }
  })

  test(`empty data and zero size produce empty/zero layouts without NaN`, () => {
    expect(compute_treemap_layout([], size)).toMatchObject({ rects: [], root: null })
    const { rects } = compute_treemap_layout(tree, { width: 0, height: 300 }, no_pad)
    expect(rects.every((rect) => area(rect) === 0)).toBe(true)
    expect(all_coords_finite(rects)).toBe(true)
  })

  test.each([
    [`NaN`, Number.NaN],
    [`Infinity`, Number.POSITIVE_INFINITY],
    [`negative`, -5],
  ])(`%s leaf values are coerced to zero-size cells, not NaN rects`, (_desc, bad_value) => {
    const { rects } = compute_treemap_layout(
      [
        { label: `good`, value: 10 },
        { label: `bad`, value: bad_value },
      ],
      size,
      no_pad,
    )
    expect(all_coords_finite(rects)).toBe(true)
    expect(area(rects[2])).toBe(0) // bad leaf collapses
    expect(area(rects[1])).toBeCloseTo(size.width * size.height, 4) // good leaf fills
  })

  test(`value_mode total overflow (children > parent) clamps to the chart area`, () => {
    const { rects } = compute_treemap_layout(
      {
        label: `P`,
        value: 10,
        children: [
          { label: `c1`, value: 8 },
          { label: `c2`, value: 4 },
        ],
      },
      size,
      { value_mode: `total`, ...no_pad },
    )
    expect(all_coords_finite(rects)).toBe(true)
    for (const rect of rects) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(size.width + 1e-6)
      expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 1e-6)
    }
  })

  test(`padding_top larger than a cell collapses children without NaN`, () => {
    const { rects } = compute_treemap_layout(
      tree,
      { width: 60, height: 40 },
      { ...no_pad, padding_top: 500 },
    )
    expect(all_coords_finite(rects)).toBe(true)
  })

  test(`value_mode total leaves unfilled space for unassigned remainder`, () => {
    // parent worth 10, single child worth 3 -> child fills 30% of the parent cell
    const { rects } = compute_treemap_layout(
      { label: `P`, value: 10, children: [{ label: `c1`, value: 3 }] },
      size,
      { value_mode: `total`, ...no_pad },
    )
    expect(area(rects[1])).toBeCloseTo(size.width * size.height * 0.3, 6)
  })

  test(`min_fraction bucketing carries over from the shared layout`, () => {
    const long_tail: TreemapNode[] = [
      { label: `big`, value: 82 },
      { label: `s1`, value: 3 },
      { label: `s2`, value: 3 },
      { label: `s3`, value: 12 },
    ]
    const { arcs, rects } = compute_treemap_layout(long_tail, size, {
      min_fraction: 0.05,
      ...no_pad,
    })
    expect(arcs.map((arc) => arc.label)).toEqual([undefined, `big`, `s3`, `Other`])
    expect(arcs[3]).toMatchObject({ is_other: true, value: 6 })
    expect(area(rects[3])).toBeCloseTo(size.width * size.height * 0.06, 6)
  })

  test(`round-trips sunburst_from_paths data (shared builders)`, () => {
    const data = sunburst_from_paths([
      { path: [`cubic`, `225`], value: 12 },
      { path: [`cubic`, `221`], value: 3 },
      { path: [`hexagonal`, `194`], value: 5 },
    ])
    const { arcs, rects } = compute_treemap_layout(data, size, no_pad)
    expect(arcs.filter((arc) => arc.depth === 2)).toHaveLength(3)
    const leaf_area_sum = arcs
      .filter((arc) => arc.is_leaf)
      .reduce((sum, arc) => sum + area(rects[arc.node_idx]), 0)
    expect(leaf_area_sum).toBeCloseTo(size.width * size.height, 4)
  })
})

describe(`tile_rects`, () => {
  const { arcs } = compute_sunburst_layout(tree)

  test(`re-tiling a subtree fills the viewport and zeroes outside nodes`, () => {
    const rects = tile_rects(arcs, 1, size, no_pad) // zoom into A
    expect(rects[1]).toMatchObject({ x: 0, y: 0, ...size }) // A fills the viewport
    // A1/A2 split A's area 4:6
    expect(area(rects[2])).toBeCloseTo(size.width * size.height * 0.4, 6)
    expect(area(rects[3])).toBeCloseTo(size.width * size.height * 0.6, 6)
    // B (outside the zoomed subtree) collapses to a zero rect
    expect(area(rects[4])).toBe(0)
  })

  test(`zero rects are independent objects (mutating one can't corrupt others)`, () => {
    const rects = tile_rects(arcs, 1, size, no_pad) // zoom into A
    // root (idx 0) and B (idx 4) are both outside A's subtree -> zero rects;
    // mutating one must not leak into the other (regression: shared constant)
    rects[0].width = 999
    expect(rects[4].width).toBe(0)
  })

  test.each([
    [`bad root idx`, 99],
    [`negative idx`, -1],
  ])(`returns all-zero rects for %s`, (_desc, root_idx) => {
    const rects = tile_rects(arcs, root_idx, size, no_pad)
    expect(rects).toHaveLength(arcs.length)
    expect(rects.every((rect) => area(rect) === 0)).toBe(true)
  })
})

describe(`lerp_rects`, () => {
  const from = [{ x: 0, y: 0, width: 100, height: 100 }]
  const to = [{ x: 50, y: 20, width: 200, height: 60 }]

  test.each([
    [0, from[0]],
    [1, to[0]],
    [0.5, { x: 25, y: 10, width: 150, height: 80 }],
  ])(`t=%f interpolates rects`, (t, expected) => {
    expect(lerp_rects(from, to, t)[0]).toEqual(expected)
  })

  test(`length mismatch snaps to target (layout swap mid-tween)`, () => {
    expect(lerp_rects([], to, 0.5)).toBe(to)
  })
})
