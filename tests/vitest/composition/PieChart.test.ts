import { PieChart } from '$lib/composition'
import { createRawSnippet, mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`PieChart component`, () => {
  test(`renders SVG with correct viewBox`, () => {
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200 },
    })

    const svg = document.querySelector(`svg`)
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`renders pie slices for each element`, () => {
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 200 },
    })

    expect(document.querySelectorAll(`path`)).toHaveLength(3)
  })

  test(`handles interactive mode`, () => {
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200, interactive: true },
    })

    expect(document.querySelectorAll(`path[role="button"]`).length).toBeGreaterThan(0)
  })

  test(`renders children snippet`, () => {
    mount(PieChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        children: createRawSnippet(() => ({
          render: () => `<div class="custom-child"></div>`,
        })),
      },
    })

    expect(document.querySelector(`.custom-child`)).not.toBeNull()
  })
})
