import { expect, type Page, test } from '@playwright/test'
import { open_settings_pane, wait_for_3d_canvas } from './helpers'

const DEMO_URL = `/structure/multi-volume`
const SCENARIO_LOAD_TIMEOUT = 20_000

// networkidle is flaky with large fixture downloads; the stats bar only renders
// once volumes are fetched + parsed, so waiting on it is sufficient
async function wait_for_scenario(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator(`.stats-bar`)).toBeVisible({ timeout: SCENARIO_LOAD_TIMEOUT })
}

test.describe(`Multi-volume isosurface demo`, () => {
  // One cross-volume color path + one fractional display-range path cover load/render
  for (const [id, surfaces] of [
    [`glycine-esp`, undefined],
    [`caffeine-homo-lumo`, `Surfaces: 4`],
    [`fractional-range`, undefined],
  ] as const) {
    test(`scenario ${id} loads volumes and renders`, async ({ page }) => {
      await wait_for_scenario(page, `${DEMO_URL}?scenario=${id}`)
      await expect(page.locator(`.stats-bar`)).toContainText(`Volumes: 2`)
      if (surfaces) await expect(page.locator(`.stats-bar`)).toContainText(surfaces)
      await wait_for_3d_canvas(page, `.viewer-pane`)
      await expect(page.locator(`.status-message.error`)).toHaveCount(0)
    })
  }

  test(`clicking a scenario card loads it and updates the URL`, async ({ page }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=glycine-esp`)
    await page.locator(`.scenario-card`, { hasText: `Charge × magnetization` }).click()
    await expect(page.locator(`.stats-bar`)).toContainText(`Fe-spin-CHGCAR`, {
      timeout: SCENARIO_LOAD_TIMEOUT,
    })
    await expect(page).toHaveURL(/scenario=fe-spin/)
    await expect(page.locator(`.scenario-card.active`)).toContainText(`Charge × magnetization`)
  })

  test(`controls group surfaces by volume and mark color-source-only volumes`, async ({
    page,
  }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=glycine-esp`)
    const pane = await open_settings_pane(page)

    const groups = pane.locator(`.volume-group`)
    await expect(groups).toHaveCount(2)
    // Density volume has one surface with a color source; ESP volume has none
    await expect(groups.nth(0).locator(`.layer-row`)).toHaveCount(1)
    await expect(groups.nth(1).locator(`.volume-note`)).toHaveText(`color source only`)

    // Color settings switch scales and reset to automatic defaults
    const color_row = groups.nth(0).locator(`.color-row`)
    await expect(color_row.locator(`select`)).toBeVisible()
    const color_scale_select = color_row.locator(`.multiselect`)
    await expect(color_scale_select.locator(`.selected`)).toContainText(`RdBu`)
    const reset_button = color_row.getByRole(`button`, {
      name: `Reset colormap + range to auto-fit`,
    })
    await expect(reset_button).toHaveCount(0)
    await color_scale_select.click()
    await page.getByRole(`option`, { name: `Turbo` }).click()
    await expect(reset_button).toBeVisible()
    await reset_button.click()
    await expect(reset_button).toHaveCount(0)
    await expect(color_scale_select.locator(`.selected`)).toContainText(`RdBu`)
  })

  test(`add-surface button adds a surface for the color-source volume`, async ({ page }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=glycine-esp`)
    const pane = await open_settings_pane(page)
    await pane.locator(`button[aria-label="Add surface for glycine-esp.cube"]`).click()
    const groups = pane.locator(`.volume-group`)
    await expect(groups.nth(1).locator(`.layer-row`)).toHaveCount(1)
    // ESP is a signed field so its auto layer shows +/- lobes: 1 + 2 surfaces
    await expect(page.locator(`.stats-bar`)).toContainText(`Surfaces: 3`)
  })
})
