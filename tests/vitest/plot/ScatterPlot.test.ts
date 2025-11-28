import { ScatterPlot } from '$lib'
import type { DataSeries } from '$lib/plot'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const basic = {
  x: [1, 2, 3, 4, 5],
  y: [5, 3, 8, 2, 7],
  point_style: { fill: `steelblue`, radius: 5 },
}

describe(`ScatterPlot`, () => {
  test.each([
    {
      series: [basic],
      x_lim: [null, null] as const,
      y_lim: [null, null] as const,
      markers: `points`,
    },
    {
      series: [{ ...basic, y: [5, 3, 20, 2, 7] }],
      x_lim: [null, null] as const,
      y_lim: [0, 10] as const,
      markers: `line`,
    },
    {
      series: [{ ...basic, x: [0, 1, 2, 3, 10] }],
      x_lim: [0, 5] as const,
      y_lim: [null, null] as const,
      markers: `line+points`,
    },
    { series: [], markers: `points` },
    {
      series: [basic, {
        x: [1, 2, 3],
        y: [2, 5, 3],
        point_style: { fill: `orangered`, radius: 4 },
      }],
      markers: `line+points`,
    },
  ])(`renders with series/limits/markers`, (props) => {
    mount(ScatterPlot, { target: document.body, props })
  })

  test.each([
    {
      x: [0, 10, 20, 30, 40, 50],
      x_axis: { ticks: -10, format: `.0f` },
      y_axis: { ticks: -5, format: `.0f` },
    },
    {
      x: Array.from(
        { length: 12 },
        (_, idx) => new Date().setMonth(new Date().getMonth() - (12 - idx)),
      ),
      x_axis: { ticks: `month`, format: `%b %Y` },
    },
  ])(
    `tick formatting`,
    ({ x, x_axis, y_axis }) => {
      const y = Array.from({ length: 6 }, () => Math.random() * 100)
      mount(ScatterPlot, {
        target: document.body,
        props: {
          series: [{ x, y, point_style: { fill: `steelblue`, radius: 5 } }],
          x_axis,
          y_axis,
        },
      })
    },
  )

  test(`labels/padding/tooltip`, () => {
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{
          x: [1, 2, 3, 4, 5],
          y: [10, 20, 30, 40, 50],
          point_style: { fill: `steelblue`, radius: 5 },
        }],
        x_axis: { label: `Time (s)` },
        y_labels: { label: `Speed` },
        y_unit: `m/s`,
        tooltip_point: { x: 3, y: 30, series_idx: 0, point_idx: 2 },
        hovered: true,
      },
    })
  })

  test(`invalid data`, () => {
    const invalid = [
      {
        x: [1, 2, null, 4, 5] as (number | null)[],
        y: [5, 4, undefined, 2, 1] as (number | null)[],
      },
      null,
      undefined,
      { x: [10, 20, 30, 40, 50], y: [10, 20, 30] },
      { x: [100, 200, 300], y: [10, 20, 30] },
    ] as DataSeries[]
    mount(ScatterPlot, {
      target: document.body,
      props: { series: invalid, markers: `line+points` },
    })
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [1, 2, 3], y: [4, 5, 6] }],
        x_lim: [100, 200],
        y_lim: [100, 200],
      },
    })
  })

  test.each([
    { y: [-10, -5, 0, 5, 10], y_lim: [-15, 15] as const },
    { y: [5, 10, 15, 20, 25], y_lim: [0, 30] as const },
  ])(`zero lines`, ({ y, y_lim }) => {
    mount(ScatterPlot, {
      target: document.body,
      props: { series: [{ x: [1, 2, 3, 4, 5], y }], y_lim },
    })
  })

  test.each([
    {
      tooltip_point: {
        x: new Date(2023, 5, 15).getTime(),
        y: 123.45,
        series_idx: 0,
        point_idx: 0,
      },
      x_axis: { format: `%b %d, %Y` },
      y_axis: { format: `.2f` },
    },
    { tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 } },
  ])(`tooltip format`, (props) => {
    mount(ScatterPlot, {
      target: document.body,
      props: { series: [{ x: [1, 2, 3], y: [10, 20, 30] }], hovered: true, ...props },
    })
  })

  test(`children prop`, () => {
    let called = false
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [basic],
        children: () => {
          called = true
          const div_el = document.createElement(`div`)
          div_el.className = `custom-scatter-child`
          div_el.textContent = `Custom overlay content`
          document.body.appendChild(div_el)
        },
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.custom-scatter-child`)?.textContent).toBe(
      `Custom overlay content`,
    )
  })

  test.each([
    { selected_point: { series_idx: 0, point_idx: 2 }, desc: `middle point` },
    { selected_point: { series_idx: 0, point_idx: 0 }, desc: `first point` },
    { selected_point: { series_idx: 0, point_idx: 4 }, desc: `last point` },
    { selected_point: null, desc: `null (no selection)` },
  ])(`selected_point accepts $desc`, ({ selected_point }) => {
    // Tests that ScatterPlot accepts selected_point prop without errors
    mount(ScatterPlot, {
      target: document.body,
      props: { series: [basic], selected_point },
    })
    // Component should render without throwing
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })
})
