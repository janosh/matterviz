import { expect, test } from '@playwright/test'

test(`condition selection preserves the sweep and experiment edits without mobile overflow`, async ({
  page,
}) => {
  await page.goto(`/convex-hull/synthesis-planning`)
  const cells = page.locator(`.opportunity-map .map-grid button`)
  await expect(cells).toHaveCount(81, { timeout: 20000 })
  const add_route = page.locator(`.route-comparison select`)
  for (const count of [3, 4]) {
    await add_route.selectOption({ index: 1 })
    await expect(page.locator(`.route-comparison h3`)).toHaveText(
      `Compare routes (${count}/4)`,
    )
  }
  await expect(add_route).toBeDisabled()
  await page.evaluate(() => document.fonts.ready)
  const competitors = page.locator(`.route-comparison tbody tr`).filter({
    has: page.getByRole(`rowheader`, { name: `More favorable competitors`, exact: true }),
  })
  const preview = competitors.locator(`button.cell-preview`).first()
  const row_height = await competitors.evaluate((row) => row.getBoundingClientRect().height)
  await expect(preview).toHaveCSS(`-webkit-line-clamp`, `8`)
  expect(row_height).toBeGreaterThan(120)
  expect(row_height).toBeLessThan(220)
  await preview.hover()
  const popup = page.getByRole(`dialog`, { name: `More favorable competitors`, exact: true })
  await expect(popup).toBeVisible()
  expect(await popup.textContent()).toBe(await preview.textContent())
  expect(await competitors.evaluate((row) => row.getBoundingClientRect().height)).toBe(
    row_height,
  )
  await popup.hover()
  await popup.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  expect(await popup.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press(`Escape`)
  await expect(popup).toBeHidden()
  await preview.focus()
  await expect(popup).toBeVisible()
  await page.keyboard.press(`Escape`)
  const wrapped = page
    .locator(`.route-comparison tbody tr`)
    .filter({
      has: page.getByRole(`rowheader`, { name: `Model conditions`, exact: true }),
    })
    .locator(`.cell-preview`)
    .first()
  expect((await wrapped.textContent())?.length).toBeLessThan(120)
  const compact_style = await page.addStyleTag({
    content: `.route-comparison tbody tr:nth-child(7) .cell-preview { -webkit-line-clamp: 1 !important; width: 8em }`,
  })
  await expect(wrapped).toHaveJSProperty(`tagName`, `BUTTON`)
  await expect(wrapped).toHaveCSS(`-webkit-line-clamp`, `1`)
  await wrapped.hover()
  const wrapped_popup = page.getByRole(`dialog`, { name: `Model conditions`, exact: true })
  await expect(wrapped_popup).toBeVisible()
  expect(await wrapped_popup.textContent()).toBe(await wrapped.textContent())
  await page.keyboard.press(`Escape`)
  await compact_style.evaluate((element) => element.parentNode?.removeChild(element))
  await expect(wrapped).toHaveJSProperty(`tagName`, `SPAN`)
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
