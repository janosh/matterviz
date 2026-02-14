import type { ElementAxisOrderingKey } from '$lib/heatmap-matrix'
import { HeatmapMatrixControls, ORDERING_LABELS } from '$lib/heatmap-matrix'
import { mount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

describe(`HeatmapMatrixControls`, () => {
  beforeEach(() => {
    document.body.innerHTML = ``
  })

  test(`renders draggable toggle and ordering options`, () => {
    mount(HeatmapMatrixControls, {
      target: document.body,
      props: {
        ordering: `atomic_number` satisfies ElementAxisOrderingKey,
      },
    })
    const toggle_button = document.querySelector(
      `button.heatmap-matrix-controls-toggle`,
    ) as HTMLButtonElement | null
    expect(toggle_button).not.toBeNull()
    const ordering_select = document.querySelector(
      `.heatmap-matrix-controls label:first-of-type select`,
    ) as HTMLSelectElement | null
    const option_values = Array.from(ordering_select?.options ?? []).map((opt) =>
      opt.value
    )
    expect(option_values).toHaveLength(Object.keys(ORDERING_LABELS).length)
    expect(option_values).toContain(`atomic_number`)
    expect(option_values).toContain(`mendeleev_number`)
    expect(toggle_button?.getAttribute(`style`)).toContain(`opacity: 0`)
    expect(toggle_button?.getAttribute(`style`)).toContain(`pointer-events: none`)
  })

  test(`show_pane=false hides toggle and pane`, () => {
    mount(HeatmapMatrixControls, {
      target: document.body,
      props: {
        ordering: `atomic_number` satisfies ElementAxisOrderingKey,
        show_pane: false,
      },
    })
    expect(document.querySelector(`button.heatmap-matrix-controls-toggle`)).toBeNull()
    expect(document.querySelector(`.heatmap-matrix-controls`)).toBeNull()
  })

  test(`toggle_props class is merged with required heatmap class`, () => {
    mount(HeatmapMatrixControls, {
      target: document.body,
      props: {
        ordering: `atomic_number` satisfies ElementAxisOrderingKey,
        toggle_props: { class: `custom-toggle-class` },
      },
    })
    const toggle_button = document.querySelector(
      `button.heatmap-matrix-controls-toggle`,
    ) as HTMLButtonElement | null
    expect(toggle_button?.classList.contains(`heatmap-matrix-controls-toggle`)).toBe(true)
    expect(toggle_button?.classList.contains(`custom-toggle-class`)).toBe(true)
  })

  test(`toggle_visible=true shows toggle via inline styles`, () => {
    mount(HeatmapMatrixControls, {
      target: document.body,
      props: {
        ordering: `atomic_number` satisfies ElementAxisOrderingKey,
        toggle_visible: true,
      },
    })
    const toggle_button = document.querySelector(
      `button.heatmap-matrix-controls-toggle`,
    ) as HTMLButtonElement | null
    expect(toggle_button?.getAttribute(`style`)).toContain(`opacity: 1`)
    expect(toggle_button?.getAttribute(`style`)).toContain(`pointer-events: auto`)
  })

  test(`renders foundation controls and export actions`, () => {
    const export_handler = vi.fn()
    mount(HeatmapMatrixControls, {
      target: document.body,
      props: {
        ordering: `atomic_number` satisfies ElementAxisOrderingKey,
        show_legend: true,
        normalize: `log`,
        domain_mode: `robust`,
        search_query: `Fe`,
        onexport: export_handler,
      },
    })
    const search_input = document.querySelector(
      `.heatmap-matrix-controls input[placeholder="Filter labels/keys"]`,
    ) as HTMLInputElement | null
    expect(search_input?.value).toBe(`Fe`)
    const normalize_select = Array.from(
      document.querySelectorAll(`.heatmap-matrix-controls select`),
    ).find((select_el) =>
      Array.from((select_el as HTMLSelectElement).options).some((opt) =>
        opt.value === `log`
      )
    ) as HTMLSelectElement | undefined
    expect(normalize_select).toBeDefined()
    const export_buttons = document.querySelectorAll(`.exports button`)
    expect(export_buttons.length).toBeGreaterThan(0)
    ;(export_buttons[0] as HTMLButtonElement).click()
    expect(export_handler).toHaveBeenCalledOnce()
  })
})
