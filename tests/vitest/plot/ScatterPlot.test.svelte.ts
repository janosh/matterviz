import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import { svg_to_string } from '#lib/io/export.js'
import type { Vec2 } from '#lib/math.js'
import type {
  AxisConfig,
  AxisRanges,
  DataSeries,
  DisplayConfig,
  FillRegion,
  StyleOverrides,
} from '#lib/plot/core/types.js'
import type { FacetLayoutContext } from '#lib/plot/core/facets.js'
import { place_tooltip } from '#lib/plot/core/decorations/tooltip.js'
import { rects_overlap, type Rect, type Sides } from '#lib/plot/core/layout.js'
import { SETTLE_MS } from '#lib/plot/core/settling-tween.svelte.js'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'
import { rgb } from 'd3-color'
import { scaleSequentialLog } from 'd3-scale'
import { interpolateViridis } from 'd3-scale-chromatic'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  click_export,
  clip_rect,
  doc_query,
  fire,
  flush_render,
  pin_cycle,
  form_controls,
  keydown,
  marker_fill,
  marker_position,
  mock_canvas_context,
  mount_sized,
  mouse,
  one_tab_stop,
  plot_svg,
  query,
  resize_element,
  roving_tabindexes,
  svg_query,
  set_input,
  translate_of,
  type PinStep,
} from '../setup'

// Pass-through spy so tests can inspect what the tooltip was told to dodge
vi.mock(`#lib/plot/core/decorations/tooltip.js`, async (import_original) => {
  const original = await import_original<{ place_tooltip: typeof place_tooltip }>()
  return { ...original, place_tooltip: vi.fn(original.place_tooltip) }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const basic = {
  x: [1, 2, 3, 4, 5],
  y: [5, 3, 8, 2, 7],
  point_style: { fill: `steelblue`, radius: 5 },
}

const dense = {
  x: Array.from({ length: 40 }, (_, idx) => idx),
  y: Array.from({ length: 40 }, (_, idx) => idx % 7),
}

// an instantly settled plot without legend or controls
const bare = { point_tween: { duration: 0 }, legend: null, show_controls: false }

const mount_sized_scatter_plot = (
  props: Partial<ComponentProps<typeof ScatterPlot>>,
): Promise<HTMLElement> => mount_sized(ScatterPlot, props, { selector: `.scatter` })

test(`CDF geometry refreshes after domain, scale, style, and data changes`, async () => {
  const state = $state<{
    series: DataSeries[]
    x_axis: AxisConfig
    marginals: ComponentProps<typeof ScatterPlot>[`marginals`]
  }>({
    series: [{ x: [1, 2, 4, 8], y: [1, 2, 3, 4] }],
    x_axis: { range: [1, 8], scale_type: `linear` },
    marginals: { top: { type: `cdf`, stroke: `red` } },
  })
  const root = await mount_sized_scatter_plot(bind_props({}, state))
  const path = () => query(root, `.marginal-top path[fill="none"]`)
  let previous = path().getAttribute(`d`)
  for (const update of [
    () => (state.x_axis.range = [1, 4]),
    () => (state.x_axis.scale_type = `log`),
    () => (state.series[0].x = [1, 1.5, 3, 4]),
  ]) {
    update()
    await flush_render()
    expect(path().getAttribute(`d`)).not.toBe(previous)
    previous = path().getAttribute(`d`)
  }
  state.marginals = { top: { type: `cdf`, stroke: `blue`, curve: `step` } }
  await flush_render()
  expect(path().getAttribute(`stroke`)).toBe(`blue`)
  expect(path().getAttribute(`d`)).not.toBe(previous)
})

const axis_tick_labels = (plot: HTMLElement, side: `x` | `y` | `y2`): (string | null)[] =>
  [...plot.querySelectorAll(`.${side}-axis .tick text`)].map((label) => label.textContent)
const marker_radius = (marker: Element): number => {
  const path = marker.getAttribute(`d`) ?? ``
  const match = /^M(?<radius>-?\d*\.?\d+(?:e-?\d+)?),0/i.exec(path)
  if (!match?.groups?.radius) {
    throw new Error(`Could not read marker radius from path "${path}"`)
  }
  return Math.abs(Number(match.groups.radius))
}
const hover = (element: Element): Promise<void> => fire(element, mouse(`mouseenter`))
const next_animation_frame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))
// happy-dom reports a zero rect, so client coords are plot-local
const stub_svg_rect = (svg: SVGSVGElement) => {
  svg.getBoundingClientRect = () => DOMRect.fromRect({ width: 500, height: 300 })
}
const click_at = (element: Element, position: { x: number; y: number }) =>
  element.dispatchEvent(
    mouse(`click`, { detail: 1, clientX: position.x, clientY: position.y }),
  )
// Moves the pointer `dx`/`dy` px off the nth marker and returns where it landed
const move_to_marker = async (
  plot: HTMLElement,
  marker_idx: number,
  { dx: delta_x = 0, dy: delta_y = 0 } = {},
): Promise<{ x: number; y: number }> => {
  const svg = plot_svg(plot)
  stub_svg_rect(svg)
  const { x: coord_x, y: coord_y } = marker_position(plot, marker_idx)
  const position = { x: coord_x + delta_x, y: coord_y + delta_y }
  svg.dispatchEvent(mouse(`mousemove`, { clientX: position.x, clientY: position.y }))
  await next_animation_frame()
  return position
}
const solved_decoration_rect = (element: Element): Rect => {
  const values = [`x`, `y`, `width`, `height`].map((key) =>
    element.getAttribute(`data-decoration-${key}`),
  )
  if (values.some((value) => value == null)) {
    throw new Error(`Decoration has no solved rectangle: ${element.outerHTML}`)
  }
  const [coord_x, coord_y, width, height] = values.map(Number)
  return { x: coord_x, y: coord_y, width, height }
}
const mock_decoration_measurements = (width = 100, height = 60) => {
  vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(height)
  return vi
    .spyOn(Element.prototype, `getBoundingClientRect`)
    .mockReturnValue(DOMRect.fromRect({ width, height }))
}

describe(`ScatterPlot`, () => {
  // Past the marker threshold the SVG points that carry role/tabindex/aria-label are
  // gone, so arrow keys drive a cursor through the data instead
  describe(`canvas keyboard cursor`, () => {
    const arrow = async (svg: Element, key: string) => {
      await fire(svg, keydown(key))
    }
    const announced = (plot: HTMLElement) => query(plot, `[aria-live="polite"]`).textContent

    test(`End and arrows step and wrap, Enter pins, Escape unpins then clears`, async () => {
      const plot = await mount_sized_scatter_plot({
        series: [dense],
        marker_renderer: `canvas`,
      })
      // the live region is mounted before its first message, or that message goes unheard
      expect(announced(plot)).toBe(``)
      const svg = plot_svg(plot)
      for (const [key, expected, pinned = false] of [
        [`End`, `point 40`],
        [`Enter`, `point 40`, true], // free click: pins the cursor point's tooltip
        [`ArrowLeft`, `point 39`, true],
        [`Escape`, `point 39`], // the pin goes first
        [`Escape`, ``],
        [`ArrowRight`, `point 1`],
        [`ArrowRight`, `point 2`],
        [`ArrowLeft`, `point 1`],
        // Backwards off the start wraps to the end rather than dead-ending
        [`ArrowLeft`, `point 40`],
        [`Escape`, ``],
      ] as const) {
        await arrow(svg, key)
        if (expected) expect(announced(plot), key).toContain(expected)
        else expect(announced(plot), key).toBe(``)
        expect(plot.querySelector(`.plot-tooltip.pinned`) !== null, key).toBe(pinned)
      }
    })

    // The cursor is one flat index across both series, so the series boundary is where an
    // off-by-one shows up
    test(`the cursor crosses series and keeps its point through hiding and zoom`, async () => {
      const state = $state<{ hidden_series: (string | number)[]; x_axis: AxisConfig }>({
        hidden_series: [],
        x_axis: {},
      })
      const plot = await mount_sized_scatter_plot(
        bind_props(
          {
            series: [
              { x: [0, 1], y: [1, 2], label: `first`, id: `first` },
              { x: [2, 3], y: [3, 4], label: `second`, id: `second` },
            ],
            marker_renderer: `canvas` as const,
          },
          state,
        ),
      )
      const svg = plot_svg(plot)
      for (const expected of [`first point 1`, `first point 2`, `second point 1`]) {
        await arrow(svg, `ArrowRight`)
        expect(announced(plot)).toContain(expected)
      }
      // End lands on the last point of the last series, not past it
      await arrow(svg, `End`)
      expect(announced(plot)).toContain(`second point 2`)
      // hiding the first series shifts every flat index, but not the cursor's point
      state.hidden_series = [`first`]
      flushSync()
      expect(announced(plot)).toContain(`second point 2`)
      // zooming onto the cursor's point keeps it, and steps continue from it
      state.x_axis = { range: [1.5, 3.5] }
      flushSync()
      expect(announced(plot)).toContain(`second point 2`)
      await arrow(svg, `ArrowLeft`)
      expect(announced(plot)).toContain(`second point 1`)
      // zooming it out of view clears the cursor rather than naming second point 2 instead
      state.x_axis = { range: [2.5, 3.5] }
      flushSync()
      expect(announced(plot)).toBe(``)
    })
  })

  // No pointer event updates or clears the tooltip when the host swaps data or hides a series,
  // so the plot itself must tell on_point_hover once the point is gone
  test(`tooltip follows its point through data changes and closes when it is gone`, async () => {
    const on_point_hover = vi.fn()
    const state = $state<{
      series: DataSeries[]
      hidden_series: (string | number)[]
      tooltip_point: ComponentProps<typeof ScatterPlot>[`tooltip_point`]
    }>({
      series: [{ x: [0, 1, 2], y: [0, 1, 2], color_values: [1, NaN, 3], id: `a` }],
      hidden_series: [],
      tooltip_point: null,
    })
    const plot = await mount_sized_scatter_plot(
      bind_props(
        { point_tween: { duration: 0 }, color_bar: null, hovered: true, on_point_hover },
        state,
      ),
    )
    const tooltip_text = () =>
      plot.querySelector(`.plot-tooltip`)?.textContent?.replaceAll(/\s+/g, ` `).trim()
    const hover_point = (point_idx: number) => {
      const { x, y, color_values } = state.series[0]
      const [x_val, y_val] = [x[point_idx], y[point_idx]]
      const color_value = color_values?.[point_idx]
      state.tooltip_point = { x: x_val, y: y_val, series_idx: 0, point_idx, color_value }
      flushSync()
    }
    hover_point(2)
    expect(tooltip_text()).toContain(`x: 2 y: 2 Color: 3`)
    // a NaN color value falls back to the series color, so there is no color to report
    hover_point(1)
    expect(tooltip_text()).toContain(`x: 1 y: 1`)
    expect(tooltip_text()).not.toContain(`Color`)
    hover_point(2)
    state.series = [{ x: [0, 1, 7], y: [0, 1, 8], id: `a` }]
    flushSync()
    expect(tooltip_text()).toContain(`x: 7 y: 8`)
    expect(state.tooltip_point).toMatchObject({ x: 7, y: 8, point_idx: 2 })
    state.series = [{ x: [5, 6], y: [50, 60], id: `a` }]
    flushSync()
    expect(tooltip_text()).toBeUndefined()
    expect(state.tooltip_point).toBeNull()
    expect(on_point_hover).toHaveBeenCalledExactlyOnceWith(null)
    hover_point(1)
    expect(tooltip_text()).toContain(`x: 6 y: 60`)
    state.hidden_series = [`a`]
    flushSync()
    expect(tooltip_text()).toBeUndefined()
    expect(on_point_hover).toHaveBeenCalledTimes(2)
    state.hidden_series = []
    hover_point(0)
    state.series = []
    flushSync()
    expect(state.tooltip_point).toBeNull()
    expect(on_point_hover).toHaveBeenCalledTimes(3)
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
  })

  // No on_point_click or on_plot_click claims the click here, so it pins the tooltip
  test(`a click pins the hovered point's tooltip, which follows its point through data changes`, async () => {
    const state = $state<{
      series: DataSeries[]
      tooltip_point: ComponentProps<typeof ScatterPlot>[`tooltip_point`]
      hovered: boolean
    }>({
      series: [{ x: [0, 1, 2], y: [0, 1, 2], id: `a` }],
      tooltip_point: null,
      hovered: false,
    })
    const plot = await mount_sized_scatter_plot(
      bind_props({ ...bare, color_bar: null }, state),
    )
    const svg = plot_svg(plot)
    const hover_on = (point_idx: number) => {
      const { x, y } = state.series[0]
      state.tooltip_point = { x: x[point_idx], y: y[point_idx], series_idx: 0, point_idx }
      state.hovered = true
    }
    const act = (step: PinStep, mark_idx: 0 | 1 | null) => {
      if (step === `escape`) svg.dispatchEvent(keydown(`Escape`))
      else if (step === `leave`) svg.dispatchEvent(mouse(`mouseleave`))
      else if (mark_idx !== null) hover_on(mark_idx + 1)
      if (step === `click`) svg.dispatchEvent(mouse(`click`))
    }
    const lit = (idx: 0 | 1) =>
      plot.querySelectorAll(`.marker`)[idx + 1].classList.contains(`is-hovered`)
    expect(await pin_cycle(act, { lit })).toMatch(/x: 1\s*y: 1/)
    act(`click`, 1)
    act(`leave`, 1)
    state.series = [{ x: [0, 1, 7], y: [0, 1, 8], id: `a` }]
    flushSync()
    expect(doc_query(`.plot-tooltip.pinned`).textContent).toMatch(/x: 7\s*y: 8/)
    state.series = [{ x: [5, 6], y: [50, 60], id: `a` }]
    flushSync()
    expect(plot.querySelector(`.plot-tooltip`)).toBeNull()
  })

  test(`image export redraws the legend and color bar without touching the chart`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        { ...basic, label: `AlphaSeries`, color_values: [1, 2, 3, 4, 5] },
        { ...basic, label: `BetaSeries` },
      ],
      legend: {},
      color_bar: { title: `CbarTitle` },
    })
    const rect = DOMRect.fromRect({ x: 10, y: 20, width: 80, height: 16 })
    vi.spyOn(Element.prototype, `getBoundingClientRect`).mockReturnValue(rect)
    vi.spyOn(Range.prototype, `getBoundingClientRect`).mockReturnValue(rect)
    const svg = plot_svg(plot)
    const live_markup = svg.outerHTML
    const doc = new DOMParser().parseFromString(svg_to_string(svg), `image/svg+xml`)
    const texts = [...doc.querySelectorAll(`text`)].map((el) => el.textContent)
    expect(texts).toEqual(expect.arrayContaining([`AlphaSeries`, `BetaSeries`, `CbarTitle`]))
    // legend marker glyphs come along, and the color bar's gradient becomes an SVG gradient
    expect(doc.querySelectorAll(`svg svg`).length).toBeGreaterThanOrEqual(2)
    expect(doc.querySelector(`linearGradient stop`)).not.toBeNull()
    expect(svg.outerHTML).toBe(live_markup) // overlays are drawn into the copy only
  })

  // CSV series names match the legend: label, else series metadata.label, else `Series N`
  test(`CSV export names series as the legend does, numbered past hidden ones`, async () => {
    const save = vi.fn()
    vi.stubGlobal(`download`, save) // the global hook download() defers to
    const series = [
      { x: [1], y: [10], visible: false },
      { x: [2], y: [20] },
      { x: [3], y: [30], metadata: { label: `from meta` } },
    ]
    await mount_sized_scatter_plot({ series })
    expect(await click_export(`CSV`)).toEqual([`PNG`, `SVG`, `CSV`])
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce())
    const [csv] = save.mock.calls[0]
    expect(csv).toContain(`Series 2,2,20`)
    expect(csv).toContain(`from meta,3,30`)
    expect(csv).not.toContain(`Series 1`)
  })

  test(`error bands draw on their series' y axis and hide with it`, async () => {
    const state = $state<{ hidden_series: (string | number)[] }>({ hidden_series: [] })
    const ref = (series_id: string) => ({ type: `series` as const, series_id })
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          series: [
            { x: [0, 1, 2, 3], y: [0, 1, 0, 1], id: `a`, markers: `points` as const },
            { x: [0, 1, 2, 3], y: [1e3, 1e3, 1e3, 1e3], y_axis: `y2` as const, id: `b` },
          ],
          error_bands: [
            { series: ref(`b`), error: 10 },
            { series: ref(`a`), error: 0.5, label: `A band` },
          ],
          fill_regions: [{ upper: ref(`a`), lower: 0 }],
          point_tween: { duration: 0 },
          line_tween: { duration: 0 },
        },
        state,
      ),
    )
    const fill_paths = () => plot.querySelectorAll(`.fill-region path`)
    expect(fill_paths()).toHaveLength(3)
    state.hidden_series = [`a`]
    flushSync()
    // only b's band is left, hugging b's markers
    const [band] = fill_paths()
    expect(fill_paths()).toHaveLength(1)
    const band_ys = [
      ...(band.getAttribute(`d`) ?? ``).matchAll(/[MLC,]\s*-?[\d.e]+[, ](?<y>-?[\d.e]+)/g),
    ].map((match) => Number(match.groups?.y))
    const marker_y = marker_position(plot, 0).y
    expect(band_ys.length).toBeGreaterThan(0)
    expect(Math.min(...band_ys)).toBeGreaterThan(marker_y - 50)
    expect(Math.max(...band_ys)).toBeLessThan(marker_y + 50)
    // the hidden band's legend entry stays, greyed out
    const band_item = [...plot.querySelectorAll(`.legend-item`)].find((item) =>
      item.textContent?.includes(`A band`),
    )
    expect(band_item?.classList.contains(`hidden`)).toBe(true)
  })

  describe(`density contours`, () => {
    // Symmetric cloud: rings of points around (cx, cy) plus the center, so the KDE peak sits
    // exactly on the marker centroid
    const cloud = (cx: number, cy: number, extra: Partial<DataSeries> = {}): DataSeries => {
      const offsets = [
        [0, 0],
        ...[0.5, 1, 1.5].flatMap((radius) =>
          Array.from({ length: 12 }, (_, idx) => [
            radius * Math.cos((idx * Math.PI) / 6),
            radius * Math.sin((idx * Math.PI) / 6),
          ]),
        ),
      ]
      return {
        x: offsets.map(([dx]) => cx + dx),
        y: offsets.map(([, dy]) => cy + dy),
        ...extra,
      }
    }
    const contour_groups = (plot: HTMLElement) => [
      ...plot.querySelectorAll(`g.density-contours`),
    ]
    // Contour vertices in svg px (paths are drawn in plot-area coordinates under a translate)
    const contour_vertices = (path: Element) => {
      const offset = translate_of(path.parentElement)
      const nums =
        path
          .getAttribute(`d`)
          ?.match(/-?\d+(?:\.\d+)?/g)
          ?.map(Number) ?? []
      return Array.from({ length: nums.length / 2 }, (_, idx) => ({
        x: nums[2 * idx] + offset.x,
        y: nums[2 * idx + 1] + offset.y,
      }))
    }

    test(`off by default, one line group per visible series when enabled`, async () => {
      const series = [
        cloud(2, 2, { point_style: { fill: `crimson` } }),
        cloud(8, 8),
        cloud(5, 5, { visible: false }),
      ]
      expect(contour_groups(await mount_sized_scatter_plot({ series }))).toHaveLength(0)
      document.body.innerHTML = ``
      const plot = await mount_sized_scatter_plot({ series, density_contours: true })
      const groups = contour_groups(plot)
      expect(groups.map((group) => group.getAttribute(`data-series-idx`))).toEqual([`0`, `1`])
      const paths = [...groups[0].querySelectorAll(`path`)]
      // Default levels, outermost first so the core paints last
      expect(paths.map((path) => Number(path.getAttribute(`data-fraction`)))).toEqual([
        0.8, 0.6, 0.4, 0.2,
      ])
      for (const path of paths) {
        expect(path.getAttribute(`d`)).not.toMatch(/NaN|Infinity/)
        expect(path.getAttribute(`stroke`)).toBe(`crimson`)
        expect(path.getAttribute(`fill`)).toBe(`none`)
      }
      // Contours ignore the pointer so they never steal hover from the markers above them
      expect(groups[0].getAttribute(`pointer-events`)).toBe(`none`)
      // Hovering a legend entry fades the other series' contours with their markers
      await hover(query(plot, `.legend-item`))
      expect(groups.map((group) => group.getAttribute(`opacity`))).toEqual([`1`, `0.25`])
    })

    test(`contours ring the cluster centroid, inner levels tighter`, async () => {
      const plot = await mount_sized_scatter_plot({
        series: [cloud(5, 5)],
        x_axis: { range: [0, 10] },
        y_axis: { range: [0, 10] },
        density_contours: { bandwidth: 10, levels: [0.3, 0.9] },
      })
      const n_markers = plot.querySelectorAll(`.marker`).length
      const markers = Array.from({ length: n_markers }, (_, idx) => marker_position(plot, idx))
      const center = {
        x: markers.reduce((sum, pt) => sum + pt.x, 0) / n_markers,
        y: markers.reduce((sum, pt) => sum + pt.y, 0) / n_markers,
      }
      const mean_radius = (path: Element) => {
        const verts = contour_vertices(path)
        // Centroid within 1 px of the markers' (the cloud is point-symmetric)
        const centroid_x = verts.reduce((sum, pt) => sum + pt.x, 0) / verts.length
        const centroid_y = verts.reduce((sum, pt) => sum + pt.y, 0) / verts.length
        expect(Math.hypot(centroid_x - center.x, centroid_y - center.y)).toBeLessThan(1)
        return (
          verts.reduce((sum, pt) => sum + Math.hypot(pt.x - center.x, pt.y - center.y), 0) /
          verts.length
        )
      }
      const [outer, inner] = [...plot.querySelectorAll(`g.density-contours path`)]
      expect(mean_radius(inner)).toBeLessThan(mean_radius(outer))
    })

    test.each([
      [`filled with default opacity`, { filled: true }, `0.15`, `none`, `0`],
      [
        `filled with outline`,
        { filled: true, fill_opacity: 0.3, stroke_width: 2 },
        `0.3`,
        `teal`,
        `2`,
      ],
    ])(`%s`, async (_name, config, fill_opacity, stroke, stroke_width) => {
      const plot = await mount_sized_scatter_plot({
        series: [cloud(5, 5, { point_style: { fill: `teal` } })],
        density_contours: config,
      })
      for (const path of plot.querySelectorAll(`g.density-contours path`)) {
        expect(path.getAttribute(`fill`)).toBe(`teal`)
        expect(path.getAttribute(`fill-opacity`)).toBe(fill_opacity)
        expect(path.getAttribute(`stroke`)).toBe(stroke)
        expect(path.getAttribute(`stroke-width`)).toBe(stroke_width)
      }
    })

    // The arcsinh scale reads a JSON null as 0, a real pixel; on a log axis non-positive
    // values have no pixel. Either way the contours must equal the series' without them.
    test.each([
      [`null on an arcsinh axis`, `arcsinh`, [null as unknown as number]],
      [`non-positive on a log axis`, `log`, [0, -3]],
    ] as const)(`%s is skipped, not drawn`, async (_name, scale_type, bad_ys) => {
      const clean = cloud(5, 5)
      const dirty: DataSeries = {
        x: [...clean.x, ...bad_ys.map(() => 5)],
        y: [...clean.y, ...bad_ys],
      }
      const contour_paths = async (srs: DataSeries) => {
        document.body.innerHTML = ``
        const plot = await mount_sized_scatter_plot({
          series: [srs],
          y_axis: { scale_type, range: scale_type === `log` ? [1, 10] : [0, 10] },
          x_axis: { range: [0, 10] },
          density_contours: true,
        })
        return [...plot.querySelectorAll(`g.density-contours path`)].map((path) =>
          path.getAttribute(`d`),
        )
      }
      const clean_paths = await contour_paths(clean)
      expect(clean_paths.length).toBeGreaterThan(0)
      expect(await contour_paths(dirty)).toEqual(clean_paths)
    })
  })

  describe(`size legend`, () => {
    const bubbles = (
      size_values: (number | null)[],
      extra: Partial<DataSeries> = {},
    ): DataSeries => ({
      x: size_values.map((_, idx) => idx),
      y: size_values.map((_, idx) => (idx * 7) % 5),
      size_values,
      ...extra,
    })

    test(`draws reference circles at the radii the markers get`, async () => {
      // 20 and 60 are both data and legend values, so their markers must match the circles,
      // even with a static symbol_size the size scale has to override
      const size_values = [3, 20, 45, 60, 97]
      const plot = await mount_sized_scatter_plot({
        series: [
          bubbles(size_values, { markers: `points`, point_style: { symbol_size: 400 } }),
        ],
        size_legend: { title: `Atoms` },
        color_bar: null,
        marker_renderer: `svg`,
      })
      const wrapper = query(plot, `.size-legend-wrapper`)
      expect(wrapper.getAttribute(`data-decoration-location`)).toBe(`interior`)
      expect(wrapper.querySelector(`.title`)?.textContent).toBe(`Atoms`)
      const labels = [...wrapper.querySelectorAll(`text:not(.title)`)].map((el) =>
        el.textContent?.trim(),
      )
      expect(labels).toEqual([`20`, `60`, `80`])
      const legend_radii = [...wrapper.querySelectorAll(`circle`)].map((circle) =>
        Number(circle.getAttribute(`r`)),
      )
      const markers = [...plot.querySelectorAll(`.marker`)]
      expect(markers).toHaveLength(5)
      // Marker paths carry 3 decimals (d3-path rounding), so agree to half the last digit
      for (const [legend_idx, data_idx] of [
        [0, 1],
        [1, 3],
      ]) {
        expect(legend_radii[legend_idx]).toBeCloseTo(marker_radius(markers[data_idx]), 3)
      }
    })

    test.each([
      [`no size values`, [{ x: [0, 1, 2], y: [0, 1, 2] }], {}, {}],
      [`one distinct size`, [bubbles([4, 4, 4])], {}, {}],
      [`only non-finite sizes`, [bubbles([null, null])], {}, {}],
      [
        `sizes only in a hidden series`,
        [bubbles([1, 9], { visible: false }), { x: [0], y: [0] }],
        {},
        {},
      ],
      [`size_legend null`, [bubbles([1, 5, 9])], null, {}],
      // The legend explains marker sizes, so it goes with the markers
      [`line-only markers`, [bubbles([1, 5, 9], { markers: `line` })], {}, {}],
      [`points hidden`, [bubbles([1, 5, 9])], {}, { show_points: false }],
    ] as const)(`hidden with %s`, async (_name, series, size_legend, styles) => {
      const plot = await mount_sized_scatter_plot({ series: [...series], size_legend, styles })
      expect(plot.querySelector(`.size-legend-wrapper`)).toBeNull()
    })

    test(`placed clear of the colorbar`, async () => {
      const plot = await mount_sized_scatter_plot({
        series: [bubbles([1, 4, 9, 16, 25], { color_values: [1, 2, 3, 4, 5] })],
      })
      const size_rect = solved_decoration_rect(query(plot, `.size-legend-wrapper`))
      const colorbar_rect = solved_decoration_rect(query(plot, `.colorbar-wrapper`))
      expect(size_rect.width).toBeGreaterThan(0)
      expect(rects_overlap(size_rect, colorbar_rect)).toBe(false)
    })

    test(`wrapper_style pins it outside the solver`, async () => {
      const plot = await mount_sized_scatter_plot({
        series: [bubbles([1, 5, 9])],
        size_legend: { wrapper_style: `right: 4px; bottom: 4px;` },
      })
      const wrapper = query(plot, `.size-legend-wrapper`)
      expect(wrapper.getAttribute(`style`)).toBe(`right: 4px; bottom: 4px;`)
      expect(wrapper.hasAttribute(`data-decoration-location`)).toBe(false)
      expect(wrapper.querySelectorAll(`circle`)).toHaveLength(3)
    })
  })

  describe(`error bars`, () => {
    // One path per series holds every bar, so bars are counted by their subpaths:
    // each bar emits exactly three M commands (two caps and the shaft).
    const n_bars = (plot: HTMLElement) =>
      [...plot.querySelectorAll(`path.error-bars`)]
        .map((path) => (path.getAttribute(`d`) ?? ``).match(/M/g)?.length ?? 0)
        .reduce((sum, n_moves) => sum + n_moves, 0) / 3

    test.each([
      [`symmetric scalar`, [{ y_error: 1 }], 5, 1],
      [`per-point array`, [{ y_error: [1, 2, 3, 4, 5] }], 5, 1],
      [`asymmetric`, [{ y_error: { lower: 1, upper: 2 } }], 5, 1],
      [`both axes`, [{ x_error: 1, y_error: 1 }], 10, 1],
      [`two series`, [{ y_error: 1 }, { y_error: 2 }], 10, 2],
      [`no error declared`, [{}], 0, 0],
      // A zero-width bar is not drawn at all, rather than a degenerate zero-length path
      [`all-zero error`, [{ y_error: 0 }], 0, 0],
    ])(`%s renders %i bars in %i path(s)`, async (_name, error_props, expected, n_paths) => {
      const series = error_props.map((props) => ({ ...basic, ...props }))
      const plot = await mount_sized_scatter_plot({ series })
      expect(n_bars(plot)).toBe(expected)
      // One path holds all of a series' bars: thousands of points must not remount thousands
      // of nodes and undo the canvas threshold
      expect(plot.querySelectorAll(`path.error-bars`)).toHaveLength(n_paths)
    })

    test(`bar spans the point's value +/- its error and the axis reaches it`, async () => {
      // Single point at y=5 with +/-100 forces the y range to include 105
      const plot = await mount_sized_scatter_plot({
        series: [{ x: [1], y: [5], y_error: 100 }],
      })
      const bar = plot.querySelector(`path.error-bars`)
      const nums = (bar?.getAttribute(`d`) ?? ``).match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
      expect(nums.length).toBeGreaterThan(0)
      // The bar must have non-zero pixel height, i.e. both ends are on the canvas
      const y_values = nums.filter((_, idx) => idx % 2 === 1)
      expect(Math.max(...y_values) - Math.min(...y_values)).toBeGreaterThan(1)
    })

    // Ends at nice tick values used to become the exact auto range, putting the outer
    // markers and their caps on the frame where the plot-area clip cut them in half
    test.each([
      [`default markers`, {}, 2.75],
      [`large markers`, { point_style: { radius: 12, stroke_width: 2 } }, 13],
      [`sized markers`, { size_values: [1, 2] }, 10.25],
      // a d3 triangle reaches 1.555 r from its centre, past the circle radius
      [`triangles`, { point_style: { radius: 8, symbol_type: `Triangle` } }, 1.555 * 8 + 0.5],
    ])(
      `%s and caps at the data extremes draw inside the frame`,
      async (_name, extra, extent) => {
        const plot = await mount_sized_scatter_plot({
          ...bare,
          series: [
            {
              x: [175, 200],
              y: [200, 240],
              y_error: { lower: [5, 10], upper: [10, 0] },
              ...extra,
            },
          ],
        })
        const { x, y, width, height } = clip_rect(plot)
        // Markers reach `extent` past their centre; every vertex of the bars' M/H/V path, caps
        // included, half the 1px bar stroke
        const bar_vertices: { x: number; y: number }[] = []
        const bar_path = plot.querySelector(`path.error-bars`)?.getAttribute(`d`) ?? ``
        for (const { groups } of bar_path.matchAll(/(?<cmd>[MHV])(?<args>[^MHV]+)/g)) {
          const { cmd, args } = groups ?? {}
          const nums = args.split(`,`).map(Number)
          const prev = bar_vertices.at(-1) ?? { x: Number.NaN, y: Number.NaN }
          if (cmd === `M`) bar_vertices.push({ x: nums[0], y: nums[1] })
          else if (cmd === `H`) bar_vertices.push({ x: nums[0], y: prev.y })
          else bar_vertices.push({ x: prev.x, y: nums[0] })
        }
        const boxes = [
          ...[0, 1].map((idx) => [marker_position(plot, idx), extent] as const),
          ...bar_vertices.map((vertex) => [vertex, 0.5] as const),
        ]
        expect(boxes.length).toBeGreaterThan(2)
        for (const [center, half] of boxes) {
          expect(center.x - half).toBeGreaterThanOrEqual(x)
          expect(center.x + half).toBeLessThanOrEqual(x + width)
          expect(center.y - half).toBeGreaterThanOrEqual(y)
          expect(center.y + half).toBeLessThanOrEqual(y + height)
        }
      },
    )
  })

  // Regression: every mark used to carry tabindex=0, so tabbing past a chart meant
  // one press per bin/point/box. Exactly one mark holds the group's tab stop.
  test(`marks are reachable by Tab exactly once`, async () => {
    const tabindexes = roving_tabindexes(
      await mount_sized_scatter_plot({ series: [basic], on_point_click: () => {} }),
    )
    expect(tabindexes.length).toBeGreaterThan(1)
    expect(tabindexes).toEqual(one_tab_stop(tabindexes.length))
  })

  // Only interactive points carry roving marks, so a plain plot must not rescan its SVG for
  // them on every hover, and an interactive one rescans at most once per hover
  test.each([
    { desc: `plain`, extra: {}, max_scans: 0 },
    { desc: `interactive`, extra: { on_point_click: () => {} }, max_scans: 3 },
  ])(
    `hovering $desc points rescans roving marks at most $max_scans times`,
    async ({ extra, max_scans }) => {
      const state = $state<{
        tooltip_point: ComponentProps<typeof ScatterPlot>[`tooltip_point`]
      }>({ tooltip_point: null })
      const props = { series: [basic], marker_renderer: `svg` as const, hovered: true }
      await mount_sized_scatter_plot(bind_props({ ...props, ...extra }, state))
      await tick()
      const scan_spy = vi.spyOn(Element.prototype, `querySelectorAll`)
      for (const point_idx of [0, 1, 2]) {
        const [x_val, y_val] = [basic.x[point_idx], basic.y[point_idx]]
        state.tooltip_point = { x: x_val, y: y_val, series_idx: 0, point_idx }
        await flush_render()
      }
      const roving_scans = scan_spy.mock.calls.filter(([selector]) =>
        selector.includes(`data-roving-key`),
      )
      expect(roving_scans.length).toBeLessThanOrEqual(max_scans)
    },
  )

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
    // ranges reach half a tick past the data so the end markers (radius 5) aren't clipped
    expect(report).toEqual({
      padding: { t: 7, b: 11, l: 13, r: 17 },
      ranges: { x: [0.5, 5.5], x2: [0, 1], y: [1.5, 8.5], y2: [0, 1] },
    })
    expect(clip_rect(plot)).toEqual({ x: 83, y: 17, width: 288, height: 236 })
    expect(plot.querySelector(`.x-axis`)).toBeNull()
    expect(plot.querySelector(`.y-axis`)).not.toBeNull()
    expect(update_range).not.toHaveBeenCalled()
  })

  // Shared side-by-side padding is explicit, so the plot must report its axes' needs back up
  test(`resolved_padding raises explicit top/bottom to what the axis titles need`, async () => {
    const state = $state<{ resolved_padding?: Required<Sides> }>({
      resolved_padding: undefined,
    })
    const padding = { t: 7, b: 11, l: 13, r: 17 }
    const x_axis = { label: `Electron density of states per unit energy (states/eV)` }
    await mount_sized_scatter_plot(bind_props({ series: [basic], padding, x_axis }, state))
    await vi.waitFor(() => expect(state.resolved_padding?.b).toBeGreaterThan(padding.b))
    expect(state.resolved_padding).toMatchObject({ t: 7, l: 13, r: 17 })
  })

  test(`resolved_padding fed back into the plot settles instead of looping`, async () => {
    const state = $state<{ resolved_padding?: Required<Sides> }>({
      resolved_padding: undefined,
    })
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const props = {
      series: [{ ...basic, color_values: [1, 2, 3, 4, 5] }],
      padding: { r: 70 },
      // the scatter-plot demo sizes its external color bar from the bound padding
      get color_bar() {
        const { t = 0, b = 0 } = state.resolved_padding ?? {}
        return { wrapper_style: `position: absolute; height: calc(100% - ${t + b}px)` }
      },
    }
    await mount_sized_scatter_plot(bind_props(props, state))
    await flush_render()
    expect(state.resolved_padding?.r).toBe(70)
    expect(error_spy.mock.calls.flat().join(` `)).not.toContain(`effect_update_depth_exceeded`)
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
    if (open) {
      expect(
        plot.querySelector(`[data-key="line.opacity"]`)?.closest(`.style-row`),
      ).not.toBeNull()
    }
  })

  test(`draws a current-frame guide through the plot area`, async () => {
    const plot = await mount_sized_scatter_plot({ series: [basic], current_x_value: 3 })
    const clip = clip_rect(plot)
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
    const labelled_series = (point_idx = 3) => ({
      ...dense,
      point_label: dense.x.map((_, idx) =>
        idx === point_idx ? { text: `tagged` } : { text: undefined },
      ),
    })
    const mount_canvas = (props: Partial<ComponentProps<typeof ScatterPlot>> = {}) =>
      mount_sized_scatter_plot({ series: [dense], marker_renderer: `canvas`, ...props })
    test.each([
      [`auto`, 40, false],
      [`svg`, 40, false],
      [`canvas`, 40, true],
      [`auto`, 1000, false],
      [`auto`, 1001, true],
    ] as const)(`%s, %i points: canvas %s`, async (renderer, n_points, canvas) => {
      const coords = Array.from({ length: n_points }, (_, idx) => idx)
      const plot = await mount_sized_scatter_plot({
        series: [{ x: coords, y: coords }],
        marker_renderer: renderer,
      })
      expect(Boolean(plot.querySelector(`canvas.marker-canvas`))).toBe(canvas)
      expect(plot.querySelectorAll(`path.marker`)).toHaveLength(canvas ? 0 : n_points)
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
      const canvas = query<HTMLCanvasElement>(overlaid, `canvas.marker-canvas`)
      expect(canvas.parentElement?.tagName.toLowerCase()).toBe(`foreignobject`)
      const ratio = globalThis.devicePixelRatio ?? 1
      expect([canvas.width, canvas.height]).toEqual([
        Math.round(400 * ratio),
        Math.round(300 * ratio),
      ])
      expect(canvas.style.width).toBe(`400px`)
      // export repaints the markers on a fresh canvas at 2x via the registered painter
      vi.spyOn(HTMLCanvasElement.prototype, `toDataURL`).mockReturnValue(
        `data:image/png;base64,cGxvdA==`,
      )
      const exported = new DOMParser().parseFromString(
        svg_to_string(plot_svg(overlaid)),
        `image/svg+xml`,
      )
      const image = query(exported, `image[href="data:image/png;base64,cGxvdA=="]`)
      expect(
        query(exported, `g[clip-path] path`).compareDocumentPosition(image) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      const overlay_marker = [...exported.querySelectorAll(`path`)].at(-1)
      if (!overlay_marker) throw new Error(`exported overlay marker missing`)
      expect(
        image.compareDocumentPosition(overlay_marker) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

      const state = $state<{
        tooltip_point: ComponentProps<typeof ScatterPlot>[`tooltip_point`]
        selected_points: { series_idx: number; point_idx: number }[]
        marker_renderer: `canvas` | `svg`
      }>({ tooltip_point: null, selected_points: [], marker_renderer: `canvas` })
      const hover_plot = await mount_sized_scatter_plot(bind_props({ series: [dense] }, state))
      const draws_before_hover = clear_rect.mock.calls.length
      state.tooltip_point = { x: dense.x[4], y: dense.y[4], series_idx: 0, point_idx: 4 }
      await flush_render()
      expect(clear_rect).toHaveBeenCalledTimes(draws_before_hover)
      expect(hover_plot.querySelectorAll(`path.marker`)).toHaveLength(1)
      // The hovered overlay is filled so canvas hovers and the keyboard cursor stay visible
      const hovered_fill = query(hover_plot, `path.marker`).getAttribute(`fill`)
      expect(hovered_fill).toMatch(/^var\(--point-fill-color/)
      // Empty selection must stay reactive when points enter/leave the SVG overlay.
      for (const selected of [[4, 5], []]) {
        state.selected_points = selected.map((idx) => ({ series_idx: 0, point_idx: idx }))
        await flush_render()
        expect(arcs_since_clear).toBe(dense.x.length - selected.length)
        expect(hover_plot.querySelectorAll(`path.marker`)).toHaveLength(selected.length || 1)
      }
      const removed_canvas = query(hover_plot, `canvas`)
      state.marker_renderer = `svg`
      await flush_render()
      expect(removed_canvas.parentNode).toBeNull()
      expect(hover_plot.querySelector(`canvas`)).toBeNull()
      state.marker_renderer = `canvas`
      await flush_render()
      expect(query(hover_plot, `canvas`)).not.toBe(removed_canvas)
    })

    test(`disables point tweening for canvas overlays`, async () => {
      mock_canvas_context()
      const tweened = await mount_canvas({
        selected_point: { series_idx: 0, point_idx: 5 },
        point_tween: { duration: 60_000 },
      })
      const clip = clip_rect(tweened)
      const { x: coord_x, y: coord_y } = marker_position(tweened, 0)
      expect(
        Math.hypot(coord_x - (clip.x + clip.width / 2), coord_y - (clip.y + clip.height / 2)),
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

    // a line-only copy painted first ties every marker: its unmarked points must not win clicks.
    // With the tooltip off and no hover/plot-click handler, the pointer still arms the cursor.
    test.each([
      { desc: `markers only`, series: [dense], series_idx: 0, tooltip_off: false },
      {
        desc: `under a line-only copy`,
        series: [{ ...dense, markers: `line` as const }, dense],
        series_idx: 1,
        tooltip_off: false,
      },
      { desc: `tooltip off`, series: [dense], series_idx: 0, tooltip_off: true },
    ])(
      `keeps canvas markers with click handlers and routes clicks to the nearest marker ($desc)`,
      async ({ series, series_idx, tooltip_off }) => {
        const on_point_click = vi.fn()
        const on_plot_click = vi.fn()
        const plot = await mount_canvas({
          series,
          on_point_click,
          ...(tooltip_off ? { tooltip: false } : { on_plot_click }),
          point_tween: { duration: 0 },
          // its overlay tells us where marker 4 sits on screen
          selected_point: { series_idx, point_idx: 4 },
        })
        expect(plot.querySelector(`canvas.marker-canvas`)).not.toBeNull()
        const svg = plot_svg(plot)
        stub_svg_rect(svg)
        const position = marker_position(plot, 0)
        // the click goes to the plot surface itself, not to that overlay marker
        svg.dispatchEvent(mouse(`mousemove`, { clientX: position.x + 2, clientY: position.y }))
        await next_animation_frame()
        expect(svg.style.cursor).toBe(`pointer`)
        click_at(svg, { x: position.x + 2, y: position.y })
        expect(on_point_click).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ x: dense.x[4], y: dense.y[4], series_idx }),
        )
        expect(on_plot_click).not.toHaveBeenCalled()
        // a click far from every point activates nothing
        click_at(svg, { x: 1, y: 1 })
        expect(on_point_click).toHaveBeenCalledOnce()
      },
    )

    test(`keeps SVG markers when point handlers require DOM events`, async () => {
      const on_keydown = vi.fn()
      const on_context_menu = vi.fn()
      const plot = await mount_canvas({
        point_events: { oncontextmenu: on_context_menu, onkeydown: on_keydown },
      })
      expect(plot.querySelector(`canvas.marker-canvas`)).toBeNull()
      plot.querySelector(`path.marker`)?.parentElement?.dispatchEvent(keydown(`a`))
      expect(on_keydown).toHaveBeenCalledOnce()
      plot.querySelector(`path.marker`)?.dispatchEvent(mouse(`contextmenu`))
      expect(on_context_menu).toHaveBeenCalledOnce()
    })

    test.each([
      `var(--series-color)`,
      `light-dark(black, white)`,
      `currentColor`,
      `url(#series-gradient)`,
      `color-mix(in srgb, red, blue)`,
    ])(`keeps SVG markers for canvas-unsafe color %s`, async (fill) => {
      const plot = await mount_canvas({ series: [{ ...dense, point_style: { fill } }] })
      expect(plot.querySelector(`canvas.marker-canvas`)).toBeNull()
      expect(plot.querySelectorAll(`path.marker`)).toHaveLength(dense.x.length)
    })

    test(`reports point offsets in handler screen coordinates`, async () => {
      const on_point_click = vi.fn()
      const plot = await mount_sized_scatter_plot({
        series: [{ x: [1], y: [2], point_offset: { x: 24, y: -12 } }],
        on_point_click,
        point_tween: { duration: 0 },
      })
      await tick()
      const marker = plot.querySelector(`path.marker`)
      const { x: coord_x, y: coord_y } = marker_position(plot, 0)
      marker?.dispatchEvent(mouse(`click`))
      const handler_props = on_point_click.mock.calls[0]?.[0]
      expect(handler_props?.cx).toBeCloseTo(coord_x)
      expect(handler_props?.cy).toBeCloseTo(coord_y)
    })

    test(`paints link-dimmed markers first at 0.25 alpha, highlighted ones on top`, async () => {
      const fill_alphas: number[] = []
      const ctx = mock_canvas_context({ fill: vi.fn(() => fill_alphas.push(ctx.globalAlpha)) })
      // p0 and p1 lead the data, so data order alone would paint them first
      const point_ids = dense.x.map((idx) => `p${idx}`)
      await mount_canvas({ series: [{ ...dense, point_ids }], highlighted_ids: [`p0`, `p1`] })
      expect(fill_alphas).toEqual([...Array.from({ length: 38 }, () => 0.25), 1, 1])
    })
  })

  test(`highlighted_ids dims keyed points outside the set and follows updates`, async () => {
    const keyed = { x: [1, 2, 3, 4], y: [4, 1, 3, 2], point_ids: [`a`, `b`, 3, `d`] }
    const state = $state<Pick<ComponentProps<typeof ScatterPlot>, `highlighted_ids`>>({
      highlighted_ids: null,
    })
    const series = [keyed, { x: [1.5, 2.5], y: [2, 3] }]
    const plot = await mount_sized_scatter_plot(
      bind_props({ series, marker_renderer: `svg` as const }, state),
    )
    // x = dimmed marker; unkeyed points (the last two) never dim, an empty set dims all keyed ones
    for (const [highlighted_ids, expected] of [
      [null, `......`],
      [[`b`, 3], `x..x..`],
      [new Set([`a`]), `.xxx..`],
      [[], `xxxx..`],
    ] as const) {
      state.highlighted_ids = highlighted_ids
      await flush_render()
      const markers = [...plot.querySelectorAll(`g[data-series-id] path.marker`)]
      const dimmed = markers.map((marker) =>
        marker.classList.contains(`is-dimmed`) ? `x` : `.`,
      )
      expect(dimmed.join(``)).toBe(expected)
    }
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
    // an initial view prop sets the first rendered range
    {
      series: [{ x: [10, 25, 90], y: [1, 5, 9] }],
      view: { x: [20, 30] as Vec2 },
      expected_markers: 1,
    },
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
    // series without unit or axis_group share one unlabeled y-axis
    expect(plot.querySelector(`g.y2-axis`)).toBeNull()
    expect(plot.querySelector(`.y-axis .axis-label`)).toBeNull()
  })

  // Auto visibility uses rendered entries after shared-identity and fill-region folding.
  const labeled_series = (...labels: string[]) => labels.map((label) => ({ ...basic, label }))
  const fill_region: FillRegion = { lower: 0, upper: 4, fill: `steelblue` }
  type LegendAutoCase = [string, Partial<ComponentProps<typeof ScatterPlot>>, number]
  // oxfmt-ignore
  const legend_auto_cases: LegendAutoCase[] = [
    [`distinct labels auto-show`, { series: labeled_series(`A`, `B`) }, 2],
    [`duplicate labels remain distinct`, { series: labeled_series(`Dup`, `Dup`) }, 2],
    [`IDs cannot collide with label/group keys`, { series: [{ ...basic, id: `foo`, label: `First` }, { ...basic, legend_group: `string`, label: `foo` }] }, 2],
    [`distinct IDs keep identical labels separate`, { series: labeled_series(`Dup`, `Dup`).map((srs, idx) => ({ ...srs, id: idx })) }, 2],
    [`shared legend IDs combine distinct drawing IDs and labels`, { series: labeled_series(`A`, `B`).map((srs, idx) => ({ ...srs, id: idx, legend_id: `shared` })), show_legend: true }, 1],
    [`explicit true shows a single series`, { series: labeled_series(`Only`), show_legend: true }, 1],
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

  test(`legend-hidden series stays hidden across one-way series replacement until the parent changes hidden_series`, async () => {
    const make_series = (first_extra: Partial<DataSeries> = {}): DataSeries[] => [
      { ...basic, id: `a`, label: `A`, ...first_extra },
      { ...basic, id: `b`, label: `B` },
    ]
    const state = $state<{
      series: DataSeries[]
      hidden_series?: readonly (string | number)[]
    }>({ series: make_series() })
    // getter-only prop: one-way, the component cannot write back into the parent
    const plot = await mount_sized_scatter_plot({
      get series() {
        return state.series
      },
      get hidden_series() {
        return state.hidden_series
      },
      set hidden_series(value) {
        state.hidden_series = value
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

    // Explicit visibility state shows it again without replacing the series.
    state.hidden_series = []
    flushSync()
    expect(first_hidden()).toBe(false)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(10)
  })

  test(`axis choices request host updates without replacing input data or axis metadata`, async () => {
    const x_axis = Object.freeze({
      label: `Energy`,
      selected_key: `energy`,
      options: [
        { key: `energy`, label: `Energy` },
        { key: `volume`, label: `Volume` },
      ],
    })
    const on_axis_change = vi.fn()
    const plot = await mount_sized_scatter_plot({ series: [basic], x_axis, on_axis_change })
    plot.querySelector<HTMLButtonElement>(`button.axis-trigger`)?.click()
    flushSync()
    const option = [...document.querySelectorAll<HTMLButtonElement>(`[role="option"]`)].find(
      (candidate) => candidate.textContent?.includes(`Volume`),
    )
    expect(option).toBeDefined()
    option?.click()
    await tick()
    expect(on_axis_change).toHaveBeenCalledWith(`x`, `volume`)
    expect(x_axis.selected_key).toBe(`energy`)
    expect(plot.querySelector(`button.axis-trigger`)?.textContent).toContain(`Energy`)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(5)
  })

  test.each([false, true])(
    `legend hover follows shared identity (grouped=%s)`,
    async (grouped) => {
      const plot = await mount_sized_scatter_plot({
        series: [0, 1, 2].map((idx) => ({
          id: idx,
          legend_id: grouped && idx < 2 ? `shared` : undefined,
          label: `Series ${idx}`,
          x: [idx * 2, idx * 2 + 1],
          y: [idx * 2, idx * 2 + 1],
          markers: `line+points`,
        })),
        point_tween: { duration: 0 },
      })
      const items = [...plot.querySelectorAll<HTMLElement>(`.legend-item`)]
      expect(items).toHaveLength(grouped ? 2 : 3)
      await hover(items[0])
      expect(
        [0, 1, 2].map((idx) =>
          plot.querySelector(`g[data-series-id="${idx}"][opacity]`)?.getAttribute(`opacity`),
        ),
      ).toEqual([`1`, grouped ? `1` : `0.25`, `0.25`])
      items[0].dispatchEvent(mouse(`mouseleave`))
      await move_to_marker(plot, 2)
      expect(items.map((item) => item.classList.contains(`active`))).toEqual(
        grouped ? [true, false] : [false, true, false],
      )
    },
  )

  test.each([0, 300])(
    `keeps line cropping consistent through pan for duration %s`,
    async (duration) => {
      const x_values = Array.from({ length: 101 }, (_, idx) => idx)
      const y_values = x_values.map((value) => Math.sin(value))
      const color_values = x_values.map((value) => (value === 100 ? 1 : null))
      const color_scan = vi.spyOn(color_values, `find`)
      const plot = await mount_sized_scatter_plot({
        series: [
          {
            x: x_values,
            y: y_values,
            color_values,
            markers: `line`,
            x_axis: `x2`,
            line_style: { line_dash: `4 2` },
            line_underlays: [{ x: x_values, y: y_values }],
          },
        ],
        x2_axis: { range: [30.2, 40.8] },
        line_tween: { duration },
        fill_regions: [{ upper: 0.5, lower: 0 }], // fills rebuild on pan, legend rows mustn't
      })
      const paths = [...plot.querySelectorAll(`g[data-series-id] > path[fill="none"]`)]
      expect(paths).toHaveLength(2)
      const check_vertices = () => {
        const vertices = paths.map((path) => path.getAttribute(`d`)?.match(/C/g)?.length ?? 0)
        if (duration > 0) expect(vertices[0]).toBe(100)
        else {
          expect(vertices[0]).toBeGreaterThan(10)
          expect(vertices[0]).toBeLessThan(20)
        }
        expect(vertices[1]).toBe(100)
      }
      check_vertices()
      expect(color_scan).toHaveBeenCalled()
      color_scan.mockClear()
      vi.spyOn(performance, `now`).mockReturnValue(performance.now() + SETTLE_MS + 1)
      const clip = clip_rect(plot)
      const at = (dx: number) => ({ clientX: clip.x + dx, clientY: clip.y + 10 })
      plot_svg(plot).dispatchEvent(
        mouse(`mousedown`, { button: 0, shiftKey: true, ...at(10) }),
      )
      await tick()
      check_vertices()
      await fire(window, new MouseEvent(`mousemove`, { buttons: 1, ...at(15) }))
      check_vertices()
      const dragged_paths = paths.map((path) => path.getAttribute(`d`))
      await fire(window, new MouseEvent(`mouseup`))
      check_vertices()
      expect(paths.map((path) => path.getAttribute(`d`))).toEqual(dragged_paths)
      expect(color_scan).not.toHaveBeenCalled()
    },
  )

  test.each([`points`, `line`, `line+points`] as const)(
    `%s controls can target another series independently of labels`,
    async (markers) => {
      let styles = $state.raw<StyleOverrides>({
        point: { opacity: 0.2 },
        line: { opacity: 0.2 },
      })
      const state = $state<{
        selected_series_idx: number
        series: DataSeries[]
        styles: StyleOverrides
      }>({
        selected_series_idx: 0,
        get styles() {
          return styles
        },
        set styles(value) {
          styles = value
        },
        series: [0, 1].map(() => ({
          x: [0, 1],
          y: [0, 1],
          label: `Repeated`,
          markers,
          point_style: { fill: `red` },
          line_style: { stroke: `red` },
          color_values: [NaN, Infinity],
          size_values: [NaN, Infinity],
        })),
      })
      const plot = await mount_sized_scatter_plot(
        bind_props({ controls_open: true, point_tween: { duration: 0 } }, state),
      )
      const { control, set_value } = form_controls(plot)
      const series_select = control(`Series`)
      await set_value(`Series`, `1`)
      expect(state.selected_series_idx).toBe(1)
      for (const [kind, selector, attribute] of [
        ...(markers.includes(`points`) ? [[`point`, `.marker`, `fill`]] : []),
        ...(markers.includes(`line`) ? [[`line`, `path[fill="none"]`, `stroke`]] : []),
      ]) {
        const reset_style = `button[title="Clear ${kind} style overrides"]`
        expect(plot.querySelector(reset_style)).not.toBeNull()
        const toggle = control(`Show ${kind}s`)
        if (!(toggle instanceof HTMLInputElement))
          throw new Error(`Show ${kind}s not a checkbox`)
        toggle.click()
        await tick()
        expect(toggle.checked).toBe(false)
        expect(plot.querySelector(`[data-key="${kind}.opacity"]`)).toBeNull()
        expect(series_select.isConnected).toBe(markers === `line+points`)
        toggle.click()
        await tick()
        expect(toggle.checked).toBe(true)
        toggle.click()
        await tick()
        expect(state.styles).toMatchObject({ [`show_${kind}s`]: false })
        doc_query<HTMLButtonElement>(
          `button[aria-label="Restore display to initial values"]`,
        ).click()
        await tick()
        expect(state.styles).not.toHaveProperty(`show_${kind}s`)
        expect(toggle.checked).toBe(true)
        const input = doc_query(`[aria-label="${kind} color hex"]`, HTMLInputElement)
        expect(input.value).toBe(`#ff0000`) // authored CSS colors stay editable as hex
        set_input(input, `#0000ff`)
        await tick()
        for (const [series_idx, color] of [`red`, `#0000ff`].entries()) {
          const legend_item = plot.querySelectorAll(`.legend-item`)[series_idx]
          const swatch = legend_item.querySelector(kind === `point` ? `path` : `line`)
          expect(swatch?.getAttribute(kind === `point` ? `fill` : `stroke`)).toBe(color)
          const marks = plot.querySelectorAll(`[data-series-id="${series_idx}"] ${selector}`)
          expect(marks.length).toBeGreaterThan(0)
          for (const mark of marks) {
            if (kind === `point`) expect(marker_fill(mark)).toBe(color)
            else expect(mark.getAttribute(attribute)).toBe(color)
          }
        }
        const numeric_edits =
          kind === `point`
            ? [
                [`opacity`, `0.35`, `fill-opacity`],
                [`stroke_width`, `2.5`, `stroke-width`],
                [`stroke_opacity`, `0.6`, `stroke-opacity`],
              ]
            : [
                [`width`, `7`, `stroke-width`],
                [`opacity`, `0.4`, `stroke-opacity`],
              ]
        for (const [key, value, numeric_attribute] of numeric_edits) {
          const range_input = doc_query(
            `[data-key="${kind}.${key}"] input[type="range"]`,
            HTMLInputElement,
          )
          set_input(range_input, value)
          await tick()
          const marks = plot.querySelectorAll(`[data-series-id="1"] ${selector}`)
          expect([...marks].map((mark) => mark.getAttribute(numeric_attribute))).toEqual(
            Array(marks.length).fill(value),
          )
          if (key === `opacity`) {
            const legend_item = plot.querySelectorAll(`.legend-item`)[1]
            const swatch = legend_item.querySelector(kind === `point` ? `path` : `line`)
            expect(swatch?.getAttribute(kind === `point` ? `opacity` : `stroke-opacity`)).toBe(
              value,
            )
          }
        }
        doc_query<HTMLButtonElement>(reset_style).click()
        await tick()
        expect(state.styles).not.toHaveProperty(kind)
        expect(plot.querySelector(reset_style)).toBeNull()
      }
      // Data-driven styling on another series must not hide the selected series' controls.
      state.series[0].color_values = [0, 1]
      state.series[0].size_values = [0, 1]
      for (const selected_idx of [0, 1]) {
        state.selected_series_idx = selected_idx
        await tick()
        for (const [key, applies] of [
          [`point.size`, markers.includes(`points`)],
          [`point.color`, markers.includes(`points`)],
          [`line.color`, markers.includes(`line`)],
        ] as const) {
          expect(plot.querySelector(`[data-key="${key}"]`) !== null).toBe(
            selected_idx === 1 && applies,
          )
        }
      }
      // Removing the selected series restores one shared target in the chart and pane.
      state.series = [
        {
          x: [0, 1],
          y: [0, 1],
          markers,
          line_style: { stroke_width: 7 },
          point_style: { radius: 9 },
        },
      ]
      state.styles = {}
      await tick()
      const field = markers === `line` ? `line.width` : `point.size`
      expect(
        plot.querySelector<HTMLInputElement>(`[data-key="${field}"] input[type="range"]`)
          ?.value,
      ).toBe(markers === `line` ? `7` : `9`)
    },
  )

  test(`line underlays stay out of legends, controls, and hover`, async () => {
    const on_point_hover = vi.fn()
    const state = $state<{ styles: StyleOverrides; show_controls: boolean }>({
      styles: {},
      show_controls: true,
    })
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          series: [
            {
              id: `trend`,
              x: [0, 1, 2],
              y: [0, 1, 0],
              label: `Energy`,
              markers: `line+points`,
              line_style: { stroke: `red`, stroke_width: 3 },
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
          hover_config: { mode: `x`, threshold_px: 5 },
          tooltip: false,
          point_tween: { duration: 0 },
          on_point_hover,
          show_legend: true,
          controls_open: true,
        } satisfies ComponentProps<typeof ScatterPlot>,
        state,
      ),
    )

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
    expect(line_width_input.value).toBe(`3`)
    expect(state.styles).toEqual({})
    // An explicit override equal to the shipped default must still offer Reset.
    for (const width of [`5`, `2`]) {
      set_input(line_width_input, width)
      await tick()
      expect([...lines].map((line) => line.getAttribute(`stroke-width`))).toEqual([`1`, width])
      expect(state.styles).toEqual({ line: { width: Number(width) } })
      expect(plot.querySelector(`[aria-label="Clear line style overrides"]`)).not.toBeNull()
    }

    // Clearing the override restores the authored width in the plot and controls.
    doc_query(`[aria-label="Clear line style overrides"]`, HTMLButtonElement).click()
    await tick()
    expect([...lines].map((line) => line.getAttribute(`stroke-width`))).toEqual([`1`, `3`])
    expect(line_width_input.value).toBe(`3`)
    expect(state.styles).toEqual({})
    expect(plot.querySelector(`[aria-label="Clear line style overrides"]`)).toBeNull()

    state.show_controls = false
    state.styles = { line: { width: 4, color: `green`, dash: `4 2`, opacity: 0.5 } }
    await tick()
    expect([...lines].map((line) => line.getAttribute(`stroke-width`))).toEqual([`1`, `4`])
    for (const line of [lines[1], doc_query(`.legend-item line`, SVGElement)]) {
      expect(line.getAttribute(`stroke`)).toBe(`green`)
      expect(line.getAttribute(`stroke-dasharray`)).toBe(`4 2`)
      expect(line.getAttribute(`stroke-opacity`)).toBe(`0.5`)
    }

    await move_to_marker(plot, 1)
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover.mock.calls[0][0]).toMatchObject({ x: 1, y: 1 })
  })

  test(`shows a pointer cursor only where a plot click would reach a point`, async () => {
    const on_plot_click = vi.fn()
    const plot = await mount_sized_scatter_plot({
      series: [basic],
      on_plot_click,
      point_tween: { duration: 0 },
    })
    const svg = plot_svg(plot)
    expect(svg.style.cursor).toBe(`crosshair`)

    // a near miss: 8px below the marker, outside its own hit area but inside the hover radius
    click_at(svg, await move_to_marker(plot, 1, { dy: 8 }))
    expect(svg.style.cursor).toBe(`pointer`)
    expect(on_plot_click).toHaveBeenCalledOnce()
    expect(on_plot_click.mock.calls[0][0]).toMatchObject({ x: 2, y: 3 })
    // Plot-only handlers must also receive a direct marker hit, not just near misses.
    click_at(plot.querySelectorAll(`path.marker`)[1], await move_to_marker(plot, 1))
    expect(on_plot_click).toHaveBeenCalledTimes(2)
    expect(on_plot_click).toHaveBeenLastCalledWith(expect.objectContaining({ x: 2, y: 3 }))

    // far from every point the click would land on nothing, so the crosshair returns
    svg.dispatchEvent(mouse(`mousemove`, { clientX: 0, clientY: 0 }))
    await next_animation_frame()
    expect(svg.style.cursor).toBe(`crosshair`)

    // without a plot click handler the hand never shows on the background
    const passive = await mount_sized_scatter_plot({ series: [basic] })
    await move_to_marker(passive, 1, { dy: 8 })
    expect(plot_svg(passive).style.cursor).toBe(`crosshair`)

    // a tighter click radius keeps the tooltip's reach but not the click's: 8px off the marker
    // hovers (within 20px) but must not click (outside 5px). `x` mode measures along x only and
    // used to report every candidate at distance 0, so the click radius never applied there
    for (const [mode, offset] of [
      [undefined, `dy`],
      [`x`, `dx`],
    ] as const) {
      const on_tight_click = vi.fn()
      const tight = await mount_sized_scatter_plot({
        series: [basic],
        on_plot_click: on_tight_click,
        hover_config: { mode, threshold_px: 20, click_threshold_px: 5 },
        point_tween: { duration: 0 },
      })
      const tight_svg = plot_svg(tight)
      click_at(tight_svg, await move_to_marker(tight, 1, { [offset]: 8 }))
      expect(tight.querySelector(`.plot-tooltip`), mode).not.toBeNull()
      expect(tight_svg.style.cursor, mode).toBe(`crosshair`)
      expect(on_tight_click, mode).not.toHaveBeenCalled()
      click_at(tight_svg, await move_to_marker(tight, 1, { [offset]: 3 }))
      expect(tight_svg.style.cursor, mode).toBe(`pointer`)
      expect(on_tight_click.mock.calls, mode).toEqual([
        [expect.objectContaining({ x: 2, y: 3 })],
      ])
    }
  })

  test(`child marks and rectangle zoom do not trigger plot clicks`, async () => {
    const on_plot_click = vi.fn()
    const on_fill_click = vi.fn()
    const on_ref_line_click = vi.fn()
    const plot = await mount_sized_scatter_plot({
      series: [basic],
      fill_regions: [{ lower: 0, upper: 4, on_click: on_fill_click }],
      // duplicate public ids still render both lines (keyed by index, not id)
      ref_lines: [
        { type: `vertical`, x: 2, id: `dup`, on_click: on_ref_line_click },
        { type: `horizontal`, y: 3, id: `dup` },
      ],
      on_plot_click,
      point_tween: { duration: 0 },
    })
    expect(plot.querySelectorAll(`.reference-line`)).toHaveLength(2)
    plot.querySelector(`.fill-region`)?.dispatchEvent(mouse(`click`))
    plot.querySelector(`.reference-line`)?.dispatchEvent(mouse(`click`))
    expect(on_fill_click).toHaveBeenCalledOnce()
    expect(on_ref_line_click).toHaveBeenCalledOnce()
    expect(on_plot_click).not.toHaveBeenCalled()

    const svg = plot_svg(plot)
    const clip = clip_rect(plot)
    const end = { clientX: clip.x + 80, clientY: clip.y + 80 }
    svg.dispatchEvent(
      mouse(`mousedown`, { button: 0, clientX: clip.x + 10, clientY: clip.y + 10 }),
    )
    window.dispatchEvent(new MouseEvent(`mousemove`, { buttons: 1, ...end }))
    window.dispatchEvent(new MouseEvent(`mouseup`, end))
    click_at(svg, { x: end.clientX, y: end.clientY })
    expect(on_plot_click).not.toHaveBeenCalled()
  })

  test.each([
    { width: 0, color_values: [0, 1], has_scale: false },
    { width: 400, color_values: [0, 1], has_scale: true },
    { width: 400, color_values: [NaN, Infinity], has_scale: false },
  ])(
    `empty categories preserve colorbar visibility at width $width with $color_values`,
    async ({ width, color_values, has_scale }) => {
      vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(width)
      vi.spyOn(HTMLElement.prototype, `clientHeight`, `get`).mockReturnValue(width ? 300 : 0)
      const color_bar = $state({
        categories: {},
        property_options: [{ key: `energy`, label: `Energy` }],
      })
      mount(ScatterPlot, {
        target: document.body,
        props: { series: [{ x: [0, 1], y: [0, 1], color_values }], color_bar },
      })
      await tick()
      expect(Boolean(document.querySelector(`.colorbar .bar`))).toBe(has_scale)
      expect(document.querySelector(`.category-legend`)).toBeNull()
      expect(Boolean(document.querySelector(`.property-select`))).toBe(width > 0)
      color_bar.property_options = []
      await tick()
      expect(Boolean(document.querySelector(`.colorbar-wrapper`))).toBe(has_scale)
    },
  )

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
      expect(marker_radius(query(plot, `.marker`))).toBeCloseTo(expected_radius, 6)
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
    [`linear`, false],
    [`monotone`, true],
  ] as const)(
    `line_style.curve=%s flows through to the rendered line`,
    async (curve, cubic) => {
      const plot = await mount_sized_scatter_plot({
        series: [{ x: [0, 1, 2, 3], y: [0, 8, 1, 9], markers: `line`, line_style: { curve } }],
        line_tween: { duration: 0 }, // no path morph, so the final `d` is set synchronously
        legend: null,
      })
      const has_cubic = [...plot_svg(plot).querySelectorAll(`path`)].some((path) =>
        (path.getAttribute(`d`) ?? ``).includes(`C`),
      )
      expect(has_cubic).toBe(cubic)
    },
  )

  test.each([`x2`, `y2`] as const)(
    `does not render the %s axis without a finite x/y pair`,
    async (axis) => {
      const invalid: DataSeries = { x: [1, NaN], y: [NaN, 2], [`${axis[0]}_axis`]: axis }
      const plot = await mount_sized_scatter_plot({
        series: [{ x: [1, 2], y: [3, 4] }, invalid],
      })
      expect(plot.querySelector(`g.${axis}-axis`)).toBeNull()
    },
  )

  // x2 data (e.g. photon energy over wavelength) must not stretch the primary x axis
  test(`x axis spans only its own series`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        { x: [400, 800], y: [400, 800] },
        { x: [1, 3], y: [1, 3], x_axis: `x2` },
      ],
    })
    expect(Number(axis_tick_labels(plot, `x`)[0])).toBeGreaterThanOrEqual(300)
  })

  test(`input warnings fire once, not on every data update that keeps them`, async () => {
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const line_style = { stroke: `red` }
    const bands = (): DataSeries[] =>
      [0, 1].map(() => ({ x: [0, 1], y: [0, 1], label: `Band`, markers: `line`, line_style }))
    const state = $state({ series: bands() })
    const typo_ref = { type: `series`, series_id: `typo` } as const
    await mount_sized_scatter_plot(
      bind_props({ fill_regions: [{ upper: typo_ref, lower: 0 }] }, state),
    )
    state.series = bands()
    flushSync()
    expect(warn.mock.calls).toEqual([
      [`ScatterPlot: fill references no series: ${JSON.stringify(typo_ref)}`],
      [`ScatterPlot: identical legend rows "Band", give them a shared legend_id`],
    ])
  })

  test(`assigns unit groups to axes, keeps explicit y_axis, reassigns on visibility changes`, async () => {
    const state = $state({
      series: [
        { x: [1, 2], y: [-2, -1], label: `Energy`, unit: `eV` },
        { x: [1, 2], y: [10, 20], label: `Pressure`, unit: `GPa` },
      ] as DataSeries[],
      y2_axis: {},
    })
    // empty y2_axis (the default) here: auto-assignment must hold with scale inference
    const plot = await mount_sized_scatter_plot(bind_props({}, state))
    const label = (axis: `y` | `y2`) => plot.querySelector(`.${axis}-label`)?.textContent
    expect(label(`y`)).toContain(`Energy (eV)`)
    expect(label(`y2`)).toContain(`Pressure (GPa)`)

    state.series[0].visible = false
    await flush_render()
    expect(label(`y`)).toContain(`Pressure (GPa)`)
    expect(plot.querySelector(`g.y2-axis`)).toBeNull()

    // an explicit y_axis assignment is kept and the remaining group fills the other axis
    state.y2_axis = { scale_type: `linear` }
    state.series = [
      {
        x: [1, 2],
        y: [1e-8, 1],
        label: `Residual`,
        unit: `eV`,
        axis_group: `scf`,
        y_axis: `y2`,
      },
      { x: [1, 2], y: [-2, -1], label: `Energy`, unit: `eV` },
    ]
    await flush_render()
    expect(label(`y`)).toContain(`Energy (eV)`)
    expect(label(`y2`)).toContain(`Residual (eV)`)
  })

  test(`infers a logarithmic scale for a wide positive axis_group`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        { x: [1, 2, 3], y: [1e-6, 1e-3, 1], label: `Residual`, unit: `eV`, axis_group: `scf` },
      ],
      point_tween: { duration: 0 },
    })
    const marker_y = [...plot.querySelectorAll(`.marker`)].map(
      (_, idx) => marker_position(plot, idx).y,
    )
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

  test.each([`x`, `y`] as const)(
    `animates %s quantity changes across new ranges and reordered series`,
    async (axis) => {
      const state = $state<{ series: DataSeries[] }>({
        series: [
          { id: `other`, x: [1, 10], y: [1, 10] },
          { id: `tracked`, x: [3, 7], y: [3, 7] },
        ],
      })
      const plot = await mount_sized_scatter_plot(
        bind_props({ point_tween: { duration: 60_000 }, legend: null }, state),
      )
      const marker = () => query(plot, `[data-series-id="tracked"] .marker`)
      const original = marker()
      const position = original.parentElement?.getAttribute(`transform`)
      vi.spyOn(performance, `now`).mockReturnValue(performance.now() + SETTLE_MS + 1)

      state.series = state.series.toReversed().map((series) => ({
        ...series,
        [axis]: series.id === `tracked` ? [240, 180] : [100, 300],
      }))
      await flush_render()

      expect(marker()).toBe(original)
      // The same marker starts its tween at the old position instead of snapping.
      expect(marker().parentElement?.getAttribute(`transform`)).toBe(position)
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
  ])(`tick formatting`, async ({ x: coord_x, x_axis, y_axis }) => {
    const coord_y = coord_x.map((_value, idx) => 12 * (idx + 1))
    const plot = await mount_sized_scatter_plot({
      series: [{ x: coord_x, y: coord_y, point_style: { fill: `steelblue`, radius: 5 } }],
      x_axis,
      y_axis,
    })
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(coord_x.length)
    const x_tick_labels = axis_tick_labels(plot, `x`)
    if (x_axis.format.startsWith(`%`)) {
      expect(x_tick_labels.length).toBeGreaterThan(1)
      expect(x_tick_labels.every((label) => /^\w{3} \d{4}$/.test(label ?? ``))).toBe(true)
    } else expect(x_tick_labels).toEqual([`0`, `10`, `20`, `30`, `40`, `50`])
    expect(axis_tick_labels(plot, `y`).length).toBeGreaterThan(1)
  })

  // an integer-format axis zoomed below one unit has no integer to label: decimal ticks, not
  // an empty axis or repeated `0`s; compact labels that would collide gain precision
  // oxfmt-ignore
  test.each<[string, number[], AxisConfig, string[]]>([
    [`integer format without an integer in range`, [0.2, 0.8], { format: `d`, range: [0.2, 0.8], ticks: 4 }, [`0.2`, `0.4`, `0.6`, `0.8`]],
    [`compact labels that would collide`, [-1539, -1537], { ticks: [-1539, -1538, -1537] }, [`−1539`, `−1538`, `−1537`]],
  ])(`y tick labels for %s`, async (_desc, y, y_axis, expected) => {
    const plot = await mount_sized_scatter_plot({ series: [{ x: [0, 1], y }], y_axis })
    expect(axis_tick_labels(plot, `y`)).toEqual(expected)
  })

  const color_series = [{ x: [1, 2, 3], y: [10, 20, 30], color_values: [100, 200, 300] }]
  const mid_point = { x: 2, y: 20, series_idx: 0, point_idx: 1 }
  const june_15 = new Date(2023, 5, 15).getTime()
  // the tooltip shows the plotted point with the hovered key, so each case plots it
  // oxfmt-ignore
  test.each<[string, Partial<ComponentProps<typeof ScatterPlot>>, string[], string[]]>([
    [`axis labels instead of bare x/y`, { series: [{ x: [1, 2, 3], y: [10, 20, 30] }], x_axis: { label: `Time (s)` }, y_axis: { label: `Speed` }, tooltip_point: mid_point }, [`Time: 2 s`, `Speed`, `20`], []],
    [`series label with several series, HTML rendered`, { series: [{ x: [1, 2, 3], y: [10, 20, 30], label: `A<sub>1</sub>lpha` }, { x: [1, 2, 3], y: [5, 15, 25], label: `Beta` }], tooltip_point: mid_point }, [`A1lpha`], [`<sub>`]],
    [`no series label for a single series`, { series: [{ x: [1, 2, 3], y: [10, 20, 30], label: `Only` }], tooltip_point: mid_point }, [], [`Only`]],
    [`color value with color bar title`, { series: color_series, color_bar: { title: `Temperature` }, tooltip_point: { ...mid_point, color_value: 200 } }, [`Temperature`, `200`], []],
    [`color value without title`, { series: color_series, color_bar: {}, tooltip_point: { ...mid_point, color_value: 200 } }, [`Color`, `200`], []],
    [`time and number formats`, { series: [{ x: [june_15, june_15 + 864e5], y: [123.45, 130] }], tooltip_point: { x: june_15, y: 123.45, series_idx: 0, point_idx: 0 }, x_axis: { scale_type: `time`, format: `%b %d, %Y` }, y_axis: { format: `.2r` } }, [`Jun 15, 2023`, `120`], []],
  ])(`default tooltip shows %s`, async (_desc, props, includes, excludes) => {
    const plot = await mount_sized_scatter_plot({ hovered: true, ...props })
    const text = plot.querySelector(`.plot-tooltip`)?.textContent ?? ``
    for (const expected of includes) expect(text).toContain(expected)
    for (const unexpected of excludes) expect(text).not.toContain(unexpected)
    // an axis label's unit is split off into a <small>
    if (props.x_axis?.label) expect(plot.querySelector(`.plot-tooltip small`)?.textContent).toBe(`s`)
  })

  test(`invalid data`, async () => {
    // null entries hold their index, draw nothing and don't break the underlay lookup
    const invalid = [
      {
        x: [1, 2, null, 4, 5] as (number | null)[],
        y: [5, 4, undefined, 2, 1] as (number | null)[],
      },
      null,
      undefined,
      // a JSON null x_axis (e.g. Python None) means the primary one
      { x: [10, 20, 30, 40, 50], y: [10, 20, 30, NaN, NaN], x_axis: null },
      {
        x: [100, 200, 300],
        y: [10, 20, 30],
        line_underlays: [{ x: [100, 300], y: [10, 30] }],
      },
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
    [`duplicate ids`, [{ id: `a` }, { id: `a` }], /duplicate "a"/],
    [`duplicate numeric ids`, [{ id: 1 }, { id: 1 }], /duplicate "1"/],
    [`unset ids`, [{}, {}, null], null],
    [`distinct ids`, [{ id: `a` }, { id: 1 }, {}], null],
  ] as const)(`series with %s`, (_desc, series_ids, error) => {
    const series = series_ids.map((ids) => ids && { ...basic, ...ids }) as DataSeries[]
    const mount_plot = () => mount(ScatterPlot, { target: document.body, props: { series } })
    if (error) expect(mount_plot).toThrow(error)
    else expect(mount_plot).not.toThrow()
  })

  test(`hidden series widen no axis and hiding every series keeps the current view`, async () => {
    const state = $state({
      series: [
        { x: [0, 10], y: [0, 1], label: `A` },
        { x: [0, 100], y: [0, 50], label: `B`, visible: false },
      ] as DataSeries[],
    })
    const plot = await mount_sized_scatter_plot(bind_props({ ...bare }, state))
    expect(axis_tick_labels(plot, `x`)).toContain(`10`)
    expect(axis_tick_labels(plot, `x`)).not.toContain(`100`)
    expect(axis_tick_labels(plot, `y`)).not.toContain(`50`)

    state.series[1].visible = true
    await flush_render()
    expect(axis_tick_labels(plot, `x`)).toContain(`100`)
    expect(axis_tick_labels(plot, `y`)).toContain(`50`)

    // Every series hidden: no data backs the auto ranges, so the view stays put
    state.series[0].visible = false
    state.series[1].visible = false
    await flush_render()
    expect(axis_tick_labels(plot, `x`)).toContain(`100`)
    expect(axis_tick_labels(plot, `y`)).toContain(`50`)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(0)
  })

  // A point missing one coordinate is not drawn, so neither its other coordinate nor its error
  // bar may stretch that axis to where nothing is plotted
  test(`points missing a coordinate widen no axis`, async () => {
    const plot = await mount_sized_scatter_plot({
      ...bare,
      series: [
        { x: [0, 10, 1000], y: [0, 1, NaN], x_error: [0, 0, 5000] },
        { x: [5, NaN], y: [0.5, 500], y_error: [0.1, 5000] },
      ],
    })
    const max_tick = (side: `x` | `y`) => Math.max(...axis_tick_labels(plot, side).map(Number))
    expect([max_tick(`x`), max_tick(`y`)]).toEqual([10, 1])
  })

  // One line per enabled axis whose range spans zero (ending at zero counts), at the zero
  // pixel: x=0 halfway across [-10, 10], y=0 halfway up [-15, 15] or at the bottom of [0, 30].
  // A log axis has no zero.
  test.each<[string, AxisConfig, DisplayConfig, string[], Vec2 | null]>([
    [`both ranges span zero`, {}, {}, [`x`, `y`], [0.5, 0.5]],
    [`y range ends at zero`, { range: [0, 30] }, {}, [`x`, `y`], [0.5, 1]],
    [`y range above zero`, { range: [5, 30] }, {}, [`x`], null],
    [`log y axis`, { range: [1, 100], scale_type: `log` }, {}, [`x`], null],
    [`x zero line off`, {}, { x_zero_line: false }, [`y`], null],
  ])(`zero lines: %s`, async (_name, y_axis, display, axes, fractions) => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [-5, 0, 5], y: [2, 5, 20] }],
      x_axis: { range: [-10, 10] },
      y_axis: { range: [-15, 15], ...y_axis },
      display,
    })
    const lines = [...plot.querySelectorAll(`.zero-line`)].map((line) => {
      const [x1, x2, y1, y2] = [`x1`, `x2`, `y1`, `y2`].map((key) =>
        Number(line.getAttribute(key)),
      )
      return { x1, x2, y1, y2 }
    })
    // a vertical line marks x=0, a horizontal one y=0
    expect(lines.map(({ x1, x2 }) => (x1 === x2 ? `x` : `y`))).toEqual(axes)
    if (!fractions) return
    const [x_line, y_line] = lines
    const x_frac = (x_line.x1 - y_line.x1) / (y_line.x2 - y_line.x1)
    const y_frac = (y_line.y1 - x_line.y1) / (x_line.y2 - x_line.y1)
    expect(x_frac).toBeCloseTo(fractions[0], 9)
    expect(y_frac).toBeCloseTo(fractions[1], 9)
  })

  // styles.point.symbol_type (the VS Code scatter.symbol_type setting) replaces the per-series
  // Circle/Square/Triangle cycle for markers and legend swatches alike; a point's own
  // point_style.symbol_type still wins
  test.each([undefined, `Triangle`] as const)(
    `styles.point.symbol_type=%s shapes markers and legend swatches`,
    async (symbol_type) => {
      const series = [
        { x: [1, 2], y: [1, 2], label: `A` },
        { x: [1, 2], y: [2, 3], label: `B` },
        { x: [1, 2], y: [3, 4], label: `C`, point_style: { symbol_type: `Diamond` } },
      ] as DataSeries[]
      const plot = await mount_sized_scatter_plot({
        series,
        styles: { point: { symbol_type } },
        legend: {},
      })
      const marker_path = (series_idx: number) =>
        plot.querySelector(`[data-series-id="${series_idx}"] .marker`)?.getAttribute(`d`) ?? ``
      // d3 circles are arc commands; squares/triangles are straight segments. Without the
      // override the cycle gives Circle then Square; with it both series share the shape
      expect(marker_path(0).includes(`A`)).toBe(symbol_type === undefined)
      expect(marker_path(1)).not.toContain(`A`)
      expect(marker_path(0) === marker_path(1)).toBe(symbol_type !== undefined)
      // the authored Diamond survives the override
      expect(marker_path(2)).not.toBe(marker_path(1))
      expect(marker_path(2)).not.toContain(`A`)
      // the legend swatch is the marker's own d3 outline, drawn at a fixed swatch size
      const outline = (path: string) => path.replaceAll(/[-\d.]+/g, ``)
      const swatches = [...plot.querySelectorAll(`.legend-marker path`)].map((path) =>
        outline(path.getAttribute(`d`) ?? ``),
      )
      expect(swatches).toEqual([0, 1, 2].map((idx) => outline(marker_path(idx))))
    },
  )

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
      ...bare,
    })
    const plot = await mount_sized_scatter_plot(props)
    const label_offset = () => {
      const label = query(plot, `text.label-text`)
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
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [0, 1], y: [0, 1], markers: `points` }],
      x_axis: { range: [0, 1] },
      y_axis: { range: [0, 1] },
      point_tween: { duration: 0 },
      on_point_hover,
      legend: null,
    })
    const svg = plot_svg(plot)
    stub_svg_rect(svg)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(2)
    const sweep_markers = () => {
      for (const { x: coord_x, y: coord_y } of [0, 1].map((idx) =>
        marker_position(plot, idx),
      )) {
        svg.dispatchEvent(mouse(`mousemove`, { clientX: coord_x, clientY: coord_y }))
      }
    }
    sweep_markers()
    expect(on_point_hover).not.toHaveBeenCalled()
    await next_animation_frame()
    expect(on_point_hover).toHaveBeenCalledTimes(1)
    expect(on_point_hover.mock.calls[0][0]).toMatchObject({ x: 1, y: 1 })

    svg.dispatchEvent(mouse(`mouseleave`))
    expect(on_point_hover).toHaveBeenLastCalledWith(null)

    on_point_hover.mockClear()
    sweep_markers()
    svg.dispatchEvent(mouse(`mouseleave`))
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
    await next_animation_frame()
    expect(on_point_hover).toHaveBeenCalledOnce()
  })

  // A data change under a resting pointer (e.g. sweep playback) re-reports the hovered point
  // with its new values, then null once it is gone
  test(`on_point_hover hears the hovered point's new values after a data change`, async () => {
    const on_point_hover = vi.fn()
    const state = $state<{ series: DataSeries[] }>({
      series: [{ x: [0, 1], y: [0, 1], markers: `points` }],
    })
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          x_axis: { range: [0, 1] as [number, number] },
          y_axis: { range: [0, 1] as [number, number] },
          point_tween: { duration: 0 },
          on_point_hover,
          legend: null,
        },
        state,
      ),
    )
    const svg = plot_svg(plot)
    stub_svg_rect(svg)
    const { x: coord_x, y: coord_y } = marker_position(plot, 1)
    svg.dispatchEvent(mouse(`mousemove`, { clientX: coord_x, clientY: coord_y }))
    await next_animation_frame()
    expect(on_point_hover).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1, y: 1 }))
    state.series = [{ x: [0, 1], y: [0, 0.5], markers: `points` }]
    flushSync()
    expect(on_point_hover).toHaveBeenCalledTimes(2)
    expect(on_point_hover).toHaveBeenLastCalledWith(expect.objectContaining({ x: 1, y: 0.5 }))
    state.series = [{ x: [0], y: [0], markers: `points` }]
    flushSync()
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
  })

  // x mode ignores vertical distance, except to break ties between duplicate x-values. y mode is
  // the transposed rule (a spectrum with a vertical frequency axis) and scans every series.
  const peak = [0, 1, 0]
  test.each([
    { mode: `x`, label: `ascending`, x_values: [0, 1, 2], y_values: peak, target_idx: 1 },
    { mode: `x`, label: `descending`, x_values: [2, 1, 0], y_values: peak, target_idx: 1 },
    { mode: `x`, label: `unordered`, x_values: [0, 2, 1], y_values: peak, target_idx: 2 },
    { mode: `x`, label: `tied-x`, x_values: [1, 1, 1], y_values: [0, 0.5, 1], target_idx: 2 },
    { mode: `y`, label: `ascending`, x_values: peak, y_values: [0, 0.5, 1], target_idx: 1 },
    { mode: `y`, label: `unordered`, x_values: peak, y_values: [0, 1, 0.5], target_idx: 2 },
  ] as const)(
    `$mode hover finds the nearest $label point`,
    async ({ mode, label, x_values, y_values, target_idx }) => {
      const on_point_hover = vi.fn()
      const plot = await mount_sized_scatter_plot({
        series: [{ x: [...x_values], y: [...y_values], markers: `points` }],
        x_axis: { range: [0, 2] },
        y_axis: { range: [0, 1] },
        hover_config: { mode, threshold_px: 5 },
        tooltip: false,
        point_tween: { duration: 0 },
        on_point_hover,
        legend: null,
      })
      // hover far off-axis from distinct targets
      const { x: coord_x, y: coord_y } = marker_position(plot, target_idx)
      const offset =
        label === `tied-x`
          ? {}
          : mode === `x`
            ? { dy: (coord_y < 150 ? 290 : 10) - coord_y }
            : { dx: (coord_x < 200 ? 390 : 10) - coord_x }
      await move_to_marker(plot, target_idx, offset)

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
      ?.dispatchEvent(mouse(`mousemove`, { clientX: 1, clientY: 1 }))
    await unmount(component)
    await next_animation_frame()

    expect(on_point_hover).not.toHaveBeenCalled()
  })

  const fill_plot_props = (): Partial<ComponentProps<typeof ScatterPlot>> => ({
    series: [{ x: [0, 1], y: [0, 1] }],
    x_axis: { range: [0, 1] as Vec2 },
    y_axis: { range: [0, 1] as Vec2 },
    legend: null,
  })

  test(`fill hover keys by explicit id or fallback index, stable across data updates`, async () => {
    const make_fills = (): FillRegion[] => [
      { id: `lead`, lower: 0, upper: 0.1, fill: `transparent` },
      { lower: 0.2, upper: 0.4, fill: `steelblue` },
      { id: `1`, lower: 0.5, upper: 0.7, fill: `slategray` },
    ]
    const state = $state({ fill_regions: make_fills() })
    await mount_sized_scatter_plot(bind_props(fill_plot_props(), state))

    const hovered = (idx: number) =>
      svg_query(`[aria-label="Fill region ${idx + 1}"]`).classList.contains(`hovered`)
    await hover(svg_query(`[aria-label="Fill region 2"]`)) // fallback index 1 vs explicit id `1`
    expect([hovered(1), hovered(2)]).toEqual([true, false])
    const rerender = async (fills: FillRegion[]) => {
      state.fill_regions = fills
      await flush_render()
    }
    await rerender(make_fills())
    expect(hovered(1)).toBe(true)

    // a unique explicit id keeps its hover when an insertion shifts its source index
    await hover(svg_query(`[aria-label="Fill region 1"]`))
    await rerender([
      { id: `inserted`, lower: 0.3, upper: 0.4, fill: `transparent` },
      ...make_fills(),
    ])
    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(4)
    expect([hovered(0), hovered(1)]).toEqual([false, true])
  })

  // ids 1 and `1` would both key as `1`
  test.each([
    [`duplicate`, `duplicate`],
    [1, `1`],
  ])(`keeps fill IDs %j and %j keyed and hovered apart`, async (first_id, second_id) => {
    const fill_regions: FillRegion[] = [
      { id: first_id, lower: 0, upper: 0.2, fill: `steelblue` },
      { id: second_id, lower: 0.4, upper: 0.6, fill: `slategray` },
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
      [...document.querySelectorAll<HTMLElement>(`.legend-item.fill-item`)].find((element) =>
        element.textContent?.includes(label),
      )
    const fire_fill = async (label: string, type: `click` | `dblclick`) => {
      fill_item(label)?.dispatchEvent(mouse(type))
      await flush_render()
    }
    const visibility = () => state.fill_regions.map((region) => region.visible)

    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(2)

    // click hides only that fill (writes `visible` into the bound fill_regions); the fill is
    // no longer drawn, but its legend item persists (greyed) so it can be toggled back
    await fire_fill(`Band`, `click`)
    expect(visibility()).toEqual([false, undefined])
    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(1)
    expect(fill_item(`Band`)?.classList.contains(`hidden`)).toBe(true)

    // hovering the hidden fill's legend item must not mark it active (nothing renders to highlight)
    fill_item(`Band`)?.dispatchEvent(mouse(`mouseenter`))
    await flush_render()
    expect(fill_item(`Band`)?.classList.contains(`active`)).toBe(false)

    await fire_fill(`Band`, `click`)
    expect(visibility()).toEqual([true, undefined])

    // double-click isolates the fill; a second double-click on the sole visible fill shows all
    await fire_fill(`Cap`, `dblclick`)
    expect(visibility()).toEqual([false, true])
    await fire_fill(`Cap`, `dblclick`)
    expect(visibility()).toEqual([true, true])
    // double-clicking a hidden fill while another is visible isolates the clicked one
    await fire_fill(`Band`, `dblclick`)
    expect(visibility()).toEqual([true, false])
  })

  test(`log axis clamps non-positive fill coords to the domain floor, not a tiny epsilon`, async () => {
    // y=0 has no log image: clamp it to y_min (the bottom edge), not 1e-10 far outside the plot
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 10, 100], y: [2, 20, 80] }],
      x_axis: { range: [1, 100] },
      y_axis: { scale_type: `log`, range: [1, 100] },
      fill_regions: [{ lower: 0, upper: { type: `series`, series_idx: 0 } }],
      line_tween: { duration: 0 },
    })
    const path_d = query(plot, `.fill-region path`).getAttribute(`d`) ?? ``
    const coords = (path_d.match(/-?\d+\.?\d*/g) ?? []).map(Number)
    expect(coords.length).toBeGreaterThan(0) // guard: Math.max(...[]) is -Infinity, a false pass
    expect(Math.max(...coords.map(Math.abs))).toBeLessThan(1000)
  })

  const decorated_series = (): DataSeries[] => [
    { ...basic, label: `A`, color_values: basic.x },
    { ...basic, label: `B` },
  ]

  // The solver counts grouped series, fill entries and group headers in the grid the legend
  // renders after a chevron toggle, whether the collapsed set comes from the caller or the plot
  test.each([
    [`caller set`, new SvelteSet([`Signals`]), 1, 4],
    [`plot-owned set`, undefined, 4, 1],
  ])(
    `auto tracks follow chevron toggles with %s`,
    async (_, collapsed_groups, before, after) => {
      mock_decoration_measurements()
      const plot = await mount_sized_scatter_plot({
        series: [
          { ...basic, label: `A`, legend_group: `Signals` },
          { ...basic, label: `B`, legend_group: `Signals` },
        ],
        fill_regions: [
          { label: `Band`, legend_group: `Signals`, lower: 2, upper: 4, fill: `steelblue` },
        ],
        legend: { layout: `vertical`, layout_tracks: `auto`, collapsed_groups },
      })
      const rows = () => plot.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateRows
      await vi.waitFor(() => expect(rows()).toBe(`repeat(${before}, auto)`))
      plot.querySelector<HTMLElement>(`.group-chevron`)?.click()
      await vi.waitFor(() => expect(rows()).toBe(`repeat(${after}, auto)`))
    },
  )

  test(`keeps the unified decoration solution disjoint initially and across resize`, async () => {
    mock_decoration_measurements()
    const plot = await mount_sized_scatter_plot({
      series: decorated_series(),
      legend: { responsive: true },
      color_bar: { responsive: true },
    })
    // returns the colorbar rect once it is solved clear of the legend
    const disjoint_colorbar = () => {
      const legend_rect = solved_decoration_rect(doc_query(`.legend`))
      const colorbar_rect = solved_decoration_rect(doc_query(`.colorbar-wrapper`))
      expect(rects_overlap(legend_rect, colorbar_rect)).toBe(false)
      return colorbar_rect
    }
    const { width, height } = await vi.waitFor(disjoint_colorbar)
    await resize_element(plot, 650, 360)
    await flush_render()
    await vi.waitFor(() => expect(disjoint_colorbar()).toMatchObject({ width, height }))
  })

  test(`preserves explicit legend and colorbar positions outside solver ownership`, async () => {
    mock_decoration_measurements()
    const plot = await mount_sized_scatter_plot({
      series: decorated_series(),
      legend: { style: `position: absolute; left: 23px; top: 31px;` },
      // pinned by `right`: a solver `left: 0px` written alongside stretched the bar across the plot
      color_bar: { wrapper_style: `position: absolute; right: 9px; top: 17px;` },
    })
    const legend = query(plot, `.legend`)
    const colorbar = query(plot, `.colorbar-wrapper`)
    expect([legend.style.left, legend.style.top]).toEqual([`23px`, `31px`])
    const { left, right, top } = colorbar.style
    expect([left, right, top]).toEqual([``, `9px`, `17px`])
    expect(legend.getAttribute(`data-decoration-x`)).toBeNull()
    expect(colorbar.getAttribute(`data-decoration-x`)).toBeNull()

    // The tooltip dodges the pinned colorbar and legend through the frame's exclusion
    // list. place_tooltip sums overlap areas, so a rect listed twice would be dodged twice.
    vi.mocked(place_tooltip).mockClear()
    await move_to_marker(plot, 0)
    const { exclusion_rects } = vi.mocked(place_tooltip).mock.lastCall?.[0] ?? {}
    if (!exclusion_rects) throw new Error(`Expected place_tooltip to run on hover`)
    const rect_keys = exclusion_rects.map((rect) => JSON.stringify(rect))
    expect(rect_keys.length).toBeGreaterThanOrEqual(2) // pinned legend + pinned colorbar
    expect(new Set(rect_keys).size).toBe(rect_keys.length)
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
    await flush_render()
    expect(layout_spy).not.toHaveBeenCalled()
    expect({ left: legend.style.left, top: legend.style.top }).toEqual(initial_position)
  })

  // NaN/null colour and size values must neither widen the scales nor paint a NaN colour:
  // those points fall back to the series colour and default radius.
  test(`color_values and size_values with NaN fall back per point without widening the scales`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: [1, 2, 3, 4],
          y: [1, 2, 3, 4],
          // distinct ranges catch a size scale reading the colour range
          color_values: [0, NaN, 100, null] as number[],
          size_values: [1, NaN, 9, null] as number[],
        },
      ],
      size_scale: { radius_range: [2, 10] },
      color_scale: `interpolateViridis`,
      color_bar: {},
      ...bare,
    })
    const tick_labels = [...plot.querySelectorAll(`.colorbar .tick-label`)].map(
      (label) => label.textContent,
    )
    expect(tick_labels[0]).toBe(`0`)
    expect(tick_labels.at(-1)).toBe(`100`)
    const markers = [...plot.querySelectorAll<SVGPathElement>(`path.marker`)]
    expect(markers.map(marker_radius)).toEqual([2, 2.5, 10, 2.5])
    const fills = markers.map(marker_fill)
    expect(fills[0]).toBe(`#440154`) // viridis(0)
    expect(fills[2]).toBe(`#fde725`) // viridis(1)
    expect(fills[1]).toBe(fills[3])
    expect(fills[1]).not.toMatch(/NaN/)
  })

  // A 0 has no log image: the smallest positive value is the auto floor, so 0 clamps to it
  // instead of flooring at LOG_EPS and squashing 1..100 into the top of the ramp
  test(`log color and size scales floor at the smallest positive value`, async () => {
    const values = [0, 1, 10, 100]
    const plot = await mount_sized_scatter_plot({
      series: [
        { x: [1, 2, 3, 4], y: [1, 2, 3, 4], color_values: values, size_values: values },
      ],
      size_scale: { type: `log`, radius_range: [2, 10] },
      color_scale: { type: `log`, scheme: `interpolateViridis` },
      color_bar: {},
      ...bare,
    })
    const markers = [...plot.querySelectorAll<SVGPathElement>(`path.marker`)]
    const expected_scale = scaleSequentialLog(interpolateViridis).domain([1, 100]).clamp(true)
    expect(markers.map(marker_fill)).toEqual(
      values.map((value) => rgb(expected_scale(value)).formatHex()),
    )
    expect(markers.map(marker_radius)).toEqual([2, 2, 6, 10])
    const tick_labels = plot.querySelectorAll(`.colorbar .tick-label`)
    expect(tick_labels[0]?.textContent).toBe(`1`)
  })

  // Re-encoding colour or size (e.g. picking another column) glides markers like a data move.
  // Colours d3 can't parse (CSS variables) can't blend, so they switch at the start.
  test(`markers tween colour and size with the position`, async () => {
    // Svelte's frame loop keeps the real requestAnimationFrame, but reads this faked clock
    vi.useFakeTimers({ toFake: [`performance`] })
    try {
      const series = $state<DataSeries[]>([
        {
          x: [1, 2, 3],
          y: [1, 2, 3],
          color_values: [0, 100, null] as number[],
          size_values: [1, 9, 1],
          point_style: [{}, {}, { fill: `var(--accent)` }],
          point_label: [{ text: `A`, offset: { x: 10, y: 0 } }, {}, {}],
        },
      ])
      const plot = await mount_sized_scatter_plot({
        series,
        size_scale: { radius_range: [2, 10] },
        color_scale: `interpolateViridis`,
        color_bar: null,
        legend: null,
        show_controls: false,
      })
      const [first, , authored] = plot.querySelectorAll(`path.marker`)
      const start_position = marker_position(plot, 0)
      expect([marker_fill(first), marker_radius(first)]).toEqual([`#440154`, 2])
      vi.advanceTimersByTime(SETTLE_MS + 1) // past the window where every change snaps

      series[0] = {
        ...series[0],
        color_values: [100, 0, null] as number[],
        size_values: [9, 1, 1],
        point_style: [{}, {}, { fill: `red` }],
        point_label: [{ text: `A`, offset: { x: -30, y: 20 } }, {}, {}],
      }
      flushSync()
      vi.advanceTimersByTime(150)
      await vi.waitFor(() => expect(marker_fill(first)).toMatch(/^rgb\(/))
      const mid_fill = marker_fill(first) ?? ``
      const [red, green, blue] = mid_fill.match(/\d+/g)?.map(Number) ?? []
      // one eased frame: each channel from viridis(0) = rgb(68, 1, 84) to viridis(1) =
      // rgb(253, 231, 37) and the radius from 2 to 10 sit at the same fraction of the way
      const [frac, ...fracs] = [
        (red - 68) / 185,
        (green - 1) / 230,
        (blue - 84) / -47,
        (marker_radius(first) - 2) / 8,
      ]
      expect(frac).toBeGreaterThan(0)
      expect(frac).toBeLessThan(1)
      for (const other of fracs) expect(other).toBeCloseTo(frac, 1)
      expect(marker_fill(authored)).toBe(`red`)
      // the label's offset (re-placed with the marker) glides on the same eased frame
      const label = query(plot, `text.label-text`)
      expect((Number(label.getAttribute(`x`)) - 10) / -40).toBeCloseTo(frac, 1)
      expect(Number(label.getAttribute(`y`)) / 20).toBeCloseTo(frac, 1)
      expect(marker_position(plot, 0)).toEqual(start_position)

      vi.advanceTimersByTime(1000)
      await vi.waitFor(() =>
        expect([marker_fill(first), marker_radius(first)]).toEqual([`#fde725`, 10]),
      )
      expect(
        [`x`, `y`].map((attr) => query(plot, `text.label-text`).getAttribute(attr)),
      ).toEqual([`-30`, `20`])

      // a label switched on after settling lands on its auto-placed spot, no slide from {10, 0}
      series[0] = { ...series[0], point_label: [{}, { text: `B`, auto_placement: true }, {}] }
      await flush_render()
      const placed_label = () =>
        [`x`, `y`].map((attr) => query(plot, `text.label-text`).getAttribute(attr))
      const first_frame = placed_label()
      expect(first_frame).not.toEqual([`10`, `0`])
      vi.advanceTimersByTime(1000)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(placed_label()).toEqual(first_frame)
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([1, 1e-30])(
    `log y axis holds non-positive line points at the domain floor (factor=%s)`,
    async (factor) => {
      const plot = await mount_sized_scatter_plot({
        series: [
          {
            x: [1, 2, 3, 4],
            y: [0, 10, -5, 1000].map((value) => value * factor),
            markers: `line+points`,
            line_style: { curve: `linear` },
          },
        ],
        y_axis: { scale_type: `log` },
        line_tween: { duration: 0 },
        ...bare,
      })
      const clip = clip_rect(plot)
      expect(plot.querySelectorAll(`path.marker`)).toHaveLength(2)
      const line_d = plot
        .querySelector(`g[data-series-id] path[fill="none"]`)
        ?.getAttribute(`d`)
      const y_values = [...(line_d ?? ``).matchAll(/[ML][-\d.]+,(?<y>[-\d.]+)/g)].map(
        (match) => Number(match.groups?.y),
      )
      expect(y_values).toHaveLength(4)
      const bottom = clip.y + clip.height
      // Non-positive values sit on the bottom edge, not at -Infinity/NaN
      expect(y_values[0]).toBeCloseTo(bottom, 6)
      expect(y_values[2]).toBeCloseTo(bottom, 6)
      expect(y_values[3]).toBeLessThan(y_values[1])
      expect(y_values.every(Number.isFinite)).toBe(true)
    },
  )

  // a bound `view` mirrors the live ranges unless its mount value sets a differing range
  test.each([
    [undefined, [0, 100]],
    [{}, [0, 100]],
    [{ x: [0, 100] as Vec2 }, [0, 100]],
    [{ x: [20, 30] as Vec2 }, [20, 30]],
  ])(`bound view %j at mount ends with x %j`, async (view, expected_x) => {
    const state = $state<{ view: Partial<AxisRanges> | undefined }>({ view })
    const [x_axis, y_axis] = [{ range: [0, 100] as Vec2 }, { range: [0, 10] as Vec2 }]
    const series = [{ x: [10, 50, 90], y: [1, 5, 9] }]
    await mount_sized_scatter_plot(bind_props({ series, x_axis, y_axis }, state))
    await tick()
    expect([state.view?.x, state.view?.y]).toEqual([expected_x, [0, 10]])
  })

  // Shift-drag pans by a constant data offset: moving the cursor by a quarter of the plot
  // width shifts the view by a quarter of the x span. Gestures only move the live view, which
  // the bindable `view` mirrors; the bound axis props keep the pre-pan range (so a later reset
  // has a target), and a host writing `view` moves the plot without touching them either.
  test(`shift-drag pan shifts the view by the dragged data span`, async () => {
    const state = $state<{
      x_axis: AxisConfig
      y_axis: AxisConfig
      view: Partial<AxisRanges> | undefined
    }>({ x_axis: { range: [0, 100] }, y_axis: { range: [0, 10] }, view: undefined })
    const plot = await mount_sized_scatter_plot(
      bind_props({ series: [{ x: [10, 50, 90], y: [1, 5, 9] }], ...bare }, state),
    )
    const svg = plot_svg(plot)
    const clip = clip_rect(plot)
    const [start_x, start_y] = [clip.x + clip.width / 2, clip.y + clip.height / 2]
    svg.dispatchEvent(
      mouse(`mousedown`, { button: 0, shiftKey: true, clientX: start_x, clientY: start_y }),
    )
    // Drag left by a quarter of the plot: the view follows the data, so the range moves right
    const end = { clientX: start_x - clip.width / 4, clientY: start_y }
    await fire(window, new MouseEvent(`mousemove`, { buttons: 1, ...end }))
    await fire(window, new MouseEvent(`mouseup`, end))
    expect(state.x_axis.range).toEqual([0, 100])
    expect(state.y_axis.range).toEqual([0, 10])
    // The view is now [25, 125]: x=10 scrolled out, x=50 sits a quarter of the way along the
    // plot, x=90 at 65%, and the x ticks moved with them
    const marker_xs = [...plot.querySelectorAll(`.marker`)].map(
      (_, idx) => marker_position(plot, idx).x,
    )
    expect(marker_xs).toHaveLength(2)
    expect(marker_xs[0]).toBeCloseTo(clip.x + clip.width * 0.25, 6)
    expect(marker_xs[1]).toBeCloseTo(clip.x + clip.width * 0.65, 6)
    expect(axis_tick_labels(plot, `x`)).toContain(`120`)
    expect(axis_tick_labels(plot, `x`)).not.toContain(`0`)
    expect(state.view?.x?.[0]).toBeCloseTo(25, 6)
    expect(state.view?.x?.[1]).toBeCloseTo(125, 6)
    expect(state.view?.y).toEqual([0, 10])

    // the host scrolls the view back through the same prop
    state.view = { ...state.view, x: [0, 100] }
    await tick()
    expect(axis_tick_labels(plot, `x`)).toContain(`0`)
    expect(axis_tick_labels(plot, `x`)).not.toContain(`120`)
    expect(state.x_axis.range).toEqual([0, 100])
  })

  // A grown auto range (more data, or a narrower plot: the padding is in px) moves an unzoomed
  // view along but leaves a zoomed one where the user put it
  test(`a grown auto range keeps a zoomed view and moves an unzoomed one`, async () => {
    const state = $state<{ series: DataSeries[]; view: Partial<AxisRanges> | undefined }>({
      series: [{ x: [1, 9], y: [1, 9] }],
      view: undefined,
    })
    await mount_sized_scatter_plot(bind_props({ ...bare }, state))
    await tick()
    const grow = async (x_max: number) => {
      state.series = [{ x: [1, x_max], y: [1, 9] }]
      await flush_render()
    }
    await grow(19)
    expect(state.view?.x?.[1]).toBeGreaterThanOrEqual(19)
    state.view = { ...state.view, x: [2, 4] }
    await tick()
    await grow(29)
    expect(state.view?.x).toEqual([2, 4])
  })

  // Regression guard for effect_update_depth_exceeded: with an explicit y range the range-sync
  // effect writes a fresh y array every run, and the y2 sync reads it back, so a tracked read
  // loops forever (Svelte logs via console.error). A synced y2 derives from y, so every writer
  // of y, including the `view` prop, must re-derive it in the same flush.
  test(`explicit y range + synced y2: no loop, view.y writes re-derive y2`, async () => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => undefined)
    const state = $state<{ view: Partial<AxisRanges> | undefined; y2_axis: AxisConfig }>({
      view: undefined,
      y2_axis: { sync: `synced` },
    })
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          series: [
            { x: [1, 2, 3], y: [1, 2, 3] },
            { x: [1, 2, 3], y: [10, 20, 30], y_axis: `y2` as const },
          ],
          y_axis: { range: [0, 10] as Vec2 },
          ...bare,
        },
        state,
      ),
    )
    expect(error_spy).not.toHaveBeenCalled()
    expect(axis_tick_labels(plot, `y2`)).toEqual(axis_tick_labels(plot, `y`))

    // the host scrolls only y; y2 has to come along in the same flush
    state.view = { y: [0, 5] }
    await tick()
    expect(axis_tick_labels(plot, `y`)).toContain(`5`)
    expect(axis_tick_labels(plot, `y`)).not.toContain(`10`)
    expect(axis_tick_labels(plot, `y2`)).toEqual(axis_tick_labels(plot, `y`))
    expect(error_spy).not.toHaveBeenCalled()

    // y2 follows the linear y gesture; independently panning its log scale would overflow.
    state.y2_axis = { sync: `synced`, scale_type: `log` }
    await tick()
    state.view = { y: [1, 1e300] }
    await tick()
    const svg = plot_svg()
    svg.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Shift` }))
    svg.dispatchEvent(
      new WheelEvent(`wheel`, { deltaY: clip_rect(plot).height / 10, bubbles: true }),
    )
    await tick()
    expect(state.view?.y).toEqual([1e299, 1.1e300])
    expect(state.view?.y2).toEqual(state.view?.y)
    expect(error_spy).not.toHaveBeenCalled()
  })
})
