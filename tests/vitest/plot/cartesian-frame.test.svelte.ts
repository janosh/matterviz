// Regression tests for the shared Cartesian scaffold (create_cartesian_frame) and the layers it
// feeds (PlotAxes, PlotLegendLayer, ReferenceLinesLayer), exercised through the charts that
// mount it rather than in isolation (it creates $effects). Anything asserted here holds for
// every chart, so the per-chart test files only keep behaviour specific to their own marks.
import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib'
import type { Vec2 } from '$lib/math'
import { type AxisConfig, COLOR_BAR_DEFAULTS } from '$lib/plot/core/types'
import { AXIS_LABEL_HEIGHT, DEFAULT_PLOT_PADDING } from '$lib/plot/core/layout'
import BinnedScatterPlot from '$lib/plot/scatter/BinnedScatterPlot.svelte'
import { type Component, createRawSnippet, flushSync, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  axis_label_pivot_y,
  bind_props,
  clip_rect,
  doc_query,
  inside_clip_path,
  mount_sized,
  query,
  with_measured_text,
} from '../setup'

const dist = (count: number, center = 0): number[] =>
  Array.from({ length: count }, (_, idx) => center + Math.sin(idx * 1.7))
const labels = [`alpha`, `beta`, `gamma`]
const thirty = Array.from({ length: 30 }, (_, idx) => idx)
const uniform = Array.from({ length: 800 }, (_, idx) => idx % 100)

type FrameChart = {
  name: string
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  component: Component<any>
  selector: string
  // Group element wrapping one series' marks, for paint-order checks
  series_selector: string
  // Whether the chart's legend auto-shows for several labelled series (BoxPlot opts out:
  // its category ticks already name every box)
  legend_auto: boolean
  // Three labelled series spanning x ∈ [0, 2], sparse enough that the legend fits inside
  props: () => Record<string, unknown>
  // Marks covering the whole chart area so the solver has to move the legend outside
  dense_props: () => Record<string, unknown>
  // One primary series plus one series per secondary axis in `secondary_axes`, carrying
  // `values`. Unit-less series share one axis group, so the primaries pin y1 explicitly
  secondary_axes: (`x2` | `y2`)[]
  secondary_props: (values: number[]) => Record<string, unknown>
}

const frame_charts: FrameChart[] = [
  {
    name: `BarPlot`,
    component: BarPlot,
    selector: `.bar-plot`,
    series_selector: `.bar-series`,
    legend_auto: true,
    props: () => ({
      series: labels.map((label, idx) => ({
        x: [0, 1, 2],
        y: [idx + 1, idx + 2, idx + 3],
        label,
      })),
    }),
    dense_props: () => ({
      series: [`A`, `B`].map((label) => ({ x: thirty, y: thirty.map(() => 100), label })),
      mode: `stacked`,
    }),
    secondary_axes: [`x2`, `y2`],
    secondary_props: (values) => ({
      series: [
        { x: [1, 2, 3], y: [1, 2, 3], label: `Main`, y_axis: `y1` },
        { x: [1, 2, 3], y: values, label: `Y2`, y_axis: `y2` },
        { x: values, y: [5, 15, 25], label: `X2`, x_axis: `x2`, y_axis: `y1` },
      ],
    }),
  },
  {
    name: `BoxPlot`,
    component: BoxPlot,
    selector: `.box-plot`,
    series_selector: `.box-series`,
    legend_auto: false,
    props: () => ({ series: labels.map((label, idx) => ({ y: dist(30, idx), label })) }),
    dense_props: () => ({
      series: Array.from({ length: 24 }, (_, idx) => ({
        y: [-20, -10, 0, 10, 20],
        label: `Box ${idx}`,
      })),
    }),
    // vertical boxes sit on a categorical x, so only y2 can carry data
    secondary_axes: [`y2`],
    secondary_props: (values) => ({
      series: [
        { y: dist(30), label: `Main`, y_axis: `y1` },
        { y: values, label: `Y2`, y_axis: `y2` },
      ],
    }),
  },
  {
    name: `Histogram`,
    component: Histogram,
    selector: `.histogram`,
    series_selector: `.histogram-series`,
    legend_auto: true,
    props: () => ({
      series: labels.map((label, idx) => ({ values: dist(30, idx), label })),
      mode: `overlay`,
    }),
    dense_props: () => ({
      series: [
        { values: uniform, label: `A` },
        { values: uniform.map((val) => val + 0.5), label: `B` },
      ],
      bins: 40,
      mode: `overlay`,
    }),
    secondary_axes: [`x2`, `y2`],
    secondary_props: (values) => ({
      series: [
        { values: [1, 2, 3], label: `Main`, y_axis: `y1` },
        { values, label: `Y2`, y_axis: `y2` },
        { values, label: `X2`, x_axis: `x2`, y_axis: `y1` },
      ],
      mode: `overlay`,
    }),
  },
  {
    name: `ScatterPlot`,
    component: ScatterPlot,
    selector: `.scatter`,
    series_selector: `g[data-series-id]`,
    legend_auto: true,
    props: () => ({
      series: labels.map((label, idx) => ({
        x: [0, 1, 2],
        y: [idx, idx + 1, idx],
        label,
        markers: `points`,
      })),
    }),
    dense_props: () => {
      const grid = Array.from({ length: 400 }, (_, idx) => [idx % 20, Math.floor(idx / 20)])
      return {
        series: [`A`, `B`].map((label, series_idx) => ({
          x: grid.map(([col]) => col + series_idx * 0.5),
          y: grid.map(([, row]) => row + series_idx * 0.5),
          label,
        })),
      }
    },
    secondary_axes: [`x2`, `y2`],
    secondary_props: (values) => ({
      series: [
        { x: [1, 2, 3], y: [1, 2, 3], label: `Main`, y_axis: `y1` },
        { x: [1, 2, 3], y: values, label: `Y2`, y_axis: `y2` },
        { x: values, y: [5, 15, 25], label: `X2`, x_axis: `x2`, y_axis: `y1` },
      ],
    }),
  },
]

// BinnedScatterPlot mounts the frame too but has no legend, so it only joins the axis and
// reference-line tests; it takes its ref lines via `overlays` rather than a top-level prop
type AxisChart = Pick<FrameChart, `name` | `component` | `selector` | `props`> & {
  ref_line_props?: (ref_lines: Record<string, unknown>[]) => Record<string, unknown>
}
const axis_charts: AxisChart[] = [
  ...frame_charts,
  {
    name: `BinnedScatterPlot`,
    component: BinnedScatterPlot,
    selector: `.binned-scatter`,
    props: () => ({ series: [{ x: [0, 1, 2], y: [0, 1, 2] }], color_bar: null }),
    ref_line_props: (ref_lines) => ({ overlays: { ref_lines } }),
  },
]

// Charts with a category axis: the frame measures their category names (not the slot
// indices behind them) when reserving padding, on whichever side the orientation puts them
const categorical_charts = [
  {
    name: `BarPlot`,
    component: BarPlot,
    selector: `.bar-plot`,
    props: (cats: string[], orientation: `vertical` | `horizontal`) => ({
      series: [{ x: cats, y: cats.map((_cat, idx) => idx + 1), color: `blue` }],
      orientation,
    }),
  },
  {
    name: `BoxPlot`,
    component: BoxPlot,
    selector: `.box-plot`,
    props: (cats: string[], orientation: `vertical` | `horizontal`) => ({
      series: cats.map((cat) => ({ y: dist(40), label: cat, category: cat })),
      orientation,
      show_legend: false, // isolate tick tilting from the auto legend's layout reservation
    }),
  },
]

// Charts that hand a colorbar to the frame's solver through create_colorbar_decoration
const colorbar_charts = [
  {
    name: `ScatterPlot`,
    component: ScatterPlot,
    selector: `.scatter`,
    props: () => ({
      series: [{ x: [0, 100], y: [90, 90], color_values: [1, 2] }],
      x_axis: { range: [0, 100] },
      y_axis: { range: [0, 100] },
      legend: null,
      color_bar: {},
    }),
  },
  {
    name: `BinnedScatterPlot`,
    component: BinnedScatterPlot,
    selector: `.binned-scatter`,
    props: () => ({
      series: [{ x: [0.5], y: [0.5] }],
      density: { auto_point_mode: { max_points: 0, max_points_per_px: 0 }, bin_px: 20 },
      x_axis: { range: [0, 1] },
      y_axis: { range: [0, 1] },
    }),
  },
]

const mount_chart = (
  chart: Pick<FrameChart, `component` | `selector`>,
  props: Record<string, unknown>,
  size: { width?: number; height?: number } = {},
): Promise<HTMLElement> =>
  mount_sized(chart.component, props, { selector: chart.selector, ...size })

const legend_px = (plot: HTMLElement, prop: `left` | `top`): number => {
  const legend = query(plot, `.legend`)
  return Number(legend.style[prop].replace(`px`, ``))
}
const legend_outside = (plot: HTMLElement): boolean => {
  const clip = clip_rect(plot)
  return legend_px(plot, `top`) >= clip.y + clip.height
}
// Reference-line annotation label with the given text
const annotation_of = (plot: HTMLElement, text: string): Element => {
  const label = [...plot.querySelectorAll(`svg text`)].find((el) => el.textContent === text)
  if (!label) throw new Error(`missing ${text} annotation`)
  return label
}

describe(`cartesian frame`, () => {
  afterEach(() => vi.restoreAllMocks())

  // PlotLegendLayer binds frame.legend_filter_query, so the frame owns the text after mount.
  // As a $derived it reset to the legend config on every new legend object, wiping what the
  // user had typed whenever the parent re-rendered with an inline legend={{ ... }} literal.
  test.each(frame_charts)(
    `$name keeps typed legend filter across a new legend object`,
    async (chart) => {
      // filter_threshold below the series count so PlotLegend renders its filter input
      const bound = $state({ legend: { filter_threshold: 2 } })
      await mount_chart(chart, bind_props({ ...chart.props(), show_legend: true }, bound))

      const input = doc_query<HTMLInputElement>(`input.legend-filter`)
      input.value = `alp`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(input.value).toBe(`alp`)

      bound.legend = { filter_threshold: 2 } // fresh object, as a parent re-render would pass
      await tick()
      // Re-query rather than reuse `input`: a remounted input would leave the old node
      // detached but still holding the typed text, which would pass for the wrong reason.
      expect(doc_query<HTMLInputElement>(`input.legend-filter`).value).toBe(`alp`)
    },
  )

  // Rect zoom inverts the drag rect into the live view and leaves the axis props alone, so a
  // caller's pin survives the gesture and a reset lands back on it. A secondary axis only
  // zooms with data on it: otherwise its [0, 1] sentinel scale must not be inverted
  test.each(frame_charts)(
    `$name rect zoom moves the view, not the bound axis props, and reset restores the pin`,
    async (chart) => {
      const pinned: Vec2 = [0, 400]
      const bound = $state<Record<`x_axis` | `x2_axis` | `y_axis` | `y2_axis`, AxisConfig>>({
        x_axis: { range: pinned },
        x2_axis: { range: pinned },
        y_axis: { range: pinned },
        y2_axis: { range: pinned },
      })
      const plot = await mount_chart(
        chart,
        bind_props(chart.secondary_props([100, 200, 300]), bound),
      )
      const tick_values = (axis: `x` | `x2` | `y` | `y2`): number[] =>
        [...plot.querySelectorAll(`g.${axis}-axis g.tick text`)]
          .map((el) => Number(el.textContent))
          .filter(Number.isFinite)
      const tick_span = (axis: `x` | `x2` | `y` | `y2`): Vec2 => {
        const values = tick_values(axis)
        expect(values.length, axis).toBeGreaterThan(1)
        return [Math.min(...values), Math.max(...values)]
      }
      // numeric axes only: BoxPlot's categorical x labels its boxes, not the range
      const shown_axes = ([`x`, `y`, ...chart.secondary_axes] as const).filter(
        (axis) => tick_values(axis).length > 1,
      )
      expect(shown_axes).toContain(`y`)
      const initial = Object.fromEntries(shown_axes.map((axis) => [axis, tick_span(axis)]))
      // jsdom reports a zero-origin bounding rect, so client coords are plot-local; drag the
      // middle half of the plot width and the second quarter of its height
      const clip = clip_rect(plot)
      const at = (fx: number, fy: number): MouseEventInit => ({
        bubbles: true,
        clientX: clip.x + clip.width * fx,
        clientY: clip.y + clip.height * fy,
      })
      doc_query(`svg[role="application"]`).dispatchEvent(
        new MouseEvent(`mousedown`, at(0.25, 0.25)),
      )
      window.dispatchEvent(new MouseEvent(`mousemove`, at(0.75, 0.5)))
      window.dispatchEvent(new MouseEvent(`mouseup`, at(0.75, 0.5)))
      await tick()

      for (const axis of shown_axes) {
        const [min, max] = tick_span(axis)
        // The drag selects x=[100, 300] and y=[200, 300]; ticks may land on the endpoints.
        const [lower, upper] = axis.startsWith(`x`) ? [100, 300] : [200, 300]
        expect(min, axis).toBeGreaterThanOrEqual(lower)
        expect(max, axis).toBeLessThanOrEqual(upper)
      }
      const props_unchanged = () => {
        for (const axis of [`x`, `x2`, `y`, `y2`] as const) {
          expect(bound[`${axis}_axis`], axis).toEqual({ range: pinned })
        }
      }
      props_unchanged()

      doc_query(`svg[role="application"]`).dispatchEvent(
        new MouseEvent(`dblclick`, { bubbles: true }),
      )
      await tick()
      for (const axis of shown_axes) expect(tick_span(axis), axis).toEqual(initial[axis])
      props_unchanged()
    },
  )

  // The frame owns legend dragging: a dropped legend keeps the drop position (clamped to the
  // plot) and leaves solver ownership, so the data-decoration-* stamps go away
  // The drag measures the legend and the SVG once at grab time: re-measuring the SVG after
  // every position write forced a reflow per mousemove (21 rect reads for this drag, now 2),
  // and the legend box itself is measured in an effect, never in the handlers or derivations
  test.each(frame_charts)(`$name legend drag pins it where it was dropped`, async (chart) => {
    await mount_chart(chart, { ...chart.props(), show_legend: true })
    const legend = doc_query(`.legend`)
    expect(legend.getAttribute(`data-decoration-x`)).not.toBeNull()
    const rect_spy = vi.spyOn(Element.prototype, `getBoundingClientRect`)
    const offset_spy = vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`)
    try {
      // jsdom reports zero-origin rects, so the drop lands at cursor minus the grab offset
      legend.dispatchEvent(
        new MouseEvent(`mousedown`, { bubbles: true, clientX: 100, clientY: 50 }),
      )
      for (let step = 1; step <= 20; step++) {
        window.dispatchEvent(
          new MouseEvent(`mousemove`, { clientX: 100 + step * 10, clientY: 50 + step * 7.5 }),
        )
        flushSync()
      }
      window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: 300, clientY: 200 }))
      await tick()
      expect([rect_spy.mock.calls.length, offset_spy.mock.calls.length]).toEqual([2, 0])
    } finally {
      rect_spy.mockRestore()
      offset_spy.mockRestore()
    }
    const pinned = doc_query(`.legend`)
    expect({ left: pinned.style.left, top: pinned.style.top }).toEqual({
      left: `200px`,
      top: `150px`,
    })
    expect(pinned.getAttribute(`data-decoration-x`)).toBeNull()
  })

  // The accessible name comes from the axis labels unless the caller passes one explicitly;
  // either way only the SVG carries it, not the wrapper
  test.each(axis_charts)(
    `$name derives the SVG aria-label from the axis labels`,
    async (chart) => {
      const svg_label = (plot: HTMLElement) =>
        plot.querySelector(`svg[role="application"]`)?.getAttribute(`aria-label`)
      const labelled = await mount_chart(chart, {
        ...chart.props(),
        x_axis: { label: `Temperature` },
        y_axis: { label: `Pressure` },
      })
      expect(svg_label(labelled)).toBe(`Temperature vs Pressure`)
      expect(labelled.getAttribute(`aria-label`)).toBeNull()
      const aria_label = `${chart.name} accessible plot`
      const explicit = await mount_chart(chart, { ...chart.props(), 'aria-label': aria_label })
      expect(svg_label(explicit)).toBe(aria_label)
      expect(explicit.getAttribute(`aria-label`)).toBeNull()
    },
  )

  test.each(frame_charts)(`$name renders the children snippet`, async (chart) => {
    const plot = await mount_chart(chart, {
      ...chart.props(),
      children: createRawSnippet(() => ({
        render: () => `<div class="custom-child">Custom overlay content</div>`,
      })),
    })
    expect(plot.querySelector(`.custom-child`)?.textContent).toBe(`Custom overlay content`)
  })

  // Auto-padding has to measure the custom strings the axis actually draws, not the numeric
  // tick values behind them, or the labels tilt into a band nobody reserved
  test.each(axis_charts)(
    `$name bottom padding follows custom x tick labels, not their numeric values`,
    async (chart) => {
      // read the baseline off a tick group's translate: ScatterPlot draws no x spine
      const baseline_y = async (ticks: Record<number, string>): Promise<number> => {
        const plot = await mount_chart(chart, {
          ...chart.props(),
          x_axis: { ticks, tick_label: { rotation: 45 } },
        })
        const transform = plot.querySelector(`g.x-axis g.tick`)?.getAttribute(`transform`)
        return Number(/,\s*(?<axis_y>[\d.]+)\)/.exec(transform ?? ``)?.groups?.axis_y)
      }
      await with_measured_text(async () => {
        const long = Object.fromEntries([0, 1, 2].map((val) => [val, `CATEGORY_LABEL_${val}`]))
        const short = Object.fromEntries([0, 1, 2].map((val) => [val, `${val}`]))
        const [with_long, with_short] = [await baseline_y(long), await baseline_y(short)]
        expect(with_short).toBeGreaterThan(0)
        expect(with_long).toBeLessThan(with_short)
      })
    },
  )

  // resolve_legend_visibility itself is unit-tested in series-visibility.test.ts; this checks
  // each chart wires its own auto default through and that legend=null stays the hard off switch
  test.each(frame_charts)(
    `$name legend auto default is $legend_auto, explicit show_legend wins and legend=null hides`,
    async (chart) => {
      const has_legend = async (extra: Record<string, unknown>) =>
        Boolean(
          (await mount_chart(chart, { ...chart.props(), ...extra })).querySelector(`.legend`),
        )
      expect(await has_legend({})).toBe(chart.legend_auto)
      expect(await has_legend({ show_legend: !chart.legend_auto })).toBe(!chart.legend_auto)
      expect(await has_legend({ show_legend: true, legend: null })).toBe(false)
    },
  )

  // double-clicking a legend item isolates that series; a second double-click restores
  test.each(frame_charts)(
    `$name legend double-click isolates a series and restores on repeat`,
    async (chart) => {
      const plot = await mount_chart(chart, { ...chart.props(), show_legend: true })
      const visible_states = () =>
        [...plot.querySelectorAll(`.legend-item`)].map(
          (el) => !el.classList.contains(`hidden`),
        )
      expect(visible_states()).toEqual([true, true, true])
      const dblclick = async () => {
        plot
          .querySelector(`.legend-item`)
          ?.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
        await tick()
      }
      await dblclick()
      expect(visible_states()).toEqual([true, false, false])
      await dblclick()
      expect(visible_states()).toEqual([true, true, true])
    },
  )

  // The solver reads the chart's obstacle field: sparse marks leave room inside the plot area,
  // marks covering the whole area push the legend below it (and shrink the clip to make room)
  test.each(frame_charts)(
    `$name legend stays inside sparse marks and moves below dense ones`,
    async (chart) => {
      const sparse = await mount_chart(chart, {
        ...chart.props(),
        show_legend: true,
        legend: {},
      })
      expect(legend_outside(sparse)).toBe(false)
      const dense = await mount_chart(chart, {
        ...chart.dense_props(),
        show_legend: true,
        legend: {},
      })
      expect(legend_outside(dense)).toBe(true)
    },
  )

  // An outside legend is placed from its measured size: bottom-centred with an 8px gap, at
  // every plot size, and mounting the same props twice yields the same chart area
  test.each(frame_charts)(
    `$name places a measured outside legend without padding drift across plot sizes`,
    async (chart) => {
      vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(180)
      vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(44)
      const props = () => ({ ...chart.dense_props(), show_legend: true, legend: {} })
      const small = await mount_chart(chart, props(), { width: 400, height: 300 })
      const wide = await mount_chart(chart, props(), { width: 640, height: 340 })
      const repeated = await mount_chart(chart, props(), { width: 640, height: 340 })
      for (const [plot, height] of [
        [small, 300],
        [wide, 340],
      ] as const) {
        const clip = clip_rect(plot)
        expect(legend_px(plot, `top`)).toBe(height - 44 - 8)
        expect(legend_px(plot, `left`)).toBe(clip.x + (clip.width - 180) / 2)
      }
      expect(legend_px(wide, `left`)).toBeGreaterThan(legend_px(small, `left`))
      expect(clip_rect(repeated)).toEqual(clip_rect(wide))
    },
    // three ScatterPlot mounts take ~1 s alone but 5 s+ under a loaded full-suite run
    15_000,
  )

  test.each(frame_charts)(
    `$name auto legend tracks follow the plot width and a styled legend keeps its place`,
    async (chart) => {
      const four = {
        ...chart.props(),
        series: Array.from({ length: 4 }, (_, idx) => ({
          ...(chart.props().series as Record<string, unknown>[])[idx % 3],
          label: `Series ${idx}`,
        })),
        show_legend: true,
        legend: {
          layout: `horizontal`,
          layout_tracks: `auto`,
          item_extents: Array.from({ length: 4 }, () => ({ width: 70, height: 20 })),
        },
      }
      const columns = (plot: HTMLElement) =>
        plot.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateColumns
      expect(columns(await mount_chart(chart, four))).toBe(`repeat(4, auto)`)
      expect(columns(await mount_chart(chart, four, { width: 280 }))).toBe(`repeat(2, auto)`)

      // An explicitly positioned legend is left alone by the solver and reserves no padding
      const pinned = await mount_chart(chart, {
        ...chart.props(),
        show_legend: true,
        legend: { style: `right: 7px; top: 9px; background-color: rgb(1, 2, 3);` },
      })
      const legend = pinned.querySelector<HTMLElement>(`.legend`)
      expect(legend?.style.right).toBe(`7px`)
      expect(legend?.style.top).toBe(`9px`)
      expect(legend?.style.left).toBe(``)
      expect(legend?.style.backgroundColor).toBe(`rgb(1, 2, 3)`)
      const baseline = await mount_chart(chart, { ...chart.props(), show_legend: false })
      expect(clip_rect(pinned)).toEqual(clip_rect(baseline))
    },
  )

  test.each(frame_charts)(
    `$name renders labelled secondary axes with the y2 title centred on the y title`,
    async (chart) => {
      const plot = await mount_chart(chart, {
        ...chart.secondary_props([100, 200, 300]),
        y_axis: { label: `Primary` },
        y2_axis: { label: `Secondary` },
        x2_axis: { label: `Top` },
      })
      for (const axis of chart.secondary_axes) {
        expect(plot.querySelector(`g.${axis}-axis`)).toBeInstanceOf(SVGGElement)
      }
      expect(plot.querySelector(`.x2-label`)?.textContent ?? null).toBe(
        chart.secondary_axes.includes(`x2`) ? `Top` : null,
      )
      expect(plot.querySelector(`.y2-label`)?.textContent).toBe(`Secondary`)
      // both y titles rotate about the plot's vertical center; a stale label_shift default
      // used to push the y2 title 60px below center
      const pivot_y = (selector: string) => axis_label_pivot_y(plot, selector)
      expect(pivot_y(`.axis-label.y2-label`)).toBeCloseTo(pivot_y(`.axis-label.y-label`), 5)
    },
  )

  // Secondary axes only exist with a finite point behind them: [0, 1] sentinel scales never render
  test.each(frame_charts)(
    `$name does not render secondary axes for series without finite values`,
    async (chart) => {
      const plot = await mount_chart(chart, chart.secondary_props([NaN, NaN, Infinity]))
      for (const axis of chart.secondary_axes) {
        expect(plot.querySelector(`g.${axis}-axis`)).toBeNull()
      }
      expect(plot.querySelectorAll(chart.series_selector).length).toBeGreaterThan(0)
    },
  )

  test.each(frame_charts)(
    `$name explicit top/right padding is not overridden by secondary-axis auto-padding`,
    async (chart) => {
      const plot = await mount_chart(chart, {
        ...chart.secondary_props([100, 200, 300]),
        padding: { r: 10, t: 10 },
        x2_axis: { label: `Top` },
        y2_axis: { label: `Secondary` },
      })
      const clip = clip_rect(plot)
      expect(400 - clip.x - clip.width).toBe(10)
      expect(clip.y).toBe(10)
    },
  )

  test(`title-only y2 axis expands right padding`, async () => {
    const plot = await mount_sized(
      BarPlot,
      {
        series: [
          { x: [1, 2], y: [1, 2], label: `A` },
          { x: [1, 2], y: [1, 2], label: `Y2`, y_axis: `y2` },
        ],
        y_axis: { ticks: [] },
        y2_axis: { label: `Secondary`, ticks: [] },
      },
      { selector: `.bar-plot` },
    )
    // a title with no ticks still reserves its own band, past the shared default
    const clip = clip_rect(plot)
    expect(400 - clip.x - clip.width).toBe(AXIS_LABEL_HEIGHT)
    expect(AXIS_LABEL_HEIGHT).toBeGreaterThan(DEFAULT_PLOT_PADDING.r)
  })

  // The Ticks control writes `ticks` into the bindable axis config, which the frame feeds to
  // generate_ticks, so typing a count changes the rendered tick marks (not a dead setting)
  test.each(frame_charts)(
    `$name Ticks control changes the rendered y tick count`,
    async (chart) => {
      const plot = await mount_chart(chart, {
        ...chart.props(),
        show_controls: true,
        controls_open: true,
      })
      const y_tick_count = () => plot.querySelectorAll(`g.y-axis .tick`).length
      const before = y_tick_count()
      expect(before).toBeGreaterThan(0)
      const y_input = doc_query<HTMLInputElement>(`input[aria-label="Y axis tick count"]`)
      y_input.value = `${before * 3}`
      y_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(y_tick_count()).toBeGreaterThan(before)
    },
  )

  test.each(axis_charts)(
    `$name default left padding grows for wide y ticks`,
    async (chart) => {
      const plot = await with_measured_text(
        () => mount_chart(chart, { ...chart.props(), y_axis: { label: `Value` } }),
        60, // even 1-digit y ticks measure 60px wide, past the 60px default left pad
      )
      expect(clip_rect(plot).x).toBeGreaterThan(DEFAULT_PLOT_PADDING.l)
    },
  )

  const long_cats = [`PENDING`, `RUNNING`, `QUEUE_HOLD`, `COMPLETED`, `CANCELLED`]
  test.each(categorical_charts)(
    `$name rotates long category names outward and keeps short ones upright`,
    async (chart) => {
      const mount_with_cats = (cats: string[], strategies?: `rotate`[]) =>
        with_measured_text(() =>
          mount_chart(chart, {
            ...chart.props(cats, `vertical`),
            x_axis: { label: `state`, tick_label: { auto_layout: { strategies } } },
          }),
        )
      const x_tick_labels = (plot: HTMLElement) => [
        ...plot.querySelectorAll(`g.x-axis g.tick text`),
      ]
      const baseline_of = (plot: HTMLElement): number =>
        Number(plot.querySelector(`g.x-axis > line`)?.getAttribute(`y1`))
      const long = await mount_with_cats(long_cats, [`rotate`])
      const long_labels = x_tick_labels(long)
      expect(long_labels.length).toBeGreaterThan(2)
      for (const label of long_labels) {
        expect(label.getAttribute(`transform`)).toMatch(/^rotate\(-[\d.]+,/)
      }
      // Side padding lets every label trail outward instead of flipping the first into the marks
      expect(long_labels.map((label) => label.getAttribute(`text-anchor`))).toEqual(
        Array(long_labels.length).fill(`end`),
      )
      const short = await mount_with_cats([`A`, `B`, `C`])
      const short_labels = x_tick_labels(short)
      expect(short_labels).toHaveLength(3) // else the loop below asserts nothing
      for (const label of short_labels) expect(label.getAttribute(`transform`)).toBeNull()
      // the tilted labels still fit: the x baseline moves up to make room for them
      expect(baseline_of(long)).toBeGreaterThan(0)
      expect(baseline_of(long)).toBeLessThan(baseline_of(short))
    },
  )

  // Horizontal orientation moves the categories onto y, so the left padding has to be measured
  // from the category names; measuring the integer slot indices behind them left long names
  // overrunning the reserved gutter and the y title on top of the ticks
  test.each(categorical_charts)(
    `$name horizontal orientation sizes left padding from category names`,
    async (chart) => {
      const left_pad_for = (cats: string[]) =>
        with_measured_text(async () => {
          const plot = await mount_chart(chart, chart.props(cats, `horizontal`))
          return clip_rect(plot).x
        })
      const long = await left_pad_for([`QUEUE_HOLD`, `COMPLETED`, `CANCELLED`])
      const short = await left_pad_for([`A`, `B`, `C`])
      expect(short).toBeGreaterThan(0)
      expect(long).toBeGreaterThan(short)
    },
  )

  // ref-line annotations render outside the chart clip group so labels at the plot edges
  // (e.g. a vertical line's top label) can overflow instead of being cropped, while z ordering
  // still holds: below-lines refs paint behind the marks, above-all in front
  test.each(frame_charts)(
    `$name reference-line annotations are unclipped and z-ordered around the marks`,
    async (chart) => {
      const plot = await mount_chart(chart, {
        ...chart.props(),
        ref_lines: [
          { type: `vertical`, x: 0.5, annotation: { text: `behind` } }, // default z: below-lines
          { type: `vertical`, x: 1.5, z_index: `above-all`, annotation: { text: `front` } },
        ],
      })
      await tick()
      const label_of = (text: string) => annotation_of(plot, text)
      const marks = query(plot, `svg ${chart.series_selector}`)
      for (const text of [`behind`, `front`]) {
        expect(inside_clip_path(label_of(text)), `annotation must escape the clip-path`).toBe(
          false,
        )
      }
      // document order encodes paint order: below-lines < marks < above-all
      const behind_order = marks.compareDocumentPosition(label_of(`behind`))
      const front_order = marks.compareDocumentPosition(label_of(`front`))
      expect(behind_order & Node.DOCUMENT_POSITION_PRECEDING).not.toBe(0)
      expect(front_order & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    },
  )

  test.each(axis_charts)(
    `$name shared solver separates nearby annotations and keeps explicit placement pinned`,
    async (chart) => {
      const ref_lines = [
        { type: `vertical`, x: 1, annotation: { text: `automatic A` } },
        { type: `vertical`, x: 1.02, annotation: { text: `automatic B` } },
        {
          type: `vertical`,
          x: 1.04,
          annotation: { text: `pinned`, position: `end`, side: `above` },
        },
      ]
      const plot = await mount_chart(chart, {
        ...chart.props(),
        ...(chart.ref_line_props?.(ref_lines) ?? { ref_lines }),
      })
      await tick()
      const geometry = (text: string) => {
        const label = annotation_of(plot, text)
        return {
          y: Number(label.getAttribute(`y`)),
          anchor: label.getAttribute(`text-anchor`),
          baseline: label.getAttribute(`dominant-baseline`),
        }
      }
      // the lines are 2px apart, so the solver has to pick a different side or a different
      // position along the line for the second label
      const [auto_a, auto_b] = [geometry(`automatic A`), geometry(`automatic B`)]
      expect(
        auto_a.anchor !== auto_b.anchor ||
          auto_a.baseline !== auto_b.baseline ||
          Math.abs(auto_a.y - auto_b.y) > 10,
        JSON.stringify({ auto_a, auto_b }),
      ).toBe(true)
      expect(geometry(`pinned`)).toMatchObject({ anchor: `end`, baseline: `auto` })
    },
  )

  // The solver reserves the colorbar's full footprint (bar plus tick labels overflowing it),
  // keeps that rectangle axis_clearance away from every plot edge and positions the wrapper
  // so the overflowing labels, not the bar, sit at the solved rect
  test.each(colorbar_charts)(
    `$name keeps overflowing colorbar ticks clear of the plot axes`,
    async (chart) => {
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
      const plot = await mount_chart(chart, chart.props(), { width: 800, height: 600 })
      const clearance = COLOR_BAR_DEFAULTS.axis_clearance
      await vi.waitFor(() => {
        const colorbar = doc_query(`.colorbar-wrapper`)
        const [x, y, width, height] = [`x`, `y`, `width`, `height`].map((key) =>
          Number(colorbar.getAttribute(`data-decoration-${key}`)),
        )
        const area = clip_rect(plot)
        expect({ width, height }).toEqual({ width: 240, height: 46 })
        expect(x).toBeGreaterThanOrEqual(area.x + clearance)
        expect(y).toBeGreaterThanOrEqual(area.y + clearance)
        expect(x + width).toBeLessThanOrEqual(area.x + area.width - clearance)
        expect(y + height).toBeLessThanOrEqual(area.y + area.height - clearance)
        expect(Math.min(x - area.x, area.x + area.width - (x + width))).toBe(clearance)
        expect(Number(colorbar.style.left.replace(`px`, ``))).toBe(x + 10)
      })
    },
  )
})
