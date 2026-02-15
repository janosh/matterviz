import type { ElementAxisOrderingKey } from '$lib/heatmap-matrix'
import { HeatmapMatrixControls, ORDERING_LABELS } from '$lib/heatmap-matrix'
import type { ComponentProps } from 'svelte'
import { mount, tick } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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

// Find the legend position select by its option values (right/bottom)
const find_position_select = () =>
  Array.from(document.querySelectorAll(`.heatmap-controls select`)).find(
    (sel) => (sel as HTMLSelectElement).querySelector(`option[value="right"]`),
  ) as HTMLSelectElement | undefined

describe(`HeatmapMatrixControls`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`renders toggle, ordering options, and pane with correct classes`, () => {
    mount_controls()
    // Toggle button present and initially hidden
    const toggle = get_toggle()
    expect(toggle).not.toBeNull()
    expect(toggle.style.cssText).toContain(`opacity: 0`)
    expect(toggle.style.cssText).toContain(`pointer-events: none`)
    // Pane div has heatmap-controls class
    expect(document.querySelector(`.draggable-pane.heatmap-controls`)).not.toBeNull()
    // Ordering select has all ordering options
    const ordering_select = document.querySelector(
      `.heatmap-controls select`,
    ) as HTMLSelectElement
    const option_values = Array.from(ordering_select.options).map((opt) => opt.value)
    expect(option_values).toHaveLength(Object.keys(ORDERING_LABELS).length)
    expect(option_values).toContain(`atomic_number`)
    expect(option_values).toContain(`mendeleev_number`)
  })

  test(`show_pane=false hides toggle and pane`, () => {
    mount_controls({ show_pane: false })
    expect(get_toggle()).toBeNull()
    expect(document.querySelector(`.heatmap-controls`)).toBeNull()
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

  test(`toggle title shows hint when closed, empty when open`, async () => {
    mount_controls({ controls_open: false })
    const toggle = get_toggle()
    expect(toggle.getAttribute(`title`)).toBe(`Heatmap controls`)
    toggle.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
    await tick()
    expect(toggle.getAttribute(`title`)).toBe(``)
  })

  test(`pane_props class is merged with heatmap-controls`, () => {
    mount_controls({ pane_props: { class: `custom-pane` } })
    const pane = document.querySelector(`.draggable-pane`) as HTMLElement
    expect(pane.classList.contains(`heatmap-controls`)).toBe(true)
    expect(pane.classList.contains(`custom-pane`)).toBe(true)
  })

  test(`search input reflects value and has no explicit type attr`, () => {
    mount_controls({ search_query: `Fe` })
    const search_input = document.querySelector(
      `.heatmap-controls input[placeholder="Filter labels/keys"]`,
    ) as HTMLInputElement
    expect(search_input.value).toBe(`Fe`)
    // No explicit type attr — needed for CSS input:not([type]) selector
    expect(search_input.getAttribute(`type`)).toBeNull()
  })

  test(`normalize and domain selects present with correct options`, () => {
    mount_controls({ normalize: `log`, domain_mode: `robust` })
    const selects = document.querySelectorAll(`.heatmap-controls select`)
    const all_options = Array.from(selects).flatMap((sel) =>
      Array.from((sel as HTMLSelectElement).options).map((opt) => opt.value)
    )
    // Normalize options
    expect(all_options).toContain(`linear`)
    expect(all_options).toContain(`log`)
    // Domain options
    expect(all_options).toContain(`auto`)
    expect(all_options).toContain(`robust`)
    expect(all_options).toContain(`fixed`)
  })

  test(`legend position select only visible when show_legend is true`, async () => {
    mount_controls({ controls_open: true, show_legend: false })
    await tick()
    expect(find_position_select()).toBeUndefined()

    // Enable show_legend by clicking the checkbox
    const legend_checkbox = document.querySelector(
      `.heatmap-controls input[type="checkbox"]`,
    ) as HTMLInputElement
    legend_checkbox.click()
    await tick()
    expect(find_position_select()).toBeDefined()
  })

  test(`export buttons render with text and fire handler with format`, () => {
    const export_handler = vi.fn()
    mount_controls({ onexport: export_handler, export_formats: [`csv`, `json`] })
    const buttons = Array.from(
      document.querySelectorAll(`.pane-row button`),
    ) as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    expect(buttons[0].textContent?.trim()).toBe(`Export CSV`)
    expect(buttons[1].textContent?.trim()).toBe(`Export JSON`)
    // Click each and verify correct format passed
    buttons[0].click()
    expect(export_handler).toHaveBeenLastCalledWith(`csv`)
    buttons[1].click()
    expect(export_handler).toHaveBeenLastCalledWith(`json`)
    expect(export_handler).toHaveBeenCalledTimes(2)
  })

  test(`labels use shortened text`, () => {
    mount_controls()
    const label_texts = Array.from(
      document.querySelectorAll(`.heatmap-controls label`),
    ).map((label) => label.childNodes[0]?.textContent?.trim())
    expect(label_texts).toContain(`Ordering`)
    expect(label_texts).toContain(`Search`)
    expect(label_texts).toContain(`Normalize`)
    expect(label_texts).toContain(`Domain`)
  })
})
