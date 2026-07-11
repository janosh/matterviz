import { expect, type Page, test } from '@playwright/test'
import { open_settings_pane, wait_for_3d_canvas } from './helpers'

const DEMO_URL = `/structure/multi-volume`

// networkidle is flaky with large fixture downloads; the stats bar only renders
// once volumes are fetched + parsed, so waiting on it is sufficient
async function wait_for_scenario(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator(`.stats-bar`)).toBeVisible({ timeout: 20_000 })
}

test.describe(`Multi-volume isosurface demo`, () => {
  // Smoke test: every scenario loads its two volumes and renders without errors
  for (const id of [
    `glycine-esp`,
    `caffeine-homo-lumo`,
    `fe-spin`,
    `al-slab`,
    `hbn-elf`,
    `fractional-range`,
    `perf`,
  ]) {
    test(`scenario ${id} loads volumes and renders`, async ({ page }) => {
      await wait_for_scenario(page, `${DEMO_URL}?scenario=${id}`)
      await expect(page.locator(`.stats-bar`)).toContainText(`Volumes: 2`)
      await wait_for_3d_canvas(page, `.viewer-pane`)
      await expect(page.locator(`.status-message.error`)).toHaveCount(0)
    })
  }

  test(`clicking a scenario card loads it and updates the URL`, async ({ page }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=glycine-esp`)
    await page.locator(`.scenario-card`, { hasText: `Charge × magnetization` }).click()
    await expect(page.locator(`.stats-bar`)).toContainText(`Fe-spin-CHGCAR`, {
      timeout: 20_000,
    })
    await expect(page).toHaveURL(/scenario=fe-spin/)
    await expect(page.locator(`.scenario-card.active`)).toContainText(`Charge × magnetization`)
  })

  test(`glycine ESP scenario lists both source files and one colored surface`, async ({
    page,
  }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=glycine-esp`)
    const stats = page.locator(`.stats-bar`)
    await expect(stats).toContainText(`glycine-density.cube`)
    await expect(stats).toContainText(`glycine-esp.cube`)
    await expect(stats).toContainText(`Surfaces: 1`)
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

    // The color row exposes source select + colormap select
    const color_row = groups.nth(0).locator(`.color-row`)
    await expect(color_row.locator(`select`).first()).toBeVisible()
    await expect(color_row.locator(`select`).nth(1)).toHaveValue(`interpolateRdBu`)
  })

  test(`caffeine scenario renders 4 surfaces from two orbital volumes`, async ({ page }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=caffeine-homo-lumo`)
    const stats = page.locator(`.stats-bar`)
    await expect(stats).toContainText(`Volumes: 2`)
    await expect(stats).toContainText(`Surfaces: 4`) // 2 orbitals x (+/-) lobes
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
