import { expect, test } from '@playwright/test'

test.describe(`DOS Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/dos`, { waitUntil: `networkidle` })
  })

  test(`renders single DOS with axes`, async ({ page }) => {
    const plot = page.locator(`#single-dos + .scatter`)
    await expect(plot).toBeVisible()

    // Check SVG and DOS curve
    const paths = plot.locator(`svg path[fill="none"]`)
    await expect(paths.first()).toBeVisible()

    // Check both axes
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
  })

  test(`renders multiple DOS with toggleable legend`, async ({ page }) => {
    const plot = page.locator(`#multiple-dos + .scatter`)
    const svg = plot.locator(`svg`)

    // Check legend with correct labels
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    expect(await legend.locator(`.legend-item`).count()).toBe(2)
    const legend_text = await legend.textContent()
    expect(legend_text).toContain(`DOS1`)
    expect(legend_text).toContain(`DOS2`)

    // Test toggling
    const initial_paths = await svg.locator(`path[fill="none"]`).count()
    await legend.locator(`.legend-item`).first().click()
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll(`#multiple-dos + .scatter path[fill="none"]`).length <
          count,
      initial_paths,
      { timeout: 3000 },
    )
    expect(await svg.locator(`path[fill="none"]`).count()).toBeLessThan(initial_paths)
  })

  test(`applies normalization correctly`, async ({ page }) => {
    // Max normalization should have y-values <= 1
    const max_plot = page.locator(`#max-normalization + .scatter`)
    await expect(max_plot.locator(`path[fill="none"]`).first()).toBeVisible()
    const y_ticks = await max_plot.locator(`g.y-axis text`).allTextContents()
    expect(
      y_ticks.some((text) => {
        const val = parseFloat(text)
        return !isNaN(val) && val <= 1.0
      }),
    ).toBe(true)

    // Sum normalization should render
    const sum_plot = page.locator(`#sum-normalization + .scatter`)
    await expect(sum_plot.locator(`path[fill="none"]`).first()).toBeVisible()
  })

  test(`renders stacked DOS and applies Gaussian smearing`, async ({ page }) => {
    // Check stacked DOS
    const stacked_plot = page.locator(`#stacked-dos + .scatter`)
    await expect(stacked_plot.locator(`path[fill="none"]`).first()).toBeVisible()

    // Check Gaussian smearing produces smooth curves
    const smeared_plot = page.locator(`#gaussian-smearing + .scatter`)
    const path_d = await smeared_plot
      .locator(`path[fill="none"]`)
      .first()
      .getAttribute(`d`)
    expect(path_d).toContain(`C`) // Cubic bezier curves
  })

  test(`renders with horizontal orientation`, async ({ page }) => {
    const plot = page.locator(`#horizontal-dos + .scatter`)
    await expect(plot.locator(`path[fill="none"]`).first()).toBeVisible()
    await expect(plot.locator(`g.x-axis`)).toBeVisible()
    await expect(plot.locator(`g.y-axis`)).toBeVisible()
  })

  test(`converts frequencies to different units`, async ({ page }) => {
    await Promise.all(
      [
        [`eV`, `#ev-units`],
        [`meV`, `#mev-units`],
      ].map(async ([unit, selector]) => {
        const plot = page.locator(`${selector} + .scatter`)
        await expect(plot).toBeVisible()
        const x_label = plot.locator(`g.x-axis text.axis-label`)
        if ((await x_label.count()) > 0) {
          expect(await x_label.textContent()).toContain(unit)
        }
      }),
    )
  })

  test(`hides legend when configured and maintains responsive layout`, async ({ page }) => {
    // Check legend hidden
    const no_legend_plot = page.locator(`#no-legend + .scatter`)
    await expect(no_legend_plot.locator(`.legend`)).not.toBeVisible()

    // Check responsive layout
    const plot = page.locator(`#single-dos + .scatter`)
    expect(await plot.boundingBox()).toBeTruthy()
    await page.setViewportSize({ width: 800, height: 600 })
    await page.waitForTimeout(100)
    await expect(plot).toBeVisible()
  })
})
