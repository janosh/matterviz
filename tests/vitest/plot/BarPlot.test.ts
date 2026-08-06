import { BarPlot } from '$lib'
import type { BarHandlerProps, BarSeries } from '$lib/plot'
import { type ComponentProps, createRawSnippet, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  axis_label_pivot_y,
  inside_clip_path,
  mount_sized,
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

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [
        basic,
        {
          x: [100, 200, 300],
          y: [5, 15, 25],
          x_axis: `x2`,
          label: `X2 Series`,
          color: `orangered`,
        },
      ],
      x2_axis: { label: `Temperature (K)` },
    })
    expect(plot.querySelector(`g.x2-axis`)).toBeInstanceOf(SVGGElement)
    expect(plot.querySelector(`.x2-label`)?.textContent).toBe(`Temperature (K)`)
  })

  test(`y2 axis title shares the y axis title's vertical center`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic, { x: [1, 2, 3], y: [100, 200, 300], label: `Sec`, y_axis: `y2` }],
      y_axis: { label: `Primary` },
      y2_axis: { label: `Secondary` },
    })
    // both y titles rotate about the plot's vertical center; a stale label_shift default
    // used to push the y2 title 60px below center
    const pivot_y = (selector: string) => axis_label_pivot_y(plot, selector)
    expect(pivot_y(`.axis-label.y2-label`)).toBeCloseTo(pivot_y(`.axis-label.y-label`), 5)
  })

  test(`explicit top/right padding is not overridden by secondary-axis auto-padding`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [
        basic,
        { ...basic, label: `Y2`, y_axis: `y2` },
        { ...basic, label: `X2`, x_axis: `x2` },
      ],
      padding: { r: 10, t: 10 },
      x2_axis: { label: `Top` },
      y2_axis: { label: `Secondary` },
    })
    const clip_rect = plot.querySelector(`clipPath rect`)
    expect(Number(clip_rect?.getAttribute(`width`))).toBe(330)
    expect(Number(clip_rect?.getAttribute(`y`))).toBe(10)
  })

  test(`title-only y2 axis expands right padding`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic, { ...basic, label: `Y2`, y_axis: `y2` }],
      y_axis: { ticks: [] },
      y2_axis: { label: `Secondary`, ticks: [] },
    })
    expect(Number(plot.querySelector(`clipPath rect`)?.getAttribute(`width`))).toBe(308)
  })

  test(`default padding grows for wide y-axis ticks`, async () => {
    const plot = await with_measured_text(
      () => mount_sized_bar_plot({ series: [basic], y_axis: { label: `Value` } }),
      60, // 2-digit y ticks measure 120px wide, far past the 60px default left pad
    )
    expect(Number(plot.querySelector(`clipPath rect`)?.getAttribute(`x`))).toBeGreaterThan(60)
  })

  test(`line markers render zero-valued color and size inputs`, async () => {
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
      on_point_hover,
      on_point_click,
    })
    expect(plot.querySelectorAll(`.line-series`)).toHaveLength(1)
    const markers = [...plot.querySelectorAll(`.line-points .marker`)]
    expect(markers).toHaveLength(5)
    expect(markers.every((marker) => !marker.getAttribute(`d`)?.includes(`NaN`))).toBe(true)
    markers[0].dispatchEvent(new MouseEvent(`mouseover`, { bubbles: true }))
    markers[0].dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_click).toHaveBeenCalledOnce()
  })

  test(`markerless line series emit point hover and click callbacks`, async () => {
    const on_point_hover = vi.fn()
    const on_point_click = vi.fn()
    const plot = await mount_sized_bar_plot({
      series: [{ ...basic, render_mode: `line`, markers: `line` }],
      on_point_hover,
      on_point_click,
    })
    const hit_target = plot.querySelector(`.line-series polyline[stroke="transparent"]`)
    expect(hit_target).toBeInstanceOf(SVGPolylineElement)
    hit_target?.dispatchEvent(
      new MouseEvent(`mousemove`, { bubbles: true, clientX: 100, clientY: 100 }),
    )
    hit_target?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover.mock.calls[0][0]).toMatchObject({ series_idx: 0 })
    expect(on_point_click).toHaveBeenCalledOnce()
    expect(on_point_click.mock.calls[0][0]).toMatchObject({ series_idx: 0 })
    hit_target?.dispatchEvent(new MouseEvent(`mouseleave`, { bubbles: true }))
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
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
  })

  test(`default tooltip shows series label for multi-series on hover`, async () => {
    const series_a: BarSeries = { x: [1, 2], y: [10, 20], label: `Group A`, color: `red` }
    const series_b: BarSeries = { x: [1, 2], y: [5, 15], label: `Group B`, color: `blue` }
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [series_a, series_b],
        x_axis: { label: `X` },
        y_axis: { label: `Count` },
      },
    })
    await tick()
    const bar = document.querySelector(`path[role="button"]`)
    expect(bar).toBeInstanceOf(SVGPathElement)
    bar?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    const text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
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
    first_bar?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    expect(plot.querySelector(`.custom-tooltip`)?.textContent).toBe(`x: 1, y: 10`)
  })

  test(`children prop`, () => {
    mount(BarPlot, {
      target: document.body,
      props: {
        series: [basic],
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-bar-child">Custom bar overlay</div>`,
        })),
      },
    })
    expect(document.querySelector(`.custom-bar-child`)?.textContent).toBe(`Custom bar overlay`)
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
              tick: { label: { auto_layout: { strategies: [`thin`] } } },
            },
          }),
        )
        expect(plot.querySelectorAll(`path[role="button"]`)).toHaveLength(n_cats)
        const tick_count = plot.querySelectorAll(`g.x-axis g.tick`).length
        expect(tick_count).toBeGreaterThanOrEqual(min_ticks)
        expect(tick_count).toBeLessThanOrEqual(max_ticks)
      },
    )

    const x_tick_labels = (plot: HTMLElement): Element[] => [
      ...plot.querySelectorAll(`g.x-axis g.tick text`),
    ]

    test(`long category names auto-rotate`, async () => {
      const cats = [`PENDING`, `RUNNING`, `QUEUE_HOLD`, `COMPLETED`, `CANCELLED`]
      const plot = await with_measured_text(() =>
        mount_sized_bar_plot({
          series: [{ x: cats, y: cats.map((_cat, idx) => idx + 1), color: `blue` }],
          x_axis: {
            label: `state`,
            tick: { label: { auto_layout: { strategies: [`rotate`] } } },
          },
        }),
      )
      const labels = x_tick_labels(plot)
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) {
        // Negative angle anchored at the label's end, so it trails left of its tick and
        // the rightmost one cannot spill past the plot's right edge.
        expect(label.getAttribute(`transform`)).toMatch(/^rotate\(-[\d.]+,/)
        expect(label.getAttribute(`text-anchor`)).toBe(`end`)
      }
    })

    // Horizontal orientation moves the categories onto y, so the left padding has to be
    // measured from the category names. Measuring ticks.y sizes it from the integer slot
    // indices instead, leaving the names to overrun the reserved gutter.
    test(`horizontal orientation sizes left padding from category names`, async () => {
      const left_pad_for = (cats: string[]) =>
        with_measured_text(async () => {
          const plot = await mount_sized_bar_plot({
            series: [{ x: cats, y: cats.map((_cat, idx) => idx + 1), color: `blue` }],
            orientation: `horizontal`,
          })
          return Number(plot.querySelector(`clipPath rect`)?.getAttribute(`x`))
        })
      const long = await left_pad_for([`QUEUE_HOLD`, `COMPLETED`, `CANCELLED`])
      const short = await left_pad_for([`A`, `B`, `C`])
      expect(short).toBeGreaterThan(0)
      expect(long).toBeGreaterThan(short)
    })

    test(`short category names stay upright`, async () => {
      const plot = await with_measured_text(() =>
        mount_sized_bar_plot({
          series: [{ x: [`A`, `B`, `C`], y: [1, 2, 3], color: `blue` }],
        }),
      )
      const labels = x_tick_labels(plot)
      expect(labels).toHaveLength(3) // else the loop below asserts nothing
      for (const label of labels) expect(label.getAttribute(`transform`)).toBeNull()
    })

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
      mount(BarPlot, {
        target: document.body,
        props: {
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
          style: `width: 400px; height: 300px`,
        },
      })
      await tick()
      const bar = document.querySelector(`path[role="button"]`)
      if (!bar) throw new Error(`bar element not found`)
      bar.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
      await tick()
      expect(hover_fn).toHaveBeenCalled()
      const data = hover_fn.mock.calls[0][0]
      expect(data.category_label).toBe(`Alpha`)
      expect(data.metadata).toEqual({ id: 1 })
      // tooltip shows the category name, not its numeric index
      const tooltip_text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
      expect(tooltip_text).toContain(`Alpha`)
      expect(tooltip_text).not.toMatch(/\b0\b/)
    })
  })

  const multi_series = [basic, { ...basic, color: `orangered`, label: `S2` }]

  test.each([
    {
      props: { series: multi_series, show_legend: false },
      visible: false,
      label: `hidden when show_legend=false`,
    },
    {
      props: { series: multi_series, show_legend: true },
      visible: true,
      label: `visible when show_legend=true`,
    },
    {
      props: { series: multi_series },
      visible: true,
      label: `auto-shows for multiple series`,
    },
    {
      props: { series: multi_series, legend: null },
      visible: false,
      label: `hidden when null`,
    },
    { props: { series: [basic] }, visible: false, label: `auto-hides for single series` },
  ])(`legend $label`, async ({ props, visible }) => {
    mount(BarPlot, { target: document.body, props })
    await tick()
    expect(Boolean(document.querySelector(`.legend`))).toBe(visible)
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

  const legend_position = (plot: HTMLElement): { x: number; y: number } => {
    const legend = plot.querySelector<HTMLElement>(`.legend`)
    if (!legend) throw new Error(`legend not found`)
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
      return {
        x: Number(match.x),
        y: Number(match.y),
        width: Number(match.width),
        height: Number(match.height),
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

  test.each([`stacked`, `grouped`] as const)(
    `legend moves outside dense %s bar obstacles`,
    async (mode) => {
      // Full-height bars across the width leave no safe interior rectangle.
      const cats = Array.from({ length: 30 }, (_, idx) => idx)
      const plot = await mount_sized_bar_plot({
        series: [
          { x: cats, y: cats.map(() => 100), label: `A` },
          { x: cats, y: cats.map(() => 100), label: `B` },
        ],
        mode,
        legend: {},
        show_legend: true,
      })
      const clip_rect = plot.querySelector(`clipPath rect`)
      const clip_bottom =
        Number(clip_rect?.getAttribute(`y`)) + Number(clip_rect?.getAttribute(`height`))
      expect(legend_position(plot).y).toBeGreaterThanOrEqual(clip_bottom)
    },
  )

  test(`uses measured legend size across resize without padding drift`, async () => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(180)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(44)
    const cats = Array.from({ length: 30 }, (_, idx) => idx)
    const make_props = () => ({
      series: [
        { x: cats, y: cats.map(() => 100), label: `A` },
        { x: cats, y: cats.map(() => 100), label: `B` },
      ],
      legend: {},
      show_legend: true,
    })
    const small = await mount_sized_bar_plot(make_props(), { width: 400, height: 300 })
    const wide = await mount_sized_bar_plot(make_props(), { width: 640, height: 340 })
    const repeated = await mount_sized_bar_plot(make_props(), { width: 640, height: 340 })
    expect(legend_position(small)).toEqual({ x: 130, y: 300 - 44 - 8 })
    expect(legend_position(wide)).toEqual({ x: 250, y: 340 - 44 - 8 })
    const clip_geometry = (plot: HTMLElement) => {
      const clip_rect = plot.querySelector(`clipPath rect`)
      if (!clip_rect) throw new Error(`clip rectangle not found`)
      return [`x`, `y`, `width`, `height`].map((attr) => clip_rect.getAttribute(attr))
    }
    expect(clip_geometry(repeated)).toEqual(clip_geometry(wide))
  })

  test(`preserves explicit legend position and automatic tracks on resize`, async () => {
    const item_extents = Array.from({ length: 4 }, () => ({ width: 70, height: 20 }))
    const make_auto_props = () =>
      ({
        series: Array.from({ length: 4 }, (_, series_idx) => ({
          ...basic,
          label: `Series ${series_idx}`,
        })),
        show_legend: true,
        legend: { layout: `horizontal`, layout_tracks: `auto`, item_extents },
      }) satisfies Partial<ComponentProps<typeof BarPlot>>
    const auto_wide = await mount_sized_bar_plot(make_auto_props())
    const auto_narrow = await mount_sized_bar_plot(make_auto_props(), { width: 280 })
    expect(auto_wide.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateColumns).toBe(
      `repeat(4, auto)`,
    )
    expect(auto_narrow.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateColumns).toBe(
      `repeat(2, auto)`,
    )

    const mount_pinned = (style: string, size = {}) =>
      mount_sized_bar_plot(
        { series: multi_series, show_legend: true, legend: { style } },
        size,
      )
    const plot = await mount_pinned(`right: 7px; top: 9px; background-color: rgb(1, 2, 3);`)
    const legend = plot.querySelector<HTMLElement>(`.legend`)
    expect(legend?.style.right).toBe(`7px`)
    expect(legend?.style.top).toBe(`9px`)
    expect(legend?.style.left).toBe(``)
    expect(legend?.style.backgroundColor).toBe(`rgb(1, 2, 3)`)
    const resized = await mount_pinned(`right: 7px; top: 9px;`, {
      width: 520,
      height: 340,
    })
    expect(resized.querySelector<HTMLElement>(`.legend`)?.style.right).toBe(`7px`)
    expect(resized.querySelector<HTMLElement>(`.legend`)?.style.top).toBe(`9px`)
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
      plot
        .querySelector(`.legend-item`)
        ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      await tick()
      expect(plot.querySelector(`.legend-item`)?.classList.contains(`hidden`)).toBe(true)
      expect(orientation === `vertical` ? input[1].y_axis : input[1].x_axis).toBeUndefined()
      expect(plot.querySelector(`g.${secondary_axis}-axis`)).toBeNull()
      expect(plot.querySelectorAll(`.bar-series`)).toHaveLength(1)
      plot
        .querySelector(`.legend-item`)
        ?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
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

  test(`automatic y1 assignment preserves legacy unassigned geometry`, async () => {
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

  // double-clicking a legend item isolates that series (shared helper, same as
  // ScatterPlot); a second double-click restores the previous visibility
  test(`legend double-click isolates a series and restores on repeat`, async () => {
    const series = [basic, { ...basic, label: `Other`, color: `tomato` }]
    const plot = await mount_sized_bar_plot({ series, show_legend: true })
    const visible_states = () =>
      [...plot.querySelectorAll(`.legend-item`)].map((el) => !el.classList.contains(`hidden`))
    expect(visible_states()).toEqual([true, true])
    const dblclick = () =>
      plot
        .querySelector(`.legend-item`)
        ?.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    dblclick()
    await tick()
    expect(visible_states()).toEqual([true, false]) // isolated
    dblclick()
    await tick()
    expect(visible_states()).toEqual([true, true]) // restored
  })

  // ref-line annotations must render outside the chart clip group so labels at the
  // plot edges (e.g. a vertical line's top label) can overflow instead of being cropped,
  // while z ordering still holds: below-lines refs paint behind bars, above-all in front
  test(`reference-line annotations are unclipped and z-ordered around the bars`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic],
      ref_lines: [
        { type: `vertical`, x: 3, annotation: { text: `behind` } }, // default z: below-lines
        { type: `vertical`, x: 4, z_index: `above-all`, annotation: { text: `front` } },
      ],
    })
    await tick()
    const labels = Object.fromEntries(
      [...plot.querySelectorAll(`svg text`)].map((el) => [el.textContent?.trim(), el]),
    )
    const bars = plot.querySelector(`svg .bar-series`)
    if (!labels.behind || !labels.front || !bars) throw new Error(`missing elements`)
    for (const label of [labels.behind, labels.front]) {
      expect(inside_clip_path(label), `annotation must escape the clip-path`).toBe(false)
    }
    // document order encodes paint order: below-lines < bars < above-all
    const order = (el: Element) => bars.compareDocumentPosition(el)
    expect(Boolean(order(labels.behind) & Node.DOCUMENT_POSITION_PRECEDING)).toBe(true)
    expect(Boolean(order(labels.front) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  test(`shared solver separates nearby annotations and keeps explicit placement pinned`, async () => {
    const plot = await mount_sized_bar_plot({
      series: [basic],
      ref_lines: [
        { type: `horizontal`, y: 15, annotation: { text: `automatic A` } },
        { type: `horizontal`, y: 15.1, annotation: { text: `automatic B` } },
        {
          type: `horizontal`,
          y: 15.2,
          annotation: { text: `pinned`, position: `end`, side: `above` },
        },
      ],
    })
    await tick()
    const labels = [...plot.querySelectorAll<SVGTextElement>(`.reference-line text`)]
    const geometry = (text: string) => {
      const label = labels.find((element) => element.textContent === text)
      if (!label) throw new Error(`missing ${text} annotation`)
      return {
        x: label.getAttribute(`x`),
        y: label.getAttribute(`y`),
        anchor: label.getAttribute(`text-anchor`),
        baseline: label.getAttribute(`dominant-baseline`),
      }
    }
    const automatic_a = geometry(`automatic A`)
    const automatic_b = geometry(`automatic B`)
    expect({
      anchor: automatic_a.anchor,
      baseline: automatic_a.baseline,
    }).not.toEqual({
      anchor: automatic_b.anchor,
      baseline: automatic_b.baseline,
    })
    expect(geometry(`pinned`)).toMatchObject({ anchor: `end`, baseline: `auto` })
  })
})
