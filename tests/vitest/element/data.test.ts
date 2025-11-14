import { element_data } from '$lib/element'
import { CATEGORY_COUNTS as expected_counts } from '$lib/labels'
import { expect, test } from 'vitest'

test(`element data`, () => {
  expect(element_data.length).toBe(118)
  expect(element_data[0].name).toBe(`Hydrogen`)

  expect(element_data[0].category).toBe(`diatomic nonmetal`)
  expect(element_data[0].number).toBe(1)
  expect(element_data[0].atomic_mass).toBe(1.008)
  expect(element_data[0].electronegativity).toBe(2.2)
  expect(element_data[0].electron_configuration).toBe(`1s1`)

  // all elements should have a density
  expect(element_data.every((el) => typeof el.density === `number`)).toBe(true)
})

test(`category counts`, () => {
  const CATEGORY_COUNTS: Record<string, number> = {}
  for (const { category } of element_data) {
    CATEGORY_COUNTS[category] = (CATEGORY_COUNTS[category] ?? 0) + 1
  }
  expect(CATEGORY_COUNTS).toEqual(expected_counts)
})
