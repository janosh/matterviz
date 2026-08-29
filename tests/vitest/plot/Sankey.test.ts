import { Sankey } from '$lib'
import type { SankeyData, SankeyLinkHandlerProps, SankeyNodeHandlerProps } from '$lib/plot'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
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
    expect(fills[3]).not.toBeNull() // palette fallback
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

  test(`fires node click callback`, async () => {
    const on_node_click = vi.fn()
    const plot = await mount_sized_sankey({ data, on_node_click })
    const rect = plot.querySelector<SVGRectElement>(`.nodes rect`)
    rect?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(on_node_click).toHaveBeenCalledOnce()
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
