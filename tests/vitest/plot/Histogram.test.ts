import { Histogram, type Vec2 } from '$lib'
import { bin, max as d3max } from 'd3-array'
import { mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { axis_label_pivot_y, resize_element } from '../setup'

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
  return nodes
    .map((node) => Number((node.textContent || ``).trim()))
    .filter((val) => !Number.isNaN(val))
}

const get_y_tick_numbers = (): number[] => get_tick_numbers(`y`)

// Mount a histogram, flush one tick, and read its y-axis tick numbers (the common
// arrange+act for the count-domain tests). Resets the DOM, so it's safe to call twice per test.
const y_ticks_after = async (props: Record<string, unknown>): Promise<number[]> => {
  mount_histogram(props)
  await tick()
  return get_y_tick_numbers()
}

const get_svg = () => {
  const svg = document.querySelector(`svg[role="application"]`)
  if (!svg) throw new Error(`histogram plot area not found`)
  return svg
}

const get_plot = (): HTMLElement => {
  const plot = document.querySelector<HTMLElement>(`.histogram`)
  if (!plot) throw new Error(`Histogram root element not found`)
  return plot
}

// happy-dom lacks Touch/TouchEvent constructors, so dispatch plain events
// carrying a touches array (the handlers only read touches[*].clientX/Y)
const touch_event = (type: string, touches: readonly Readonly<Vec2>[]) => {
  const evt = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(evt, `touches`, {
    value: touches.map(([clientX, clientY]) => ({ clientX, clientY })),
  })
  return evt
}

describe(`Histogram`, () => {
  test.each<{
    name: string
    series: { x: number[]; y: number[]; label?: string }[]
    bins: number
    y_axis?: { range: Vec2 }
    expected_min_max: Vec2
  }>([
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
    {
      // A puts all 5 in one bin, B spreads across bins: the y-domain must reflect the
      // taller series (max count across series), so the top tick is >= 5
      name: `uses the maximum count across multiple series`,
      series: [
        { x: [], y: [0, 0, 0, 0, 0], label: `A` },
        { x: [], y: [1, 2, 3, 4, 5], label: `B` },
      ],
      bins: 5,
      expected_min_max: [5, 50],
    },
    {
      // explicit range caps the auto count domain (max count 5 clamped to 3)
      name: `y_axis.range caps the auto count domain`,
      series: [{ x: [], y: [1, 1, 1, 1, 1] }],
      bins: 5,
      y_axis: { range: [0, 3] },
      expected_min_max: [1, 3],
    },
  ])(`$name`, async ({ series, bins, y_axis, expected_min_max }) => {
    const ticks = await y_ticks_after({ series, bins, y_axis })
    expect(ticks.length).toBeGreaterThan(0)
    const max_tick = Math.max(...ticks)
    expect(max_tick).toBeGreaterThanOrEqual(expected_min_max[0])
    expect(max_tick).toBeLessThanOrEqual(expected_min_max[1])
  })

  // pan must be screen-uniform: on a log axis that's a constant *factor*, not a
  // constant amount. A multi-plot-height wheel pan over [1, 100] must land decades
  // up while still spanning 2 decades - the old linear-space math collapsed the
  // view to a sub-decade slice (and panning down shifted past zero into NaN)
  test(`shift+wheel pan on a log y axis shifts by decades, not linearly`, async () => {
    mount_histogram({
      series: [{ x: [], y: [1, 2, 3, 4, 5], label: `A` }],
      y_axis: { scale_type: `log`, range: [1, 100] },
    })
    await tick()
    const plot = get_svg()
    plot.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Shift` }))
    await tick()
    plot.dispatchEvent(new WheelEvent(`wheel`, { deltaY: 2000, bubbles: true }))
    await tick()
    const ticks = get_y_tick_numbers()
    expect(ticks.length).toBeGreaterThan(0)
    expect(Math.min(...ticks)).toBeGreaterThan(100) // moved decades up from [1, 100]
    // log pan preserves the visible span (a constant factor): ticks still cover >= 1
    // decade; the old linear math left a sub-decade slice here
    expect(Math.max(...ticks) / Math.min(...ticks)).toBeGreaterThanOrEqual(10)
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
    const max_many = Math.max(...(await y_ticks_after({ series, bins: 9 })))
    const max_few = Math.max(...(await y_ticks_after({ series, bins: 3 })))
    expect(max_few).toBeGreaterThanOrEqual(max_many)
  })

  test(`x_axis.range applies domain; y max tick >= computed max bin count`, async () => {
    const series = [{ x: [], y: [0, 0, 1, 1, 1, 2, 2, 10, 10, 10], label: `A` }]
    const max_bin_count = (domain?: [number, number]): number =>
      d3max(
        (domain ? bin().domain(domain) : bin()).thresholds(5)(series[0].y),
        (bucket) => bucket.length,
      ) ?? 0

    const full_max = Math.max(...(await y_ticks_after({ series, bins: 5 })))
    expect(full_max).toBeGreaterThanOrEqual(max_bin_count())

    const zoom_max = Math.max(
      ...(await y_ticks_after({ series, bins: 5, x_axis: { range: [0, 3] } })),
    )
    expect(zoom_max).toBeGreaterThanOrEqual(max_bin_count([0, 3]))
  })

  test(`log y-scale: positive count-based domain; non-positive explicit bound falls back to auto`, async () => {
    const series = [{ x: [], y: [1, 1, 1, 1, 1] }]
    // auto and an explicit positive lower both yield a count-based domain with no non-positive ticks
    const auto = await y_ticks_after({ series, bins: 5, y_axis: { scale_type: `log` } })
    expect(auto.length).toBeGreaterThan(0) // guard: Math.min(...[]) is Infinity -> false pass
    expect(Math.min(...auto)).toBeGreaterThan(0)
    const pinned = await y_ticks_after({
      series,
      bins: 5,
      y_axis: { scale_type: `log`, range: [1, null] },
    })
    expect(pinned.length).toBeGreaterThan(0)
    expect(Math.min(...pinned)).toBeGreaterThan(0)
    // an invalid (<= 0) explicit lower is ignored, falling back to the auto minimum (the old
    // `y_limit[0] ?? ...` kept the 0 verbatim, yielding a broken log domain starting at 0)
    const zero_lower = await y_ticks_after({
      series,
      bins: 5,
      y_axis: { scale_type: `log`, range: [0, null] },
    })
    expect(zero_lower).toEqual(auto)
    // a non-positive upper bound is likewise invalid on a log axis and falls back to the auto domain
    const y_axis = { scale_type: `log`, range: [null, -5] }
    const neg_upper = await y_ticks_after({ series, bins: 5, y_axis })
    expect(neg_upper).toEqual(auto)
  })

  test(`log y-scale renders bins with one count at visible height`, async () => {
    mount_histogram({
      series: [{ x: [], y: [1, 100], label: `Sparse tail` }],
      bins: 2,
      bar: { border_radius: 0 }, // radius-free path so the height shows up as a parseable `v{h}` segment
      y_axis: { scale_type: `log` },
    })
    await resize_element(get_plot(), 400, 300)

    const bars = [...document.querySelectorAll(`g.histogram-series path[role="button"]`)]
    expect(bars).toHaveLength(2)
    // each singleton-count bin must have visible height: the old log y-range floored at the count,
    // collapsing them to ~0px at the baseline. extract the radius-free bar_path's relative `v{h}`
    // segment tolerantly (whitespace, any following command) so format tweaks don't yield NaN.
    for (const bar of bars) {
      const height = Number(
        /v\s*(?<h>-?\d*\.?\d+)/.exec(bar.getAttribute(`d`) ?? ``)?.groups?.h,
      )
      expect(height).toBeGreaterThan(2)
    }
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

  test(`y2 axis title shares the y axis title's vertical center`, async () => {
    mount_histogram({
      series: [
        { x: [], y: [1, 2, 3], label: `Main` },
        { x: [], y: [10, 20, 30], label: `Sec`, y_axis: `y2` },
      ],
      mode: `overlay`, // single mode (default) would drop the y2 series
      y_axis: { label: `Primary` },
      y2_axis: { label: `Secondary` },
    })
    await resize_element(get_plot(), 400, 300) // axis labels only render once the plot has a size
    // both y titles rotate about the plot's vertical center; a stale label_shift default
    // used to push the y2 title 60px below center
    const pivot_y = (selector: string) => axis_label_pivot_y(document, selector)
    expect(pivot_y(`.axis-label.y2-label`)).toBeCloseTo(pivot_y(`.axis-label.y-label`), 5)
  })

  test(`legend=null suppresses the legend even with show_legend=true`, async () => {
    mount_histogram({
      series: [
        { x: [], y: [1, 2, 3], label: `A` },
        { x: [], y: [2, 3, 4], label: `B` },
      ],
      legend: null,
      show_legend: true,
    })
    await tick()
    expect(document.querySelector(`.histogram`)).toBeInstanceOf(HTMLElement)
    expect(document.querySelector(`.legend`)).toBeNull()
  })

  // oxfmt-ignore
  test.each([
    {
      // 1px apart: passes a Number.EPSILON guard, so curr_dist / start_dist would
      // blow up the zoom factor without the MIN_TOUCH_DISTANCE_PIXELS guard
      name: `near-coincident two-finger start is ignored (no explosive pinch zoom)`,
      events: [[`touchstart`, [[100, 100], [101, 100]]], [`touchmove`, [[50, 100], [250, 100]]]],
    },
    {
      // OS-cancelled gesture (e.g. notification swipe) fires touchcancel, not touchend;
      // stale touch state must not let the later touchmove pan
      name: `touchcancel clears touch state so later touchmove does not pan`,
      events: [
        [`touchstart`, [[100, 100], [200, 100]]],
        [`touchcancel`, []],
        [`touchmove`, [[150, 150], [250, 150]]],
      ],
    },
    {
      // One contact starts in the left axis margin. Moving both contacts into the
      // plot must not retroactively arm a pinch gesture.
      name: `two-finger start spanning the plot margin is ignored`,
      events: [
        [`touchstart`, [[10, 100], [100, 100]]],
        [`touchmove`, [[100, 100], [300, 100]]],
      ],
    },
  ] as const)(`$name`, async ({ events }) => {
    mount_histogram({ series: [{ x: [], y: [1, 2, 3, 4, 5], label: `A` }] })
    await tick()
    const svg = get_svg()
    const ticks_before = { x: get_tick_numbers(`x`), y: get_y_tick_numbers() }
    expect(ticks_before.x.length).toBeGreaterThan(0)
    for (const [type, touches] of events) svg.dispatchEvent(touch_event(type, touches))
    await tick()
    expect(get_tick_numbers(`x`)).toEqual(ticks_before.x)
    expect(get_y_tick_numbers()).toEqual(ticks_before.y)
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
    expect(Number(legend?.style.top.replace(`px`, ``) ?? `0`)).toBeGreaterThan(150)
  })
})
