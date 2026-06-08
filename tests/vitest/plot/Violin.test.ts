import { Violin } from '$lib'
import type { BoxPlotSeries } from '$lib/plot'
import { type ComponentProps, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { resize_element } from '../setup'

const dist = (count: number, center = 0, spread = 1): number[] =>
  Array.from(
    { length: count },
    (_, idx) => center + spread * Math.sin(idx * 1.7) + (idx % 5) * 0.1,
  )

// Extract alternating x,y pixel coords from a violin path ("Mx,yLx,y...Z")
const path_coords = (path_d: string): { xs: number[]; ys: number[] } => {
  const nums = (path_d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number)
  return {
    xs: nums.filter((_, idx) => idx % 2 === 0),
    ys: nums.filter((_, idx) => idx % 2 === 1),
  }
}

async function mount_violin(
  props: Partial<ComponentProps<typeof Violin>>,
): Promise<HTMLElement> {
  const target = document.createElement(`div`)
  document.body.append(target)
  mount(Violin, {
    target,
    props: { ...props, style: `width: 400px; height: 300px; ${props.style ?? ``}` },
  })
  const plot = target.querySelector<HTMLElement>(`.box-plot`)
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

  test(`log value axis clamps KDE grid to positive support (finite path, no range pollution)`, async () => {
    const plot = await mount_violin({
      series: [{ y: [0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 15], label: `A` }],
      y_axis: { scale_type: `log` },
    })
    const path = plot.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``
    // unclamped, the KDE grid tail (≈ -4.5) mapped to NaN pixels (invisible violin)
    expect(path.length).toBeGreaterThan(0)
    expect(path).not.toContain(`NaN`)
    const { ys } = path_coords(path)
    // a LOG_EPS-polluted auto-range (~10 decades) squashed the violin to span ≈ 35px
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(100)
  })

  // side=positive must hug "above the center line" (horizontal, smaller screen y) /
  // "right of it" (vertical, larger screen x) — the horizontal category pixel axis
  // is inverted, so the rendered side flips
  test.each([
    [`horizontal`, -1],
    [`vertical`, 1],
  ] as const)(
    `side=positive draws the violin hump on the positive side (%s)`,
    async (orientation, sign) => {
      const plot = await mount_violin({
        series: [{ y: dist(80, 5, 1), label: `A` }],
        orientation,
        side: `positive`,
        kind: `violin+box`,
      })
      // whisker segments run along the value axis at the category center
      const [c1, c2] = orientation === `horizontal` ? [`y1`, `y2`] : [`x1`, `x2`]
      const whisker = [...plot.querySelectorAll(`.box-series line`)].find(
        (ln) => ln.getAttribute(c1) === ln.getAttribute(c2),
      )
      const center = Number(whisker?.getAttribute(c1))
      expect(Number.isFinite(center)).toBe(true)
      const { xs, ys } = path_coords(
        plot.querySelector(`.violin-area`)?.getAttribute(`d`) ?? ``,
      )
      // signed offsets from the center line: hump on the positive side, inner edge on it
      const deltas = (orientation === `horizontal` ? ys : xs).map((px) => (px - center) * sign)
      expect(Math.max(...deltas)).toBeGreaterThan(5)
      expect(Math.min(...deltas)).toBeGreaterThanOrEqual(-1)
    },
  )
})
