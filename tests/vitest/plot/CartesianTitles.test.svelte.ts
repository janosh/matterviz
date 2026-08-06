import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib'
import { place_decorations } from '$lib/plot/core/auto-place'
import { calc_auto_padding } from '$lib/plot/core/layout'
import { resolve_plot_title } from '$lib/plot/core/plot-title'
import BinnedScatterPlot from '$lib/plot/scatter/BinnedScatterPlot.svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mock_text_measurement, mount_sized } from '../setup'

const title = {
  text: `Measured plot title`,
  subtitle: `Measured subtitle`,
  align: `start`,
} as const
const xy_series = () => [{ x: [0, 1, 2], y: [1, 2, 3] }]
const y_series = () => [{ y: [1, 2, 3] }]
const histogram_series = () => [{ x: [], y: [1, 2, 3] }]
const shared_props = {
  title,
  padding: { t: 17 },
  x2_axis: { label: `Upper axis`, tick_values: [0, 1, 2] },
}
const plot_cases = [
  [
    `BarPlot`,
    () =>
      mount_sized(
        BarPlot,
        { ...shared_props, series: xy_series() },
        { selector: `.bar-plot` },
      ),
  ],
  [
    `BoxPlot`,
    () =>
      mount_sized(BoxPlot, { ...shared_props, series: y_series() }, { selector: `.box-plot` }),
  ],
  [
    `Histogram`,
    () =>
      mount_sized(
        Histogram,
        { ...shared_props, series: histogram_series() },
        { selector: `.histogram` },
      ),
  ],
  [
    `ScatterPlot`,
    () =>
      mount_sized(
        ScatterPlot,
        { ...shared_props, series: xy_series() },
        { selector: `.scatter` },
      ),
  ],
  [
    `BinnedScatterPlot`,
    () =>
      mount_sized(
        BinnedScatterPlot,
        { ...shared_props, series: xy_series() },
        { selector: `.binned-scatter` },
      ),
  ],
] satisfies [string, () => Promise<HTMLElement>][]

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe(`Cartesian plot titles`, () => {
  test.each(plot_cases)(
    `%s renders a measured title block before its plot area`,
    async (_, mount) => {
      const root = await mount()
      const title_text = root.querySelector(`.plot-title-text`)
      const subtitle_text = root.querySelector(`.plot-subtitle-text`)
      const clip_rect = title_text?.closest(`svg`)?.querySelector(`clipPath rect`)

      expect(title_text?.getAttribute(`aria-label`)).toBe(title.text)
      expect(title_text?.getAttribute(`text-anchor`)).toBe(`start`)
      expect(subtitle_text?.getAttribute(`aria-label`)).toBe(title.subtitle)
      expect(Number(title_text?.querySelector(`tspan`)?.getAttribute(`x`))).toBe(
        Number(clip_rect?.getAttribute(`x`)),
      )
      expect(
        Number(subtitle_text?.querySelector(`tspan:last-child`)?.getAttribute(`y`)),
      ).toBeLessThan(Number(clip_rect?.getAttribute(`y`)))
      expect(Number(clip_rect?.getAttribute(`y`))).toBeGreaterThan(17)
    },
  )

  test(`title, upper-axis ticks, and an outside decoration reserve independent top bands`, () => {
    mock_text_measurement()
    const width = 400
    const height = 300
    const axis_pad = calc_auto_padding({
      width,
      padding: {},
      default_padding: { t: 0, r: 0, b: 0, l: 0 },
      x2_axis: { label: `Upper axis`, tick_values: [0, 1, 2] },
    })
    const title_layout = resolve_plot_title(title, {
      width: width - axis_pad.l - axis_pad.r,
      x: axis_pad.l,
      y: 0,
    })
    const base_pad = { ...axis_pad, t: axis_pad.t + title_layout.block_height }
    const decorated = place_decorations({
      base_pad,
      width,
      height,
      obstacles_norm: [{ x: 0.5, y: 0.5 }],
      colorbar: { footprint: { width, height: 32 }, horizontal: true },
    })

    expect(axis_pad.t).toBeGreaterThan(0)
    expect(base_pad.t - axis_pad.t).toBe(title_layout.block_height)
    expect(decorated.colorbar_outside).toBe(true)
    expect(decorated.pad.t - base_pad.t).toBe(40)
  })
})
