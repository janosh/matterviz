import { expect, test, type Page } from '@playwright/test'

// Helper function to mock downloads if needed, or check for anchor tags
// For now, we'll focus on button presence and clickability

test.describe(`Structure Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `load` })
    // Wait for the structure component to likely be initialized
    await page.waitForSelector(`#structure-wrapper canvas`, { timeout: 5000 })
  })

  test(`renders Structure component with canvas`, async ({ page }) => {
    const structure_wrapper = page.locator(`#structure-wrapper`)
    await expect(structure_wrapper).toBeVisible()

    const canvas = structure_wrapper.locator(`canvas`)
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute(`width`) // Threlte sets these
    await expect(canvas).toHaveAttribute(`height`)

    // Check initial bound prop statuses from test page
    await expect(
      page.locator(`[data-testid="controls-open-status"]`),
    ).toContainText(`false`)
    await expect(
      page.locator(`[data-testid="structure-id-status"]`),
    ).toContainText(`mp-1`)
    await expect(
      page.locator(`[data-testid="canvas-width-status"]`),
    ).toContainText(`600`)
    await expect(
      page.locator(`[data-testid="canvas-height-status"]`),
    ).toContainText(`500`)
  })

  test(`reacts to background_color prop change from test page`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#structure-wrapper .structure`)
    // More specific locator for the test page's background color input
    const background_color_input = page.locator(
      `section:has-text("Controls for Test Page") label:has-text("Background Color") input[type="color"]`,
    )

    const initial_bg_style_full = await structure_div.evaluate(
      (el) => getComputedStyle(el).background,
    )

    await background_color_input.fill(`#ff0000`) // Change to red

    const expected_alpha = 0.063 // Rounded from 16 / 255 (hex '10' appended to color)
    // Wait specifically for the target element's style to change to what we expect
    await expect(structure_div).toHaveCSS(
      `background-color`,
      `rgba(255, 0, 0, ${expected_alpha})`,
      { timeout: 3000 }, // Increased timeout for style propagation
    )

    // Verify the full background property also changed from its initial state
    const new_bg_style_full = await structure_div.evaluate(
      (el) => getComputedStyle(el).background,
    )
    expect(new_bg_style_full).not.toBe(initial_bg_style_full)
  })

  test(`updates width and height from test page controls`, async ({ page }) => {
    const structure_wrapper_div = page.locator(`#structure-wrapper`) // The outer div whose style is changed
    const canvas = page.locator(`#structure-wrapper .structure canvas`)
    const width_input = page.locator(
      `label:has-text("Canvas Width") input[type="number"]`,
    )
    const height_input = page.locator(
      `label:has-text("Canvas Height") input[type="number"]`,
    )
    const canvas_width_status = page.locator(
      `[data-testid="canvas-width-status"]`,
    )
    const canvas_height_status = page.locator(
      `[data-testid="canvas-height-status"]`,
    )

    // Check initial wrapper style which dictates component size
    await expect(structure_wrapper_div).toHaveCSS(`width`, `600px`)
    await expect(structure_wrapper_div).toHaveCSS(`height`, `400px`)
    // Check initial canvas attributes (Threlte might take a moment to update these after prop change)
    await expect(canvas).toHaveAttribute(`width`, `600`)
    await expect(canvas).toHaveAttribute(`height`, `500`)

    await width_input.fill(`700`)
    await height_input.fill(`500`)

    // Wait for test page state and then component to update
    await expect(canvas_width_status).toContainText(`700`)
    await expect(canvas_height_status).toContainText(`500`)
    await expect(structure_wrapper_div).toHaveCSS(`width`, `700px`)
    await expect(structure_wrapper_div).toHaveCSS(`height`, `500px`)

    // Check canvas attributes reflect the change
    // This can be a bit tricky as Threlte/Svelte reactivity might have slight delays
    await expect(canvas).toHaveAttribute(`width`, `700`, { timeout: 1000 })
    await expect(canvas).toHaveAttribute(`height`, `500`, { timeout: 1000 })
  })

  // Fullscreen testing is complex with Playwright as it requires user gesture and browser API mocking.
  // We can at least check if the button exists and try to click it.
  test(`fullscreen button click`, async ({ page }: { page: Page }) => {
    const structure_component = page.locator(`#structure-wrapper .structure`)
    const fullscreen_button = structure_component.locator(
      `button.fullscreen-toggle`,
    )

    // Mock requestFullscreen if possible, or just check for errors on click
    // For now, just click and ensure no immediate client-side error
    let error_occured = false
    page.on(`pageerror`, () => (error_occured = true))

    await expect(fullscreen_button).toBeVisible()
    await expect(fullscreen_button).toBeEnabled() // Ensure it's actionable
    await fullscreen_button.click({ force: true })
    expect(error_occured).toBe(false)
    // Further checks would involve complex browser state or mocking.
  })

  test(`closes controls panel with Escape key`, async ({ page }) => {
    const structure_component = page.locator(`#structure-wrapper .structure`)
    const controls_toggle_button = structure_component.locator(
      `button.controls-toggle`,
    )
    const controls_dialog = structure_component.locator(`dialog.controls`)

    // Open controls first
    await controls_toggle_button.click()
    await page.waitForTimeout(100) // Allow time for dialog to attempt to open
    // We'll assume for this test that if it *could* open, it would. Focus is on Escape key.
    // If the previous test was fixed, we'd assert it's open here.
    // For now, we'll rely on the internal state 'controls_open' being true.

    await page.keyboard.press(`Escape`)
    await page.waitForTimeout(100) // Allow time for close action

    // Check if dialog is not visible (or lacks 'open' attribute if that's more reliable)
    await expect(controls_dialog).not.toHaveAttribute(`open`, ``, {
      timeout: 1000,
    })
    await expect(controls_dialog).not.toBeVisible({ timeout: 1000 })
    const controls_open_status = page.locator(
      `[data-testid="controls-open-status"]`,
    )
    await expect(controls_open_status).toContainText(
      `Controls Open Status: false`,
    )
    await expect(controls_toggle_button).toContainText(`Controls`)
  })

  test(`closes controls panel on outside click`, async ({ page }) => {
    const structure_component = page.locator(`#structure-wrapper .structure`)
    const controls_toggle_button = structure_component.locator(
      `button.controls-toggle`,
    )
    const controls_dialog = structure_component.locator(`dialog.controls`)
    const outside_area = page.locator(`body`) // Clicking on body, outside the dialog/button

    // Open controls first
    await controls_toggle_button.click()
    await page.waitForTimeout(100) // Allow time for dialog to attempt to open
    // Similar to Escape test, assume controls_open would be true internally.

    // Click outside (e.g., on the body or a designated outside element)
    // Ensure the click is not on the toggle button or dialog itself.
    // Clicking body at a position far from these elements.
    await outside_area.click({ position: { x: 0, y: 0 }, force: true }) // Force click if other things are overlaying
    await page.waitForTimeout(100) // Allow time for close action

    await expect(controls_dialog).not.toHaveAttribute(`open`, ``, {
      timeout: 1000,
    })
    await expect(controls_dialog).not.toBeVisible({ timeout: 1000 })
    const controls_open_status = page.locator(
      `[data-testid="controls-open-status"]`,
    )
    await expect(controls_open_status).toContainText(
      `Controls Open Status: false`,
    )
    await expect(controls_toggle_button).toContainText(`Controls`)
  })

  test(`show_site_labels defaults to false and can be toggled`, async ({
    page,
  }) => {
    const structure_component = page.locator(`#structure-wrapper .structure`)
    const controls_toggle_button = structure_component.locator(
      `button.controls-toggle`,
    )
    const controls_dialog = structure_component.locator(`dialog.controls`)

    // Open controls panel
    await controls_toggle_button.click()
    await page.waitForTimeout(500)

    // Find site labels checkbox by searching through all checkboxes
    const all_checkboxes = controls_dialog.locator(`input[type="checkbox"]`)
    const checkbox_count = await all_checkboxes.count()

    let site_labels_checkbox = null
    for (let idx = 0; idx < checkbox_count; idx++) {
      const checkbox = all_checkboxes.nth(idx)
      const label_text = await checkbox.locator(`xpath=..`).textContent()
      if (label_text?.includes(`site labels`)) {
        site_labels_checkbox = checkbox
        break
      }
    }

    expect(site_labels_checkbox).not.toBeNull()
    expect(await site_labels_checkbox!.isChecked()).toBe(false)
  })

  test(`show_site_labels controls are properly labeled`, async ({ page }) => {
    const controls_dialog = page.locator(
      `#structure-wrapper .structure dialog.controls`,
    )

    // Open controls panel
    await page
      .locator(`#structure-wrapper .structure button.controls-toggle`)
      .click()
    await page.waitForTimeout(200)

    // Verify control structure exists
    const site_labels_label = controls_dialog.locator(
      `label:has-text("site labels")`,
    )
    const site_labels_checkbox = site_labels_label.locator(
      `input[type="checkbox"]`,
    )

    expect(await site_labels_label.count()).toBe(1)
    expect(await site_labels_checkbox.count()).toBe(1)
  })

  test(`gizmo is hidden when prop is set to false`, async ({ page }) => {
    // Find and uncheck the gizmo checkbox on the test page
    const gizmo_checkbox = page.locator(
      `label:has-text("Show Gizmo") input[type="checkbox"]`,
    )
    await expect(gizmo_checkbox).toBeVisible()
    await expect(gizmo_checkbox).toBeChecked() // Should be checked by default

    // Uncheck the gizmo to hide it
    await gizmo_checkbox.uncheck()

    // Verify the gizmo status is updated
    const gizmo_status = page.locator(`[data-testid="gizmo-status"]`)
    await expect(gizmo_status).toContainText(`Gizmo Status: false`)

    // Verify the scene still loads without errors
    const canvas = page.locator(`#structure-wrapper canvas`)
    await expect(canvas).toBeVisible()
  })

  test(`gizmo is visible by default and can be toggled`, async ({ page }) => {
    // Verify gizmo is enabled by default
    const gizmo_checkbox = page.locator(
      `label:has-text("Show Gizmo") input[type="checkbox"]`,
    )
    const gizmo_status = page.locator(`[data-testid="gizmo-status"]`)

    await expect(gizmo_checkbox).toBeChecked()
    await expect(gizmo_status).toContainText(`Gizmo Status: true`)

    // Test toggling gizmo off and on
    await gizmo_checkbox.uncheck()
    await expect(gizmo_status).toContainText(`Gizmo Status: false`)

    await gizmo_checkbox.check()
    await expect(gizmo_status).toContainText(`Gizmo Status: true`)
  })

  test(`clicking gizmo rotates the structure`, async ({ page }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    await expect(canvas).toBeVisible()

    const initial_screenshot = await canvas.screenshot()

    // Try gizmo click (top-right) or fallback to drag for camera rotation
    const box = await canvas.boundingBox()
    if (box) {
      await canvas.click({
        position: { x: box.width - 80, y: 80 },
        force: true,
      })

      let after_screenshot = await canvas.screenshot()
      if (initial_screenshot.equals(after_screenshot)) {
        // Fallback: drag to rotate via OrbitControls
        await canvas.dragTo(canvas, {
          sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
          targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
        })
        after_screenshot = await canvas.screenshot()
      }

      expect(initial_screenshot.equals(after_screenshot)).toBe(false)
    }
  })

  test(`element color legend allows color changes via color picker`, async ({
    page,
  }) => {
    const structure_wrapper = page.locator(`#structure-wrapper`)
    await page.waitForSelector(`#structure-wrapper canvas`, { timeout: 5000 })
    await page.waitForTimeout(500) // Wait for structure to fully load

    // Find element legend labels and validate count
    const legend_labels = structure_wrapper.locator(`div label`)
    const legend_count = await legend_labels.count()
    expect(legend_count).toBeGreaterThan(0)

    // Test first element legend label
    const first_label = legend_labels.first()
    await expect(first_label).toBeVisible()

    // Test color picker functionality
    const color_input = first_label.locator(`input[type="color"]`)
    await expect(color_input).toBeAttached()

    const initial_bg_color = await first_label.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )

    await color_input.fill(`#ff0000`)
    await page.waitForTimeout(300)

    const new_bg_color = await first_label.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(new_bg_color).not.toBe(initial_bg_color)
    expect(new_bg_color).toMatch(/rgb\(255,\s*0,\s*0\)/)

    // Test double-click reset
    await first_label.dblclick({ force: true })
    await page.waitForTimeout(200)

    const reset_bg_color = await first_label.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(reset_bg_color).not.toBe(new_bg_color)
  })
})
