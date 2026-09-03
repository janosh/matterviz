import type {
  CellSnippetArgs,
  ColumnFilter,
  ColumnPrefs,
  Label,
  RowData,
  SummaryStat,
} from '$lib/table'
import { HeatmapTable } from '$lib/table'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { bind_props, doc_query, keydown, mouse, trigger_resize_observer } from '../setup'

const mount_table = (props: ComponentProps<typeof HeatmapTable>): ReturnType<typeof mount> =>
  mount(HeatmapTable, { target: document.body, props })

const plain_columns = (...labels: string[]): Label[] => labels.map((label) => ({ label }))
const value_rows = (values: readonly RowData[string][]): RowData[] =>
  values.map((value, idx) => ({ Name: String.fromCharCode(65 + idx), Value: value }))

// Trimmed text of every cell in the given column.
const col_values = (col_name: string): (string | undefined)[] =>
  [...document.querySelectorAll(`td[data-col="${col_name}"]`)].map((cell) =>
    cell.textContent?.trim(),
  )

const cell_at = (row_idx: number, col_idx: number): HTMLTableCellElement =>
  doc_query(`td[data-row-idx="${row_idx}"][data-col-idx="${col_idx}"]`, HTMLTableCellElement)

// Call before mounting, so the debounce wait below costs no wall clock
const fake_search_timers = () => {
  vi.useFakeTimers()
  onTestFinished(() => void vi.useRealTimers())
}
// A non-empty search_query is debounced 150 ms before it reaches the filter (clearing is not)
const settle_search = async (state: { search_query: string }, query: string) => {
  state.search_query = query
  flushSync() // let the debounce effect schedule its timer before advancing
  await vi.advanceTimersByTimeAsync(150)
  await tick()
}

describe(`HeatmapTable`, () => {
  const sample_data = [
    { Model: `Model A`, Score: 0.95, Value: 100 },
    { Model: `Model B`, Score: 0.85, Value: 200 },
    { Model: `Model C`, Score: 0.75, Value: 300 },
  ]

  const sample_columns: Label[] = [
    { label: `Model`, sticky: true },
    { label: `Score`, better: `higher`, format: `.2f` },
    { label: `Value`, better: `lower` },
  ]

  const heatmap_col: Label = {
    label: `Value`,
    color_scale: `interpolateViridis`,
  }

  // 50-row dataset shared by the Pagination tests.
  // Scores are deterministic but shuffled (37 is coprime to 50).
  const large_data = Array.from({ length: 50 }, (_, idx) => ({
    Model: `Model ${idx + 1}`,
    Score: ((idx * 37) % 50) / 50,
    Value: idx * 10,
  }))

  const open_export_menu = async (): Promise<void> => {
    doc_query<HTMLButtonElement>(`.dropdown-wrapper .icon-btn`).click()
    await tick()
  }

  it(`renders table with correct structure and handles hidden columns`, () => {
    const columns = [...sample_columns, { label: `Hidden`, visible: false }]
    mount_table({ data: sample_data, columns })

    const headers = document.querySelectorAll(`th`)
    expect(headers).toHaveLength(3)
    expect(
      Array.from(headers).map((header) => header.textContent?.replaceAll(/\s+/g, ` `).trim()),
    ).toEqual([`Model`, `Score`, `Value`])

    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
    expect(document.querySelectorAll(`td[data-col="Hidden"]`)).toHaveLength(0)
    expect(document.querySelectorAll(`td.row-num-col`)).toHaveLength(0)
    expect(document.querySelector(`tfoot`)).toBeNull() // no footer snippet -> no tfoot
    expect(document.querySelector(`.empty-row`)).toBeNull() // data present -> no empty row
    expect(document.querySelector(`.dropdown-wrapper`)).toBeNull()
    expect(document.querySelector(`.pane-toggle`)).toBeNull()
  })

  it(`preserves both ends of long plain-text cells for middle ellipsis`, () => {
    const id = `prefix-middle-suffix`
    // The flag must land wholly in the 8-grapheme suffix. Code-point slicing would retain
    // only its second regional indicator and this exact assertion would fail.
    const unicode_id = `long-prefix-value🇩🇪1234567`
    const symbols = `research & development < threshold`
    mount_table({
      data: [
        {
          ID: id,
          Unicode: unicode_id,
          Symbols: symbols,
          Short: `🇩🇪`,
          Rich: `<strong>rich-markup</strong>`,
        },
      ],
      columns: plain_columns(`ID`, `Unicode`, `Symbols`, `Short`, `Rich`),
    })

    const id_cell = doc_query(`td[data-col="ID"]`)
    const visual = doc_query(`td[data-col="ID"] .middle-ellipsis-visual`)
    expect(id_cell.textContent?.trim()).toBe(id)
    expect(id_cell.dataset.sortValue).toBe(id)
    expect(visual.dataset.start).toBe(`prefix-middl`)
    expect(visual.dataset.end).toBe(`e-suffix`)
    expect(visual.getAttribute(`aria-hidden`)).toBe(`true`)
    const unicode_visual = doc_query(`td[data-col="Unicode"] .middle-ellipsis-visual`)
    expect(`${unicode_visual.dataset.start}${unicode_visual.dataset.end}`).toBe(unicode_id)
    expect(unicode_visual.dataset.end).toBe(`🇩🇪1234567`)
    const symbols_cell = doc_query(`td[data-col="Symbols"]`)
    expect(symbols_cell.textContent?.trim()).toBe(symbols)
    expect(symbols_cell.querySelector(`.middle-ellipsis`)).not.toBeNull()
    // Short strings stay as one text node, avoiding needless wrappers and grapheme splitting.
    expect(doc_query(`td[data-col="Short"]`).querySelector(`.middle-ellipsis`)).toBeNull()
    // Rich cells retain their sanitized markup instead of being flattened for truncation.
    expect(doc_query(`td[data-col="Rich"] strong`).textContent).toBe(`rich-markup`)
  })

  it(`does not loop when data rows carry no discoverable column keys`, async () => {
    mount_table({ data: [{ style: `color: red` }, {}], columns: [] })
    await tick()
    expect(document.querySelectorAll(`thead th`)).toHaveLength(0)
  })

  it(`delegates and sanitizes tooltips across cell re-renders`, async () => {
    const cell = (text: string, tip: string) => `<span title="${tip}">${text}</span>`
    const unsafe_title = `&lt;img src=x onerror=alert(1)&gt;unsafe`
    const rows: RowData[] = $state([
      { Model: cell(`alpha`, `tip alpha v1`), Score: 1 },
      { Model: cell(`beta`, `tip beta v1`), Score: `<span title="${unsafe_title}">2</span>` },
    ])
    const columns = plain_columns(`Model`, `Score`)
    const component = mount_table({ data: rows, columns })
    await tick()

    const unsafe_cell = doc_query(`td[data-col="Score"] span[title]`)
    unsafe_cell.dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    const tooltip_content = doc_query(`.custom-tooltip .tooltip-content`)
    expect(tooltip_content.innerHTML).not.toMatch(/onerror|javascript:/i)
    expect(tooltip_content.textContent).toContain(`unsafe`)

    const alpha = () => doc_query(`td[data-col="Model"] span`)
    const activate_tooltip = (expected_title: string) => {
      expect(alpha().getAttribute(`title`)).toBe(expected_title)
      alpha().dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
      expect(alpha().getAttribute(`title`)).toBeNull()
    }

    activate_tooltip(`tip alpha v1`)

    rows[0].Model = cell(`alpha`, `tip alpha v2`)
    await tick()
    activate_tooltip(`tip alpha v2`)
    await unmount(component)
  })

  it(`filters rows whose values are all undefined`, () => {
    mount_table({
      data: [{ Model: undefined, Score: undefined }, ...sample_data],
      columns: sample_columns,
    })
    expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
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
          { label: `Observed` },
          { label: `Start Time`, datetime_format: `time` },
          { label: `Created`, datetime_format: `datetime` },
          { label: `Ancient`, datetime_format: `datetime` },
          { label: `Unix`, datetime_format: `datetime` },
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

    // Cell parsing itself is covered by the compare_rows/parse_numeric_val unit tests; these
    // check a column is wired through them (string initial_sort shorthand sorts ascending)
    // and that a header click then flips the order.
    it.each<[string, string[], string[], boolean]>([
      [
        `data-sort-value over the visible text`,
        [`1,000`, `50`, `10,000`].map(
          (txt) => `<span data-sort-value="${txt.replace(`,`, ``)}">${txt}</span>`,
        ),
        [`50`, `1,000`, `10,000`],
        true,
      ],
      [
        `markup-wrapped numbers numerically`,
        [`<b>10</b>`, `<b>9</b>`, `<b>100</b>`],
        [`9`, `10`, `100`],
        true,
      ],
      [
        // the title attribute orders the raw markup opposite to the sort keys, so neither the
        // visible text nor the unparsed string could produce this order
        `by a non-numeric data-sort-value`,
        [
          [`c`, `1`, `Alpha`],
          [`b`, `2`, `Mike`],
          [`a`, `3`, `Zulu`],
        ].map(
          ([key, title, name]) =>
            `<span title="${title}" data-sort-value="${key}">${name}</span>`,
        ),
        [`Zulu`, `Mike`, `Alpha`],
        false,
      ],
      [
        `mixed columns with numbers first`,
        [`10`, `abc`, `9`, `def`, `2`, `a1`],
        [`2`, `9`, `10`, `a1`, `abc`, `def`],
        false,
      ],
    ])(`sorts %s`, async (_desc, values, expected, numeric) => {
      mount_table({
        data: values.map((Col) => ({ Col })),
        columns: plain_columns(`Col`),
        initial_sort: `Col`,
      })
      await tick()
      expect(col_values(`Col`)).toEqual(expected)
      expect(doc_query(`td[data-col="Col"]`).classList.contains(`numeric-col`)).toBe(numeric)
      document.querySelector(`th`)?.click() // toggle to descending
      await tick()
      expect(col_values(`Col`)).toEqual(expected.toReversed())
    })

    it(`respects unsortable columns`, async () => {
      const columns: Label[] = [
        { label: `Name`, sortable: true },
        { label: `Value`, sortable: true },
        { label: `Actions`, sortable: false },
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
      mount_table({
        data: [sample_data[1], sample_data[2], sample_data[0]],
        columns: sample_columns,
        initial_sort,
      })

      expect(col_values(`Score`)).toEqual(expected)
    })

    // Uncertainty strings sort and colour by their primary value (parse_numeric_val covers the
    // notations one by one in index.test.ts; this checks the table wires sorting through it)
    it(`sorts and colours cells with mixed uncertainty notation by the primary value`, async () => {
      const input = [`1.5 ± 0.2`, `0.8`, `2.3(5)`, `-1.0 +- 0.1`, `5.0e-4 ± 1e-4`]
      mount_table({
        data: value_rows(input),
        columns: [{ label: `Name` }, { ...heatmap_col, better: `lower` }],
      })
      const style_attrs = () =>
        [...document.querySelectorAll(`td[data-col="Value"]`)].map(
          (cell) => cell.getAttribute(`style`) ?? ``,
        )
      // every cell is numeric, so every cell gets a (distinct) heatmap background
      expect(style_attrs().every((style) => style.includes(`--cell-bg:`))).toBe(true)
      expect(new Set(style_attrs()).size).toBe(input.length)

      document.querySelectorAll(`th`)[1].click()
      await tick()
      expect(col_values(`Value`)).toEqual([
        `-1.0 +- 0.1`,
        `5.0e-4 ± 1e-4`,
        `0.8`,
        `1.5 ± 0.2`,
        `2.3(5)`,
      ])
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
      mount_table({ data: value_rows(values), columns: [{ label: `Name` }, heatmap_col] })

      const cells = Array.from(document.querySelectorAll(`td[data-col="Value"]`))
      const style_attrs = cells.map((cell) => cell.getAttribute(`style`) ?? ``)
      colored.forEach((has_bg, idx) => {
        if (has_bg) expect(style_attrs[idx]).toContain(`--cell-bg:`)
        else expect(style_attrs[idx]).not.toContain(`--cell-bg:`)
      })
    })
  })

  it(`formats numbers with column format strings`, () => {
    mount_table({
      data: [{ Num: 0.123 }, { Num: 1.234 }],
      columns: [{ label: `Num`, format: `.1%` }],
    })

    expect(col_values(`Num`)).toEqual([`12.3%`, `123.4%`])
  })

  it.each([
    [`white`, `black`],
    [`black`, `white`],
  ])(`maps scale types and contrasts opacity over a %s page`, async (page_bg, text_color) => {
    const columns: Label[] = [
      { ...heatmap_col, label: `Linear`, better: `higher`, scale_type: `linear` },
      { ...heatmap_col, label: `Log`, better: `higher`, scale_type: `log` },
    ]
    const data = [0, 10, 100, 1000].map((val) => ({ Linear: val, Log: val }))

    // a faint wash so the page shows through: viridis' dark purple at 50% would be a
    // mid-tone that takes white text over either page
    mount_table({
      data,
      columns,
      heatmap_opacity: 0.2,
      style: `--page-bg: ${page_bg}`,
    })
    await tick()

    const [linear_styles, log_styles] = columns.map(({ label }) =>
      Array.from(
        document.querySelectorAll(`td[data-col="${label}"]`),
        (cell) => cell.getAttribute(`style`) ?? ``,
      ),
    )

    // Both scale types color every cell, including zero, but map positive values differently
    expect(
      [...linear_styles, ...log_styles].every((style) => style.includes(`--cell-bg:`)),
    ).toBe(true)
    expect(linear_styles).not.toEqual(log_styles)
    expect(cell_at(0, 0).style.color).toBe(text_color)
  })

  it(`falls back to the page surface for a translucent backdrop override`, async () => {
    mount_table({
      data: [{ Value: 0 }],
      columns: [heatmap_col],
      heatmap_opacity: 0.5,
      backdrop: `rgba(255, 255, 255, 0.5)`,
      style: `--page-bg: black`,
    })
    await tick()
    expect(cell_at(0, 0).style.color).toBe(`white`)
  })

  it(`handles accessibility features`, () => {
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

  it(`prevents HTML strings from being used as data-sort-value attributes`, async () => {
    const html_data = [
      {
        HTML: `<span data-sort-value="100" title="This is a tooltip">100 units</span>`,
        Complex: `<span data-sort-value="3373529" title="Complex tooltip with multiple lines&#013;• Line item 1&#013;• Line item 2">3.37M <small>(details)</small> (<a href="https://example.com">Link</a>)</span>`,
      },
    ]
    mount_table({
      data: html_data,
      columns: plain_columns(`HTML`, `Complex`),
    })
    expect(doc_query(`td[data-col="HTML"] span`).hasAttribute(`data-sort-value`)).toBe(false)
    await tick()

    for (const [col, sort_value, title] of [
      [`HTML`, `100`, `This is a tooltip`],
      [`Complex`, `3373529`, `Complex tooltip`],
    ]) {
      const cell = document.querySelector(`td[data-col="${col}"]`)
      // HTML renders inside the cell, but the raw HTML string must not leak
      // into the td's own data-sort-value attribute
      expect(cell?.innerHTML).toContain(`<span data-sort-value="${sort_value}"`)
      expect(cell?.getAttribute(`data-sort-value`)).toBeNull()
      expect(cell?.querySelector(`span[title]`)?.getAttribute(`title`)).toContain(title)
    }
  })

  describe(`Heatmap Toggle Functionality`, () => {
    const heatmap_val_col: Label = {
      label: `Val`,
      better: `higher`,
      color_scale: `interpolateViridis`,
    }

    it.each([
      [`show_heatmap is false`, { show_heatmap: false }],
      [
        `column preferences disable the color scale`,
        { column_prefs: { Val: { color_scale: null } } },
      ],
    ] as const)(`does not set cell colors when %s`, (_name, props) => {
      const data = [{ Val: 0 }, { Val: 50 }, { Val: 100 }]
      mount_table({ data, columns: [heatmap_val_col], ...props })

      const cells = Array.from(document.querySelectorAll(`td[data-col="Val"]`))
      expect(cells).toHaveLength(data.length)
      for (const cell of cells) {
        expect(cell.getAttribute(`style`) ?? ``).not.toContain(`--cell-bg:`)
      }
    })
  })

  describe(`Column grouping`, () => {
    it(`renders grouped, repeated, and interleaved ungrouped columns`, () => {
      const grouped_columns: Label[] = [
        { label: `Name`, sticky: true },
        { label: `Regular` },
        { label: `Value 1`, group: `Values` },
        { label: `Value 2`, group: `Values` },
        { label: `Metric 1`, group: `Metrics` },
        { label: `Metric 2`, group: `Metrics` },
        { label: `Another` },
        { label: `Value 1`, group: `Second Values` },
        { label: `Value 2`, group: `Second Values` },
      ]

      const grouped_data = [
        {
          Name: `Item A`,
          Regular: 1,
          'Value 1 (Values)': 10,
          'Value 2 (Values)': 20,
          'Metric 1': 30,
          'Metric 2': 40,
          Another: 2,
          'Value 1 (Second Values)': 50,
          'Value 2 (Second Values)': 60,
        },
      ]

      mount_table({ data: grouped_data, columns: grouped_columns })

      const header_rows = document.querySelectorAll(`thead tr`)
      expect(header_rows).toHaveLength(2)

      const group_headers = [...header_rows[0].querySelectorAll(`th`)]
      expect(
        group_headers.map((th) => [th.textContent?.trim(), th.getAttribute(`colspan`)]),
      ).toEqual([
        [``, null],
        [``, null],
        [`Values`, `2`],
        [`Metrics`, `2`],
        [``, null],
        [`Second Values`, `2`],
      ])

      expect(
        [...header_rows[1].querySelectorAll(`th`)].map((header) =>
          header.textContent?.trim().replaceAll(/\s+|[↑↓]/g, ``),
        ),
      ).toEqual([
        `Name`,
        `Regular`,
        `Value1`,
        `Value2`,
        `Metric1`,
        `Metric2`,
        `Another`,
        `Value1`,
        `Value2`,
      ])
    })

    // A split group used to swallow the intervening column under its label, leaving its tail
    // unlabelled
    it(`pulls a group's columns together when they are listed non-contiguously`, () => {
      mount_table({
        data: [{ A: 1, B: 2, C: 3 }],
        columns: [{ label: `A`, group: `g1` }, { label: `B` }, { label: `C`, group: `g1` }],
      })
      const [group_row, header_row] = document.querySelectorAll(`thead tr`)
      const spans = (row: Element) =>
        [...row.querySelectorAll(`th`)].map(
          (th) => `${th.textContent?.trim().replaceAll(/[↑↓\s]/g, ``)}/${th.colSpan}`,
        )
      expect(spans(group_row)).toEqual([`g1/2`, `/1`])
      expect(spans(header_row)).toEqual([`A/1`, `C/1`, `B/1`])
    })
  })

  describe(`Style and CSS properties`, () => {
    it(`applies root, density, column, and row styles`, () => {
      mount_table({
        data: [
          {
            Col1: `a`,
            Col2: `b`,
            style: `background-color: yellow;`,
            class: `custom-row`,
          },
          { Col1: `c`, Col2: `d` },
        ],
        columns: [
          { label: `Col1`, style: `color: red; font-weight: lighter;` },
          { label: `Col2` },
        ],
        density: `compact`,
        root_style: `flex: 1`,
        style: `color: red`,
      })
      const container = doc_query(`.table-container`)
      const root_style = container.getAttribute(`style`) ?? ``
      expect(root_style).toContain(`color: red`)
      // happy-dom normalizes `flex: 1` to longhand properties
      expect(root_style).toMatch(/flex-grow:\s*1|flex:\s*1/)
      expect(getComputedStyle(container).getPropertyValue(`--heatmap-density-padding`)).toBe(
        `0 4pt`,
      )

      const header_style = document.querySelector(`th`)?.getAttribute(`style`) ?? ``
      expect(header_style).toContain(`color: red`)
      expect(header_style).toContain(`font-weight: lighter`)
      expect(document.querySelector(`td[data-col="Col1"]`)?.getAttribute(`style`)).toContain(
        `font-weight: lighter`,
      )
      expect(document.querySelector(`tbody tr`)?.getAttribute(`style`)).toContain(
        `background-color: yellow`,
      )
      const rows = document.querySelectorAll(`tbody tr`)
      expect(rows[0].classList.contains(`custom-row`)).toBe(true)
      for (const row of rows) expect(row.getAttribute(`class`)).not.toContain(`undefined`)
    })
  })

  describe(`Search and Filter`, () => {
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
      if (click) {
        doc_query<HTMLButtonElement>(`.control-buttons .icon-btn`).click()
        await tick()
      }

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
      fake_search_timers()
      const state = $state({ search_query: `` })
      const data = [
        { Model: `Model A`, Score: 0.95 },
        { Model: `Model B`, Score: 0.85 },
        { Model: `<b>bold</b> Model C`, Score: 0.75 },
      ]
      mount_table(bind_props({ data, columns: sample_columns, search: true }, state))

      state.search_query = query
      await tick()
      if (query.trim()) expect(col_values(`Model`)).toHaveLength(3) // debounced, not yet applied
      await settle_search(state, query)

      const model_cells = col_values(`Model`)
      expect(model_cells).toHaveLength(expected.length)
      for (const [idx, name] of expected.entries()) {
        expect(model_cells[idx]).toContain(name)
      }
    })

    it(`search.keys restricts matching to the given columns`, async () => {
      fake_search_timers()
      const state = $state({ search_query: `` })
      const data = [
        { Model: `Model A`, Note: `great` },
        { Model: `Model B`, Note: `model a lookalike` },
      ]
      const columns = plain_columns(`Model`, `Note`)
      mount_table(bind_props({ data, columns, search: { keys: [`Model`] } }, state))

      await settle_search(state, `model a`)

      // without keys, "model a lookalike" in Note would also match
      expect(col_values(`Model`)).toEqual([`Model A`])
    })

    it.each([
      [true, [`Model A`]], // "mdla" is an in-order subsequence of "model a"
      [false, []],
    ])(`search.fuzzy=%s controls subsequence matching`, async (fuzzy, expected) => {
      fake_search_timers()
      const state = $state({ search_query: `` })
      mount_table(
        bind_props({ data: sample_data, columns: sample_columns, search: { fuzzy } }, state),
      )

      await settle_search(state, `mdla`)

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
    it.each([
      { desc: `true shows CSV and JSON`, export_data: true, present: [`CSV`, `JSON`] },
      {
        desc: `formats restricts the options`,
        export_data: { formats: [`csv`] as `csv`[] },
        present: [`CSV`],
        absent: [`JSON`],
      },
    ])(`export_data=$desc`, async ({ export_data, present, absent }) => {
      mount_table({ data: sample_data, columns: sample_columns, export_data })
      await open_export_menu()

      const dropdown = document.querySelector(`.dropdown-pane`)
      for (const fmt of present) expect(dropdown?.textContent).toContain(fmt)
      for (const fmt of absent ?? []) expect(dropdown?.textContent).not.toContain(fmt)
    })
  })

  describe(`Column Visibility Toggle`, () => {
    // The menu is ToggleMenu, whose dropdown portals to <body>, so query from document.
    it(`toggles columns and resets without enabling caller-hidden columns`, async () => {
      const state = $state({ hidden_columns: [`Value`] })
      mount_table(
        bind_props(
          {
            data: sample_data,
            columns: [...sample_columns, { label: `Static`, visible: false }],
            show_column_toggle: true,
          },
          state,
        ),
      )
      await tick()
      expect(document.querySelectorAll(`th`)).toHaveLength(2)

      doc_query(`.column-toggles summary`).click()
      await tick()
      const boxes = [
        ...document.querySelectorAll<HTMLInputElement>(`.column-menu input[type="checkbox"]`),
      ]
      expect(boxes).toHaveLength(4)
      expect(boxes.at(-1)?.disabled).toBe(true)

      boxes[0].click()
      await tick()
      expect(state.hidden_columns).toEqual([`Value`, `Model`])
      expect(document.querySelectorAll(`th`)).toHaveLength(1)

      doc_query(`.column-toggles summary .reset-btn`).click()
      await tick()
      expect(state.hidden_columns).toEqual([])
      expect(document.querySelectorAll(`th`)).toHaveLength(3)
    })

    it(`keeps grouped IDs distinct from display-style ungrouped keys`, async () => {
      const state = $state({ hidden_columns: [] as string[] })
      mount_table(
        bind_props(
          {
            data: [{ 'Value (Group A)': 1 }],
            columns: [
              { key: `Value`, label: `Value`, group: `Group A` },
              {
                key: `Value (Group A)`,
                label: `Qualified value`,
              },
            ],
            show_column_toggle: true,
          },
          state,
        ),
      )
      await tick()

      doc_query(`.column-toggles summary`).click()
      await tick()
      document
        .querySelectorAll<HTMLInputElement>(`.sections-container input`)
        .forEach((checkbox) => checkbox.click())
      await tick()
      expect(state.hidden_columns).toEqual([`["Value","Group A"]`, `Value (Group A)`])

      doc_query(`.column-toggles summary .reset-btn`).click()
      await tick()
      expect(state.hidden_columns).toEqual([])
    })

    // The two menus overlap, so only one may be open. ToggleMenu owns its own open state,
    // so the column side has to route through the shared `open_dropdown` slot to close.
    it.each([[`columns`], [`export`]] as const)(
      `opening the %s menu closes the other`,
      async (first) => {
        mount_table({
          data: sample_data,
          columns: sample_columns,
          show_column_toggle: true,
          export_data: true,
        })
        const columns_btn = () => doc_query(`.column-toggles summary`)
        const export_btn = () => doc_query<HTMLButtonElement>(`.dropdown-wrapper .icon-btn`)
        // ToggleMenu keeps its dropdown mounted and toggles `hidden`; export renders on demand
        const open_menus = () =>
          [
            document.querySelector(`.column-menu:not([hidden])`),
            document.querySelector(`.dropdown-pane`),
          ].filter(Boolean).length

        ;(first === `columns` ? columns_btn() : export_btn()).click()
        await tick()
        expect(open_menus()).toBe(1)
        ;(first === `columns` ? export_btn() : columns_btn()).click()
        await tick()
        expect(open_menus()).toBe(1)
      },
    )
  })

  describe(`Row Selection`, () => {
    it(`tracks partial and full selection, then clears it`, async () => {
      const state = $state({ selected_rows: [] as RowData[] })
      mount_table(
        bind_props(
          { data: sample_data, columns: sample_columns, show_row_select: true },
          state,
        ),
      )
      const checkboxes = [
        ...document.querySelectorAll<HTMLInputElement>(`td.select-col input[type="checkbox"]`),
      ]
      expect(checkboxes).toHaveLength(3)
      expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true)

      checkboxes[0].click()
      await tick()
      const select_all = doc_query<HTMLInputElement>(`th.select-col input[type="checkbox"]`)
      expect(select_all.checked).toBe(false)
      expect(document.querySelector(`.selection-badge .badge`)?.textContent).toBe(`1`)

      for (const checkbox of checkboxes.slice(1)) {
        checkbox.click()
        await tick()
      }

      expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true)
      expect(select_all.checked).toBe(true)
      expect(state.selected_rows.map((row) => row.Model)).toEqual([
        `Model A`,
        `Model B`,
        `Model C`,
      ])
      const badge = document.querySelector<HTMLElement>(`.selection-badge .badge`)
      expect(badge?.textContent).toBe(`3`)
      expect(badge?.style.color).toBe(`white`) // accent #4a9eff is a mid-tone blue

      doc_query<HTMLButtonElement>(`.selection-badge`).click()
      await tick()
      expect(state.selected_rows).toEqual([])
      expect(document.querySelectorAll(`tr.selected`)).toHaveLength(0)
    })

    it(`contrasts selection badges against the accent color`, async () => {
      mount_table({
        data: sample_data,
        columns: sample_columns,
        show_row_select: true,
        style: `--accent-color: rgb(0 0 0)`,
      })
      document.querySelector<HTMLInputElement>(`td.select-col input[type="checkbox"]`)?.click()
      await tick()
      const badge = doc_query(`.selection-badge .badge`)
      expect(badge.style.color).toBe(`white`)
    })
  })

  describe(`Multi-Column Sorting`, () => {
    it(`Shift+click toggles multi-sort columns and regular click clears them`, async () => {
      mount_table({ data: sample_data, columns: sample_columns })
      const headers = document.querySelectorAll(`th`)
      const shift_click = async (idx: number) => {
        headers[idx].dispatchEvent(mouse(`click`, { shiftKey: true }))
        await tick()
      }

      await shift_click(0)
      await shift_click(1)
      expect(headers[0].innerHTML).toContain(`<sup>1</sup>`)
      expect(headers[1].innerHTML).toContain(`<sup>2</sup>`)
      expect(headers[0].textContent).toMatch(/[↑↓]/)
      expect(headers[1].textContent).toMatch(/[↑↓]/)

      await shift_click(0)
      expect(headers[0].textContent).not.toMatch(/[↑↓]/)
      expect(headers[1].innerHTML).not.toContain(`<sup>`)

      headers[2].click()
      await tick()
      expect(headers[0].innerHTML).not.toContain(`<sup>`)
      expect(headers[1].innerHTML).not.toContain(`<sup>`)
      expect(headers[2].textContent).toMatch(/[↑↓]/)
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
      expect(document.querySelector(`.page-size-select`)).toBeNull()

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

    it(`keeps the current page across same-length data refreshes, resets on row count change`, async () => {
      const state = $state({ data: large_data.map((row) => ({ ...row })) })
      mount_table(
        bind_props({ columns: sample_columns, pagination: { page_size: 10 } }, state),
      )
      const page_input = doc_query<HTMLInputElement>(`.page-input`)
      const next_btn = document.querySelectorAll<HTMLButtonElement>(`.page-btn`)[2]
      next_btn.click()
      await tick()
      expect(page_input.value).toBe(`2`)

      state.data[0].Value = 999 // live cell update
      await tick()
      expect(page_input.value).toBe(`2`)
      state.data = state.data.map((row) => ({ ...row })) // same-length replacement
      await tick()
      expect(page_input.value).toBe(`2`)

      state.data = state.data.slice(0, 30) // row count changed
      await tick()
      expect(page_input.value).toBe(`1`)
    })

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

    it(`renders configured options and applies page-size changes`, async () => {
      const on_page_size_change = vi.fn()
      mount_table({
        data: large_data,
        columns: sample_columns,
        pagination: { page_size: 10, page_sizes: [10, 25, 50], on_page_size_change },
      })

      const options = document.querySelectorAll(`.page-size-select option`)
      expect(options).toHaveLength(3)
      expect(Array.from(options).map((opt) => opt.textContent?.trim())).toEqual([
        `10 / page`,
        `25 / page`,
        `50 / page`,
      ])

      const select = document.querySelector(`.page-size-select`) as HTMLSelectElement
      select.value = `25`
      select.dispatchEvent(new Event(`change`, { bubbles: true }))
      await tick()

      expect(on_page_size_change).toHaveBeenCalledWith(25)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(25)
    })
  })

  it(`renders resize handles with ARIA roles and drags them into clamped column widths`, async () => {
    const column_prefs: Record<string, ColumnPrefs> = {}
    const state = $state({ column_prefs })
    mount_table(bind_props({ data: sample_data, columns: sample_columns }, state))

    const resize_handles = document.querySelectorAll<HTMLElement>(`.resize-handle`)
    expect(resize_handles).toHaveLength(3) // One per column
    expect(resize_handles[0].getAttribute(`role`)).toBe(`separator`)
    expect(resize_handles[0].getAttribute(`aria-orientation`)).toBe(`vertical`)

    // headers have no layout width in happy-dom, so widths start from 0 and clamp to [50, 500].
    // The handle captures the pointer, so every event of the drag targets it.
    const handle = resize_handles[1]
    const pointer = (type: string, clientX: number) =>
      handle.dispatchEvent(new PointerEvent(type, { clientX, bubbles: true, pointerId: 1 }))
    pointer(`pointerdown`, 100)
    pointer(`pointermove`, 220)
    await tick()
    expect(state.column_prefs.Score?.width).toBe(120)
    expect(doc_query(`th[data-col-id="Score"]`).style.width).toBe(`120px`)
    pointer(`pointermove`, 900)
    expect(state.column_prefs.Score?.width).toBe(500)
    pointer(`pointerup`, 900)
    pointer(`pointermove`, 300) // released: further movement must not resize
    expect(state.column_prefs.Score?.width).toBe(500)
    expect(state.column_prefs.Model).toBeUndefined()
    // the click that follows the release lands on the handle inside the sortable header
    handle.dispatchEvent(mouse(`click`))
    await tick()
    expect(doc_query(`th[data-col-id="Score"]`).getAttribute(`aria-sort`)).toBe(`none`)
  })

  describe(`Regression tests for bug fixes`, () => {
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
        { label: `Name` },
        { label: `Value`, group: `Group A` },
        { label: `Value`, group: `Group B` }, // Same label, different group
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
      expect(group_b_header.textContent).toContain(`Value`)

      group_b_header.click()
      await tick()

      // Should sort by Group B values (100, 50, 75)
      // data-col="Value" is used for both groups, so check Name column order instead
      // Group B values: Item 1=100, Item 2=50, Item 3=75
      // Default sort is descending: Item 1 (100), Item 3 (75), Item 2 (50)
      expect(col_values(`Name`)).toEqual([`Item 1`, `Item 3`, `Item 2`])
    })

    it(`renders, sorts, and colors plainly keyed grouped columns`, async () => {
      const columns: Label[] = [
        { label: `Name` },
        {
          label: `Mass`,
          group: `Physical`,
          color_scale: `interpolateViridis`,
        },
        { label: `Charge`, group: `Physical` },
      ]
      mount_table({
        data: [
          { Name: `O`, Mass: 16, Charge: -2 },
          { Name: `Fe`, Mass: 55.85, Charge: 3 },
        ],
        columns,
      })

      expect(col_values(`Mass`)).toEqual([`16`, `55.9`])
      expect(col_values(`Charge`)).toEqual([`−2`, `3`])
      expect(document.body.textContent).not.toContain(`n/a`)
      document.querySelectorAll<HTMLElement>(`thead tr:last-child th`)[1].click()
      await tick()
      expect(col_values(`Name`)).toEqual([`Fe`, `O`])
      for (const cell of document.querySelectorAll(`td[data-col="Mass"]`)) {
        expect(cell.getAttribute(`style`)).toContain(`--cell-bg:`)
      }
    })

    it(`finds qualified grouped keys after the first 50 rows`, () => {
      const data = Array.from({ length: 51 }, (_, idx) =>
        idx === 50 ? { Name: `late`, 'Mass (Physical)': 55.85 } : { Name: `row-${idx}` },
      )
      mount_table({
        data,
        columns: [{ label: `Name` }, { label: `Mass`, group: `Physical` }],
      })
      expect(col_values(`Mass`).at(-1)).toBe(`55.9`)
    })

    // Right-aligned digits are what make a column scannable; text and dates stay left.
    it(`right-aligns only all-numeric columns`, () => {
      mount_table({
        data: [
          { Name: `A`, Mass: 55.85, Mixed: 1, When: `2026-06-21`, Marked: `<b>1.5</b>` },
          {
            Name: `B`,
            Mass: 16,
            Mixed: `n/a-ish text`,
            When: `2026-06-22`,
            Marked: `<b data-sort-value="2.5">2.5 eV</b>`,
          },
        ],
        columns: [`Name`, `Mass`, `Mixed`, `When`, `Marked`].map((label) => ({
          label,
        })),
      })
      const aligned = (col: string) =>
        document.querySelector(`td[data-col="${col}"]`)?.classList.contains(`numeric-col`)

      expect(aligned(`Mass`)).toBe(true)
      expect(aligned(`Name`)).toBe(false)
      expect(aligned(`Mixed`)).toBe(false) // one non-numeric value disqualifies the column
      expect(aligned(`When`)).toBe(false) // dates read as text
      // markup and data-sort-value read as the numbers they sort by
      expect(aligned(`Marked`)).toBe(true)
      // header follows its column so the two line up
      const headers = [...document.querySelectorAll(`thead th`)]
      expect(headers.map((th) => th.classList.contains(`numeric-col`))).toEqual([
        false,
        true,
        false,
        false,
        true,
      ])
    })

    // A sampled scan of the leading rows would right-align this column and offer it a
    // range filter, then render text in it.
    it(`disqualifies a column whose only text value is past the first 50 rows`, () => {
      mount_table({
        data: Array.from({ length: 60 }, (_, idx) => ({
          Name: `row-${idx}`,
          Mass: idx === 59 ? `unknown` : idx,
        })),
        columns: plain_columns(`Name`, `Mass`),
      })
      expect(
        document.querySelector(`td[data-col="Mass"]`)?.classList.contains(`numeric-col`),
      ).toBe(false)
    })

    // aria-grabbed follows the drag state reactively rather than being poked onto the DOM
    // by the drag handlers, so it can't fall out of sync with what the component thinks.
    it(`marks the dragged header grabbed until the drag ends`, async () => {
      mount_table({ data: sample_data, columns: sample_columns })
      const header = document.querySelector(`thead tr:last-child th`) as HTMLElement
      const drag = (type: string) => {
        const event = new Event(type, { bubbles: true })
        Object.defineProperty(event, `dataTransfer`, {
          value: { effectAllowed: ``, dropEffect: ``, setData: vi.fn() },
        })
        header.dispatchEvent(event)
      }

      expect(header.getAttribute(`aria-grabbed`)).toBeNull()
      drag(`dragstart`)
      await tick()
      expect(header.getAttribute(`aria-grabbed`)).toBe(`true`)
      drag(`dragend`)
      await tick()
      expect(header.getAttribute(`aria-grabbed`)).toBeNull()
    })

    // Sticky columns all pin to the same edge, so any after the first must clear the ones
    // before it. Widths only exist after layout, hence the measured offsetWidth.
    it(`stacks multiple sticky columns instead of overlapping them`, async () => {
      let first_width = 80
      const width_spy = vi
        .spyOn(HTMLElement.prototype, `offsetWidth`, `get`)
        .mockImplementation(function (this: HTMLElement) {
          return this.dataset.colId === `Name` ? first_width : 80
        })
      onTestFinished(() => width_spy.mockRestore())
      mount_table({
        data: [{ Name: `A`, Tag: `x`, Value: 1 }],
        columns: [
          { label: `Name`, sticky: true },
          { label: `Tag`, sticky: true },
          { label: `Value` },
        ],
      })
      await tick()

      const left_of = (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.style.left
      expect(left_of(`thead th[data-col-id="Name"]`)).toBe(`0px`)
      expect(left_of(`thead th[data-col-id="Tag"]`)).toBe(`80px`)
      expect(left_of(`td[data-col="Tag"]`)).toBe(`80px`)
      expect(left_of(`td[data-col="Value"]`)).toBe(``)

      // the first header grows (a manual resize, longer label): every sticky column after it shifts
      first_width = 120
      trigger_resize_observer(doc_query(`thead th[data-col-id="Name"]`))
      await tick()
      expect(left_of(`thead th[data-col-id="Tag"]`)).toBe(`120px`)
      expect(left_of(`td[data-col="Tag"]`)).toBe(`120px`)
    })

    it(`clears the grouped-header offset when the final group is hidden`, async () => {
      const height_spy = vi
        .spyOn(HTMLElement.prototype, `clientHeight`, `get`)
        .mockReturnValue(24)
      try {
        const state = $state({ hidden_columns: [] as string[] })
        mount_table(
          bind_props(
            {
              data: [{ Name: `Fe`, Mass: 55.85 }],
              columns: [{ label: `Name` }, { label: `Mass`, group: `Physical` }],
            },
            state,
          ),
        )
        await tick()
        const table = document.querySelector(`table`)
        expect(table?.getAttribute(`style`)).toContain(`--group-header-height: 24px`)

        state.hidden_columns = [`["Mass","Physical"]`]
        await tick()
        expect(table?.getAttribute(`style`)).toContain(`--group-header-height: 0px`)
      } finally {
        height_spy.mockRestore()
      }
    })

    // Negatives must still enter the linear scale domain (not filtered as invalid).
    it(`heatmap works with negative values for linear scale`, () => {
      mount_table({
        data: value_rows([-100, 0, 100]),
        columns: [{ label: `Name` }, heatmap_col],
      })

      for (const cell of Array.from(document.querySelectorAll(`td[data-col="Value"]`))) {
        expect(cell.getAttribute(`style`) ?? ``).toContain(`--cell-bg:`)
      }
    })

    // Search-input filtering is skipped because Svelte 5's bind:value requires native
    // input simulation that happy-dom doesn't support.
    // The strip_html functionality is tested in tests/vitest/table/index.test.ts
  })

  describe(`Empty State`, () => {
    it(`shows an empty row with colspan over every column, select and row-number`, () => {
      mount_table({
        data: [],
        columns: sample_columns,
        show_row_select: true,
        show_row_numbers: true,
      })
      const cell = doc_query(`.empty-row td`)
      expect(cell.textContent?.trim()).toBe(`No data`)
      expect(cell.getAttribute(`colspan`)).toBe(`5`) // 3 data + select + row number
    })
  })

  describe(`Row Numbers`, () => {
    it(`shows 1-indexed numbers and # header when enabled`, () => {
      mount_table({ data: sample_data, columns: sample_columns, show_row_numbers: true })
      const headers = [...document.querySelectorAll(`th`)].map((th) => th.textContent?.trim())
      expect(headers).toContain(`#`)
      expect(
        [...document.querySelectorAll(`td.row-num-col`)].map((td) => td.textContent?.trim()),
      ).toEqual([`1`, `2`, `3`])
    })
  })

  describe(`Keyboard Navigation`, () => {
    it.each([
      { desc: `with on_row_click`, has_click: true, expected_tabindex: `0` },
      { desc: `without on_row_click`, has_click: false, expected_tabindex: null },
    ])(`tabindex $desc`, ({ has_click, expected_tabindex }) => {
      mount_table({
        data: sample_data,
        columns: sample_columns,
        ...(has_click ? { on_row_click: () => {} } : {}),
      })

      for (const row of Array.from(document.querySelectorAll(`tbody tr`))) {
        expect(row.getAttribute(`tabindex`)).toBe(expected_tabindex)
      }
    })

    it.each([{ key: `Enter` }, { key: ` ` }])(
      `triggers on_row_click on $key key`,
      async ({ key }) => {
        const clicked: unknown[] = []
        mount_table({
          data: sample_data,
          columns: sample_columns,
          on_row_click: (_event: KeyboardEvent | MouseEvent, row: Record<string, unknown>) =>
            clicked.push(row),
        })

        const first_row = document.querySelector(`tbody tr`) as HTMLElement
        first_row.dispatchEvent(keydown(key))
        await tick()

        expect(clicked).toHaveLength(1)
        expect(clicked[0]).toHaveProperty(`Model`, `Model A`)
      },
    )

    // Row actions are delegated to <tbody> and resolve their row from the DOM, so a table
    // rendered inside a cell snippet (whose own <tr>s carry no index) and a row whose data
    // columns are all hidden must still map back to the right row object
    it(`resolves row actions through nested tables and rows without data cells`, async () => {
      const on_row_click = vi.fn()
      const on_row_double_click = vi.fn()
      const data = [{ A: 1 }, { A: 2 }]
      const cell = createRawSnippet((_args: () => CellSnippetArgs) => ({
        render: () => `<table><tbody><tr><td class="inner">x</td></tr></tbody></table>`,
      }))
      const state = $state({ hidden_columns: [] as string[] })
      mount_table(
        bind_props(
          {
            data,
            columns: plain_columns(`A`),
            on_row_click,
            on_row_double_click,
            cell,
            show_row_select: true,
          },
          state,
        ),
      )
      await tick()
      const inner = document.querySelectorAll<HTMLElement>(`td.inner`)[1]
      inner.dispatchEvent(mouse(`click`))
      inner.dispatchEvent(mouse(`dblclick`))
      inner.dispatchEvent(keydown(`Enter`))
      expect(on_row_click.mock.calls.map((call) => call[1])).toEqual([data[1], data[1]])
      expect(on_row_double_click.mock.calls.map((call) => call[1])).toEqual([data[1]])

      on_row_click.mockClear()
      state.hidden_columns = [`A`]
      await tick()
      const last_row = doc_query(`tbody tr[data-row-idx="1"]`)
      expect(last_row.querySelector(`td[data-row-idx]`)).toBeNull()
      last_row.dispatchEvent(mouse(`click`))
      expect(on_row_click.mock.calls.map((call) => call[1])).toEqual([data[1]])
    })

    // A HeatmapTable nested in a cell (a per-row mini table) carries its own data-row-idx /
    // data-col-idx attributes, so the outer lookups must stop at their own <tbody> instead of
    // resolving the inner table's coordinates against the outer rows
    it(`ignores the indices of a nested HeatmapTable when resolving rows and cells`, async () => {
      const on_row_click = vi.fn()
      const data = [{ A: 1 }, { A: 2 }, { A: 3 }]
      // the inner markup mirrors what a nested HeatmapTable renders for its own first row
      const cell = createRawSnippet((_args: () => CellSnippetArgs) => ({
        render: () =>
          `<table><tbody><tr data-row-idx="0"><td data-row-idx="0" data-col-idx="0" class="inner">x</td></tr></tbody></table>`,
      }))
      mount_table({
        data,
        columns: plain_columns(`A`),
        on_row_click,
        cell,
        keyboard_cells: true,
      })
      await tick()
      const inner = document.querySelectorAll<HTMLElement>(`td.inner`)[2]
      inner.dispatchEvent(mouse(`click`))
      expect(on_row_click.mock.calls.map((call) => call[1])).toEqual([data[2]])

      // a drag started in the inner cell selects the outer cell it sits in, not (0, 0)
      inner.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true, button: 0 }))
      globalThis.dispatchEvent(new PointerEvent(`pointerup`))
      await tick()
      const selected = [...document.querySelectorAll<HTMLElement>(`td.cell-selected`)]
      expect(selected.map((td) => td.dataset.rowIdx)).toEqual([`2`])
      expect(selected[0].classList.contains(`inner`)).toBe(false)

      // keyboard: ArrowUp from the outer row 2 cell lands on the outer row 1 cell
      cell_at(2, 0).focus()
      cell_at(2, 0).dispatchEvent(keydown(`ArrowUp`))
      await tick()
      expect(document.activeElement).toBe(cell_at(1, 0))
    })
  })

  describe(`Filtering, summaries and per-column state`, () => {
    const metrics = plain_columns(`Model`, `Score`, `Tier`)
    const metric_rows = [
      { Model: `A`, Score: 10, Tier: `alpha` },
      { Model: `B`, Score: 20, Tier: `beta` },
      { Model: `C`, Score: 30, Tier: `alpha` },
    ]
    const rendered_models = () => col_values(`Model`)

    // Filters live in column_prefs, so setting them from the outside is the same code path
    // the funnel UI drives — and doubles as the persistence test for that prop.
    it.each<[string, ColumnFilter, string, string[]]>([
      [`numeric lower bound`, { kind: `numeric`, min: 20 }, `Score`, [`B`, `C`]],
      [`numeric range`, { kind: `numeric`, min: 15, max: 25 }, `Score`, [`B`]],
      [`category allow-list`, { kind: `category`, values: [`alpha`] }, `Tier`, [`A`, `C`]],
      [`substring`, { kind: `text`, text: `bet` }, `Tier`, [`B`]],
    ])(`filters rows by %s`, (_desc, filter, col_id, expected) => {
      mount_table({
        data: metric_rows,
        columns: metrics,
        column_prefs: { [col_id]: { filter } },
      })
      expect(rendered_models()).toEqual(expected)
    })

    it(`combines a column filter with the global search`, () => {
      mount_table({
        data: metric_rows,
        columns: metrics,
        search: true,
        search_query: `alpha`,
        column_prefs: { Score: { filter: { kind: `numeric`, min: 20 } } },
      })
      expect(rendered_models()).toEqual([`C`]) // alpha AND score >= 20
    })

    // Summary rows read the same stats the color scales use, so they must shrink with the
    // filter rather than describing the untouched data.
    it(`summarizes only the rows left after filtering`, async () => {
      const props = $state({
        data: metric_rows,
        columns: metrics,
        summary: [`mean`, `count`] as SummaryStat[],
        column_prefs: {} satisfies Record<string, ColumnPrefs>,
      })
      mount_table(props)
      const summary_cells = () =>
        [...document.querySelectorAll(`tfoot .summary-row`)].map((row) =>
          [...row.querySelectorAll(`td`)].map((cell) => cell.textContent?.trim()),
        )

      expect(summary_cells()).toEqual([
        [`mean`, `20`, ``],
        [`count`, `3`, ``],
      ])
      props.column_prefs = { Score: { filter: { kind: `numeric`, min: 20 } } }
      await tick()
      expect(summary_cells()).toEqual([
        [`mean`, `25`, ``],
        [`count`, `2`, ``],
      ])
    })

    it.each([
      [`higher`, [`0%`, `50%`, `100%`], `30`],
      [`lower`, [`100%`, `50%`, `0%`], `10`],
      [undefined, [`0%`, `50%`, `100%`], undefined],
    ] as const)(
      `sizes data bars and highlights best for better=%s`,
      (better, widths, best) => {
        mount_table({
          data: metric_rows,
          columns: [
            { label: `Model` },
            { label: `Score`, better, render_as: `bar`, highlight_best: true },
          ],
        })
        expect(
          [...document.querySelectorAll(`td[data-col="Score"] .data-bar`)].map(
            (bar) => (bar as HTMLElement).style.width,
          ),
        ).toEqual(widths)
        expect(
          document.querySelector(`td.best-cell[data-col="Score"]`)?.textContent?.trim(),
        ).toBe(best)
      },
    )

    it(`clears the sort on the third click`, async () => {
      const unsorted = [
        { Model: `A`, Score: 20, Tier: `alpha` },
        { Model: `B`, Score: 10, Tier: `beta` },
        { Model: `C`, Score: 30, Tier: `alpha` },
      ]
      mount_table({ data: unsorted, columns: metrics })
      const score_header = document.querySelectorAll(`thead th`)[1] as HTMLElement
      expect(score_header.textContent).not.toMatch(/[↑↓]/)
      // the header arrow follows the cycle: desc first (no `better`), then asc, then none
      for (const [expected, arrow] of [
        [[`C`, `A`, `B`], `↑`],
        [[`B`, `A`, `C`], `↓`],
        [[`A`, `B`, `C`], null],
      ] as const) {
        score_header.click()
        await tick()
        expect(rendered_models()).toEqual(expected)
        if (arrow) expect(score_header.textContent).toContain(arrow)
        else expect(score_header.textContent).not.toMatch(/[↑↓]/)
      }
    })

    // an initial_sort has no "unsorted" state to return to, so the cycle stays two-step
    it(`keeps cycling asc/desc under an initial_sort`, async () => {
      const unsorted = [
        { Model: `A`, Score: 20 },
        { Model: `B`, Score: 10 },
      ]
      mount_table({
        data: unsorted,
        columns: plain_columns(`Model`, `Score`),
        initial_sort: { column: `Score`, direction: `desc` },
      })
      const header = document.querySelectorAll(`thead th`)[1] as HTMLElement
      expect(rendered_models()).toEqual([`A`, `B`])
      for (const expected of [
        [`B`, `A`],
        [`A`, `B`],
        [`B`, `A`],
      ]) {
        header.click()
        await tick()
        expect(rendered_models()).toEqual(expected)
      }
    })

    // column_prefs holds widths and colors as well as filters, so a resize must not look
    // like a filter change — that re-filtered every row and wiped the cell selection.
    it(`keeps the cell selection when an unrelated pref changes`, async () => {
      const props = $state({
        data: metric_rows,
        columns: metrics,
        column_prefs: {} satisfies Record<string, ColumnPrefs>,
      })
      mount_table(props)
      await tick()
      const cell = document.querySelector(
        `td[data-row-idx="1"][data-col-idx="1"]`,
      ) as HTMLElement
      cell.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true, button: 0 }))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)

      props.column_prefs = { Score: { width: 180 } } // a resize, not a filter
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)
      expect(cell.style.width).toBe(`180px`)
    })

    // Past the auto-detect cap a checklist would be unusable, but a column explicitly
    // configured as `category` must still get its full option list rather than an empty panel.
    it(`lists every option for an explicitly categorical column past the cap`, async () => {
      const many = Array.from({ length: 60 }, (_v, idx) => ({ Tag: `t${idx}`, Score: idx }))
      mount_table({
        data: many,
        columns: [{ label: `Tag`, filter: `category` }, { label: `Score` }],
        show_filters: true,
      })
      await tick()
      ;(document.querySelector(`.column-filter-trigger`) as HTMLButtonElement).click()
      await tick()
      const options = document.querySelectorAll(`.column-filter-options label`)
      expect(options).toHaveLength(60)
      const event = keydown(`Escape`)
      vi.spyOn(event, `stopPropagation`)
      document.querySelector<HTMLElement>(`.column-filter-panel`)?.dispatchEvent(event)
      await tick()
      expect(document.querySelector(`.column-filter-panel`)).toBeNull()
      expect(event.stopPropagation).toHaveBeenCalledOnce()
    })

    // The funnel lives inside the sortable header, so every interaction with it must stop
    // before the header sorts or starts a drag
    it(`drives numeric, category and text filters from the header panel without sorting`, async () => {
      const column_prefs: Record<string, ColumnPrefs> = {}
      const state = $state({ column_prefs })
      const columns: Label[] = [{ label: `Model`, filter: `text` }, ...metrics.slice(1)]
      mount_table(bind_props({ data: metric_rows, columns, show_filters: true }, state))
      const headers = document.querySelectorAll<HTMLElement>(`th`)
      const open_panel = async (th: HTMLElement) => {
        th.querySelector<HTMLButtonElement>(`.column-filter-trigger`)?.click()
        await tick()
        expect(document.querySelectorAll(`.column-filter-panel`)).toHaveLength(1) // one at a time
        return doc_query(`.column-filter-panel`)
      }
      const set_input = async (input: HTMLInputElement | undefined, value: string) => {
        assert(input)
        input.value = value
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        await tick()
      }

      const [min_input, max_input] = (
        await open_panel(headers[1])
      ).querySelectorAll<HTMLInputElement>(`input[type="number"]`)
      expect(min_input.getAttribute(`placeholder`)).toBe(`10`)
      await set_input(min_input, `15`)
      expect(rendered_models()).toEqual([`B`, `C`])
      await set_input(max_input, `25`)
      expect(state.column_prefs.Score?.filter).toEqual({ kind: `numeric`, min: 15, max: 25 })
      await set_input(min_input, ``)
      await set_input(max_input, `abc`) // neither bound left: the filter is dropped entirely
      expect(state.column_prefs.Score?.filter).toBeUndefined()
      expect(rendered_models()).toEqual([`A`, `B`, `C`])

      const [alpha_box] = (await open_panel(headers[2])).querySelectorAll<HTMLInputElement>(
        `input`,
      )
      alpha_box.click()
      await tick()
      expect(state.column_prefs.Tier?.filter).toEqual({ kind: `category`, values: [`beta`] })
      expect(rendered_models()).toEqual([`B`])
      doc_query<HTMLButtonElement>(`.column-filter-clear`).click()
      await tick()
      expect(state.column_prefs.Tier?.filter).toBeUndefined()

      const text_input = (await open_panel(headers[0])).querySelector<HTMLInputElement>(
        `input[type="search"]`,
      )
      await set_input(text_input ?? undefined, `c`)
      expect(state.column_prefs.Model?.filter).toEqual({ kind: `text`, text: `c` })
      expect(rendered_models()).toEqual([`C`])

      // none of this reached the header: nothing got sorted
      expect([...headers].map((th) => th.getAttribute(`aria-sort`))).toEqual(
        Array(3).fill(`none`),
      )
    })

    it(`omits summary statistics for columns that aren't fully numeric`, () => {
      mount_table({
        data: [
          { Model: `A`, Score: 10, Mixed: `ok` },
          { Model: `B`, Score: 20, Mixed: 2 },
        ],
        columns: plain_columns(`Model`, `Score`, `Mixed`),
        summary: [`mean`],
      })
      const cells = [...document.querySelectorAll(`tfoot .summary-row td`)].map((cell) =>
        cell.textContent?.trim(),
      )
      expect(cells).toEqual([`mean`, `15`, ``]) // Mixed has a text value -> no mean
    })

    // Keyboard parity: arrows walk the active cell, Shift extends the rectangle,
    // Alt moves the column. All three were mouse-only before.
    it(`navigates, extends selection and moves columns from the keyboard`, async () => {
      const props = $state({
        data: metric_rows,
        columns: metrics,
        keyboard_cells: true,
        column_order: [] as string[],
      })
      mount_table(props as ComponentProps<typeof HeatmapTable>)
      await tick() // let column_order initialize; that write clears any pending selection

      // exactly one cell owns the tab stop, and it moves with the arrows
      expect(cell_at(0, 0).getAttribute(`tabindex`)).toBe(`0`)
      expect([...document.querySelectorAll(`td[tabindex="0"]`)]).toHaveLength(1)

      cell_at(0, 0).dispatchEvent(keydown(`ArrowDown`))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)
      expect(cell_at(1, 0).classList.contains(`cell-selected`)).toBe(true)
      expect(cell_at(1, 0).getAttribute(`tabindex`)).toBe(`0`)
      expect(document.activeElement).toBe(cell_at(1, 0))

      cell_at(1, 0).dispatchEvent(keydown(`ArrowRight`, { shiftKey: true }))
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(2)

      cell_at(1, 1).dispatchEvent(keydown(`ArrowLeft`, { altKey: true }))
      await tick()
      expect(props.column_order).toEqual([`Score`, `Model`, `Tier`])
    })

    // A persisted column_order may be stale (renamed/removed columns), partial (new columns)
    // or even contain repeats; the table renders the resolved order and writes it back.
    it(`reconciles a bound column_order with the current columns`, async () => {
      const state = $state({
        data: metric_rows,
        columns: metrics,
        column_order: [`Tier`, `Tier`, `Ghost`],
      })
      mount_table(bind_props({}, state))
      await tick()
      const header_ids = () =>
        [...document.querySelectorAll<HTMLElement>(`th[data-col-id]`)].map(
          (th) => th.dataset.colId,
        )
      expect(state.column_order).toEqual([`Tier`, `Model`, `Score`])
      expect(header_ids()).toEqual(state.column_order)

      state.columns = metrics.filter((col) => col.label !== `Model`)
      await tick()
      expect(state.column_order).toEqual([`Tier`, `Score`])
      expect(header_ids()).toEqual([`Tier`, `Score`])

      state.data = [] // while data reloads there are no columns: the persisted order survives
      state.columns = []
      await tick()
      expect(state.column_order).toEqual([`Tier`, `Score`])
    })
  })

  describe(`Export Enhancements`, () => {
    // Shared helper: mount, optionally interact, trigger an export, return blob text
    async function export_table_text(
      props: Partial<ComponentProps<typeof HeatmapTable>>,
      before_export?: () => Promise<void>,
      format = `CSV`,
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
        const format_btn = Array.from(
          document.querySelectorAll(`.dropdown-pane .dropdown-option`),
        ).find((btn) => btn.textContent?.includes(format)) as HTMLButtonElement
        format_btn.click()
        await tick()

        return await (create_url.mock.calls[0][0] as Blob).text()
      } finally {
        create_url.mockRestore()
        revoke_url.mockRestore()
        anchor_click.mockRestore()
        append_spy.mockRestore()
      }
    }

    // Escaping itself is covered by the exporter unit tests; this checks the download wiring,
    // header markup stripping and numeric-column alignment for every format
    it.each<[string, RowData, string[]]>([
      [
        `CSV`,
        { Model: `say "hi", ok`, 'E<sub>f</sub>': 1 },
        [`Model,Ef`, `"say ""hi"", ok",1`],
      ],
      [
        `MD`,
        { Model: `a\nb|c`, 'E<sub>f</sub>': 1 },
        [`| Model | Ef |`, `| :--- | ---: |`, `| a<br>b\\|c | 1 |`],
      ],
      [
        `TEX`,
        { Model: `Fe_2 & x^2 100%`, 'E<sub>f</sub>': 1 },
        [
          `\\begin{tabular}{lr}`,
          `  \\toprule`,
          `  Model & Ef \\\\`,
          `  \\midrule`,
          `  Fe\\_2 \\& x\\textasciicircum{}2 100\\% & 1 \\\\`,
          `  \\bottomrule`,
          `\\end{tabular}`,
        ],
      ],
    ])(
      `downloads %s with stripped headers and aligned numeric columns`,
      async (format, row, expected) => {
        const text = await export_table_text(
          { data: [row], columns: plain_columns(...Object.keys(row)) },
          undefined,
          format,
        )
        expect(text.split(`\n`)).toEqual(expected)
      },
    )

    it(`copy to clipboard writes TSV`, async () => {
      mount_table({
        data: [{ Model: `Model\tA\nB`, Score: 1, Value: 2 }],
        columns: sample_columns,
        export_data: true,
      })
      await open_export_menu()

      const copy_btn = Array.from(
        document.querySelectorAll(`.dropdown-pane .dropdown-option`),
      ).find((btn) => btn.textContent?.includes(`Copy`)) as HTMLButtonElement
      copy_btn.click()
      await tick()

      expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
        `Model\tScore\tValue\nModel A B\t1\t2`,
      )
    })

    it(`exports only selected rows`, async () => {
      const text = await export_table_text(
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
  })

  describe(`Controls Pane`, () => {
    it(`keeps an explicit null color preference available to reset`, async () => {
      const props = $state({
        data: sample_data,
        columns: [heatmap_col],
        column_prefs: {} satisfies Record<string, ColumnPrefs>,
        show_controls: true,
      })
      mount_table(props)
      document.querySelector<HTMLButtonElement>(`.pane-toggle`)?.click()
      await tick()
      props.column_prefs = { Value: { color_scale: null } }
      await tick()

      const reset = await vi.waitFor(() => {
        const button = document.querySelector<HTMLButtonElement>(
          `[aria-label="Reset column colors to defaults"]`,
        )
        expect(button).not.toBeNull()
        return button
      })
      assert(reset)
      reset.click()
      await tick()
      expect(cell_at(0, 0).style.getPropertyValue(`--cell-bg`)).not.toBe(``)
    })

    // Two ways the color control used to vanish from a column that still paints: gating the
    // list on "every value parses" dropped a mixed column, and gating it on column_stats
    // (derived from the FILTERED rows) dropped it mid-typing
    it(`keeps the color control for a mixed column the search empties of numbers`, async () => {
      fake_search_timers()
      const state = $state({ search_query: `` })
      const data = [
        { Model: `alpha 1`, Score: 1 },
        { Model: `alpha 2`, Score: 2 },
        { Model: `beta`, Score: `N/A` },
      ]
      const columns = plain_columns(`Model`, `Score`)
      mount_table(bind_props({ data, columns, show_controls: true, search: true }, state))
      document.querySelector<HTMLButtonElement>(`.pane-toggle`)?.click()
      await tick()
      const color_labels = () =>
        [...document.querySelectorAll(`.col-color-label`)].map((el) => el.textContent?.trim())
      expect(color_labels()).toEqual([`Score`])
      expect(cell_at(0, 1).style.getPropertyValue(`--cell-bg`)).not.toBe(``) // it paints

      await settle_search(state, `beta`) // filters away every numeric Score
      expect(col_values(`Model`)).toEqual([`beta`])
      expect(color_labels()).toEqual([`Score`])
    })
  })

  describe(`cell range selection and column copy`, () => {
    const pointer = (type: string, init: MouseEventInit = {}) =>
      mouse(type, { button: 0, ...init })
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

    it(`selects, extends, replaces, and copies cell ranges`, async () => {
      await mount_sample_table()

      drag_cells([0, 0], [1, 1])
      await tick()

      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(4)
      copy_shortcut()
      expect(written_text()).toBe(`Model A\t0.95\nModel B\t0.85`)

      drag_cells([0, 0], [0, 0])
      drag_cells([2, 2], [2, 2], { shiftKey: true })
      await tick()

      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(2)
      copy_shortcut()
      expect(written_text()).toBe(`Model A\n300`)

      drag_cells([2, 1], [2, 1])
      await tick()

      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)
      expect(cell_at(2, 1).classList.contains(`cell-selected`)).toBe(true)
    })

    it(`clears selection when columns hide, reorder, or sort`, async () => {
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

      drag_cells([0, 0], [1, 1])
      cell_at(1, 1).dispatchEvent(pointer(`click`)) // consume the post-drag click guard
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(4)
      doc_query(`th[data-col-id="Model"]`).click()
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
      const on_row_click = vi.fn()
      await mount_sample_table({ on_row_click })

      // drag across cells -> the click on release must not fire the row action
      drag_cells([0, 0], [1, 1])
      cell_at(1, 1).dispatchEvent(pointer(`click`))
      expect(on_row_click).not.toHaveBeenCalled()

      // plain click (pointer never moved) still fires the row action
      drag_cells([0, 0], [0, 0])
      cell_at(0, 0).dispatchEvent(pointer(`click`))
      expect(on_row_click).toHaveBeenCalledTimes(1)
    })

    it(`right-click copy column copies all filtered rows across pages`, async () => {
      await mount_sample_table({ pagination: { page_size: 2 } })

      cell_at(0, 0).dispatchEvent(pointer(`contextmenu`, { button: 2 }))
      await tick()

      const copy_option = [
        ...document.querySelectorAll<HTMLButtonElement>(`.action-menu button`),
      ].find((btn) => btn.textContent?.includes(`Copy column`))
      expect(copy_option?.textContent).toContain(`3 values`)
      copy_option?.click()
      await tick()

      // all rows, not just the 2 on the current page
      expect(written_text()).toBe(`Model A\nModel B\nModel C`)
      expect(document.querySelector(`.action-menu`)).toBeNull()
    })

    it(`context menu on headers offers copy for non-heatmap columns`, async () => {
      await mount_sample_table()

      const header = document.querySelector(`th`)
      header?.dispatchEvent(pointer(`contextmenu`, { button: 2 }))
      await tick()

      const options = [...document.querySelectorAll(`.action-menu button`)].map((btn) =>
        btn.textContent?.trim(),
      )
      expect(options.some((text) => text?.includes(`Copy column`))).toBe(true)
      // no color_scale on Model -> no gradient-direction section
      expect(options.some((text) => text?.includes(`Higher is better`))).toBe(false)

      // right-clicking another column while the menu is open must retarget it, not
      // leave it dismissed: the pointerdown of that right-click is an outside press
      const score_header = document.querySelectorAll(`th`)[1]
      score_header?.dispatchEvent(pointer(`pointerdown`, { button: 2 }))
      score_header?.dispatchEvent(pointer(`contextmenu`, { button: 2 }))
      await tick()
      expect(document.querySelector(`.action-menu`)).not.toBeNull()
    })

    // An unconfigured numeric column still gets the default viridis scale, so its gradient
    // direction is adjustable; `color_scale: null` in the prefs turns it back off
    it.each([
      [`hidden when preferences disable the color scale`, [heatmap_col], 0, false],
      [`offered on a bare numeric column`, plain_columns(`Model`, `Value`), 1, true],
    ])(`gradient controls %s`, async (_desc, columns, th_idx, shown) => {
      mount_table({
        data: sample_data,
        columns,
        column_prefs: { Value: { color_scale: shown ? undefined : null } },
        allow_better_toggle: true,
      })
      await tick()

      const headers = document.querySelectorAll(`th`)
      headers[th_idx].dispatchEvent(pointer(`contextmenu`, { button: 2 }))
      await tick()
      const menu_text = document.querySelector(`.action-menu`)?.textContent ?? ``
      expect(/Higher is better|Lower is better/.test(menu_text)).toBe(shown)
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
    const two_cols = plain_columns(`Model`, `Score`)
    const rendered_rows = () =>
      document.querySelectorAll(`tbody tr:not(.virtual-spacer):not(.empty-row)`)
    const spacers = () => [
      ...document.querySelectorAll<HTMLTableRowElement>(`tr.virtual-spacer`),
    ]
    const scroll_to = async (scroll_top: number): Promise<HTMLDivElement> => {
      const scroller = doc_query<HTMLDivElement>(`.table-scroll`)
      scroller.scrollTop = scroll_top
      scroller.dispatchEvent(new Event(`scroll`))
      await tick()
      return scroller
    }

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
        virtual: true,
        keyboard_cells: true,
      })
      const scroller = await scroll_to(30 * row_height_px)

      const start = 30 - overscan
      const end = start + min_window
      expect(rendered_rows()).toHaveLength(min_window)
      expect(spacers()).toHaveLength(2)
      expect(spacers()[0].style.height).toBe(`${start * row_height_px}px`)
      expect(spacers()[1].style.height).toBe(`${(many_rows.length - end) * row_height_px}px`)
      expect(rendered_rows()[0].querySelector(`.row-num-col`)?.textContent?.trim()).toBe(`21`)
      expect(col_values(`Model`)[0]).toBe(`Model 20`)

      cell_at(start, 0).dispatchEvent(keydown(`ArrowRight`))
      await tick()
      expect(scroller.scrollTop).toBe(30 * row_height_px)

      cell_at(end - 1, 0).dispatchEvent(keydown(`ArrowDown`))
      await tick()
      expect(scroller.scrollTop).toBe(end * row_height_px)
      expect(document.activeElement).toBe(
        document.querySelector(`td[data-row-idx="${end}"][data-col-idx="0"]`),
      )
    })

    it(`measures hidden rows on resize without scroll feedback`, async () => {
      let measurement_reads = 0
      let rows_have_layout = false
      const offset_height_spy = vi
        .spyOn(HTMLElement.prototype, `offsetHeight`, `get`)
        .mockImplementation(function (this: HTMLElement) {
          if (!(this instanceof HTMLTableRowElement)) return 0
          if (++measurement_reads > min_window * 5) {
            throw new Error(`row-height measurement loop`)
          }
          if (!rows_have_layout) return 0
          const row_idx = Number(
            this.querySelector<HTMLElement>(`[data-row-idx]`)?.dataset.rowIdx,
          )
          return row_idx < 90 ? 20 : 60
        })
      onTestFinished(() => offset_height_spy.mockRestore())
      const state = $state({ data: [] as RowData[] })
      mount_table(bind_props({ columns: two_cols, virtual: true }, state))
      await tick()
      expect(measurement_reads).toBe(0)

      state.data = many_rows
      await tick()

      for (const scroll_top of [3000, 0, 3000, 0]) {
        await scroll_to(scroll_top)
        expect(rendered_rows().length).toBeGreaterThan(0)
      }
      expect(measurement_reads).toBe(min_window)

      const scroller = doc_query<HTMLDivElement>(`.table-scroll`)
      rows_have_layout = true
      Object.defineProperty(scroller, `clientWidth`, { value: 700, configurable: true })
      trigger_resize_observer(scroller)
      await tick()
      expect(measurement_reads).toBe(min_window * 2)

      state.data = [...many_rows, { Model: `Model 201`, Score: 0.5 }]
      await tick()
      expect(measurement_reads).toBe(min_window * 2)
      expect(spacers()[0].style.height).toBe(`${(state.data.length - min_window) * 20}px`)

      Object.defineProperty(scroller, `clientWidth`, { value: 600, configurable: true })
      trigger_resize_observer(scroller)
      await tick()
      expect(measurement_reads).toBe(min_window * 3)
    })

    it(`does not force layout for every row when the virtual window moves`, async () => {
      const rect_spy = vi.spyOn(Element.prototype, `getBoundingClientRect`)
      onTestFinished(() => rect_spy.mockRestore())
      mount_table({ data: many_rows, columns: two_cols, virtual: true })
      await tick()
      rect_spy.mockClear()

      await scroll_to(11 * row_height_px)
      expect(rect_spy).not.toHaveBeenCalled()
    })

    // Clickable rows step by absolute index, not DOM sibling: the element after the last
    // rendered row is a spacer, so sibling-walking stranded keyboard users at the window edge.
    it(`arrow keys walk clickable rows across the virtual window boundary`, async () => {
      mount_table({
        data: many_rows,
        columns: two_cols,
        virtual: true,
        on_row_click: () => {},
      })
      await tick() // let bind:this resolve the scroll container
      const scroller = doc_query<HTMLDivElement>(`.table-scroll`)
      const row_at = (abs_idx: number) =>
        document.querySelector(`td[data-row-idx="${abs_idx}"]`)?.closest(`tr`)

      const last_rendered = row_at(min_window - 1)
      assert(last_rendered)
      last_rendered.dispatchEvent(keydown(`ArrowDown`))
      await tick()

      expect(scroller.scrollTop).toBeGreaterThan(0) // pulled the next row into the window
      expect(document.activeElement).toBe(row_at(min_window))

      row_at(min_window)?.dispatchEvent(keydown(`ArrowUp`))
      await tick()
      expect(document.activeElement).toBe(row_at(min_window - 1))
    })

    it(`clamps the rendered window when data shrinks below the scroll position`, async () => {
      const state = $state({ data: many_rows })
      mount_table(bind_props({ columns: two_cols, virtual: true }, state))
      await scroll_to(150 * row_height_px) // deep into the 200 rows
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

    // A narrowed result set starts at its top: keeping the old offset drops the user past
    // the end of the matches (row 140 of 111), so they land on the tail, not the first hit.
    it(`returns to the top of the results when the search query changes`, async () => {
      fake_search_timers()
      const state = $state({ search_query: `` })
      mount_table(bind_props({ data: many_rows, columns: two_cols, virtual: true }, state))
      const scroller = await scroll_to(150 * row_height_px)
      expect(spacers()[0].style.height).toBe(`${(150 - overscan) * row_height_px}px`)

      await settle_search(state, `Model 1`) // matches 111 of the 200 rows
      expect(scroller.scrollTop).toBe(0)
      expect(spacers()).toHaveLength(1) // bottom only, so the window starts at row 0
    })

    it.each([
      [`virtualization is off by default: every row renders`, {}, many_rows.length],
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
})
