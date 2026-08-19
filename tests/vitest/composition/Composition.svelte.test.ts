import { Composition } from '$lib/composition'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

async function open_context_menu() {
  const wrapper = doc_query(`.composition`)
  wrapper.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true, cancelable: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe(`Composition component`, () => {
  test.each([`pie`, `bubble`, `bar`] as const)(`renders %s mode correctly`, (mode) => {
    mount(Composition, { target: document.body, props: { composition: `H2O`, mode } })
    expect(doc_query(`.${mode}-chart`)).toBeInstanceOf(SVGSVGElement)
  })

  test(`forwards size to child chart`, () => {
    mount(Composition, {
      target: document.body,
      props: { composition: `H2O`, size: 200 },
    })
    expect(doc_query(`.pie-chart`).getAttribute(`viewBox`)).toBe(`0 0 200 200`)
  })

  test(`reports parsed composition`, async () => {
    const on_parse = vi.fn()
    mount(Composition, {
      target: document.body,
      props: { composition: `H2O`, on_parse },
    })
    await tick()
    expect(on_parse).toHaveBeenCalledWith({ H: 2, O: 1 })
  })

  test(`rejects invalid input`, () => {
    expect(() =>
      mount(Composition, { target: document.body, props: { composition: `invalid` } }),
    ).toThrow(`No valid elements`)
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
    expect(container.getAttribute(`style`)).toContain(`background-color: red;`)
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
  })

  test(`opens context menu on right click`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    await open_context_menu()
    expect(doc_query(`.action-menu`)).toBeInstanceOf(HTMLElement)
    expect(doc_query(`.section-title`).textContent).toBe(`Display Mode`)
    // the active mode is a checked radio, so a screen reader announces the selection
    const pie = doc_query(`[role="menuitemradio"]`)
    expect([pie.textContent?.trim(), pie.getAttribute(`aria-checked`)]).toEqual([
      `Pie Chart`,
      `true`,
    ])
  })

  test(`context menu lists display modes, color schemes, and export options`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    await open_context_menu()

    const menu_options = document.querySelectorAll(`.action-menu button`)
    expect(menu_options.length).toBeGreaterThanOrEqual(13) // 3 display modes + 6 color schemes + 4 export options

    const option_texts = Array.from(menu_options).map((opt) => opt.textContent?.trim())
    const expected_options = [
      `Pie Chart`,
      `Bubble Chart`,
      `Bar Chart`,
      `Vesta`,
      `Jmol`,
      `Alloy`,
      `Copy Formula`,
      `Copy Data`,
      `Export SVG`,
      `Export PNG`,
    ]
    for (const label of expected_options) expect(option_texts).toContain(label)
  })

  test(`context menu changes propagate to chart components`, async () => {
    mount(Composition, { target: document.body, props: { composition: `H2O` } })
    await open_context_menu()

    const bubble_option = Array.from(
      document.querySelectorAll<HTMLButtonElement>(`.action-menu button`),
    ).find((opt) => opt.textContent?.includes(`Bubble Chart`))
    if (!bubble_option) throw new Error(`Bubble Chart option not found`)
    bubble_option.click()

    await open_context_menu()
    expect(doc_query(`.bubble-chart`)).toBeInstanceOf(SVGSVGElement)
  })
})
