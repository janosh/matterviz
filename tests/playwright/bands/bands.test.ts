import { expect, test } from '@playwright/test'

test.describe(`Bands Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bands`, { waitUntil: `networkidle` })
  })

  test(`renders single band structure with axes and high-symmetry labels`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    await expect(plot).toBeVisible()

    // Check SVG and band paths (4 bands expected from mock data)
    const paths = plot.locator(`svg path[fill="none"]`)
    await expect(paths.first()).toBeVisible()
    expect(await paths.count()).toBe(4)

    // Check axes and high-symmetry point labels
    await expect(plot.locator(`g.x-axis`)).toBeVisible()
    await expect(plot.locator(`g.y-axis`)).toBeVisible()
    const x_labels = (await plot.locator(`g.x-axis text`).allTextContents()).join()
    expect(x_labels).toContain(`Γ`)
    expect(x_labels).toContain(`X`)

    // Verify y-axis has tick values
    const y_ticks = await plot.locator(`g.y-axis text`).allTextContents()
    expect(y_ticks.filter((t) => !isNaN(parseFloat(t))).length).toBeGreaterThan(2)
  })

  test(`renders multiple band structures with toggleable legend`, async ({ page }) => {
    const plot = page.getByTestId(`multiple-bands-plot`)
    const svg = plot.locator(`svg`)

    // Check legend with correct labels
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    const legend_items = legend.locator(`.legend-item`)
    expect(await legend_items.count()).toBe(2)
    const legend_text = await legend.textContent()
    expect(legend_text).toContain(`BS1`)
    expect(legend_text).toContain(`BS2`)

    // Test toggling - should have 8 paths (2 structures × 4 bands)
    await expect(svg.locator(`path[fill="none"]`)).toHaveCount(8)
    await legend_items.first().click()
    await expect(svg.locator(`path[fill="none"]`)).toHaveCount(4, { timeout: 2000 })
    await legend_items.first().click()
    await expect(svg.locator(`path[fill="none"]`)).toHaveCount(8, { timeout: 2000 })
  })

  test(`applies custom line styling and hides legend when configured`, async ({ page }) => {
    // Check custom styling
    const custom_plot = page.getByTestId(`custom-styling-plot`)
    const first_path = custom_plot.locator(`path[fill="none"]`).first()
    await expect(first_path).toBeVisible()
    expect(
      await first_path.evaluate((el) => getComputedStyle(el).stroke),
    ).toBeTruthy()

    // Check legend hidden
    const no_legend_plot = page.getByTestId(`no-legend-plot`)
    await expect(no_legend_plot.locator(`.legend`)).toBeHidden()
  })

  test(`renders with different path modes`, async ({ page }) => {
    await Promise.all(
      [`union`, `intersection`].map(async (mode) => {
        const plot = page.getByTestId(`${mode}-path-plot`)
        await expect(plot.locator(`path[fill="none"]`).first()).toBeVisible()
      }),
    )
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const initial_box = await plot.boundingBox()
    expect(initial_box).toBeTruthy()

    await page.setViewportSize({ width: 800, height: 600 })

    // Wait for plot to resize by checking for width change
    await expect(async () => {
      const new_box = await plot.boundingBox()
      expect(new_box).toBeTruthy()
      expect(new_box?.width).not.toBe(initial_box?.width)
    }).toPass({ timeout: 2000 })

    await expect(plot).toBeVisible()
  })

  test(`renders non-canonical segments in union mode`, async ({ page }) => {
    const plot = page.getByTestId(`union-non-canonical-plot`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`svg path[fill="none"]`).first()).toBeVisible()

    // Check non-canonical segment label appears (K only in alt_path)
    const x_labels = (await plot.locator(`g.x-axis text`).allTextContents()).join()
    expect(x_labels).toContain(`K`)
  })

  test(`shows tooltip with frequency and path on hover`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    await expect(plot).toBeVisible()

    // Get the first band path
    const first_path = plot.locator(`svg path[fill="none"]`).first()
    await expect(first_path).toBeVisible()

    // Hover directly over the path element with force to bypass intercept
    await first_path.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    // Check tooltip content by text
    const tooltip_text = await tooltip.textContent()
    expect(tooltip_text).toContain(`THz`)
    expect(tooltip_text).toContain(`→`)
  })

  test(`tooltip shows series label with multiple band structures`, async ({ page }) => {
    const plot = page.getByTestId(`multiple-bands-plot`)
    await expect(plot).toBeVisible()

    // Get the first band path
    const first_path = plot.locator(`svg path[fill="none"]`).first()
    await first_path.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    // Check tooltip content contains series label, frequency, and path
    const tooltip_text = await tooltip.textContent()
    expect(tooltip_text).toMatch(/BS[12]/)
    expect(tooltip_text).toContain(`THz`)
    expect(tooltip_text).toContain(`→`)
  })

  test(`tooltip disappears when mouse leaves plot area`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const first_path = plot.locator(`svg path[fill="none"]`).first()

    // Hover to show tooltip
    await first_path.hover({ force: true })
    await expect(plot.locator(`.tooltip`)).toBeVisible({ timeout: 2000 })

    // Move mouse outside plot
    const box = await plot.boundingBox()
    expect(box).toBeTruthy()
    if (!box) return

    await page.mouse.move(box.x - 50, box.y - 50)

    // Tooltip should be hidden
    await expect(plot.locator(`.tooltip`)).toBeHidden()
  })

  test(`tooltip updates when hovering different segments`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const paths = plot.locator(`svg path[fill="none"]`)

    // Hover over first path
    await paths.nth(0).hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })
    const first_text = await tooltip.textContent()
    expect(first_text).toBeTruthy()

    // Hover over a different path (different band)
    await paths.nth(2).hover({ force: true })

    const second_text = await tooltip.textContent()
    expect(second_text).toBeTruthy()

    // Tooltip text should change (different band = different frequency)
    expect(first_text).not.toBe(second_text)
  })

  test(`tooltip shows band index`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    await expect(plot).toBeVisible()

    // Get the first band path
    const first_path = plot.locator(`svg path[fill="none"]`).first()
    await first_path.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    // Check tooltip contains band index
    const tooltip_text = await tooltip.textContent()
    expect(tooltip_text).toMatch(/Band:\s*\d+/)
  })

  test(`tooltip shows different band indices for different bands`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const paths = plot.locator(`svg path[fill="none"]`)

    // Hover over first path (Band 1)
    await paths.nth(0).hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })
    const first_text = await tooltip.textContent()
    expect(first_text).toMatch(/Band:\s*1/)

    // Hover over third path (Band 3)
    await paths.nth(2).hover({ force: true })

    const third_text = await tooltip.textContent()
    expect(third_text).toMatch(/Band:\s*3/)
  })

  test(`handles k-path discontinuities with combined labels`, async ({ page }) => {
    const plot = page.getByTestId(`discontinuity-plot`)
    await expect(plot).toBeVisible()

    // Check that plot renders with paths
    const paths = plot.locator(`svg path[fill="none"]`)
    await expect(paths.first()).toBeVisible()
    const path_count = await paths.count()
    expect(path_count).toBeGreaterThan(0)

    // Check x-axis labels for combined discontinuity label "U | K"
    const x_labels = await plot.locator(`g.x-axis text`).allTextContents()
    const x_labels_text = x_labels.join(`,`)

    // Should have combined label for discontinuity
    expect(x_labels_text).toContain(`U | K`)

    // Should have other normal labels too
    expect(x_labels_text).toContain(`Γ`) // GAMMA
    expect(x_labels_text).toContain(`X`)
    expect(x_labels_text).toContain(`L`)

    // The discontinuous segment (U-K with consecutive indices) should not create paths
    // We have 3 branches, but U-K is discontinuous, so only 2 should have paths
    // Each of the 2 continuous branches * 4 bands = 8 paths expected
    expect(path_count).toBe(8)
  })
})
