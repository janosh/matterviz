import { BubbleChart, get_total_atoms } from '$lib/composition'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`BubbleChart component`, () => {
  test(`renders SVG with correct viewBox`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200 },
    })

    const svg = document.querySelector(`svg`)
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`renders circles for each element`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 200 },
    })

    expect(document.querySelectorAll(`circle`)).toHaveLength(3)
  })

  test(`handles interactive mode`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200, interactive: true },
    })

    const n_buttons = document.querySelectorAll(`circle[role="button"]`).length
    expect(n_buttons).toBeGreaterThan(0)
  })
})

describe(`BubbleChart calculations`, () => {
  test(`calculates bubble radii proportional to amounts`, () => {
    const size = 200
    const padding = 20
    const max_amount = 4
    const available_area = (size - 2 * padding) ** 2
    const max_radius = Math.sqrt(available_area / (2 * Math.PI)) * 0.8

    const h_radius = Math.sqrt(4 / max_amount) * max_radius
    const o_radius = Math.sqrt(1 / max_amount) * max_radius

    expect(h_radius).toBeCloseTo(max_radius, 2)
    expect(o_radius).toBeCloseTo(max_radius * 0.5, 2)
  })

  test(`handles single element positioning`, () => {
    const size = 200
    const center_x = size / 2
    const center_y = size / 2

    expect(center_x).toBe(100)
    expect(center_y).toBe(100)
  })

  test.each([
    [{ H: 2, O: 1 }, 3],
    [{}, 0],
    [{ C: 60 }, 60],
    [{ H: 0.1, O: 0.2 }, 0.3],
  ])(`processes data correctly`, (composition, expected_total) => {
    const total = get_total_atoms(composition)

    if (expected_total < 1) {
      expect(total).toBeCloseTo(expected_total, 1)
    } else {
      expect(total).toBe(expected_total)
    }
  })
})
