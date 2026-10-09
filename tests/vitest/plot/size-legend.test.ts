import { create_size_scale } from '#lib/plot/core/scales.js'
import {
  size_legend_entries,
  size_legend_layout,
  type SizeLegendEntry,
} from '#lib/plot/core/size-legend.js'
import { DEFAULT_FONT_SPEC, measure_text_line } from '#lib/plot/core/text-metrics.js'
import type { ScaleType } from '#lib/plot/core/types.js'
import type { Vec2 } from '#lib/math.js'
import { describe, expect, test } from 'vitest'

const format_label = (value: number) => `${value}`
const font = { ...DEFAULT_FONT_SPEC, font_size: 11 }

describe(`size_legend_entries`, () => {
  test.each([
    // ticks(3) over [3, 97] are 20, 40, 60, 80: keep both ends
    [`linear`, [3, 97], [20, 60, 80]],
    // ticks(3) over [2, 120] are 0, 50, 100 with 0 out of domain: refine to step 20
    [`linear`, [2, 120], [20, 80, 120]],
    [`log`, [1, 1e6], [1, 1e4, 1e6]],
    // Decades, from the arcsinh scale's own ticks (linear ticks crowd 500k and 1M together)
    [`arcsinh`, [0, 1e3], [10, 100, 1000]],
    [`arcsinh`, [0, 1e6], [1e4, 1e5, 1e6]],
  ] satisfies [ScaleType, Vec2, number[]][])(
    `%s scale over %o picks %o at the chart's radii`,
    (type, range, expected) => {
      const scale = create_size_scale({ type, radius_range: [2, 10] }, range)
      const entries = size_legend_entries(scale, { count: 3 })
      expect(entries.map(({ value }) => value)).toEqual(expected)
      for (const { value, radius } of entries) expect(radius).toBe(scale(value))
    },
  )

  test(`explicit values: sorted, non-finite and invisible dropped, one per radius`, () => {
    // Clamped above 10 and below 0, so 10/50 share a radius; radius_range starts at 0 so the
    // domain minimum is invisible
    const scale = create_size_scale({ radius_range: [0, 8] }, [0, 10])
    const entries = size_legend_entries(scale, { values: [10, NaN, 5, 0, 50, 2.5] })
    expect(entries).toEqual([
      { value: 2.5, radius: 2 },
      { value: 5, radius: 4 },
      { value: 10, radius: 8 },
    ])
  })

  test.each([0, -1, 1.5])(`rejects count %f`, (count) => {
    const scale = create_size_scale({}, [0, 1])
    expect(() => size_legend_entries(scale, { count })).toThrow(RangeError)
  })
})

describe(`size_legend_layout`, () => {
  const entries: SizeLegendEntry[] = [
    { value: 1, radius: 2 },
    { value: 5, radius: 4 },
    { value: 10000, radius: 7 },
    { value: 100, radius: 10 },
  ]

  test(`bottom-aligned circles in non-overlapping columns, labels underneath`, () => {
    const geo = size_legend_layout(entries, { format_label, font })
    expect(geo.items).toHaveLength(4)
    const bottoms = new Set(geo.items.map(({ cy, radius }) => cy + radius))
    expect(bottoms.size).toBe(1)
    const [bottom] = bottoms
    expect(geo.label_y).toBeGreaterThan(bottom)
    expect(geo.height).toBeGreaterThan(geo.label_y)
    for (const [idx, item] of geo.items.entries()) {
      // Stroked edges (radius + 0.5) and label text stay inside the box and off the next column
      const half_width = Math.max(
        item.radius + 0.5,
        measure_text_line(item.text, font).width / 2,
      )
      expect(item.cx - half_width).toBeGreaterThanOrEqual(0)
      expect(item.cx + half_width).toBeLessThanOrEqual(geo.width)
      expect(item.cy - item.radius - 0.5).toBeGreaterThanOrEqual(0)
      const next = geo.items[idx + 1]
      if (!next) continue
      const next_half = Math.max(
        next.radius + 0.5,
        measure_text_line(next.text, font).width / 2,
      )
      expect(item.cx + half_width).toBeLessThan(next.cx - next_half)
    }
  })

  test(`a title adds a row and widens the box to its bold width`, () => {
    const title = `Number of atoms per cell`
    const plain = size_legend_layout(entries, { format_label, font })
    const titled = size_legend_layout(entries, { format_label, font, title })
    const bold_width = measure_text_line(title, { ...font, font_weight: `600` }).width
    expect(bold_width).toBeGreaterThan(plain.width)
    expect(titled.width).toBe(bold_width)
    expect(titled.height).toBe(plain.height + font.font_size + 4)
    expect(titled.items.every(({ cy, radius }) => cy - radius >= titled.title_y)).toBe(true)
  })

  test(`no entries draws nothing`, () => {
    expect(size_legend_layout([], { format_label, font })).toMatchObject({
      width: 0,
      height: 0,
      items: [],
    })
  })
})
