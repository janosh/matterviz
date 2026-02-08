import { HeatmapTable, type Label } from '$lib'
import { mount, tick } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

describe(`HeatmapTable`, () => {
  const sample_data = [
    { Model: `Model A`, Score: 0.95, Value: 100 },
    { Model: `Model B`, Score: 0.85, Value: 200 },
    { Model: `Model C`, Score: 0.75, Value: 300 },
  ]

  const sample_columns: Label[] = [
    { label: `Model`, sticky: true, description: `` },
    { label: `Score`, better: `higher`, format: `.2f`, description: `` },
    { label: `Value`, better: `lower`, description: `` },
  ]

  // Shared heatmap column used across multiple test groups
  const heatmap_col: Label = {
    label: `Value`,
    color_scale: `interpolateViridis`,
    description: ``,
  }

  it(`renders table with correct structure and handles hidden columns`, () => {
    const columns = [
      ...sample_columns,
      { label: `Hidden`, visible: false, description: `` },
    ]
    mount(HeatmapTable, {
      target: document.body,
      props: { data: sample_data, columns },
    })

    const headers = document.querySelectorAll(`th`)
    expect(headers).toHaveLength(3)
    expect(
      Array.from(headers).map((h) => h.textContent?.replace(/\s+/g, ` `).trim()),
    ).toEqual([`Model`, `Score ↑`, `Value ↓`])

    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
    expect(document.querySelectorAll(`td[data-col="Hidden"]`)).toHaveLength(0)
  })

  it(`handles empty data and filters undefined rows`, async () => {
    let data_with_empty = $state([{ Model: undefined, Score: undefined }, ...sample_data])

    mount(HeatmapTable, {
      target: document.body,
      props: { data: data_with_empty, columns: sample_columns },
    })

    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)

    data_with_empty = []
    await tick()
    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
  })

  describe(`Sorting and Data Updates`, () => {
    it(`sorts correctly and handles missing values`, async () => {
      const data = [
        { Model: `A`, Score: undefined, Value: 100 },
        { Model: `B`, Score: 0.85, Value: undefined },
        { Model: `C`, Score: 0.75, Value: 300 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: sample_columns },
      })

      // Test initial sort
      const value_header = document.querySelectorAll(`th`)[2]
      value_header.click()
      await tick()

      const values = Array.from(
        document.querySelectorAll(`td[data-col="Value"]`),
      ).map((cell) => cell.textContent?.trim())
      expect(values).toEqual([`100`, `300`, `n/a`])

      // Test sort direction toggle
      value_header.click()
      await tick()
      const reversed = Array.from(
        document.querySelectorAll(`td[data-col="Value"]`),
      ).map((cell) => cell.textContent?.trim())
      expect(reversed).toEqual([`300`, `100`, `n/a`])
    })

    it(`maintains sort state on data updates`, async () => {
      let data = $state(sample_data)
      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: sample_columns },
      })

      const score_header = document.querySelectorAll(`th`)[1]
      score_header.click() // Sort by Score
      await tick()

      data = [{ Model: `D`, Score: 0.65, Value: 400 }, ...sample_data]
      await tick()

      const scores = Array.from(
        document.querySelectorAll(`td[data-col="Score"]`),
      ).map((cell) => cell.textContent?.trim())
      expect(scores).toEqual([`0.95`, `0.85`, `0.75`])
    })

    it(`sorts date columns correctly`, () => {
      const dates = [
        { Date: `<span data-sort-value="1620950400000">2021-05-14</span>` },
        { Date: `<span data-sort-value="1684966800000">2023-05-25</span>` },
        { Date: `<span data-sort-value="1715089200000">2024-05-07</span>` },
      ]

      const date_columns: Label[] = [{ label: `Date`, description: `` }]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: dates, columns: date_columns },
      })

      // Initial data should already be in order
      const initial_dates = Array.from(document.querySelectorAll(`td`)).map((cell) =>
        cell.textContent?.trim()
      )

      expect(initial_dates).toEqual([`2021-05-14`, `2023-05-25`, `2024-05-07`])
    })

    it(`sorts using data-sort-value attributes for numeric values`, async () => {
      const formatted_data = [
        { Number: `<span data-sort-value="1000">1,000</span>` },
        { Number: `<span data-sort-value="50">50</span>` },
        { Number: `<span data-sort-value="10000">10,000</span>` },
      ]

      const columns: Label[] = [{ label: `Number`, description: `` }]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: formatted_data, columns },
      })

      // Click to sort ascending by data-sort-value
      document.querySelector(`th`)?.click()
      await tick()

      const sorted = Array.from(document.querySelectorAll(`td`)).map(
        (cell) => cell.textContent?.trim(),
      )
      // Default sort is descending (no `better` set), so largest first
      expect(sorted).toEqual([`10,000`, `1,000`, `50`])
    })

    it(`respects unsortable columns`, async () => {
      const columns: Label[] = [
        { label: `Name`, sortable: true, description: `` },
        { label: `Value`, sortable: true, description: `` },
        { label: `Actions`, sortable: false, description: `` },
      ]
      const data = [
        { Name: `Alice`, Value: `100`, Actions: `View` },
        { Name: `Bob`, Value: `200`, Actions: `Edit` },
        { Name: `Charlie`, Value: `300`, Actions: `Delete` },
      ]

      mount(HeatmapTable, { target: document.body, props: { data, columns } })

      const get_values = () =>
        Array.from(document.querySelectorAll(`td[data-col="Value"]`))
          .map((cell) => cell.textContent?.trim())
      const headers = document.querySelectorAll(`th`)

      // Clicking unsortable column has no effect
      headers[2].click()
      await tick()
      expect(get_values()).toEqual([`100`, `200`, `300`])

      // Clicking sortable column does sort
      headers[1].click()
      await tick()
      expect(get_values()).not.toEqual([`100`, `200`, `300`])
    })

    it.each(
      [
        {
          initial_sort: { column: `Score`, direction: `desc` },
          expected: [`0.95`, `0.85`, `0.75`],
          desc: `object desc`,
        },
        {
          initial_sort: `Score`,
          expected: [`0.75`, `0.85`, `0.95`],
          desc: `string shorthand defaults to asc`,
        },
      ] as const,
    )(`initial_sort $desc`, ({ initial_sort, expected }) => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, initial_sort },
      })

      const scores = Array.from(document.querySelectorAll(`td[data-col="Score"]`))
        .map((cell) => cell.textContent?.trim())
      expect(scores).toEqual(expected)
    })

    // Tests for sorting numbers with error/uncertainty notation (±, +-, parenthetical)
    // Sorts by extracting the primary numeric value before the error term
    it.each([
      {
        desc: `± notation`,
        input: [`1.5 ± 0.2`, `0.8 ± 0.1`, `2.3 ± 0.5`],
        expected: [`0.8 ± 0.1`, `1.5 ± 0.2`, `2.3 ± 0.5`],
      },
      {
        desc: `+- notation`,
        input: [`10.5 +- 1.2`, `5.2 +- 0.8`, `15.0 +- 2.0`],
        expected: [`5.2 +- 0.8`, `10.5 +- 1.2`, `15.0 +- 2.0`],
      },
      {
        desc: `parenthetical notation`,
        input: [`1.234(5)`, `0.567(3)`, `2.890(8)`],
        expected: [`0.567(3)`, `1.234(5)`, `2.890(8)`],
      },
      {
        desc: `negative numbers`,
        input: [`-1.5 ± 0.2`, `0.8 ± 0.1`, `-2.3 ± 0.5`],
        expected: [`-2.3 ± 0.5`, `-1.5 ± 0.2`, `0.8 ± 0.1`],
      },
      {
        desc: `scientific notation`,
        input: [`1.5e-3 ± 0.2e-3`, `2.8e-2 ± 0.1e-2`, `5.0e-4 ± 1.0e-4`],
        expected: [`5.0e-4 ± 1.0e-4`, `1.5e-3 ± 0.2e-3`, `2.8e-2 ± 0.1e-2`],
      },
      {
        desc: `mixed plain and error notation`,
        input: [`1.5 ± 0.2`, `0.8`, `2.3 ± 0.5`, `1.0`],
        expected: [`0.8`, `1.0`, `1.5 ± 0.2`, `2.3 ± 0.5`],
      },
    ])(`sorts numbers with $desc correctly`, async ({ input, expected }) => {
      const data = input.map((val, idx) => ({
        Name: String.fromCharCode(65 + idx),
        Value: val,
      }))
      const columns: Label[] = [
        { label: `Name`, description: `` },
        { label: `Value`, better: `lower`, description: `` },
      ]

      mount(HeatmapTable, { target: document.body, props: { data, columns } })

      document.querySelectorAll(`th`)[1].click()
      await tick()

      const values = Array.from(document.querySelectorAll(`td[data-col="Value"]`))
        .map((cell) => cell.textContent?.trim())
      expect(values).toEqual(expected)
    })

    // Tests for heatmap coloring with uncertainty notation strings
    // Heatmap colors should be applied by parsing the primary numeric value
    it.each([
      { desc: `± notation`, values: [`1.0 ± 0.1`, `5.0 ± 0.2`, `10.0 ± 0.3`] },
      { desc: `+- notation`, values: [`1.0 +- 0.1`, `5.0 +- 0.2`, `10.0 +- 0.3`] },
      { desc: `parenthetical notation`, values: [`1.0(1)`, `5.0(2)`, `10.0(3)`] },
      { desc: `mixed formats`, values: [`1.0 ± 0.1`, `5.0 +- 0.2`, `10.0(3)`] },
      { desc: `unicode minus (−)`, values: [`−1.0 ± 0.1`, `−5.0 ± 0.2`, `−10.0 ± 0.3`] },
      { desc: `leading decimals`, values: [`.5 ± 0.1`, `-.5 ± 0.1`, `.25(1)`] },
    ])(`applies heatmap colors to $desc strings`, ({ values }) => {
      const data = values.map((val, idx) => ({
        Name: String.fromCharCode(65 + idx),
        Value: val,
      }))

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: [{ label: `Name`, description: `` }, heatmap_col] },
      })

      const cells = document.querySelectorAll(`td[data-col="Value"]`)
      const style_attrs = Array.from(cells).map(
        (cell) => cell.getAttribute(`style`) ?? ``,
      )

      // All cells should have --cell-bg custom property set (match with colon to avoid partial matches)
      expect(style_attrs.every((s) => s.includes(`--cell-bg:`))).toBe(true)
      // Styles should be different for different values (different d3 colors)
      expect(new Set(style_attrs).size).toBeGreaterThan(1)
    })

    it(`does not apply heatmap colors to non-numeric strings`, () => {
      const data = [
        { Name: `A`, Value: `hello` },
        { Name: `B`, Value: `world` },
        { Name: `C`, Value: `test` },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: [{ label: `Name`, description: `` }, heatmap_col] },
      })

      const cells = document.querySelectorAll(`td[data-col="Value"]`)
      const style_attrs = Array.from(cells).map(
        (cell) => cell.getAttribute(`style`) ?? ``,
      )

      // No --cell-bg should be set for non-numeric strings
      expect(style_attrs.every((s) => !s.includes(`--cell-bg:`))).toBe(true)
    })

    it(`does not apply heatmap colors to non-numeric values mixed with numeric`, () => {
      // Tests that string cells in a column with valid numeric peers don't get colored
      const data = [
        { Name: `A`, Value: 10 },
        { Name: `B`, Value: `not a number` },
        { Name: `C`, Value: 100 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: [{ label: `Name`, description: `` }, heatmap_col] },
      })

      const cells = Array.from(document.querySelectorAll(`td[data-col="Value"]`))
      const style_attrs = cells.map((cell) => cell.getAttribute(`style`) ?? ``)

      // First and third rows (numeric 10 and 100) should have --cell-bg
      expect(style_attrs[0]).toContain(`--cell-bg:`)
      expect(style_attrs[2]).toContain(`--cell-bg:`)
      // Second row (string "not a number") should NOT have --cell-bg
      expect(style_attrs[1]).not.toContain(`--cell-bg:`)
    })
  })

  it(`handles formatting and styles`, () => {
    const columns: Label[] = [
      { label: `Num`, format: `.1%`, description: `` },
      {
        label: `Val`,
        better: `higher`,
        color_scale: `interpolateViridis`,
        description: ``,
      },
    ]
    const data = [
      { Num: 0.123, Val: 0 },
      { Num: 1.234, Val: 100 },
    ]

    mount(HeatmapTable, {
      target: document.body,
      props: { data, columns },
    })

    // Check number formatting
    const num_cell = document.querySelector(`td[data-col="Num"]`)
    if (!num_cell) throw `Num cell not found`
    expect(num_cell.textContent?.trim()).toBe(`12.3%`)

    // Check that val cells have --cell-bg set
    const val_cells = document.querySelectorAll(`td[data-col="Val"]`)
    const has_color = Array.from(val_cells).some((cell) =>
      (cell.getAttribute(`style`) ?? ``).includes(`--cell-bg:`)
    )
    expect(has_color).toBe(true)
  })

  it(`applies different scale types for color mapping`, () => {
    const c1: Label = {
      label: `Linear`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      scale_type: `linear`,
      description: ``,
    }
    const c2: Label = {
      label: `Log`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      scale_type: `log`,
      description: ``,
    }
    const data = [10, 100, 1000].map((val) => ({ [c1.label]: val, [c2.label]: val }))

    mount(HeatmapTable, { target: document.body, props: { data, columns: [c1, c2] } })

    // Get cells for both columns
    const linear_cells = document.querySelectorAll(`td[data-col="Linear"]`)
    const log_cells = document.querySelectorAll(`td[data-col="Log"]`)

    // Check --cell-bg is set on cells
    const linear_styles = Array.from(linear_cells).map(
      (cell) => cell.getAttribute(`style`) ?? ``,
    )
    const log_styles = Array.from(log_cells).map(
      (cell) => cell.getAttribute(`style`) ?? ``,
    )

    // Both types should have --cell-bg set
    expect(linear_styles.every((s) => s.includes(`--cell-bg:`))).toBe(true)
    expect(log_styles.every((s) => s.includes(`--cell-bg:`))).toBe(true)

    // The color distribution should be different between linear and log scale
    // In linear scale, 10->100->1000 should have increasingly spaced colors
    // In log scale, the color difference between 10->100 should be similar to 100->1000
    // Difficult to test precisely without mocking d3 scales, but we can check
    // there are differences between the two scale types.
    expect(linear_styles).not.toEqual(log_styles)
  })

  it(`handles accessibility features`, () => {
    mount(HeatmapTable, {
      target: document.body,
      props: {
        data: sample_data,
        columns: [{ label: `Col`, description: `Description`, sticky: true }],
        sort_hint: `Click to sort`,
      },
    })

    const header = document.querySelector(`th`)
    expect(header?.getAttribute(`title`) || header?.getAttribute(`data-title`)).toBe(
      `Description`,
    )
    // sort_hint renders as a separate .sort-hint element, not inside the header
    expect(document.querySelector(`.sort-hint`)).not.toBeNull()
    expect(header?.classList.contains(`sticky-col`)).toBe(true)
  })

  it(`handles undefined and null values`, () => {
    const data = [{ Model: `Empty Model`, Score: undefined, Value: undefined }]

    mount(HeatmapTable, {
      target: document.body,
      props: { data, columns: sample_columns },
    })

    const cells = document.querySelectorAll(`td`)
    expect(cells).toHaveLength(3)
    expect(cells[0].textContent?.trim()).toBe(`Empty Model`)
    expect(cells[1].textContent?.trim()).toBe(`n/a`)
    expect(cells[2].textContent?.trim()).toBe(`n/a`)
  })

  it(`handles NaN values by displaying them as 'n/a'`, () => {
    const data = [
      { Model: `Model A`, Score: 1.5, Value: NaN },
      { Model: `Model B`, Score: NaN, Value: 2.7 },
    ]

    mount(HeatmapTable, {
      target: document.body,
      props: { data, columns: sample_columns },
    })

    const all_text = Array.from(document.querySelectorAll(`td`))
      .map((cell) => cell.textContent?.trim())

    // NaN displayed as 'n/a', never as literal 'NaN'
    expect(all_text.filter((text) => text === `n/a`)).toHaveLength(2)
    expect(all_text).not.toContain(`NaN`)
    // Normal values still rendered
    expect(all_text).toContain(`Model A`)
    expect(all_text.some((text) => text?.includes(`1.5`))).toBe(true)
    expect(all_text.some((text) => text?.includes(`2.7`))).toBe(true)
  })

  it(`prevents HTML strings from being used as data-sort-value attributes`, () => {
    const html_data = [
      {
        Name: `Test Model`,
        HTML: `<span data-sort-value="100" title="This is a tooltip">100 units</span>`,
        Complex:
          `<span data-sort-value="3373529" title="Complex tooltip with multiple lines&#013;• Line item 1&#013;• Line item 2">3.37M <small>(details)</small> (<a href="https://example.com">Link</a>)</span>`,
      },
    ]

    const html_columns: Label[] = [
      { label: `Name`, description: `` },
      { label: `HTML`, description: `` },
      { label: `Complex`, description: `` },
    ]

    mount(HeatmapTable, {
      target: document.body,
      props: { data: html_data, columns: html_columns },
    })

    // Get the cells with HTML content
    const html_cell = document.querySelector(`td[data-col="HTML"]`)
    const complex_cell = document.querySelector(`td[data-col="Complex"]`)

    // Verify cells exist and contain the expected HTML
    expect(html_cell).not.toBeNull()
    expect(complex_cell).not.toBeNull()

    // HTML should be rendered correctly
    expect(html_cell?.innerHTML).toContain(`<span data-sort-value="100"`)
    expect(complex_cell?.innerHTML).toContain(`<span data-sort-value="3373529"`)

    // The data-sort-value attribute on the td should not contain HTML
    const html_cell_sort_value = html_cell?.getAttribute(`data-sort-value`)
    const complex_cell_sort_value = complex_cell?.getAttribute(`data-sort-value`)

    // Either undefined (meaning HTML was detected and no sort value was set)
    // or not containing HTML tags
    if (html_cell_sort_value !== null) {
      expect(html_cell_sort_value?.includes(`<`)).toBe(false)
      expect(html_cell_sort_value?.includes(`>`)).toBe(false)
    }

    if (complex_cell_sort_value !== null) {
      expect(complex_cell_sort_value?.includes(`<`)).toBe(false)
      expect(complex_cell_sort_value?.includes(`>`)).toBe(false)
    }

    // Check that tooltips are present and accessible
    const tooltip_span = html_cell?.querySelector(`span[title]`)
    expect(tooltip_span).not.toBeNull()
    expect(tooltip_span?.getAttribute(`title`)).toBe(`This is a tooltip`)

    const complex_tooltip_span = complex_cell?.querySelector(`span[title]`)
    expect(complex_tooltip_span).not.toBeNull()
    expect(complex_tooltip_span?.getAttribute(`title`)).toContain(`Complex tooltip`)
  })

  describe(`Heatmap Toggle Functionality`, () => {
    const heatmap_val_col: Label = {
      label: `Val`,
      better: `higher`,
      color_scale: `interpolateViridis`,
      description: ``,
    }

    // --cell-bg CSS custom property is set inline per cell; the stylesheet applies
    // color-mix(in srgb, var(--cell-bg) var(--heatmap-opacity, 100%), transparent)
    it.each([
      { show_heatmap: true, desc: `sets --cell-bg when show_heatmap is true (default)` },
      { show_heatmap: false, desc: `does not set --cell-bg when show_heatmap is false` },
    ])(`$desc`, ({ show_heatmap }) => {
      const data = [{ Val: 0 }, { Val: 50 }, { Val: 100 }]
      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: [heatmap_val_col], show_heatmap },
      })

      for (const cell of Array.from(document.querySelectorAll(`td[data-col="Val"]`))) {
        const style_attr = cell.getAttribute(`style`) ?? ``
        if (show_heatmap) {
          expect(style_attr).toContain(`--cell-bg:`)
        } else {
          expect(style_attr).not.toContain(`--cell-bg:`)
        }
      }
    })

    it(`does not set --cell-bg on non-numeric cells`, () => {
      const data = [
        { Name: `foo`, Val: 10 },
        { Name: `bar`, Val: 20 },
      ]
      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: [{ label: `Name`, description: `` }, heatmap_val_col] },
      })

      for (const cell of Array.from(document.querySelectorAll(`td[data-col="Name"]`))) {
        expect(cell.getAttribute(`style`) ?? ``).not.toContain(`--cell-bg:`)
      }
      for (const cell of Array.from(document.querySelectorAll(`td[data-col="Val"]`))) {
        expect(cell.getAttribute(`style`) ?? ``).toContain(`--cell-bg:`)
      }
    })
  })

  describe(`Column grouping`, () => {
    it(`correctly renders grouped columns`, () => {
      const grouped_columns: Label[] = [
        { label: `Name`, sticky: true, description: `` },
        { label: `Value 1`, group: `Values`, description: `` },
        { label: `Value 2`, group: `Values`, description: `` },
        { label: `Metric 1`, group: `Metrics`, description: `` },
        { label: `Metric 2`, group: `Metrics`, description: `` },
        { label: `Value 1`, group: `Second Values`, description: `` },
        { label: `Value 2`, group: `Second Values`, description: `` },
      ]

      const grouped_data = [
        {
          Name: `Item A`,
          'Value 1 (Values)': 10,
          'Value 2 (Values)': 20,
          'Metric 1': 30,
          'Metric 2': 40,
          'Value 1 (Second Values)': 50,
          'Value 2 (Second Values)': 60,
        },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: grouped_data, columns: grouped_columns },
      })

      // Should have two rows in the header
      const header_rows = document.querySelectorAll(`thead tr`)
      expect(header_rows).toHaveLength(2)

      // First row should contain the group headers
      const group_headers = header_rows[0].querySelectorAll(`th`)
      expect(group_headers).toHaveLength(4) // Name (empty), Values, Metrics, Second Values

      // Get the text content of the group headers (excluding the empty one)
      const group_texts = Array.from(group_headers)
        .filter((th) => th.textContent?.trim())
        .map((th) => th.textContent?.trim())

      // Should have all three groups rendered
      expect(group_texts).toEqual([`Values`, `Metrics`, `Second Values`])

      // Check the group headers have correct colspan
      const values_header = Array.from(group_headers).find((th) =>
        th.textContent?.includes(`Values`)
      )
      const metrics_header = Array.from(group_headers).find((th) =>
        th.textContent?.includes(`Metrics`)
      )
      const second_values_header = Array.from(group_headers).find((th) =>
        th.textContent?.includes(`Second Values`)
      )

      expect(values_header?.getAttribute(`colspan`)).toBe(`2`) // Values spans 2 columns
      expect(metrics_header?.getAttribute(`colspan`)).toBe(`2`) // Metrics spans 2 columns
      expect(second_values_header?.getAttribute(`colspan`)).toBe(`2`) // Second Values spans 2 columns

      // Check column headers in second row
      const col_headers = header_rows[1].querySelectorAll(`th`)
      expect(col_headers).toHaveLength(7)

      // Column headers should have duplicate label names (Value 1, Value 2) rendered for each group
      expect(
        Array.from(col_headers).map((h) =>
          h.textContent?.trim().replace(/\s+|[↑↓]/g, ``)
        ),
      ).toEqual([`Name`, `Value1`, `Value2`, `Metric1`, `Metric2`, `Value1`, `Value2`])
    })

    it(`correctly handles mixed grouped and ungrouped columns`, () => {
      const mixed_columns: Label[] = [
        { label: `Name`, description: `` },
        { label: `Regular`, description: `` },
        { label: `Group 1`, group: `Grouped`, description: `` },
        { label: `Group 2`, group: `Grouped`, description: `` },
        { label: `Another`, description: `` },
      ]

      const mixed_data = [
        { Name: `Test`, Regular: 1, 'Group 1': 2, 'Group 2': 3, Another: 4 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: mixed_data, columns: mixed_columns },
      })

      // Should have two rows in the header
      const header_rows = document.querySelectorAll(`thead tr`)
      expect(header_rows).toHaveLength(2)

      // Check the group header row
      const group_cells = header_rows[0].querySelectorAll(`th`)

      // There should be 4 cells - two empty (for Name and Regular), one for Grouped, and one empty for Another
      expect(group_cells).toHaveLength(4)

      // The Grouped cell should have colspan=2
      const grouped_header = Array.from(group_cells).find((c) =>
        c.textContent?.includes(`Grouped`)
      )
      expect(grouped_header?.getAttribute(`colspan`)).toBe(`2`)
    })
  })

  describe(`Style and CSS properties`, () => {
    it(`applies custom column styles`, () => {
      const styled_columns: Label[] = [
        {
          label: `Col1`,
          style: `color: red; font-weight: lighter;`,
          description: ``,
        },
        { label: `Col2`, description: `` },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: [{ Col1: `a`, Col2: `b` }], columns: styled_columns },
      })

      const header = document.querySelector(`th`)
      expect(header?.getAttribute(`style`)).toContain(`color: red`)
      expect(header?.getAttribute(`style`)).toContain(`font-weight: lighter`)
      // Check that style is also applied to cells
      const cell = document.querySelector(`td[data-col="Col1"]`)
      expect(cell?.getAttribute(`style`)).toContain(`font-weight: lighter;`)
    })

    it(`applies row styles from data`, () => {
      const data_with_styles = [{ col: `value`, style: `background-color: yellow;` }]

      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: data_with_styles,
          columns: [{ label: `col`, description: `` }],
        },
      })

      const row = document.querySelector(`tbody tr`)
      expect(row?.getAttribute(`style`)).toContain(`background-color: yellow`)
    })

    it(`applies container style from props`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: [{ col: `value` }],
          columns: [{ label: `col`, description: `` }],
          style: `max-height: 200px; border: 1px solid blue;`,
        },
      })

      const container = document.querySelector(`.table-container`)
      expect(container?.getAttribute(`style`)).toContain(`max-height: 200px`)
      expect(container?.getAttribute(`style`)).toContain(`border: 1px solid blue`)
    })
  })

  describe(`Search and Filter`, () => {
    it(`renders search button when search is enabled`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, search: true },
      })

      const control_buttons = document.querySelector(`.control-buttons`)
      expect(control_buttons).not.toBeNull()
      expect(control_buttons?.querySelector(`.icon-btn`)).not.toBeNull()
    })

    it(`expands search input when toggle clicked`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, search: true },
      })

      const search_btn = document.querySelector(
        `.control-buttons .icon-btn`,
      ) as HTMLButtonElement
      search_btn.click()
      await tick()

      const search_input = document.querySelector(`input[type="search"]`)
      expect(search_input).not.toBeNull()
    })

    it(`respects search.placeholder configuration`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          search: { placeholder: `Search materials...` },
        },
      })

      // Click to expand search
      const search_btn = document.querySelector(
        `.control-buttons .icon-btn`,
      ) as HTMLButtonElement
      search_btn.click()
      await tick()

      const search_input = document.querySelector(
        `input[type="search"]`,
      ) as HTMLInputElement
      expect(search_input?.placeholder).toBe(`Search materials...`)
    })

    it(`respects search.expanded configuration to auto-expand`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          search: { expanded: true },
        },
      })

      // Search input should be visible immediately without clicking
      const search_input = document.querySelector(`input[type="search"]`)
      expect(search_input).not.toBeNull()
    })

    // Note: Tests for filtering functionality are skipped in happy-dom due to:
    // 1. happy-dom doesn't fully support getAnimations() for animate:flip directive
    // 2. Svelte 5's bind:value requires native input simulation that happy-dom doesn't support
    // These should be tested in Playwright e2e tests instead.

    // Note: Test for closing search skipped due to happy-dom button click handling
    // issues with Svelte 5's onclick handlers
  })

  describe(`Export Functionality`, () => {
    it(`renders export dropdown when export_data is enabled`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, export_data: true },
      })

      // Find export dropdown (second dropdown-wrapper when column toggle is not present)
      const control_buttons = document.querySelector(`.control-buttons`)
      const export_btn = control_buttons?.querySelector(
        `.dropdown-wrapper .icon-btn`,
      ) as HTMLButtonElement
      expect(export_btn).not.toBeNull()

      // Click to open
      export_btn.click()
      await tick()

      // Should show CSV and JSON options
      const dropdown = document.querySelector(`.dropdown-pane`)
      expect(dropdown?.textContent).toContain(`CSV`)
      expect(dropdown?.textContent).toContain(`JSON`)
    })

    it(`does not render export button when export_data is false`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, export_data: false },
      })

      const dropdown_wrappers = document.querySelectorAll(`.dropdown-wrapper`)
      expect(dropdown_wrappers).toHaveLength(0)
    })

    it(`respects export_data.formats to show only specified formats`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          export_data: { formats: [`csv`] },
        },
      })

      const export_btn = document.querySelector(
        `.dropdown-wrapper .icon-btn`,
      ) as HTMLButtonElement
      export_btn.click()
      await tick()

      const dropdown = document.querySelector(`.dropdown-pane`)
      expect(dropdown?.textContent).toContain(`CSV`)
      expect(dropdown?.textContent).not.toContain(`JSON`)
    })
  })

  describe(`Column Visibility Toggle`, () => {
    it(`renders toggle button and shows dropdown with all columns`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, show_column_toggle: true },
      })

      const dropdown_wrapper = document.querySelector(`.dropdown-wrapper`)
      expect(dropdown_wrapper).not.toBeNull()

      const toggle_btn = dropdown_wrapper?.querySelector(`.icon-btn`) as HTMLButtonElement
      toggle_btn.click()
      await tick()

      const dropdown = document.querySelector(`.dropdown-pane`)
      expect(dropdown).not.toBeNull()
      expect(dropdown?.querySelectorAll(`input[type="checkbox"]`)).toHaveLength(3)
    })

    it(`hides column when unchecked`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, show_column_toggle: true },
      })

      // Initial: all 3 columns visible
      expect(document.querySelectorAll(`th`)).toHaveLength(3)

      // Open dropdown
      const dropdown_wrapper = document.querySelector(`.dropdown-wrapper`)
      const toggle_btn = dropdown_wrapper?.querySelector(`.icon-btn`) as HTMLButtonElement
      toggle_btn.click()
      await tick()

      // Uncheck first column
      const checkboxes = document.querySelectorAll(
        `.dropdown-pane input[type="checkbox"]`,
      )
      ;(checkboxes[0] as HTMLInputElement).click()
      await tick()

      // Should now have 2 columns
      expect(document.querySelectorAll(`th`)).toHaveLength(2)
    })
  })

  describe(`Row Selection`, () => {
    it(`renders checkbox column when show_row_select is true`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, show_row_select: true },
      })

      const checkboxes = document.querySelectorAll(`td.select-col input[type="checkbox"]`)
      expect(checkboxes).toHaveLength(3) // One per row
    })

    it(`selects row when checkbox clicked`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          show_row_select: true,
        },
      })

      // Verify checkbox exists and check it
      const checkbox = document.querySelector(
        `td.select-col input[type="checkbox"]`,
      ) as HTMLInputElement
      expect(checkbox).not.toBeNull()
      expect(checkbox.checked).toBe(false)

      checkbox.click()
      await tick()

      // The checkbox should now be checked (verifies click worked)
      expect(checkbox.checked).toBe(true)

      // Selection badge should appear with count "1"
      const badge = document.querySelector(`.selection-badge .badge`)
      expect(badge?.textContent).toContain(`1`)
    })

    it(`shows selection count in header`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          show_row_select: true,
        },
      })

      // Select two rows
      const checkboxes = document.querySelectorAll(`td.select-col input[type="checkbox"]`)
      ;(checkboxes[0] as HTMLInputElement).click()
      ;(checkboxes[1] as HTMLInputElement).click()
      await tick()

      const badge = document.querySelector(`.selection-badge .badge`)
      expect(badge?.textContent).toContain(`2`)
    })

    it(`clears selection when clear button clicked`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          show_row_select: true,
        },
      })

      // Select a row
      const checkbox = document.querySelector(
        `td.select-col input[type="checkbox"]`,
      ) as HTMLInputElement
      checkbox.click()
      await tick()

      // Click clear button (now a selection-badge icon-btn)
      const clear_btn = document.querySelector(`.selection-badge`) as HTMLButtonElement
      clear_btn.click()
      await tick()

      expect(document.querySelectorAll(`tr.selected`)).toHaveLength(0)
    })
  })

  describe(`Multi-Column Sorting`, () => {
    it(`adds secondary sort with Shift+click and shows numbered badges`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns },
      })

      const headers = document.querySelectorAll(`th`)

      headers[0].dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
      await tick()
      headers[1].dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
      await tick()

      // With 2 columns in multi-sort, numbered badges should appear
      expect(headers[0].innerHTML).toContain(`<sup>1</sup>`)
      expect(headers[1].innerHTML).toContain(`<sup>2</sup>`)
    })

    it(`clears multi-sort on regular click`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns },
      })

      const headers = document.querySelectorAll(`th`)

      // Add multi-sort
      const shift_event = new MouseEvent(`click`, { shiftKey: true, bubbles: true })
      headers[0].dispatchEvent(shift_event)
      await tick()
      headers[1].dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
      await tick()

      // Regular click should clear multi-sort
      headers[2].click()
      await tick()

      // Only third header should have sort indicator
      expect(headers[0].innerHTML).not.toContain(`<sup>`)
      expect(headers[1].innerHTML).not.toContain(`<sup>`)
    })
  })

  describe(`Pagination`, () => {
    const large_data = Array.from({ length: 50 }, (_, idx) => ({
      Model: `Model ${idx + 1}`,
      Score: Math.random(),
      Value: idx * 10,
    }))

    it(`renders pagination controls when pagination is enabled`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: large_data,
          columns: sample_columns,
          pagination: { page_size: 10 },
        },
      })

      const pagination = document.querySelector(`.pagination`)
      expect(pagination).not.toBeNull()

      // Check page input value (not textContent since it's in an input)
      const page_input = document.querySelector(`.page-input`) as HTMLInputElement
      expect(page_input?.value).toBe(`1`)

      const page_info = document.querySelector(`.page-info`)
      expect(page_info?.textContent).toContain(`of 5`)
    })

    it(`limits rows to pagination.page_size`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: large_data,
          columns: sample_columns,
          pagination: { page_size: 10 },
        },
      })

      const rows = document.querySelectorAll(`tbody tr`)
      expect(rows).toHaveLength(10)
    })

    // Note: Test for navigation between pages skipped in happy-dom due to:
    // happy-dom doesn't support getAnimations() which animate:flip uses when rows change

    it(`disables prev/first buttons on first page`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: large_data,
          columns: sample_columns,
          pagination: { page_size: 10 },
        },
      })

      const buttons = document.querySelectorAll(`.page-btn`)
      expect((buttons[0] as HTMLButtonElement).disabled).toBe(true) // First
      expect((buttons[1] as HTMLButtonElement).disabled).toBe(true) // Prev
      expect((buttons[2] as HTMLButtonElement).disabled).toBe(false) // Next
      expect((buttons[3] as HTMLButtonElement).disabled).toBe(false) // Last
    })

    it(`shows total row count`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: large_data,
          columns: sample_columns,
          pagination: { page_size: 10 },
        },
      })

      const row_count = document.querySelector(`.row-count`)
      expect(row_count?.textContent).toContain(`50 rows`)
    })

    it(`does not render pagination for small datasets`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data, // Only 3 rows
          columns: sample_columns,
          pagination: { page_size: 10 },
        },
      })

      // Pagination should not appear when data fits on one page
      const pagination = document.querySelector(`.pagination`)
      expect(pagination).toBeNull()
    })
  })

  it(`renders resize handles on headers with correct ARIA role`, () => {
    mount(HeatmapTable, {
      target: document.body,
      props: { data: sample_data, columns: sample_columns },
    })

    const resize_handles = document.querySelectorAll(`.resize-handle`)
    expect(resize_handles).toHaveLength(3) // One per column
    expect(resize_handles[0].getAttribute(`role`)).toBe(`separator`)
    expect(resize_handles[0].getAttribute(`aria-orientation`)).toBe(`vertical`)
  })

  describe(`Regression tests for bug fixes`, () => {
    it(`row.class renders correctly, never outputs 'undefined' string`, () => {
      // Regression: String(undefined) returns "undefined", not undefined
      const data = [
        { Model: `Model A`, Score: 0.95, Value: 100, class: `custom-row` },
        { Model: `Model B`, Score: 0.85, Value: 200 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: sample_columns },
      })

      const rows = document.querySelectorAll(`tbody tr`)
      expect(rows[0].classList.contains(`custom-row`)).toBe(true)
      for (const row of Array.from(rows)) {
        expect(row.getAttribute(`class`)).not.toContain(`undefined`)
      }
    })

    it(`sort_hint renders as string with default position bottom`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          sort_hint: `Click to sort`,
        },
      })

      const hint = document.querySelector(`.sort-hint`)
      expect(hint).not.toBeNull()
      expect(hint?.textContent).toBe(`Click to sort`)
      // Should not have permanent class by default
      expect(hint?.classList.contains(`permanent`)).toBe(false)
    })

    it(`sort_hint does not render when undefined`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
        },
      })

      const hint = document.querySelector(`.sort-hint`)
      expect(hint).toBeNull()
    })

    it(`sort_hint renders with object config and permanent class`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          sort_hint: { text: `Sort hint text`, position: `top`, permanent: true },
        },
      })

      const hint = document.querySelector(`.sort-hint`)
      expect(hint).not.toBeNull()
      expect(hint?.textContent).toBe(`Sort hint text`)
      expect(hint?.classList.contains(`permanent`)).toBe(true)
    })

    it.each([`top`, `bottom`] as const)(
      `sort_hint position=%s renders hint in correct location`,
      (position) => {
        mount(HeatmapTable, {
          target: document.body,
          props: {
            data: sample_data,
            columns: sample_columns,
            sort_hint: { text: `Positioned hint`, position },
          },
        })

        const container = document.querySelector(`.table-container`)
        const table_scroll = container?.querySelector(`.table-scroll`)
        const hint = container?.querySelector(`.sort-hint`)

        expect(hint).not.toBeNull()
        expect(table_scroll).not.toBeNull()
        expect(hint?.textContent).toBe(`Positioned hint`)

        // Check relative order in the DOM
        if (hint && table_scroll) {
          if (position === `top`) {
            // Hint should come before the table-scroll div
            expect(hint.compareDocumentPosition(table_scroll)).toBe(
              Node.DOCUMENT_POSITION_FOLLOWING,
            )
          } else {
            // Hint should come after the table-scroll div
            expect(hint.compareDocumentPosition(table_scroll)).toBe(
              Node.DOCUMENT_POSITION_PRECEDING,
            )
          }
        }
      },
    )

    it(`sort_hint applies custom style, class, position, and permanent together`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          sort_hint: {
            text: `Full config hint`,
            position: `top`,
            permanent: true,
            style: `font-weight: bold; color: red;`,
            class: `custom-hint-class another-class`,
          },
        },
      })

      const container = document.querySelector(`.table-container`)
      const table_scroll = container?.querySelector(`.table-scroll`)
      const hint = container?.querySelector(`.sort-hint`)

      expect(hint).not.toBeNull()
      expect(hint?.textContent).toBe(`Full config hint`)
      expect(hint?.classList.contains(`permanent`)).toBe(true)
      expect(hint?.classList.contains(`custom-hint-class`)).toBe(true)
      expect(hint?.classList.contains(`another-class`)).toBe(true)
      expect(hint?.getAttribute(`style`)).toContain(`font-weight: bold`)
      expect(hint?.getAttribute(`style`)).toContain(`color: red`)
      // Hint should be above table (position: top)
      if (hint && table_scroll) {
        expect(hint.compareDocumentPosition(table_scroll)).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        )
      }
    })

    it(`correctly matches grouped columns for sorting`, async () => {
      // Regression test: ungrouped column matching was incorrect
      const grouped_columns: Label[] = [
        { label: `Name`, description: `` },
        { label: `Value`, group: `Group A`, description: `` },
        { label: `Value`, group: `Group B`, description: `` }, // Same label, different group
      ]

      const data = [
        { Name: `Item 1`, 'Value (Group A)': 10, 'Value (Group B)': 100 },
        { Name: `Item 2`, 'Value (Group A)': 20, 'Value (Group B)': 50 },
        { Name: `Item 3`, 'Value (Group A)': 5, 'Value (Group B)': 75 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: grouped_columns },
      })

      // Click on the second "Value" header (Group B)
      const headers = document.querySelectorAll(`thead tr:last-child th`)
      const group_b_header = headers[2] as HTMLElement
      expect(group_b_header).toBeDefined()
      expect(group_b_header.textContent).toContain(`Value`)

      group_b_header.click()
      await tick()

      // Should sort by Group B values (100, 50, 75)
      // data-col="Value" is used for both groups, so check Name column order instead
      const sorted_names = Array.from(
        document.querySelectorAll(`td[data-col="Name"]`),
      ).map((cell) => cell.textContent?.trim())
      // Group B values: Item 1=100, Item 2=50, Item 3=75
      // Default sort is descending: Item 1 (100), Item 3 (75), Item 2 (50)
      expect(sorted_names).toEqual([`Item 1`, `Item 3`, `Item 2`])
    })

    // Regression: zero and negative values should be included in linear scale heatmap
    it.each([
      { desc: `zero values`, values: [0, 50, 100] },
      { desc: `negative values`, values: [-100, 0, 100] },
    ])(`heatmap works with $desc for linear scale`, ({ values }) => {
      const data = values.map((val, idx) => ({
        Name: String.fromCharCode(65 + idx),
        Value: val,
      }))
      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: [{ label: `Name`, description: `` }, heatmap_col] },
      })

      for (const cell of Array.from(document.querySelectorAll(`td[data-col="Value"]`))) {
        expect(cell.getAttribute(`style`) ?? ``).toContain(`--cell-bg:`)
      }
    })

    // Note: Tests involving search input filtering are skipped in happy-dom due to:
    // 1. happy-dom doesn't fully support getAnimations() for animate:flip directive
    // 2. Svelte 5's bind:value requires native input simulation that happy-dom doesn't support
    // The strip_html functionality is tested in tests/vitest/table/index.test.ts
  })

  describe(`Async Sort Feature`, () => {
    const initial_data = [
      { Model: `Model A`, Score: 0.95, Value: 100 },
      { Model: `Model B`, Score: 0.85, Value: 200 },
      { Model: `Model C`, Score: 0.75, Value: 300 },
    ]

    describe(`onsort callback prop`, () => {
      it(`calls onsort with correct column and direction`, async () => {
        const onsort_mock = vi.fn().mockResolvedValue(initial_data)

        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, onsort: onsort_mock },
        })

        const headers = document.querySelectorAll(`th`)

        // Score has better: higher, so first click = desc
        headers[1].click()
        await tick()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenCalledWith(`Score`, `desc`))

        // Value has better: lower, so first click = asc
        headers[2].click()
        await tick()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenCalledWith(`Value`, `asc`))
      })

      it(`toggles sort direction on subsequent clicks`, async () => {
        const onsort_mock = vi.fn().mockResolvedValue(initial_data)
        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, onsort: onsort_mock },
        })

        const score_header = document.querySelectorAll(`th`)[1]

        // First click = desc (better: higher), second = asc, third = desc
        score_header.click()
        await vi.waitFor(() =>
          expect(onsort_mock).toHaveBeenLastCalledWith(`Score`, `desc`)
        )
        score_header.click()
        await vi.waitFor(() =>
          expect(onsort_mock).toHaveBeenLastCalledWith(`Score`, `asc`)
        )
        score_header.click()
        await vi.waitFor(() =>
          expect(onsort_mock).toHaveBeenLastCalledWith(`Score`, `desc`)
        )
        expect(onsort_mock).toHaveBeenCalledTimes(3)
      })

      it(`updates data with resolved Promise value`, async () => {
        const server_data = [
          { Model: `Server A`, Score: 0.99, Value: 999 },
          { Model: `Server B`, Score: 0.88, Value: 888 },
          { Model: `Server C`, Score: 0.77, Value: 777 },
        ]
        const onsort_mock = vi.fn().mockResolvedValue(server_data)
        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, onsort: onsort_mock },
        })

        const table = document.body.lastElementChild as HTMLElement
        const tbody = table.querySelector(`tbody`)

        table.querySelectorAll(`th`)[1].click()
        await tick()

        await vi.waitFor(() => {
          const models = Array.from(tbody?.querySelectorAll(`td[data-col="Model"]`) ?? [])
            .map((cell) => cell.textContent?.trim())
          expect(models).toEqual([`Server A`, `Server B`, `Server C`])
        })
      })

      it(`does not call onsort for Shift+click or unsortable columns`, async () => {
        const onsort_mock = vi.fn().mockResolvedValue(initial_data)
        const cols: Label[] = [
          { label: `Model`, sortable: false, description: `` },
          { label: `Score`, better: `higher`, description: `` },
        ]
        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: cols, onsort: onsort_mock },
        })

        const headers = document.querySelectorAll(`th`)

        // Click unsortable column
        headers[0].click()
        await tick()
        expect(onsort_mock).not.toHaveBeenCalled()

        // Shift+click for multi-sort
        headers[1].dispatchEvent(
          new MouseEvent(`click`, { shiftKey: true, bubbles: true }),
        )
        await tick()
        expect(onsort_mock).not.toHaveBeenCalled()
      })

      it(`works with grouped columns`, async () => {
        const onsort_mock = vi.fn().mockResolvedValue(initial_data)
        const grouped_columns: Label[] = [
          { label: `Name`, description: `` },
          { label: `Value`, group: `Group A`, description: `` },
          { label: `Value`, group: `Group B`, description: `` },
        ]
        mount(HeatmapTable, {
          target: document.body,
          props: {
            data: [
              { Name: `Item 1`, 'Value (Group A)': 10, 'Value (Group B)': 100 },
              { Name: `Item 2`, 'Value (Group A)': 20, 'Value (Group B)': 50 },
            ],
            columns: grouped_columns,
            onsort: onsort_mock,
          },
        })

        // Click on Group B's "Value" header
        const headers = document.querySelectorAll(`thead tr:last-child th`)
        ;(headers[2] as HTMLElement).click()
        await tick()

        await vi.waitFor(() =>
          expect(onsort_mock).toHaveBeenCalledWith(`Value (Group B)`, expect.any(String))
        )
      })
    })

    describe(`loading state`, () => {
      it.each([
        [true, `shows overlay and spinner`],
        [false, `hides overlay`],
      ])(`loading=%s %s`, (loading) => {
        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, loading },
        })
        const container = document.body.lastElementChild as HTMLElement
        const overlay = container.querySelector(`.loading-overlay`)
        if (loading) {
          expect(overlay).not.toBeNull()
          expect(container.querySelector(`.loading-spinner`)).not.toBeNull()
          expect(getComputedStyle(overlay as HTMLElement).position).toBe(`absolute`)
        } else {
          expect(overlay).toBeNull()
        }
      })

      it(`manages loading state during async onsort`, async () => {
        let resolve_sort!: (value: typeof initial_data) => void
        const onsort_mock = vi.fn().mockReturnValue(
          new Promise<typeof initial_data>((resolve) => {
            resolve_sort = resolve
          }),
        )
        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, onsort: onsort_mock },
        })

        const container = document.body.lastElementChild as HTMLElement
        expect(container.querySelector(`.loading-overlay`)).toBeNull()

        container.querySelectorAll(`th`)[1].click()
        await tick()
        expect(container.querySelector(`.loading-overlay`)).not.toBeNull()

        resolve_sort(initial_data)
        await tick()
        await vi.waitFor(() =>
          expect(container.querySelector(`.loading-overlay`)).toBeNull()
        )
      })
    })

    describe(`sort_data prop`, () => {
      it.each([
        {
          sort_data: false,
          expected_order: [`X`, `Y`, `Z`],
          desc: `preserves original order`,
        },
        { sort_data: true, expected_order: [`Z`, `Y`, `X`], desc: `sorts client-side` },
      ])(`sort_data=$sort_data $desc`, async ({ sort_data, expected_order }) => {
        const unsorted = [
          { Model: `X`, Score: 0.10, Value: 100 },
          { Model: `Y`, Score: 0.50, Value: 200 },
          { Model: `Z`, Score: 0.90, Value: 300 },
        ]
        mount(HeatmapTable, {
          target: document.body,
          props: { data: unsorted, columns: sample_columns, sort_data },
        })

        const table = document.body.lastElementChild as HTMLElement
        table.querySelectorAll(`th`)[1].click()
        await tick()

        const models = Array.from(table.querySelectorAll(`td[data-col="Model"]`))
          .map((cell) => cell.textContent?.trim())
        expect(models).toEqual(expected_order)
      })

      it(`onsort implicitly disables client-side sorting`, async () => {
        // Server returns data in "wrong" order that client-side would re-sort if not disabled
        // Score column has better: higher, so client would sort desc (C=0.99, B=0.88, A=0.77)
        // But server returns A, B, C - if onsort skips client sort, this order stays
        const server_ordered = [
          { Model: `A`, Score: 0.77, Value: 100 },
          { Model: `B`, Score: 0.88, Value: 200 },
          { Model: `C`, Score: 0.99, Value: 300 },
        ]
        const onsort_mock = vi.fn().mockResolvedValue(server_ordered)
        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, onsort: onsort_mock },
        })

        const table = document.body.lastElementChild as HTMLElement
        table.querySelectorAll(`th`)[1].click()
        await tick()

        await vi.waitFor(() => {
          const models = Array.from(table.querySelectorAll(`td[data-col="Model"]`))
            .map((cell) => cell.textContent?.trim())
          // Server order preserved (A, B, C), NOT client-side sorted (C, B, A)
          expect(models).toEqual([`A`, `B`, `C`])
        })
      })
    })

    describe(`integration scenarios`, () => {
      it(`sort hint works with onsort`, () => {
        mount(HeatmapTable, {
          target: document.body,
          props: {
            data: initial_data,
            columns: sample_columns,
            onsort: vi.fn().mockResolvedValue(initial_data),
            sort_hint: { text: `Server-side sort`, permanent: true },
          },
        })

        const hint = document.querySelector(`.sort-hint`)
        expect(hint?.textContent).toContain(`Server-side sort`)
        expect(hint?.classList.contains(`permanent`)).toBe(true)
      })

      it(`other features work with async sort props`, () => {
        const paginated_data = Array.from({ length: 50 }, (_, idx) => ({
          Model: `Model ${idx + 1}`,
          Score: Math.random(),
          Value: idx * 10,
        }))
        mount(HeatmapTable, {
          target: document.body,
          props: {
            data: paginated_data,
            columns: sample_columns,
            onsort: vi.fn().mockResolvedValue(paginated_data),
            pagination: { page_size: 10 },
            search: { expanded: true },
            sort_data: false,
          },
        })

        const table = document.body.lastElementChild as HTMLElement

        // Pagination works
        expect(table.querySelector(`.pagination`)).not.toBeNull()
        expect(table.querySelectorAll(`tbody tr`)).toHaveLength(10)

        // Search works
        expect(table.querySelector(`input[type="search"]`)).not.toBeNull()

        // Column reorder works (headers are draggable)
        expect(table.querySelector(`th`)?.getAttribute(`draggable`)).toBe(`true`)
      })

      it(`handles race condition: stale responses are ignored`, async () => {
        // Simulate two async sorts where the first resolves after the second
        let resolve_first!: (value: typeof initial_data) => void
        let resolve_second!: (value: typeof initial_data) => void

        const first_data = [{ Model: `First`, Score: 0.1, Value: 1 }]
        const second_data = [{ Model: `Second`, Score: 0.2, Value: 2 }]

        let call_count = 0
        const onsort_mock = vi.fn().mockImplementation(() => {
          call_count++
          if (call_count === 1) {
            return new Promise((resolve) => {
              resolve_first = resolve
            })
          }
          return new Promise((resolve) => {
            resolve_second = resolve
          })
        })

        mount(HeatmapTable, {
          target: document.body,
          props: { data: initial_data, columns: sample_columns, onsort: onsort_mock },
        })

        const table = document.body.lastElementChild as HTMLElement
        const headers = table.querySelectorAll(`th`)

        // Click first column (starts first async sort)
        headers[1].click()
        await tick()

        // Click second column before first resolves (starts second async sort)
        headers[2].click()
        await tick()

        expect(onsort_mock).toHaveBeenCalledTimes(2)

        // Resolve second request first
        resolve_second(second_data)
        await tick()

        // Now resolve first (stale) request
        resolve_first(first_data)
        await tick()

        // Data should show second_data, not first_data (stale response ignored)
        await vi.waitFor(() => {
          const models = Array.from(table.querySelectorAll(`td[data-col="Model"]`))
            .map((cell) => cell.textContent?.trim())
          expect(models).toEqual([`Second`])
        })
      })

      it(`reverts sort state on onsort callback failure`, async () => {
        // First call succeeds, second call fails
        const onsort_mock = vi.fn()
          .mockResolvedValueOnce(initial_data) // First sort succeeds
          .mockRejectedValueOnce(new Error(`Network error`)) // Second sort fails

        mount(HeatmapTable, {
          target: document.body,
          props: {
            data: initial_data,
            columns: sample_columns,
            onsort: onsort_mock,
          },
        })

        const headers = document.querySelectorAll(`th`)

        // First sort by Model (succeeds)
        headers[0].click()
        await tick()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenCalledTimes(1))

        // Verify Model is sorted (check aria-sort attribute)
        expect(headers[0].getAttribute(`aria-sort`)).not.toBe(`none`)

        // Now click Score (will fail)
        headers[1].click()
        await tick()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenCalledTimes(2))

        // Sort state should revert to Model after failure (Score should be unsorted)
        await vi.waitFor(() => {
          expect(headers[1].getAttribute(`aria-sort`)).toBe(`none`)
          expect(headers[0].getAttribute(`aria-sort`)).not.toBe(`none`)
        })
      })

      it(`calls onsorterror callback with error details on failure`, async () => {
        const error = new Error(`Server unavailable`)
        const onsort_mock = vi.fn().mockRejectedValue(error)
        const onsorterror_mock = vi.fn()

        mount(HeatmapTable, {
          target: document.body,
          props: {
            data: initial_data,
            columns: sample_columns,
            onsort: onsort_mock,
            onsorterror: onsorterror_mock,
          },
        })

        // Click Score header (better: higher → first click = desc)
        document.querySelectorAll(`th`)[1].click()
        await tick()

        await vi.waitFor(() => {
          expect(onsorterror_mock).toHaveBeenCalledTimes(1)
          expect(onsorterror_mock).toHaveBeenCalledWith(error, `Score`, `desc`)
        })
      })
    })
  })
})
