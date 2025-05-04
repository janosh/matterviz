import element_data from '$lib/element/data'
import { expect, test } from '@playwright/test'

const n_tests = 2
// Increase timeout for this specific test file as it loads n_tests pages
test.setTimeout(10_000 * n_tests)

test.describe(`Element detail page`, async () => {
  test(`has periodicity plot`, async ({ page }) => {
    // test any 5 random elements
    for (const _ of Array(n_tests)) {
      const rand_idx = Math.floor(Math.random() * element_data.length)
      const random_element = element_data[rand_idx]

      await page.goto(`/${random_element.name.toLowerCase()}`, {
        waitUntil: `networkidle`,
      })

      expect(await page.textContent(`h2`)).toContain(
        `${random_element.number} - ${random_element.name}`,
      )

      // should have brief element description
      const description = await page.$(`text=${random_element.summary}`)
      expect(description).toBeTruthy()

      // should have Bohr model SVG
      expect(await page.$(`svg > circle.nucleus + text + g.shell`)).toBeTruthy()
    }
  })
})
