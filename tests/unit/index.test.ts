import * as lib from '$lib'
import { ElementScatter, PeriodicTable } from '$lib'
import * as labels from '$lib/labels'
import DirectImportPeriodicTable from '$lib/periodic-table/PeriodicTable.svelte'
import DirectImportElementScatter from '$lib/plot/ElementScatter.svelte'
import { expect, test } from 'vitest'

test(`PeriodicTable is named and default export`, () => {
  expect(DirectImportPeriodicTable).toBe(PeriodicTable)
})

test(`ElementScatter is named export`, () => {
  expect(DirectImportElementScatter).toBe(ElementScatter)
})

test(`src/lib/icons/index.ts re-exports all components`, () => {
  const components = Object.keys(import.meta.glob(`$lib/*.svelte`)).map(
    (path) => path.split(`/`).pop()?.split(`.`).shift(),
  )
  expect(Object.keys(lib)).toEqual(expect.arrayContaining(components))
})

test(`categories and element_symbols are exported`, () => {
  expect(labels.categories).toHaveLength(10)
  expect(labels.elem_symbols).toHaveLength(lib.element_data.length)
})
