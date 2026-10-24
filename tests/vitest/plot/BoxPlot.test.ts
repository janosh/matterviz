import BoxPlot from '#lib/plot/box/BoxPlot.svelte'
import * as kde_math from '#lib/plot/box/kde.js'
import * as box_math from '#lib/plot/box/box-plot.js'
import type { Vec2 } from '#lib'
import type { BoxPlotSeries, Orientation, WhiskerMode } from '#lib/plot/index.js'
import { type ComponentProps, flushSync, tick } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { type Rect, rects_overlap } from '#lib/plot/core/layout.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  fire,
  pin_cycle,
  expect_plot_controls,
  export_via_pane,
  form_controls,
  mount_sized,
  one_tab_stop,
  pattern_id_of,
  plot_svg,
  query,
  roving_tabindexes,
  svg_mark_driver,
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
const rendered_box_count = (series: readonly BoxPlotSeries[] = []): number =>
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

  // Every config must draw one box, hit target (and value label if asked) per finite series.
  // No series means no category labels, so the axis must fall back to generated ticks
  test.each([
    [`no series`, { series: [] }],
    [`axis labels`, { series: [basic], x_axis: { label: `Model` }, y_axis: { label: `Err` } }],
    ...([`minmax`, `percentile`, `std`] as WhiskerMode[]).map((whisker_mode) => [
      `whisker_mode=${whisker_mode}`,
      { series: [basic], whisker_mode },
    ]),
    [`a clamped y range`, { series: [basic], y_axis: { range: [-3, 3] as Vec2 } }],
    [`an SI tick format`, { series: [basic], y_axis: { format: `.2~s` } }],
    [`controls hidden`, { series: [basic], show_controls: false }],
    [`value labels`, { series: [basic, { ...basic, label: `B` }], show_value_labels: true }],
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
      const expected = rendered_box_count(props.series)
      expect(plot.querySelectorAll(`.box-series`)).toHaveLength(expected)
      expect(plot.querySelectorAll(`g.box-series[role="button"]`)).toHaveLength(expected)
      expect(plot.querySelectorAll(`.value-label`)).toHaveLength(
        props.show_value_labels ? expected : 0,
      )
      expect(plot.querySelectorAll(`g.x-axis g.tick`).length).toBeGreaterThan(0)
    },
  )

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

  // Strokes default to a theme CSS variable so they track light/dark themes; an explicit color
  // recolors only its own glyph. Rows give the per-color tally of the 5 lines (2 whiskers,
  // 2 caps, 1 median) and the IQR rect stroke
  const theme_stroke = `var(--text-color, black)`
  // oxfmt-ignore
  test.each([
    [`default`, {}, { [theme_stroke]: 5 }, theme_stroke],
    [`whisker`, { whisker: { color: `tomato` } }, { tomato: 4, [theme_stroke]: 1 }, theme_stroke],
    [`median`, { median_style: { color: `gold` } }, { gold: 1, [theme_stroke]: 4 }, theme_stroke],
    [`box outline`, { box: { stroke_color: `cyan` } }, { [theme_stroke]: 5 }, `cyan`],
  ] as const)(`%s color is theme-aware and isolated`, async (_name, extra, lines, rect) => {
    const plot = await mount_sized_box_plot({ series: [basic], ...extra })
    const strokes = [...plot.querySelectorAll(`.box-series line`)].map((line) => line.getAttribute(`stroke`))
    expect(strokes).toHaveLength(5)
    for (const [color, count] of Object.entries(lines)) {
      expect(strokes.filter((stroke) => stroke === color)).toHaveLength(count)
    }
    expect(plot.querySelector(`.iqr-box`)?.getAttribute(`stroke`)).toBe(rect)
    // IQR box rect + transparent hover-target rect
    expect(plot.querySelectorAll(`.box-series rect`)).toHaveLength(2)
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
    // range_values must reach the extreme outliers, not just the whiskers
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
      const vertical = orientation === `vertical`
      const tukey = await mount_sized_box_plot({
        series: outlier_series,
        orientation,
        [vertical ? `y_axis` : `x_axis`]: { range: [-8, 9] },
      })
      const outlier_circles = [...tukey.querySelectorAll(`.box-series circle`)]
      expect(outlier_circles.length).toBeGreaterThan(0)
      const clip = svg_rect(query(tukey, `clipPath rect`))
      const [clip_start, clip_size] = vertical ? [clip.y, clip.height] : [clip.x, clip.width]
      const centers = outlier_circles.map((circle) =>
        Number(circle.getAttribute(vertical ? `cy` : `cx`)),
      )
      expect(Math.min(...centers)).toBeCloseTo(clip_start)
      expect(Math.max(...centers)).toBeCloseTo(clip_start + clip_size)
      expect(outlier_circles.filter((circle) => circle.closest(`[clip-path]`))).toEqual([])
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
        const { control, set_value } = form_controls(plot)
        const outliers = control(`Show outliers`)
        expect([control(`Points`).value, outliers.disabled]).toEqual([`none`, false])
        expect(plot.querySelectorAll(`circle.sample-point`)).toHaveLength(0)
        await set_value(`Points`, `swarm`)
        expect(plot.querySelectorAll(`circle.sample-point`)).toHaveLength(n_samples)
        expect(outliers.disabled).toBe(disabled_after)
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
    const fills = [...plot.querySelectorAll(`g.x-axis text`)]
      .filter((node) => [`Red`, `Green`].includes(node.textContent?.trim() ?? ``))
      .map((node) => node.getAttribute(`fill`))
    expect(fills).toEqual([`#ff0000`, `#00ff00`])
  })

  // Tukey whiskers are not the series min/max once there are outliers. The tooltip must not
  // be a snapshot: it tracks replaced data under a resting pointer and closes with its box
  test(`hover and click report box stats and the tooltip follows replaced data`, async () => {
    const [on_box_hover, on_box_click] = [vi.fn(), vi.fn()]
    // a reactive getter lets this plain .ts test replace the series under the resting pointer
    const current = new SvelteMap<string, BoxPlotSeries[]>([
      [`series`, [{ y: [1, 2, 3, 4, 5, 100], label: `Box A` }]],
    ])
    const plot = await mount_sized_box_plot({
      get series() {
        return current.get(`series`)
      },
      on_box_hover,
      on_box_click,
    })
    const hit = query(plot, `g.box-series[role="button"]`)
    hit.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true }))
    await fire(hit, new MouseEvent(`click`, { bubbles: true }))
    expect(on_box_hover).toHaveBeenCalledOnce()
    // type-7 median: mean of the two middle order statistics
    expect(on_box_click).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        box_idx: 0,
        category_label: `Box A`,
        stats: expect.objectContaining({ median: 3.5 }),
      }),
    )
    const tooltip_after = (series?: BoxPlotSeries[]) => {
      if (series) current.set(`series`, series)
      flushSync()
      return plot.querySelector(`.plot-tooltip`)?.textContent ?? null
    }
    const text = tooltip_after() ?? ``
    for (const part of [`median`, `whisker high: 5`, `whisker low: 1`, `outliers: 1`]) {
      expect(text).toContain(part)
    }
    expect(text).not.toMatch(/max|min/)
    expect(tooltip_after([{ y: [1, 2, 30, 40, 50], label: `A` }])).toContain(`median: 30`)
    expect(tooltip_after([])).toBeNull()
    expect(on_box_hover).toHaveBeenLastCalledWith(null)
  })

  test(`a box click or Enter pins its tooltip; it again, empty space or Escape unpin`, async () => {
    const series = [basic, { y: dist(80, 3), label: `Box B` }]
    const plot = await mount_sized_box_plot({ series })
    const boxes = [...plot.querySelectorAll(`g.box-series[role="button"]`)]
    const text = await pin_cycle(svg_mark_driver(boxes, plot_svg(plot)), { keyboard: true })
    expect(text).toContain(`Box A`)
  })

  // Statistics are snapped to 0 only within float noise n·ε·max|x|: a round-off mean or an
  // interpolated quartile reads 0, a genuinely tiny median or mean beside large values doesn't
  test.each([
    { label: `round-off mean`, y: [0.1, 0.2, -0.3], median: /median: 0\.1/, mean: /mean: 0$/ },
    {
      label: `round-off quartile`,
      y: [-0.3, 0.1],
      median: /q3: 0median/,
      mean: /mean: −0\.1$/,
    },
    {
      label: `tiny median and mean beside large values`,
      y: [-1e6, 1e-7, 1e6],
      median: /median: 1e-7/,
      mean: /mean: 3\.33e-8$/,
    },
  ])(`tooltip statistics: $label`, async ({ y, median, mean }) => {
    const plot = await mount_sized_box_plot({ series: [{ y, label: `A` }], show_mean: true })
    query(plot, `g.box-series[role="button"]`).dispatchEvent(
      new MouseEvent(`mousemove`, { bubbles: true }),
    )
    await tick()
    const text = query(plot, `.plot-tooltip`).textContent?.trim()
    expect(text).toMatch(median)
    expect(text).toMatch(mean)
  })

  // aria-labels are read aloud: the interpolated median 0.15000000000000002 reads as 0.15
  test.each([
    [{}, `box 1: A, median 0.15`],
    [{ format: `.1%` }, `box 1: A, median 15%`],
  ])(`aria-label formats the median with value axis %j`, async (y_axis, expected) => {
    const plot = await mount_sized_box_plot({
      series: [{ y: [0.1, 0.2], label: `A` }],
      y_axis,
    })
    expect(query(plot, `g.box-series`).getAttribute(`aria-label`)).toBe(expected)
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
    expect(summary_spy).toHaveBeenCalledTimes(24)
    const legend = query(plot, `.legend`)
    const is_outside = () => {
      const clip = svg_rect(query(plot, `clipPath rect`))
      return Number(legend.style.top.replace(`px`, ``)) > clip.y + clip.height
    }
    expect(is_outside()).toBe(true)
    query(legend, `.legend-item`).dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await vi.waitFor(() => expect(is_outside()).toBe(false))
    expect(summary_spy).toHaveBeenCalledTimes(24) // isolating reuses the box stats
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

  test(`violin inner box is narrower than a standalone box unless box_width widens it`, async () => {
    const iqr_width = async (props: Partial<ComponentProps<typeof BoxPlot>>) => {
      document.body.innerHTML = ``
      return Number(iqr_box(await mount_sized_box_plot(props))[0].getAttribute(`width`))
    }
    const inner = await iqr_width({ series: [basic], kind: `violin+box` })
    expect(await iqr_width({ series: [basic], kind: `box` })).toBeGreaterThan(inner)
    const widened = { series: [{ ...basic, box_width: 0.8 }], kind: `violin+box` } as const
    expect(await iqr_width(widened)).toBeGreaterThan(inner)
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

  // uncategorized series must not key slots by index (index labels, merging with category `1`);
  // split violins share one slot
  // oxfmt-ignore
  test.each([
    [`distinct categories`, [{ category: `A` }, { category: `B` }], [`A`, `B`], {}],
    [`a category spelled like an index`, [{ category: `1` }, { label: `other` }], [`1`, `other`], {}],
    [`a shorter x_axis.categories`, [{ label: `A` }, { label: `B` }, { label: `C` }], [`A`, `B`, `C`], { categories: [`A`, `B`] }],
    [`split violins`, [{ category: `X`, side: `negative` }, { category: `X`, side: `positive` }], [`X`], {}],
  ] as const)(`violin slots and tick labels with %s`, async (_name, specs, expected_ticks, x_axis) => {
    const plot = await mount_sized_box_plot({
      series: specs.map((spec, idx) => ({ y: dist(80, idx, 1), ...spec })),
      kind: `violin`,
      x_axis,
    })
    const ticks = [...plot.querySelectorAll(`g.x-axis g.tick text`)]
    expect(ticks.map((node) => node.textContent?.trim())).toEqual(expected_ticks)
    const paths = [...plot.querySelectorAll(`.violin-area`)].map((path) => path.getAttribute(`d`))
    expect(paths).toHaveLength(specs.length)
    expect(paths.filter((path) => path?.includes(`NaN`))).toEqual([])
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
    const { control } = form_controls(plot)
    const [mean, outliers] = [control(`Show mean`), control(`Show outliers`)]
    if (!(mean instanceof HTMLInputElement && outliers instanceof HTMLInputElement)) {
      throw new TypeError(`Show mean/outliers are not checkboxes`)
    }
    expect([mean.checked, outliers.checked]).toEqual([false, true])
    const [kde_calls, summary_calls] = [kde_spy, summary_spy].map(
      (spy) => spy.mock.calls.length,
    )
    expect(Math.min(kde_calls, summary_calls)).toBeGreaterThan(0)
    // no outliers drawn once they're toggled off; the mean line appears, without re-estimating
    mean.click()
    outliers.click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([true, false])
    expect(plot.querySelectorAll(`.box-series circle`)).toHaveLength(0)
    expect(plot.querySelectorAll(`.box-series line[stroke-dasharray="3 2"]`)).toHaveLength(1)
    expect([kde_spy, summary_spy].map((spy) => spy.mock.calls.length)).toEqual([
      kde_calls,
      summary_calls,
    ])
    query(plot, `button[aria-label="Reset box / violin to defaults"]`).click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([false, true])
    expect(plot.querySelectorAll(`.box-series line[stroke-dasharray="3 2"]`)).toHaveLength(0)
    expect(
      plot.querySelector(`button[aria-label="Reset box / violin to defaults"]`),
    ).toBeNull()
  })
})

// One CSV row per visible box with its five-number summary and outliers
test(`BoxPlot CSV export lists each box's summary statistics`, async () => {
  const on_export = vi.fn()
  const plot = await mount_sized_box_plot({ series: [basic], on_export })
  const result = await export_via_pane(on_export, `CSV`, plot)
  expect(result.offered).toEqual([`PNG`, `SVG`, `CSV`])
  const [header, row] = String(result.data).split(`\n`)
  expect(header.split(`,`).slice(0, 3)).toEqual([`series`, `n`, `min`])
  expect(header.endsWith(`,outliers`)).toBe(true)
  expect(row.startsWith(`Box A,`)).toBe(true)
})

// The tick of an unlabeled box used to read its 0-based index while legend and CSV said
// `Box 1`, and its aria-label read `box 1: , median`
test(`unlabeled boxes are numbered from 1 in ticks, legend, aria-labels and CSV`, async () => {
  const on_export = vi.fn()
  const plot = await mount_sized_box_plot({
    series: [{ y: [1, 2, 3] }, { y: [4, 5, 6] }],
    show_legend: true,
    on_export,
  })
  const ticks = [...plot.querySelectorAll(`g.x-axis g.tick text`)]
  expect(ticks.map((node) => node.textContent?.trim())).toEqual([`Box 1`, `Box 2`])
  const aria_labels = (selector: string) =>
    [...plot.querySelectorAll(selector)].map((node) => node.getAttribute(`aria-label`))
  expect(aria_labels(`.legend-item`)).toEqual([
    `Toggle visibility for Box 1`,
    `Toggle visibility for Box 2`,
  ])
  expect(aria_labels(`g.box-series`)).toEqual([`Box 1, median 2`, `Box 2, median 5`])
  const { data } = await export_via_pane(on_export, `CSV`, plot)
  const rows = String(data).split(`\n`).slice(1)
  expect(rows.map((row) => row.split(`,`)[0])).toEqual([`Box 1`, `Box 2`])
})
