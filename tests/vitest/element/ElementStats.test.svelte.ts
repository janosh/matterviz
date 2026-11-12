import element_data from '#lib/element/data.js'
import ElementStats from '#lib/element/ElementStats.svelte'
import { format_num } from '#lib/labels.js'
import { flushSync, mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`ElementStats`, () => {
  test.each(element_data.slice(0, 5))(
    `renders the correct properties for chemical element=$symbol`,
    (element) => {
      mount(ElementStats, { target: document.body, props: { element } })

      const { atomic_mass, density, phase, year } = element
      const values = [2, 3, 4, 5].map((nth) =>
        doc_query(`div > section:nth-child(${nth}) > strong`).textContent?.trim(),
      )
      expect(values).toEqual([format_num(atomic_mass), format_num(density), phase, `${year}`])
      const units = [...document.querySelectorAll(`abbr`)].map((abbr) => abbr.textContent)
      expect(units).toEqual([`(u)`, `(g/cm³)`])
    },
  )

  // the outgoing element lingers in its own layer while the new one fades in over it
  test(`hovering a new element crossfades the old and new stats`, () => {
    const props = $state({ element: element_data[0] })
    mount(ElementStats, { target: document.body, props })
    props.element = element_data[1]
    flushSync()
    const headings = [...document.querySelectorAll(`.element-stats > .layer h2`)].map(
      (heading) => heading.textContent?.replaceAll(/\s+/g, ` `).trim(),
    )
    expect(headings.toSorted()).toEqual([
      `1 - Hydrogen diatomic nonmetal`,
      `2 - Helium noble gas`,
    ])
  })
})
