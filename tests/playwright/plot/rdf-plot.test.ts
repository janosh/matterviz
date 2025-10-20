import { expect, test } from '@playwright/test'

test.describe(`RdfPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/rdf-plot`, { waitUntil: `networkidle` })
  })

  // Test basic rendering with single and multiple patterns
  test(`renders patterns with axes and legend`, async ({ page }) => {
    // Single pattern
    const single = page.locator(`#single-pattern`)
    await expect(single).toBeVisible()
    await expect(single.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(single.locator(`g.y-axis .tick`).first()).toBeVisible()
    await expect(single.locator(`svg path.series-line`).first()).toBeVisible()

    // Multiple patterns with legend
    const multi = page.locator(`#multi-pattern`)
    await expect(multi).toBeVisible()
    await expect(multi.locator(`.legend`)).toBeVisible()
    await expect(multi.locator(`.legend-item`)).toHaveCount(2)
    await expect(multi.locator(`svg path.series-line`)).toHaveCount(2)
  })

  // Test legend interactivity
  test(`legend toggles series visibility`, async ({ page }) => {
    const plot = page.locator(`#multi-pattern`)
    const items = plot.locator(`.legend-item`)

    const initial_lines = await plot.locator(`svg path.series-line`).count()
    expect(initial_lines).toBe(2)

    await items.first().click()
    await page.waitForTimeout(100)

    const after_toggle = await plot.locator(`svg path.series-line:visible`).count()
    expect(after_toggle).toBeLessThan(initial_lines)

    await items.first().click()
    await page.waitForTimeout(100)

    expect(await plot.locator(`svg path.series-line:visible`).count()).toBe(initial_lines)
  })

  // Test tooltip
  test(`tooltip shows r and g(r) on hover`, async ({ page }) => {
    const plot = page.locator(`#single-pattern`)
    await plot.locator(`svg`).hover({ force: true, position: { x: 100, y: 100 } })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible()
    const text = await tooltip.textContent()
    expect(text || ``).toMatch(/r.*Å/)
    expect(text || ``).toContain(`g(r)`)
  })

  // Test reference line
  test(`reference line visibility`, async ({ page }) => {
    // Shown when enabled
    const with_ref = page.locator(`#reference-line`)
    await expect(with_ref.locator(`svg line[stroke="gray"][stroke-dasharray="4"]`))
      .toBeVisible()
    await expect(with_ref.locator(`svg text:has-text("g(r) = 1")`)).toBeVisible()

    // Hidden when disabled
    const no_ref = page.locator(`#no-reference-line`)
    await expect(no_ref.locator(`svg line[stroke="gray"][stroke-dasharray="4"]`)).not
      .toBeVisible()
    await expect(no_ref.locator(`svg text:has-text("g(r) = 1")`)).toBeHidden()
  })

  // Test structure-based RDF calculation in both modes
  test(`calculates RDF from structures`, async ({ page }) => {
    // Element pairs mode - multiple series
    const ep_plot = page.locator(`#single-structure-element-pairs`)
    await expect(ep_plot).toBeVisible()
    await expect(ep_plot.locator(`.legend`)).toBeVisible()
    const ep_lines_count = await ep_plot.locator(`svg path.series-line`).count()
    expect(ep_lines_count).toBeGreaterThanOrEqual(1)

    // Full mode - single averaged series
    const full_plot = page.locator(`#single-structure-full`)
    await expect(full_plot.locator(`svg path.series-line`)).toHaveCount(1)

    // Element pairs should have more lines than full mode
    expect(ep_lines_count).toBeGreaterThan(1)

    // Check legend labels for element pair format
    const first_label = await ep_plot.locator(`.legend-item`).first().textContent()
    expect(first_label).toMatch(/[A-Z][a-z]?-[A-Z][a-z]?/)
  })

  // Test multiple structures comparison
  test(`compares multiple structures`, async ({ page }) => {
    const plot = page.locator(`#multi-structure`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`.legend-item`)).toHaveCount(3)
    await expect(plot.locator(`svg path.series-line`)).toHaveCount(3)
  })

  // Test axis labels and ranges
  test(`axes labels and ranges`, async ({ page }) => {
    const plot = page.locator(`#single-pattern`)

    // Axis labels
    await expect(plot.locator(`text.axis-label:has-text("r (Å)")`)).toBeVisible()
    await expect(plot.locator(`text.axis-label:has-text("g(r)")`)).toBeVisible()

    // X-axis range (cutoff=10)
    const x_ticks = plot.locator(`g.x-axis .tick text`)
    const first_x = await x_ticks.first().textContent()
    const last_x = await x_ticks.last().textContent()

    if (first_x && last_x) {
      expect(parseFloat(first_x)).toBeCloseTo(0, 1)
      expect(parseFloat(last_x)).toBeLessThanOrEqual(12)
    }

    // Y-axis values are non-negative
    const y_ticks = await plot.locator(`g.y-axis .tick text`).allTextContents()
    const y_values = y_ticks.map(parseFloat).filter((val) => !isNaN(val))

    for (const val of y_values) {
      expect(val).toBeGreaterThanOrEqual(0)
    }
  })
})
