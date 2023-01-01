import * as lib from '$lib'
import IndexPeriodicTable, { PeriodicTable, ScatterPlot } from '$lib'
import FilePeriodicTable from '$lib/PeriodicTable.svelte'
import FileScatterPlot from '$lib/ScatterPlot.svelte'
import { expect, test } from 'vitest'

test(`PeriodicTable is named and default export`, () => {
  expect(IndexPeriodicTable).toBe(PeriodicTable)
  expect(FilePeriodicTable).toBe(PeriodicTable)
})

test(`ScatterPlot is named export`, () => {
  expect(FileScatterPlot).toBe(ScatterPlot)
})

test(`lib exports PeriodicTable and ScatterPlot`, () => {
  expect(Object.entries(lib).length).toBeGreaterThan(8)
})
