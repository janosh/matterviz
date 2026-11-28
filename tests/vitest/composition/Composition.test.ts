import Composition from '#lib/composition/Composition.svelte'
import { parse_species_composition } from '#lib/composition/parse'
import { ELEMENT_COLOR_SCHEMES, ELEMENT_COLOR_SCHEME_NAMES } from '#lib/colors/index'
import { rgb } from 'd3-color'
import { type ComponentProps, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vite-plus/test'
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

  test.each([
    [`H2O`, { H: 2, O: 1 }],
    [`Fe2+Fe3+2O2-4`, { 'Fe2+': 1, 'Fe3+': 2, 'O2-': 4 }],
    [
      { 'Fe^2+': 1, 'O2-': 1 },
      { 'Fe2+': 1, 'O2-': 1 },
    ],
  ])(`reports parsed composition of %j`, async (composition, expected) => {
    const on_parse = vi.fn()
    mount_composition({ composition, on_parse })
    await tick()
    expect(on_parse).toHaveBeenCalledWith(expected)
  })

  test.each([
    [`invalid`, `Unexpected character "i"`],
    [`Xx2O`, `Invalid element symbol: Xx`],
    [{ 'Fe2+3': 1 }, `Invalid species, element symbol or atomic number: Fe2+3`],
  ])(`rejects invalid input %s`, (composition, error) => {
    expect(() => mount_composition({ composition })).toThrow(error)
  })

  test.each([
    [`O3Fe2`, `Fe2 O3`],
    [`Li0.123456Na0.876544Cl`, `Na0.876544 Li0.123456 Cl`],
    [`O2-4Fe3+2Fe2+`, `Fe2+ Fe3+2 O2-4`],
  ])(`copies a precise plain-text formula for %s`, async (composition, expected) => {
    const write_text = vi.fn()
    vi.stubGlobal(`navigator`, { clipboard: { writeText: write_text } })
    mount_composition({ composition })
    await open_context_menu()
    click_menu_item(`Copy Formula`)
    expect(write_text).toHaveBeenCalledExactlyOnceWith(expected)
    expect(parse_species_composition(write_text.mock.calls[0][0])).toEqual(
      parse_species_composition(composition),
    )
    vi.unstubAllGlobals()
  })

  test(`right click opens the checked display modes, color schemes, and export options`, async () => {
    mount_composition({ composition: `Fe2+Fe3+2O2-4` })
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
    // a distinct icon per action, swatches of the charted elements per color scheme
    const icons = [...menu_options].map((option) => option.querySelector(`svg`)?.innerHTML)
    const with_icon = icons.filter(Boolean)
    expect(new Set(with_icon).size).toBe(with_icon.length)
    const swatch_rows = [...document.querySelectorAll(`.action-menu .swatches`)]
    expect(swatch_rows).toHaveLength(ELEMENT_COLOR_SCHEME_NAMES.length)
    expect(with_icon.length + swatch_rows.length).toBe(menu_options.length)
    const jmol_swatches = [...swatch_rows[1].children].map((span) =>
      span instanceof HTMLElement ? span.style.background : null,
    )
    // one swatch per element: Fe2+ and Fe3+ share theirs
    const { Fe, O } = ELEMENT_COLOR_SCHEMES.Jmol
    expect(jmol_swatches.map((color) => color && rgb(color).formatHex())).toEqual([Fe, O])

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
    `shows clipboard rejection for %s`,
    async (label) => {
      vi.stubGlobal(`navigator`, {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error(`denied`)) },
      })
      mount_composition({ composition: `H2O` })
      await open_context_menu()
      click_menu_item(label)
      await vi.waitFor(() =>
        expect(document.querySelector(`.copy-toast[data-error]`)?.textContent).toBe(
          `Copy failed`,
        ),
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
    // the shared pane, with PNG at the pane's DPI and a copyable SVG
    expect(document.querySelector(`[aria-label="Download PNG"]`)).not.toBeNull()
    expect(document.querySelector(`[aria-label="Copy SVG to clipboard"]`)).not.toBeNull()
  })
})
