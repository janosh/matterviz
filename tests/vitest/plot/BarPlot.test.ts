import { BarPlot } from '$lib'
import type { BarHandlerProps, BarSeries } from '$lib/plot'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { axis_label_pivot_y, inside_clip_path, mount_sized } from '../setup'

const basic: BarSeries = {
  x: [1, 2, 3, 4, 5],
  y: [10, 20, 15, 25, 18],
  label: `Test Series`,
  color: `steelblue`,
}

const mount_sized_bar_plot = (
  props: Partial<ComponentProps<typeof BarPlot>>,
): Promise<HTMLElement> => mount_sized(BarPlot, props, { selector: `.bar-plot` })

describe(`BarPlot`, () => {
  test.each([
    {
      name: `empty data`,
      series: [],
      expected_series: 0,
      expected_bars: 0,
    },
    {
      name: `all-negative values`,
      series: [{ x: [1, 2, 3, 4], y: [-10, -20, -15, -25] }],
      expected_series: 1,
      expected_bars: 4,
    },
    {
      name: `hidden series`,
      series: [
        basic,
        { ...basic, color: `orangered`, visible: false },
        { ...basic, color: `green` },
      ],
      expected_series: 2,
      expected_bars: 10,
    },
  ] satisfies {
    name: string
    series: BarSeries[]
    expected_series: number
    expected_bars: number
  }[])(`renders $name`, async ({ series, expected_series, expected_bars }) => {
    const plot = await mount_sized_bar_plot({ series })
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(expected_series)
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(expected_bars)
  })

  test.each([`vertical`, `horizontal`] as const)(
    `omits zero-valued bars in %s orientation`,
    async (orientation) => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [1, 2, 3], y: [-5, 0, 5] }],
        orientation,
      })
      expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(2)
    },
  )

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [
        basic,
        {
          x: [100, 200, 300],
          y: [5, 15, 25],
          x_axis: `x2`,
          label: `X2 Series`,
          color: `orangered`,
        },
      ],
      x2_axis: { label: `Temperature (K)` },
    })
    expect(plot.querySelector(`g.x2-axis`)).toBeInstanceOf(SVGGElement)
    expect(plot.querySelector(`.x2-label`)?.textContent).toBe(`Temperature (K)`)
  })

  test(`y2 axis title shares the y axis title's vertical center`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic, { x: [1, 2, 3], y: [100, 200, 300], label: `Sec`, y_axis: `y2` }],
      y_axis: { label: `Primary` },
      y2_axis: { label: `Secondary` },
    })
    // both y titles rotate about the plot's vertical center; a stale label_shift default
    // used to push the y2 title 60px below center
    const pivot_y = (selector: string) => axis_label_pivot_y(plot, selector)
    expect(pivot_y(`.axis-label.y2-label`)).toBeCloseTo(pivot_y(`.axis-label.y-label`), 5)
  })

  test(`explicit top/right padding is not overridden by secondary-axis auto-padding`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [
        basic,
        { ...basic, label: `Y2`, y_axis: `y2` },
        { ...basic, label: `X2`, x_axis: `x2` },
      ],
      padding: { r: 10, t: 10 },
      x2_axis: { label: `Top` },
      y2_axis: { label: `Secondary` },
    })
    const clip_rect = plot.querySelector(`clipPath rect`)
    expect(Number(clip_rect?.getAttribute(`width`))).toBe(330)
    expect(Number(clip_rect?.getAttribute(`y`))).toBe(10)
  })

  test(`title-only y2 axis expands right padding`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic, { ...basic, label: `Y2`, y_axis: `y2` }],
      y_axis: { ticks: [] },
      y2_axis: { label: `Secondary`, ticks: [] },
    })
    expect(Number(plot.querySelector(`clipPath rect`)?.getAttribute(`width`))).toBe(308)
  })

  test(`default padding grows for wide y-axis ticks`, async () => {
    const context_spy = vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
      font: ``,
      measureText: () => ({ width: 120 }),
    } as unknown as CanvasRenderingContext2D)
    try {
      const plot = await mount_sized_bar_plot({
        series: [basic],
        y_axis: { label: `Value` },
      })
      expect(Number(plot.querySelector(`clipPath rect`)?.getAttribute(`x`))).toBeGreaterThan(
        60,
      )
    } finally {
      context_spy.mockRestore()
    }
  })

  test(`horizontal grouped mode renders all bars`, async () => {
    const series = [basic, { ...basic, color: `orangered` }]
    const plot = await mount_sized_bar_plot({
      series,
      orientation: `horizontal`,
      mode: `grouped`,
    })
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(2)
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(10)
  })

  test(`line markers render zero-valued color and size inputs`, async () => {
    // Regression: .filter(Boolean) incorrectly removed 0 from auto-range calculation
    // Zero is a valid value for color/size scales (e.g. minimum on a gradient)
    const plot = await mount_sized_bar_plot({
      series: [
        {
          ...basic,
          render_mode: `line`,
          markers: `line+points`,
          color_values: [0, 0.25, 0.5, 0.75, 1],
          size_values: [0, 5, 10, 15, 20],
        },
      ],
    })
    expect(plot.querySelectorAll(`.line-series`)).toHaveLength(1)
    const markers = [...plot.querySelectorAll(`.line-points .marker`)]
    expect(markers).toHaveLength(5)
    expect(markers.every((marker) => !marker.getAttribute(`d`)?.includes(`NaN`))).toBe(true)
  })

  test(`mixed bar and line series`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [
        basic,
        {
          x: [1, 2, 3, 4, 5],
          y: [12, 18, 20, 22, 16],
          render_mode: `line` as const,
          line_style: { stroke_width: 3, line_dash: `5,5` },
        },
      ],
      mode: `stacked`,
    })
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(1)
    expect(plot.querySelectorAll(`.line-series`)).toHaveLength(1)
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(5)
  })

  test(`stacked mode keys offsets by x value for misaligned series grids`, async () => {
    // Regression test: offsets accumulated per array index stacked B's x=4 bar on A's x=3 total
    const plot = await mount_sized_bar_plot({
      series: [
        { x: [1, 2, 3], y: [10, 20, 30] },
        { x: [2, 3, 4], y: [5, 5, 5] },
      ],
      mode: `stacked`,
      bar: { border_radius: 0 }, // square corners -> parseable `M x,y h w v h` paths
    })
    // Parse a series' rect paths into { top, bottom } screen coords
    const rects = (idx: number) =>
      Array.from(
        plot.querySelectorAll(`.bar-series[data-series-idx="${idx}"] path[role="button"]`),
        (path) => {
          const [, y_str, h_str] =
            path.getAttribute(`d`)?.match(/^M[\d.-]+,(?<y>[\d.-]+)h[\d.-]+v(?<h>[\d.-]+)/) ??
            []
          return { top: Number(y_str), bottom: Number(y_str) + Number(h_str) }
        },
      )
    const [a_rects, b_rects] = [rects(0), rects(1)]
    expect([a_rects.length, b_rects.length]).toEqual([3, 3])
    // B bars at x=2,3 sit on top of A bars at x=2,3 (B bottom == A top)
    expect(b_rects[0].bottom).toBeCloseTo(a_rects[1].top, 4)
    expect(b_rects[1].bottom).toBeCloseTo(a_rects[2].top, 4)
    // B bar at x=4 has no A bar below it -> starts at baseline 0 (same bottom as A bars)
    expect(b_rects[2].bottom).toBeCloseTo(a_rects[0].bottom, 4)
  })

  test(`default tooltip shows series label for multi-series on hover`, async () => {
    const series_a: BarSeries = { x: [1, 2], y: [10, 20], label: `Group A`, color: `red` }
    const series_b: BarSeries = { x: [1, 2], y: [5, 15], label: `Group B`, color: `blue` }
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [series_a, series_b],
        x_axis: { label: `X` },
        y_axis: { label: `Count` },
      },
    })
    await tick()
    const bar = document.querySelector(`path[role="button"]`)
    expect(bar).toBeInstanceOf(SVGPathElement)
    bar?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    const text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    expect(text).toContain(`Group A`)
    expect(text).toContain(`Count`)
  })

  test(`custom tooltip snippet`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic],
      tooltip: createRawSnippet<[BarHandlerProps]>((data) => ({
        render: () => `<div class="custom-tooltip">x: ${data().x}, y: ${data().y}</div>`,
      })),
    })
    const first_bar = plot.querySelector(`path[role="button"]`)
    expect(first_bar).toBeInstanceOf(SVGPathElement)
    first_bar?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    expect(plot.querySelector(`.custom-tooltip`)?.textContent).toBe(`x: 1, y: 10`)
  })

  test(`children prop`, () => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic],
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-bar-child">Custom bar overlay</div>`,
        })),
      },
    })
    expect(document.querySelector(`.custom-bar-child`)?.textContent).toBe(`Custom bar overlay`)
  })

  describe(`categorical bar charts`, () => {
    const cat_series: BarSeries[] = [
      { x: [`A`, `B`, `C`], y: [10, 20, 30], label: `S1`, color: `blue` },
      { x: [`B`, `C`, `D`], y: [5, 15, 25], label: `S2`, color: `red` },
    ]

    test.each([
      [`overlay mode`, { mode: `overlay` }],
      [`stacked mode`, { mode: `stacked` }],
      [`grouped mode`, { mode: `grouped` }],
      [`horizontal orientation`, { orientation: `horizontal` }],
    ] as const)(`renders misaligned categories in %s`, async (_name, props) => {
      const plot = await mount_sized_bar_plot({ series: cat_series, ...props })
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(2)
      expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(6)
    })

    // every category renders a bar; x-axis ticks thin only when labels can't fit the
    // 400px axis at ~28px each (3 fit untouched, 30 thin to every ~3rd category)
    test.each([
      { desc: `few categories keep every tick`, n_cats: 3, min_ticks: 3, max_ticks: 3 },
      { desc: `many categories thin the ticks`, n_cats: 30, min_ticks: 3, max_ticks: 14 },
    ])(
      `single categorical series renders every bar ($desc)`,
      async ({ n_cats, min_ticks, max_ticks }) => {
        const cats = Array.from({ length: n_cats }, (_cat, idx) => `cat${idx}`)
        const plot = await mount_sized_bar_plot({
          series: [{ x: cats, y: cats.map((_cat, idx) => idx + 1), color: `blue` }],
        })
        expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(n_cats)
        const tick_count = plot.querySelectorAll(`g.x-axis g.tick`).length
        expect(tick_count).toBeGreaterThanOrEqual(min_ticks)
        expect(tick_count).toBeLessThanOrEqual(max_ticks)
      },
    )

    // categorical ticks are generated for every category regardless of the view, so
    // a panned/zoomed range must cull the ones that fall outside the plot area
    test(`ticks panned outside the plot area are culled`, async () => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [`A`, `B`, `C`, `D`, `E`], y: [1, 2, 3, 4, 5], color: `blue` }],
        x_axis: { range: [1.5, 3.5] }, // panned view: only C and D remain in range
      })
      const labels = [...plot.querySelectorAll(`g.x-axis g.tick text`)].map((el) =>
        el.textContent?.trim(),
      )
      expect(labels).toEqual([`C`, `D`])
    })

    test(`hover reports category_label + metadata and tooltip shows the category name`, async () => {
      const hover_fn = vi.fn()
      mount(BarPlot, {
        target: document.body,
        props: {
          series: [
            {
              x: [`Alpha`, `Beta`, `Gamma`],
              y: [10, 20, 30],
              color: `blue`,
              metadata: [{ id: 1 }, { id: 2 }, { id: 3 }],
            },
          ],
          x_axis: { label: `Greek` },
          on_bar_hover: hover_fn,
          style: `width: 400px; height: 300px`,
        },
      })
      await tick()
      const bar = document.querySelector(`path[role="button"]`)
      if (!bar) throw new Error(`bar element not found`)
      bar.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
      await tick()
      expect(hover_fn).toHaveBeenCalled()
      const data = hover_fn.mock.calls[0][0]
      expect(data.category_label).toBe(`Alpha`)
      expect(data.metadata).toEqual({ id: 1 })
      // tooltip shows the category name, not its numeric index
      const tooltip_text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
      expect(tooltip_text).toContain(`Alpha`)
      expect(tooltip_text).not.toMatch(/\b0\b/)
    })
  })

  const multi_series = [basic, { ...basic, color: `orangered`, label: `S2` }]

  test.each([
    {
      props: { series: multi_series, show_legend: false },
      visible: false,
      label: `hidden when show_legend=false`,
    },
    {
      props: { series: multi_series, show_legend: true },
      visible: true,
      label: `visible when show_legend=true`,
    },
    {
      props: { series: multi_series },
      visible: true,
      label: `auto-shows for multiple series`,
    },
    {
      props: { series: multi_series, legend: null },
      visible: false,
      label: `hidden when null`,
    },
    { props: { series: [basic] }, visible: false, label: `auto-hides for single series` },
  ])(`legend $label`, async ({ props, visible }) => {
    mount(BarPlot, { target: document.body, props })
    await tick()
    const legend = document.querySelector(`.legend`)
    if (visible) expect(legend).toBeInstanceOf(HTMLElement)
    else expect(legend).toBeNull()
  })

  describe(`legend grouping`, () => {
    const grouped_series: BarSeries[] = [
      {
        x: [1, 2, 3],
        y: [10, 20, 15],
        label: `PBE`,
        legend_group: `DFT`,
        color: `blue`,
      },
      {
        x: [1, 2, 3],
        y: [12, 18, 17],
        label: `LDA`,
        legend_group: `DFT`,
        color: `lightblue`,
      },
      {
        x: [1, 2, 3],
        y: [11, 19, 16],
        label: `MACE`,
        legend_group: `ML`,
        color: `red`,
      },
      {
        x: [1, 2, 3],
        y: [10.5, 20.5, 15.5],
        label: `Experiment`,
        color: `green`,
      },
    ]

    test.each([
      [`grouped`, [`DFT`, `ML`]],
      [`overlay`, [`Experiment`]],
    ] as const)(`renders grouped + ungrouped series in %s mode`, async (mode, labels) => {
      const plot = await mount_sized_bar_plot({ series: grouped_series, mode })
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(4)
      for (const label of labels) expect(plot.textContent).toContain(label)
    })
  })

  test(`legend auto-moves to the bottom margin when bars fill the plot`, async () => {
    // many full-height bars across the width -> no interior spot avoids overlap so the legend must
    // drop into the reserved bottom margin
    const cats = Array.from({ length: 30 }, (_, idx) => idx)
    await mount_sized_bar_plot({
      series: [
        { x: cats, y: cats.map(() => 100), label: `A` },
        { x: cats, y: cats.map(() => 100), label: `B` },
      ],
      legend: {},
      show_legend: true,
    })
    await tick()
    const legend = document.querySelector<HTMLElement>(`.legend`)
    expect(legend).toBeInstanceOf(HTMLElement)
    // interior default is top-left (~pad.t + 10); auto-outside drops it well into the lower half
    expect(Number(legend?.style.top.replace(`px`, ``) ?? `0`)).toBeGreaterThan(150)
  })

  // double-clicking a legend item isolates that series (shared helper, same as
  // ScatterPlot); a second double-click restores the previous visibility
  test(`legend double-click isolates a series and restores on repeat`, async () => {
    const series = [basic, { ...basic, label: `Other`, color: `tomato` }]
    const plot = await mount_sized_bar_plot({ series, show_legend: true })
    const visible_states = () =>
      [...plot.querySelectorAll(`.legend-item`)].map((el) => !el.classList.contains(`hidden`))
    expect(visible_states()).toEqual([true, true])
    const dblclick = () =>
      plot
        .querySelector(`.legend-item`)
        ?.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    dblclick()
    await tick()
    expect(visible_states()).toEqual([true, false]) // isolated
    dblclick()
    await tick()
    expect(visible_states()).toEqual([true, true]) // restored
  })

  // ref-line annotations must render outside the chart clip group so labels at the
  // plot edges (e.g. a vertical line's top label) can overflow instead of being cropped,
  // while z ordering still holds: below-lines refs paint behind bars, above-all in front
  test(`reference-line annotations are unclipped and z-ordered around the bars`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic],
      ref_lines: [
        { type: `vertical`, x: 3, annotation: { text: `behind` } }, // default z: below-lines
        { type: `vertical`, x: 4, z_index: `above-all`, annotation: { text: `front` } },
      ],
    })
    await tick()
    const labels = Object.fromEntries(
      [...plot.querySelectorAll(`svg text`)].map((el) => [el.textContent?.trim(), el]),
    )
    const bars = plot.querySelector(`svg .bar-series`)
    if (!labels.behind || !labels.front || !bars) throw new Error(`missing elements`)
    for (const label of [labels.behind, labels.front]) {
      expect(inside_clip_path(label), `annotation must escape the clip-path`).toBe(false)
    }
    // document order encodes paint order: below-lines < bars < above-all
    const order = (el: Element) => bars.compareDocumentPosition(el)
    expect(Boolean(order(labels.behind) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true)
    expect(Boolean(order(labels.front) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })
})
