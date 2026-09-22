import { Composition, parse_composition } from '$lib/composition'
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

function click_menu_item(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>(`.action-menu button`)].find(
    (option) => option.textContent?.trim() === label,
  )
  if (!button) throw new Error(`Missing action: ${label}`)
  button.click()
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

  test.each([
    [`O3Fe2`, `Fe2 O3`],
    [`Li0.123456Na0.876544Cl`, `Na0.876544 Li0.123456 Cl`],
  ])(`copies a precise plain-text formula for %s`, async (composition, expected) => {
    const write_text = vi.fn()
    vi.stubGlobal(`navigator`, { clipboard: { writeText: write_text } })
    mount_composition({ composition })
    await open_context_menu()
    click_menu_item(`Copy Formula`)
    expect(write_text).toHaveBeenCalledExactlyOnceWith(expected)
    expect(parse_composition(write_text.mock.calls[0][0])).toEqual(
      parse_composition(composition),
    )
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
    expect([...menu_options].every((option) => option.querySelector(`svg`))).toBe(true)

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

  test.each([`Copy Formula`, `Copy Data`])(
    `reports clipboard rejection for %s`,
    async (label) => {
      const error = new Error(`Clipboard permission denied`)
      const report = vi.spyOn(console, `error`).mockImplementation(() => {})
      vi.stubGlobal(`navigator`, {
        clipboard: { writeText: vi.fn().mockRejectedValue(error) },
      })
      mount_composition({ composition: `H2O` })
      await open_context_menu()
      click_menu_item(label)
      await vi.waitFor(() =>
        expect(report).toHaveBeenCalledExactlyOnceWith(`Export failed:`, error),
      )
      vi.unstubAllGlobals()
    },
  )

  test(`context menu changes propagate to chart components`, async () => {
    mount_composition({ composition: `H2O` })
    await open_context_menu()

    click_menu_item(`Bubble Chart`)

    await open_context_menu()
    expect(doc_query(`.bubble-chart`)).toBeInstanceOf(SVGSVGElement)
    click_menu_item(`Export files…`)
    await tick()
    expect(document.body.textContent).toContain(`Export composition`)
  })
})
