import FacetGrid from '$lib/plot/core/components/FacetGrid.svelte'
import type {
  FacetPanel,
  FacetPanelContext,
  FacetSharedBandContext,
  FacetSharedBandSizes,
} from '$lib/plot/core/facets'
import { createRawSnippet, mount, tick, unmount, type Snippet } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { afterEach, describe, expect, test } from 'vitest'
import { query, trigger_resize_observer } from '../setup'

const make_panel_snippet = (context_getters: (() => FacetPanelContext)[]) =>
  createRawSnippet<[FacetPanelContext]>((get_context) => {
    context_getters.push(get_context)
    return {
      render: () => `<span class="facet-test-content">${String(get_context().key)}</span>`,
    }
  })

const make_panels = (...keys: string[]): FacetPanel[] =>
  keys.map((key, panel_idx) => ({ key, data: panel_idx + 1 }))

const make_band_snippet = (context_getters: (() => FacetSharedBandContext)[], name: string) =>
  createRawSnippet<[FacetSharedBandContext]>((get_context) => {
    context_getters.push(get_context)
    return { render: () => `<span>${name}</span>` }
  })

const context_for = (
  context_getters: (() => FacetPanelContext)[],
  key: string,
): FacetPanelContext => {
  const context_getter = context_getters.findLast((get_context) => get_context().key === key)
  if (!context_getter) throw new Error(`No facet context for key "${key}"`)
  return context_getter()
}

const mounted_grids: { component: ReturnType<typeof mount>; target: HTMLElement }[] = []

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
    color_bar?: Snippet<[FacetSharedBandContext]>
  } = {},
) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const context_getters: (() => FacetPanelContext)[] = []
  const panel_state = new SvelteMap<`panels`, readonly FacetPanel[]>([[`panels`, panels]])
  const component = mount(FacetGrid, {
    target,
    props: {
      get panels() {
        return panel_state.get(`panels`) ?? []
      },
      columns: options.columns ?? 1,
      gap: options.gap,
      axis_modes: options.axis_modes,
      shared_bands: options.shared_bands,
      children: make_panel_snippet(context_getters),
      title: options.title,
      legend: options.legend,
      color_bar: options.color_bar,
    },
  })
  mounted_grids.push({ component, target })
  await Promise.resolve()
  await tick()
  const root = query(target, `.facet-grid`)
  return {
    root,
    context_getters,
    set_panels: (next_panels: readonly FacetPanel[]) => panel_state.set(`panels`, next_panels),
  }
}

describe(`FacetGrid`, () => {
  afterEach(async () => {
    for (const { component, target } of mounted_grids.splice(0)) {
      await unmount(component)
      target.remove()
    }
  })

  test(`renders explicit shared chrome bands and passes their geometry to slots`, async () => {
    const band_context_getters: (() => FacetSharedBandContext)[] = []
    const { root, context_getters } = await mount_grid([{ key: `only`, data: { value: 1 } }], {
      title: make_band_snippet(band_context_getters, `shared title`),
      legend: make_band_snippet(band_context_getters, `shared legend`),
      color_bar: make_band_snippet(band_context_getters, `shared color bar`),
      shared_bands: {
        title_height: 40,
        legend_width: 120,
        color_bar_width: 60,
        gap: 10,
      },
    })

    expect(root.querySelectorAll(`.facet-grid-panel`)).toHaveLength(1)
    expect(root.querySelector(`.facet-test-content`)?.textContent).toBe(`only`)
    expect(root.querySelector(`[data-facet-slot="title"]`)?.textContent).toBe(`shared title`)
    expect(root.querySelector(`[data-facet-slot="legend"]`)?.textContent).toBe(`shared legend`)
    expect(root.querySelector(`[data-facet-slot="color_bar"]`)?.textContent).toBe(
      `shared color bar`,
    )
    expect(band_context_getters.map((get_context) => get_context())).toEqual([
      { band: `title`, rect: { x: 0, y: 0, width: 800, height: 40 } },
      { band: `legend`, rect: { x: 610, y: 50, width: 120, height: 550 } },
      { band: `color_bar`, rect: { x: 740, y: 50, width: 60, height: 550 } },
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

  test(`keeps zero-size panel and shared-band rectangles independent`, async () => {
    const band_context_getters: (() => FacetSharedBandContext)[] = []
    const { root, context_getters } = await mount_grid(make_panels(`left`, `right`), {
      columns: 2,
      gap: 8,
      title: make_band_snippet(band_context_getters, `title`),
      legend: make_band_snippet(band_context_getters, `legend`),
      shared_bands: { title_height: 20, legend_width: 20 },
    })
    Object.defineProperties(root, {
      clientWidth: { value: 0, configurable: true },
      clientHeight: { value: 0, configurable: true },
    })
    trigger_resize_observer(root)
    await tick()

    const rects = [
      context_for(context_getters, `left`).rect,
      context_for(context_getters, `right`).rect,
      ...band_context_getters.map((get_context) => get_context().rect),
    ]
    expect(rects).toEqual(rects.map(() => ({ x: 0, y: 0, width: 0, height: 0 })))
    expect(rects.every((rect, rect_idx) => rects.indexOf(rect) === rect_idx)).toBe(true)
  })

  test(`reconciles child layout reports and suppresses inner shared axes`, async () => {
    const { context_getters } = await mount_grid(make_panels(`left`, `right`), {
      columns: 2,
      axis_modes: { x: `shared`, y: `free` },
    })

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
    expect(left.padding).toEqual({ t: 20, b: 40, l: 70, r: 0 })
    expect(right.padding).toEqual({ t: 20, b: 40, l: 70, r: 25 })
    expect([left.rect.width, right.rect.width]).toEqual([387.5, 412.5])
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
    const keys = [`top-left`, `top-right`, `bottom-left`, `bottom-right`]
    const { context_getters } = await mount_grid(make_panels(...keys), {
      columns: 2,
      axis_modes: { x: `row`, y: `col` },
    })
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
    const { context_getters } = await mount_grid(make_panels(`left`, `right`), { columns: 2 })
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
      await tick()
    }

    expect(context_for(context_getters, `left`)).toBe(resolved_left)
    context_for(context_getters, `left`).update_range(`x`, [3, 4])
    await tick()
    context_for(context_getters, `right`).update_range(`x`, null)
    await tick()
    expect(context_for(context_getters, `left`).ranges.x).toEqual([0, 10])
  })

  test(`keeps reports and callback identities stable through resize`, async () => {
    const { root, context_getters } = await mount_grid(make_panels(`left`, `right`), {
      columns: 2,
      gap: 10,
    })
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
    trigger_resize_observer(root)
    await tick()

    const resized_left = context_for(context_getters, `left`)
    const resized_right = context_for(context_getters, `right`)
    expect(resized_left.rect).toEqual({ x: 0, y: 0, width: 225, height: 200 })
    expect(resized_right.rect).toEqual({ x: 235, y: 0, width: 165, height: 200 })
    expect(
      root.querySelector<HTMLElement>(`.facet-grid-panels`)?.style.gridTemplateColumns,
    ).toBe(`225px 165px`)
    expect(resized_left.padding).toEqual({ t: 0, b: 0, l: 60, r: 0 })
    expect(resized_right.padding).toEqual({ t: 0, b: 0, l: 0, r: 0 })
    expect(resized_left.ranges.x).toEqual([-2, 2])
    expect(resized_left.report_layout).toBe(report_layout)

    // An identical report and resize are both no-ops, so the resolved context stays stable.
    resized_left.report_layout({ padding: { l: 60 }, ranges: { x: [-2, 2] } })
    trigger_resize_observer(root)
    await tick()
    expect(context_for(context_getters, `left`)).toBe(resized_left)
  })

  test(`prunes callback identities when a panel key leaves the grid`, async () => {
    const { context_getters, set_panels } = await mount_grid(make_panels(`kept`, `removed`), {
      columns: 2,
    })
    const removed = context_for(context_getters, `removed`)

    set_panels([{ key: `kept`, data: 1 }])
    await tick()
    removed.report_layout({ padding: { l: 99 } })
    removed.update_range(`x`, [4, 6])

    set_panels([
      { key: `kept`, data: 1 },
      { key: `removed`, data: 3 },
    ])
    await tick()
    const re_added = context_for(context_getters, `removed`)

    expect(re_added.report_layout).not.toBe(removed.report_layout)
    expect(re_added.update_range).not.toBe(removed.update_range)
    expect(re_added.padding).toEqual({})
    expect(re_added.ranges).toEqual({})
  })
})
