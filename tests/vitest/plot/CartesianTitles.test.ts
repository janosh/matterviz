import { BarPlot, BoxPlot, Histogram, ScatterPlot } from '$lib'
import { place_outside_decorations } from '$lib/plot/core/decorations'
import { calc_auto_padding, DEFAULT_PLOT_PADDING } from '$lib/plot/core/layout'
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
const xy_props = () => ({ series: xy_series() })
const y_series = () => [{ y: [1, 2, 3] }]
const histogram_series = () => [{ x: [], y: [1, 2, 3] }]
const shared_props = {
  title,
  padding: { t: 17 },
  x2_axis: { label: `Upper axis`, tick_values: [0, 1, 2], tick_positions: [0, 50, 100] },
}
const hidden_axis_props = {
  x2_axis: { label: `Unused top` },
  y2_axis: { label: `Unused right` },
}
const plot_cases = [
  [`BarPlot`, BarPlot, xy_props, `.bar-plot`],
  [`BoxPlot`, BoxPlot, () => ({ series: y_series() }), `.box-plot`],
  [`Histogram`, Histogram, () => ({ series: histogram_series() }), `.histogram`],
  [`ScatterPlot`, ScatterPlot, xy_props, `.scatter`],
  [`BinnedScatterPlot`, BinnedScatterPlot, xy_props, `.binned-scatter`],
] as const
const hidden_axis_cases = plot_cases.slice(0, -1)

afterEach(() => vi.restoreAllMocks())

describe(`Cartesian plot titles`, () => {
  test.each(plot_cases)(
    `%s renders a measured title block before its plot area`,
    async (_, component, get_props, selector) => {
      const root = await mount_sized(
        component,
        { ...shared_props, ...get_props() },
        { selector },
      )
      const title_text = root.querySelector(`.plot-title-text`)
      const subtitle_text = root.querySelector(`.plot-subtitle-text`)
      const clip_rect = title_text?.closest(`svg`)?.querySelector(`clipPath rect`)

      expect(title_text?.getAttribute(`aria-label`)).toBe(title.text)
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

  test.each(hidden_axis_cases)(
    `%s does not reserve padding for hidden secondary axes`,
    async (_, component, get_props, selector) => {
      const root = await mount_sized(
        component,
        { ...hidden_axis_props, ...get_props() },
        { selector },
      )
      const clip_rect = root.querySelector(`clipPath rect`)
      const clip_x = Number(clip_rect?.getAttribute(`x`))
      expect(root.querySelector(`.x2-axis, .y2-axis`)).toBeNull()
      // every Cartesian plot falls back to the shared DEFAULT_PLOT_PADDING on a side
      // whose axis is hidden, so assert the constants rather than their current values
      expect(Number(clip_rect?.getAttribute(`y`))).toBe(DEFAULT_PLOT_PADDING.t)
      expect(400 - clip_x - Number(clip_rect?.getAttribute(`width`))).toBe(
        DEFAULT_PLOT_PADDING.r,
      )
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
      x2_axis: { label: `Upper axis`, tick_values: [0, 1, 2], tick_positions: [0, 50, 100] },
    })
    const title_layout = resolve_plot_title(title, {
      width: width - axis_pad.l - axis_pad.r,
      x: axis_pad.l,
      y: 0,
    })
    const base_pad = { ...axis_pad, t: axis_pad.t + title_layout.block_height }
    const decorated = place_outside_decorations({
      base_pad,
      width,
      height,
      obstacles_norm: [{ x: 0.5, y: 0.5 }],
      items: [
        {
          id: `colorbar`,
          kind: `colorbar`,
          footprint: { width, height: 32 },
          horizontal: true,
        },
      ],
    })

    expect(axis_pad.t).toBeGreaterThan(0)
    expect(base_pad.t - axis_pad.t).toBe(title_layout.block_height)
    expect(decorated.colorbar_outside).toBe(true)
    expect(decorated.pad.t - base_pad.t).toBe(40)
  })

  test(`wrapped horizontal and vertical axis titles preserve sub/sup markup`, async () => {
    mock_text_measurement(7)
    const root = await mount_sized(
      ScatterPlot,
      {
        series: xy_series(),
        x_axis: { label: `Long formation E<sub>hull</sub> relative energy scale` },
        y_axis: { label: `Long squared x<sup>2</sup> response property scale` },
        show_controls: false,
        fullscreen_toggle: false,
        legend: null,
        point_tween: { duration: 0 },
      },
      { selector: `.scatter`, width: 320, height: 260 },
    )
    const x_label = root.querySelector(`.axis-label.x-label`)
    const y_label = root.querySelector(`.axis-label.y-label`)

    const line_count = (label: Element | null) =>
      [...(label?.children ?? [])].filter((child) => child.tagName.toLowerCase() === `tspan`)
        .length
    expect(line_count(x_label)).toBeGreaterThan(1)
    expect(x_label?.querySelector(`tspan[baseline-shift="sub"]`)?.textContent?.trim()).toBe(
      `hull`,
    )
    expect(line_count(y_label)).toBeGreaterThan(1)
    expect(y_label?.querySelector(`tspan[baseline-shift="super"]`)?.textContent?.trim()).toBe(
      `2`,
    )
  })
})
