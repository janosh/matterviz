// Regression tests for the shared Cartesian scaffold (create_cartesian_frame), exercised
// through the charts that mount it rather than in isolation (it creates $effects).
import { BarPlot, BoxPlot, Histogram } from '$lib'
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
