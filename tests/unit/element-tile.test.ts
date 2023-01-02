import { element_data } from '$lib'
import ElementTile from '$lib/ElementTile.svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ``
})

// test random element for increased robustness
const rand_idx = Math.floor(Math.random() * element_data.length)
const rand_element = element_data[rand_idx]

describe(`ElementTile`, () => {
  test(`renders element name, symbol and atomic number`, () => {
    new ElementTile({
      target: document.body,
      props: { element: rand_element },
    })

    const name = document.querySelector(`.name`)
    expect(name?.textContent).toBe(rand_element.name)

    const symbol = document.querySelector(`.symbol`)
    expect(symbol?.textContent).toBe(rand_element.symbol)

    const number = document.querySelector(`.atomic-number`)
    expect(number?.textContent).toBe(rand_element.number.toString())
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

    const node = document.querySelector(`.element-tile`)
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

    const node = document.querySelector(`.element-tile`) as HTMLElement

    expect(node.style.backgroundColor).toBe(`red`)
  })
})
