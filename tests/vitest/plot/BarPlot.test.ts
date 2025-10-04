import { BarPlot } from '$lib'
import type { BarSeries } from '$lib/plot'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const basic_series: BarSeries = {
  x: [1, 2, 3, 4, 5],
  y: [10, 20, 15, 25, 18],
  label: `Test Series`,
  color: `steelblue`,
}

describe(`BarPlot`, () => {
  test.each([
    [{ series: [basic_series], x_label: `Category`, y_label: `Value` }, `basic`],
    [{ series: [], orientation: `vertical` as const }, `empty`],
    [{ series: [{ ...basic_series, labels: [`A`, `B`, `C`, `D`, `E`] }] }, `labels`],
    [
      {
        series: [{ x: [1, 2, 3], y: [-5, 0, 5] }],
        x_grid: true,
        y_grid: true,
        show_zero_lines: true,
      },
      `grid+zero`,
    ],
  ])(`renders %s`, (props, _desc) => {
    mount(BarPlot, { target: document.body, props })
  })

  test.each(
    [
      [`vertical`, `overlay`],
      [`horizontal`, `overlay`],
      [`vertical`, `stacked`],
    ] as const,
  )(`orientation=%s mode=%s`, (orientation, mode) => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic_series, { ...basic_series, color: `orangered` }],
        orientation,
        mode,
      },
    })
  })

  test(`children prop`, () => {
    let called = false
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic_series],
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
