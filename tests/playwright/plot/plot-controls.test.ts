import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const export_routes = [`ternary`, `box-plot`, `scatter-plot`, `histogram`, `bar-plot`]
export_routes.forEach((route) => {
  test(`${route} pane exports real SVG, CSV and PNG files`, async ({ page }) => {
    await page.goto(`/plot/${route}`, { waitUntil: `networkidle` })
    await page.locator(`button.pane-toggle`).first().click()
    const pane = page.locator(`.draggable-pane:visible`).first()
    for (const format of [`svg`, `csv`, `png`]) {
      const downloaded = page.waitForEvent(`download`)
      await pane.getByRole(`button`, { name: format.toUpperCase(), exact: true }).click()
      const download = await downloaded
      expect(await download.failure()).toBeNull()
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`))
      const path = await download.path()
      if (!path) throw new Error(`No downloaded ${format} file for ${route}`)
      const contents = await readFile(path)
      expect(contents.length).toBeGreaterThan(50)
      if (format === `png`) expect(contents.subarray(1, 4).toString()).toBe(`PNG`)
      else if (format === `svg`) expect(contents.toString()).toContain(`<svg`)
      else expect(contents.toString().split(`\n`).length).toBeGreaterThan(2)
    }
  })
})

const reset_cases = [
  [`ternary`, `grid`, `Grid step`, `0.25`],
  [`sunburst`, `sunburst`, `Max depth`, `3`],
  [`treemap`, `treemap`, `Max depth`, `3`],
  [`sankey`, `sankey`, `Node width`, `40`],
  [`box-plot`, `box / violin`, `Orientation`, `horizontal`],
]
reset_cases.forEach(([route, section, label, value]) => {
  test(`${route} section reset clears its changed state`, async ({ page }) => {
    await page.goto(`/plot/${route}`, { waitUntil: `networkidle` })
    await page.locator(`button.pane-toggle`).first().click()
    const pane = page.locator(`.draggable-pane:visible`).first()
    const row = pane.locator(`label`).filter({ hasText: label }).first()
    if (route === `box-plot`) await row.locator(`select`).selectOption(value)
    else await row.locator(`input[type=number]`).fill(value)
    const reset = pane.getByRole(`button`, {
      name: `Reset ${section} to defaults`,
      exact: true,
    })
    await reset.click()
    await expect(reset).toHaveCount(0)
  })
})
