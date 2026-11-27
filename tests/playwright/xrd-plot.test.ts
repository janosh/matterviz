import { expect, test } from '@playwright/test'
import { expect_bottom_within, get_chart_svg } from './helpers'

test.describe(`XrdPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/xrd-plot`, { waitUntil: `networkidle` })
  })

  test(`renders single series with axes, annotated peaks and hkl tooltips`, async ({
    page,
  }) => {
    const plot = page.locator(`#single-pattern .bar-plot`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
    // Bars are rendered as path elements inside .bar-series
    await expect(plot.locator(`svg .bar-series path`).first()).toBeVisible()
    await expect_bottom_within(get_chart_svg(plot), plot.locator(`.axis-label.x-label`))
    await expect(plot.locator(`text.bar-label`).first()).toBeVisible()
    // The first peak lies on the y-axis; use the unobstructed second peak.
    const bar = plot.locator(`svg .bar-series path`).nth(1)
    await expect(bar).toBeVisible()
    await bar.hover()

    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`2θ: 30 °`)
    await expect(tooltip).toContainText(`hkl: 110`)
    await expect(tooltip).toContainText(`d: 2.98 Å`)
    await expect(tooltip.locator(`small`)).toHaveText([`°`, `Å`])
  })

  // The plot's header row owns the reveal: hover mode fades the whole row, `always` shows every
  // pane toggle unhovered (XrdPlot used to hide them again until hover)
  test(`pane toggles follow show_controls`, async ({ page }) => {
    await page.mouse.move(0, 0)
    const toggles = (id: string) => page.locator(`#${id} .header-controls .pane-toggle`)
    await expect(toggles(`always-controls`)).not.toHaveCount(0)
    for (const toggle of await toggles(`always-controls`).all())
      await expect(toggle).toHaveCSS(`opacity`, `1`)
    await expect(page.locator(`#always-controls .header-controls`)).toHaveCSS(`opacity`, `1`)
    const hover_row = page.locator(`#single-pattern .header-controls`)
    await expect(hover_row).toHaveCSS(`opacity`, `0`)
    await page.locator(`#single-pattern .bar-plot`).hover()
    await expect(hover_row).toHaveCSS(`opacity`, `1`)
  })

  // no hover on touch screens: the header row and its pane toggles show unhovered
  test.describe(`touch`, () => {
    test.use({ isMobile: true, hasTouch: true })
    test(`touch screens show the header row and pane toggles`, async ({ page }) => {
      expect(await page.evaluate(() => matchMedia(`(hover: none)`).matches)).toBe(true)
      const row = page.locator(`#single-pattern .header-controls`)
      await expect(row).toHaveCSS(`opacity`, `1`)
      await expect(row.locator(`.pane-toggle`)).not.toHaveCount(0)
      for (const toggle of await row.locator(`.pane-toggle`).all())
        await expect(toggle).toHaveCSS(`opacity`, `1`)
    })
  })

  test(`broadening toggles the rendered profile and resets to sticks`, async ({ page }) => {
    const plot = page.locator(`#single-pattern`)
    await plot.locator(`.control-pane-toggle`).click()
    const pane = plot.locator(`.control-pane`)
    await pane.getByLabel(`Simulate Broadening`, { exact: true }).click()
    await expect(plot.locator(`.scatter`)).toBeVisible()
    await expect(plot.locator(`.bar-plot`)).toHaveCount(0)
    const reset = pane.getByRole(`button`, {
      name: `Reset broadening to defaults`,
      exact: true,
    })
    await reset.click()
    await expect(plot.locator(`.bar-plot`)).toBeVisible()
    await expect(plot.locator(`.scatter`)).toHaveCount(0)
  })
})
