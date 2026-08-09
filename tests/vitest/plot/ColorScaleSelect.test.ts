import { ColorScaleSelect } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'

describe(`ColorScaleSelect`, () => {
  test(`binds value and selected correctly (initial state)`, () => {
    mount(ColorScaleSelect, {
      target: document.body,
      props: {
        value: `interpolateViridis`,
        selected: [`interpolateViridis`],
      },
    })

    expect(doc_query(`.selected`).textContent?.trim()).toBe(`Viridis`)
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

  // MultiSelect keeps its option list mounted while closed, so a gradient per scheme would
  // otherwise be built on every mount — including in control panels never opened.
  test(`builds option gradients only once the dropdown opens`, async () => {
    const options: D3InterpolateName[] = [
      `interpolateViridis`,
      `interpolatePlasma`,
      `interpolateInferno`,
    ]
    mount(ColorScaleSelect, {
      target: document.body,
      props: { options, value: options[0], selected: [options[0]] },
    })
    flushSync()
    const gradient_count = () => document.body.querySelectorAll(`.colorbar`).length

    expect(gradient_count()).toBe(1) // just the selected chip
    doc_query(`.multiselect`).dispatchEvent(new MouseEvent(`mouseup`, { bubbles: true }))
    // the chip plus one per unselected option (MultiSelect drops the selected one from the list)
    await vi.waitFor(() => expect(gradient_count()).toBe(options.length))
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

    doc_query(`.multiselect`).dispatchEvent(new MouseEvent(`mousedown`))
    await vi.waitFor(() => document.body.querySelector(`.options`))

    const color_bar_wrapper = doc_query(`.colorbar`)
    expect(color_bar_wrapper.getAttribute(`style`)).toContain(
      custom_color_bar_props.wrapper_style,
    )
    expect(color_bar_wrapper.style.flexDirection).toBe(`row-reverse`)
  })
})
