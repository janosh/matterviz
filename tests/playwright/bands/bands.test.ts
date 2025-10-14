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
    const x_labels = await plot.locator(`g.x-axis text`).allTextContents()
    expect(x_labels.some((text) => text.includes(`Γ`) || text.includes(`X`))).toBe(
      true,
    )
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
    const initial_paths = await svg.locator(`path[fill="none"]`).count()
    await legend.locator(`.legend-item`).first().click()
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(`#multiple-bands + .scatter path[fill="none"]`)
          .length < count,
      initial_paths,
      { timeout: 3000 },
    )
    expect(await svg.locator(`path[fill="none"]`).count()).toBeLessThan(initial_paths)
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
})
