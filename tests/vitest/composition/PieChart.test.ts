import { PieChart } from '$lib/composition'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`PieChart component`, () => {
  test(`renders sized, non-interactive slices for each element`, () => {
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 200 },
    })

    const svg = document.querySelector(`svg`)
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute(`viewBox`)).toBe(`0 0 200 200`)
    expect(document.querySelectorAll(`path`)).toHaveLength(3)
    expect(document.querySelectorAll(`path[role="button"]`)).toHaveLength(0)
  })
})
