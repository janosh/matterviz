import element_data from '$lib/element/data'
import { expect, test } from '@playwright/test'

const n_tests = 2
// Increase timeout for this specific test file as it loads n_tests pages
test.setTimeout(10_000 * n_tests)

test.describe(`Element detail page`, async () => {
  test(`has periodicity plot`, async ({ page }) => {
    // test specific elements (consistent rather than random)
    const test_elements = [element_data[0], element_data[5]] // Hydrogen and Carbon

    for (const random_element of test_elements) {
      // Retry navigation in case of initial failure
      let retries = 3
      let success = false

      while (retries > 0 && !success) {
        try {
          await page.goto(`/${random_element.name.toLowerCase()}`, {
            waitUntil: `networkidle`,
            timeout: 15000,
          })

          // Wait for and check the h2 element content
          const h2_locator = page.locator(`h2`)
          await expect(h2_locator).toBeVisible({ timeout: 15000 })
          await expect(h2_locator).toContainText(
            `${random_element.number} - ${random_element.name}`,
          )
          success = true
        } catch (error) {
          retries--
          if (retries === 0) throw error
          await page.waitForTimeout(1000)
        }
      }

      // should have brief element description
      const description_locator = page.locator(`text=${random_element.summary}`)
      await expect(description_locator).toBeVisible()

      // should have Bohr model SVG - be more specific to avoid matching multiple SVGs
      const bohr_svg = page.locator(`svg circle.nucleus`).first()
      await expect(bohr_svg).toBeVisible()
    }
  })
})
