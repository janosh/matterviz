import Histogram from '#lib/plot/histogram/Histogram.svelte'
import type { Vec2 } from '#lib'
import { plot_color } from '#lib/colors/index.js'
import * as marginal_utils from '#lib/plot/core/marginals.js'
import type { HistogramSeries } from '#lib/plot/histogram/histogram.js'
import {
  bin_values,
  compute_count_range,
  compute_histogram_bins,
  compute_histogram_counts,
  log_safe_range,
  normalize_counts,
} from '#lib/plot/histogram/histogram.js'
import { flushSync, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  doc_query,
  expect_tooltip_paint,
  export_via_pane,
  fire,
  form_controls,
  keydown,
  mount_sized,
  mouse,
  one_tab_stop,
  option_texts,
  pattern_id_of,
  pin_cycle,
  plot_svg,
  roving_tabindexes,
  set_input,
  svg_mark_driver,
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
  entries: Parameters<typeof compute_histogram_counts>[0],
  overrides: Partial<Parameters<typeof compute_histogram_counts>[1]> & {
    normalize?: Parameters<typeof compute_histogram_bins>[1]
  } = {},
) => {
  const counted = compute_histogram_counts(entries, { ...histogram_cfg, ...overrides })
  const normalize = overrides.normalize ?? `count`
  return compute_histogram_bins(counted, normalize, histogram_cfg.series_color, counted)
}
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
  // exactly one mark holds the group's tab stop so Tab skips past the chart in one press
  test(`marks are reachable by Tab exactly once`, async () => {
    const values = [1, 2, 2, 3, 3, 3, 4, 5, 6, 7]
    const plot = await mount_histogram({ series: [{ values, label: `H` }] })
    const tabindexes = roving_tabindexes(plot)
    expect(tabindexes.length).toBeGreaterThan(1)
    expect(tabindexes).toEqual(one_tab_stop(tabindexes.length))
  })

  // oxfmt-ignore
  test.each([
    [`a single stacked bin`, { series: [{ values: [1, 1, 1, 1, 1], label: `A` }], bins: 5 }, 5, 50],
    [`spread-out values`, { series: [{ values: [1000, 2000, 3000, 4000, 5000], label: `B` }], bins: 5 }, 1, 20],
    [`two series`, { series: [{ values: [0, 0, 0, 0, 0], label: `A` }, { values: [1, 2, 3, 4, 5], label: `B` }], bins: 5 }, 5, 50],
    [`an explicit y range`, { series: [{ values: [1, 1, 1, 1, 1] }], bins: 5, y_axis: { range: [0, 3] } }, 1, 3],
    // weighted counts are fractional: the raw-count `d` default rounded every tick to 0
    [`fractional weights`, { series: [{ values: [1, 2, 3, 4], weights: [0.1, 0.2, 0.3, 0.4] }], bins: 4 }, 0.4, 0.5],
    // integer-formatted half steps used to label small counts `0, 1, 1, 2, 2`
    [`one sample`, { series: [{ values: [1] }] }, 1, 2],
    [`small counts`, { series: [{ values: [1, 1, 2] }] }, 2, 3],
  ] as const)(`count axis spans the tallest bin for %s`, async (_name, props, lower, upper) => {
    const ticks = await y_ticks_after(props)
    expect(ticks.length).toBeGreaterThan(1)
    expect(new Set(ticks).size).toBe(ticks.length)
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(lower)
    expect(Math.max(...ticks)).toBeLessThanOrEqual(upper)
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
        // read fractional log ranges without the raw-count default's integer rounding
        y_axis: { scale_type: `log`, format: `.6~g`, ...(range ? { range } : {}) },
      })
    const valid_ticks = [await log_ticks(), await log_ticks([1, null])]
    for (const ticks of valid_ticks) {
      expect(ticks.length).toBeGreaterThan(0)
      expect(Math.min(...ticks)).toBeGreaterThan(0)
    }
    // oxfmt-ignore
    for (const invalid_range of [[0, null], [null, -5]] as const) {
      expect(await log_ticks([...invalid_range])).toEqual(valid_ticks[0])
    }
    // oxfmt-ignore
    for (const range of [[100.123, null], [null, 0.0123]] as const) {
      const [lower, upper] = count_range(log_series, `log`, [...range])
      expect(lower).toBeGreaterThan(0)
      expect(lower).toBeLessThan(upper)
      expect([lower, upper]).toEqual(range.map((bound, idx) => bound ?? [lower, upper][idx]))
      const ticks = await log_ticks([...range])
      expect(ticks.length).toBeGreaterThan(0)
      expect(Math.min(...ticks)).toBeGreaterThanOrEqual(lower)
      expect(Math.max(...ticks)).toBeLessThanOrEqual(upper)
    }
    // radius 0 keeps bar_boxes' path parser valid
    await mount_histogram({
      series: [{ values: [1, 100] }],
      bins: 2,
      bar: { border_radius: 0 },
      y_axis: { scale_type: `log` },
    })
    const heights = bar_boxes().map(({ height }) => height)
    expect(heights.length).toBeGreaterThan(0)
    expect(Math.min(...heights)).toBeGreaterThan(2)
  })

  // with 0 off the count range, an empty bin drew a bar down from the floor that took focus
  // ("count 0") but, like a gone one, showed no tooltip
  test(`empty bins draw no bar when the count range excludes 0`, async () => {
    const series = [series_of([1, 1, 1, 3, 3, 3])]
    await mount_histogram({ series, bins: 3, y_axis: { range: [2, 8] } })
    const bars = [...document.querySelectorAll(`g.histogram-series path[role="button"]`)]
    expect(bars.map((bar) => bar.getAttribute(`aria-label`))).toEqual([
      `Series 1 bin 1: 1 to 1.67, count 3`,
      `Series 1 bin 3: 2.33 to 3, count 3`,
    ])
  })

  test(`shift-wheel pans a log count axis by decades`, async () => {
    await mount_histogram({
      series: [{ values: [1, 2, 3, 4, 5], label: `A` }],
      y_axis: { scale_type: `log`, range: [1, 100] },
    })
    const plot = plot_svg()
    plot.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    await fire(window, new KeyboardEvent(`keydown`, { key: `Shift` }))
    await fire(plot, new WheelEvent(`wheel`, { deltaY: 2000, bubbles: true }))
    const pan_ticks = get_tick_numbers(`y`)
    expect(pan_ticks.length).toBeGreaterThan(0)
    expect(Math.min(...pan_ticks)).toBeGreaterThan(100)
    expect(Math.max(...pan_ticks) / Math.min(...pan_ticks)).toBeGreaterThanOrEqual(10)
  })

  test(`legend swatches stay per-series in single mode`, async () => {
    await mount_histogram({
      series: [`A`, `B`, `C`].map((label) => ({ values: [1, 2, 3], label })),
      mode: `single`,
      selected_series_idx: 1,
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

  // A series' own color wins over bar.color, and the fill picker only shows when bar.color
  // is what the bars actually use (a lone series without its own color)
  // oxfmt-ignore
  test.each([
    [`lone series color wins`, [{ values: [1, 2], color: `#00ff00` }], `#00ff00`, false],
    [`lone series uses bar.color`, [{ values: [1, 2] }], `#123456`, true],
    [`several series use the palette`, [{ values: [1, 2] }, { values: [2, 3], visible: false }], plot_color(0), false],
  ])(`bar fill: %s`, async (_desc, series, expected_fill, picker_shown) => {
    const open = { show_controls: true, controls_open: true }
    await mount_histogram({ series, bins: 2, bar: { color: `#123456` }, ...open })
    const bars = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    const fills = new Set([...bars].map((bar) => bar.getAttribute(`fill`)))
    expect(fills).toEqual(new Set([expected_fill]))
    const picker = document.querySelector(`input[aria-label="Fill color hex"]`)
    expect(Boolean(picker)).toBe(picker_shown)
  })

  test(`probability bar heights survive a rect zoom`, async () => {
    const on_bar_hover = vi.fn()
    const values = Array.from({ length: 1000 }, (_, idx) => idx)
    const props = { normalize: `probability`, bins: 10, on_bar_hover }
    await mount_histogram({ series: [{ values }], ...props })
    const svg = plot_svg()
    const { left, top } = svg.getBoundingClientRect()
    const at = (px_x: number, px_y: number) => ({
      clientX: left + px_x,
      clientY: top + px_y,
      button: 0,
      buttons: 1,
    })
    svg.dispatchEvent(mouse(`mousedown`, at(130, 40)))
    window.dispatchEvent(mouse(`mousemove`, at(250, 240)))
    await fire(window, mouse(`mouseup`, at(250, 240)))
    const bars = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    bars[Math.floor(bars.length / 2)].dispatchEvent(mouse(`mousemove`))
    const { count, y } = on_bar_hover.mock.lastCall?.[0] ?? {}
    // the zoom re-binned into fewer samples per bin, each still a share of all 1000
    expect(count).toBeLessThan(100)
    expect(y).toBeCloseTo(count / 1000, 12)
  })

  const repeated = { values: [0, 1, 2], label: `Repeated` }
  // oxfmt-ignore
  test.each([
    [`skips hidden series`, { series: [{ ...repeated, visible: false }, { values: [1, 1, 2] }], show_legend: true }, [`1`]],
    [`keeps duplicate labels apart`, { series: [repeated, repeated], show_legend: true }, [`0`, `1`]],
    [`selects the first visible series for an unavailable index`, { series: [repeated], mode: `single`, selected_series_idx: 99 }, [`0`]],
  ] as const)(`series indexing %s and clips every series group`, async (_name, props, indices) => {
    await mount_histogram({ ...props })
    const groups = [...document.querySelectorAll(`g.histogram-series`)]
    expect(groups.map((element) => element.getAttribute(`data-series-idx`))).toEqual(indices)
    for (const group of groups) expect(group.getAttribute(`clip-path`)).toMatch(/^url\(#histogram-clip/)
  })

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
    const scale_labels = scale_type_sections[0].querySelectorAll(`label > span:first-child`)
    expect([...scale_labels].map((label) => label.textContent)).toEqual([`X`, `X2`, `Y`])
    const x_ticks = get_tick_numbers(`x`)
    expect(x_ticks.length).toBeGreaterThan(0)
    expect(Math.max(...x_ticks)).toBeLessThan(100)
    expect(Math.max(...get_tick_numbers(`y`))).toBeGreaterThanOrEqual(4)
  })

  // bin_values drops a sample whose weight is non-finite, so it must not widen the value axis,
  // and a series with no countable sample doesn't open the secondary axes
  test(`samples with non-finite weights widen no axis`, async () => {
    await mount_histogram({
      series: [
        { values: [0, 1, 2, 1000], weights: [1, 1, 1, NaN] },
        { values: [50, 60], weights: [NaN, Infinity], x_axis: `x2`, y_axis: `y2` },
      ],
      mode: `overlay`,
    })
    expect(Math.max(...get_tick_numbers(`x`))).toBeLessThan(10)
    expect(document.querySelector(`g.x2-axis`)).toBeNull()
    expect(document.querySelector(`g.y2-axis`)).toBeNull()
  })

  test(`legend writes hidden IDs while preserving input samples and colors`, async () => {
    const first_series = { values: [1, 1, 2, 3, 5], label: `A`, color: `red` }
    const second_series = { values: [2, 4, 4, 6, 9], label: `B`, color: `blue` }
    const hidden_series: (string | number)[] = []
    const state = { series: [first_series, second_series], hidden_series }
    // on_series_toggle observes the toggle after the chart's own hidden-ID update
    const on_series_toggle = vi.fn(() => expect(state.hidden_series).toEqual([1]))
    await mount_histogram(
      bind_props({ bins: 4, mode: `overlay`, show_legend: true, on_series_toggle }, state),
    )
    const legend_items = document.querySelectorAll<HTMLElement>(`.legend-item`)
    expect(legend_items).toHaveLength(2)
    const fills = [...document.querySelectorAll(`g.histogram-series path`)].map((bar) =>
      bar.getAttribute(`fill`),
    )
    expect(new Set(fills)).toEqual(new Set([`red`, `blue`]))
    legend_items[1].click()
    await tick()
    expect(state.series[0]).toBe(first_series)
    expect(state.series[1]).toBe(second_series)
    expect(state.hidden_series).toEqual([1])
    expect(on_series_toggle).toHaveBeenCalledExactlyOnceWith(1)
    expect(on_series_toggle).toHaveReturned()
  })

  // One flip at a time against an ascending reference: bin edges stay ascending, so on a
  // descending x range x_scale(bin.x0) is the bar's RIGHT edge; on a descending y range the
  // baseline sits ABOVE the bar's value pixel, so bars hang from it at unchanged heights
  test(`bars mirror rather than shift or vanish on reversed x and y ranges`, async () => {
    const bars_for = async (x_range: Vec2, y_range: Vec2) => {
      const axes = { x_axis: { range: x_range }, y_axis: { range: y_range } }
      await mount_histogram({ series: [{ values: [1, 3, 5, 7, 9] }], bins: 5, ...axes })
      const boxes = bar_boxes()
      expect(boxes).toHaveLength(5)
      return boxes
    }
    const spans = (boxes: ReturnType<typeof bar_boxes>) =>
      boxes.map(({ left, right }) => [left, right])
    const ascending = await bars_for([0, 10], [0, 100])
    expect(spans(await bars_for([10, 0], [0, 100]))).toEqual(spans(ascending).toReversed())
    const flipped_y = await bars_for([0, 10], [100, 0])
    expect(spans(flipped_y)).toEqual(spans(ascending))
    expect(flipped_y.map((box) => box.height)).toEqual(ascending.map((box) => box.height))
    expect(new Set(ascending.map((box) => box.bottom)).size).toBe(1)
    expect(new Set(flipped_y.map((box) => box.top)).size).toBe(1)
    expect(flipped_y[0].top).toBeLessThan(ascending[0].bottom)
  })

  // legend obstacles must track reversed and log axes and each bar's full width
  // oxfmt-ignore
  test.each([
    // bars hang from the top baseline on [2, 0]
    [`a reversed range`, { range: [2, 0] }, [1, 3, 5, 7, 9], 5],
    // counts [1, 300, 1, 300, 1]: linearly the 300s fill under a third of the ~[1, 1000] axis
    [`a log axis`, { scale_type: `log` }, [1, 5, 9, ...Array(300).fill(3), ...Array(300).fill(7)], 5],
    // counts [20, 1, 1, 20]: wide outer bars whose center lines leave room between them
    [`wide bars`, {}, [...Array(20).fill(1), 4, 6, ...Array(20).fill(9)], 4],
  ] as const)(`automatic legend placement avoids the bars on %s`, async (_name, y_axis, values, bins) => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(60)
    await mount_histogram({ series: [{ values, label: `A` }], bins, show_legend: true, y_axis })
    const { left, top } = doc_query(`.legend`).style
    const [legend_x, legend_y] = [left, top].map((px) => Number(px.replace(`px`, ``)))
    const bars = bar_boxes()
    expect(bars).toHaveLength(bins)
    type Box = (typeof bars)[number]
    const overlap_x = (bar: Box) => legend_x < bar.right && legend_x + 120 > bar.left
    const overlap_y = (bar: Box) => legend_y < bar.bottom && legend_y + 60 > bar.top
    expect(bars.filter((bar) => overlap_x(bar) && overlap_y(bar))).toEqual([])
  })

  test(`single mode selects exactly one series by its original index, including duplicate and empty labels`, async () => {
    const state = $state({ selected_series_idx: 0 })
    const labels = [`Repeated`, `Repeated`, ``, undefined, `E<sub>F</sub>`]
    const series = [
      series_of([1], { label: `Hidden`, visible: false }),
      ...labels.map((label) => series_of([1], { label })),
    ]
    const panes = { show_controls: true, controls_open: true, show_legend: true }
    await mount_histogram(bind_props({ series, mode: `single`, ...panes }, state))

    const { control, set_value } = form_controls()
    const series_select = control(`Series`)
    if (!(series_select instanceof HTMLSelectElement)) throw new Error(`Series is no select`)
    // an option shows text, so an HTML label reads as it renders in the legend
    expect(option_texts(series_select)).toEqual([
      `Repeated`,
      `Repeated`,
      `Series 4`,
      `Series 5`,
      `EF`,
    ])
    expect(series_select.value).toBe(`1`)
    expect(document.querySelectorAll(`g.histogram-series`)).toHaveLength(1)
    expect(document.querySelector(`input[aria-label="Fill color hex"]`)).toBeNull()
    expect(document.querySelector(`input[aria-label="Stroke color hex"]`)).not.toBeNull()
    for (const series_idx of [1, 2, 3, 4]) {
      await set_value(`Series`, String(series_idx))
      expect(state.selected_series_idx).toBe(series_idx)
      const groups = [...document.querySelectorAll(`g.histogram-series`)]
      const shown = groups.map((group) => group.getAttribute(`data-series-idx`))
      expect(shown).toEqual([String(series_idx)])
    }
    const legend_items = document.querySelectorAll<HTMLElement>(`.legend-item`)
    for (const series_idx of [1, 2, 3, 4, 5]) {
      legend_items[series_idx].click()
      await tick()
    }
    expect(series_select.disabled).toBe(true)
    const { options, selectedIndex } = series_select
    expect(options[selectedIndex].textContent).toBe(`No visible series`)
    expect(document.querySelectorAll(`g.histogram-series`)).toHaveLength(0)
    legend_items[3].click()
    await tick()
    expect(series_select.disabled).toBe(false)
    expect(series_select.value).toBe(`3`)
    expect(doc_query(`g.histogram-series`).getAttribute(`data-series-idx`)).toBe(`3`)
  })

  test.each([`y`, `y2`] as const)(
    `binds style and normalize controls on %s`,
    async (y_axis) => {
      let sample_reads = 0
      const values = [1]
      Object.defineProperty(values, 0, {
        get: () => {
          sample_reads++
          return 1
        },
      })
      const state = { bar: { color: `#112233` }, normalize: `count` as const }
      const series = [series_of(values, { label: `Only`, y_axis })]
      const props = { series, show_controls: true, controls_open: true }
      await mount_histogram(bind_props(props, state))
      const initial_reads = sample_reads
      const fill_input = doc_query<HTMLInputElement>(`input[aria-label="Fill color hex"]`)
      set_input(fill_input, `#wrong`)
      await tick()
      expect(fill_input.getAttribute(`aria-invalid`)).toBe(`true`)
      expect(state.bar).toEqual({ color: `#112233` })
      set_input(fill_input, `#abcdef`)
      expect(state.bar).toEqual({ color: `#abcdef` })
      const stroke_color = doc_query<HTMLInputElement>(`input[aria-label="Stroke color"]`)
      set_input(stroke_color, `#fedcba`)
      const stroke_opacity = [...document.querySelectorAll<HTMLLabelElement>(`label`)]
        .find((label) => label.textContent?.trim() === `Stroke opacity`)
        ?.querySelector<HTMLInputElement>(`input[type="number"]`)
      if (!stroke_opacity) throw new Error(`Missing stroke opacity input`)
      set_input(stroke_opacity, `0.25`)
      const bar = { color: `#abcdef`, stroke_color: `#fedcba`, stroke_opacity: 0.25 }
      expect(state.bar).toEqual(bar)
      // the controls pane's normalize select writes back into a bound normalize prop
      const { control, set_value } = form_controls()
      expect(control(`Normalize`).value).toBe(`count`)
      await set_value(`Normalize`, `density`)
      expect(state.normalize).toBe(`density`)
      expect(sample_reads).toBe(initial_reads)
    },
  )

  test(`a bar click or Enter pins its tooltip; it again, empty space or Escape unpin`, async () => {
    await mount_histogram({ series: [series_of([0, 1, 1, 9])], bins: 5 })
    const bars = [...document.querySelectorAll(`g.histogram-series path[role="button"]`)]
    const text = await pin_cycle(svg_mark_driver(bars, plot_svg()), {
      keyboard: true,
      lit: (idx) => bars[idx].getAttribute(`opacity`) === `1`, // else the 0.7 default
    })
    expect(text).toMatch(/Value: 0.9\s*Count: 3/)
    // a mouse click focuses no bar: the page's Escape reaches the chart under the pointer
    bars[0].dispatchEvent(mouse(`mousemove`))
    bars[0].dispatchEvent(mouse(`click`))
    flushSync()
    expect(doc_query(`.plot-tooltip`).classList.contains(`pinned`)).toBe(true)
    doc_query(`.histogram`).dispatchEvent(new PointerEvent(`pointerenter`))
    globalThis.dispatchEvent(keydown(`Escape`))
    flushSync()
    expect(doc_query(`.plot-tooltip`).classList.contains(`pinned`)).toBe(false)
  })

  test(`tooltip takes the color of the hovered bar's own series`, async () => {
    await mount_histogram({ series: [series_of([0, 1]), series_of([5, 6])], mode: `overlay` })
    const bars = [...document.querySelectorAll(`g.histogram-series path[role="button"]`)]
    const [first, last] = [bars[0], bars.at(-1)].map((bar) => bar?.getAttribute(`fill`))
    expect(first).not.toBe(last)
    await fire(bars.at(-1), new MouseEvent(`mousemove`, { bubbles: true }))
    expect_tooltip_paint(doc_query(`.plot-tooltip`), last ?? ``)
  })

  // the tooltip must not be a snapshot: it tracks rebinned data under a resting pointer
  test(`bar hover/click handlers receive the bin center, count and label`, async () => {
    const on_bar_hover = vi.fn()
    const on_bar_click = vi.fn()
    // 5 bins over [0, 10]: [0,2) holds fractional weight 2.5 of 5
    const weights = [1.25, 1.25, 1.5, 1]
    let series = $state([series_of([0, 1, 5, 9], { label: `A`, weights })])
    await mount_histogram({
      get series() {
        return series
      },
      bins: 5,
      normalize: `probability`,
      x_axis: { range: [0, 10] },
      mode: `overlay`,
      on_bar_hover,
      on_bar_click,
    })
    const [first_bar] = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    await fire(first_bar, new MouseEvent(`mousemove`, { bubbles: true }))
    // Same payload as the tooltip snippet (HistogramHandlerProps) plus the DOM event, matching BarPlot
    const event = expect.any(MouseEvent)
    const hit = { value: 1, count: 2.5, property: `A`, series_idx: 0, event }
    const hover_hit = { ...hit, label: `A`, active_x_axis: `x` }
    expect(on_bar_hover).toHaveBeenLastCalledWith(expect.objectContaining(hover_hit))
    const tooltip_text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    for (const text of [`Count: 2.5`, `Probability: 0.5`, `A`])
      expect(tooltip_text).toContain(text)
    // Enter/Space activate the bar like a click, other keys are ignored
    for (const key of [`Enter`, ` `, `a`])
      first_bar.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
    first_bar.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    expect(on_bar_click).toHaveBeenCalledTimes(3)
    expect(on_bar_click).toHaveBeenLastCalledWith(expect.objectContaining(hit))
    expect(document.querySelector(`.plot-tooltip.pinned`)).toBeNull() // a claimed click
    await fire(first_bar, new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(on_bar_hover).toHaveBeenLastCalledWith(null)
    expect(document.querySelector(`.plot-tooltip`)).toBeNull()
    await fire(first_bar, mouse(`mousemove`))
    const tooltip_after = (next: HistogramSeries[]) => {
      series = next
      flushSync()
      return document.querySelector(`.plot-tooltip`)?.textContent ?? null
    }
    const refilled = [series_of([0, 1, 1, 9], { label: `A` })]
    expect(tooltip_after(refilled)).toContain(`Count: 3`)
    // an emptied bin draws no bar: its tooltip showed `Count: 0` over nothing
    expect(tooltip_after([series_of([5, 9], { label: `A` })])).toBeNull()
    expect(on_bar_hover).toHaveBeenLastCalledWith(null)
    tooltip_after(refilled)
    await fire(document.querySelector(`g.histogram-series path`), mouse(`mousemove`))
    expect(tooltip_after([])).toBeNull()
    expect(on_bar_hover).toHaveBeenLastCalledWith(null)
  })

  // the middle of 15 bins over [-4.9, 4.9] has edges ±0.3267 a few ulps apart, whose float
  // midpoint -4.4e-16 the tooltip printed as its value
  test(`a bin centered on 0 reports exactly 0 to the tooltip and hover handler`, async () => {
    const on_bar_hover = vi.fn()
    await mount_histogram({
      series: [series_of([-1, 0, 1], { label: `A` })],
      bins: 15,
      x_axis: { range: [-4.9, 4.9], label: `E` },
      on_bar_hover,
    })
    const bars = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    const middle_bar = [...bars].find((bar) =>
      bar.getAttribute(`aria-label`)?.includes(`bin 8:`),
    )
    await fire(middle_bar, new MouseEvent(`mousemove`, { bubbles: true }))
    expect(on_bar_hover).toHaveBeenLastCalledWith(expect.objectContaining({ value: 0 }))
    expect(document.querySelector(`.plot-tooltip`)?.textContent).toMatch(/E: 0\s*Count: 1/)
  })

  // rounded corners belong on the bar's tip, which a reversed count range puts at the bottom
  test.each([
    [[0, null], `top`],
    [[6, 0], `bottom`],
  ] as const)(`count range %j rounds the bar tip at the %s`, async (range, tip_side) => {
    await mount_histogram({
      series: [series_of([1, 1, 1])],
      bins: 1,
      bar: { border_radius: 3 },
      y_axis: { range: [...range] },
    })
    // bar_path starts on the flat base edge and runs to the rounded edge: M<x>,<start>V<arc>
    const path = doc_query(`g.histogram-series path`).getAttribute(`d`) ?? ``
    const { start, arc } =
      /^M[-\d.]+,(?<start>[-\d.]+)V(?<arc>[-\d.]+)A/.exec(path)?.groups ?? {}
    const [start_px, arc_px] = [start, arc].map(Number)
    expect(tip_side === `top` ? arc_px < start_px : arc_px > start_px, path).toBe(true)
  })

  // aria-labels are read aloud, so bin edges carry the tooltip's formatting, not float noise,
  // and an HTML series label its text
  test(`bar aria-labels format bin edges and normalized values`, async () => {
    await mount_histogram({
      series: [series_of([0.15, 0.35, 0.35], { label: `A<sub>1</sub>` })],
      bins: 3,
      normalize: `probability`,
      // the third bin's lower edge is 0.1 + 0.2 = 0.30000000000000004
      x_axis: { range: [0.1, 0.4] },
    })
    const bars = document.querySelectorAll(`g.histogram-series path[role="button"]`)
    expect([...bars].map((bar) => bar.getAttribute(`aria-label`))).toEqual([
      `A1 bin 1: 0.1 to 0.2, count 1, value 0.333`,
      `A1 bin 3: 0.3 to 0.4, count 2, value 0.667`,
    ])
  })

  // weighted bars must get a weighted marginal, else its CDF contradicts the bars beside it
  test(`marginals receive the series weights`, async () => {
    const compute = vi.spyOn(marginal_utils, `compute_marginal_curve`)
    const series = [series_of([1, 9], { weights: [9, 1] })]
    await mount_histogram({ series, marginals: true })
    expect(compute.mock.calls.map((call) => call[1])).toContainEqual([9, 1])
  })

  // The arithmetic mean of [1, 10] is 5.5, which a log axis draws ~74% across the bar
  test(`log x axis centers the bin at its scale-space midpoint`, async () => {
    const on_bar_hover = vi.fn()
    const x_axis = { scale_type: `log`, range: [1, 1000] }
    const series = [series_of([2, 5, 20, 200])]
    await mount_histogram({ series, bins: 3, x_axis, on_bar_hover })
    await fire(doc_query(`g.histogram-series path[role="button"]`), mouse(`mousemove`))
    const { value, x } = on_bar_hover.mock.lastCall?.[0] ?? {}
    expect(value).toBeCloseTo(Math.sqrt(10), 12)
    expect(x).toBe(value)
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
      bins: 10,
    })
    const legend_checkbox = form_controls().control(`Show legend`)
    if (!(legend_checkbox instanceof HTMLInputElement)) throw new Error(`no legend checkbox`)
    expect(legend_checkbox.checked).toBe(true)
    for (const checked of [false, true]) {
      legend_checkbox.click()
      await tick()
      expect(legend_checkbox.checked).toBe(checked)
      expect(document.querySelector(`.legend`) !== null).toBe(checked)
    }
    const reset_selector = `button[title="Reset histogram to defaults"]`
    doc_query(reset_selector).click()
    await tick()
    expect(document.querySelector(reset_selector)).toBeNull()
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
    const samples = [0, 0.5, 1, 2.5, 4, 5, 7.99, 8, 10, 10.0001, -1, NaN]
    const { edges, counts } = bin_values(samples, [0, 10], 5)
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
    // an edge meant to sit on 0 is exactly 0, not the -8.9e-16 of -4.9 + 7 / (10 / 7)
    expect(bin_values([], [-4.9, 2.1], 10).edges[7]).toBe(0)
    // collapsed domain: one bin with the samples sitting on it
    expect(bin_values([5, 5, 6], [5, 5], 10)).toEqual({
      edges: Float64Array.of(5, 5),
      counts: Uint32Array.of(2),
    })
  })

  test(`bin_values: weights must align, and non-finite ones drop like non-finite values`, () => {
    const values = [1, 3, 5, 7, 9]
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

  // n_bins IS the allocation (edges + counts + one <rect> each): 5e7 is a 400 MB Float64Array
  test.each([[5e7], [NaN], [Infinity]])(`bin_values rejects n_bins %p`, (n_bins) => {
    expect(() => bin_values([1, 2], [0, 10], n_bins)).toThrow(
      `bin_geometry: n_bins must be finite and at most 1000000, got ${n_bins}`,
    )
  })

  test(`bin_values: log and arcsinh bins are uniform in transformed space`, () => {
    const samples = [1, 9.99, 10, 99, 100, 999, 1000, 5000]
    const { edges, counts } = bin_values(samples, [1, 1000], 3, `log`)
    for (const [idx, expected] of [1, 10, 100, 1000].entries()) {
      expect(Math.abs(edges[idx] - expected)).toBeLessThan(1e-12 * expected)
    }
    // [1,10) [10,100) [100,1000]; 5000 is outside the domain
    expect(Array.from(counts)).toEqual([2, 2, 3])
    // values exactly on a log edge snap to the upper bin even though log10(1000) rounds below 3
    expect(counts_of([1000, 10], [1, 10_000], 4, `log`)).toEqual([0, 1, 0, 1])
    const tiny = bin_values([1e-20, 5e-20, 5e-19, 1e-18], [1e-20, 1e-18], 2, `log`)
    expect(Array.from(tiny.counts)).toEqual([2, 2])
    for (const [idx, expected] of [1e-20, 1e-19, 1e-18].entries()) {
      expect(Math.abs(tiny.edges[idx] - expected)).toBeLessThanOrEqual(
        128 * Number.EPSILON * expected,
      )
    }
    // a domain a few ulps wide collapses in log10 space (scale would be Infinity and every
    // sample would be dropped): treat it as one bin holding the in-domain samples
    const lower = 1e10
    const upper = lower * (1 + 4 * Number.EPSILON)
    const ulp_samples = [lower, (lower + upper) / 2, upper, 2e10]
    const collapsed = bin_values(ulp_samples, [lower, upper], 3, `log`)
    expect(collapsed.edges).toEqual(Float64Array.of(lower, upper))
    expect(collapsed.counts).toEqual(Uint32Array.of(3))
    // a zero/negative log lower bound is clamped to LOG_EPS instead of producing NaN edges
    const clamped = bin_values([0.5, 1], [0, 1], 2, `log`)
    expect(clamped.edges[0]).toBe(1e-9)
    expect(Array.from(clamped.counts)).toEqual([0, 2])
    // Repair below a tiny positive upper bound, keeping bin edges ascending like the axis.
    const tiny_recovered = bin_values([1e-20, 2e-19, 8e-19, 1e-18], [0, 1e-18], 2, `log`)
    expect(Array.from(tiny_recovered.counts)).toEqual([1, 2])
    expect(tiny_recovered.edges[0]).toBeGreaterThan(0)
    expect(tiny_recovered.edges[0]).toBeLessThan(2e-19)
    expect(tiny_recovered.edges[2]).toBe(1e-18)
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
    // oxfmt-ignore
    expect(raw.map(({ count, value }) => [count, value])).toEqual([[3, 3], [5, 5], [4, 4]])
    const probability = normalize_counts(edges, counts, `probability`)
    expect(probability.map(({ value }) => value)).toEqual([3 / 12, 5 / 12, 4 / 12])
    const density = normalize_counts(edges, counts, `density`)
    const integral = density.reduce(
      (sum, { x0: coord_x_0, x1: coord_x_1, value }) => sum + value * (coord_x_1 - coord_x_0),
      0,
    )
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
    const extents = result.map(({ max_value, min_value }) => [max_value, min_value])
    // oxfmt-ignore
    expect(extents).toEqual([[3, 1], [1, 1], [1, 1]])
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
    // per-sample weights reach the counts and the probability total
    const [weighted] = histogram_bins(
      [{ series_data: series_of([1, 1, 9], { weights: [2, 0.5, 4] }), series_idx: 0 }],
      { normalize: `probability` },
    )
    expect(weighted.bins.map(({ count }) => count)).toEqual([2.5, 0, 0, 0, 4])
    expect(weighted.bins[0].value).toBeCloseTo(2.5 / 6.5, 12)

    // empty, log-empty and out-of-domain series
    expect(count_range([], `linear`)).toEqual([0, 1])
    expect(count_range([], `log`)).toEqual([1, 1])
    expect(count_range([series_of([500, 600])], `linear`)).toEqual([0, 1])
    const lin_range = count_range([series_of([1, 1, 1, 9])], `linear`)
    expect(lin_range[0]).toBe(0)
    expect(lin_range[1]).toBeGreaterThanOrEqual(3)
    const [log_lo, log_hi] = count_range([series_of([1, 1, 1, 1, 9])], `log`)
    expect(log_lo).toBeCloseTo(1 / 1.1, 10)
    expect(log_hi).toBeGreaterThanOrEqual(4)
    expect(count_range([series_of([1, 1, 9])], `log`, [0.5, null])[0]).toBe(0.5)
    const with_x2 = [series_of([1, 1]), series_of([150, 150, 150, 150], { x_axis: `x2` })]
    expect(count_range(with_x2, `linear`)[1]).toBeGreaterThanOrEqual(4)
    // one bin per sample stays finite and fast
    const n_samples = 130_000
    const series_data = series_of(Array.from({ length: n_samples }, (_, idx) => idx))
    const per_sample = { x_domain: [0, n_samples] as Vec2, bins: n_samples }
    const [hist] = histogram_bins([{ series_data, series_idx: 0 }], per_sample)
    expect(hist.bins.map(({ count }) => count)).toEqual(Array(n_samples).fill(1))
    const y_limit: [null, null] = [null, null]
    const range_opts = { scale_type: `linear`, y_limit, range_padding: 0 } as const
    expect(compute_count_range([hist], range_opts)).toEqual([0, 1])
  })
})

// Bins have an extent, so the CSV reports edges and both count and plotted value
test(`Histogram CSV export lists bin edges and counts`, async () => {
  const on_export = vi.fn()
  const plot = await mount_histogram({
    series: [{ values: [1, 1, 2, 3, 3, 3], label: `vals` }],
    bins: 2,
    show_controls: `hover`,
    on_export,
  })
  const result = await export_via_pane(on_export, `CSV`, plot)
  expect(result.offered).toEqual([`PNG`, `SVG`, `CSV`])
  const [header, ...rows] = String(result.data).split(`\n`)
  expect(header).toBe(`series,bin_start,bin_end,count,value`)
  expect(rows.reduce((sum, row) => sum + Number(row.split(`,`)[3]), 0)).toBe(6)
})
