import { expect, test } from '@playwright/test'

test.describe(`structure info pane`, () => {
  test(`should display structure information`, async ({ page }) => {
    await page.goto(`/test/structure`)
    await expect(page.locator(`#structure-info-pane`)).toBeVisible()
  })
})
