import { SETTLE_MS } from '$lib/plot/core/utils'
import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib'
import { tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { mount_sized } from '../setup'

type LocalPoint = { x: number; y: number; button?: number }

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

type DragOptions = { shift?: boolean; mid_drag?: () => void }

async function drag(
  svg: SVGSVGElement,
  start: LocalPoint,
  end: LocalPoint,
  { shift = false, mid_drag }: DragOptions = {},
): Promise<boolean> {
  const bounds = svg.getBoundingClientRect()
  const event_init = ({ x, y, button = 0 }: LocalPoint): MouseEventInit => ({
    button,
    buttons: 1, // a real drag holds the primary button down; the pan gives up when it isn't
    clientX: bounds.left + x,
    clientY: bounds.top + y,
    shiftKey: shift,
  })
  svg.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, ...event_init(start) }))
  window.dispatchEvent(new MouseEvent(`mousemove`, event_init(end)))
  await tick()
  const active = svg.querySelector(`.zoom-rect`) instanceof SVGRectElement
  mid_drag?.()
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
      expect(await drag(svg, { x: 100, y: 100, button: 2 }, { x: 300, y: 200 })).toBe(false)

      // Only the start is gated: leaving the plot after an interior start still zooms.
      expect(await drag(svg, { x: 100, y: 100 }, { x: 300, y: 290 })).toBe(true)
    },
  )

  // A mouseup delivered outside the window never reaches the pan's own handler. That used to
  // leave the plot panning on bare mouse moves; now that consumers gate animation and hover
  // on `is_panning`, a wedged pan would also freeze both for the rest of the plot's life.
  test(`a move without the button held ends a pan that lost its mouseup`, async () => {
    const root = await mount_sized(ScatterPlot, { series: xy_series() }, { selector: `.scatter` })
    const svg = root.querySelector<SVGSVGElement>(`svg[role="application"]`)
    if (!svg) throw new Error(`plot SVG not found`)
    const bounds = svg.getBoundingClientRect()
    const at = (x: number, buttons: number): MouseEventInit => ({
      button: 0,
      buttons,
      clientX: bounds.left + x,
      clientY: bounds.top + 120,
      shiftKey: true,
    })

    svg.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, ...at(200, 1) }))
    window.dispatchEvent(new MouseEvent(`mousemove`, at(150, 1)))
    await tick()
    const during = svg.getAttribute(`style`) ?? ``

    window.dispatchEvent(new MouseEvent(`mousemove`, at(100, 0))) // button released off-window
    await tick()
    // the pan is over, so a later bare move must not keep panning the plot
    const after_release = svg.querySelectorAll(`path.marker`)[0]?.parentElement?.getAttribute(
      `transform`,
    )
    window.dispatchEvent(new MouseEvent(`mousemove`, at(20, 0)))
    await tick()
    expect(
      svg.querySelectorAll(`path.marker`)[0]?.parentElement?.getAttribute(`transform`),
    ).toBe(after_release)
    expect(document.body.style.cursor).toBe(``) // and the grabbing cursor is released
    expect(during).toBeDefined()
  })

  // A pan retargets every marker on each pointer frame. Animating that leaves the markers
  // trailing the axes while hover hit-testing already uses the live scales, so the point you
  // click isn't the one under the cursor. Only `performance` is faked, to step past the
  // mount settle window during which every tween snaps anyway.
  test(`shift-drag pan moves markers with the cursor rather than animating behind it`, async () => {
    vi.useFakeTimers({ toFake: [`performance`] })
    try {
      const root = await mount_sized(
        ScatterPlot,
        {
          series: xy_series(),
          point_tween: { duration: 60_000 },
          // Padding keeps all three points on screen across the pan; a culled point would
          // shift which markers the query returns and mask the comparison below.
          x_axis: { range: [-2, 4] as [number, number] },
        },
        { selector: `.scatter` },
      )
      const svg = root.querySelector<SVGSVGElement>(`svg[role="application"]`)
      if (!svg) throw new Error(`plot SVG not found`)
      const marker_xs = () =>
        [...svg.querySelectorAll(`path.marker`)].map((marker) =>
          Number(
            /translate\((?<x>[-\d.]+)/.exec(
              marker.parentElement?.getAttribute(`transform`) ?? ``,
            )?.groups?.x,
          ),
        )
      vi.advanceTimersByTime(SETTLE_MS + 1)

      const before = marker_xs()
      expect(before).toHaveLength(3)
      let during: number[] = []
      await drag(
        svg,
        { x: 200, y: 120 },
        { x: 100, y: 120 },
        {
          shift: true,
          mid_drag: () => (during = marker_xs()),
        },
      )

      // Every marker is a full 100 px left within the drag frame. Animated, they would all
      // still be sitting within a pixel of where they started, so the 1e-9 tolerance (the
      // scales differ by an ulp either side of the pan) is far tighter than it needs to be.
      expect(during).toHaveLength(before.length)
      for (const [idx, x] of during.entries()) expect(x).toBeCloseTo(before[idx] - 100, 9)
    } finally {
      vi.useRealTimers()
    }
  })
})
