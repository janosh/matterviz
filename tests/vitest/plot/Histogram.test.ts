import { Histogram } from '$lib'
import { bin, max as d3max } from 'd3-array'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

function mount_histogram(props: Record<string, unknown>) {
  const component = mount(Histogram, {
    target: document.body,
    props: {
      show_controls: false,
      show_legend: false,
      style: `width: 400px; height: 300px;`,
      ...props,
    },
  })
  const root = document.querySelector(`.histogram`)
  expect(component).toBeTruthy()
  expect(root).toBeTruthy()
}

function get_y_tick_numbers(): number[] {
  const nodes = Array.from(document.querySelectorAll(`g.y-axis .tick text`))
  return nodes.map((n) => Number((n.textContent || ``).trim())).filter((v) =>
    !Number.isNaN(v)
  )
}

async function set_size_and_tick(): Promise<number[]> {
  // Allow Svelte to flush reactive updates
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  return get_y_tick_numbers()
}

describe(`Histogram`, () => {
  // Ensure non-zero client size for happy-dom before each mount
  const ensure_client_size = () => {
    try {
      Object.defineProperty(HTMLElement.prototype, `clientWidth`, {
        get: () => 400,
        configurable: true,
      })
      Object.defineProperty(HTMLElement.prototype, `clientHeight`, {
        get: () => 300,
        configurable: true,
      })
    } catch {
      /* ignore defineProperty errors in some environments */
    }
  }

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
    document.body.innerHTML = ``
    ensure_client_size()
    mount_histogram({ series, bins })
    await Promise.resolve()
    const ticks = await set_size_and_tick()
    expect(ticks.length).toBeGreaterThan(0)
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeGreaterThanOrEqual(expected_min_max[0])
    expect(max_tick).toBeLessThanOrEqual(expected_min_max[1])
  })

  test(`multi-series uses maximum counts across series`, async () => {
    document.body.innerHTML = ``
    ensure_client_size()
    mount_histogram({
      series: [
        { x: [], y: [0, 0, 0, 0, 0], label: `A` }, // single bin gets 5
        { x: [], y: [1, 2, 3, 4, 5], label: `B` }, // spread across bins
      ],
      bins: 5,
    })
    await Promise.resolve()
    const ticks = await set_size_and_tick()
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeGreaterThanOrEqual(5)
  })

  test(`bins sensitivity: fewer bins increase per-bin counts`, async () => {
    document.body.innerHTML = ``
    const series = [{ x: [], y: [1, 2, 3, 4, 5, 6, 7, 8, 9], label: `A` }]
    ensure_client_size()
    mount_histogram({ series, bins: 9 })
    await Promise.resolve()
    const ticks_many = await set_size_and_tick()
    const max_many = Math.max(...ticks_many)

    document.body.innerHTML = ``
    ensure_client_size()
    mount_histogram({ series, bins: 3 })
    await Promise.resolve()
    const ticks_few = await set_size_and_tick()
    const max_few = Math.max(...ticks_few)

    expect(max_few).toBeGreaterThanOrEqual(max_many)
  })

  test(`y_lim caps auto count domain`, async () => {
    document.body.innerHTML = ``
    ensure_client_size()
    mount_histogram({ series: [{ x: [], y: [1, 1, 1, 1, 1] }], bins: 5, y_lim: [0, 3] })
    await Promise.resolve()
    const ticks = await set_size_and_tick()
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeLessThanOrEqual(3)
  })

  test(`x_lim applies domain; y max tick >= computed max bin count`, async () => {
    document.body.innerHTML = ``
    const series = [{ x: [], y: [0, 0, 1, 1, 1, 2, 2, 10, 10, 10], label: `A` }]
    ensure_client_size()
    mount_histogram({ series, bins: 5 })
    await Promise.resolve()
    const ticks_full = await set_size_and_tick()
    const full_max = Math.max(...ticks_full)
    const full_hist = bin().thresholds(5)(series[0].y)
    const full_expected = d3max(full_hist, (b) => b.length) || 0
    expect(full_max).toBeGreaterThanOrEqual(full_expected)

    document.body.innerHTML = ``
    ensure_client_size()
    mount_histogram({ series, bins: 5, x_lim: [0, 3] })
    await Promise.resolve()
    const ticks_zoom = await set_size_and_tick()
    const zoom_max = Math.max(...ticks_zoom)
    const zoom_hist = bin().domain([0, 3]).thresholds(5)(series[0].y)
    const zoom_expected = d3max(zoom_hist, (b) => b.length) || 0
    expect(zoom_max).toBeGreaterThanOrEqual(zoom_expected)
  })

  test(`log y-scale still uses count-based domain`, async () => {
    document.body.innerHTML = ``
    ensure_client_size()
    mount_histogram({
      series: [{ x: [], y: [1, 1, 1, 1, 1] }],
      bins: 5,
      y_scale_type: `log`,
      y_format: `.2f`,
      y_lim: [1, null],
    })
    await Promise.resolve()
    const ticks = await set_size_and_tick()
    // log scale should not include non-positive ticks
    expect(Math.min(...ticks)).toBeGreaterThan(0)
  })
})
