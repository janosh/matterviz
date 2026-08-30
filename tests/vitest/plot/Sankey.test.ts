import { Sankey } from '$lib'
import { plot_color } from '$lib/colors'
import type { SankeyData, SankeyLinkHandlerProps, SankeyNodeHandlerProps } from '$lib/plot'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bucket_sankey_data } from '$lib/plot/sankey/sankey'
import { mount_sized } from '../setup'

const data: SankeyData = {
  nodes: [
    { label: `A`, color: `#e15759` },
    { label: `B`, color: `#4e79a7` },
    { label: `C`, color: `#59a14f` },
    { label: `D` },
  ],
  links: [
    { source: 0, target: 2, value: 8 },
    { source: 1, target: 2, value: 4 },
    { source: 2, target: 3, value: 12 },
  ],
}

const mount_sized_sankey = (
  props: Partial<ComponentProps<typeof Sankey>>,
): Promise<HTMLElement> =>
  mount_sized(Sankey, props, { selector: `.sankey`, width: 500, height: 360 })

describe(`Sankey`, () => {
  test.each([`horizontal`, `vertical`] as const)(
    `renders one rect per node and one path per link (%s)`,
    async (orientation) => {
      const plot = await mount_sized_sankey({ data, orientation })
      expect(plot.querySelectorAll(`.nodes rect`)).toHaveLength(data.nodes.length)
      expect(plot.querySelectorAll(`.links path`)).toHaveLength(data.links.length)
    },
  )

  test.each([
    [true, data.nodes.length],
    [false, 0],
  ])(`show_node_labels=%s renders %i labels`, async (show_node_labels, n_labels) => {
    const plot = await mount_sized_sankey({ data, show_node_labels })
    expect(plot.querySelectorAll(`.node-label`)).toHaveLength(n_labels)
  })

  test(`a cyclic graph renders the error naming the cycle instead of a diagram`, async () => {
    const plot = await mount_sized_sankey({
      data: {
        nodes: [{ label: `A` }, { label: `B` }],
        links: [
          { source: 0, target: 1, value: 1 },
          { source: 1, target: 0, value: 1 },
        ],
      },
    })
    expect(plot.querySelector(`.status-message.error`)?.textContent).toContain(
      `cycle A -> B -> A`,
    )
    expect(plot.querySelectorAll(`.nodes rect`)).toHaveLength(0)
  })

  test(`uses explicit node colors and cycles palette for the rest`, async () => {
    const plot = await mount_sized_sankey({ data })
    const fills = [...plot.querySelectorAll(`.nodes rect`)].map((rect) =>
      rect.getAttribute(`fill`),
    )
    expect(fills[0]).toBe(`#e15759`)
    expect(fills[1]).toBe(`#4e79a7`)
    expect(fills[2]).toBe(`#59a14f`)
    expect(fills[3]).toBe(plot_color(3)) // palette fallback indexed by node position
  })

  test(`gradient mode emits one linearGradient per link`, async () => {
    const plot = await mount_sized_sankey({ data, link_color_mode: `gradient` })
    expect(plot.querySelectorAll(`linearGradient`)).toHaveLength(data.links.length)
    const first_path = plot.querySelector(`.links path`)
    expect(first_path?.getAttribute(`stroke`)?.startsWith(`url(#`)).toBe(true)
  })

  test(`hovering a node then a link swaps the tooltip and fires each callback once`, async () => {
    const [on_node_hover, on_link_hover] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_sankey({ data, on_node_hover, on_link_hover })
    const rect = plot.querySelector<SVGRectElement>(`.nodes rect`)
    const hover = (el: Element | null, x = 0, y = 0) => {
      el?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX: x, clientY: y }))
      return tick()
    }
    await hover(rect, 30, 40)
    const tooltip = () => plot.querySelector<HTMLElement>(`.plot-tooltip`)
    expect(tooltip()?.textContent).toMatch(/A.*8/)
    // Anchored at the cursor, constrained to the 500x360 chart. `avoid_cursor`
    // widens the 10px x offset to the pointer glyph's width so the tooltip abuts
    // the cursor instead of starting under it; y keeps its 5px offset.
    expect([tooltip()?.style.left, tooltip()?.style.top]).toEqual([`48px`, `45px`])
    expect(on_node_hover).toHaveBeenCalledOnce()
    expect(on_node_hover.mock.calls[0][0] as SankeyNodeHandlerProps).toMatchObject({
      type: `node`,
      label: `A`,
      value: 8,
      color: `#e15759`,
    })
    // moving within the same node only moves the chip, no second callback
    await hover(rect, 35, 40)
    expect(on_node_hover).toHaveBeenCalledOnce()
    // a cursor near the right edge flips the chip to the left of the anchor
    await hover(rect, 490, 40)
    expect(tooltip()?.style.left).toBe(`332px`) // 490 - 18 - 140 (flipped left)

    await hover(plot.querySelector(`.links path`), 200, 100)
    expect(on_node_hover).toHaveBeenLastCalledWith(null)
    expect(on_link_hover).toHaveBeenCalledOnce()
    expect(on_link_hover.mock.calls[0][0] as SankeyLinkHandlerProps).toMatchObject({
      type: `link`,
      source_label: `A`,
      target_label: `C`,
      value: 8,
    })
    expect(tooltip()?.textContent).toMatch(/A\s*→\s*C.*8/)
    // back onto the node: the link callback clears, the node callback re-fires
    await hover(rect, 30, 40)
    expect(on_link_hover).toHaveBeenLastCalledWith(null)
    expect(on_node_hover).toHaveBeenCalledTimes(3)
    expect(tooltip()?.textContent).toMatch(/A.*8/)
    // leaving the svg clears everything once
    plot.querySelector(`svg[role="application"]`)?.dispatchEvent(new MouseEvent(`mouseleave`))
    await tick()
    expect(tooltip()).toBeNull()
    expect(on_node_hover).toHaveBeenLastCalledWith(null)
    expect([on_node_hover.mock.calls.length, on_link_hover.mock.calls.length]).toEqual([4, 2])
  })

  test(`click handlers make marks focusable buttons and fire with node/link props`, async () => {
    const [on_node_click, on_link_click] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_sankey({ data, on_node_click, on_link_click })
    const rect = plot.querySelector<SVGRectElement>(`.nodes rect`)
    const path = plot.querySelector<SVGPathElement>(`.links path`)
    for (const mark of [rect, path]) {
      expect(mark?.getAttribute(`role`)).toBe(`button`)
      expect(mark?.getAttribute(`tabindex`)).toBe(`0`)
    }
    expect(rect?.getAttribute(`aria-label`)).toBe(`A: 8`)
    expect(path?.getAttribute(`aria-label`)).toBe(`flow A to C: 8`)

    rect?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_node_click.mock.calls[0][0] as SankeyNodeHandlerProps).toMatchObject({
      type: `node`,
      node_idx: 0,
      label: `A`,
      value: 8,
      color: `#e15759`,
    })
    // Enter/Space on a focused mark activates it like a click; other keys are ignored
    rect?.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    rect?.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Tab`, bubbles: true }))
    await tick()
    expect(on_node_click).toHaveBeenCalledTimes(2)

    path?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(on_link_click).toHaveBeenCalledOnce()
    expect(on_link_click.mock.calls[0][0] as SankeyLinkHandlerProps).toMatchObject({
      type: `link`,
      source_label: `A`,
      target_label: `C`,
      value: 8,
    })
  })

  test(`marks are not focusable buttons without click handlers`, async () => {
    const plot = await mount_sized_sankey({ data })
    for (const mark of [
      plot.querySelector(`.nodes rect`),
      plot.querySelector(`.links path`),
    ]) {
      expect(mark?.hasAttribute(`role`)).toBe(false)
      expect(mark?.hasAttribute(`tabindex`)).toBe(false)
      expect(mark?.hasAttribute(`aria-label`)).toBe(false)
    }
  })

  test(`dims toggled node and its links via legend`, async () => {
    // toggling a legend item mutes that node (dimmed, not removed) and its connected links.
    // fixture nodes omit `id`; the layout backfills id = index, so muting keys consistently
    const plot = await mount_sized_sankey({ data, show_legend: true })
    const dim_nodes = () =>
      [...plot.querySelectorAll<SVGGElement>(`.node`)]
        .filter((node_g) => node_g.style.opacity === `0.12`)
        .map((node_g) => node_g.querySelector(`.node-label`)?.textContent?.trim())
    const dim_links = () =>
      [...plot.querySelectorAll(`.links path`)].filter(
        (path) => Number(path.getAttribute(`stroke-opacity`)) < 0.2,
      ).length

    expect(dim_nodes()).toEqual([])
    expect(dim_links()).toBe(0)

    plot.querySelector<HTMLElement>(`.legend-item`)?.click() // toggle first node (A)
    await tick()
    expect(dim_nodes()).toEqual([`A`]) // node A dimmed
    expect(dim_links()).toBe(1) // its single link (A->C) dimmed

    plot.querySelector<HTMLElement>(`.legend-item`)?.click() // re-click restores
    await tick()
    expect(dim_nodes()).toEqual([])
    expect(dim_links()).toBe(0)
  })

  test(`orphan-only nodes do not open an empty legend`, async () => {
    const plot = await mount_sized_sankey({
      data: {
        nodes: [{ label: `orphan-a` }, { label: `orphan-b` }],
        links: [],
      },
      show_legend: true,
    })
    expect(plot.querySelector(`.legend`)).toBeNull()
  })

  test.each([
    { data: { nodes: [], links: [] } },
    { data: { nodes: [{ label: `solo` }], links: [] } },
  ])(`renders without error for empty/degenerate data %#`, async (props) => {
    const plot = await mount_sized_sankey(props)
    expect(plot.querySelectorAll(`.links path`)).toHaveLength(0)
  })
})

describe(`bucket_sankey_data`, () => {
  // One big flow plus a long tail of small terminal ones - the shape this exists for
  const tail = {
    nodes: [{ id: `src` }, { id: `big` }, { id: `a` }, { id: `b` }, { id: `c` }],
    links: [
      { source: `src`, target: `big`, value: 90 },
      { source: `src`, target: `a`, value: 4 },
      { source: `src`, target: `b`, value: 3 },
      { source: `src`, target: `c`, value: 3 },
    ],
  }

  test(`folds the small terminal tail into one Other link`, () => {
    const { nodes, links } = bucket_sankey_data(tail, { min_fraction: 0.05 })
    expect(links.map((link) => [link.source, link.target, link.value])).toEqual([
      [`src`, `big`, 90],
      [`src`, `src/Other`, 10],
    ])
    // The folded targets are gone, replaced by one bucket node
    expect(nodes.map((node) => node.id)).toEqual([`src`, `big`, `src/Other`])
  })

  test.each([
    [`threshold below every link`, { min_fraction: 0.01 }, 4],
    [`max_links keeps the largest`, { max_links: 2 }, 3],
    [`disabled by default`, {}, 4],
  ])(`%s -> %i links`, (_name, opts, expected) => {
    expect(bucket_sankey_data(tail, opts).links).toHaveLength(expected)
  })

  // A bucket of one is just that link renamed, so it is left alone
  test(`a single qualifying link is not bucketed`, () => {
    const one_small = {
      nodes: [{ id: `src` }, { id: `big` }, { id: `a` }],
      links: [
        { source: `src`, target: `big`, value: 99 },
        { source: `src`, target: `a`, value: 1 },
      ],
    }
    expect(bucket_sankey_data(one_small, { min_fraction: 0.1 })).toBe(one_small)
  })

  // Folding a target that carries flow onward would delete that flow from the diagram
  test(`never folds a link whose target has outgoing flow`, () => {
    const passthrough = {
      nodes: [{ id: `src` }, { id: `big` }, { id: `mid` }, { id: `sink` }, { id: `t` }],
      links: [
        { source: `src`, target: `big`, value: 90 },
        { source: `src`, target: `mid`, value: 5 },
        { source: `mid`, target: `sink`, value: 5 },
        { source: `src`, target: `t`, value: 5 },
      ],
    }
    const { links } = bucket_sankey_data(passthrough, { min_fraction: 0.5 })
    // `mid` survives (it has downstream flow); only one terminal link qualifies, so
    // the >= 2 rule leaves the graph untouched rather than bucketing `t` alone
    expect(links).toEqual(passthrough.links)
  })

  // `max_links` bounds the links kept under their own name, not the total drawn: the
  // bucket is additional, and a non-terminal overflow link cannot be folded away at all.
  // Same contract as `max_children` on the hierarchy charts.
  test.each([
    [
      `bucket is additional to the kept links`,
      [
        { source: `src`, target: `a`, value: 5 },
        { source: `src`, target: `b`, value: 4 },
        { source: `src`, target: `c`, value: 3 },
        { source: `src`, target: `d`, value: 2 },
        { source: `src`, target: `e`, value: 1 },
      ],
      4,
    ], // 3 kept + 1 bucket
    [
      `non-terminal overflow is kept under its own name`,
      [
        { source: `src`, target: `a`, value: 5 },
        { source: `src`, target: `b`, value: 4 },
        { source: `src`, target: `c`, value: 3 },
        { source: `src`, target: `mid`, value: 2 },
        { source: `src`, target: `e`, value: 1 },
        { source: `mid`, target: `sink`, value: 2 },
      ],
      6,
    ], // nothing folds: only `e` is a foldable overflow, and a bucket of one is not made
  ])(`max_links: %s`, (_name, links, expected) => {
    const graph = {
      nodes: [`src`, `a`, `b`, `c`, `d`, `e`, `mid`, `sink`].map((id) => ({ id })),
      links,
    }
    expect(bucket_sankey_data(graph, { max_links: 3 }).links).toHaveLength(expected)
  })

  // Labels are not identity: two nodes may share one, and keying on it would merge them
  test(`duplicate labels with index references resolve to distinct nodes`, () => {
    const dup = {
      nodes: [{ label: `src` }, { label: `dup` }, { label: `dup` }, { label: `dup` }],
      links: [
        { source: 0, target: 1, value: 90 },
        { source: 0, target: 2, value: 1 },
        { source: 0, target: 3, value: 1 },
      ],
    }
    const { nodes, links } = bucket_sankey_data(dup, { min_fraction: 0.1 })
    // Nodes 2 and 3 fold; node 1 survives under its own index-derived id
    expect(nodes.map((node) => node.id)).toEqual([0, 1, `0/Other`])
    expect(links.map((link) => [link.source, link.target, link.value])).toEqual([
      [0, 1, 90],
      [0, `0/Other`, 2],
    ])
  })

  // An earlier label must not shadow a later node's explicit id. Here the shadowing node
  // carries flow onward while the id node is terminal, so resolving to the wrong one
  // changes whether the link may be folded at all.
  test(`an explicit id outranks an earlier node's matching label`, () => {
    const shadowed = {
      nodes: [
        { id: `src` },
        { label: `X` }, // shadows node 3's id, and is NOT terminal
        { id: `big` },
        { id: `X` }, // terminal, so a link naming `X` is foldable
        { id: `t` },
        { id: `downstream` },
      ],
      links: [
        { source: `src`, target: `big`, value: 90 },
        { source: `src`, target: `X`, value: 1 },
        { source: `src`, target: `t`, value: 1 },
        { source: 1, target: `downstream`, value: 1 }, // makes the label node non-terminal
      ],
    }
    const { nodes } = bucket_sankey_data(shadowed, { min_fraction: 0.1 })
    // Resolving `X` to the terminal node 3 lets both small links fold into one bucket;
    // resolving it to the non-terminal node 1 would leave the graph untouched
    expect(nodes.map((node) => node.id)).toContain(`src/Other`)
  })

  test(`a bucket id that collides with a real node is made unique`, () => {
    const collide = {
      nodes: [{ id: `src` }, { id: `big` }, { id: `src/Other` }, { id: `t` }],
      links: [
        { source: `src`, target: `big`, value: 90 },
        { source: `src`, target: `src/Other`, value: 1 },
        { source: `src`, target: `t`, value: 1 },
      ],
    }
    const { nodes } = bucket_sankey_data(collide, { min_fraction: 0.1 })
    // The real `src/Other` was folded away here, but the synthetic id must still not
    // reuse an id held by any retained node
    const ids = nodes.map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // An unknown target is a broken reference, not a terminal node: folding it would
  // replace it with a valid link and hide the error compute_sankey_layout reports
  test(`links with unresolved targets are never folded`, () => {
    const broken = {
      nodes: [{ id: `src` }, { id: `big` }],
      links: [
        { source: `src`, target: `big`, value: 90 },
        { source: `src`, target: `ghost`, value: 1 },
        { source: `src`, target: `phantom`, value: 1 },
      ],
    }
    expect(bucket_sankey_data(broken, { min_fraction: 0.1 }).links).toEqual(broken.links)
  })
})
