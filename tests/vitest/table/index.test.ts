import type { CellVal, OnSortCallback, RowData } from '$lib/table'
import { calc_cell_color, strip_html } from '$lib/table'
import type * as d3sc from 'd3-scale-chromatic'
import { describe, expect, it } from 'vitest'

type ColorScale = keyof typeof d3sc | null

describe(`calc_cell_color`, () => {
  // Tests for cases that should return null colors
  it.each<{
    name: string
    val: number | null | undefined
    all_values: CellVal[]
    color_scale: ColorScale
    scale_type?: `linear` | `log`
  }>([
    {
      name: `null value`,
      val: null,
      all_values: [1, 2, 3],
      color_scale: `interpolateViridis`,
    },
    {
      name: `undefined value`,
      val: undefined,
      all_values: [1, 2, 3],
      color_scale: `interpolateViridis`,
    },
    {
      name: `NaN value`,
      val: NaN,
      all_values: [1, 50, 100],
      color_scale: `interpolateViridis`,
    },
    {
      name: `null color_scale`,
      val: 5,
      all_values: [1, 5, 10],
      color_scale: null,
    },
    {
      name: `empty all_values`,
      val: 5,
      all_values: [] as number[],
      color_scale: `interpolateViridis`,
    },
    {
      name: `only non-numeric all_values`,
      val: 50,
      all_values: [null, `a`, undefined],
      color_scale: `interpolateViridis`,
    },
    {
      name: `all NaN all_values`,
      val: NaN,
      all_values: [NaN, NaN],
      color_scale: `interpolateViridis`,
    },
    {
      name: `zero with log scale`,
      val: 0,
      all_values: [0, 50, 100],
      color_scale: `interpolateViridis`,
      scale_type: `log`,
    },
    {
      name: `negative with log scale`,
      val: -5,
      all_values: [-5, 50, 100],
      color_scale: `interpolateViridis`,
      scale_type: `log`,
    },
  ])(`returns null colors for $name`, ({ val, all_values, color_scale, scale_type }) => {
    const result = calc_cell_color(val, [...all_values], `higher`, color_scale, scale_type)
    expect(result).toEqual({ bg: null, text: null })
  })

  // Tests for cases that should return valid colors
  it.each([
    {
      name: `higher-is-better`,
      val: 10,
      all_values: [1, 5, 10],
      better: `higher` as const,
    },
    { name: `lower-is-better`, val: 1, all_values: [1, 5, 10], better: `lower` as const },
    { name: `undefined better`, val: 50, all_values: [1, 50, 100], better: undefined },
    {
      name: `zero with linear scale`,
      val: 0,
      all_values: [0, 50, 100],
      better: `higher` as const,
    },
    {
      name: `negative with linear scale`,
      val: -50,
      all_values: [-100, 0, 100],
      better: `higher` as const,
    },
    {
      name: `log scale positive values`,
      val: 100,
      all_values: [10, 100, 1000],
      better: `higher` as const,
      scale_type: `log` as const,
    },
    {
      name: `mixed types in all_values`,
      val: 50,
      all_values: [null, `text`, 10, 50, 100, undefined, true, { obj: 1 }],
      better: `higher` as const,
    },
    {
      name: `single numeric value`,
      val: 42,
      all_values: [42],
      better: `higher` as const,
    },
    {
      name: `NaN filtered from all_values`,
      val: 50,
      all_values: [1, NaN, 100],
      better: `higher` as const,
    },
  ])(`returns valid colors for $name`, ({ val, all_values, better, scale_type }) => {
    const result = calc_cell_color(
      val,
      [...all_values],
      better,
      `interpolateViridis`,
      scale_type,
    )
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`returns appropriate contrast text colors`, () => {
    const values = [1, 50, 100]
    expect(calc_cell_color(1, values, `higher`, `interpolateViridis`).text).toBe(`white`)
    expect(calc_cell_color(100, values, `higher`, `interpolateViridis`).text).toBe(`black`)
  })

  it(`uses different colors for min vs max values`, () => {
    const values = [1, 50, 100]
    expect(calc_cell_color(1, values, `higher`).bg).not.toEqual(
      calc_cell_color(100, values, `higher`).bg,
    )
  })

  it.each([
    `interpolateViridis`,
    `interpolatePlasma`,
    `interpolateInferno`,
    `interpolateCividis`,
    `interpolateTurbo`,
    `interpolateBlues`,
    `interpolateGreens`,
    `interpolateReds`,
    `interpolateYlOrRd`,
  ] as const)(`produces valid colors with %s scale`, (scale) => {
    const result = calc_cell_color(50, [1, 50, 100], `higher`, scale)
    expect(result.bg).toMatch(/^(rgb|#)/)
    expect(result.text).toMatch(/^(black|white)$/)
  })

  it.each([
    `interpolateViridis`,
    `interpolatePlasma`,
    `interpolateInferno`,
    `interpolateTurbo`,
  ] as const)(`reverses gradient direction consistently with %s`, (scale) => {
    const values = [1, 50, 100]
    expect(calc_cell_color(1, values, `higher`, scale).bg).toBe(
      calc_cell_color(100, values, `lower`, scale).bg,
    )
    expect(calc_cell_color(100, values, `higher`, scale).bg).toBe(
      calc_cell_color(1, values, `lower`, scale).bg,
    )
  })

  it(`falls back to viridis for invalid color scale name`, () => {
    const result = calc_cell_color(
      50,
      [1, 50, 100],
      `higher`,
      `interpolateNonExistent` as Parameters<typeof calc_cell_color>[3],
    )
    const viridis = calc_cell_color(50, [1, 50, 100], `higher`, `interpolateViridis`)
    expect(result.bg).toBe(viridis.bg)
  })
})

describe(`strip_html`, () => {
  it.each([
    [`<span>hello</span>`, `hello`],
    [`<div><span>nested</span></div>`, `nested`],
    [`<a href="https://example.com" class="link">link text</a>`, `link text`],
    [`<span data-sort-value="100">formatted</span>`, `formatted`],
    [`plain text`, `plain text`],
    [``, ``],
    [`before<br/>after`, `beforeafter`],
    [`<b>bold</b> and <i>italic</i>`, `bold and italic`],
  ])(`strip_html(%j) = %j`, (input, expected) => {
    expect(strip_html(input)).toBe(expected)
  })
})

describe(`OnSortCallback type`, () => {
  it(`type is correctly exported and usable`, async () => {
    // Verifies the type export works - runtime check is minimal since types are compile-time
    const mock_onsort: OnSortCallback = () =>
      Promise.resolve([{ id: 1 }, { id: 2 }] satisfies RowData[])

    const result = await mock_onsort(`column`, `asc`)
    expect(result).toHaveLength(2)
  })
})
