import { expect, test } from '@playwright/test'
import { require_bbox } from '../helpers'

test.describe(`RdfPlot Component Tests`, () => {
  // Retry for intermittent SSR warm-up issues
  test.describe.configure({ retries: 1 })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/rdf-plot`, { waitUntil: `networkidle` })
    // Wait for first plot to render (SVG paths take time to draw)
    await page.waitForSelector(`#single-pattern svg path`, { timeout: 15000 })
  })

  test(`single pattern renders labelled axes over the cutoff with non-negative g(r)`, async ({
    page,
  }) => {
    const plot = page.locator(`#single-pattern`)
    await expect(plot.locator(`svg path[fill="none"]`).first()).toBeVisible()
    await expect(plot.locator(`.axis-label.x-label`)).toBeVisible()
    await expect(plot.locator(`.axis-label.y-label`)).toBeVisible()
    for (const axis of [`x`, `y`]) {
      await expect(plot.locator(`g.${axis}-axis .tick text`).nth(1)).toBeVisible()
    }
    // x spans 0 to the cutoff of 10
    const x_ticks = (await plot.locator(`g.x-axis .tick text`).allTextContents()).map(Number)
    expect(x_ticks.length).toBeGreaterThan(1)
    expect(x_ticks[0]).toBeCloseTo(0, 1)
    expect(x_ticks.at(-1)).toBeLessThanOrEqual(12)
    const y_values = (await plot.locator(`g.y-axis .tick text`).allTextContents())
      .map(parseFloat)
      .filter((val) => !isNaN(val))
    expect(y_values.length).toBeGreaterThan(0)
    for (const val of y_values) expect(val).toBeGreaterThanOrEqual(0)
  })

  test(`multiple patterns get a legend that toggles series visibility`, async ({ page }) => {
    const plot = page.locator(`#multi-pattern`)
    const items = plot.locator(`.legend .legend-item`)
    await expect(items).toHaveCount(2)
    const visible_lines = plot.locator(`svg path[fill="none"]:visible`)
    await expect(visible_lines).toHaveCount(2)
    await items.first().click()
    await expect(visible_lines).toHaveCount(1)
    await items.first().click()
    await expect(visible_lines).toHaveCount(2)
  })

  test(`tooltip shows x and y values on hover`, async ({ page }) => {
    const plot = page.locator(`#single-pattern`)
    // Select the main plot SVG (has role="application" and contains the x-axis)
    const box = await require_bbox(plot.locator(`svg:has(g.x-axis)`), `RDF plot svg`)

    const tooltip = plot.locator(`.plot-tooltip`)
    // Two-phase move (enter SVG to set hovered, then move across the plot so the
    // nearest-point tooltip appears) — a single hover() is unreliable headless.
    await expect(async () => {
      await page.mouse.move(box.x + 10, box.y + 10)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await expect(tooltip).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 5000 })

    await expect(tooltip).toContainText(/r:\s*-?\d+\.?\d*\s+Å/)
    await expect(tooltip).toContainText(/g\(r\):\s*-?\d+\.?\d*/)
    await expect(tooltip.locator(`small`)).toHaveText([`Å`])
  })

  test(`calculates RDFs from structures per element pair, in full and across structures`, async ({
    page,
  }) => {
    // element-pairs mode draws one labelled series per pair, full mode a single average
    const ep_plot = page.locator(`#single-structure-element-pairs-plot`)
    await expect(ep_plot.locator(`.legend`)).toBeVisible()
    expect(await ep_plot.locator(`svg path[fill="none"]`).count()).toBeGreaterThan(1)
    await expect(ep_plot.locator(`.legend-item`).first()).toHaveText(/[A-Z][a-z]?-[A-Z][a-z]?/)
    await expect(page.locator(`#single-structure-full svg path[fill="none"]`)).toHaveCount(1)

    const multi = page.locator(`#multi-structure`)
    await expect(multi.locator(`.legend-item`)).toHaveCount(3)
    await expect(multi.locator(`svg path[fill="none"]`)).toHaveCount(3)
  })
})
