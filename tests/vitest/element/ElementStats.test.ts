import { element_data, ElementStats } from '$lib'
import { format_num } from '$lib/labels'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'
import { doc_query } from '../setup'

describe(`ElementStats`, () => {
  test.each(element_data.slice(0, 5))(
    `renders the correct properties for chemical element=$symbol`,
    (element) => {
      mount(ElementStats, { target: document.body, props: { element } })

      const atomic_mass = doc_query(`div > section:nth-child(2) > strong`)
      expect(atomic_mass.textContent?.trim()).toBe(
        format_num(element.atomic_mass),
      )

      const density = doc_query(`div > section:nth-child(3) > strong`)
      expect(density.textContent?.trim()).toBe(format_num(element.density))

      const phase = doc_query(`div > section:nth-child(4) > strong`)
      expect(phase.textContent?.trim()).toBe(element.phase)

      const year = doc_query(`div > section:nth-child(5) > strong`)
      expect(year.textContent?.trim()).toBe(`${element.year}`)
    },
  )
})
