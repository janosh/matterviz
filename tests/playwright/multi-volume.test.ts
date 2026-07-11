import { expect, type Page, test } from '@playwright/test'

const DEMO_URL = `/structure/multi-volume`

async function wait_for_scenario(page: Page, url: string) {
  await page.goto(url, { waitUntil: `networkidle` })
  await expect(page.locator(`.stats-bar`)).toBeVisible({ timeout: 20_000 })
}

async function open_settings_pane(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement(`style`)
    style.textContent = `.hover-visible { opacity: 1 !important; pointer-events: auto !important; }`
    document.head.append(style)
  })
  const gear = page.locator(`button.structure-controls-toggle`)
  await expect(gear).toBeVisible({ timeout: 15_000 })
  await gear.click()
  const pane = page.locator(`.controls-pane`)
  await expect(pane).toBeVisible({ timeout: 15_000 })
  return pane
}

test.describe(`Multi-volume isosurface demo`, () => {
  // Smoke test: every scenario loads its volumes and renders without errors
  for (const { id, n_volumes } of [
    { id: `glycine-esp`, n_volumes: 2 },
    { id: `caffeine-homo-lumo`, n_volumes: 2 },
    { id: `fe-spin`, n_volumes: 2 },
    { id: `al-slab`, n_volumes: 2 },
    { id: `hbn-elf`, n_volumes: 2 },
    { id: `fractional-range`, n_volumes: 2 },
    { id: `perf`, n_volumes: 2 },
  ]) {
    test(`scenario ${id} loads ${n_volumes} volumes and renders`, async ({ page }) => {
      await wait_for_scenario(page, `${DEMO_URL}?scenario=${id}`)
      await expect(page.locator(`.stats-bar`)).toContainText(`Volumes: ${n_volumes}`)
      await expect(page.locator(`canvas`).first()).toBeVisible()
      await expect(page.locator(`.status-message.error`)).toHaveCount(0)
    })
  }

  test(`glycine ESP scenario loads two volumes with one colored surface`, async ({ page }) => {
    await wait_for_scenario(page, `${DEMO_URL}?scenario=glycine-esp`)
    const stats = page.locator(`.stats-bar`)
    await expect(stats).toContainText(`Volumes: 2`)
    await expect(stats).toContainText(`glycine-density.cube`)
    await expect(stats).toContainText(`glycine-esp.cube`)
    await expect(stats).toContainText(`Surfaces: 1`)
    await expect(page.locator(`canvas`).first()).toBeVisible()
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
