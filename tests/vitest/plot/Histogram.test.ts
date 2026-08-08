import { Histogram, type Vec2 } from '$lib'
import type { DataSeries } from '$lib/plot/core/types'
import {
  compute_count_range,
  compute_histogram_bins,
  log_safe_range,
} from '$lib/plot/histogram/histogram'
import { bin, max as d3max } from 'd3-array'
import { mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  axis_label_pivot_y,
  expect_custom_x_ticks_grow_bottom_pad,
  resize_element,
} from '../setup'

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

const get_tick_numbers = (axis: `x` | `y`): number[] =>
  [...document.querySelectorAll(`g.${axis}-axis .tick text`)]
    .map((node) => Number((node.textContent || ``).trim()))
    .filter((val) => !Number.isNaN(val))

const y_ticks_after = async (props: Record<string, unknown>) => {
  mount_histogram(props)
  await tick()
  return get_tick_numbers(`y`)
}

const get_svg = () => {
  const svg = document.querySelector(`svg[role="application"]`)
  if (!svg) throw new Error(`histogram plot area not found`)
  return svg
}
const get_plot = () => {
  const plot = document.querySelector<HTMLElement>(`.histogram`)
  if (!plot) throw new Error(`Histogram root element not found`)
  return plot
}

const clip_rect_attrs = () =>
  [`x`, `y`, `width`, `height`].map((attr) =>
    document.querySelector(`clipPath rect`)?.getAttribute(attr),
  )

const legend_px = (legend: HTMLElement, prop: `top` | `left`) =>
  Number(legend.style[prop].replace(`px`, ``))

const touch_event = (type: string, touches: readonly Readonly<Vec2>[]) => {
  const evt = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(evt, `touches`, {
    value: touches.map(([clientX, clientY]) => ({ clientX, clientY })),
  })
  return evt
}

// oxfmt-ignore
const series_of = (values: number[], extra: Partial<DataSeries> = {}): DataSeries => ({ x: [], y: values, ...extra })
// oxfmt-ignore
const histogram_cfg = { x_domain: [0, 10] as Vec2, x2_domain: [100, 200] as Vec2, bin_count: 5, series_color: () => `steelblue` }
const histogram_bins = (
  entries: Parameters<typeof compute_histogram_bins>[0],
  has_x2 = false,
) => compute_histogram_bins(entries, { ...histogram_cfg, has_x2 })
const count_cfg = { ...histogram_cfg, y_limit: [null, null] as [null, null], range_padding: 0 }
const count_range = (
  series: DataSeries[],
  scale_type: `linear` | `log`,
  y_limit: [number | null, number | null] = [null, null],
) => compute_count_range(series, { ...count_cfg, scale_type, y_limit })

describe(`Histogram`, () => {
  afterEach(() => vi.restoreAllMocks())

  test(`count domains and log interactions`, async () => {
    const assert_y_max = async (props: Record<string, unknown>, lo: number, hi: number) => {
      const ticks = await y_ticks_after(props)
      expect(ticks.length).toBeGreaterThan(0)
      const max_tick = Math.max(...ticks)
      expect(max_tick).toBeGreaterThanOrEqual(lo)
      expect(max_tick).toBeLessThanOrEqual(hi)
    }
    // oxfmt-ignore
    for (const [props, lo, hi] of [
      [{ series: [{ x: [], y: [1, 1, 1, 1, 1], label: `A` }], bins: 5 }, 5, 50],
      [{ series: [{ x: [], y: [1000, 2000, 3000, 4000, 5000], label: `B` }], bins: 5 }, 1, 20],
      [{ series: [{ x: [], y: [0, 0, 0, 0, 0], label: `A` }, { x: [], y: [1, 2, 3, 4, 5], label: `B` }], bins: 5 }, 5, 50],
      [{ series: [{ x: [], y: [1, 1, 1, 1, 1] }], bins: 5, y_axis: { range: [0, 3] } }, 1, 3],
    ] as const) {
      await assert_y_max(props, lo, hi)
    }

    const spread = [{ x: [], y: [1, 2, 3, 4, 5, 6, 7, 8, 9], label: `A` }]
    const max_many = Math.max(...(await y_ticks_after({ series: spread, bins: 9 })))
    expect(
      Math.max(...(await y_ticks_after({ series: spread, bins: 3 }))),
    ).toBeGreaterThanOrEqual(max_many)

    const series = [{ x: [], y: [0, 0, 1, 1, 1, 2, 2, 10, 10, 10], label: `A` }]
    const max_bin_count = (domain?: [number, number]) =>
      d3max(
        (domain ? bin().domain(domain) : bin()).thresholds(5)(series[0].y),
        (bucket) => bucket.length,
      ) ?? 0
    expect(Math.max(...(await y_ticks_after({ series, bins: 5 })))).toBeGreaterThanOrEqual(
      max_bin_count(),
    )
    expect(
      Math.max(...(await y_ticks_after({ series, bins: 5, x_axis: { range: [0, 3] } }))),
    ).toBeGreaterThanOrEqual(max_bin_count([0, 3]))

    const log_series = [{ x: [], y: [1, 1, 1, 1, 1] }]
    const log_ticks = (range?: [number | null, number | null]) =>
      y_ticks_after({
        series: log_series,
        bins: 5,
        y_axis: { scale_type: `log`, ...(range ? { range } : {}) },
      })
    const valid_ticks = [await log_ticks(), await log_ticks([1, null])]
    for (const ticks of valid_ticks) {
      expect(ticks.length).toBeGreaterThan(0)
      expect(Math.min(...ticks)).toBeGreaterThan(0)
    }
    for (const invalid_range of [
      [0, null],
      [null, -5],
    ] as const) {
      expect(await log_ticks([...invalid_range])).toEqual(valid_ticks[0])
    }

    mount_histogram({
      series: [{ x: [], y: [1, 100], label: `Sparse tail` }],
      bins: 2,
      bar: { border_radius: 0 },
      y_axis: { scale_type: `log` },
    })
    await resize_element(get_plot(), 400, 300)
    const bars = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      const height = Number(
        /v\s*(?<h>-?\d*\.?\d+)/.exec(bar.getAttribute(`d`) ?? ``)?.groups?.h,
      )
      expect(height).toBeGreaterThan(2)
    }

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
    const pan_ticks = get_tick_numbers(`y`)
    expect(pan_ticks.length).toBeGreaterThan(0)
    expect(Math.min(...pan_ticks)).toBeGreaterThan(100)
    expect(Math.max(...pan_ticks) / Math.min(...pan_ticks)).toBeGreaterThanOrEqual(10)
    // many mounts in one test: needs more than the 5s default under parallel load
  }, 20_000)

  test(`series indices, secondary axes, titles, and padding`, async () => {
    const repeated = { x: [], y: [0, 1, 2], label: `Repeated` }
    for (const [props, expected_indices] of [
      [
        {
          series: [
            { x: [], y: [0, 1, 2], label: `Hidden`, visible: false },
            { x: [], y: [1, 1, 2], label: `Visible` },
          ],
          show_legend: true,
        },
        [`1`],
      ],
      [{ series: [repeated, repeated], show_legend: true }, [`0`, `1`]],
      [
        {
          series: [{ x: [], y: [1, 2, 3], label: `Band Gap` }],
          mode: `single`,
          selected_property: `Energy`,
        },
        [`0`],
      ],
    ] as const) {
      mount_histogram(props)
      await tick()
      const groups = Array.from(document.querySelectorAll(`g.histogram-series`))
      expect(groups.map((element) => element.getAttribute(`data-series-idx`))).toEqual(
        expected_indices,
      )
      for (const group of groups) {
        expect(group.getAttribute(`clip-path`)).toMatch(/^url\(#histogram-clip/)
      }
    }

    mount_histogram({
      series: [
        { x: [], y: [70, 72, 68], label: `Mass (kg)` },
        { x: [], y: [154, 154, 154, 154, 158], label: `Mass (lbs)`, x_axis: `x2` },
      ],
      bins: 5,
      x2_axis: { label: `Mass (lbs)` },
      mode: `overlay`,
      show_controls: true,
      controls_open: true,
    })
    await tick()
    expect(document.querySelector(`g.x2-axis`)).toBeInstanceOf(SVGGElement)
    const scale_type_sections = document.querySelectorAll(`[data-testid="scale-type-section"]`)
    expect(scale_type_sections).toHaveLength(1)
    expect(
      [...scale_type_sections[0].querySelectorAll(`label > span:first-child`)].map(
        (label) => label.textContent,
      ),
    ).toEqual([`X`, `X2`, `Y`])
    const x_ticks = get_tick_numbers(`x`)
    expect(x_ticks.length).toBeGreaterThan(0)
    expect(Math.max(...x_ticks)).toBeLessThan(100)
    expect(Math.max(...get_tick_numbers(`y`))).toBeGreaterThanOrEqual(4)

    for (const axis of [`x2`, `y2`] as const) {
      mount_histogram({
        series: [
          { x: [], y: [1, 2], y_axis: `y1` },
          axis === `x2`
            ? { x: [], y: [NaN, NaN], x_axis: `x2` }
            : { x: [], y: [NaN, NaN], y_axis: `y2` },
        ],
        mode: `overlay`,
      })
      await tick()
      expect(document.querySelector(`g.${axis}-axis`)).toBeNull()
    }

    mount_histogram({
      series: [
        { x: [], y: [1, 2, 3], label: `Main` },
        { x: [], y: [10, 20, 30], label: `Sec`, y_axis: `y2` },
      ],
      mode: `overlay`,
      y_axis: { label: `Primary` },
      y2_axis: { label: `Secondary` },
    })
    await resize_element(get_plot(), 400, 300)
    const pivot_y = (selector: string) => axis_label_pivot_y(document, selector)
    expect(pivot_y(`.axis-label.y2-label`)).toBeCloseTo(pivot_y(`.axis-label.y-label`), 5)

    mount_histogram({
      series: [
        { x: [], y: [1, 2, 3], label: `Main` },
        { x: [], y: [10, 20, 30], label: `Y2`, y_axis: `y2` },
        { x: [], y: [100, 200, 300], label: `X2`, x_axis: `x2` },
      ],
      mode: `overlay`,
      padding: { r: 10, t: 10 },
      x2_axis: { label: `Top` },
      y2_axis: { label: `Secondary` },
    })
    await resize_element(get_plot(), 400, 300)
    const clip_rect = document.querySelector(`clipPath rect`)
    const clip_x = Number(clip_rect?.getAttribute(`x`))
    expect(Number(clip_rect?.getAttribute(`width`))).toBe(400 - clip_x - 10)
    expect(Number(clip_rect?.getAttribute(`y`))).toBe(10)

    vi.spyOn(HTMLCanvasElement.prototype, `getContext`).mockReturnValue({
      font: ``,
      measureText: () => ({ width: 120 }),
    } as unknown as CanvasRenderingContext2D)
    mount_histogram({
      series: [{ x: [], y: [1, 2, 3], label: `Main` }],
      y_axis: { label: `Count` },
    })
    await resize_element(get_plot(), 400, 300)
    expect(Number(document.querySelector(`clipPath rect`)?.getAttribute(`x`))).toBeGreaterThan(
      60,
    )
    await expect_custom_x_ticks_grow_bottom_pad(
      async (ticks) => {
        mount_histogram({
          series: [{ x: [], y: [0, 1, 2, 3, 4, 5] }],
          x_axis: {
            ticks,
            tick: { label: { auto_layout: { strategies: [`upright`, `rotate`] } } },
          },
        })
        await resize_element(get_plot(), 400, 300)
        return Number(document.querySelector(`g.x-axis > line`)?.getAttribute(`y1`))
      },
      [0, 1, 2, 3, 4, 5],
    )
  })

  test(`property options allow duplicate and empty series labels`, async () => {
    mount_histogram({
      series: [`Repeated`, `Repeated`, ``, undefined].map((label) =>
        series_of([1], { label }),
      ),
      mode: `single`,
      show_controls: true,
      controls_open: true,
    })
    await tick()

    const property_select = [...document.querySelectorAll<HTMLSelectElement>(`select`)].find(
      (select) => select.closest(`label`)?.textContent?.includes(`Property`),
    )
    const option_labels = [...(property_select?.options ?? [])].map(
      (option) => option.textContent,
    )
    expect(option_labels).toEqual([`All`, `Repeated`, `Repeated`, `Series`, `Series`])
  })

  test(`touch gestures keep finite axis ranges`, async () => {
    // oxfmt-ignore
    for (const events of [
      [[`touchstart`, [[100, 100], [101, 100]]], [`touchmove`, [[50, 100], [250, 100]]]],
      [[`touchstart`, [[100, 100], [200, 100]]], [`touchcancel`, []], [`touchmove`, [[150, 150], [250, 150]]]],
      [[`touchstart`, [[10, 100], [100, 100]]], [`touchmove`, [[100, 100], [300, 100]]]],
    ] as const) {
      mount_histogram({ series: [{ x: [], y: [1, 2, 3, 4, 5], label: `A` }] })
      await tick()
      const svg = get_svg()
      const ticks_before = { x: get_tick_numbers(`x`), y: get_tick_numbers(`y`) }
      expect(ticks_before.x.length).toBeGreaterThan(0)
      for (const [type, touches] of events) svg.dispatchEvent(touch_event(type, touches))
      await tick()
      expect(get_tick_numbers(`x`)).toEqual(ticks_before.x)
      expect(get_tick_numbers(`y`)).toEqual(ticks_before.y)
    }
  })

  test(`legend visibility, placement, and layout`, async () => {
    const multi_series = [
      { x: [], y: [1, 2, 3], label: `A` },
      { x: [], y: [2, 3, 4], label: `B` },
    ]
    mount_histogram({ series: multi_series, legend: null, show_legend: true })
    await tick()
    expect(document.querySelector(`.legend`)).toBeNull()
    mount_histogram({
      series: multi_series,
      show_controls: true,
      controls_open: true,
      show_legend: undefined,
    })
    await tick()
    const legend_checkbox = [
      ...document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`),
    ].find((checkbox) => checkbox.parentElement?.textContent?.includes(`Show legend`))
    if (!legend_checkbox) throw new Error(`Show legend checkbox not found`)
    expect(legend_checkbox.checked).toBe(true)
    legend_checkbox.click()
    await tick()
    expect(legend_checkbox.checked).toBe(false)
    expect(document.querySelector(`.legend`)).toBeNull()
    legend_checkbox.click()
    await tick()
    expect(legend_checkbox.checked).toBe(true)
    const reset_legend = document.querySelector<HTMLButtonElement>(
      `button[title="Reset histogram to defaults"]`,
    )
    if (!reset_legend) throw new Error(`Histogram reset button not found`)
    reset_legend.click()
    await tick()
    expect(document.querySelector(`button[title="Reset histogram to defaults"]`)).toBeNull()
    expect(legend_checkbox.checked).toBe(true)

    mount_histogram({
      series: [
        { x: [], y: Array.from({ length: 100 }, () => 0), label: `A` },
        { x: [], y: Array.from({ length: 100 }, () => 1), label: `B` },
      ],
      bins: 20,
      mode: `overlay`,
      show_legend: true,
      legend: {},
    })
    await resize_element(get_plot(), 400, 300)
    const sparse_legend = document.querySelector<HTMLElement>(`.legend`)
    const sparse_clip = document.querySelector(`clipPath rect`)
    if (!sparse_legend || !sparse_clip) throw new Error(`legend or clip rectangle not found`)
    expect(legend_px(sparse_legend, `top`)).toBeLessThan(
      Number(sparse_clip.getAttribute(`y`)) + Number(sparse_clip.getAttribute(`height`)),
    )

    const uniform = Array.from({ length: 800 }, (_, idx) => idx % 100)
    const mount_uniform = (style?: string) =>
      mount_histogram({
        series: [
          { x: [], y: uniform, label: `A` },
          { x: [], y: uniform.map((val) => val + 0.5), label: `B` },
        ],
        bins: 40,
        mode: `overlay`,
        show_legend: true,
        legend: {},
        ...(style ? { style } : {}),
      })
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(180)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(44)
    mount_uniform()
    await resize_element(get_plot(), 400, 300)
    const initial_legend = document.querySelector<HTMLElement>(`.legend`)
    if (!initial_legend) throw new Error(`legend not found`)
    expect(legend_px(initial_legend, `top`)).toBe(300 - 44 - 8)
    mount_uniform(`width: 640px; height: 340px;`)
    await resize_element(get_plot(), 640, 340)
    const resized_legend = document.querySelector<HTMLElement>(`.legend`)
    if (!resized_legend) throw new Error(`legend not found`)
    expect(legend_px(resized_legend, `left`)).toBeGreaterThan(
      legend_px(initial_legend, `left`),
    )
    expect(legend_px(resized_legend, `top`)).toBe(340 - 44 - 8)
    const stable_clip = clip_rect_attrs()
    mount_uniform(`width: 640px; height: 340px;`)
    await resize_element(get_plot(), 640, 340)
    expect(clip_rect_attrs()).toEqual(stable_clip)

    const layout_series = Array.from({ length: 4 }, (_, series_idx) => ({
      x: [],
      y: [series_idx, series_idx + 0.5, series_idx + 1],
      label: `Series ${series_idx}`,
    }))
    const layout_legend = {
      layout: `horizontal` as const,
      layout_tracks: `auto` as const,
      item_extents: layout_series.map(() => ({ width: 70, height: 20 })),
    }
    for (const [width, cols] of [
      [400, 4],
      [280, 2],
    ] as const) {
      mount_histogram({
        series: layout_series,
        mode: `overlay`,
        show_legend: true,
        legend: layout_legend,
        style: `width: ${width}px; height: 300px;`,
      })
      await resize_element(get_plot(), width, 300)
      expect(document.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateColumns).toBe(
        `repeat(${cols}, auto)`,
      )
    }

    mount_histogram({
      series: layout_series.slice(0, 2),
      mode: `overlay`,
      show_legend: true,
      legend: { style: `position: absolute; left: 17px; top: 23px;` },
    })
    await resize_element(get_plot(), 400, 300)
    const pinned_legend = document.querySelector<HTMLElement>(`.legend`)
    if (!pinned_legend) throw new Error(`legend not found`)
    expect(pinned_legend.style.left).toBe(`17px`)
    expect(pinned_legend.style.top).toBe(`23px`)
    const pinned_clip = clip_rect_attrs()
    mount_histogram({
      series: layout_series.slice(0, 2),
      mode: `overlay`,
      show_legend: false,
    })
    await resize_element(get_plot(), 400, 300)
    expect(document.querySelector(`.legend`)).toBeNull()
    expect(pinned_clip).toEqual(clip_rect_attrs())
  })

  test(`compute_histogram_bins and compute_count_range`, () => {
    // oxfmt-ignore
    for (const [_name, axis, expected] of [
      [`linear`, { range: [0, 10], scale_type: `linear` }, [0, 10]],
      [`positive log`, { range: [1, 100], scale_type: `log` }, [1, 100]],
      [`zero log lower`, { range: [0, 100], scale_type: `log` }, [null, 100]],
      [`negative log lower`, { range: [-5, 100], scale_type: `log` }, [null, 100]],
      [`non-positive log`, { range: [-5, 0], scale_type: `log` }, [null, null]],
      [`null log`, { range: [null, null], scale_type: `log` }, [null, null]],
      [`negative linear`, { range: [-5, 10], scale_type: `linear` }, [-5, 10]],
      [`missing log range`, { scale_type: `log` }, [null, null]],
    ] as const) {
      expect(log_safe_range(axis as Parameters<typeof log_safe_range>[0])).toEqual(expected)
    }
    const result = histogram_bins([
      { series_data: series_of([1, 1, 1, 9], { label: `alpha` }), series_idx: 0 },
      { series_data: series_of([5, 6]), series_idx: 1 },
      { series_data: series_of([1], { id: `explicit` }), series_idx: 3 },
    ])
    expect(result.map(({ label }) => label)).toEqual([`alpha`, `Series 2`, `Series 4`])
    expect(result.map(({ max_count }) => max_count)).toEqual([3, 1, 1])
    expect(result[0].color).toBe(`steelblue`)
    expect(result[0].bins.reduce((sum, one_bin) => sum + one_bin.length, 0)).toBe(4)
    expect(result[2]).toMatchObject({ id: `explicit`, series_idx: 3 })
    for (const [has_x2, expected_count, max_count] of [
      [true, 2, 1],
      [false, 0, 0],
    ] as const) {
      const [histogram] = histogram_bins(
        [{ series_data: series_of([150, 160], { x_axis: `x2` }), series_idx: 0 }],
        has_x2,
      )
      expect(histogram.bins.reduce((sum, one_bin) => sum + one_bin.length, 0)).toBe(
        expected_count,
      )
      expect(histogram.max_count).toBe(max_count)
    }
    for (const [_name, series, scale_type, expected] of [
      [`linear empty`, [], `linear`, [0, 1]],
      [`log empty`, [], `log`, [1, 1]],
      [`out-of-domain`, [series_of([500, 600])], `linear`, [0, 1]],
    ] as const) {
      expect(count_range([...series], scale_type)).toEqual(expected)
    }
    const lin_range = count_range([series_of([1, 1, 1, 9])], `linear`)
    expect(lin_range[0]).toBe(0)
    expect(lin_range[1]).toBeGreaterThanOrEqual(3)
    const [log_lo, log_hi] = count_range([series_of([1, 1, 1, 1, 9])], `log`)
    expect(log_lo).toBeCloseTo(1 / 1.1, 10)
    expect(log_hi).toBeGreaterThanOrEqual(4)
    expect(count_range([series_of([1, 1, 9])], `log`, [0.5, null])[0]).toBe(0.5)
    expect(
      count_range(
        [series_of([1, 1]), series_of([150, 150, 150, 150], { x_axis: `x2` })],
        `linear`,
      )[1],
    ).toBeGreaterThanOrEqual(4)
    const n_samples = 130_000
    const [lo, hi] = compute_count_range(
      [series_of(Array.from({ length: n_samples }, (_, idx) => idx))],
      {
        ...count_cfg,
        x_domain: [0, n_samples],
        x2_domain: [0, 1],
        bin_count: n_samples,
        scale_type: `linear`,
      },
    )
    expect(Number.isFinite(lo)).toBe(true)
    expect(hi).toBeGreaterThanOrEqual(1)
  })
})
