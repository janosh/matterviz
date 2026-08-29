import { TernaryPlot } from '$lib'
import type { TernaryPointProps, TernarySeries } from '$lib/plot'
import { type ComponentProps, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { mount_sized, one_tab_stop, roving_tabindexes } from '../setup'

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
// The marker <g> is translated to its pixel position
const marker_pos = (marker: Element): [number, number] => {
  const match = /translate\((?<x>[-\d.]+) (?<y>[-\d.]+)\)/.exec(
    marker.getAttribute(`transform`) ?? ``,
  )
  return [Number(match?.groups?.x), Number(match?.groups?.y)]
}

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
    const [pure_a, mixed, counts, pure_b, pure_c] = markers(plot).map(marker_pos)
    // 500x400 box: the height bounds the triangle, side = 400 / (√3/2), centered in x
    const side = 400 / (Math.sqrt(3) / 2)
    const left_x = (500 - side) / 2
    expect(pure_a[0]).toBeCloseTo(left_x + side, 6)
    expect(pure_c[0]).toBeCloseTo(left_x, 6)
    expect(pure_a[1]).toBeCloseTo(pure_c[1], 6) // base is level
    expect(pure_b[0]).toBeCloseTo(250, 6)
    expect(pure_b[1]).toBeLessThan(pure_a[1]) // apex above the base (SVG y grows down)
    expect(pure_a[1] - pure_b[1]).toBeCloseTo(400, 6)
    // [2, 2, 6] normalizes to [0.2, 0.2, 0.6], a different spot than [0.2, 0.3, 0.5]
    expect(counts).not.toEqual(mixed)
    expect(counts[0]).toBeCloseTo(left_x + 0.2 * side + (0.2 * side) / 2, 6)
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
    show_grid.click()
    await tick()
    expect(plot.querySelectorAll(`.grid line`)).toHaveLength(0)
    plot
      .querySelector<HTMLButtonElement>(`button[aria-label="Reset grid to defaults"]`)
      ?.click()
    await tick()
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
    const message = plot.querySelector(`.status-message.error`)?.textContent
    expect(message).toContain(`Bad point 1 has a negative amount`)
    expect(markers(plot)).toHaveLength(0)
  })

  test(`hover shows the fractions tooltip and fires the callback once per point`, async () => {
    const on_point_hover = vi.fn()
    const plot = await mount_ternary({ series, labels: [`Fe`, `Ni`, `Cr`], on_point_hover })
    const hover = (el: Element | undefined, x = 0, y = 0) => {
      el?.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX: x, clientY: y }))
      return tick()
    }
    const tooltip = () => plot.querySelector<HTMLElement>(`.plot-tooltip`)
    await hover(markers(plot)[1], 100, 100)
    expect(tooltip()?.textContent).toMatch(/Oxides\s*Fe: 20%\s*Ni: 30%\s*Cr: 50%/)
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
    // moving within the same marker only moves the chip
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
    plot.querySelector(`svg[role="application"]`)?.dispatchEvent(new MouseEvent(`mouseleave`))
    await tick()
    expect(tooltip()).toBeNull()
    expect(on_point_hover).toHaveBeenLastCalledWith(null)
  })

  test(`keyboard focus anchors the tooltip at the marker, in svg pixels, until focus leaves the chart`, async () => {
    const padding = { t: 20, b: 20, l: 60, r: 60 }
    const plot = await mount_ternary({ series, padding })
    const tooltip = () => plot.querySelector<HTMLElement>(`.plot-tooltip`)
    const focus = (el: Element, type: string, relatedTarget: Element | null = null) => {
      el.dispatchEvent(new FocusEvent(type, { bubbles: true, relatedTarget }))
      return tick()
    }
    const pure_c = markers(plot)[4] // left corner: the marker sits at x = 0 inside the padded <g>
    const [marker_x] = marker_pos(pure_c)
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

  test(`click and Enter fire on_point_click with the point payload`, async () => {
    const on_point_click = vi.fn()
    const plot = await mount_ternary({ series, on_point_click })
    const [first] = markers(plot)
    expect(first.getAttribute(`role`)).toBe(`button`)
    first.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    first.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    await tick()
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

  test(`legend line swatch uses line_style.color like the rendered path`, async () => {
    const styled = [series[0], { ...series[1], line_style: { color: `#00ff00` } }]
    const plot = await mount_ternary({ series: styled })
    expect(plot.querySelector(`.lines path`)?.getAttribute(`stroke`)).toBe(`#00ff00`)
    expect(plot.querySelector(`.legend-item line`)?.getAttribute(`stroke`)).toBe(`#00ff00`)
  })

  test(`legend toggles write visible into the bound series and yield to host changes`, async () => {
    let bound = $state<TernarySeries[]>(series.map((srs) => ({ ...srs })))
    const plot = await mount_ternary({
      get series() {
        return bound
      },
      set series(val) {
        bound = val
      },
    })
    expect(plot.querySelectorAll(`.legend-item`)).toHaveLength(2)
    plot.querySelector<HTMLElement>(`.legend-item`)?.click() // hide Oxides
    await tick()
    expect(bound[0].visible).toBe(false)
    expect(markers(plot)).toHaveLength(2)
    expect(plot.querySelectorAll(`.lines path`)).toHaveLength(1) // Path keeps its line
    // the host overrides the toggle
    bound = bound.map((srs, idx) => (idx === 0 ? { ...srs, visible: true } : srs))
    await tick()
    expect(markers(plot)).toHaveLength(5)
  })

  test(`visible: false hides a series until the legend re-enables it`, async () => {
    const plot = await mount_ternary({ series: [series[0], { ...series[1], visible: false }] })
    expect(markers(plot)).toHaveLength(3)
    expect(plot.querySelectorAll(`.lines path`)).toHaveLength(0) // the hidden line goes too
    plot.querySelectorAll<HTMLElement>(`.legend-item`)[1]?.click()
    await tick()
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
          color_values: [0, 5, null],
        },
      ],
      color_scale: {
        fn: (value: number) => (value > 2 ? `rgb(255, 0, 0)` : `rgb(0, 0, 255)`),
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
  })

  test.each<Partial<ComponentProps<typeof TernaryPlot>>>([
    { series: [{ points: [[1, 1, 1]] }] }, // no color_values
    { series: [{ points: [[1, 1, 1]], color_values: [1] }], color_bar: null },
  ])(`no color bar for %j`, async (props) => {
    const plot = await mount_ternary(props)
    expect(plot.querySelector(`.colorbar`)).toBeNull()
  })

  test(`renders without error for empty series`, async () => {
    const plot = await mount_ternary({ series: [] })
    expect(markers(plot)).toHaveLength(0)
    expect(plot.querySelectorAll(`.corner-labels text`)).toHaveLength(3)
  })
})
