import { ColorBar } from '$lib'
import * as d3sc from 'd3-scale-chromatic'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

const valid_color_scale_keys = Object.keys(d3sc)
  .map((key) => key.split(`interpolate`)[1])
  .filter(Boolean)
  .join(`, `)

describe(`ColorBar`, () => {
  test(`renders text, color scale, tick labels, and styles`, () => {
    new ColorBar({
      target: document.body,
      props: {
        label: `Test`,
        color_scale: `Viridis`,
        tick_labels: 5,
        range: [0, 100],
        label_side: `left`,
        style: `width: 200px;`,
        label_style: `font-weight: bold;`,
        wrapper_style: `margin: 10px;`,
      },
    })

    const text = doc_query(`.colorbar > span`)
    expect(text.textContent).toBe(`Test`)
    expect(text.style.fontWeight).toBe(`bold`)

    const cbar_div = doc_query(`.colorbar > div`)
    expect(cbar_div.style.width).toBe(`200px`)

    const tick_labels = document.querySelectorAll(`.colorbar > div > span`)
    expect(tick_labels.length).toBe(6)

    const wrapper = doc_query(`.colorbar`)
    expect(wrapper.style.margin).toBe(`10px`)
  })

  test(`handles invalid color_scale input`, () => {
    const spy = vi.spyOn(console, `error`)

    new ColorBar({
      target: document.body,
      props: { color_scale: `purposely invalid` },
    })

    expect(spy).toHaveBeenCalledWith(
      `Color scale 'purposely invalid' not found, supported color scale names are ${valid_color_scale_keys}. Falling back on 'Viridis'.`,
    )
  })
})
