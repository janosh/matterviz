import { ScatterPlot } from '$lib'
import type { DataSeries } from '$lib/plot'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

// Test helpers
const container_style = `width: 800px; height: 600px; position: relative;`

function mount_scatter(props: Record<string, unknown>) {
  const component = mount(ScatterPlot, { target: document.body, props })
  const scatter = document.querySelector(`.scatter`)
  expect(component).toBeTruthy()
  expect(scatter).toBeTruthy()
  return { component, scatter }
}

function simulate_mouse_event(
  element: Element | null,
  event_type: string,
  coords = { x: 400, y: 300 },
) {
  if (!element) return
  const event = new MouseEvent(event_type, {
    bubbles: true,
    cancelable: true,
    clientX: coords.x,
    clientY: coords.y,
  })
  Object.defineProperties(event, {
    offsetX: { value: coords.x },
    offsetY: { value: coords.y },
  })
  element.dispatchEvent(event)
}

// Common test data
const basic_series = {
  x: [1, 2, 3, 4, 5],
  y: [5, 3, 8, 2, 7],
  point_style: { fill: `steelblue`, radius: 5 },
}
const multi_series = [
  { ...basic_series, metadata: { label: `Series A` } },
  {
    x: [1, 2, 3],
    y: [2, 5, 3],
    point_style: { fill: `orangered`, radius: 4 },
    metadata: { label: `Series B` },
  },
]

describe(`ScatterPlot`, () => {
  beforeEach(() => {
    const container = document.createElement(`div`)
    container.setAttribute(`style`, container_style)
    document.body.appendChild(container)
  })

  test.each([
    {
      name: `basic`,
      data: basic_series,
      x_lim: [null, null],
      y_lim: [null, null],
      markers: `points`,
    },
    {
      name: `y_limits`,
      data: { ...basic_series, y: [5, 3, 20, 2, 7] },
      x_lim: [null, null],
      y_lim: [0, 10],
      markers: `line`,
    },
    {
      name: `x_limits`,
      data: { ...basic_series, x: [0, 1, 2, 3, 10] },
      x_lim: [0, 5],
      y_lim: [null, null],
      markers: `line+points`,
    },
  ])(`renders: $name`, ({ data, x_lim, y_lim, markers }) => {
    mount_scatter({
      series: [data],
      x_label: `X Axis`,
      y_label: `Y Axis`,
      x_lim,
      y_lim,
      markers,
    })
  })

  test(`multiple series and empty data`, () => {
    mount_scatter({ series: multi_series, markers: `line+points` })
    mount_scatter({ series: [] })
  })

  test.each([
    {
      data: { x: [0, 10, 20, 30, 40, 50], y: [0, 30, 15, 45, 20, 50] },
      x_ticks: -10,
      y_ticks: -5,
      x_format: `.0f`,
      y_format: `.0f`,
    },
    {
      data: {
        x: Array.from(
          { length: 12 },
          (_, i) => new Date().setMonth(new Date().getMonth() - (12 - i)),
        ),
        y: Array.from({ length: 12 }, () => Math.random() * 100),
      },
      x_ticks: `month`,
      y_ticks: 5,
      x_format: `%b %Y`,
      y_format: `.0f`,
    },
  ])(
    `tick formats: numeric/timestamp`,
    ({ data, x_ticks, y_ticks, x_format, y_format }) => {
      mount_scatter({
        series: [{ ...data, point_style: { fill: `steelblue`, radius: 5 } }],
        x_ticks,
        y_ticks,
        x_format,
        y_format,
      })
    },
  )

  test(`labels, padding, tooltips`, () => {
    mount_scatter({
      series: [{
        x: [1, 2, 3, 4, 5],
        y: [10, 20, 30, 40, 50],
        point_style: { fill: `steelblue`, radius: 5 },
      }],
      x_label: `Time (s)`,
      y_label: `Speed`,
      y_unit: `m/s`,
      x_format: `.1f`,
      y_format: `.0f`,
      pad_top: 20,
      pad_bottom: 50,
      pad_left: 80,
      pad_right: 30,
      x_label_yshift: 10,
      tooltip_point: { x: 3, y: 30, series_idx: 0, point_idx: 2 },
      hovered: true,
    })
  })

  test(`mouse events`, () => {
    const mock_change = vi.fn()
    const { scatter } = mount_scatter({
      series: [{ ...basic_series, metadata: { label: `Test Data` } }],
      change: mock_change,
    })
    simulate_mouse_event(scatter, `mousemove`, { x: 400, y: 300 })
  })

  test(`edge cases - invalid data`, () => {
    const invalid_series = [
      {
        x: [1, 2, null, 4, 5] as (number | null)[],
        y: [5, 4, undefined, 2, 1] as (number | null)[],
      },
      null,
      undefined,
      { x: [10, 20, 30, 40, 50], y: [10, 20, 30] }, // mismatched lengths
      { x: [100, 200, 300], y: [10, 20, 30] }, // valid
    ] as DataSeries[]

    mount_scatter({
      series: invalid_series,
      x_lim: [null, null],
      y_lim: [null, null],
      markers: `line+points`,
    })
    mount_scatter({
      series: [{ x: [1, 2, 3], y: [4, 5, 6] }],
      x_lim: [100, 200],
      y_lim: [100, 200],
    }) // filtered out
  })

  test(`negative values and zero line`, () => {
    mount_scatter({
      series: [{ x: [1, 2, 3, 4, 5], y: [-10, -5, 0, 5, 10] }],
      y_lim: [-15, 15],
    })
    mount_scatter({
      series: [{ x: [1, 2, 3, 4, 5], y: [5, 10, 15, 20, 25] }],
      y_lim: [0, 30],
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
      x_format: `%b %d, %Y`,
      y_format: `.2f`,
    },
    {
      tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      x_format: undefined,
      y_format: undefined,
    },
  ])(`tooltip formatting`, ({ tooltip_point, x_format, y_format }) => {
    mount_scatter({
      series: [{ x: [1, 2, 3], y: [10, 20, 30] }],
      tooltip_point,
      hovered: true,
      x_format,
      y_format,
    })
  })

  test(`mouse move scenarios`, () => {
    const mock_change = vi.fn()
    const { scatter } = mount_scatter({
      series: [{
        x: [10, 20, 30, 40, 50],
        y: [5, 15, 25, 35, 45],
        metadata: { series: `Series A` },
      }],
      change: mock_change,
    })
    ;[{ x: 200, y: 200 }, { x: 100, y: 100 }, { x: 700, y: 500 }].forEach((coords) => {
      simulate_mouse_event(scatter, `mousemove`, coords)
    })
  })
})
