import { expect, test } from '@playwright/test'
import { ensure_pane_visible, open_info_and_controls } from './utils'

test.describe(`PhaseDiagram4D (Quaternary)`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
  })

  test(`renders quaternary diagram canvas and opens panes`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Phase Diagrams` })).toBeVisible()
    const quaternary_grid = page.locator(`.quaternary-grid`)
    await expect(quaternary_grid).toBeVisible()

    const diagram = quaternary_grid.locator(`.phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Open info pane
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    // Scoped pane inside this diagram
    const info_pane = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info_pane).toBeVisible()

    // Open legend controls pane
    const legend_btn = diagram.locator(`.legend-controls-btn`)
    await legend_btn.click()
    const controls_pane = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls_pane).toBeVisible()
  })

  test(`camera rotation controls accept updates`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

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
    await expect(diagram).toBeVisible()

    const { info, controls } = await open_info_and_controls(diagram)

    // Switch to energy mode
    await controls.getByText(`Energy`, { exact: true }).click()
    // Raise threshold to include more unstable points
    const number_input = controls.locator(`input.threshold-input`).first()
    await number_input.fill(`0.5`)
    // Ensure info pane is in front and visible before asserting
    await ensure_pane_visible(info, diagram.locator(`.info-btn`))
    await expect(info.getByText(`Phase Diagram Stats`, { exact: false }))
      .toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false }))
      .toBeVisible()
  })

  test(`computes hull distances on-the-fly when data is incomplete`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    // Craft a minimal quaternary dataset with missing e_above_hull
    // Also includes edge cases: invalid energy values that should be filtered out
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
      // Edge cases that should be filtered out (non-finite energies)
      { composition: { A: 1, B: 1 }, energy: NaN }, // NaN energy
      { composition: { A: 1, C: 1 }, energy: Infinity }, // Infinity energy
      { composition: { B: 1, D: 1 } }, // Missing energy entirely
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
    await expect(info).toBeVisible()

    // With on-the-fly computation enabled, entries without precomputed e_above_hull
    // will have it computed automatically. The quaternary entry with energy=-3
    // will be evaluated against the hull and may be stable or slightly unstable
    // Invalid entries (NaN, Infinity, missing energy) should be filtered out gracefully
    const unstable_text = await info.getByTestId(`pd-visible-unstable`).textContent()
    expect(unstable_text).toBeTruthy()
    const unstable_match = unstable_text?.match(/([0-9]+)\s*\/\s*([0-9]+)/)
    expect(unstable_match).toBeTruthy()
    const u_visible = Number(unstable_match?.[1])
    const u_total = Number(unstable_match?.[2])
    expect(Number.isFinite(u_visible) && Number.isFinite(u_total)).toBe(true)

    // Expect stable entries to include at minimum the 4 elemental refs + 1 marked stable
    // The 3 invalid entries (NaN, Infinity, missing) should be filtered out
    const stable_text = await info.getByTestId(`pd-visible-stable`).textContent()
    const stable_match = stable_text?.match(/([0-9]+)\s*\/\s*([0-9]+)/)
    expect(stable_match).toBeTruthy()
    const s_visible = Number(stable_match?.[1])
    const s_total = Number(stable_match?.[2])
    expect(s_visible).toBeGreaterThanOrEqual(5)
    expect(s_total).toBeGreaterThanOrEqual(5)
  })

  test(`displays energy above hull color bar in energy mode`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    // Open legend controls and switch to energy mode
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible()

    // Switch to energy color mode
    await controls.getByText(`Energy`, { exact: true }).click()

    // Verify color bar is visible
    const color_bar = diagram.locator(`.colorbar`).first()
    await expect(color_bar).toBeVisible()

    // Verify color bar title
    const color_bar_title = color_bar.getByText(/Energy above hull/i)
    await expect(color_bar_title).toBeVisible()
  })

  test(`resets drag state on mouseup outside canvas`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas_box = await diagram.locator(`canvas`).boundingBox()
    if (!canvas_box) return

    // Drag on canvas then release outside
    await page.mouse.move(
      canvas_box.x + canvas_box.width / 2,
      canvas_box.y + canvas_box.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      canvas_box.x + canvas_box.width / 2 + 50,
      canvas_box.y + canvas_box.height / 2 + 50,
    )
    await page.mouse.move(canvas_box.x + canvas_box.width + 100, canvas_box.y - 100)
    await page.mouse.up()

    // Verify subsequent click works (would be blocked if drag_started wasn't reset)
    await diagram.locator(`.info-btn`).click()
    await expect(diagram.locator(`.draggable-pane.phase-diagram-info-pane`)).toBeVisible()
  })
})
