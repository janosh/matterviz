import FacetGrid from '$lib/plot/core/components/FacetGrid.svelte'
import type {
  FacetPanel,
  FacetPanelContext,
  FacetSharedBandContext,
  FacetSharedBandSizes,
} from '$lib/plot/core/facets'
import { createRawSnippet, mount, tick, type Snippet } from 'svelte'
import { describe, expect, test } from 'vitest'

const make_panel_snippet = (context_getters: (() => FacetPanelContext)[]) =>
  createRawSnippet<[FacetPanelContext]>((get_context) => {
    context_getters.push(get_context)
    return {
      render: () => `<span class="facet-test-content">${String(get_context().key)}</span>`,
    }
  })

const context_for = (
  context_getters: (() => FacetPanelContext)[],
  key: string,
): FacetPanelContext => {
  const context_getter = context_getters.find((get_context) => get_context().key === key)
  if (!context_getter) throw new Error(`No facet context for key "${key}"`)
  return context_getter()
}

const mount_grid = async (
  panels: readonly FacetPanel[],
  options: {
    columns?: number
    gap?: number
    axis_modes?: {
      x?: `shared` | `free` | `row` | `col`
      y?: `shared` | `free` | `row` | `col`
    }
    shared_bands?: FacetSharedBandSizes
    title?: Snippet<[FacetSharedBandContext]>
    legend?: Snippet<[FacetSharedBandContext]>
    colorbar?: Snippet<[FacetSharedBandContext]>
  } = {},
) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const context_getters: (() => FacetPanelContext)[] = []
  mount(FacetGrid, {
    target,
    props: {
      panels,
      columns: options.columns ?? 1,
      gap: options.gap,
      axis_modes: options.axis_modes,
      shared_bands: options.shared_bands,
      children: make_panel_snippet(context_getters),
      title: options.title,
      legend: options.legend,
      colorbar: options.colorbar,
    },
  })
  await Promise.resolve()
  await tick()
  const root = target.querySelector<HTMLElement>(`.facet-grid`)
  if (!root) throw new Error(`FacetGrid root not found`)
  return { root, context_getters }
}

describe(`FacetGrid`, () => {
  test(`renders explicit shared chrome bands and passes their geometry to slots`, async () => {
    const band_context_getters: (() => FacetSharedBandContext)[] = []
    const slot = (name: string) =>
      createRawSnippet<[FacetSharedBandContext]>((get_context) => {
        band_context_getters.push(get_context)
        return { render: () => `<span>${name}</span>` }
      })
    const { root, context_getters } = await mount_grid([{ key: `only`, data: { value: 1 } }], {
      title: slot(`shared title`),
      legend: slot(`shared legend`),
      colorbar: slot(`shared colorbar`),
      shared_bands: {
        title_height: 40,
        legend_width: 120,
        colorbar_width: 60,
        gap: 10,
      },
    })

    expect(root.querySelectorAll(`.facet-grid-panel`)).toHaveLength(1)
    expect(root.querySelector(`.facet-test-content`)?.textContent).toBe(`only`)
    expect(root.querySelector(`[data-facet-slot="title"]`)?.textContent).toBe(`shared title`)
    expect(root.querySelector(`[data-facet-slot="legend"]`)?.textContent).toBe(`shared legend`)
    expect(root.querySelector(`[data-facet-slot="colorbar"]`)?.textContent).toBe(
      `shared colorbar`,
    )
    expect(band_context_getters.map((get_context) => get_context())).toEqual([
      { band: `title`, rect: { x: 0, y: 0, width: 800, height: 40 } },
      { band: `legend`, rect: { x: 610, y: 50, width: 120, height: 550 } },
      { band: `colorbar`, rect: { x: 740, y: 50, width: 60, height: 550 } },
    ])
    expect(root.style.gridTemplateColumns).toBe(`minmax(0, 1fr) 120px 60px`)
    expect(root.style.gridTemplateRows).toBe(`40px minmax(0, 1fr)`)
    expect(context_for(context_getters, `only`)).toMatchObject({
      row: 0,
      column: 0,
      rect: { x: 0, y: 50, width: 600, height: 550 },
      axis_visibility: { x: true, x2: true, y: true, y2: true },
    })
  })

  test(`reconciles child layout reports and suppresses inner shared axes`, async () => {
    const { context_getters } = await mount_grid(
      [
        { key: `left`, data: 1 },
        { key: `right`, data: 2 },
      ],
      { columns: 2, axis_modes: { x: `shared`, y: `free` } },
    )

    context_for(context_getters, `left`).report_layout({
      padding: { t: 5, b: 40, l: 70, r: 10 },
      ranges: { x: [0, 2], y: [10, 12] },
    })
    context_for(context_getters, `right`).report_layout({
      padding: { t: 20, b: 30, l: 50, r: 25 },
      ranges: { x: [8, 10], y: [20, 24] },
    })
    await tick()

    const left = context_for(context_getters, `left`)
    const right = context_for(context_getters, `right`)
    expect(left.padding).toEqual({ t: 20, b: 40, l: 70, r: 25 })
    expect(right.padding).toEqual(left.padding)
    expect([left.ranges.x, right.ranges.x]).toEqual([
      [0, 10],
      [0, 10],
    ])
    expect([left.ranges.y, right.ranges.y]).toEqual([
      [10, 12],
      [20, 24],
    ])
    expect(left.axis_visibility).toMatchObject({ x: true, y: true, y2: false })
    expect(right.axis_visibility).toMatchObject({ x: true, y: true, y2: true })
  })

  test(`propagates linked zoom and reset updates by row and column`, async () => {
    const { context_getters } = await mount_grid(
      [
        { key: `top-left`, data: 1 },
        { key: `top-right`, data: 2 },
        { key: `bottom-left`, data: 3 },
        { key: `bottom-right`, data: 4 },
      ],
      { columns: 2, axis_modes: { x: `row`, y: `col` } },
    )
    const keys = [`top-left`, `top-right`, `bottom-left`, `bottom-right`]
    keys.forEach((key, panel_idx) => {
      context_for(context_getters, key).report_layout({
        ranges: {
          x: [10 * panel_idx, 10 * panel_idx + 1],
          y: [100 * panel_idx, 100 * panel_idx + 1],
        },
      })
    })
    await tick()

    const top_left = context_for(context_getters, `top-left`)
    const update_range = top_left.update_range
    top_left.update_range(`x`, [4, 6])
    top_left.update_range(`y`, [40, 60])
    await tick()
    expect(keys.map((key) => context_for(context_getters, key).ranges.x)).toEqual([
      [4, 6],
      [4, 6],
      [20, 31],
      [20, 31],
    ])
    expect(keys.map((key) => context_for(context_getters, key).ranges.y)).toEqual([
      [40, 60],
      [100, 301],
      [40, 60],
      [100, 301],
    ])
    expect(context_for(context_getters, `top-left`).update_range).toBe(update_range)

    context_for(context_getters, `top-right`).update_range(`x`, null)
    await tick()
    expect(keys.map((key) => context_for(context_getters, key).ranges.x)).toEqual([
      [0, 11],
      [0, 11],
      [20, 31],
      [20, 31],
    ])
  })

  test(`ignores repeated resolved layout echoes without losing intrinsic reports`, async () => {
    const { context_getters } = await mount_grid(
      [
        { key: `left`, data: 1 },
        { key: `right`, data: 2 },
      ],
      { columns: 2 },
    )
    context_for(context_getters, `left`).report_layout({
      padding: { l: 50 },
      ranges: { x: [0, 2] },
    })
    context_for(context_getters, `right`).report_layout({
      padding: { l: 80 },
      ranges: { x: [8, 10] },
    })
    await tick()
    const resolved_left = context_for(context_getters, `left`)

    for (let report_idx = 0; report_idx < 20; report_idx++) {
      context_for(context_getters, `left`).report_layout({
        padding: { l: 80 },
        ranges: { x: [0, 10] },
      })
      context_for(context_getters, `right`).report_layout({
        padding: { l: 80 },
        ranges: { x: [0, 10] },
      })
    }
    await tick()

    expect(context_for(context_getters, `left`)).toBe(resolved_left)
    context_for(context_getters, `left`).update_range(`x`, [3, 4])
    await tick()
    context_for(context_getters, `right`).update_range(`x`, null)
    await tick()
    expect(context_for(context_getters, `left`).ranges.x).toEqual([0, 10])
  })

  test(`keeps reports and callback identities stable through resize`, async () => {
    const { root, context_getters } = await mount_grid(
      [
        { key: `left`, data: 1 },
        { key: `right`, data: 2 },
      ],
      { columns: 2, gap: 10 },
    )
    const initial_left = context_for(context_getters, `left`)
    initial_left.report_layout({
      padding: { l: 60 },
      ranges: { x: [-2, 2] },
    })
    await tick()
    const report_layout = context_for(context_getters, `left`).report_layout

    Object.defineProperties(root, {
      clientWidth: { value: 400, configurable: true },
      clientHeight: { value: 200, configurable: true },
    })
    root.dispatchEvent(new Event(`resize`))
    await tick()

    const resized_left = context_for(context_getters, `left`)
    const resized_right = context_for(context_getters, `right`)
    expect(resized_left.rect).toEqual({ x: 0, y: 0, width: 195, height: 200 })
    expect(resized_right.rect).toEqual({ x: 205, y: 0, width: 195, height: 200 })
    expect(resized_left.padding).toEqual({ l: 60 })
    expect(resized_left.ranges.x).toEqual([-2, 2])
    expect(resized_left.report_layout).toBe(report_layout)

    // An identical report and resize are both no-ops, so the resolved context stays stable.
    resized_left.report_layout({ padding: { l: 60 }, ranges: { x: [-2, 2] } })
    root.dispatchEvent(new Event(`resize`))
    await tick()
    expect(context_for(context_getters, `left`)).toBe(resized_left)
  })
})
