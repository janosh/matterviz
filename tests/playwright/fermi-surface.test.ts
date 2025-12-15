// E2E tests for Fermi surface visualization page
import { expect, test } from '@playwright/test'

test.describe(`Fermi Surface Demo Page`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/fermi-surface`)
  })

  test(`page loads with correct title`, async ({ page }) => {
    await expect(page).toHaveTitle(/Fermi Surface/i)
  })

  test(`displays intro text and features`, async ({ page }) => {
    await expect(page.locator(`h1`)).toContainText(`Fermi Surface`)
    // Intro paragraph with .intro class
    await expect(page.locator(`p.intro`)).toBeVisible()
    // Features section contains a heading and list
    const features_heading = page.locator(`h2`, { hasText: `Features` })
    await expect(features_heading).toBeVisible()
  })

  test(`FilePicker shows sample files`, async ({ page }) => {
    const file_picker = page.locator(`.file-picker`)
    await expect(file_picker).toBeVisible()

    // Should have at least one file item
    const file_items = page.locator(`.file-item`)
    await expect(file_items.first()).toBeVisible()
  })

  test(`FermiSurface component renders with default file`, async ({ page }) => {
    // Page auto-loads a default BXSF file, so we should see the fermi surface container
    const fermi_container = page.locator(`.fermi-surface`)
    await expect(fermi_container).toBeVisible({ timeout: 10000 })
  })

  test(`features list displays all feature items`, async ({ page }) => {
    // Features are in a <ul> with <li> elements containing <strong> tags
    const feature_items = page.locator(`section ul li strong`)
    await expect(feature_items).toHaveCount(6)

    // Check some feature content
    await expect(page.locator(`li`, { hasText: `BXSF` })).toBeVisible()
    await expect(page.locator(`li`, { hasText: `Property Coloring` })).toBeVisible()
  })
})
