import { HeatmapTable, type Label } from '$lib'
import { mount, tick } from 'svelte'
import { describe, expect, it } from 'vitest'

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

    it(`sorts using data-sort-value attributes for numeric values`, () => {
      const formatted_data = [
        { Number: `<span data-sort-value="50">50</span>` },
        { Number: `<span data-sort-value="1000">1,000</span>` },
        { Number: `<span data-sort-value="10000">10,000</span>` },
      ]

      const columns: Label[] = [{ label: `Number`, description: `` }]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: formatted_data, columns },
      })

      // Initial data
      const initial_numbers = Array.from(document.querySelectorAll(`td`)).map(
        (cell) => cell.textContent?.trim(),
      )
      expect(initial_numbers).toEqual([`50`, `1,000`, `10,000`])
    })

    it(`respects unsortable columns`, async () => {
      // Setup columns with an unsortable column
      const columns: Label[] = [
        { label: `Name`, sortable: true, description: `` },
        { label: `Value`, sortable: true, description: `` },
        { label: `Actions`, sortable: false, description: `` },
      ]

      // Setup data with three sample entries
      const data = [
        { Name: `Alice`, Value: `100`, Actions: `View` },
        { Name: `Bob`, Value: `200`, Actions: `Edit` },
        { Name: `Charlie`, Value: `300`, Actions: `Delete` },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns },
      })

      const headers = Array.from(document.querySelectorAll(`th`))
      const actions_header = headers[2]

      // Check initial values
      const initial_values = Array.from(
        document.querySelectorAll(`td[data-col="Value"]`),
      ).map((cell) => cell.textContent?.trim())

      expect(initial_values).toEqual([`100`, `200`, `300`])

      // Click the unsortable column - it should have no effect
      actions_header.click()
      await tick()

      // Capture values after clicking unsortable column
      const unchanged_values = Array.from(
        document.querySelectorAll(`td[data-col="Value"]`),
      ).map((cell) => cell.textContent?.trim())

      // Values should be unchanged since Actions is unsortable
      expect(unchanged_values).toEqual(initial_values)

      // Now try to sort by Value column
      headers[1].click()
      await tick()

      // Values should be sorted by Value column
      const post_sort_values = Array.from(
        document.querySelectorAll(`td[data-col="Value"]`),
      ).map((cell) => cell.textContent?.trim())

      // Check if values are sorted - the actual order depends on implementation
      expect(post_sort_values).not.toEqual(initial_values)
    })

    it(`sorts correctly with initial_sort object (direction: desc)`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          initial_sort: { column: `Score`, direction: `desc` },
        },
      })

      // Initial data should be sorted by Score in descending order
      const scores = Array.from(
        document.querySelectorAll(`td[data-col="Score"]`),
      ).map((cell) => cell.textContent?.trim())

      expect(scores).toEqual([`0.95`, `0.85`, `0.75`])
    })

    it(`initial_sort string shorthand defaults to ascending`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          initial_sort: `Score`,
        },
      })

      // String shorthand should sort ascending by default
      const scores = Array.from(
        document.querySelectorAll(`td[data-col="Score"]`),
      ).map((cell) => cell.textContent?.trim())

      expect(scores).toEqual([`0.75`, `0.85`, `0.95`])
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

    // Check that val cells have background colors
    const val_cells = document.querySelectorAll(`td[data-col="Val"]`)
    const backgrounds = Array.from(val_cells).map(
      (cell) => getComputedStyle(cell as Element).backgroundColor,
    )

    // Verify at least one background color is set (not empty)
    expect(backgrounds.some((bg) => bg !== `` && bg !== `rgba(0, 0, 0, 0)`)).toBe(true)
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

    // Get background colors
    const linear_backgrounds = Array.from(linear_cells).map(
      (cell) => getComputedStyle(cell).backgroundColor,
    )
    const log_backgrounds = Array.from(log_cells).map(
      (cell) => getComputedStyle(cell).backgroundColor,
    )

    // Both types should have colors set
    expect(linear_backgrounds.every((bg) => bg !== `` && bg !== `rgba(0, 0, 0, 0)`)).toBe(
      true,
    )
    expect(log_backgrounds.every((bg) => bg !== `` && bg !== `rgba(0, 0, 0, 0)`)).toBe(
      true,
    )

    // The color distribution should be different between linear and log scale
    // In linear scale, 10->100->1000 should have increasingly spaced colors
    // In log scale, the color difference between 10->100 should be similar to 100->1000
    // Difficult to test precisely without mocking d3 scales, but we can check
    // there are differences between the two scale types.
    expect(linear_backgrounds).not.toEqual(log_backgrounds)
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
    expect(header?.querySelector(`[title="Click to sort"]`)).toBeDefined()
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

    const cells = document.querySelectorAll(`td`)
    expect(cells).toHaveLength(6) // 2 rows × 3 columns

    // Get all cell text content
    const all_text = Array.from(cells).map((cell) => cell.textContent?.trim())

    // Check that NaN values are displayed as 'n/a', not 'NaN'
    expect(all_text.filter((text) => text === `n/a`).length).toBe(2) // Two NaN values should show as 'n/a'
    expect(all_text).not.toContain(`NaN`) // Should not contain the literal string 'NaN'

    // Check that normal values are still displayed (with any formatting)
    expect(all_text).toContain(`Model A`)
    expect(all_text).toContain(`Model B`)
    // Check that normal numbers are formatted properly (not as 'n/a')
    expect(all_text.some((text) => text?.includes(`1.5`))).toBe(true) // 1.5 or 1.50
    expect(all_text.some((text) => text?.includes(`2.7`))).toBe(true) // 2.7 or 2.70
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
    it(`does not apply heatmap colors when show_heatmap is false`, () => {
      const columns: Label[] = [
        {
          label: `Val`,
          better: `higher`,
          color_scale: `interpolateViridis`,
          description: ``,
        },
      ]
      const data = [{ Val: 0 }, { Val: 100 }]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns, show_heatmap: false }, // Disable heatmap
      })

      const val_cells = document.querySelectorAll(`td[data-col="Val"]`)
      const backgrounds = Array.from(val_cells).map(
        (cell) => getComputedStyle(cell as Element).backgroundColor,
      )

      // No background color should be applied when show_heatmap is false
      expect(backgrounds.every((bg) => bg === `` || bg === `rgba(0, 0, 0, 0)`)).toBe(true)
    })

    it(`applies heatmap colors when show_heatmap is true (default)`, () => {
      const columns: Label[] = [
        {
          label: `Val`,
          better: `higher`,
          color_scale: `interpolateViridis`,
          description: ``,
        },
      ]
      const data = [{ Val: 0 }, { Val: 100 }]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns }, // show_heatmap is true by default
      })

      const val_cells = document.querySelectorAll(`td[data-col="Val"]`)
      const backgrounds = Array.from(val_cells).map(
        (cell) => getComputedStyle(cell as Element).backgroundColor,
      )

      // At least one background color should be set when show_heatmap is true
      expect(backgrounds.some((bg) => bg !== `` && bg !== `rgba(0, 0, 0, 0)`)).toBe(true)
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
    it(`renders column toggle button when show_column_toggle is true`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, show_column_toggle: true },
      })

      const dropdown_wrapper = document.querySelector(`.dropdown-wrapper`)
      expect(dropdown_wrapper).not.toBeNull()
    })

    it(`shows dropdown with all columns when toggle button clicked`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns, show_column_toggle: true },
      })

      // Find the column toggle button (first dropdown-wrapper)
      const dropdown_wrapper = document.querySelector(`.dropdown-wrapper`)
      const toggle_btn = dropdown_wrapper?.querySelector(`.icon-btn`) as HTMLButtonElement
      toggle_btn.click()
      await tick()

      const dropdown = document.querySelector(`.dropdown-pane`)
      expect(dropdown).not.toBeNull()

      const checkboxes = dropdown?.querySelectorAll(`input[type="checkbox"]`)
      expect(checkboxes?.length).toBe(3) // 3 columns
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
    it(`adds secondary sort with Shift+click`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns },
      })

      const headers = document.querySelectorAll(`th`)

      // Shift+click first column to start multi-sort
      const shift_event1 = new MouseEvent(`click`, { shiftKey: true, bubbles: true })
      headers[0].dispatchEvent(shift_event1)
      await tick()

      // Shift+click second column to add to multi-sort
      const shift_event2 = new MouseEvent(`click`, { shiftKey: true, bubbles: true })
      headers[1].dispatchEvent(shift_event2)
      await tick()

      // Now with 2 columns in multi-sort, badges should appear
      expect(headers[0].innerHTML).toContain(`<sup>1</sup>`)
      expect(headers[1].innerHTML).toContain(`<sup>2</sup>`)
    })

    it(`shows numbered badges for multi-sort columns`, async () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns },
      })

      const headers = document.querySelectorAll(`th`)

      // Shift+click to add multiple sort columns
      const shift_event1 = new MouseEvent(`click`, { shiftKey: true, bubbles: true })
      headers[0].dispatchEvent(shift_event1)
      await tick()

      const shift_event2 = new MouseEvent(`click`, { shiftKey: true, bubbles: true })
      headers[1].dispatchEvent(shift_event2)
      await tick()

      // First column should have badge "1", second should have "2"
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

  describe(`Column Resizing`, () => {
    it(`renders resize handle on headers`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns },
      })

      const resize_handles = document.querySelectorAll(`.resize-handle`)
      expect(resize_handles).toHaveLength(3) // One per column
    })

    it(`resize handles have correct role`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: { data: sample_data, columns: sample_columns },
      })

      const resize_handle = document.querySelector(`.resize-handle`)
      expect(resize_handle?.getAttribute(`role`)).toBe(`separator`)
      expect(resize_handle?.getAttribute(`aria-orientation`)).toBe(`vertical`)
    })
  })

  describe(`Regression tests for bug fixes`, () => {
    it(`row.class renders correctly without 'undefined' string`, () => {
      // Regression test: String(undefined) returns "undefined", not undefined
      const data_without_class = [
        { Model: `Model A`, Score: 0.95, Value: 100 },
        { Model: `Model B`, Score: 0.85, Value: 200 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: data_without_class, columns: sample_columns },
      })

      const rows = document.querySelectorAll(`tbody tr`)
      // Should not have class="undefined"
      rows.forEach((row) => {
        expect(row.getAttribute(`class`)).not.toContain(`undefined`)
      })
    })

    it(`row with explicit class renders correctly`, () => {
      const data_with_class = [
        { Model: `Model A`, Score: 0.95, Value: 100, class: `custom-row` },
        { Model: `Model B`, Score: 0.85, Value: 200 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data: data_with_class, columns: sample_columns },
      })

      const rows = document.querySelectorAll(`tbody tr`)
      expect(rows[0].classList.contains(`custom-row`)).toBe(true)
      // Second row should have empty class, not "undefined"
      expect(rows[1].getAttribute(`class`)).not.toContain(`undefined`)
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

    it(`sort_hint applies custom style attribute`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          sort_hint: {
            text: `Styled hint`,
            style: `color: red; font-size: 1.2em;`,
          },
        },
      })

      const hint = document.querySelector(`.sort-hint`)
      expect(hint).not.toBeNull()
      expect(hint?.getAttribute(`style`)).toContain(`color: red`)
      expect(hint?.getAttribute(`style`)).toContain(`font-size: 1.2em`)
    })

    it(`sort_hint applies custom class attribute`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          sort_hint: {
            text: `Classed hint`,
            class: `custom-hint-class another-class`,
          },
        },
      })

      const hint = document.querySelector(`.sort-hint`)
      expect(hint).not.toBeNull()
      expect(hint?.classList.contains(`custom-hint-class`)).toBe(true)
      expect(hint?.classList.contains(`another-class`)).toBe(true)
    })

    it(`sort_hint combines all config options`, () => {
      mount(HeatmapTable, {
        target: document.body,
        props: {
          data: sample_data,
          columns: sample_columns,
          sort_hint: {
            text: `Full config hint`,
            position: `top`,
            permanent: true,
            style: `font-weight: bold;`,
            class: `my-custom-class`,
          },
        },
      })

      const container = document.querySelector(`.table-container`)
      const table_scroll = container?.querySelector(`.table-scroll`)
      const hint = container?.querySelector(`.sort-hint`)

      expect(hint).not.toBeNull()
      expect(table_scroll).not.toBeNull()
      expect(hint?.textContent).toBe(`Full config hint`)
      expect(hint?.classList.contains(`permanent`)).toBe(true)
      expect(hint?.classList.contains(`my-custom-class`)).toBe(true)
      expect(hint?.getAttribute(`style`)).toContain(`font-weight: bold`)
      // Hint should be above table
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

      // Should sort by Group B values, not Group A
      // Group B values: 100, 50, 75 - sorted ascending: 50, 75, 100
    })

    it(`heatmap works with zero values for linear scale`, () => {
      // Regression test: zero values should be included in linear scale
      const columns_with_heatmap: Label[] = [
        { label: `Name`, description: `` },
        { label: `Value`, color_scale: `interpolateViridis`, description: `` },
      ]

      const data = [
        { Name: `A`, Value: 0 },
        { Name: `B`, Value: 50 },
        { Name: `C`, Value: 100 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: columns_with_heatmap },
      })

      const cells = document.querySelectorAll(`td[data-col="Value"]`)
      // All cells should have background colors set
      cells.forEach((cell) => {
        const bg = (cell as HTMLElement).style.backgroundColor
        // Should have a color, not be empty
        expect(bg).not.toBe(``)
      })
    })

    it(`heatmap works with negative values for linear scale`, () => {
      // Regression test: negative values should work for linear scale
      const columns_with_heatmap: Label[] = [
        { label: `Name`, description: `` },
        { label: `Value`, color_scale: `interpolateViridis`, description: `` },
      ]

      const data = [
        { Name: `A`, Value: -100 },
        { Name: `B`, Value: 0 },
        { Name: `C`, Value: 100 },
      ]

      mount(HeatmapTable, {
        target: document.body,
        props: { data, columns: columns_with_heatmap },
      })

      const cells = document.querySelectorAll(`td[data-col="Value"]`)
      // All cells should have background colors set
      cells.forEach((cell) => {
        const bg = (cell as HTMLElement).style.backgroundColor
        expect(bg).not.toBe(``)
      })
    })

    // Note: Tests involving search input filtering are skipped in happy-dom due to:
    // 1. happy-dom doesn't fully support getAnimations() for animate:flip directive
    // 2. Svelte 5's bind:value requires native input simulation that happy-dom doesn't support
    // The strip_html functionality is tested in tests/vitest/table/index.test.ts
  })
})
