// Tests for the shared Cartesian scaffold (create_cartesian_frame) and the layers it
// feeds (PlotAxes, PlotLegendLayer, ReferenceLinesLayer), exercised through the charts that
// mount it rather than in isolation (it creates $effects). Anything asserted here holds for
// every chart, so the per-chart test files only keep behaviour specific to their own marks.
import BarPlot from '#lib/plot/bar/BarPlot.svelte'
import BoxPlot from '#lib/plot/box/BoxPlot.svelte'
import Histogram from '#lib/plot/histogram/Histogram.svelte'
import ScatterPlot from '#lib/plot/scatter/ScatterPlot.svelte'
import type { ShowControlsProp } from '#lib/controls'
import type { Vec2 } from '#lib/math'
import { type AxisConfig, type AxisRanges, COLOR_BAR_DEFAULTS } from '#lib/plot/core/types'
import {
  AXIS_LABEL_HEIGHT,
  DEFAULT_PLOT_PADDING,
  rect_within_rect,
  rects_overlap,
  Y_TITLE_EDGE_AIR,
} from '#lib/plot/core/layout'
import BinnedScatterPlot from '#lib/plot/scatter/BinnedScatterPlot.svelte'
import ChartHeaderControls from '#lib/plot/core/components/ChartHeaderControls.svelte'
import { create_placed_tween } from '#lib/plot/core/placed-tween.svelte'
import type { PaneToggleProps } from '#lib/overlays/index'
import type * as decorations from '#lib/plot/core/decorations/index'
import { solve_decorations } from '#lib/plot/core/decorations/index'
import { type Component, createRawSnippet, flushSync, tick } from 'svelte'
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vite-plus/test'
import {
  axis_label_pivot_y,
  bind_props,
  clip_rect,
  doc_query,
  drag,
  inside_clip_path,
  mock_fullscreen,
  mount_in_test,
  mount_sized,
  query,
  resize_element,
  with_measured_text,
  set_input,
  svg_rect,
  trigger_resize_observer,
} from '../setup'

// Passthrough spy, so tests can count decoration solves
vi.mock(`#lib/plot/core/decorations/index`, async (import_original) => {
  const original = await import_original<typeof decorations>()
  return { ...original, solve_decorations: vi.fn(original.solve_decorations) }
})

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

const xy_secondary_props = (values: number[]) => ({
  series: [
    { x: [1, 2, 3], y: [1, 2, 3], label: `Main`, y_axis: `y` },
    { x: [1, 2, 3], y: values, label: `Y2`, y_axis: `y2` },
    { x: values, y: [5, 15, 25], label: `X2`, x_axis: `x2`, y_axis: `y` },
  ],
})

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
    secondary_props: xy_secondary_props,
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
        { y: dist(30), label: `Main`, y_axis: `y` },
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
        { values: [1, 2, 3], label: `Main`, y_axis: `y` },
        { values, label: `Y2`, y_axis: `y2` },
        { values, label: `X2`, x_axis: `x2`, y_axis: `y` },
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
    secondary_props: xy_secondary_props,
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

const legend_px = (plot: HTMLElement, prop: `left` | `top`): number =>
  Number(query(plot, `.legend`).style[prop].replace(`px`, ``))
const legend_outside = (plot: HTMLElement): boolean => {
  const clip = clip_rect(plot)
  return legend_px(plot, `top`) >= clip.y + clip.height
}
// Reference-line annotation label with the given text
const annotation_of = (plot: HTMLElement, text: string): Element => {
  const label = [...plot.querySelectorAll(`svg text`)].find(
    (element) => element.textContent === text,
  )
  if (!label) throw new Error(`missing ${text} annotation`)
  return label
}

describe(`cartesian frame`, () => {
  afterEach(() => vi.restoreAllMocks())

  test.each(frame_charts)(
    `$name renders children and shares fullscreen and reactive controls visibility`,
    async (chart) => {
      mock_fullscreen()
      const state = $state<{ show_controls: ShowControlsProp }>({ show_controls: `hover` })
      const plot = await mount_chart(
        chart,
        bind_props(
          {
            ...chart.props(),
            controls_toggle_props: { class: `custom-controls`, style: `color: tomato` },
            children: createRawSnippet(() => ({
              render: () => `<div class="custom-child"></div>`,
            })),
          },
          state,
        ),
      )
      expect(plot.querySelector(`.custom-child`)).not.toBeNull()
      const gear = query<HTMLButtonElement>(plot, `.header-controls > .control-pane-toggle`)
      expect(gear.style.position).toBe(`static`)
      expect(gear.style.color).toBe(`tomato`)
      expect(gear.classList.contains(`custom-controls`)).toBe(true)
      gear.click()
      await tick()
      expect(gear.getAttribute(`aria-expanded`)).toBe(`true`)
      // every control pane carries `control-pane`, like its toggle `control-pane-toggle`
      expect(plot.querySelector(`.control-pane.plot-controls-pane.pane-open`)).not.toBeNull()
      const toggle = query<HTMLButtonElement>(plot, `.fullscreen-btn`)
      expect(plot.classList.contains(`fullscreen`)).toBe(false)
      expect(toggle.getAttribute(`aria-label`)).toBe(`Enter fullscreen`)
      for (const fullscreen of [true, false]) {
        toggle.click()
        await tick()
        expect(plot.classList.contains(`fullscreen`)).toBe(fullscreen)
        expect(toggle.getAttribute(`aria-label`)).toBe(
          fullscreen ? `Exit fullscreen` : `Enter fullscreen`,
        )
      }
      expect(query(plot, `.header-controls`).classList.contains(`hover-visible`)).toBe(true)
      expect(query(plot, `.control-pane-toggle`).classList.contains(`always-visible`)).toBe(
        true,
      )
      state.show_controls = { mode: `always`, hidden: [`controls`] }
      await tick()
      expect(plot.querySelector(`.control-pane-toggle`)).toBeNull()
      expect(plot.querySelector(`.fullscreen-btn`)).not.toBeNull()
      expect(query(plot, `.header-controls`).classList.contains(`always-visible`)).toBe(true)
      state.show_controls = { hidden: [`fullscreen`] }
      await tick()
      expect(plot.querySelector(`.control-pane-toggle`)).not.toBeNull()
      expect(plot.querySelector(`.fullscreen-btn`)).toBeNull()
      state.show_controls = `never`
      await tick()
      expect(plot.querySelector(`.control-pane-toggle, .fullscreen-btn`)).toBeNull()
    },
  )

  // The frame owns the legend filter text after mount, so a parent re-rendering with an
  // inline legend={{ ... }} literal must not wipe what the user typed
  test.each(frame_charts)(
    `$name keeps typed legend filter across a new legend object`,
    async (chart) => {
      // filter_threshold below the series count so PlotLegend renders its filter input
      const bound = $state({ legend: { filter_threshold: 2 } })
      await mount_chart(chart, bind_props({ ...chart.props(), show_legend: true }, bound))
      const input = doc_query<HTMLInputElement>(`input.legend-filter`)
      set_input(input, `alp`)
      await tick()
      expect(input.value).toBe(`alp`)
      bound.legend = { filter_threshold: 2 } // fresh object, as a parent re-render would pass
      await tick()
      // re-query: a remounted input would leave the old detached node holding the typed text
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
      type Bound = Record<`x_axis` | `x2_axis` | `y_axis` | `y2_axis`, AxisConfig>
      const bound = $state<Bound & { view?: Partial<AxisRanges> }>({
        x_axis: { range: pinned },
        x2_axis: { range: pinned },
        y_axis: { range: pinned },
        y2_axis: { range: pinned },
        view: undefined,
      })
      const plot = await mount_chart(
        chart,
        bind_props(chart.secondary_props([100, 200, 300]), bound),
      )
      const tick_values = (axis: `x` | `x2` | `y` | `y2`): number[] =>
        [...plot.querySelectorAll(`g.${axis}-axis g.tick text`)]
          .map((element) => Number(element.textContent))
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
      const at = (frac_x: number, frac_y: number): Vec2 => [
        clip.x + clip.width * frac_x,
        clip.y + clip.height * frac_y,
      ]
      await drag(doc_query(`svg[role="application"]`), {}, at(0.25, 0.25), at(0.75, 0.5))
      for (const axis of shown_axes) {
        const [min, max] = tick_span(axis)
        // The drag selects x=[100, 300] and y=[200, 300]; ticks may land on the endpoints.
        const [lower, upper] = axis.startsWith(`x`) ? [100, 300] : [200, 300]
        expect(min, axis).toBeGreaterThanOrEqual(lower)
        expect(max, axis).toBeLessThanOrEqual(upper)
        // the bindable `view` mirrors the zoom out (to 1e-6)
        const view = bound.view?.[axis]?.map((bound_val) => Number(bound_val.toFixed(6)))
        expect(view, axis).toEqual([lower, upper])
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
      // a host writing `view` moves the plot, not the axis props, and keeps its own values
      bound.view = { y: [200, 300] }
      await tick()
      const [min, max] = tick_span(`y`)
      expect([min >= 200, max <= 300, bound.view?.y]).toEqual([true, true, [200, 300]])
      props_unchanged()
    },
  )

  // The frame owns legend dragging: a dropped legend keeps the drop position and leaves solver
  // ownership (no data-decoration-* stamps). The drag measures the legend and the SVG once at
  // grab time (2 rect reads), never per mousemove, so dragging doesn't force a reflow per frame
  test.each(frame_charts)(`$name legend drag pins it where it was dropped`, async (chart) => {
    await mount_chart(chart, { ...chart.props(), show_legend: true })
    const legend = doc_query(`.legend`)
    expect(legend.getAttribute(`data-decoration-x`)).not.toBeNull()
    const rect_spy = vi.spyOn(Element.prototype, `getBoundingClientRect`)
    const offset_spy = vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`)
    // jsdom reports zero-origin rects, so the drop lands at cursor minus the grab offset
    legend.dispatchEvent(
      new MouseEvent(`mousedown`, { bubbles: true, clientX: 100, clientY: 50 }),
    )
    for (let step = 1; step <= 20; step++) {
      // primary button held: a bare move ends the drag
      const [clientX, clientY] = [100 + step * 10, 50 + step * 7.5]
      window.dispatchEvent(new MouseEvent(`mousemove`, { buttons: 1, clientX, clientY }))
      flushSync()
    }
    window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: 300, clientY: 200 }))
    await tick()
    expect([rect_spy.mock.calls.length, offset_spy.mock.calls.length]).toEqual([2, 0])
    const pinned = doc_query(`.legend`)
    expect([pinned.style.left, pinned.style.top]).toEqual([`200px`, `150px`])
    expect(pinned.getAttribute(`data-decoration-x`)).toBeNull()
  })

  // A pan holds the decoration layout like a legend drag: re-solving per frame rebuilt the
  // obstacle field from every mark only to move the legend under the cursor. Its end re-solves,
  // as does a resize mid-pan (the frame's own geometry moved, so the held pad no longer fits).
  test.each(frame_charts)(
    `$name pan holds the legend until the gesture ends`,
    async (chart) => {
      const root = await mount_chart(chart, { ...chart.props(), show_legend: true })
      const svg = doc_query(`svg[role="application"]`)
      const solves = vi.mocked(solve_decorations)
      const pan_event = (step: number, buttons = 1): MouseEventInit => ({
        bubbles: true,
        buttons,
        shiftKey: true,
        clientX: 200 + step * 10,
        clientY: 150 + step * 5,
      })
      svg.dispatchEvent(new PointerEvent(`pointerdown`, pan_event(0)))
      solves.mockClear()
      const axis_before = svg.querySelector(`.x-axis`)?.innerHTML
      for (let step = 1; step <= 5; step++) {
        svg.dispatchEvent(new PointerEvent(`pointermove`, pan_event(step)))
        flushSync()
      }
      // it panned, without solving the layout once
      expect(svg.querySelector(`.x-axis`)?.innerHTML).not.toBe(axis_before)
      expect(solves).not.toHaveBeenCalled()
      await resize_element(root, 520, 380)
      trigger_resize_observer(root)
      flushSync()
      expect(solves.mock.calls.length).toBeGreaterThan(0)
      solves.mockClear()
      svg.dispatchEvent(new PointerEvent(`pointerup`, pan_event(5, 0)))
      flushSync()
      expect(solves.mock.calls.length).toBeGreaterThan(0)
    },
  )

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
          legend: null, // else a legend moving outside changes the bottom band too
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
          (element) => !element.classList.contains(`hidden`),
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
      // at 400px every interior spot for the legend covers one of the Histogram's edge bins
      const sparse = await mount_chart(
        chart,
        { ...chart.props(), show_legend: true, legend: {} },
        { width: 800 },
      )
      expect(legend_outside(sparse)).toBe(false)
      // an interior legend scrolls rather than outgrow the plot
      expect(query(sparse, `.legend`).getAttribute(`style`)).toMatch(
        /max-height: min\(var\(--plot-legend-max-height, 80%\), [\d.]+px\)/,
      )
      const dense = await mount_chart(chart, {
        ...chart.dense_props(),
        show_legend: true,
        legend: {},
      })
      expect(legend_outside(dense)).toBe(true)
    },
  )

  test.each(frame_charts)(
    `$name keeps automatic legends clear of marginal strips`,
    async (chart) => {
      vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(120)
      vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(44)
      for (const placement of [`auto`, `flush`, `outer`] as const) {
        for (const dense of [false, true]) {
          const plot = await mount_chart(
            chart,
            {
              ...(dense ? chart.dense_props() : chart.props()),
              show_legend: true,
              legend: {},
              marginals: Object.fromEntries(
                [`top`, `right`, `bottom`, `left`].map((side) => [
                  side,
                  { type: `cdf`, size: 60, placement },
                ]),
              ),
            },
            { width: 800, height: 600 },
          )
          const legend = {
            x: legend_px(plot, `left`),
            y: legend_px(plot, `top`),
            width: 120,
            height: 44,
          }
          if (!dense) expect(rect_within_rect(legend, clip_rect(plot))).toBe(true)
          const strips = plot.querySelectorAll(`.marginal-hit`)
          expect(strips).toHaveLength(4)
          for (const strip of strips) {
            expect(
              rects_overlap(legend, svg_rect(strip)),
              `${placement}, dense=${dense}`,
            ).toBe(false)
          }
        }
      }
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
        // to 1e-9 px: the pads summed in another order differ in the last ulp
        expect(legend_px(plot, `left`)).toBeCloseTo(clip.x + (clip.width - 180) / 2, 9)
      }
      expect(legend_px(wide, `left`)).toBeGreaterThan(legend_px(small, `left`))
      expect(clip_rect(repeated)).toEqual(clip_rect(wide))
    },
  )

  // A default legend too wide to sit beside the plot (300px cells) wraps into a row below it,
  // at the width its cells wrap into; an explicit layout keeps its grid and rendered box
  test.each(frame_charts)(
    `$name wraps a default legend below the plot into a row`,
    async (chart) => {
      vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(180)
      vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(44)
      vi.spyOn(Element.prototype, `getBoundingClientRect`).mockImplementation(function (
        this: Element,
      ) {
        return DOMRect.fromRect({ width: 300, height: this.matches(`.legend-item`) ? 20 : 0 })
      })
      const mount_legend = async (legend: object) => {
        const props = { ...chart.dense_props(), show_legend: true, legend }
        // tall enough for BoxPlot's 24 one-per-line items to leave 80px of plot (outside.ts)
        return query(await mount_chart(chart, props, { width: 400, height: 700 }), `.legend`)
      }
      const wrapped = await mount_legend({})
      expect([wrapped.className.includes(`wrap`), wrapped.dataset.decorationSide]).toEqual([
        true,
        `bottom`,
      ])
      expect(wrapped.style.width).toBe(`${wrapped.dataset.decorationWidth}px`)
      const gridded = await mount_legend({ layout: `vertical` })
      expect(gridded.className).not.toContain(`wrap`)
      expect(gridded.dataset.decorationWidth).toBe(`180`)
    },
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

  // Explicit top/right padding is kept, not overridden by the secondary axes' auto-padding
  test.each(frame_charts)(
    `$name renders labelled secondary axes inside explicit padding, y2 title centred on y's`,
    async (chart) => {
      const plot = await mount_chart(chart, {
        ...chart.secondary_props([100, 200, 300]),
        padding: { r: 10, t: 10 },
        y_axis: { label: `Primary` },
        y2_axis: { label: `Secondary` },
        x2_axis: { label: `Top` },
      })
      const clip = clip_rect(plot)
      expect(400 - clip.x - clip.width).toBe(10)
      expect(clip.y).toBe(10)
      for (const axis of chart.secondary_axes) {
        expect(plot.querySelector(`g.${axis}-axis`)).toBeInstanceOf(SVGGElement)
      }
      expect(plot.querySelector(`.x2-label`)?.textContent ?? null).toBe(
        chart.secondary_axes.includes(`x2`) ? `Top` : null,
      )
      expect(plot.querySelector(`.y2-label`)?.textContent).toBe(`Secondary`)
      // both y titles rotate about the plot's vertical center
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

  // A synced y2 copies y's range, so y's auto range must span the y2 data (100x the y data)
  test.each(frame_charts)(`$name synced y2 range covers the y2 data`, async (chart) => {
    // Histogram's y axes count values, so pile the y2 values into one 300-count bin
    const values = chart.name === `Histogram` ? Array(300).fill(2) : [100, 200, 300]
    const props = chart.secondary_props(values)
    // drop the x2 series, which Histogram also counts on y
    const series = (props.series as { label: string }[]).filter(({ label }) => label !== `X2`)
    const plot = await mount_chart(chart, { ...props, series, y2_axis: { sync: `synced` } })
    const tick_values = (axis: `y` | `y2`): number[] =>
      [...plot.querySelectorAll(`g.${axis}-axis g.tick text`)].map((text) =>
        Number(text.textContent),
      )
    expect(Math.max(...tick_values(`y`))).toBeGreaterThanOrEqual(200)
    expect(tick_values(`y2`)).toEqual(tick_values(`y`))
  })

  // shared_xy_range gives x and y one range: the union of both auto ranges, pins on either
  // axis pinning both; pan/zoom stays per axis and a reset returns to the shared range
  const parity_series = (scale: `linear` | `log`) =>
    scale === `log` ? { x: [1, 10, 30], y: [0.2, 4, 90] } : { x: [0, 5, 10], y: [-6, 1, 3] }
  test.each([
    { scale: `linear`, pins: {}, lower: -6, upper: 10 },
    { scale: `linear`, pins: { x_axis: { range: [-20, null] } }, lower: -20, upper: 10 },
    { scale: `linear`, pins: { y_axis: { range: [null, 50] } }, lower: -6, upper: 50 },
    // a pin inside the other axis's data still pins both
    { scale: `linear`, pins: { x_axis: { range: [null, 2] } }, lower: -6, upper: 2 },
    { scale: `log`, pins: {}, lower: 0.2, upper: 90 },
  ] as const)(
    `ScatterPlot shared_xy_range on $scale axes with pins $pins`,
    async ({ scale, pins, lower, upper }) => {
      const pin_of = (axis_name: `x_axis` | `y_axis`) =>
        (pins as Partial<Record<string, AxisConfig>>)[axis_name]
      // each mount gets its own `view`: a shared one would hand the first plot's view on
      const mount_view = async (shared_xy_range: boolean) => {
        const bound = $state<{ view?: Partial<AxisRanges> }>({ view: undefined })
        const axis = (axis_name: `x_axis` | `y_axis`) => ({
          scale_type: scale,
          ...pin_of(axis_name),
        })
        const props = {
          series: [{ ...parity_series(scale), markers: `points` as const }],
          x_axis: axis(`x_axis`),
          y_axis: axis(`y_axis`),
          shared_xy_range,
        }
        const plot = await mount_sized(ScatterPlot, bind_props(props, bound), {
          selector: `.scatter`,
        })
        return { plot, bound }
      }
      const own = (await mount_view(false)).bound.view
      expect(own?.x).not.toEqual(own?.y)
      const { plot, bound } = await mount_view(true)
      const { x, y } = bound.view ?? {}
      if (!x) throw new Error(`no view mirrored`)
      expect(y).toEqual(x)
      // pinned bounds land exactly, auto ones cover the data of both axes
      expect([x[0] <= lower, x[1] >= upper]).toEqual([true, true])
      for (const [bound_idx, axis_name] of [
        [0, `x_axis`],
        [1, `y_axis`],
      ] as const) {
        const pin = pin_of(axis_name)?.range?.[bound_idx]
        if (pin != null) expect(x[bound_idx]).toBe(pin)
      }
      if (scale === `log`) expect(x[0]).toBeGreaterThan(0)
      // a rect zoom moves each axis on its own, a reset restores the shared range
      const clip = clip_rect(plot)
      const at = (frac_x: number, frac_y: number): Vec2 => [
        clip.x + clip.width * frac_x,
        clip.y + clip.height * frac_y,
      ]
      const svg = query(plot, `svg[role="application"]`)
      await drag(svg, {}, at(0.1, 0.2), at(0.6, 0.4))
      expect(bound.view?.x).not.toEqual(bound.view?.y)
      svg.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
      await tick()
      expect([bound.view?.x, bound.view?.y]).toEqual([x, x])
    },
  )

  // nice: false shares the padded data ends instead of whole decades ([0.1, 1000] here);
  // line-only series reach no further than their points, so no marker padding is added
  test(`ScatterPlot log-log shared_xy_range with nice: false spans the padded data`, async () => {
    const bound = $state<{ view?: Partial<AxisRanges> }>({ view: undefined })
    const axis = { scale_type: `log` as const, nice: false }
    const [xs, ys] = [
      [1, 10, 30],
      [0.2, 4, 90],
    ]
    const props = {
      series: [{ x: xs, y: ys, markers: `line` as const }],
      x_axis: axis,
      y_axis: axis,
      range_padding: 0.1,
      shared_xy_range: true,
    }
    await mount_sized(ScatterPlot, bind_props(props, bound), { selector: `.scatter` })
    const padded = (values: number[]): Vec2 => {
      const [lower, upper] = [Math.min(...values), Math.max(...values)].map(Math.log10)
      const pad = (upper - lower) * 0.1
      return [10 ** (lower - pad), 10 ** (upper + pad)]
    }
    const [x_padded, y_padded] = [padded(xs), padded(ys)]
    const expected = [Math.min(x_padded[0], y_padded[0]), Math.max(x_padded[1], y_padded[1])]
    expect([bound.view?.x, bound.view?.y]).toEqual([expected, expected])
  })

  // A facet grid reconciles each axis across panels, which would undo the sharing
  test.each([
    [`ScatterPlot`, ScatterPlot],
    [`BinnedScatterPlot`, BinnedScatterPlot],
  ] as [string, unknown][])(
    `%s shared_xy_range throws inside a facet grid`,
    (_name, component) => {
      const facet_layout = {
        padding: {},
        ranges: {},
        axis_visibility: {},
        report_layout: () => {},
        update_range: () => {},
      }
      const props = { series: [{ x: [0, 1], y: [2, 3] }], facet_layout, shared_xy_range: true }
      // the range sync runs in a post effect, so flush it inside the assertion
      const chart = component as Component<typeof props>
      expect(() => flushSync(() => mount_in_test(chart, props))).toThrow(
        /not supported in facet grids/,
      )
    },
  )

  // BinnedScatterPlot has no `view`, so compare where each axis places its ticks: one range
  // puts a value at the same fraction along both axes
  test(`BinnedScatterPlot shared_xy_range spans x and y over one range`, async () => {
    const tick_fracs = (plot: HTMLElement, axis: `x` | `y`): Map<number, number> => {
      const clip = clip_rect(plot)
      const entries = [...plot.querySelectorAll(`g.${axis}-axis g.tick`)].map((tick_el) => {
        const value = Number(tick_el.textContent?.trim().replace(`\u2212`, `-`))
        const [pos_x, pos_y] = (tick_el.getAttribute(`transform`) ?? ``)
          .match(/-?[\d.]+/g)
          ?.map(Number) ?? [NaN, NaN]
        const frac =
          axis === `x`
            ? (pos_x - clip.x) / clip.width
            : (clip.y + clip.height - pos_y) / clip.height
        return [value, frac] as const
      })
      return new Map(entries)
    }
    const mount_binned = async (shared_xy_range: boolean) => {
      const plot = await mount_sized(
        BinnedScatterPlot,
        { series: [{ x: [0, 5, 10], y: [-6, 1, 3] }], color_bar: null, shared_xy_range },
        { selector: `.binned-scatter`, width: 400, height: 400 },
      )
      const [x_fracs, y_fracs] = [tick_fracs(plot, `x`), tick_fracs(plot, `y`)]
      const common = [...x_fracs.keys()].filter((value) => y_fracs.has(value))
      return { x_fracs, y_fracs, common }
    }
    const own = await mount_binned(false)
    expect(own.common.some((value) => own.x_fracs.get(value) !== own.y_fracs.get(value))).toBe(
      true,
    )
    const shared = await mount_binned(true)
    expect(shared.common.length).toBeGreaterThanOrEqual(2)
    for (const value of shared.common) {
      expect(shared.y_fracs.get(value), `tick ${value}`).toBeCloseTo(
        shared.x_fracs.get(value) ?? NaN,
        6,
      )
    }
    // the shared range reaches y's low data end on x too
    expect(Math.min(...shared.x_fracs.keys())).toBeLessThanOrEqual(-4)
  })

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
    expect(400 - clip.x - clip.width).toBe(AXIS_LABEL_HEIGHT + Y_TITLE_EDGE_AIR)
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
      const y_input = doc_query<HTMLInputElement>(`input[aria-label="Y axis tick count"]`)
      // From a sparse count up: Histogram's integer count axis has only so many integers
      const tick_count_for = async (count: number): Promise<number> => {
        set_input(y_input, `${count}`)
        await tick()
        return plot.querySelectorAll(`g.y-axis .tick`).length
      }
      const sparse = await tick_count_for(2)
      expect(sparse).toBeGreaterThan(0)
      expect(await tick_count_for(10)).toBeGreaterThan(sparse)
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
  // from the category names, not the integer slot indices behind them
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
      const [behind, front] = [`behind`, `front`].map((text) => annotation_of(plot, text))
      expect([behind, front].map(inside_clip_path)).toEqual([false, false])
      // document order encodes paint order: below-lines < marks < above-all
      const marks = query(plot, `svg ${chart.series_selector}`)
      expect(
        marks.compareDocumentPosition(behind) & Node.DOCUMENT_POSITION_PRECEDING,
      ).not.toBe(0)
      expect(marks.compareDocumentPosition(front) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      )
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
  test.each(
    colorbar_charts.flatMap((chart) =>
      [undefined, 20].map((axis_clearance) => ({ ...chart, axis_clearance })),
    ),
  )(
    `$name keeps overflowing colorbar ticks clear of the plot axes (axis_clearance=$axis_clearance)`,
    async ({ axis_clearance, ...chart }) => {
      vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(220)
      vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(30)
      vi.spyOn(Element.prototype, `getBoundingClientRect`).mockImplementation(function (
        this: Element,
      ): DOMRect {
        if (this.classList.contains(`tick-label`)) {
          return DOMRect.fromRect({ x: 90, y: 128, width: 240, height: 18 })
        }
        return DOMRect.fromRect({ x: 100, y: 100, width: 220, height: 30 })
      })
      const plot = await mount_chart(
        chart,
        { ...chart.props(), color_bar: { axis_clearance } },
        { width: 800, height: 600 },
      )
      const clearance = axis_clearance ?? COLOR_BAR_DEFAULTS.axis_clearance
      await vi.waitFor(() => {
        const colorbar = doc_query(`.colorbar-wrapper`)
        const [coord_x, coord_y, width, height] = [`x`, `y`, `width`, `height`].map((key) =>
          Number(colorbar.getAttribute(`data-decoration-${key}`)),
        )
        const area = clip_rect(plot)
        expect({ width, height }).toEqual({ width: 240, height: 46 })
        expect(coord_x).toBeGreaterThanOrEqual(area.x + clearance)
        expect(coord_y).toBeGreaterThanOrEqual(area.y + clearance)
        expect(coord_x + width).toBeLessThanOrEqual(area.x + area.width - clearance)
        expect(coord_y + height).toBeLessThanOrEqual(area.y + area.height - clearance)
        expect(Math.min(coord_x - area.x, area.x + area.width - (coord_x + width))).toBe(
          clearance,
        )
        expect(Number(colorbar.style.left.replace(`px`, ``))).toBe(coord_x + 10)
      })
    },
  )

  // Any user wrapper_style replaces the solver's position: a solver `left` written alongside
  // a `right` pin stretched the bar across the plot, and BinnedScatterPlot used to forward
  // the style to the inner ColorBar so the bar could not be pinned at all
  test.each(colorbar_charts)(
    `$name pins its colorbar with color_bar.wrapper_style`,
    async (chart) => {
      const plot = await mount_chart(chart, {
        ...chart.props(),
        color_bar: {
          wrapper_style: `position: absolute; right: 9px; top: 17px;`,
          bar_style: `width: 14px; height: 160px;`,
          axis_clearance: 20,
          responsive: true,
        },
      })
      const wrapper = query(plot, `.colorbar-wrapper`)
      const { left, right, top } = wrapper.style
      expect([left, right, top]).toEqual([``, `9px`, `17px`])
      expect(wrapper.getAttribute(`data-decoration-x`)).toBeNull()
      // the pinned bar fills its wrapper; decoration-only keys never reach ColorBar's div
      const bar_wrapper = query(wrapper, `.colorbar`)
      const { width, height, right: bar_right } = bar_wrapper.style
      expect([width, height, bar_right]).toEqual([`100%`, `100%`, ``])
      const attr_names = bar_wrapper.getAttributeNames()
      expect(
        attr_names.filter((name) => [`axis_clearance`, `responsive`].includes(name)),
      ).toEqual([])
      const bar = query(wrapper, `.colorbar .bar`)
      expect([bar.style.width, bar.style.height]).toEqual([`14px`, `160px`])
    },
  )
})

// `never` drops the caller's buttons and the export pane, still tells the controls snippet it
// is hidden, and keeps the button of an active fullscreen (hidden) so it can still exit
test.each([
  [`always`, false, [`320x200`, true, `true`, `shown`]],
  [{ hidden: [`fullscreen`] }, false, [`320x200`, true, `true`, null]],
  [`never`, false, [null, false, `false`, null]],
  [`never`, true, [null, false, `false`, `hidden`]],
] as const)(
  `ChartHeaderControls show_controls=%j fullscreen=%s`,
  (show_controls, fullscreen, expected) => {
    const target = mount_in_test(ChartHeaderControls, {
      dims: { width: 320, height: 200, fullscreen },
      fullscreen,
      css_prefix: `scatter`,
      show_controls,
      header_controls: createRawSnippet((dims: () => { width: number; height: number }) => ({
        render: () => `<span class="custom">${dims().width}x${dims().height}</span>`,
      })),
      export_pane: {
        children: createRawSnippet(() => ({ render: () => `<p>extra export</p>` })),
      },
      controls: createRawSnippet((_toggle: () => PaneToggleProps, visible: () => boolean) => ({
        render: () => `<i class="controls" data-visible="${visible()}"></i>`,
      })),
    })
    const row = query(target, `.header-controls`)
    const fullscreen_btn = row.querySelector<HTMLButtonElement>(`.fullscreen-btn`)
    expect([
      row.querySelector(`.custom`)?.textContent ?? null,
      row.querySelector(`button.export-toggle`) !== null,
      query(row, `.controls`).dataset.visible,
      fullscreen_btn && (fullscreen_btn.hidden ? `hidden` : `shown`),
    ]).toEqual(expected)
  },
)

test(`create_placed_tween re-places and re-observes as descendants come and go`, async () => {
  const observed = new Set<Element>()
  onTestFinished(() => void vi.unstubAllGlobals())
  vi.stubGlobal(
    `ResizeObserver`,
    class {
      observe = (target: Element): void => void observed.add(target)
      unobserve = (target: Element): void => void observed.delete(target)
      disconnect(): void {}
    },
  )
  const decoration = document.createElement(`div`)
  let placement_x = 10
  let placed_tween: ReturnType<typeof create_placed_tween> | undefined
  const dispose = $effect.root(() => {
    placed_tween = create_placed_tween({
      placement: () => ({ x: placement_x, y: 0 }),
      dims: () => ({ width: 100, height: 100 }),
      responsive: () => false,
      element: () => decoration,
      tween: () => ({ duration: 0 }),
    })
  })
  flushSync()
  const tick_label = document.createElement(`span`)
  // a label appearing or leaving (without resizing the wrapper) changes the footprint
  for (const [x_pos, mutate, is_observed] of [
    [30, () => decoration.append(tick_label), true],
    [50, () => tick_label.remove(), false],
  ] as const) {
    placement_x = x_pos
    mutate()
    await vi.waitFor(() => expect(observed.has(tick_label)).toBe(is_observed))
    flushSync()
    expect(placed_tween?.coords.target).toEqual({ x: x_pos, y: 0 })
  }
  dispose()
})
