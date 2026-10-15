import type { ShowControlsProp } from '#lib/controls.js'
import Sankey from '#lib/plot/sankey/Sankey.svelte'
import { plot_color } from '#lib/colors/index.js'
import { color as d3_color } from 'd3-color'
import type {
  SankeyData,
  SankeyLinkHandlerProps,
  SankeyNodeHandlerProps,
} from '#lib/plot/index.js'
import type { ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bucket_sankey_data, compute_sankey_layout } from '#lib/plot/sankey/sankey.js'
import { fire, keydown, mount_sized, mouse, plot_svg, query } from '../setup'

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

// id-only nodes: one big flow plus a long tail of small terminal ones, the shape bucketing exists for
const tail: SankeyData = {
  nodes: [`src`, `big`, `a`, `b`, `c`].map((id) => ({ id })),
  links: Object.entries({ big: 90, a: 4, b: 3, c: 3 }).map(([target, value]) => ({
    source: `src`,
    target,
    value,
  })),
}

const mount_sized_sankey = (
  props: Partial<ComponentProps<typeof Sankey>>,
): Promise<HTMLElement> =>
  mount_sized(Sankey, props, { selector: `.sankey`, width: 500, height: 360 })

describe(`Sankey`, () => {
  test.each([
    [`never`, false, false],
    [{ hidden: [`controls`] }, false, true],
    [{ mode: `always`, hidden: [`fullscreen`] }, true, false],
  ] satisfies [ShowControlsProp<`controls` | `fullscreen`>, boolean, boolean][])(
    `shared controls %j`,
    async (show_controls, controls, fullscreen) => {
      const plot = await mount_sized_sankey({ data, show_controls })
      expect(Boolean(plot.querySelector(`.control-pane-toggle`))).toBe(controls)
      expect(Boolean(plot.querySelector(`.fullscreen-btn`))).toBe(fullscreen)
    },
  )

  test(`chrome owns mode and style without applying either twice`, async () => {
    const plot = await mount_sized_sankey({
      data,
      show_controls: { mode: `hover`, style: `opacity: 0.5` },
    })
    const row = plot.querySelector<HTMLElement>(`.header-controls`)
    const toggle = plot.querySelector<HTMLElement>(`.control-pane-toggle`)
    expect(row?.classList.contains(`hover-visible`)).toBe(true)
    expect(row?.style.opacity).toBe(`0.5`)
    expect(toggle?.classList.contains(`always-visible`)).toBe(true)
    expect(toggle?.style.opacity).toBe(``)
  })

  test.each([
    [`horizontal`, true],
    [`vertical`, false],
  ] as const)(
    `%s: one colored rect per node, one path per link, show_node_labels=%s`,
    async (orientation, show_node_labels) => {
      const plot = await mount_sized_sankey({ data, orientation, show_node_labels })
      // explicit node colors win, the rest fall back to the palette by node position
      expect(
        [...plot.querySelectorAll(`.nodes rect`)].map((rect) => rect.getAttribute(`fill`)),
      ).toEqual([`#e15759`, `#4e79a7`, `#59a14f`, plot_color(3)])
      expect(plot.querySelectorAll(`.links path`)).toHaveLength(data.links.length)
      expect(plot.querySelectorAll(`.node-label`)).toHaveLength(
        show_node_labels ? data.nodes.length : 0,
      )
      // without click handlers, marks are not focusable buttons
      for (const mark of [query(plot, `.nodes rect`), query(plot, `.links path`)]) {
        for (const attr of [`role`, `tabindex`, `aria-label`])
          expect(mark.hasAttribute(attr)).toBe(false)
      }
    },
  )

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
    expect(plot.querySelector(`.viewer-error [role="alert"]`)?.textContent).toContain(
      `cycle A -> B -> A`,
    )
    expect(plot.querySelectorAll(`.nodes rect`)).toHaveLength(0)
  })

  test(`gradient mode emits one linearGradient per link`, async () => {
    const plot = await mount_sized_sankey({ data, link_color_mode: `gradient` })
    expect(plot.querySelectorAll(`linearGradient`)).toHaveLength(data.links.length)
    const first_path = plot.querySelector(`.links path`)
    expect(first_path?.getAttribute(`stroke`)?.startsWith(`url(#`)).toBe(true)
  })

  // an explicit link color wins over the node color in both ribbon and tooltip; a static
  // var() ribbon resolves to its own grey, not the source node's color
  test.each<[`source` | `target` | `static`, string?, string?]>([
    [`source`],
    [`target`],
    [`source`, `#123456`],
    [`static`, undefined, `#888888`],
  ])(
    `link tooltip wears the ribbon color in %s mode (link color %s)`,
    async (link_color_mode, color, expected) => {
      const links = data.links.map((link) => ({ ...link, color: color ?? link.color }))
      const plot = await mount_sized_sankey({ data: { ...data, links }, link_color_mode })
      const link = query(plot, `.links path`)
      await fire(link, mouse(`mousemove`, { clientX: 200, clientY: 100 }))
      const tooltip = query(plot, `.plot-tooltip`)
      const hex = (css: string | null) => d3_color(css ?? ``)?.formatHex()
      expect(hex(tooltip.style.backgroundColor)).toBe(
        expected ?? hex(link.getAttribute(`stroke`)),
      )
    },
  )

  test(`hovering a node then a link swaps the tooltip and fires each callback once`, async () => {
    const [on_node_hover, on_link_hover] = [vi.fn(), vi.fn()]
    const plot = await mount_sized_sankey({ data, on_node_hover, on_link_hover })
    const rect = plot.querySelector<SVGRectElement>(`.nodes rect`)
    const hover = (element: Element | null | undefined, coord_x = 0, coord_y = 0) =>
      fire(element, mouse(`mousemove`, { clientX: coord_x, clientY: coord_y }))
    await hover(rect, 30, 40)
    const tooltip = () => plot.querySelector<HTMLElement>(`.plot-tooltip`)
    expect(tooltip()?.textContent).toMatch(/A.*8/)
    // Anchored at the cursor, constrained to the 500x360 chart. `avoid_cursor` widens the
    // 10px x offset to the pointer glyph's width; y keeps its 5px offset.
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

    const opacities = () =>
      [...plot.querySelectorAll(`.links path`)].map((path) =>
        Number(path.getAttribute(`stroke-opacity`)),
      )
    const on_node = opacities()
    expect(on_node[0]).toBeGreaterThan(on_node[1])
    await hover(plot.querySelectorAll(`.nodes rect`)[1], 30, 40)
    expect(opacities()).toEqual([on_node[1], on_node[0], on_node[2]])
    await hover(rect, 30, 40)
    expect(opacities()).toEqual(on_node)

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
    expect(on_node_hover).toHaveBeenCalledTimes(5)
    expect(tooltip()?.textContent).toMatch(/A.*8/)
    // leaving the svg clears everything once
    await fire(plot_svg(plot), mouse(`mouseleave`))
    expect(tooltip()).toBeNull()
    expect(on_node_hover).toHaveBeenLastCalledWith(null)
    expect([on_node_hover.mock.calls.length, on_link_hover.mock.calls.length]).toEqual([6, 2])
    expect(new Set(opacities()).size).toBe(1)
    await hover(plot.querySelectorAll(`.nodes rect`)[1], 30, 40)
    expect(opacities()).toEqual([on_node[1], on_node[0], on_node[2]])
    expect(
      [...plot.querySelectorAll<SVGGElement>(`.node`)].map((node) => node.style.opacity),
    ).toEqual([`0.3`, `1`, `1`, `0.3`])
  })

  test.each([`Enter`, ` `])(`click and %j activate marks`, async (key) => {
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

    await fire(rect)
    expect(on_node_click).toHaveBeenCalledOnce()
    expect(on_node_click.mock.calls[0][0] as SankeyNodeHandlerProps).toMatchObject({
      type: `node`,
      node_idx: 0,
      label: `A`,
      value: 8,
      color: `#e15759`,
    })
    // Enter/Space on a focused mark activates it like a click; other keys are ignored
    const canceled_event = keydown(key, { cancelable: true })
    canceled_event.preventDefault()
    rect?.dispatchEvent(canceled_event)
    rect?.dispatchEvent(keydown(key, { isComposing: true }))
    expect(on_node_click).toHaveBeenCalledOnce()
    rect?.dispatchEvent(keydown(key))
    await fire(rect, keydown(`Tab`))
    expect(on_node_click).toHaveBeenCalledTimes(2)

    await fire(path)
    expect(on_link_click).toHaveBeenCalledOnce()
    expect(on_link_click.mock.calls[0][0] as SankeyLinkHandlerProps).toMatchObject({
      type: `link`,
      source_label: `A`,
      target_label: `C`,
      value: 8,
    })
  })

  test(`legend toggle dims a node and its links, re-click restores`, async () => {
    // fixture nodes omit `id`; the layout backfills id = index, so muting keys consistently
    const plot = await mount_sized_sankey({ data, show_legend: true })
    const dimmed = () => [
      [...plot.querySelectorAll<SVGGElement>(`.node`)]
        .filter((node_g) => node_g.style.opacity === `0.12`)
        .map((node_g) => node_g.querySelector(`.node-label`)?.textContent?.trim()),
      [...plot.querySelectorAll(`.links path`)].filter(
        (path) => Number(path.getAttribute(`stroke-opacity`)) < 0.2,
      ).length,
    ]
    expect(dimmed()).toEqual([[], 0])
    await fire(plot.querySelector(`.legend-item`)) // mute A and its single link A->C
    expect(dimmed()).toEqual([[`A`], 1])
    await fire(plot.querySelector(`.legend-item`))
    expect(dimmed()).toEqual([[], 0])
  })

  // Id-only links must be named by id, not "undefined" or a layout index. Hover state is
  // index-based and folding renumbers nodes, so a hovered node's tooltip must not outlive it.
  test(`id-only nodes name links by id; refolding clears a stale hover`, async () => {
    const on_node_hover = vi.fn()
    const plot = await mount_sized_sankey({
      data: tail,
      controls_open: true,
      on_node_hover,
      on_link_click: vi.fn(),
    })
    const tooltip_text = () => plot.querySelector(`.plot-tooltip`)?.textContent
    const link = query(plot, `.links path`)
    expect(link.getAttribute(`aria-label`)).toBe(`flow src to big: 90`)
    await fire(link, mouse(`mousemove`))
    expect(tooltip_text()).toMatch(/src\s*→\s*big/)
    await fire(query(plot, `[data-sankey-node-idx="4"]`), mouse(`mousemove`))
    expect(tooltip_text()).toMatch(/c.*3/)
    const min_fraction_input = [
      ...plot.querySelectorAll<HTMLInputElement>(`input[type="number"]`),
    ].find((input) => input.max === `0.2`)
    if (!min_fraction_input) throw new Error(`no min_fraction input`)
    min_fraction_input.value = `0.05`
    await fire(min_fraction_input, new Event(`input`, { bubbles: true }))
    expect(plot.querySelectorAll(`.nodes rect`)).toHaveLength(3) // a, b, c folded
    expect(tooltip_text()).toBeUndefined()
    expect(on_node_hover).toHaveBeenLastCalledWith(null)
  })

  test.each([
    { nodes: [], links: [] },
    { nodes: [{ label: `solo` }], links: [] },
    { nodes: [{ label: `orphan-a` }, { label: `orphan-b` }], links: [] },
  ])(`renders link-less data %# without error or an empty legend`, async (graph) => {
    const plot = await mount_sized_sankey({ data: graph, show_legend: true })
    expect(plot.querySelector(`.viewer-error`)).toBeNull()
    expect(plot.querySelectorAll(`.links path`)).toHaveLength(0)
    expect(plot.querySelector(`.legend`)).toBeNull()
  })
})

describe(`bucket_sankey_data`, () => {
  const hub = (links: (readonly [string, string, number])[]): SankeyData => ({
    nodes: [`src`, `big`, `a`, `b`, `c`, `d`, `e`, `mid`, `sink`, `t`].map((id) => ({ id })),
    links: links.map(([source, target, value]) => ({ source, target, value })),
  })
  const ranked = (...targets: string[]) =>
    targets.map((target, idx) => [`src`, target, 5 - idx] as const)

  test(`folds the small terminal tail into one Other link`, () => {
    const { nodes, links } = bucket_sankey_data(tail, { min_fraction: 0.05 })
    expect(links.map((link) => [link.source, link.target, link.value])).toEqual([
      [`src`, `big`, 90],
      [`src`, `src/Other`, 10],
    ])
    expect(nodes.map((node) => node.id)).toEqual([`src`, `big`, `src/Other`])
  })

  // `max_links` bounds the links kept under their own name, not the total drawn: the bucket
  // is additional (same contract as `max_children` on the hierarchy charts)
  // oxfmt-ignore
  test.each<[string, SankeyData, Parameters<typeof bucket_sankey_data>[1], number]>([
    [`threshold below every link`, tail, { min_fraction: 0.01 }, 4],
    [`max_links keeps the largest`, tail, { max_links: 2 }, 3],
    [`disabled by default`, tail, {}, 4],
    [`max_links: 3 kept + 1 bucket`, hub(ranked(`a`, `b`, `c`, `d`, `e`)), { max_links: 3 }, 4],
    // only `e` is a foldable overflow, and a bucket of one is not made
    [`max_links keeps non-terminal overflow`, hub([...ranked(`a`, `b`, `c`, `mid`, `e`), [`mid`, `sink`, 2]]), { max_links: 3 }, 6],
  ])(`%s -> %i links`, (_name, graph, opts, expected) => {
    expect(bucket_sankey_data(graph, opts).links).toHaveLength(expected)
  })

  // Each case leaves the graph untouched: a bucket of one is just that link renamed; folding a
  // target that carries flow onward would delete that flow from the diagram (`mid` survives, so
  // only `t` qualifies and the >= 2 rule applies); an unknown target is a broken reference, not
  // a terminal node, and folding it would hide the error compute_sankey_layout reports
  // oxfmt-ignore
  test.each([
    [`a single qualifying link`, 99, [[`src`, `a`, 1]]],
    [`a target with outgoing flow`, 90, [[`src`, `mid`, 5], [`mid`, `sink`, 5], [`src`, `t`, 5]]],
    [`unresolved targets`, 90, [[`src`, `ghost`, 1], [`src`, `phantom`, 1]]],
  ] as const)(`never buckets %s`, (_desc, big_value, rows) => {
    const graph = hub([[`src`, `big`, big_value], ...rows])
    expect(bucket_sankey_data(graph, { min_fraction: 0.5 })).toBe(graph)
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
    // only resolving `X` to the terminal node 3 lets both small links fold
    const { nodes } = bucket_sankey_data(shadowed, { min_fraction: 0.1 })
    expect(nodes.map((node) => node.id)).toContain(`src/Other`)
  })

  // Folding must not move flow between nodes: bucketed or not, a label resolves to one node
  test.each([
    [`a duplicated label`, [{ label: `A` }, { label: `A` }]],
    [`a label matching a later node's id`, [{ id: `A` }, { label: `A` }]],
  ])(`%s resolves to the same source with and without folding`, (_desc, sources) => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const targets = [`big`, `t1`, `t2`]
    const graph: SankeyData = {
      nodes: [
        ...sources.map((node, idx) => ({ ...node, color: `color-${idx}` })),
        ...targets.map((id) => ({ id })),
      ],
      links: targets.map((target, idx) => ({ source: `A`, target, value: idx ? 1 : 90 })),
    }
    const source_colors = (graph_in: SankeyData) =>
      new Set(
        compute_sankey_layout(graph_in, { width: 400, height: 300 }).links.map(
          (link) => link.source.color,
        ),
      )
    const bucketed = bucket_sankey_data(graph, { min_fraction: 0.1 })
    expect(bucketed.links).toHaveLength(2) // t1 + t2 folded
    expect(source_colors(bucketed)).toEqual(source_colors(graph))
    warn.mockRestore()
  })

  // the real `src/Other` folds away here, but the synthetic id must still be unique
  test(`a bucket id that collides with a real node is made unique`, () => {
    const collide = hub([
      [`src`, `big`, 90],
      [`src`, `src/Other`, 1],
      [`src`, `t`, 1],
    ])
    collide.nodes.push({ id: `src/Other` })
    const ids = bucket_sankey_data(collide, { min_fraction: 0.1 }).nodes.map((node) => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
