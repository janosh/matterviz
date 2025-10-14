import { expect, test } from '@playwright/test'

test.describe(`BandsAndDos Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bands-and-dos`, { waitUntil: `networkidle` })
  })

  test(`renders both bands and DOS subplots with proper axes`, async ({ page }) => {
    const container = page.locator(`#default + .bands-and-dos`)
    await expect(container).toBeVisible()

    // Check both plots render
    const plots = container.locator(`.scatter`)
    expect(await plots.count()).toBe(2)

    // Verify bands plot (left) and DOS plot (right) both have data
    const bands_paths = plots.first().locator(`path[fill="none"]`)
    const dos_paths = plots.nth(1).locator(`path[fill="none"]`)
    expect(await bands_paths.count()).toBeGreaterThan(0)
    expect(await dos_paths.count()).toBeGreaterThan(0)

    // Check all axes are present
    await Promise.all(
      [plots.first(), plots.nth(1)].map(async (plot) => {
        await expect(plot.locator(`g.x-axis`)).toBeVisible()
        await expect(plot.locator(`g.y-axis`)).toBeVisible()
      }),
    )
  })

  test(`shares y-axis and uses grid layout`, async ({ page }) => {
    const container = page.locator(`#default + .bands-and-dos`)
    const plots = container.locator(`.scatter`)

    // Check grid layout
    expect(await container.evaluate((el) => getComputedStyle(el).display)).toBe(
      `grid`,
    )

    // Check shared y-axis aligns plots vertically
    const bands_box = await plots.first().boundingBox()
    const dos_box = await plots.nth(1).boundingBox()
    expect(bands_box).toBeTruthy()
    expect(dos_box).toBeTruthy()
    if (bands_box && dos_box) {
      expect(Math.abs(bands_box.height - dos_box.height)).toBeLessThan(100)
    }
  })

  test(`applies custom widths and passes props to subcomponents`, async ({ page }) => {
    // Check custom widths
    const custom_container = page.locator(`#custom-widths + .bands-and-dos`)
    await expect(custom_container).toBeVisible()
    expect(await custom_container.getAttribute(`style`)).toContain(
      `grid-template-columns`,
    )

    // Check bands props passed
    const bands_container = page.locator(`#bands-custom-styling + .bands-and-dos`)
    const bands_path = bands_container.locator(`.scatter`).first().locator(
      `path[fill="none"]`,
    ).first()
    expect(
      await bands_path.evaluate((el) => getComputedStyle(el).stroke),
    ).toBeTruthy()

    // Check DOS props passed (normalization)
    const dos_container = page.locator(`#dos-normalization + .bands-and-dos`)
    await expect(
      dos_container.locator(`.scatter`).nth(1).locator(`g.y-axis`),
    ).toBeVisible()
  })

  test(`handles independent y-axes with different ranges`, async ({ page }) => {
    const container = page.locator(`#independent-axes + .bands-and-dos`)
    await expect(container).toBeVisible()

    const plots = container.locator(`.scatter`)
    const bands_y_ticks = await plots.first().locator(`g.y-axis text`).allTextContents()
    const dos_y_ticks = await plots.nth(1).locator(`g.y-axis text`).allTextContents()

    // Both should have their own tick labels
    expect(bands_y_ticks.length).toBeGreaterThan(0)
    expect(dos_y_ticks.length).toBeGreaterThan(0)
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const container = page.locator(`#default + .bands-and-dos`)
    expect(await container.boundingBox()).toBeTruthy()

    await page.setViewportSize({ width: 800, height: 600 })
    await page.waitForTimeout(100)
    await expect(container).toBeVisible()
    expect(await container.boundingBox()).toBeTruthy()
  })
})
