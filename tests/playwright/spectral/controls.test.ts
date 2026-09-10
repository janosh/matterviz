import { expect, test } from '@playwright/test'

const cases = [
  {
    name: `DOS smearing`,
    route: `/test/dos`,
    plot: `[data-testid="dos-smeared"]`,
    section: `smearing`,
  },
  {
    name: `band units`,
    route: `/test/bands`,
    plot: `[data-testid="phonon-units-highlight-plot"]`,
    section: `path`,
  },
  {
    name: `IR broadening`,
    route: `/reciprocal/ir-raman`,
    plot: `.scatter:has(#ir-raman-fwhm)`,
    section: `broadening`,
  },
]
cases.forEach(({ name, route, plot: selector, section }) => {
  test(`${name} reset restores defaults and clears its changed state`, async ({ page }) => {
    await page.goto(route, { waitUntil: `networkidle` })
    const plot = page.locator(selector).first()
    await plot.locator(`button.pane-toggle`).first().click()
    const pane = plot.locator(`.draggable-pane`)
    const reset = pane.getByRole(`button`, {
      name: `Reset ${section} to defaults`,
      exact: true,
    })
    const before = await plot.locator(`svg[role=application]`).innerHTML()
    await reset.click()
    await expect(reset).toHaveCount(0)
    await expect.poll(() => plot.locator(`svg[role=application]`).innerHTML()).not.toBe(before)
    if (section === `path`) await expect(pane.locator(`#bands-units`)).toHaveValue(`THz`)
    if (section === `broadening`) {
      const width = pane.locator(`#ir-raman-fwhm`)
      const reset_width = await width.inputValue()
      await width.press(`ArrowRight`)
      await reset.click()
      await expect(width).toHaveValue(reset_width)
      await expect(reset).toHaveCount(0)
    }
  })
})

test(`NEB profile controls and reset update the plotted axes`, async ({ page }) => {
  await page.goto(`/neb`, { waitUntil: `networkidle` })
  const plot = page.locator(`.scatter`).last()
  await plot.locator(`button.pane-toggle`).first().click()
  const pane = plot.locator(`.draggable-pane`)
  await pane.locator(`#neb-coord-mode`).selectOption(`image_index`)
  await pane.locator(`#neb-energy-reference`).selectOption(`absolute`)
  await pane.locator(`#neb-show-spline`).uncheck()
  await expect(plot.locator(`.x-axis .axis-label`)).toContainText(`Image index`)
  const reset = pane.getByRole(`button`, { name: `Reset profile to defaults`, exact: true })
  await reset.click()
  await expect(reset).toHaveCount(0)
  await expect(pane.locator(`#neb-coord-mode`)).toHaveValue(`arc_length`)
  await expect(pane.locator(`#neb-energy-reference`)).toHaveValue(`initial`)
  await expect(pane.locator(`#neb-show-spline`)).toBeChecked()
  await expect(plot.locator(`.x-axis .axis-label`)).toContainText(`Reaction coordinate`)
})
