import { Composition } from '$lib/composition'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

const mount_composition = (props: ComponentProps<typeof Composition>) =>
  mount(Composition, { target: document.body, props })

async function open_context_menu() {
  const wrapper = doc_query(`.composition`)
  wrapper.dispatchEvent(new MouseEvent(`contextmenu`, { bubbles: true, cancelable: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe(`Composition component`, () => {
  test.each([`pie`, `bubble`, `bar`] as const)(`renders %s mode correctly`, (mode) => {
    mount_composition({ composition: `H2O`, mode })
    expect(doc_query(`.${mode}-chart`)).toBeInstanceOf(SVGSVGElement)
  })

  test(`forwards chart options and SVG attributes`, () => {
    mount_composition({
      composition: `H2O`,
      size: 200,
      style: `background-color: red;`,
      class: `my-custom-class`,
      show_labels: false,
    })
    const container = doc_query(`.composition.pie-chart`)
    expect(container.getAttribute(`viewBox`)).toBe(`0 0 200 200`)
    expect(container.getAttribute(`style`)).toContain(`background-color: red;`)
    expect(container.classList.contains(`my-custom-class`)).toBe(true)
    expect(container.querySelector(`text`)).toBeNull()
  })

  test(`reports parsed composition`, async () => {
    const on_parse = vi.fn()
    mount_composition({ composition: `H2O`, on_parse })
    await tick()
    expect(on_parse).toHaveBeenCalledWith({ H: 2, O: 1 })
  })

  test.each([
    [`invalid`, `Unexpected character "i"`],
    [`Xx2O`, `Invalid element symbol: Xx`],
  ])(`rejects invalid input %s`, (composition, error) => {
    expect(() => mount_composition({ composition })).toThrow(error)
  })

  test(`copies a plain-text electronegativity formula (no HTML subscripts)`, async () => {
    const write_text = vi.fn()
    vi.stubGlobal(`navigator`, { clipboard: { writeText: write_text } })
    mount_composition({ composition: `O3Fe2` })
    await open_context_menu()
    const copy_btn = [
      ...document.querySelectorAll<HTMLButtonElement>(`.action-menu button`),
    ].find((btn) => btn.textContent?.includes(`Copy Formula`))
    copy_btn?.click()
    expect(write_text).toHaveBeenCalledExactlyOnceWith(`Fe2 O3`)
    vi.unstubAllGlobals()
  })

  test(`right click opens the checked display modes, color schemes, and export options`, async () => {
    mount_composition({ composition: `H2O` })
    await open_context_menu()
    expect(doc_query(`.action-menu`)).toBeInstanceOf(HTMLElement)
    expect(doc_query(`.section-title`).textContent).toBe(`Display Mode`)
    // the active mode is a checked radio, so a screen reader announces the selection
    const pie = doc_query(`[role="menuitemradio"]`)
    expect([pie.textContent?.trim(), pie.getAttribute(`aria-checked`)]).toEqual([
      `Pie Chart`,
      `true`,
    ])
    const menu_options = document.querySelectorAll(`.action-menu button`)
    expect(menu_options.length).toBeGreaterThanOrEqual(12) // 3 display modes + 6 color schemes + 3 export options

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
      `Export files…`,
    ]
    for (const label of expected_options) expect(option_texts).toContain(label)
  })

  test(`context menu changes propagate to chart components`, async () => {
    mount_composition({ composition: `H2O` })
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
