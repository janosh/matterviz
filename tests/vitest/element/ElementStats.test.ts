import element_data from '#lib/element/data.js'
import ElementStats from '#lib/element/ElementStats.svelte'
import { format_num } from '#lib/labels.js'
import { mount } from 'svelte'
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
})
