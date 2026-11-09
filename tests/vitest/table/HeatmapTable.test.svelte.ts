import type { ShowControlsProp } from '#lib/controls.js'
import type {
  CellSnippetArgs,
  ColumnPrefs,
  Column,
  RowData,
  RowId,
  SummaryStat,
} from '#lib/table/index.js'
import HeatmapTable from '#lib/table/HeatmapTable.svelte'
import { TABLE_EXPORT_FORMATS } from '#lib/table/index.js'
import type { Component, ComponentProps } from 'svelte'
import { createRawSnippet, flushSync, mount, tick } from 'svelte'
import { assert, describe, expect, expectTypeOf, it, onTestFinished, vi } from 'vitest'
import { bind_props, doc_query, fire } from '../setup'

// vp lint sees .svelte imports as nongeneric; specialize only row-dependent props for mount.
type TableProps<Row extends object = RowData> = Omit<
  ComponentProps<typeof HeatmapTable>,
  `data` | `columns` | `cell` | `row_key` | `on_row_click` | `on_row_double_click`
> & {
  data: Row[]
  columns?: Column<Row>[]
  cell?: Column<Row>[`cell`]
  row_key?: Extract<keyof Row, string> | ((row: Row) => RowId)
  on_row_click?: (event: MouseEvent | KeyboardEvent, row: Row) => void
  on_row_double_click?: (event: MouseEvent, row: Row) => void
}
const mount_table = (props: TableProps): ReturnType<typeof mount> =>
  mount(HeatmapTable as Component<TableProps>, { target: document.body, props })

const plain_columns = (...labels: string[]): Column[] =>
  labels.map((label) => ({ id: label, label }))
const value_rows = (values: readonly RowData[string][]): RowData[] =>
  values.map((value, idx) => ({ Name: String.fromCodePoint(65 + idx), Value: value }))

// Whitespace-collapsed text of every element matching the selector
const texts = (selector: string): (string | undefined)[] =>
  [...document.querySelectorAll(selector)].map((elem) =>
    elem.textContent?.replaceAll(/\s+/g, ` `).trim(),
  )
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
  it(`accepts named row interfaces with typed keys and cell callbacks`, async () => {
    interface Measurement {
      id: number
      score: number
    }
    const cell = createRawSnippet((args: () => CellSnippetArgs<Measurement>) => ({
      render: () => {
        expectTypeOf(args().row).toEqualTypeOf<Measurement>()
        return `<span>${args().row.score}</span>`
      },
    }))
    expectTypeOf<Column<Measurement>[`key`]>().toEqualTypeOf<`id` | `score` | undefined>()
    expectTypeOf<{ id: `missing_score`; label: `Score` }>().not.toExtend<Column<Measurement>>()
    expectTypeOf<{ id: `display`; key: `score`; label: `Score` }>().toExtend<
      Column<Measurement>
    >()
    const columns: Column<Measurement>[] = [
      { id: `value`, key: `score`, label: `Score`, cell },
    ]
    const data: Measurement[] = [{ id: 1, score: 42 }]
    mount(HeatmapTable as Component<TableProps<Measurement>>, {
      target: document.body,
      props: { data, columns, row_key: `id` },
    })
    await tick()
    expect(col_values(`Score`)).toEqual([`42`])
  })

  const sample_data = [
    { Model: `Model A`, Score: 0.95, Value: 100 },
    { Model: `Model B`, Score: 0.85, Value: 200 },
    { Model: `Model C`, Score: 0.75, Value: 300 },
  ]

  const sample_columns: Column[] = [
    { id: `Model`, label: `Model`, pin: `left` },
    { id: `Score`, label: `Score`, better: `higher`, format: `.2f` },
    { id: `Value`, label: `Value`, better: `lower` },
  ]

  const mount_sample = (props: Partial<TableProps> = {}) =>
    mount_table(bind_props({ data: sample_data, columns: sample_columns }, props))

  const heatmap_col: Column = {
    id: `Value`,
    label: `Value`,
    color_scale: `interpolateViridis`,
  }

  const click = async (element: HTMLElement | null | undefined) => {
    assert(element)
    element.click()
    await tick()
  }
  const open_export_menu = () => click(doc_query(`button.export-toggle`))

  it.each([false, true])(
    `renders table structure, hidden columns and row numbers=%s`,
    (show_row_numbers) => {
      const columns = [...sample_columns, { id: `Hidden`, label: `Hidden`, visible: false }]
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      onTestFinished(() => warn.mockRestore())
      mount_sample({ columns, show_row_numbers })
      flushSync() // only the column whose key is in no row warns (it would render all n/a)
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `DataTable column Hidden: key Hidden is in no row`,
      )
      const model_cols = [`Model`, `Score`, `Value`]
      expect(texts(`th`)).toEqual(show_row_numbers ? [`#`, ...model_cols] : model_cols)
      expect(document.querySelectorAll(`tbody tr`)).toHaveLength(3)
      expect(document.querySelector(`tbody tr[tabindex]`)).toBeNull() // no on_row_click
      expect(document.querySelectorAll(`td[data-col="Hidden"]`)).toHaveLength(0)
      expect(texts(`td.row-num-col`)).toEqual(show_row_numbers ? [`1`, `2`, `3`] : [])
      expect(document.querySelector(`tfoot`)).toBeNull() // no footer snippet -> no tfoot
      expect(document.querySelector(`.empty-row`)).toBeNull() // data present -> no empty row
      expect(document.querySelector(`.pane-toggle`)).toBeNull()
      expect(document.querySelector(`button.export-toggle`)).toBeNull() // export is opt-in
      expect(document.querySelector(`.sort-hint`)).toBeNull()
    },
  )

  describe(`Sorting and Data Updates`, () => {
    // Svelte already skips DOM writes of unchanged values, so beyond node identity and DOM
    // mutations this counts each column's td attribute-effect runs through a `label` getter
    // (every td reads it for data-col): stable column views keep other columns' cells idle.
    it(`updates one cell in place, repainting its column only when the color range moves`, () => {
      const label_reads: Record<string, number> = {}
      type Extra = Pick<Column, `better` | `color_scale` | `highlight_best`>
      const counted = (id: string, label: string, extra: Extra = {}): Column => ({
        id,
        ...extra,
        get label() {
          label_reads[id] = (label_reads[id] ?? 0) + 1
          return label
        },
      })
      const columns = [
        counted(`name`, `Name`),
        counted(`count`, `Count`, { color_scale: null }),
        counted(`energy`, `Energy`, { better: `higher`, highlight_best: true }),
        counted(`phase`, `Phase`),
      ]
      const phases = [`solid`, `liquid`, `gas`]
      let data = $state.raw(
        Array.from({ length: 20 }, (_, idx) => ({
          name: `row ${idx}`,
          count: idx * 3,
          energy: idx / 4,
          phase: phases[idx % 3],
        })),
      )
      mount_table({
        get data() {
          return data
        },
        columns,
        row_key: `name`,
      })
      flushSync()
      const tbody = doc_query(`tbody`)
      const nodes = () => [...tbody.querySelectorAll(`tr, td`)]
      const initial_nodes = nodes()
      expect(initial_nodes).toHaveLength(20 * 5)
      const energy_styles = () =>
        Array.from({ length: 20 }, (_, idx) => cell_at(idx, 2).style.cssText)
      const initial_styles = energy_styles()
      const best_row = () => doc_query(`td.best-cell`).dataset.rowIdx
      expect(best_row()).toBe(`19`)
      const observer = new MutationObserver(() => {})
      observer.observe(tbody, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })
      onTestFinished(() => observer.disconnect())
      // Replaces one row object, returning the cells whose DOM changed
      const update_energy = (row_idx: number, energy: number): HTMLElement[] => {
        for (const id of Object.keys(label_reads)) label_reads[id] = 0
        data = data.with(row_idx, { ...data[row_idx], energy })
        flushSync()
        // a mutated row or tbody maps to itself, failing the column checks below
        const targets = observer.takeRecords().map(({ target }) => {
          const element = target instanceof HTMLElement ? target : target.parentElement
          return element?.closest(`td`) ?? element
        })
        return [...new Set(targets)].filter((node) => node != null)
      }

      // A new maximum moves the color range: the whole Energy column repaints, nothing else
      const repainted = update_energy(7, 99)
      expect(label_reads).toEqual({ name: 0, count: 0, energy: 20, phase: 0 })
      expect(cell_at(7, 2).textContent?.trim()).toBe(`99`)
      expect(repainted.every((cell) => cell.dataset.col === `Energy`)).toBe(true)
      expect(repainted).toContain(cell_at(7, 2))
      expect(repainted).toContain(cell_at(19, 2))
      expect(best_row()).toBe(`7`)

      // An edit inside the range keeps the column's color function: one cell re-runs
      const edited = update_energy(3, 0.8)
      expect(label_reads).toEqual({ name: 0, count: 0, energy: 1, phase: 0 })
      expect(edited).toHaveLength(1)
      expect(edited[0]).toBe(cell_at(3, 2))
      expect(cell_at(3, 2).textContent?.trim()).toBe(`0.8`)

      // Restoring the old maximum restores every other cell's color
      update_energy(7, 7 / 4)
      update_energy(3, 3 / 4)
      expect(energy_styles()).toEqual(initial_styles)
      expect(best_row()).toBe(`19`)
      const current = nodes()
      expect(current).toHaveLength(initial_nodes.length)
      expect(current.every((node, idx) => node === initial_nodes[idx])).toBe(true)
    })

    // Uncertainty strings sort and colour by their primary value (parse_numeric_val covers the
    // notations one by one in index.test.ts; this checks the table wires sorting through it)
    it(`sorts and colours cells with mixed uncertainty notation by the primary value`, async () => {
      const input = [`1.5 ± 0.2`, `0.8`, `2.3(5)`, `-1.0 +- 0.1`, `5.0e-4 ± 1e-4`]
      mount_table({
        data: value_rows(input),
        columns: [
          { id: `Name`, label: `Name` },
          { ...heatmap_col, better: `lower` },
        ],
      })
      const style_attrs = () =>
        [...document.querySelectorAll(`td[data-col="Value"]`)].map(
          (cell) => cell.getAttribute(`style`) ?? ``,
        )
      // every cell is numeric, so every cell gets a (distinct) heatmap background
      expect(style_attrs().every((style) => style.includes(`--cell-bg:`))).toBe(true)
      expect(new Set(style_attrs()).size).toBe(input.length)
      await click(document.querySelectorAll(`th`)[1])
      const sorted = [`-1.0 +- 0.1`, `5.0e-4 ± 1e-4`, `0.8`, `1.5 ± 0.2`, `2.3(5)`]
      expect(col_values(`Value`)).toEqual(sorted)
    })

    // Per-cell guard: only numeric cells get --cell-bg, strings never do. Negatives must still
    // enter the linear scale domain rather than be filtered as invalid.
    it.each<{
      desc: string
      values: RowData[string][]
      colored: boolean[]
      props?: Partial<TableProps>
    }>([
      { desc: `non-numeric strings`, values: [`hello`, `world`], colored: [false, false] },
      {
        desc: `mixed values`,
        values: [10, `not a number`, 100],
        colored: [true, false, true],
      },
      { desc: `negative values`, values: [-100, 0, 100], colored: [true, true, true] },
      {
        desc: `show_heatmap=false`,
        values: [0, 50, 100],
        colored: [false, false, false],
        props: { show_heatmap: false },
      },
      {
        desc: `column preferences disabling the color scale`,
        values: [0, 50, 100],
        colored: [false, false, false],
        props: { column_prefs: { Value: { color_scale: null } } },
      },
    ])(`colors only numeric heatmap cells with $desc`, ({ values, colored, props }) => {
      mount_table({
        data: value_rows(values),
        columns: [{ id: `Name`, label: `Name` }, heatmap_col],
        ...props,
      })
      const has_bg = [...document.querySelectorAll(`td[data-col="Value"]`)].map((cell) =>
        (cell.getAttribute(`style`) ?? ``).includes(`--cell-bg:`),
      )
      expect(has_bg).toEqual(colored)
    })
  })

  it(`formats numbers with column format strings`, () => {
    mount_table({
      data: [{ Num: 0.123 }, { Num: 1.234 }],
      columns: [{ id: `Num`, label: `Num`, format: `.1%` }],
    })
    expect(col_values(`Num`)).toEqual([`12.3%`, `123.4%`])
  })

  it.each([
    [`white`, `black`],
    [`black`, `white`],
  ])(`maps scale types and contrasts opacity over a %s page`, async (page_bg, text_color) => {
    const columns: Column[] = [
      { ...heatmap_col, id: `Linear`, label: `Linear`, better: `higher` },
      {
        ...heatmap_col,
        id: `Log`,
        label: `Log`,
        better: `higher`,
        color_scale: { scheme: `interpolateViridis`, type: `log` },
      },
      // a scheme picked in the controls keeps the column's log type
      {
        ...heatmap_col,
        id: `Picked`,
        label: `Picked`,
        better: `higher`,
        color_scale: { scheme: `interpolatePlasma`, type: `log` },
      },
    ]
    const data = [0, 10, 100, 1000].map((val) => ({ Linear: val, Log: val, Picked: val }))

    // a faint wash so the page shows through: viridis' dark purple at 50% would be a
    // mid-tone that takes white text over either page
    mount_table({
      data,
      columns,
      heatmap_opacity: 0.2,
      style: `--page-bg: ${page_bg}`,
      column_prefs: { Picked: { color_scale: `interpolateViridis` } },
    })
    await tick()

    const [linear_styles, log_styles, picked_styles] = columns.map(({ label }) =>
      Array.from(
        document.querySelectorAll(`td[data-col="${label}"]`),
        (cell) => cell.getAttribute(`style`) ?? ``,
      ),
    )
    expect(picked_styles).toEqual(log_styles)

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

  it(`prevents HTML strings from being used as data-sort-value attributes`, async () => {
    const html_data = [
      {
        HTML: `<span data-sort-value="100" title="This is a tooltip">100 units</span>`,
        Complex: `<span data-sort-value="3373529" title="Complex tooltip with multiple lines&#013;• Line item 1&#013;• Line item 2">3.37M <small>(details)</small> (<a href="https://example.com">Link</a>)</span>`,
      },
    ]
    mount_table({ data: html_data, columns: plain_columns(`HTML`, `Complex`) })
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

  // DataTable applies root, density, column and row styles; HeatmapTable merges the host's
  // style with its fill-opacity and selection-badge variables
  it(`merges the host style with the heatmap's table variables`, () => {
    mount_table({
      data: sample_data,
      columns: sample_columns,
      style: `color: red`,
      heatmap_opacity: 0.4,
    })
    const root_style = doc_query(`.table-container`).getAttribute(`style`) ?? ``
    expect(root_style).toContain(`color: red`)
    expect(root_style).toContain(`--table-fill-opacity: 40%`)
    expect(root_style).toMatch(/--table-badge-color: (?:black|white)/)
  })

  it(`renders, sorts, and colors plainly keyed grouped columns`, async () => {
    const columns: Column[] = [
      { id: `Name`, label: `Name` },
      {
        id: `Mass (Physical)`,
        key: `Mass`,
        label: `Mass`,
        group: `Physical`,
        color_scale: `interpolateViridis`,
      },
      { id: `Charge (Physical)`, key: `Charge`, label: `Charge`, group: `Physical` },
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
    await click(document.querySelectorAll<HTMLElement>(`thead tr:last-child th`)[1])
    expect(col_values(`Name`)).toEqual([`Fe`, `O`])
    for (const cell of document.querySelectorAll(`td[data-col="Mass"]`))
      expect(cell.getAttribute(`style`)).toContain(`--cell-bg:`)
  })

  describe(`Filtering, summaries and per-column state`, () => {
    const metrics = plain_columns(`Model`, `Score`, `Tier`)
    const metric_rows = [
      { Model: `A`, Score: 10, Tier: `alpha` },
      { Model: `B`, Score: 20, Tier: `beta` },
      { Model: `C`, Score: 30, Tier: `alpha` },
    ]

    it(`normalizes columns independently and enables median summaries on demand`, async () => {
      const values = [...Array.from({ length: 20 }, (_, idx) => idx * 5), 10_000]
      const props = $state({
        data: values.map((value, idx) => ({
          Name: `row_${idx}`,
          Quantile: value,
          Linear: value,
        })),
        columns: [
          { id: `Name`, label: `Name` },
          { id: `Quantile`, label: `Quantile`, normalize: `quantile` },
          { id: `Linear`, label: `Linear` },
        ] as Column[],
        summary: [] as SummaryStat[],
      })
      mount_table(props)
      const fill = (row_idx: number, col_idx: number) =>
        cell_at(row_idx, col_idx).style.getPropertyValue(`--cell-bg`)
      expect(fill(19, 1)).toBe(fill(20, 1)) // 95 and the outlier saturate above q95
      expect(fill(19, 2)).not.toBe(fill(20, 2)) // minmax keeps the full domain
      props.columns[1].normalize = `minmax`
      props.summary = [`median`]
      await tick()
      expect(fill(19, 1)).toBe(fill(19, 2))
      expect(
        [...document.querySelectorAll(`tfoot .summary-row td`)].map((cell) =>
          cell.textContent?.trim(),
        ),
      ).toEqual([`median`, `50`, `50`])
      // A later column widens the shared domain of columns already processed.
      props.columns[1].domain_group = `values`
      props.columns[2].domain_group = `values`
      props.data[19].Linear = 10_000
      props.data[20].Linear = 20_000
      await tick()
      expect(fill(20, 1)).toBe(fill(19, 2))
      expect(fill(20, 1)).not.toBe(fill(20, 2))
    })

    // column_prefs holds widths and colors as well as filters, so a resize must not look
    // like a filter change — that re-filtered every row and wiped the cell selection.
    it(`updates preferences without rescanning offscreen rows or clearing selection`, async () => {
      let offscreen_reads = 0
      const props = $state({
        data: [
          ...metric_rows,
          {
            Model: `D`,
            get Score() {
              offscreen_reads++
              return 40
            },
          },
        ],
        columns: metrics.map((col) => ({ ...col, highlight_best: true })),
        pagination: { page_size: 3 },
        summary: true,
        column_prefs: {} satisfies Record<string, ColumnPrefs>,
      })
      mount_table(props)
      await tick()
      const cell = document.querySelector(
        `td[data-row-idx="1"][data-col-idx="1"]`,
      ) as HTMLElement
      await fire(cell, new PointerEvent(`pointerdown`, { bubbles: true, button: 0 }))
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)

      offscreen_reads = 0
      props.column_prefs = { Score: { width: 180 } } // a resize, not a filter
      await tick()
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)
      expect(cell.style.width).toBe(`180px`)
      props.column_prefs = {
        Score: { width: 180, better: `lower`, color_scale: `interpolatePlasma` },
      }
      await tick()
      expect(offscreen_reads).toBe(0)
      expect(document.querySelectorAll(`td.cell-selected`)).toHaveLength(1)
      expect(
        document.querySelector(`td.best-cell[data-col="Score"]`)?.textContent?.trim(),
      ).toBe(`10`)
      expect(document.querySelector(`tfoot td:nth-child(2)`)?.textContent?.trim()).toBe(`25`)
      props.data[3] = { Model: `D`, Score: 80 }
      await tick()
      expect(document.querySelector(`tfoot td:nth-child(2)`)?.textContent?.trim()).toBe(`35`)
    })
  })

  describe(`Export`, () => {
    const download_labels = () =>
      [...document.querySelectorAll(`.export-pane button[aria-label^="Download "]`)].map(
        (btn) => btn.getAttribute(`aria-label`)?.replace(`Download `, ``),
      )
    it(`export_formats restricts the options`, async () => {
      mount_sample({ export_formats: [`csv`] })
      await open_export_menu()
      expect(download_labels()).toEqual([`CSV`])
      doc_query(`.table-container`).dispatchEvent(new MouseEvent(`mouseleave`))
      await tick()
      // an open pane keeps the hover toolbar visible
      expect(doc_query(`.control-buttons`).classList.contains(`force-visible`)).toBe(true)
    })

    // Shared helper: mount, optionally interact, trigger an export, return blob text
    async function export_table_text(
      props: Partial<TableProps>,
      before_export?: () => Promise<void>,
      format = `CSV`,
    ): Promise<string> {
      const create_url = vi.spyOn(URL, `createObjectURL`).mockReturnValue(`blob:test`)
      const revoke_url = vi.spyOn(URL, `revokeObjectURL`).mockImplementation(() => {})
      const anchor_click = vi
        .spyOn(HTMLAnchorElement.prototype, `click`)
        .mockImplementation(() => {})

      try {
        mount_table({
          show_column_toggle: true,
          export_formats: TABLE_EXPORT_FORMATS,
          ...props,
        } as TableProps)
        if (before_export) await before_export()
        await open_export_menu()
        const format_btn = doc_query<HTMLButtonElement>(`[aria-label="Download ${format}"]`)
        format_btn.dispatchEvent(new PointerEvent(`pointerdown`, { bubbles: true }))
        await tick()
        // A closed Columns menu must not clear the sibling export pane on pointerdown.
        expect(format_btn.isConnected).toBe(true)
        await click(format_btn)

        return await (create_url.mock.calls[0][0] as Blob).text()
      } finally {
        create_url.mockRestore()
        revoke_url.mockRestore()
        anchor_click.mockRestore()
      }
    }

    // Escaping itself is covered by the exporter unit tests; this checks the download wiring,
    // header markup stripping and numeric-column alignment for every format
    it.each<[string, RowData, string[]]>([
      [
        `CSV`,
        { Model: `say "hi", ok`, 'E<sub>f</sub> &amp; &Delta;H': 1 },
        [`Model,Ef & ΔH`, `"say ""hi"", ok",1`],
      ],
      [
        `Markdown`,
        { Model: `a\nb|c`, 'E<sub>f</sub>': 1 },
        [`| Model | Ef |`, `| :--- | ---: |`, `| a<br>b\\|c | 1 |`],
      ],
      [
        `LaTeX`,
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
      // JSON keys by column ID and keeps numbers, but string cells lose their markup
      [
        `JSON`,
        { Model: `<b>Fe</b>&amp;O`, 'E<sub>f</sub>': 1 },
        [`[`, `  {`, `    "Model": "Fe&O",`, `    "E<sub>f</sub>": 1`, `  }`, `]`],
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
        export_formats: [`csv`],
      })
      await open_export_menu()

      await click(doc_query(`[aria-label="Copy TSV to clipboard"]`))

      expect(navigator.clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
        `Model\tScore\tValue\nModel A B\t1\t2`,
      )
    })

    it(`exports only the selected rows, in the current sort order`, async () => {
      const text = await export_table_text(
        {
          data: sample_data,
          columns: sample_columns,
          show_row_select: true,
          row_key: `Model`,
          sort: [{ column: `Value`, dir: `desc` }],
        },
        async () => {
          // the first two rendered rows (C, B): data order would export them as B, C
          const checkboxes = document.querySelectorAll<HTMLInputElement>(
            `td.select-col input[type="checkbox"]`,
          )
          for (const checkbox of [...checkboxes].slice(0, 2)) await click(checkbox)
        },
      )
      const models = text.trim().split(`\n`).slice(1)
      expect(models.map((line) => line.split(`,`)[0])).toEqual([`Model C`, `Model B`])
    })
  })

  describe(`Controls Pane`, () => {
    // The wrapper fills DataTable's `controls` slot itself, so a host's `controls` snippet must
    // render inside it once, not resolve to the wrapper's own snippet and recurse
    it(`renders a host controls snippet once next to the export and settings toggles`, () => {
      const controls = createRawSnippet((args: () => { sources: { csv: () => string } }) => ({
        render: () => `<button class="host-ctrl">${args().sources.csv().length > 0}</button>`,
      }))
      mount_table({
        data: sample_data,
        columns: sample_columns,
        export_formats: [`csv`],
        controls,
      })
      const host_buttons = document.querySelectorAll(`.control-buttons .host-ctrl`)
      expect(host_buttons).toHaveLength(1)
      expect(host_buttons[0].textContent).toBe(`true`)
      expect(document.querySelector(`.control-buttons button.export-toggle`)).not.toBeNull()
    })

    it(`uses a single row for controls mode and style`, async () => {
      const state = $state<{ show_controls: ShowControlsProp<`controls`> }>({
        show_controls: { mode: `always`, style: `opacity: 0.5` },
      })
      mount_table(
        bind_props({ data: sample_data, columns: [heatmap_col], search: true }, state),
      )
      const row = doc_query(`.control-buttons`)
      expect(row.classList.contains(`always-visible`)).toBe(true)
      expect(row.style.opacity).toBe(`0.5`)
      expect(doc_query(`.control-pane-toggle`).style.opacity).toBe(``)
      state.show_controls = `hover`
      await tick()
      expect(row.classList.contains(`hover-visible`)).toBe(true)
      state.show_controls = { hidden: [`controls`] }
      await tick()
      expect(row.querySelector(`.control-pane-toggle`)).toBeNull()
      expect(row.querySelectorAll(`button`).length).toBeGreaterThan(0)
      expect(row.isConnected).toBe(true)
      for (const show_controls of [false, `never`, { mode: `never` }] as const) {
        state.show_controls = show_controls
        await tick()
        expect(document.querySelector(`.control-buttons`)).toBeNull()
        expect(document.querySelectorAll(`tbody tr`)).toHaveLength(sample_data.length)
      }
    })

    // Settings authored at mount are reset by the playwright table-controls test; this covers
    // the same overrides arriving after mount
    // a better-only pref counts as a color setting, like a picked or disabled scheme
    it.each<ColumnPrefs>([{ color_scale: null }, { better: `lower` }])(
      `resets color and display settings changed after mount (%o)`,
      async (color_pref) => {
        const props = $state({
          data: sample_data,
          columns: [heatmap_col],
          column_prefs: {} satisfies Record<string, ColumnPrefs>,
          show_controls: true,
          show_heatmap: true,
          heatmap_opacity: 1,
          show_row_numbers: false,
        })
        mount_table(bind_props({}, props))
        await click(document.querySelector<HTMLButtonElement>(`.pane-toggle`))
        props.column_prefs = { Value: { ...color_pref, width: 120 } }
        props.show_heatmap = false
        props.heatmap_opacity = 0.5
        props.show_row_numbers = true
        await tick()

        for (const section of [`heatmap`, `display`, `column colors`]) {
          const selector = `[aria-label="Reset ${section} to defaults"]`
          const reset = await vi.waitFor(() => doc_query(selector, HTMLButtonElement))
          await click(reset)
          expect(document.querySelector(selector)).toBeNull()
        }
        expect(props.show_heatmap).toBe(true)
        expect(props.heatmap_opacity).toBe(1)
        expect(document.querySelector(`.row-num-col`)).toBeNull()
        expect(props.column_prefs).toEqual({ Value: { width: 120 } })
        expect(cell_at(0, 0).style.getPropertyValue(`--cell-bg`)).not.toBe(``)
      },
    )

    // Two ways the color control used to vanish from a column that still paints: gating the
    // list on "every value parses" dropped a mixed column, and gating it on column_stats
    // (derived from the FILTERED rows) dropped it mid-typing. A keystroke also re-parsed every
    // filtered cell for the column statistics (~290 ms at 50k x 30); cells now parse once.
    it(`keeps the color control for a mixed column the search empties of numbers`, async () => {
      fake_search_timers()
      const state = $state({
        search_query: ``,
        column_prefs: {} satisfies Record<string, ColumnPrefs>,
      })
      let [model_reads, cell_reads] = [0, 0]
      const data = [
        { Model: `alpha 1`, Score: 1 },
        { Model: `alpha 2`, Score: 2 },
        { Model: `beta`, Score: `N/A` },
      ].map(
        (row) =>
          new Proxy(row, {
            get: (target, key) => {
              if (key === `Model`) model_reads++
              if (key === `Model` || key === `Score`) cell_reads++
              return Reflect.get(target, key)
            },
          }),
      )
      const columns = plain_columns(`Model`, `Score`)
      mount_table(bind_props({ data, columns, show_controls: true, search: true }, state))
      await click(document.querySelector<HTMLButtonElement>(`.pane-toggle`))
      // each column's selects are named after it (they were unlabeled)
      const color_labels = () =>
        [...document.querySelectorAll(`.col-color-row select`)].map((sel) =>
          sel.getAttribute(`aria-label`),
        )
      const score_labels = [`Score color scheme`, `Score better direction`]
      expect(color_labels()).toEqual(score_labels)
      expect(cell_at(0, 1).style.getPropertyValue(`--cell-bg`)).not.toBe(``) // it paints
      // a resize writes column_prefs: the control list must not rescan the text column
      model_reads = 0
      state.column_prefs = { Model: { width: 120 } }
      await tick()
      expect(model_reads).toBe(0)
      expect(color_labels()).toEqual(score_labels)

      cell_reads = 0
      await settle_search(state, `beta`) // filters away every numeric Score
      expect(cell_reads).toBe(0)
      expect(col_values(`Model`)).toEqual([`beta`])
      expect(color_labels()).toEqual(score_labels)
    })

    // DataTable discovers the columns of a table given none; the color controls ignored those,
    // so a data-only table painted cells it offered no control for
    it(`offers color controls on discovered columns and stores picked schemes as prefs`, async () => {
      const state = $state({ column_prefs: {} satisfies Record<string, ColumnPrefs> })
      const data = [
        { Model: `a`, Score: 1 },
        { Model: `b`, Score: 2 },
      ]
      mount_table(bind_props({ data, show_controls: true }, state))
      await click(document.querySelector<HTMLButtonElement>(`.pane-toggle`))
      const scheme = doc_query(`select[aria-label="Score color scheme"]`, HTMLSelectElement)
      const bg = () => cell_at(0, 1).style.getPropertyValue(`--cell-bg`)
      const viridis_bg = bg()
      expect(viridis_bg).not.toBe(``)
      for (const [picked, prefs] of [
        [`interpolatePlasma`, { Score: { color_scale: `interpolatePlasma` } }],
        // picking the default back clears the pref instead of storing it
        [`interpolateViridis`, { Score: {} }],
      ] as const) {
        scheme.value = picked
        scheme.dispatchEvent(new Event(`change`, { bubbles: true }))
        await tick()
        expect(state.column_prefs).toEqual(prefs)
        expect(bg() === viridis_bg).toBe(picked === `interpolateViridis`)
      }
    })
  })
})
