// deno-lint-ignore-file no-await-in-loop
import element_data from '$lib/element/data'
import { expect, test } from '@playwright/test'
import process from 'node:process'

test.describe(`Element detail page`, () => {
  test.beforeEach(() => {
    test.skip(process.env.CI === `true`, `Element detail pages timeout in CI`)
  })

  test(`has periodicity plot`, async ({ page }) => {
    // Test specific elements (Hydrogen and Carbon)
    const test_elements = [element_data[0], element_data[5]]

    for (const element of test_elements) {
      // Longer timeout for CI - page load can be slow
      await page.goto(`/${element.name.toLowerCase()}`, {
        waitUntil: `networkidle`,
        timeout: 15000,
      })

      // Wait for and check the h2 element content
      const h2_locator = page.locator(`h2`)
      await expect(h2_locator).toBeVisible({ timeout: 5000 })
      await expect(h2_locator).toContainText(
        `${element.number} - ${element.name}`,
      )

      // should have brief element description
      const description_locator = page.locator(`text=${element.summary}`)
      await expect(description_locator).toBeVisible()

      // should have Bohr model SVG - be more specific to avoid matching multiple SVGs
      const bohr_svg = page.locator(`svg circle.nucleus`).first()
      await expect(bohr_svg).toBeVisible()
    }
  })
})
