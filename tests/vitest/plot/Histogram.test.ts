import { Histogram } from '$lib'
import { bin, max as d3max } from 'd3-array'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'

function mount_histogram(props: Record<string, unknown>) {
  document.body.innerHTML = ``
  mount(Histogram, {
    target: document.body,
    props: {
      series: [],
      show_controls: false,
      show_legend: false,
      style: `width: 400px; height: 300px;`,
      ...props,
    },
  })
}

function get_tick_numbers(axis: `x` | `y`): number[] {
  const nodes = Array.from(document.querySelectorAll(`g.${axis}-axis .tick text`))
  return nodes.map((n) => Number((n.textContent || ``).trim())).filter((v) => !Number.isNaN(v))
}

const get_y_tick_numbers = (): number[] => get_tick_numbers(`y`)

describe(`Histogram`, () => {
  test.each([
    {
      name: `y-axis based on counts for identical values`,
      series: [{ x: [], y: [1, 1, 1, 1, 1], label: `A` }],
      bins: 5,
      expected_min_max: [5, 50],
    },
    {
      name: `ignores raw magnitudes for y-axis (counts remain small)`,
      series: [{ x: [], y: [1000, 2000, 3000, 4000, 5000], label: `B` }],
      bins: 5,
      expected_min_max: [1, 20],
    },
  ])(`$name`, async ({ series, bins, expected_min_max }) => {
    mount_histogram({ series, bins })
    await tick()
    const ticks = get_y_tick_numbers()
    expect(ticks.length).toBeGreaterThan(0)
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeGreaterThanOrEqual(expected_min_max[0])
    expect(max_tick).toBeLessThanOrEqual(expected_min_max[1])
  })

  test(`multi-series uses maximum counts across series`, async () => {
    mount_histogram({
      series: [
        { x: [], y: [0, 0, 0, 0, 0], label: `A` }, // single bin gets 5
        { x: [], y: [1, 2, 3, 4, 5], label: `B` }, // spread across bins
      ],
      bins: 5,
    })
    await tick()
    const ticks = get_y_tick_numbers()
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeGreaterThanOrEqual(5)
  })

  const repeated_histogram_series = { x: [], y: [0, 1, 2], label: `Repeated` }

  test.each([
    {
      name: `when earlier series are hidden`,
      series: [
        { x: [], y: [0, 1, 2], label: `Hidden`, visible: false },
        { x: [], y: [1, 1, 2], label: `Visible` },
      ],
      expected_indices: [`1`],
    },
    {
      name: `for repeated series objects`,
      series: [repeated_histogram_series, repeated_histogram_series],
      expected_indices: [`0`, `1`],
    },
  ])(
    `rendered series keep original indices and clip to chart area $name`,
    async ({ series, expected_indices }) => {
      mount_histogram({ series, show_legend: true })
      await tick()

      const groups = Array.from(document.querySelectorAll(`g.histogram-series`))
      const series_indices = groups.map((element) => element.getAttribute(`data-series-idx`))
      expect(series_indices).toEqual(expected_indices)

      // bars must clip to the chart area, else zooming/panning the y range lets tall
      // bars paint over the top margin and x2 axis (ref lines stay outside the clip)
      for (const group of groups) {
        expect(group.getAttribute(`clip-path`)).toMatch(/^url\(#histogram-clip/)
      }
    },
  )

  test(`single mode falls back when selected_property is stale`, async () => {
    mount_histogram({
      series: [{ x: [], y: [1, 2, 3], label: `Band Gap` }],
      mode: `single`,
      selected_property: `Energy`,
    })
    await tick()

    expect(document.querySelectorAll(`g.histogram-series`)).toHaveLength(1)
  })

  test(`bins sensitivity: fewer bins increase per-bin counts`, async () => {
    const series = [{ x: [], y: [1, 2, 3, 4, 5, 6, 7, 8, 9], label: `A` }]

    mount_histogram({ series, bins: 9 })
    await tick()
    const ticks_many = get_y_tick_numbers()
    const max_many = Math.max(...ticks_many)

    mount_histogram({ series, bins: 3 })
    await tick()
    const ticks_few = get_y_tick_numbers()
    const max_few = Math.max(...ticks_few)

    expect(max_few).toBeGreaterThanOrEqual(max_many)
  })

  test(`y_range caps auto count domain`, async () => {
    mount_histogram({ series: [{ x: [], y: [1, 1, 1, 1, 1] }], bins: 5, y_range: [0, 3] })
    await tick()
    const ticks = get_y_tick_numbers()
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeLessThanOrEqual(3)
  })

  test(`x_range applies domain; y max tick >= computed max bin count`, async () => {
    const series = [{ x: [], y: [0, 0, 1, 1, 1, 2, 2, 10, 10, 10], label: `A` }]

    mount_histogram({ series, bins: 5 })
    await tick()
    const ticks_full = get_y_tick_numbers()
    const full_max = Math.max(...ticks_full)
    const full_hist = bin().thresholds(5)(series[0].y)
    const full_expected = d3max(full_hist, (b) => b.length) ?? 0
    expect(full_max).toBeGreaterThanOrEqual(full_expected)

    mount_histogram({ series, bins: 5, x_range: [0, 3] })
    await tick()
    const ticks_zoom = get_y_tick_numbers()
    const zoom_max = Math.max(...ticks_zoom)
    const zoom_hist = bin().domain([0, 3]).thresholds(5)(series[0].y)
    const zoom_expected = d3max(zoom_hist, (b) => b.length) ?? 0
    expect(zoom_max).toBeGreaterThanOrEqual(zoom_expected)
  })

  test(`log y-scale still uses count-based domain`, async () => {
    mount_histogram({
      series: [{ x: [], y: [1, 1, 1, 1, 1] }],
      bins: 5,
      y_axis: { scale_type: `log`, format: `.2r` },
      y_range: [1, null],
    })
    await tick()
    const ticks = get_y_tick_numbers()
    // log scale should not include non-positive ticks
    expect(Math.min(...ticks)).toBeGreaterThan(0)
  })

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    mount_histogram({
      series: [
        { x: [], y: [70, 72, 68], label: `Mass (kg)` },
        { x: [], y: [154, 154, 154, 154, 158], label: `Mass (lbs)`, x_axis: `x2` },
      ],
      bins: 5,
      x2_axis: { label: `Mass (lbs)` },
      mode: `overlay`,
    })
    await tick()
    expect(document.querySelector(`.histogram`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(`g.x2-axis`)).toBeInstanceOf(SVGGElement)
    expect(document.querySelector(`.x2-label`)?.textContent).toBe(`Mass (lbs)`)
    // x1 auto-range must come from x1 series only, excluding x2 magnitudes (~150)
    const x_ticks = get_tick_numbers(`x`)
    expect(x_ticks.length).toBeGreaterThan(0)
    expect(Math.max(...x_ticks)).toBeLessThan(100)
    // y-range must bin the x2 series over the x2 domain (4 of 5 values share one bin)
    expect(Math.max(...get_y_tick_numbers())).toBeGreaterThanOrEqual(4)
  })

  test(`renders without error when legend prop is null`, async () => {
    // Should not throw when legend={null} is passed
    mount_histogram({
      series: [
        { x: [], y: [1, 2, 3], label: `A` },
        { x: [], y: [2, 3, 4], label: `B` },
      ],
      legend: null,
      show_legend: true,
    })
    await tick()
    // Verify component mounted without crashing
    expect(document.querySelector(`.histogram`)).toBeInstanceOf(HTMLElement)
  })

  test(`legend auto-moves to the bottom margin when bars fill the plot`, async () => {
    // near-uniform distribution -> every bin is tall -> filled bars cover the plot so no interior
    // spot avoids overlap and the legend must drop into the reserved bottom margin
    const uniform = Array.from({ length: 800 }, (_, idx) => idx % 100)
    mount_histogram({
      series: [
        { x: [], y: uniform, label: `A` },
        { x: [], y: uniform.map((val) => val + 0.5), label: `B` },
      ],
      bins: 40,
      show_legend: true,
      legend: {},
    })
    await tick()
    const legend = document.querySelector<HTMLElement>(`.legend`)
    expect(legend).toBeInstanceOf(HTMLElement)
    // interior default is top-left (~pad.t + 10); auto-outside drops it well into the lower half
    expect(parseFloat(legend?.style.top ?? `0`)).toBeGreaterThan(150)
  })
})
