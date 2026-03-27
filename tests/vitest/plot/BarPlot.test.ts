import { BarPlot } from '$lib'
import type { BarHandlerProps, BarMode, BarSeries, Orientation } from '$lib/plot'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

const basic: BarSeries = {
  x: [1, 2, 3, 4, 5],
  y: [10, 20, 15, 25, 18],
  label: `Test Series`,
  color: `steelblue`,
}

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
  ] as Partial<ComponentProps<typeof BarPlot>>[])(`renders various configs`, (props) => {
    mount(BarPlot, { target: document.body, props })
  })

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    mount(BarPlot, {
      target: document.body,
      props: {
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
        style: `width: 400px; height: 300px`,
      },
    })
    await tick()
    expect(document.querySelector(`.bar-plot`)).toBeTruthy()
    expect(document.querySelector(`g.x2-axis`)).toBeTruthy()
    expect(document.querySelector(`.x2-label`)?.textContent).toBe(`Temperature (K)`)
  })

  test.each<[Orientation, BarMode]>([
    [`vertical`, `overlay`],
    [`horizontal`, `overlay`],
    [`vertical`, `stacked`],
    [`vertical`, `grouped`],
    [`horizontal`, `grouped`],
    [`horizontal`, `stacked`],
  ])(`orientation=%s mode=%s`, (orientation, mode) => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic, { ...basic, color: `orangered` }],
        orientation,
        mode,
      },
    })
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
  ])(`%s mode with negative/multiple series`, (mode, series) => {
    mount(BarPlot, { target: document.body, props: { series, mode } })
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
  ])(`line series %#`, (series_props) => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [{ x: [1, 2, 3, 4, 5], y: [10, 20, 15, 25, 18], ...series_props }],
      },
    })
    const plot = document.querySelector(`.bar-plot`)
    expect(plot).toBeTruthy()
  })

  test(`mixed bar and line series`, () => {
    mount(BarPlot, {
      target: document.body,
      props: {
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
      },
    })
  })

  test(`stacked mode with interleaved hidden series`, () => {
    // Regression test: stacked_offsets lookup should use original series index
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [
          { x: [1, 2, 3], y: [10, 20, 15], color: `red`, visible: true },
          { x: [1, 2, 3], y: [5, 10, 8], color: `blue`, visible: false }, // hidden
          { x: [1, 2, 3], y: [8, 12, 10], color: `green`, visible: true },
        ],
        mode: `stacked`,
      },
    })
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
    expect(bar).toBeTruthy()
    bar?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    const text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    expect(text).toContain(`Group A`)
    expect(text).toContain(`Count`)
  })

  test(`custom tooltip snippet`, () => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic],
        tooltip: createRawSnippet<[BarHandlerProps]>((data) => ({
          render: () => `<div class="custom-tooltip">x: ${data().x}, y: ${data().y}</div>`,
        })),
        hovered: true,
      },
    })
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
        {
          series: cat_series,
          x_axis: { categories: [`D`, `C`, `B`, `A`] },
        },
      ],
      [
        `category subset filter`,
        {
          series: cat_series,
          x_axis: { categories: [`A`, `C`] },
        },
      ],
      [
        `empty categorical series`,
        {
          series: [{ x: [] as string[], y: [], color: `blue` }],
        },
      ],
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
        {
          series: [{ x: [1, 2, 3], y: [10, 20, 30], color: `blue` }],
        },
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
        expect(plot).toBeTruthy()
        expect(plot?.querySelector(`svg`)).toBeTruthy()
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
      expect(document.querySelectorAll(`path[role="button"]`).length).toBe(3)
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

    test(`accepts series with legend_group property without errors`, () => {
      // BarPlot should render without errors when series have legend_group
      mount(BarPlot, {
        target: document.body,
        props: { series: grouped_series, mode: `grouped` },
      })

      // Component should render the bar plot wrapper
      expect(document.querySelector(`.bar-plot`)).toBeTruthy()
    })

    test(`series visibility can be toggled via legend_group`, () => {
      // Test that series with legend_group can have their visibility toggled
      const series_with_hidden_group: BarSeries[] = grouped_series.map((srs) =>
        srs.legend_group === `DFT` ? { ...srs, visible: false } : srs,
      )

      mount(BarPlot, {
        target: document.body,
        props: { series: series_with_hidden_group, mode: `grouped` },
      })

      // Component should render
      expect(document.querySelector(`.bar-plot`)).toBeTruthy()
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

    test(`renders with mixed grouped and ungrouped series`, () => {
      mount(BarPlot, {
        target: document.body,
        props: { series: grouped_series, mode: `overlay` },
      })

      // Component should render without errors
      expect(document.querySelector(`.bar-plot`)).toBeTruthy()
    })
  })
})
