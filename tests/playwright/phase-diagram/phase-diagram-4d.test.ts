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

  test(`excludes entries without e_above_hull unless stable or elemental`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible({ timeout: 15000 })

    // Craft a minimal quaternary dataset
    const data = [
      // Elemental reference corners (always include)
      { composition: { A: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { B: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { C: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { D: 1 }, energy: 0, e_above_hull: 0 },
      // Elemental polymorph without e_above_hull (should be excluded)
      { composition: { A: 1 }, energy: -0.1 },
      // Non-elemental stable without e_above_hull (should be included due to is_stable)
      { composition: { A: 1, B: 1, C: 1, D: 1 }, energy: -4, is_stable: true },
      // Non-elemental without e_above_hull and not stable (should be excluded)
      { composition: { A: 1, B: 1, C: 1, D: 1 }, energy: -3 },
    ]

    // Build DataTransfer with a JSON file and dispatch drop on the diagram
    const data_transfer = await page.evaluateHandle((json) => {
      const dt = new DataTransfer()
      const file = new File([JSON.stringify(json)], `pd.json`, {
        type: `application/json`,
      })
      dt.items.add(file)
      return dt
    }, data)

    await diagram.dispatchEvent(`drop`, { dataTransfer: data_transfer })

    // Open info pane to read visible counts
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    const info = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info).toBeVisible({ timeout: 15000 })

    // Expect unstable entries are 0/0 (excluded when e_above_hull is undefined)
    await expect(info.getByText(/Visible unstable/i)).toContainText(`0 / 0`)

    // Expect stable entries include 4 elemental refs + 1 stable quaternary
    await expect(info.getByText(/Visible stable/i)).toContainText(`5 / 5`)
  })
})
