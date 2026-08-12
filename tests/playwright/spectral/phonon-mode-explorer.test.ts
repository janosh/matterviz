import { expect, test } from '@playwright/test'
import { wait_for_3d_canvas } from '../helpers'

const extxyz_frame_coordinates = (content: string, frame_idx: number): number[][] => {
  const lines = content.trim().split(`\n`)
  const n_sites = Number(lines[0])
  if (!Number.isInteger(n_sites) || n_sites <= 0) {
    throw new Error(`Invalid extXYZ site count '${lines[0]}'`)
  }
  const frame_start = frame_idx * (n_sites + 2)
  return lines
    .slice(frame_start + 2, frame_start + 2 + n_sites)
    .map((line) => line.trim().split(/\s+/).slice(1, 4).map(Number))
}

test.describe(`PhononModeExplorer`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/phonon-mode-explorer`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, `#phonon-mode-explorer`, 15_000)
  })

  test(`synchronizes mode controls, spectra, and trajectory playback`, async ({ page }) => {
    const explorer = page.locator(`#phonon-mode-explorer`)
    const summary = explorer.getByTestId(`phonon-mode-summary`)
    await expect(summary).toContainText(`Mode 4`)
    await expect(explorer.getByRole(`application`, { name: /Wave Vector/ })).toBeVisible()

    const qpoint_select = explorer.getByLabel(`q-point`)
    await qpoint_select.selectOption(`2`)
    await expect(summary).toContainText(`q = [0.25, 0, 0.25]`)
    await expect(explorer.getByText(/not commensurate/)).toBeVisible()

    await explorer.getByRole(`button`, { name: `IR`, exact: true }).click()
    const stick = explorer.locator(`line.mode-stick`).nth(1)
    await expect(stick).toBeAttached()
    await stick.click({ force: true })
    await expect(summary).toContainText(`Mode 5`)
    await expect(stick).toHaveClass(/selected/)

    const step_input = explorer.locator(`.trajectory-controls .step-input`)
    await expect(step_input).toHaveValue(`0`)
    await explorer.locator(`button[title^="Next step"]`).click()
    await expect(step_input).toHaveValue(`1`)

    const export_toggle = explorer.locator(`button.trajectory-export-toggle`)
    await expect(export_toggle).toBeVisible()
    await export_toggle.click()
    const export_pane = explorer.locator(`.draggable-pane.export-pane.pane-open`)
    await expect(export_pane).toBeVisible()
    await export_pane.locator(`label:has-text("End Frame") input[type="number"]`).fill(`1`)
    const extxyz_download = page.waitForEvent(`download`)
    await export_pane
      .locator(`.export-buttons`)
      .first()
      .locator(`div`)
      .filter({ hasText: `extXYZ` })
      .getByRole(`button`)
      .click()
    const download = await extxyz_download
    const stream = await download.createReadStream()
    if (!stream) throw new Error(`Unable to read downloaded extXYZ trajectory`)
    let extxyz = ``
    for await (const chunk of stream) extxyz += String(chunk)

    const frame_zero = extxyz_frame_coordinates(extxyz, 0)
    const frame_one = extxyz_frame_coordinates(extxyz, 1)
    const max_coordinate_change = frame_zero.reduce(
      (max_change, site, site_idx) =>
        site.reduce(
          (site_max, coordinate, axis) =>
            Math.max(site_max, Math.abs(coordinate - frame_one[site_idx][axis])),
          max_change,
        ),
      0,
    )
    expect(max_coordinate_change).toBeGreaterThan(1e-6)
  })

  test(`selects a band point through the plot interaction layer`, async ({ page }) => {
    const explorer = page.locator(`#phonon-mode-explorer`)
    const summary = explorer.getByTestId(`phonon-mode-summary`)
    const marker = explorer.locator(`.plot-pane .marker`).nth(2)
    await expect(marker).toBeVisible()
    await marker.click({ force: true })
    await expect(summary).toContainText(`q = [0.375, 0, 0.375]`)
  })
})
