import HeatmapMatrix from '#lib/heatmap-matrix/HeatmapMatrix.svelte'
import heatmap_source from '#lib/heatmap-matrix/HeatmapMatrix.svelte?raw'
import type { AxisItem, HeatmapDomainMode } from '#lib/heatmap-matrix/index.js'
import { VIRTUAL_CELL_THRESHOLD } from '#lib/heatmap-matrix/index.js'
import { format_num } from '#lib/labels.js'
import type ColorBar from '#lib/plot/core/components/ColorBar.svelte'
import type { ColorScale, ColorScaleConfig } from '#lib/plot/core/types.js'
import type { ComponentProps } from 'svelte'
import { flushSync, mount, tick } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import { afterEach, describe, expect, onTestFinished, test, vi } from 'vitest'
import {
  bind_props,
  doc_query,
  expect_tooltip_paint,
  export_via_pane,
  form_controls,
  keydown,
  mouse,
  trigger_resize_observer,
} from '../setup'
import HeatmapMatrixReplacementHarness from './HeatmapMatrixReplacementHarness.svelte'

const make_items = (labels: readonly string[]): AxisItem[] =>
  labels.map((label, idx) => ({ label, key: label, sort_value: idx }))

const x_items = make_items([`A`, `B`, `C`])
const y_items = make_items([`X`, `Y`, `Z`])
const numbered_values = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
]

// `x`/`y` are a shorthand to build x_items/y_items from label arrays; pass x_items/y_items
// directly for custom AxisItem objects (e.g. explicit sort_value)
const mount_matrix = (
  props: { x?: readonly string[]; y?: readonly string[] } & Partial<
    ComponentProps<typeof HeatmapMatrix>
  > = {},
): void => {
  const { x: coord_x, y: coord_y, ...rest } = props
  mount(HeatmapMatrix, {
    target: document.body,
    props: {
      x_items: coord_x ? make_items(coord_x) : x_items,
      y_items: coord_y ? make_items(coord_y) : y_items,
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
const label_text = (label: HTMLElement) => label.textContent?.trim()
// rendered [column, row] grid line of a cell: its column's --c<x_idx> on the grid, its row wrapper's --r
const cell_track = (cell: HTMLElement): [number, number] => [
  Number(doc_query(`.grid`).style.getPropertyValue(`--c${cell.dataset.x}`)),
  Number(cell.closest<HTMLElement>(`.row`)?.style.getPropertyValue(`--r`)),
]
const cell_at = (x_idx: number, y_idx: number) =>
  doc_query(`.cell[data-x="${x_idx}"][data-y="${y_idx}"]`)
// scheme whose red channel reads back the normalized position on the ramp
const red_scale = (val: number) => `rgb(${Math.round(val * 255)}, 0, 0)`
const red_of = (cell: HTMLElement) => Number(/\d+/.exec(cell.style.backgroundColor)?.[0])

describe(`HeatmapMatrix rendering`, () => {
  test(`renders cells, labels, corner, data attributes, class, gap and CSS vars`, () => {
    mount_matrix({ class: `my-matrix`, gap: `2px` })
    // 3x3 = 9 cells
    const cells = get_data_cells()
    expect(cells).toHaveLength(9)
    // happy-dom drops nested CSS rules; Playwright checks the rendered colors and animations.
    expect(heatmap_source).toMatch(/\.cell\s*\{[^{}]*transition:\s*none;/)
    expect(get_x_labels().map(label_text)).toEqual([`A`, `B`, `C`])
    expect(get_y_labels().map(label_text)).toEqual([`X`, `Y`, `Z`])
    // corner spacer present when both axes have labels
    expect(document.querySelectorAll(`.corner`)).toHaveLength(1)
    // data attributes on first and last cell
    const { x: first_x, y: first_y } = cells[0].dataset
    const { x: last_x, y: last_y } = cells[8].dataset
    expect([first_x, first_y, last_x, last_y]).toEqual([`0`, `0`, `2`, `2`])
    const container = doc_query(`.grid`)
    expect(container.style.getPropertyValue(`--n-cols`)).toBe(`3`)
    expect(container.style.getPropertyValue(`--n-rows`)).toBe(`3`)
    expect(container.classList.contains(`my-matrix`)).toBe(true)
    expect(container.style.gap).toBe(`2px`)
  })

  test.each([false, true])(`show_x_labels=%s with the other axis hidden`, (show_x_labels) => {
    mount_matrix({ show_x_labels, show_y_labels: !show_x_labels })
    expect(get_x_labels()).toHaveLength(show_x_labels ? 3 : 0)
    expect(get_y_labels()).toHaveLength(show_x_labels ? 0 : 3)
    // corner spacer only when both axes shown
    expect(document.querySelectorAll(`.corner`)).toHaveLength(0)
  })
})

describe(`axis replacement`, () => {
  test(`clears index-based interaction state when axis keys change`, async () => {
    mount(HeatmapMatrixReplacementHarness, { target: document.body })
    await tick()
    const test_text = (id: string) => doc_query(`[data-testid="${id}"]`).textContent
    expect(test_text(`selected-count`)).toBe(`1`)
    doc_query(`[data-testid="replace-axis"]`).click()
    flushSync()
    await tick()
    const ids = [`selected-count`, `active-cell`, `pinned-cell`]
    expect(ids.map(test_text)).toEqual([`0`, `none`, `none`])
  })
})

describe(`symmetric mode`, () => {
  // label order renders C A B as A B C, so the triangle must follow rendered positions
  test.each([`lower`, `upper`] as const)(`%s renders triangle + diagonal`, (mode) => {
    const labels = [`C`, `A`, `B`]
    mount_matrix({ x: labels, y: labels, symmetric: mode, x_order: `label`, y_order: `label` })
    const data_cells = get_data_cells()
    const empty_cells = get_empty_cells()
    // 3x3 symmetric: diagonal(3) + triangle(3) = 6 data, 3 empty
    expect(data_cells).toHaveLength(6)
    expect(empty_cells).toHaveLength(3)
    for (const cell of data_cells) {
      const [col, row] = cell_track(cell)
      const message = `(${cell.dataset.x},${cell.dataset.y})`
      if (mode === `lower`) expect(col, message).toBeLessThanOrEqual(row)
      else expect(col, message).toBeGreaterThanOrEqual(row)
    }
    for (const cell of empty_cells) expect(cell.dataset.x).toBeUndefined()
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
      color_scale: { scheme: red_scale },
    })
    // cells are laid out y-row by y-row, so the ramp position is each value's own share of
    // the 0..1 data range (0.25 -> 64, 0.75 -> 191 after rounding)
    expect(get_data_cells().map(red_of)).toEqual([0, 128, 255, 64, 191, 0, 255, 0, 128])
  })

  test(`missing color, label and style decorate only null cells`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`],
      y: [`X`],
      values: [[null, 1, null]],
      missing: { color: `red`, label: `N/A`, style: `opacity: 0.4` },
    })
    const cells = get_data_cells()
    for (const idx of [0, 2]) {
      expect(cells[idx].style.backgroundColor).toBe(`red`)
      expect(cells[idx].textContent?.trim()).toBe(`N/A`)
      expect(cells[idx].style.opacity).toBe(`0.4`)
      expect(cells[idx].style.color).toBe(``)
    }
    // B=1 is present -> regular color, no label, not dimmed
    expect(cells[1].style.backgroundColor).not.toBe(`red`)
    expect(cells[1].textContent).not.toContain(`N/A`)
    expect(cells[1].style.opacity).toBe(``)
  })

  test(`record-based values resolve by key with null handling`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`, `Y`],
      values: { X: { A: 0, B: 1 }, Y: { A: 0.5, B: null } },
      missing: { color: `red` },
      color_scale: { scheme: red_scale },
    })
    const cells = get_data_cells()
    expect(cells).toHaveLength(4)
    // X.A=0, X.B=1, Y.A=0.5 land at the bottom, top and middle of the ramp; the null Y.B
    // cell takes the missing color and does not shrink the [0, 1] domain
    expect(cells.slice(0, 3).map(red_of)).toEqual([0, 255, 128])
    expect(cells[3].style.backgroundColor).toBe(`red`)
  })

  test(`color_overrides takes precedence over computed color`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
      values: [[0.2, 0.8]],
      color_overrides: { X: { B: `rgb(1, 2, 3)` } },
    })
    const cells = get_data_cells()
    expect(cells[1].style.backgroundColor).toBe(`rgb(1, 2, 3)`)
    expect(cells[0].style.backgroundColor).not.toBe(`rgb(1, 2, 3)`)
  })

  // the legend reads the same lifted floor as the cells: a zero in the data must not floor
  // the bar at LOG_EPS while cells start at the smallest positive value
  test(`log legend spans the lifted cell floor, not LOG_EPS`, () => {
    mount_matrix({
      x: [`A`, `B`, `C`],
      y: [`X`],
      values: [[0, 0.01, 100]],
      color_scale: { type: `log` },
      color_bar: { tick_format: `~g` },
    })
    const ticks = [...document.querySelectorAll(`.colorbar .tick-label`)].map((span) =>
      Number(span.textContent),
    )
    expect([Math.min(...ticks), Math.max(...ticks)]).toEqual([0.01, 100])
  })

  // 51 values 0..50: the 2nd/98th percentiles (interpolated, quantile_unordered) are 1 and 49,
  // so under `robust` 1 maps to the bottom of the ramp, 49 to the top, 0 and 50 saturate.
  test(`switching domains collects robust quantiles and restores the automatic range`, () => {
    const values = [Array.from({ length: 51 }, (_val, idx) => idx)]
    const domain = fromStore(writable<HeatmapDomainMode>(`auto`))
    mount(HeatmapMatrix, {
      target: document.body,
      props: {
        x_items: make_items(values[0].map((val) => `c${val}`)),
        y_items: make_items([`X`]),
        values,
        color_scale: { scheme: red_scale },
        get domain_mode() {
          return domain.current
        },
      },
    })
    for (const mode of [`auto`, `robust`, `auto`, `robust`] as const) {
      flushSync(() => (domain.current = mode))
      const reds = get_data_cells().map(red_of)
      expect([0, 1, 2, 25, 49, 50].map((idx) => reds[idx])).toEqual(
        mode === `robust` ? [0, 0, 5, 128, 255, 255] : [0, 5, 10, 128, 250, 255],
      )
    }
  })

  // value_range[0] takes the palette start whichever way the range runs, as in every other
  // colored component; cells and the ColorBar read the same mapping
  test(`descending value_range runs the palette high-to-low in cells and legend`, () => {
    mount_matrix({
      x: [`A`, `B`],
      y: [`X`],
      values: [[0, 10]],
      color_bar: {},
      color_scale: { scheme: red_scale, value_range: [10, 0] },
    })
    expect(get_data_cells().map(red_of)).toEqual([255, 0])
    const gradient = doc_query(`.colorbar .bar`).getAttribute(`style`) ?? ``
    const stops = gradient.match(/rgb\(\d+, 0, 0\)/g) ?? []
    expect(stops[0]).toBe(`rgb(0, 0, 0)`) // value 10 sits at the left end
    expect(stops.at(-1)).toBe(`rgb(255, 0, 0)`)
  })

  // a non-positive log floor is lifted to the smallest positive value so the data still spans
  // the ramp; a degenerate domain paints every mappable cell the midpoint color (also when
  // the lifted log floor lands on the max); non-positive log value_range ends fit the data.
  // Log midpoints land on 127.5 +- 1 ulp, so they may round to byte 127 or 128.
  test.each<[string, ColorScaleConfig, number[], (number | string)[]]>([
    [`custom color scale`, { scheme: () => `rgb(255, 0, 0)` }, [0.5], [`rgb(255, 0, 0)`]],
    [
      `non-positive data lifts the log floor`,
      { type: `log` },
      [-1, 0.01, 1, 100],
      [`red`, 0, expect.toBeOneOf([127, 128]), 255],
    ],
    // Positive values below LOG_EPS (1e-9) must still span the whole ramp.
    [`sub-1e-9 log bounds`, { type: `log` }, [1e-12, 1e-9, 1e-6], [0, 128, 255]],
    [
      `log floor lifted to the min positive value`,
      { type: `log`, value_range: [-10, 10] },
      [1, 10],
      [0, 255],
    ],
    [`zero-width range`, { value_range: [2, 2] }, [1, 2, 3], [128, 128, 128]],
    // a null end keeps the data bound
    [`one fixed end`, { value_range: [null, 4] }, [0, 2, 4, 8], [0, 128, 255, 255]],
    [
      `log floor lifted onto the max`,
      { type: `log`, value_range: [-1, 5] },
      [5, 0],
      [expect.toBeOneOf([127, 128]), 0],
    ],
    [`log range entirely <= 0`, { type: `log`, value_range: [-5, 0] }, [1, 100], [0, 255]],
    // palette_range clips the scheme: the data spans its upper half
    [`palette_range`, { palette_range: [0.5, 1] }, [0, 1], [128, 255]],
  ])(`%s`, (_name, color_scale, row, expected_reds) => {
    mount_matrix({
      x: row.map((val) => `c${val}`),
      y: [`X`],
      values: [row],
      missing: { color: expected_reds.includes(`red`) ? `red` : `rgb(0, 0, 0)` },
      color_scale: { scheme: red_scale, ...color_scale },
    })
    const colors = get_data_cells().map((cell, idx) =>
      typeof expected_reds[idx] === `string` ? cell.style.backgroundColor : red_of(cell),
    )
    expect(colors).toEqual(expected_reds)
  })

  test(`empty values array gives transparent cells`, () => {
    mount_matrix({ values: [] })
    for (const cell of get_data_cells()) expect(cell.style.backgroundColor).toBe(`transparent`)
  })
})

describe(`click and dblclick handlers`, () => {
  test.each([
    [`on_click`, `click`],
    [`on_double_click`, `dblclick`],
  ] as const)(`%s receives the CellContext of a %s`, (prop, event_type) => {
    const handler = vi.fn()
    mount_matrix({ values: numbered_values, [prop]: handler })
    cell_at(1, 2).dispatchEvent(mouse(event_type))
    expect(handler).toHaveBeenCalledOnce()
    expect(handler.mock.calls[0][0]).toMatchObject({
      x_idx: 1,
      y_idx: 2,
      value: 8,
      x_item: { label: `B` },
      y_item: { label: `Z` },
    })
  })

  test(`disambiguates click vs dblclick when both handlers are set`, () => {
    vi.useFakeTimers()
    try {
      const on_click = vi.fn()
      const on_dblclick = vi.fn()
      mount_matrix({ values: [[10, 20, 30]], on_click, on_double_click: on_dblclick })
      const cells = get_data_cells()
      // Matching click/dblclick triggers double; orphaned or different-cell doubles become single.
      for (const [click_idx, cell_idx, double] of [
        [0, 0, true],
        [null, 0, false],
        [0, 1, false],
      ] as const) {
        on_click.mockClear()
        on_dblclick.mockClear()
        if (click_idx !== null) cells[click_idx].dispatchEvent(mouse(`click`))
        cells[cell_idx].dispatchEvent(mouse(`dblclick`))
        if (!double) expect(on_dblclick).not.toHaveBeenCalled()
        vi.runAllTimers()
        expect(on_click).toHaveBeenCalledTimes(double ? 0 : 1)
        expect(on_dblclick).toHaveBeenCalledTimes(double ? 1 : 0)
        const handler = double ? on_dblclick : on_click
        expect(handler.mock.calls[0][0]).toMatchObject({
          x_idx: cell_idx,
          y_idx: 0,
          value: cell_idx === 0 ? 10 : 20,
        })
      }
    } finally {
      vi.useRealTimers()
    }
  })

  test(`x_order/y_order reorder labels, arrow keys follow, reorders move no nodes`, async () => {
    const x_order = fromStore(writable<`sort_value` | undefined>(`sort_value`))
    mount(HeatmapMatrix, {
      target: document.body,
      props: {
        x_items: [
          { label: `B`, sort_value: 2 },
          { label: `A`, sort_value: 1 },
        ],
        y_items: [
          { label: `Y`, sort_value: 2 },
          { label: `X`, sort_value: 1 },
        ],
        get x_order() {
          return x_order.current
        },
        y_order: `label`,
        on_click: () => {},
      },
    })
    await tick()
    expect(get_x_labels()[0].textContent?.trim()).toBe(`A`)
    expect(get_y_labels()[0].textContent?.trim()).toBe(`X`)
    const start = cell_at(1, 1)
    start.focus()
    const arrow_right = keydown(`ArrowRight`, { cancelable: true })
    start.dispatchEvent(arrow_right)
    expect(arrow_right.defaultPrevented).toBe(true)
    await tick()
    expect(document.activeElement).toBe(cell_at(0, 1))
    document.activeElement?.dispatchEvent(keydown(`ArrowDown`))
    await tick()
    expect(document.activeElement).toBe(cell_at(0, 0))
    // back to item order (B A): cell nodes stay put, only their grid columns change
    const nodes = get_data_cells()
    const columns = () => nodes.map((cell) => cell_track(cell)[0])
    expect(columns()).toEqual([2, 3, 2, 3])
    flushSync(() => (x_order.current = undefined))
    await tick()
    expect(get_data_cells()).toEqual(nodes)
    expect(columns()).toEqual([3, 2, 3, 2])
  })

  test(`one tab stop follows focus, Enter and Space click it; static matrices are tables`, async () => {
    const on_click = vi.fn()
    const disabled = fromStore(writable(false))
    const props = {
      x_items,
      y_items,
      on_click,
      get disabled() {
        return disabled.current
      },
    }
    mount(HeatmapMatrix, { target: document.body, props })
    await tick()
    const roles = () =>
      [doc_query(`.grid`), cell_at(0, 0)].map((el) => el.getAttribute(`role`))
    expect(roles()).toEqual([`grid`, `gridcell`])
    const tab_stops = () => get_data_cells().filter((cell) => cell.tabIndex === 0)
    expect(tab_stops()).toEqual([cell_at(0, 0)])
    cell_at(1, 1).focus()
    expect(tab_stops()).toEqual([cell_at(1, 1)])
    for (const key_name of [`Enter`, ` `]) {
      const event = keydown(key_name, { cancelable: true })
      cell_at(1, 1).dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
    expect(on_click).toHaveBeenCalledTimes(2) // once per key, cells are not native buttons
    expect(on_click.mock.calls[0][0]).toMatchObject({ x_idx: 1, y_idx: 1 })
    // disabled matrices are static tables; re-enabling restores exactly one tab stop
    flushSync(() => (disabled.current = true))
    expect(roles()).toEqual([`table`, `cell`])
    // focus reaching a static cell (e.g. a button in a `cell` snippet) adds no tab stop
    cell_at(0, 0).dispatchEvent(new FocusEvent(`focusin`, { bubbles: true }))
    expect(query_all(`.grid [tabindex]`)).toEqual([])
    flushSync(() => (disabled.current = false))
    expect(tab_stops()).toEqual([cell_at(1, 1)])
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

test.each([
  { desc: `4x2`, x: [`A`, `B`, `C`, `D`], y: [`X`, `Y`], symmetric: false, data: 8 },
  { desc: `1x1 symmetric`, x: [`A`], y: [`A`], symmetric: `lower`, data: 1 },
] as const)(
  `$desc renders $data data cells and no empty cells`,
  ({ desc: _desc, data, ...props }) => {
    mount_matrix(props)
    expect(get_data_cells()).toHaveLength(data)
    expect(get_empty_cells()).toHaveLength(0)
  },
)

describe(`hide_empty`, () => {
  // 3x3 grid where column B and row Y are entirely null; x_order renders C B A as A B C
  const sparse = {
    x: [`C`, `B`, `A`],
    x_order: `label` as const,
    y: [`X`, `Y`, `Z`],
    values: [
      [2, null, 1],
      [null, null, null],
      [4, null, 3],
    ],
  }

  test.each([`compact`, `gaps`, false] as const)(
    `mode=%s filters rows and columns`,
    (hide_empty) => {
      mount_matrix({ ...sparse, hide_empty })
      expect(get_x_labels().map((label) => label.textContent?.trim())).toEqual(
        hide_empty ? [`A`, `C`] : [`A`, `B`, `C`],
      )
      expect(get_y_labels().map((label) => label.textContent?.trim())).toEqual(
        hide_empty ? [`X`, `Z`] : sparse.y,
      )
      const cells = get_data_cells()
      expect(cells).toHaveLength(hide_empty ? 4 : 9)
      if (hide_empty === `gaps`) {
        const grid = doc_query(`.grid`)
        expect(grid.style.getPropertyValue(`--n-cols`)).toBe(`3`)
        expect(grid.style.getPropertyValue(`--n-rows`)).toBe(`3`)
        // Gaps retain the ordered A/X and C/Z tracks despite missing B/Y.
        expect(cell_track(cells[0])).toEqual([2, 2])
        expect(cell_track(cells[3])).toEqual([4, 4])
      }
    },
  )
})

describe(`axis label placement`, () => {
  test.each([false, true])(
    `staggered labels avoid summary tracks: summaries=%s`,
    (summaries) => {
      // shuffled items sorted by label: edges alternate by rendered position, not item index
      mount_matrix({
        x: [`C`, `A`, `D`, `B`],
        y: [`Y`, `W`, `Z`, `X`],
        x_order: `label`,
        y_order: `label`,
        ...(summaries && {
          values: [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
            [13, 14, 15, 16],
          ],
          show_row_summaries: true,
          show_col_summaries: true,
        }),
        stagger_axis_labels: true,
      })
      const far_track = summaries ? `7` : `6`
      const tracks = [`1`, far_track, `1`, far_track]
      for (const [labels, track, near, far] of [
        [get_x_labels(), `gridRow`, `x-edge-top`, `x-edge-bottom`],
        [get_y_labels(), `gridColumn`, `y-edge-left`, `y-edge-right`],
      ] as const) {
        expect(labels.map((label) => label.style[track])).toEqual(tracks)
        const near_edges = labels.map((label) => label.classList.contains(near))
        const far_edges = labels.map((label) => label.classList.contains(far))
        expect(near_edges).toEqual([true, false, true, false])
        expect(far_edges).toEqual([false, true, false, true])
      }
      expect(doc_query(`.grid`).style.getPropertyValue(`--extra-bottom-x`)).toBe(`1`)
      if (summaries) {
        expect(doc_query(`.summary-col`).style.gridRow).toBe(`6`)
        expect(doc_query(`.summary-row`).style.gridColumn).toBe(`6`)
      }
    },
  )

  test.each([
    [`diagonal`, [`1`, `2`, `3`]],
    [`edge`, [`1`, `1`, `1`]],
  ] as const)(
    `symmetric %s positions x labels and keeps y labels at the edge`,
    (position, rows) => {
      mount_matrix({ symmetric: `lower`, symmetric_label_position: position })
      expect(get_x_labels().map((label) => label.style.gridRow)).toEqual(rows)
      expect(get_y_labels().map((label) => label.style.gridColumn)).toEqual([`1`, `1`, `1`])
    },
  )
})

describe(`milestone feature props`, () => {
  test(`search_query filters visible labels`, () => {
    mount_matrix({ x: [`Al`, `Fe`, `Ni`], y: [`Al`, `Fe`, `Ni`], search_query: `fe` })
    expect(get_x_labels().map(label_text)).toEqual([`Fe`])
    expect(get_y_labels().map(label_text)).toEqual([`Fe`])
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
      color_scale: { scheme: red_scale },
      search_query,
    })
    const cells = get_data_cells()
    expect(cells).toHaveLength(n_cells)
    expect(red_of(cells[0])).toBe(red) // the cell holding 5
  })

  // HeatmapMatrix binds color_scale/color_bar into its controls pane, so both must be
  // $bindable - a plain prop drops the select/checkbox writes (and fails to compile). The
  // Normalize select writes color_scale.type, keeping its scheme.
  test(`controls pane writes color scale type and color bar props back`, async () => {
    // store-backed, so the matrix re-renders on its own writes
    const boxed = (initial: unknown): PropertyDescriptor => {
      const box = fromStore(writable(initial))
      return { get: () => box.current, set: (val) => (box.current = val), enumerable: true }
    }
    type BarProps = Partial<ComponentProps<typeof ColorBar>> | null
    type State = { color_scale: ColorScale; color_bar: BarProps }
    const state = Object.defineProperties({} as State, {
      color_scale: boxed({ scheme: red_scale, type: `log` }),
      color_bar: boxed({ title: `Kept` }),
    })
    const props = {
      x_items,
      y_items: make_items([`X`]),
      values: [[1, 10, 100]],
      show_controls: true,
      controls_open: true,
    }
    mount(HeatmapMatrix, { target: document.body, props: bind_props(props, state) })
    await tick()
    const { control, set_value } = form_controls()
    const reds = () => get_data_cells().map(red_of)
    const normalize = control(`Normalize`).value
    expect([normalize, ...reds()]).toEqual([`log`, 0, expect.toBeOneOf([127, 128]), 255])
    await set_value(`Normalize`, `linear`)
    expect(reds()).toEqual([0, 23, 255])
    expect(state.color_scale).toEqual({ scheme: red_scale, type: `linear` })

    await set_value(`Color bar side`, `vertical`)
    expect(state.color_bar).toEqual({ title: `Kept`, orientation: `vertical` })
    expect(doc_query(`.heatmap`).classList.contains(`color-bar-right`)).toBe(true)
    control(`Color bar`).click()
    flushSync()
    expect(state.color_bar).toBeNull()
    control(`Color bar`).click() // toggling back on restores the stashed props
    flushSync()
    expect(state.color_bar).toEqual({ title: `Kept`, orientation: `vertical` })
  })

  test(`color_bar renders with its title and tick_format overriding the defaults`, () => {
    mount_matrix({
      x: [`A`],
      y: [`X`],
      values: [[1.234]],
      color_bar: { title: `Custom`, tick_format: `.1f` },
      color_scale: { value_range: [1.234, 1.234] },
    })
    expect(doc_query(`.color-bar .label`).textContent).toContain(`Custom`)
    const tick_text = Array.from(document.querySelectorAll(`.color-bar .tick-label`))
      .map((item) => item.textContent?.trim())
      .find(Boolean)
    expect(tick_text).toBe(format_num(1.234, `.1f`))
  })

  test(`selection_mode multi updates selected class on click`, async () => {
    const select_handler = vi.fn()
    mount_matrix({ selection_mode: `multi`, values: [[1, 2, 3]], on_select: select_handler })
    const cells = get_data_cells()
    for (const cell of cells.slice(0, 2)) {
      cell.dispatchEvent(mouse(`click`, { ctrlKey: true }))
      await tick()
      expect(cell.classList.contains(`selected`)).toBe(true)
    }
    expect(select_handler.mock.calls.at(-1)?.[0]).toEqual([
      { x_idx: 0, y_idx: 0 },
      { x_idx: 1, y_idx: 0 },
    ])
  })

  // Shift+click spans the rectangle from the last selected cell (cells listed as x:y); the
  // hidden triangle of a symmetric matrix and columns filtered out by the search are left out
  test.each([
    [`symmetric lower`, { symmetric: `lower` }, [1, 2], `0:0 0:1 1:1 0:2 1:2`],
    [`search hides a column`, { x: [`Ax`, `B`, `Cx`], search_query: `x` }, [2, 0], `0:0 2:0`],
  ] as const)(
    `selection_mode range spans a rectangle: %s`,
    (_desc, props, [end_x, end_y], expected) => {
      const select_handler = vi.fn<(cells: { x_idx: number; y_idx: number }[]) => void>()
      mount_matrix({
        selection_mode: `range`,
        values: numbered_values,
        on_select: select_handler,
        ...props,
      })
      cell_at(0, 0).dispatchEvent(mouse(`click`))
      cell_at(end_x, end_y).dispatchEvent(mouse(`click`, { shiftKey: true }))
      const cells = select_handler.mock.calls.at(-1)?.[0] ?? []
      expect(cells.map(({ x_idx, y_idx }) => `${x_idx}:${y_idx}`).join(` `)).toBe(expected)
    },
  )

  // C A B renders as A B C: a drag from C back to B spans rendered B..C (item indices 2, 0)
  // and must not pick up A from between their indices
  test(`brush drag reports the spanned ranges and cells in rendered order`, () => {
    const brush_handler = vi.fn()
    mount_matrix({
      x: [`C`, `A`, `B`],
      x_order: `label`,
      enable_brush: true,
      on_brush: brush_handler,
      values: numbered_values,
    })
    // drag from bottom-right to top-left so the ranges have to be sorted
    cell_at(0, 1).dispatchEvent(mouse(`mousedown`))
    cell_at(2, 0).dispatchEvent(mouse(`mouseover`))
    window.dispatchEvent(new MouseEvent(`mouseup`))
    expect(brush_handler).toHaveBeenCalledOnce()
    const payload = brush_handler.mock.calls[0][0]
    expect(payload.x_range).toEqual([2, 0])
    expect(payload.y_range).toEqual([0, 1])
    expect(payload.cells.map((ctx: { value: number }) => ctx.value)).toEqual([3, 1, 6, 4])
    // a second mouseup without a new drag reports nothing
    window.dispatchEvent(new MouseEvent(`mouseup`))
    expect(brush_handler).toHaveBeenCalledOnce()
  })

  // a search hiding the brushed cells before mouseup leaves no rectangle (not undefined ranges)
  test(`a brush whose corners a search hid reports nothing`, async () => {
    const brush_handler = vi.fn()
    mount_matrix({
      values: numbered_values,
      enable_brush: true,
      on_brush: brush_handler,
      show_controls: true,
      controls_open: true,
    })
    cell_at(1, 0).dispatchEvent(mouse(`mousedown`))
    await form_controls().set_value(`Search`, `Z`) // hides every column and the brushed row
    window.dispatchEvent(new MouseEvent(`mouseup`))
    expect(brush_handler).not.toHaveBeenCalled()
  })

  test(`selected outline color token contrasts with dark cell backgrounds`, () => {
    mount_matrix({ x: [`A`], y: [`X`], selection_mode: `single`, values: [[`#000000`]] })
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
    mount_matrix({ tooltip_mode: `both`, values: [[`#000000`, null, `rgba(0, 0, 255, 0.5)`]] })
    await Promise.resolve()
    const [first_cell, missing_cell, translucent_cell] = get_data_cells()
    // the tooltip wears the hovered cell's fill (translucent ones flattened) with contrasting
    // text; a fill-less cell gets the neutral chip
    for (const [cell, fill] of [
      [first_cell, `#000000`],
      [missing_cell, null],
      [translucent_cell, `rgba(0, 0, 255, 0.5)`],
    ] as const) {
      cell.dispatchEvent(mouse(`mouseover`, { clientX: 10, clientY: 10 }))
      await tick()
      const tooltip_el = doc_query(`.plot-tooltip`)
      if (fill) expect_tooltip_paint(tooltip_el, fill)
      else expect(tooltip_el.textContent?.trim()).toMatch(/ - /)
    }
    first_cell.dispatchEvent(mouse(`mouseout`))
    await tick()
    expect(document.querySelector(`.plot-tooltip`)).toBeNull()
  })

  // The tooltip hangs below the hovered cell (anchored at its center, 4px past its bottom),
  // flipping above it where the viewport has no room below; it never covers the cell
  test(`tooltip sits below the hovered cell and flips above at the viewport bottom`, async () => {
    vi.stubGlobal(`innerWidth`, 300)
    vi.stubGlobal(`innerHeight`, 300)
    onTestFinished(() => void vi.unstubAllGlobals())
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(20)
    mount_matrix({ x: [`A`, `Longer label`], y: [`X`], values: [[1, 2]] })
    await Promise.resolve()
    const [top_cell, bottom_cell] = get_data_cells()
    top_cell.getBoundingClientRect = () => new DOMRect(40, 10, 20, 20)
    bottom_cell.getBoundingClientRect = () => new DOMRect(40, 270, 20, 20)
    for (const [cell, text, top] of [
      [top_cell, `A - X: 1`, `34px`], // 10 + 20 + 4
      [bottom_cell, `Longer label - X: 2`, `246px`], // 270 - 4 - 20
    ] as const) {
      cell.dispatchEvent(mouse(`mouseover`, { clientX: 50, clientY: 20 }))
      await tick()
      const tooltip_el = doc_query(`.plot-tooltip`)
      expect(tooltip_el.textContent?.trim()).toBe(text)
      expect([tooltip_el.style.left, tooltip_el.style.top]).toEqual([`50px`, top])
    }
  })

  // tooltip, color bar and controls toggle default on like the charts; false/null opt out
  test.each([
    [{}, true],
    [{ tooltip: false, color_bar: null, show_controls: false }, false],
  ] as const)(`%o shows tooltip, color bar and controls: %s`, async (props, shown) => {
    mount_matrix({ values: numbered_values, ...props })
    await tick()
    // the tooltip mounts on hover
    get_data_cells()[0]?.dispatchEvent(mouse(`mouseover`, { clientX: 10, clientY: 10 }))
    await tick()
    for (const sel of [
      `.plot-tooltip`,
      `.colorbar`,
      `button.heatmap-matrix-controls-toggle`,
    ]) {
      expect(document.querySelector(sel) !== null, sel).toBe(shown)
    }
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

  test.each([
    [`default format`, [1.2345, 0.001], true],
    [`custom format`, [Math.PI], `.1f`],
    [`null produces no span`, [null, 1], true],
  ] as const)(`%s`, (_description, row, show_values) => {
    const x_labels = [`A`, `B`].slice(0, row.length)
    mount_matrix({ x: x_labels, y: [`X`], values: [[...row]], show_values })
    expect(query_all(`.cell-value`).map((span) => span.textContent)).toEqual(
      row
        .filter((value) => value !== null)
        .map((value) => format_num(value, show_values === true ? `.3~g` : show_values)),
    )
  })

  test(`contrasts translucent cell colors against the matrix background`, async () => {
    mount_single_value(1, {
      show_values: true,
      color_overrides: { X: { A: `rgba(255, 255, 255, 0.1)` } },
      backdrop: `black`,
      style: `background: black`,
    })
    await tick()
    expect(doc_query(`.cell`).style.color).toBe(`white`)
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
})

describe(`axis titles`, () => {
  test.each([
    [`x`, `Columns`],
    [`y`, `Rows`],
  ])(`%s_axis.label renders its title`, (axis, label) => {
    mount_matrix({ [`${axis}_axis`]: { label } })
    expect(doc_query(`.${axis}-title`).textContent).toBe(label)
    if (axis === `y`) expect(doc_query(`.heatmap`).style.paddingLeft).toBe(`1.8em`)
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
      vi.spyOn(HTMLElement.prototype, prop, `get`).mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.dataset?.[axis] === undefined ? 0 : Number(this.dataset[axis]) * STRIDE
      })
    }
  }

  const mount_virtual = (extra: Partial<ComponentProps<typeof HeatmapMatrix>> = {}) => {
    stub_cell_layout()
    mount_matrix({
      x: labels,
      y: labels,
      values: labels.map((_unused_param_u, row) =>
        labels.map((_unused_value, col) => row + col),
      ),
      virtual: true,
      tile_size: `${STRIDE}px`,
      ...extra,
    })
  }
  // Unmeasured (happy-dom has no layout), a window holds its overscan or min_window tracks
  const side = Math.sqrt(VIRTUAL_CELL_THRESHOLD)
  test.each([
    [`unset at the threshold renders every cell`, side, undefined, side ** 2],
    [`unset past the threshold windows`, side + 1, undefined, 3 ** 2],
    [`false never windows`, side + 1, false, (side + 1) ** 2],
    [`an object tunes the window`, 10, { overscan: 1, min_window: 5 }, 5 ** 2],
  ] as const)(`virtual %s`, (_desc, n_items, virtual, n_cells) => {
    const items = Array.from({ length: n_items }, (_unused, idx) => `I${idx}`)
    mount_matrix({ x: items, y: items, values: items.map(() => items.map(() => 1)), virtual })
    expect(query_all(`.cell[data-x]`)).toHaveLength(n_cells)
  })

  test.each([`auto`, `robust`] as const)(
    `%s with explicit bounds only reads and colors rendered cells`,
    async (domain_mode) => {
      const scheme = vi.fn(red_scale)
      const values = labels.map(() => labels.map(() => 1))
      const offscreen_value = vi.fn(() => 1)
      Object.defineProperty(values[29], 29, { get: offscreen_value })
      mount_virtual({ values, color_scale: { scheme, value_range: [0, 60] }, domain_mode })
      await tick()
      expect(offscreen_value).not.toHaveBeenCalled()
      expect(query_all(`.cell[data-x]`).length).toBeLessThan(100)
      expect(scheme.mock.calls.length).toBeLessThan(200)
      expect(scheme.mock.calls.length).toBeGreaterThan(0)
    },
  )

  const rendered_idxs = (axis: `x` | `y`): number[] =>
    [
      ...new Set(query_all(`.cell[data-x]`).map((cell) => Number(cell.dataset[axis]))),
    ].toSorted((left, right) => left - right)

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
  [`no export pane, no shortcut`, { key: `e` }, `never`, 0],
])(`%s`, async (_name, init, target_tag, calls) => {
  const on_export = vi.fn()
  mount_matrix({
    on_export,
    export_formats: [`csv`],
    values: numbered_values,
    show_controls: target_tag === `never` ? false : `hover`,
  })
  await tick()
  const grid = doc_query(`.grid`)
  const input = document.createElement(`input`)
  if (target_tag) grid.append(input)
  const target = target_tag === `input` ? input : grid
  target.dispatchEvent(new KeyboardEvent(`keydown`, { ...init, bubbles: true }))
  await tick()
  await vi.waitFor(() => expect(on_export).toHaveBeenCalledTimes(calls))
  if (calls) expect(on_export.mock.calls[0][0]).toBe(`csv`)
})

// The export pane sits in the header chrome: CSV/JSON hold the visible matrix as tidy rows,
// SVG redraws the HTML grid (cells as rects, labels as text)
const svg_texts = (data: string) =>
  [...new DOMParser().parseFromString(data, `image/svg+xml`).querySelectorAll(`text`)].map(
    (text) => text.textContent,
  )
test.each([
  [`csv`, (data: string) => data.split(`\n`)[1], `X,1,2,3`],
  [`json`, (data: string) => JSON.parse(data)[2], { y_key: `Z`, A: 7, B: 8, C: 9 }],
  // every cell and label lands in the drawing (all mocked to one 40x20 box here)
  [`svg`, svg_texts, expect.arrayContaining([`A`, `X`, `1`, `9`])],
] as const)(
  `%s export hands the serialized matrix to on_export`,
  async (format, pick, expected) => {
    const on_export = vi.fn()
    vi.spyOn(Element.prototype, `getBoundingClientRect`).mockReturnValue(
      DOMRect.fromRect({ width: 40, height: 20 }),
    )
    vi.spyOn(Range.prototype, `getBoundingClientRect`).mockReturnValue(
      DOMRect.fromRect({ width: 8, height: 12 }),
    )
    const props = { show_controls: `hover`, show_values: true, on_export } as const
    mount_matrix({ values: numbered_values, ...props })
    await tick()
    const result = await export_via_pane(on_export, format.toUpperCase())
    expect(result.offered).toEqual([`PNG`, `SVG`, `CSV`, `JSON`])
    expect([result.format, result.filename]).toEqual([format, `heatmap`])
    expect(pick(String(result.data))).toEqual(expected)
  },
)

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
