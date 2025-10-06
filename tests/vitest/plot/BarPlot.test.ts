import { BarPlot } from '$lib'
import type { BarMode, BarSeries, BarTooltipProps, Orientation } from '$lib/plot'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

const basic: BarSeries = {
  x: [1, 2, 3, 4, 5],
  y: [10, 20, 15, 25, 18],
  label: `Test Series`,
  color: `steelblue`,
}

describe(`BarPlot`, () => {
  test.each<{ series: BarSeries[]; [key: string]: unknown }>([
    { series: [basic], x_label: `Category`, y_label: `Value` },
    { series: [], orientation: `vertical` },
    { series: [{ ...basic, labels: [`A`, `B`, `C`, `D`, `E`] }] },
    { series: [{ x: [1, 2, 3], y: [-5, 0, 5] }], x_grid: true, show_zero_lines: true },
    { series: [{ x: [1, 2, 3, 4], y: [-10, -20, -15, -25] }] }, // all negative
    { series: [basic], x_lim: [2, 4], y_lim: [10, 25] },
    { series: [basic], x_format: `.0f`, y_format: `.2f` },
    { series: [basic], x_ticks: 10, y_ticks: -3 },
    { series: [basic], range_padding: 0.1 },
    { series: [basic], padding: { t: 20, b: 80, l: 100, r: 40 } },
    { series: [basic], show_controls: false },
    { series: [basic], controls_open: true },
    { series: [basic], x_range: [0, 10], y_range: [0, 50] },
    { series: [basic], legend: null },
    {
      series: [basic],
      x_grid: { stroke: `blue`, 'stroke-width': 2 },
      y_grid: { stroke: `red` },
    },
    {
      series: [basic],
      x_label: `X`,
      y_label: `Y`,
      x_label_shift: { x: 10 },
      y_label_shift: { y: 10 },
    },
    { series: [{ x: [1, 2, 3, 4], y: [-10, 5, -15, 20] }], show_zero_lines: false },
    { series: [{ ...basic, bar_width: 0.8 }] },
    { series: [{ ...basic, bar_width: [0.3, 0.5, 0.7, 0.9, 0.4] }] },
    {
      series: [{
        ...basic,
        metadata: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      }],
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
  ])(`renders various configs`, (props) => {
    mount(BarPlot, { target: document.body, props })
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
    [`overlay`, [{ x: [1, 2, 3, 4], y: [-10, -5, 15, 20] }, {
      x: [1, 2, 3, 4],
      y: [5, -8, 12, -3],
    }]],
    [`stacked`, [{ x: [1, 2, 3, 4], y: [10, -5, 15, 20] }, {
      x: [1, 2, 3, 4],
      y: [-5, 10, -8, 5],
    }]],
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
  ])(`line series`, (series_props) => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [{ x: [1, 2, 3, 4, 5], y: [10, 20, 15, 25, 18], ...series_props }],
      },
    })
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

  test(`custom tooltip snippet`, () => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic],
        tooltip: (data: BarTooltipProps) => {
          const div_el = document.createElement(`div`)
          div_el.className = `custom-tooltip`
          div_el.textContent = `x: ${data.x}, y: ${data.y}`
          document.body.appendChild(div_el)
        },
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
        children: () => {
          called = true
          const div_el = document.createElement(`div`)
          div_el.className = `custom-bar-child`
          div_el.textContent = `Custom bar overlay`
          document.body.appendChild(div_el)
        },
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.custom-bar-child`)?.textContent).toBe(
      `Custom bar overlay`,
    )
  })
})
