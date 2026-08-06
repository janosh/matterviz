import PlotTitle from '$lib/plot/core/components/PlotTitle.svelte'
import type { PlotTitleConfig } from '$lib/plot/core/plot-title'
import { clear_text_metrics_cache } from '$lib/plot/core/text-metrics'
import type { ComponentProps } from 'svelte'
import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mock_text_measurement } from '../setup'

const mount_title = (
  config: PlotTitleConfig | null | undefined,
  props: Partial<ComponentProps<typeof PlotTitle>> = {},
) => {
  const svg = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`)
  document.body.append(svg)
  const component = mount(PlotTitle, {
    target: svg,
    props: { config, width: 100, ...props },
  })
  return { component, svg }
}

beforeEach(() => {
  clear_text_metrics_cache()
  mock_text_measurement(5)
})

afterEach(() => {
  vi.restoreAllMocks()
  clear_text_metrics_cache()
  document.body.replaceChildren()
})

describe(`PlotTitle`, () => {
  test(`renders wrapped title and subtitle as export-friendly SVG text`, async () => {
    const { component, svg } = mount_title(
      {
        text: `alpha beta gamma`,
        subtitle: `details here`,
        gap: 7,
        font: { font_size: 10, line_height: 12, font_weight: `700` },
        subtitle_font: { font_size: 8, line_height: 10, font_style: `italic` },
      },
      { width: 50, x: 10, y: 5 },
    )

    const title = svg.querySelector(`text.plot-title-text`)
    const subtitle = svg.querySelector(`text.plot-subtitle-text`)
    expect(title?.querySelectorAll(`tspan`)).toHaveLength(2)
    expect(
      [...(title?.querySelectorAll(`tspan`) ?? [])].map((line) => line.textContent),
    ).toEqual([`alpha beta`, `gamma`])
    expect(subtitle?.querySelectorAll(`tspan`)).toHaveLength(2)
    expect(title?.getAttribute(`font-size`)).toBe(`10`)
    expect(title?.getAttribute(`font-weight`)).toBe(`700`)
    expect(subtitle?.getAttribute(`font-style`)).toBe(`italic`)
    expect(svg.querySelector(`foreignObject`)).toBeNull()
    expect(Number(subtitle?.querySelector(`tspan`)?.getAttribute(`y`))).toBeGreaterThan(
      Number(title?.querySelectorAll(`tspan`)[1]?.getAttribute(`y`)),
    )
    await unmount(component)
  })

  test(`keeps full title and subtitle labels accessible after visual truncation`, async () => {
    const full_title = `A long measured title`
    const full_subtitle = `A descriptive subtitle`
    const { component, svg } = mount_title(
      {
        text: full_title,
        subtitle: full_subtitle,
        max_lines: 1,
        font: { font_size: 10, line_height: 12 },
        subtitle_font: { font_size: 9, line_height: 11 },
      },
      { width: 45 },
    )

    const title = svg.querySelector(`text.plot-title-text`)
    const subtitle = svg.querySelector(`text.plot-subtitle-text`)
    expect(title?.getAttribute(`role`)).toBe(`heading`)
    expect(title?.getAttribute(`aria-level`)).toBe(`2`)
    expect(title?.getAttribute(`aria-label`)).toBe(full_title)
    expect(subtitle?.getAttribute(`role`)).toBe(`note`)
    expect(subtitle?.getAttribute(`aria-label`)).toBe(full_subtitle)
    expect(title?.textContent?.endsWith(`…`)).toBe(true)
    expect(subtitle?.textContent?.endsWith(`…`)).toBe(true)
    expect(
      [...svg.querySelectorAll(`tspan`)].every(
        (line) => line.getAttribute(`aria-hidden`) === `true`,
      ),
    ).toBe(true)
    await unmount(component)
  })

  test.each([
    { align: `start`, expected_x: `10` },
    { align: `middle`, expected_x: `60` },
    { align: `end`, expected_x: `110` },
  ] as const)(`renders align=$align at x=$expected_x`, async ({ align, expected_x }) => {
    const { component, svg } = mount_title({ text: `Aligned`, align }, { x: 10, width: 100 })
    const title = svg.querySelector(`text.plot-title-text`)
    const line = title?.querySelector(`tspan`)

    expect(title?.getAttribute(`text-anchor`)).toBe(align)
    expect(title?.getAttribute(`x`)).toBe(expected_x)
    expect(line?.getAttribute(`x`)).toBe(expected_x)
    await unmount(component)
  })

  test.each([
    { label: `undefined`, config: undefined },
    { label: `null`, config: null },
    { label: `empty`, config: {} },
  ])(`renders no SVG nodes for $label config`, async ({ config }) => {
    const { component, svg } = mount_title(config)
    expect(svg.childElementCount).toBe(0)
    await unmount(component)
  })
})
