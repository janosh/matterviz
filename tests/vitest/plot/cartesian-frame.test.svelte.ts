// Regression tests for the shared Cartesian scaffold (create_cartesian_frame), exercised
// through the charts that mount it rather than in isolation (it creates $effects).
import { BarPlot, BoxPlot, Histogram } from '$lib'
import type { Vec2 } from '$lib/math'
import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { bind_props, doc_query, mount_sized } from '../setup'

const dist = (count: number, center = 0): number[] =>
  Array.from({ length: count }, (_, idx) => center + Math.sin(idx * 1.7))
const labels = [`alpha`, `beta`, `gamma`]

const frame_charts = [
  [
    `BarPlot`,
    BarPlot,
    () => ({
      series: labels.map((label, idx) => ({
        x: [0, 1, 2],
        y: [idx + 1, idx + 2, idx + 3],
        label,
      })),
    }),
    `.bar-plot`,
  ],
  [
    `BoxPlot`,
    BoxPlot,
    () => ({
      series: labels.map((label, idx) => ({ y: dist(30, idx), label })),
    }),
    `.box-plot`,
  ],
  [
    `Histogram`,
    Histogram,
    () => ({
      series: labels.map((label, idx) => ({ x: dist(30, idx), y: [], label })),
    }),
    `.histogram`,
  ],
] as const

describe(`cartesian frame`, () => {
  // PlotLegendLayer binds frame.legend_filter_query, so the frame owns the text after mount.
  // As a $derived it reset to the legend config on every new legend object, wiping what the
  // user had typed whenever the parent re-rendered with an inline legend={{ ... }} literal.
  test.each(frame_charts)(
    `%s keeps typed legend filter across a new legend object`,
    async (_name, component, get_props, selector) => {
      // filter_threshold below the series count so PlotLegend renders its filter input
      const bound = $state({ legend: { filter_threshold: 2 } })
      await mount_sized(component, bind_props(get_props(), bound), { selector })

      const input = doc_query<HTMLInputElement>(`input.legend-filter`)
      input.value = `alp`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(input.value).toBe(`alp`)

      bound.legend = { filter_threshold: 2 } // fresh object, as a parent re-render would pass
      await tick()
      // Re-query rather than reuse `input`: a remounted input would leave the old node
      // detached but still holding the typed text, which would pass for the wrong reason.
      expect(doc_query<HTMLInputElement>(`input.legend-filter`).value).toBe(`alp`)
    },
  )

  // Rect zoom inverts the drag rect and writes it into each bindable axis prop, so the
  // range sync effect can't snap the view straight back to the auto range. x2/y2 have no
  // data behind them here, so their [0, 1] sentinel scales must stay out of the props.
  test(`rect zoom writes only the primary axis ranges back to the props`, async () => {
    const bound = $state({
      x_axis: { range: [0, 10] as Vec2 },
      y_axis: { range: [0, 10] as Vec2 },
      x2_axis: {},
      y2_axis: {},
    })
    await mount_sized(
      BarPlot,
      bind_props({ series: [{ x: [0, 1, 2], y: [1, 2, 3] }] }, bound),
      {
        selector: `.bar-plot`,
      },
    )

    // jsdom reports a zero-origin bounding rect, so client coords are plot-local
    const at = (x: number, y: number): MouseEventInit => ({
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    })
    const svg = doc_query<SVGSVGElement>(`svg[role="application"]`)
    svg.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, ...at(150, 120) }))
    window.dispatchEvent(new MouseEvent(`mousemove`, at(300, 200)))
    window.dispatchEvent(new MouseEvent(`mouseup`, { ...at(300, 200), buttons: 0 }))
    await tick()

    for (const [min, max] of [bound.x_axis.range, bound.y_axis.range]) {
      expect(min).toBeGreaterThan(0)
      expect(max).toBeLessThan(10)
      expect(max).toBeGreaterThan(min)
    }
    expect(bound.x2_axis).toEqual({}) // a write would have added a `range` key
    expect(bound.y2_axis).toEqual({})
  })

  test.each(frame_charts)(
    `%s applies an aria-label only to its SVG`,
    async (name, component, get_props, selector) => {
      const aria_label = `${name} accessible plot`
      const plot = await mount_sized(
        component,
        { ...get_props(), 'aria-label': aria_label },
        { selector },
      )
      expect(plot.getAttribute(`aria-label`)).toBeNull()
      expect(plot.querySelector(`svg[role="application"]`)?.getAttribute(`aria-label`)).toBe(
        aria_label,
      )
    },
  )
})
