import { ColorScaleSelect } from '$lib'
import type { D3InterpolateName } from '$lib/colors'
import { flushSync, mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, fire } from '../setup'

describe(`ColorScaleSelect`, () => {
  test.each([
    [`14em`, undefined],
    [`0`, `min-width: 0`],
  ] as const)(`closed chip min-width is %s`, (min_width, style) => {
    mount(ColorScaleSelect, {
      target: document.body,
      props: {
        value: `interpolateViridis`,
        style,
      },
    })

    expect(doc_query(`.selected`).textContent?.trim()).toBe(`Viridis`)
    expect(doc_query(`.multiselect`).style.minWidth).toBe(min_width)
  })

  test(`keeps a scalar bound value on mount and selection, and reports additions`, async () => {
    const controls_state = { value: `interpolateViridis` as D3InterpolateName }
    const on_add = vi.fn()
    mount(ColorScaleSelect, {
      target: document.body,
      props: bind_props(
        {
          options: [`interpolateViridis`, `interpolatePlasma`] satisfies D3InterpolateName[],
          on_add,
        },
        controls_state,
      ),
    })
    flushSync()

    expect(controls_state.value).toBe(`interpolateViridis`)
    expect(doc_query(`.selected`)?.textContent?.trim()).toBe(`Viridis`)
    await fire(doc_query(`.multiselect`), new MouseEvent(`mouseup`, { bubbles: true }))
    await fire(doc_query(`[role="option"]`))
    expect(controls_state.value).toBe(`interpolatePlasma`)
    expect(on_add).toHaveBeenCalledExactlyOnceWith({
      option: `interpolatePlasma`,
      selected: [`interpolateViridis`],
    })
  })

  // MultiSelect keeps its option list mounted while closed, so a gradient per scheme would
  // otherwise be built on every mount — including in control panels never opened.
  test.each([false, true])(`lazily builds gradients with custom styles=%s`, async (custom) => {
    const options: D3InterpolateName[] = [
      `interpolateViridis`,
      `interpolatePlasma`,
      `interpolateInferno`,
    ]
    mount(ColorScaleSelect, {
      target: document.body,
      props: {
        options,
        value: options[0],
        color_bar: custom
          ? {
              tick_side: `secondary`,
              title_side: `right`,
              wrapper_style: `border: 1px dashed red;`,
            }
          : undefined,
      },
    })
    flushSync()
    for (const open of [false, true]) {
      if (open)
        await fire(doc_query(`.multiselect`), new MouseEvent(`mouseup`, { bubbles: true }))
      const bars = document.body.querySelectorAll<HTMLElement>(`.colorbar`)
      // The closed chip only; after opening, one bar per scheme including the chip.
      expect(bars).toHaveLength(open ? options.length : 1)
      for (const { style } of bars) {
        if (custom) {
          expect(style.border).toBe(`1px dashed red`)
          expect(style.flexDirection).toBe(`row-reverse`)
        } else expect(style.getPropertyValue(`--cbar-label-text-align`)).toBe(`left`)
      }
    }
  })
})
