import { expect, test } from '@playwright/test'
import { dom_click } from './utils'

test.describe(`PhaseDiagram3D (Ternary)`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
  })

  test(`renders ternary diagram canvas and toggles hull faces`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Phase Diagrams` })).toBeVisible()
    const ternary_grid = page.locator(`.ternary-grid`)
    await expect(ternary_grid).toBeVisible()

    const diagram = ternary_grid.locator(`.phase-diagram-3d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Open legend controls pane to toggle hull faces
    const legend_btn = diagram.locator(`.legend-controls-btn`)
    await dom_click(legend_btn)

    // Toggle hull faces via control pane switch if present
    const pane = page.locator(`.draggable-pane.phase-diagram-controls-pane`).last()
    const hull_toggle = pane.getByText(`Hull Faces`, { exact: false })
    if (await hull_toggle.isVisible({ timeout: 2000 })) {
      await hull_toggle.click()
    }

    // Ensure canvas still renders after toggle
    await expect(canvas).toBeVisible()
  })

  test(`info pane stats show chemical system and counts`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .phase-diagram-3d`).first()
    await expect(diagram).toBeVisible()
    // Open info via DOM click to avoid overlay intercepts
    await dom_click(diagram.locator(`.info-btn`))
    const info = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    // Ensure content inside the pane is visible (not just attached)
    await expect(info.getByText(`Phase Diagram Stats`, { exact: false }))
      .toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false })).toBeVisible()
    await expect(info.getByText(`Stability`)).toBeVisible()
  })

  test(`camera elevation/azimuth controls accept numeric changes`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .phase-diagram-3d`).first()
    await expect(diagram).toBeVisible()
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible()
    const elev = controls.getByText(`Elev`).locator(`..`).locator(`input[type="number"]`)
      .first()
    const azim = controls.getByText(`Azim`).locator(`..`).locator(`input[type="number"]`)
      .first()
    await elev.fill(`45`)
    await azim.fill(`120`)
    await expect(diagram.locator(`canvas`)).toBeVisible()
  })
})
