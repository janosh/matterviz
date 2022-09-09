import { expect, test } from '@playwright/test'

import element_data from '$lib/element-data.ts'
import type { ChemicalElement } from '$lib/types'

test(`element data`, async () => {
  expect(element_data.length).toBe(118)
  expect(element_data[0].name).toBe(`Hydrogen`)

  expect(element_data[0].category).toBe(`diatomic nonmetal`)
  expect(element_data[0].number).toBe(1)
  expect(element_data[0].atomic_mass).toBe(1.008)
  expect(element_data[0].electronegativity).toBe(2.2)
  expect(element_data[0].electron_configuration).toBe(`1s1`)

  // all elements should have a density
  expect(
    element_data.every((el: ChemicalElement) => typeof el.density === `number`)
  ).toBe(true)
})
