import { expect, test } from '@playwright/test'
import { category_counts } from './element-data.test.ts'

test(`periodic table in default state`, async ({ page }) => {
  await page.goto(`/`)

  expect(await page.$$(`.element-tile`)).toHaveLength(118)

  for (const [category, count] of Object.entries(category_counts)) {
    const css_cls = `.${category.replaceAll(` `, `-`)}`
    expect(await page.$$(css_cls)).toHaveLength(count)
  }
})

test(`periodic table shows stats on hover element`, async ({ page }) => {
  await page.goto(`/`)

  await page.hover(`text=Hydrogen`)

  expect(await page.$(`text=1 - Hydrogen diatomic nonmetal`)).not.toBeNull()
})

test(`periodic table in heatmap mode`, async ({ page }) => {
  test.skip(
    process.env.CI === `true`,
    `This test fails in CI at clicking click('text=Electronegativity')`
    // works locally, maybe due to faster CPU
  )

  await page.goto(`/`)

  await page.click(`[placeholder="Select a heat map"]`)

  // select electronegativity heatmap
  await page.click(`text=Electronegativity`)

  // make sure Fluorine electronegativity value is displayed correctly
  expect(await page.$(`text=9 F 3.98`)).not.toBeNull()
})
