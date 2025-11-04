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

  test(`renders children content`, () => {
    mount(BubbleChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        children: () => {
          const elem = document.createElement(`div`)
          elem.className = `custom-child`
          document.body.appendChild(elem)
        },
      },
    })

    expect(document.querySelector(`.custom-child`)).toBeTruthy()
  })
})

describe(`BubbleChart calculations`, () => {
  test.each([
    [{ H: 2, O: 1 }, 3],
    [{}, 0],
    [{ C: 60 }, 60],
    [{ H: 0.1, O: 0.2 }, 0.3],
  ])(`calculates total atoms correctly`, (composition, expected_total) => {
    const total = get_total_atoms(composition)

    if (expected_total < 1) {
      expect(total).toBeCloseTo(expected_total, 1)
    } else {
      expect(total).toBe(expected_total)
    }
  })
})
