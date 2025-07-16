import { BarChart } from '$lib/composition'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

// Mock composition parsing utilities
vi.mock(`$lib/composition/parse`, () => ({
  composition_to_percentages: vi.fn((comp: Record<string, number>) => {
    const total = Object.values(comp).reduce(
      (sum: number, val: number) => sum + (val || 0),
      0,
    )
    const percentages: Record<string, number> = {}
    for (const [element, amount] of Object.entries(comp)) {
      if (typeof amount === `number`) percentages[element] = (amount / total) * 100
    }
    return percentages
  }),
  get_total_atoms: vi.fn((comp: Record<string, number>) =>
    Object.values(comp).reduce(
      (sum: number, val: number) => sum + (val || 0),
      0,
    )
  ),
}))

vi.mock(`$lib/colors`, () => ({
  element_color_schemes: {
    Vesta: {
      H: `#ffffff`,
      C: `#909090`,
      N: `#3050f8`,
      O: `#ff0d0d`,
      Fe: `#e06633`,
      Ca: `#3dff00`,
      Mg: `#8aff00`,
    },
    Jmol: {
      H: `#ffffff`,
      C: `#909090`,
      N: `#3050f8`,
      O: `#ff0d0d`,
      Fe: `#e06633`,
      Ca: `#3dff00`,
      Mg: `#8aff00`,
    },
  },
  default_category_colors: {
    'diatomic-nonmetal': `#ff8c00`,
    'noble-gas': `#9932cc`,
    'alkali-metal': `#006400`,
    'alkaline-earth-metal': `#483d8b`,
    metalloid: `#b8860b`,
    'polyatomic-nonmetal': `#a52a2a`,
    'transition-metal': `#571e6c`,
    'post-transition-metal': `#938d4a`,
    lanthanide: `#58748e`,
    actinide: `#6495ed`,
  },
  default_element_colors: {
    H: `#ffffff`,
    C: `#909090`,
    N: `#3050f8`,
    O: `#ff0d0d`,
    Fe: `#e06633`,
    Ca: `#3dff00`,
    Mg: `#8aff00`,
  },
  pick_color_for_contrast: vi.fn(() => `#000000`),
}))

vi.mock(`$lib`, () => ({
  format_num: vi.fn((num: number, precision: number) => num.toFixed(precision)),
}))

function doc_query<T extends Element = Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Element with selector "${selector}" not found`)
  return element
}

describe(`BarChart component`, () => {
  test(`imports without errors`, async () => {
    const module = await import(`$lib/composition/BarChart.svelte`)
    expect(module.default).toBeDefined()
  })

  test(`renders container with correct dimensions`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 300 },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container).toBeTruthy()
    expect(container?.getAttribute(`style`)).toContain(`max-width: 300px;`)
    expect(container?.getAttribute(`style`)).toContain(`max-height: 300px;`)
  })

  test(`renders segments for each element`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1, C: 1 }, size: 300 },
    })

    expect(document.querySelectorAll(`.bar-segment`)).toHaveLength(3)
  })

  test(`handles interactive mode`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, interactive: true },
    })

    expect(
      document.querySelectorAll(`.bar-segment[role="button"]`).length,
    ).toBeGreaterThan(0)
  })

  test.each([
    [false, `all segments`],
    [true, `outer corners only`],
  ])(
    `applies border radius correctly when outer_corners_only is %s`,
    (outer_corners_only) => {
      mount(BarChart, {
        target: document.body,
        props: {
          composition: { H: 2, O: 1, C: 1 },
          border_radius: 5,
          outer_corners_only,
        },
      })

      const container = document.querySelector(`.bar-segments`)
      expect(container?.classList.contains(`outer-corners-only`)).toBe(
        outer_corners_only,
      )
    },
  )

  test.each([true, false])(`handles labels`, (show_labels) => {
    const composition = { H: 2, O: 1 }
    mount(BarChart, {
      target: document.body,
      props: { composition, size: 300, show_labels },
    })

    const container = document.querySelector(`.bar-chart`)
    expect(container?.querySelectorAll(`.bar-label`).length).toBe(
      show_labels ? Object.keys(composition).length : 0,
    )
  })

  test(`renders with basic composition`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 } },
    })
    expect(doc_query(`.bar-chart`)).toBeTruthy()
  })

  test(`renders bar segments correctly`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 } },
    })

    const segments = document.querySelectorAll(`.bar-segment`)
    expect(segments.length).toBe(2) // H and O segments
  })

  test(`external label positioning balances above and below`, () => {
    // Create composition with many thin segments to trigger external labels
    const composition = { H: 1, C: 1, N: 1, O: 1, Ca: 1, Mg: 1 }
    mount(BarChart, {
      target: document.body,
      props: { composition, size: 300 },
    })

    // Check that external labels exist
    const aboveLabels = document.querySelectorAll(
      `.external-labels-above .external-label`,
    )
    const belowLabels = document.querySelectorAll(
      `.external-labels-below .external-label`,
    )

    // With 6 equal segments at ~16.7% each, they should be thin enough for external labels
    const totalExternalLabels = aboveLabels.length + belowLabels.length
    expect(totalExternalLabels).toBeGreaterThan(0)

    // The difference between above and below labels should be at most 1
    // (perfect balance or one extra in one direction)
    const difference = Math.abs(aboveLabels.length - belowLabels.length)
    expect(difference).toBeLessThanOrEqual(1)
  })

  test(`handles custom dimensions`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: { H: 2, O: 1 }, size: 400 },
    })

    const container = doc_query(`.bar-chart`)
    expect(container.getAttribute(`style`)).toContain(
      `max-width: 400px; max-height: 400px;`,
    )
  })

  test(`applies custom styling and classes`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        style: `background-color: red;`,
        class: `my-custom-class`,
      },
    })

    const container = doc_query(`.bar-chart`)
    expect(container.getAttribute(`style`)).toContain(`background-color: red;`)
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
  })

  test(`handles empty composition gracefully`, () => {
    mount(BarChart, {
      target: document.body,
      props: { composition: {} },
    })

    const segments = document.querySelectorAll(`.bar-segment`)
    expect(segments.length).toBe(0)
  })

  test(`shows labels and percentages when enabled`, () => {
    mount(BarChart, {
      target: document.body,
      props: {
        composition: { H: 2, O: 1 },
        show_labels: true,
        show_percentages: true,
        show_amounts: true,
      },
    })

    // Should find element symbols
    expect(document.querySelector(`.element-symbol`)).toBeTruthy()

    // Should find percentage elements
    expect(document.querySelector(`.percentage`)).toBeTruthy()

    // Should find amount elements
    expect(document.querySelector(`.amount`)).toBeTruthy()
  })
})

describe(`BarChart calculations`, () => {
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

  test(`calculates font scaling correctly`, () => {
    const min_font_scale = 0.6
    const max_font_scale = 1.2

    // Test different segment sizes
    expect(Math.min(max_font_scale, Math.max(min_font_scale, 80 / 40))).toBe(
      max_font_scale,
    )
    expect(Math.min(max_font_scale, Math.max(min_font_scale, 20 / 40))).toBe(
      min_font_scale,
    )
    expect(Math.min(max_font_scale, Math.max(min_font_scale, 40 / 40))).toBe(
      1.0,
    )
  })
})
