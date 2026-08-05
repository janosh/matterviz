import type { D3InterpolateName } from '$lib/colors'
import type { CellVal } from '$lib/table'
import {
  calc_cell_color,
  compute_column_stats,
  make_cell_color_scale,
  merge_domains,
  resolve_color_domain,
  strip_html,
} from '$lib/table'
import { describe, expect, it } from 'vitest'

describe(`column stats and color domains`, () => {
  const values = [...Array.from({ length: 20 }, (_v, idx) => idx * 5), 10_000]

  it(`summarizes a column in one pass, ignoring non-numeric entries`, () => {
    const stats = compute_column_stats([1, 2, 3, null, undefined, NaN], `higher`)
    expect(stats).toMatchObject({ min: 1, max: 3, mean: 2, median: 2, count: 3, best: 3 })
    expect(compute_column_stats([1, 2, 3], `lower`)?.best).toBe(1)
    expect(compute_column_stats([1, 2, 3])?.best).toBeNull()
    expect(compute_column_stats([null, undefined, NaN])).toBeNull()
  })

  // Pinned exactly: a loose "somewhere below the outlier" bound would pass for almost any
  // wrong quantile implementation. 21 values -> q05 index 1.0, q95 index 19.0.
  it(`clips a quantile domain inside the outlier-driven full range`, () => {
    const stats = compute_column_stats(values)
    if (!stats) throw new Error(`expected stats`)
    expect(resolve_color_domain(stats, `minmax`)).toEqual([0, 10_000])
    expect(resolve_color_domain(stats, `quantile`)).toEqual([5, 95])
    expect([stats.q_lo, stats.median, stats.q_hi]).toEqual([5, 50, 95])
  })

  it.each([
    [`a single value`, [7], { min: 7, max: 7, mean: 7, median: 7, q_lo: 7, q_hi: 7 }],
    [`all-equal values`, [3, 3, 3], { min: 3, max: 3, mean: 3, median: 3, q_lo: 3, q_hi: 3 }],
  ])(`handles %s without collapsing`, (_desc, input, expected) => {
    const stats = compute_column_stats(input)
    expect(stats).toMatchObject(expected)
    // a zero-width quantile range must fall back to min/max, not produce an empty domain
    if (stats)
      expect(resolve_color_domain(stats, `quantile`)).toEqual([expected.min, expected.max])
  })

  it(`treats non-finite values as uncolorable everywhere`, () => {
    expect(compute_column_stats([1, 2, Infinity, -Infinity])).toMatchObject({
      min: 1,
      max: 2,
      count: 2,
    })
    const scale = make_cell_color_scale([1, 2, Infinity], `higher`)
    expect(scale(Infinity).bg).toBeNull()
    expect(scale(2).bg).not.toBeNull()
  })

  it(`keeps log scaling when a supplied domain reaches zero`, () => {
    const log_scale = make_cell_color_scale(
      [1, 10, 100],
      `higher`,
      `interpolateViridis`,
      `log`,
      [0, 100],
    )
    const linear_scale = make_cell_color_scale(
      [1, 10, 100],
      `higher`,
      `interpolateViridis`,
      `linear`,
      [0, 100],
    )
    expect(log_scale(10).bg).not.toBe(linear_scale(10).bg)
    expect(log_scale(10).bg).toBe(
      make_cell_color_scale([1, 100], `higher`, `interpolateViridis`, `log`)(10).bg,
    )
  })

  it(`falls back to min/max when quantiles are not requested`, () => {
    const stats = compute_column_stats(values, undefined, false)
    expect(stats).toMatchObject({ q_lo: 0, q_hi: 10_000, median: null, min: 0, max: 10_000 })
  })

  it.each([
    [
      [-2, -1, 5],
      [-5, 5],
    ],
    [
      [-8, 1, 2],
      [-8, 8],
    ],
    [
      [1, 2, 3],
      [-3, 3],
    ],
  ])(`centers a diverging domain on zero for %s`, (input, expected) => {
    const stats = compute_column_stats(input)
    if (!stats) throw new Error(`expected stats`)
    expect(resolve_color_domain(stats, `diverging`)).toEqual(expected)
  })

  it(`merges a shared-domain group to its widest extent`, () => {
    expect(
      merge_domains([
        [0, 5],
        [-2, 3],
        [1, 9],
      ]),
    ).toEqual([-2, 9])
    expect(merge_domains([])).toBeNull()
  })

  it(`clamps values outside a supplied domain`, () => {
    const scale = make_cell_color_scale(
      [0, 10, 10_000],
      `higher`,
      `interpolateViridis`,
      `linear`,
      [0, 10],
    )
    expect(scale(10_000).bg).toBe(scale(10).bg)
    expect(scale(5).bg).not.toBe(scale(10).bg)
  })
})

describe(`calc_cell_color`, () => {
  it.each<{
    name: string
    val: number | null | undefined
    all_values: CellVal[]
    color_scale: D3InterpolateName | null
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
      all_values: [],
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
      val: 50,
      all_values: [NaN, NaN],
      color_scale: `interpolateViridis`,
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
      name: `all-zero log scale`,
      val: 0,
      all_values: [0, 0],
      better: `higher` as const,
      scale_type: `log` as const,
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

  it(`uses distinct endpoint colors and reverses the gradient for lower values`, () => {
    const values = [1, 50, 100]
    const low_higher = calc_cell_color(1, values, `higher`).bg
    const high_higher = calc_cell_color(100, values, `higher`).bg
    expect(low_higher).not.toBe(high_higher)
    expect(low_higher).toBe(calc_cell_color(100, values, `lower`).bg)
    expect(high_higher).toBe(calc_cell_color(1, values, `lower`).bg)
  })

  it(`maps log-scale zero to the lowest positive endpoint color`, () => {
    const values = [0, 10, 100]
    for (const better of [`higher`, `lower`] as const) {
      expect(calc_cell_color(0, values, better, undefined, `log`).bg).toBe(
        calc_cell_color(10, values, better, undefined, `log`).bg,
      )
    }
  })

  it(`falls back to viridis for invalid color scale name`, () => {
    const invalid_scale = `interpolateNonExistent` as D3InterpolateName
    expect(calc_cell_color(50, [1, 50, 100], `higher`, invalid_scale)).toEqual(
      calc_cell_color(50, [1, 50, 100], `higher`, `interpolateViridis`),
    )
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
