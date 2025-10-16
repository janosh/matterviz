import { ColorScaleSelect } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`ColorScaleSelect`, () => {
  test(`renders with custom options array`, () => {
    const custom_options: D3InterpolateName[] = [
      `interpolateBlues`,
      `interpolateGreens`,
      `interpolateReds`,
    ]
    mount(ColorScaleSelect, {
      target: document.body,
      props: { options: custom_options },
    })

    const select_wrapper = doc_query(`div`)
    expect(select_wrapper).toBeTruthy()
  })

  test(`binds value and selected correctly (initial state)`, () => {
    // Tests if initial value and selected props are rendered correctly.
    const selected_value: D3InterpolateName = `interpolateViridis`
    const selected_array: D3InterpolateName[] = [`interpolateViridis`]

    // Initial mount
    mount(ColorScaleSelect, {
      target: document.body,
      props: {
        value: selected_value,
        selected: selected_array,
      },
    })

    // Check initial state rendered by svelte-multiselect
    const initial_selection = doc_query(`.selected`)
    expect(initial_selection?.textContent?.trim()).toBe(`Viridis`)
  })

  test(`passes colorbar props to ColorBar snippet`, async () => {
    // Verifies that props passed via the colorbar prop are applied to the ColorBar component.
    const custom_colorbar_props = {
      tick_align: `secondary` as const,
      title_side: `right` as const,
      wrapper_style: `border: 1px dashed red;`,
    }

    mount(ColorScaleSelect, {
      target: document.body,
      props: {
        options: [`interpolateViridis`],
        colorbar: custom_colorbar_props,
        selected: [`interpolateViridis`],
      },
    })

    const multiselect_el = doc_query(`.multiselect`)
    if (multiselect_el) {
      multiselect_el.dispatchEvent(new MouseEvent(`mousedown`))
      await vi.waitFor(() => document.body.querySelector(`.options`))
    }

    const color_bar_wrapper = doc_query(`.colorbar`)
    expect(color_bar_wrapper).toBeTruthy()
    // Check wrapper style
    expect(color_bar_wrapper.getAttribute(`style`)).toContain(
      custom_colorbar_props.wrapper_style,
    )

    // Check flex direction based on title_side
    expect(color_bar_wrapper.style.flexDirection).toBe(`row-reverse`)

    // Check for the existence of the inner bar div, but not its specific background style
    const color_bar_div = doc_query(`.colorbar > div.bar`)
    expect(color_bar_div).toBeTruthy()
  })
})
