import type { ElementAxisOrderingKey } from '$lib/heatmap-matrix'
import { ELEMENT_ORDERINGS, HeatmapMatrixControls, ORDERING_LABELS } from '$lib/heatmap-matrix'
import { mount, tick, type ComponentProps } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, expect_labelled_settings_grid } from '../setup'

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
  test(`renders toggle, ordering options, and pane with correct classes`, () => {
    mount_controls()
    const toggle = get_toggle()
    expect(toggle).not.toBeNull()
    expect(toggle.style.cssText).toContain(`opacity: 0`)
    expect(toggle.style.cssText).toContain(`pointer-events: none`)
    expect(doc_query(`.draggable-pane.heatmap-controls`)).toBeInstanceOf(HTMLElement)
    expect_labelled_settings_grid()
    // one option per ordering, in ELEMENT_ORDERINGS order, labelled and bound to the prop
    const ordering_select = doc_query<HTMLSelectElement>(`.heatmap-controls select`)
    const options = Array.from(ordering_select.options)
    expect(options.map((opt) => opt.value)).toEqual(ELEMENT_ORDERINGS)
    expect(options.map((opt) => opt.textContent)).toEqual(
      ELEMENT_ORDERINGS.map((key) => ORDERING_LABELS[key]),
    )
    expect(ordering_select.value).toBe(`atomic_number`)
  })

  test(`show_pane=false hides toggle and pane`, () => {
    mount_controls({ show_pane: false })
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

  test(`toggle_props class is merged with required heatmap class`, () => {
    mount_controls({ toggle_props: { class: `custom-toggle-class` } })
    const toggle = get_toggle()
    expect(toggle.classList.contains(`heatmap-matrix-controls-toggle`)).toBe(true)
    expect(toggle.classList.contains(`custom-toggle-class`)).toBe(true)
  })

  test(`toggle_visible=true shows toggle via inline styles`, () => {
    mount_controls({ toggle_visible: true })
    const toggle = get_toggle()
    expect(toggle.style.cssText).toContain(`opacity: 1`)
    expect(toggle.style.cssText).toContain(`pointer-events: auto`)
  })

  // CSS elsewhere keys off pane-open (e.g. hover-visible control bars stay visible)
  test(`toggle exposes its label and flips the pane-open state`, async () => {
    mount_controls({ controls_open: false })
    const toggle = get_toggle()
    const pane = doc_query(`.draggable-pane`)
    expect(toggle.getAttribute(`aria-label`)).toBe(`Heatmap controls`)
    expect(toggle.getAttribute(`aria-expanded`)).toBe(`false`)
    expect(pane.classList.contains(`pane-open`)).toBe(false)
    toggle.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(toggle.getAttribute(`aria-label`)).toBe(`Heatmap controls`)
    expect(toggle.getAttribute(`aria-expanded`)).toBe(`true`)
    expect(pane.classList.contains(`pane-open`)).toBe(true)
  })

  test(`pane_props class is merged with heatmap-controls`, () => {
    mount_controls({ pane_props: { class: `custom-pane` } })
    const pane = doc_query(`.draggable-pane`)
    expect(pane.classList.contains(`heatmap-controls`)).toBe(true)
    expect(pane.classList.contains(`custom-pane`)).toBe(true)
  })

  test(`search input reflects value and has no explicit type attr`, () => {
    mount_controls({ search_query: `Fe` })
    const search_input = doc_query<HTMLInputElement>(
      `.heatmap-controls input[placeholder="Filter labels/keys"]`,
    )
    expect(search_input.value).toBe(`Fe`)
    // No explicit type attr — needed for CSS input:not([type]) selector
    expect(search_input.getAttribute(`type`)).toBeNull()
  })

  test(`normalize and domain selects offer every mode and reflect the bound value`, async () => {
    mount_controls({ normalize: `log`, domain_mode: `robust` })
    await tick()
    const selects = [
      ...document.querySelectorAll<HTMLSelectElement>(`.heatmap-controls select`),
    ]
    const select_with = (value: string) =>
      selects.find((select) => select.querySelector(`option[value="${value}"]`))
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
  })

  test(`export buttons render with text and fire handler with format`, () => {
    const export_handler = vi.fn()
    mount_controls({ on_export: export_handler, export_formats: [`csv`, `json`] })
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.pane-row button`),
    )
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent?.trim()).toBe(`Export CSV`)
    expect(buttons[1].textContent?.trim()).toBe(`Export JSON`)
    buttons[0].click()
    expect(export_handler).toHaveBeenLastCalledWith(`csv`)
    buttons[1].click()
    expect(export_handler).toHaveBeenLastCalledWith(`json`)
    expect(export_handler).toHaveBeenCalledTimes(2)
  })
})
