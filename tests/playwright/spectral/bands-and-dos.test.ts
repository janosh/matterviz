import { expect, test } from '@playwright/test'
import { get_chart_svg, IS_CI } from '../helpers'

test.describe(`BandsAndDos Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Bands tests timeout in CI`)
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

    // Bands should have symmetry point labels (Γ, X, etc), DOS has numeric ticks
    const bands_x_ticks = await plots.first().locator(`g.x-axis text`).allTextContents()
    const dos_x_ticks = await plots.nth(1).locator(`g.x-axis text`).allTextContents()
    expect(bands_x_ticks.join()).toMatch(/[ΓXM]/)
    expect(dos_x_ticks.some((t) => !isNaN(parseFloat(t)))).toBe(true)
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
      const tolerance = Math.max(bands_box.height, dos_box.height) * 0.05 // 5% tolerance
      expect(Math.abs(bands_box.height - dos_box.height)).toBeLessThan(tolerance)
    }

    // Verify shared y-axis: tick values should overlap significantly
    const bands_y_ticks = await plots.first().locator(`g.y-axis text`).allTextContents()
    const dos_y_ticks = await plots.nth(1).locator(`g.y-axis text`).allTextContents()
    const common_ticks = bands_y_ticks.filter((tick) => dos_y_ticks.includes(tick))
    expect(common_ticks.length).toBeGreaterThan(bands_y_ticks.length / 2)

    // Both should have numeric y-axis ticks
    expect(bands_y_ticks.filter((t) => !isNaN(parseFloat(t))).length).toBeGreaterThan(2)
    expect(dos_y_ticks.filter((t) => !isNaN(parseFloat(t))).length).toBeGreaterThan(2)
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

    // Y-axis ranges should be completely different (high_freq_dos has frequencies 10-30)
    const bands_max = Math.max(...bands_y_ticks.map(parseFloat).filter((n) => !isNaN(n)))
    const dos_max = Math.max(...dos_y_ticks.map(parseFloat).filter((n) => !isNaN(n)))
    expect(Math.abs(bands_max - dos_max)).toBeGreaterThan(5) // Should differ significantly

    // Both should have numeric y-ticks
    expect(bands_y_ticks.filter((t) => !isNaN(parseFloat(t))).length).toBeGreaterThan(2)
    expect(dos_y_ticks.filter((t) => !isNaN(parseFloat(t))).length).toBeGreaterThan(2)
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const container = page.locator(`#default + .bands-and-dos`)
    expect(await container.boundingBox()).toBeTruthy()

    await page.setViewportSize({ width: 800, height: 600 })
    await expect(container).toBeVisible()
    expect(await container.boundingBox()).toBeTruthy()
  })

  test(`hovering over DOS shows reference lines in both plots`, async ({ page }) => {
    const container = page.locator(`#default + .bands-and-dos`)
    const plots = container.locator(`.scatter`)
    const bands_plot = plots.first()
    const dos_plot = plots.nth(1)

    // Initially no reference lines should be visible
    const initial_bands_lines = await bands_plot
      .locator(`line[stroke-dasharray]`)
      .count()
    const initial_dos_lines = await dos_plot.locator(`line[stroke-dasharray]`).count()

    // Hover over DOS plot
    const dos_svg = get_chart_svg(dos_plot)
    const dos_box = await dos_svg.boundingBox()
    if (dos_box) {
      await page.mouse.move(
        dos_box.x + dos_box.width / 2,
        dos_box.y + dos_box.height / 2,
      )

      // Wait for hover state to update - reference lines should appear
      await expect(async () => {
        const hovered_bands_lines = await bands_plot
          .locator(`line[stroke-dasharray]`)
          .count()
        const hovered_dos_lines = await dos_plot
          .locator(`line[stroke-dasharray]`)
          .count()

        expect(hovered_bands_lines).toBeGreaterThan(initial_bands_lines)
        expect(hovered_dos_lines).toBeGreaterThan(initial_dos_lines)
      }).toPass({ timeout: 2000 })
    }
  })

  test(`renders children snippet content`, async ({ page }) => {
    // Navigate to section with children (independent-axes)
    await page.locator(`#independent-axes`).scrollIntoViewIfNeeded()

    // Find the bands-and-dos container after the independent-axes heading
    const container = page.locator(`#independent-axes + .bands-and-dos`)
    await expect(container).toBeVisible()

    // Verify the custom overlay child element is rendered
    const custom_overlay = container.locator(`.custom-overlay`)
    await expect(custom_overlay).toBeVisible()
    await expect(custom_overlay).toHaveText(`Custom Overlay`)

    // Verify the main functionality is still working
    const plots = container.locator(`.scatter`)
    expect(await plots.count()).toBe(2)
  })

  // Fermi level alignment tests - verifies BandsAndDos fermi_level prop takes precedence
  // over any fermi_level in bands_props/dos_props, ensuring Bands and DOS are aligned
  const fermi_alignment_cases = [
    { anchor: `#electronic-bands`, testid: `bands-and-dos-electronic`, tolerance: 15 },
    {
      anchor: `#electronic-spin-polarized`,
      testid: `bands-and-dos-spin-polarized`,
      tolerance: 30,
    },
  ] as const

  for (const { anchor, testid, tolerance } of fermi_alignment_cases) {
    test(`Fermi level lines aligned in ${testid}`, async ({ page }) => {
      await page.locator(anchor).scrollIntoViewIfNeeded()
      const container = page.locator(`[data-testid="${testid}"]`)
      await expect(container).toBeVisible()
      await page.waitForTimeout(500)

      const plots = container.locator(`.scatter`)
      const bands_fermi = plots.first().locator(`.fermi-level-line`)
      const dos_fermi = plots.nth(1).locator(`.fermi-level-line`)

      await expect(bands_fermi).toHaveCount(1, { timeout: 10000 })
      await expect(dos_fermi).toHaveCount(1, { timeout: 10000 })

      // Fermi lines should be at approximately the same y position
      await expect(async () => {
        const [bands_y1, dos_y1] = await Promise.all([
          bands_fermi.getAttribute(`y1`),
          dos_fermi.getAttribute(`y1`),
        ])
        if (!bands_y1 || !dos_y1) throw new Error(`Fermi level y-coordinates not found`)
        expect(Math.abs(parseFloat(bands_y1) - parseFloat(dos_y1))).toBeLessThanOrEqual(
          tolerance,
        )
      }).toPass({ timeout: 5000 })
    })
  }
})
