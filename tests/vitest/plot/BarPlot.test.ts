import { BarPlot } from '$lib'
import type { BarHandlerProps, BarMode, BarSeries, Orientation } from '$lib/plot'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { resize_element } from '../setup'

const basic: BarSeries = {
  x: [1, 2, 3, 4, 5],
  y: [10, 20, 15, 25, 18],
  label: `Test Series`,
  color: `steelblue`,
}

async function mount_sized_bar_plot(
  props: Partial<ComponentProps<typeof BarPlot>>,
): Promise<HTMLElement> {
  mount(BarPlot, {
    target: document.body,
    props: { ...props, style: `width: 400px; height: 300px; ${props.style ?? ``}` },
  })
  const plot = document.querySelector<HTMLElement>(`.bar-plot`)
  if (!plot) throw new Error(`BarPlot root element not found`)
  await resize_element(plot, 400, 300)
  return plot
}

const visible_bar_count = (series: BarSeries[] = []): number =>
  series
    .filter((srs) => srs.visible !== false && srs.render_mode !== `line`)
    .reduce((sum, srs) => sum + srs.y.filter((y_val) => y_val !== 0).length, 0)

const visible_bar_series_count = (series: BarSeries[] = []): number =>
  series.filter((srs) => srs.visible !== false && srs.render_mode !== `line`).length

describe(`BarPlot`, () => {
  test.each([
    { series: [basic], x_axis: { label: `Category` }, y_axis: { label: `Value` } },
    { series: [], orientation: `vertical` },
    { series: [{ ...basic, labels: [`A`, `B`, `C`, `D`, `E`] }] },
    {
      series: [{ x: [1, 2, 3], y: [-5, 0, 5] }],
      display: { x_grid: true, y_zero_line: true },
    },
    { series: [{ x: [1, 2, 3, 4], y: [-10, -20, -15, -25] }] }, // all negative
    { series: [basic], x_axis: { range: [2, 4] }, y_axis: { range: [10, 25] } },
    { series: [basic], x_axis: { format: `.0r` }, y_axis: { format: `.2r` } },
    { series: [basic], x_axis: { ticks: 10 }, y_axis: { ticks: -3 } },
    { series: [basic], range_padding: 0.1 },
    { series: [basic], padding: { t: 20, b: 80, l: 100, r: 40 } },
    { series: [basic], show_controls: false },
    { series: [basic], controls_open: true },
    { series: [basic], x_axis: { range: [0, 10] }, y_axis: { range: [0, 50] } },
    { series: [basic], legend: null },
    {
      series: [basic],
      x_axis: { grid_style: { stroke: `blue`, 'stroke-width': 2 } },
      y_axis: { grid_style: { stroke: `red` } },
      display: { x_grid: true, y_grid: true },
    },
    {
      series: [basic],
      x_axis: { label: `X`, label_shift: { x: 10 } },
      y_axis: { label: `Y`, label_shift: { y: 10 } },
    },
    {
      series: [{ x: [1, 2, 3, 4], y: [-10, 5, -15, 20] }],
      display: { y_zero_line: false },
    },
    { series: [{ ...basic, bar_width: 0.8 }] },
    { series: [{ ...basic, bar_width: [0.3, 0.5, 0.7, 0.9, 0.4] }] },
    {
      series: [
        {
          ...basic,
          metadata: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        },
      ],
    },
    { series: [{ ...basic, metadata: { dataset: `Test`, units: `kg` } }] },
    {
      series: [
        basic,
        { ...basic, color: `orangered`, visible: false },
        { ...basic, color: `green` },
      ],
    },
    {
      series: [basic, { ...basic, color: `orangered`, label: `S2` }],
      legend: { title: `Test` },
    },
  ] as Partial<ComponentProps<typeof BarPlot>>[])(`renders various configs`, async (props) => {
    const series = (props.series ?? []) as BarSeries[]
    const plot = await mount_sized_bar_plot(props)
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(visible_bar_series_count(series))
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(
      visible_bar_count(series),
    )
    if (props.legend === null) expect(plot.querySelector(`.legend`)).toBeNull()
  })

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

  test.each<[Orientation, BarMode]>([
    [`vertical`, `overlay`],
    [`horizontal`, `overlay`],
    [`vertical`, `stacked`],
    [`vertical`, `grouped`],
    [`horizontal`, `grouped`],
    [`horizontal`, `stacked`],
  ])(`orientation=%s mode=%s`, async (orientation, mode) => {
    const series = [basic, { ...basic, color: `orangered` }]
    const plot = await mount_sized_bar_plot({ series, orientation, mode })
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(2)
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(10)
  })

  test.each<[BarMode, BarSeries[]]>([
    [
      `overlay`,
      [
        { x: [1, 2, 3, 4], y: [-10, -5, 15, 20] },
        {
          x: [1, 2, 3, 4],
          y: [5, -8, 12, -3],
        },
      ],
    ],
    [
      `stacked`,
      [
        { x: [1, 2, 3, 4], y: [10, -5, 15, 20] },
        {
          x: [1, 2, 3, 4],
          y: [-5, 10, -8, 5],
        },
      ],
    ],
    [
      `grouped`,
      [
        basic,
        { ...basic, color: `orangered`, label: `S2` },
        { ...basic, color: `green`, label: `S3` },
      ],
    ],
  ])(`%s mode with negative/multiple series`, async (mode, series) => {
    const plot = await mount_sized_bar_plot({ series, mode })
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(series.length)
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(
      visible_bar_count(series),
    )
  })

  test.each([
    { render_mode: `line` as const, color: `red`, label: `Line` },
    { render_mode: `line` as const, line_style: { stroke_width: 4, line_dash: `10,5` } },
    // Regression: .filter(Boolean) incorrectly removed 0 from auto-range calculation
    // Zero is a valid value for color/size scales (e.g. minimum on a gradient)
    {
      render_mode: `line` as const,
      markers: `line+points` as const,
      color_values: [0, 0.25, 0.5, 0.75, 1],
      size_values: [0, 5, 10, 15, 20],
    },
  ])(`line series %#`, async (series_props) => {
    const plot = await mount_sized_bar_plot({
      series: [{ x: [1, 2, 3, 4, 5], y: [10, 20, 15, 25, 18], ...series_props }],
    })
    expect(plot.querySelectorAll(`.line-series`)).toHaveLength(1)
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(0)
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

  test(`stacked mode with interleaved hidden series`, async () => {
    // Regression test: stacked_offsets lookup should use original series index
    const plot = await mount_sized_bar_plot({
      series: [
        { x: [1, 2, 3], y: [10, 20, 15], color: `red`, visible: true },
        { x: [1, 2, 3], y: [5, 10, 8], color: `blue`, visible: false }, // hidden
        { x: [1, 2, 3], y: [8, 12, 10], color: `green`, visible: true },
      ],
      mode: `stacked`,
    })
    expect(
      Array.from(plot.querySelectorAll(`.bar-series`), (el) =>
        el.getAttribute(`data-series-idx`),
      ),
    ).toEqual([`0`, `2`])
    expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(6)
  })

  test(`event callbacks`, () => {
    const [change_fn, hover_fn, click_fn] = [vi.fn(), vi.fn(), vi.fn()]
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic],
        change: change_fn,
        on_bar_hover: hover_fn,
        on_bar_click: click_fn,
      },
    })
    expect(change_fn).not.toHaveBeenCalled()
    expect(hover_fn).not.toHaveBeenCalled()
    expect(click_fn).not.toHaveBeenCalled()
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
    let called = false
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic],
        children: createRawSnippet(() => {
          called = true
          return {
            render: () => `<div class="custom-bar-child">Custom bar overlay</div>`,
          }
        }),
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.custom-bar-child`)?.textContent).toBe(`Custom bar overlay`)
  })

  describe(`categorical bar charts`, () => {
    const cat_series: BarSeries[] = [
      { x: [`A`, `B`, `C`], y: [10, 20, 30], label: `S1`, color: `blue` },
      { x: [`B`, `C`, `D`], y: [5, 15, 25], label: `S2`, color: `red` },
    ]

    // Fold all mount-and-check configs into a single parameterized test
    test.each([
      [`overlay mode`, { series: cat_series, mode: `overlay` as BarMode }],
      [`stacked mode`, { series: cat_series, mode: `stacked` as BarMode }],
      [`grouped mode`, { series: cat_series, mode: `grouped` as BarMode }],
      [`vertical`, { series: cat_series, orientation: `vertical` as Orientation }],
      [`horizontal`, { series: cat_series, orientation: `horizontal` as Orientation }],
      [
        `explicit category order`,
        { series: cat_series, x_axis: { categories: [`D`, `C`, `B`, `A`] } },
      ],
      [`category subset filter`, { series: cat_series, x_axis: { categories: [`A`, `C`] } }],
      [`empty categorical series`, { series: [{ x: [] as string[], y: [], color: `blue` }] }],
      [`single category`, { series: [{ x: [`Only`], y: [42], color: `blue` }] }],
      [
        `mixed bar+line`,
        {
          series: [
            { x: [`A`, `B`, `C`], y: [10, 20, 30], color: `blue` },
            {
              x: [`A`, `B`, `C`],
              y: [15, 25, 35],
              color: `red`,
              render_mode: `line` as const,
              markers: `line+points` as const,
            },
          ],
        },
      ],
      [
        `numeric x (not categorical)`,
        { series: [{ x: [1, 2, 3], y: [10, 20, 30], color: `blue` }] },
      ],
    ] as [string, Partial<ComponentProps<typeof BarPlot>>][])(
      `renders %s`,
      async (_label, props) => {
        mount(BarPlot, {
          target: document.body,
          props: { ...props, style: `width: 400px; height: 300px` },
        })
        await tick()
        const plot = document.querySelector(`.bar-plot`)
        expect(plot).toBeInstanceOf(HTMLElement)
        expect(plot?.querySelector(`svg`)).toBeInstanceOf(SVGSVGElement)
      },
    )

    test(`single series with 3 categories renders 3 bars`, async () => {
      mount(BarPlot, {
        target: document.body,
        props: {
          series: [{ x: [`Foo`, `Bar`, `Baz`], y: [1, 2, 3], color: `blue` }],
          style: `width: 400px; height: 300px`,
        },
      })
      await tick()
      expect(document.querySelectorAll(`path[role="button"]`)).toHaveLength(3)
    })

    test(`hover provides category_label and preserves metadata`, async () => {
      const hover_fn = vi.fn()
      mount(BarPlot, {
        target: document.body,
        props: {
          series: [
            {
              x: [`X`, `Y`],
              y: [10, 20],
              color: `blue`,
              metadata: [{ id: 1 }, { id: 2 }],
              labels: [`Label X`, `Label Y`],
            },
          ],
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
      expect(typeof data.category_label).toBe(`string`)
      expect(data.metadata).toBeDefined()
    })

    test(`tooltip shows category name, not numeric index`, async () => {
      mount(BarPlot, {
        target: document.body,
        props: {
          series: [{ x: [`Alpha`, `Beta`, `Gamma`], y: [10, 20, 30], color: `blue` }],
          x_axis: { label: `Greek` },
          style: `width: 400px; height: 300px`,
        },
      })
      await tick()
      const bar = document.querySelector(`path[role="button"]`)
      if (!bar) throw new Error(`bar element not found`)
      bar.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
      await tick()
      const tooltip_text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
      expect(tooltip_text).toMatch(/Alpha|Beta|Gamma/)
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

    test(`accepts series with legend_group property without errors`, async () => {
      const plot = await mount_sized_bar_plot({ series: grouped_series, mode: `grouped` })
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(4)
      expect(plot.textContent).toContain(`DFT`)
      expect(plot.textContent).toContain(`ML`)
    })

    test(`series visibility can be toggled via legend_group`, async () => {
      // Test that series with legend_group can have their visibility toggled
      const series_with_hidden_group: BarSeries[] = grouped_series.map((srs) =>
        srs.legend_group === `DFT` ? { ...srs, visible: false } : srs,
      )

      const plot = await mount_sized_bar_plot({
        series: series_with_hidden_group,
        mode: `grouped`,
      })
      expect(
        Array.from(plot.querySelectorAll(`.bar-series`), (el) =>
          el.getAttribute(`data-series-idx`),
        ),
      ).toEqual([`2`, `3`])
    })

    test(`legend_group property is preserved on series data`, () => {
      // Verify that legend_group is a valid property on BarSeries
      const series_with_group: BarSeries = {
        x: [1, 2, 3],
        y: [10, 20, 15],
        label: `Test`,
        legend_group: `TestGroup`,
        color: `blue`,
      }

      expect(series_with_group.legend_group).toBe(`TestGroup`)
    })

    test(`renders with mixed grouped and ungrouped series`, async () => {
      const plot = await mount_sized_bar_plot({ series: grouped_series, mode: `overlay` })
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(4)
      expect(plot.textContent).toContain(`Experiment`)
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
    expect(parseFloat(legend?.style.top ?? `0`)).toBeGreaterThan(150)
  })
})
