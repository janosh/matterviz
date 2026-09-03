import type { Vec2 } from '$lib/math'
import type { FacetLayoutContext } from '$lib/plot/core/facets'
import { COLOR_BAR_DEFAULTS } from '$lib/plot/core/types'
import type { BinnedDensityConfig } from '$lib/plot/scatter/binned-scatter-types'
import BinnedScatterPlot from '$lib/plot/scatter/BinnedScatterPlot.svelte'
import { plot_color } from '$lib/colors'
import { interpolateViridis } from 'd3-scale-chromatic'
import { createRawSnippet, mount, tick, type ComponentProps } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  CANVAS_NOOP_METHODS,
  clip_rect,
  doc_query,
  mock_canvas_context,
  query,
  resize_element,
  svg_query,
  svg_rect,
  trigger_intersection,
  trigger_resize_observer,
} from '../setup'

// Shared deterministic point cloud; spreads y values without RNG overhead.
const PSEUDO_RANDOM_MULTIPLIER = 48_271
const density_thresholds = { max_points: 0, max_points_per_px: 0 }
type BinnedProps = Partial<ComponentProps<typeof BinnedScatterPlot>>
// Most tests hide the colorbar so it can't perturb decoration placement.
const hidden_colorbar = { color_bar: null } satisfies BinnedProps
const density_mode = (config: BinnedDensityConfig = {}): BinnedProps => ({
  color_bar: null,
  density: { auto_point_mode: density_thresholds, ...config },
})
// `color_bar` defaults to {} (shown), matching ScatterPlot, so this just omits the override
const density_mode_with_colorbar = (config: BinnedDensityConfig = {}): BinnedProps => ({
  density: { auto_point_mode: density_thresholds, ...config },
})
const point_mode = (config: BinnedDensityConfig = {}): BinnedProps => ({
  color_bar: null,
  density: { auto_point_mode: { max_points: Number.MAX_SAFE_INTEGER }, ...config },
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const settle = async () => {
  await tick()
  await tick()
}
const mount_plot = (props: ComponentProps<typeof BinnedScatterPlot>): void => {
  // Object.assign (not spread) keeps bind_props accessors intact
  mount(BinnedScatterPlot, {
    target: document.body,
    props: Object.assign(props, { style: props.style ?? `width: 800px; height: 600px` }),
  })
}
// Pinning both axes to [0,1] makes client coordinates map to known data values, so
// plot_center() lands on (0.5, 0.5).
const unit_axes = { x_axis: { range: [0, 1] as Vec2 }, y_axis: { range: [0, 1] as Vec2 } }
// Plot-area centre in client coords, read off the rendered chart rect rather than hardcoded
// so tuning the default padding can't silently move these hit tests off their target.
const plot_center = (): { x: number; y: number } => {
  const { x, y, width, height } = clip_rect()
  return { x: x + width / 2, y: y + height / 2 }
}
const binned_plot = (): HTMLElement => doc_query(`.binned-scatter`)
const render_mode = (): string | undefined => binned_plot().dataset.renderMode
// Pointer events land on the frame's SVG (the canvases underneath take none)
const plot_svg = (): SVGElement => svg_query(`.binned-scatter svg[role="application"]`)
const click_plot = (clientX: number, clientY: number): boolean =>
  plot_svg().dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX, clientY }))
const hover_plot = (clientX: number, clientY: number): boolean =>
  plot_svg().dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX, clientY }))
// bind:clientWidth reads the element, so both the mocked size and its observer must update
const resize_plot = async (next_width: number, next_height: number) => {
  await resize_element(binned_plot(), next_width, next_height)
  trigger_resize_observer(binned_plot())
  await settle()
}
const plot_rect = (): TestRect => {
  const clip = svg_query(`clipPath[id^="binned-scatter-plot-area-"] rect`)
  const num = (attr: string) => Number(clip.getAttribute(attr))
  return { x: num(`x`), y: num(`y`), width: num(`width`), height: num(`height`) }
}
const tick_labels = (axis: `x` | `y`): string[] =>
  [...document.querySelectorAll(`.binned-scatter .${axis}-axis text`)].map(
    (label) => label.textContent?.trim() ?? ``,
  )
// Point radii reach the canvas only as arc() calls, so capture them off a mocked context.
const capture_radii = (overrides: Partial<CanvasRenderingContext2D> = {}): number[] => {
  const radii: number[] = []
  mock_canvas_context({
    arc: vi.fn((_x: number, _y: number, radius: number) => radii.push(radius)),
    ...overrides,
  })
  return radii
}
const overlay_snippet = (class_name: string) =>
  createRawSnippet<[{ height: number; width: number; fullscreen: boolean }]>((context) => ({
    render: () => {
      const { height, width, fullscreen } = context()
      return `<span class="${class_name}">${width}x${height}:${fullscreen}</span>`
    },
  }))
type TestLabelData = { label?: string; measure_text?: string }
const point_label_snippet = () =>
  createRawSnippet<[{ point_data?: TestLabelData }]>((context) => ({
    render: () =>
      `<span class="custom-point-label">${
        context().point_data?.label ?? context().point_data?.measure_text ?? ``
      }</span>`,
  }))
const point_tooltip_snippet = () =>
  createRawSnippet<[{ point_data?: TestLabelData }]>((context) => ({
    render: () =>
      `<span class="custom-point-tooltip">${context().point_data?.label ?? ``}</span>`,
  }))
const svg_num = (element: Element, attr_name: string): number =>
  Number(element.getAttribute(attr_name))
const css_px = (value: string): number => Number(value.replace(`px`, ``))
type TestRect = { x: number; y: number; width: number; height: number }
const decoration_rect = (selector: string): TestRect => {
  const element = doc_query(selector)
  const numeric_data = (name: string): number => Number(element.dataset[name])
  return {
    x: numeric_data(`decorationX`),
    y: numeric_data(`decorationY`),
    width: numeric_data(`decorationWidth`),
    height: numeric_data(`decorationHeight`),
  }
}
const rects_intersect = (first: TestRect, second: TestRect): boolean =>
  first.x < second.x + second.width &&
  second.x < first.x + first.width &&
  first.y < second.y + second.height &&
  second.y < first.y + first.height
const uniform_density_series = (columns = 32, rows = 24) => [
  {
    x: Array.from(
      { length: columns * rows },
      (_value, point_idx) => ((point_idx % columns) + 0.5) / columns,
    ),
    y: Array.from(
      { length: columns * rows },
      (_value, point_idx) => (Math.floor(point_idx / columns) + 0.5) / rows,
    ),
  },
]
function mock_label_measurement(width: number, height: number) {
  const original_get_bounding_client_rect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    `getBoundingClientRect`,
  )?.value as (this: HTMLElement) => DOMRect
  return vi
    .spyOn(HTMLElement.prototype, `getBoundingClientRect`)
    .mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLElement && this.classList.contains(`point-label-measure`)) {
        return DOMRect.fromRect({ width, height })
      }
      return original_get_bounding_client_rect.call(this)
    })
}

describe(`BinnedScatterPlot`, () => {
  test(`supports ScatterPlot-style fullscreen controls and overlay snippets`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...hidden_colorbar,
      header_controls: overlay_snippet(`custom-header-controls`),
      children: overlay_snippet(`custom-overlay`),
    })
    await settle()

    const plot = binned_plot()
    const toggle = doc_query<HTMLButtonElement>(`.fullscreen-btn`)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)
    expect(document.querySelector(`.custom-header-controls`)?.textContent).toBe(
      `800x600:false`,
    )
    expect(document.querySelector(`.custom-overlay`)).toBeInstanceOf(HTMLElement)

    toggle.click()
    await tick()
    expect(plot.classList.contains(`fullscreen`)).toBe(true)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Exit fullscreen`)

    await document.exitFullscreen()
    await tick()
    expect(plot.classList.contains(`fullscreen`)).toBe(false)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)

    document.body.replaceChildren()
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...hidden_colorbar,
      fullscreen_toggle: false,
    })
    await settle()
    expect(document.querySelector(`.fullscreen-btn`)).toBeNull()
  })

  // a NaN bound in a partially-set axis range would otherwise loop the auto-range
  // effect forever (NaN !== NaN never settles) until effect_update_depth_exceeded
  test(`NaN axis-range bound mounts without a reactive loop`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...hidden_colorbar,
      x_axis: { range: [null, NaN] as [null, number] },
    })
    await settle()
    expect(error_spy).not.toHaveBeenCalled()
  })

  test(`keeps default y-axis ticks sparse`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1600] }],
      y_axis: { range: [-200, 1600] },
      ...hidden_colorbar,
    })
    await settle()
    expect(document.querySelectorAll(`.y-axis .tick text`)).toHaveLength(4)
  })

  test(`auto-ranges finite pairs on logarithmic axes`, async () => {
    const plotted_x: number[] = []
    const arc = vi.fn((x: number, y: number) => {
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
      plotted_x.push(x)
    })
    mock_canvas_context({ arc })

    mount_plot({
      series: [{ x: [1, 100, 1e9], y: [1, 10, Number.NaN] }],
      x_axis: { scale_type: `log` },
      ...point_mode(),
    })
    await settle()

    expect(arc).toHaveBeenCalledTimes(2)
    expect(Math.max(...plotted_x) - Math.min(...plotted_x)).toBeGreaterThan(500)
  })

  test.each([
    [`partial`, [5, null]],
    [`reversed`, [100, 1]],
  ] as [string, [number, number | null]][])(
    `keeps an explicit %s range authoritative`,
    async (_kind, range) => {
      mount_plot({
        series: [{ x: [1, 10], y: [1, 10] }],
        x_axis: { range, ticks: [range[0]] },
        ...point_mode(),
      })
      await settle()
      const labels = [...document.querySelectorAll(`.x-axis .tick text`)].map((node) =>
        Number(node.textContent?.replaceAll(`,`, ``)),
      )
      expect(labels).toContain(range[0])
    },
  )

  // Auto-padding must measure the same `.2~g` fallback that the axis renders.
  test(`default x tick format reserves the same room as an explicit .2~g`, async () => {
    const layout = async (format?: string) => {
      mock_canvas_context({
        measureText: vi.fn((label: string) => ({ width: label.length * 20 })),
      })
      mount_plot({
        series: [{ x: [0, 8e4], y: [0, 1] }],
        x_axis: format ? { format } : {},
        ...point_mode(),
      })
      await settle()
      const baseline = Number(document.querySelector(`.x-axis > line`)?.getAttribute(`y1`))
      const rotated = Boolean(
        document.querySelector(`.x-axis .tick text[transform^="rotate"]`),
      )
      document.body.replaceChildren()
      return { baseline, rotated }
    }
    const [fallback, explicit] = [await layout(), await layout(`.2~g`)]
    expect(Number.isFinite(explicit.baseline)).toBe(true)
    expect(fallback).toEqual(explicit)
  })

  test(`renders density colorbar defaults and honors the null opt-out`, async () => {
    const density = { auto_point_mode: density_thresholds }
    mount_plot({ series: [{ x: [0, 1], y: [0, 1] }], density })
    await settle()

    expect(document.querySelector(`.mode-pill`)).toBeNull()
    expect(document.querySelector(`.colorbar .label`)?.textContent).toBe(`Density (2 points)`)
    const colorbar_style = (document.querySelector(`.colorbar .bar`) as HTMLElement).style
    expect(colorbar_style.width).toBe(`${COLOR_BAR_DEFAULTS.width}px`)
    expect(colorbar_style.height).toBe(`10px`)

    document.body.replaceChildren()
    mount_plot({ series: [{ x: [0, 1], y: [0, 1] }], density, color_bar: null })
    await settle()
    expect(document.querySelector(`.colorbar`)).toBeNull()
  })

  // An outside colorbar stacks on the axis band (default 20 top / 12 right), not on the caller's
  // larger padding, whose surplus is absorbed: 20 + 56 + 8 above, 12 + 56 + 8 to the right
  test.each([
    [`horizontal`, `dense`, `outside`, `top`, { x: 80, y: 84, width: 700, height: 456 }],
    [`vertical`, `dense`, `outside`, `right`, { x: 80, y: 30, width: 644, height: 510 }],
    [`horizontal`, `sparse`, `interior`, null, { x: 80, y: 30, width: 700, height: 510 }],
    [`vertical`, `sparse`, `interior`, null, { x: 80, y: 30, width: 700, height: 510 }],
  ] as const)(
    `solves %s colorbar placement for %s bins`,
    async (
      orientation,
      density_kind,
      expected_location,
      expected_side,
      expected_plot_rect,
    ) => {
      mount_plot({
        series: density_kind === `dense` ? uniform_density_series() : [{ x: [0.5], y: [0.5] }],
        ...density_mode_with_colorbar({ bin_px: 20 }),
        color_bar: { orientation },
        ...unit_axes,
        padding: { l: 80, r: 20, t: 30, b: 60 },
      })
      await settle()

      const colorbar = doc_query(`.binned-scatter .colorbar-wrapper`)
      expect(colorbar.dataset.decorationLocation).toBe(expected_location)
      expect(colorbar.dataset.decorationSide ?? null).toBe(expected_side)
      expect(plot_rect()).toEqual(expected_plot_rect)
    },
  )

  test(`preserves explicit colorbar wrapper and bar styles`, async () => {
    mount_plot({
      series: uniform_density_series(),
      ...density_mode_with_colorbar({ bin_px: 20 }),
      color_bar: {
        orientation: `vertical`,
        wrapper_style: `border: 3px solid rgb(1, 2, 3); padding: 7px;`,
        bar_style: `width: 14px; height: 160px;`,
      },
      ...unit_axes,
    })
    await settle()

    const wrapper = doc_query(`.binned-scatter .colorbar`)
    const bar = doc_query(`.binned-scatter .colorbar .bar`)
    expect(wrapper.style.border).toBe(`3px solid rgb(1, 2, 3)`)
    expect(wrapper.style.padding).toBe(`7px`)
    expect(bar.style.width).toBe(`14px`)
    expect(bar.style.height).toBe(`160px`)
  })

  test(`auto-places annotation snippet without overlapping the colorbar`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...density_mode_with_colorbar(),
      annotation: overlay_snippet(`custom-annotation`),
    })
    await settle()

    const anno_wrapper = doc_query(`.binned-scatter .annotation`)
    expect(anno_wrapper.querySelector(`.custom-annotation`)?.textContent).toBe(`800x600:false`)
    const anno_rect = decoration_rect(`.binned-scatter .annotation`)
    const bar_rect = decoration_rect(`.binned-scatter .colorbar-wrapper`)
    for (const rect of [anno_rect, bar_rect]) {
      expect(Object.values(rect).every(Number.isFinite), JSON.stringify(rect)).toBe(true)
    }
    expect(rects_intersect(anno_rect, bar_rect), JSON.stringify({ anno_rect, bar_rect })).toBe(
      false,
    )
  })

  test(`keeps solver padding stable across repeated resizes`, async () => {
    mount_plot({
      series: uniform_density_series(),
      ...density_mode_with_colorbar({ bin_px: 20 }),
      ...unit_axes,
      padding: { l: 80, r: 20, t: 30, b: 60 },
    })
    await settle()

    const initial_rect = plot_rect()
    await resize_plot(620, 420)
    const resized_rect = plot_rect()
    expect(resized_rect).not.toEqual(initial_rect)
    expect(resized_rect.x + resized_rect.width).toBeLessThanOrEqual(620)
    expect(resized_rect.y + resized_rect.height).toBeLessThanOrEqual(420)

    for (let repeat_idx = 0; repeat_idx < 3; repeat_idx++) {
      await resize_plot(620, 420)
      expect(plot_rect()).toEqual(resized_rect)
    }
    await resize_plot(800, 600)
    expect(plot_rect()).toEqual(initial_rect)
  })

  test(`keeps colorbar placement frozen across data changes`, async () => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(60)
    const layout_spy = vi
      .spyOn(Element.prototype, `getBoundingClientRect`)
      .mockReturnValue(DOMRect.fromRect({ width: 100, height: 60 }))
    const series = $state([{ x: [0, 1], y: [0, 1] }])
    mount_plot({ series, ...density_mode_with_colorbar() })
    await settle()
    const colorbar = doc_query(`.binned-scatter .colorbar-wrapper`)
    const initial_position = { left: colorbar.style.left, top: colorbar.style.top }
    layout_spy.mockClear()

    series[0].x = [0.2, 0.8]
    await tick()
    expect(layout_spy).not.toHaveBeenCalled()
    expect({ left: colorbar.style.left, top: colorbar.style.top }).toEqual(initial_position)
  })

  test(`renders annotation in point mode (no colorbar) and skips wrapper when absent`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...point_mode(),
      annotation: overlay_snippet(`custom-annotation`),
    })
    await settle()

    expect(document.querySelector(`.colorbar-wrapper`)).toBeNull()
    const anno_wrapper = doc_query(`.annotation`)
    expect(anno_wrapper.style.left).toMatch(/px$/)
    expect(anno_wrapper.style.top).toMatch(/px$/)

    document.body.replaceChildren()
    mount_plot({ series: [{ x: [0, 1], y: [0, 1] }], ...point_mode() })
    await settle()
    expect(document.querySelector(`.annotation`)).toBeNull()
  })

  // Both cases also re-check the clip path, which the reference-line group must point at
  // for the lines to be cropped to the plot area (l 80 / t 30 of an 800x600 figure).
  test.each([
    [
      `an unstyled diagonal`,
      { type: `diagonal`, slope: 1, intercept: 0 },
      [80, 540, 780, 30],
      { stroke: `currentColor`, dash: null },
    ],
    [
      `a styled horizontal`,
      { type: `horizontal`, y: 0.5, style: { color: `red`, dash: `4 4` } },
      [80, 285, 780, 285],
      { stroke: `red`, dash: `4 4` },
    ],
  ] as const)(`resolves and clips %s RefLine`, async (_kind, ref_line, coords, style) => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...unit_axes,
      overlays: { ref_lines: [ref_line] },
      ...hidden_colorbar,
      padding: { l: 80, r: 20, t: 30, b: 60 },
    })
    await settle()

    const clip_path = doc_query(
      `clipPath[id^="binned-scatter-plot-area-"]`,
      SVGClipPathElement,
    )
    expect(svg_rect(query(clip_path, `rect`))).toEqual({
      x: 80,
      y: 30,
      width: 700,
      height: 510,
    })

    const ref_group = document.querySelector(`.reference-lines`)
    expect(ref_group?.querySelector(`g[clip-path]`)?.getAttribute(`clip-path`)).toBe(
      `url(#${clip_path?.id})`,
    )
    const line = ref_group?.querySelector(`line:not([stroke="transparent"])`)
    expect(line).toBeInstanceOf(SVGLineElement)
    expect([`x1`, `y1`, `x2`, `y2`].map((attr) => Number(line?.getAttribute(attr)))).toEqual(
      coords,
    )
    expect(line?.getAttribute(`stroke`)).toBe(style.stroke)
    expect(line?.getAttribute(`stroke-dasharray`)).toBe(style.dash)
  })

  // The frame keeps [0, 1] sentinel ranges/scales for x2/y2 when no series uses them, so a
  // secondary-axis ref line must fall back to the primary axis instead of the sentinel
  test.each([
    [`x2`, { type: `vertical`, x: 5, x_axis: `x2` }, { type: `vertical`, x: 5 }],
    [`y2`, { type: `horizontal`, y: 50, y_axis: `y2` }, { type: `horizontal`, y: 50 }],
  ] as const)(
    `a %s RefLine resolves on the primary axis when the chart has no secondary data`,
    async (_axis, secondary, primary) => {
      const visible_line_coords = async (ref_line: typeof secondary | typeof primary) => {
        document.body.replaceChildren()
        mount_plot({
          series: [{ x: [0, 10], y: [0, 100] }],
          x_axis: { range: [0, 10] },
          y_axis: { range: [0, 100] },
          overlays: { ref_lines: [ref_line] },
          ...hidden_colorbar,
        })
        await settle()
        const lines = [...document.querySelectorAll(`.reference-lines line`)].filter(
          (line) => line.getAttribute(`stroke`) !== `transparent`,
        )
        return lines.map((line) =>
          [`x1`, `y1`, `x2`, `y2`].map((attr) => Number(line.getAttribute(attr))),
        )
      }
      const primary_coords = await visible_line_coords(primary)
      expect(primary_coords).toHaveLength(1)
      expect(await visible_line_coords(secondary)).toEqual(primary_coords)
    },
  )

  test(`drops declarative RefLines that resolve outside the axis ranges`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      // inverted x range: visibility must use sorted bounds, not [min, max] as given
      x_axis: { range: [1, 0] },
      y_axis: { range: [0, 1] },
      overlays: {
        ref_lines: [
          { type: `vertical`, x: 5 }, // outside x range -> dropped
          { type: `horizontal`, y: 0.5, visible: false }, // explicitly hidden
          { type: `vertical`, x: 0.5 }, // inside the inverted range -> kept
        ],
      },
      ...hidden_colorbar,
    })
    await settle()

    // one kept line = one visible stroke (each ReferenceLine also draws a transparent hit line)
    const visible_lines = [...document.querySelectorAll(`.reference-lines line`)].filter(
      (line) => line.getAttribute(`stroke`) !== `transparent`,
    )
    expect(visible_lines).toHaveLength(1)
  })

  test(`uses density color scale type for colorbar ticks`, async () => {
    const ctx = mock_canvas_context()
    mount_plot({
      series: [{ x: Array(100).fill(0), y: Array(100).fill(0) }],
      ...density_mode_with_colorbar({
        color_scale: { type: `log`, scheme: `interpolateMagma` },
      }),
    })
    await settle()

    const tick_by_label = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(`.colorbar .tick-label`)].map(
        (tick_label) => [tick_label.textContent, tick_label.style.left],
      ),
    )
    expect(tick_by_label).toMatchObject({ '1': `0%`, '10': `50%`, '100': `100%` })
    expect(ctx.clip).toHaveBeenCalled()
  })

  test(`skips non-finite coordinates in point rendering`, async () => {
    const arc = vi.fn((x: number, y: number, radius: number) => {
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
      expect(radius).toBe(4)
    })
    const ctx = mock_canvas_context({ arc })

    mount_plot({
      series: [{ x: [0, NaN, 0.5, Infinity], y: [0, 0.5, NaN, 0.8] }],
      ...point_mode(),
      ...unit_axes,
    })
    await settle()

    expect(render_mode()).toBe(`points`)
    expect(arc).toHaveBeenCalledOnce()
    expect(ctx.clip).not.toHaveBeenCalled()
  })

  test(`scales point radii from size values in point mode`, async () => {
    const radii = capture_radii()

    mount_plot({
      series: [{ x: [0.2, 0.5, 0.8], y: [0.5, 0.5, 0.5], size_values: [1, 4, 16] }],
      ...point_mode(),
      ...unit_axes,
    })
    await settle()

    expect(radii).toHaveLength(3)
    expect(radii[0]).toBe(4)
    expect(radii[1]).toBeGreaterThan(radii[0] ?? 0)
    expect(radii[2]).toBe(12)
  })

  test.each([
    [{ radius_range: [2, 18] as Vec2 }, [2, 18]],
    [{ radius_range: [2, 18] as Vec2, value_range: [0, 64] as Vec2 }, [2, 10]],
  ])(`supports size_scale config %#`, async (size_scale, expected_radii) => {
    const radii = capture_radii()

    mount_plot({
      series: [{ x: [0.2, 0.8], y: [0.5, 0.5], size_values: [0, 32] }],
      ...point_mode(),
      size_scale,
      ...unit_axes,
    })
    await settle()

    expect(radii).toEqual(expected_radii)
  })

  // A point drawn at radius 18 must stay pickable 17px off its center
  test(`uses auto pick radius from configured size scale range`, async () => {
    const on_point_click = vi.fn()
    mount_plot({
      series: [{ x: [0.5], y: [0.5], size_values: [1] }],
      ...point_mode(),
      size_scale: { radius_range: [2, 18], pick_radius: `auto` },
      ...unit_axes,
      on_point_click,
    })
    await settle()

    const center = plot_center()
    click_plot(center.x + 17, center.y)

    expect(on_point_click).toHaveBeenCalledOnce()
  })

  // rAF is faked so the pulse can be stepped deterministically instead of sleeping
  const advance_frames = (count: number) => vi.advanceTimersByTime(count * 16)

  test(`pulses the selected point and pauses while scrolled out of view`, async () => {
    vi.useFakeTimers({ toFake: [`requestAnimationFrame`, `cancelAnimationFrame`] })
    const stroke = vi.fn()
    const radii = capture_radii({ stroke })

    mount_plot({
      series: [{ x: [0.4, 0.6], y: [0.5, 0.5], point_ids: [`selected`, `other`] }],
      ...point_mode(),
      selected_point_id: `selected`,
      ...unit_axes,
    })
    await settle()

    expect(stroke).toHaveBeenCalled()
    expect(Math.max(...radii)).toBeGreaterThan(4)

    // Assert the pulse actually advances rather than just rendering one highlighted frame:
    // the visibility gate silently froze it everywhere before, and a frozen pulse still
    // draws that first frame. Redraws show up as further arc() calls.
    const after_mount = radii.length
    advance_frames(3)
    await settle()
    expect(radii.length).toBeGreaterThan(after_mount)

    trigger_intersection(binned_plot(), false)
    await settle()
    const after_pause = radii.length
    advance_frames(3)
    await settle()
    expect(radii).toHaveLength(after_pause)
  })

  // The pulsing marker sits on its own canvas, so a tick repaints one circle rather than
  // every point in the plot. Counted per canvas because both share the mocked getContext.
  test(`pulse ticks repaint only the marked-points overlay`, async () => {
    vi.useFakeTimers({ toFake: [`requestAnimationFrame`, `cancelAnimationFrame`] })
    const clears = { base: 0, overlay: 0 }
    const width_setter = vi.spyOn(HTMLCanvasElement.prototype, `width`, `set`)
    // happy-dom 20.13 dropped the per-property accessors on CSSStyleDeclaration.prototype, so a
    // `width` setter spy throws; `style.width = x` routes through setProperty either way.
    const set_property = vi.spyOn(CSSStyleDeclaration.prototype, `setProperty`)
    const resize_count = () =>
      width_setter.mock.calls.length +
      set_property.mock.calls.filter(([prop]) => prop === `width`).length
    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockImplementation(
      function (this: HTMLCanvasElement) {
        const layer = this.classList.contains(`marked-points`) ? `overlay` : `base`
        return {
          font: ``,
          measureText: () => ({ width: 0 }),
          ...Object.fromEntries(CANVAS_NOOP_METHODS.map((name) => [name, vi.fn()])),
          clearRect: () => clears[layer]++,
        } as unknown as CanvasRenderingContext2D
      },
    )

    mount_plot({
      series: [{ x: [0.4, 0.6], y: [0.5, 0.5], point_ids: [`selected`, `other`] }],
      ...point_mode(),
      selected_point_id: `selected`,
      ...unit_axes,
    })
    await settle()
    advance_frames(3)
    await settle()

    const settled = { ...clears, resizes: resize_count() }
    expect(settled.overlay).toBeGreaterThan(0)
    advance_frames(3)
    await settle()
    expect(clears.overlay).toBeGreaterThan(settled.overlay)
    expect(clears.base).toBe(settled.base) // points layer untouched between view changes
    expect(resize_count()).toBe(settled.resizes)
  })

  test(`missing selected point ID does not schedule pulse frames`, async () => {
    const request_frame = vi.spyOn(globalThis, `requestAnimationFrame`)
    mock_canvas_context()
    mount_plot({
      series: [{ x: [0.4], y: [0.5], point_ids: [`selected`] }],
      ...point_mode(),
      selected_point_id: `missing`,
      ...unit_axes,
    })
    await settle()

    expect(request_frame).not.toHaveBeenCalled()
  })

  test(`rect zoom moves the view, swallows its trailing click, and double-click resets`, async () => {
    const on_density_zoom = vi.fn()
    // $state so the parent's later range writes propagate in
    const state = $state({
      x_axis: { range: [0, 1] as Vec2 },
      y_axis: { range: [0, 1] as Vec2 },
    })
    mount_plot(
      bind_props(
        {
          series: [{ x: Array(20).fill(0.5), y: Array(20).fill(0.5) }],
          ...density_mode({ bin_px: 100 }),
          on_density_zoom,
        },
        state,
      ),
    )
    await settle()
    const svg = plot_svg()
    const area = plot_rect()
    const drag = async (start: Vec2, end: Vec2) => {
      svg.dispatchEvent(
        new MouseEvent(`mousedown`, {
          bubbles: true,
          button: 0,
          clientX: start[0],
          clientY: start[1],
        }),
      )
      window.dispatchEvent(
        new MouseEvent(`mousemove`, { buttons: 1, clientX: end[0], clientY: end[1] }),
      )
      window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: end[0], clientY: end[1] }))
      await tick()
    }

    // [min, max] of the numeric tick labels: the view the axis currently shows
    const tick_span = (axis: `x` | `y`): Vec2 => {
      const values = tick_labels(axis).map(Number)
      expect(values.length, axis).toBeGreaterThan(1)
      return [Math.min(...values), Math.max(...values)]
    }
    const within = (span: Vec2, [lo, hi]: Vec2) => span[0] >= lo && span[1] <= hi
    const full_view = () => {
      expect(tick_span(`x`)).toEqual([0, 1])
      expect(tick_span(`y`)).toEqual([0, 1])
    }
    // the axis props are the caller's; no gesture below may write them
    const props_untouched = () => {
      expect(state.x_axis).toEqual({ range: [0, 1] })
      expect(state.y_axis).toEqual({ range: [0, 1] })
    }
    full_view()

    // A drag starting in the x-label margin below the plot area must not zoom
    await drag([400, area.y + area.height + 20], [200, 200])
    full_view()

    // A drag inside the plot area zooms both axes to the dragged fraction of the unit range
    const [x0, x1] = [area.x + 0.25 * area.width, area.x + 0.75 * area.width]
    const [y0, y1] = [area.y + 0.25 * area.height, area.y + 0.75 * area.height]
    await drag([x0, y0], [x1, y1])
    expect(within(tick_span(`x`), [0.25, 0.75])).toBe(true)
    expect(within(tick_span(`y`), [0.25, 0.75])).toBe(true)
    expect(tick_span(`x`)[1] - tick_span(`x`)[0]).toBeLessThan(0.5)
    props_untouched()

    // The drag's trailing click is swallowed rather than zooming the bin under it. Nudge off
    // the exact centre: data at 0.5 falls in the upper-right of the two bins meeting there.
    const center = plot_center()
    const [bin_x, bin_y] = [center.x + 1, center.y - 1]
    click_plot(bin_x, bin_y)
    expect(on_density_zoom).not.toHaveBeenCalled()

    // Double-click restores the pinned unit range
    svg.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await settle()
    full_view()
    props_untouched()
    expect(plot_rect()).toEqual(area)

    // With the view restored, clicking the populated bin zooms into it
    await new Promise((resolve) => setTimeout(resolve, 0)) // suppress_click clears next tick
    click_plot(bin_x, bin_y)
    await tick()
    expect(on_density_zoom).toHaveBeenCalledOnce()
    const { bin } = on_density_zoom.mock.calls[0][0]
    // the bin is the one just right of and above the (0.5, 0.5) data point
    expect(bin.x_range[0]).toBe(0.5)
    expect(bin.x_range[1]).toBeGreaterThan(0.5)
    expect(bin.y_range[0]).toBe(0.5)
    expect(within(tick_span(`x`), bin.x_range)).toBe(true)
    expect(within(tick_span(`y`), bin.y_range)).toBe(true)
    props_untouched()

    // A range the parent writes after a user zoom replaces the zoomed view
    state.x_axis = { range: [2, 4] }
    await settle()
    expect(tick_labels(`x`)).toEqual(expect.arrayContaining([`2`, `3`, `4`]))

    // Shift-drag pans the current view (half the plot width = half the range) without
    // touching the axis props, as in ScatterPlot
    const panned = plot_rect()
    const [pan_x, pan_y] = [panned.x + panned.width / 2, panned.y + panned.height / 2]
    svg.dispatchEvent(
      new MouseEvent(`mousedown`, {
        bubbles: true,
        button: 0,
        shiftKey: true,
        clientX: pan_x,
        clientY: pan_y,
      }),
    )
    window.dispatchEvent(
      new MouseEvent(`mousemove`, {
        buttons: 1,
        clientX: pan_x - panned.width / 2,
        clientY: pan_y,
      }),
    )
    window.dispatchEvent(new MouseEvent(`mouseup`))
    await settle()
    expect(tick_labels(`x`)).toEqual(expect.arrayContaining([`3`, `4`, `5`]))
    expect(tick_labels(`x`)).not.toContain(`2`)
    expect(state.x_axis.range).toEqual([2, 4])
  })

  test(`reports pinned axis ranges (not the no-scan sentinel) to a facet grid`, async () => {
    const report_layout = vi.fn()
    const facet_layout: FacetLayoutContext = {
      padding: {},
      ranges: {},
      axis_visibility: { x: true, x2: true, y: true, y2: true },
      report_layout,
      update_range: vi.fn(),
    }
    const series = [{ x: [100, 200], y: [5, 10] }]
    const last_report = () => report_layout.mock.calls.at(-1)?.[0]
    // both axes pinned: no data scan, yet the report must carry the pinned ranges
    mount_plot({
      series,
      x_axis: { range: [90, 210] },
      y_axis: { range: [0, 20] },
      facet_layout,
      ...hidden_colorbar,
    })
    await settle()
    expect(last_report().ranges).toMatchObject({ x: [90, 210], y: [0, 20] })

    // one pinned bound: the other falls back to the data extent
    document.body.replaceChildren()
    mount_plot({
      series,
      x_axis: { range: [90, null] },
      range_padding: 0,
      facet_layout,
      ...hidden_colorbar,
    })
    await settle()
    expect(last_report().ranges).toMatchObject({ x: [90, 200], y: [5, 10] })
  })

  test(`keeps density bins bin_px wide when marginal strips shrink the plot area`, async () => {
    const on_density_zoom = vi.fn()
    const bin_px = 20
    mount_plot({
      series: [{ x: Array(20).fill(0.5), y: Array(20).fill(0.5) }],
      ...unit_axes,
      ...density_mode({ bin_px }),
      marginals: { top: { type: `histogram`, size: 64 }, right: { type: `kde`, size: 64 } },
      on_density_zoom,
    })
    await settle()
    // Without decorations the plot rect is the base pad plus the marginal strips, so the bin
    // grid must tile exactly that rect at bin_px
    const area = plot_rect()
    const center = plot_center()
    click_plot(center.x + 1, center.y - 1)
    await tick()
    const { bin } = on_density_zoom.mock.calls[0][0]
    expect(Math.round(1 / (bin.x_range[1] - bin.x_range[0]))).toBe(
      Math.ceil(area.width / bin_px),
    )
    expect(Math.round(1 / (bin.y_range[1] - bin.y_range[0]))).toBe(
      Math.ceil(area.height / bin_px),
    )
  })

  test.each([
    [`point`, 1, 0],
    [`none`, 0, 0],
  ] as const)(
    `supports density bin click mode %s`,
    async (bin_click, point_clicks, zoom_clicks) => {
      const on_density_zoom = vi.fn()
      const on_point_click = vi.fn()
      mount_plot({
        series: [{ x: Array(20).fill(0.5), y: Array(20).fill(0.5) }],
        ...density_mode({ bin_px: 100, bin_click }),
        ...unit_axes,
        on_density_zoom,
        on_point_click,
      })
      await settle()

      click_plot(420, 247)

      expect(on_point_click).toHaveBeenCalledTimes(point_clicks)
      expect(on_density_zoom).toHaveBeenCalledTimes(zoom_clicks)
    },
  )

  test(`can disable automatic point mode switching`, async () => {
    mount_plot({
      series: [{ x: [0.5], y: [0.5] }],
      ...hidden_colorbar,
      density: { auto_point_mode: false },
      render_mode: `density`,
      ...unit_axes,
    })
    await settle()

    expect(render_mode()).toBe(`density`)
  })

  test(`matches density tooltip background to hovered bin color`, async () => {
    const on_point_click = vi.fn()
    mount_plot({
      series: [{ x: [0.5], y: [0.5] }],
      ...density_mode({
        color_scale: { scheme: `interpolateViridis`, value_range: [1, 2] },
        bin_px: 100,
      }),
      ...unit_axes,
      on_point_click,
    })
    await settle()

    hover_plot(420, 247)
    await tick()

    const expected_color = document.createElement(`div`)
    expected_color.style.backgroundColor = interpolateViridis(0)
    const tooltip = doc_query(`.plot-tooltip`)
    expect(tooltip.style.backgroundColor).toBe(expected_color.style.backgroundColor)
    expect(tooltip.style.color).toBe(`white`)

    click_plot(420, 247)
    expect(on_point_click).toHaveBeenCalledWith(
      expect.objectContaining({ color: interpolateViridis(0) }),
    )
  })

  // Regression: colorless multi-series must use the series index color everywhere. This catches the
  // old plot_color(0)-for-all fallback in both point rendering and per-series marginals.
  test(`colorless series use distinct per-index colors`, async () => {
    const fill_styles: string[] = []
    const ctx = mock_canvas_context()
    Object.defineProperty(ctx, `fillStyle`, {
      get: () => fill_styles.at(-1) ?? ``,
      set: (value: string) => void fill_styles.push(value),
    })
    mount_plot({
      series: [
        { x: [0.2], y: [0.2] }, // series 0
        { x: [0.5], y: [0.5] }, // series 1
      ],
      marginals: { top: { type: `histogram`, per_series: true } },
      ...point_mode(),
      ...unit_axes,
    })
    await settle()
    expect(render_mode()).toBe(`points`)
    // draw_points paints each colorless series with its index color (canvas fillStyle)
    expect(fill_styles).toContain(plot_color(0))
    expect(fill_styles).toContain(plot_color(1))
    // per-series marginals get the same index colors so they're visually distinguishable
    const marginal_fills = [...document.querySelectorAll(`.marginal-top rect`)].map((rect) =>
      rect.getAttribute(`fill`),
    )
    expect(marginal_fills).toEqual(expect.arrayContaining([plot_color(0), plot_color(1)]))
  })

  test(`does not paint canvas markers whose color is none`, async () => {
    let fill_style = ``
    const painted_colors: string[] = []
    const ctx = mock_canvas_context({
      fill: vi.fn(() => painted_colors.push(fill_style)),
    })
    Object.defineProperty(ctx, `fillStyle`, {
      get: () => fill_style,
      // Canvas retains the previous style when assigned the SVG-only `none` keyword.
      set: (value: string) => {
        if (value !== `none`) fill_style = value
      },
    })
    mount_plot({
      series: [
        { x: [0.2], y: [0.2], color: `red` },
        { x: [0.5], y: [0.5], color: `none` },
      ],
      ...point_mode(),
      ...unit_axes,
    })
    await settle()

    expect(painted_colors).toEqual([`red`])
  })

  test(`places the title below an outer top marginal`, async () => {
    mount_plot({
      series: [{ x: [0.2, 0.8], y: [0.3, 0.7] }],
      title: `Density map`,
      marginals: {
        top: { placement: `outer`, size: 30, gap: 7, value_axis: false },
      },
      ...point_mode(),
      ...unit_axes,
    })
    await settle()

    const marginal_rect = svg_query(`clipPath[id$="-top"] rect`)
    const marginal_bottom = svg_num(marginal_rect, `y`) + svg_num(marginal_rect, `height`)
    expect(svg_num(svg_query(`.plot-title tspan`), `y`)).toBeGreaterThan(marginal_bottom)
  })

  test(`renders point label snippets with auto-placed leader lines`, async () => {
    mock_label_measurement(80, 20)
    mount_plot({
      series: [{ x: [0.5, 0.502], y: [0.5, 0.502], point_ids: [`wbm-1`, `wbm-2`] }],
      ...point_mode(),
      ...unit_axes,
      point_labels: {
        render: point_label_snippet(),
        gap_px: 20,
        placement: { leader_line_threshold: 0 },
      },
      point_data: ({ point }: { point: { point_id?: string | number } }) => ({
        label: `${point.point_id} (Li2O-label)`,
        measure_text: `${point.point_id}\nLi2O-label`,
      }),
    })
    await settle()
    await settle()

    const labels = [...document.querySelectorAll<HTMLElement>(`.point-labels .point-label`)]
    expect(labels.map((label) => label.textContent)).toEqual([
      `wbm-1 (Li2O-label)`,
      `wbm-2 (Li2O-label)`,
    ])
    const label_positions = labels.map((label) => `${label.style.left},${label.style.top}`)
    expect(label_positions[0]).not.toBe(label_positions[1])
    const leaders = [...document.querySelectorAll(`.point-label-leaders line`)]
    expect(leaders).toHaveLength(2)

    const first_leader = leaders[0]
    const first_label = labels[0]
    if (!first_leader) throw new Error(`missing first point label leader`)
    if (!first_label) throw new Error(`missing first point label`)
    // the first point sits at (0.5, 0.5), i.e. dead centre of the plot area
    const point_center = plot_center()
    const label_center = {
      x: css_px(first_label.style.left),
      y: css_px(first_label.style.top),
    }
    const delta_x = label_center.x - point_center.x
    const delta_y = label_center.y - point_center.y
    const center_distance = Math.hypot(delta_x, delta_y)
    const unit_x = delta_x / center_distance
    const unit_y = delta_y / center_distance
    const label_edge_distance = Math.min(
      Math.abs(unit_x) > 0.001 ? 41 / Math.abs(unit_x) : Infinity,
      Math.abs(unit_y) > 0.001 ? 11 / Math.abs(unit_y) : Infinity,
    )
    const start_distance = Math.hypot(
      svg_num(first_leader, `x1`) - point_center.x,
      svg_num(first_leader, `y1`) - point_center.y,
    )
    const end_distance = Math.hypot(
      svg_num(first_leader, `x2`) - label_center.x,
      svg_num(first_leader, `y2`) - label_center.y,
    )
    const visible_length = Math.hypot(
      svg_num(first_leader, `x2`) - svg_num(first_leader, `x1`),
      svg_num(first_leader, `y2`) - svg_num(first_leader, `y1`),
    )
    expect(start_distance).toBeCloseTo(4)
    expect(end_distance).toBeCloseTo(label_edge_distance)
    expect(visible_length).toBeGreaterThan(6)
  })

  test(`skips point label rendering above the configured label count`, async () => {
    const n_points = 51
    mount_plot({
      series: [
        {
          x: Array.from({ length: n_points }, (_value, point_idx) => point_idx / n_points),
          y: Array<number>(n_points).fill(0.5),
        },
      ],
      ...point_mode(),
      ...unit_axes,
      point_labels: { render: point_label_snippet() },
    })
    await settle()

    expect(document.querySelectorAll(`.point-label`)).toHaveLength(0)
    expect(document.querySelectorAll(`.point-label-leaders line`)).toHaveLength(0)
  })

  // No marginals here, so the plot area isn't shrunk by a marginal reservation and the
  // click at (420, 280) maps to series 1 at (0.5, 0.5).
  test(`passes point data, index and color to tooltips and click handlers`, async () => {
    const on_point_click = vi.fn()
    mount_plot({
      series: [
        { x: [0.2], y: [0.2] }, // series 0, away from the pointer
        { x: [0.5], y: [0.5], point_ids: [`wbm-1`] }, // series 1, under the pointer
      ],
      ...point_mode(),
      ...unit_axes,
      tooltip: point_tooltip_snippet(),
      point_data: ({ point }: { point: { point_id?: string | number } }) => ({
        label: `label-${point.point_id}`,
      }),
      on_point_click,
    })
    await settle()

    hover_plot(420, 280)
    await tick()
    expect(document.querySelector(`.custom-point-tooltip`)?.textContent).toBe(`label-wbm-1`)

    click_plot(420, 280)
    expect(on_point_click).toHaveBeenCalledWith(
      expect.objectContaining({
        series_idx: 1,
        color: plot_color(1),
        point_data: { label: `label-wbm-1` },
      }),
    )
  })

  // A single labelled point at the plot center (420, 280); placement tests vary only the
  // point_labels config. Placement runs after measurement, hence the second settle.
  const mount_labelled_point = async (
    point_labels: BinnedProps[`point_labels`],
  ): Promise<void> => {
    document.body.replaceChildren()
    mount_plot({
      series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
      ...point_mode(),
      point_data: () => ({ label: `wbm-1`, measure_text: `wbm-1` }),
      ...unit_axes,
      point_labels: { render: point_label_snippet(), ...point_labels },
    })
    await settle()
    await settle()
  }

  test(`includes configured point label gap in placement`, async () => {
    mock_label_measurement(40, 10)
    const label_distance = (): number => {
      const label = doc_query(`.point-labels .point-label`)
      const left = css_px(label.style.left)
      const top = css_px(label.style.top)
      return Math.hypot(left - 420, top - 284)
    }

    await mount_labelled_point({ gap_px: 0 })
    const no_gap_distance = label_distance()

    await mount_labelled_point({ gap_px: 20 })
    expect(label_distance()).toBeGreaterThan(no_gap_distance + 15)
  })

  test(`respects leader threshold separately from visible line length`, async () => {
    mock_label_measurement(30, 10)
    const leader_count = (): number =>
      document.querySelectorAll(`.point-label-leaders line`).length

    await mount_labelled_point({ gap_px: 20, placement: { leader_line_threshold: 1000 } })
    expect(leader_count()).toBe(0)

    // Same short gap, threshold 0: the line is drawn however little of it shows.
    await mount_labelled_point({ gap_px: 20, placement: { leader_line_threshold: 0 } })
    expect(leader_count()).toBeGreaterThan(0)
  })

  test(`applies point label font size to rendered and measured labels`, async () => {
    mount_plot({
      series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
      ...point_mode(),
      point_labels: { render: point_label_snippet(), font_size: `20px` },
      ...unit_axes,
    })
    await settle()

    expect(getComputedStyle(doc_query(`.point-labels .point-label`)).fontSize).toBe(`20px`)
    expect(getComputedStyle(doc_query(`.point-label-measure`)).fontSize).toBe(`20px`)
  })

  test(`renders rotated y-axis label as SVG text with subscript tspans`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      y_axis: { label: `E<sub>form</sub>` },
      ...hidden_colorbar,
    })
    await settle()

    const label = svg_query(`.axis-label.y-label`)
    const subscript = label.querySelector(`tspan[baseline-shift="sub"]`)

    expect(label.tagName.toLowerCase()).toBe(`text`)
    expect(label.closest(`foreignObject`)).toBeNull()
    expect(label.parentElement?.getAttribute(`transform`)).toContain(`rotate(-90`)
    expect(subscript?.textContent).toBe(`form`)
  })

  test(`waits for plot dimensions before scanning explicit-range data`, async () => {
    let accesses = 0
    const counted = (values: number[]) =>
      new Proxy(values, {
        get(target, prop, receiver) {
          if (typeof prop === `string` && /^\d+$/.test(prop)) accesses++
          return Reflect.get(target, prop, receiver)
        },
      })
    const n_points = 1000

    mount_plot({
      series: [
        {
          x: counted(Array.from({ length: n_points }, (_, idx) => idx / n_points)),
          y: counted(Array.from({ length: n_points }, (_, idx) => idx / n_points)),
        },
      ],
      ...density_mode(),
      ...unit_axes,
    })
    await settle()

    expect(render_mode()).toBe(`density`)
    expect(accesses).toBe(n_points * 2)

    accesses = 0
    hover_plot(420, 280)
    expect(accesses).toBe(0)
  })

  test(`mounts and bins one million auto-ranged points`, async () => {
    const n_points = 1_000_000
    const x = new Float32Array(n_points)
    const y = new Float32Array(n_points)
    for (let idx = 0; idx < n_points; idx++) {
      x[idx] = (idx % 10_000) / 10_000
      y[idx] = ((idx * PSEUDO_RANDOM_MULTIPLIER) % 1_000_000) / 1_000_000
    }

    mount_plot({ series: [{ x, y }], ...density_mode_with_colorbar() })
    await settle()

    expect(render_mode()).toBe(`density`)
    expect(document.querySelector(`.colorbar .label`)?.textContent).toBe(
      `Density (1,000,000 points)`,
    )
  }, 10_000)
})

// The component supplied its own `.2~g` tick format, and format_tick_values short-circuits its
// whole duplicate-avoidance escalation the moment a formatter is given. So a tight window over
// large values labelled every tick identically with zero configuration - and the default
// density bin_click is `zoom`, which lands in exactly such a window.
test(`does not force a tick format that collapses distinct labels`, async () => {
  const values = Array.from({ length: 400 }, (_unused, idx) => 1000 + (idx % 20) / 2)
  mount_plot({ series: [{ x: values, y: values }] })
  await tick()
  const labels = (side: string) =>
    [...document.querySelectorAll(`.${side}-axis .tick text`)].map(
      (node) => node.textContent?.trim() ?? ``,
    )
  for (const side of [`x`, `y`]) {
    const ticks = labels(side)
    expect(ticks.length).toBeGreaterThan(1)
    expect(new Set(ticks).size).toBe(ticks.length) // was six identical `1e+3`
  }
})
