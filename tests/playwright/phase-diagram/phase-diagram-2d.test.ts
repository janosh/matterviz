import { expect, test } from '@playwright/test'
import { dom_click, open_info_and_controls } from './utils'

test.describe(`PhaseDiagram2D (Binary)`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
  })

  test(`renders binary phase diagram with scatter plot and colorbar`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Phase Diagrams` })).toBeVisible({
      timeout: 15000,
    })
    const binary_grid = page.locator(`.binary-grid`)
    await expect(binary_grid).toBeVisible({ timeout: 15000 })

    const pd2d = binary_grid.locator(`.phase-diagram-2d`).first()
    await expect(pd2d).toBeVisible({ timeout: 15000 })

    // ScatterPlot should be present inside 2D diagram
    const scatter = pd2d.locator(`.scatter`)
    await expect(scatter).toBeVisible({ timeout: 15000 })

    // Colorbar should be rendered for energy mode (pick first visible within this diagram)
    await expect(pd2d.locator(`.colorbar`).first()).toBeVisible()

    // Hull line segments should render (dashed)
    const line_segments = scatter.locator(`path[fill='none']`)
    await expect(line_segments.first()).toBeVisible({ timeout: 15000 })
  })

  test(`opens legend controls and info pane`, async ({ page }) => {
    const pd2d = page.locator(`.binary-grid .phase-diagram-2d`).first()
    await expect(pd2d).toBeVisible({ timeout: 15000 })

    const info_btn = pd2d.locator(`.info-btn`)
    await dom_click(info_btn)
    await expect(info_btn).toHaveAttribute(`aria-expanded`, `true`)

    const controls_btn = pd2d.locator(`.legend-controls-btn`)
    await dom_click(controls_btn)
    await expect(controls_btn).toHaveAttribute(`aria-expanded`, `true`)
  })

  test(`color mode toggles switch visible controls and do not error`, async ({ page }) => {
    const pd2d = page.locator(`.binary-grid .phase-diagram-2d`).first()
    await expect(pd2d).toBeVisible({ timeout: 15000 })

    // Open controls
    await dom_click(pd2d.locator(`.legend-controls-btn`))
    const controls = pd2d.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls.getByText(`Color mode`)).toBeVisible()

    // Energy mode should show Color scale selector
    await dom_click(controls.getByText(`Energy`, { exact: true }))
    await expect(controls.getByText(`Color scale`)).toBeVisible()

    // Switch to Stability → should show Points toggles and hide Color scale
    await dom_click(controls.getByText(`Stability`, { exact: true }))
    await expect(controls.getByText(`Points`, { exact: true })).toBeVisible()
    await expect(controls.getByText(`Color scale`)).toHaveCount(0)
  })

  test(`threshold slider filters entries and info pane reflects changes`, async ({ page }) => {
    const pd2d = page.locator(`.binary-grid .phase-diagram-2d`).first()
    await expect(pd2d).toBeVisible({ timeout: 15000 })

    const { info } = await open_info_and_controls(pd2d)

    const get_visible_unstable = async () => {
      const row = info.getByText(`Visible unstable`).locator(`..`)
      const text = await row.textContent()
      // Format: Visible unstable: X / Y
      const match = text?.match(/Visible unstable:\s*(\d+)\s*\/\s*(\d+)/)
      return match ? { x: parseInt(match[1]), y: parseInt(match[2]) } : { x: 0, y: 0 }
    }

    const before = await get_visible_unstable()

    // Open controls and set threshold to 0
    const controls_btn = pd2d.locator(`.legend-controls-btn`)
    await dom_click(controls_btn)
    const controls = pd2d.locator(`.draggable-pane.phase-diagram-controls-pane`)
    const number_input = controls.locator(`input.threshold-input`).first()
    const scatter = pd2d.locator(`.scatter`)
    const markers = scatter.locator(`path.marker`)
    const count_before = await markers.count()
    await number_input.fill(`0`)

    // Wait for info pane to update
    await expect
      .poll(async () => (await get_visible_unstable()).x)
      .toBeLessThanOrEqual(before.x)
    const after = await get_visible_unstable()

    // Total unstable count should remain non-negative and not increase
    expect(after.y).toBeGreaterThanOrEqual(0)
    // Visible unstable should be <= before
    expect(after.x).toBeLessThanOrEqual(before.x)

    // Scatter markers should not increase when threshold is decreased to 0
    const count_after = await markers.count()
    expect(count_after).toBeGreaterThan(0)
    expect(count_after).toBeLessThanOrEqual(count_before)
  })

  test(`stability mode 'Above hull' toggle hides unstable points (info pane)`, async ({ page }) => {
    const pd2d = page.locator(`.binary-grid .phase-diagram-2d`).first()
    await expect(pd2d).toBeVisible({ timeout: 15000 })

    // Open info pane and controls
    await dom_click(pd2d.locator(`.info-btn`))
    const info = pd2d.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info.getByText(`Phase Diagram Statistics`, { exact: false }))
      .toBeVisible({ timeout: 15000 })
    await dom_click(pd2d.locator(`.legend-controls-btn`))
    const controls = pd2d.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible({ timeout: 15000 })

    // Switch to Stability mode to reveal Points toggles
    await dom_click(controls.getByText(`Stability`, { exact: true }))
    await expect(controls.getByText(`Points`, { exact: true })).toBeVisible()

    const get_visible_unstable = async () => {
      const row = info.getByText(`Visible unstable`).locator(`..`)
      const text = await row.textContent()
      const match = text?.match(/Visible unstable:\s*(\d+)\s*\/\s*(\d+)/)
      return match ? parseInt(match[1]) : 0
    }
    const before = await get_visible_unstable()
    // Toggle 'Above hull' off
    await dom_click(controls.getByText(`Above hull`, { exact: false }))
    await expect.poll(get_visible_unstable).toBe(0)
    expect(before).toBeGreaterThanOrEqual(0)
  })
})
