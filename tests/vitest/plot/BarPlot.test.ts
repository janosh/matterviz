import { BarPlot } from '$lib'
import type { BarHandlerProps, BarSeries } from '$lib/plot'
import { type ComponentProps, createRawSnippet, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  inside_clip_path,
  keydown,
  mount_sized,
  mouse,
  one_tab_stop,
  pattern_id_of,
  query,
  roving_tabindexes,
  with_measured_text,
} from '../setup'

const basic: BarSeries = {
  x: [1, 2, 3, 4, 5],
  y: [10, 20, 15, 25, 18],
  label: `Test Series`,
  color: `steelblue`,
}

const mount_sized_bar_plot = (
  props: Partial<ComponentProps<typeof BarPlot>>,
  size: { width?: number; height?: number } = {},
): Promise<HTMLElement> => mount_sized(BarPlot, props, { selector: `.bar-plot`, ...size })

describe(`BarPlot`, () => {
  afterEach(() => vi.restoreAllMocks())

  // Both mark kinds regressed the same policy in opposite directions: every bar was
  // tabindex=0 (230 tab stops on a spacegroup plot), while the line-point group put
  // its only 0 on the *hovered* point - so with nothing hovered every point was -1
  // and Tab could not enter the group at all.
  test.each([
    [`bars`, { series: [basic] }],
    [
      `line points`,
      { series: [{ ...basic, render_mode: `line` as const }], on_point_click: () => {} },
    ],
  ])(`%s are reachable by Tab exactly once`, async (_name, props) => {
    const tabindexes = roving_tabindexes(await mount_sized_bar_plot(props))
    expect(tabindexes.length).toBeGreaterThan(1)
    expect(tabindexes).toEqual(one_tab_stop(tabindexes.length))
  })

  // Focus is the keyboard's hover, so leaving the chart is the keyboard's mouseleave.
  // Arrowing between marks must not clear it, though - that is sliding along, not leaving.
  test(`focus opens the tooltip, and only leaving the chart closes it`, async () => {
    const on_bar_hover = vi.fn()
    const plot = await mount_sized_bar_plot({ series: [basic], on_bar_hover })
    const bars = [...plot.querySelectorAll<SVGPathElement>(`[data-roving-key]`)]

    bars[0].dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    await tick()
    expect(on_bar_hover).toHaveBeenCalledOnce()

    // Focus moving to a sibling mark keeps the hover
    bars[0].dispatchEvent(
      new FocusEvent(`focusout`, { bubbles: true, relatedTarget: bars[1] }),
    )
    await tick()
    expect(on_bar_hover).not.toHaveBeenLastCalledWith(null)

    // Focus leaving the chart clears it
    bars[1].dispatchEvent(
      new FocusEvent(`focusout`, { bubbles: true, relatedTarget: document.body }),
    )
    await tick()
    expect(on_bar_hover).toHaveBeenLastCalledWith(null)
  })

  test(`arrow keys move the tab stop between marks`, async () => {
    const plot = await mount_sized_bar_plot({ series: [basic] })
    const bars = [...plot.querySelectorAll<SVGPathElement>(`[data-roving-key]`)]
    bars[0].focus()
    bars[0].dispatchEvent(keydown(`ArrowRight`))
    await tick()
    expect(bars[1].getAttribute(`tabindex`)).toBe(`0`)
    expect(bars[0].getAttribute(`tabindex`)).toBe(`-1`)
  })

  test.each([
    { name: `empty data`, series: [], expected_series: 0, expected_bars: 0 },
    {
      name: `all-negative values`,
      series: [{ x: [1, 2, 3, 4], y: [-10, -20, -15, -25] }],
      expected_series: 1,
      expected_bars: 4,
    },
    {
      name: `hidden series`,
      series: [
        basic,
        { ...basic, color: `orangered`, visible: false },
        { ...basic, color: `green` },
      ],
      expected_series: 2,
      expected_bars: 10,
    },
    {
      name: `horizontal grouped mode`,
      series: [basic, { ...basic, color: `orangered` }],
      props: { orientation: `horizontal`, mode: `grouped` },
      expected_series: 2,
      expected_bars: 10,
    },
    {
      name: `bar and line series side by side`,
      series: [basic, { x: [1, 2, 3, 4, 5], y: [12, 18, 20, 22, 16], render_mode: `line` }],
      props: { mode: `stacked` },
      expected_series: 1,
      expected_bars: 5,
      expected_lines: 1,
    },
  ] satisfies {
    name: string
    series: BarSeries[]
    props?: Partial<ComponentProps<typeof BarPlot>>
    expected_series: number
    expected_bars: number
    expected_lines?: number
  }[])(
    `renders $name`,
    async ({ series, props, expected_series, expected_bars, expected_lines = 0 }) => {
      const plot = await mount_sized_bar_plot({ series, ...props })
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(expected_series)
      expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(expected_bars)
      expect(plot.querySelectorAll(`.line-series`)).toHaveLength(expected_lines)
    },
  )

  test.each([`vertical`, `horizontal`] as const)(
    `omits zero-valued bars in %s orientation`,
    async (orientation) => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [1, 2, 3], y: [-5, 0, 5] }],
        orientation,
      })
      expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(2)
    },
  )

  test(`rotates vertical bar labels outward`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [{ x: [1], y: [5], labels: [`Material 1`] }],
      bar: { label_rotation: 90 },
    })
    const label = plot.querySelector(`.bar-label`)
    expect(label).not.toBeNull()
    expect(label?.getAttribute(`text-anchor`)).toBe(`end`)
    expect(label?.getAttribute(`transform`)).toBe(
      `rotate(90, ${label?.getAttribute(`x`)}, ${label?.getAttribute(`y`)})`,
    )
    expect(inside_clip_path(label)).toBe(false)
    expect(plot.querySelector(`path[role="button"]`)?.getAttribute(`clip-path`)).toMatch(
      /^url\(#chart-clip-/,
    )
  })

  test.each([
    [`value-axis zero line by default`, [1.1, 1.4, 3.4], undefined, `y`, `vertical`],
    [
      `explicitly enabled category zero line`,
      [-1.1, 1.4, 3.4],
      { x_zero_line: true, y_zero_line: false },
      `x`,
      `vertical`,
    ],
    [
      `value-axis zero with partial display props`,
      [-1.1, 1.4, 3.4],
      { x_grid: false },
      `y`,
      `vertical`,
    ],
    [`value-axis zero when horizontal`, [-1.1, 1.4, 3.4], undefined, `x`, `horizontal`],
  ] as const)(
    `categorical bars render the %s`,
    async (_name, y, display, axis, orientation) => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [`Si`, `GaAs`, `GaN`], y: [...y] }],
        orientation,
        ...(display ? { display } : {}),
      })
      const lines = plot.querySelectorAll(`.zero-line`)
      expect(lines).toHaveLength(1)
      expect(lines[0].getAttribute(`${axis}1`)).toBe(lines[0].getAttribute(`${axis}2`))
    },
  )

  test.each([`vertical`, `horizontal`] as const)(
    `rounds corners on the free end of %s bars`,
    async (orientation) => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [1, 2], y: [-10, 10] }],
        orientation,
        bar: { border_radius: 4 },
      })
      // The rounded end is where the first arc lands: compare it against the path's
      // start point along the value axis to tell which end got the corners.
      const start_re = /^M(?<x>-?[\d.]+),(?<y>-?[\d.]+)/
      const arc_re = /A[\d.]+,[\d.]+ 0 0 [01] (?<x>-?[\d.]+),(?<y>-?[\d.]+)/
      const rounded_beyond_start = (path: Element) => {
        const path_str = path.getAttribute(`d`) ?? ``
        const start = start_re.exec(path_str)?.groups
        const arc = arc_re.exec(path_str)?.groups
        if (!start || !arc) throw new Error(`unexpected bar path ${path_str}`)
        const key = orientation === `vertical` ? `y` : `x`
        return Number(arc[key]) > Number(start[key])
      }
      const [neg_bar, pos_bar] = plot.querySelectorAll(`path[role="button"]`)
      // vertical: negative bar rounds at the bottom (larger y), positive at the top
      // horizontal: negative bar rounds on the left (smaller x), positive on the right
      expect(rounded_beyond_start(neg_bar)).toBe(orientation === `vertical`)
      expect(rounded_beyond_start(pos_bar)).toBe(orientation === `horizontal`)
    },
  )

  const valid_values = [1, 2]
  const invalid_values = [NaN, Infinity]
  const invalid_x = { x: invalid_values, y: valid_values }
  const invalid_y = { x: valid_values, y: invalid_values }
  const unpaired_values = { x: [1, NaN], y: [NaN, 2] }
  test.each([
    {
      name: `vertical x2 with invalid categories`,
      axis: `x2`,
      orientation: `vertical`,
      invalid_series: { ...invalid_x, x_axis: `x2` },
      primary_axis: { x_axis: `x1` },
    },
    {
      name: `vertical x2 with unpaired coordinates`,
      axis: `x2`,
      orientation: `vertical`,
      invalid_series: { ...unpaired_values, x_axis: `x2` },
      primary_axis: { x_axis: `x1` },
    },
    {
      name: `horizontal x2 with invalid values`,
      axis: `x2`,
      orientation: `horizontal`,
      invalid_series: { ...invalid_y, x_axis: `x2` },
      primary_axis: { x_axis: `x1` },
    },
  ] as const)(
    `does not render an axis without a finite point ($name)`,
    async ({ axis, orientation, invalid_series, primary_axis }) => {
      const plot = await mount_sized_bar_plot({
        orientation,
        series: [{ ...basic, ...primary_axis }, invalid_series],
      })
      expect(plot.querySelector(`g.${axis}-axis`)).toBeNull()
      for (const path of plot.querySelectorAll(`path[role="button"]`)) {
        expect(path.getAttribute(`d`)).not.toContain(`NaN`)
      }
    },
  )

  test(`line markers preserve zero-valued inputs and fractional range edges`, async () => {
    // Regression: .filter(Boolean) incorrectly removed 0 from auto-range calculation
    // Zero is a valid value for color/size scales (e.g. minimum on a gradient)
    const on_point_hover = vi.fn()
    const on_point_click = vi.fn()
    const plot = await mount_sized_bar_plot({
      series: [
        {
          ...basic,
          render_mode: `line`,
          markers: `line+points`,
          color_values: [0, 0.25, 0.5, 0.75, 1],
          size_values: [0, 5, 10, 15, 20],
        },
      ],
      x_axis: { range: [1, 5] },
      y_axis: { range: [10, 25] },
      padding: { l: 0.2, r: 64.4, t: 15.1, b: 40.9 },
      on_point_hover,
      on_point_click,
    })
    const line_series = plot.querySelector(`.line-series`)
    expect(line_series?.getAttribute(`clip-path`)).toBeNull()
    expect(line_series?.querySelector(`polyline`)?.getAttribute(`clip-path`)).toMatch(
      /^url\(#.+\)$/,
    )
    const markers = [...plot.querySelectorAll(`.line-points .marker`)]
    expect(markers).toHaveLength(5)
    expect(markers.every((marker) => !marker.getAttribute(`d`)?.includes(`NaN`))).toBe(true)
    expect(markers.every((marker) => marker.closest(`[clip-path]`) === null)).toBe(true)
    markers[0].dispatchEvent(mouse(`mouseover`))
    markers[0].dispatchEvent(mouse(`click`))
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_click).toHaveBeenCalledOnce()
  })

  test(`markerless line series emit point hover and click callbacks`, async () => {
    const on_point_hover = vi.fn()
    const on_point_click = vi.fn()
    const plot = await mount_sized_bar_plot({
      series: [{ x: [-0.01, 1], y: [1, 0], render_mode: `line`, markers: `line` }],
      x_axis: { range: [0, 1] },
      y_axis: { range: [0, 1] },
      on_point_hover,
      on_point_click,
    })
    const hit_target = plot.querySelector(`.line-series polyline[stroke="transparent"]`)
    const clip_rect = plot.querySelector(`clipPath rect`)
    const edge_event = {
      bubbles: true,
      clientX: Number(clip_rect?.getAttribute(`x`)),
      clientY: Number(clip_rect?.getAttribute(`y`)),
    }
    expect(hit_target).toBeInstanceOf(SVGPolylineElement)
    hit_target?.dispatchEvent(new MouseEvent(`mousemove`, edge_event))
    hit_target?.dispatchEvent(new MouseEvent(`click`, edge_event))
    for (const callback of [on_point_hover, on_point_click]) {
      expect(callback).toHaveBeenCalledOnce()
      expect(callback.mock.calls[0][0]).toMatchObject({
        series_idx: 0,
        point: { data_x: 1 },
      })
    }
    hit_target?.dispatchEvent(mouse(`mouseleave`))
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
  })

  test(`omits line hit targets when no data vertex is in range`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [{ x: [-1, 2], y: [0.5, 0.5], render_mode: `line`, markers: `line` }],
      x_axis: { range: [0, 1] },
      y_axis: { range: [0, 1] },
      on_point_click: vi.fn(),
    })
    expect(
      plot.querySelector(`.line-series polyline:not([stroke="transparent"])`),
    ).not.toBeNull()
    expect(plot.querySelector(`.line-series polyline[stroke="transparent"]`)).toBeNull()
  })

  test(`stacked mode keys offsets by x value for misaligned series grids`, async () => {
    // Regression test: offsets accumulated per array index stacked B's x=4 bar on A's x=3 total
    const plot = await mount_sized_bar_plot({
      series: [
        { x: [1, 2, 3], y: [10, 20, 30] },
        { x: [2, 3, 4], y: [5, 5, 5] },
      ],
      mode: `stacked`,
      bar: { border_radius: 0 }, // square corners -> parseable `M x,y h w v h` paths
    })
    // Parse a series' rect paths into { top, bottom } screen coords
    const rects = (idx: number) =>
      Array.from(
        plot.querySelectorAll(`.bar-series[data-series-idx="${idx}"] path[role="button"]`),
        (path) => {
          const [, y_str, h_str] =
            path.getAttribute(`d`)?.match(/^M[\d.-]+,(?<y>[\d.-]+)h[\d.-]+v(?<h>[\d.-]+)/) ??
            []
          return { top: Number(y_str), bottom: Number(y_str) + Number(h_str) }
        },
      )
    const [a_rects, b_rects] = [rects(0), rects(1)]
    expect([a_rects.length, b_rects.length]).toEqual([3, 3])
    // B bars at x=2,3 sit on top of A bars at x=2,3 (B bottom == A top)
    expect(b_rects[0].bottom).toBeCloseTo(a_rects[1].top, 4)
    expect(b_rects[1].bottom).toBeCloseTo(a_rects[2].top, 4)
    // B bar at x=4 has no A bar below it -> starts at baseline 0 (same bottom as A bars)
    expect(b_rects[2].bottom).toBeCloseTo(a_rects[0].bottom, 4)

    // Hovering B's x=2 bar anchors the tooltip at its stacked top (above A's bar), not at the
    // unstacked value 5 near the baseline
    const b_bar = plot.querySelector(`.bar-series[data-series-idx="1"] path[role="button"]`)
    b_bar?.dispatchEvent(mouse(`mousemove`))
    await tick()
    const tooltip = plot.querySelector<HTMLElement>(`.plot-tooltip`)
    expect(tooltip).not.toBeNull()
    expect(Number(tooltip?.style.top.replace(`px`, ``))).toBeLessThan(a_rects[1].top)
  })

  test.each([`vertical`, `horizontal`] as const)(
    `%s bars on a log value axis grow from the plot edge and skip zero bars`,
    async (orientation) => {
      // Regression: base 0 mapped to an infinite pixel on the log scale, so every bar had NaN
      // geometry and none rendered; the zero bar also dragged the auto range down to 1e-9.
      const vertical = orientation === `vertical`
      const plot = await mount_sized_bar_plot({
        series: [{ x: [1, 2, 3, 4], y: [0, 10, 100, 1000], label: `A` }],
        orientation,
        [vertical ? `y_axis` : `x_axis`]: { scale_type: `log` },
        bar: { border_radius: 0 },
        padding: { l: 50, r: 20, t: 20, b: 40 },
      })
      const paths = [...plot.querySelectorAll(`.bar-series path[role="button"]`)]
      expect(paths).toHaveLength(3)
      const rects = paths.map((path) => {
        const match = /^M(?<x>[\d.-]+),(?<y>[\d.-]+)h(?<w>[\d.-]+)v(?<h>[\d.-]+)/.exec(
          path.getAttribute(`d`) ?? ``,
        )
        if (!match?.groups) throw new Error(`unexpected bar path ${path.getAttribute(`d`)}`)
        return Object.fromEntries(
          Object.entries(match.groups).map(([key, val]) => [key, Number(val)]),
        )
      })
      expect(rects.every((rect) => Object.values(rect).every(Number.isFinite))).toBe(true)
      // bars start at the value-axis edge (bottom or left plot border) and are strictly ordered
      const edge = vertical ? 300 - 40 : 50
      for (const rect of rects) {
        expect(vertical ? rect.y + rect.h : rect.x).toBeCloseTo(edge, 6)
      }
      const extents = rects.map((rect) => (vertical ? rect.h : rect.w))
      // the auto range is [10, 1000]: the 10 bar sits on the edge (1px floor), 100 is exactly
      // halfway up the two decades and 1000 spans the whole chart
      expect(extents[0]).toBe(1)
      expect(extents[2]).toBeCloseTo(vertical ? 300 - 40 - 20 : 400 - 50 - 20, 6)
      expect(extents[2]).toBeCloseTo(2 * extents[1], 6)
      const value_ticks = [
        ...plot.querySelectorAll(`g.${vertical ? `y` : `x`}-axis .tick text`),
      ]
        .map((node) => Number(node.textContent?.replace(`k`, `000`)))
        .filter(Number.isFinite)
      expect(Math.min(...value_ticks)).toBeGreaterThanOrEqual(10)
    },
  )

  // The bar renders at the 1px floor and stays hoverable, but scaleLog()(-5) is NaN
  test(`tooltip anchors a negative bar on a log value axis at finite coords`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [{ x: [1, 2], y: [-5, 100], label: `A` }],
      y_axis: { scale_type: `log` },
    })
    plot.querySelector(`path[role="button"]`)?.dispatchEvent(mouse(`mousemove`))
    await tick()
    const tooltip = plot.querySelector<HTMLElement>(`.plot-tooltip`)
    expect(tooltip).not.toBeNull()
    // match the px strings, not Number(): an unset style is `` and Number(``) is a finite 0
    for (const edge of [tooltip?.style.top, tooltip?.style.left]) {
      expect(edge).toMatch(/^-?[\d.]+px$/)
    }
  })

  // The log floor belongs to the VALUE axis only: on the category axis it pinned the anchor to
  // the range minimum while the bar stayed at its raw pixel. happy-dom lays nothing out, so the
  // bar's own path is the only witness to the mapping - assert the exact anchor, not "inside".
  test(`tooltip follows the bar when the category axis is log`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [{ x: [1.9, 4], y: [10, 20], label: `A` }], // 1.9 sits below the range floor
      x_axis: { scale_type: `log`, range: [2, 5] },
      bar: { border_radius: 0 },
      // roomy on the value axis so the tooltip is placed at anchor + offset without flipping
      padding: { l: 50, r: 20, t: 20, b: 40 },
    })
    const [out_of_range_bar] = plot.querySelectorAll(`path[role="button"]`)
    const path = out_of_range_bar?.getAttribute(`d`) ?? ``
    const match = /^M(?<x>[\d.-]+),[\d.-]+h(?<w>[\d.-]+)/.exec(path)
    if (!match?.groups) throw new Error(`unexpected bar path ${path}`)
    // The bar's edges are the category scale at 1.9 +- half the default 0.5 bar width, so
    // they pin down the log mapping; the anchor must land on it at 1.9 itself.
    const lo_px = Number(match.groups.x)
    const log_frac = Math.log(1.9 / 1.65) / Math.log(2.15 / 1.65)
    const anchor = lo_px + Number(match.groups.w) * log_frac
    out_of_range_bar?.dispatchEvent(mouse(`mousemove`))
    await tick()
    const left = plot.querySelector<HTMLElement>(`.plot-tooltip`)?.style.left ?? ``
    // anchor + the tooltip's offset; a floored anchor sits ~19px away at the range minimum
    expect(Number(left.replace(`px`, ``))).toBeCloseTo(anchor + 10, 3)
  })

  test(`default tooltip shows series label for multi-series on hover`, async () => {
    const series_a: BarSeries = { x: [1, 2], y: [10, 20], label: `Group A`, color: `red` }
    const series_b: BarSeries = { x: [1, 2], y: [5, 15], label: `Group B`, color: `blue` }
    const plot = await mount_sized_bar_plot({
      series: [series_a, series_b],
      x_axis: { label: `X` },
      y_axis: { label: `Count` },
    })
    const bar = plot.querySelector(`path[role="button"]`)
    expect(bar).toBeInstanceOf(SVGPathElement)
    bar?.dispatchEvent(mouse(`mousemove`))
    await tick()
    const text = plot.querySelector(`.plot-tooltip`)?.textContent ?? ``
    expect(text).toContain(`Group A`)
    expect(text).toContain(`Count`)
  })

  test(`custom tooltip snippet`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic],
      tooltip: createRawSnippet<[BarHandlerProps]>((data) => ({
        render: () => `<div class="custom-tooltip">x: ${data().x}, y: ${data().y}</div>`,
      })),
    })
    const first_bar = plot.querySelector(`path[role="button"]`)
    expect(first_bar).toBeInstanceOf(SVGPathElement)
    first_bar?.dispatchEvent(mouse(`mousemove`))
    await tick()
    expect(plot.querySelector(`.custom-tooltip`)?.textContent).toBe(`x: 1, y: 10`)
  })

  describe(`categorical bar charts`, () => {
    const cat_series: BarSeries[] = [
      { x: [`A`, `B`, `C`], y: [10, 20, 30], label: `S1`, color: `blue` },
      { x: [`B`, `C`, `D`], y: [5, 15, 25], label: `S2`, color: `red` },
    ]

    test.each([
      [`overlay mode`, { mode: `overlay` }],
      [`stacked mode`, { mode: `stacked` }],
      [`grouped mode`, { mode: `grouped` }],
      [`horizontal orientation`, { orientation: `horizontal` }],
    ] as const)(`renders misaligned categories in %s`, async (_name, props) => {
      const plot = await mount_sized_bar_plot({ series: cat_series, ...props })
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(2)
      expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(6)
    })

    // Every category renders a bar; the measured thinning strategy only removes crowded ticks.
    test.each([
      { desc: `few categories keep every tick`, n_cats: 3, min_ticks: 3, max_ticks: 3 },
      { desc: `many categories thin the ticks`, n_cats: 30, min_ticks: 2, max_ticks: 14 },
    ])(
      `single categorical series renders every bar ($desc)`,
      async ({ n_cats, min_ticks, max_ticks }) => {
        const cats = Array.from({ length: n_cats }, (_cat, idx) => `cat${idx}`)
        const plot = await with_measured_text(() =>
          mount_sized_bar_plot({
            series: [{ x: cats, y: cats.map((_cat, idx) => idx + 1), color: `blue` }],
            x_axis: {
              tick_label: { auto_layout: { strategies: [`thin`] } },
            },
          }),
        )
        expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(n_cats)
        const tick_count = plot.querySelectorAll(`g.x-axis g.tick`).length
        expect(tick_count).toBeGreaterThanOrEqual(min_ticks)
        expect(tick_count).toBeLessThanOrEqual(max_ticks)
      },
    )

    // categorical ticks are generated for every category regardless of the view, so
    // a panned/zoomed range must cull the ones that fall outside the plot area
    test(`ticks panned outside the plot area are culled`, async () => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [`A`, `B`, `C`, `D`, `E`], y: [1, 2, 3, 4, 5], color: `blue` }],
        x_axis: { range: [1.5, 3.5] }, // panned view: only C and D remain in range
      })
      const labels = [...plot.querySelectorAll(`g.x-axis g.tick text`)].map((el) =>
        el.textContent?.trim(),
      )
      expect(labels).toEqual([`C`, `D`])
    })

    test(`hover reports category_label + metadata and tooltip shows the category name`, async () => {
      const hover_fn = vi.fn()
      const plot = await mount_sized_bar_plot({
        series: [
          {
            x: [`Alpha`, `Beta`, `Gamma`],
            y: [10, 20, 30],
            color: `blue`,
            metadata: [{ id: 1 }, { id: 2 }, { id: 3 }],
          },
        ],
        x_axis: { label: `Greek` },
        on_bar_hover: hover_fn,
      })
      const bar = query(plot, `path[role="button"]`)
      bar.dispatchEvent(mouse(`mousemove`))
      await tick()
      expect(hover_fn).toHaveBeenCalled()
      const data = hover_fn.mock.calls[0][0]
      expect(data.category_label).toBe(`Alpha`)
      expect(data.metadata).toEqual({ id: 1 })
      // tooltip shows the category name, not its numeric index
      const tooltip_text = plot.querySelector(`.plot-tooltip`)?.textContent ?? ``
      expect(tooltip_text).toContain(`Alpha`)
      expect(tooltip_text).not.toMatch(/\b0\b/)
    })
  })

  test(`renders grouped and ungrouped legend entries`, async () => {
    const series = (
      label: string,
      y: number[],
      color: string,
      legend_group?: string,
    ): BarSeries => ({ x: [1, 2, 3], y, label, color, legend_group })
    const grouped_series: BarSeries[] = [
      series(`PBE`, [10, 20, 15], `blue`, `DFT`),
      series(`LDA`, [12, 18, 17], `lightblue`, `DFT`),
      series(`MACE`, [11, 19, 16], `red`, `ML`),
      series(`Experiment`, [10.5, 20.5, 15.5], `green`),
    ]
    const plot = await mount_sized_bar_plot({ series: grouped_series })
    expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(4)
    // the two DFT series collapse under one group entry, the ungrouped one stands alone
    for (const label of [`DFT`, `ML`, `Experiment`]) {
      expect(plot.textContent).toContain(label)
    }
  })

  test(`series pattern fills bars and the legend swatch from scoped <pattern> defs`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [
        { ...basic, label: `hatched`, pattern: `/` },
        { ...basic, label: `hatched-too`, pattern: `/` }, // same tile -> shares the def
        { ...basic, label: `plain`, color: `tomato` },
        // line series never texture: there is no area to fill
        { ...basic, label: `line`, pattern: `.`, render_mode: `line` },
      ],
    })
    const bar = (idx: number) =>
      plot.querySelector(`.bar-series[data-series-idx="${idx}"] path[role="button"]`)
    const pattern_id = pattern_id_of(bar(0), `bar`)
    expect(pattern_id_of(bar(1), `bar`)).toBe(pattern_id)
    expect(bar(2)?.getAttribute(`fill`)).toBe(`tomato`)
    // legend swatches carry their own `legend-` defs, so count only the chart's `bar-` ones
    const chart_defs = plot.querySelectorAll(`.bar-plot svg defs pattern[id^="bar-"]`)
    expect(chart_defs).toHaveLength(1)
    expect(chart_defs[0].id).toBe(pattern_id)
    expect(chart_defs[0].querySelector(`rect`)?.getAttribute(`fill`)).toBe(`steelblue`)
    // the legend renders its own half-scale copy of the tile inside the swatch svg
    const items = [...plot.querySelectorAll<HTMLElement>(`.legend-item`)]
    expect(items.map((item) => item.querySelectorAll(`pattern`).length)).toEqual([1, 1, 0, 0])
    const swatch_def = items[0].querySelector(`pattern`)
    expect(swatch_def?.getAttribute(`width`)).toBe(`4`)
    expect(items[0].querySelector(`.legend-marker > svg > path`)?.getAttribute(`fill`)).toBe(
      `url(#${swatch_def?.id})`,
    )
    expect(swatch_def?.id).not.toBe(pattern_id)
  })

  const legend_position = (plot: HTMLElement): { x: number; y: number } => {
    const legend = query(plot, `.legend`)
    return {
      x: Number(legend.style.left.replace(`px`, ``)),
      y: Number(legend.style.top.replace(`px`, ``)),
    }
  }

  const bar_rects = (plot: HTMLElement) =>
    [...plot.querySelectorAll(`.bar-series path[role="button"]`)].map((path) => {
      const path_data = path.getAttribute(`d`) ?? ``
      const match = /^M(?<x>[\d.-]+),(?<y>[\d.-]+)h(?<width>[\d.-]+)v(?<height>[\d.-]+)/.exec(
        path_data,
      )?.groups
      if (!match) throw new Error(`unexpected square bar path: ${path_data}`)
      const x = Number(match.x)
      const y = Number(match.y)
      const width = Number(match.width)
      const height = Number(match.height)
      return {
        x: Math.min(x, x + width),
        y: Math.min(y, y + height),
        width: Math.abs(width),
        height: Math.abs(height),
      }
    })

  test(`automatic legend placement avoids sparse bar and line obstacles`, async () => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(60)
    const plot = await mount_sized_bar_plot({
      series: [
        { x: [1, 2, 3], y: [8, 12, 10], label: `Bars` },
        {
          x: [1, 2, 3],
          y: [9, 11, 8],
          label: `Line`,
          render_mode: `line`,
          markers: `line`,
        },
      ],
      show_legend: true,
      bar: { border_radius: 0 },
    })
    const { x, y } = legend_position(plot)
    const legend_rect = { x, y, width: 120, height: 60 }
    const overlaps = bar_rects(plot).some(
      (bar_rect) =>
        legend_rect.x < bar_rect.x + bar_rect.width &&
        legend_rect.x + legend_rect.width > bar_rect.x &&
        legend_rect.y < bar_rect.y + bar_rect.height &&
        legend_rect.y + legend_rect.height > bar_rect.y,
    )
    expect(overlaps).toBe(false)
    const line_points = (
      plot.querySelector(`.line-series polyline`)?.getAttribute(`points`) ?? ``
    )
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(`,`).map(Number))
    const sampled_line_points = line_points.flatMap((point, point_idx) => {
      const next_point = line_points[point_idx + 1]
      if (!next_point) return [point]
      return Array.from({ length: 11 }, (_, sample_idx) => {
        const fraction = sample_idx / 10
        return [
          point[0] + (next_point[0] - point[0]) * fraction,
          point[1] + (next_point[1] - point[1]) * fraction,
        ]
      })
    })
    expect(
      sampled_line_points.some(
        ([point_x, point_y]) =>
          point_x >= legend_rect.x &&
          point_x <= legend_rect.x + legend_rect.width &&
          point_y >= legend_rect.y &&
          point_y <= legend_rect.y + legend_rect.height,
      ),
    ).toBe(false)
  })

  test.each([
    { orientation: `vertical`, secondary_axis: `y2` },
    { orientation: `horizontal`, secondary_axis: `x2` },
  ] as const)(
    `visible automatic axis groups reassign in $orientation orientation`,
    async ({ orientation, secondary_axis }) => {
      const input: BarSeries[] = [
        { x: [1, 2], y: [1, 2], label: `Energy`, unit: `eV` },
        { x: [1, 2], y: [100, 200], label: `Pressure`, unit: `GPa` },
      ]
      const plot = await mount_sized_bar_plot({
        series: input,
        show_legend: true,
        bar: { border_radius: 0 },
        orientation,
      })
      expect(plot.querySelector(`g.${secondary_axis}-axis`)).toBeInstanceOf(SVGGElement)
      const first_legend_item = plot.querySelector(`.legend-item`)
      first_legend_item?.dispatchEvent(mouse(`mouseenter`))
      await tick()
      expect(plot.querySelectorAll(`.bar-series`)[1]?.getAttribute(`opacity`)).toBe(`0.25`)
      first_legend_item?.dispatchEvent(mouse(`click`))
      await tick()
      expect(plot.querySelector(`.legend-item`)?.classList.contains(`hidden`)).toBe(true)
      expect(orientation === `vertical` ? input[1].y_axis : input[1].x_axis).toBeUndefined()
      expect(plot.querySelector(`g.${secondary_axis}-axis`)).toBeNull()
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(1)
      expect(plot.querySelector(`.bar-series`)?.getAttribute(`opacity`)).toBe(`1`)
      plot.querySelector(`.legend-item`)?.dispatchEvent(mouse(`click`))
      await tick()
      expect(
        [...plot.querySelectorAll(`.legend-item`)].every(
          (item) => !item.classList.contains(`hidden`),
        ),
      ).toBe(true)
      expect(plot.querySelector(`g.${secondary_axis}-axis`)).toBeInstanceOf(SVGGElement)
    },
  )

  test.each([
    { orientation: `vertical`, secondary_axis: `y2`, explicit_axis: { y_axis: `y1` } },
    { orientation: `horizontal`, secondary_axis: `x2`, explicit_axis: { x_axis: `x1` } },
  ] as const)(
    `explicit value axes reserve their slot in $orientation orientation`,
    async ({ orientation, secondary_axis, explicit_axis }) => {
      const plot = await mount_sized_bar_plot({
        orientation,
        series: [
          { x: [1, 2], y: [1, 2], unit: `eV`, ...explicit_axis },
          { x: [1, 2], y: [100, 200], unit: `GPa` },
        ],
      })
      expect(plot.querySelector(`g.${secondary_axis}-axis`)).toBeInstanceOf(SVGGElement)
    },
  )

  test(`implicit and explicit y1 assignment render identically`, async () => {
    const collect_geometry = async (series: BarSeries[]) => {
      const plot = await mount_sized_bar_plot({
        series,
        mode: `grouped`,
        bar: { border_radius: 0 },
      })
      return {
        bars: [...plot.querySelectorAll(`.bar-series path[role="button"]`)].map((path) =>
          path.getAttribute(`d`),
        ),
        clip: [...(plot.querySelector(`clipPath rect`)?.attributes ?? [])].map(
          ({ name, value }) => [name, value],
        ),
        y_ticks: [...plot.querySelectorAll(`g.y-axis .tick text`)].map(
          (tick_label) => tick_label.textContent,
        ),
      }
    }
    const input = [basic, { ...basic, label: `Second`, color: `tomato` }]
    expect(await collect_geometry(input)).toEqual(
      await collect_geometry(input.map((srs) => ({ ...srs, y_axis: `y1` }))),
    )
  })

  test(`automatic axis overflow names the conflicting groups`, async () => {
    await expect(
      mount_sized_bar_plot({
        series: [
          { x: [1], y: [1], unit: `eV` },
          { x: [1], y: [2], unit: `GPa` },
          { x: [1], y: [3], unit: `K` },
        ],
      }),
    ).rejects.toThrow(
      `BarPlot cannot automatically assign visible value series in vertical orientation: Cannot assign 3 visible axis groups to 2 axes: eV, GPa, K`,
    )
  })
})
