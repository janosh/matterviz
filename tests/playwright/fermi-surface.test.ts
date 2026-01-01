// E2E tests for Fermi surface visualization page
import { expect, test } from '@playwright/test'

test.describe(`Fermi Surface Demo Page`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/reciprocal/fermi-surface`, { waitUntil: `networkidle` })
    // Wait for page to render with the h1 visible
    await expect(page.locator(`h1`)).toBeVisible()
  })

  test(`page loads with correct title`, async ({ page }) => {
    await expect(page).toHaveTitle(/Fermi Surface/i)
  })

  test(`displays intro text and features`, async ({ page }) => {
    await expect(page.locator(`h1`)).toContainText(`Fermi Surface`)
    // Intro paragraph with .intro class
    await expect(page.locator(`p.intro`)).toBeVisible()
    // Features section: look for a section containing a Features heading
    const features_section = page.locator(`section`).filter({
      has: page.locator(`h2`, { hasText: `Features` }),
    })
    await expect(features_section).toBeVisible()
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
})
