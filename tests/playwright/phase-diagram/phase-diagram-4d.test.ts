import { expect, test } from '@playwright/test'
import { ensure_pane_visible, open_info_and_controls } from './utils'

test.describe(`PhaseDiagram4D (Quaternary)`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
  })

  test(`renders quaternary diagram canvas and opens panes`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Phase Diagrams` })).toBeVisible({
      timeout: 15000,
    })
    const quaternary_grid = page.locator(`.quaternary-grid`)
    await expect(quaternary_grid).toBeVisible({ timeout: 15000 })

    const diagram = quaternary_grid.locator(`.phase-diagram-4d`).first()
    await expect(diagram).toBeVisible({ timeout: 15000 })

    const canvas = diagram.locator(`canvas`)
    await expect(canvas).toBeVisible({ timeout: 15000 })

    // Open info pane
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    // Scoped pane inside this diagram
    const info_pane = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info_pane).toBeVisible({ timeout: 15000 })

    // Open legend controls pane
    const legend_btn = diagram.locator(`.legend-controls-btn`)
    await legend_btn.click()
    const controls_pane = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls_pane).toBeVisible({ timeout: 15000 })
  })

  test(`camera rotation controls accept updates`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible({ timeout: 15000 })

    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible()

    const phi = controls.getByText(`φ`).locator(`..`).locator(`input[type="number"]`)
      .first()
    const theta = controls.getByText(`θ`).locator(`..`).locator(`input[type="number"]`)
      .first()
    await phi.fill(`0.2`)
    await theta.fill(`0.4`)
    await expect(diagram.locator(`canvas`)).toBeVisible()
  })

  test(`color mode + threshold impacts visible entries`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible({ timeout: 15000 })

    const { info, controls } = await open_info_and_controls(diagram)

    // Switch to energy mode
    await controls.getByText(`Energy`, { exact: true }).click()
    // Raise threshold to include more unstable points
    const number_input = controls.locator(`input.threshold-input`).first()
    await number_input.fill(`0.5`)
    // Ensure info pane is in front and visible before asserting
    await ensure_pane_visible(info, diagram.locator(`.info-btn`))
    await expect(info.getByText(`Phase Diagram Statistics`, { exact: false }))
      .toBeVisible({ timeout: 15000 })
    await expect(info.getByText(`Chemical System`, { exact: false }))
      .toBeVisible({ timeout: 15000 })
  })
})
