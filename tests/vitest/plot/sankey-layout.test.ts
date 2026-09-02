import type { SankeyData } from '$lib/plot'
import { compute_sankey_layout, sankey_from_links } from '$lib/plot'
import { sankey as d3_sankey, sankeyJustify } from 'd3-sankey'
import { describe, expect, test, vi } from 'vitest'

// Simple two-column graph: A->C (1), B->C (2). C value = 1 + 2 = 3.
const tri: SankeyData = {
  nodes: [{ label: `A` }, { label: `B` }, { label: `C` }],
  links: [
    { source: 0, target: 2, value: 1 },
    { source: 1, target: 2, value: 2 },
  ],
}

const dims = { width: 400, height: 300, node_width: 20, node_padding: 10 }

describe(`compute_sankey_layout`, () => {
  test(`assigns columns/depths and conserves node values`, () => {
    const { nodes, links } = compute_sankey_layout(tri, dims)
    expect(nodes).toHaveLength(3)
    expect(links).toHaveLength(2)

    const [a, b, c] = nodes
    expect(a.depth).toBe(0)
    expect(b.depth).toBe(0)
    expect(c.depth).toBe(1)
    // node.value = max(sum incoming, sum outgoing)
    expect(a.value).toBe(1)
    expect(b.value).toBe(2)
    expect(c.value).toBe(3)
  })

  test(`node boxes and link ribbons match a raw d3-sankey layout to 1e-9`, () => {
    // A and B stack in column 0 (400px wide, 20px nodes), C fills column 1. With
    // padding 10 the busiest column (A + B) spans the full 300px height.
    const { nodes, links } = compute_sankey_layout(tri, dims)
    const reference = d3_sankey<{ idx: number }, object>()
      .nodeId((node) => node.idx)
      .nodeWidth(dims.node_width)
      .nodePadding(dims.node_padding)
      .nodeAlign(sankeyJustify)
      .iterations(6)
      .extent([
        [0, 0],
        [dims.width, dims.height],
      ])({
      nodes: tri.nodes.map((_, idx) => ({ idx })),
      links: tri.links.map((link) => ({ ...link })),
    })
    nodes.forEach((node, idx) => {
      const ref = reference.nodes[idx]
      for (const key of [`x0`, `x1`, `y0`, `y1`] as const) {
        expect(node[key], `${node.label}.${key}`).toBeCloseTo(ref[key] ?? Number.NaN, 9)
      }
    })
    links.forEach((link, idx) => {
      const ref = reference.links[idx]
      expect(link.width).toBeCloseTo(ref.width ?? Number.NaN, 9)
      expect(link.y0).toBeCloseTo(ref.y0 ?? Number.NaN, 9)
      expect(link.y1).toBeCloseTo(ref.y1 ?? Number.NaN, 9)
    })
    // hand-checked geometry: columns at x = 0 and 380; A (1/3 of the 290px left after
    // one padding gap) sits on top of B, which ends at the bottom edge
    const [a, b, c] = nodes
    expect([a.x0, a.x1, c.x0, c.x1]).toEqual([0, 20, 380, 400])
    expect([a.y0, a.y1, b.y0, b.y1]).toEqual(
      [0, 290 / 3, 290 / 3 + 10, 300].map((val) => expect.closeTo(val, 9)),
    )
    // ribbons run from the source's right edge to the target's left edge with the
    // bezier control points halfway between the columns
    expect(links[0].mid.x).toBe(200)
    expect(links[0].path).toMatch(
      /^M20,(?<y0>[\d.]+)C200,\k<y0> 200,(?<y1>[\d.]+) 380,\k<y1>$/,
    )
  })

  test(`column heights respect d3 value scaling`, () => {
    const { nodes } = compute_sankey_layout(tri, dims)
    const [a, b, c] = nodes
    const [a_h, b_h, c_h] = [a.y1 - a.y0, b.y1 - b.y0, c.y1 - c.y0]
    // busiest column (A + B + one padding gap) fills the full height; d3 scales all
    // columns by that limiting factor, so the lone node C does NOT fill the height
    expect(a_h + b_h + dims.node_padding).toBeCloseTo(dims.height, 6)
    // C.value == A.value + B.value at the same scale -> C height == A + B heights
    expect(c_h).toBeCloseTo(a_h + b_h, 6)
    // heights proportional to value (B twice A)
    expect(b_h / a_h).toBeCloseTo(2, 6)
  })

  test(`link widths are positive and conserve flow into a node`, () => {
    const { nodes, links } = compute_sankey_layout(tri, dims)
    for (const link of links) {
      expect(link.width).toBeGreaterThan(0)
      expect(link.path.startsWith(`M`)).toBe(true)
    }
    // C receives both links: sum of incoming widths == C box height
    const c_height = nodes[2].y1 - nodes[2].y0
    const incoming = links.reduce((sum, link) => sum + link.width, 0)
    expect(incoming).toBeCloseTo(c_height, 6)
    // widths proportional to value (B link is twice the A link)
    const [w_a, w_b] = links.map((link) => link.width)
    expect(w_b / w_a).toBeCloseTo(2, 6)
  })

  test(`horizontal places source left of target; vertical places it above`, () => {
    const horiz = compute_sankey_layout(tri, { ...dims, orientation: `horizontal` })
    expect(horiz.nodes[0].x0).toBeLessThan(horiz.nodes[2].x0)
    // same depth (col 0) -> same x band
    expect(horiz.nodes[0].x0).toBeCloseTo(horiz.nodes[1].x0, 6)

    const vert = compute_sankey_layout(tri, { ...dims, orientation: `vertical` })
    expect(vert.nodes[0].y0).toBeLessThan(vert.nodes[2].y0)
    expect(vert.nodes[0].y0).toBeCloseTo(vert.nodes[1].y0, 6)
    // vertical nodes still contained within screen-space extent
    for (const node of vert.nodes) {
      expect(node.x1).toBeLessThanOrEqual(dims.width + 1e-6)
      expect(node.y1).toBeLessThanOrEqual(dims.height + 1e-6)
    }
  })

  test(`resolves links by string node id`, () => {
    const data: SankeyData = {
      nodes: [
        { id: `a`, label: `A` },
        { id: `b`, label: `B` },
      ],
      links: [{ source: `a`, target: `b`, value: 5 }],
    }
    const { nodes, links } = compute_sankey_layout(data, dims)
    expect(links[0].source.id).toBe(`a`)
    expect(links[0].target.id).toBe(`b`)
    expect(nodes[1].value).toBe(5)
  })

  test(`resolves non-index numeric node ids by id before index fallback`, () => {
    const data: SankeyData = {
      nodes: [
        { id: 10, label: `A` },
        { id: 20, label: `B` },
      ],
      links: [{ source: 10, target: 20, value: 5 }],
    }
    const { links } = compute_sankey_layout(data, dims)
    expect(links[0].source.node_idx).toBe(0)
    expect(links[0].target.node_idx).toBe(1)
  })

  test(`resolves links by node label when no explicit id is set`, () => {
    const data: SankeyData = {
      nodes: [{ label: `Coal` }, { label: `Grid` }],
      links: [{ source: `Coal`, target: `Grid`, value: 7 }],
    }
    const { nodes, links } = compute_sankey_layout(data, dims)
    expect(links[0].source.label).toBe(`Coal`)
    expect(links[0].target.label).toBe(`Grid`)
    expect(nodes[1].value).toBe(7)
  })

  test.each([
    [
      { nodes: [], links: [] },
      { width: 0, height: 0 },
    ],
    [tri, { width: 0, height: 0 }], // valid data but zero size -> empty
    // all-zero link values would divide by zero in d3-sankey (NaN ribbon paths)
    [
      {
        nodes: [{ label: `A` }, { label: `B` }],
        links: [{ source: 0, target: 1, value: 0 }],
      },
      dims,
    ],
  ])(`returns empty layout for degenerate input %#`, (data, size) => {
    expect(compute_sankey_layout(data, size).nodes).toEqual([])
  })

  test(`a zero-value link among positive links keeps the layout finite`, () => {
    const data: SankeyData = {
      nodes: [{ label: `A` }, { label: `B` }, { label: `C` }],
      links: [
        { source: 0, target: 2, value: 1 },
        { source: 1, target: 2, value: 0 },
      ],
    }
    const { nodes, links } = compute_sankey_layout(data, dims)
    expect(nodes).toHaveLength(3)
    expect(nodes.every((nd) => Number.isFinite(nd.y0) && Number.isFinite(nd.y1))).toBe(true)
    for (const link of links) expect(link.path).not.toContain(`NaN`)
  })

  // The all-zero guard above covers the whole graph being empty, but one bad row in an
  // otherwise valid graph reached d3 unchecked: a non-finite value poisoned every coordinate
  // in the layout (`d="M24,NaN..."`), and a negative one produced an invalid negative
  // stroke-width and silently subtracted from its source node's total, so that node's box
  // understated its own outflow. Every sibling chart already screens its inputs.
  test.each([
    [`NaN`, NaN],
    [`undefined`, undefined],
    [`negative`, -5],
  ])(`rejects a %s link value instead of emitting a broken layout`, (_case, bad_value) => {
    const data = {
      nodes: [{ id: `A` }, { id: `B` }, { id: `C` }],
      links: [
        { source: `A`, target: `B`, value: 10 },
        { source: `A`, target: `C`, value: bad_value as number },
      ],
    } as SankeyData
    expect(() => compute_sankey_layout(data, dims)).toThrow(/non-negative finite value/)
  })

  // zero stays legal: it is the documented all-zero-collapses-to-empty case, not bad input
  test(`accepts a zero-valued link alongside a real one`, () => {
    const data: SankeyData = {
      nodes: [{ id: `A` }, { id: `B` }, { id: `C` }],
      links: [
        { source: `A`, target: `B`, value: 10 },
        { source: `A`, target: `C`, value: 0 },
      ],
    }
    const { links } = compute_sankey_layout(data, dims)
    for (const link of links) expect(link.path).not.toContain(`NaN`)
  })

  test(`drops link-less nodes so extra labels don't pile up below the plot`, () => {
    // orphan nodes (extra labels with no links) used to get value 0 / zero height yet
    // still stack with node_padding each, overflowing past the plot bottom edge
    const data: SankeyData = {
      nodes: [
        { label: `A` },
        { label: `B` },
        ...Array.from({ length: 20 }, (_, idx) => ({ label: `orphan-${idx}` })),
      ],
      links: [{ source: 0, target: 1, value: 5 }],
    }
    const { nodes } = compute_sankey_layout(data, dims)
    expect(nodes.map((nd) => nd.label)).toEqual([`A`, `B`])
    for (const node of nodes) {
      expect(node.y0).toBeGreaterThanOrEqual(-1e-6)
      expect(node.y1).toBeLessThanOrEqual(dims.height + 1e-6)
    }
  })

  test(`keeps node_idx stable when a link-less node sits between linked nodes`, () => {
    // dropping the middle orphan must not shift indices: colors/metadata in the
    // component are keyed by the original node_idx, and links resolve by it too
    const data: SankeyData = {
      nodes: [{ label: `A` }, { label: `gap` }, { label: `B` }],
      links: [{ source: 0, target: 2, value: 3 }], // skips node 1
    }
    const { nodes, links } = compute_sankey_layout(data, dims)
    expect(nodes.map((nd) => nd.node_idx)).toEqual([0, 2])
    expect(links[0].source.node_idx).toBe(0)
    expect(links[0].target.node_idx).toBe(2)
  })

  test(`warns when node labels collide and no ids are set`, () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const data: SankeyData = {
      nodes: [{ label: `A` }, { label: `A` }, { label: `B` }],
      links: [{ source: `A`, target: `B`, value: 1 }],
    }
    const { links } = compute_sankey_layout(data, dims)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/duplicate node label "A"/))
    // last occurrence wins -> source resolves to node index 1
    expect(links[0].source.node_idx).toBe(1)
    warn.mockRestore()
  })

  test(`throws on unknown node reference`, () => {
    const data: SankeyData = {
      nodes: [{ label: `A` }],
      links: [{ source: 0, target: 9, value: 1 }],
    }
    expect(() => compute_sankey_layout(data, dims)).toThrow(/unknown node/)
  })

  test.each([
    [
      `2-cycle`,
      [
        [0, 1],
        [1, 0],
      ],
      `A -> B -> A`,
    ],
    [`self loop`, [[0, 0]], `A -> A`],
    // the cycle is buried behind an acyclic prefix and named from its entry node
    [
      `3-cycle behind a chain`,
      [
        [3, 0],
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      `A -> B -> C -> A`,
    ],
  ] as const)(`names the offending nodes of a %s`, (_desc, edges, cycle) => {
    const data: SankeyData = {
      nodes: [`A`, `B`, `C`, `D`].map((label) => ({ label })),
      links: edges.map(([source, target]) => ({ source, target, value: 1 })),
    }
    expect(() => compute_sankey_layout(data, dims)).toThrow(
      `Sankey: links must form a DAG but contain the cycle ${cycle}`,
    )
  })

  test(`does not mutate the input data`, () => {
    const data: SankeyData = {
      nodes: [{ label: `A` }, { label: `B` }],
      links: [{ source: 0, target: 1, value: 3 }],
    }
    compute_sankey_layout(data, dims)
    // link.source stays the original index, not replaced by a node object
    expect(data.links[0].source).toBe(0)
    expect(data.nodes[0]).not.toHaveProperty(`x0`)
  })
})

describe(`sankey_from_links`, () => {
  test(`builds nodes + links from flat arrays`, () => {
    const data = sankey_from_links([0, 1], [2, 2], [10, 20], [`A`, `B`, `C`])
    expect(data.nodes).toHaveLength(3)
    expect(data.nodes.map((node) => node.label)).toEqual([`A`, `B`, `C`])
    expect(data.links).toEqual([
      { source: 0, target: 2, value: 10 },
      { source: 1, target: 2, value: 20 },
    ])
  })

  test(`infers node count from indices when labels omitted`, () => {
    const data = sankey_from_links([0, 1, 2], [3, 3, 3], [1, 1, 1])
    expect(data.nodes).toHaveLength(4)
  })

  test(`covers all indexed nodes when labels are too short`, () => {
    // labels only cover indices 0..1 but links reference index 2
    const data = sankey_from_links([0, 1], [2, 2], [10, 20], [`A`, `B`])
    expect(data.nodes).toHaveLength(3)
    expect(data.nodes.map((node) => node.label)).toEqual([`A`, `B`, `2`])
    // the layout resolves the highest-indexed link: node 2 collects both inflows
    const { nodes } = compute_sankey_layout(data, dims)
    expect(nodes.map((nd) => [nd.label, nd.value])).toEqual([
      [`A`, 10],
      [`B`, 20],
      [`2`, 30],
    ])
  })

  test(`surplus labels beyond linked indices are dropped by the layout`, () => {
    // builder pads nodes up to labels.length; the extras are orphans (no links) that
    // compute_sankey_layout must drop, else they pile up/overflow below the plot
    const data = sankey_from_links([0], [1], [5], [`A`, `B`, `extra1`, `extra2`])
    expect(data.nodes).toHaveLength(4) // builder keeps every label
    expect(compute_sankey_layout(data, dims).nodes.map((nd) => nd.label)).toEqual([`A`, `B`])
  })

  test.each([
    [[0, 1], [2], [1, 2]],
    [[0], [1], [1, 2]],
  ])(`throws on mismatched array lengths %#`, (source, target, value) => {
    expect(() => sankey_from_links(source, target, value)).toThrow(/equal length/)
  })

  test(`handles very large index arrays without an argument-count overflow`, () => {
    // single-pass max scan must not spread huge arrays into Math.max(...)
    const count = 200_000
    const source = Array.from({ length: count }, (_, idx) => idx)
    const target = Array.from({ length: count }, () => count)
    const value = Array.from({ length: count }, () => 1)
    const data = sankey_from_links(source, target, value)
    expect(data.nodes).toHaveLength(count + 1) // indices 0..count
    expect(data.links).toHaveLength(count)
  })
})
