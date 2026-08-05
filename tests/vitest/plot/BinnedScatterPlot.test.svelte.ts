import type { Vec2 } from '$lib/math'
import { BinnedScatterPlot, type BinnedDensityConfig, COLOR_BAR_DEFAULTS } from '$lib/plot'
import { get_series_color } from '$lib/plot/core/data-transform'
import { interpolateViridis } from 'd3-scale-chromatic'
import { createRawSnippet, mount, tick, type ComponentProps } from 'svelte'
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
const mount_plot = (props: ComponentProps<typeof BinnedScatterPlot>): void => {
  mount(BinnedScatterPlot, {
    target: document.body,
    props: { style: `width: 800px; height: 600px`, ...props },
  })
}
// Pinning both axes to [0,1] makes client coordinates map to known data values, e.g. the
// plot center (420, 280) lands on (0.5, 0.5).
const unit_axes = { x_axis: { range: [0, 1] as Vec2 }, y_axis: { range: [0, 1] as Vec2 } }
const binned_plot = (): HTMLElement => doc_query(`.binned-scatter`)
const render_mode = (): string | undefined => binned_plot().dataset.renderMode
const click_plot = (clientX: number, clientY: number): boolean =>
  binned_plot().dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX, clientY }))
const hover_plot = (clientX: number, clientY: number): boolean =>
  binned_plot().dispatchEvent(
    new PointerEvent(`pointermove`, { bubbles: true, clientX, clientY }),
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

function mock_canvas_context(overrides: Partial<CanvasRenderingContext2D> = {}) {
  const ctx = {
    font: ``,
    measureText: vi.fn(() => ({ width: 0 })),
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
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      density: hidden_density,
      header_controls: overlay_snippet(`custom-header-controls`),
      children: overlay_snippet(`custom-overlay`),
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

    document.body.replaceChildren()
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      density: hidden_density,
      fullscreen_toggle: false,
    })
    await settle()
    expect(document.querySelector(`.fullscreen-toggle`)).toBeNull()
  })

  // a NaN bound in a partially-set axis range would otherwise loop the auto-range
  // effect forever (NaN !== NaN never settles) until effect_update_depth_exceeded
  test(`NaN axis-range bound mounts without a reactive loop`, async () => {
    const errors: unknown[][] = []
    const error_spy = vi
      .spyOn(console, `error`)
      .mockImplementation((...args) => void errors.push(args))
    try {
      mount_plot({
        series: [{ x: [0, 1], y: [0, 1] }],
        density: hidden_density,
        x_axis: { range: [null, NaN] as [null, number] },
      })
      await settle()
    } finally {
      error_spy.mockRestore()
    }
    expect(errors.map(String).join(`\n`)).toBe(``)
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
      density: point_mode(),
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
        density: point_mode(),
      })
      await settle()
      const labels = [...document.querySelectorAll(`.x-axis .tick text`)].map((node) =>
        Number(node.textContent?.replaceAll(`,`, ``)),
      )
      expect(labels).toContain(range[0])
    },
  )

  // The x axis renders through `x_axis.format ?? '.2~g'`, so auto-padding has to measure
  // with that same fallback. Leaving it off measured `format_num` strings ("10k") while the
  // axis drew scientific ones ("1e+4"), reserving a band the labels overflow.
  test(`default x tick format reserves the same room as an explicit .2~g`, async () => {
    const baseline_y = async (format?: string): Promise<number> => {
      mock_canvas_context({
        measureText: vi.fn((label: string) => ({ width: label.length * 20 })),
      } as unknown as Partial<CanvasRenderingContext2D>)
      mount_plot({
        series: [{ x: [0, 8e4], y: [0, 1] }],
        x_axis: format ? { format } : {},
        density: point_mode(),
      })
      await settle()
      const value = Number(document.querySelector(`.x-axis > line`)?.getAttribute(`y1`))
      document.body.replaceChildren()
      return value
    }
    const [fallback, explicit] = [await baseline_y(), await baseline_y(`.2~g`)]
    // Both must tilt and reserve the same band; measuring `format_num` left the fallback
    // upright at the default padding while the axis drew wider scientific labels.
    expect(explicit).toBeGreaterThan(0)
    expect(explicit).toBeLessThan(540)
    expect(fallback).toBe(explicit)
  })

  test(`puts visible point count in colorbar title without a mode pill`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      density: density_mode_with_colorbar(),
    })
    await settle()

    expect(document.querySelector(`.mode-pill`)).toBeNull()
    expect(document.querySelector(`.colorbar .label`)?.textContent).toBe(`Density (2 points)`)
    const colorbar_style = (document.querySelector(`.colorbar .bar`) as HTMLElement).style
    expect(colorbar_style.width).toBe(`${COLOR_BAR_DEFAULTS.width}px`)
    expect(colorbar_style.height).toBe(`10px`)
  })

  test(`auto-places annotation snippet without overlapping the colorbar`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      density: density_mode_with_colorbar(),
      annotation: overlay_snippet(`custom-annotation`),
    })
    await settle()

    const anno_wrapper = doc_query(`.binned-scatter .annotation`)
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
    const bar_wrapper = doc_query(`.binned-scatter .color-bar`)
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
    mount_plot({ series, density: density_mode_with_colorbar() })
    await settle()
    const colorbar = doc_query(`.binned-scatter .color-bar`)
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
      density: point_mode(),
      annotation: overlay_snippet(`custom-annotation`),
    })
    await settle()

    expect(document.querySelector(`.color-bar`)).toBeNull()
    const anno_wrapper = doc_query(`.annotation`)
    expect(anno_wrapper.style.left).toMatch(/px$/)
    expect(anno_wrapper.style.top).toMatch(/px$/)

    document.body.replaceChildren()
    mount_plot({ series: [{ x: [0, 1], y: [0, 1] }], density: point_mode() })
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
      density: hidden_density,
      padding: { l: 80, r: 20, t: 30, b: 60 },
    })
    await settle()

    const clip_path = document.querySelector(`clipPath[id^="binned-scatter-plot-area-"]`)
    expect(clip_path).toBeInstanceOf(SVGClipPathElement)
    const clip_rect = clip_path?.querySelector(`rect`)
    expect([`x`, `y`, `width`, `height`].map((attr) => clip_rect?.getAttribute(attr))).toEqual(
      [`80`, `30`, `700`, `510`],
    )

    const ref_group = document.querySelector(`.reference-lines`)
    expect(ref_group?.getAttribute(`clip-path`)).toBe(`url(#${clip_path?.id})`)
    const line = ref_group?.querySelector(`line`)
    expect(line).toBeInstanceOf(SVGLineElement)
    expect([`x1`, `y1`, `x2`, `y2`].map((attr) => Number(line?.getAttribute(attr)))).toEqual(
      coords,
    )
    expect(line?.getAttribute(`stroke`)).toBe(style.stroke)
    expect(line?.getAttribute(`stroke-dasharray`)).toBe(style.dash)
  })

  test(`drops declarative RefLines that resolve outside the axis ranges`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      ...unit_axes,
      overlays: {
        ref_lines: [
          { type: `vertical`, x: 5 }, // outside x range -> dropped
          { type: `horizontal`, y: 0.5, visible: false }, // explicitly hidden
        ],
      },
      density: hidden_density,
    })
    await settle()

    expect(document.querySelectorAll(`.reference-lines line`)).toHaveLength(0)
  })

  test(`uses density color scale type for colorbar ticks`, async () => {
    mount_plot({
      series: [{ x: Array(100).fill(0), y: Array(100).fill(0) }],
      density: density_mode_with_colorbar({
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
  })

  test(`skips non-finite coordinates in point rendering`, async () => {
    const arc = vi.fn((x: number, y: number, radius: number) => {
      expect(Number.isFinite(x)).toBe(true)
      expect(Number.isFinite(y)).toBe(true)
      expect(radius).toBe(4)
    })
    mock_canvas_context({ arc })

    mount_plot({
      series: [{ x: [0, NaN, 0.5, Infinity], y: [0, 0.5, NaN, 0.8] }],
      density: point_mode(),
      ...unit_axes,
    })
    await settle()

    expect(render_mode()).toBe(`points`)
    expect(arc).toHaveBeenCalledOnce()
  })

  test(`scales point radii from size values in point mode`, async () => {
    const radii = capture_radii()

    mount_plot({
      series: [{ x: [0.2, 0.5, 0.8], y: [0.5, 0.5, 0.5], size_values: [1, 4, 16] }],
      density: point_mode(),
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
      density: point_mode(),
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
      density: point_mode(),
      size_scale: { radius_range: [2, 18], pick_radius: `auto` },
      ...unit_axes,
      on_point_click,
    })
    await settle()

    click_plot(437, 280)

    expect(on_point_click).toHaveBeenCalledOnce()
  })

  test(`pulses the selected point`, async () => {
    const stroke = vi.fn()
    const radii = capture_radii({ stroke })

    mount_plot({
      series: [{ x: [0.4, 0.6], y: [0.5, 0.5], point_ids: [`selected`, `other`] }],
      density: point_mode(),
      selected_point_id: `selected`,
      ...unit_axes,
    })
    await settle()

    expect(stroke).toHaveBeenCalled()
    expect(Math.max(...radii)).toBeGreaterThan(4)
  })

  test(`gates drag zoom starts, suppresses its trailing click, and resets zoom`, async () => {
    const on_density_zoom = vi.fn()
    mount_plot({
      series: [{ x: Array(20).fill(0.5), y: Array(20).fill(0.5) }],
      density: density_mode({ bin_px: 100 }),
      ...unit_axes,
      on_density_zoom,
    })
    await settle()

    const plot = binned_plot()
    const canvas = plot.querySelector(`canvas`)
    if (!canvas) throw new Error(`binned scatter canvas not found`)
    // Fullscreen adds a 32px wrapper border above the canvas. Pointer coordinates
    // must remain canvas-relative rather than inheriting that wrapper offset.
    const canvas_rect = DOMRect.fromRect({ x: 0, y: 32, width: 800, height: 600 })
    vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue(canvas_rect)
    const client_coords = (x: number, y: number) => ({
      clientX: canvas_rect.left + x,
      clientY: canvas_rect.top + y,
    })
    const pointer = (type: string, x: number, y: number, button?: number) =>
      plot.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button,
          pointerId: 1,
          ...client_coords(x, y),
        }),
      )
    const click = (x: number, y: number) =>
      plot.dispatchEvent(new MouseEvent(`click`, { bubbles: true, ...client_coords(x, y) }))
    const drag = async (start: Vec2, end: Vec2) => {
      pointer(`pointerdown`, ...start, 0)
      pointer(`pointermove`, ...end)
      pointer(`pointerup`, ...end)
      await tick()
    }

    // A drag starting in the fullscreen-only border above the canvas is outside.
    await drag([400, -7], [200, 200])
    expect(document.querySelector(`.reset-view`)).toBeNull()

    // The bottom x-label margin must not initiate a drag zoom.
    await drag([400, 590], [200, 200])
    expect(document.querySelector(`.reset-view`)).toBeNull()

    await drag([206, 436], [633, 124])

    click(420, 247)
    expect(on_density_zoom).not.toHaveBeenCalled()
    click(420, 247)
    expect(on_density_zoom).toHaveBeenCalledOnce()
    await tick()

    const reset_btn = doc_query<HTMLButtonElement>(`.reset-view`)
    expect(reset_btn.getAttribute(`aria-label`)).toBe(`Reset view`)
    reset_btn.click()
    await tick()
    expect(document.querySelector(`.reset-view`)).toBeNull()

    // Only the start is gated: an interior start may end outside the plot.
    await drag([400, 300], [10, 100])
    expect(document.querySelector(`.reset-view`)).not.toBeNull()
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
        density: density_mode({ bin_px: 100, bin_click }),
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
      density: { ...hidden_density, auto_point_mode: false },
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
      density: density_mode({
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
    expect(tooltip.style.color).toBe(`#ffffff`)

    click_plot(420, 247)
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
    mount_plot({
      series: [
        { x: [0.2], y: [0.2] }, // series 0
        { x: [0.5], y: [0.5] }, // series 1
      ],
      marginals: { top: { type: `histogram`, per_series: true } },
      density: point_mode(),
      ...unit_axes,
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

  test(`renders point label snippets with auto-placed leader lines`, async () => {
    mock_label_measurement(80, 20)
    mount_plot({
      series: [{ x: [0.5, 0.502], y: [0.5, 0.502], point_ids: [`wbm-1`, `wbm-2`] }],
      density: point_mode(),
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
    mount_plot({
      series: [
        {
          x: Array.from({ length: n_points }, (_value, point_idx) => point_idx / n_points),
          y: Array<number>(n_points).fill(0.5),
        },
      ],
      density: point_mode(),
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
      density: point_mode(),
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
        color: get_series_color(1),
        point_data: { label: `label-wbm-1` },
      }),
    )
  })

  // A single labelled point at the plot center (420, 280); placement tests vary only the
  // point_labels config. Placement runs after measurement, hence the second settle.
  type PlotProps = ComponentProps<typeof BinnedScatterPlot>
  const mount_labelled_point = async (
    point_labels: PlotProps[`point_labels`],
  ): Promise<void> => {
    document.body.replaceChildren()
    mount_plot({
      series: [{ x: [0.5], y: [0.5], point_ids: [`wbm-1`] }],
      density: point_mode(),
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
      const left = Number(label.style.left.replace(`px`, ``))
      const top = Number(label.style.top.replace(`px`, ``))
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
      density: point_mode(),
      point_labels: { render: point_label_snippet(), font_size: `20px` },
      ...unit_axes,
    })
    await settle()

    expect(getComputedStyle(doc_query(`.point-labels .point-label`)).fontSize).toBe(`20px`)
    expect(getComputedStyle(doc_query(`.point-label-measure`)).fontSize).toBe(`20px`)
  })

  test(`auto-grows left padding for wide y-axis ticks`, async () => {
    mock_canvas_context({
      measureText: () => ({ width: 120 }) as TextMetrics,
    })
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      y_axis: { label: `Energy` },
      density: hidden_density,
    })
    await settle()

    const clip_rect = svg_query(`clipPath[id^="binned-scatter-plot-area-"] rect`)
    expect(svg_num(clip_rect, `x`)).toBeGreaterThan(60)
  })

  test(`renders rotated y-axis label as SVG text with subscript tspans`, async () => {
    mount_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      y_axis: { label: `E<sub>form</sub>` },
      density: hidden_density,
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
      density: density_mode(),
      ...unit_axes,
    })
    await settle()

    expect(render_mode()).toBe(`density`)
    expect(accesses).toBe(n_points * 2)

    accesses = 0
    hover_plot(420, 280)
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
    mount_plot({ series: [{ x, y }], density: density_mode_with_colorbar() })
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
