import * as lib from '$lib'
import IndexPeriodicTable, { ElementScatter, PeriodicTable } from '$lib'
import FileElementScatter from '$lib/ElementScatter.svelte'
import FilePeriodicTable from '$lib/PeriodicTable.svelte'
import { expect, test } from 'vitest'

test(`PeriodicTable is named and default export`, () => {
  expect(IndexPeriodicTable).toBe(PeriodicTable)
  expect(FilePeriodicTable).toBe(PeriodicTable)
})

test(`ElementScatter is named export`, () => {
  expect(FileElementScatter).toBe(ElementScatter)
})

test(`lib has named component exports`, () => {
  expect(Object.entries(lib).length).toBeGreaterThan(8)
})
