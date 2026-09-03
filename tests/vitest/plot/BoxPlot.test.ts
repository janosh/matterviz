import { BoxPlot, type Vec2 } from '$lib'
import type { BoxPlotSeries, Orientation, WhiskerMode } from '$lib/plot'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  expect_plot_controls,
  mount_sized,
  one_tab_stop,
  pattern_id_of,
  roving_tabindexes,
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
  // Regression: every mark used to carry tabindex=0, so tabbing past a chart meant
  // one press per bin/point/box. Exactly one mark holds the group's tab stop.
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

  // Hiding series shrinks the obstacle field the frame's solver reads, so an outside legend
  // moves back inside once the remaining boxes leave room for it
  test(`legend returns inside the plot once dense boxes are isolated`, async () => {
    const plot = await mount_sized_box_plot({
      series: Array.from({ length: 24 }, (_, series_idx) => ({
        y: [-20, -10, 0, 10, 20],
        label: `Box ${series_idx}`,
      })),
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
    expect(is_outside()).toBe(true)
    legend
      .querySelector(`.legend-item`)
      ?.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    await vi.waitFor(() => expect(is_outside()).toBe(false))
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
      const [c1, c2] = orientation === `horizontal` ? [`y1`, `y2`] : [`x1`, `x2`]
      const whisker = [...plot.querySelectorAll(`.box-series line`)].find(
        (ln) => ln.getAttribute(c1) === ln.getAttribute(c2),
      )
      const center = Number(whisker?.getAttribute(c1))
      expect(Number.isFinite(center)).toBe(true)
      const { xs, ys } = path_coords(
        plot.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``,
      )
      // signed offsets from the center line: hump on the positive side, inner edge on it
      const deltas = (orientation === `horizontal` ? ys : xs).map((px) => (px - center) * sign)
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

  test(`distinct categories produce one slot each`, async () => {
    const series: BoxPlotSeries[] = [
      { y: dist(80, 0, 1), category: `A`, label: `A`, color: `#4e79a7` },
      { y: dist(80, 1, 1), category: `B`, label: `B`, color: `#e15759` },
    ]
    const plot = await mount_sized_box_plot({ series, kind: `violin` })
    expect(plot.querySelectorAll(`g.x-axis g.tick`)).toHaveLength(2)
  })

  // on a log value axis, stats <= 0 (whisker_low is often exactly 0, outliers can be
  // negative) must clamp to the log floor instead of rendering NaN coordinates, and the KDE
  // grid must clamp to the smallest positive sample (its tail would otherwise map to NaN
  // pixels and a LOG_EPS-polluted auto range would squash the violin to a few px)
  test(`log value axis renders finite box glyphs and a full-height violin`, async () => {
    const plot = await mount_sized_box_plot({
      series: [{ y: [0, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 15], label: `Z` }],
      y_axis: { scale_type: `log` },
      kind: `violin+box`,
    })
    const attrs = [...plot.querySelectorAll(`.box-series line, .box-series rect`)].flatMap(
      (el) => [...el.attributes].map((attr) => attr.value),
    )
    expect(attrs.length).toBeGreaterThan(0)
    expect(
      attrs.some((val) => val.includes(`NaN`)),
      `no NaN in box glyphs`,
    ).toBe(false)
    const path = plot.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``
    expect(path.length).toBeGreaterThan(0)
    expect(path).not.toContain(`NaN`)
    const { ys } = path_coords(path)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(100)
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
    const plot = await mount_sized_box_plot({
      series: [basic],
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
    // no outliers drawn once they're toggled off; the mean line appears
    mean.click()
    outliers.click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([true, false])
    expect(plot.querySelectorAll(`.box-series circle`)).toHaveLength(0)
    expect(plot.querySelectorAll(`.box-series line[stroke-dasharray="3 2"]`)).toHaveLength(1)

    const reset_btn = plot.querySelector<HTMLButtonElement>(
      `button[aria-label="Reset box / violin to defaults"]`,
    )
    // a missing/no-op reset (the original bug) would leave the flipped values in place
    if (!reset_btn) throw new Error(`reset button not rendered`)
    reset_btn.click()
    await tick()
    expect([mean.checked, outliers.checked]).toEqual([false, true])
    expect(plot.querySelectorAll(`.box-series line[stroke-dasharray="3 2"]`)).toHaveLength(0)
  })
})
