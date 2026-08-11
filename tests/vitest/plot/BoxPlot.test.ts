import { BoxPlot, type Vec2 } from '$lib'
import { DEFAULT_PLOT_PADDING } from '$lib/plot/core/layout'
import type { BoxPlotSeries, Orientation, WhiskerMode } from '$lib/plot'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  inside_clip_path,
  mount_sized,
  resize_element,
  with_measured_text,
} from '../setup'

const dist = (count: number, center = 0, spread = 1): number[] =>
  Array.from(
    { length: count },
    (_, idx) => center + spread * Math.sin(idx * 1.7) + (idx % 5) * 0.1,
  )

const basic: BoxPlotSeries = { y: dist(80, 0, 1), label: `Box A`, color: `steelblue` }

const mount_sized_box_plot = (
  props: Partial<ComponentProps<typeof BoxPlot>>,
  size: { width?: number; height?: number } = {},
): Promise<HTMLElement> => mount_sized(BoxPlot, props, { selector: `.box-plot`, ...size })

// Boxes only render when they have at least one finite value (finite median)
const rendered_box_count = (series: BoxPlotSeries[] = []): number =>
  series.filter((srs) => (srs.visible ?? true) && srs.y.some((val) => Number.isFinite(val)))
    .length

describe(`BoxPlot`, () => {
  test(`long category names tilt and still fit inside the figure`, async () => {
    const mount_with_cats = (cats: string[]): Promise<HTMLElement> =>
      with_measured_text(() =>
        mount_sized_box_plot({
          series: cats.map((cat) => ({ y: dist(40, 0, 1), label: cat, category: cat })),
          x_axis: { label: `state` },
          show_legend: false, // isolate tick tilting from the auto legend's layout reservation
        }),
      )
    const baseline_of = (root: HTMLElement): number =>
      Number(root.querySelector(`g.x-axis > line`)?.getAttribute(`y1`))
    const plot = await mount_with_cats([
      `PENDING`,
      `RUNNING`,
      `QUEUE_HOLD`,
      `COMPLETED`,
      `CANCELLED`,
    ])
    expect(plot.querySelector(`g.x-axis g.tick text`)?.getAttribute(`transform`)).toMatch(
      /^rotate\(-[\d.]+,/,
    )
    const upright = await mount_with_cats([`0`, `1`, `2`, `3`, `4`])
    expect(baseline_of(plot)).toBeGreaterThan(0)
    expect(baseline_of(plot)).toBeLessThan(baseline_of(upright))
  })

  // Smoke matrix: every one of these must still draw one box (and one hit target) per
  // series with finite data. Named per row so a failure says which config broke.
  test.each([
    [`axis labels`, { series: [basic], x_axis: { label: `Model` }, y_axis: { label: `Err` } }],
    [`whisker_mode=minmax`, { series: [basic], whisker_mode: `minmax` as WhiskerMode }],
    [
      `whisker_mode=percentile`,
      { series: [basic], whisker_mode: `percentile` as WhiskerMode },
    ],
    [`whisker_mode=std`, { series: [basic], whisker_mode: `std` as WhiskerMode }],
    [`a clamped y range`, { series: [basic], y_axis: { range: [-3, 3] as Vec2 } }],
    [`an SI tick format`, { series: [basic], y_axis: { format: `.2~s` } }],
    [`controls hidden`, { series: [basic], show_controls: false }],
    [
      `an invisible series`,
      {
        series: [
          { ...basic, visible: false },
          { ...basic, label: `Visible` },
        ],
      },
    ],
    [`an empty distribution`, { series: [{ y: [] as number[], label: `Empty` }, basic] }],
  ] as [string, Partial<ComponentProps<typeof BoxPlot>>][])(
    `renders with %s`,
    async (_label, props) => {
      const plot = await mount_sized_box_plot(props)
      const expected = rendered_box_count(props.series as BoxPlotSeries[])
      expect(plot.querySelectorAll(`.box-series`)).toHaveLength(expected)
      expect(plot.querySelectorAll(`g.box-series[role="button"]`)).toHaveLength(expected)
    },
  )

  // No slots means no category labels, so the axis must fall back to generated ticks
  test(`empty series leaves the category axis with generated ticks`, async () => {
    const plot = await mount_sized_box_plot({ series: [] })
    expect(plot.querySelectorAll(`g.x-axis g.tick`).length).toBeGreaterThan(0)
  })

  test.each([
    [`vertical`, `y`],
    [`horizontal`, `x`],
  ] as const)(
    `%s boxes keep only the value-axis zero line by default`,
    async (orientation, axis) => {
      const plot = await mount_sized_box_plot({ series: [basic], orientation })
      const lines = plot.querySelectorAll(`.zero-line`)
      expect(lines).toHaveLength(1)
      expect(lines[0].getAttribute(`${axis}1`)).toBe(lines[0].getAttribute(`${axis}2`))
    },
  )

  // 2 whiskers + 2 caps + 1 median render as <line>s inside .box-series (tukey, cap_fraction
  // > 0, show_mean off); the IQR box is a <rect class="iqr-box">
  const theme_stroke = `var(--text-color, black)`
  const box_line_strokes = (plot: HTMLElement): (string | null)[] =>
    [...plot.querySelectorAll(`.box-series line`)].map((el) => el.getAttribute(`stroke`))

  // whiskers, median and box outline default to a theme CSS variable (like the axis/tick/grid
  // colors) so they track light/dark themes instead of being permanently black; an explicit
  // color recolors only its own glyph, leaving every other stroke on the theme default. Each
  // case gives the expected per-color line tally (sums to 5) and the IQR rect stroke.
  test.each([
    [`default`, {}, { [theme_stroke]: 5 }, theme_stroke],
    [
      `whisker`,
      { whisker: { color: `tomato` } },
      { tomato: 4, [theme_stroke]: 1 },
      theme_stroke,
    ],
    [
      `median`,
      { median_style: { color: `gold` } },
      { gold: 1, [theme_stroke]: 4 },
      theme_stroke,
    ],
    [`box outline`, { box: { stroke_color: `cyan` } }, { [theme_stroke]: 5 }, `cyan`],
  ] as const)(`%s color is theme-aware and isolated`, async (_name, extra, lines, rect) => {
    const plot = await mount_sized_box_plot({ series: [basic], ...extra })
    const strokes = box_line_strokes(plot)
    expect(strokes).toHaveLength(5)
    for (const [color, count] of Object.entries(lines)) {
      expect(strokes.filter((stroke) => stroke === color)).toHaveLength(count)
    }
    expect(plot.querySelector(`.iqr-box`)?.getAttribute(`stroke`)).toBe(rect)
    // IQR box rect + transparent hover-target rect
    expect(plot.querySelectorAll(`.box-series rect`)).toHaveLength(2)
  })

  test(`show_value_labels renders one label per box`, async () => {
    const series = [basic, { ...basic, label: `B`, color: `tomato` }]
    const plot = await mount_sized_box_plot({ series, show_value_labels: true })
    expect(plot.querySelectorAll(`.value-label`)).toHaveLength(2)
  })

  test(`show_mean keeps the mean line inside the plot even when outliers are hidden`, async () => {
    // heavy outlier drags mean (~1004) far above whisker_high (~9); with outliers
    // hidden, the mean used to be excluded from the auto-range and rendered off-plot
    const plot = await mount_sized_box_plot({
      series: [{ y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10_000], label: `skewed` }],
      show_mean: true,
      show_outliers: false,
    })
    // the dashed line is the mean glyph (median/whiskers/caps are solid)
    const mean_line = [...plot.querySelectorAll(`.box-series line`)].find((line) =>
      line.hasAttribute(`stroke-dasharray`),
    )
    expect(mean_line).toBeDefined()
    const mean_y = Number(mean_line?.getAttribute(`y1`))
    expect(mean_y).toBeGreaterThanOrEqual(0) // was ≈ -27000 before the fix
    expect(mean_y).toBeLessThanOrEqual(300)
  })

  test(`a far outlier expands the value-axis range`, async () => {
    // value_points must reach the extreme outliers, not just the whiskers. The component
    // pushes only the sorted outlier extremes (outliers[0]/[last]) so this also stays safe
    // when a matbench-scale distribution produces tens of thousands of outliers (spreading
    // them as Math/array call args would RangeError).
    const cluster = dist(200, 0, 1) // ~[-1, 1.4]
    const series: BoxPlotSeries[] = [{ y: [...cluster, 500], label: `Tail` }]
    const plot = await mount_sized_box_plot({ series })
    const tick_vals = [...plot.querySelectorAll(`g.y-axis .tick`)]
      .map((tick_el) => Number(tick_el.textContent?.trim() || NaN))
      .filter(Number.isFinite)
    // axis reaches up toward the outlier at 500, far beyond the cluster
    expect(Math.max(...tick_vals)).toBeGreaterThan(100)
  })

  test.each([`vertical`, `horizontal`] satisfies Orientation[])(
    `outliers render whole at %s range edges, hide outside, and vanish in minmax`,
    async (orientation) => {
      const outlier_series: BoxPlotSeries[] = [
        { y: [...dist(60, 0, 1), 8, 9, -7, -8, 100], label: `Outliers` },
      ]
      const value_range: Vec2 = [-8, 9]
      const tukey = await mount_sized_box_plot({
        series: outlier_series,
        orientation,
        ...(orientation === `vertical`
          ? { y_axis: { range: value_range } }
          : { x_axis: { range: value_range } }),
      })
      const outlier_circles = tukey.querySelectorAll(`.box-series circle`)
      expect(outlier_circles.length).toBeGreaterThan(0)
      const clip_rect = tukey.querySelector(`clipPath rect`)
      const coordinate = orientation === `vertical` ? `y` : `x`
      const center = orientation === `vertical` ? `cy` : `cx`
      const size = orientation === `vertical` ? `height` : `width`
      const clip_start = Number(clip_rect?.getAttribute(coordinate))
      const clip_end = clip_start + Number(clip_rect?.getAttribute(size))
      const centers = [...outlier_circles].map((circle) => Number(circle.getAttribute(center)))
      expect(Math.min(...centers)).toBeCloseTo(clip_start)
      expect(Math.max(...centers)).toBeCloseTo(clip_end)
      expect(
        [...outlier_circles].every((circle) => circle.closest(`[clip-path]`) === null),
      ).toBe(true)
      document.body.innerHTML = ``
      const minmax = await mount_sized_box_plot({
        series: outlier_series,
        orientation,
        whisker_mode: `minmax`,
      })
      expect(minmax.querySelectorAll(`.box-series circle`)).toHaveLength(0)
    },
  )

  test(`renders y2 axis when a box is assigned to y2`, async () => {
    const plot = await mount_sized_box_plot({
      series: [basic, { y: dist(60, 100, 20), label: `Y2`, y_axis: `y2`, color: `green` }],
      y2_axis: { label: `Secondary` },
    })
    expect(plot.querySelector(`g.y2-axis`)).toBeInstanceOf(SVGGElement)
    expect(plot.querySelector(`.y2-label`)?.textContent).toBe(`Secondary`)
  })

  test.each([
    [`y2`, `vertical`, { y: [NaN, NaN], y_axis: `y2` }],
    [`x2`, `horizontal`, { y: [NaN, NaN], x_axis: `x2` }],
  ] satisfies [`x2` | `y2`, Orientation, BoxPlotSeries][])(
    `does not render the %s axis for a secondary box without finite values in %s mode`,
    async (axis, orientation, invalid_series) => {
      const plot = await mount_sized_box_plot({
        orientation,
        series: [basic, invalid_series],
      })
      expect(plot.querySelector(`g.${axis}-axis`)).toBeNull()
    },
  )

  test(`explicit right padding is not overridden by y2 auto-padding`, async () => {
    const plot = await mount_sized_box_plot({
      series: [basic, { ...basic, label: `Y2`, y_axis: `y2` }],
      padding: { r: 10 },
      y2_axis: { label: `Secondary` },
    })
    const clip_rect = plot.querySelector(`clipPath rect`)
    const right_pad =
      400 - Number(clip_rect?.getAttribute(`x`)) - Number(clip_rect?.getAttribute(`width`))
    expect(right_pad).toBe(10)
  })

  test(`default padding grows for wide y-axis ticks`, async () => {
    const plot = await with_measured_text(
      () => mount_sized_box_plot({ series: [basic], y_axis: { label: `Value` } }),
      60, // short y ticks still measure past the 60px default left pad
    )
    expect(Number(plot.querySelector(`clipPath rect`)?.getAttribute(`x`))).toBeGreaterThan(60)
  })

  test(`horizontal left padding fits slot names, not their indices`, async () => {
    // slots sit on y when horizontal, so measuring the integer indices behind them left
    // long category names overflowing the figure and the y title on top of the ticks
    const clip_x = async (cats: string[]) => {
      const plot = await with_measured_text(() =>
        mount_sized_box_plot({
          series: cats.map((cat) => ({ y: dist(40, 0, 1), label: cat, category: cat })),
          orientation: `horizontal`,
        }),
      )
      return Number(plot.querySelector(`clipPath rect`)?.getAttribute(`x`))
    }
    expect(await clip_x([`QUEUE_HOLD`, `COMPLETED`])).toBeGreaterThan(await clip_x([`Q`, `C`]))
  })

  test(`vertical rect-zoom zooms y2 but writes no phantom x2 range`, async () => {
    // vertical orientation: the secondary value axis is y2; x is categorical and x2 is a
    // sentinel, so rect-zoom must not write back an x2 range. Mount directly (the helper
    // spreads props, which would sever the bind_props getters and lose the write-back).
    const state = {
      x2_axis: {} as Record<string, unknown>,
      y2_axis: {} as Record<string, unknown>,
    }
    const container = document.createElement(`div`)
    document.body.append(container)
    mount(BoxPlot, {
      target: container,
      props: bind_props(
        {
          series: [
            { y: dist(40, 0, 1), label: `A` },
            { y: dist(40, 50, 5), label: `B`, y_axis: `y2` as const },
          ],
          style: `width: 400px; height: 300px;`,
        },
        state,
      ),
    })
    const plot = container.querySelector<HTMLElement>(`.box-plot`)
    if (!plot) throw new Error(`BoxPlot root element not found`)
    await resize_element(plot, 400, 300)
    const svg = plot.querySelector(`svg[role="application"]`)
    if (!svg) throw new Error(`svg not found`)
    svg.dispatchEvent(
      new MouseEvent(`mousedown`, { clientX: 100, clientY: 50, bubbles: true }),
    )
    // The endpoint may leave the plot as long as the drag started inside it.
    window.dispatchEvent(new MouseEvent(`mousemove`, { clientX: 300, clientY: 290 }))
    window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: 300, clientY: 290 }))
    await tick()
    const y2_range = state.y2_axis.range as Vec2 | undefined
    expect(y2_range?.every(Number.isFinite)).toBe(true)
    expect(state.x2_axis.range).toBeUndefined() // no phantom x2 range in vertical mode
  })

  test(`category tick labels are colored per box`, async () => {
    const plot = await mount_sized_box_plot({
      series: [
        { ...basic, color: `#ff0000`, label: `Red` },
        { ...basic, color: `#00ff00`, label: `Green` },
      ],
    })
    const x_axis = plot.querySelector(`g.x-axis`)
    const tick_texts = [...(x_axis?.querySelectorAll(`text`) ?? [])].filter((node) =>
      [`Red`, `Green`].includes(node.textContent?.trim() ?? ``),
    )
    expect(tick_texts).toHaveLength(2)
    expect(tick_texts[0].getAttribute(`fill`)).toBe(`#ff0000`)
    expect(tick_texts[1].getAttribute(`fill`)).toBe(`#00ff00`)
  })

  test(`hover shows a tooltip and fires on_box_hover`, async () => {
    const on_box_hover = vi.fn()
    const plot = await mount_sized_box_plot({ series: [basic], on_box_hover })
    const hit = plot.querySelector<SVGGElement>(`g.box-series[role="button"]`)
    expect(hit).not.toBeNull()
    hit?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    expect(on_box_hover).toHaveBeenCalledOnce()
    expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
    expect(plot.querySelector(`.plot-tooltip`)?.textContent).toContain(`median`)
  })

  test(`click fires on_box_click with stats`, async () => {
    const on_box_click = vi.fn()
    const plot = await mount_sized_box_plot({ series: [basic], on_box_click })
    const hit = plot.querySelector<SVGGElement>(`g.box-series[role="button"]`)
    hit?.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(on_box_click).toHaveBeenCalledOnce()
    const arg = on_box_click.mock.calls[0][0]
    expect(arg.box_idx).toBe(0)
    expect(arg.stats.median).toBeTypeOf(`number`)
    expect(arg.category_label).toBe(`Box A`)
  })

  test(`horizontal orientation renders all boxes`, async () => {
    const series = [basic, { ...basic, label: `B`, color: `orangered` }]
    const plot = await mount_sized_box_plot({ series, orientation: `horizontal` })
    expect(plot.querySelectorAll(`.box-series`)).toHaveLength(2)
    expect(plot.querySelectorAll(`g.box-series[role="button"]`)).toHaveLength(2)
  })

  test(`one category tick per series even when x_axis.categories is shorter`, async () => {
    // Each box is positioned by its index in `series`; the category axis must always
    // have one slot/tick per series, regardless of any x_axis.categories override.
    const series = [
      { ...basic, label: `A` },
      { ...basic, label: `B`, color: `tomato` },
      { ...basic, label: `C`, color: `green` },
    ]
    const plot = await mount_sized_box_plot({ series, x_axis: { categories: [`A`, `B`] } })
    expect(plot.querySelectorAll(`.box-series`)).toHaveLength(3)
    const x_ticks = plot.querySelectorAll(`g.x-axis g.tick`)
    expect(x_ticks).toHaveLength(3)
    expect([...x_ticks].map((tick_el) => tick_el.textContent?.trim())).toEqual([`A`, `B`, `C`])
  })

  // Category labels already identify each box, so legends stay opt-in.
  // legend=null remains the hard off switch even when show_legend is explicit.
  const multi_series = [basic, { ...basic, label: `B`, color: `orangered` }]
  test.each([
    [`defaults off for multiple series`, { series: multi_series }, false],
    [`renders when show_legend=true`, { series: multi_series, show_legend: true }, true],
    [`hides when show_legend=false`, { series: multi_series, show_legend: false }, false],
    [
      `is suppressed by legend=null despite show_legend`,
      { series: multi_series, show_legend: true, legend: null },
      false,
    ],
    [`can force a single-series legend`, { series: [basic], show_legend: true }, true],
  ] as [string, Partial<ComponentProps<typeof BoxPlot>>, boolean][])(
    `legend %s`,
    async (_label, props, visible) => {
      const plot = await mount_sized_box_plot(props)
      expect(Boolean(plot.querySelector(`.legend`))).toBe(visible)
    },
  )

  test.each([
    {
      name: `keeps a sparse plot legend inside`,
      series: [
        { ...basic, label: `A` },
        { ...basic, y: dist(80, 3, 0.5), label: `B` },
      ],
      outside: false,
    },
    {
      name: `moves the legend outside densely filled boxes`,
      series: Array.from({ length: 24 }, (_, series_idx) => ({
        y: [-20, -10, 0, 10, 20],
        label: `Box ${series_idx}`,
      })),
      outside: true,
    },
  ])(`$name without colliding with the chart`, async ({ series, outside }) => {
    const plot = await mount_sized_box_plot({
      series,
      show_legend: true,
      legend: { tween: { duration: 0 } },
    })
    await tick()
    const legend = plot.querySelector<HTMLElement>(`.legend`)
    const clip_rect = plot.querySelector(`clipPath rect`)
    if (!legend || !clip_rect) throw new Error(`legend or clip rectangle not found`)
    const is_outside = () =>
      Number(legend.style.top.replace(`px`, ``)) >
      Number(clip_rect.getAttribute(`y`)) + Number(clip_rect.getAttribute(`height`))
    expect(is_outside()).toBe(outside)
    if (!outside) return
    const first_item = legend.querySelector(`.legend-item`)
    if (!first_item) throw new Error(`legend item not found`)
    first_item.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await vi.waitFor(() => expect(is_outside()).toBe(false))
  })

  test(`uses measured legend size across plot sizes without padding drift`, async () => {
    const width_spy = vi
      .spyOn(HTMLElement.prototype, `offsetWidth`, `get`)
      .mockReturnValue(180)
    const height_spy = vi
      .spyOn(HTMLElement.prototype, `offsetHeight`, `get`)
      .mockReturnValue(44)
    try {
      const series = Array.from({ length: 8 }, (_, series_idx) => ({
        y: [-20, -10, 0, 10, 20],
        label: `Box ${series_idx}`,
      }))
      const initial_plot = await mount_sized_box_plot({ series, show_legend: true })
      const initial_legend = initial_plot.querySelector<HTMLElement>(`.legend`)
      const resized_plot = await mount_sized_box_plot(
        { series, show_legend: true },
        { width: 640, height: 340 },
      )
      const resized_legend = resized_plot.querySelector<HTMLElement>(`.legend`)
      const resized_clip = resized_plot.querySelector(`clipPath rect`)
      if (!initial_legend || !resized_legend || !resized_clip) {
        throw new Error(`legend or clip rectangle not found`)
      }
      expect(Number(initial_legend.style.top.replace(`px`, ``))).toBe(300 - 44 - 8)
      expect(Number(resized_legend.style.left.replace(`px`, ``))).toBeGreaterThan(
        Number(initial_legend.style.left.replace(`px`, ``)),
      )
      expect(Number(resized_legend.style.top.replace(`px`, ``))).toBe(340 - 44 - 8)
      expect(Number(resized_clip.getAttribute(`height`))).toBe(
        340 - DEFAULT_PLOT_PADDING.t - DEFAULT_PLOT_PADDING.b - 44 - 8,
      )
    } finally {
      width_spy.mockRestore()
      height_spy.mockRestore()
    }
  })

  test(`preserves explicit legend position and auto tracks on resize`, async () => {
    const item_extents = Array.from({ length: 4 }, () => ({ width: 70, height: 20 }))
    const auto = await mount_sized_box_plot({
      series: Array.from({ length: 4 }, (_, series_idx) => ({
        ...basic,
        label: `Box ${series_idx}`,
      })),
      show_legend: true,
      legend: { layout: `horizontal`, layout_tracks: `auto`, item_extents },
    })
    const auto_legend = auto.querySelector<HTMLElement>(`.legend`)
    expect(auto_legend?.style.gridTemplateColumns).toBe(`repeat(4, auto)`)
    const narrow = await mount_sized_box_plot(
      {
        series: Array.from({ length: 4 }, (_, series_idx) => ({
          ...basic,
          label: `Box ${series_idx}`,
        })),
        show_legend: true,
        legend: { layout: `horizontal`, layout_tracks: `auto`, item_extents },
      },
      { width: 280, height: 300 },
    )
    expect(narrow.querySelector<HTMLElement>(`.legend`)?.style.gridTemplateColumns).toBe(
      `repeat(2, auto)`,
    )

    const pinned = await mount_sized_box_plot({
      series: [basic, { ...basic, label: `B` }],
      show_legend: true,
      legend: { style: `position: absolute; left: 17px; top: 23px;` },
    })
    const pinned_legend = pinned.querySelector<HTMLElement>(`.legend`)
    const pinned_clip = pinned.querySelector(`clipPath rect`)
    const baseline = await mount_sized_box_plot({
      series: [basic, { ...basic, label: `B` }],
      show_legend: false,
    })
    const baseline_clip = baseline.querySelector(`clipPath rect`)
    expect(pinned_legend?.style.left).toBe(`17px`)
    expect(pinned_legend?.style.top).toBe(`23px`)
    expect(
      [`x`, `y`, `width`, `height`].map((attr) => pinned_clip?.getAttribute(attr)),
    ).toEqual([`x`, `y`, `width`, `height`].map((attr) => baseline_clip?.getAttribute(attr)))
  })

  // === Violin support ===
  const iqr_box = (plot: HTMLElement) => plot.querySelectorAll(`.box-series rect.iqr-box`)

  test.each([
    { kind: `box`, violins: 0, boxes: 1 },
    { kind: `violin`, violins: 1, boxes: 0 },
    { kind: `violin+box`, violins: 1, boxes: 1 },
  ] as const)(
    `kind=$kind draws $violins violin and $boxes box`,
    async ({ kind, violins, boxes }) => {
      const plot = await mount_sized_box_plot({ series: [basic], kind })
      expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(violins)
      expect(iqr_box(plot)).toHaveLength(boxes)
    },
  )

  // inner IQR-box width: a violin shrinks the default box, and per-series box_width widens it
  test.each([
    {
      name: `violin inner box is narrower than a standalone box`,
      narrow: () => mount_sized_box_plot({ series: [basic], kind: `violin+box` }),
      wide: () => mount_sized_box_plot({ series: [basic], kind: `box` }),
    },
    {
      name: `per-series box_width widens the violin inner box`,
      narrow: () => mount_sized_box_plot({ series: [basic], kind: `violin+box` }),
      wide: () =>
        mount_sized_box_plot({ series: [{ ...basic, box_width: 0.8 }], kind: `violin+box` }),
    },
  ])(`$name`, async ({ narrow, wide }) => {
    const rect_w = (plot: HTMLElement) => Number(iqr_box(plot)[0].getAttribute(`width`) ?? `0`)
    const narrow_plot = await narrow()
    document.body.innerHTML = ``
    const wide_plot = await wide()
    expect(rect_w(narrow_plot)).toBeLessThan(rect_w(wide_plot))
  })

  test(`per-series kind overrides the component default`, async () => {
    const plot = await mount_sized_box_plot({
      kind: `box`,
      series: [basic, { ...basic, label: `V`, kind: `violin` }],
    })
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(1) // only the violin series
    expect(iqr_box(plot)).toHaveLength(1) // only the box series
  })

  test(`renders a finite violin path`, async () => {
    const plot = await mount_sized_box_plot({ series: [basic], kind: `violin` })
    const path = plot.querySelector<SVGPathElement>(`.violin-area`)
    expect(path?.getAttribute(`d`)).toMatch(/^M[\d.\-,]/)
    expect(path?.getAttribute(`d`)).not.toContain(`NaN`)
  })

  test(`split violins share one category slot`, async () => {
    const series: BoxPlotSeries[] = [
      { y: dist(80, 0, 1), category: `X`, side: `negative`, label: `Left`, color: `#4e79a7` },
      { y: dist(80, 1, 1), category: `X`, side: `positive`, label: `Right`, color: `#e15759` },
    ]
    const plot = await mount_sized_box_plot({ series, kind: `violin`, show_legend: true })
    // two violins, but a single category slot (one x-axis tick)
    const paths = plot.querySelectorAll<SVGPathElement>(`.violin-area`)
    expect(paths).toHaveLength(2)
    for (const path of paths) expect(path.getAttribute(`d`)).not.toContain(`NaN`)
    expect(plot.querySelectorAll(`g.x-axis g.tick`)).toHaveLength(1)
    expect(plot.querySelector(`g.x-axis g.tick text`)?.textContent?.trim()).toBe(`X`)
  })

  test(`distinct categories produce one slot each`, async () => {
    const series: BoxPlotSeries[] = [
      { y: dist(80, 0, 1), category: `A`, label: `A`, color: `#4e79a7` },
      { y: dist(80, 1, 1), category: `B`, label: `B`, color: `#e15759` },
    ]
    const plot = await mount_sized_box_plot({ series, kind: `violin` })
    expect(plot.querySelectorAll(`g.x-axis g.tick`)).toHaveLength(2)
  })

  // on a log value axis, stats <= 0 (whisker_low is often exactly 0, outliers can be
  // negative) must clamp to the log floor instead of rendering NaN coordinates
  test(`log value axis renders finite coordinates when data includes zero`, async () => {
    const plot = await mount_sized_box_plot({
      series: [{ y: [0, 1, 2, 5, 10, 100], label: `Z` }],
      y_axis: { scale_type: `log` },
    })
    const attrs = [...plot.querySelectorAll(`.box-series line, .box-series rect`)].flatMap(
      (el) => [...el.attributes].map((attr) => attr.value),
    )
    expect(attrs.length).toBeGreaterThan(0)
    expect(
      attrs.some((val) => val.includes(`NaN`)),
      `no NaN in box glyphs`,
    ).toBe(false)
  })

  // same contract as BarPlot: ref-line annotations render outside the chart clip group
  // so labels at the plot edges can overflow instead of being cropped
  test(`reference-line annotation is not clipped by the chart area`, async () => {
    const plot = await mount_sized_box_plot({
      series: [basic],
      ref_lines: [{ type: `horizontal`, y: 0, annotation: { text: `threshold` } }],
    })
    await tick()
    const label = [...plot.querySelectorAll(`svg text`)].find(
      (el) => el.textContent?.trim() === `threshold`,
    )
    if (!label) throw new Error(`annotation text should render`)
    expect(inside_clip_path(label), `annotation must escape the clip-path`).toBe(false)
  })
})
