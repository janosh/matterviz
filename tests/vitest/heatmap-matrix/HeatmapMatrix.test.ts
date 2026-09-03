// Tests for HeatmapMatrix Svelte component rendering, interaction, and color computation.

import { HeatmapMatrix, make_color_override_key } from '$lib/heatmap-matrix'
import type { AxisItem, ColorBarPosition } from '$lib/heatmap-matrix'
import { format_num } from '$lib/labels'
import type { ComponentProps } from 'svelte'
import { flushSync, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, keydown, mouse, trigger_resize_observer } from '../setup'
import HeatmapMatrixReplacementHarness from './HeatmapMatrixReplacementHarness.svelte'

const make_items = (labels: readonly string[]): AxisItem[] =>
  labels.map((label, idx) => ({ label, key: label, sort_value: idx }))

const x_items = make_items([`A`, `B`, `C`])
const y_items = make_items([`X`, `Y`, `Z`])

// `x`/`y` are a shorthand to build x_items/y_items from label arrays; pass x_items/y_items
// directly for custom AxisItem objects (e.g. explicit sort_value)
const mount_matrix = (
  props: { x?: readonly string[]; y?: readonly string[] } & Partial<
    ComponentProps<typeof HeatmapMatrix>
  > = {},
): void => {
  const { x, y, ...rest } = props
  mount(HeatmapMatrix, {
    target: document.body,
    props: {
      x_items: x ? make_items(x) : x_items,
      y_items: y ? make_items(y) : y_items,
      ...rest,
    },
  })
}

const query_all = (sel: string): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(sel))
const get_data_cells = () => query_all(`.cell:not(.empty)`)
const get_empty_cells = () => query_all(`.cell.empty`)
const get_x_labels = () => query_all(`.x-label`)
const get_y_labels = () => query_all(`.y-label`)
// color_scale whose red channel reads back the normalized position on the ramp
const red_scale = (val: number) => `rgb(${Math.round(val * 255)}, 0, 0)`
const red_of = (cell: HTMLElement) => Number(/\d+/.exec(cell.style.backgroundColor)?.[0])

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

describe(`axis replacement`, () => {
  test(`clears index-based interaction state when axis keys change`, async () => {
    mount(HeatmapMatrixReplacementHarness, { target: document.body })
    await tick()

    expect(doc_query(`[data-testid="selected-count"]`).textContent).toBe(`1`)

    doc_query<HTMLButtonElement>(`[data-testid="replace-axis"]`).click()
    flushSync()
    await tick()

    expect(doc_query(`[data-testid="selected-count"]`).textContent).toBe(`0`)
    expect(doc_query(`[data-testid="active-cell"]`).textContent).toBe(`none`)
    expect(doc_query(`[data-testid="pinned-cell"]`).textContent).toBe(`none`)
  })
})

describe(`symmetric mode`, () => {
  test.each([
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
      const x_idx = Number(cell.dataset.x)
      const y_idx = Number(cell.dataset.y)
      const message = `(${cell.dataset.x},${cell.dataset.y})`
      if (check === `toBeLessThanOrEqual`) expect(x_idx, message).toBeLessThanOrEqual(y_idx)
      else expect(x_idx, message).toBeGreaterThanOrEqual(y_idx)
    }
    for (const cell of empty_cells) {
      expect(cell.dataset.x).toBeUndefined()
    }
  })
})

describe(`values and colors`, () => {
  test(`numeric values map linearly onto the auto [min, max] domain, row by row`, () => {
    mount_matrix({
      values: [
        [0, 0.5, 1],
        [0.25, 0.75, 0],
        [1, 0, 0.5],
      ],
      color_scale: red_scale,
    })
    // cells are laid out y-row by y-row, so the ramp position is each value's own share of
    // the 0..1 data range (0.25 -> 64, 0.75 -> 191 after rounding)
    expect(get_data_cells().map(red_of)).toEqual([0, 128, 255, 64, 191, 0, 255, 0, 128])
  })

  test(`null values get the missing color, non-null values don't`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`],
      y: [`X`],
      values: [[null, 1, null]],
      missing: { color: `red` },
    })
    const cells = get_data_cells()
    expect(cells[0].style.backgroundColor).toBe(`red`)
    expect(cells[1].style.backgroundColor).not.toBe(`red`)
    expect(cells[2].style.backgroundColor).toBe(`red`)
  })

  test(`missing.label and missing.style decorate only missing cells`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
      values: [[null, 1]],
      missing: { label: `N/A`, style: `opacity: 0.4` },
    })
    const cells = get_data_cells()
    // A=null is missing -> label + dimmed
    expect(cells[0].textContent?.trim()).toBe(`N/A`)
    expect(cells[0].style.opacity).toBe(`0.4`)
    expect(cells[0].style.color).toBe(``)
    // B=1 is present -> no label, not dimmed
    expect(cells[1].textContent).not.toContain(`N/A`)
    expect(cells[1].style.opacity).toBe(``)
  })

  test(`record-based values resolve by key with null handling`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`, `Y`],
      values: { X: { A: 0, B: 1 }, Y: { A: 0.5, B: null } },
      missing: { color: `red` },
      color_scale: red_scale,
    })
    const cells = get_data_cells()
    expect(cells).toHaveLength(4)
    // X.A=0, X.B=1, Y.A=0.5 land at the bottom, top and middle of the ramp; the null Y.B
    // cell takes the missing color and does not shrink the [0, 1] domain
    expect(cells.slice(0, 3).map(red_of)).toEqual([0, 255, 128])
    expect(cells[3].style.backgroundColor).toBe(`red`)
  })

  test(`custom color_scale function is applied`, () => {
    mount_matrix({
      x: [`A`],
      y: [`X`],
      values: [[0.5]],
      color_scale: () => `rgb(255, 0, 0)`,
    })
    expect(doc_query(`.cell:not(.empty)`).style.backgroundColor).toBe(`rgb(255, 0, 0)`)
  })

  test(`color_overrides takes precedence over computed color`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
      values: [[0.2, 0.8]],
      color_overrides: { [make_color_override_key(`B`, `X`)]: `rgb(1, 2, 3)` },
    })
    const cells = get_data_cells()
    expect(cells[1].style.backgroundColor).toBe(`rgb(1, 2, 3)`)
    expect(cells[0].style.backgroundColor).not.toBe(`rgb(1, 2, 3)`)
  })

  test(`log mode anchors at smallest positive value when data has non-positives`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`, `D`],
      y: [`X`],
      values: [[-1, 0.01, 1, 100]],
      log: true,
      missing: { color: `red` },
      color_scale: (val: number) => `rgb(${Math.round(val * 255)}, 0, 0)`,
    })
    const cells = get_data_cells()
    const red = (idx: number) => Number(/\d+/.exec(cells[idx].style.backgroundColor)?.[0])
    expect(cells[0].style.backgroundColor).toBe(`red`) // non-positive -> missing color
    // a Number.MIN_VALUE lower bound squashes all positives into [0.985, 1]; instead
    // 0.01 must map to the bottom, 100 to the top, 1 to the log midpoint
    expect(red(1)).toBe(0)
    expect(Math.abs(red(2) - 127.5)).toBeLessThanOrEqual(1)
    expect(red(3)).toBe(255)
  })

  // the legend reads the same lifted floor as the cells: a zero in the data must not floor
  // the bar at LOG_EPS while cells start at the smallest positive value
  test(`log legend spans the lifted cell floor, not LOG_EPS`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`],
      y: [`X`],
      values: [[0, 0.01, 100]],
      log: true,
      show_color_bar: true,
      color_bar_format: `~g`,
    })
    const ticks = [...document.querySelectorAll(`.colorbar .tick-label`)].map((span) =>
      Number(span.textContent),
    )
    expect([Math.min(...ticks), Math.max(...ticks)]).toEqual([0.01, 100])
  })

  // the shared ramp must not floor positive log bounds at LOG_EPS (1e-9): 1e-12 is the
  // bottom, 1e-9 the log midpoint, not the bottom color twice
  test(`log mode keeps positive values below 1e-9 spread over the ramp`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`],
      y: [`X`],
      values: [[1e-12, 1e-9, 1e-6]],
      log: true,
      color_scale: red_scale,
    })
    expect(get_data_cells().map(red_of)).toEqual([0, 128, 255])
  })

  // 51 values 0..50: the 2nd/98th percentiles (interpolated, quantile_unordered) are 1 and 49,
  // so under `robust` 1 maps to the bottom of the ramp, 49 to the top, 0 and 50 saturate.
  test(`robust domain clips to the 2nd-98th percentile`, () => {
    const values = [Array.from({ length: 51 }, (_val, idx) => idx)]
    mount_matrix({
      x: values[0].map((val) => `c${val}`),
      y: [`X`],
      values,
      domain_mode: `robust`,
      color_scale: red_scale,
    })
    const reds = get_data_cells().map(red_of)
    expect(reds.slice(0, 3)).toEqual([0, 0, Math.round(255 / 48)])
    expect(reds.slice(-2)).toEqual([255, 255])
    expect(reds[25]).toBe(Math.round((24 / 48) * 255))
  })

  // A descending color_scale_range flips the legend's direction but must not flip which
  // value gets which color: cells and the ColorBar read the same ramp.
  test(`descending color_scale_range keeps value-to-color mapping consistent with the legend`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
      values: [[0, 10]],
      color_scale_range: [10, 0],
      domain_mode: `fixed`,
      show_color_bar: true,
      color_scale: red_scale,
    })
    const cells = get_data_cells()
    expect(cells[0].style.backgroundColor).toBe(`rgb(0, 0, 0)`)
    expect(cells[1].style.backgroundColor).toBe(`rgb(255, 0, 0)`)
    const gradient = doc_query(`.colorbar .bar`).getAttribute(`style`) ?? ``
    const stops = gradient.match(/rgb\(\d+, 0, 0\)/g) ?? []
    expect(stops[0]).toBe(`rgb(255, 0, 0)`) // value 10 sits at the left end
    expect(stops.at(-1)).toBe(`rgb(0, 0, 0)`)
  })

  // a non-positive log floor is lifted to the smallest positive value so the data still spans
  // the ramp; a degenerate domain paints every mappable cell the midpoint color (also when
  // the lifted log floor lands on the max); a log domain entirely <= 0 maps nothing
  test.each<[string, Partial<ComponentProps<typeof HeatmapMatrix>>, number[], number[]]>([
    [
      `log floor lifted to the min positive value`,
      { log: true, color_scale_range: [-10, 10] },
      [1, 10],
      [0, 255],
    ],
    [`zero-width range`, { color_scale_range: [2, 2] }, [1, 2, 3], [128, 128, 128]],
    [
      `log floor lifted onto the max`,
      { log: true, color_scale_range: [-1, 5] },
      [5, 0],
      [128, 0],
    ],
    [`log range entirely <= 0`, { log: true, color_scale_range: [-5, 0] }, [1], [0]],
  ])(`%s`, (_name, props, row, expected_reds) => {
    mount_matrix({
      x: row.map((val) => `c${val}`),
      y: [`X`],
      values: [row],
      missing: { color: `rgb(0, 0, 0)` },
      color_scale: red_scale,
      ...props,
    })
    expect(get_data_cells().map(red_of)).toEqual(expected_reds)
  })

  test(`empty values array gives transparent cells`, () => {
    mount_matrix({ values: [] })
    for (const cell of get_data_cells()) {
      expect(cell.style.backgroundColor).toBe(`transparent`)
    }
  })
})

describe(`click and dblclick handlers`, () => {
  test(`on_click receives correct CellContext`, () => {
    const handler = vi.fn()
    mount_matrix({
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      on_click: handler,
    })
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

  test(`on_double_click receives correct CellContext`, () => {
    const handler = vi.fn()
    mount_matrix({ values: [[10, 20, 30]], on_double_click: handler })
    const cell = doc_query(`.cell:not(.empty)`)
    cell.dispatchEvent(mouse(`dblclick`))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toMatchObject({ x_idx: 0, y_idx: 0, value: 10 })
  })

  test(`disambiguates click vs dblclick when both handlers are set`, () => {
    vi.useFakeTimers()
    try {
      const on_click = vi.fn()
      const on_dblclick = vi.fn()
      mount_matrix({ values: [[10, 20, 30]], on_click, on_double_click: on_dblclick })
      const cells = get_data_cells()
      const fire = (el: HTMLElement, type: `click` | `dblclick`) => {
        el.dispatchEvent(mouse(type))
      }

      // Matching click + dblclick → dblclick only
      fire(cells[0], `click`)
      fire(cells[0], `dblclick`)
      vi.runAllTimers()
      expect(on_click).not.toHaveBeenCalled()
      expect(on_dblclick).toHaveBeenCalledOnce()

      // Orphaned dblclick → schedule single-click
      on_click.mockClear()
      on_dblclick.mockClear()
      fire(cells[0], `dblclick`)
      expect(on_dblclick).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(on_click).toHaveBeenCalledOnce()
      expect(on_click.mock.calls[0][0]).toMatchObject({ x_idx: 0, y_idx: 0, value: 10 })

      // Click A then dblclick B → single-click B
      on_click.mockClear()
      on_dblclick.mockClear()
      fire(cells[0], `click`)
      fire(cells[1], `dblclick`)
      expect(on_dblclick).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(on_click).toHaveBeenCalledOnce()
      expect(on_click.mock.calls[0][0]).toMatchObject({ x_idx: 1, y_idx: 0, value: 20 })
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([`Enter`, ` `])(
    `keyboard %s plus native click synthesis triggers once`,
    (key_name) => {
      const click_handler = vi.fn()
      mount_matrix({ values: [[1]], on_click: click_handler })
      const cell = doc_query(`.cell:not(.empty)`)
      expect(cell.tagName).toBe(`BUTTON`)
      // Approximate native button activation: keydown then synthesized click.
      cell.dispatchEvent(keydown(key_name))
      cell.dispatchEvent(mouse(`click`))
      expect(click_handler).toHaveBeenCalledOnce()
    },
  )

  test(`arrow keys follow sorted display order`, async () => {
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
      y_order: `sort_value`,
      on_click: () => {},
    })
    await tick()
    const start = doc_query(`.cell[data-x="1"][data-y="1"]`)
    start.focus()
    const arrow_right = keydown(`ArrowRight`, { cancelable: true })
    start.dispatchEvent(arrow_right)
    expect(arrow_right.defaultPrevented).toBe(true)
    await tick()
    expect(document.activeElement).toBe(doc_query(`.cell[data-x="0"][data-y="1"]`))
    document.activeElement?.dispatchEvent(keydown(`ArrowDown`))
    await tick()
    expect(document.activeElement).toBe(doc_query(`.cell[data-x="0"][data-y="0"]`))
  })

  test(`disabled prevents clicks, non-cell clicks are no-ops`, () => {
    const handler = vi.fn()
    mount_matrix({ on_click: handler, disabled: true })
    doc_query(`.cell:not(.empty)`).click()
    expect(handler).not.toHaveBeenCalled()
    // Re-mount without disabled, clicking a label shouldn't fire handler
    document.body.innerHTML = ``
    mount_matrix({ on_click: handler })
    doc_query(`.x-label`).click()
    expect(handler).not.toHaveBeenCalled()

    // Hovering a cell should not make subsequent label clicks trigger on_click
    const first_cell = doc_query(`.cell:not(.empty)`)
    first_cell.dispatchEvent(mouse(`mouseover`))
    doc_query(`.x-label`).click()
    expect(handler).not.toHaveBeenCalled()
  })
})

describe(`edge cases`, () => {
  test.each([
    {
      desc: `4x2 asymmetric`,
      x: [`A`, `B`, `C`, `D`],
      y: [`X`, `Y`],
      symmetric: false,
      data: 8,
      empty: 0,
    },
    {
      desc: `1x1 symmetric`,
      x: [`A`],
      y: [`A`],
      symmetric: `lower`,
      data: 1,
      empty: 0,
    },
  ] as const)(
    `$desc renders $data data cells and $empty empty cells`,
    ({ x, y, symmetric, data, empty }) => {
      mount_matrix({ x, y, symmetric })
      expect(get_data_cells()).toHaveLength(data)
      expect(get_empty_cells()).toHaveLength(empty)
    },
  )
})

describe(`hide_empty`, () => {
  // 3x3 grid where column B and row Y are entirely null
  const sparse = {
    x: [`A`, `B`, `C`],
    y: [`X`, `Y`, `Z`],
    values: [
      [1, null, 2],
      [null, null, null],
      [3, null, 4],
    ],
  }

  test(`compact removes all-null columns and rows`, () => {
    mount_matrix({ ...sparse, hide_empty: `compact` })
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
    mount_matrix({ ...sparse, hide_empty: `gaps` })
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
    mount_matrix({ ...sparse, hide_empty: false })
    expect(get_x_labels()).toHaveLength(3)
    expect(get_y_labels()).toHaveLength(3)
    expect(get_data_cells()).toHaveLength(9)
  })
})

describe(`axis label placement`, () => {
  test(`stagger_axis_labels=true splits x(top/bottom) and y(left/right) sides`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`, `D`],
      y: [`W`, `X`, `Y`, `Z`],
      stagger_axis_labels: true,
    })
    const x_labels = get_x_labels()
    const y_labels = get_y_labels()
    expect(x_labels[0].style.gridRow).toBe(`1`)
    expect(x_labels[1].style.gridRow).toBe(`6`) // n_rows(4) + top row + bottom row
    expect(y_labels[0].style.gridColumn).toBe(`1`)
    expect(y_labels[1].style.gridColumn).toBe(`6`) // n_cols(4) + left col + right col
    // even items keep the near edge class, odd ones get the far edge class
    const has_class = (labels: HTMLElement[], cls: string) =>
      labels.map((label) => label.classList.contains(cls))
    expect(has_class(x_labels, `x-edge-top`)).toEqual([true, false, true, false])
    expect(has_class(x_labels, `x-edge-bottom`)).toEqual([false, true, false, true])
    expect(has_class(y_labels, `y-edge-left`)).toEqual([true, false, true, false])
    expect(has_class(y_labels, `y-edge-right`)).toEqual([false, true, false, true])
    expect(doc_query(`.grid`).style.getPropertyValue(`--extra-bottom-x`)).toBe(`1`)
  })

  test(`symmetric diagonal mode moves only x labels toward diagonal`, () => {
    mount_matrix({
      symmetric: `lower`,
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
      symmetric: `lower`,
      symmetric_label_position: `edge`,
    })
    const x_labels = get_x_labels()
    for (const x_label of Array.from(x_labels)) {
      expect(x_label.style.gridRow).toBe(`1`)
    }
  })

  test(`staggered labels avoid summary row and summary column tracks`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`, `D`],
      y: [`W`, `X`, `Y`, `Z`],
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
    expect(doc_query(`.summary-col`).style.gridRow).toBe(`6`)
    expect(doc_query(`.summary-row`).style.gridColumn).toBe(`6`)
  })
})

describe(`milestone feature props`, () => {
  test(`search_query filters visible labels`, () => {
    mount_matrix({
      x: [`Al`, `Fe`, `Ni`],
      y: [`Al`, `Fe`, `Ni`],
      search_query: `fe`,
    })
    expect(get_x_labels()).toHaveLength(1)
    expect(get_y_labels()).toHaveLength(1)
    expect(get_x_labels()[0].textContent?.trim()).toBe(`Fe`)
  })

  // The ramp spans only the values still on screen, so filtering rescales the colors
  test.each([
    [`unfiltered, the hidden 0 anchors the domain`, ``, 3, 128],
    [`filtered, the domain shrinks to the survivors`, `keep`, 2, 0],
  ])(`%s`, (_desc, search_query, n_cells, red) => {
    mount_matrix({
      x: [`keepA`], // the search filters both axes
      y: [`keep5`, `keep10`, `drop0`],
      values: [[5], [10], [0]],
      color_scale: red_scale,
      search_query,
    })
    const cells = get_data_cells()
    expect(cells).toHaveLength(n_cells)
    expect(red_of(cells[0])).toBe(red) // the cell holding 5
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

  test(`show_color_bar renders color bar with label`, () => {
    mount_matrix({ show_color_bar: true, color_bar_label: `Custom` })
    expect(doc_query(`.color-bar .label`).textContent).toContain(`Custom`)
  })

  // HeatmapMatrix binds show_color_bar/color_bar_position into its controls pane, so both must
  // be $bindable - a plain prop drops the checkbox/select writes (and fails to compile).
  test(`controls pane writes show_color_bar and color_bar_position back to the parent`, async () => {
    const state: { show_color_bar: boolean; color_bar_position: ColorBarPosition } = {
      show_color_bar: true,
      color_bar_position: `bottom`,
    }
    mount(HeatmapMatrix, {
      target: document.body,
      props: bind_props({ x_items, y_items, show_controls: true, controls_open: true }, state),
    })
    await tick()
    const position_select = Array.from(
      document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`),
    ).find((sel) => sel.querySelector(`option[value="right"]`))
    if (!position_select) throw new Error(`color bar position select not rendered`)
    position_select.value = `right`
    position_select.dispatchEvent(new Event(`change`, { bubbles: true }))
    flushSync()
    expect(state.color_bar_position).toBe(`right`)

    doc_query<HTMLInputElement>(`.heatmap-controls input[type="checkbox"]`).click()
    flushSync()
    expect(state.show_color_bar).toBe(false)
  })

  test(`color_bar_format passes through to format_num`, () => {
    mount_matrix({
      x: [`A`],
      y: [`X`],
      values: [[1.234]],
      show_color_bar: true,
      color_bar_format: `.1f`,
      color_scale_range: [1.234, 1.234],
    })
    const tick_text = Array.from(document.querySelectorAll(`.color-bar .tick-label`))
      .map((item) => item.textContent?.trim())
      .find(Boolean)
    expect(tick_text).toBe(format_num(1.234, `.1f`))
  })

  test(`selection_mode multi updates selected class on click`, async () => {
    const select_handler = vi.fn()
    mount_matrix({
      selection_mode: `multi`,
      values: [[1, 2, 3]],
      on_select: select_handler,
    })
    const cells = get_data_cells()
    cells[0].dispatchEvent(mouse(`click`, { ctrlKey: true }))
    await tick()
    expect(cells[0].classList.contains(`selected`)).toBe(true)
    cells[1].dispatchEvent(mouse(`click`, { ctrlKey: true }))
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

  // Shift+click spans the rectangle from the last selected cell; the hidden triangle of a
  // symmetric matrix is left out of it
  test(`selection_mode range spans a rectangle minus the hidden triangle`, () => {
    const select_handler = vi.fn()
    mount_matrix({
      selection_mode: `range`,
      symmetric: `lower`,
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      on_select: select_handler,
    })
    const cell_at = (x_idx: number, y_idx: number) =>
      doc_query(`.cell[data-x="${x_idx}"][data-y="${y_idx}"]`)
    cell_at(0, 0).dispatchEvent(mouse(`click`))
    cell_at(1, 2).dispatchEvent(mouse(`click`, { shiftKey: true }))
    expect(select_handler.mock.calls.at(-1)?.[0]).toEqual([
      { x_idx: 0, y_idx: 0 },
      { x_idx: 0, y_idx: 1 },
      { x_idx: 1, y_idx: 1 },
      { x_idx: 0, y_idx: 2 },
      { x_idx: 1, y_idx: 2 },
    ])
  })

  test(`brush drag reports the spanned ranges and cells`, () => {
    const brush_handler = vi.fn()
    mount_matrix({
      enable_brush: true,
      on_brush: brush_handler,
      values: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    })
    const cell_at = (x_idx: number, y_idx: number) =>
      doc_query(`.cell[data-x="${x_idx}"][data-y="${y_idx}"]`)
    // drag from bottom-right to top-left so the ranges have to be sorted
    cell_at(2, 1).dispatchEvent(mouse(`mousedown`))
    cell_at(1, 0).dispatchEvent(mouse(`mouseover`))
    window.dispatchEvent(new MouseEvent(`mouseup`))
    expect(brush_handler).toHaveBeenCalledOnce()
    const payload = brush_handler.mock.calls[0][0]
    expect(payload.x_range).toEqual([1, 2])
    expect(payload.y_range).toEqual([0, 1])
    expect(payload.cells.map((ctx: { value: number }) => ctx.value)).toEqual([2, 3, 5, 6])
    // a second mouseup without a new drag reports nothing
    window.dispatchEvent(new MouseEvent(`mouseup`))
    expect(brush_handler).toHaveBeenCalledOnce()
  })

  test(`selected outline color token contrasts with dark cell backgrounds`, () => {
    mount_matrix({
      x: [`A`],
      y: [`X`],
      selection_mode: `single`,
      values: [[`#000000`]],
    })
    const first_cell = get_data_cells()[0]
    // only selected cells carry the token (contrast is resolved on demand)
    expect(first_cell.style.getPropertyValue(`--heatmap-selected-outline-color`)).toBe(``)
    first_cell.dispatchEvent(mouse(`click`))
    flushSync()
    expect(first_cell.style.getPropertyValue(`--heatmap-selected-outline-color`)).toBe(`white`)
  })

  test(`on_context_menu is triggered for cell`, () => {
    const handler = vi.fn()
    mount_matrix({ on_context_menu: handler, values: [[1]] })
    const first_cell = get_data_cells()[0]
    const event = mouse(`contextmenu`, { cancelable: true })
    first_cell.dispatchEvent(event)
    // the handler gets the cell's context plus the raw event, whose native menu is suppressed
    expect(handler).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ x_idx: 0, y_idx: 0, value: 1 }),
      event,
    )
    expect(event.defaultPrevented).toBe(true)
  })

  test(`tooltip_mode=both hides hover tooltip when no pinned cell`, async () => {
    mount_matrix({
      tooltip: true,
      tooltip_mode: `both`,
      values: [[1]],
    })
    await Promise.resolve()
    const first_cell = get_data_cells()[0]
    const tooltip_el = doc_query(`.tooltip`)
    first_cell.dispatchEvent(mouse(`mouseover`, { clientX: 10, clientY: 10 }))
    await Promise.resolve()
    first_cell.dispatchEvent(mouse(`mouseout`))
    await Promise.resolve()
    expect(tooltip_el.classList.contains(`visible`)).toBe(false)
  })

  test(`symmetric summaries ignore hidden upper triangle`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`A`, `B`],
      values: [
        [1, 2],
        [3, 4],
      ],
      symmetric: `lower`,
      show_row_summaries: true,
    })
    const summary_cells = document.querySelectorAll<HTMLElement>(`.summary-row`)
    expect(summary_cells[0].textContent?.trim()).toBe(`1`)
    expect(summary_cells[1].textContent?.trim()).toBe(`3.5`)
  })
})

describe(`show_values`, () => {
  const mount_single_value = (
    value: number,
    props: Partial<ComponentProps<typeof HeatmapMatrix>>,
  ): void => mount_matrix({ x: [`A`], y: [`X`], values: [[value]], ...props })

  test(`true renders formatted numbers inside cells`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
      values: [[1.2345, 0.001]],
      show_values: true,
    })
    const spans = document.querySelectorAll(`.cell-value`)
    expect(spans).toHaveLength(2)
    expect(spans[0].textContent).toBe(format_num(1.2345, `.3~g`))
    expect(spans[1].textContent).toBe(format_num(0.001, `.3~g`))
  })

  test(`contrasts translucent cell colors against the matrix background`, async () => {
    mount_single_value(1, {
      show_values: true,
      color_overrides: {
        [make_color_override_key(`A`, `X`)]: `rgba(255, 255, 255, 0.1)`,
      },
      backdrop: `black`,
      style: `background: black`,
    })
    await tick()
    expect(doc_query(`.cell`).style.color).toBe(`white`)
  })

  test(`custom format string is used`, () => {
    mount_single_value(Math.PI, { show_values: `.1f` })
    expect(doc_query(`.cell-value`).textContent).toBe(format_num(Math.PI, `.1f`))
  })

  test(`ignored when custom cell snippet is provided`, () => {
    mount_single_value(42, {
      show_values: true,
      // not a real snippet - only presence matters for suppressing .cell-value
      // oxlint-disable-next-line no-unnecessary-type-assertion -- svelte-check needs it
      cell: (() => {}) as never,
    })
    expect(document.querySelectorAll(`.cell-value`)).toHaveLength(0)
  })

  test(`null values produce no span`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
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

describe(`virtualization`, () => {
  const STRIDE = 100 // tile_size, with the default 0 gap
  const labels = Array.from({ length: 30 }, (_unused, idx) => `I${idx}`)

  // happy-dom has no layout, so offsetLeft/offsetTop read 0 for every cell and the grid-offset
  // probe would see the grid sliding out from under the scroll. Lay the cells out on the same
  // uniform stride the virtualizer already assumes. Spies rather than a prototype patch, so
  // restoreAllMocks puts the real getters back for the rest of the file.
  afterEach(() => vi.restoreAllMocks())
  const stub_cell_layout = () => {
    for (const [prop, axis] of [
      [`offsetLeft`, `x`],
      [`offsetTop`, `y`],
    ] as const) {
      vi.spyOn(HTMLElement.prototype, prop, `get`).mockImplementation(
        function (this: HTMLElement) {
          return this.dataset?.[axis] === undefined ? 0 : Number(this.dataset[axis]) * STRIDE
        },
      )
    }
  }

  const mount_virtual = (extra: Partial<ComponentProps<typeof HeatmapMatrix>> = {}) => {
    stub_cell_layout()
    mount_matrix({
      x: labels,
      y: labels,
      values: labels.map((_u, row) => labels.map((_v, col) => row + col)),
      virtualize: true,
      tile_size: `${STRIDE}px`,
      ...extra,
    })
  }
  const rendered_idxs = (axis: `x` | `y`): number[] =>
    [
      ...new Set(query_all(`.cell[data-x]`).map((cell) => Number(cell.dataset[axis]))),
    ].toSorted((left, right) => left - right)
  const cell_at = (x_idx: number, y_idx: number) =>
    document.querySelector<HTMLElement>(`.cell[data-x="${x_idx}"][data-y="${y_idx}"]`)

  // Stepping off the edge of the window lands on a cell that has no DOM node yet, so the
  // component has to scroll it in and wait for the re-render. Focusing without that simply
  // found nothing, and the arrow key did nothing at all four edges.
  test.each([
    [`ArrowRight`, `x`, 1],
    [`ArrowLeft`, `x`, -1],
    [`ArrowDown`, `y`, 1],
    [`ArrowUp`, `y`, -1],
  ] as const)(`%s moves focus across the virtual window edge`, async (key, axis, step) => {
    mount_virtual({ on_click: () => {} })
    await tick()
    // Scroll into the middle so the window has an edge to cross in either direction
    const grid = doc_query(`.grid`)
    grid.scrollLeft = 1000
    grid.scrollTop = 1000
    grid.dispatchEvent(new Event(`scroll`))
    await tick()

    const moving = rendered_idxs(axis)
    const from = step > 0 ? Math.max(...moving) : Math.min(...moving)
    const fixed_axis = axis === `x` ? `y` : `x`
    const fixed = rendered_idxs(fixed_axis)[1] // safely inside the other axis's window
    const start = axis === `x` ? cell_at(from, fixed) : cell_at(fixed, from)
    if (!start) throw new Error(`edge cell ${from} was not rendered`)
    start.focus()
    start.dispatchEvent(keydown(key))
    await tick()
    await tick()

    const focused = document.activeElement as HTMLElement | null
    expect(Number(focused?.dataset?.[axis])).toBe(from + step)
    expect(Number(focused?.dataset?.[fixed_axis])).toBe(fixed)
  })

  // Labels and summaries are one node per track, so the full list mounted 30 of each for a
  // handful of cells. Measuring also left the scroll handler, so a resize must re-window.
  test(`windows the label and summary tracks, and re-windows on a resize`, async () => {
    mount_virtual({ show_row_summaries: true, show_col_summaries: true })
    await tick()
    const [x_window, y_window] = [rendered_idxs(`x`), rendered_idxs(`y`)]
    expect(x_window.length).toBeLessThan(labels.length)
    expect(get_x_labels()).toHaveLength(x_window.length)
    expect(get_y_labels()).toHaveLength(y_window.length)
    expect(query_all(`.summary-col`)).toHaveLength(x_window.length)
    expect(query_all(`.summary-row`)).toHaveLength(y_window.length)

    const grid = doc_query(`.grid`)
    for (const prop of [`clientWidth`, `clientHeight`] as const) {
      Object.defineProperty(grid, prop, { value: 10 * STRIDE, configurable: true })
    }
    trigger_resize_observer(grid)
    await tick()
    expect(rendered_idxs(`x`).length).toBeGreaterThan(x_window.length)
  })
})

// `e` downloads a file, so it must reach neither a chord nor a typed character
test.each([
  [`plain e exports`, { key: `e` }, undefined, 1],
  [`Cmd+E is the browser's`, { key: `e`, metaKey: true }, undefined, 0],
  [`Ctrl+E is the browser's`, { key: `e`, ctrlKey: true }, undefined, 0],
  [`typing e in an input never exports`, { key: `e` }, `input`, 0],
  [`a held e does not re-download`, { key: `e`, repeat: true }, undefined, 0],
])(`%s`, async (_name, init, target_tag, calls) => {
  const on_export = vi.fn()
  mount_matrix({ on_export, export_formats: [`csv`] })
  await tick()
  const grid = doc_query(`.grid`)
  const input = document.createElement(`input`)
  if (target_tag) grid.append(input)
  const target = target_tag ? input : grid
  target.dispatchEvent(new KeyboardEvent(`keydown`, { ...init, bubbles: true }))
  await tick()
  expect(on_export).toHaveBeenCalledTimes(calls)
})

// Cmd/Ctrl+Arrow is the browser's (scroll to end); only bare arrows walk cells
test.each([
  [`bare ArrowRight walks a cell`, {}, true],
  [`Cmd+ArrowRight is the browser's`, { metaKey: true }, false],
  [`Ctrl+ArrowRight is the browser's`, { ctrlKey: true }, false],
])(`%s`, async (_name, modifiers, expect_handled) => {
  mount_matrix()
  await tick()
  const cell = doc_query(`.grid [data-x="0"][data-y="0"]`)
  cell.focus()
  const event = keydown(`ArrowRight`, { cancelable: true })
  Object.assign(event, modifiers)
  doc_query(`.grid`).dispatchEvent(event)
  await tick()
  expect(event.defaultPrevented).toBe(expect_handled)
})
