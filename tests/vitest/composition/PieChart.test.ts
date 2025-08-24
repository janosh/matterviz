import { PieChart } from '$lib/composition'
import { composition_to_percentages, get_total_atoms } from '$lib/composition/parse'
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
})

describe(`PieChart data processing`, () => {
  test.each([
    [{ H: 2, O: 1 }, { H: 66.67, O: 33.33 }, 3],
    [{}, {}, 0],
    [{ H: 5 }, { H: 100 }, 5],
    [
      { C: 8, H: 10, N: 4, O: 2 },
      { C: 33.33, H: 41.67, N: 16.67, O: 8.33 },
      24,
    ],
  ])(
    `processes composition correctly`,
    (composition, expected_percentages, expected_total) => {
      expect(get_total_atoms(composition)).toBe(expected_total)

      const percentages = composition_to_percentages(composition)
      if (Object.keys(expected_percentages).length === 0) {
        expect(Object.keys(percentages)).toHaveLength(0)
      } else {
        Object.entries(expected_percentages).forEach(
          ([element, expected_pct]) => {
            expect(
              percentages[element as keyof typeof percentages],
            ).toBeCloseTo(expected_pct as number, 1)
          },
        )
      }
    },
  )
})
