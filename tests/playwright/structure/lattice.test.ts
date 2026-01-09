import { expect, test } from '@playwright/test'
import { expect_canvas_changed, get_canvas_timeout } from '../helpers'

test.describe(`Lattice Component Tests`, () => {
  // Use retries instead of blanket skip for flaky CI runs
  test.describe.configure({ retries: 2 })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })

    // Wait for canvas to be ready before interacting with controls
    await expect
      .poll(async () => (await canvas.screenshot()).length, {
        timeout: get_canvas_timeout(),
      })
      .toBeGreaterThan(1000)

    // Use test page checkbox to open controls
    const checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await expect(checkbox).toBeVisible({ timeout: 5_000 })
    await checkbox.check()
    await expect(page.locator(`.draggable-pane.controls-pane`)).toHaveClass(
      /pane-open/,
      { timeout: 10_000 },
    )
  })

  test(`renders lattice with default properties`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    // Poll until screenshot has non-trivial size (WebGL rendered something)
    await expect
      .poll(async () => (await canvas.screenshot()).length, {
        timeout: get_canvas_timeout(),
      })
      .toBeGreaterThan(1000)
  })

  test(`lattice vectors checkbox toggles visibility`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const checkbox = page.locator(
      `.draggable-pane label:has-text("lattice vectors") input[type="checkbox"]`,
    )

    const before = await canvas.screenshot()
    await checkbox.click()
    await expect_canvas_changed(canvas, before)
  })

  test(`color controls work`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    // Target Edge color input by its label text
    const edge_color = page.locator(
      `.draggable-pane label:has-text("Edge color") input[type="color"]`,
    )
    // Target Surface opacity range input
    const surface_opacity = page.locator(
      `.draggable-pane label:has-text("Surface color") + label input[type="range"]`,
    )

    // Make surface visible and change edge color
    await surface_opacity.fill(`0.5`)
    const before = await canvas.screenshot()
    await edge_color.fill(`#ff0000`)
    await expect_canvas_changed(canvas, before)
  })

  test(`opacity controls work`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const edge_opacity = page.locator(
      `.draggable-pane label:has-text("Edge color") + label input[type="range"]`,
    )
    const surface_opacity = page.locator(
      `.draggable-pane label:has-text("Surface color") + label input[type="range"]`,
    )

    const before = await canvas.screenshot()
    await edge_opacity.fill(`1`)
    await surface_opacity.fill(`0.8`)
    await expect_canvas_changed(canvas, before)
  })

  test(`number and range inputs sync`, async ({ page }) => {
    const edge_range = page.locator(
      `.draggable-pane label:has-text("Edge color") + label input[type="range"]`,
    )
    const edge_number = page.locator(
      `.draggable-pane label:has-text("Edge color") + label input[type="number"]`,
    )

    await edge_number.fill(`0.3`)
    await expect(edge_range).toHaveValue(`0.3`)

    await edge_range.fill(`0.7`)
    await expect(edge_number).toHaveValue(`0.7`)
  })

  test(`inputs have correct validation`, async ({ page }) => {
    const edge_number = page.locator(
      `.draggable-pane label:has-text("Edge color") + label input[type="number"]`,
    )
    const surface_number = page.locator(
      `.draggable-pane label:has-text("Surface color") + label input[type="number"]`,
    )

    await expect(edge_number).toHaveAttribute(`step`, `0.05`)
    await expect(surface_number).toHaveAttribute(`step`, `0.01`)
  })
})
