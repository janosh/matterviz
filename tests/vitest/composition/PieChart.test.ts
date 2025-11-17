import { PieChart } from '$lib/composition'
import {
  count_atoms_in_composition,
  fractional_composition,
} from '$lib/composition/parse'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

describe(`PieChart component`, () => {
  test(`renders SVG with correct viewBox`, () => {
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200 },
    })

    const svg = document.querySelector(`svg`)
    expect(svg).toBeTruthy()
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

    expect(
      document.querySelectorAll(`path[role="button"]`).length,
    ).toBeGreaterThan(0)
  })

  test(`renders children snippet`, () => {
    mount(PieChart, {
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

describe(`PieChart data processing`, () => {
  test.each([
    [{ H: 2, O: 1 }, { H: 0.6667, O: 0.3333 }, 3],
    [{}, {}, 0],
    [{ H: 5 }, { H: 1.0 }, 5],
    [
      { C: 8, H: 10, N: 4, O: 2 },
      { C: 0.3333, H: 0.4167, N: 0.1667, O: 0.0833 },
      24,
    ],
  ])(
    `processes composition correctly`,
    (composition, expected_fractions, expected_total) => {
      expect(count_atoms_in_composition(composition)).toBe(expected_total)

      const fractions = fractional_composition(composition)
      if (Object.keys(expected_fractions).length === 0) {
        expect(Object.keys(fractions)).toHaveLength(0)
      } else {
        Object.entries(expected_fractions).forEach(
          ([element, expected_frac]) => {
            expect(
              fractions[element as keyof typeof fractions],
            ).toBeCloseTo(expected_frac as number, 3)
          },
        )
      }
    },
  )
})
