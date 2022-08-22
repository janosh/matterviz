import { expect, test } from '@playwright/test'

import element_data from '../src/lib/periodic-table-data.ts'

export const category_counts: Record<string, number> = {}

for (const { category } of element_data) {
  if (category in category_counts) category_counts[category] += 1
  else category_counts[category] = 1
}

test(`element data`, async () => {
  expect(element_data.length).toBe(118)
  expect(element_data[0].name).toBe(`Hydrogen`)
})
