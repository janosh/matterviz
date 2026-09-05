import { Histogram, type Vec2 } from '$lib'
import type { HistogramSeries } from '$lib/plot/histogram/histogram'
import {
  bin_values,
  compute_count_range,
  compute_histogram_bins,
  log_safe_range,
  normalize_counts,
} from '$lib/plot/histogram/histogram'
import { tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  doc_query,
  mount_sized,
  one_tab_stop,
  pattern_id_of,
  plot_svg,
  roving_tabindexes,
} from '../setup'

// Controls and legend are off unless a test asks for them. Props are mutated in place (not
// spread) so bind_props accessors survive.
const mount_histogram = (
  props: Record<string, unknown>,
  size: { width?: number; height?: number } = {},
): Promise<HTMLElement> => {
  document.body.innerHTML = ``
  for (const [key, value] of Object.entries({ show_controls: false, show_legend: false })) {
    if (!(key in props)) props[key] = value
  }
  return mount_sized(Histogram, props, { selector: `.histogram`, ...size })
}

// Bar geometry read back out of the rendered path. radius defaults to 0, so bars render as
// `M<x>,<y>h<width>v<height>h-<width>Z`, and bar_path is fed min/abs coords so width and
// height are always positive. Rounded because the two scale directions differ by float dust
// in the last ULP.
const bar_boxes = () =>
  [...document.querySelectorAll<SVGPathElement>(`g.histogram-series path`)].map((bar) => {
    const path = bar.getAttribute(`d`) ?? ``
    const match = /^M(?<x>[-\d.]+),(?<y>[-\d.]+)h(?<width>[-\d.]+)v(?<height>[-\d.]+)/.exec(
      path,
    )
    if (!match?.groups) throw new Error(`unparsable bar path: ${path}`)
    const round = (num: number) => Number(num.toFixed(6))
    const [left, top] = [Number(match.groups.x), Number(match.groups.y)]
    const [width, height] = [Number(match.groups.width), Number(match.groups.height)]
    return {
      left: round(left),
      right: round(left + width),
      top: round(top),
      bottom: round(top + height),
      height: round(height),
    }
  })

const get_tick_numbers = (axis: `x` | `y`): number[] =>
  [...document.querySelectorAll(`g.${axis}-axis .tick text`)]
    .map((node) => Number((node.textContent || ``).trim()))
    .filter((val) => !Number.isNaN(val))

const y_ticks_after = async (props: Record<string, unknown>) => {
  await mount_histogram(props)
  return get_tick_numbers(`y`)
}
const max_y_tick = async (props: Record<string, unknown>) =>
  Math.max(...(await y_ticks_after(props)))

const touch_event = (type: string, touches: readonly Readonly<Vec2>[]) => {
  const evt = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(evt, `touches`, {
    value: touches.map(([clientX, clientY]) => ({ clientX, clientY })),
  })
  return evt
}

// oxfmt-ignore
const series_of = (values: number[], extra: Partial<HistogramSeries> = {}): HistogramSeries => ({ values, ...extra })
// oxfmt-ignore
const histogram_cfg = { x_domain: [0, 10] as Vec2, x2_domain: [100, 200] as Vec2, bins: 5, series_color: () => `steelblue` }
const histogram_bins = (
  entries: Parameters<typeof compute_histogram_bins>[0],
  overrides: Partial<Parameters<typeof compute_histogram_bins>[1]> = {},
) => compute_histogram_bins(entries, { ...histogram_cfg, ...overrides })
// count range of a set of series binned over histogram_cfg's domains
const count_range = (
  series: HistogramSeries[],
  scale_type: `linear` | `log`,
  y_limit: [number | null, number | null] = [null, null],
) =>
  compute_count_range(
    histogram_bins(series.map((series_data, series_idx) => ({ series_data, series_idx }))),
    { scale_type, y_limit, range_padding: 0 },
  )
const counts_of = (...args: Parameters<typeof bin_values>) =>
  Array.from(bin_values(...args).counts)

describe(`Histogram`, () => {
  afterEach(() => vi.restoreAllMocks())
  // Regression: every mark used to carry tabindex=0, so tabbing past a chart meant
  // one press per bin/point/box. Exactly one mark holds the group's tab stop.
  test(`marks are reachable by Tab exactly once`, async () => {
    const tabindexes = roving_tabindexes(
      await mount_histogram({
        series: [{ values: [1, 2, 2, 3, 3, 3, 4, 5, 6, 7], label: `H` }],
      }),
    )
    expect(tabindexes.length).toBeGreaterThan(1)
    expect(tabindexes).toEqual(one_tab_stop(tabindexes.length))
  })

  // oxfmt-ignore
  test.each([
    [`a single stacked bin`, { series: [{ values: [1, 1, 1, 1, 1], label: `A` }], bins: 5 }, 5, 50],
    [`spread-out values`, { series: [{ values: [1000, 2000, 3000, 4000, 5000], label: `B` }], bins: 5 }, 1, 20],
    [`two series`, { series: [{ values: [0, 0, 0, 0, 0], label: `A` }, { values: [1, 2, 3, 4, 5], label: `B` }], bins: 5 }, 5, 50],
    [`an explicit y range`, { series: [{ values: [1, 1, 1, 1, 1] }], bins: 5, y_axis: { range: [0, 3] } }, 1, 3],
  ] as const)(`count axis spans the tallest bin for %s`, async (_name, props, lo, hi) => {
    const ticks = await y_ticks_after(props)
    expect(ticks.length).toBeGreaterThan(0)
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(lo)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(hi)
  })

  test(`fewer bins and a clipped x range change the count domain`, async () => {
    const spread = [{ values: [1, 2, 3, 4, 5, 6, 7, 8, 9], label: `A` }]
    const max_many = await max_y_tick({ series: spread, bins: 9 })
    expect(await max_y_tick({ series: spread, bins: 3 })).toBeGreaterThanOrEqual(max_many)

    // 5 uniform bins over [0, 10]: [0,2) holds five samples; over [0, 3] (width 0.6) the
    // three 1s share a bin and the 10s fall outside the domain
    const series = [{ values: [0, 0, 1, 1, 1, 2, 2, 10, 10, 10], label: `A` }]
    expect(await max_y_tick({ series, bins: 5 })).toBeGreaterThanOrEqual(5)
    const clipped = await max_y_tick({ series, bins: 5, x_axis: { range: [0, 3] } })
    expect(clipped).toBeGreaterThanOrEqual(3)
    expect(clipped).toBeLessThan(5)
  })

  test(`log count axis ignores non-positive range bounds and keeps sparse bars visible`, async () => {
    const log_series = [{ values: [1, 1, 1, 1, 1] }]
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

    await mount_histogram({
      series: [{ values: [1, 100], label: `Sparse tail` }],
      bins: 2,
      bar: { border_radius: 0 },
      y_axis: { scale_type: `log` },
    })
    const bars = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      const height = Number(
        /v\s*(?<h>-?\d*\.?\d+)/.exec(bar.getAttribute(`d`) ?? ``)?.groups?.h,
      )
      expect(height).toBeGreaterThan(2)
    }
  })

  test(`shift-wheel pans a log count axis by decades`, async () => {
    await mount_histogram({
      series: [{ values: [1, 2, 3, 4, 5], label: `A` }],
      y_axis: { scale_type: `log`, range: [1, 100] },
    })
    const plot = plot_svg()
    plot.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Shift` }))
    await tick()
    plot.dispatchEvent(new WheelEvent(`wheel`, { deltaY: 2000, bubbles: true }))
    await tick()
    const pan_ticks = get_tick_numbers(`y`)
    expect(pan_ticks.length).toBeGreaterThan(0)
    expect(Math.min(...pan_ticks)).toBeGreaterThan(100)
    expect(Math.max(...pan_ticks) / Math.min(...pan_ticks)).toBeGreaterThanOrEqual(10)
  })

  const repeated = { values: [0, 1, 2], label: `Repeated` }
  // Keyed on the visible subset, `single` mode painted every swatch the shared bar color
  test(`legend swatches stay per-series in single mode`, async () => {
    await mount_histogram({
      series: [`A`, `B`, `C`].map((label) => ({ values: [1, 2, 3], label })),
      mode: `single`,
      selected_property: `B`,
      bins: 3,
      show_legend: true,
      bar: { color: `rebeccapurple` },
    })
    const swatches = [...document.querySelectorAll(`.legend-item .legend-marker path`)].map(
      (path) => path.getAttribute(`fill`),
    )
    expect(swatches).toHaveLength(3)
    expect(new Set(swatches).size).toBe(3)
    expect(swatches).not.toContain(`rebeccapurple`)
  })

  test.each([
    [
      `skips hidden series`,
      {
        series: [
          { values: [0, 1, 2], label: `Hidden`, visible: false },
          { values: [1, 1, 2], label: `Visible` },
        ],
        show_legend: true,
      },
      [`1`],
    ],
    [
      `keeps duplicate labels apart`,
      { series: [repeated, repeated], show_legend: true },
      [`0`, `1`],
    ],
    [
      `ignores an unmatched selected_property in single mode`,
      {
        series: [{ values: [1, 2, 3], label: `Band Gap` }],
        mode: `single`,
        selected_property: `Energy`,
      },
      [`0`],
    ],
  ] as const)(
    `series indexing %s and clips every series group`,
    async (_name, props, indices) => {
      await mount_histogram({ ...props })
      const groups = Array.from(document.querySelectorAll(`g.histogram-series`))
      expect(groups.map((element) => element.getAttribute(`data-series-idx`))).toEqual(indices)
      for (const group of groups) {
        expect(group.getAttribute(`clip-path`)).toMatch(/^url\(#histogram-clip/)
      }
    },
  )

  test(`x2 series bin on their own axis and expose it in the scale-type controls`, async () => {
    await mount_histogram({
      series: [
        { values: [70, 72, 68], label: `Mass (kg)` },
        { values: [154, 154, 154, 154, 158], label: `Mass (lbs)`, x_axis: `x2` },
      ],
      bins: 5,
      x2_axis: { label: `Mass (lbs)` },
      mode: `overlay`,
      show_controls: true,
      controls_open: true,
    })
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
  })

  test(`legend toggles preserve bound sample arrays and colors`, async () => {
    const first_series = { values: [1, 1, 2, 3, 5], label: `A`, color: `red` }
    const second_series = { values: [2, 4, 4, 6, 9], label: `B`, color: `blue` }
    const state = { series: [first_series, second_series] }
    await mount_histogram(bind_props({ bins: 4, mode: `overlay`, show_legend: true }, state))
    const legend_items = document.querySelectorAll<HTMLElement>(`.legend-item`)
    expect(legend_items).toHaveLength(2)
    const fills = [...document.querySelectorAll(`g.histogram-series path`)].map((bar) =>
      bar.getAttribute(`fill`),
    )
    expect(new Set(fills)).toEqual(new Set([`red`, `blue`]))
    legend_items[1].click()
    await tick()
    expect(state.series[0]).toBe(first_series)
    expect(state.series[1]).toStrictEqual({ ...second_series, visible: false })
    expect(state.series[1].values).toBe(second_series.values)
  })

  // Regression on both axes, one flip at a time against a shared ascending reference:
  // - x: bin edges are always ascending, so on a descending x range x_scale(bin.x0) is the
  //   bar's RIGHT edge. Using it as the left edge shifted every bar one full bin outward,
  //   pushing the last bar past the clip rect.
  // - y: on a descending value range the baseline sits ABOVE the bar's value pixel, so
  //   `baseline - y_scale(value)` went negative and `Math.max(0, ...)` clamped every bar to
  //   zero height, leaving the chart completely empty.
  test(`bars mirror rather than shift or vanish on reversed x and y ranges`, async () => {
    const props = { series: [{ values: [1, 3, 5, 7, 9], label: `A` }], bins: 5 }
    const spans = (boxes: ReturnType<typeof bar_boxes>) =>
      boxes.map(({ left, right }) => [left, right])

    // oxfmt-ignore
    await mount_histogram({ ...props, x_axis: { range: [0, 10] }, y_axis: { range: [0, 100] } })
    const ascending = bar_boxes()
    expect(ascending).toHaveLength(5)

    // bin_idx still runs low-to-high in data, so on a flipped x axis the bars run right-to-left
    // oxfmt-ignore
    await mount_histogram({ ...props, x_axis: { range: [10, 0] }, y_axis: { range: [0, 100] } })
    const flipped_x = bar_boxes()
    expect(flipped_x).toHaveLength(5)
    expect(spans(flipped_x)).toEqual(spans(ascending).toReversed())

    // flipping the count axis leaves the bars where they are horizontally and only mirrors
    // them vertically: same heights, but count 0 moves from the bottom of the plot to the top,
    // so every bar hangs down from the baseline instead of standing on it
    // oxfmt-ignore
    await mount_histogram({ ...props, x_axis: { range: [0, 10] }, y_axis: { range: [100, 0] } })
    const flipped_y = bar_boxes()
    expect(flipped_y).toHaveLength(5)
    expect(spans(flipped_y)).toEqual(spans(ascending))
    expect(flipped_y.map((box) => box.height)).toEqual(ascending.map((box) => box.height))
    expect(new Set(ascending.map((box) => box.bottom)).size).toBe(1)
    expect(new Set(flipped_y.map((box) => box.top)).size).toBe(1)
    expect(flipped_y[0].top).toBeLessThan(ascending[0].bottom)
  })

  // Regression: the obstacle field feeding automatic decoration placement rejected any
  // reversed axis range as degenerate, so on a flipped count axis it came out empty and the
  // auto-placed legend landed on top of the bars.
  test(`automatic legend placement avoids the bars on a reversed y range`, async () => {
    const [legend_width, legend_height] = [120, 60]
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(legend_width)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(legend_height)
    const legend_overlaps_bars = async (y_range: Vec2) => {
      await mount_histogram({
        series: [{ values: [1, 3, 5, 7, 9], label: `A` }],
        bins: 5,
        show_legend: true,
        y_axis: { range: y_range },
      })
      const legend = doc_query(`.legend`)
      const left = Number(legend.style.left.replace(`px`, ``))
      const top = Number(legend.style.top.replace(`px`, ``))
      const bars = bar_boxes()
      expect(bars).toHaveLength(5)
      return bars.some(
        (bar) =>
          left < bar.right &&
          left + legend_width > bar.left &&
          top < bar.bottom &&
          top + legend_height > bar.top,
      )
    }
    // bars stand on the bottom baseline on [0, 2] and hang from the top one on [2, 0], so the
    // solver has to see the obstacles move to keep the legend clear in both
    expect(await legend_overlaps_bars([0, 2])).toBe(false)
    expect(await legend_overlaps_bars([2, 0])).toBe(false)
  })

  test(`property options allow duplicate and empty series labels`, async () => {
    await mount_histogram({
      series: [`Repeated`, `Repeated`, ``, undefined].map((label) =>
        series_of([1], { label }),
      ),
      mode: `single`,
      show_controls: true,
      controls_open: true,
    })

    const property_select = [...document.querySelectorAll<HTMLSelectElement>(`select`)].find(
      (select) => select.closest(`label`)?.textContent?.includes(`Property`),
    )
    const option_labels = [...(property_select?.options ?? [])].map(
      (option) => option.textContent,
    )
    expect(option_labels).toEqual([`Repeated`, `Repeated`, `Series`, `Series`])
    // the select shows the active series (first visible label) even though the bound
    // selected_property was never set: single mode never shows "all"
    expect(property_select?.value).toBe(`Repeated`)
    expect(document.querySelectorAll(`g.histogram-series`)).toHaveLength(2)
  })

  test(`binds style and normalize controls to the public props`, async () => {
    const state = { bar: { color: `#112233` }, normalize: `count` as const }
    await mount_histogram(
      bind_props(
        {
          series: [series_of([1], { label: `Only` })],
          show_controls: true,
          controls_open: true,
        },
        state,
      ),
    )
    const fill_input = doc_query<HTMLInputElement>(`input[type="color"]`)
    fill_input.value = `#abcdef`
    fill_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    expect(state.bar).toEqual({ color: `#abcdef` })
    // the controls pane's normalize select writes back into a bound normalize prop
    const normalize_select = [...document.querySelectorAll<HTMLSelectElement>(`select`)].find(
      (select) => select.parentElement?.textContent?.includes(`Normalize`),
    )
    if (!normalize_select) throw new Error(`Histogram normalize select not found`)
    expect(normalize_select.value).toBe(`count`)
    normalize_select.value = `density`
    // Svelte's select binding reads the chosen option via querySelector(':checked'), which
    // happy-dom doesn't match on <option> (it would fall back to the first option)
    vi.spyOn(normalize_select, `querySelector`).mockImplementation(
      () => normalize_select.selectedOptions[0],
    )
    normalize_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(state.normalize).toBe(`density`)
  })

  test(`bar hover/click handlers receive the bin center, count and label`, async () => {
    const on_bar_hover = vi.fn()
    const on_bar_click = vi.fn()
    await mount_histogram({
      // 5 bins over [0, 10]: [0,2) holds two samples
      series: [series_of([0, 1, 5, 9], { label: `A` })],
      bins: 5,
      normalize: `probability`,
      x_axis: { range: [0, 10] },
      mode: `overlay`,
      on_bar_hover,
      on_bar_click,
    })
    const [first_bar] = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    first_bar.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    // Same payload as the tooltip snippet (HistogramHandlerProps) plus the DOM event, matching BarPlot
    expect(on_bar_hover).toHaveBeenLastCalledWith(
      expect.objectContaining({
        value: 1,
        count: 2,
        property: `A`,
        label: `A`,
        series_idx: 0,
        active_x_axis: `x1`,
        event: expect.any(MouseEvent),
      }),
    )
    const tooltip_text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    expect(tooltip_text).toContain(`Count: 2`)
    expect(tooltip_text).toContain(`Probability: 0.5`)
    expect(tooltip_text).toContain(`A`)
    // Enter/Space activate the bar like a click, other keys are ignored
    for (const key of [`Enter`, ` `, `a`]) {
      first_bar.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
    }
    first_bar.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    expect(on_bar_click).toHaveBeenCalledTimes(3)
    expect(on_bar_click).toHaveBeenLastCalledWith(
      expect.objectContaining({
        value: 1,
        count: 2,
        property: `A`,
        series_idx: 0,
        event: expect.any(MouseEvent),
      }),
    )
    first_bar.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    await tick()
    expect(on_bar_hover).toHaveBeenLastCalledWith(null)
    expect(document.querySelector(`.plot-tooltip`)).toBeNull()
  })

  // oxfmt-ignore
  test.each([
    [`a one-pixel pinch`, [[`touchstart`, [[100, 100], [101, 100]]], [`touchmove`, [[50, 100], [250, 100]]]]],
    [`a cancelled then resumed pinch`, [[`touchstart`, [[100, 100], [200, 100]]], [`touchcancel`, []], [`touchmove`, [[150, 150], [250, 150]]]]],
    [`a pinch from the plot edge`, [[`touchstart`, [[10, 100], [100, 100]]], [`touchmove`, [[100, 100], [300, 100]]]]],
  ] as const)(`%s keeps finite axis ranges`, async (_name, events) => {
    await mount_histogram({ series: [{ values: [1, 2, 3, 4, 5], label: `A` }] })
    const svg = plot_svg()
    const ticks_before = { x: get_tick_numbers(`x`), y: get_tick_numbers(`y`) }
    expect(ticks_before.x.length).toBeGreaterThan(0)
    for (const [type, touches] of events) svg.dispatchEvent(touch_event(type, touches))
    await tick()
    expect(get_tick_numbers(`x`)).toEqual(ticks_before.x)
    expect(get_tick_numbers(`y`)).toEqual(ticks_before.y)
  })

  test(`controls pane toggles the legend and reset restores the default`, async () => {
    await mount_histogram({
      series: [
        { values: [1, 2, 3], label: `A` },
        { values: [2, 3, 4], label: `B` },
      ],
      show_controls: true,
      controls_open: true,
      show_legend: undefined,
    })
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
    const reset_legend = doc_query<HTMLButtonElement>(
      `button[title="Reset histogram to defaults"]`,
    )
    reset_legend.click()
    await tick()
    expect(document.querySelector(`button[title="Reset histogram to defaults"]`)).toBeNull()
    expect(legend_checkbox.checked).toBe(true)
  })

  test.each<[Parameters<typeof log_safe_range>[0], [number | null, number | null]]>([
    [{ range: [0, 10], scale_type: `linear` }, [0, 10]],
    [{ range: [1, 100], scale_type: `log` }, [1, 100]],
    [{ range: [0, 100], scale_type: `log` }, [null, 100]],
    [{ range: [-5, 100], scale_type: `log` }, [null, 100]],
    [{ range: [-5, 0], scale_type: `log` }, [null, null]],
    [{ range: [null, null], scale_type: `log` }, [null, null]],
    [{ range: [-5, 10], scale_type: `linear` }, [-5, 10]],
    [{ scale_type: `log` }, [null, null]],
  ])(`log_safe_range(%j) drops non-positive log bounds -> %j`, (axis, expected) => {
    expect(log_safe_range(axis)).toEqual(expected)
  })

  test(`bin_values: uniform edges in bin space, inclusive upper bound, out-of-domain dropped`, () => {
    const { edges, counts } = bin_values(
      [0, 0.5, 1, 2.5, 4, 5, 7.99, 8, 10, 10.0001, -1, NaN],
      [0, 10],
      5,
    )
    expect(Array.from(edges)).toEqual([0, 2, 4, 6, 8, 10])
    // 10 lands in the last bin (numpy convention); 10.0001, -1 and NaN are dropped
    expect(Array.from(counts)).toEqual([3, 1, 2, 1, 2])
    expect(counts).toBeInstanceOf(Uint32Array)
    // either domain order, non-integer bin count floors, and exact 1/3 edges stay within 1 ulp
    expect(Array.from(bin_values([], [10, 0], 5.9).edges)).toEqual([0, 2, 4, 6, 8, 10])
    const third_edges = Array.from(bin_values([], [0, 1], 3).edges)
    expect(third_edges[0]).toBe(0)
    expect(third_edges[3]).toBe(1)
    expect(third_edges[1]).toBeCloseTo(1 / 3, 15)
    expect(third_edges[2]).toBeCloseTo(2 / 3, 15)
    // a value exactly on an interior edge goes to the upper bin
    expect(counts_of([2, 4, 6, 8], [0, 10], 5)).toEqual([0, 1, 1, 1, 1])
    // collapsed domain: one bin with the samples sitting on it
    expect(bin_values([5, 5, 6], [5, 5], 10)).toEqual({
      edges: Float64Array.of(5, 5),
      counts: Uint32Array.of(2),
    })
  })

  test(`bin_values: weights must align, and non-finite ones drop like non-finite values`, () => {
    const values = [1, 3, 5, 7, 9]
    // a short array yields `undefined` weights, one of which NaNs the whole Float64Array
    expect(() => bin_values(values, [0, 10], 5, `linear`, [1, 2])).toThrow(
      `bin_values got 2 weights for 5 values`,
    )
    expect(counts_of(values, [0, 10], 5, `linear`, [1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4, 5])
    // NaN/Infinity weights are skipped, exactly as a NaN VALUE already is
    expect(counts_of(values, [0, 10], 5, `linear`, [1, NaN, 3, Infinity, 5])).toEqual([
      1, 0, 3, 0, 5,
    ])
    // the collapsed-domain path shares the policy
    expect(Array.from(bin_values([5, 5], [5, 5], 4, `linear`, [2, NaN]).counts)).toEqual([2])
  })

  // n_bins IS the allocation (edges + counts + one <rect> each): 5e7 is a 400 MB Float64Array,
  // and NaN slipped through `Math.max(1, ...)` to a zero-length edge array.
  test.each([[5e7], [NaN], [Infinity]])(`bin_values rejects n_bins %p`, (n_bins) => {
    expect(() => bin_values([1, 2], [0, 10], n_bins)).toThrow(
      `bin_geometry: n_bins must be finite and at most 1000000, got ${n_bins}`,
    )
  })

  test(`bin_values: log and arcsinh bins are uniform in transformed space`, () => {
    const { edges, counts } = bin_values(
      [1, 9.99, 10, 99, 100, 999, 1000, 5000],
      [1, 1000],
      3,
      `log`,
    )
    for (const [idx, expected] of [1, 10, 100, 1000].entries()) {
      expect(Math.abs(edges[idx] - expected)).toBeLessThan(1e-12 * expected)
    }
    // [1,10) [10,100) [100,1000]; 5000 is outside the domain
    expect(Array.from(counts)).toEqual([2, 2, 3])
    // values exactly on a log edge snap to the upper bin even though log10(1000) rounds below 3
    expect(counts_of([1000, 10], [1, 10_000], 4, `log`)).toEqual([0, 1, 0, 1])
    // a domain a few ulps wide collapses in log10 space (scale would be Infinity and every
    // sample would be dropped): treat it as one bin holding the in-domain samples
    const lo = 1e10
    const hi = lo * (1 + 4 * Number.EPSILON)
    expect(bin_values([lo, (lo + hi) / 2, hi, 2e10], [lo, hi], 3, `log`)).toEqual({
      edges: Float64Array.of(lo, hi),
      counts: Uint32Array.of(3),
    })
    // a zero/negative log lower bound is clamped to LOG_EPS instead of producing NaN edges
    const clamped = bin_values([0.5, 1], [0, 1], 2, `log`)
    expect(clamped.edges[0]).toBe(1e-9)
    expect(Array.from(clamped.counts)).toEqual([0, 2])
    const arcsinh = bin_values([-10, -1, 1, 10], [-10, 10], 2, `arcsinh`)
    expect(Math.abs(arcsinh.edges[1])).toBeLessThan(1e-12)
    expect(Array.from(arcsinh.counts)).toEqual([2, 2])
    // asinh(x / threshold): a quarter of the way in transformed space is below the linear quarter
    const quarter = bin_values([], [0, 100], 4, { type: `arcsinh`, threshold: 1 }).edges[1]
    expect(quarter).toBeCloseTo(Math.sinh(Math.asinh(100) / 4), 12)
    expect(quarter).toBeLessThan(25)
  })

  test(`series pattern fills bars from a scoped <pattern> def`, async () => {
    const values = [1, 2, 2, 3, 3, 3, 4, 5]
    const plot = await mount_histogram({
      series: [
        { values, label: `hatched`, color: `steelblue`, pattern: `/` },
        { values, label: `plain`, color: `tomato` },
      ],
      bins: 4,
    })
    const bar = (idx: number) =>
      plot.querySelector(`.histogram-series[data-series-idx="${idx}"] path[role="button"]`)
    expect(bar(1)?.getAttribute(`fill`)).toBe(`tomato`)
    const defs = plot.querySelectorAll(`.histogram svg defs pattern`)
    expect(defs).toHaveLength(1)
    expect(defs[0].id).toBe(pattern_id_of(bar(0), `histogram`))
    expect(defs[0].querySelector(`rect`)?.getAttribute(`fill`)).toBe(`steelblue`)
  })

  test(`normalize_counts: probability sums to 1, density integrates to 1 on uneven bins`, () => {
    const values = [1, 2, 3, 10, 30, 50, 70, 90, 100, 400, 900, 1000]
    const { edges, counts } = bin_values(values, [1, 1000], 3, `log`)
    const raw = normalize_counts(edges, counts, `count`)
    expect(raw.map(({ count, value }) => [count, value])).toEqual([
      [3, 3],
      [5, 5],
      [4, 4],
    ])
    const probability = normalize_counts(edges, counts, `probability`)
    expect(probability.map(({ value }) => value)).toEqual([3 / 12, 5 / 12, 4 / 12])
    const density = normalize_counts(edges, counts, `density`)
    const integral = density.reduce((sum, { x0, x1, value }) => sum + value * (x1 - x0), 0)
    expect(Math.abs(integral - 1)).toBeLessThan(1e-12)
    // density = count / (total * width): the widest bin is the flattest
    expect(density[2].value).toBeCloseTo(4 / (12 * 900), 15)
    // empty input keeps zero bars instead of dividing by zero
    const empty = normalize_counts(Float64Array.of(0, 1, 2), Uint32Array.of(0, 0), `density`)
    expect(empty.map(({ value }) => value)).toEqual([0, 0])
  })

  test(`compute_histogram_bins and compute_count_range`, () => {
    const result = histogram_bins([
      { series_data: series_of([1, 1, 1, 9], { label: `alpha` }), series_idx: 0 },
      { series_data: series_of([5, 6]), series_idx: 1 },
      { series_data: series_of([1], { id: `explicit` }), series_idx: 3 },
    ])
    expect(result.map(({ label }) => label)).toEqual([`alpha`, `Series 2`, `Series 4`])
    expect(result.map(({ max_value, min_value }) => [max_value, min_value])).toEqual([
      [3, 1],
      [1, 1],
      [1, 1],
    ])
    expect(result[0].color).toBe(`steelblue`)
    expect(result[0].bins.map(({ count }) => count)).toEqual([3, 0, 0, 0, 1])
    expect(result[2]).toMatchObject({ id: `explicit`, series_idx: 3 })
    // x2 series bin over the x2 domain with the x2 scale
    const [x2_hist] = histogram_bins(
      [{ series_data: series_of([150, 160, 50], { x_axis: `x2` }), series_idx: 0 }],
      { x2_scale_type: `log`, normalize: `probability` },
    )
    expect(x2_hist.bins.map(({ count }) => count)).toEqual([0, 0, 1, 1, 0])
    expect(x2_hist.bins[0].x1).toBeCloseTo(100 * 2 ** (1 / 5), 12)
    expect(x2_hist.max_value).toBe(0.5)

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
    // one bin per sample stays finite and fast
    const n_samples = 130_000
    const [hist] = histogram_bins(
      [
        {
          series_data: series_of(Array.from({ length: n_samples }, (_, idx) => idx)),
          series_idx: 0,
        },
      ],
      { x_domain: [0, n_samples], bins: n_samples },
    )
    expect(hist.bins).toHaveLength(n_samples)
    expect(hist.bins.every(({ count }) => count === 1)).toBe(true)
    expect(
      compute_count_range([hist], {
        scale_type: `linear`,
        y_limit: [null, null],
        range_padding: 0,
      }),
    ).toEqual([0, 1])
  })
})
