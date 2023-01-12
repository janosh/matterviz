import { ElementTile, element_data } from '$lib'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '.'

// test random element for increased robustness
const rand_idx = Math.floor(Math.random() * element_data.length)
const rand_element = element_data[rand_idx]

describe(`ElementTile`, () => {
  test(`renders element name, symbol and atomic number`, () => {
    new ElementTile({
      target: document.body,
      props: { element: rand_element },
    })

    const name = doc_query(`.name`)
    expect(name.textContent).toBe(rand_element.name)

    const symbol = doc_query(`.symbol`)
    expect(symbol.textContent).toBe(rand_element.symbol)

    const number = doc_query(`.atomic-number`)
    expect(number.textContent).toBe(rand_element.number.toString())
  })

  test(`forwards mouseenter and mouseleave events`, () => {
    const element_tile = new ElementTile({
      target: document.body,
      props: { element: rand_element },
    })

    const mouseenter = vi.fn()
    const mouseleave = vi.fn()

    element_tile.$on(`mouseenter`, mouseenter)
    element_tile.$on(`mouseleave`, mouseleave)

    const node = doc_query(`.element-tile`)
    if (!node) throw new Error(`DOM node not found`)

    node.dispatchEvent(new MouseEvent(`mouseenter`))
    node.dispatchEvent(new MouseEvent(`mouseleave`))

    expect(mouseenter).toHaveBeenCalledTimes(1)
    expect(mouseleave).toHaveBeenCalledTimes(1)
  })

  test(`applies bg_color as background color`, async () => {
    new ElementTile({
      target: document.body,
      props: { element: rand_element, bg_color: `red` },
    })

    const node = doc_query(`.element-tile`) as HTMLElement

    expect(node.style.backgroundColor).toBe(`red`)
  })

  // skipping for now as JSDOM doesn't actually apply the bg_color so ElementTile can't determine its text color from background
  test.skip.each([
    [`red`, `white`],
    [`#eee`, `black`],
    [`#ddd`, `black`],
    [`#cccccc`, `black`],
    [`green`, `white`],
    [`blue`, `white`],
    [`yellow`, `white`],
    [`orange`, `white`],
    [`purple`, `white`],
    [`white`, `black`],
    [`lightgray`, `black`],
  ])(
    `sets text_color based on lightness of bg_color`,
    async (bg_color, text_color) => {
      new ElementTile({
        target: document.body,
        props: { element: rand_element, bg_color },
      })

      const node = doc_query(`.element-tile`)

      expect(
        node.style.color,
        `got text_color=${node.style.color} for bg_color=${bg_color}, expected ${text_color}`
      ).toBe(text_color)
    }
  )
})
