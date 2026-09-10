import type { ElementAxisOrderingKey } from '$lib/heatmap-matrix'
import * as heatmap from '$lib/heatmap-matrix'
import * as file_io from '$lib/io/fetch'
import { ELEMENT_ORDERINGS, HeatmapMatrixControls, ORDERING_LABELS } from '$lib/heatmap-matrix'
import { mount, tick, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, expect_labelled_settings_grid, fire, query } from '../setup'
import HeatmapDemo from '../../../src/routes/(demos)/plot/heatmap-matrix/+page.svelte'

const mount_controls = (
  props: Partial<ComponentProps<typeof HeatmapMatrixControls>> = {},
): void => {
  mount(HeatmapMatrixControls, {
    target: document.body,
    props: {
      ordering: `atomic_number` satisfies ElementAxisOrderingKey,
      ...props,
    },
  })
}

const get_toggle = () =>
  document.querySelector(`button.heatmap-matrix-controls-toggle`) as HTMLButtonElement

// Find the color bar position select by its option values (right/bottom)
const find_position_select = () =>
  [...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`)].find(
    (select) => select.querySelector(`option[value="right"]`),
  )

describe(`HeatmapMatrixControls`, () => {
  test.each([true, `.2f`])(
    `preserves the value format through repeated toggles: %s`,
    async (show_values) => {
      const state = { show_values }
      mount(HeatmapMatrixControls, { target: document.body, props: bind_props({}, state) })
      const values_label = [...document.querySelectorAll(`.heatmap-controls label`)].find(
        (label) => label.textContent?.trim() === `Values`,
      )
      if (!values_label) throw new Error(`Missing Values control`)
      const checkbox = query<HTMLInputElement>(values_label, `input`)
      for (const expected of [false, show_values, false, show_values]) {
        checkbox.click()
        await tick()
        expect(state.show_values).toBe(expected)
      }
    },
  )

  test(`demo controls update only their own heatmap`, async () => {
    // A small full-matrix sample exercises the bindings without mounting 10,000 cells.
    const elements_to_axis = heatmap.elements_to_axis
    vi.spyOn(heatmap, `elements_to_axis`).mockImplementation((symbols, ordering) =>
      elements_to_axis(symbols ?? [`H`, `Li`, `Be`, `Co`, `Ni`, `Cu`], ordering),
    )
    mount(HeatmapDemo, { target: document.body })
    await tick()
    const matrices = document.querySelectorAll(`.heatmap-controls-anchor .heatmap`)
    const orderings = [
      ...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`),
    ].filter((select) => select.querySelector(`option[value="atomic_number"]`))
    expect(orderings).toHaveLength(2)
    // Svelte reads :checked on options, which happy-dom doesn't match.
    for (const select of orderings) {
      vi.spyOn(select, `querySelector`).mockImplementation(() => select.selectedOptions[0])
    }
    const labels = (idx: number) =>
      [...matrices[idx].querySelectorAll(`.x-label`)].map((label) => label.textContent)
    const initial_full = labels(0)
    const initial_subset = labels(1)
    expect(initial_full.length).toBeGreaterThan(0)
    orderings[1].value = `atomic_mass`
    orderings[1].dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    const reordered_subset = labels(1)
    expect(reordered_subset).not.toEqual(initial_subset)
    expect(labels(0)).toEqual(initial_full)
    expect(orderings[0].value).toBe(`atomic_number`)
    orderings[0].value = `alphabetical`
    orderings[0].dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
    expect(labels(0)).not.toEqual(initial_full)
    expect(labels(1)).toEqual(reordered_subset)

    const panes = document.querySelectorAll(`.heatmap-controls`)
    for (const pane of panes) {
      // Caller-provided ordering/hide-empty rows must share the built-in settings grid.
      expect(pane.querySelectorAll(`.settings-section.grid > label`)).toHaveLength(
        pane.querySelectorAll(`label`).length,
      )
    }
    const setting = (pane_idx: number, name: string) => {
      const control_label = [...panes[pane_idx].querySelectorAll(`label`)].find(
        (label) => label.querySelector(`span`)?.textContent === name,
      )
      if (!control_label) throw new Error(`Missing ${name} control in pane ${pane_idx}`)
      return control_label
    }
    // These controls previously changed unconnected state in a separate panel.
    for (const [name, selector] of [
      [`Values`, `.cell-value`],
      [`Row sums`, `.summary-row`],
      [`Col sums`, `.summary-col`],
    ]) {
      query<HTMLInputElement>(setting(0, name), `input`).click()
      await tick()
      expect(matrices[0].querySelector(selector)).not.toBeNull()
      expect(matrices[1].querySelector(selector)).toBeNull()
    }
    query<HTMLInputElement>(setting(1, `Color bar`), `input`).click()
    await tick()
    expect(matrices[1].querySelector(`.colorbar`)).not.toBeNull()
    for (const pane_idx of [1, 0]) {
      const unchanged = labels(1 - pane_idx)
      const search = query<HTMLInputElement>(setting(pane_idx, `Search`), `input`)
      search.value = `Co`
      search.dispatchEvent(new Event(`input`, { bubbles: true }))
      await tick()
      expect(labels(pane_idx)).toEqual([`Co`])
      expect(labels(1 - pane_idx)).toEqual(unchanged)
    }
    const download = vi.spyOn(file_io, `download`).mockImplementation(() => {})
    for (const button of panes[0].querySelectorAll<HTMLButtonElement>(`.pane-row button`)) {
      button.click()
    }
    expect(download.mock.calls).toEqual([
      [`y_key,Co\nCo,0`, `electronegativity-difference.csv`, `text/csv;charset=utf-8`],
      [
        JSON.stringify([{ y_key: `Co`, Co: 0 }], null, 2),
        `electronegativity-difference.json`,
        `application/json`,
      ],
    ])
  })

  test.each([undefined, `always`] as const)(
    `renders labelled controls, forwards classes and toggles the pane (mode=%s)`,
    async (show_controls) => {
      mount_controls({
        show_controls,
        controls_open: false,
        toggle_props: { class: `custom-toggle` },
        pane_props: { class: `custom-pane` },
      })
      const toggle = get_toggle()
      const pane = doc_query(`.draggable-pane`)
      for (const class_name of [
        `heatmap-matrix-controls-toggle`,
        `custom-toggle`,
        `${show_controls ?? `hover`}-visible`,
      ])
        expect(toggle.classList.contains(class_name)).toBe(true)
      for (const class_name of [`heatmap-controls`, `custom-pane`])
        expect(pane.classList.contains(class_name)).toBe(true)
      expect_labelled_settings_grid()
      const ordering_select = doc_query<HTMLSelectElement>(`.heatmap-controls select`)
      expect(
        [...ordering_select.options].map((option) => [option.value, option.textContent]),
      ).toEqual(ELEMENT_ORDERINGS.map((key) => [key, ORDERING_LABELS[key]]))
      expect(ordering_select.value).toBe(`atomic_number`)
      // pane-open also keeps the surrounding hover controls visible.
      for (const open of [false, true]) {
        expect(toggle.getAttribute(`aria-label`)).toBe(`Heatmap controls`)
        expect(toggle.getAttribute(`aria-expanded`)).toBe(String(open))
        expect(pane.classList.contains(`pane-open`)).toBe(open)
        await fire(toggle)
      }
    },
  )

  test(`show_controls=false hides toggle and pane`, () => {
    mount_controls({ show_controls: false })
    expect(get_toggle()).toBeNull()
    expect(document.querySelector(`.heatmap-controls`)).toBeNull()
  })

  // HeatmapMatrix's built-in pane never binds an element ordering, so no dead select there
  test(`omits the ordering select when no ordering is bound`, () => {
    mount_controls({ ordering: undefined })
    const selects = [
      ...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`),
    ]
    expect(
      selects.some((select) => select.querySelector(`option[value="atomic_number"]`)),
    ).toBe(false)
  })

  test(`normalize and domain selects offer every mode and reflect the bound value`, async () => {
    mount_controls({ normalize: `log`, domain_mode: `robust`, search_query: `Fe` })
    await tick()
    const selects = [
      ...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`),
    ]
    const select_with = (value: string) =>
      selects.find((select) => select.querySelector(`option[value="${value}"]`))
    const search = doc_query<HTMLInputElement>(`input[placeholder="Filter labels/keys"]`)
    expect(search.value).toBe(`Fe`)
    expect(search.getAttribute(`type`)).toBeNull() // styled by input:not([type])
    const normalize_select = select_with(`log`)
    const domain_select = select_with(`robust`)
    if (!normalize_select || !domain_select) throw new Error(`normalize/domain select missing`)
    expect([...normalize_select.options].map((opt) => opt.value)).toEqual([`linear`, `log`])
    expect(normalize_select.value).toBe(`log`)
    expect([...domain_select.options].map((opt) => opt.value)).toEqual([
      `auto`,
      `robust`,
      `fixed`,
    ])
    expect(domain_select.value).toBe(`robust`)
  })

  test(`color bar position select only visible when show_color_bar is true`, async () => {
    mount_controls({ controls_open: true, show_color_bar: false })
    await tick()
    expect(find_position_select()).toBeUndefined()

    const color_bar_checkbox = doc_query<HTMLInputElement>(
      `.heatmap-controls input[type="checkbox"]`,
    )
    color_bar_checkbox.click()
    await tick()
    expect(find_position_select()).toBeDefined()
    expect(find_position_select()?.labels?.[0]?.textContent).toContain(`Color bar side`)
  })

  test.each([undefined, [], [`csv`, `json`]] as const)(
    `export controls require a handler and formats: %j`,
    (formats) => {
      const export_handler = vi.fn()
      mount_controls({
        on_export: formats ? export_handler : undefined,
        export_formats: formats ? [...formats] : undefined,
      })
      const buttons = Array.from(
        document.querySelectorAll<HTMLButtonElement>(`.pane-row button`),
      )
      expect(buttons).toHaveLength(formats?.length ?? 0)
      if (!formats?.length) {
        expect(document.querySelector(`.heatmap-controls .pane-row`)).toBeNull()
        return
      }
      for (const [idx, format] of formats.entries()) {
        expect(buttons[idx].textContent?.trim()).toBe(`Export ${format.toUpperCase()}`)
        buttons[idx].click()
        expect(export_handler).toHaveBeenLastCalledWith(format)
      }
      expect(export_handler).toHaveBeenCalledTimes(2)
    },
  )
})
