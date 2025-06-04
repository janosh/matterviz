import element_data from '$lib/element/data'
import { expect, test } from '@playwright/test'

const n_tests = 2
// Increase timeout for this specific test file as it loads n_tests pages
test.setTimeout(10_000 * n_tests)

test.describe(`Element detail page`, async () => {
  test(`has periodicity plot`, async ({ page }) => {
    // test any 2 random elements
    for (const _ of Array(n_tests)) {
      const rand_idx = Math.floor(Math.random() * element_data.length)
      const random_element = element_data[rand_idx]

      await page.goto(`/${random_element.name.toLowerCase()}`, {
        waitUntil: `networkidle`,
      })

      // Wait for and check the h2 element content
      const h2_locator = page.locator(`h2`)
      await expect(h2_locator).toBeVisible()
      await expect(h2_locator).toContainText(
        `${random_element.number} - ${random_element.name}`,
      )

      // should have brief element description
      const description_locator = page.locator(`text=${random_element.summary}`)
      await expect(description_locator).toBeVisible()

      // should have Bohr model SVG - be more specific to avoid matching multiple SVGs
      const bohr_svg = page.locator(`svg circle.nucleus`).first()
      await expect(bohr_svg).toBeVisible()
    }
  })
})
