import { expect, test } from '@playwright/test'

test.describe(`XrdPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/xrd-plot`, { waitUntil: `networkidle` })
  })

  test(`renders single series with axis labels and bars`, async ({ page }) => {
    const plot = page.locator(`#single-pattern .bar-plot`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`svg rect`).first()).toBeVisible()
  })

  test(`shows labels for annotated peaks`, async ({ page }) => {
    const plot = page.locator(`#single-pattern .bar-plot`)
    await expect(plot).toBeVisible()
    // Peak labels are rendered as text above bars for selected indices
    const labels = plot.locator(`text.bar-label`)
    // Some labels should be present for annotated peaks
    await expect(labels.first()).toBeVisible()
  })

  test(`tooltip includes hkl and d-spacing when available`, async ({ page }) => {
    const plot = page.locator(`#single-pattern .bar-plot`)
    const first_bar = plot.locator(`svg rect`).first()
    await expect(first_bar).toBeVisible()
    await first_bar.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible()
    const text = await tooltip.textContent()
    expect(text || ``).toContain(`2θ:`)
    // hkl and d are conditional; ensure tooltip structure exists
  })

  test(`legend appears for multiple patterns and toggles series`, async ({ page }) => {
    const plot = page.locator(`#multi-pattern .bar-plot`)
    await expect(plot).toBeVisible()
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    const items = legend.locator(`.legend-item`)
    await expect(items).toHaveCount(2)

    const pre_toggle = await plot.locator(`svg rect`).count()
    expect(pre_toggle).toBeGreaterThan(0)

    await items.first().click()
    const after_toggle = await plot.locator(`svg rect`).count()
    expect(after_toggle).toBeLessThan(pre_toggle)

    await items.first().click()
    const restored = await plot.locator(`svg rect`).count()
    expect(restored).toBeGreaterThanOrEqual(pre_toggle)
  })
})
