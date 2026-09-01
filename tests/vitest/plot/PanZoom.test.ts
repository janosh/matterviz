import { SETTLE_MS } from '$lib/plot/core/settling-tween.svelte'
import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib'
import { tick, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { mount_sized, plot_svg, translate_of } from '../setup'

type LocalPoint = { x: number; y: number; button?: number }

const xy_series = () => [{ x: [0, 1, 2], y: [1, 2, 3] }]
const y_series = () => [{ y: [1, 2, 3] }]
const histogram_series = () => [{ values: [1, 2, 3] }]
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

type DragOptions = { shift?: boolean; alt?: boolean; mid_drag?: () => void }

async function drag(
  svg: SVGSVGElement,
  start: LocalPoint,
  end: LocalPoint,
  { shift = false, alt = false, mid_drag }: DragOptions = {},
): Promise<boolean> {
  const bounds = svg.getBoundingClientRect()
  const event_init = ({ x, y, button = 0 }: LocalPoint): MouseEventInit => ({
    button,
    buttons: 1, // a real drag holds the primary button down; the pan gives up when it isn't
    clientX: bounds.left + x,
    clientY: bounds.top + y,
    shiftKey: shift,
    altKey: alt,
  })
  svg.dispatchEvent(new MouseEvent(`mousedown`, { bubbles: true, ...event_init(start) }))
  window.dispatchEvent(new MouseEvent(`mousemove`, event_init(end)))
  await tick()
  const active = svg.querySelector(`.zoom-rect`) instanceof SVGRectElement
  mid_drag?.()
  window.dispatchEvent(new MouseEvent(`mouseup`, { ...event_init(end), buttons: 0 }))
  await tick()
  return active
}

const marker_xs = (svg: SVGSVGElement): number[] =>
  [...svg.querySelectorAll(`path.marker`)].map(
    (marker) => translate_of(marker.parentElement).x,
  )

const mount_scatter = async (props: Partial<ComponentProps<typeof ScatterPlot>> = {}) =>
  plot_svg(
    await mount_sized(
      ScatterPlot,
      { series: xy_series(), ...props },
      { selector: `.scatter` },
    ),
  )
// Keep every point on screen so culling cannot masquerade as marker motion.
const slow_tween_props = {
  point_tween: { duration: 60_000 },
  x_axis: { range: [-2, 4] as [number, number] },
}

describe(`alt+drag rect selection`, () => {
  test(`selects the points inside the rect and leaves the axis range alone`, async () => {
    const on_select = vi.fn()
    const x_range: [number, number] = [-2, 4]
    const svg = await mount_scatter({ on_select, x_axis: { range: x_range } })
    const before = marker_xs(svg)

    await drag(svg, { x: 60, y: 40 }, { x: 380, y: 240 }, { alt: true })

    expect(on_select).toHaveBeenCalledOnce()
    const [{ points, rect }] = on_select.mock.calls[0]
    expect(points.length).toBeGreaterThan(0)
    expect(rect).toEqual({ x: [60, 380], y: [40, 240] })
    // Alt+drag must not also zoom - markers stay exactly where they were
    expect(marker_xs(svg)).toEqual(before)
  })

  // A host filtering a linked view needs to hear "nothing" as clearly as it hears a list
  test(`an empty rect still reports the selection`, async () => {
    const on_select = vi.fn()
    // Top-left corner of the plot area, above every point in the series
    const svg = await mount_scatter({ on_select, y_axis: { range: [0, 100] } })
    await drag(svg, { x: 60, y: 40 }, { x: 120, y: 70 }, { alt: true })
    expect(on_select).toHaveBeenCalledWith(expect.objectContaining({ points: [] }))
  })

  // Scatter always offers selection (selected_points is bindable with or without a
  // callback), so the rect's mode follows the modifier alone
  test(`alt+drag draws the select rect, plain drag the zoom rect`, async () => {
    const svg = await mount_scatter()
    const rect_class = async (alt: boolean) => {
      let seen = ``
      await drag(
        svg,
        { x: 60, y: 40 },
        { x: 300, y: 200 },
        {
          alt,
          mid_drag: () => {
            seen = svg.querySelector(`.zoom-rect`)?.getAttribute(`class`) ?? ``
          },
        },
      )
      return seen
    }
    expect(await rect_class(true)).toContain(`select`)
    expect(await rect_class(false)).not.toContain(`select`)
  })

  // A chart with no marks to enumerate implements no on_rect_select, and there the
  // gesture must stay a zoom rather than being swallowed
  test(`alt+drag stays a zoom on a chart that cannot select`, async () => {
    const svg = plot_svg(
      await mount_sized(BarPlot, { series: xy_series() }, { selector: `.bar-plot` }),
    )
    let seen = ``
    await drag(
      svg,
      { x: 60, y: 40 },
      { x: 300, y: 200 },
      {
        alt: true,
        mid_drag: () => {
          seen = svg.querySelector(`.zoom-rect`)?.getAttribute(`class`) ?? ``
        },
      },
    )
    expect(seen).toContain(`zoom-rect`)
    expect(seen).not.toContain(`select`)
  })
})

describe(`shared plot drag zoom bounds`, () => {
  test.each(plot_cases)(
    `%s rejects margin starts but allows the endpoint outside`,
    async (_name, mount_plot) => {
      const root = await mount_plot()
      const svg = plot_svg(root)

      // Default 400×300 plots end at y=240; y=290 is in the x-label margin.
      expect(await drag(svg, { x: 100, y: 290 }, { x: 300, y: 100 })).toBe(false)
      expect(await drag(svg, { x: 100, y: 100, button: 2 }, { x: 300, y: 200 })).toBe(false)

      // Only the start is gated: leaving the plot after an interior start still zooms.
      expect(await drag(svg, { x: 100, y: 100 }, { x: 300, y: 290 })).toBe(true)
    },
  )

  // Shift+wheel and two-finger drags pan too, and each notch retargets every marker. Only the
  // shift-drag used to report itself as a pan, so those two still animated behind the axes.
  test(`shift+wheel pan snaps markers instead of animating them`, async () => {
    vi.useFakeTimers({ toFake: [`performance`] })
    try {
      const svg = await mount_scatter(slow_tween_props)
      vi.advanceTimersByTime(SETTLE_MS + 1) // past the window where every change snaps anyway

      svg.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Shift` }))
      const before = marker_xs(svg)
      expect(before.length).toBeGreaterThan(0)
      // deltaX so the pan runs along the axis being measured; the wheel picks the dominant one
      svg.dispatchEvent(
        new WheelEvent(`wheel`, { deltaX: 40, bubbles: true, cancelable: true }),
      )
      await tick()

      // A wheel pan has no gesture end to snap until, so the notch itself has to land every
      // marker at its new position; animated, they would all still be sitting at `before`.
      const after = marker_xs(svg)
      expect(after).toHaveLength(before.length)
      const deltas = after.map((pos, idx) => pos - before[idx])
      expect(Math.abs(deltas[0])).toBeGreaterThan(1) // it panned, rather than sitting still
      for (const delta of deltas) expect(delta).toBeCloseTo(deltas[0], 6) // by one shared offset
      window.dispatchEvent(new KeyboardEvent(`keyup`, { key: `Shift` }))
    } finally {
      vi.useRealTimers()
    }
  })

  // Tabbing away eats the keyup, so a latched shift would leave the wheel silently panning
  // (and swallowing page scroll) while the cursor promises a pan mousedown won't deliver.
  test(`window blur clears a latched shift`, async () => {
    const svg = await mount_scatter()

    window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Shift` }))
    await tick()
    expect(svg.style.cursor).toBe(`grab`)

    window.dispatchEvent(new FocusEvent(`blur`))
    await tick()
    expect(svg.style.cursor).toBe(`crosshair`)
  })

  // A mouseup delivered outside the window never reaches the pan's own handler. That used to
  // leave the plot panning on bare mouse moves; now that consumers gate animation and hover
  // on `is_panning`, a wedged pan would also freeze both for the rest of the plot's life.
  test(`a move without the button held ends a pan that lost its mouseup`, async () => {
    const svg = await mount_scatter()
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

    window.dispatchEvent(new MouseEvent(`mousemove`, at(100, 0))) // button released off-window
    await tick()
    const after_release = marker_xs(svg)
    expect(document.body.style.cursor).toBe(``) // the grabbing cursor is released

    window.dispatchEvent(new MouseEvent(`mousemove`, at(20, 0)))
    await tick()
    expect(marker_xs(svg)).toEqual(after_release) // a later bare move no longer pans the plot
  })

  // A pan retargets every marker on each pointer frame. Animating that leaves the markers
  // trailing the axes while hover hit-testing already uses the live scales, so the point you
  // click isn't the one under the cursor. Only `performance` is faked, to step past the
  // mount settle window during which every tween snaps anyway.
  test(`shift-drag pan moves markers with the cursor rather than animating behind it`, async () => {
    vi.useFakeTimers({ toFake: [`performance`] })
    try {
      const svg = await mount_scatter(slow_tween_props)
      vi.advanceTimersByTime(SETTLE_MS + 1)

      const before = marker_xs(svg)
      expect(before).toHaveLength(3)
      let during: number[] = []
      await drag(
        svg,
        { x: 200, y: 120 },
        { x: 100, y: 120 },
        {
          shift: true,
          mid_drag: () => (during = marker_xs(svg)),
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
