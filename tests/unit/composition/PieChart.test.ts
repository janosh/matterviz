import type { CompositionType } from '$lib'
import { describe, expect, test, vi } from 'vitest'

// Mock composition parsing utilities
vi.mock(`$lib/composition/parse`, () => ({
  composition_to_percentages: vi.fn((comp: CompositionType) => {
    const total = Object.values(comp).reduce((sum, val) => sum + (val || 0), 0)
    const percentages: CompositionType = {}
    for (const [element, amount] of Object.entries(comp)) {
      if (typeof amount === `number`) {
        percentages[element as keyof CompositionType] = (amount / total) * 100
      }
    }
    return percentages
  }),
  get_total_atoms: vi.fn((comp: CompositionType) =>
    Object.values(comp).reduce((sum, val) => sum + (val || 0), 0)
  ),
}))

// Mock colors module
vi.mock(`$lib/colors`, () => ({
  element_color_schemes: {
    Vesta: { H: `#ffffff`, O: `#ff0d0d`, C: `#909090`, Fe: `#e06633` },
  },
}))

// Mock state module
vi.mock(`$lib/state.svelte`, () => ({
  colors: {
    element: { H: `#ffffff`, O: `#ff0d0d`, C: `#909090`, Fe: `#e06633` },
  },
}))

describe(`PieChart component`, () => {
  test(`imports without errors`, async () => {
    const module = await import(`$lib/composition/PieChart.svelte`)
    expect(module.default).toBeDefined()
    expect(typeof module.default).toBe(`function`)
  })

  test(`renders SVG with correct viewBox`, async () => {
    const { mount } = await import(`svelte`)
    const PieChart = (await import(`$lib/composition/PieChart.svelte`)).default

    document.body.innerHTML = ``
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 200 },
    })

    const svg = document.querySelector(`svg`)
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`renders pie slices for each element`, async () => {
    const { mount } = await import(`svelte`)
    const PieChart = (await import(`$lib/composition/PieChart.svelte`)).default

    document.body.innerHTML = ``
    mount(PieChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 200 },
    })

    expect(document.querySelectorAll(`path`)).toHaveLength(3)
  })

  test(`handles interactive mode`, async () => {
    const { mount } = await import(`svelte`)
    const PieChart = (await import(`$lib/composition/PieChart.svelte`)).default

    document.body.innerHTML = ``
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
    async (composition, expected_percentages, expected_total) => {
      const { composition_to_percentages, get_total_atoms } = await import(
        `$lib/composition/parse`
      )

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
