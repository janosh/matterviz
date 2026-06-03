import { Violin } from '$lib'
import type { BoxPlotSeries } from '$lib/plot'
import { type ComponentProps, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { resize_element } from '../setup'

const dist = (n: number, center = 0, spread = 1): number[] =>
  Array.from(
    { length: n },
    (_, idx) => center + spread * Math.sin(idx * 1.7) + (idx % 5) * 0.1,
  )

async function mount_violin(
  props: Partial<ComponentProps<typeof Violin>>,
): Promise<HTMLElement> {
  mount(Violin, {
    target: document.body,
    props: { ...props, style: `width: 400px; height: 300px; ${props.style ?? ``}` },
  })
  const plot = document.querySelector<HTMLElement>(`.box-plot`)
  if (!plot) throw new Error(`Violin root element not found`)
  await resize_element(plot, 400, 300)
  return plot
}

describe(`Violin`, () => {
  const series: BoxPlotSeries[] = [
    { y: dist(80, 0, 1), label: `A`, color: `#4e79a7` },
    { y: dist(80, 1, 1.4), label: `B`, color: `#e15759` },
  ]

  test(`defaults to violin glyphs (no boxes)`, async () => {
    const plot = await mount_violin({ series })
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(2)
    expect(plot.querySelectorAll(`.box-series rect.iqr-box`)).toHaveLength(0)
  })

  test(`forwards kind override to draw inner boxes`, async () => {
    const plot = await mount_violin({ series, kind: `violin+box` })
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(2)
    expect(plot.querySelectorAll(`.box-series rect.iqr-box`)).toHaveLength(2)
  })

  test(`forwards orientation and axis props`, async () => {
    const plot = await mount_violin({
      series,
      orientation: `horizontal`,
      x_axis: { label: `Value` },
    })
    expect(plot.querySelectorAll(`.violin-area`)).toHaveLength(2)
    expect(plot.querySelector(`.x-label`)?.textContent).toBe(`Value`)
  })
})
