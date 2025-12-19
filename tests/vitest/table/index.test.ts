import type {
  CellSnippetArgs,
  CellVal,
  Label,
  MultiSortState,
  RowData,
  SortState,
} from '$lib/table/utils'
import { calc_cell_color, strip_html } from '$lib/table/utils'
import { describe, expect, it } from 'vitest'

describe(`table module exports`, () => {
  it(`exports calc_cell_color function`, () => {
    expect(calc_cell_color).toBeDefined()
    expect(typeof calc_cell_color).toBe(`function`)
  })

  it(`exports strip_html function`, () => {
    expect(strip_html).toBeDefined()
    expect(typeof strip_html).toBe(`function`)
  })

  it(`exports type definitions`, () => {
    // Type-level checks - these are compile-time only
    const cell_val: CellVal = `test`
    const row_data: RowData = { value: 1 }
    const label: Label = { label: `Test` }
    const cell_args: CellSnippetArgs = { row: row_data, col: label, val: cell_val }
    const sort_state: SortState = { column: `test`, ascending: true }
    const multi_sort: MultiSortState = [{ column: `a`, ascending: true }, {
      column: `b`,
      ascending: false,
    }]

    expect(cell_val).toBe(`test`)
    expect(row_data.value).toBe(1)
    expect(label.label).toBe(`Test`)
    expect(cell_args.val).toBe(`test`)
    expect(sort_state.column).toBe(`test`)
    expect(multi_sort).toHaveLength(2)
  })
})

describe(`calc_cell_color`, () => {
  it(`returns null colors for null value`, () => {
    const result = calc_cell_color(null, [1, 2, 3], `higher`)
    expect(result.bg).toBeNull()
    expect(result.text).toBeNull()
  })

  it(`returns null colors for undefined value`, () => {
    const result = calc_cell_color(undefined, [1, 2, 3], `higher`)
    expect(result.bg).toBeNull()
    expect(result.text).toBeNull()
  })

  it(`returns null colors when color_scale is null`, () => {
    const result = calc_cell_color(5, [1, 5, 10], `higher`, null)
    expect(result.bg).toBeNull()
    expect(result.text).toBeNull()
  })

  it(`returns null colors for empty values array`, () => {
    const result = calc_cell_color(5, [], `higher`)
    expect(result.bg).toBeNull()
    expect(result.text).toBeNull()
  })

  it(`calculates colors for valid input with higher-is-better`, () => {
    const result = calc_cell_color(10, [1, 5, 10], `higher`)
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`calculates colors for valid input with lower-is-better`, () => {
    const result = calc_cell_color(1, [1, 5, 10], `lower`)
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`handles log scale for positive values`, () => {
    const result = calc_cell_color(
      100,
      [10, 100, 1000],
      `higher`,
      `interpolateViridis`,
      `log`,
    )
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`uses different color for min vs max value`, () => {
    const min_result = calc_cell_color(1, [1, 50, 100], `higher`)
    const max_result = calc_cell_color(100, [1, 50, 100], `higher`)
    expect(min_result.bg).not.toEqual(max_result.bg)
  })

  it(`uses custom color scale when provided`, () => {
    const viridis = calc_cell_color(50, [1, 50, 100], `higher`, `interpolateViridis`)
    const plasma = calc_cell_color(50, [1, 50, 100], `higher`, `interpolatePlasma`)
    expect(viridis.bg).not.toEqual(plasma.bg)
  })

  it(`includes zero values for linear scale`, () => {
    // Regression test: zero should be included in linear scale calculations
    const result = calc_cell_color(
      0,
      [0, 50, 100],
      `higher`,
      `interpolateViridis`,
      `linear`,
    )
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`returns null colors for non-positive values with log scale`, () => {
    // Log scale cannot handle zero/negative values, should return null colors
    const zero_result = calc_cell_color(
      0,
      [0, 50, 100],
      `higher`,
      `interpolateViridis`,
      `log`,
    )
    expect(zero_result).toEqual({ bg: null, text: null })

    const negative_result = calc_cell_color(
      -5,
      [-5, 50, 100],
      `higher`,
      `interpolateViridis`,
      `log`,
    )
    expect(negative_result).toEqual({ bg: null, text: null })
  })

  it(`includes negative values for linear scale`, () => {
    // Regression test: negative values should work for linear scale
    const result = calc_cell_color(
      -50,
      [-100, 0, 100],
      `higher`,
      `interpolateViridis`,
      `linear`,
    )
    expect(result.bg).not.toBeNull()
    expect(result.text).not.toBeNull()
  })

  it(`passes undefined better prop directly without coercion`, () => {
    // Regression test: undefined better should be passed through, not converted
    const result = calc_cell_color(50, [1, 50, 100], undefined)
    expect(result.bg).not.toBeNull()
  })
})

describe(`strip_html`, () => {
  it(`removes simple HTML tags`, () => {
    expect(strip_html(`<span>hello</span>`)).toBe(`hello`)
  })

  it(`removes nested HTML tags`, () => {
    expect(strip_html(`<div><span>nested</span></div>`)).toBe(`nested`)
  })

  it(`removes tags with attributes`, () => {
    expect(strip_html(`<a href="https://example.com" class="link">link text</a>`)).toBe(
      `link text`,
    )
  })

  it(`handles data-sort-value attributes`, () => {
    expect(strip_html(`<span data-sort-value="100">formatted</span>`)).toBe(`formatted`)
  })

  it(`returns plain text unchanged`, () => {
    expect(strip_html(`plain text`)).toBe(`plain text`)
  })

  it(`handles empty string`, () => {
    expect(strip_html(``)).toBe(``)
  })

  it(`removes self-closing tags`, () => {
    expect(strip_html(`before<br/>after`)).toBe(`beforeafter`)
  })

  it(`handles multiple tags`, () => {
    expect(strip_html(`<b>bold</b> and <i>italic</i>`)).toBe(`bold and italic`)
  })
})
