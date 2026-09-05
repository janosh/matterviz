import { expect, test } from '@playwright/test'

test(`condition selection preserves the sweep and experiment edits without mobile overflow`, async ({
  page,
}) => {
  await page.goto(`/convex-hull/synthesis-planning`)
  const cells = page.locator(`.opportunity-map .map-grid button`)
  await expect(cells).toHaveCount(81, { timeout: 20000 })
  const first_cell = await cells.first().elementHandle()
  if (!first_cell) throw new Error(`Missing opportunity-map cell`)
  const temperature = page
    .locator(`.recipe-card`)
    .getByLabel(`Temperature (K)`, { exact: true })
  await temperature.fill(`1100`)
  await cells.nth(31).click()
  await expect(page.locator(`.summary`)).toContainText(`900 K`)
  await expect(temperature).toHaveValue(`1100`)
  expect(await first_cell.evaluate((element) => element.isConnected)).toBe(true)
  const mass = page.getByLabel(`Target mass (g)`)
  await mass.fill(``)
  await expect(page.locator(`.recipe-card [role="alert"]`)).toContainText(`greater than zero`)
  await mass.fill(`2`)
  await expect(page.locator(`.recipe-card tr.target td:nth-child(3)`)).toHaveText(`2`)
  for (const width of [600, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width)
  }
})
