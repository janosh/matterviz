import { HeatmapTable, type Label, type RowData } from '$lib'
import { type ComponentProps, mount, tick } from 'svelte'
import { assert, describe, expect, it, vi } from 'vitest'
import { bind_props } from '../setup'

const mount_table = (props: ComponentProps<typeof HeatmapTable>): unknown =>
  mount(HeatmapTable, { target: document.body, props })

/** Trimmed text of every cell in the given column. */
const col_values = (col_name: string): (string | undefined)[] =>
  [...document.querySelectorAll(`td[data-col="${col_name}"]`)].map((cell) =>
    cell.textContent?.trim(),
  )

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

  // 50-row dataset shared by Pagination, Page Size Selector, and async-sort tests.
  // Scores are deterministic but shuffled (37 is coprime to 50, so all distinct)
  const large_data = Array.from({ length: 50 }, (_, idx) => ({
    Model: `Model ${idx + 1}`,
    Score: ((idx * 37) % 50) / 50,
    Value: idx * 10,
  }))

  const open_export_menu = async (): Promise<void> => {
    ;(document.querySelector(`.dropdown-wrapper .icon-btn`) as HTMLButtonElement).click()
    await tick()
  }

  it(`renders table with correct structure and handles hidden columns`, () => {
    const columns = [...sample_columns, { label: `Hidden`, visible: false, description: `` }]
    mount_table({ data: sample_data, columns })

    const headers = document.querySelectorAll(`th`)
    expect(headers).toHaveLength(3)
    expect(
      Array.from(headers).map((header) => header.textContent?.replaceAll(/\s+/g, ` `).trim()),
    ).toEqual([`Model`, `Score`, `Value`])

    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
    expect(document.querySelectorAll(`td[data-col="Hidden"]`)).toHaveLength(0)
  })

  it(`re-wires cell tooltips after cells re-render`, async () => {
    const cell = (text: string, tip: string) => `<span title="${tip}">${text}</span>`
    const rows: RowData[] = $state([
      { Model: cell(`alpha`, `tip alpha v1`), Score: 1 },
      { Model: cell(`beta`, `tip beta v1`), Score: 2 },
    ])
    const columns: Label[] = [
      { label: `Model`, description: `` },
      { label: `Score`, description: `` },
    ]
    mount_table({ data: rows, columns })
    await tick()

    const alpha_orig = () =>
      [...document.querySelectorAll(`td[data-col="Model"] span`)]
        .find((el) => el.textContent === `alpha`)
        ?.getAttribute(`data-original-title`)

    // tooltip() wires a cell by moving its title -> data-original-title
    expect(alpha_orig()).toBe(`tip alpha v1`)

    // mutating the cell value re-renders it, replacing the <span>. A one-time tooltip
    // scan would miss the new node; table_tooltips must re-wire it on DOM mutation.
    rows[0].Model = cell(`alpha`, `tip alpha v2`)
    await tick()
    // re-wiring happens in a MutationObserver microtask, so poll until it lands
    await vi.waitFor(() => expect(alpha_orig()).toBe(`tip alpha v2`))
  })

  it(`handles empty data and filters undefined rows`, async () => {
    const state = $state({ data: [{ Model: undefined, Score: undefined }, ...sample_data] })

    mount_table(bind_props({ columns: sample_columns }, state))

    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)

    state.data = []
    await tick()
    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(1)
  })

  describe(`Sorting and Data Updates`, () => {
    it(`sorts correctly and handles missing values`, async () => {
      const data = [
        { Model: `A`, Score: undefined, Value: 100 },
        { Model: `B`, Score: 0.85, Value: undefined },
        { Model: `C`, Score: 0.75, Value: 300 },
      ]

      mount_table({ data, columns: sample_columns })

      // Test initial sort
      const value_header = document.querySelectorAll(`th`)[2]
      value_header.click()
      await tick()

      expect(col_values(`Value`)).toEqual([`100`, `300`, `n/a`])

      // Test sort direction toggle
      value_header.click()
      await tick()
      expect(col_values(`Value`)).toEqual([`300`, `100`, `n/a`])
    })

    it(`maintains sort state on data updates`, async () => {
      const state = $state({ data: sample_data })
      mount_table(bind_props({ columns: sample_columns }, state))

      const score_header = document.querySelectorAll(`th`)[1]
      score_header.click() // Sort by Score
      await tick()

      state.data = [{ Model: `D`, Score: 0.65, Value: 400 }, ...sample_data]
      await tick()

      expect(col_values(`Score`)).toEqual([`0.95`, `0.85`, `0.75`, `0.65`])
    })

    it(`selects valid date/time column display modes`, async () => {
      const created = new Date(2024, 0, 2, 3, 4)
      const now = new Date(2024, 0, 3, 5, 34).getTime()
      const date_now = vi.spyOn(Date, `now`).mockReturnValue(now)
      try {
        const data = [
          {
            Observed: `2024-01-02`,
            'Start Time': created,
            Created: created,
            Ancient: new Date(2017, 6, 23, 9, 57),
            Unix: new Date(2024, 0, 2, 12, 0).getTime(),
          },
        ]
        const columns: Label[] = [
          { label: `Observed`, description: `` },
          { label: `Start Time`, datetime_format: `time`, description: `` },
          { label: `Created`, datetime_format: `datetime`, description: `` },
          { label: `Ancient`, datetime_format: `datetime`, description: `` },
          { label: `Unix`, format_type: `datetime`, description: `` },
        ]

        mount_table({ data, columns })

        const cells = () =>
          [...document.querySelectorAll(`tbody td`)].map((cell) => cell.textContent?.trim())
        const triggers = document.querySelectorAll<HTMLButtonElement>(
          `.datetime-format-trigger`,
        )
        const options = (select: HTMLSelectElement) =>
          [...select.options].map((option) => option.value)
        const open_select = async (idx: number): Promise<HTMLSelectElement> => {
          if (triggers[idx].getAttribute(`aria-expanded`) !== `true`) {
            triggers[idx].click()
            await tick()
          }
          const select = document.querySelector<HTMLSelectElement>(`.datetime-format-select`)
          expect(select).not.toBeNull()
          return select as HTMLSelectElement
        }
        const select_mode = async (idx: number, value: string) => {
          const select = await open_select(idx)
          select.value = value
          select.dispatchEvent(new Event(`input`, { bubbles: true }))
          await tick()
        }

        expect(cells()).toEqual([
          `2024-01-02`,
          `03:04`,
          `2024-01-02 03:04`,
          `2017-07-23 09:57`,
          `2024-01-02 12:00`,
        ])
        expect(document.querySelector(`.datetime-format-select`)).toBeNull()
        expect([...triggers].map((trigger) => trigger.dataset.mode)).toEqual([
          `date`,
          `time`,
          `datetime`,
          `datetime`,
          `datetime`,
        ])

        expect(options(await open_select(0))).toEqual([`date`, `relative`])
        expect(options(await open_select(1))).toEqual([`time`])
        expect(options(await open_select(2))).toEqual([
          `date`,
          `time`,
          `datetime`,
          `iso`,
          `relative`,
        ])
        const active_select = await open_select(2)
        active_select.click()
        await tick()
        expect(document.querySelector(`.datetime-format-select`)).toBeNull()

        await select_mode(2, `relative`)
        expect(document.querySelector(`.datetime-format-select`)).toBeNull()
        expect(triggers[2].dataset.mode).toBe(`relative`)
        expect(cells()[2]).toBe(`1d 2h 30m ago`)

        await select_mode(3, `relative`)
        expect(cells()[3]).toBe(`6y 5mo 2w ago`)

        await select_mode(2, `time`)
        expect(cells()[2]).toBe(`03:04`)
        expect(cells()[1]).toBe(`03:04`)
      } finally {
        date_now.mockRestore()
      }
    })

    it(`sorts using data-sort-value attributes for numeric values`, async () => {
      const formatted_data = [
        { Number: `<span data-sort-value="1000">1,000</span>` },
        { Number: `<span data-sort-value="50">50</span>` },
        { Number: `<span data-sort-value="10000">10,000</span>` },
      ]

      const columns: Label[] = [{ label: `Number`, description: `` }]

      mount_table({ data: formatted_data, columns })

      // Click to sort ascending by data-sort-value
      document.querySelector(`th`)?.click()
      await tick()

      // Default sort is descending (no `better` set), so largest first
      expect(col_values(`Number`)).toEqual([`10,000`, `1,000`, `50`])
    })

    it(`sorts mixed number/string columns: numbers first, desc reverses`, async () => {
      const data = [`10`, `abc`, `9`, `def`, `2`, `a1`].map((Mixed) => ({ Mixed }))
      const columns: Label[] = [{ label: `Mixed`, description: `` }]
      // string shorthand defaults to asc
      mount_table({ data, columns, initial_sort: `Mixed` })
      await tick()
      expect(col_values(`Mixed`)).toEqual([`2`, `9`, `10`, `a1`, `abc`, `def`])
      document.querySelector(`th`)?.click() // toggle to descending
      await tick()
      expect(col_values(`Mixed`)).toEqual([`def`, `abc`, `a1`, `10`, `9`, `2`])
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

      mount_table({ data, columns })

      const headers = document.querySelectorAll(`th`)

      // Clicking unsortable column has no effect
      headers[2].click()
      await tick()
      expect(col_values(`Value`)).toEqual([`100`, `200`, `300`])

      // Clicking sortable column does sort
      headers[1].click()
      await tick()
      expect(col_values(`Value`)).not.toEqual([`100`, `200`, `300`])
    })

    it.each([
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
    ] as const)(`initial_sort $desc`, ({ initial_sort, expected }) => {
      mount_table({ data: sample_data, columns: sample_columns, initial_sort })

      expect(col_values(`Score`)).toEqual(expected)
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

      mount_table({ data, columns })

      document.querySelectorAll(`th`)[1].click()
      await tick()

      expect(col_values(`Value`)).toEqual(expected)
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

      mount_table({ data, columns: [{ label: `Name`, description: `` }, heatmap_col] })

      const cells = document.querySelectorAll(`td[data-col="Value"]`)
      const style_attrs = Array.from(cells).map((cell) => cell.getAttribute(`style`) ?? ``)

      // All cells should have --cell-bg custom property set (match with colon to avoid partial matches)
      expect(style_attrs.every((style) => style.includes(`--cell-bg:`))).toBe(true)
      // Styles should be different for different values (different d3 colors)
      expect(new Set(style_attrs).size).toBeGreaterThan(1)
    })

    // Per-cell guard: only numeric cells get --cell-bg, strings never do
    it.each([
      {
        desc: `all non-numeric strings`,
        values: [`hello`, `world`, `test`],
        colored: [false, false, false],
      },
      {
        desc: `non-numeric values mixed with numeric`,
        values: [10, `not a number`, 100],
        colored: [true, false, true],
      },
    ])(`does not apply heatmap colors to $desc`, ({ values, colored }) => {
      const data = values.map((val, idx) => ({
        Name: String.fromCharCode(65 + idx),
        Value: val,
      }))

      mount_table({ data, columns: [{ label: `Name`, description: `` }, heatmap_col] })

      const cells = Array.from(document.querySelectorAll(`td[data-col="Value"]`))
      const style_attrs = cells.map((cell) => cell.getAttribute(`style`) ?? ``)
      colored.forEach((has_bg, idx) => {
        if (has_bg) expect(style_attrs[idx]).toContain(`--cell-bg:`)
        else expect(style_attrs[idx]).not.toContain(`--cell-bg:`)
      })
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

    mount_table({ data, columns })

    // Check number formatting
    const num_cell = document.querySelector(`td[data-col="Num"]`)
    assert(num_cell, `Num cell not found`)
    expect(num_cell.textContent?.trim()).toBe(`12.3%`)

    // Check that val cells have --cell-bg set
    const val_cells = document.querySelectorAll(`td[data-col="Val"]`)
    const has_color = Array.from(val_cells).some((cell) =>
      (cell.getAttribute(`style`) ?? ``).includes(`--cell-bg:`),
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

    mount_table({ data, columns: [c1, c2] })

    // Get cells for both columns
    const linear_cells = document.querySelectorAll(`td[data-col="Linear"]`)
    const log_cells = document.querySelectorAll(`td[data-col="Log"]`)

    // Check --cell-bg is set on cells
    const linear_styles = Array.from(linear_cells).map(
      (cell) => cell.getAttribute(`style`) ?? ``,
    )
    const log_styles = Array.from(log_cells).map((cell) => cell.getAttribute(`style`) ?? ``)

    // Both types should have --cell-bg set
    expect(linear_styles.every((style) => style.includes(`--cell-bg:`))).toBe(true)
    expect(log_styles.every((style) => style.includes(`--cell-bg:`))).toBe(true)

    // The color distribution should be different between linear and log scale
    // In linear scale, 10->100->1000 should have increasingly spaced colors
    // In log scale, the color difference between 10->100 should be similar to 100->1000
    // Difficult to test precisely without mocking d3 scales, but we can check
    // there are differences between the two scale types.
    expect(linear_styles).not.toEqual(log_styles)
  })

  it(`handles accessibility features`, () => {
    // sort_hint rendering is covered by the sort_hint it.each in regression tests
    mount_table({
      data: sample_data,
      columns: [{ label: `Col`, description: `Description`, sticky: true }],
    })

    const header = document.querySelector(`th`)
    expect(header?.getAttribute(`title`) ?? header?.getAttribute(`data-title`)).toBe(
      `Description`,
    )
    expect(header?.classList.contains(`sticky-col`)).toBe(true)
  })

  // Missing values displayed as 'n/a', never as literal 'NaN' or 'undefined'
  it.each([
    {
      desc: `undefined values`,
      data: [{ Model: `Empty Model`, Score: undefined, Value: undefined }],
      present: [`Empty Model`],
    },
    {
      desc: `NaN values`,
      data: [
        { Model: `Model A`, Score: 1.5, Value: NaN },
        { Model: `Model B`, Score: NaN, Value: 2.7 },
      ],
      present: [`Model A`, `1.5`, `2.7`],
    },
  ])(`displays $desc as 'n/a'`, ({ data, present }) => {
    mount_table({ data, columns: sample_columns })

    const all_text = Array.from(document.querySelectorAll(`td`)).map((cell) =>
      cell.textContent?.trim(),
    )
    expect(all_text.filter((text) => text === `n/a`)).toHaveLength(2)
    expect(all_text).not.toContain(`NaN`)
    expect(all_text).not.toContain(`undefined`)
    for (const value of present) {
      expect(all_text.some((text) => text?.includes(value))).toBe(true)
    }
  })

  it(`prevents HTML strings from being used as data-sort-value attributes`, () => {
    const html_data = [
      {
        Name: `Test Model`,
        HTML: `<span data-sort-value="100" title="This is a tooltip">100 units</span>`,
        Complex: `<span data-sort-value="3373529" title="Complex tooltip with multiple lines&#013;• Line item 1&#013;• Line item 2">3.37M <small>(details)</small> (<a href="https://example.com">Link</a>)</span>`,
      },
    ]

    const html_columns: Label[] = [
      { label: `Name`, description: `` },
      { label: `HTML`, description: `` },
      { label: `Complex`, description: `` },
    ]

    mount_table({ data: html_data, columns: html_columns })

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
      mount_table({ data, columns: [heatmap_val_col], show_heatmap })

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
      mount_table({ data, columns: [{ label: `Name`, description: `` }, heatmap_val_col] })

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

      mount_table({ data: grouped_data, columns: grouped_columns })

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
        th.textContent?.includes(`Values`),
      )
      const metrics_header = Array.from(group_headers).find((th) =>
        th.textContent?.includes(`Metrics`),
      )
      const second_values_header = Array.from(group_headers).find((th) =>
        th.textContent?.includes(`Second Values`),
      )

      expect(values_header?.getAttribute(`colspan`)).toBe(`2`) // Values spans 2 columns
      expect(metrics_header?.getAttribute(`colspan`)).toBe(`2`) // Metrics spans 2 columns
      expect(second_values_header?.getAttribute(`colspan`)).toBe(`2`) // Second Values spans 2 columns

      // Check column headers in second row
      const col_headers = header_rows[1].querySelectorAll(`th`)
      expect(col_headers).toHaveLength(7)

      // Column headers should have duplicate label names (Value 1, Value 2) rendered for each group
      expect(
        Array.from(col_headers).map((header) =>
          header.textContent?.trim().replaceAll(/\s+|[↑↓]/g, ``),
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

      const mixed_data = [{ Name: `Test`, Regular: 1, 'Group 1': 2, 'Group 2': 3, Another: 4 }]

      mount_table({ data: mixed_data, columns: mixed_columns })

      // Should have two rows in the header
      const header_rows = document.querySelectorAll(`thead tr`)
      expect(header_rows).toHaveLength(2)

      // Check the group header row
      const group_cells = header_rows[0].querySelectorAll(`th`)

      // There should be 4 cells - two empty (for Name and Regular), one for Grouped, and one empty for Another
      expect(group_cells).toHaveLength(4)

      // The Grouped cell should have colspan=2
      const grouped_header = Array.from(group_cells).find((cell) =>
        cell.textContent?.includes(`Grouped`),
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

      mount_table({ data: [{ Col1: `a`, Col2: `b` }], columns: styled_columns })

      const header = document.querySelector(`th`)
      expect(header?.getAttribute(`style`)).toContain(`color: red`)
      expect(header?.getAttribute(`style`)).toContain(`font-weight: lighter`)
      // Check that style is also applied to cells
      const cell = document.querySelector(`td[data-col="Col1"]`)
      expect(cell?.getAttribute(`style`)).toContain(`font-weight: lighter;`)
    })

    it(`applies row styles from data`, () => {
      const data_with_styles = [{ col: `value`, style: `background-color: yellow;` }]

      mount_table({
        data: data_with_styles,
        columns: [{ label: `col`, description: `` }],
      })

      const row = document.querySelector(`tbody tr`)
      expect(row?.getAttribute(`style`)).toContain(`background-color: yellow`)
    })

    it(`applies container style from props`, () => {
      mount_table({
        data: [{ col: `value` }],
        columns: [{ label: `col`, description: `` }],
        style: `max-height: 200px; border: 1px solid blue;`,
      })

      const container = document.querySelector(`.table-container`)
      expect(container?.getAttribute(`style`)).toContain(`max-height: 200px`)
      expect(container?.getAttribute(`style`)).toContain(`border: 1px solid blue`)
    })
  })

  describe(`Search and Filter`, () => {
    const click_search_toggle = async (): Promise<void> => {
      ;(document.querySelector(`.control-buttons .icon-btn`) as HTMLButtonElement).click()
      await tick()
    }

    it.each([
      { desc: `search=true expands input on toggle click`, search: true, click: true },
      {
        desc: `search.placeholder is applied to the input`,
        search: { placeholder: `Search materials...` },
        click: true,
        placeholder: `Search materials...`,
      },
      {
        desc: `search.expanded auto-expands without clicking`,
        search: { expanded: true },
        click: false,
      },
    ])(`$desc`, async ({ search, click, placeholder }) => {
      mount_table({ data: sample_data, columns: sample_columns, search })

      expect(document.querySelector(`.control-buttons .icon-btn`)).not.toBeNull()
      if (click) await click_search_toggle()

      const search_input = document.querySelector(`input[type="search"]`) as HTMLInputElement
      expect(search_input).not.toBeNull()
      if (placeholder) expect(search_input.placeholder).toBe(placeholder)
    })

    // Filtering is tested through the bindable search_query prop (simulating typing
    // via bind:value needs native input events that happy-dom doesn't support).

    it.each([
      [`substring match`, `model b`, [`Model B`]],
      [`html is stripped before matching`, `bold`, [`Model C`]],
      [`no match`, `no-such-model`, []],
      [`empty query returns all rows`, `  `, [`Model A`, `Model B`, `Model C`]],
    ])(`filters rows by search_query: %s`, async (_desc, query, expected) => {
      const state = $state({ search_query: `` })
      const data = [
        { Model: `Model A`, Score: 0.95 },
        { Model: `Model B`, Score: 0.85 },
        { Model: `<b>bold</b> Model C`, Score: 0.75 },
      ]
      mount_table(bind_props({ data, columns: sample_columns, search: true }, state))

      state.search_query = query
      await tick()

      const model_cells = col_values(`Model`)
      expect(model_cells).toHaveLength(expected.length)
      for (const [idx, name] of expected.entries()) {
        expect(model_cells[idx]).toContain(name)
      }
    })

    it(`search.keys restricts matching to the given columns`, async () => {
      const state = $state({ search_query: `` })
      const data = [
        { Model: `Model A`, Note: `great` },
        { Model: `Model B`, Note: `model a lookalike` },
      ]
      const columns: Label[] = [
        { label: `Model`, description: `` },
        { label: `Note`, description: `` },
      ]
      mount_table(bind_props({ data, columns, search: { keys: [`Model`] } }, state))

      state.search_query = `model a`
      await tick()

      // without keys, "model a lookalike" in Note would also match
      expect(col_values(`Model`)).toEqual([`Model A`])
    })

    it.each([
      [true, [`Model A`]], // "mdla" is an in-order subsequence of "model a"
      [false, []],
    ])(`search.fuzzy=%s controls subsequence matching`, async (fuzzy, expected) => {
      const state = $state({ search_query: `` })
      mount_table(
        bind_props({ data: sample_data, columns: sample_columns, search: { fuzzy } }, state),
      )

      state.search_query = `mdla`
      await tick()

      expect(col_values(`Model`)).toEqual(expected)
    })

    it(`clear button resets bound search_query`, async () => {
      const state = $state({ search_query: `model b` })
      mount_table(
        bind_props({ data: sample_data, columns: sample_columns, search: true }, state),
      )
      await tick()
      expect(col_values(`Model`)).toEqual([`Model B`])

      // input is rendered (non-empty query implies expanded); clear button follows it
      const clear_btn = document.querySelector(
        `.control-buttons .icon-btn`,
      ) as HTMLButtonElement
      clear_btn.click()
      await tick()

      expect(state.search_query).toBe(``)
      expect(col_values(`Model`)).toHaveLength(3)
    })

    // Note: Test for closing search skipped due to happy-dom button click handling
    // issues with Svelte 5's onclick handlers
  })

  describe(`Export Functionality`, () => {
    it(`renders export dropdown when export_data is enabled`, async () => {
      mount_table({ data: sample_data, columns: sample_columns, export_data: true })

      // Export dropdown lives in the control buttons row
      expect(
        document.querySelector(`.control-buttons .dropdown-wrapper .icon-btn`),
      ).not.toBeNull()
      await open_export_menu()

      // Should show CSV and JSON options
      const dropdown = document.querySelector(`.dropdown-pane`)
      expect(dropdown?.textContent).toContain(`CSV`)
      expect(dropdown?.textContent).toContain(`JSON`)
    })

    it(`does not render export button when export_data is false`, () => {
      mount_table({ data: sample_data, columns: sample_columns, export_data: false })

      const dropdown_wrappers = document.querySelectorAll(`.dropdown-wrapper`)
      expect(dropdown_wrappers).toHaveLength(0)
    })

    it(`respects export_data.formats to show only specified formats`, async () => {
      mount_table({
        data: sample_data,
        columns: sample_columns,
        export_data: { formats: [`csv`] },
      })
      await open_export_menu()

      const dropdown = document.querySelector(`.dropdown-pane`)
      expect(dropdown?.textContent).toContain(`CSV`)
      expect(dropdown?.textContent).not.toContain(`JSON`)
    })
  })

  describe(`Column Visibility Toggle`, () => {
    it(`renders toggle button and shows dropdown with all columns`, async () => {
      mount_table({ data: sample_data, columns: sample_columns, show_column_toggle: true })

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
      mount_table({ data: sample_data, columns: sample_columns, show_column_toggle: true })

      // Initial: all 3 columns visible
      expect(document.querySelectorAll(`th`)).toHaveLength(3)

      // Open dropdown
      const dropdown_wrapper = document.querySelector(`.dropdown-wrapper`)
      const toggle_btn = dropdown_wrapper?.querySelector(`.icon-btn`) as HTMLButtonElement
      toggle_btn.click()
      await tick()

      // Uncheck first column
      const checkboxes = document.querySelectorAll(`.dropdown-pane input[type="checkbox"]`)
      ;(checkboxes[0] as HTMLInputElement).click()
      await tick()

      // Should now have 2 columns
      expect(document.querySelectorAll(`th`)).toHaveLength(2)
    })
  })

  describe(`Row Selection`, () => {
    const mount_selectable = (): HTMLInputElement[] => {
      mount_table({ data: sample_data, columns: sample_columns, show_row_select: true })
      return [
        ...document.querySelectorAll<HTMLInputElement>(`td.select-col input[type="checkbox"]`),
      ]
    }

    it(`renders one unchecked checkbox per row`, () => {
      const checkboxes = mount_selectable()
      expect(checkboxes).toHaveLength(3)
      expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true)
    })

    it.each([
      { clicks: 1, badge_count: `1` },
      { clicks: 2, badge_count: `2` },
      { clicks: 3, badge_count: `3` }, // all rows selected
    ])(
      `selection badge shows $badge_count after clicking $clicks checkbox(es)`,
      async ({ clicks, badge_count }) => {
        const checkboxes = mount_selectable()
        for (const checkbox of checkboxes.slice(0, clicks)) checkbox.click()
        await tick()

        expect(checkboxes[0].checked).toBe(true)
        const badge = document.querySelector(`.selection-badge .badge`)
        expect(badge?.textContent).toContain(badge_count)
      },
    )

    it(`clears selection when clear button clicked`, async () => {
      mount_selectable()[0].click()
      await tick()

      // Click clear button (now a selection-badge icon-btn)
      const clear_btn = document.querySelector(`.selection-badge`) as HTMLButtonElement
      clear_btn.click()
      await tick()

      expect(document.querySelectorAll(`tr.selected`)).toHaveLength(0)
    })

    it(`header checkbox unchecked on partial selection`, async () => {
      mount_selectable()[0].click()
      await tick()

      expect(document.querySelector(`.selection-badge .badge`)?.textContent).toContain(`1`)
      expect(
        (document.querySelector(`th.select-col input[type="checkbox"]`) as HTMLInputElement)
          .checked,
      ).toBe(false)
    })
  })

  describe(`Multi-Column Sorting`, () => {
    it(`adds secondary sort with Shift+click and shows numbered badges`, async () => {
      mount_table({ data: sample_data, columns: sample_columns })

      const headers = document.querySelectorAll(`th`)

      headers[0].dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
      await tick()
      headers[1].dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
      await tick()

      // With 2 columns in multi-sort, numbered badges should appear
      expect(headers[0].innerHTML).toContain(`<sup>1</sup>`)
      expect(headers[1].innerHTML).toContain(`<sup>2</sup>`)
      expect(headers[0].textContent).toMatch(/[↑↓]/)
      expect(headers[1].textContent).toMatch(/[↑↓]/)
    })

    it(`clears multi-sort on regular click`, async () => {
      mount_table({ data: sample_data, columns: sample_columns })

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

  describe(`Sort Indicator Rendering`, () => {
    const render_table = (
      columns: Label[] = sample_columns,
      data: RowData[] = sample_data,
    ) => {
      mount_table({ data, columns })
      return document.querySelectorAll(`th`)
    }

    it(`does not render arrows for unsorted columns by default`, () => {
      const headers = render_table()
      expect(headers).toHaveLength(3)
      for (const header of Array.from(headers)) {
        expect(header.textContent).not.toMatch(/[↑↓]/)
      }
    })

    it.each([
      { click_count: 1, expected_arrow: `↓` },
      { click_count: 2, expected_arrow: `↑` },
    ])(
      `renders $expected_arrow for Value header after $click_count click(s)`,
      async ({ click_count, expected_arrow }) => {
        const headers = render_table()
        const value_header = headers[2]

        if (click_count >= 1) {
          value_header.click()
          await tick()
        }
        if (click_count >= 2) {
          value_header.click()
          await tick()
        }
        expect(value_header.textContent).toContain(expected_arrow)
      },
    )

    it.each<{ desc: string; value_col: Label }>([
      {
        desc: `show_sort_indicator=false`,
        value_col: {
          label: `Value`,
          better: `lower`,
          show_sort_indicator: false,
          description: ``,
        },
      },
      {
        desc: `--hide-sort-indicator style token`,
        value_col: {
          label: `Value`,
          better: `lower`,
          style: `--hide-sort-indicator:1;`,
          description: ``,
        },
      },
    ])(`hides indicator for $desc but still sorts rows`, async ({ value_col }) => {
      const columns: Label[] = [{ label: `Model`, description: `` }, value_col]
      const data = [
        { Model: `A`, Value: 300 },
        { Model: `B`, Value: 100 },
        { Model: `C`, Value: 200 },
      ]
      const headers = render_table(columns, data)
      const value_header = headers[1]
      value_header.click()
      await tick()

      expect(value_header.textContent).not.toMatch(/[↑↓]/)
      expect(col_values(`Value`)).toEqual([`100`, `200`, `300`])
    })
  })

  describe(`Pagination`, () => {
    it(`renders controls, caps rows at page_size, and disables prev/first on page 1`, () => {
      mount_table({
        data: large_data,
        columns: sample_columns,
        pagination: { page_size: 10 },
      })

      expect(document.querySelector(`.pagination`)).not.toBeNull()
      // Check page input value (not textContent since it's in an input)
      expect((document.querySelector(`.page-input`) as HTMLInputElement)?.value).toBe(`1`)
      expect(document.querySelector(`.page-info`)?.textContent).toContain(`of 5`)
      expect(document.querySelector(`.row-count`)?.textContent).toContain(`50 rows`)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(10)

      const buttons = document.querySelectorAll<HTMLButtonElement>(`.page-btn`)
      expect(buttons[0].disabled).toBe(true) // First
      expect(buttons[1].disabled).toBe(true) // Prev
      expect(buttons[2].disabled).toBe(false) // Next
      expect(buttons[3].disabled).toBe(false) // Last
    })

    it(`updates visible rows when parent changes pagination.page_size`, async () => {
      const state = $state({
        pagination: { page_size: 10, page_sizes: [10, 25, 50] },
      })
      mount_table(bind_props({ data: large_data, columns: sample_columns }, state))

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(10)

      state.pagination = { page_size: 25, page_sizes: [10, 25, 50] }
      await tick()

      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(25)
      expect((document.querySelector(`.page-size-select`) as HTMLSelectElement).value).toBe(
        `25`,
      )
    })

    // Note: Test for navigation between pages skipped in happy-dom due to:
    // happy-dom doesn't support getAnimations() which animate:flip uses when rows change

    it(`does not render pagination for small datasets`, () => {
      mount_table({
        data: sample_data, // Only 3 rows
        columns: sample_columns,
        pagination: { page_size: 10 },
      })

      // Pagination should not appear when data fits on one page
      const pagination = document.querySelector(`.pagination`)
      expect(pagination).toBeNull()
    })
  })

  it(`renders resize handles on headers with correct ARIA role`, () => {
    mount_table({ data: sample_data, columns: sample_columns })

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

      mount_table({ data, columns: sample_columns })

      const rows = document.querySelectorAll(`tbody tr`)
      expect(rows[0].classList.contains(`custom-row`)).toBe(true)
      for (const row of Array.from(rows)) {
        expect(row.getAttribute(`class`)).not.toContain(`undefined`)
      }
    })

    type SortHintCase = {
      desc: string
      sort_hint?: ComponentProps<typeof HeatmapTable>[`sort_hint`]
      text: string | null
      permanent?: boolean
      position?: `top` | `bottom`
      classes?: string[]
      style_includes?: string[]
    }
    it.each<SortHintCase>([
      { desc: `does not render when undefined`, sort_hint: undefined, text: null },
      {
        desc: `renders as string with default position bottom, not permanent`,
        sort_hint: `Click to sort`,
        text: `Click to sort`,
        permanent: false,
        position: `bottom`,
      },
      {
        desc: `renders object config with permanent class at position top`,
        sort_hint: { text: `Sort hint text`, position: `top`, permanent: true },
        text: `Sort hint text`,
        permanent: true,
        position: `top`,
      },
      {
        desc: `renders at explicit position bottom`,
        sort_hint: { text: `Positioned hint`, position: `bottom` },
        text: `Positioned hint`,
        permanent: false,
        position: `bottom`,
      },
      {
        desc: `applies custom style, class, position, and permanent together`,
        sort_hint: {
          text: `Full config hint`,
          position: `top`,
          permanent: true,
          style: `font-weight: bold; color: red;`,
          class: `custom-hint-class another-class`,
        },
        text: `Full config hint`,
        permanent: true,
        position: `top`,
        classes: [`custom-hint-class`, `another-class`],
        style_includes: [`font-weight: bold`, `color: red`],
      },
    ])(
      `sort_hint $desc`,
      ({ sort_hint, text, permanent, position, classes, style_includes }) => {
        mount_table({ data: sample_data, columns: sample_columns, sort_hint })

        const container = document.querySelector(`.table-container`)
        const hint = container?.querySelector(`.sort-hint`)
        if (text === null) {
          expect(hint).toBeNull()
          return
        }

        expect(hint).not.toBeNull()
        expect(hint?.textContent).toBe(text)
        expect(hint?.classList.contains(`permanent`)).toBe(permanent)
        for (const cls of classes ?? []) expect(hint?.classList.contains(cls)).toBe(true)
        for (const fragment of style_includes ?? []) {
          expect(hint?.getAttribute(`style`)).toContain(fragment)
        }

        // position=top -> hint precedes the table-scroll div, bottom -> follows it
        const table_scroll = container?.querySelector(`.table-scroll`)
        expect(table_scroll).not.toBeNull()
        if (hint && table_scroll) {
          expect(hint.compareDocumentPosition(table_scroll)).toBe(
            position === `top`
              ? Node.DOCUMENT_POSITION_FOLLOWING
              : Node.DOCUMENT_POSITION_PRECEDING,
          )
        }
      },
    )

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

      mount_table({ data, columns: grouped_columns })

      // Click on the second "Value" header (Group B)
      const headers = document.querySelectorAll(`thead tr:last-child th`)
      const group_b_header = headers[2] as HTMLElement
      expect(group_b_header).toBeDefined()
      expect(group_b_header.textContent).toContain(`Value`)

      group_b_header.click()
      await tick()

      // Should sort by Group B values (100, 50, 75)
      // data-col="Value" is used for both groups, so check Name column order instead
      // Group B values: Item 1=100, Item 2=50, Item 3=75
      // Default sort is descending: Item 1 (100), Item 3 (75), Item 2 (50)
      expect(col_values(`Name`)).toEqual([`Item 1`, `Item 3`, `Item 2`])
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
      mount_table({ data, columns: [{ label: `Name`, description: `` }, heatmap_col] })

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

        mount_table({ data: initial_data, columns: sample_columns, onsort: onsort_mock })

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
        mount_table({ data: initial_data, columns: sample_columns, onsort: onsort_mock })

        const score_header = document.querySelectorAll(`th`)[1]

        // First click = desc (better: higher), second = asc, third = desc
        score_header.click()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenLastCalledWith(`Score`, `desc`))
        score_header.click()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenLastCalledWith(`Score`, `asc`))
        score_header.click()
        await vi.waitFor(() => expect(onsort_mock).toHaveBeenLastCalledWith(`Score`, `desc`))
        expect(onsort_mock).toHaveBeenCalledTimes(3)
      })

      it(`updates data with resolved Promise value`, async () => {
        const server_data = [
          { Model: `Server A`, Score: 0.99, Value: 999 },
          { Model: `Server B`, Score: 0.88, Value: 888 },
          { Model: `Server C`, Score: 0.77, Value: 777 },
        ]
        const onsort_mock = vi.fn().mockResolvedValue(server_data)
        mount_table({ data: initial_data, columns: sample_columns, onsort: onsort_mock })

        const table = document.body.lastElementChild as HTMLElement
        const tbody = table.querySelector(`tbody`)

        table.querySelectorAll(`th`)[1].click()
        await tick()

        await vi.waitFor(() => {
          const models = Array.from(tbody?.querySelectorAll(`td[data-col="Model"]`) ?? []).map(
            (cell) => cell.textContent?.trim(),
          )
          expect(models).toEqual([`Server A`, `Server B`, `Server C`])
        })
      })

      it(`does not call onsort for Shift+click or unsortable columns`, async () => {
        const onsort_mock = vi.fn().mockResolvedValue(initial_data)
        const cols: Label[] = [
          { label: `Model`, sortable: false, description: `` },
          { label: `Score`, better: `higher`, description: `` },
        ]
        mount_table({ data: initial_data, columns: cols, onsort: onsort_mock })

        const headers = document.querySelectorAll(`th`)

        // Click unsortable column
        headers[0].click()
        await tick()
        expect(onsort_mock).not.toHaveBeenCalled()

        // Shift+click for multi-sort
        headers[1].dispatchEvent(new MouseEvent(`click`, { shiftKey: true, bubbles: true }))
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
        mount_table({
          data: [
            { Name: `Item 1`, 'Value (Group A)': 10, 'Value (Group B)': 100 },
            { Name: `Item 2`, 'Value (Group A)': 20, 'Value (Group B)': 50 },
          ],
          columns: grouped_columns,
          onsort: onsort_mock,
        })

        // Click on Group B's "Value" header
        const headers = document.querySelectorAll(`thead tr:last-child th`)
        ;(headers[2] as HTMLElement).click()
        await tick()

        await vi.waitFor(() =>
          expect(onsort_mock).toHaveBeenCalledWith(`Value (Group B)`, expect.any(String)),
        )
      })
    })

    describe(`loading state`, () => {
      it.each([
        [true, `shows overlay and spinner`],
        [false, `hides overlay`],
      ])(`loading=%s %s`, (loading) => {
        mount_table({ data: initial_data, columns: sample_columns, loading })
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
        mount_table({ data: initial_data, columns: sample_columns, onsort: onsort_mock })

        const container = document.body.lastElementChild as HTMLElement
        expect(container.querySelector(`.loading-overlay`)).toBeNull()

        container.querySelectorAll(`th`)[1].click()
        await tick()
        expect(container.querySelector(`.loading-overlay`)).not.toBeNull()

        resolve_sort(initial_data)
        await tick()
        await vi.waitFor(() => expect(container.querySelector(`.loading-overlay`)).toBeNull())
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
          { Model: `X`, Score: 0.1, Value: 100 },
          { Model: `Y`, Score: 0.5, Value: 200 },
          { Model: `Z`, Score: 0.9, Value: 300 },
        ]
        mount_table({ data: unsorted, columns: sample_columns, sort_data })

        const table = document.body.lastElementChild as HTMLElement
        table.querySelectorAll(`th`)[1].click()
        await tick()

        const models = Array.from(table.querySelectorAll(`td[data-col="Model"]`)).map((cell) =>
          cell.textContent?.trim(),
        )
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
        mount_table({ data: initial_data, columns: sample_columns, onsort: onsort_mock })

        const table = document.body.lastElementChild as HTMLElement
        table.querySelectorAll(`th`)[1].click()
        await tick()

        await vi.waitFor(() => {
          const models = Array.from(table.querySelectorAll(`td[data-col="Model"]`)).map(
            (cell) => cell.textContent?.trim(),
          )
          // Server order preserved (A, B, C), NOT client-side sorted (C, B, A)
          expect(models).toEqual([`A`, `B`, `C`])
        })
      })
    })

    describe(`integration scenarios`, () => {
      it(`sort hint works with onsort`, () => {
        mount_table({
          data: initial_data,
          columns: sample_columns,
          onsort: vi.fn().mockResolvedValue(initial_data),
          sort_hint: { text: `Server-side sort`, permanent: true },
        })

        const hint = document.querySelector(`.sort-hint`)
        expect(hint?.textContent).toContain(`Server-side sort`)
        expect(hint?.classList.contains(`permanent`)).toBe(true)
      })

      it(`other features work with async sort props`, () => {
        mount_table({
          data: large_data,
          columns: sample_columns,
          onsort: vi.fn().mockResolvedValue(large_data),
          pagination: { page_size: 10 },
          search: { expanded: true },
          sort_data: false,
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

        mount_table({ data: initial_data, columns: sample_columns, onsort: onsort_mock })

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
          const models = Array.from(table.querySelectorAll(`td[data-col="Model"]`)).map(
            (cell) => cell.textContent?.trim(),
          )
          expect(models).toEqual([`Second`])
        })
      })

      it(`reverts sort state on onsort callback failure`, async () => {
        // First call succeeds, second call fails
        const onsort_mock = vi
          .fn()
          .mockResolvedValueOnce(initial_data) // First sort succeeds
          .mockRejectedValueOnce(new Error(`Network error`)) // Second sort fails

        mount_table({
          data: initial_data,
          columns: sample_columns,
          onsort: onsort_mock,
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

        mount_table({
          data: initial_data,
          columns: sample_columns,
          onsort: onsort_mock,
          onsorterror: onsorterror_mock,
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

  describe(`Empty State`, () => {
    it.each([
      { desc: `default message`, props: {}, text: `No data`, visible: true },
      {
        desc: `custom message`,
        props: { empty_message: `Nothing here` },
        text: `Nothing here`,
        visible: true,
      },
      {
        desc: `hidden when empty string`,
        props: { empty_message: `` },
        text: null,
        visible: false,
      },
    ])(`$desc`, ({ props, text, visible }) => {
      mount_table({ data: [], columns: sample_columns, ...props })

      const empty_row = document.querySelector(`.empty-row`)
      if (visible) {
        expect(empty_row?.textContent?.trim()).toBe(text)
      } else {
        expect(empty_row).toBeNull()
      }
    })

    it(`colspan covers all columns including select and row-number`, () => {
      mount_table({
        data: [],
        columns: sample_columns,
        show_row_select: true,
        show_row_numbers: true,
      })
      // 3 data columns + 1 select + 1 row number = 5
      expect(document.querySelector(`.empty-row td`)?.getAttribute(`colspan`)).toBe(`5`)
    })

    it(`not shown when data is present`, () => {
      mount_table({ data: sample_data, columns: sample_columns })
      expect(document.querySelector(`.empty-row`)).toBeNull()
    })
  })

  describe(`Row Numbers`, () => {
    it(`shows 1-indexed numbers and # header when enabled`, () => {
      mount_table({ data: sample_data, columns: sample_columns, show_row_numbers: true })

      const headers = Array.from(document.querySelectorAll(`th`)).map((th) =>
        th.textContent?.trim(),
      )
      expect(headers).toContain(`#`)

      const num_cells = document.querySelectorAll(`td.row-num-col`)
      expect(num_cells).toHaveLength(3)
      expect(Array.from(num_cells).map((td) => td.textContent?.trim())).toEqual([
        `1`,
        `2`,
        `3`,
      ])
    })

    it(`hidden by default`, () => {
      mount_table({ data: sample_data, columns: sample_columns })
      expect(document.querySelectorAll(`td.row-num-col`)).toHaveLength(0)
    })
  })

  describe(`Keyboard Navigation`, () => {
    it.each([
      { desc: `with onrowclick`, has_click: true, expected_tabindex: `0` },
      { desc: `without onrowclick`, has_click: false, expected_tabindex: null },
    ])(`tabindex $desc`, ({ has_click, expected_tabindex }) => {
      mount_table({
        data: sample_data,
        columns: sample_columns,
        ...(has_click ? { onrowclick: () => {} } : {}),
      })

      for (const row of Array.from(document.querySelectorAll(`tbody tr`))) {
        expect(row.getAttribute(`tabindex`)).toBe(expected_tabindex)
      }
    })

    it.each([{ key: `Enter` }, { key: ` ` }])(
      `triggers onrowclick on $key key`,
      async ({ key }) => {
        const clicked: unknown[] = []
        mount_table({
          data: sample_data,
          columns: sample_columns,
          onrowclick: (_event: KeyboardEvent | MouseEvent, row: Record<string, unknown>) =>
            clicked.push(row),
        })

        const first_row = document.querySelector(`tbody tr`) as HTMLElement
        first_row.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
        await tick()

        expect(clicked).toHaveLength(1)
        expect(clicked[0]).toHaveProperty(`Model`, `Model A`)
      },
    )

    it(`triggers row pointerdown before row click`, () => {
      const pointer_down = vi.fn()
      const click = vi.fn()
      mount_table({
        data: sample_data,
        columns: sample_columns,
        onrowpointerdown: pointer_down,
        onrowclick: click,
      })

      const first_row = document.querySelector(`tbody tr`) as HTMLElement
      const event = new Event(`pointerdown`, { bubbles: true }) as PointerEvent
      Object.defineProperty(event, `button`, { value: 0 })
      first_row.dispatchEvent(event)
      first_row.click()

      expect(pointer_down).toHaveBeenCalledWith(event, sample_data[0])
      expect(click).toHaveBeenCalledWith(expect.any(MouseEvent), sample_data[0])
      expect(pointer_down.mock.invocationCallOrder[0]).toBeLessThan(
        click.mock.invocationCallOrder[0],
      )
    })
  })

  describe(`Export Enhancements`, () => {
    // Shared helper: mount, optionally interact, trigger CSV export, return blob text
    async function export_csv_text(
      props: Partial<ComponentProps<typeof HeatmapTable>>,
      before_export?: () => Promise<void>,
    ): Promise<string> {
      const create_url = vi.spyOn(URL, `createObjectURL`).mockReturnValue(`blob:test`)
      const revoke_url = vi.spyOn(URL, `revokeObjectURL`).mockImplementation(() => {})
      const anchor_click = vi
        .spyOn(HTMLAnchorElement.prototype, `click`)
        .mockImplementation(() => {})
      const append_spy = vi.spyOn(document.body, `append`)

      try {
        mount_table({ export_data: true, ...props } as ComponentProps<typeof HeatmapTable>)
        if (before_export) await before_export()
        await open_export_menu()
        const csv_btn = Array.from(
          document.querySelectorAll(`.dropdown-pane .dropdown-option`),
        ).find((btn) => btn.textContent?.includes(`CSV`)) as HTMLButtonElement
        csv_btn.click()
        await tick()

        return await (create_url.mock.calls[0][0] as Blob).text()
      } finally {
        create_url.mockRestore()
        revoke_url.mockRestore()
        anchor_click.mockRestore()
        append_spy.mockRestore()
      }
    }

    it(`copy to clipboard writes TSV`, async () => {
      mount_table({ data: sample_data, columns: sample_columns, export_data: true })
      await open_export_menu()

      const copy_btn = Array.from(
        document.querySelectorAll(`.dropdown-pane .dropdown-option`),
      ).find((btn) => btn.textContent?.includes(`Copy`)) as HTMLButtonElement
      copy_btn.click()
      await tick()

      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
      const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string
      expect(written).toContain(`Model\tScore\tValue`)
      expect(written).toContain(`Model A`)
    })

    it(`strips HTML from column headers`, async () => {
      const text = await export_csv_text({
        data: [{ 'E<sub>form</sub>': -1.5, Name: `Fe` }],
        columns: [
          { label: `E<sub>form</sub>`, description: `` },
          {
            label: `Name`,
            description: ``,
          },
        ],
      })
      expect(text).toContain(`Eform`)
      expect(text).not.toContain(`<sub>`)
    })

    it(`exports only selected rows`, async () => {
      const text = await export_csv_text(
        { data: sample_data, columns: sample_columns, show_row_select: true },
        async () => {
          ;(
            document.querySelector(`td.select-col input[type="checkbox"]`) as HTMLInputElement
          ).click()
          await tick()
        },
      )

      const lines = text.trim().split(`\n`)
      expect(lines).toHaveLength(2) // header + 1 selected row
      expect(text).toContain(`Model A`)
      expect(text).not.toContain(`Model B`)
    })

    it.each([
      { desc: `commas`, val: `hello, world`, expected: `"hello, world"` },
      { desc: `double quotes`, val: `say "hi"`, expected: `"say ""hi"""` },
      { desc: `newlines`, val: `line1\nline2`, expected: `"line1\nline2"` },
    ])(`CSV quoting for $desc`, async ({ val, expected }) => {
      const text = await export_csv_text({
        data: [{ Name: val }],
        columns: [{ label: `Name`, description: `` }],
      })
      expect(text).toContain(expected)
    })
  })

  it(`does not render tfoot when footer is not provided`, () => {
    mount_table({ data: sample_data, columns: sample_columns })
    expect(document.querySelector(`tfoot`)).toBeNull()
  })

  describe(`root_style prop`, () => {
    it.each([
      {
        desc: `applies root_style to container`,
        props: { root_style: `margin: 0; max-width: 500px` },
        fragments: [`margin: 0`, `max-width: 500px`],
      },
      {
        desc: `merges root_style with rest style`,
        props: { root_style: `flex: 1`, style: `color: red` },
        fragments: [`color: red`],
        // happy-dom normalizes `flex: 1` to longhand properties
        pattern: /flex-grow:\s*1|flex:\s*1/,
      },
    ])(`$desc`, ({ props, fragments, pattern }) => {
      mount_table({ data: sample_data, columns: sample_columns, ...props })

      const style = document.querySelector(`.table-container`)?.getAttribute(`style`) ?? ``
      for (const fragment of fragments) expect(style).toContain(fragment)
      if (pattern) expect(style).toMatch(pattern)
    })
  })

  describe(`Controls Pane`, () => {
    it.each([
      [false, null],
      [true, `.pane-toggle`],
    ] as const)(`show_controls=%s -> gear icon %s`, (show_controls, expected_selector) => {
      mount_table({ data: sample_data, columns: sample_columns, show_controls })
      const toggle = document.querySelector(`.pane-toggle`)
      if (expected_selector) expect(toggle).not.toBeNull()
      else expect(toggle).toBeNull()
    })
  })

  describe(`Page Size Selector`, () => {
    it(`renders dropdown with correct options when page_sizes provided`, () => {
      mount_table({
        data: large_data,
        columns: sample_columns,
        pagination: { page_size: 10, page_sizes: [10, 25, 50] },
      })

      const options = document.querySelectorAll(`.page-size-select option`)
      expect(options).toHaveLength(3)
      expect(Array.from(options).map((opt) => opt.textContent?.trim())).toEqual([
        `10 / page`,
        `25 / page`,
        `50 / page`,
      ])
    })

    it(`notifies parent when page size changes`, async () => {
      const on_page_size_change = vi.fn()
      mount_table({
        data: large_data,
        columns: sample_columns,
        pagination: { page_size: 10, page_sizes: [10, 25, 50], on_page_size_change },
      })

      const select = document.querySelector(`.page-size-select`) as HTMLSelectElement
      select.value = `25`
      select.dispatchEvent(new Event(`change`, { bubbles: true }))
      await tick()

      expect(on_page_size_change).toHaveBeenCalledWith(25)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(25)
    })

    it(`hidden when page_sizes not provided`, () => {
      mount_table({
        data: large_data,
        columns: sample_columns,
        pagination: { page_size: 10 },
      })
      expect(document.querySelector(`.page-size-select`)).toBeNull()
    })
  })

  describe(`cell range selection and column copy`, () => {
    const cell_at = (row_idx: number, col_idx: number): HTMLTableCellElement => {
      const cell = document.querySelector<HTMLTableCellElement>(
        `td[data-row-idx="${row_idx}"][data-col-idx="${col_idx}"]`,
      )
      if (!cell) throw new Error(`cell (${row_idx}, ${col_idx}) not found`)
      return cell
    }
    const pointer = (type: string, init: MouseEventInit = {}) =>
      new MouseEvent(type, { button: 0, bubbles: true, ...init })
    const drag_cells = (
      from: [number, number],
      to: [number, number],
      init: MouseEventInit = {},
    ) => {
      cell_at(...from).dispatchEvent(pointer(`pointerdown`, init))
      cell_at(...to).dispatchEvent(pointer(`pointermove`))
      globalThis.window.dispatchEvent(pointer(`pointerup`))
    }
    const copy_shortcut = () =>
      globalThis.window.dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `c`, metaKey: true }),
      )
    const written_text = (): string =>
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]
    const mount_sample_table = async (
      props: Omit<ComponentProps<typeof HeatmapTable>, 'data' | 'columns'> = {},
    ) => {
      mount_table({ data: sample_data, columns: sample_columns, ...props })
      await tick()
    }

    it(`drag selects a rectangle and Cmd+C copies it as TSV`, async () => {
      await mount_sample_table()

      drag_cells([0, 0], [1, 1])
      await tick()

      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(4)
      copy_shortcut()
      expect(written_text()).toBe(`Model A\t0.95\nModel B\t0.85`)
    })

    it(`shift+drag adds disjoint blocks that copy separated by newlines`, async () => {
      await mount_sample_table()

      drag_cells([0, 0], [0, 0])
      drag_cells([2, 2], [2, 2], { shiftKey: true })
      await tick()

      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(2)
      copy_shortcut()
      expect(written_text()).toBe(`Model A\n300`)
    })

    it(`plain drag replaces the previous selection`, async () => {
      await mount_sample_table()

      drag_cells([0, 0], [1, 0])
      drag_cells([2, 1], [2, 1])
      await tick()

      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)
      expect(cell_at(2, 1).classList.contains(`cell-selected`)).toBe(true)
    })

    it(`clears the selection when columns are hidden or reordered`, async () => {
      const state = $state({ hidden_columns: [] as string[], column_order: [] as string[] })
      mount_table(bind_props({ data: sample_data, columns: sample_columns }, state))
      await tick()

      // hiding a column remaps col indices -> stale rects must clear
      drag_cells([0, 0], [1, 1])
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(4)
      state.hidden_columns = [`Value`]
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(0)

      // reordering columns remaps col indices too
      drag_cells([0, 0], [1, 1])
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(4)
      state.column_order = [`Score`, `Model`, `Value`]
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(0)
    })

    it(`Escape and outside pointerdown clear the selection`, async () => {
      await mount_sample_table()

      drag_cells([0, 0], [1, 1])
      await tick()
      globalThis.window.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(0)

      drag_cells([0, 0], [1, 1])
      await tick()
      document.body.dispatchEvent(pointer(`pointerdown`))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(0)
    })

    it(`suppresses the row click that follows a cell drag`, async () => {
      const onrowclick = vi.fn()
      await mount_sample_table({ onrowclick })

      // drag across cells -> the click on release must not fire the row action
      drag_cells([0, 0], [1, 1])
      cell_at(1, 1).dispatchEvent(pointer(`click`))
      expect(onrowclick).not.toHaveBeenCalled()

      // plain click (pointer never moved) still fires the row action
      drag_cells([0, 0], [0, 0])
      cell_at(0, 0).dispatchEvent(pointer(`click`))
      expect(onrowclick).toHaveBeenCalledTimes(1)
    })

    it(`right-click copy column copies all filtered rows across pages`, async () => {
      await mount_sample_table({ pagination: { page_size: 2 } })

      cell_at(0, 0).dispatchEvent(pointer(`contextmenu`, { button: 2 }))
      await tick()

      const copy_option = [
        ...document.querySelectorAll<HTMLButtonElement>(`.context-menu button`),
      ].find((btn) => btn.textContent?.includes(`Copy column`))
      expect(copy_option?.textContent).toContain(`3 values`)
      copy_option?.click()
      await tick()

      // all rows, not just the 2 on the current page
      expect(written_text()).toBe(`Model A\nModel B\nModel C`)
      expect(document.querySelector(`.context-menu`)).toBeNull()
    })

    it(`context menu on headers offers copy for non-heatmap columns`, async () => {
      await mount_sample_table()

      const header = document.querySelector(`th`)
      header?.dispatchEvent(pointer(`contextmenu`, { button: 2 }))
      await tick()

      const options = [...document.querySelectorAll(`.context-menu button`)].map((btn) =>
        btn.textContent?.trim(),
      )
      expect(options.some((text) => text?.includes(`Copy column`))).toBe(true)
      // no color_scale on Model -> no gradient-direction section
      expect(options.some((text) => text?.includes(`Higher is better`))).toBe(false)
    })

    it(`clears selection when the rendered data changes`, async () => {
      const state = $state({ data: sample_data })
      mount(HeatmapTable, {
        target: document.body,
        props: { data: state.data, columns: sample_columns },
      })
      await tick()

      drag_cells([0, 0], [1, 1])
      // browsers fire a click on the release target after every drag; it is
      // swallowed by the suppress guard (see previous test)
      cell_at(1, 1).dispatchEvent(pointer(`click`))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(4)

      // sorting reorders rows -> stale (row, col) coordinates must clear
      document.querySelector(`th`)?.dispatchEvent(pointer(`click`))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(0)
    })
  })

  describe(`Infinite scroll (virtualized rows)`, () => {
    const row_height_px = 33
    const overscan = 10
    const min_window = 60
    // happy-dom has no layout: clientHeight/offsetHeight are 0, so the window
    // is driven by min_window and the row-height estimate
    const many_rows = Array.from({ length: 200 }, (_, idx) => ({
      Model: `Model ${idx}`,
      Score: idx,
    }))
    const two_cols: Label[] = [
      { label: `Model`, description: `` },
      { label: `Score`, description: `` },
    ]
    const rendered_rows = () =>
      document.querySelectorAll(`tbody tr:not(.virtual-spacer):not(.empty-row)`)
    const spacers = () => [
      ...document.querySelectorAll<HTMLTableRowElement>(`tr.virtual-spacer`),
    ]

    it(`virtual={true} caps rendered rows and shows shown-of-total count`, () => {
      mount_table({ data: many_rows, columns: two_cols, virtual: true })

      expect(rendered_rows()).toHaveLength(min_window)
      const [bottom_spacer] = spacers()
      expect(spacers()).toHaveLength(1) // only below (window starts at top)
      expect(bottom_spacer.style.height).toBe(
        `${(many_rows.length - min_window) * row_height_px}px`,
      )
      expect(document.querySelector(`.row-count-info`)?.textContent?.trim()).toBe(
        `${min_window} of ${many_rows.length} rows`,
      )
      expect(document.querySelector(`.pagination`)).toBeNull()
    })

    it(`moves the window and preserves absolute row numbers on scroll`, async () => {
      mount_table({
        data: many_rows,
        columns: two_cols,
        show_row_numbers: true,
        sort_data: false,
        virtual: true,
      })
      const scroller = document.querySelector<HTMLDivElement>(`.table-scroll`)
      assert(scroller)
      scroller.scrollTop = 30 * row_height_px
      scroller.dispatchEvent(new Event(`scroll`))
      await tick()

      const start = 30 - overscan
      const end = start + min_window
      expect(rendered_rows()).toHaveLength(min_window)
      expect(spacers()).toHaveLength(2)
      expect(spacers()[0].style.height).toBe(`${start * row_height_px}px`)
      expect(spacers()[1].style.height).toBe(`${(many_rows.length - end) * row_height_px}px`)
      expect(rendered_rows()[0].querySelector(`.row-num-col`)?.textContent?.trim()).toBe(`21`)
      expect(col_values(`Model`)[0]).toBe(`Model 20`)
    })

    it(`reports the rendered range via on_visible_range`, async () => {
      const on_visible_range = vi.fn()
      mount_table({ data: many_rows, columns: two_cols, on_visible_range, virtual: true })
      await tick()
      expect(on_visible_range).toHaveBeenLastCalledWith({
        start: 0,
        end: min_window,
        total: many_rows.length,
      })

      const scroller = document.querySelector<HTMLDivElement>(`.table-scroll`)
      assert(scroller)
      scroller.scrollTop = 30 * row_height_px
      scroller.dispatchEvent(new Event(`scroll`))
      await tick()
      expect(on_visible_range).toHaveBeenLastCalledWith({
        start: 30 - overscan,
        end: 30 - overscan + min_window,
        total: many_rows.length,
      })
    })

    it(`clamps the rendered window when data shrinks below the scroll position`, async () => {
      const state = $state({ data: many_rows })
      mount_table(bind_props({ columns: two_cols, virtual: true }, state))
      const scroller = document.querySelector<HTMLDivElement>(`.table-scroll`)
      assert(scroller)
      scroller.scrollTop = 150 * row_height_px // deep into the 200 rows
      scroller.dispatchEvent(new Event(`scroll`))
      await tick()
      expect(rendered_rows().length).toBeGreaterThan(0)

      // happy-dom never clamps scrollTop, so the stale offset (150 rows) now
      // points far past the 20-row content. The window must clamp to the data:
      // all 20 rows fit the 600px viewport, so everything renders, no spacers.
      // (Unclamped, the window would start at row 140 and render zero rows.)
      state.data = many_rows.slice(0, 20)
      await tick()
      expect(rendered_rows()).toHaveLength(20)
      expect(spacers()).toHaveLength(0)
    })

    it.each([
      [`virtualization is off by default: every row renders`, {}, many_rows.length],
      [`virtual={false} renders every row`, { virtual: false as const }, many_rows.length],
      [`custom min_window bounds the window`, { virtual: { min_window: 25 } }, 25],
    ])(`%s`, (_desc, extra_props, expected_rows) => {
      mount_table({ data: many_rows, columns: two_cols, ...extra_props })
      expect(rendered_rows()).toHaveLength(expected_rows)
      if (expected_rows === many_rows.length) {
        expect(spacers()).toHaveLength(0)
        expect(document.querySelector(`.row-count-info`)).toBeNull()
      }
    })

    it(`pagination disables virtualization and its count line`, () => {
      mount_table({
        data: many_rows,
        columns: two_cols,
        pagination: { page_size: 10 },
        virtual: true,
      })
      expect(rendered_rows()).toHaveLength(10)
      expect(spacers()).toHaveLength(0)
      expect(document.querySelector(`.row-count-info`)).toBeNull()
      expect(document.querySelector(`.pagination`)).not.toBeNull()
    })
  })

  describe(`controls_target`, () => {
    const rows = [
      { Model: `A`, Score: 1 },
      { Model: `B`, Score: 2 },
    ]
    const cols: Label[] = [
      { label: `Model`, description: `` },
      { label: `Score`, description: `` },
    ]
    const control_props = { search: true, export_data: true, show_controls: true }

    it(`teleports control buttons into the host target, always visible`, async () => {
      const target = document.createElement(`div`)
      document.body.append(target)
      mount_table({ data: rows, columns: cols, ...control_props, controls_target: target })
      await tick() // attachments run in the effect phase

      const section = target.querySelector(`.control-buttons`)
      expect(section).not.toBeNull()
      expect(section?.classList.contains(`portaled`)).toBe(true)
      // settings gear travels with the row (it lives inside the section now)
      expect(section?.querySelector(`.pane-toggle`)).not.toBeNull()
      // no leftover controls row inside the table itself
      expect(document.querySelector(`.table-container .control-buttons`)).toBeNull()
    })

    it(`renders controls inline (gear included) when no target is given`, () => {
      mount_table({ data: rows, columns: cols, ...control_props })

      const section = document.querySelector(`.table-container .control-buttons`)
      expect(section).not.toBeNull()
      expect(section?.classList.contains(`portaled`)).toBe(false)
      expect(section?.querySelector(`.pane-toggle`)).not.toBeNull()
    })
  })
})
