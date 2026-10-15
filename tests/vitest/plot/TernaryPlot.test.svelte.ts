import TernaryPlot from '#lib/plot/ternary/TernaryPlot.svelte'
import { CANVAS_MARKER_THRESHOLD } from '#lib/plot/core/canvas-markers.js'
import { make_rng } from '../numeric-helpers'
import type { ColorScaleConfig, TernaryPointProps, TernarySeries } from '#lib/plot/index.js'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  export_via_pane,
  fire,
  keydown,
  mock_canvas_context,
  mount_sized,
  mouse,
  one_tab_stop,
  plot_svg,
  query,
  roving_tabindexes,
  translate_of,
} from '../setup'

const series: TernarySeries[] = [
  {
    label: `Oxides`,
    color: `#e15759`,
    points: [
      [1, 0, 0],
      [0.2, 0.3, 0.5],
      [2, 2, 6], // raw counts
    ],
  },
  {
    label: `Path`,
    color: `#4e79a7`,
    markers: `line+points`,
    points: [
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
]

const mount_ternary = (
  props: Partial<ComponentProps<typeof TernaryPlot>>,
): Promise<HTMLElement> =>
  mount_sized(TernaryPlot, props, { selector: `.ternary`, width: 500, height: 400 })

const markers = (plot: HTMLElement) => [
  ...plot.querySelectorAll<SVGGElement>(`.points [data-ternary-idx]`),
]

describe(`TernaryPlot`, () => {
  test(`renders one marker per point, corner labels and a line for line series`, async () => {
    const plot = await mount_ternary({ series, labels: [`Fe`, `Ni`, `Cr`] })
    expect(markers(plot)).toHaveLength(5)
    const corner_labels = [...plot.querySelectorAll(`.corner-labels text`)]
    expect(corner_labels.map((text) => text.textContent)).toEqual([`Fe`, `Ni`, `Cr`])
    // each label is nudged clear of its corner: right beside, apex above, left beside
    expect(
      corner_labels.map((text) =>
        [`dx`, `dy`, `text-anchor`].map((attr) => text.getAttribute(attr)),
      ),
    ).toEqual([
      [`8`, null, `start`],
      [null, `-10`, `middle`],
      [`-8`, null, `end`],
    ])
    expect(plot.querySelectorAll(`.lines path`)).toHaveLength(1)
    expect(plot.querySelector(`.lines path`)?.getAttribute(`stroke`)).toBe(`#4e79a7`)
    expect(plot.querySelector(`svg[role="application"]`)?.getAttribute(`aria-label`)).toBe(
      `Ternary plot of Fe, Ni, Cr`,
    )
  })

  test(`places pure components at the corners: first right, second top, third left`, async () => {
    const plot = await mount_ternary({ series, padding: { t: 0, b: 0, l: 0, r: 0 } })
    const [pure_a, mixed, counts, pure_b, pure_c] = markers(plot).map(translate_of)
    // 500x400 box: the height bounds the triangle, side = 400 / (√3/2), centered in x
    const side = 400 / (Math.sqrt(3) / 2)
    const left_x = (500 - side) / 2
    expect(pure_a.x).toBeCloseTo(left_x + side, 6)
    expect(pure_c.x).toBeCloseTo(left_x, 6)
    expect(pure_a.y).toBeCloseTo(pure_c.y, 6) // base is level
    expect(pure_b.x).toBeCloseTo(250, 6)
    expect(pure_b.y).toBeLessThan(pure_a.y) // apex above the base (SVG y grows down)
    expect(pure_a.y - pure_b.y).toBeCloseTo(400, 6)
    // [2, 2, 6] normalizes to [0.2, 0.2, 0.6], a different spot than [0.2, 0.3, 0.5]
    expect(counts).not.toEqual(mixed)
    expect(counts.x).toBeCloseTo(left_x + 0.2 * side + (0.2 * side) / 2, 6)
  })

  test.each([
    [{ grid_step: 0.1 }, 27, 27],
    [{ grid_step: 0.25 }, 9, 9],
    [{ grid_step: 0.25, show_ticks: false }, 9, 0],
    [{ grid_step: 0.5, show_grid: false }, 0, 3], // ticks survive without grid lines
    [{ grid_step: 0 }, 0, 0],
  ])(`%j draws %d grid lines and %d tick labels`, async (props, n_lines, n_ticks) => {
    const plot = await mount_ternary({ series, ...props })
    expect(plot.querySelectorAll(`.grid line`)).toHaveLength(n_lines)
    const tick_labels = [...plot.querySelectorAll(`.ticks text`)].map(
      (text) => text.textContent,
    )
    expect(tick_labels).toHaveLength(n_ticks)
    // ticks of the first component read along the base, ascending
    if (props.grid_step === 0.25 && n_ticks) {
      expect(tick_labels.slice(0, 3)).toEqual([`25%`, `50%`, `75%`])
    }
  })

  test(`the controls pane toggles the grid off and Reset puts it back`, async () => {
    const plot = await mount_ternary({ series, controls_open: true })
    const [show_grid] = plot.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`)
    await fire(show_grid)
    expect(plot.querySelectorAll(`.grid line`)).toHaveLength(0)
    await fire(plot.querySelector(`button[aria-label="Reset grid to defaults"]`))
    expect(plot.querySelectorAll(`.grid line`)).toHaveLength(27)
  })

  test(`an invalid triple renders an error naming the point instead of a chart`, async () => {
    const plot = await mount_ternary({
      series: [
        {
          label: `Bad`,
          points: [
            [1, 0, 0],
            [0, -1, 2],
          ],
        },
      ],
    })
    const message = plot.querySelector(`.viewer-error [role="alert"]`)?.textContent
    expect(message).toContain(`Bad point 2 has a negative amount`)
    expect(markers(plot)).toHaveLength(0)
  })

  // tooltip=false hides the tooltip but keeps the hover handlers
  test.each([undefined, false] as const)(`tooltip=%s`, async (tooltip) => {
    const on_point_hover = vi.fn()
    const plot = await mount_ternary({ series, on_point_hover, tooltip })
    await fire(markers(plot)[1], mouse(`mousemove`, { clientX: 100, clientY: 100 }))
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(plot.querySelector(`.plot-tooltip`) !== null).toBe(tooltip === undefined)
  })

  test(`hover shows the fractions tooltip and fires the callback once per point`, async () => {
    const on_point_hover = vi.fn()
    const bound = $state({ series, labels: [`Fe`, `Ni`, `Cr`] as const })
    const plot = await mount_ternary(bind_props({ on_point_hover }, bound))
    const hover = (element: Element | undefined, coord_x = 0, coord_y = 0) =>
      fire(element, mouse(`mousemove`, { clientX: coord_x, clientY: coord_y }))
    const tooltip = () => plot.querySelector<HTMLElement>(`.plot-tooltip`)
    await hover(markers(plot)[1], 100, 100)
    expect(tooltip()?.textContent).toMatch(/Oxides\s*Fe: 20 %\s*Ni: 30 %\s*Cr: 50 %/)
    expect(
      [...(tooltip()?.querySelectorAll(`small`) ?? [])].map((node) => node.textContent),
    ).toEqual([`%`, `%`, `%`])
    expect(on_point_hover).toHaveBeenCalledOnce()
    expect(on_point_hover.mock.calls[0][0] as TernaryPointProps).toMatchObject({
      series_idx: 0,
      point_idx: 1,
      series_label: `Oxides`,
      amounts: [0.2, 0.3, 0.5],
      fractions: [0.2, 0.3, 0.5],
      color: `#e15759`,
      color_value: null,
    })
    // the open tooltip follows new data; moving within the same marker only moves the chip
    const [oxides, path] = series
    bound.series = [{ ...oxides, points: oxides.points.with(1, [0.6, 0.3, 0.1]) }, path]
    await tick()
    expect(tooltip()?.textContent).toMatch(/Fe: 60 %\s*Ni: 30 %\s*Cr: 10 %/)
    await hover(markers(plot)[1], 105, 100)
    expect(on_point_hover).toHaveBeenCalledOnce()
    // a different marker swaps the payload
    await hover(markers(plot)[3], 200, 50)
    expect(on_point_hover).toHaveBeenCalledTimes(2)
    expect(on_point_hover.mock.calls[1][0] as TernaryPointProps).toMatchObject({
      series_idx: 1,
      point_idx: 0,
      series_label: `Path`,
    })
    // the tooltip closes when its point is gone, and the hover ends right away
    bound.series = [oxides]
    await tick()
    expect(tooltip()).toBeNull()
    expect(on_point_hover).toHaveBeenCalledTimes(3)
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
    await fire(plot_svg(plot), mouse(`mouseleave`))
    expect(on_point_hover).toHaveBeenCalledTimes(3)
  })

  // ScatterPlot's threshold: one canvas instead of an SVG node per marker, still pickable
  test.each([
    { fill: undefined, canvas: true },
    { fill: `var(--marker-fill)`, canvas: false }, // a paint canvas can't parse stays SVG
  ])(`$fill markers past the canvas threshold: canvas=$canvas`, async ({ fill, canvas }) => {
    const arcs: [number, number][] = []
    mock_canvas_context({ arc: vi.fn((cx: number, cy: number) => arcs.push([cx, cy])) })
    const n_points = CANVAS_MARKER_THRESHOLD + 1
    const rng = make_rng(0)
    const points = Array.from(
      { length: n_points },
      () => [rng(), rng(), rng()] as [number, number, number],
    )
    const [on_point_hover, on_point_click] = [vi.fn(), vi.fn()]
    const plot = await mount_ternary({
      series: [{ points, point_style: { fill } }],
      on_point_hover,
      on_point_click,
    })
    expect(Boolean(plot.querySelector(`canvas.marker-canvas`))).toBe(canvas)
    expect(markers(plot)).toHaveLength(canvas ? 0 : n_points)
    if (!canvas) return
    // markers paint in data order, so arc k is point k; the svg rect sits at the origin
    expect(arcs).toHaveLength(n_points)
    const svg = plot_svg(plot)
    for (const point_idx of [0, 500, n_points - 1]) {
      const [cx, cy] = arcs[point_idx]
      await fire(svg, mouse(`mousemove`, { clientX: cx, clientY: cy }))
      expect(on_point_hover).toHaveBeenLastCalledWith(expect.objectContaining({ point_idx }))
      // only the hovered marker gets an SVG node, drawn over its canvas twin
      expect(markers(plot).map((node) => node.getAttribute(`data-ternary-idx`))).toEqual([
        String(point_idx),
      ])
      expect(plot.querySelector(`.plot-tooltip`)).not.toBeNull()
      await fire(svg, mouse(`click`, { clientX: cx, clientY: cy }))
      expect(on_point_click).toHaveBeenLastCalledWith(expect.objectContaining({ point_idx }))
    }
    // far from every marker clears the hover
    await fire(svg, mouse(`mousemove`, { clientX: 1, clientY: 1 }))
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
    expect(markers(plot)).toHaveLength(0)
  })

  test(`keyboard focus anchors the tooltip at the marker, in svg pixels, until focus leaves the chart`, async () => {
    const padding = { t: 20, b: 20, l: 60, r: 60 }
    const plot = await mount_ternary({ series, padding })
    const tooltip = () => plot.querySelector<HTMLElement>(`.plot-tooltip`)
    const focus = (element: Element, type: string, relatedTarget: Element | null = null) =>
      fire(element, new FocusEvent(type, { bubbles: true, relatedTarget }))
    const pure_c = markers(plot)[4] // left corner: the marker sits at x = 0 inside the padded <g>
    const { x: marker_x } = translate_of(pure_c)
    expect(marker_x).toBeCloseTo(0, 6)
    await focus(pure_c, `focusin`)
    // anchor = padding + marker, then the 10px tooltip offset to the right
    expect(Number(tooltip()?.style.left.replace(`px`, ``))).toBeCloseTo(padding.l + 10, 6)
    // focus moving to another marker is the keyboard's mousemove, not a leave
    await focus(pure_c, `focusout`, markers(plot)[3])
    expect(tooltip()).not.toBeNull()
    await focus(pure_c, `focusout`)
    expect(tooltip()).toBeNull()
  })

  test.each([`Enter`, ` `])(`click and %j activate points`, async (key) => {
    const on_point_click = vi.fn()
    const plot = await mount_ternary({ series, on_point_click })
    const [first] = markers(plot)
    expect(first.getAttribute(`role`)).toBe(`button`)
    first.focus()
    await tick()
    expect(getComputedStyle(first).outlineStyle).toBe(`none`)
    const marker_style = getComputedStyle(query(first, `.marker`))
    expect(marker_style.strokeWidth).toBe(`1.5px`)
    expect(marker_style.vectorEffect).toBe(`non-scaling-stroke`)
    first.dispatchEvent(mouse(`click`))
    const canceled_event = keydown(key, { cancelable: true })
    canceled_event.preventDefault()
    first.dispatchEvent(canceled_event)
    first.dispatchEvent(keydown(key, { isComposing: true }))
    expect(on_point_click).toHaveBeenCalledOnce()
    await fire(first, keydown(key))
    expect(on_point_click).toHaveBeenCalledTimes(2)
    expect(on_point_click.mock.calls[0][0] as TernaryPointProps).toMatchObject({
      series_idx: 0,
      point_idx: 0,
      fractions: [1, 0, 0],
    })
  })

  test(`markers share one tab stop and expose fractions as their accessible name`, async () => {
    const plot = await mount_ternary({ series, labels: [`Fe`, `Ni`, `Cr`] })
    const tabindexes = roving_tabindexes(plot)
    expect(tabindexes).toEqual(one_tab_stop(5))
    expect(markers(plot)[1].getAttribute(`aria-label`)).toBe(`Oxides: Fe 20%, Ni 30%, Cr 50%`)
  })

  test.each([
    [{ series: [series[0]] }, false], // single series: auto-hidden
    [{ series, legend: null }, false],
    [{ series: [series[0]], show_legend: true }, true],
  ])(`legend visibility for %j is %s`, async (props, visible) => {
    const plot = await mount_ternary(props)
    expect(plot.querySelector(`.legend`) !== null).toBe(visible)
  })

  test.each([
    [`line`, 3],
    [`line+points`, 5],
  ] as const)(
    `%s styles match the legend and only markers get keyboard stops`,
    async (mode, n_markers) => {
      const plot = await mount_ternary({
        series: [{ ...series[1], markers: mode, line_style: { color: `#00ff00` } }, series[0]],
      })
      expect(plot.querySelectorAll(`.lines path`)).toHaveLength(1)
      expect(plot.querySelector(`.lines path`)?.getAttribute(`stroke`)).toBe(`#00ff00`)
      expect(plot.querySelector(`.legend-item line`)?.getAttribute(`stroke`)).toBe(`#00ff00`)
      expect(markers(plot)).toHaveLength(n_markers)
      expect(markers(plot).map((marker) => marker.getAttribute(`data-ternary-idx`))).toEqual(
        Array.from({ length: n_markers }, (_, idx) => `${idx}`),
      )
      expect(roving_tabindexes(plot)).toEqual(one_tab_stop(n_markers))
    },
  )

  test(`legend toggles update separate visibility state`, async () => {
    const bound = $state({
      series: series.map((srs) => ({ ...srs })),
      hidden_series: [] as (string | number)[],
    })
    const on_toggle = vi.fn(() => expect(bound.hidden_series).toEqual([0]))
    const on_double_click = vi.fn(() => expect(bound.hidden_series).toEqual([1]))
    const plot = await mount_ternary(
      bind_props({ legend: { on_toggle, on_double_click } }, bound),
    )
    expect(plot.querySelectorAll(`.legend-item`)).toHaveLength(2)
    await fire(plot.querySelector(`.legend-item`)) // hide Oxides
    expect(bound.series[0].visible).toBeUndefined()
    expect(bound.hidden_series).toEqual([0])
    expect(on_toggle).toHaveBeenCalledExactlyOnceWith(0)
    expect(markers(plot)).toHaveLength(2)
    expect(plot.querySelectorAll(`.lines path`)).toHaveLength(1) // Path keeps its line
    await fire(plot.querySelector(`.legend-item`), mouse(`dblclick`))
    expect(on_double_click).toHaveBeenCalledExactlyOnceWith(0)
    expect(markers(plot)).toHaveLength(3)
    // the host overrides the toggle
    bound.hidden_series = []
    await tick()
    expect(markers(plot)).toHaveLength(5)
  })

  test(`visible: false hides a series until the legend re-enables it`, async () => {
    const plot = await mount_ternary({ series: [series[0], { ...series[1], visible: false }] })
    expect(markers(plot)).toHaveLength(3)
    expect(plot.querySelectorAll(`.lines path`)).toHaveLength(0) // the hidden line goes too
    await fire(plot.querySelectorAll(`.legend-item`)[1])
    expect(markers(plot)).toHaveLength(5)
    expect(plot.querySelectorAll(`.lines path`)).toHaveLength(1)
  })

  test(`color_values paint markers through the color scale and show a color bar`, async () => {
    const plot = await mount_ternary({
      series: [
        {
          points: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          color_values: [0, 5, null, 1000], // a value without a point must not widen the range
        },
        { points: [[1, 1, 1]], color_values: [-1000], visible: false },
      ],
      // a t in [0, 1] scheme over the auto [0, 5] value range
      color_scale: {
        scheme: (frac: number) => (frac > 0.4 ? `rgb(255, 0, 0)` : `rgb(0, 0, 255)`),
      },
      color_bar: { title: `E (eV)` },
    })
    const fills = markers(plot).map((marker) =>
      marker.querySelector(`.marker`)?.getAttribute(`fill`),
    )
    expect(fills[0]).toContain(`rgb(0, 0, 255)`)
    expect(fills[1]).toContain(`rgb(255, 0, 0)`)
    expect(fills[2]).not.toContain(`rgb`) // null value: palette color
    const colorbar = plot.querySelector(`.colorbar`)?.textContent
    expect(colorbar).toContain(`E (eV)`)
    expect(colorbar).toContain(`5`) // spans the min/max of the non-null color values
    const ticks = [...plot.querySelectorAll(`.colorbar .tick-label`)].map((label) =>
      Number(label.textContent),
    )
    expect([Math.min(...ticks), Math.max(...ticks)]).toEqual([0, 5])
  })

  // type spaces the colors and value_range ends override the data extent, on markers and bar
  test.each<[ColorScaleConfig, number[], number[]]>([
    [{ type: `log` }, [0, 128, 255], [1, 100]],
    [{ value_range: [0, 200] }, [1, 13, 128], [0, 200]],
    [{ type: `log`, value_range: [null, 1000] }, [0, 85, 170], [1, 1000]],
  ])(`color_scale %j`, async (config, expected_reds, bar_range) => {
    const red_ramp = (frac: number) => `rgb(${Math.round(frac * 255)}, 0, 0)`
    const plot = await mount_ternary({
      series: [
        {
          points: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          color_values: [1, 10, 100],
        },
      ],
      color_scale: { ...config, scheme: red_ramp },
      color_bar: { tick_format: `d` },
    })
    const reds = markers(plot).map((marker) =>
      Number(
        /rgb\((?<red>\d+)/.exec(marker.querySelector(`.marker`)?.getAttribute(`fill`) ?? ``)
          ?.groups?.red,
      ),
    )
    expect(reds).toEqual(expected_reds)
    const ticks = [...plot.querySelectorAll(`.colorbar .tick-label`)].map((label) =>
      Number(label.textContent),
    )
    expect([Math.min(...ticks), Math.max(...ticks)]).toEqual(bar_range)
  })

  test.each<Partial<ComponentProps<typeof TernaryPlot>>>([
    { series: [{ points: [[1, 1, 1]] }] }, // no color_values
    { series: [{ points: [[1, 1, 1]], color_values: [null] }] },
    { series: [{ points: [[1, 1, 1]], color_values: [NaN] }] },
    { series: [{ points: [[1, 1, 1]], color_values: [Infinity] }] },
    { series: [{ points: [[1, 1, 1]], color_values: [1] }], color_bar: null },
  ])(`no color bar for %j`, async (props) => {
    const plot = await mount_ternary(props)
    expect(plot.querySelector(`.colorbar`)).toBeNull()
  })

  test(`renders without error for empty series`, async () => {
    const plot = await mount_ternary({ series: [] })
    expect(plot.querySelector(`.viewer-error`)).toBeNull()
    expect(markers(plot)).toHaveLength(0)
    expect(plot.querySelectorAll(`.corner-labels text`)).toHaveLength(3)
  })
})

// CSV rows hold each visible point's normalized fractions under the corner labels
test(`TernaryPlot CSV export lists normalized fractions per series`, async () => {
  const on_export = vi.fn()
  const plot = await mount_ternary({ series, labels: [`A`, `B`, `C`], on_export })
  const result = await export_via_pane(on_export, `CSV`, plot)
  expect(result.offered).toEqual([`PNG`, `SVG`, `CSV`])
  expect(result.filename).toBe(`ternary-A-B-C`)
  const [header, ...rows] = String(result.data).split(`\n`)
  expect(header).toBe(`series,A,B,C,color_value`)
  expect(rows).toContain(`Oxides,0.2,0.2,0.6,`) // raw counts [2, 2, 6] normalized
  expect(rows).toHaveLength(5)
})
