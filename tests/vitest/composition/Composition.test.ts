import type { CompositionType } from '$lib'
import { Composition } from '$lib/composition'
import { mount, tick } from 'svelte'
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
  pick_color_for_contrast: vi.fn(() => `#000000`),
}))

function doc_query<T extends Element = Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Element with selector "${selector}" not found`)
  return element
}

function open_context_menu() {
  const wrapper = doc_query(`.composition`)
  wrapper.dispatchEvent(
    new MouseEvent(`contextmenu`, { bubbles: true, cancelable: true }),
  )
}

describe(`Composition component`, () => {
  test(`renders with basic props`, () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    expect(doc_query(`.composition`)).toBeTruthy()
  })

  test.each([`pie`, `bubble`, `bar`] as const)(`renders %s mode correctly`, (mode) => {
    mount(Composition, { target: document.body, props: { composition: `H2O`, mode } })
    expect(doc_query(`.${mode}-chart`)).toBeTruthy()
  })

  test(`forwards props to child components`, () => {
    mount(Composition, {
      target: document.body,
      props: {
        composition: `H2O`,
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
      props: { composition: `H2O`, on_composition_change },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(on_composition_change).toHaveBeenCalledWith({ H: 2, O: 1 })
  })

  test(`handles invalid input gracefully`, () => {
    mount(Composition, { target: document.body, props: { composition: `invalid` } })
    expect(doc_query(`.composition`)).toBeTruthy()
  })

  test(`applies custom styling`, () => {
    mount(Composition, {
      target: document.body,
      props: {
        composition: `H2O`,
        style: `background-color: red;`,
        class: `my-custom-class`,
      },
    })
    const container = doc_query(`.composition`)
    expect(container.getAttribute(`style`)).toBe(`background-color: red;`)
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
  })

  test(`handles numeric input`, () => {
    mount(Composition, {
      target: document.body,
      props: { composition: { 1: 2, 8: 1 } as CompositionType },
    })
    expect(doc_query(`.composition`)).toBeTruthy()
  })

  test(`renders bar mode with custom dimensions`, () => {
    mount(Composition, {
      target: document.body,
      props: { composition: `H2O`, mode: `bar`, size: 400 },
    })
    expect(doc_query(`.bar-chart`).getAttribute(`viewBox`)).toContain(`0 0 400`)
  })

  test(`opens context menu on right click`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    open_context_menu()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(doc_query(`.context-menu`)).toBeTruthy()
    expect(doc_query(`.header`).textContent).toBe(`Display Mode`)
  })

  test(`context menu has all expected options`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    open_context_menu()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const menu_options = document.querySelectorAll(`.context-menu button`)
    expect(menu_options.length).toBe(13) // 3 display modes + 6 color schemes + 4 export options

    const option_texts = Array.from(menu_options).map((opt) => opt.textContent?.trim())
    expect(option_texts).toContain(`Pie Chart`)
    expect(option_texts).toContain(`Bubble Chart`)
    expect(option_texts).toContain(`Bar Chart`)
    expect(option_texts).toContain(`Vesta`)
    expect(option_texts).toContain(`Jmol`)
    expect(option_texts).toContain(`Alloy`)
    expect(option_texts).toContain(`Copy Formula`)
  })

  test(`context menu changes propagate to chart components`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    open_context_menu()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const bubble_option = Array.from(document.querySelectorAll(`.context-menu button`))
      .find((opt) => opt.textContent?.includes(`Bubble Chart`))
    expect(bubble_option).toBeTruthy()
    ;(bubble_option as HTMLElement).click()
    await tick()

    open_context_menu()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(doc_query(`.bubble-chart`)).toBeTruthy()
  })

  test(`export options are available in context menu`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    open_context_menu()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const export_options = Array.from(document.querySelectorAll(`.context-menu button`))
      .filter((opt) =>
        opt.textContent?.includes(`Export`) || opt.textContent?.includes(`Copy`)
      )
    expect(export_options.length).toBe(4)

    const option_texts = export_options.map((opt) => opt.textContent?.trim())
    expect(option_texts).toContain(`Copy Formula`)
    expect(option_texts).toContain(`Copy Data`)
    expect(option_texts).toContain(`Export SVG`)
    expect(option_texts).toContain(`Export PNG`)
  })
})
