import type { CompositionType } from '$lib'
import { Composition } from '$lib/composition'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

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
      props: { composition: `H2O`, size: 200, color_scheme: `Jmol`, interactive: false },
    })
    expect(doc_query(`.pie-chart`).getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`handles composition change callback`, async () => {
    const on_composition_change = vi.fn()
    let composition = $state(`H2O`)
    mount(Composition, {
      target: document.body,
      props: { composition, on_composition_change },
    })
    await tick()
    expect(on_composition_change).toHaveBeenCalledWith({ H: 2, O: 1 })
    composition = `FeF`

    // TODO figure out why on_composition_change not called on $state(`H2O`) change
    // await tick()
    // expect(on_composition_change).toHaveBeenCalledTimes(2)
    // expect(on_composition_change).toHaveBeenCalledWith({ Fe: 1, F: 1 })
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
    await new Promise((r) => setTimeout(r, 0))
    expect(doc_query(`.context-menu`)).toBeTruthy()
    expect(doc_query(`.header`).textContent).toBe(`Display Mode`)
  })

  test(`context menu has all expected options`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    open_context_menu()
    await new Promise((r) => setTimeout(r, 0))

    const menu_options = document.querySelectorAll(`.context-menu button`)
    expect(menu_options.length).toBeGreaterThanOrEqual(13) // 3 display modes + 6 color schemes + 4 export options

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
    await new Promise((r) => setTimeout(r, 0))

    const bubble_option = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.context-menu button`),
    )
      .find((opt) => opt.textContent?.includes(`Bubble Chart`))
    if (!bubble_option) throw new Error(`Bubble Chart option not found`)
    bubble_option.click()

    open_context_menu()
    await tick()
    expect(doc_query(`.bubble-chart`)).toBeTruthy()
  })

  test(`export options are available in context menu`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    open_context_menu()
    await new Promise((r) => setTimeout(r, 0))

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
