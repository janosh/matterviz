import type { ElementAxisOrderingKey } from '#lib/heatmap-matrix/index.js'
import * as heatmap from '#lib/heatmap-matrix/index.js'
import * as file_io from 'svelte-widgets/download'
import { ELEMENT_ORDERINGS, ORDERING_LABELS } from '#lib/heatmap-matrix/index.js'
import HeatmapMatrixControls from '#lib/heatmap-matrix/HeatmapMatrixControls.svelte'
import { mount, tick, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  bind_props,
  click_export,
  doc_query,
  expect_labelled_settings_grid,
  fire,
  query,
  set_input,
  set_select,
} from '../setup'
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

const toggle_sel = `button.heatmap-matrix-controls-toggle`
// first pane select offering an option with this value
const select_with = (value: string) =>
  [...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`)].find(
    (select) => select.querySelector(`option[value="${value}"]`),
  )

describe(`HeatmapMatrixControls`, () => {
  test.each([true, `.2f`])(
    `preserves the value format through repeated toggles: %s`,
    async (show_values) => {
      const state = { show_values }
      mount(HeatmapMatrixControls, {
        target: document.body,
        props: bind_props({ controls_open: true }, state),
      })
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
    // open both demos' panes (their settings mount on first open); every other heatmap on
    // the page has its own hover toggle too
    const demo_toggles = `.heatmap-controls-anchor ${toggle_sel}`
    await vi.waitFor(() => expect(document.querySelectorAll(demo_toggles)).toHaveLength(2))
    for (const toggle of document.querySelectorAll<HTMLElement>(demo_toggles))
      await fire(toggle)
    const orderings = await vi.waitFor(() => {
      const selects = [
        ...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`),
      ].filter((select) => select.querySelector(`option[value="atomic_number"]`))
      expect(selects).toHaveLength(2)
      return selects
    })
    const matrices = document.querySelectorAll(`.heatmap-controls-anchor .heatmap`)
    // rendered order (DOM order is stable across reorders)
    const labels = (idx: number) =>
      [...matrices[idx].querySelectorAll<HTMLElement>(`.x-label`)]
        .toSorted(
          (lbl_a, lbl_b) => Number(lbl_a.style.gridColumn) - Number(lbl_b.style.gridColumn),
        )
        .map((label) => label.textContent)
    const initial_full = labels(0)
    const initial_subset = labels(1)
    expect(initial_full.length).toBeGreaterThan(0)
    set_select(orderings[1], `atomic_mass`)
    await tick()
    const reordered_subset = labels(1)
    expect(reordered_subset).not.toEqual(initial_subset)
    expect(labels(0)).toEqual(initial_full)
    expect(orderings[0].value).toBe(`atomic_number`)
    set_select(orderings[0], `alphabetical`)
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
    // the color bar shows by default; its toggle hides only this heatmap's
    const color_bars = () =>
      [...matrices].map((matrix) => Boolean(matrix.querySelector(`.colorbar`)))
    expect(color_bars()).toEqual([true, true])
    query<HTMLInputElement>(setting(1, `Color bar`), `input`).click()
    await tick()
    expect(color_bars()).toEqual([true, false])
    for (const pane_idx of [1, 0]) {
      const unchanged = labels(1 - pane_idx)
      const search = query<HTMLInputElement>(setting(pane_idx, `Search`), `input`)
      set_input(search, `Co`)
      await tick()
      expect(labels(pane_idx)).toEqual([`Co`])
      expect(labels(1 - pane_idx)).toEqual(unchanged)
    }
    const download = vi.spyOn(file_io, `download`).mockImplementation(() => {})
    // the demo's on_export saves each file itself; the first heatmap's pane serves its matrix
    for (const format of [`CSV`, `JSON`]) {
      await click_export(format, matrices[0])
      await vi.waitFor(() =>
        expect(download.mock.calls).toHaveLength(format === `CSV` ? 1 : 2),
      )
    }
    expect(download.mock.calls).toEqual([
      [`y_key,Co\nCo,0`, `heatmap.csv`, `text/csv;charset=utf-8`],
      [JSON.stringify([{ y_key: `Co`, Co: 0 }], null, 2), `heatmap.json`, `application/json`],
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
      const toggle = doc_query(toggle_sel)
      const pane = doc_query(`.draggable-pane`)
      for (const class_name of [
        `heatmap-matrix-controls-toggle`,
        `custom-toggle`,
        `${show_controls ?? `hover`}-visible`,
      ])
        expect(toggle.classList.contains(class_name)).toBe(true)
      for (const class_name of [`heatmap-controls`, `custom-pane`])
        expect(pane.classList.contains(class_name)).toBe(true)
      // settings mount on first open, not before
      expect(pane.querySelector(`select`)).toBeNull()
      // pane-open also keeps the surrounding hover controls visible.
      for (const open of [false, true]) {
        expect(toggle.getAttribute(`aria-label`)).toBe(`Heatmap controls`)
        expect(toggle.getAttribute(`aria-expanded`)).toBe(String(open))
        expect(pane.classList.contains(`pane-open`)).toBe(open)
        await fire(toggle)
      }
      // and stay mounted once the pane closes again
      expect_labelled_settings_grid()
      const ordering_select = doc_query<HTMLSelectElement>(`.heatmap-controls select`)
      expect(
        [...ordering_select.options].map((option) => [option.value, option.textContent]),
      ).toEqual(ELEMENT_ORDERINGS.map((key) => [key, ORDERING_LABELS[key]]))
      expect(ordering_select.value).toBe(`atomic_number`)
    },
  )

  test(`show_controls=false hides toggle and pane`, () => {
    mount_controls({ show_controls: false })
    expect(document.querySelector(toggle_sel)).toBeNull()
    expect(document.querySelector(`.heatmap-controls`)).toBeNull()
  })

  // HeatmapMatrix's built-in pane never binds an element ordering, so no dead select there
  test(`omits the ordering select when no ordering is bound`, () => {
    mount_controls({ ordering: undefined })
    expect(select_with(`atomic_number`)).toBeUndefined()
  })

  test(`normalize and domain selects offer every mode and reflect the bound value`, async () => {
    mount_controls({
      controls_open: true,
      color_scale: { scheme: `interpolatePlasma`, type: `log` },
      domain_mode: `robust`,
      search_query: `Fe`,
    })
    await tick()
    const search = doc_query<HTMLInputElement>(`input[placeholder="Filter labels/keys"]`)
    expect(search.value).toBe(`Fe`)
    expect(search.getAttribute(`type`)).toBeNull() // styled by input:not([type])
    const normalize_select = select_with(`log`)
    const domain_select = select_with(`robust`)
    if (!normalize_select || !domain_select) throw new Error(`normalize/domain select missing`)
    expect([...normalize_select.options].map((opt) => opt.value)).toEqual([`linear`, `log`])
    expect(normalize_select.value).toBe(`log`)
    expect([...domain_select.options].map((opt) => opt.value)).toEqual([`auto`, `robust`])
    expect(domain_select.value).toBe(`robust`)
  })

  test(`color bar side select only visible while color_bar is not null`, async () => {
    mount_controls({ controls_open: true, color_bar: null })
    await tick()
    expect(select_with(`vertical`)).toBeUndefined()

    const color_bar_checkbox = doc_query<HTMLInputElement>(
      `.heatmap-controls input[type="checkbox"]`,
    )
    color_bar_checkbox.click()
    await tick()
    expect(select_with(`vertical`)?.labels?.[0]?.textContent).toContain(`Color bar side`)
  })
})
