import { ColorScaleSelect } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'

describe(`ColorScaleSelect`, () => {
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

    // Check initial state rendered by svelte-widgets
    const initial_selection = doc_query(`.selected`)
    expect(initial_selection?.textContent?.trim()).toBe(`Viridis`)
  })

  // Binding `selected` alongside `value` is optional, so mounting must not treat an unbound
  // `selected` as "nothing is selected" and write that emptiness back over the caller's value.
  test(`keeps a bound value when only value is bound`, () => {
    const controls_state = { value: `interpolateViridis` as D3InterpolateName }
    mount(ColorScaleSelect, {
      target: document.body,
      props: bind_props({}, controls_state),
    })
    flushSync()

    expect(controls_state.value).toBe(`interpolateViridis`)
    expect(doc_query(`.selected`)?.textContent?.trim()).toBe(`Viridis`)
  })

  test(`passes color_bar props to ColorBar snippet`, async () => {
    // Verifies that props passed via the color_bar prop are applied to the ColorBar component.
    const custom_color_bar_props = {
      tick_align: `secondary` as const,
      title_side: `right` as const,
      wrapper_style: `border: 1px dashed red;`,
    }

    mount(ColorScaleSelect, {
      target: document.body,
      props: {
        options: [`interpolateViridis`],
        color_bar: custom_color_bar_props,
        selected: [`interpolateViridis`],
      },
    })

    const multiselect_el = doc_query(`.multiselect`)
    if (multiselect_el) {
      multiselect_el.dispatchEvent(new MouseEvent(`mousedown`))
      await vi.waitFor(() => document.body.querySelector(`.options`))
    }

    const color_bar_wrapper = doc_query(`.colorbar`)
    expect(color_bar_wrapper).toBeInstanceOf(HTMLElement)
    // Check wrapper style
    expect(color_bar_wrapper.getAttribute(`style`)).toContain(
      custom_color_bar_props.wrapper_style,
    )

    // Check flex direction based on title_side
    expect(color_bar_wrapper.style.flexDirection).toBe(`row-reverse`)

    // Check for the existence of the inner bar div, but not its specific background style
    const color_bar_div = doc_query(`.colorbar > div.bar`)
    expect(color_bar_div).toBeInstanceOf(HTMLElement)
  })
})
