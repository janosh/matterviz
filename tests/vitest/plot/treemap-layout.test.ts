import type { SunburstLayoutOptions, SunburstSort, TreemapNode } from '$lib/plot'
import {
  align_tiling,
  compute_sunburst_layout,
  header_strip,
  lerp_rects,
  sunburst_from_paths,
  tile_rects,
} from '$lib/plot'
import { DEFAULT_FONT_SPEC } from '$lib/plot/core/text-metrics'
import { DEFAULTS } from '$lib/settings'
import {
  measure_treemap_label_block,
  normalize_treemap_label_lines,
  place_treemap_label,
} from '$lib/plot/treemap/labels'
import { describe, expect, test } from 'vitest'

const size = { width: 400, height: 300 }

// One-shot semantic layout + root tiling, the way the Treemap component composes them
// (it calls compute_sunburst_layout and tile_rects separately so zoom re-tiles cheaply)
const compute_treemap_layout = (
  data: TreemapNode | TreemapNode[],
  tile_size: { width: number; height: number },
  opts: Omit<SunburstLayoutOptions, `sort`> & {
    sort?: SunburstSort
    padding_inner?: number
    padding_top?: number
    padding_outer?: number
  } = {},
) => {
  const {
    padding_inner = DEFAULTS.treemap.padding_inner,
    padding_top = DEFAULTS.treemap.padding_top,
    padding_outer = DEFAULTS.treemap.padding_outer,
    sort = `descending`,
    ...tree_opts
  } = opts
  const { arcs, root, max_depth } = compute_sunburst_layout(data, { sort, ...tree_opts })
  const rects = tile_rects(arcs, 0, tile_size, { padding_inner, padding_top, padding_outer })
  return { arcs, rects, root, max_depth }
}
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
    // semantic fields come from the shared sunburst layout (ids, colors,
    // breadcrumbs); the default descending sort puts A2 (6) before A1 (4)
    expect(arcs.map((arc) => arc.id)).toEqual([``, `A`, `A/A2`, `A/A1`, `B`])
    expect(arcs[3]).toMatchObject({
      label_path: [`A`, `A1`],
      fraction: expect.closeTo(0.2, 9),
      parent_fraction: expect.closeTo(0.4, 9),
    })
    // d3's squarify (golden-ratio target) tiles the 400x300 area as two 400x150
    // rows for the equal-value A/B pair; inside A's row, A2 (6) and A1 (4) sit side
    // by side at 240px and 160px. Zero padding -> areas exactly proportional.
    expect(rects.map(({ x, y, width, height }) => [x, y, width, height])).toEqual(
      [
        [0, 0, 400, 300],
        [0, 0, 400, 150], // A
        [0, 0, 240, 150], // A2
        [240, 0, 160, 150], // A1
        [0, 150, 400, 150], // B
      ].map((row) => row.map((val) => expect.closeTo(val, 9))),
    )
    // opt-out restores input order
    const unsorted = compute_treemap_layout(tree, size, { ...no_pad, sort: `none` })
    expect(unsorted.arcs.map((arc) => arc.id)).toEqual([``, `A`, `A/A1`, `A/A2`, `B`])
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

  // d3 applies paddingTop after paddingOuter, so the reserved strip is the larger of the two
  test(`header_strip is the band the tiling actually reserves`, () => {
    expect([header_strip(4, 10), header_strip(20, 4)]).toEqual([10, 20])
    const opts = { padding_inner: 0, padding_top: 4, padding_outer: 10 }
    const [rect_a, rect_a1, rect_a2] = compute_treemap_layout(tree, size, opts).rects.slice(1)
    expect(Math.min(rect_a1.y, rect_a2.y) - rect_a.y).toBeCloseTo(header_strip(4, 10), 9)
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

test(`normalize_treemap_label_lines ignores nullish and empty-label array entries`, () => {
  expect(normalize_treemap_label_lines([`kept`, null, undefined, { text: `` }])).toEqual([
    { text: `kept` },
  ])
})

describe(`place_treemap_label`, () => {
  // happy-dom has no canvas, so text-metrics' fallback measures 0.6px per character
  // per px of font size: 'label' at 10px = 30px wide, 11px tall (1.1 line height)
  const font = DEFAULT_FONT_SPEC
  const block = (
    lines: { text: string; font_scale?: number; font_weight?: number }[] = [{ text: `label` }],
    font_size = 10,
  ) => measure_treemap_label_block(lines, font_size, font)
  const base = {
    block: block(),
    header: false,
    fit: `hide` as const,
    min_font_size: 6,
    header_height: 0,
    margin: 0,
  }
  const rect = (width: number, height: number) => ({ x: 0, y: 0, width, height })

  test(`measures the widest line and stacks line heights; weight/scale per line`, () => {
    expect(block()).toMatchObject({ font_size: 10, width: 30, height: 11 })
    const two = block([
      { text: `ab`, font_scale: 0.5 },
      { text: `cd`, font_weight: 700 },
    ])
    expect(two.width).toBeCloseTo(12, 9) // 'cd' at 10px (the half-size 'ab' is 6px)
    expect(two.height).toBeCloseTo(5.5 + 11, 9)
  })

  test.each([
    { name: `fits horizontally at max size`, rect: rect(100, 50), rotated: false },
    { name: `rotates in tall-thin cells`, rect: rect(12, 100), rotated: true },
  ])(`$name`, ({ rect: cell, rotated }) => {
    const placement = place_treemap_label({ ...base, rect: cell })
    expect(placement).not.toBeNull()
    expect(Boolean(placement?.transform?.includes(`rotate(-90`))).toBe(rotated)
    expect(placement?.font_size).toBe(10)
    // the single line sits on the cell's vertical center
    expect(placement?.lines.map((line) => line.y)).toEqual([cell.height / 2])
  })

  test(`leaf fitting reserves margin on every edge`, () => {
    const cell = rect(40, 12) // 30x11 block fits with margin 0 but not 4 (32x4 left)
    expect(place_treemap_label({ ...base, rect: cell })).not.toBeNull()
    expect(place_treemap_label({ ...base, rect: cell, margin: 4 })).toBeNull()
  })

  test.each([
    // 'label' at 10px = 30px wide; a 20px-wide cell gives ratio 2/3
    {
      name: `shrink scales to the exact fit ratio`,
      fit: `shrink`,
      width: 20,
      font_px: 20 / 3,
    },
    { name: `shrink clamps at min_font_size`, fit: `shrink`, width: 3, font_px: 6 },
    { name: `clip keeps the max size on overflow`, fit: `clip`, width: 3, font_px: 10 },
  ] as const)(`$name`, ({ fit, width, font_px }) => {
    // tall cell so only width constrains and rotation stays unattractive
    const placement = place_treemap_label({
      ...base,
      fit,
      header: true, // header disables the rotated candidate
      header_height: 100,
      rect: rect(width, 100),
    })
    expect(placement?.font_size).toBeCloseTo(font_px, 9)
    expect(placement?.x).toBe(0) // header labels left-align at the margin
  })

  test.each([
    { name: `hide drops overflowing labels`, opts: { rect: rect(3, 3) } },
    { name: `empty lines`, opts: { rect: rect(100, 50), block: block([]) } },
    { name: `NaN width`, opts: { rect: rect(Number.NaN, 50) } },
    { name: `zero-height sliver`, opts: { rect: rect(100, 0) } },
    { name: `header without a strip`, opts: { rect: rect(100, 50), header: true } },
  ])(`returns null for $name`, ({ opts }) => {
    expect(place_treemap_label({ ...base, ...opts })).toBeNull()
  })

  test(`min > max collapses to max; font_scale lines stack cumulatively`, () => {
    const placement = place_treemap_label({
      ...base,
      block: block([{ text: `ab`, font_scale: 0.5 }, { text: `cd` }]),
      min_font_size: 99,
      rect: rect(100, 50),
    })
    expect(placement?.font_size).toBe(10)
    // block height = (0.5 + 1) * 10 * 1.1 = 16.5, centered on y=25:
    // line 1 spans [16.75, 22.25] (center 19.5), line 2 [22.25, 33.25] (center 27.75)
    expect(placement?.lines.map((line) => line.y)).toEqual([19.5, 27.75])
  })
})

describe(`align_tiling`, () => {
  const rect = (x: number) => ({ x, y: 0, width: 10, height: 10 })
  // parent P (idx 0) with children; ids are what alignment matches on
  const arcs = (ids: string[]) =>
    ids.map((id, idx) => ({ id, parent_idx: idx === 0 ? null : 0 }))

  test(`matches by id, not position`, () => {
    // `b` moved from index 1 to index 2 between the two tilings
    const prev = { rects: [rect(0), rect(10), rect(20)], arcs: arcs([`P`, `b`, `c`]) }
    const next = { rects: [rect(0), rect(50), rect(60)], arcs: arcs([`P`, `c`, `b`]) }
    expect(align_tiling(prev, next)).toEqual([rect(0), rect(20), rect(10)])
  })

  // Nodes revealed by a dissolved bucket have no counterpart; starting them at their
  // parent's old rect makes them unfold out of the region the bucket occupied
  test(`a new cell starts from its nearest surviving ancestor`, () => {
    const prev = { rects: [rect(0), rect(10)], arcs: arcs([`P`, `P/Other`]) }
    const next = {
      rects: [rect(0), rect(30), rect(40)],
      arcs: arcs([`P`, `P/a`, `P/b`]),
    }
    expect(align_tiling(prev, next)).toEqual([rect(0), rect(0), rect(0)])
  })

  test(`a cell with no ancestor in the previous tiling starts where it lands`, () => {
    const prev = { rects: [rect(0)], arcs: arcs([`Q`]) }
    const next = { rects: [rect(5), rect(6)], arcs: arcs([`P`, `P/a`]) }
    expect(align_tiling(prev, next)).toEqual([rect(5), rect(6)])
  })

  // The realigned array is what lerp_rects consumes, and it bails on a length mismatch
  test(`always returns one rect per cell of the new tiling`, () => {
    const prev = { rects: [rect(0), rect(10), rect(20)], arcs: arcs([`P`, `x`, `y`]) }
    const next = { rects: [rect(0)], arcs: arcs([`P`]) }
    expect(align_tiling(prev, next)).toHaveLength(1)
  })
})
