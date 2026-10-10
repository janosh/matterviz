import * as lib from '#lib'
import * as labels from '#lib/labels.js'
import { expect, test } from 'vitest'

test(`library exports all Svelte components from #lib/*.svelte`, () => {
  const svelte_files = Object.keys(import.meta.glob(`#lib/*.svelte`))
    .map((path) => path.split(`/`).pop()?.split(`.`).shift())
    .filter((name): name is string => name !== undefined)
  const lib_exports = Object.keys(lib)
  for (const component of svelte_files) {
    expect(lib_exports).toContain(component)
  }
})

test(`ELEMENT_CATEGORIES and ELEM_SYMBOLS match element_data`, () => {
  const categories = new Set(lib.element_data.map((elem) => elem.category))
  expect(categories).toEqual(new Set(labels.ELEMENT_CATEGORIES))
  expect(labels.ELEM_SYMBOLS).toEqual(lib.element_data.map((elem) => elem.symbol))
})

test(`root exports is_binary without misclassifying sparse high bytes`, () => {
  expect(lib.is_binary).toBeTypeOf(`function`)
  expect(lib.is_binary(`\u00FF${`a`.repeat(20)}`)).toBe(false)
})
