import ScatterPlot from '$lib/plot/scatter/ScatterPlot.svelte'
import type { Vec2 } from '$lib/math'
import { COLOR_BAR_DEFAULTS, type DataSeries, type FillRegion } from '$lib/plot/core/types'
import type { FacetLayoutContext } from '$lib/plot/core/facets'
import { rects_overlap, type Rect } from '$lib/plot/core/layout'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  doc_query,
  expect_custom_x_ticks_grow_bottom_pad,
  mount_sized,
  resize_element,
  svg_query,
} from '../setup'

afterEach(() => vi.restoreAllMocks())

const basic = {
  x: [1, 2, 3, 4, 5],
  y: [5, 3, 8, 2, 7],
  point_style: { fill: `steelblue`, radius: 5 },
}

const mount_sized_scatter_plot = (
  props: Partial<ComponentProps<typeof ScatterPlot>>,
): Promise<HTMLElement> => mount_sized(ScatterPlot, props, { selector: `.scatter` })

const marker_radius = (marker: Element): number => {
  const path = marker.getAttribute(`d`) ?? ``
  const match = /^M(?<radius>-?\d*\.?\d+(?:e-?\d+)?),0/i.exec(path)
  if (!match?.groups?.radius) {
    throw new Error(`Could not read marker radius from path "${path}"`)
  }
  return Math.abs(Number(match.groups.radius))
}
const hover = async (element: Element): Promise<void> => {
  element.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
  await tick()
}
const next_animation_frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))
const move_to_marker = async (
  plot: HTMLElement,
  marker_idx: number,
  client_y?: number,
): Promise<void> => {
  const svg = plot.querySelector<SVGSVGElement>(`svg[role="application"]`)
  const marker = plot.querySelectorAll<SVGPathElement>(`.marker`).item(marker_idx)
  const transform = marker.parentElement?.getAttribute(`transform`) ?? ``
  const match = /translate\((?<x>[-\d.]+) (?<y>[-\d.]+)\)/.exec(transform)
  if (!svg || !match?.groups) throw new Error(`Expected marker ${marker_idx}`)
  Object.defineProperty(svg, `getBoundingClientRect`, {
    value: () => DOMRect.fromRect({ width: 500, height: 300 }),
  })
  svg.dispatchEvent(
    new MouseEvent(`mousemove`, {
      bubbles: true,
      clientX: Number(match.groups.x),
      clientY: client_y ?? Number(match.groups.y),
    }),
  )
  await next_animation_frame()
}
const scatter_clip_rect = (element: ParentNode): Rect => {
  const rect = element.querySelector(`defs clipPath rect`)
  if (!rect) throw new Error(`Scatter clip rectangle not found`)
  return {
    x: Number(rect.getAttribute(`x`)),
    y: Number(rect.getAttribute(`y`)),
    width: Number(rect.getAttribute(`width`)),
    height: Number(rect.getAttribute(`height`)),
  }
}
const solved_decoration_rect = (element: Element): Rect => {
  const values = [`x`, `y`, `width`, `height`].map((key) =>
    element.getAttribute(`data-decoration-${key}`),
  )
  if (values.some((value) => value == null)) {
    throw new Error(`Decoration has no solved rectangle: ${element.outerHTML}`)
  }
  const [x, y, width, height] = values.map(Number)
  return { x, y, width, height }
}
const mock_decoration_measurements = (width = 100, height = 60) => {
  vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(height)
  return vi
    .spyOn(Element.prototype, `getBoundingClientRect`)
    .mockReturnValue(DOMRect.fromRect({ width, height }))
}

describe(`ScatterPlot`, () => {
  test(`reports intrinsic layout before applying facet ranges, padding, and visibility`, async () => {
    const report_layout = vi.fn()
    const update_range = vi.fn()
    const facet_layout: FacetLayoutContext = {
      padding: { t: 17, b: 47, l: 83, r: 29 },
      ranges: { x: [-100, 100], y: [-200, 200] },
      axis_visibility: { x: false, x2: false, y: true, y2: false },
      report_layout,
      update_range,
    }
    const plot = await mount_sized_scatter_plot({
      series: [basic],
      padding: { t: 7, b: 11, l: 13, r: 17 },
      facet_layout,
      show_controls: false,
      fullscreen_toggle: false,
      legend: null,
    })

    await vi.waitFor(() => expect(report_layout).toHaveBeenCalled())
    const report = report_layout.mock.calls.at(-1)?.[0]
    expect(report).toEqual({
      padding: { t: 7, b: 11, l: 13, r: 17 },
      ranges: { x: [1, 5], x2: [0, 1], y: [2, 8], y2: [0, 1] },
    })
    expect(scatter_clip_rect(plot)).toEqual({ x: 83, y: 17, width: 288, height: 236 })
    expect(plot.querySelector(`.x-axis`)).toBeNull()
    expect(plot.querySelector(`.y-axis`)).not.toBeNull()
    expect(update_range).not.toHaveBeenCalled()
  })

  test(`unannotated series use a single unlabeled y-axis`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        { x: [1, 2], y: [1, 2], label: `A` },
        { x: [1, 2], y: [3, 4], label: `B` },
      ],
    })

    expect(plot.querySelector(`g.y2-axis`)).toBeNull()
    expect(plot.querySelector(`.y-axis .axis-label`)).toBeNull()
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(4)
  })

  test.each([
    [`closed by default`, {}, true, false],
    [`hidden`, { show_controls: false }, false, false],
    [`opened`, { controls_open: true }, true, true],
  ] as const)(`renders controls %s`, async (_desc, controls_props, visible, open) => {
    const plot = await mount_sized_scatter_plot({ series: [basic], ...controls_props })
    expect(Boolean(plot.querySelector(`.plot-controls-toggle`))).toBe(visible)
    expect(Boolean(plot.querySelector(`.pane-open`))).toBe(open)
    for (const prop_name of Object.keys(controls_props)) {
      expect(plot.hasAttribute(prop_name)).toBe(false)
    }
  })

  test(`draws a current-frame guide through the plot area`, async () => {
    const plot = await mount_sized_scatter_plot({ series: [basic], current_x_value: 3 })
    const clip = scatter_clip_rect(plot)
    const guide = plot.querySelector(`.current-frame-guide`)
    expect(guide).not.toBeNull()
    expect(guide?.getAttribute(`x1`)).toBe(guide?.getAttribute(`x2`))
    expect(Number(guide?.getAttribute(`x1`))).toBeGreaterThan(clip.x)
    expect(Number(guide?.getAttribute(`x1`))).toBeLessThan(clip.x + clip.width)
    expect([guide?.getAttribute(`y1`), guide?.getAttribute(`y2`)]).toEqual([
      String(clip.y),
      String(clip.y + clip.height),
    ])
    expect(guide?.getAttribute(`stroke-dasharray`)).toBe(`8 4`)
    expect(plot.querySelector(`.current-frame-indicator`)).not.toBeNull()
  })

  describe(`marker_renderer`, () => {
    const dense = {
      x: Array.from({ length: 40 }, (_, idx) => idx),
      y: Array.from({ length: 40 }, (_, idx) => idx % 7),
    }
    const labelled_series = (point_idx = 3) => ({
      ...dense,
      point_label: dense.x.map((_, idx) =>
        idx === point_idx ? { text: `tagged` } : { text: undefined },
      ),
    })
    const mount_canvas = (props: Partial<ComponentProps<typeof ScatterPlot>> = {}) =>
      mount_sized_scatter_plot({ series: [dense], marker_renderer: `canvas`, ...props })
    const marker_coords = (plot: ParentNode): { x: number; y: number } => {
      const transform =
        plot.querySelector(`path.marker`)?.parentElement?.getAttribute(`transform`) ?? ``
      const match = /translate\((?<x>[-\d.]+) (?<y>[-\d.]+)\)/.exec(transform)
      if (!match?.groups) throw new Error(`Could not parse marker transform "${transform}"`)
      return { x: Number(match.groups.x), y: Number(match.groups.y) }
    }
    const mock_canvas_context = (overrides: Record<string, unknown> = {}): void => {
      const stubs =
        `save restore setTransform clearRect scale beginPath rect clip moveTo arc fill stroke`.split(
          ` `,
        )
      vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
        font: ``,
        measureText: () => ({ width: 0 }),
        ...Object.fromEntries(stubs.map((name) => [name, vi.fn()])),
        ...overrides,
      } as unknown as CanvasRenderingContext2D)
    }

    test.each([
      [`auto`, false, 40],
      [`svg`, false, 40],
      [`canvas`, true, 0],
    ] as const)(`selects the %s marker layer`, async (marker_renderer, canvas, svg_count) => {
      const plot = await mount_sized_scatter_plot({ series: [dense], marker_renderer })
      expect(Boolean(plot.querySelector(`canvas.marker-canvas`))).toBe(canvas)
      expect(plot.querySelectorAll(`path.marker`)).toHaveLength(svg_count)
    })

    test(`renders SVG overlays without redrawing the base canvas on hover`, async () => {
      let arcs_since_clear = 0
      const canvas_clip = vi.fn()
      const canvas_rect = vi.fn()
      const clear_rect = vi.fn(() => (arcs_since_clear = 0))
      mock_canvas_context({
        clearRect: clear_rect,
        arc: vi.fn(() => arcs_since_clear++),
        clip: canvas_clip,
        rect: canvas_rect,
      })
      const point_idx = 3
      const overlaid = await mount_canvas({
        series: [labelled_series(point_idx)],
        selected_point: { series_idx: 0, point_idx },
        tooltip_point: {
          x: dense.x[point_idx],
          y: dense.y[point_idx],
          series_idx: 0,
          point_idx,
        },
      })
      expect(overlaid.querySelectorAll(`path.marker`)).toHaveLength(1)
      expect(
        overlaid
          .querySelector(`path.marker`)
          ?.closest(`g[data-series-id]`)
          ?.getAttribute(`clip-path`),
      ).toBeNull()
      expect(arcs_since_clear).toBe(dense.x.length - 1)
      expect(canvas_rect).not.toHaveBeenCalled()
      expect(canvas_clip).not.toHaveBeenCalled()
      expect(overlaid.querySelector(`text.label-text`)?.textContent).toBe(`tagged`)
      expect(overlaid.querySelector(`circle.effect-ring.selected`)).not.toBeNull()
      const canvas = overlaid.querySelector(`canvas.marker-canvas`)
      expect(canvas?.parentElement?.tagName.toLowerCase()).toBe(`foreignobject`)
      const ratio = globalThis.devicePixelRatio ?? 1
      expect(canvas?.getAttribute(`width`)).toBe(String(400 * ratio))
      expect(canvas?.getAttribute(`height`)).toBe(String(300 * ratio))
      expect((canvas as HTMLCanvasElement).style.width).toBe(`400px`)

      const state = $state<{
        tooltip_point: ComponentProps<typeof ScatterPlot>[`tooltip_point`]
      }>({ tooltip_point: null })
      const hover_plot = await mount_sized_scatter_plot(
        bind_props({ series: [dense], marker_renderer: `canvas` as const }, state),
      )
      const draws_before_hover = clear_rect.mock.calls.length
      state.tooltip_point = {
        x: dense.x[4],
        y: dense.y[4],
        series_idx: 0,
        point_idx: 4,
      }
      flushSync()
      await tick()
      expect(clear_rect).toHaveBeenCalledTimes(draws_before_hover)
      expect(hover_plot.querySelectorAll(`path.marker`)).toHaveLength(1)
      expect(hover_plot.querySelector(`path.marker`)?.getAttribute(`fill`)).toBe(`none`)
    })

    test(`disables point tweening for canvas overlays`, async () => {
      mock_canvas_context()
      const tweened = await mount_canvas({
        selected_point: { series_idx: 0, point_idx: 5 },
        point_tween: { duration: 60_000 },
      })
      const clip = scatter_clip_rect(tweened)
      const { x, y } = marker_coords(tweened)
      expect(
        Math.hypot(x - (clip.x + clip.width / 2), y - (clip.y + clip.height / 2)),
      ).toBeGreaterThan(10)
      expect(tweened.querySelector(`circle.effect-ring.selected`)).not.toBeNull()
    })

    test(`skips canvas markers when points are hidden`, async () => {
      const arc = vi.fn()
      mock_canvas_context({ arc })
      const hidden = await mount_canvas({ styles: { show_points: false } })
      expect(hidden.querySelectorAll(`path.marker`)).toHaveLength(0)
      expect(arc).not.toHaveBeenCalled()
    })

    test(`keeps SVG markers when point handlers require DOM events`, async () => {
      const on_point_click = vi.fn()
      const on_plot_click = vi.fn()
      const on_keydown = vi.fn()
      let plot = await mount_canvas({ on_point_click, on_plot_click })
      expect(plot.querySelector(`canvas.marker-canvas`)).toBeNull()
      expect(plot.querySelectorAll(`path.marker`)).toHaveLength(dense.x.length)
      plot
        .querySelector(`path.marker`)
        ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      expect(on_point_click).toHaveBeenCalledOnce()
      expect(on_plot_click).not.toHaveBeenCalled()
      const interactive_point = plot.querySelector<SVGGElement>(`[role="button"]`)
      expect(interactive_point?.getAttribute(`tabindex`)).toBe(`0`)
      expect(interactive_point?.getAttribute(`aria-label`)).toBe(`Select series 1 point 1`)
      interactive_point?.dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
      )
      expect(on_point_click).toHaveBeenCalledTimes(2)

      const on_context_menu = vi.fn()
      plot = await mount_canvas({
        point_events: { oncontextmenu: on_context_menu, onkeydown: on_keydown },
      })
      expect(plot.querySelector(`canvas.marker-canvas`)).toBeNull()
      plot
        .querySelector(`path.marker`)
        ?.parentElement?.dispatchEvent(
          new KeyboardEvent(`keydown`, { key: `a`, bubbles: true }),
        )
      expect(on_keydown).toHaveBeenCalledOnce()
      plot
        .querySelector(`path.marker`)
        ?.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true }))
      expect(on_context_menu).toHaveBeenCalledOnce()
    })

    test.each([
      `var(--series-color)`,
      `light-dark(black, white)`,
      `currentColor`,
      `url(#series-gradient)`,
      `color-mix(in srgb, red, blue)`,
    ])(`keeps SVG markers for canvas-unsafe color %s`, async (fill) => {
      const plot = await mount_canvas({
        series: [{ ...dense, point_style: { fill } }],
      })
      expect(plot.querySelector(`canvas.marker-canvas`)).toBeNull()
      expect(plot.querySelectorAll(`path.marker`)).toHaveLength(dense.x.length)
    })

    test(`reports point offsets in handler screen coordinates`, async () => {
      const on_point_click = vi.fn()
      const plot = await mount_canvas({
        series: [{ x: [1], y: [2], point_offset: { x: 24, y: -12 } }],
        on_point_click,
        point_tween: { duration: 0 },
      })
      await tick()
      const marker = plot.querySelector(`path.marker`)
      const { x, y } = marker_coords(plot)
      marker?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      const handler_props = on_point_click.mock.calls[0]?.[0]
      expect(handler_props?.cx).toBeCloseTo(x)
      expect(handler_props?.cy).toBeCloseTo(y)
    })
  })

  // Auto-padding has to measure the custom strings the axis actually draws, not the numeric
  // tick values behind them, or the labels tilt into a band nobody reserved.
  test(`bottom padding follows custom x tick labels, not their numeric values`, async () => {
    expect.assertions(2)
    const baseline_y = async (ticks: Record<number, string>): Promise<number> => {
      const plot = await mount_sized_scatter_plot({
        series: [basic],
        x_axis: { ticks, tick: { label: { rotation: 45 } } },
      })
      // ScatterPlot draws no x spine, so read the baseline off a tick group's translate
      const transform = plot.querySelector(`g.x-axis g.tick`)?.getAttribute(`transform`)
      return Number(/,\s*(?<axis_y>[\d.]+)\)/.exec(transform ?? ``)?.groups?.axis_y)
    }
    await expect_custom_x_ticks_grow_bottom_pad(baseline_y, [1, 2, 3, 4, 5])
  })

  test.each([
    {
      series: [{ ...basic, y: [5, 3, 20, 2, 7] }],
      x_axis: { range: [null, null] as [null, null] },
      y_axis: { range: [0, 10] as Vec2 },
      expected_markers: 4,
    },
    {
      series: [{ ...basic, x: [0, 1, 2, 3, 10] }],
      x_axis: { range: [0, 5] as Vec2 },
      y_axis: { range: [null, null] as [null, null] },
      expected_markers: 4,
    },
    { series: [], expected_markers: 0 },
    { series: [basic], legend: null, expected_markers: 5 },
    {
      series: [
        basic,
        { x: [1, 2, 3], y: [2, 5, 3], point_style: { fill: `orangered`, radius: 4 } },
      ],
      expected_markers: 8,
    },
  ])(`renders series and explicit ranges`, async ({ expected_markers, ...props }) => {
    const plot = await mount_sized_scatter_plot(props)
    const markers = [...plot.querySelectorAll(`.marker`)]
    expect(markers).toHaveLength(expected_markers)
    expect(markers.every((marker) => marker.closest(`[clip-path]`) === null)).toBe(true)
    if (props.legend === null) expect(plot.querySelector(`.legend`)).toBeNull()
  })

  // Auto visibility uses rendered entries after label deduplication and fill-region folding.
  const labeled_series = (...labels: string[]) => labels.map((label) => ({ ...basic, label }))
  const fill_region: FillRegion = { lower: 0, upper: 4, fill: `steelblue` }
  type LegendAutoCase = [string, Partial<ComponentProps<typeof ScatterPlot>>, number]
  // oxfmt-ignore
  const legend_auto_cases: LegendAutoCase[] = [
    [`distinct labels auto-show`, { series: labeled_series(`A`, `B`) }, 2],
    [`duplicate labels auto-hide`, { series: labeled_series(`Dup`, `Dup`) }, 0],
    [`explicit true opens one deduped entry`, { series: labeled_series(`Dup`, `Dup`), show_legend: true }, 1],
    [`labelled fill region counts`, { series: labeled_series(`A`), fill_regions: [{ ...fill_region, label: `Band` }] }, 2],
    [`unlabelled fill region does not count`, { series: labeled_series(`A`), fill_regions: [fill_region] }, 0],
  ]
  test.each(legend_auto_cases)(
    `legend auto rule: %s`,
    async (_desc, props, expected_entries) => {
      const plot = await mount_sized_scatter_plot(props)
      expect(Boolean(plot.querySelector(`.legend`))).toBe(expected_entries > 0)
      expect(plot.querySelectorAll(`.legend .legend-item`)).toHaveLength(expected_entries)
    },
  )

  test(`legend-hidden series stays hidden across one-way series replacement until the parent flips visible`, async () => {
    const make_series = (first_extra: Partial<DataSeries> = {}): DataSeries[] => [
      { ...basic, id: `a`, label: `A`, ...first_extra },
      { ...basic, id: `b`, label: `B` },
    ]
    const state = $state({ series: make_series() })
    // getter-only prop: one-way, the component cannot write back into the parent
    const plot = await mount_sized_scatter_plot({
      get series() {
        return state.series
      },
    })
    const first_hidden = () =>
      plot.querySelector<HTMLElement>(`.legend-item`)?.classList.contains(`hidden`)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(10)

    plot.querySelector<HTMLElement>(`.legend-item`)?.click()
    flushSync()
    expect(first_hidden()).toBe(true)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(5)
    expect(state.series[0].visible).toBeUndefined()

    // parent rebuilds the array (anywidget trait sync, notebook re-render, ...)
    state.series = make_series()
    flushSync()
    expect(first_hidden()).toBe(true)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(5)

    // parent explicitly shows it again: the user's override yields
    state.series = make_series({ visible: true })
    flushSync()
    expect(first_hidden()).toBe(false)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(10)
  })

  test(`x hover resolves duplicate x-values by vertical distance`, async () => {
    const on_point_hover = vi.fn()
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 1, 1], y: [0, 0.5, 1], markers: `points` }],
      x_axis: { range: [0, 2] },
      y_axis: { range: [0, 1] },
      hover_config: { mode: `x`, threshold_px: 5, show_tooltip: false },
      point_tween: { duration: 0 },
      on_point_hover,
      legend: null,
    })
    await move_to_marker(plot, 2)
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover.mock.calls[0][0]).toMatchObject({ x: 1, y: 1 })
  })

  test(`line underlays stay out of legends, controls, and hover`, async () => {
    const on_point_hover = vi.fn()
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          id: `trend`,
          x: [0, 1, 2],
          y: [0, 1, 0],
          label: `Energy`,
          markers: `line+points`,
          line_style: { stroke: `red`, stroke_width: 2 },
          line_underlays: [
            {
              x: [0, 1, 2],
              y: [100, 100, 100],
              line_style: { stroke: `blue`, stroke_width: 1 },
            },
          ],
        },
      ],
      x_axis: { range: [0, 2] },
      hover_config: { mode: `x`, threshold_px: 5, show_tooltip: false },
      point_tween: { duration: 0 },
      on_point_hover,
      show_legend: true,
      controls_open: true,
    })

    const lines = plot.querySelectorAll(`g[data-series-id="trend"] path[fill="none"]`)
    expect(lines).toHaveLength(2)
    expect(plot.querySelector(`.y-axis`)?.textContent).toContain(`100`)
    expect(plot.querySelectorAll(`.legend .legend-item`)).toHaveLength(1)
    expect(
      [...plot.querySelectorAll(`label > span`)].some(
        (element) => element.textContent === `Series`,
      ),
    ).toBe(false)

    const line_width_input = doc_query(
      `[data-key="line.width"] input[type="range"]`,
      HTMLInputElement,
    )
    line_width_input.value = `5`
    line_width_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect([...lines].map((line) => line.getAttribute(`stroke-width`))).toEqual([`1`, `5`])

    await move_to_marker(plot, 1)
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover.mock.calls[0][0]).toMatchObject({ x: 1, y: 1 })
  })

  test(`child marks and rectangle zoom do not trigger plot clicks`, async () => {
    const on_plot_click = vi.fn()
    const on_fill_click = vi.fn()
    const on_ref_line_click = vi.fn()
    const plot = await mount_sized_scatter_plot({
      series: [basic],
      fill_regions: [{ lower: 0, upper: 4, on_click: on_fill_click }],
      ref_lines: [{ type: `vertical`, x: 2, on_click: on_ref_line_click }],
      on_plot_click,
      point_tween: { duration: 0 },
    })
    plot
      .querySelector(`.fill-region`)
      ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    plot
      .querySelector(`.reference-line`)
      ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    expect(on_fill_click).toHaveBeenCalledOnce()
    expect(on_ref_line_click).toHaveBeenCalledOnce()
    expect(on_plot_click).not.toHaveBeenCalled()

    const svg = plot.querySelector<SVGSVGElement>(`svg[role="application"]`)
    const clip = scatter_clip_rect(plot)
    if (!svg) throw new Error(`scatter SVG not found`)
    svg.dispatchEvent(
      new MouseEvent(`mousedown`, {
        bubbles: true,
        button: 0,
        clientX: clip.x + 10,
        clientY: clip.y + 10,
      }),
    )
    window.dispatchEvent(
      new MouseEvent(`mousemove`, {
        buttons: 1,
        clientX: clip.x + 80,
        clientY: clip.y + 80,
      }),
    )
    window.dispatchEvent(
      new MouseEvent(`mouseup`, { clientX: clip.x + 80, clientY: clip.y + 80 }),
    )
    svg.dispatchEvent(
      new MouseEvent(`click`, {
        bubbles: true,
        detail: 1,
        clientX: clip.x + 80,
        clientY: clip.y + 80,
      }),
    )
    expect(on_plot_click).not.toHaveBeenCalled()
  })

  test(`does not render a colorbar in a zero-sized plot`, async () => {
    vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(0)
    vi.spyOn(HTMLElement.prototype, `clientHeight`, `get`).mockReturnValue(0)
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{ ...basic, color_values: basic.x }],
        color_bar: {},
      },
    })
    await tick()
    expect(document.querySelector(`.colorbar-wrapper`)).toBeNull()
  })

  test.each([
    [`points only`, `points`, 5, 3, undefined],
    [`line+points`, `line+points`, 5, 2.5, undefined],
    [`dense points only`, `points`, 101, 2.5, undefined],
    [`dense line+points`, `line+points`, 101, 2, undefined],
    [`explicit dense line+points`, `line+points`, 101, 6, 6],
  ] as const)(
    `uses the expected marker radius for %s`,
    async (_desc, markers, count, expected_radius, explicit_radius) => {
      const series = [
        {
          x: Array.from({ length: count }, (_, idx) => idx),
          y: Array.from({ length: count }, (_, idx) => idx % 10),
          markers,
          point_style: explicit_radius === undefined ? undefined : { radius: explicit_radius },
        },
      ]
      const plot = await mount_sized_scatter_plot({ series, legend: null })
      expect(marker_radius(plot.querySelector(`.marker`) as Element)).toBeCloseTo(
        expected_radius,
        6,
      )
    },
  )

  test(`uses a thin border that follows the plot color`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1], y: [2], markers: `points` }],
      legend: null,
      style: `color: rgb(120, 130, 140)`,
    })
    const marker = plot.querySelector(`.marker`)
    expect(marker?.getAttribute(`stroke`)).toBe(`rgb(120, 130, 140)`)
    expect(marker?.getAttribute(`stroke-width`)).toBe(`0.5`)
    expect(marker?.getAttribute(`stroke-opacity`)).toBe(`0.45`)

    plot.style.color = `rgb(40, 50, 60)`
    await vi.waitFor(() => expect(marker?.getAttribute(`stroke`)).toBe(`rgb(40, 50, 60)`))
  })

  // guards the line_style.curve -> <Line> wiring (the Line unit test alone wouldn't catch
  // ScatterPlot dropping `curve={ls?.curve}`). cubic `C` commands appear only for splines.
  test.each([
    [`linear`, false], // straight segments -> no cubic Bézier anywhere
    [`monotone`, true], // default spline -> cubic Bézier present
  ] as const)(
    `line_style.curve=%s flows through to the rendered line`,
    async (curve, cubic) => {
      const series: DataSeries[] = [
        { x: [0, 1, 2, 3], y: [0, 8, 1, 9], markers: `line`, line_style: { curve } },
      ]
      const plot = await mount_sized_scatter_plot({
        series,
        line_tween: { duration: 0 }, // disable path morph so the final `d` is set synchronously
        legend: null,
      })
      const has_cubic = [...plot.querySelectorAll(`path`)].some((path) =>
        (path.getAttribute(`d`) ?? ``).includes(`C`),
      )
      expect(has_cubic).toBe(cubic)
    },
  )

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        { x: [1, 2, 3], y: [10, 20, 30], label: `Primary` },
        { x: [100, 200, 300], y: [5, 15, 25], x_axis: `x2`, label: `Secondary` },
      ],
      x2_axis: { label: `Temperature (K)` },
    })
    expect(plot.querySelector(`g.x2-axis`)).toBeInstanceOf(SVGGElement)
    expect(plot.querySelector(`.x2-label`)?.textContent).toBe(`Temperature (K)`)
  })

  test.each([`x2`, `y2`] as const)(
    `does not render the %s axis without a finite x/y pair`,
    async (axis) => {
      const invalid_series: DataSeries =
        axis === `x2`
          ? { x: [1, NaN], y: [NaN, 2], x_axis: `x2` }
          : { x: [1, NaN], y: [NaN, 2], y_axis: `y2` }
      const plot = await mount_sized_scatter_plot({
        series: [{ x: [1, 2], y: [3, 4], y_axis: `y1` }, invalid_series],
      })
      expect(plot.querySelector(`g.${axis}-axis`)).toBeNull()
    },
  )

  test(`reassigns visible unit groups and inferred axes after visibility changes`, async () => {
    const state = $state({
      series: [
        { x: [1, 2], y: [-2, -1], label: `Energy`, unit: `eV` },
        { x: [1, 2], y: [10, 20], label: `Pressure`, unit: `GPa` },
      ] as DataSeries[],
    })
    const plot = await mount_sized_scatter_plot(bind_props({}, state))

    expect(plot.querySelector(`.y-label`)?.textContent).toContain(`Energy (eV)`)
    expect(plot.querySelector(`.y2-label`)?.textContent).toContain(`Pressure (GPa)`)

    state.series[0].visible = false
    flushSync()
    await tick()

    expect(plot.querySelector(`.y-label`)?.textContent).toContain(`Pressure (GPa)`)
    expect(plot.querySelector(`g.y2-axis`)).toBeNull()
  })

  test(`preserves explicit y_axis assignments while filling the remaining axis`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: [1, 2],
          y: [1e-8, 1],
          label: `Residual`,
          unit: `eV`,
          axis_group: `scf`,
          y_axis: `y2`,
        },
        { x: [1, 2], y: [-2, -1], label: `Energy`, unit: `eV` },
      ],
      y2_axis: { scale_type: `linear` },
    })

    expect(plot.querySelector(`.y-label`)?.textContent).toContain(`Energy (eV)`)
    expect(plot.querySelector(`.y2-label`)?.textContent).toContain(`Residual (eV)`)
  })

  test(`infers a logarithmic scale for a wide positive axis_group`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: [1, 2, 3],
          y: [1e-6, 1e-3, 1],
          label: `Residual`,
          unit: `eV`,
          axis_group: `scf`,
        },
      ],
      point_tween: { duration: 0 },
    })
    const marker_y = [...plot.querySelectorAll(`.marker`)].map((marker) => {
      const transform = marker.parentElement?.getAttribute(`transform`) ?? ``
      const match = /translate\([^ ]+ (?<y>[-\d.]+)\)/.exec(transform)
      if (!match?.groups?.y) throw new Error(`Could not parse marker transform "${transform}"`)
      return Number(match.groups.y)
    })
    const spacing = marker_y.slice(1).map((value, idx) => Math.abs(value - marker_y[idx]))

    expect(spacing[0] / spacing[1]).toBeCloseTo(1, 1)
  })

  // A plot appearing on screen must not animate itself into place: markers used to fly in
  // from the plot centre and lines to morph out of an empty path. Zero and long tween
  // durations must therefore mount to identical geometry.
  test.each([
    [
      `point_tween`,
      `.marker`,
      (marker: Element) => marker.parentElement?.getAttribute(`transform`),
    ],
    [`line_tween`, `path[stroke-width]`, (path: Element) => path.getAttribute(`d`)],
  ] as const)(
    `mounts at final geometry regardless of %s duration`,
    async (tween_prop, selector, read) => {
      const series: DataSeries[] = [{ x: [1, 2, 3], y: [4, 6, 5], markers: `line+points` }]
      const geometry = async (duration: number) => {
        const plot = await mount_sized_scatter_plot({
          series,
          [tween_prop]: { duration },
          legend: null,
        })
        return [...plot.querySelectorAll(selector)].map(read)
      }

      const [instant, tweened] = [await geometry(0), await geometry(60_000)]
      expect(tweened.filter(Boolean).length).toBeGreaterThan(0)
      expect(tweened).toEqual(instant)
    },
  )

  test(`reports all visible group keys when more than two axes are required`, async () => {
    const target = document.createElement(`div`)
    document.body.append(target)
    expect(() =>
      flushSync(() =>
        mount(ScatterPlot, {
          target,
          props: {
            style: `width: 400px; height: 300px;`,
            series: [
              { x: [1], y: [1], label: `Energy`, unit: `eV` },
              { x: [1], y: [1], label: `Pressure`, unit: `GPa` },
              { x: [1], y: [1], label: `Temperature`, unit: `K` },
            ],
          },
        }),
      ),
    ).toThrow(
      `ScatterPlot cannot automatically assign visible value series: Cannot assign 3 visible axis groups to 2 axes: eV, GPa, K. Set y_axis explicitly or hide an axis group.`,
    )
  })

  test.each([
    {
      x: [0, 10, 20, 30, 40, 50],
      x_axis: { ticks: -10, format: `.0r` },
      y_axis: { ticks: -5, format: `.0r` },
    },
    {
      x: Array.from({ length: 12 }, (_, idx) =>
        new Date().setMonth(new Date().getMonth() - (12 - idx)),
      ),
      x_axis: { ticks: `month`, scale_type: `time` as const, format: `%b %Y` },
    },
  ])(`tick formatting`, async ({ x, x_axis, y_axis }) => {
    const y = x.map((_value, idx) => 12 * (idx + 1))
    const plot = await mount_sized_scatter_plot({
      series: [{ x, y, point_style: { fill: `steelblue`, radius: 5 } }],
      x_axis,
      y_axis,
    })
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(x.length)
    const x_tick_labels = [...plot.querySelectorAll(`.x-axis .tick text`)].map(
      (tick_label) => tick_label.textContent,
    )
    if (x_axis.format.startsWith(`%`)) {
      expect(x_tick_labels.length).toBeGreaterThan(1)
      expect(x_tick_labels.every((label) => /^\w{3} \d{4}$/.test(label ?? ``))).toBe(true)
    } else expect(x_tick_labels).toEqual([`0`, `10`, `20`, `30`, `40`, `50`])
    expect(plot.querySelectorAll(`.y-axis .tick text`).length).toBeGreaterThan(1)
  })

  test(`increases automatic tick precision when compact labels would collide`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [0, 1], y: [-1539, -1537] }],
      y_axis: { ticks: [-1539, -1538, -1537] },
    })
    expect(
      [...plot.querySelectorAll(`.y-axis .tick text`)].map(
        (tick_element) => tick_element.textContent,
      ),
    ).toEqual([`−1539`, `−1538`, `−1537`])
  })

  describe(`default tooltip content`, () => {
    const tooltip_text = async (props: Record<string, unknown>): Promise<string> => {
      document.body.replaceChildren()
      mount(ScatterPlot, { target: document.body, props: { hovered: true, ...props } })
      await tick()
      return document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    }

    test(`shows axis labels instead of bare x/y`, async () => {
      const text = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30] }],
        x_axis: { label: `Time (s)` },
        y_axis: { label: `Speed` },
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      })
      expect(text).toContain(`Time (s)`)
      expect(text).toContain(`Speed`)
    })

    test(`shows series label only when multiple series`, async () => {
      const multi = await tooltip_text({
        series: [
          { x: [1, 2, 3], y: [10, 20, 30], label: `Alpha` },
          { x: [1, 2, 3], y: [5, 15, 25], label: `Beta` },
        ],
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      })
      expect(multi).toContain(`Alpha`)

      const single = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30], label: `Only` }],
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      })
      expect(single).not.toContain(`Only`)
    })

    test(`shows color value with title, falls back to "Color"`, async () => {
      const with_title = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30], color_values: [100, 200, 300] }],
        color_bar: { title: `Temperature` },
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1, color_value: 200 },
      })
      expect(with_title).toContain(`Temperature`)
      expect(with_title).toContain(`200`)

      const no_title = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30], color_values: [100, 200, 300] }],
        color_bar: {},
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1, color_value: 200 },
      })
      expect(no_title).toContain(`Color`)
      expect(no_title).toContain(`200`)
    })
  })

  test(`invalid data`, async () => {
    const invalid = [
      {
        x: [1, 2, null, 4, 5] as (number | null)[],
        y: [5, 4, undefined, 2, 1] as (number | null)[],
      },
      null,
      undefined,
      { x: [10, 20, 30, 40, 50], y: [10, 20, 30, NaN, NaN] },
      { x: [100, 200, 300], y: [10, 20, 30] },
    ] as DataSeries[]
    const invalid_plot = await mount_sized_scatter_plot({ series: invalid })
    expect(invalid_plot.querySelectorAll(`.marker`)).toHaveLength(10)
    document.body.replaceChildren()

    // Null entries must survive the auto-label scan. A throw there only kills the placement
    // effect, so assert placement actually ran: unplaced labels keep the default 10/0 offset.
    const labelled = await mount_sized_scatter_plot({
      series: [
        null,
        {
          x: [1, 5],
          y: [1, 5],
          point_label: [
            { text: `A`, auto_placement: true },
            { text: `B`, auto_placement: true },
          ],
        },
      ] as DataSeries[],
    })
    const label_xs = [...labelled.querySelectorAll(`text.label-text`)].map((label) =>
      label.getAttribute(`x`),
    )
    expect(label_xs).toHaveLength(2)
    expect(label_xs).not.toContain(`10`) // 10 is the un-placed fallback offset
    document.body.replaceChildren()

    const out_of_range_plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 2, 3], y: [4, 5, 6] }],
      x_axis: { range: [100, 200] },
      y_axis: { range: [100, 200] },
    })
    expect(out_of_range_plot.querySelectorAll(`.marker`)).toHaveLength(0)
  })

  test.each([
    { y: [-10, -5, 0, 5, 10], y_range: [-15, 15] as Vec2 },
    { y: [5, 10, 15, 20, 25], y_range: [0, 30] as Vec2 },
  ])(`zero lines`, async ({ y, y_range }) => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 2, 3, 4, 5], y }],
      y_axis: { range: y_range },
    })
    expect(plot.querySelectorAll(`.zero-line`)).toHaveLength(1)
  })

  test.each([
    {
      tooltip_point: {
        x: new Date(2023, 5, 15).getTime(),
        y: 123.45,
        series_idx: 0,
        point_idx: 0,
      },
      x_axis: { scale_type: `time` as const, format: `%b %d, %Y` },
      y_axis: { format: `.2r` },
      expected: [`Jun 15, 2023`, `120`],
    },
    {
      tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      expected: [`2`, `20`],
    },
  ])(`tooltip format`, async ({ expected, ...props }) => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 2, 3], y: [10, 20, 30] }],
      hovered: true,
      ...props,
    })
    const tooltip_text = plot.querySelector(`.plot-tooltip`)?.textContent
    for (const text of expected) expect(tooltip_text).toContain(text)
  })

  test(`children prop`, () => {
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [basic],
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-scatter-child">Custom overlay content</div>`,
        })),
      },
    })
    expect(document.querySelector(`.custom-scatter-child`)?.textContent).toBe(
      `Custom overlay content`,
    )
  })

  test(`cold-solves labels after placement config changes`, async () => {
    const props = $state({
      series: [
        {
          x: [0.5],
          y: [0.5],
          point_label: { text: `A`, auto_placement: true, font_size: `10px` },
        },
      ],
      x_axis: { range: [0, 1] as Vec2 },
      y_axis: { range: [0, 1] as Vec2 },
      label_placement_config: { sa_iterations: 0, candidate_gap: 0 },
      point_tween: { duration: 0 },
      show_controls: false,
      legend: null,
    })
    const plot = await mount_sized_scatter_plot(props)
    const label_offset = () => {
      const label = plot.querySelector(`text.label-text`)
      if (!label) throw new Error(`auto-placed label not rendered`)
      return { x: Number(label.getAttribute(`x`)), y: Number(label.getAttribute(`y`)) }
    }
    const initial_offset = label_offset()

    props.label_placement_config = { sa_iterations: 0, candidate_gap: 100 }
    await tick()

    expect(label_offset()).not.toEqual(initial_offset)
  })

  test(`hides auto labels culled by max_neighbors`, async () => {
    const coords = [...Array.from({ length: 6 }, (_val, idx) => 1 + idx * 0.001), 100]
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: coords,
          y: coords,
          point_label: coords.map((_coord, idx) => ({
            text: idx < 6 ? `C${idx}` : `Lonely`,
            auto_placement: true,
            font_size: `10px`,
          })),
        },
      ],
      label_placement_config: { max_neighbors: { count: 1, radius: 30 }, sa_iterations: 0 },
    })

    expect(
      [...plot.querySelectorAll(`text.label-text`)].map((label) => label.textContent),
    ).toEqual([`Lonely`])
  })

  test(`coalesces pointer hover to the latest point and clears it on leave`, async () => {
    const on_point_hover = vi.fn()
    const on_pointer_leave = vi.fn()
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [0, 1], y: [0, 1], markers: `points` }],
      x_axis: { range: [0, 1] },
      y_axis: { range: [0, 1] },
      point_tween: { duration: 0 },
      on_point_hover,
      on_pointer_leave,
      legend: null,
    })
    const svg = plot.querySelector<SVGSVGElement>(`svg[role="application"]`)
    const markers = [...plot.querySelectorAll<SVGPathElement>(`.marker`)]
    if (!svg || markers.length !== 2) throw new Error(`expected chart SVG with two markers`)
    Object.defineProperty(svg, `getBoundingClientRect`, {
      value: () => DOMRect.fromRect({ width: 500, height: 300 }),
    })
    const marker_coords = markers.map((marker) => {
      const transform = marker.parentElement?.getAttribute(`transform`) ?? ``
      const match = /translate\((?<x>[-\d.]+) (?<y>[-\d.]+)\)/.exec(transform)
      if (!match?.groups) throw new Error(`could not parse marker transform "${transform}"`)
      return { x: Number(match.groups.x), y: Number(match.groups.y) }
    })

    for (const { x, y } of marker_coords) {
      svg.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX: x, clientY: y }))
    }
    expect(on_point_hover).not.toHaveBeenCalled()
    await next_animation_frame()
    expect(on_point_hover).toHaveBeenCalledTimes(1)
    expect(on_point_hover.mock.calls[0][0]).toMatchObject({ x: 1, y: 1 })

    svg.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
    expect(on_pointer_leave).toHaveBeenCalledOnce()

    on_point_hover.mockClear()
    on_pointer_leave.mockClear()
    for (const { x, y } of marker_coords) {
      svg.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX: x, clientY: y }))
    }
    svg.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
    expect(on_pointer_leave).toHaveBeenCalledOnce()
    await next_animation_frame()
    expect(on_point_hover).toHaveBeenCalledOnce()
  })

  test.each([
    { label: `ascending`, x_values: [0, 1, 2], target_idx: 1 },
    { label: `descending`, x_values: [2, 1, 0], target_idx: 1 },
    { label: `unordered`, x_values: [0, 2, 1], target_idx: 2 },
  ])(
    `x hover finds the nearest $label point without vertical proximity`,
    async ({ x_values, target_idx }) => {
      const on_point_hover = vi.fn()
      const y_values = [0, 1, 0]
      const plot = await mount_sized_scatter_plot({
        series: [{ x: x_values, y: y_values, markers: `points` }],
        x_axis: { range: [0, 2] },
        y_axis: { range: [0, 1] },
        hover_config: { mode: `x`, threshold_px: 5, show_tooltip: false },
        point_tween: { duration: 0 },
        on_point_hover,
        legend: null,
      })
      const svg = plot.querySelector<SVGSVGElement>(`svg[role="application"]`)
      const target_marker = plot.querySelectorAll<SVGPathElement>(`.marker`).item(target_idx)
      const transform = target_marker.parentElement?.getAttribute(`transform`) ?? ``
      const match = /translate\((?<x>[-\d.]+) (?<y>[-\d.]+)\)/.exec(transform)
      if (!svg || !match?.groups) throw new Error(`expected the middle scatter marker`)
      Object.defineProperty(svg, `getBoundingClientRect`, {
        value: () => DOMRect.fromRect({ width: 500, height: 300 }),
      })

      const far_y = Number(match.groups.y) < 150 ? 290 : 10
      svg.dispatchEvent(
        new MouseEvent(`mousemove`, {
          bubbles: true,
          clientX: Number(match.groups.x),
          clientY: far_y,
        }),
      )
      await next_animation_frame()

      expect(on_point_hover).toHaveBeenCalledOnce()
      expect(on_point_hover.mock.calls[0][0]).toMatchObject({
        x: x_values[target_idx],
        y: y_values[target_idx],
      })
      expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
    },
  )

  test(`cancels queued pointer hover when destroyed`, async () => {
    vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, `clientHeight`, `get`).mockReturnValue(300)
    const on_point_hover = vi.fn()
    const component = mount(ScatterPlot, {
      target: document.body,
      props: { series: [{ x: [0], y: [0] }], on_point_hover },
    })
    flushSync()
    document
      .querySelector(`svg`)
      ?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX: 1, clientY: 1 }))
    await unmount(component)
    await next_animation_frame()

    expect(on_point_hover).not.toHaveBeenCalled()
  })

  // Remaining cursor-style behavior lives in Playwright because happy-dom lacks
  // dimensions unless each chart element is explicitly stubbed as above.

  test(`svg aria-label derives from axis labels`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [basic],
      x_axis: { label: `Temperature` },
      y_axis: { label: `Pressure` },
    })
    const svg = plot.querySelector(`svg[role="application"]`)
    if (!(svg instanceof SVGSVGElement)) throw new Error(`ScatterPlot SVG not rendered`)

    expect(svg.getAttribute(`aria-label`)).toBe(`Temperature vs Pressure`)
    expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Temperature`)
    expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`Pressure`)
  })

  const fill_plot_props = (): Partial<ComponentProps<typeof ScatterPlot>> => ({
    series: [{ x: [0, 1], y: [0, 1] }],
    x_axis: { range: [0, 1] as Vec2 },
    y_axis: { range: [0, 1] as Vec2 },
    legend: null,
  })

  test(`keeps fallback-index and explicit-id fill hovers distinct`, async () => {
    const make_fills = (): FillRegion[] => [
      { id: `lead`, lower: 0, upper: 0.1, fill: `transparent` },
      { lower: 0.2, upper: 0.4, fill: `steelblue` },
      { id: `1`, lower: 0.5, upper: 0.7, fill: `slategray` },
    ]
    const state = $state({ fill_regions: make_fills() })
    await mount_sized_scatter_plot(bind_props(fill_plot_props(), state))

    const fallback_fill = () => svg_query(`[aria-label="Fill region 1"]`)
    const explicit_id_fill = () => svg_query(`[aria-label="Fill region 2"]`)
    await hover(fallback_fill())
    expect(fallback_fill().classList.contains(`hovered`)).toBe(true)
    expect(explicit_id_fill().classList.contains(`hovered`)).toBe(false)

    state.fill_regions = make_fills()
    flushSync()
    await tick()
    expect(fallback_fill().classList.contains(`hovered`)).toBe(true)
  })

  test(`keeps unique fill ID hover stable when source index changes`, async () => {
    const state = $state({
      fill_regions: [{ id: `target`, lower: 0, upper: 0.2, fill: `steelblue` }],
    })
    await mount_sized_scatter_plot(bind_props(fill_plot_props(), state))

    await hover(svg_query(`[aria-label="Fill region 0"]`))
    state.fill_regions = [
      { id: `inserted`, lower: 0.3, upper: 0.4, fill: `transparent` },
      { id: `target`, lower: 0, upper: 0.2, fill: `steelblue` },
    ]
    flushSync()
    await tick()

    const fills = document.querySelectorAll<SVGGElement>(`.fill-region`)
    expect(fills).toHaveLength(2)
    expect(fills[1].classList.contains(`hovered`)).toBe(true)
  })

  test(`keeps duplicate fill IDs keyed and hovered independently`, async () => {
    const fill_regions: FillRegion[] = [
      { id: `duplicate`, lower: 0, upper: 0.2, fill: `steelblue` },
      { id: `duplicate`, lower: 0.4, upper: 0.6, fill: `slategray` },
    ]
    await mount_sized_scatter_plot({ ...fill_plot_props(), fill_regions })

    const fills = document.querySelectorAll<SVGGElement>(`.fill-region`)
    expect(fills).toHaveLength(fill_regions.length)

    await hover(fills[0])
    expect(fills[0].classList.contains(`hovered`)).toBe(true)
    expect(fills[1].classList.contains(`hovered`)).toBe(false)
  })

  test(`legend clicks toggle and isolate fills, and a hidden fill keeps its legend item`, async () => {
    const state = $state({
      fill_regions: [
        { id: `band`, label: `Band`, lower: 0, upper: 0.5, fill: `steelblue` },
        { id: `cap`, label: `Cap`, lower: 0.6, upper: 0.8, fill: `tomato` },
      ] as FillRegion[],
    })
    await mount_sized_scatter_plot(bind_props({ ...fill_plot_props(), legend: {} }, state))
    await tick()

    const fill_item = (label: string) =>
      [...document.querySelectorAll<HTMLElement>(`.legend-item.fill-item`)].find((el) =>
        el.textContent?.includes(label),
      )
    const fire = async (label: string, type: `click` | `dblclick`) => {
      fill_item(label)?.dispatchEvent(new MouseEvent(type, { bubbles: true }))
      flushSync()
      await tick()
    }
    const visibility = () => state.fill_regions.map((region) => region.visible)

    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(2)

    // click hides only that fill (writes `visible` into the bound fill_regions); the fill is
    // no longer drawn, but its legend item persists (greyed) so it can be toggled back
    await fire(`Band`, `click`)
    expect(visibility()).toEqual([false, undefined])
    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(1)
    expect(fill_item(`Band`)?.classList.contains(`hidden`)).toBe(true)

    // hovering the hidden fill's legend item must not mark it active (nothing renders to highlight)
    fill_item(`Band`)?.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    flushSync()
    await tick()
    expect(fill_item(`Band`)?.classList.contains(`active`)).toBe(false)

    await fire(`Band`, `click`)
    expect(visibility()).toEqual([true, undefined])

    // double-click isolates the fill; a second double-click on the sole visible fill shows all
    await fire(`Cap`, `dblclick`)
    expect(visibility()).toEqual([false, true])
    await fire(`Cap`, `dblclick`)
    expect(visibility()).toEqual([true, true])
    // double-clicking a hidden fill while another is visible isolates the clicked one
    await fire(`Band`, `dblclick`)
    expect(visibility()).toEqual([true, false])
  })

  test(`log axis clamps non-positive fill coords to the domain floor, not a tiny epsilon`, async () => {
    // lower edge at y=0 is non-positive on a log axis: must clamp to y_min (bottom edge), not
    // 1e-10 which maps far outside the plot.
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [1, 10, 100], y: [2, 20, 80] }],
        x_axis: { range: [1, 100] as Vec2 },
        y_axis: { scale_type: `log`, range: [1, 100] as Vec2 },
        fill_regions: [{ lower: 0, upper: { type: `series`, series_idx: 0 } }],
      },
    })
    // wait for the path Tween to settle (`d` unchanged across two polls) so we read the final
    // coords, not a wild mid-animation frame — deterministic instead of a fixed sleep
    let last_d = ``
    const settled_d = await vi.waitFor(
      () => {
        const path_d = doc_query(`.fill-region path`).getAttribute(`d`) ?? ``
        const settled = path_d !== `` && path_d === last_d
        last_d = path_d
        if (!settled) throw new Error(`fill path not settled`)
        return path_d
      },
      { timeout: 2000 },
    )

    const coords = (settled_d.match(/-?\d+\.?\d*/g) ?? []).map(Number)
    expect(coords.length).toBeGreaterThan(0) // guard: Math.max(...[]) is -Infinity, a false pass
    expect(Math.max(...coords.map(Math.abs))).toBeLessThan(1000)
  })

  // Dense grid covering the whole plot so no decoration can avoid overlapping data
  const dense_grid = (grid_n: number): { x: number[]; y: number[] } => {
    const x: number[] = []
    const y: number[] = []
    for (let row = 0; row < grid_n; row++) {
      for (let col = 0; col < grid_n; col++) {
        x.push((row / (grid_n - 1)) * 100)
        y.push((col / (grid_n - 1)) * 100)
      }
    }
    return { x, y }
  }
  const decorated_series = (): DataSeries[] => [
    { ...basic, label: `A`, color_values: basic.x },
    { ...basic, label: `B` },
  ]

  test(`keeps overflowing colorbar ticks clear of the plot axes`, async () => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(220)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(30)
    vi.spyOn(Element.prototype, `getBoundingClientRect`).mockImplementation(
      function (this: Element): DOMRect {
        if (this.classList.contains(`tick-label`)) {
          return DOMRect.fromRect({ x: 90, y: 128, width: 240, height: 18 })
        }
        return DOMRect.fromRect({ x: 100, y: 100, width: 220, height: 30 })
      },
    )
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [0, 100], y: [90, 90], color_values: [1, 2] }],
      x_axis: { range: [0, 100] },
      y_axis: { range: [0, 100] },
      legend: null,
      color_bar: {},
    })

    await vi.waitFor(() => {
      const colorbar = doc_query(`.colorbar-wrapper`)
      const visual_rect = solved_decoration_rect(colorbar)
      const plot_rect = scatter_clip_rect(plot)
      expect(visual_rect).toMatchObject({ width: 240, height: 46 })
      const horizontal_gap = Math.min(
        visual_rect.x - plot_rect.x,
        plot_rect.x + plot_rect.width - (visual_rect.x + visual_rect.width),
      )
      expect(horizontal_gap).toBe(COLOR_BAR_DEFAULTS.axis_clearance)
      expect(visual_rect.y + visual_rect.height).toBeLessThanOrEqual(
        plot_rect.y + plot_rect.height - COLOR_BAR_DEFAULTS.axis_clearance,
      )
      expect(Number(colorbar.style.left.replace(`px`, ``))).toBe(visual_rect.x + 10)
    })
  })

  test(`uses solver-provided automatic legend tracks`, async () => {
    mock_decoration_measurements()
    const plot = await mount_sized_scatter_plot({
      series: [`A`, `B`, `C`].map((label, idx) => ({
        x: [1, 2],
        y: [idx, idx + 1],
        label,
      })),
      legend: { layout: `horizontal`, layout_tracks: `auto` },
    })

    await vi.waitFor(() =>
      expect(plot.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateColumns).toBe(
        `repeat(3, auto)`,
      ),
    )
  })

  test(`solver auto tracks count grouped series, fill entries, and group headers`, async () => {
    mock_decoration_measurements()
    const plot = await mount_sized_scatter_plot({
      series: [
        { ...basic, label: `A`, legend_group: `Signals` },
        { ...basic, label: `B`, legend_group: `Signals` },
      ],
      fill_regions: [
        {
          label: `Band`,
          legend_group: `Signals`,
          lower: 2,
          upper: 4,
          fill: `steelblue`,
        },
      ],
      legend: {
        layout: `vertical`,
        layout_tracks: `auto`,
      },
    })

    await vi.waitFor(() =>
      expect(plot.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateRows).toBe(
        `repeat(4, auto)`,
      ),
    )
  })

  test(`keeps the unified decoration solution disjoint initially and across resize`, async () => {
    mock_decoration_measurements()
    const plot = await mount_sized_scatter_plot({
      series: decorated_series(),
      legend: { responsive: true },
      color_bar: { responsive: true },
    })
    const initial_colorbar_rect = await vi.waitFor(() => {
      const legend_rect = solved_decoration_rect(doc_query(`.legend`))
      const colorbar_rect = solved_decoration_rect(doc_query(`.colorbar-wrapper`))
      expect(rects_overlap(legend_rect, colorbar_rect)).toBe(false)
      return colorbar_rect
    })

    await resize_element(plot, 650, 360)
    flushSync()
    await tick()

    await vi.waitFor(() => {
      const legend_rect = solved_decoration_rect(doc_query(`.legend`))
      const colorbar_rect = solved_decoration_rect(doc_query(`.colorbar-wrapper`))
      expect(rects_overlap(legend_rect, colorbar_rect)).toBe(false)
      expect(colorbar_rect.width).toBe(initial_colorbar_rect.width)
      expect(colorbar_rect.height).toBe(initial_colorbar_rect.height)
    })
  })

  test(`preserves explicit legend and colorbar positions outside solver ownership`, async () => {
    mock_decoration_measurements()
    const plot = await mount_sized_scatter_plot({
      series: decorated_series(),
      legend: { style: `position: absolute; left: 23px; top: 31px;` },
      color_bar: { wrapper_style: `position: absolute; left: 211px; top: 17px;` },
    })
    const legend = plot.querySelector<HTMLElement>(`.legend`)
    const colorbar = plot.querySelector<HTMLElement>(`.colorbar-wrapper`)
    if (!legend || !colorbar) throw new Error(`Expected explicit legend and colorbar`)

    expect({ left: legend.style.left, top: legend.style.top }).toEqual({
      left: `23px`,
      top: `31px`,
    })
    expect({ left: colorbar.style.left, top: colorbar.style.top }).toEqual({
      left: `211px`,
      top: `17px`,
    })
    expect(legend.getAttribute(`data-decoration-x`)).toBeNull()
    expect(colorbar.getAttribute(`data-decoration-x`)).toBeNull()
  })

  test(`legend auto-moves to the bottom margin when interior overlap is unavoidable`, async () => {
    const grid = dense_grid(12)
    await mount_sized_scatter_plot({
      series: [
        { ...grid, label: `Dense`, markers: `points` },
        { x: [50], y: [50], label: `B`, markers: `points` },
      ],
      legend: {},
      x_axis: { range: [0, 100] as Vec2 },
      y_axis: { range: [0, 100] as Vec2 },
    })
    await tick()
    // default interior placement would be top-left (~10px); auto-outside drops it into the
    // reserved bottom margin (~height - footprint - gap), well below mid-plot
    const legend = doc_query(`.legend`)
    expect(Number(legend.style.top.replace(`px`, ``))).toBeGreaterThan(150)
  })

  test(`non-responsive legend avoids layout reads when data changes`, async () => {
    const layout_spy = mock_decoration_measurements()
    const series = $state<DataSeries[]>([
      { ...basic, label: `A` },
      { ...basic, label: `B` },
    ])
    const plot = await mount_sized_scatter_plot({ series, legend: { responsive: false } })
    await resize_element(plot, 401, 300)
    await tick()
    const legend = doc_query(`.legend`)
    const initial_position = { left: legend.style.left, top: legend.style.top }
    layout_spy.mockClear()

    series[0].y = [6, 4, 9, 3, 8]
    flushSync()
    await tick()
    expect(layout_spy).not.toHaveBeenCalled()
    expect({ left: legend.style.left, top: legend.style.top }).toEqual(initial_position)
  })

  // rect-zoom must zoom y2 series too when sync is 'none' (the default) - BarPlot,
  // Histogram and BoxPlot all do; only the synced/align modes derive y2 from y1
  test(`rect-zoom updates y2 range when y2 sync is 'none'`, async () => {
    const state = { y2_axis: {} as Record<string, unknown> }
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          series: [
            { x: [1, 2, 3], y: [1, 2, 3] },
            { x: [1, 2, 3], y: [10, 20, 30], y_axis: `y2` as const },
          ],
        },
        state,
      ),
    )
    const svg = plot.querySelector(`svg[role="application"]`) // chart svg, not control icons
    if (!svg) throw new Error(`svg not found`)
    // Drag a rect covering a known fraction of the plot area, read off the clip rect, so the
    // expected zoom factor doesn't depend on the padding defaults
    const clip = plot.querySelector(`clipPath rect`)
    const plot_top = Number(clip?.getAttribute(`y`))
    const plot_height = Number(clip?.getAttribute(`height`))
    const [drag_top, drag_bottom] = [
      plot_top + plot_height * 0.25,
      plot_top + plot_height * 0.5,
    ]
    svg.dispatchEvent(
      new MouseEvent(`mousedown`, { clientX: 100, clientY: drag_top, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent(`mousemove`, { clientX: 300, clientY: drag_bottom }))
    window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: 300, clientY: drag_bottom }))
    await tick()
    const y2_range = state.y2_axis.range as Vec2 | undefined
    if (!y2_range) throw new Error(`y2_axis.range not set by rect-zoom`)
    expect(y2_range.every(Number.isFinite)).toBe(true)
    expect(y2_range[0]).toBeLessThan(y2_range[1])
    // a quarter of the plot height can't span more than a quarter of the 10..30 data range
    // (plus nicing slack), so this stays well under the full span
    expect(y2_range[1] - y2_range[0]).toBeLessThan(12)
  })

  // NaN/null colour and size values must neither widen the scales nor paint a NaN colour:
  // those points fall back to the series colour and default radius.
  test(`color_values and size_values with NaN fall back per point without widening the scales`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: [1, 2, 3, 4],
          y: [1, 2, 3, 4],
          color_values: [0, NaN, 100, null] as number[],
          size_values: [1, NaN, 9, null] as number[],
        },
      ],
      size_scale: { radius_range: [2, 10] },
      color_scale: `interpolateViridis`,
      color_bar: {},
      point_tween: { duration: 0 },
      legend: null,
      show_controls: false,
    })
    const tick_labels = [...plot.querySelectorAll(`.colorbar .tick-label`)].map(
      (label) => label.textContent,
    )
    expect(tick_labels[0]).toBe(`0`)
    expect(tick_labels.at(-1)).toBe(`100`)
    const markers = [...plot.querySelectorAll<SVGPathElement>(`path.marker`)]
    expect(markers.map(marker_radius)).toEqual([2, 2.5, 10, 2.5])
    // --point-fill-color is set on the wrapper Svelte adds for component CSS custom props
    const fills = markers.map((marker) =>
      marker.parentElement?.parentElement?.style.getPropertyValue(`--point-fill-color`),
    )
    expect(fills[0]).toBe(`#440154`) // viridis(0)
    expect(fills[2]).toBe(`#fde725`) // viridis(1)
    expect(fills[1]).toBe(fills[3])
    expect(fills[1]).not.toMatch(/NaN/)
  })

  test(`log y axis holds non-positive line points at the domain floor and drops their markers`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: [1, 2, 3, 4],
          y: [0, 10, -5, 1000],
          markers: `line+points`,
          line_style: { curve: `linear` },
        },
      ],
      y_axis: { scale_type: `log` },
      point_tween: { duration: 0 },
      line_tween: { duration: 0 },
      legend: null,
      show_controls: false,
    })
    const clip = scatter_clip_rect(plot)
    expect(plot.querySelectorAll(`path.marker`)).toHaveLength(2)
    const line_d = plot.querySelector(`g[data-series-id] path[fill="none"]`)?.getAttribute(`d`)
    const ys = [...(line_d ?? ``).matchAll(/[ML][-\d.]+,(?<y>[-\d.]+)/g)].map((match) =>
      Number(match.groups?.y),
    )
    expect(ys).toHaveLength(4)
    const bottom = clip.y + clip.height
    // Non-positive values sit on the bottom edge, not at -Infinity/NaN
    expect(ys[0]).toBeCloseTo(bottom, 6)
    expect(ys[2]).toBeCloseTo(bottom, 6)
    expect(ys[3]).toBeLessThan(ys[1])
    expect(ys.every(Number.isFinite)).toBe(true)
  })

  // Shift-drag pans by a constant data offset: moving the cursor by a quarter of the plot
  // width shifts the view by a quarter of the x span. Unlike rect zoom, a pan only moves the
  // live view; the bound axis props keep the pre-pan range (so a later reset has a target).
  test(`shift-drag pan shifts the view by the dragged data span`, async () => {
    const state = { x_axis: { range: [0, 100] as Vec2 }, y_axis: { range: [0, 10] as Vec2 } }
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          series: [{ x: [10, 50, 90], y: [1, 5, 9] }],
          point_tween: { duration: 0 },
          legend: null,
          show_controls: false,
        },
        state,
      ),
    )
    const svg = plot.querySelector<SVGSVGElement>(`svg[role="application"]`)
    if (!svg) throw new Error(`scatter SVG not found`)
    const clip = scatter_clip_rect(plot)
    const start = { x: clip.x + clip.width / 2, y: clip.y + clip.height / 2 }
    svg.dispatchEvent(
      new MouseEvent(`mousedown`, {
        bubbles: true,
        button: 0,
        shiftKey: true,
        clientX: start.x,
        clientY: start.y,
      }),
    )
    // Drag left by a quarter of the plot: the view follows the data, so the range moves right
    window.dispatchEvent(
      new MouseEvent(`mousemove`, {
        buttons: 1,
        clientX: start.x - clip.width / 4,
        clientY: start.y,
      }),
    )
    await tick()
    window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: start.x - clip.width / 4 }))
    await tick()
    expect(state.x_axis.range).toEqual([0, 100])
    expect(state.y_axis.range).toEqual([0, 10])
    // The view is now [25, 125]: x=10 scrolled out, x=50 sits a quarter of the way along the
    // plot, x=90 at 65%, and the x ticks moved with them
    const marker_xs = [...plot.querySelectorAll(`path.marker`)].map((marker) =>
      Number(
        /translate\((?<x>[-\d.]+)/.exec(marker.parentElement?.getAttribute(`transform`) ?? ``)
          ?.groups?.x,
      ),
    )
    expect(marker_xs).toHaveLength(2)
    expect(marker_xs[0]).toBeCloseTo(clip.x + clip.width * 0.25, 6)
    expect(marker_xs[1]).toBeCloseTo(clip.x + clip.width * 0.65, 6)
    const tick_labels = [...plot.querySelectorAll(`.x-axis .tick text`)].map(
      (label) => label.textContent,
    )
    expect(tick_labels).toContain(`120`)
    expect(tick_labels).not.toContain(`0`)
  })

  // Regression guard for effect_update_depth_exceeded: with an explicit y range the
  // range-sync effect assigns zoom_y_range a fresh array every run, and the y2-sync
  // branch reads it back - a tracked read would re-trigger the effect forever. Svelte's
  // loop guard logs via console.error and throws, so a clean mount proves the fix.
  test(`explicit y range + y2 sync mounts without a reactive loop`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
    await mount_sized_scatter_plot({
      series: [
        { x: [1, 2, 3], y: [1, 2, 3] },
        { x: [1, 2, 3], y: [10, 20, 30], y_axis: `y2` },
      ],
      y_axis: { range: [0, 5] as Vec2 },
      y2_axis: { sync: `synced` },
    })
    expect(error_spy).not.toHaveBeenCalled()
  })
})
