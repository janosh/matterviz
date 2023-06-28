import { expect, test } from '@playwright/test'
import element_data from '../src/lib/element/data.js'

test.describe(`Element detail page`, async () => {
  test(`has periodicity plot`, async ({ page }) => {
    // test any 5 random elements
    for (const _ of Array(5)) {
      const rand_idx = Math.floor(Math.random() * element_data.length)
      const random_element = element_data[rand_idx]

      await page.goto(`/${random_element.name.toLowerCase()}`, {
        waitUntil: `networkidle`,
      })

      // titles should have dash-separated element number and name
      expect(await page.textContent(`h2`)).toContain(
        `${random_element.number} - ${random_element.name}`
      )

      // should have brief element description
      const description = await page.$(`text=${random_element.summary}`)
      expect(description).toBeTruthy()

      // should have Bohr model SVG
      expect(await page.$(`svg > circle.nucleus + text + g.shell`)).toBeTruthy()
    }
  })
})
