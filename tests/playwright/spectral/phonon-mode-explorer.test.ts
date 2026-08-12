import { expect, test } from '@playwright/test'
import { wait_for_3d_canvas } from '../helpers'

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
    const canvas = explorer.locator(`.trajectory-pane canvas`).first()
    const frame_zero = await canvas.screenshot()
    await expect(step_input).toHaveValue(`0`)
    await explorer.locator(`button[title^="Next step"]`).click()
    await expect(step_input).toHaveValue(`1`)
    await expect.poll(async () => (await canvas.screenshot()).equals(frame_zero)).toBe(false)
    await expect(explorer.locator(`button.trajectory-export-toggle`)).toBeVisible()
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
