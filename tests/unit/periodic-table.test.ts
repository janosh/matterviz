import PeriodicTable from '$lib/PeriodicTable.svelte'
import { beforeEach, describe, expect, test } from 'vitest'

beforeEach(() => {
  document.body.innerHTML = ``
})

async function sleep(ms = 1) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe(`PeriodicTable`, () => {
  test(`renders element tiles`, async () => {
    new PeriodicTable({ target: document.body })

    const element_tiles = document.querySelectorAll(`.element-tile`)
    expect(element_tiles.length).toBe(118)
  })

  test(`has no text content when symbols, names and numbers are disabled`, async () => {
    new PeriodicTable({
      target: document.body,
      props: {
        show_symbols: false,
        show_names: false,
        show_numbers: false,
        // style: `width: 500px; height: 100px;`,
      },
    })

    const ptable = document.querySelector(`.periodic-table`)

    expect(ptable?.textContent?.trim()).toBe(``)

    // make sure empty tiles are still rendered
    const symbol_tiles = document.querySelectorAll(`.element-tile`)
    expect(symbol_tiles.length).toBe(118)
  })

  test(`hovered element tile has border`, async () => {
    new PeriodicTable({ target: document.body })

    const element_tile = document.querySelector(`.element-tile`)
    if (!element_tile) {
      throw new Error(`No element tile found`)
    }

    element_tile?.dispatchEvent(new MouseEvent(`mouseenter`))
    await sleep()
    expect([...element_tile.classList]).toContain(`active`)

    element_tile?.dispatchEvent(new MouseEvent(`mouseleave`))
    await sleep()
    expect([...element_tile.classList]).not.toContain(`active`)
  })
})
