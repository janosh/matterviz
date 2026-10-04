import BarPlot from '#lib/plot/bar/BarPlot.svelte'
import SpacegroupBarPlot from '#lib/plot/bar/SpacegroupBarPlot.svelte'
import type { BarHandlerProps, BarSeries } from '#lib/plot/index.js'
import { type ComponentProps, createRawSnippet, flushSync, tick } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { point_in_rect, rects_overlap } from '#lib/plot/core/layout.js'
import { DEFAULT_FONT_SPEC } from '#lib/plot/core/text-metrics.js'
import { measure_text_width } from '#lib/plot/core/tick-layout.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  clip_rect,
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

// Screen rects of square-cornered (`M x,y h w v h`) bars
const bar_rects = (root: ParentNode) =>
  [...root.querySelectorAll(`.bar-series path[role="button"]`)].map((path) => {
    const path_data = path.getAttribute(`d`) ?? ``
    const match = /^M(?<x>[\d.-]+),(?<y>[\d.-]+)h(?<w>[\d.-]+)v(?<h>[\d.-]+)/.exec(path_data)
    if (!match) throw new Error(`unexpected square bar path: ${path_data}`)
    const [coord_x, coord_y, width, height] = match.slice(1).map(Number)
    return {
      x: Math.min(coord_x, coord_x + width),
      y: Math.min(coord_y, coord_y + height),
      width: Math.abs(width),
      height: Math.abs(height),
    }
  })

const mount_sized_bar_plot = (
  props: Partial<ComponentProps<typeof BarPlot>>,
  size: { width?: number; height?: number } = {},
): Promise<HTMLElement> => mount_sized(BarPlot, props, { selector: `.bar-plot`, ...size })

describe(`BarPlot`, () => {
  afterEach(() => vi.restoreAllMocks())

  test.each([`vertical`, `horizontal`] as const)(
    `space-group bars aggregate symbols and numbers in %s orientation`,
    async (orientation) => {
      const plot = await mount_sized(
        SpacegroupBarPlot,
        { data: [225, `Fm-3m`, 2, 0, 231], orientation },
        { selector: `.bar-plot` },
      )
      expect(
        [...plot.querySelectorAll(`.bar-series path[role="button"]`)].map((bar) =>
          bar.getAttribute(`aria-label`),
        ),
      ).toEqual([`bar 1 of triclinic: 1`, `bar 1 of cubic: 2`])
      expect(plot.querySelectorAll(`.crystal-system-overlays rect`)).toHaveLength(7)
    },
  )

  test.each([`vertical`, `horizontal`] as const)(
    `only mounts bars crossing the %s viewport and keeps source indices`,
    async (orientation) => {
      const on_bar_click = vi.fn()
      const category_axis = { range: [40, 50] as [number, number] }
      const plot = await mount_sized_bar_plot({
        series: [{ x: Array.from({ length: 2000 }, (_, idx) => idx), y: Array(2000).fill(5) }],
        orientation,
        on_bar_click,
        ...(orientation === `vertical`
          ? { x_axis: category_axis }
          : { y_axis: category_axis }),
      })
      const paths = [...plot.querySelectorAll(`.bar-series path`)]
      expect(paths).toHaveLength(11)
      expect(paths[0].getAttribute(`aria-label`)).toContain(`bar 41 `)
      paths[0].dispatchEvent(mouse(`click`))
      expect(on_bar_click).toHaveBeenCalledWith(
        expect.objectContaining({ bar_idx: 40, x: 40, y: 5, event: expect.any(MouseEvent) }),
      )
      expect(paths.map((path) => path.getAttribute(`tabindex`))).toEqual(one_tab_stop(11))
    },
  )

  // exactly one tab stop per mark group, even with nothing hovered
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

  // A centred label on the first bar spilled onto the y-axis tick labels (XRD peak labels)
  test(`shifts an edge bar's wide label inside the plot area`, async () => {
    const label_x = async (text: string) => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [1, 2, 3, 4, 5, 6, 7, 8], y: [9, 1, 1, 1, 1, 1, 1, 1], labels: [text] }],
      })
      const clip_x = Number(plot.querySelector(`clipPath rect`)?.getAttribute(`x`))
      return [Number(plot.querySelector(`.bar-label`)?.getAttribute(`x`)), clip_x]
    }
    const long_label = `a long peak label at 20.07°`
    const [long_x, clip_x] = await label_x(long_label)
    // the centred label's left edge stays right of the plot's left edge (the y tick labels)
    const half_width =
      measure_text_width(long_label, { ...DEFAULT_FONT_SPEC, font_size: 11 }) / 2
    expect(long_x - half_width).toBeGreaterThanOrEqual(clip_x - 1e-9)
    // a one-character label still sits centred on its bar
    expect(long_x).toBeGreaterThan((await label_x(`a`))[0])
  })

  // Start-anchored past the bar's end, the longest horizontal bar's label ran off the plot
  test(`keeps the longest horizontal bar's label inside the plot area`, async () => {
    const label = `a long label for the longest bar`
    const plot = await mount_sized_bar_plot({
      series: [{ x: [1, 2, 3], y: [1, 2, 9], labels: [``, ``, label] }],
      orientation: `horizontal`,
    })
    const clip = plot.querySelector(`clipPath rect`)
    const clip_right = Number(clip?.getAttribute(`x`)) + Number(clip?.getAttribute(`width`))
    const label_x = Number(plot.querySelector(`.bar-label`)?.getAttribute(`x`))
    const width = measure_text_width(label, { ...DEFAULT_FONT_SPEC, font_size: 11 })
    expect(label_x + width).toBeLessThanOrEqual(clip_right + 1e-9)
  })

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
    async (_name, coord_y, display, axis, orientation) => {
      const plot = await mount_sized_bar_plot({
        series: [{ x: [`Si`, `GaAs`, `GaN`], y: [...coord_y] }],
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

  test.each([
    [`vertical`, `invalid categories`, { x: [NaN, Infinity], y: [1, 2] }],
    [`vertical`, `unpaired coordinates`, { x: [1, NaN], y: [NaN, 2] }],
    [`horizontal`, `invalid values`, { x: [1, 2], y: [NaN, Infinity] }],
  ] as const)(
    `does not render a %s x2 axis without a finite point (%s)`,
    async (orientation, _desc, invalid_coords) => {
      const plot = await mount_sized_bar_plot({
        orientation,
        series: [
          { ...basic, x_axis: `x` },
          { x: [...invalid_coords.x], y: [...invalid_coords.y], x_axis: `x2` },
        ],
      })
      expect(plot.querySelector(`g.x2-axis`)).toBeNull()
      for (const path of plot.querySelectorAll(`path[role="button"]`)) {
        expect(path.getAttribute(`d`)).not.toContain(`NaN`)
      }
    },
  )

  test(`line markers preserve zero-valued inputs and fractional range edges`, async () => {
    // zero is a valid color/size value (e.g. the minimum of a gradient), not a missing one
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
    const { x: clientX, y: clientY } = clip_rect(plot)
    const edge_event = { bubbles: true, clientX, clientY }
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
    // offsets accumulated per array index would stack B's x=4 bar on A's x=3 total
    const plot = await mount_sized_bar_plot({
      series: [
        { x: [1, 2, 3], y: [10, 20, 30] },
        { x: [2, 3, 4], y: [5, 5, 5] },
      ],
      mode: `stacked`,
      bar: { border_radius: 0 }, // square corners -> parseable `M x,y h w v h` paths
    })
    const [a_rects, b_rects] = [...plot.querySelectorAll(`.bar-series`)].map((group) =>
      bar_rects(group).map(({ y: top, height }) => ({ top, bottom: top + height })),
    )
    expect([a_rects.length, b_rects.length]).toEqual([3, 3])
    // B bars at x=2,3 sit on top of A bars at x=2,3 (B bottom == A top)
    expect(b_rects[0].bottom).toBeCloseTo(a_rects[1].top, 4)
    expect(b_rects[1].bottom).toBeCloseTo(a_rects[2].top, 4)
    // B bar at x=4 has no A bar below it -> starts at baseline 0 (same bottom as A bars)
    expect(b_rects[2].bottom).toBeCloseTo(a_rects[0].bottom, 4)
  })

  test.each([`vertical`, `horizontal`] as const)(
    `%s bars on a log value axis grow from the plot edge and skip zero bars`,
    async (orientation) => {
      // base 0 maps to an infinite pixel on a log scale, and a zero bar must not drag the
      // auto range down to 1e-9
      const vertical = orientation === `vertical`
      const plot = await mount_sized_bar_plot({
        series: [{ x: [1, 2, 3, 4], y: [0, 10, 100, 1000], label: `A` }],
        orientation,
        [vertical ? `y_axis` : `x_axis`]: { scale_type: `log` },
        bar: { border_radius: 0 },
        padding: { l: 50, r: 20, t: 20, b: 40 },
      })
      const rects = bar_rects(plot)
      expect(rects).toHaveLength(3)
      expect(rects.every((rect) => Object.values(rect).every(Number.isFinite))).toBe(true)
      // bars start at the value-axis edge (bottom or left plot border) and are strictly ordered
      const edge = vertical ? 300 - 40 : 50
      for (const rect of rects) {
        expect(vertical ? rect.y + rect.height : rect.x).toBeCloseTo(edge, 6)
      }
      const extents = rects.map((rect) => (vertical ? rect.height : rect.width))
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

  // anchors must follow the group slot and stack base, and floor the value axis on log ones
  const grouped = [0, 1, 2].map((idx) => ({ x: [1, 2], y: [5 + idx, 20], label: `S${idx}` }))
  // oxfmt-ignore
  test.each<[string, Partial<ComponentProps<typeof BarPlot>>]>([
    [`grouped vertical bars`, { series: grouped, mode: `grouped` }],
    [`grouped horizontal bars`, { series: grouped, mode: `grouped`, orientation: `horizontal` }],
    [`stacked bars`, { series: grouped, mode: `stacked` }],
    [`a negative bar on a log value axis`, { series: [{ x: [1, 2], y: [-5, 100] }], y_axis: { scale_type: `log` } }],
    [`a log category axis`, { series: [{ x: [1.9, 4], y: [10, 20] }], x_axis: { scale_type: `log`, range: [2, 5] } }],
  ])(`tooltip anchors at the hovered bar's tip for %s`, async (_name, props) => {
    const plot = await mount_sized_bar_plot(
      { bar: { border_radius: 0 }, padding: { l: 50, r: 20, t: 20, b: 80 }, ...props },
      { width: 800, height: 400 },
    )
    const series_groups = plot.querySelectorAll(`.bar-series`)
    expect(series_groups.length).toBeGreaterThan(0)
    // each series' first bar leaves the 140x50 fallback tooltip room to sit at anchor + offset
    for (const group of series_groups) {
      const [{ x: rect_x, y: rect_y, width, height }] = bar_rects(group)
      query(group, `path[role="button"]`).dispatchEvent(mouse(`mousemove`))
      await tick()
      const { left, top } = query(plot, `.plot-tooltip`).style
      const [anchor_x, anchor_y] =
        props.orientation === `horizontal`
          ? [rect_x + width, rect_y + height / 2]
          : [rect_x + width / 2, rect_y]
      // anchor + the tooltip's { x: 10, y: 5 } offset
      expect(Number(left.replace(`px`, ``))).toBeCloseTo(anchor_x + 10, 6)
      expect(Number(top.replace(`px`, ``))).toBeCloseTo(anchor_y + 5, 6)
    }
  })

  // the tooltip must not be a snapshot: it tracks new data under a resting pointer
  test(`a resting hover follows replaced data and closes once its bar is gone`, async () => {
    const [s0, s1] = grouped
    // a reactive getter lets this plain .ts test replace the series under the resting pointer
    const current = new SvelteMap<string, BarSeries[]>([[`series`, [s0, s1]]])
    const plot = await mount_sized_bar_plot({
      get series() {
        return current.get(`series`)
      },
    })
    const tooltip_after = (series: BarSeries[]) => {
      current.set(`series`, series)
      flushSync()
      return plot.querySelector(`.plot-tooltip`)?.textContent ?? null
    }
    // S1's second bar
    plot
      .querySelectorAll(`.bar-series[data-series-idx="1"] path[role="button"]`)[1]
      .dispatchEvent(mouse(`mousemove`))
    await tick()
    expect(tooltip_after([s0, { ...s1, y: [6, 37] }])).toMatch(/y: 37/)
    expect(tooltip_after([s0])).toBeNull()
    expect(tooltip_after([s0, { ...s1, x: [1], y: [6] }])).toBeNull()
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

    // x2 gets category ticks and honours a pinned x range; panned-out ticks are culled
    test.each([
      { x_axis: {}, labels: [`A`, `B`, `C`, `D`] },
      { x_axis: { range: [0.5, 2.5] as [number, number] }, labels: [`B`, `C`] },
    ])(
      `categorical x2 series share the slots and labels of x (x_axis=$x_axis)`,
      async ({ x_axis, labels }) => {
        const series = { x: [`A`, `B`, `C`, `D`], y: [1, 2, 3, 4] }
        const plot = await mount_sized_bar_plot({
          series: [series, { ...series, x_axis: `x2` }],
          x_axis,
          bar: { border_radius: 0 },
        })
        const [x_centers, x2_centers] = [...plot.querySelectorAll(`.bar-series`)].map(
          (group) => bar_rects(group).map(({ x: rect_x, width }) => rect_x + width / 2),
        )
        expect(x_centers).toHaveLength(4)
        expect(x2_centers).toEqual(x_centers)
        for (const axis of [`x`, `x2`]) {
          const ticks = plot.querySelectorAll(`g.${axis}-axis g.tick text`)
          expect([...ticks].map((node) => node.textContent?.trim())).toEqual(labels)
        }
      },
    )

    // a hidden x2 takes no padding: categorical x must not measure category ticks for it
    test(`categorical x without x2 series reserves no top padding`, async () => {
      const clip_top = async (x: (string | number)[]) =>
        clip_rect(await mount_sized_bar_plot({ series: [{ x, y: [1, 2, 3] }] })).y
      expect(await clip_top([`alpha`, `beta`, `gamma`])).toBe(await clip_top([0, 1, 2]))
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
      coord_y: number[],
      color: string,
      legend_group?: string,
    ): BarSeries => ({ x: [1, 2, 3], y: coord_y, label, color, legend_group })
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
    const legend_rect = { ...legend_position(plot), width: 120, height: 60 }
    expect(bar_rects(plot).some((bar_rect) => rects_overlap(legend_rect, bar_rect))).toBe(
      false,
    )
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
      sampled_line_points.some(([point_x, point_y]) =>
        point_in_rect({ x: point_x, y: point_y }, legend_rect),
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
    { orientation: `vertical`, secondary_axis: `y2`, explicit_axis: { y_axis: `y` } },
    { orientation: `horizontal`, secondary_axis: `x2`, explicit_axis: { x_axis: `x` } },
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
      await collect_geometry(input.map((srs) => ({ ...srs, y_axis: `y` }))),
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
