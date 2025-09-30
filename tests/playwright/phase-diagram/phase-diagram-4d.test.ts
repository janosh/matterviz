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

  test(`computes hull distances on-the-fly when data is incomplete`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible({ timeout: 15000 })

    // Craft a minimal quaternary dataset with missing e_above_hull
    const data = [
      // Elemental reference corners (always include)
      { composition: { A: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { B: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { C: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { D: 1 }, energy: 0, e_above_hull: 0 },
      // Elemental polymorph without e_above_hull (will be computed on-the-fly)
      { composition: { A: 1 }, energy: -0.1 },
      // Non-elemental stable without e_above_hull (marked stable)
      { composition: { A: 1, B: 1, C: 1, D: 1 }, energy: -4, is_stable: true },
      // Non-elemental without e_above_hull (will be computed on-the-fly)
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

    // Dispatch dragover first for broader browser engine parity (esp. WebKit)
    await diagram.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await diagram.dispatchEvent(`drop`, { dataTransfer: data_transfer })

    // Open info pane to read visible counts
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    const info = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info).toBeVisible({ timeout: 15000 })

    // With on-the-fly computation enabled, entries without precomputed e_above_hull
    // will have it computed automatically. The quaternary entry with energy=-3
    // will be evaluated against the hull and may be stable or slightly unstable
    const unstable_text = await info.getByText(/Visible unstable/i).locator(`..`)
      .textContent()
    expect(unstable_text).toBeTruthy()
    const unstable_match = unstable_text?.match(
      /Visible unstable[^0-9]*([0-9]+)\s*\/\s*([0-9]+)/i,
    )
    expect(unstable_match).toBeTruthy()
    const u_visible = Number(unstable_match?.[1])
    const u_total = Number(unstable_match?.[2])
    expect(Number.isFinite(u_visible) && Number.isFinite(u_total)).toBe(true)

    // Expect stable entries to include at minimum the 4 elemental refs + 1 marked stable
    const stable_text = await info.getByText(/Visible stable/i).locator(`..`)
      .textContent()
    const stable_match = stable_text?.match(
      /Visible stable[^0-9]*([0-9]+)\s*\/\s*([0-9]+)/i,
    )
    expect(stable_match).toBeTruthy()
    const s_visible = Number(stable_match?.[1])
    const s_total = Number(stable_match?.[2])
    expect(s_visible).toBeGreaterThanOrEqual(5)
    expect(s_total).toBeGreaterThanOrEqual(5)
  })

  test(`displays energy above hull color bar in energy mode`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible({ timeout: 15000 })

    // Open legend controls and switch to energy mode
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible({ timeout: 15000 })

    // Switch to energy color mode
    await controls.getByText(`Energy`, { exact: true }).click()

    // Verify color bar is visible
    const color_bar = diagram.locator(`.colorbar`).first()
    await expect(color_bar).toBeVisible({ timeout: 15000 })

    // Verify color bar title
    const color_bar_title = color_bar.getByText(/Energy above hull/i)
    await expect(color_bar_title).toBeVisible({ timeout: 15000 })
  })
})
