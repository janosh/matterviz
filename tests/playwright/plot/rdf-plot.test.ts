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
    await expect(single.locator(`svg path[fill="none"]`).first()).toBeVisible()

    // Multiple patterns with legend
    const multi = page.locator(`#multi-pattern`)
    await expect(multi).toBeVisible()
    await expect(multi.locator(`.legend`)).toBeVisible()
    await expect(multi.locator(`.legend-item`)).toHaveCount(2)
    await expect(multi.locator(`svg path[fill="none"]`)).toHaveCount(2)
  })

  // Test legend interactivity
  test(`legend toggles series visibility`, async ({ page }) => {
    const plot = page.locator(`#multi-pattern`)
    const items = plot.locator(`.legend-item`)

    const initial_lines = await plot.locator(`svg path[fill="none"]:visible`).count()
    expect(initial_lines).toBe(2)

    await items.first().click()

    // Wait for line count to decrease (2 → 1)
    await expect(async () => {
      const after_toggle = await plot.locator(`svg path[fill="none"]:visible`).count()
      expect(after_toggle).toBe(1)
    }).toPass({ timeout: 1000 })

    await items.first().click()

    // Wait for line count to restore (1 → 2)
    await expect(async () => {
      expect(await plot.locator(`svg path[fill="none"]:visible`).count()).toBe(
        initial_lines,
      )
    }).toPass({ timeout: 1000 })
  })

  // Test tooltip
  test(`tooltip shows x and y values on hover`, async ({ page }) => {
    const plot = page.locator(`#single-pattern`)
    // Select the main plot SVG (has role="img" and contains the x-axis)
    const main_svg = plot.locator(`svg:has(g.x-axis)`)
    await expect(main_svg).toBeVisible()

    // Get the bounding box and hover in the center of the plot area
    const box = await main_svg.boundingBox()
    if (!box) throw new Error(`Could not get SVG bounding box`)

    // Hover in the middle of the plot area
    await main_svg.hover({
      force: true,
      position: { x: box.width / 2, y: box.height / 2 },
    })

    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 3000 })
    const text = await tooltip.textContent()
    // Default ScatterPlot tooltip shows "x: <number>" and "y: <number>"
    expect(text || ``).toMatch(/x:\s*-?\d+\.?\d*/)
    expect(text || ``).toMatch(/y:\s*-?\d+\.?\d*/)
  })

  // Test reference line
  test(`reference line visibility`, async ({ page }) => {
    // Shown when enabled - check element exists in DOM
    const with_ref = page.locator(`#reference-line`)
    await expect(with_ref).toBeVisible()
    // Reference line may be rendered but not visible in viewport - check it exists
    const ref_line = with_ref.locator(`svg line[stroke="gray"][stroke-dasharray="4"]`)
    const line_count = await ref_line.count()
    expect(line_count).toBeGreaterThan(0)

    // Hidden when disabled
    const no_ref = page.locator(`#no-reference-line`)
    await expect(no_ref).toBeVisible()
    const no_ref_line_count = await no_ref.locator(
      `svg line[stroke="gray"][stroke-dasharray="4"]`,
    )
      .count()
    expect(no_ref_line_count).toBe(0)
  })

  // Test structure-based RDF calculation in both modes
  test(`calculates RDF from structures`, async ({ page }) => {
    // Element pairs mode - multiple series
    const ep_plot = page.locator(`#single-structure-element-pairs`)
    await expect(ep_plot).toBeVisible()
    await expect(ep_plot.locator(`.legend`)).toBeVisible()
    const ep_lines_count = await ep_plot.locator(`svg path[fill="none"]`).count()
    expect(ep_lines_count).toBeGreaterThanOrEqual(1)

    // Full mode - single averaged series
    const full_plot = page.locator(`#single-structure-full`)
    await expect(full_plot.locator(`svg path[fill="none"]`)).toHaveCount(1)

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
    await expect(plot.locator(`svg path[fill="none"]`)).toHaveCount(3)
  })

  // Test axis labels and ranges
  test(`axes labels and ranges`, async ({ page }) => {
    const plot = page.locator(`#single-pattern`)
    await expect(plot).toBeVisible()

    // Axis labels are now div elements inside foreignObject
    await expect(plot.locator(`.axis-label.x-label`)).toBeVisible()
    await expect(plot.locator(`.axis-label.y-label`)).toBeVisible()

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
