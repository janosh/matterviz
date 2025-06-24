import { Composition } from '$lib/composition'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

// Mock colors module
vi.mock(`$lib/colors`, () => ({
  element_color_schemes: {
    Vesta: { H: `#ffffff`, O: `#ff0d0d`, Fe: `#e06633` },
    Jmol: { H: `#ffffff`, O: `#ff0d0d`, Fe: `#e06633` },
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
    O: `#ff0d0d`,
    Fe: `#e06633`,
  },
}))

function doc_query<T extends Element = Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Element with selector "${selector}" not found`)
  return element
}

describe(`Composition component`, () => {
  test(`renders with basic props`, () => {
    mount(Composition, { target: document.body, props: { input: `H2O` } })
    expect(doc_query(`.composition-container`)).toBeTruthy()
  })

  test.each(
    [
      [`pie`, `.pie-chart`],
      [`bubble`, `.bubble-chart`],
      [`bar`, `.stacked-bar-chart-container`],
    ] as const,
  )(`renders %s mode correctly`, (mode, selector) => {
    mount(Composition, { target: document.body, props: { input: `H2O`, mode } })
    expect(doc_query(selector)).toBeTruthy()
  })

  test(`forwards props to child components`, () => {
    mount(Composition, {
      target: document.body,
      props: {
        input: `H2O`,
        size: 200,
        color_scheme: `Jmol`,
        interactive: false,
      },
    })
    expect(doc_query(`.pie-chart`).getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`handles composition change callback`, async () => {
    const on_composition_change = vi.fn()
    mount(Composition, {
      target: document.body,
      props: { input: `H2O`, on_composition_change },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(on_composition_change).toHaveBeenCalledWith({ H: 2, O: 1 })
  })

  test(`handles invalid input gracefully`, () => {
    mount(Composition, { target: document.body, props: { input: `invalid` } })
    expect(doc_query(`.composition-container`)).toBeTruthy()
  })

  test(`applies custom styling`, () => {
    mount(Composition, {
      target: document.body,
      props: {
        input: `H2O`,
        style: `background-color: red;`,
        class: `my-custom-class`,
      },
    })

    const container = doc_query(`.composition-container`)
    expect(container.getAttribute(`style`)).toBe(`background-color: red;`)
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
  })

  test(`handles numeric input`, () => {
    mount(Composition, {
      target: document.body,
      props: { input: { 1: 2, 8: 1 } as Composition },
    })
    expect(doc_query(`.composition-container`)).toBeTruthy()
  })

  test(`renders bar mode with custom dimensions`, () => {
    mount(Composition, {
      target: document.body,
      props: { input: `H2O`, mode: `bar`, width: 400, height: 80 },
    })

    const container = doc_query(`.stacked-bar-chart-container`)
    expect(container.getAttribute(`style`)).toContain(`--bar-max-width: 400px`)
    expect(container.getAttribute(`style`)).toContain(`--bar-height: 80px`)
  })
})
