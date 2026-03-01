import { Histogram } from '$lib'
import { bin, max as d3max } from 'd3-array'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

function mount_histogram(props: Record<string, unknown>) {
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

function get_y_tick_numbers(): number[] {
  const nodes = Array.from(document.querySelectorAll(`g.y-axis .tick text`))
  return nodes.map((n) => Number((n.textContent || ``).trim())).filter((v) =>
    !Number.isNaN(v)
  )
}

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
    await Promise.resolve()
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
    await Promise.resolve()
    const ticks = get_y_tick_numbers()
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeGreaterThanOrEqual(5)
  })

  test(`bins sensitivity: fewer bins increase per-bin counts`, async () => {
    const series = [{ x: [], y: [1, 2, 3, 4, 5, 6, 7, 8, 9], label: `A` }]

    mount_histogram({ series, bins: 9 })
    await Promise.resolve()
    const ticks_many = get_y_tick_numbers()
    const max_many = Math.max(...ticks_many)

    mount_histogram({ series, bins: 3 })
    await Promise.resolve()
    const ticks_few = get_y_tick_numbers()
    const max_few = Math.max(...ticks_few)

    expect(max_few).toBeGreaterThanOrEqual(max_many)
  })

  test(`y_range caps auto count domain`, async () => {
    mount_histogram({ series: [{ x: [], y: [1, 1, 1, 1, 1] }], bins: 5, y_range: [0, 3] })
    await Promise.resolve()
    const ticks = get_y_tick_numbers()
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeLessThanOrEqual(3)
  })

  test(`x_range applies domain; y max tick >= computed max bin count`, async () => {
    const series = [{ x: [], y: [0, 0, 1, 1, 1, 2, 2, 10, 10, 10], label: `A` }]

    mount_histogram({ series, bins: 5 })
    await Promise.resolve()
    const ticks_full = get_y_tick_numbers()
    const full_max = Math.max(...ticks_full)
    const full_hist = bin().thresholds(5)(series[0].y)
    const full_expected = d3max(full_hist, (b) => b.length) || 0
    expect(full_max).toBeGreaterThanOrEqual(full_expected)

    mount_histogram({ series, bins: 5, x_range: [0, 3] })
    await Promise.resolve()
    const ticks_zoom = get_y_tick_numbers()
    const zoom_max = Math.max(...ticks_zoom)
    const zoom_hist = bin().domain([0, 3]).thresholds(5)(series[0].y)
    const zoom_expected = d3max(zoom_hist, (b) => b.length) || 0
    expect(zoom_max).toBeGreaterThanOrEqual(zoom_expected)
  })

  test(`log y-scale still uses count-based domain`, async () => {
    mount_histogram({
      series: [{ x: [], y: [1, 1, 1, 1, 1] }],
      bins: 5,
      y_axis: { scale_type: `log`, format: `.2r` },
      y_range: [1, null],
    })
    await Promise.resolve()
    const ticks = get_y_tick_numbers()
    // log scale should not include non-positive ticks
    expect(Math.min(...ticks)).toBeGreaterThan(0)
  })

  test(`mounts with x2-axis series without error`, () => {
    mount_histogram({
      series: [
        { x: [0, 1, 2], y: [70, 72, 68], label: `Mass (kg)` },
        { x: [0, 1, 2], y: [154, 158, 150], label: `Mass (lbs)`, x_axis: `x2` },
      ],
      x2_axis: { label: `Mass (lbs)` },
      mode: `overlay`,
    })
    expect(document.querySelector(`.histogram`)).toBeTruthy()
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
    await Promise.resolve()
    // Verify component mounted without crashing
    expect(document.querySelector(`.histogram`)).toBeTruthy()
  })
})
