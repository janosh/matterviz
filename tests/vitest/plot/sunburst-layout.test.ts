import type { SunburstNode } from '$lib/plot'
import {
  compute_sunburst_layout,
  DEFAULT_SERIES_COLORS,
  sunburst_from_labels_parents,
  sunburst_from_paths,
} from '$lib/plot'
import { hsl } from 'd3-color'
import { describe, expect, test, vi } from 'vitest'

const close = (val: number) => expect.closeTo(val, 9)

// Two-branch tree: A -> {A1: 4, A2: 6}, B: 10. Root total = 20. A and A1 are
// hatched to check hatch passes through per-node without inheriting (A2/B stay unhatched).
const tree: SunburstNode[] = [
  {
    label: `A`,
    hatch: true,
    children: [
      { label: `A1`, value: 4, hatch: true },
      { label: `A2`, value: 6 },
    ],
  },
  { label: `B`, value: 10 },
]

describe(`compute_sunburst_layout`, () => {
  test(`partition geometry, pre-order indexing, ids and colors`, () => {
    const { arcs, root, max_depth } = compute_sunburst_layout(tree)
    expect(root).toBe(arcs[0])
    expect(max_depth).toBe(2)
    const [c0, c1] = DEFAULT_SERIES_COLORS
    // [id, node_idx, subtree_end, parent_idx, depth, value, is_leaf, color, hatch] per
    // arc: pre-order indexing gives contiguous subtree ranges, auto-ids slash-join
    // labels, descendants inherit their depth-1 ancestor's palette color, and hatch
    // passes through per-node without inheriting
    const fields = ({ id, node_idx, subtree_end, parent_idx, ...arc }: (typeof arcs)[0]) => [
      id,
      node_idx,
      subtree_end,
      parent_idx,
      arc.depth,
      arc.value,
      arc.is_leaf,
      arc.color,
      arc.hatch ?? false,
    ]
    expect(arcs.map(fields)).toEqual([
      [``, 0, 4, null, 0, 20, false, `transparent`, false],
      [`A`, 1, 3, 0, 1, 10, false, c0, true],
      [`A/A1`, 2, 2, 1, 2, 4, true, c0, true],
      [`A/A2`, 3, 3, 1, 2, 6, true, c0, false],
      [`B`, 4, 4, 0, 1, 10, true, c1, false],
    ])
    // sort 'none' preserves input order (A first half, B second, closing the circle);
    // children subdivide the parent span proportionally (4:6); y0 === depth
    expect(arcs.map(({ x0, x1 }) => [x0, x1])).toEqual(
      [
        [0, 1],
        [0, 0.5],
        [0, 0.2],
        [0.2, 0.5],
        [0.5, 1],
      ].map((pair) => pair.map(close)),
    )
    expect(arcs.every((arc) => arc.y0 === arc.depth && arc.y1 === arc.depth + 1)).toBe(true)
    // breadcrumbs + fractions (spot-check on A1)
    expect(arcs[2]).toMatchObject({
      path: [`A`, `A/A1`],
      label_path: [`A`, `A1`],
      fraction: close(0.2),
      parent_fraction: close(0.4),
    })
  })

  test(`explicit ids win over auto-generated ones; duplicates warn`, () => {
    const { arcs } = compute_sunburst_layout([
      { id: `sys`, label: `A`, children: [{ id: `sys/1`, label: `A1`, value: 2 }] },
    ])
    expect(arcs.map((arc) => arc.id)).toEqual([``, `sys`, `sys/1`])

    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    compute_sunburst_layout([
      { label: `A`, value: 1 },
      { label: `A`, value: 2 },
    ])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/duplicate node id "A"/))
    warn.mockRestore()
  })

  describe(`value modes`, () => {
    // parent with own value 5 + single child worth 3
    const node: SunburstNode = { label: `P`, value: 5, children: [{ label: `c1`, value: 3 }] }

    test.each([
      [`leaf-sum`, 3, 1], // parent value ignored; child is the only leaf -> full span
      [`remainder`, 8, 3 / 8], // own value added on top of children, rest is a gap
      [`total`, 5, 3 / 5], // explicit values authoritative, shortfall leaves a gap
    ] as const)(`%s: root=%d, child spans %f`, (value_mode, root_value, child_span) => {
      const { root, arcs } = compute_sunburst_layout(node, { value_mode })
      expect(root?.value).toBe(root_value)
      expect(arcs[1].x1 - arcs[1].x0).toBeCloseTo(child_span, 9)
    })

    test(`total warns when children exceed their parent's value`, () => {
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const children = [
        { label: `c1`, value: 8 },
        { label: `c2`, value: 4 },
      ]
      const { arcs } = compute_sunburst_layout(
        { label: `P`, value: 10, children },
        { value_mode: `total` },
      )
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/children of "P" sum to 12/))
      // layout does NOT clamp the overflow: c2 ends at 12/10 of the circle
      expect(arcs[2].x1).toBeCloseTo(1.2, 9)
      warn.mockRestore()
    })
  })

  describe(`sort`, () => {
    const unordered: SunburstNode[] = [
      { label: `small`, value: 1 },
      { label: `big`, value: 9 },
      { label: `mid`, value: 5 },
    ]

    test.each([
      [`none`, [`small`, `big`, `mid`]],
      [`descending`, [`big`, `mid`, `small`]],
      [`ascending`, [`small`, `mid`, `big`]],
    ] as const)(`%s ordering`, (sort, expected) => {
      const { arcs } = compute_sunburst_layout(unordered, { sort })
      const depth1 = arcs.filter((arc) => arc.depth === 1)
      depth1.sort((arc_a, arc_b) => arc_a.x0 - arc_b.x0) // by angular position
      expect(depth1.map((arc) => arc.label)).toEqual(expected)
    })
  })

  describe(`colors`, () => {
    test(`explicit colors win and are inherited by descendants`, () => {
      const grandkids = [{ label: `A2a`, value: 1 }]
      const { arcs } = compute_sunburst_layout([
        {
          label: `A`,
          color: `teal`,
          children: [
            { label: `A1`, value: 1 },
            { label: `A2`, value: 1, color: `crimson`, children: grandkids },
          ],
        },
      ])
      expect(arcs.map((arc) => [arc.label, arc.color])).toEqual([
        [undefined, `transparent`],
        [`A`, `teal`],
        [`A1`, `teal`],
        [`A2`, `crimson`],
        [`A2a`, `crimson`],
      ])
    })

    test(`level_lighten brightens inherited colors by depth`, () => {
      const grandkids = [{ label: `A1a`, value: 1 }]
      const { arcs } = compute_sunburst_layout(
        [{ label: `A`, color: `#1f77b4`, children: [{ label: `A1`, children: grandkids }] }],
        { level_lighten: 0.4 },
      )
      const [, arc_a, arc_a1, arc_a1a] = arcs
      expect(arc_a.color).toBe(`#1f77b4`) // explicit, untouched
      // lightness strictly increases with depth
      expect(hsl(arc_a1.color).l).toBeGreaterThan(hsl(arc_a.color).l)
      expect(hsl(arc_a1a.color).l).toBeGreaterThan(hsl(arc_a1.color).l)
      expect(arc_a1.color).toMatch(/^#[0-9a-f]{6}$/)
    })
  })

  test(`degenerate inputs: empty, single node, zero values`, () => {
    expect(compute_sunburst_layout([])).toEqual({ arcs: [], root: null, max_depth: 0 })

    const single = compute_sunburst_layout({ label: `only`, value: 3 })
    expect(single.max_depth).toBe(0)
    expect(single.arcs).toMatchObject([{ value: 3 }]) // leaf-sum: root is itself a leaf

    const zeros = compute_sunburst_layout([
      { label: `A`, value: 0 },
      { label: `B`, value: 0 },
    ])
    for (const arc of zeros.arcs) {
      // zero-value subtrees collapse to zero width without NaN
      expect([arc.x0, arc.x1, arc.fraction].some(Number.isNaN)).toBe(false)
      expect(arc.fraction).toBe(0)
    }
  })

  test(`does not mutate the input data; metadata carried through`, () => {
    const data: SunburstNode<{ num: number }>[] = [
      { label: `A`, children: [{ label: `A1`, value: 4, metadata: { num: 42 } }] },
    ]
    const { arcs } = compute_sunburst_layout(data)
    expect(arcs[2].metadata).toEqual({ num: 42 })
    for (const key of [`x0`, `value`, `id`]) expect(data[0]).not.toHaveProperty(key)
    expect(data[0].children?.[0]).toEqual({ label: `A1`, value: 4, metadata: { num: 42 } })
  })
})

describe(`sunburst_from_paths`, () => {
  test(`builds a nested tree from path rows that round-trips through the layout`, () => {
    const roots = sunburst_from_paths([
      { path: [`cubic`, `225`], value: 12 },
      { path: [`cubic`, `221`], value: 3 },
      { path: [`hexagonal`, `194`], value: 5 },
    ])
    expect(roots).toMatchObject([
      {
        id: `cubic`,
        children: [
          { id: `cubic/225`, value: 12 },
          { id: `cubic/221`, value: 3 },
        ],
      },
      { id: `hexagonal`, children: [{ id: `hexagonal/194`, value: 5 }] },
    ])
    const { root, arcs } = compute_sunburst_layout(roots)
    expect(root?.value).toBe(20)
    expect(arcs.filter((arc) => arc.depth === 2)).toHaveLength(3)
  })

  test(`duplicate full paths accumulate; prefix rows set interior values`, () => {
    const dup = sunburst_from_paths([
      { path: [`a`, `b`], value: 1 },
      { path: [`a`, `b`], value: 2 },
    ])
    expect(dup[0].children?.[0].value).toBe(3)

    // interior values are meaningful with value_mode 'total'/'remainder'
    const prefix = sunburst_from_paths([
      { path: [`a`], value: 10 },
      { path: [`a`, `b`], value: 3 },
    ])
    expect(prefix).toMatchObject([{ value: 10, children: [{ value: 3 }] }])
    expect(compute_sunburst_layout(prefix, { value_mode: `total` }).root?.value).toBe(10)
  })

  test(`color/metadata attach to the terminal node only; empty path throws`, () => {
    const roots = sunburst_from_paths([
      { path: [`a`, `b`], value: 1, color: `teal`, metadata: { tag: `x` } },
    ])
    expect(roots[0].children?.[0]).toMatchObject({ color: `teal`, metadata: { tag: `x` } })
    expect(roots[0].color).toBeUndefined()
    expect(() => sunburst_from_paths([{ path: [], value: 1 }])).toThrow(/empty path/)
  })
})

describe(`sunburst_from_labels_parents`, () => {
  const from_lp = sunburst_from_labels_parents // shorthand for the error table below

  test(`builds a tree from plotly trace arrays (matbench/pymatviz export style)`, () => {
    const roots = sunburst_from_labels_parents(
      [`triclinic`, `1`, `2`, `cubic`, `225`],
      [``, `triclinic`, `triclinic`, ``, `cubic`],
      [10, 4, 6, 12, 12],
      { ids: [`triclinic`, `triclinic/1`, `triclinic/2`, `cubic`, `cubic/225`] },
    )
    expect(roots).toMatchObject([
      { id: `triclinic`, children: [{ id: `triclinic/1` }, { id: `triclinic/2` }] },
      { id: `cubic`, children: [{ id: `cubic/225` }] },
    ])
    // pairs with value_mode 'total' like plotly branchvalues='total'
    const { root, arcs } = compute_sunburst_layout(roots, { value_mode: `total` })
    expect(root?.value).toBe(22)
    expect(arcs.find((arc) => arc.id === `cubic`)?.value).toBe(12)
  })

  test(`labels work as keys when no ids given; null/undefined parents mark roots`, () => {
    const roots = sunburst_from_labels_parents([`a`, `b`], [``, `a`], [1, 1])
    expect(roots).toMatchObject([{ label: `a`, children: [{ label: `b` }] }])
    expect(sunburst_from_labels_parents([`a`, `b`], [null, undefined])).toHaveLength(2)
  })

  test.each([
    [`parents length mismatch`, () => from_lp([`a`, `b`], [``]), /equal length/],
    [`values length mismatch`, () => from_lp([`a`], [``], [1, 2]), /equal length/],
    [
      `ids length mismatch`,
      () => from_lp([`a`], [``], [1], { ids: [`x`, `y`] }),
      /equal length/,
    ],
    [`dup labels`, () => from_lp([`a`, `a`], [``, ``]), /duplicate node label "a".*opts\.ids/],
    [
      `dup ids`,
      () => from_lp([`a`, `b`], [``, ``], [1, 1], { ids: [`x`, `x`] }),
      /duplicate node id "x"/,
    ],
    [`unknown parent`, () => from_lp([`a`], [`ghost`]), /unknown parent "ghost"/],
    [`cycle`, () => from_lp([`a`, `b`], [`b`, `a`]), /cycle/],
  ])(`throws on %s`, (_desc, call, regex) => {
    expect(call).toThrow(regex)
  })
})

describe(`min_fraction 'Other' bucketing`, () => {
  // one big slice + s3 above threshold + 2 slivers (3% each) that get bucketed
  const long_tail: SunburstNode[] = [
    { label: `big`, value: 82 },
    { label: `s1`, value: 3 },
    { label: `s2`, value: 3 },
    { label: `s3`, value: 12 },
  ]

  test(`merges sub-threshold siblings into one contiguous trailing Other leaf`, () => {
    const { arcs } = compute_sunburst_layout(long_tail, { min_fraction: 0.05 })
    expect(arcs.map((arc) => arc.label)).toEqual([undefined, `big`, `s3`, `Other`])
    expect(arcs[3]).toMatchObject({
      is_other: true,
      is_leaf: true,
      value: 6,
      id: `Other`,
      path: [`Other`],
      fraction: close(0.06),
      x0: close(0.94), // smalls were reordered to the end -> contiguous trailing run
      x1: close(1),
    })
  })

  test(`does not bucket a single small sibling; min_fraction 0 disables`, () => {
    const two = [
      { label: `big`, value: 95 },
      { label: `tiny`, value: 5 },
    ]
    const { arcs } = compute_sunburst_layout(two, { min_fraction: 0.06 })
    expect(arcs.map((arc) => arc.label)).toEqual([undefined, `big`, `tiny`])

    const off = compute_sunburst_layout(long_tail, { min_fraction: 0 })
    expect(off.arcs).toHaveLength(5)
    expect(off.arcs.some((arc) => arc.is_other)).toBe(false)
  })

  test(`buckets per parent with custom label and inherited color`, () => {
    const children = [
      { label: `keep`, value: 60 },
      { label: `tiny1`, value: 1 },
      { label: `tiny2`, value: 1 },
    ]
    const { arcs } = compute_sunburst_layout([{ label: `P`, color: `teal`, children }], {
      min_fraction: 0.05,
      other_label: `rest`,
    })
    expect(arcs.find((arc) => arc.is_other)).toMatchObject({
      label: `rest`,
      id: `P/rest`,
      parent_idx: 1, // child of P
      color: `teal`, // inherits parent chain color
      label_path: [`P`, `rest`],
    })
  })

  test(`drops descendants of bucketed small branches`, () => {
    // s1 (3) and s2 (4) fall below 0.05 * 97 = 4.85 -> bucketed; s1's child must vanish
    const { arcs } = compute_sunburst_layout(
      [
        { label: `big`, value: 90 },
        { label: `s1`, children: [{ label: `s1a`, value: 3 }] },
        { label: `s2`, value: 4 },
      ],
      { min_fraction: 0.05 },
    )
    expect(arcs.map((arc) => arc.label)).toEqual([undefined, `big`, `Other`])
    expect(arcs[2]).toMatchObject({ is_other: true, is_leaf: true, value: 7 })
  })

  test(`composes with sort descending (smalls still trail)`, () => {
    const opts = { min_fraction: 0.05, sort: `descending` } as const
    const { arcs } = compute_sunburst_layout(long_tail, opts)
    const depth1 = arcs.filter((arc) => arc.depth === 1)
    depth1.sort((arc_a, arc_b) => arc_a.x0 - arc_b.x0)
    expect(depth1.map((arc) => arc.label)).toEqual([`big`, `s3`, `Other`])
  })
})

describe(`scale`, () => {
  test(`handles a wide tree with 10k leaves`, () => {
    const wide: SunburstNode[] = Array.from({ length: 100 }, (_branch_el, branch) => ({
      label: `branch-${branch}`,
      children: Array.from({ length: 100 }, (_leaf_el, leaf) => ({
        label: `leaf-${branch}-${leaf}`,
        value: 1 + ((branch + leaf) % 7),
      })),
    }))
    const { arcs, root, max_depth } = compute_sunburst_layout(wide)
    expect(arcs).toHaveLength(1 + 100 + 100 * 100)
    expect(max_depth).toBe(2)
    expect(arcs.at(-1)?.x1).toBeCloseTo(1, 9)
    expect(root?.subtree_end).toBe(arcs.length - 1)
  })

  test(`resolves a 10k-node parent chain quickly; detects a buried cycle`, () => {
    // a single deep chain is the worst case for naive per-node walk-up cycle
    // detection (quadratic); the shared-prefix marking makes it linear
    const n_nodes = 10_000
    const labels = Array.from({ length: n_nodes }, (_, idx) => `node-${idx}`)
    const parents = labels.map((_, idx) => (idx === 0 ? `` : `node-${idx - 1}`))
    const roots = sunburst_from_labels_parents(labels, parents)
    expect(roots).toHaveLength(1)
    let [depth, node] = [0, roots[0]]
    while (node.children?.length) [depth, node] = [depth + 1, node.children[0]]
    expect(depth).toBe(n_nodes - 1)

    parents[2500] = `node-2501` // splice a 2-cycle into the middle
    expect(() => sunburst_from_labels_parents(labels, parents)).toThrow(/cycle/)
  })
})
