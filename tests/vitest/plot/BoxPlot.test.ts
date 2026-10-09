import BoxPlot from '#lib/plot/box/BoxPlot.svelte'
import * as kde_math from '#lib/plot/box/kde.js'
import * as box_math from '#lib/plot/box/box-plot.js'
import type { Vec2 } from '#lib'
import type { BoxPlotSeries, Orientation, WhiskerMode } from '#lib/plot/index.js'
import { type ComponentProps, tick } from 'svelte'
import { type Rect, rects_overlap } from '#lib/plot/core/layout.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  expect_plot_controls,
  mount_sized,
  one_tab_stop,
  pattern_id_of,
  query,
  set_select,
  roving_tabindexes,
  svg_rect,
  with_measured_text,
} from '../setup'

const dist = (count: number, center = 0, spread = 1): number[] =>
  Array.from(
    { length: count },
    (_, idx) => center + spread * Math.sin(idx * 1.7) + (idx % 5) * 0.1,
  )

// Extract alternating x,y pixel coords from a violin path ("Mx,yLx,y...Z")
const path_coords = (path_d: string): { xs: number[]; ys: number[] } => {
  const nums = (path_d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number)
  return {
    xs: nums.filter((_, idx) => idx % 2 === 0),
    ys: nums.filter((_, idx) => idx % 2 === 1),
  }
}

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
  afterEach(() => vi.restoreAllMocks())
  // exactly one mark holds the group's tab stop so Tab skips past the chart in one press
  test(`marks are reachable by Tab exactly once`, async () => {
    const tabindexes = roving_tabindexes(
      await mount_sized_box_plot({ series: [basic, { ...basic, label: `Box B` }] }),
    )
    expect(tabindexes.length).toBeGreaterThan(1)
    expect(tabindexes).toEqual(one_tab_stop(tabindexes.length))
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

  test.each([
    [`vertical`, `y`, { y_axis: { range: [-200, 1600] as Vec2 } }],
    [`horizontal`, `x`, { x_axis: { range: [-200, 1600] as Vec2 } }],
  ] as const)(
    `keeps default %s value-axis ticks sparse`,
    async (orientation, axis, axis_prop) => {
      const plot = await with_measured_text(() =>
        mount_sized_box_plot({ series: [basic], orientation, ...axis_prop }, { height: 245 }),
      )
      const labels = [...plot.querySelectorAll(`g.${axis}-axis g.tick text`)]
      expect(labels).toHaveLength(4)
      if (axis === `y`) {
        const label_x = labels[0]?.getAttribute(`x`)
        expect(labels.every((label) => label.getAttribute(`x`) === label_x)).toBe(true)
      }
    },
  )

  // 2 whiskers + 2 caps + 1 median render as <line>s inside .box-series (tukey, cap_fraction
  // > 0, show_mean off); the IQR box is a <rect class="iqr-box">
  const theme_stroke = `var(--text-color, black)`
  const box_line_strokes = (plot: HTMLElement): (string | null)[] =>
    [...plot.querySelectorAll(`.box-series line`)].map((element) =>
      element.getAttribute(`stroke`),
    )

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
    // heavy outlier drags mean (~1004) far above whisker_high (~9); with outliers hidden the
    // auto-range must still include the mean
    const plot = await mount_sized_box_plot({
      series: [{ y: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10_000], label: `skewed` }],
      show_mean: true,
      show_outliers: false,
    })
    // the dashed line is the mean glyph (median/whiskers/caps are solid)
    const mean_line = [...plot.querySelectorAll(`.box-series line`)].find((line) =>
      line.hasAttribute(`stroke-dasharray`),
    )
    const mean_y = Number(mean_line?.getAttribute(`y1`))
    expect(mean_y).toBeGreaterThanOrEqual(0)
    expect(mean_y).toBeLessThanOrEqual(300)
  })

  test(`a far outlier expands the value-axis range`, async () => {
    // value_points must reach the extreme outliers, not just the whiskers
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

  describe(`strip and swarm points`, () => {
    const sample_points = (plot: ParentNode) =>
      [...plot.querySelectorAll(`.box-series circle.sample-point`)].map((circle) => ({
        x: Number(circle.getAttribute(`cx`)),
        y: Number(circle.getAttribute(`cy`)),
        r: Number(circle.getAttribute(`r`)),
      }))
    // Category center of a box: its hover target spans the whisker caps symmetrically
    const box_center = (plot: HTMLElement, orientation: Orientation, box_idx = 0) => {
      const rect = svg_rect(
        query(plot, `.box-series[data-box-idx="${box_idx}"] .hover-target`),
      )
      return orientation === `vertical` ? rect.x + rect.width / 2 : rect.y + rect.height / 2
    }

    test.each([`vertical`, `horizontal`] satisfies Orientation[])(
      `%s swarm draws every finite sample once, packed around the box center`,
      async (orientation) => {
        const values = [...dist(80, 0, 1), NaN, 9, -7] // two tukey outliers, one NaN
        const plot = await mount_sized_box_plot(
          { series: [{ y: values, label: `S` }], points: `swarm`, orientation },
          { width: 500, height: 400 },
        )
        const pts = sample_points(plot)
        expect(pts).toHaveLength(82)
        // Outliers are among the samples now, not drawn a second time
        expect(plot.querySelectorAll(`.box-series circle:not(.sample-point)`)).toHaveLength(0)
        const [value_of, cross_of] =
          orientation === `vertical` ? ([`y`, `x`] as const) : ([`x`, `y`] as const)
        const center = box_center(plot, orientation)
        const offsets = pts.map((pt) => pt[cross_of] - center)
        expect(Math.max(...offsets)).toBeGreaterThan(0)
        expect(Math.min(...offsets)).toBeLessThan(0)
        // Wide slot, 82 points: nothing clamped, so no two points overlap
        for (const [idx, pt] of pts.entries()) {
          for (const other of pts.slice(idx + 1)) {
            expect(Math.hypot(pt.x - other.x, pt.y - other.y)).toBeGreaterThan(
              2 * pt.r + 0.5 - 1e-9,
            )
          }
        }
        // The outlier at 9 is the extreme sample along the value axis
        const extreme =
          orientation === `vertical`
            ? Math.min(...pts.map((pt) => pt.y))
            : Math.max(...pts.map((pt) => pt.x))
        expect(pts.some((pt) => pt[value_of] === extreme)).toBe(true)
      },
    )

    test(`value range reaches every sample even with outliers hidden`, async () => {
      const series = [{ y: [...dist(60, 0, 1), 500], label: `Far` }]
      const strip = await mount_sized_box_plot({
        series,
        show_outliers: false,
        points: `strip`,
      })
      const clip = svg_rect(query(strip, `clipPath rect`))
      // Only in-view samples are drawn, so all 61 means the range stretched to reach 500,
      // which then sits far above the cluster
      const ys = sample_points(strip)
        .map((pt) => pt.y)
        .toSorted((left, right) => left - right)
      expect(ys).toHaveLength(61)
      expect(ys[0]).toBeGreaterThanOrEqual(clip.y)
      expect(ys[1] - ys[0]).toBeGreaterThan(clip.height / 2)
    })

    // Strips jitter over half the box (0.8 slot), styled by sample_style
    test(`per-series override and strip jitter within half the box`, async () => {
      const plot = await mount_sized_box_plot(
        {
          series: [
            { y: dist(200, 0, 1), label: `A` },
            { y: dist(40, 5, 1), label: `B`, points: `none` },
          ],
          points: `strip`,
          sample_style: { radius: 1.5, opacity: 0.4 },
        },
        { width: 500, height: 300 },
      )
      const pts = sample_points(plot)
      expect(pts).toHaveLength(200) // B draws only its (here absent) outliers
      expect(new Set(pts.map(({ r }) => r))).toEqual(new Set([1.5]))
      const opacities = [...plot.querySelectorAll(`circle.sample-point`)].map((circle) =>
        circle.getAttribute(`fill-opacity`),
      )
      expect(new Set(opacities)).toEqual(new Set([`0.4`]))
      const center = box_center(plot, `vertical`)
      const slot_px = Math.abs(box_center(plot, `vertical`, 1) - center)
      const offsets = pts.map((pt) => Math.abs(pt.x - center))
      expect(Math.max(...offsets)).toBeLessThanOrEqual((slot_px * 0.4) / 2 - 1.5 + 1e-9)
      expect(Math.max(...offsets)).toBeGreaterThan((slot_px * 0.4) / 2 - 3.5)
    })

    // Split violins share a slot; each series' samples must stay on its own half
    test.each([`strip`, `swarm`] as const)(
      `%s on split violins keeps each side apart`,
      async (mode) => {
        const plot = await mount_sized_box_plot(
          {
            series: [
              { y: dist(60, 0, 1), label: `L`, category: `c`, side: `negative` },
              { y: dist(60, 0.5, 1), label: `R`, category: `c`, side: `positive` },
            ],
            kind: `violin`,
            points: mode,
          },
          { width: 400, height: 400 },
        )
        const center = box_center(plot, `vertical`)
        for (const [box_idx, sign] of [
          [0, -1],
          [1, 1],
        ] as const) {
          const offsets = sample_points(query(plot, `[data-box-idx="${box_idx}"]`)).map(
            (pt) => sign * (pt.x - center),
          )
          expect(offsets).toHaveLength(60)
          expect(Math.min(...offsets)).toBeGreaterThanOrEqual(0)
        }
      },
    )

    // The outlier toggle disables only once no box draws outliers apart from its samples
    test.each([
      [`every box swarms`, [], true, 41],
      [
        `one series keeps points: none`,
        [{ y: [...dist(40, 5), 60], label: `B`, points: `none` as const }],
        false,
        41,
      ],
    ])(
      `Points control switches the mode; %s`,
      async (_name, extra, disabled_after, n_samples) => {
        const plot = await mount_sized_box_plot({
          series: [{ y: [...dist(40), 50], label: `A` }, ...extra],
          show_controls: true,
          controls_open: true,
        })
        const select = [...plot.querySelectorAll(`select`)].find((el) =>
          el.parentElement?.textContent?.includes(`Points`),
        )
        if (!select) throw new Error(`Points select not rendered`)
        const outliers = [
          ...plot.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`),
        ].find((input) => input.parentElement?.textContent?.includes(`Show outliers`))
        expect([select.value, outliers?.disabled]).toEqual([`none`, false])
        expect(plot.querySelectorAll(`circle.sample-point`)).toHaveLength(0)
        set_select(select, `swarm`)
        await tick()
        expect(plot.querySelectorAll(`circle.sample-point`)).toHaveLength(n_samples)
        expect(outliers?.disabled).toBe(disabled_after)
      },
    )
  })

  // horizontal boxes put their secondary values on x2, which the frame tests can't reach
  test(`does not render the x2 axis for a horizontal secondary box without finite values`, async () => {
    const plot = await mount_sized_box_plot({
      orientation: `horizontal`,
      series: [basic, { y: [NaN, NaN], x_axis: `x2` }],
    })
    expect(plot.querySelector(`g.x2-axis`)).toBeNull()
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

  // In the default tukey mode the whiskers are not the series min/max once there are outliers
  test(`hover shows a tooltip labelling the whisker ends and fires on_box_hover`, async () => {
    const on_box_hover = vi.fn()
    const series = [{ y: [1, 2, 3, 4, 5, 100], label: `Box A` }]
    const plot = await mount_sized_box_plot({ series, on_box_hover })
    const hit = plot.querySelector<SVGGElement>(`g.box-series[role="button"]`)
    expect(hit).not.toBeNull()
    hit?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await tick()
    expect(on_box_hover).toHaveBeenCalledOnce()
    const text = plot.querySelector(`.plot-tooltip`)?.textContent ?? ``
    expect(text).toContain(`median`)
    expect(text).toContain(`whisker high: 5`)
    expect(text).toContain(`whisker low: 1`)
    expect(text).not.toContain(`max`)
    expect(text).not.toContain(`min`)
    expect(text).toContain(`outliers: 1`)
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
    // type-7 median of the 80 clicked values: mean of the two middle order statistics
    const sorted = [...basic.y].toSorted((val_a, val_b) => val_a - val_b)
    expect(arg.stats.median).toBeCloseTo((sorted[39] + sorted[40]) / 2, 12)
    expect(arg.category_label).toBe(`Box A`)
  })

  // Hiding series shrinks the obstacle field the frame's solver reads, so an outside legend
  // moves back inside once the remaining boxes leave room for it
  test(`legend returns inside the plot once dense boxes are isolated`, async () => {
    const summary_spy = vi.spyOn(box_math, `summarize_box_samples`)
    const plot = await mount_sized_box_plot({
      series: Array.from({ length: 24 }, (_, series_idx) => ({
        y: [-20, -10, 0, 10, 20],
        label: `Box ${series_idx}`,
      })),
      show_legend: true,
      legend: { tween: { duration: 0 } },
    })
    await tick()
    const initial_summary_calls = summary_spy.mock.calls.length
    expect(initial_summary_calls).toBe(24)
    const legend = plot.querySelector<HTMLElement>(`.legend`)
    const clip_rect = plot.querySelector(`clipPath rect`)
    if (!legend || !clip_rect) throw new Error(`legend or clip rectangle not found`)
    const is_outside = () =>
      Number(legend.style.top.replace(`px`, ``)) >
      Number(clip_rect.getAttribute(`y`)) + Number(clip_rect.getAttribute(`height`))
    expect(is_outside()).toBe(true)
    legend
      .querySelector(`.legend-item`)
      ?.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await vi.waitFor(() => expect(is_outside()).toBe(false))
    expect(summary_spy).toHaveBeenCalledTimes(initial_summary_calls)
  })

  // Drawn extent of a glyph: a box's hover target (whiskers x body width), a violin's outline
  const glyph_rect = (group: Element): Rect => {
    const violin = group.querySelector(`path.violin-area`)
    if (!violin) return svg_rect(query(group, `rect.hover-target`))
    const { xs, ys } = path_coords(violin.getAttribute(`d`) ?? ``)
    const [left, top] = [Math.min(...xs), Math.min(...ys)]
    return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
  }
  // geometric samples from 1e-3 up to 100 or 1000, so minmax whiskers span all their decades
  const log_boxes = [100, 100, 1000].map((max) => ({
    y: Array.from({ length: 21 }, (_, idx) => 1e-3 * (max / 1e-3) ** (idx / 20)),
  }))
  // obstacles must map log whiskers in log space and cover a violin's full outline
  // oxfmt-ignore
  test.each([
    [`boxes on a log value axis`, { series: log_boxes, whisker_mode: `minmax`, y_axis: { scale_type: `log` } }],
    [`a violin`, { series: [{ y: basic.y }], kind: `violin` }],
  ] as const)(`automatic legend placement avoids %s`, async (_name, props) => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(120)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(60)
    const plot = await mount_sized_box_plot({ ...props, show_legend: true })
    const { left, top } = query(plot, `.legend`).style
    const [legend_x, legend_y] = [left, top].map((px) => Number(px.replace(`px`, ``)))
    const legend_rect = { x: legend_x, y: legend_y, width: 120, height: 60 }
    const glyphs = [...plot.querySelectorAll(`g.box-series`)].map(glyph_rect)
    expect(glyphs).toHaveLength(props.series.length)
    for (const glyph of glyphs) expect(rects_overlap(legend_rect, glyph)).toBe(false)
  })

  test(`violin KDEs survive legend toggles and report hidden series`, async () => {
    const kde_spy = vi.spyOn(kde_math, `gaussian_kde`)
    const on_hidden_series_change = vi.fn()
    const plot = await mount_sized_box_plot({
      series: [`A`, `B`, `C`].map((label, idx) => ({ ...basic, label, y: dist(80, idx) })),
      kind: `violin`,
      show_legend: true,
      on_hidden_series_change,
    })
    await tick()
    expect(kde_spy).toHaveBeenCalledTimes(3)
    plot.querySelector<HTMLElement>(`.legend-item`)?.click()
    await tick()
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(2)
    expect(on_hidden_series_change).toHaveBeenCalledExactlyOnceWith([0])
    expect(kde_spy).toHaveBeenCalledTimes(3)
  })

  test.each([null, `y`] as const)(
    `forwards axis_loading=%s and on_axis_change to the value axis`,
    async (axis_loading) => {
      const on_axis_change = vi.fn()
      const options = [
        { key: `energy`, label: `Energy`, unit: `eV` },
        { key: `volume`, label: `Volume` },
      ]
      const plot = await with_measured_text(() =>
        mount_sized_box_plot({
          series: [basic],
          y_axis: { selected_key: `energy`, options },
          axis_loading,
          on_axis_change,
        }),
      )
      expect(plot.querySelector(`.interactive-axis-label.loading`) !== null).toBe(
        axis_loading !== null,
      )
      if (axis_loading) return
      plot.querySelector<HTMLButtonElement>(`button.axis-trigger`)?.click()
      await tick()
      const volume = [...document.querySelectorAll<HTMLElement>(`[role="option"]`)].find(
        (option) => option.textContent?.includes(`Volume`),
      )
      volume?.click()
      await tick()
      expect(on_axis_change).toHaveBeenCalledExactlyOnceWith(`y`, `volume`)
    },
  )

  // === Violin support ===
  const iqr_box = (plot: HTMLElement) => plot.querySelectorAll(`.box-series rect.iqr-box`)

  test.each([
    { kind: `box`, series: [basic], violins: 0, boxes: 1 },
    { kind: `violin`, series: [basic], violins: 1, boxes: 0 },
    { kind: `violin+box`, series: [basic], violins: 1, boxes: 1 },
    // per-series kind overrides the component default
    { kind: `box`, series: [basic, { ...basic, kind: `violin` }], violins: 1, boxes: 1 },
  ] as const)(
    `kind=$kind with $series.length series draws $violins violin and $boxes box`,
    async ({ kind, series, violins, boxes }) => {
      const plot = await mount_sized_box_plot({ series: [...series], kind })
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

  // the KDE grid covers exactly the observed support (no tail extension), so with min/max
  // whiskers the violin's ends coincide with the whisker caps
  test(`violin+box with minmax whiskers spans exactly the whisker range`, async () => {
    const plot = await mount_sized_box_plot({
      series: [basic],
      kind: `violin+box`,
      whisker_mode: `minmax`,
    })
    const first_series = plot.querySelector(`.box-series`)
    const violin_y = path_coords(
      first_series?.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``,
    ).ys
    const horizontal_lines = [...(first_series?.querySelectorAll(`line`) ?? [])]
      .filter((line) => line.getAttribute(`y1`) === line.getAttribute(`y2`))
      .map((line) => Number(line.getAttribute(`y1`)))
    expect([Math.min(...violin_y), Math.max(...violin_y)]).toEqual([
      Math.min(...horizontal_lines),
      Math.max(...horizontal_lines),
    ])
  })

  // side=positive must hug "above the center line" (horizontal, smaller screen y) /
  // "right of it" (vertical, larger screen x) — the horizontal category pixel axis
  // is inverted, so the rendered side flips
  test.each([
    [`horizontal`, -1],
    [`vertical`, 1],
  ] as const)(
    `side=positive draws the violin hump on the positive side (%s)`,
    async (orientation, sign) => {
      const plot = await mount_sized_box_plot({
        series: [{ y: dist(80, 5, 1), label: `A` }],
        orientation,
        side: `positive`,
        kind: `violin+box`,
      })
      // whisker segments run along the value axis at the category center
      const [value_c_1, value_c_2] = orientation === `horizontal` ? [`y1`, `y2`] : [`x1`, `x2`]
      const whisker = [...plot.querySelectorAll(`.box-series line`)].find(
        (line) => line.getAttribute(value_c_1) === line.getAttribute(value_c_2),
      )
      const center = Number(whisker?.getAttribute(value_c_1))
      expect(Number.isFinite(center)).toBe(true)
      const { xs: x_values, ys: y_values } = path_coords(
        plot.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``,
      )
      // signed offsets from the center line: hump on the positive side, inner edge on it
      const deltas = (orientation === `horizontal` ? y_values : x_values).map(
        (pixel_x) => (pixel_x - center) * sign,
      )
      expect(Math.max(...deltas)).toBeGreaterThan(5)
      expect(Math.min(...deltas)).toBeGreaterThanOrEqual(-1)
    },
  )

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

  // uncategorized series must not key slots by index (index labels, merging with category `1`)
  // oxfmt-ignore
  test.each([
    [`distinct categories`, [{ category: `A` }, { category: `B` }], [`A`, `B`], {}],
    [`a category spelled like an index`, [{ category: `1` }, { label: `other` }], [`1`, `other`], {}],
    [`a shorter x_axis.categories`, [{ label: `A` }, { label: `B` }, { label: `C` }], [`A`, `B`, `C`], { categories: [`A`, `B`] }],
  ] as const)(`category slots and tick labels with %s`, async (_name, specs, expected_ticks, x_axis) => {
    const plot = await mount_sized_box_plot({
      series: specs.map((spec, idx) => ({ y: dist(80, idx, 1), ...spec })),
      x_axis,
    })
    const ticks = [...plot.querySelectorAll(`g.x-axis g.tick text`)]
    expect(ticks.map((node) => node.textContent?.trim())).toEqual(expected_ticks)
  })

  // Stats <= 0 (whisker_low is exactly 0 here) clamp to the log floor instead of rendering NaN,
  // and the violin is estimated in log10 space over the positive samples: its outline points
  // are evenly spaced on screen and a numeric bandwidth is in decades
  test(`log value axis: finite box glyphs and a violin sampled evenly per decade`, async () => {
    const kde_spy = vi.spyOn(kde_math, `gaussian_kde`)
    const exponents = dist(200, 0, 1.5)
    const plot = await mount_sized_box_plot({
      series: [{ ...basic, y: [0, ...exponents.map((val) => 10 ** val)] }],
      kind: `violin+box`,
      bandwidth: 0.25,
      y_axis: { scale_type: `log` },
    })
    const attrs = [...plot.querySelectorAll(`.box-series line, .box-series rect`)].flatMap(
      (element) => [...element.attributes].map((attr) => attr.value),
    )
    expect(attrs.length).toBeGreaterThan(0)
    expect(attrs.filter((val) => val.includes(`NaN`))).toEqual([])
    const [samples, opts] = kde_spy.mock.calls[0] ?? []
    // log10(10 ** val) round-trips to within a few ulps
    expect(samples).toHaveLength(exponents.length)
    samples?.forEach((val, idx) => expect(val).toBeCloseTo(exponents[idx], 12))
    expect(opts).toMatchObject({ ...kde_math.VIOLIN_KDE_OPTS, bandwidth: 0.25 })
    expect(kde_spy.mock.results[0]?.value.bandwidth).toBe(0.25)
    const path = plot.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``
    expect(path).not.toContain(`NaN`)
    const levels = [...new Set(path_coords(path).ys.map((val) => Math.round(val * 1e3) / 1e3))]
    levels.sort((low, high) => low - high)
    const gaps = levels.slice(1).map((val, idx) => val - levels[idx])
    expect(levels.length).toBeGreaterThan(50)
    expect((levels.at(-1) ?? 0) - levels[0]).toBeGreaterThan(100) // full height, not squashed
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.1)
  })

  test(`series pattern fills the box body from a scoped <pattern> def`, async () => {
    const plot = await mount_sized_box_plot({
      series: [
        { ...basic, pattern: `/` },
        { ...basic, label: `plain`, color: `tomato` },
      ],
    })
    const body = (idx: number) => plot.querySelector(`.box-series[data-box-idx="${idx}"] rect`)
    expect(body(1)?.getAttribute(`fill`)).toBe(`tomato`)
    const defs = plot.querySelectorAll(`.box-plot svg defs pattern`)
    expect(defs).toHaveLength(1)
    expect(defs[0].id).toBe(pattern_id_of(body(0), `box`))
    expect(defs[0].querySelector(`rect`)?.getAttribute(`fill`)).toBe(`steelblue`)
  })

  test(`forwards controls props and the controls_open binding`, async () => {
    expect.hasAssertions()
    const controls_state = { controls_open: true }
    const plot = await mount_sized_box_plot(
      bind_props(
        {
          series: [basic],
          controls_toggle_props: { 'data-testid': `box-toggle` },
          controls_pane_props: { 'data-testid': `box-pane` },
        },
        controls_state,
      ),
    )
    await expect_plot_controls(plot, controls_state, `box`)
  })

  test(`controls pane: Box / violin reset reverts changed settings to defaults`, async () => {
    const kde_spy = vi.spyOn(kde_math, `gaussian_kde`)
    const summary_spy = vi.spyOn(box_math, `summarize_box_samples`)
    const plot = await mount_sized_box_plot({
      series: [basic],
      kind: `violin+box`,
      show_controls: true,
      controls_open: true,
    })
    const checkbox_by_label = (label: string): HTMLInputElement => {
      const box = [...plot.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)].find(
        (input) => input.parentElement?.textContent?.includes(label),
      )
      if (!box) throw new Error(`checkbox "${label}" not found`)
      return box
    }
    const [mean, outliers] = [
      checkbox_by_label(`Show mean`),
      checkbox_by_label(`Show outliers`),
    ]
    expect([mean.checked, outliers.checked]).toEqual([false, true])
    const initial_summary_calls = summary_spy.mock.calls.length
    expect(initial_summary_calls).toBeGreaterThan(0)
    const initial_kde_calls = kde_spy.mock.calls.length
    expect(initial_kde_calls).toBeGreaterThan(0)
    // no outliers drawn once they're toggled off; the mean line appears
    mean.click()
    outliers.click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([true, false])
    expect(plot.querySelectorAll(`.box-series circle`)).toHaveLength(0)
    expect(plot.querySelectorAll(`.box-series line[stroke-dasharray="3 2"]`)).toHaveLength(1)
    expect(kde_spy).toHaveBeenCalledTimes(initial_kde_calls)
    expect(summary_spy).toHaveBeenCalledTimes(initial_summary_calls)

    const reset_btn = plot.querySelector<HTMLButtonElement>(
      `button[aria-label="Reset box / violin to defaults"]`,
    )
    if (!reset_btn) throw new Error(`reset button not rendered`)
    reset_btn.click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([false, true])
    expect(plot.querySelectorAll(`.box-series line[stroke-dasharray="3 2"]`)).toHaveLength(0)
    expect(
      plot.querySelector(`button[aria-label="Reset box / violin to defaults"]`),
    ).toBeNull()
  })
})
