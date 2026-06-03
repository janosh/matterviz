import { BoxPlot } from '$lib'
import type { BoxPlotSeries, Orientation, WhiskerMode } from '$lib/plot'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { resize_element } from '../setup'

const dist = (n: number, center = 0, spread = 1): number[] =>
  Array.from(
    { length: n },
    (_, idx) => center + spread * Math.sin(idx * 1.7) + (idx % 5) * 0.1,
  )

const basic: BoxPlotSeries = { y: dist(80, 0, 1), label: `Box A`, color: `steelblue` }

async function mount_sized_box_plot(
  props: Partial<ComponentProps<typeof BoxPlot>>,
): Promise<HTMLElement> {
  mount(BoxPlot, {
    target: document.body,
    props: { ...props, style: `width: 400px; height: 300px; ${props.style ?? ``}` },
  })
  const plot = document.querySelector<HTMLElement>(`.box-plot`)
  if (!plot) throw new Error(`BoxPlot root element not found`)
  await resize_element(plot, 400, 300)
  return plot
}

// Boxes only render when they have at least one finite value (finite median)
const rendered_box_count = (series: BoxPlotSeries[] = []): number =>
  series.filter((srs) => (srs.visible ?? true) && srs.y.some((val) => Number.isFinite(val)))
    .length

describe(`BoxPlot`, () => {
  test.each([
    { series: [basic], x_axis: { label: `Model` }, y_axis: { label: `Error` } },
    { series: [] as BoxPlotSeries[] },
    { series: [basic, { ...basic, color: `orangered`, label: `B` }] },
    { series: [basic], whisker_mode: `minmax` as WhiskerMode },
    { series: [basic], whisker_mode: `percentile` as WhiskerMode },
    { series: [basic], whisker_mode: `std` as WhiskerMode },
    { series: [basic], show_value_labels: true },
    { series: [basic], show_mean: true },
    { series: [basic], show_outliers: false },
    { series: [basic], orientation: `horizontal` as Orientation },
    { series: [basic], y_axis: { range: [-3, 3] as [number, number] } },
    { series: [basic], y_axis: { format: `.2~s` } },
    { series: [basic], show_controls: false },
    { series: [basic], legend: null },
    {
      series: [
        { ...basic, visible: false },
        { ...basic, label: `Visible` },
      ],
    },
    { series: [{ y: [] as number[], label: `Empty` }, basic] }, // empty distribution skipped
  ] as Partial<ComponentProps<typeof BoxPlot>>[])(`renders various configs`, async (props) => {
    const series = (props.series ?? []) as BoxPlotSeries[]
    const plot = await mount_sized_box_plot(props)
    const expected = rendered_box_count(series)
    expect(plot.querySelectorAll(`.box-series`)).toHaveLength(expected)
    expect(plot.querySelectorAll(`g.box-series[role="button"]`)).toHaveLength(expected)
    if (props.legend === null) expect(plot.querySelector(`.legend`)).toBeNull()
  })

  test(`each box renders a median line, whiskers and an IQR box`, async () => {
    const plot = await mount_sized_box_plot({ series: [basic] })
    const box_group = plot.querySelector(`.box-series`)
    expect(box_group).not.toBeNull()
    // 2 whiskers + 2 caps + 1 median = 5 lines per box (tukey, cap_fraction > 0)
    expect(box_group?.querySelectorAll(`line`).length).toBeGreaterThanOrEqual(5)
    // IQR box rect + transparent hit rect = 2 rects
    expect(box_group?.querySelectorAll(`rect`)).toHaveLength(2)
  })

  test(`show_value_labels renders one label per box`, async () => {
    const series = [basic, { ...basic, label: `B`, color: `tomato` }]
    const plot = await mount_sized_box_plot({ series, show_value_labels: true })
    expect(plot.querySelectorAll(`.value-label`)).toHaveLength(2)
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
      .map((tick_el) => parseFloat(tick_el.textContent ?? ``))
      .filter(Number.isFinite)
    // axis reaches up toward the outlier at 500, far beyond the cluster
    expect(Math.max(...tick_vals)).toBeGreaterThan(100)
  })

  test(`outliers render as circles in tukey mode, none in minmax`, async () => {
    const outlier_series: BoxPlotSeries[] = [
      { y: [...dist(60, 0, 1), 50, -50], label: `Outliers` },
    ]
    const tukey = await mount_sized_box_plot({ series: outlier_series })
    expect(tukey.querySelectorAll(`.box-series circle`).length).toBeGreaterThan(0)
    document.body.innerHTML = ``
    const minmax = await mount_sized_box_plot({
      series: outlier_series,
      whisker_mode: `minmax`,
    })
    expect(minmax.querySelectorAll(`.box-series circle`)).toHaveLength(0)
  })

  test(`renders y2 axis when a box is assigned to y2`, async () => {
    const plot = await mount_sized_box_plot({
      series: [basic, { y: dist(60, 100, 20), label: `Y2`, y_axis: `y2`, color: `green` }],
      y2_axis: { label: `Secondary` },
    })
    expect(plot.querySelector(`g.y2-axis`)).toBeInstanceOf(SVGGElement)
    expect(plot.querySelector(`.y2-label`)?.textContent).toBe(`Secondary`)
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

  test.each<Orientation>([`vertical`, `horizontal`])(
    `orientation=%s renders all boxes`,
    async (orientation) => {
      const series = [basic, { ...basic, label: `B`, color: `orangered` }]
      const plot = await mount_sized_box_plot({ series, orientation })
      expect(plot.querySelectorAll(`.box-series`)).toHaveLength(2)
      expect(plot.querySelectorAll(`g.box-series[role="button"]`)).toHaveLength(2)
    },
  )

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

  test(`legend toggles box visibility`, async () => {
    const series = [basic, { ...basic, label: `B`, color: `orangered` }]
    const plot = await mount_sized_box_plot({ series, show_legend: true })
    expect(plot.querySelector(`.legend`)).not.toBeNull()
    expect(plot.querySelectorAll(`.box-series`)).toHaveLength(2)
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

  test(`inner box is narrower inside a violin than a standalone box`, async () => {
    const rect_w = (plot: HTMLElement) =>
      parseFloat(iqr_box(plot)[0].getAttribute(`width`) ?? `0`)
    const box_only = await mount_sized_box_plot({ series: [basic], kind: `box` })
    document.body.innerHTML = ``
    const violin_box = await mount_sized_box_plot({ series: [basic], kind: `violin+box` })
    expect(rect_w(violin_box)).toBeLessThan(rect_w(box_only))
  })

  test(`per-series box_width overrides the violin inner-box default`, async () => {
    const rect_w = (plot: HTMLElement) =>
      parseFloat(iqr_box(plot)[0].getAttribute(`width`) ?? `0`)
    const thin = await mount_sized_box_plot({ series: [basic], kind: `violin+box` })
    document.body.innerHTML = ``
    const wide = await mount_sized_box_plot({
      series: [{ ...basic, box_width: 0.8 }],
      kind: `violin+box`,
    })
    expect(rect_w(wide)).toBeGreaterThan(rect_w(thin))
  })

  test(`per-series kind overrides the component default`, async () => {
    const plot = await mount_sized_box_plot({
      kind: `box`,
      series: [basic, { ...basic, label: `V`, kind: `violin` }],
    })
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(1) // only the violin series
    expect(iqr_box(plot)).toHaveLength(1) // only the box series
  })

  test.each([`both`, `positive`, `negative`] as const)(
    `side=%s renders one violin path per series`,
    async (side) => {
      const plot = await mount_sized_box_plot({ series: [basic], kind: `violin`, side })
      const path = plot.querySelector<SVGPathElement>(`.violin-area`)
      expect(path).not.toBeNull()
      expect(path?.getAttribute(`d`)).toMatch(/^M[\d.\-,]/) // valid, finite path
      expect(path?.getAttribute(`d`)).not.toContain(`NaN`)
    },
  )

  test.each([`vertical`, `horizontal`] as const)(
    `violins render in %s orientation`,
    async (orientation) => {
      const series = [basic, { ...basic, label: `B`, color: `tomato` }]
      const plot = await mount_sized_box_plot({ series, kind: `violin`, orientation })
      expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(2)
    },
  )

  test(`split violins share one category slot`, async () => {
    const series: BoxPlotSeries[] = [
      { y: dist(80, 0, 1), category: `X`, side: `negative`, label: `Left`, color: `#4e79a7` },
      { y: dist(80, 1, 1), category: `X`, side: `positive`, label: `Right`, color: `#e15759` },
    ]
    const plot = await mount_sized_box_plot({ series, kind: `violin`, show_legend: true })
    // two violins, but a single category slot (one x-axis tick)
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(2)
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
})
