import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect_centered, require_bbox } from '../helpers'

// Cover ChartShell and the convex-hull toolbar in addition to the nested viewers in Trajectory.
// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const [route, toolbar] of [
  [`/plot/sankey`, `.header-controls`],
  [`/plot/scatter-plot`, `.header-controls`],
  [`/plot/histogram`, `.header-controls`],
  [`/plot/bar-plot`, `.header-controls`],
  [`/plot/box-plot`, `.header-controls`],
  [`/test/convex-hull-performance?dim=2d&count=100`, `.convex-hull-toolbar`],
]) {
  test(`${route} toolbar keeps icons sized and vertically aligned`, async ({ page }) => {
    await page.goto(route, { waitUntil: `networkidle` })
    const row = page.locator(toolbar).first()
    const icons = row.locator(`:scope > button > svg`)
    await expect(icons.first()).toBeAttached()
    await row.locator(`..`).hover()
    await expect(row).toHaveCSS(`opacity`, `1`)
    for (const button of await row.locator(`:scope > button`).all()) {
      await expect(button).toHaveCSS(`opacity`, `1`)
    }
    expect(await icons.count()).toBeGreaterThanOrEqual(2)
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)
    for (const icon of await icons.all()) {
      await expect(icon).toHaveCSS(`width`, size)
      await expect(icon).toHaveCSS(`height`, size)
    }
    // A custom header control can make the row taller than its icon buttons.
    for (const height of [null, `48px`]) {
      if (height)
        await row.evaluate((element, value) => {
          element.style.height = value
        }, height)
      const first = await require_bbox(icons.first())
      for (const icon of await icons.all())
        expect_centered(await require_bbox(icon), first, `y`)
    }
  })
}

const export_routes = [`ternary`, `box-plot`, `scatter-plot`, `histogram`, `bar-plot`]
export_routes.forEach((route) => {
  test(`${route} pane exports real SVG, CSV and PNG files`, async ({ page }) => {
    await page.goto(`/plot/${route}`, { waitUntil: `networkidle` })
    await page.locator(`button.pane-toggle`).first().click()
    const pane = page.locator(`.draggable-pane:visible`).first()
    await pane.getByRole(`textbox`, { name: `File name`, exact: true }).fill(`My ${route}`)
    for (const format of [`svg`, `csv`, `png`]) {
      const downloaded = page.waitForEvent(`download`)
      await pane.getByRole(`button`, { name: format.toUpperCase(), exact: true }).click()
      const download = await downloaded
      expect(await download.failure()).toBeNull()
      expect(download.suggestedFilename()).toBe(`My ${route}.${format}`)
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
    // Both grid and flow sections separate their stacked rows.
    for (const settings_section of await pane
      .locator(`.settings-section:not(.ctrl-line):not(.axis-fields)`)
      .all()) {
      const gap = await settings_section.evaluate(
        (element) => getComputedStyle(element).rowGap,
      )
      expect(Number(gap.slice(0, -2))).toBeGreaterThan(0)
    }
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
