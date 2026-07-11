import type { Vec2 } from '$lib/math'
import { BinnedScatterPlot, type BinnedDensityConfig, COLOR_BAR_DEFAULTS } from '$lib/plot'
import { get_series_color } from '$lib/plot/core/data-transform'
import { interpolateViridis } from 'd3-scale-chromatic'
import { createRawSnippet, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { doc_query, svg_query } from '../setup'

const CI_MULTIPLIER = [`true`, `1`].includes(process.env.CI ?? ``) ? 5 : 1
// Shared deterministic point cloud; spreads y values without RNG overhead.
const PSEUDO_RANDOM_MULTIPLIER = 48_271
const density_thresholds = { max_points: 0, max_points_per_px: 0 }
const hidden_density = { color_bar: null } satisfies BinnedDensityConfig
const density_mode = (config: BinnedDensityConfig = {}): BinnedDensityConfig => ({
  color_bar: null,
  auto_point_mode: density_thresholds,
  ...config,
})
const density_mode_with_colorbar = (
  config: BinnedDensityConfig = {},
): BinnedDensityConfig => ({
  auto_point_mode: density_thresholds,
  ...config,
})
const point_mode = (config: BinnedDensityConfig = {}): BinnedDensityConfig => ({
  color_bar: null,
  auto_point_mode: { max_points: Number.MAX_SAFE_INTEGER },
  ...config,
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const settle = async () => {
  await tick()
  await tick()
}
const binned_plot = (): HTMLElement => doc_query(`.binned-scatter`)
const render_mode = (): string | undefined => binned_plot().dataset.renderMode
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

function mock_canvas_context(overrides: Partial<CanvasRenderingContext2D> = {}) {
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    ...overrides,
  } as unknown as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue(ctx)
  return ctx
}

function mock_label_measurement(width: number, height: number) {
  const original_get_bounding_client_rect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    `getBoundingClientRect`,
  )?.value as (this: HTMLElement) => DOMRect
  return vi
    .spyOn(HTMLElement.prototype, `getBoundingClientRect`)
    .mockImplementation(function (this: HTMLElement) {
      if (this instanceof HTMLElement && this.classList.contains(`point-label-measure`)) {
        return {
          bottom: height,
          height,
          left: 0,
          right: width,
          top: 0,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }
      }
      return original_get_bounding_client_rect.call(this)
    })
}

describe(`BinnedScatterPlot`, () => {
  test(`supports ScatterPlot-style fullscreen controls and overlay snippets`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        density: hidden_density,
        header_controls: overlay_snippet(`custom-header-controls`),
        children: overlay_snippet(`custom-overlay`),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    const plot = binned_plot()
    const toggle = doc_query<HTMLButtonElement>(`.fullscreen-toggle`)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)
    expect(document.querySelector(`.custom-header-controls`)?.textContent).toBe(
      `800x600:false`,
    )
    expect(document.querySelector(`.custom-overlay`)).toBeInstanceOf(HTMLElement)

    toggle.click()
    await tick()
    expect(plot.classList.contains(`fullscreen`)).toBe(true)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Exit fullscreen`)

    globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
    await tick()
    expect(plot.classList.contains(`fullscreen`)).toBe(false)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)
  })

  // a NaN bound in a partially-set axis range would otherwise loop the auto-range
  // effect forever (NaN !== NaN never settles) until effect_update_depth_exceeded
  test(`NaN axis-range bound mounts without a reactive loop`, async () => {
    const errors: unknown[][] = []
    const error_spy = vi
      .spyOn(console, `error`)
      .mockImplementation((...args) => void errors.push(args))
    try {
      mount(BinnedScatterPlot, {
        target: document.body,
        props: {
          series: [{ x: [0, 1], y: [0, 1] }],
          density: hidden_density,
          x_axis: { range: [null, NaN] as [null, number] },
          style: `width: 800px; height: 600px`,
        },
      })
      await settle()
    } finally {
      error_spy.mockRestore()
    }
    expect(errors.map(String).join(`\n`)).toBe(``)
  })

  test(`can hide the fullscreen toggle`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        density: hidden_density,
        fullscreen_toggle: false,
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    expect(document.querySelector(`.fullscreen-toggle`)).toBeNull()
  })

  test(`puts visible point count in colorbar title without a mode pill`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        density: density_mode_with_colorbar(),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    expect(document.querySelector(`.mode-pill`)).toBeNull()
    expect(document.querySelector(`.colorbar .label`)?.textContent).toBe(`Density (2 points)`)
    const colorbar_style = (document.querySelector(`.colorbar .bar`) as HTMLElement).style
    expect(colorbar_style.width).toBe(`${COLOR_BAR_DEFAULTS.width}px`)
    expect(colorbar_style.height).toBe(`10px`)
  })

  test(`auto-places annotation snippet without overlapping the colorbar`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        density: density_mode_with_colorbar(),
        annotation: overlay_snippet(`custom-annotation`),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    const anno_wrapper = doc_query<HTMLElement>(`.binned-scatter .annotation`)
    expect(anno_wrapper.querySelector(`.custom-annotation`)?.textContent).toBe(`800x600:false`)
    // style.left/top are `${n}px` strings, so strip the unit before Number()
    const style_px = (value: string): number => Number(value.replace(/px$/, ``))
    // both elements report zero offset size in the test DOM, so placement uses the
    // documented fallback footprints (annotation 120x50, colorbar 220x50)
    const anno_rect = {
      x: style_px(anno_wrapper.style.left),
      y: style_px(anno_wrapper.style.top),
      width: 120,
      height: 50,
    }
    const bar_wrapper = doc_query<HTMLElement>(`.binned-scatter .color-bar`)
    const bar_rect = {
      x: style_px(bar_wrapper.style.left),
      y: style_px(bar_wrapper.style.top),
      width: COLOR_BAR_DEFAULTS.width,
      height: 50,
    }
    for (const rect of [anno_rect, bar_rect]) {
      expect(Number.isFinite(rect.x), `${rect.x}`).toBe(true)
      expect(Number.isFinite(rect.y), `${rect.y}`).toBe(true)
    }
    // exclude_rects wiring: annotation must not intersect the colorbar footprint
    const rects_intersect =
      anno_rect.x < bar_rect.x + bar_rect.width &&
      bar_rect.x < anno_rect.x + anno_rect.width &&
      anno_rect.y < bar_rect.y + bar_rect.height &&
      bar_rect.y < anno_rect.y + anno_rect.height
    expect(rects_intersect, JSON.stringify({ anno_rect, bar_rect })).toBe(false)
  })

  test(`keeps colorbar placement frozen across data changes`, async () => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(60)
    const layout_spy = vi
      .spyOn(Element.prototype, `getBoundingClientRect`)
      .mockReturnValue(DOMRect.fromRect({ width: 100, height: 60 }))
    const series = $state([{ x: [0, 1], y: [0, 1] }])
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series,
        density: density_mode_with_colorbar(),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()
    const colorbar = doc_query<HTMLElement>(`.binned-scatter .color-bar`)
    const initial_position = { left: colorbar.style.left, top: colorbar.style.top }
    layout_spy.mockClear()

    series[0].x = [0.2, 0.8]
    await tick()
    expect(layout_spy).not.toHaveBeenCalled()
    expect({ left: colorbar.style.left, top: colorbar.style.top }).toEqual(initial_position)
  })

  test(`renders annotation in point mode (no colorbar) and skips wrapper when absent`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        density: point_mode(),
        annotation: overlay_snippet(`custom-annotation`),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    expect(document.querySelector(`.color-bar`)).toBeNull()
    const anno_wrapper = doc_query<HTMLElement>(`.annotation`)
    expect(anno_wrapper.style.left).toMatch(/px$/)
    expect(anno_wrapper.style.top).toMatch(/px$/)

    document.body.replaceChildren()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()
    expect(document.querySelector(`.annotation`)).toBeNull()
  })

  test(`clips reference lines to the plot area`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        overlays: { ref_lines: [{ x1: -100, y1: -100, x2: 100, y2: 100 }] },
        density: hidden_density,
        padding: { l: 80, r: 20, t: 30, b: 60 },
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    const clip_path = document.querySelector(`clipPath[id^="binned-scatter-plot-area-"]`)
    expect(clip_path).toBeInstanceOf(SVGClipPathElement)
    expect(clip_path?.querySelector(`rect`)?.getAttribute(`x`)).toBe(`80`)
    expect(clip_path?.querySelector(`rect`)?.getAttribute(`y`)).toBe(`30`)
    expect(clip_path?.querySelector(`rect`)?.getAttribute(`width`)).toBe(`700`)
    expect(clip_path?.querySelector(`rect`)?.getAttribute(`height`)).toBe(`510`)

    const ref_group = document.querySelector(`.reference-lines`)
    expect(ref_group?.getAttribute(`clip-path`)).toBe(`url(#${clip_path?.id})`)
  })

  test.each([
    // y=x diagonal auto-fills the axis ranges: with x=y ranges [0,1] on an 800x600
    // plot padded {l:80,r:20,t:30,b:60}, it runs corner to corner
    [
      { type: `diagonal`, slope: 1, intercept: 0 } as const,
      { x1: 80, y1: 540, x2: 780, y2: 30 },
      { stroke: `currentColor`, dash: null }, // RefLine default style is solid
    ],
    // horizontal line at mid-range spans the full x extent
    [
      { type: `horizontal`, y: 0.5, style: { color: `red`, dash: `4 4` } } as const,
      { x1: 80, y1: 285, x2: 780, y2: 285 },
      { stroke: `red`, dash: `4 4` },
    ],
  ])(
    `resolves declarative RefLine %o against current axis ranges`,
    async (ref_line, coords, style) => {
      mount(BinnedScatterPlot, {
        target: document.body,
        props: {
          series: [{ x: [0, 1], y: [0, 1] }],
          x_axis: { range: [0, 1] as Vec2 },
          y_axis: { range: [0, 1] as Vec2 },
          overlays: { ref_lines: [ref_line] },
          density: hidden_density,
          padding: { l: 80, r: 20, t: 30, b: 60 },
          style: `width: 800px; height: 600px`,
        },
      })
      await settle()

      const line = document.querySelector(`.reference-lines line`)
      expect(line).toBeInstanceOf(SVGLineElement)
      for (const [attr, expected] of Object.entries(coords)) {
        expect(Number(line?.getAttribute(attr)), attr).toBeCloseTo(expected, 6)
      }
      expect(line?.getAttribute(`stroke`)).toBe(style.stroke)
      expect(line?.getAttribute(`stroke-dasharray`)).toBe(style.dash)
    },
  )

  test(`drops declarative RefLines that resolve outside the axis ranges`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        x_axis: { range: [0, 1] as Vec2 },
        y_axis: { range: [0, 1] as Vec2 },
        overlays: {
          ref_lines: [
            { type: `vertical`, x: 5 }, // outside x range -> dropped
            { type: `horizontal`, y: 0.5, visible: false }, // explicitly hidden
          ],
        },
        density: hidden_density,
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    expect(document.querySelectorAll(`.reference-lines line`)).toHaveLength(0)
  })

  test(`uses density color scale type for colorbar ticks`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: Array(100).fill(0), y: Array(100).fill(0) }],
        density: density_mode_with_colorbar({
          color_scale: { type: `log`, scheme: `interpolateMagma` },
        }),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()

    const tick_by_label = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(`.colorbar .tick-label`)].map(
        (tick_label) => [tick_label.textContent, tick_label.style.left],
      ),
    )
    expect(tick_by_label).toMatchObject({ '1': `0%`, '10': `50%`, '100': `100%` })
  })

  test(`skips non-finite coordinates in point rendering`, async () => {
    const arc = vi.fn((x: number, y: number, radius: number) => {
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
      expect(radius).toBe(4)
    })
    mock_canvas_context({ arc })

    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, NaN, 0.5, Infinity], y: [0, 0.5, NaN, 0.8] }],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    expect(render_mode()).toBe(`points`)
    expect(arc).toHaveBeenCalledOnce()
  })

  test(`scales point radii from size values in point mode`, async () => {
    const radii: number[] = []
    const arc = vi.fn((_x: number, _y: number, radius: number) => radii.push(radius))
    mock_canvas_context({ arc })

    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.2, 0.5, 0.8], y: [0.5, 0.5, 0.5], size_values: [1, 4, 16] }],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
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
    const radii: number[] = []
    const arc = vi.fn((_x: number, _y: number, radius: number) => radii.push(radius))
    mock_canvas_context({ arc })

    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.2, 0.8], y: [0.5, 0.5], size_values: [0, 32] }],
        density: point_mode(),
        size_scale,
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    expect(radii).toEqual(expected_radii)
  })

  test(`uses auto pick radius from configured size scale range`, async () => {
    const on_point_click = vi.fn()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.5], y: [0.5], size_values: [1] }],
        density: point_mode(),
        size_scale: { radius_range: [2, 18], pick_radius: `auto` },
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        on_point_click,
      },
    })
    await settle()

    binned_plot().dispatchEvent(
      new MouseEvent(`click`, { bubbles: true, clientX: 437, clientY: 280 }),
    )

    expect(on_point_click).toHaveBeenCalledOnce()
  })

  test(`pulses the selected point`, async () => {
    const radii: number[] = []
    const arc = vi.fn((_x: number, _y: number, radius: number) => radii.push(radius))
    const stroke = vi.fn()
    mock_canvas_context({ arc, stroke })

    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          {
            x: [0.4, 0.6],
            y: [0.5, 0.5],
            point_ids: [`selected`, `other`],
          },
        ],
        density: point_mode(),
        selected_point_id: `selected`,
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    expect(stroke).toHaveBeenCalled()
    expect(Math.max(...radii)).toBeGreaterThan(4)
  })

  test(`does not treat drag zoom as a bin click and can reset zoom`, async () => {
    const on_density_zoom = vi.fn()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: Array(20).fill(0.5), y: Array(20).fill(0.5) }],
        density: density_mode({ bin_px: 100 }),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        on_density_zoom,
      },
    })
    await settle()

    const plot = binned_plot()
    expect(document.querySelector(`.reset-view`)).toBeNull()
    const pointer = (type: string, clientX: number, clientY: number, button?: number) =>
      plot.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button,
          clientX,
          clientY,
          pointerId: 1,
        }),
      )
    pointer(`pointerdown`, 206, 436, 0)
    pointer(`pointermove`, 633, 124)
    pointer(`pointerup`, 633, 124)
    await tick()

    plot.dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX: 420, clientY: 247 }))
    expect(on_density_zoom).not.toHaveBeenCalled()

    plot.dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX: 420, clientY: 247 }))
    expect(on_density_zoom).toHaveBeenCalledTimes(1)
    await tick()

    const reset_btn = doc_query<HTMLButtonElement>(`.reset-view`)
    expect(reset_btn.getAttribute(`aria-label`)).toBe(`Reset view`)
    reset_btn.click()
    await tick()
    expect(document.querySelector(`.reset-view`)).toBeNull()
  })

  test.each([
    [`point`, 1, 0],
    [`none`, 0, 0],
  ] as const)(
    `supports density bin click mode %s`,
    async (bin_click, point_clicks, zoom_clicks) => {
      const on_density_zoom = vi.fn()
      const on_point_click = vi.fn()
      mount(BinnedScatterPlot, {
        target: document.body,
        props: {
          series: [{ x: Array(20).fill(0.5), y: Array(20).fill(0.5) }],
          density: density_mode({ bin_px: 100, bin_click }),
          style: `width: 800px; height: 600px`,
          x_axis: { range: [0, 1] },
          y_axis: { range: [0, 1] },
          on_density_zoom,
          on_point_click,
        },
      })
      await settle()

      binned_plot().dispatchEvent(
        new MouseEvent(`click`, { bubbles: true, clientX: 420, clientY: 247 }),
      )

      expect(on_point_click).toHaveBeenCalledTimes(point_clicks)
      expect(on_density_zoom).toHaveBeenCalledTimes(zoom_clicks)
    },
  )

  test(`can disable automatic point mode switching`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.5], y: [0.5] }],
        density: { ...hidden_density, auto_point_mode: false },
        render_mode: `density`,
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    expect(render_mode()).toBe(`density`)
  })

  test(`keeps tooltip content width near plot edge`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.95, 0.96], y: [0.5, 0.5] }],
        density: density_mode({ bin_px: 100 }),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    doc_query(`.binned-scatter`).dispatchEvent(
      new PointerEvent(`pointermove`, { bubbles: true, clientX: 740, clientY: 250 }),
    )
    await tick()

    const tooltip_style = getComputedStyle(doc_query(`.plot-tooltip`))
    expect(tooltip_style.whiteSpace).toBe(`nowrap`)
  })

  test(`matches density tooltip background to hovered bin color`, async () => {
    const on_point_click = vi.fn()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.5], y: [0.5] }],
        density: density_mode({
          color_scale: { scheme: `interpolateViridis`, value_range: [1, 2] },
          bin_px: 100,
        }),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        on_point_click,
      },
    })
    await settle()

    doc_query(`.binned-scatter`).dispatchEvent(
      new PointerEvent(`pointermove`, { bubbles: true, clientX: 420, clientY: 247 }),
    )
    await tick()

    const expected_color = document.createElement(`div`)
    expected_color.style.backgroundColor = interpolateViridis(0)
    const tooltip = doc_query<HTMLElement>(`.plot-tooltip`)
    expect(tooltip.style.backgroundColor).toBe(expected_color.style.backgroundColor)
    expect(tooltip.style.color).toBe(`#ffffff`)

    doc_query(`.binned-scatter`).dispatchEvent(
      new MouseEvent(`click`, { bubbles: true, clientX: 420, clientY: 247 }),
    )
    expect(on_point_click).toHaveBeenCalledWith(
      expect.objectContaining({ color: interpolateViridis(0) }),
    )
  })

  // Regression: colorless multi-series must use the series index color everywhere. This catches the
  // old get_series_color(0)-for-all fallback in both point rendering and per-series marginals.
  test(`colorless series use distinct per-index colors`, async () => {
    const fill_styles: string[] = []
    const ctx = mock_canvas_context()
    Object.defineProperty(ctx, `fillStyle`, {
      get: () => fill_styles.at(-1) ?? ``,
      set: (value: string) => void fill_styles.push(value),
    })
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          { x: [0.2], y: [0.2] }, // series 0
          { x: [0.5], y: [0.5] }, // series 1
        ],
        marginals: { top: { type: `histogram`, per_series: true } },
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()
    expect(render_mode()).toBe(`points`)
    // draw_points paints each colorless series with its index color (canvas fillStyle)
    expect(fill_styles).toContain(get_series_color(0))
    expect(fill_styles).toContain(get_series_color(1))
    // per-series marginals get the same index colors so they're visually distinguishable
    const marginal_fills = new Set(
      [...document.querySelectorAll(`.marginal-top rect`)].map((rect) =>
        rect.getAttribute(`fill`),
      ),
    )
    expect(marginal_fills.has(get_series_color(0))).toBe(true)
    expect(marginal_fills.has(get_series_color(1))).toBe(true)
  })

  // point_color carries the per-index color into the click payload (no marginals so the plot area
  // isn't shrunk by a marginal reservation and the click maps to series 1 at (0.5, 0.5))
  test(`point click payload carries the per-index color`, async () => {
    const on_point_click = vi.fn()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          { x: [0.2], y: [0.2] }, // series 0, away from the click
          { x: [0.5], y: [0.5] }, // series 1, under the click at (420, 280)
        ],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        on_point_click,
      },
    })
    await settle()
    binned_plot().dispatchEvent(
      new MouseEvent(`click`, { bubbles: true, clientX: 420, clientY: 280 }),
    )
    expect(on_point_click).toHaveBeenCalledWith(
      expect.objectContaining({ series_idx: 1, color: get_series_color(1) }),
    )
  })

  test(`renders point label snippets with auto-placed leader lines`, async () => {
    mock_label_measurement(80, 20)
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          {
            x: [0.5, 0.502],
            y: [0.5, 0.502],
            point_ids: [`wbm-1`, `wbm-2`],
          },
        ],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        point_labels: {
          render: point_label_snippet(),
          gap_px: 20,
          placement: { leader_line_threshold: 0 },
        },
        point_data: ({ point }: { point: { point_id?: string | number } }) => ({
          label: `${point.point_id} (Li2O-label)`,
          measure_text: `${point.point_id}\nLi2O-label`,
        }),
      },
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
    const point_center = { x: 420, y: 280 }
    const label_center = {
      x: Number(first_label.style.left.replace(`px`, ``)),
      y: Number(first_label.style.top.replace(`px`, ``)),
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
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          {
            x: Array.from({ length: n_points }, (_value, point_idx) => point_idx / n_points),
            y: Array<number>(n_points).fill(0.5),
          },
        ],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        point_labels: {
          render: point_label_snippet(),
        },
      },
    })
    await settle()

    expect(document.querySelectorAll(`.point-label`)).toHaveLength(0)
    expect(document.querySelectorAll(`.point-label-leaders line`)).toHaveLength(0)
  })

  test(`passes point data to point label snippet payloads`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          {
            x: [0.2, 0.5, 0.8],
            y: [0.5, 0.5, 0.5],
            point_ids: [`wbm-1`, `wbm-2`, `wbm-3`],
          },
        ],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        point_labels: {
          render: point_label_snippet(),
        },
        point_data: ({ point }: { point: { point_id?: string | number } }) => ({
          label: `label-${point.point_id}`,
          measure_text: String(point.point_id),
        }),
      },
    })
    await settle()

    expect(
      [...document.querySelectorAll(`.point-labels .custom-point-label`)].map(
        (label) => label.textContent,
      ),
    ).toEqual([`label-wbm-1`, `label-wbm-2`, `label-wbm-3`])
  })

  test(`passes point data to tooltips and click handlers`, async () => {
    const on_point_click = vi.fn()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
        density: point_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
        tooltip: point_tooltip_snippet(),
        point_data: ({ point }: { point: { point_id?: string | number } }) => ({
          label: `label-${point.point_id}`,
        }),
        on_point_click,
      },
    })
    await settle()

    binned_plot().dispatchEvent(
      new PointerEvent(`pointermove`, { bubbles: true, clientX: 420, clientY: 280 }),
    )
    await tick()
    expect(document.querySelector(`.custom-point-tooltip`)?.textContent).toBe(`label-wbm-1`)

    binned_plot().dispatchEvent(
      new MouseEvent(`click`, { bubbles: true, clientX: 420, clientY: 280 }),
    )
    expect(on_point_click).toHaveBeenCalledWith(
      expect.objectContaining({ point_data: { label: `label-wbm-1` } }),
    )
  })

  test(`includes configured point label gap in placement`, async () => {
    mock_label_measurement(40, 10)
    const label_distance = (): number => {
      const label = doc_query<HTMLElement>(`.point-labels .point-label`)
      const left = Number(label.style.left.replace(`px`, ``))
      const top = Number(label.style.top.replace(`px`, ``))
      return Math.hypot(left - 420, top - 284)
    }
    const base_props = {
      series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
      density: point_mode(),
      point_labels: { render: point_label_snippet() },
      point_data: () => ({ label: `wbm-1`, measure_text: `wbm-1` }),
      style: `width: 800px; height: 600px`,
      x_axis: { range: [0, 1] as [number | null, number | null] },
      y_axis: { range: [0, 1] as [number | null, number | null] },
    }

    mount(BinnedScatterPlot, {
      target: document.body,
      props: { ...base_props, point_labels: { ...base_props.point_labels, gap_px: 0 } },
    })
    await settle()
    await settle()
    const no_gap_distance = label_distance()

    document.body.replaceChildren()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: { ...base_props, point_labels: { ...base_props.point_labels, gap_px: 20 } },
    })
    await settle()
    await settle()
    expect(label_distance()).toBeGreaterThan(no_gap_distance + 15)
  })

  test(`respects leader threshold separately from visible line length`, async () => {
    mock_label_measurement(30, 10)
    const base_props = {
      series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
      density: point_mode(),
      point_labels: { render: point_label_snippet(), gap_px: 20 },
      point_data: () => ({ label: `wbm-1`, measure_text: `wbm-1` }),
      style: `width: 800px; height: 600px`,
      x_axis: { range: [0, 1] as [number | null, number | null] },
      y_axis: { range: [0, 1] as [number | null, number | null] },
    }

    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        ...base_props,
        point_labels: {
          ...base_props.point_labels,
          placement: { leader_line_threshold: 1000 },
        },
      },
    })
    await settle()
    await settle()
    expect(document.querySelectorAll(`.point-label-leaders line`)).toHaveLength(0)

    document.body.replaceChildren()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        ...base_props,
        point_labels: {
          ...base_props.point_labels,
          placement: { leader_line_threshold: 0 },
        },
      },
    })
    await settle()
    await settle()
    expect(document.querySelectorAll(`.point-label-leaders line`).length).toBeGreaterThan(0)
  })

  test(`applies point label font size to rendered and measured labels`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
        density: point_mode(),
        point_labels: { render: point_label_snippet(), font_size: `20px` },
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    expect(getComputedStyle(doc_query(`.point-labels .point-label`)).fontSize).toBe(`20px`)
    expect(getComputedStyle(doc_query(`.point-label-measure`)).fontSize).toBe(`20px`)
  })

  test(`renders rotated y-axis label as SVG text with subscript tspans`, async () => {
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [0, 1], y: [0, 1] }],
        y_axis: { label: `E<sub>form</sub>` },
        density: hidden_density,
        style: `width: 800px; height: 600px`,
      },
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

    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [
          {
            x: counted(Array.from({ length: n_points }, (_, idx) => idx / n_points)),
            y: counted(Array.from({ length: n_points }, (_, idx) => idx / n_points)),
          },
        ],
        density: density_mode(),
        style: `width: 800px; height: 600px`,
        x_axis: { range: [0, 1] },
        y_axis: { range: [0, 1] },
      },
    })
    await settle()

    expect(render_mode()).toBe(`density`)
    expect(accesses).toBe(n_points * 2)

    accesses = 0
    binned_plot().dispatchEvent(
      new PointerEvent(`pointermove`, { bubbles: true, clientX: 420, clientY: 280 }),
    )
    expect(accesses).toBe(0)
  })

  test(`mounts and bins one million auto-ranged points below the latency budget`, async () => {
    const n_points = 1_000_000
    const x = new Float32Array(n_points)
    const y = new Float32Array(n_points)
    for (let idx = 0; idx < n_points; idx++) {
      x[idx] = (idx % 10_000) / 10_000
      y[idx] = ((idx * PSEUDO_RANDOM_MULTIPLIER) % 1_000_000) / 1_000_000
    }

    const start = performance.now()
    mount(BinnedScatterPlot, {
      target: document.body,
      props: {
        series: [{ x, y }],
        density: density_mode_with_colorbar(),
        style: `width: 800px; height: 600px`,
      },
    })
    await settle()
    const elapsed_ms = performance.now() - start

    expect(render_mode()).toBe(`density`)
    expect(document.querySelector(`.colorbar .label`)?.textContent).toBe(
      `Density (1,000,000 points)`,
    )
    expect(
      elapsed_ms,
      `1M-point binned scatter mount took ${elapsed_ms.toFixed(1)}ms`,
    ).toBeLessThan(500 * CI_MULTIPLIER)
  }, 10_000)
})
