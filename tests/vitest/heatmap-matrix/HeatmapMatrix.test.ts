// Tests for HeatmapMatrix Svelte component rendering, interaction, and color computation.

import {
  type AxisItem,
  HeatmapMatrix,
  make_color_override_key,
} from '$lib/heatmap-matrix'
import { format_num } from '$lib/labels'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const make_items = (labels: string[]): AxisItem[] =>
  labels.map((label, idx) => ({ label, key: label, sort_value: idx }))

const x_items = make_items([`A`, `B`, `C`])
const y_items = make_items([`X`, `Y`, `Z`])

const mount_matrix = (
  props: Partial<ComponentProps<typeof HeatmapMatrix>> = {},
): void => {
  mount(HeatmapMatrix, {
    target: document.body,
    props: { x_items, y_items, ...props },
  })
}

const query_all = (sel: string) =>
  Array.from(document.querySelectorAll(sel) as NodeListOf<HTMLElement>)
const get_data_cells = () => query_all(`.cell:not(.empty)`)
const get_empty_cells = () => query_all(`.cell.empty`)
const get_x_labels = () => query_all(`.x-label`)
const get_y_labels = () => query_all(`.y-label`)

describe(`HeatmapMatrix rendering`, () => {
  test(`renders cells, labels, corner, data attributes, and CSS vars`, () => {
    mount_matrix()
    // 3x3 = 9 cells
    const cells = get_data_cells()
    expect(cells).toHaveLength(9)
    // axis labels
    const x_labels = get_x_labels()
    const y_labels = get_y_labels()
    expect(x_labels).toHaveLength(3)
    expect(y_labels).toHaveLength(3)
    expect(x_labels[0].textContent?.trim()).toBe(`A`)
    expect(y_labels[2].textContent?.trim()).toBe(`Z`)
    // corner spacer present when both axes have labels
    expect(document.querySelectorAll(`.corner`)).toHaveLength(1)
    // data attributes on first and last cell
    const first = cells[0]
    const last = cells[cells.length - 1]
    expect(first.dataset.x).toBe(`0`)
    expect(first.dataset.y).toBe(`0`)
    expect(last.dataset.x).toBe(`2`)
    expect(last.dataset.y).toBe(`2`)
    // CSS variables
    const container = doc_query(`.grid`)
    expect(container.style.getPropertyValue(`--n-cols`)).toBe(`3`)
    expect(container.style.getPropertyValue(`--n-rows`)).toBe(`3`)
  })

  test.each([
    { show_x_labels: false, show_y_labels: true, x_count: 0, y_count: 3 },
    { show_x_labels: true, show_y_labels: false, x_count: 3, y_count: 0 },
  ])(
    `show_x=$show_x_labels show_y=$show_y_labels`,
    ({ show_x_labels, show_y_labels, x_count, y_count }) => {
      mount_matrix({ show_x_labels, show_y_labels })
      expect(get_x_labels()).toHaveLength(x_count)
      expect(get_y_labels()).toHaveLength(y_count)
      // corner spacer only when both axes shown
      expect(document.querySelectorAll(`.corner`)).toHaveLength(0)
    },
  )

  test(`applies custom class and gap via props`, () => {
    mount_matrix({ class: `my-matrix`, gap: `2px` })
    const container = doc_query(`.grid`)
    expect(container.classList.contains(`my-matrix`)).toBe(true)
    expect(container.style.gap).toBe(`2px`)
  })
})

describe(`symmetric mode`, () => {
  test.each([
    {
      mode: true,
      label: `true (alias for lower)`,
      check: `toBeLessThanOrEqual` as const,
    },
    { mode: `lower` as const, label: `lower`, check: `toBeLessThanOrEqual` as const },
    { mode: `upper` as const, label: `upper`, check: `toBeGreaterThanOrEqual` as const },
  ])(`$label renders triangle + diagonal`, ({ mode, check }) => {
    mount_matrix({ symmetric: mode })
    const data_cells = get_data_cells()
    const empty_cells = get_empty_cells()
    // 3x3 symmetric: diagonal(3) + triangle(3) = 6 data, 3 empty
    expect(data_cells).toHaveLength(6)
    expect(empty_cells).toHaveLength(3)
    for (const cell of data_cells) {
      expect(Number(cell.dataset.x), `(${cell.dataset.x},${cell.dataset.y})`)
        [check](Number(cell.dataset.y))
    }
    for (const cell of empty_cells) {
      expect(cell.dataset.x).toBeUndefined()
    }
  })
})

describe(`values and colors`, () => {
  test(`numeric values produce distinct colors from scale`, () => {
    mount_matrix({ values: [[0, 0.5, 1], [0.25, 0.75, 0], [1, 0, 0.5]] })
    const cells = get_data_cells()
    // All cells should have a background color
    for (const cell of cells) {
      expect(cell.style.backgroundColor).toBeTruthy()
    }
    // Same values (0) should produce same color, different values should differ
    expect(cells[0].style.backgroundColor).toBe(cells[5].style.backgroundColor) // both value 0
    expect(cells[0].style.backgroundColor).not.toBe(cells[1].style.backgroundColor) // 0 vs 0.5
    expect(cells[2].style.backgroundColor).toBe(cells[6].style.backgroundColor) // both value 1
  })

  test(`null values get missing_color, non-null values don't`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`, `C`]),
      y_items: make_items([`X`]),
      values: [[null, 1, null]],
      missing_color: `red`,
    })
    const cells = get_data_cells()
    expect(cells[0].style.backgroundColor).toBe(`red`)
    expect(cells[1].style.backgroundColor).not.toBe(`red`)
    expect(cells[2].style.backgroundColor).toBe(`red`)
  })

  test(`record-based values resolve by key with null handling`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`]),
      y_items: make_items([`X`, `Y`]),
      values: { X: { A: 0, B: 1 }, Y: { A: 0.5, B: null } },
      missing_color: `red`,
    })
    const cells = get_data_cells()
    expect(cells).toHaveLength(4)
    // X.A=0 and X.B=1 should have different colors (different values)
    expect(cells[0].style.backgroundColor).not.toBe(cells[1].style.backgroundColor)
    // Y.B=null should get the missing_color
    expect(cells[3].style.backgroundColor).toBe(`red`)
    // Y.A=0.5 should NOT be missing_color
    expect(cells[2].style.backgroundColor).not.toBe(`red`)
  })

  test(`custom color_scale function is applied`, () => {
    mount_matrix({
      x_items: make_items([`A`]),
      y_items: make_items([`X`]),
      values: [[0.5]],
      color_scale: () => `rgb(255, 0, 0)`,
    })
    expect((doc_query(`.cell:not(.empty)`) as HTMLElement).style.backgroundColor).toBe(
      `rgb(255, 0, 0)`,
    )
  })

  test(`color_overrides takes precedence over computed color`, () => {
    mount(HeatmapMatrix, {
      target: document.body,
      props: {
        x_items: make_items([`A`, `B`]),
        y_items: make_items([`X`]),
        values: [[0.2, 0.8]],
        color_overrides: {
          [make_color_override_key(`B`, `X`)]: `rgb(1, 2, 3)`,
        },
      },
    })
    const cells = document.querySelectorAll(`.cell:not(.empty)`) as NodeListOf<
      HTMLElement
    >
    expect(cells[1].style.backgroundColor).toBe(`rgb(1, 2, 3)`)
    expect(cells[0].style.backgroundColor).not.toBe(`rgb(1, 2, 3)`)
  })

  test(`log mode safely handles non-positive color range minimum`, () => {
    mount(HeatmapMatrix, {
      target: document.body,
      props: {
        x_items: make_items([`A`]),
        y_items: make_items([`X`]),
        values: [[1]],
        log: true,
        color_scale_range: [-10, 10],
      },
    })
    const cell = doc_query(`.cell:not(.empty)`) as HTMLElement
    expect(cell.style.backgroundColor).toBeTruthy()
    expect(cell.style.backgroundColor).not.toBe(`transparent`)
  })

  test(`empty values array gives transparent cells`, () => {
    mount_matrix({ values: [] })
    for (const cell of get_data_cells()) {
      expect(cell.style.backgroundColor).toBe(`transparent`)
    }
  })
})

describe(`click and dblclick handlers`, () => {
  test(`onclick receives correct CellContext`, () => {
    const handler = vi.fn()
    mount_matrix({ values: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], onclick: handler })
    // Click cell at x=1, y=2 (value=8)
    const cell = get_data_cells()[7]
    expect(cell.dataset.x).toBe(`1`)
    expect(cell.dataset.y).toBe(`2`)
    cell.click()
    expect(handler).toHaveBeenCalledOnce()
    const ctx = handler.mock.calls[0][0]
    expect(ctx).toMatchObject({ x_idx: 1, y_idx: 2, value: 8 })
    expect(ctx.x_item.label).toBe(`B`)
    expect(ctx.y_item.label).toBe(`Z`)
  })

  test(`ondblclick receives correct CellContext`, () => {
    const handler = vi.fn()
    mount_matrix({ values: [[10, 20, 30]], ondblclick: handler })
    const cell = doc_query(`.cell:not(.empty)`) as HTMLElement
    cell.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toMatchObject({ x_idx: 0, y_idx: 0, value: 10 })
  })

  test(`dblclick suppresses pending single-click callback`, () => {
    vi.useFakeTimers()
    try {
      const click_handler = vi.fn()
      const dblclick_handler = vi.fn()
      mount_matrix({
        values: [[10, 20, 30]],
        onclick: click_handler,
        ondblclick: dblclick_handler,
      })
      const cell = doc_query(`.cell:not(.empty)`) as HTMLElement
      cell.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      cell.dispatchEvent(new MouseEvent(`dblclick`, { bubbles: true }))
      vi.runAllTimers()
      expect(click_handler).not.toHaveBeenCalled()
      expect(dblclick_handler).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([`Enter`, ` `])(
    `keyboard %s plus native click synthesis triggers once`,
    (key_name) => {
      const click_handler = vi.fn()
      mount_matrix({ values: [[1]], onclick: click_handler })
      const cell = doc_query(`.cell:not(.empty)`) as HTMLElement
      expect(cell.tagName).toBe(`BUTTON`)
      // Approximate native button activation: keydown then synthesized click.
      cell.dispatchEvent(new KeyboardEvent(`keydown`, { key: key_name, bubbles: true }))
      cell.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      expect(click_handler).toHaveBeenCalledOnce()
    },
  )

  test(`disabled prevents clicks, non-cell clicks are no-ops`, () => {
    const handler = vi.fn()
    mount_matrix({ onclick: handler, disabled: true })
    ;(doc_query(`.cell:not(.empty)`) as HTMLElement).click()
    expect(handler).not.toHaveBeenCalled()
    // Re-mount without disabled, clicking a label shouldn't fire handler
    document.body.innerHTML = ``
    mount_matrix({ onclick: handler })
    ;(doc_query(`.x-label`) as HTMLElement).click()
    expect(handler).not.toHaveBeenCalled()

    // Hovering a cell should not make subsequent label clicks trigger onclick
    const first_cell = doc_query(`.cell:not(.empty)`) as HTMLElement
    first_cell.dispatchEvent(new MouseEvent(`mouseover`, { bubbles: true }))
    ;(doc_query(`.x-label`) as HTMLElement).click()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe(`edge cases`, () => {
  test.each([
    { desc: `1x1`, x: [`A`], y: [`X`], symmetric: false, data: 1, empty: 0 },
    {
      desc: `4x2 asymmetric`,
      x: [`A`, `B`, `C`, `D`],
      y: [`X`, `Y`],
      symmetric: false,
      data: 8,
      empty: 0,
    },
    { desc: `1x1 symmetric`, x: [`A`], y: [`A`], symmetric: true, data: 1, empty: 0 },
  ])(
    `$desc renders $data data cells and $empty empty cells`,
    ({ x, y, symmetric, data, empty }) => {
      mount(HeatmapMatrix, {
        target: document.body,
        props: { x_items: make_items(x), y_items: make_items(y), symmetric },
      })
      expect(get_data_cells()).toHaveLength(data)
      expect(get_empty_cells()).toHaveLength(empty)
    },
  )
})

describe(`hide_empty`, () => {
  test(`compact removes all-null columns and rows`, () => {
    // 3x3 grid where column B and row Y are all null
    mount_matrix({
      x_items: make_items([`A`, `B`, `C`]),
      y_items: make_items([`X`, `Y`, `Z`]),
      values: [[1, null, 2], [null, null, null], [3, null, 4]],
      hide_empty: `compact`,
    })
    // Column B (all null) and row Y (all null) should be removed
    const x_labels = get_x_labels()
    const y_labels = get_y_labels()
    expect(x_labels).toHaveLength(2)
    expect(y_labels).toHaveLength(2)
    expect(x_labels[0].textContent?.trim()).toBe(`A`)
    expect(x_labels[1].textContent?.trim()).toBe(`C`)
    expect(y_labels[0].textContent?.trim()).toBe(`X`)
    expect(y_labels[1].textContent?.trim()).toBe(`Z`)
    // 2x2 = 4 cells rendered
    expect(get_data_cells()).toHaveLength(4)
  })

  test(`gaps keeps grid dimensions but hides empty rows/cols`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`, `C`]),
      y_items: make_items([`X`, `Y`, `Z`]),
      values: [[1, null, 2], [null, null, null], [3, null, 4]],
      hide_empty: `gaps`,
    })
    // Same 2 visible labels per axis, but grid template uses full 3 cols/rows
    expect(get_x_labels()).toHaveLength(2)
    expect(get_y_labels()).toHaveLength(2)
    const container = doc_query(`.grid`)
    expect(container.style.getPropertyValue(`--n-cols`)).toBe(`3`)
    expect(container.style.getPropertyValue(`--n-rows`)).toBe(`3`)
    // Cells use original indices for grid placement (A=col 2, C=col 4, X=row 2, Z=row 4)
    const cells = get_data_cells()
    expect(cells[0].style.gridColumn).toBe(`2`) // A (idx 0 + 2)
    expect(cells[0].style.gridRow).toBe(`2`) // X (idx 0 + 2)
    expect(cells[3].style.gridColumn).toBe(`4`) // C (idx 2 + 2)
    expect(cells[3].style.gridRow).toBe(`4`) // Z (idx 2 + 2)
  })

  test(`false shows all rows/cols including all-null ones`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`, `C`]),
      y_items: make_items([`X`, `Y`, `Z`]),
      values: [[1, null, 2], [null, null, null], [3, null, 4]],
      hide_empty: false,
    })
    expect(get_x_labels()).toHaveLength(3)
    expect(get_y_labels()).toHaveLength(3)
    expect(get_data_cells()).toHaveLength(9)
  })
})

describe(`axis label placement`, () => {
  test(`stagger_axis_labels=true splits x(top/bottom) and y(left/right) sides`, () => {
    const four_x_items = make_items([`A`, `B`, `C`, `D`])
    const four_y_items = make_items([`W`, `X`, `Y`, `Z`])
    mount_matrix({
      x_items: four_x_items,
      y_items: four_y_items,
      stagger_axis_labels: true,
    })
    const x_labels = get_x_labels()
    const y_labels = get_y_labels()
    expect(x_labels[0].style.gridRow).toBe(`1`)
    expect(x_labels[1].style.gridRow).toBe(`6`) // n_rows(4) + top row + bottom row
    expect(y_labels[0].style.gridColumn).toBe(`1`)
    expect(y_labels[1].style.gridColumn).toBe(`6`) // n_cols(4) + left col + right col
  })

  test(`symmetric diagonal mode moves only x labels toward diagonal`, () => {
    mount_matrix({
      symmetric: true,
      symmetric_label_position: `diagonal`,
    })
    const x_labels = get_x_labels()
    const y_labels = get_y_labels()
    expect(x_labels[0].style.gridRow).toBe(`1`)
    expect(x_labels[1].style.gridRow).toBe(`2`)
    expect(x_labels[2].style.gridRow).toBe(`3`)
    for (const y_label of Array.from(y_labels)) {
      expect(y_label.style.gridColumn).toBe(`1`)
    }
  })

  test(`symmetric edge mode keeps x labels on top edge`, () => {
    mount_matrix({
      symmetric: true,
      symmetric_label_position: `edge`,
    })
    const x_labels = get_x_labels()
    for (const x_label of Array.from(x_labels)) {
      expect(x_label.style.gridRow).toBe(`1`)
    }
  })

  test(`staggered labels avoid summary row and summary column tracks`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`, `C`, `D`]),
      y_items: make_items([`W`, `X`, `Y`, `Z`]),
      values: [
        [1, 2, 3, 4],
        [5, 6, 7, 8],
        [9, 10, 11, 12],
        [13, 14, 15, 16],
      ],
      stagger_axis_labels: true,
      show_row_summaries: true,
      show_col_summaries: true,
    })
    const x_labels = get_x_labels()
    const y_labels = get_y_labels()
    // With summaries enabled, odd labels move one extra track outward.
    expect(x_labels[1].style.gridRow).toBe(`7`)
    expect(y_labels[1].style.gridColumn).toBe(`7`)
    // Summary tracks still occupy the immediate next track.
    expect((doc_query(`.summary-col`) as HTMLElement).style.gridRow).toBe(`6`)
    expect((doc_query(`.summary-row`) as HTMLElement).style.gridColumn).toBe(`6`)
  })
})

describe(`milestone feature props`, () => {
  test(`search_query filters visible labels`, () => {
    mount_matrix({
      x_items: make_items([`Al`, `Fe`, `Ni`]),
      y_items: make_items([`Al`, `Fe`, `Ni`]),
      search_query: `fe`,
    })
    expect(get_x_labels()).toHaveLength(1)
    expect(get_y_labels()).toHaveLength(1)
    expect(get_x_labels()[0].textContent?.trim()).toBe(`Fe`)
  })

  test(`x_order and y_order reorder labels`, () => {
    mount_matrix({
      x_items: [
        { label: `B`, sort_value: 2 },
        { label: `A`, sort_value: 1 },
      ],
      y_items: [
        { label: `Y`, sort_value: 2 },
        { label: `X`, sort_value: 1 },
      ],
      x_order: `sort_value`,
      y_order: `label`,
    })
    expect(get_x_labels()[0].textContent?.trim()).toBe(`A`)
    expect(get_y_labels()[0].textContent?.trim()).toBe(`X`)
  })

  test(`show_legend renders legend with label`, () => {
    mount_matrix({ show_legend: true, legend_label: `Custom` })
    expect(document.querySelector(`.legend`)).not.toBeNull()
    expect(document.querySelector(`.legend .label`)?.textContent).toContain(`Custom`)
  })

  test(`legend_format passes through to format_num`, () => {
    mount_matrix({
      x_items: make_items([`A`]),
      y_items: make_items([`X`]),
      values: [[1.234]],
      show_legend: true,
      legend_ticks: 2,
      legend_format: `.1f`,
      color_scale_range: [1.234, 1.234],
    })
    const tick_text = Array.from(document.querySelectorAll(`.legend .tick-label`))
      .map((item) => item.textContent?.trim())
      .filter(Boolean)
    expect(tick_text[0]).toBe(format_num(1.234, `.1f`))
  })

  test(`selection_mode multi updates selected class on click`, async () => {
    const select_handler = vi.fn()
    mount_matrix({
      selection_mode: `multi`,
      values: [[1, 2, 3]],
      onselect: select_handler,
    })
    const cells = get_data_cells()
    cells[0].dispatchEvent(new MouseEvent(`click`, { bubbles: true, ctrlKey: true }))
    await tick()
    expect(cells[0].classList.contains(`selected`)).toBe(true)
    cells[1].dispatchEvent(new MouseEvent(`click`, { bubbles: true, ctrlKey: true }))
    await tick()
    expect(cells[1].classList.contains(`selected`)).toBe(true)
    // Both cells selected, handler receives exact array
    const last_selection = select_handler.mock.calls.at(-1)?.[0] as
      | { x_idx: number; y_idx: number }[]
      | undefined
    expect(last_selection).toHaveLength(2)
    expect(last_selection).toEqual([
      { x_idx: 0, y_idx: 0 },
      { x_idx: 1, y_idx: 0 },
    ])
  })

  test(`selected outline color token contrasts with dark cell backgrounds`, () => {
    mount_matrix({
      x_items: make_items([`A`]),
      y_items: make_items([`X`]),
      selection_mode: `single`,
      values: [[`#000000`]],
    })
    const first_cell = get_data_cells()[0]
    expect(first_cell.style.getPropertyValue(`--heatmap-selected-outline-color`)).toBe(
      `white`,
    )
  })

  test(`oncontextmenu is triggered for cell`, () => {
    const handler = vi.fn()
    mount_matrix({ oncontextmenu: handler, values: [[1]] })
    const first_cell = get_data_cells()[0]
    first_cell.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true }))
    expect(handler).toHaveBeenCalledOnce()
  })

  test(`tooltip_mode=both hides hover tooltip when no pinned cell`, async () => {
    mount_matrix({
      tooltip: true,
      tooltip_mode: `both`,
      values: [[1]],
    })
    await Promise.resolve()
    const first_cell = get_data_cells()[0]
    const tooltip_el = doc_query(`.tooltip`) as HTMLElement
    first_cell.dispatchEvent(
      new MouseEvent(`mouseover`, { bubbles: true, clientX: 10, clientY: 10 }),
    )
    await Promise.resolve()
    first_cell.dispatchEvent(new MouseEvent(`mouseout`, { bubbles: true }))
    await Promise.resolve()
    expect(tooltip_el.classList.contains(`visible`)).toBe(false)
  })

  test(`symmetric summaries ignore hidden upper triangle`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`]),
      y_items: make_items([`A`, `B`]),
      values: [[1, 2], [3, 4]],
      symmetric: true,
      show_row_summaries: true,
    })
    const summary_cells = document.querySelectorAll(`.summary-row`) as NodeListOf<
      HTMLElement
    >
    expect(summary_cells[0].textContent?.trim()).toBe(`1`)
    expect(summary_cells[1].textContent?.trim()).toBe(`3.5`)
  })
})

describe(`show_values`, () => {
  test(`true renders formatted numbers inside cells`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`]),
      y_items: make_items([`X`]),
      values: [[1.2345, 0.001]],
      show_values: true,
    })
    const spans = document.querySelectorAll(`.cell-value`)
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe(format_num(1.2345, `.3~g`))
    expect(spans[1].textContent).toBe(format_num(0.001, `.3~g`))
  })

  test(`custom format string is used`, () => {
    mount_matrix({
      x_items: make_items([`A`]),
      y_items: make_items([`X`]),
      values: [[3.14159]],
      show_values: `.1f`,
    })
    expect(doc_query(`.cell-value`).textContent).toBe(format_num(3.14159, `.1f`))
  })

  test(`ignored when custom cell snippet is provided`, () => {
    mount_matrix({
      x_items: make_items([`A`]),
      y_items: make_items([`X`]),
      values: [[42]],
      show_values: true,
      cell: (() => {}) as unknown as ComponentProps<typeof HeatmapMatrix>[`cell`],
    })
    expect(document.querySelectorAll(`.cell-value`)).toHaveLength(0)
  })

  test(`null values produce no span`, () => {
    mount_matrix({
      x_items: make_items([`A`, `B`]),
      y_items: make_items([`X`]),
      values: [[null, 1]],
      show_values: true,
    })
    expect(document.querySelectorAll(`.cell-value`)).toHaveLength(1)
  })
})

describe(`axis titles`, () => {
  test(`x_axis.label renders below grid`, () => {
    mount_matrix({ x_axis: { label: `Columns` } })
    const title = doc_query(`.x-title`)
    expect(title.textContent).toBe(`Columns`)
  })

  test(`y_axis.label renders with padding`, () => {
    mount_matrix({ y_axis: { label: `Rows` } })
    const title = doc_query(`.y-title`)
    expect(title.textContent).toBe(`Rows`)
    const shell = doc_query(`.heatmap`)
    expect(shell.style.paddingLeft).toBe(`1.8em`)
  })
})
