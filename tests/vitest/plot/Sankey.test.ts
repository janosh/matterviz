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

  test(`toggles node labels with show_node_labels`, async () => {
    const shown = await mount_sized_sankey({ data, show_node_labels: true })
    expect(shown.querySelectorAll(`.node-label`)).toHaveLength(data.nodes.length)
    document.body.innerHTML = ``
    const hidden = await mount_sized_sankey({ data, show_node_labels: false })
    expect(hidden.querySelectorAll(`.node-label`)).toHaveLength(0)
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

  test(`shows a tooltip and fires hover callback on node hover`, async () => {
    const on_node_hover = vi.fn()
    const plot = await mount_sized_sankey({ data, on_node_hover })
    const rect = plot.querySelector<SVGRectElement>(`.nodes rect`)
    rect?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    expect(on_node_hover).toHaveBeenCalledOnce()
    const arg = on_node_hover.mock.calls[0][0] as SankeyNodeHandlerProps
    expect(arg.type).toBe(`node`)
    expect(arg.label).toBe(`A`)
    expect(arg.value).toBe(8)
  })

  test(`fires link hover callback with source/target labels`, async () => {
    const on_link_hover = vi.fn()
    const plot = await mount_sized_sankey({ data, on_link_hover })
    const path = plot.querySelector<SVGPathElement>(`.links path`)
    path?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    expect(on_link_hover).toHaveBeenCalledOnce()
    const arg = on_link_hover.mock.calls[0][0] as SankeyLinkHandlerProps
    expect(arg.type).toBe(`link`)
    expect(arg.source_label).toBe(`A`)
    expect(arg.target_label).toBe(`C`)
    expect(arg.value).toBe(8)
  })

  test(`fires node click callback`, async () => {
    const on_node_click = vi.fn()
    const plot = await mount_sized_sankey({ data, on_node_click })
    const rect = plot.querySelector<SVGRectElement>(`.nodes rect`)
    rect?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(on_node_click).toHaveBeenCalledOnce()
  })

  test(`renders legend when show_legend is true`, async () => {
    const plot = await mount_sized_sankey({ data, show_legend: true })
    expect(plot.querySelector(`.legend`)).not.toBeNull()
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

  test.each([
    { data: { nodes: [], links: [] } },
    { data: { nodes: [{ label: `solo` }], links: [] } },
  ])(`renders without error for empty/degenerate data %#`, async (props) => {
    const plot = await mount_sized_sankey(props)
    expect(plot.querySelectorAll(`.links path`)).toHaveLength(0)
  })
})
