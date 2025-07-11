import { BohrAtom } from '$lib'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`BohrAtom`, () => {
  test.each([
    [`H`, `Hydrogen`, [1]],
    [`He`, `Helium`, [2]],
    [`Li`, `Lithium`, [2, 1]],
    [`Be`, `Beryllium`, [2, 2]],
    [`O`, `Oxygen`, [2, 6]],
  ])(
    `renders with custom styles and properties`,
    (symbol, name, shells) => {
      mount(BohrAtom, {
        target: document.body,
        props: {
          symbol,
          name,
          shells,
          adapt_size: true,
          shell_width: 15,
          nucleus_props: { r: 25, fill: `red` },
          electron_props: { r: 4, fill: `green` },
          style: `width: 300px;`,
        },
      })

      const nucleus = doc_query(`.nucleus`)
      expect(nucleus.getAttribute(`r`)).toBe(`25`)
      expect(nucleus.getAttribute(`fill`)).toBe(`red`)

      const text = doc_query(`text`)
      expect(text.textContent).toBe(symbol)

      const svg = doc_query(`svg`)
      expect(svg.getAttribute(`style`)).toBe(`width: 300px;`)

      const electron = document.querySelectorAll(`.electron`)
      expect(electron.length).toBe(shells.reduce((a, b) => a + b, 0))
    },
  )
})
