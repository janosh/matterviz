import BarPlot from '$lib/plot/bar/BarPlot.svelte'
import BoxPlot from '$lib/plot/box/BoxPlot.svelte'
import FacetGrid from '$lib/plot/core/components/FacetGrid.svelte'
import type { FacetPanel, FacetPanelContext } from '$lib/plot/core/facets'
import Histogram from '$lib/plot/histogram/Histogram.svelte'
import BinnedScatterPlot from '$lib/plot/scatter/BinnedScatterPlot.svelte'
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

  private notify(element: Element): void {
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

type FacetPlotComponent = Component<Record<string, unknown>>
interface PlotCase {
  name: string
  component: FacetPlotComponent
  root_selector: string
  extra_props: Record<string, unknown>
}

const define_plot_case = (
  name: string,
  component: unknown,
  root_selector: string,
  extra_props: Record<string, unknown>,
): PlotCase => ({
  name,
  component: component as FacetPlotComponent,
  root_selector,
  extra_props,
})
const standard_props = { show_controls: false, legend: null }
const histogram_case = define_plot_case(`Histogram`, Histogram, `.histogram`, standard_props)
const plot_cases: PlotCase[] = [
  define_plot_case(`ScatterPlot`, ScatterPlot, `.scatter`, {
    controls: { show: false },
    legend: null,
    point_tween: { duration: 0 },
    line_tween: { duration: 0 },
  }),
  define_plot_case(`BarPlot`, BarPlot, `.bar-plot`, standard_props),
  define_plot_case(`BarPlot horizontal`, BarPlot, `.bar-plot`, {
    ...standard_props,
    orientation: `horizontal`,
  }),
  define_plot_case(`BoxPlot`, BoxPlot, `.box-plot`, standard_props),
  define_plot_case(`BoxPlot horizontal`, BoxPlot, `.box-plot`, {
    ...standard_props,
    orientation: `horizontal`,
  }),
  histogram_case,
  define_plot_case(`BinnedScatterPlot`, BinnedScatterPlot, `.binned-scatter`, {
    density: { color_bar: null },
    render_mode: `points`,
  }),
]

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
const keys = panel_inputs.map(({ key }) => String(key))
const auto_panels = panel_inputs.map(({ key, data }) => ({
  key,
  data: { series: data.series },
}))

const mounted_grids: { component: ReturnType<typeof mount>; target: HTMLElement }[] = []

const mount_facet_plot = async (plot_case: PlotCase, panels = panel_inputs) => {
  const target = document.createElement(`div`)
  document.body.append(target)
  const context_getters: (() => FacetPanelContext<PanelDatum>)[] = []
  let plot_mounts = 0
  const children = createRawSnippet<[FacetPanelContext<PanelDatum>]>((get_context) => {
    context_getters.push(get_context)
    return {
      render: () => `<div class="facet-plot-host"></div>`,
      setup: (element) => {
        const { data } = get_context()
        plot_mounts += 1
        const props: Record<string, unknown> = {
          ...plot_case.extra_props,
          series: data.series,
          padding: data.padding,
          x_axis: { label: `Shared x` },
          y_axis: { label: `Shared y` },
          fullscreen_toggle: false,
        }
        Object.defineProperty(props, `facet_layout`, { get: get_context })
        const component = mount(plot_case.component, {
          target: element,
          props,
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
    context_for,
    panel_for,
    plot_mounts: () => plot_mounts,
  }
}

const clip_rect = (panel: ParentNode): Record<`x` | `y` | `width` | `height`, number> => {
  const rect = panel.querySelector(`defs clipPath rect`)
  if (!rect) throw new Error(`Plot clip rectangle not found`)
  return {
    x: Number(rect.getAttribute(`x`)),
    y: Number(rect.getAttribute(`y`)),
    width: Number(rect.getAttribute(`width`)),
    height: Number(rect.getAttribute(`height`)),
  }
}

describe(`FacetGrid + Cartesian plots`, () => {
  afterEach(async () => {
    for (const { component, target } of mounted_grids.splice(0)) {
      await unmount(component)
      target.remove()
    }
    ControlledResizeObserver.instances.length = 0
    vi.restoreAllMocks()
  })

  afterAll(() => void (globalThis.ResizeObserver = original_resize_observer))

  test.each(plot_cases)(
    `$name aligns shared ranges and plot rectangles with only outer axes`,
    async (plot_case) => {
      const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
      const { context_for, panel_for, plot_mounts } = await mount_facet_plot(plot_case)
      const ranges = (axis: `x` | `y`) => keys.map((key) => context_for(key).ranges[axis])

      await vi.waitFor(() => {
        expect(ranges(`x`)).toEqual(keys.map(() => context_for(keys[0]).ranges.x))
        expect(ranges(`y`)).toEqual(keys.map(() => context_for(keys[0]).ranges.y))
      })

      expect(keys.map((key) => panel_for(key).querySelector(`.x-axis`) !== null)).toEqual([
        false,
        false,
        true,
        true,
      ])
      expect(keys.map((key) => panel_for(key).querySelector(`.y-axis`) !== null)).toEqual([
        true,
        false,
        true,
        false,
      ])

      for (const key of keys) {
        const plot = panel_for(key).querySelector<HTMLElement>(plot_case.root_selector)
        if (!plot) throw new Error(`No ${plot_case.name} for facet "${key}"`)
        const { width, height } = context_for(key).rect
        Object.defineProperties(plot, {
          clientWidth: { value: width, configurable: true },
          clientHeight: { value: height, configurable: true },
        })
        ControlledResizeObserver.notify(plot)
      }
      await tick()
      const expected_offsets = [
        { x: 90, y: 20 },
        { x: 0, y: 20 },
        { x: 90, y: 0 },
        { x: 0, y: 0 },
      ]
      const clips = keys.map((key) => clip_rect(panel_for(key)))
      expect(clips.map(({ x, y }) => ({ x, y }))).toEqual(expected_offsets)
      const core_sizes = keys.map((key) => {
        const { rect, padding } = context_for(key)
        return {
          width: rect.width - (padding.l ?? 0) - (padding.r ?? 0),
          height: rect.height - (padding.t ?? 0) - (padding.b ?? 0),
        }
      })
      expect(core_sizes).toEqual(keys.map(() => core_sizes[0]))
      if (plot_case.name === `ScatterPlot` || plot_case.name === `BinnedScatterPlot`) {
        for (const [clip_idx, clip] of clips.entries()) {
          expect(Math.abs(clip.width - core_sizes[clip_idx].width)).toBeLessThanOrEqual(0.5)
          expect(Math.abs(clip.height - core_sizes[clip_idx].height)).toBeLessThanOrEqual(0.5)
        }
      }

      expect(plot_mounts()).toBe(4)
      expect(error_spy.mock.calls.flat().join(` `)).not.toContain(
        `effect_update_depth_exceeded`,
      )
    },
  )

  test(`Histogram derives shared count ranges from the reconciled x domain`, async () => {
    const panel = (key: string, values: number[]): FacetPanel<PanelDatum> => ({
      key,
      data: { series: [{ x: [], y: values }] },
    })
    const clustered_panels = [
      panel(
        `low`,
        Array.from({ length: 9 }, (_, value_idx) => (value_idx + 1) / 10),
      ),
      panel(
        `high`,
        Array.from({ length: 9 }, (_, value_idx) => 90 + value_idx),
      ),
    ]
    const { context_for } = await mount_facet_plot(
      {
        ...histogram_case,
        extra_props: { ...histogram_case.extra_props, bins: 10 },
      },
      clustered_panels,
    )

    await vi.waitFor(() => {
      const low_ranges = context_for(`low`).ranges
      const high_ranges = context_for(`high`).ranges
      expect(low_ranges.x).toEqual(high_ranges.x)
      expect(low_ranges.y).toEqual(high_ranges.y)
      expect(low_ranges.y?.[1]).toBeGreaterThanOrEqual(9)
    })
  })

  test.each(plot_cases)(
    `$name propagates rectangle zoom and reset through shared ranges`,
    async (plot_case) => {
      const { context_for, panel_for } = await mount_facet_plot(plot_case)
      await vi.waitFor(() => expect(context_for(`top-left`).ranges.x).toBeDefined())
      const initial_x = [...(context_for(`top-left`).ranges.x ?? [])]
      const initial_y = [...(context_for(`top-left`).ranges.y ?? [])]
      const panel = panel_for(`top-left`)
      const plot = panel.querySelector<HTMLElement>(plot_case.root_selector)
      if (!plot) throw new Error(`Top-left ${plot_case.name} not found`)
      const svg = plot.querySelector<SVGSVGElement>(`svg[role="application"]`)

      if (svg) {
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
      } else {
        const canvas = plot.querySelector(`canvas`)
        if (!canvas) throw new Error(`${plot_case.name} canvas not found`)
        vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue(
          DOMRect.fromRect({ width: 800, height: 600 }),
        )
        const pointer = (type: string, client_x: number, client_y: number, button?: number) =>
          plot.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              button,
              pointerId: 1,
              clientX: client_x,
              clientY: client_y,
            }),
          )
        pointer(`pointerdown`, 180, 80, 0)
        pointer(`pointermove`, 600, 420)
        pointer(`pointerup`, 600, 420)
      }

      await vi.waitFor(() => {
        const zoomed_x = context_for(`top-left`).ranges.x
        const zoomed_y = context_for(`top-left`).ranges.y
        expect(zoomed_x).not.toEqual(initial_x)
        expect(zoomed_y).not.toEqual(initial_y)
        expect(keys.map((key) => context_for(key).ranges.x)).toEqual(keys.map(() => zoomed_x))
        expect(keys.map((key) => context_for(key).ranges.y)).toEqual(keys.map(() => zoomed_y))
      })

      const reset_target = svg ?? plot
      reset_target.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
      await vi.waitFor(() => {
        expect(keys.map((key) => context_for(key).ranges.x)).toEqual(keys.map(() => initial_x))
        expect(keys.map((key) => context_for(key).ranges.y)).toEqual(keys.map(() => initial_y))
      })
    },
  )

  test.each(plot_cases)(
    `$name settles intrinsic auto-padding reports without a render loop`,
    async (plot_case) => {
      const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
      const { context_for, plot_mounts } = await mount_facet_plot(plot_case, auto_panels)

      await vi.waitFor(() => {
        const { t = 0, l = 0 } = context_for(`top-left`).padding
        const { b = 0 } = context_for(`bottom-left`).padding
        const { r = 0 } = context_for(`top-right`).padding
        expect([t, b, l, r].every((size) => size > 0)).toBe(true)
        expect(keys.map((key) => context_for(key).padding)).toEqual([
          { t, b: 0, l, r: 0 },
          { t, b: 0, l: 0, r },
          { t: 0, b, l, r: 0 },
          { t: 0, b, l: 0, r },
        ])
      })
      for (let settle_idx = 0; settle_idx < 10; settle_idx++) await tick()

      expect(plot_mounts()).toBe(4)
      expect(error_spy.mock.calls.flat().join(` `)).not.toContain(
        `effect_update_depth_exceeded`,
      )
    },
  )
})
