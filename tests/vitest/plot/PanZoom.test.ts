import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib'
import { tick } from 'svelte'
import { describe, expect, test } from 'vitest'
import { mount_sized } from '../setup'

type LocalPoint = { x: number; y: number }

const xy_series = () => [{ x: [0, 1, 2], y: [1, 2, 3] }]
const y_series = () => [{ y: [1, 2, 3] }]
const histogram_series = () => [{ x: [], y: [1, 2, 3] }]
const plot_cases = [
  [`BarPlot`, () => mount_sized(BarPlot, { series: xy_series() }, { selector: `.bar-plot` })],
  [`BoxPlot`, () => mount_sized(BoxPlot, { series: y_series() }, { selector: `.box-plot` })],
  [
    `Histogram`,
    () =>
      mount_sized(
        Histogram,
        { series: histogram_series() },
        {
          selector: `.histogram`,
        },
      ),
  ],
  [
    `ScatterPlot`,
    () => mount_sized(ScatterPlot, { series: xy_series() }, { selector: `.scatter` }),
  ],
] satisfies [string, () => Promise<HTMLElement>][]

async function drag(svg: SVGSVGElement, start: LocalPoint, end: LocalPoint): Promise<boolean> {
  const bounds = svg.getBoundingClientRect()
  const event_init = ({ x, y }: LocalPoint): MouseEventInit => ({
    clientX: bounds.left + x,
    clientY: bounds.top + y,
  })
  svg.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, ...event_init(start) }))
  window.dispatchEvent(new MouseEvent(`mousemove`, event_init(end)))
  await tick()
  const active = svg.querySelector(`.zoom-rect`) instanceof SVGRectElement
  window.dispatchEvent(new MouseEvent(`mouseup`, event_init(end)))
  await tick()
  return active
}

describe(`shared plot drag zoom bounds`, () => {
  test.each(plot_cases)(
    `%s rejects margin starts but allows the endpoint outside`,
    async (_name, mount_plot) => {
      const root = await mount_plot()
      const svg = root.querySelector<SVGSVGElement>(`svg[role="application"]`)
      if (!svg) throw new Error(`plot SVG not found`)

      // Default 400×300 plots end at y=240; y=290 is in the x-label margin.
      expect(await drag(svg, { x: 100, y: 290 }, { x: 300, y: 100 })).toBe(false)

      // Only the start is gated: leaving the plot after an interior start still zooms.
      expect(await drag(svg, { x: 100, y: 100 }, { x: 300, y: 290 })).toBe(true)
    },
  )
})
