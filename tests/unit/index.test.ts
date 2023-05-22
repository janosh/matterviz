import * as lib from '$lib'
import IndexPeriodicTable, { ElementScatter, PeriodicTable } from '$lib'
import FileElementScatter from '$lib/ElementScatter.svelte'
import * as labels from '$lib/labels'
import FilePeriodicTable from '$lib/PeriodicTable.svelte'
import { expect, test } from 'vitest'

test(`PeriodicTable is named and default export`, () => {
  expect(IndexPeriodicTable).toBe(PeriodicTable)
  expect(FilePeriodicTable).toBe(PeriodicTable)
})

test(`ElementScatter is named export`, () => {
  expect(FileElementScatter).toBe(ElementScatter)
})

test(`src/lib/icons/index.ts re-exports all components`, () => {
  const components = Object.keys(import.meta.glob(`$lib/*.svelte`)).map(
    (path) => path.split(`/`).pop()?.split(`.`).shift()
  )
  expect(Object.keys(lib)).toEqual(expect.arrayContaining(components))
})

test(`categories and element_symbols are exported`, () => {
  expect(labels.categories).toHaveLength(10)
  expect(labels.elem_symbols).toHaveLength(lib.element_data.length)
})
