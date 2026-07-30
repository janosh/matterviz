import { expect, test } from '@playwright/test'
import { expect_bottom_within, get_chart_svg } from './helpers'

test.describe(`XrdPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/xrd-plot`, { waitUntil: `networkidle` })
  })

  test(`renders single series with axis labels and bars`, async ({ page }) => {
    const plot = page.locator(`#single-pattern .bar-plot`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
    // Bars are rendered as path elements inside .bar-series
    await expect(plot.locator(`svg .bar-series path`).first()).toBeVisible()
    await expect_bottom_within(get_chart_svg(plot), plot.locator(`.axis-label.x-label`))
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
    // The first peak lies on the y-axis; use the unobstructed second peak.
    const bar = plot.locator(`svg .bar-series path`).nth(1)
    await expect(bar).toBeVisible()
    await bar.hover()

    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`2θ: 30°`)
    await expect(tooltip).toContainText(`hkl: 110`)
    await expect(tooltip).toContainText(`d: 2.98 Å`)
  })

  test(`legend appears for multiple patterns and toggles series`, async ({ page }) => {
    const plot = page.locator(`#multi-pattern .bar-plot`)
    await expect(plot).toBeVisible()
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    const items = legend.locator(`.legend-item`)
    await expect(items).toHaveCount(2)

    // Bars are rendered as path elements inside .bar-series
    const pre_toggle = await plot.locator(`svg .bar-series path`).count()
    expect(pre_toggle).toBeGreaterThan(0)

    await items.first().click()
    // Wait for series to be hidden (fewer paths visible)
    await expect(async () => {
      const after_toggle = await plot.locator(`svg .bar-series path`).count()
      expect(after_toggle).toBeLessThan(pre_toggle)
    }).toPass({ timeout: 3000 })

    await items.first().click()
    // Wait for series to be restored
    await expect(async () => {
      const restored = await plot.locator(`svg .bar-series path`).count()
      expect(restored).toBeGreaterThanOrEqual(pre_toggle)
    }).toPass({ timeout: 3000 })
  })
})
