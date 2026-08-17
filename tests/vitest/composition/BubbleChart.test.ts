import { BubbleChart } from '$lib/composition'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`BubbleChart component`, () => {
  test(`renders SVG with correct viewBox`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200 },
    })

    const svg = document.querySelector(`svg`)
    expect(svg).toBeInstanceOf(SVGSVGElement)
    expect(svg?.getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`renders circles for each element`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 200 },
    })

    expect(document.querySelectorAll(`circle`)).toHaveLength(3)
  })

  test(`does not expose non-actions as buttons`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200 },
    })

    const n_buttons = document.querySelectorAll(`circle[role="button"]`).length
    expect(n_buttons).toBe(0)
  })
})
