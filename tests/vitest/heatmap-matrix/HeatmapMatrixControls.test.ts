import type { ElementAxisOrderingKey } from '$lib/heatmap-matrix'
import { HeatmapMatrixControls, ORDERING_LABELS } from '$lib/heatmap-matrix'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`HeatmapMatrixControls`, () => {
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
    const option_values = Array.from(
      document.querySelectorAll(`.heatmap-matrix-controls option`),
    ).map((opt) => (opt as HTMLOptionElement).value)
    expect(option_values).toHaveLength(Object.keys(ORDERING_LABELS).length)
    expect(option_values).toContain(`atomic_number`)
    expect(option_values).toContain(`mendeleev_number`)
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
})
