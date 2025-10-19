import { expect, test } from '@playwright/test'

test.describe(`Bands Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bands`, { waitUntil: `networkidle` })
  })

  test(`renders single band structure with axes and high-symmetry labels`, async ({ page }) => {
    const plot = page.locator(`#single-bands + .scatter`)
    await expect(plot).toBeVisible()

    // Check SVG and band paths
    const paths = plot.locator(`svg path[fill="none"]`)
    await expect(paths.first()).toBeVisible()
    expect(await paths.count()).toBeGreaterThan(0)

    // Check axes and high-symmetry point labels
    await expect(plot.locator(`g.x-axis`)).toBeVisible()
    await expect(plot.locator(`g.y-axis`)).toBeVisible()
    const x_labels = (await plot.locator(`g.x-axis text`).allTextContents()).join()
    expect(x_labels.includes(`Γ`) || x_labels.includes(`X`)).toBe(true)
  })

  test(`renders multiple band structures with toggleable legend`, async ({ page }) => {
    const plot = page.locator(`#multiple-bands + .scatter`)
    const svg = plot.locator(`svg`)

    // Check legend with correct labels
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    expect(await legend.locator(`.legend-item`).count()).toBe(2)
    const legend_text = await legend.textContent()
    expect(legend_text).toContain(`BS1`)
    expect(legend_text).toContain(`BS2`)

    // Test toggling
    const expected_count = await svg.locator(`path[fill="none"]`).count()
    await legend.locator(`.legend-item`).first().click()
    await expect(svg.locator(`path[fill="none"]`)).not.toHaveCount(expected_count)
  })

  test(`applies custom line styling and hides legend when configured`, async ({ page }) => {
    // Check custom styling
    const custom_plot = page.locator(`#custom-styling + .scatter`)
    const first_path = custom_plot.locator(`path[fill="none"]`).first()
    await expect(first_path).toBeVisible()
    expect(
      await first_path.evaluate((el) => getComputedStyle(el).stroke),
    ).toBeTruthy()

    // Check legend hidden
    const no_legend_plot = page.locator(`#no-legend + .scatter`)
    await expect(no_legend_plot.locator(`.legend`)).not.toBeVisible()
  })

  test(`renders with different path modes`, async ({ page }) => {
    await Promise.all(
      [`union`, `intersection`].map(async (mode) => {
        const plot = page.locator(`#${mode}-path + .scatter`)
        await expect(plot.locator(`path[fill="none"]`).first()).toBeVisible()
      }),
    )
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const plot = page.locator(`#single-bands + .scatter`)
    expect(await plot.boundingBox()).toBeTruthy()

    await page.setViewportSize({ width: 800, height: 600 })
    await page.waitForTimeout(100)
    await expect(plot).toBeVisible()
    expect(await plot.boundingBox()).toBeTruthy()
  })

  test(`renders non-canonical segments in union mode`, async ({ page }) => {
    const plot = page.locator(`#union-non-canonical + .scatter`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`svg path[fill="none"]`).first()).toBeVisible()

    // Check non-canonical segment label appears (K only in alt_path)
    const x_labels = (await plot.locator(`g.x-axis text`).allTextContents()).join()
    expect(x_labels).toContain(`K`)
  })

  test(`shows tooltip with frequency and path on hover`, async ({ page }) => {
    const plot = page.locator(`#single-bands + .scatter`)
    await expect(plot).toBeVisible()

    // Get the first band path
    const first_path = plot.locator(`svg path[fill="none"]`).first()
    await expect(first_path).toBeVisible()

    // Hover directly over the path element with force to bypass intercept
    await first_path.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    const tooltip_text = await tooltip.textContent()
    expect(tooltip_text).toBeTruthy()

    // Tooltip should show frequency with unit (e.g., "Frequency: 5.23 THz")
    expect(tooltip_text).toMatch(/Frequency:\s*[\d.]+\s*THz/)

    // Tooltip should show path segment (e.g., "Path: Γ → X")
    expect(tooltip_text).toMatch(/Path:\s*\S+\s*→\s*\S+/)
  })

  test(`tooltip shows series label with multiple band structures`, async ({ page }) => {
    const plot = page.locator(`#multiple-bands + .scatter`)
    await expect(plot).toBeVisible()

    // Get the first band path
    const first_path = plot.locator(`svg path[fill="none"]`).first()
    await first_path.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    const tooltip_text = await tooltip.textContent()
    expect(tooltip_text).toBeTruthy()

    // With multiple structures, series label should be at the top in bold
    // The label should come before the frequency
    expect(tooltip_text).toMatch(/BS[12]/)
    expect(tooltip_text).toMatch(/Frequency:\s*[\d.]+\s*THz/)
    expect(tooltip_text).toMatch(/→/)

    // Verify label appears before frequency (series label should be first line)
    const frequency_idx = tooltip_text?.indexOf(`Frequency`) ?? -1
    const label_idx = tooltip_text?.search(/BS[12]/) ?? -1
    expect(label_idx).toBeGreaterThan(-1)
    expect(label_idx).toBeLessThan(frequency_idx)
  })

  test(`tooltip disappears when mouse leaves plot area`, async ({ page }) => {
    const plot = page.locator(`#single-bands + .scatter`)
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
    await expect(plot.locator(`.tooltip`)).not.toBeVisible()
  })

  test(`tooltip updates when hovering different segments`, async ({ page }) => {
    const plot = page.locator(`#single-bands + .scatter`)
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
    const plot = page.locator(`#single-bands + .scatter`)
    await expect(plot).toBeVisible()

    // Get the first band path
    const first_path = plot.locator(`svg path[fill="none"]`).first()
    await first_path.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    const tooltip_text = await tooltip.textContent()
    expect(tooltip_text).toBeTruthy()

    // Tooltip should show band index (e.g., "Band: 1")
    expect(tooltip_text).toMatch(/Band:\s*\d+/)
  })

  test(`tooltip shows different band indices for different bands`, async ({ page }) => {
    const plot = page.locator(`#single-bands + .scatter`)
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
})
