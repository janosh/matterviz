import FacetGrid from '$lib/plot/core/components/FacetGrid.svelte'
import type { FacetPanel, FacetPanelContext } from '$lib/plot/core/facets'
import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
import type { DataSeries } from '$lib/plot'
import { type Component, createRawSnippet, mount, tick, unmount } from 'svelte'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'

const original_resize_observer = globalThis.ResizeObserver
class ControlledResizeObserver implements ResizeObserver {
  static instances: ControlledResizeObserver[] = []
  readonly observed_elements: Element[] = []

  constructor(private readonly callback: ResizeObserverCallback) {
    ControlledResizeObserver.instances.push(this)
  }

  observe(element: Element): void {
    if (!this.observed_elements.includes(element)) this.observed_elements.push(element)
    queueMicrotask(() => this.notify(element))
  }

  unobserve(element: Element): void {
    const element_idx = this.observed_elements.indexOf(element)
    if (element_idx !== -1) this.observed_elements.splice(element_idx, 1)
  }

  disconnect(): void {
    this.observed_elements.length = 0
  }

  notify(element: Element): void {
    if (!this.observed_elements.includes(element)) return
    const rect =
      element instanceof HTMLElement
        ? { width: element.clientWidth, height: element.clientHeight }
        : {}
    this.callback(
      [{ target: element, contentRect: DOMRect.fromRect(rect) } as ResizeObserverEntry],
      this,
    )
  }

  static notify(element: Element): void {
    for (const observer of ControlledResizeObserver.instances) observer.notify(element)
  }
}

globalThis.ResizeObserver = ControlledResizeObserver

interface PanelDatum {
  series: DataSeries[]
  padding?: { t: number; b: number; l: number; r: number }
}

const panel_inputs: readonly FacetPanel<PanelDatum>[] = (
  [
    [`top-left`, [-5, 5], [-20, 10], { t: 5, b: 40, l: 90, r: 10 }],
    [`top-right`, [10, 20], [100, 200], { t: 20, b: 30, l: 50, r: 25 }],
    [`bottom-left`, [20, 30], [200, 300], { t: 15, b: 55, l: 60, r: 15 }],
    [`bottom-right`, [30, 40], [300, 400], { t: 10, b: 35, l: 40, r: 45 }],
  ] as const
).map(([key, x, y, padding]) => ({
  key,
  data: { series: [{ x: [0, ...x], y: [0, ...y] }], padding },
}))

const mounted_grids: { component: ReturnType<typeof mount>; target: HTMLElement }[] = []

const mount_facet_scatter = async (panels = panel_inputs) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const context_getters: (() => FacetPanelContext<PanelDatum>)[] = []
  let scatter_mounts = 0
  const children = createRawSnippet<[FacetPanelContext<PanelDatum>]>((get_context) => {
    context_getters.push(get_context)
    return {
      render: () => `<div class="facet-scatter-host"></div>`,
      setup: (element) => {
        const { data } = get_context()
        scatter_mounts += 1
        const component = mount(ScatterPlot, {
          target: element,
          props: {
            series: data.series,
            padding: data.padding,
            x_axis: { label: `Shared x` },
            y_axis: { label: `Shared y` },
            display: { x_grid: true, y_grid: true },
            controls: { show: false },
            fullscreen_toggle: false,
            legend: null,
            point_tween: { duration: 0 },
            get facet_layout() {
              return get_context()
            },
          },
        })
        return () => void unmount(component)
      },
    }
  })
  const typed_facet_grid = FacetGrid as Component<{
    panels: readonly FacetPanel<PanelDatum>[]
    columns: number
    children: typeof children
  }>
  const component = mount(typed_facet_grid, {
    target,
    props: {
      panels,
      columns: 2,
      children,
    },
  })
  mounted_grids.push({ component, target })
  await tick()
  const root = target.querySelector<HTMLElement>(`.facet-grid`)
  if (!root) throw new Error(`FacetGrid root not found`)

  const context_for = (key: string): FacetPanelContext<PanelDatum> => {
    const getter = context_getters.find((get_context) => get_context().key === key)
    if (!getter) throw new Error(`No facet context for key "${key}"`)
    return getter()
  }
  const panel_for = (key: string): HTMLElement => {
    const panel = root.querySelector<HTMLElement>(`[data-facet-key="${key}"]`)
    if (!panel) throw new Error(`No rendered facet panel for key "${key}"`)
    return panel
  }
  return {
    root,
    context_for,
    panel_for,
    scatter_mounts: () => scatter_mounts,
  }
}

const clip_rect = (panel: ParentNode): Record<`x` | `y` | `width` | `height`, number> => {
  const rect = panel.querySelector(`defs clipPath rect`)
  if (!rect) throw new Error(`Scatter clip rectangle not found`)
  return Object.fromEntries(
    ([`x`, `y`, `width`, `height`] as const).map((attr) => [
      attr,
      Number(rect.getAttribute(attr)),
    ]),
  ) as Record<`x` | `y` | `width` | `height`, number>
}

const first_marker_transform = (panel: ParentNode): string =>
  panel.querySelector(`.marker`)?.parentElement?.getAttribute(`transform`) ?? ``

describe(`FacetGrid + ScatterPlot`, () => {
  afterEach(async () => {
    for (const { component, target } of mounted_grids.splice(0)) {
      await unmount(component)
      target.remove()
    }
    ControlledResizeObserver.instances.length = 0
    vi.restoreAllMocks()
  })

  afterAll(() => void (globalThis.ResizeObserver = original_resize_observer))

  test(`aligns shared ranges and plot rectangles with only outer axes across resize`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
    const { root, context_for, panel_for, scatter_mounts } = await mount_facet_scatter()
    const keys = panel_inputs.map(({ key }) => String(key))
    const ranges = (axis: `x` | `y`) => keys.map((key) => context_for(key).ranges[axis])

    await vi.waitFor(() => {
      expect(ranges(`x`)).toEqual(keys.map(() => context_for(keys[0]).ranges.x))
      expect(ranges(`y`)).toEqual(keys.map(() => context_for(keys[0]).ranges.y))
      expect(keys.map((key) => clip_rect(panel_for(key)))).toEqual(
        keys.map(() => ({ x: 90, y: 20, width: 665, height: 525 })),
      )
      expect(keys.map((key) => first_marker_transform(panel_for(key)))).toEqual(
        keys.map(() => first_marker_transform(panel_for(keys[0]))),
      )
    })

    expect(panel_for(`top-left`).querySelector(`.x-axis`)).toBeNull()
    expect(panel_for(`top-right`).querySelector(`.x-axis`)).toBeNull()
    expect(panel_for(`bottom-left`).querySelector(`.x-axis`)).not.toBeNull()
    expect(panel_for(`bottom-right`).querySelector(`.x-axis`)).not.toBeNull()
    expect(panel_for(`top-left`).querySelector(`.y-axis`)).not.toBeNull()
    expect(panel_for(`bottom-left`).querySelector(`.y-axis`)).not.toBeNull()
    expect(panel_for(`top-right`).querySelector(`.y-axis`)).toBeNull()
    expect(panel_for(`bottom-right`).querySelector(`.y-axis`)).toBeNull()

    const scatters = [...root.querySelectorAll<HTMLElement>(`.scatter`)]
    for (const scatter of scatters) {
      Object.defineProperties(scatter, {
        clientWidth: { value: 500, configurable: true },
        clientHeight: { value: 320, configurable: true },
      })
      ControlledResizeObserver.notify(scatter)
    }
    await tick()
    await vi.waitFor(() =>
      expect(keys.map((key) => clip_rect(panel_for(key)))).toEqual(
        keys.map(() => ({ x: 90, y: 20, width: 365, height: 245 })),
      ),
    )

    expect(scatter_mounts()).toBe(4)
    expect(root.querySelectorAll(`.scatter`)).toHaveLength(4)
    expect(error_spy.mock.calls.flat().join(` `)).not.toContain(`effect_update_depth_exceeded`)
  })

  test(`propagates rectangle zoom and reset through shared facet ranges`, async () => {
    const { context_for, panel_for } = await mount_facet_scatter()
    const keys = panel_inputs.map(({ key }) => String(key))
    await vi.waitFor(() => expect(context_for(`top-left`).ranges.x).toBeDefined())
    const initial_x = [...(context_for(`top-left`).ranges.x ?? [])]
    const initial_y = [...(context_for(`top-left`).ranges.y ?? [])]
    const svg = panel_for(`top-left`).querySelector<SVGSVGElement>(`svg[role="application"]`)
    if (!svg) throw new Error(`Top-left ScatterPlot SVG not found`)
    Object.defineProperty(svg, `getBoundingClientRect`, {
      value: () => DOMRect.fromRect({ width: 800, height: 600 }),
    })

    svg.dispatchEvent(
      new MouseEvent(`mousedown`, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 180,
        clientY: 80,
      }),
    )
    window.dispatchEvent(new MouseEvent(`mousemove`, { clientX: 600, clientY: 420 }))
    window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: 600, clientY: 420 }))
    await vi.waitFor(() => {
      const zoomed_x = context_for(`top-left`).ranges.x
      const zoomed_y = context_for(`top-left`).ranges.y
      expect(zoomed_x).not.toEqual(initial_x)
      expect(zoomed_y).not.toEqual(initial_y)
      expect(keys.map((key) => context_for(key).ranges.x)).toEqual(keys.map(() => zoomed_x))
      expect(keys.map((key) => context_for(key).ranges.y)).toEqual(keys.map(() => zoomed_y))
    })

    svg.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await vi.waitFor(() => {
      expect(keys.map((key) => context_for(key).ranges.x)).toEqual(keys.map(() => initial_x))
      expect(keys.map((key) => context_for(key).ranges.y)).toEqual(keys.map(() => initial_y))
    })
  })

  test(`settles intrinsic auto-padding reports without a render loop`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
    const auto_panels = panel_inputs.map(({ key, data }) => ({
      key,
      data: { series: data.series },
    }))
    const { context_for, scatter_mounts } = await mount_facet_scatter(auto_panels)
    const keys = auto_panels.map(({ key }) => String(key))

    await vi.waitFor(() => {
      const resolved_padding = context_for(keys[0]).padding
      expect(Object.values(resolved_padding)).toHaveLength(4)
      expect(keys.map((key) => context_for(key).padding)).toEqual(
        keys.map(() => resolved_padding),
      )
    })
    for (let settle_idx = 0; settle_idx < 10; settle_idx++) await tick()

    expect(scatter_mounts()).toBe(4)
    expect(error_spy.mock.calls.flat().join(` `)).not.toContain(`effect_update_depth_exceeded`)
  })
})
