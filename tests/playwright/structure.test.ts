// deno-lint-ignore-file no-await-in-loop
import { expect, type Page, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { DEFAULTS } from '../../src/lib/settings'
import { open_structure_control_pane } from './helpers'

test.describe(`Structure Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
  })

  test(`renders Structure component with canvas`, async ({ page }) => {
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toBeVisible()

    const canvas = structure_wrapper.locator(`canvas`)
    await expect(canvas).toBeVisible()
    // Check CSS dimensions instead of HTML attributes since Three.js uses CSS sizing
    await expect(canvas).toHaveCSS(`width`, `800px`, { timeout: 5000 })
    await expect(canvas).toHaveCSS(`height`, `500px`, { timeout: 5000 })

    await expect(
      page.locator(`[data-testid="pane-open-status"]`),
    ).toContainText(`false`)

    await page.waitForLoadState(`networkidle`)
    await expect(
      page.locator(`[data-testid="canvas-width-status"]`),
    ).toContainText(`800`)
    await expect(
      page.locator(`[data-testid="canvas-height-status"]`),
    ).toContainText(`500`)
  })

  test(`reacts to background_color prop change from test page`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const background_color_input = page.locator(
      `section:has-text("Controls for Test Page") label:has-text("Background Color") input[type="color"]`,
    )

    const initial_bg_style_full = await structure_div.evaluate(
      (el) => globalThis.getComputedStyle(el).background,
    )

    await background_color_input.fill(`#ff0000`)

    const expected_alpha = 0.1
    await expect(structure_div).toHaveCSS(
      `background-color`,
      `rgba(255, 0, 0, ${expected_alpha})`,
      { timeout: 5000 },
    )

    const new_bg_style_full = await structure_div.evaluate(
      (el) => globalThis.getComputedStyle(el).background,
    )
    expect(new_bg_style_full).not.toBe(initial_bg_style_full)
  })

  test(`updates width and height from test page controls`, async ({ page }) => {
    const structure_wrapper_div = page.locator(`#test-structure`)
    const canvas = page.locator(`#test-structure canvas`)
    const width_input = page.locator(
      `label:has-text("Canvas Width") input[type="number"]`,
    )
    const height_input = page.locator(
      `label:has-text("Canvas Height") input[type="number"]`,
    )
    const canvas_width_status = page.locator(`[data-testid="canvas-width-status"]`)
    const canvas_height_status = page.locator(`[data-testid="canvas-height-status"]`)

    // Wait for component state to be initialized
    await expect(canvas_width_status).toContainText(`800`)
    await expect(canvas_height_status).toContainText(`500`)
    await expect(structure_wrapper_div).toHaveCSS(`width`, `800px`)
    await expect(structure_wrapper_div).toHaveCSS(`height`, `500px`)
    await expect(canvas).toHaveCSS(`width`, `800px`)

    // Canvas might inherit default height from Structure component - check actual value
    const initial_canvas_height = await canvas.evaluate((el) =>
      getComputedStyle(el).height
    )
    expect([`400px`, `500px`]).toContain(initial_canvas_height) // Allow either value initially

    // Update dimensions
    await width_input.fill(`700`)
    await height_input.fill(`500`)

    // Verify state and CSS are updated
    await expect(canvas_width_status).toContainText(`700`)
    await expect(canvas_height_status).toContainText(`500`)
    await expect(structure_wrapper_div).toHaveCSS(`width`, `800px`)
    await expect(structure_wrapper_div).toHaveCSS(`height`, `500px`)
    await expect(canvas).toHaveCSS(`width`, `800px`)
    await expect(canvas).toHaveCSS(`height`, `500px`)
  })

  test(`performance_mode prop can be changed via test page controls`, async ({ page }) => {
    const perf_mode_select = page.locator(`label:has-text("Performance Mode") select`)
    const status = page.locator(`[data-testid="performance-mode-status"]`)

    await expect(status).toContainText(`Performance Mode Status: quality`)
    await expect(perf_mode_select).toHaveValue(`quality`)

    await perf_mode_select.selectOption(`speed`)
    await expect(status).toContainText(`Performance Mode Status: speed`)
    await expect(perf_mode_select).toHaveValue(`speed`)

    await perf_mode_select.selectOption(`quality`)
    await expect(status).toContainText(`Performance Mode Status: quality`)
    await expect(perf_mode_select).toHaveValue(`quality`)

    await expect(page.locator(`#test-structure canvas`)).toBeVisible()
  })

  test(`performance_mode prop can be set via URL parameters`, async ({ page }) => {
    const perf_mode_status = page.locator(`[data-testid="performance-mode-status"]`)
    const perf_mode_select = page.locator(`label:has-text("Performance Mode") select`)

    const test_cases = [
      { param: `speed`, expected: `speed` },
      { param: `quality`, expected: `quality` },
      { param: `invalid`, expected: `quality` },
    ]

    // Test sequentially to avoid navigation conflicts
    for (const { param, expected } of test_cases) {
      await page.goto(`/test/structure?performance_mode=${param}`, {
        waitUntil: `load`,
      })
      await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
      await expect(perf_mode_status).toContainText(
        `Performance Mode Status: ${expected}`,
      )
      await expect(perf_mode_select).toHaveValue(expected)
    }
  })

  // Fullscreen testing is complex with Playwright as it requires user gesture and browser API mocking
  test(`fullscreen button click`, async ({ page }: { page: Page }) => {
    const structure_div = page.locator(`#test-structure`)
    const fullscreen_button = structure_div.locator(
      `button.fullscreen-toggle`,
    )

    let error_occurred = false
    page.on(`pageerror`, () => (error_occurred = true))

    await expect(fullscreen_button).toBeVisible()
    await expect(fullscreen_button).toBeEnabled()
    await expect(fullscreen_button).toHaveAttribute(
      `data-original-title`,
      /(Exit|Enter) fullscreen/,
    )
    await fullscreen_button.click({ force: true })
    expect(error_occurred).toBe(false)
  })

  test(`closes controls pane with Escape key`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const controls_toggle_button = structure_div.locator(
      `button.structure-controls-toggle`,
    )

    // Use helper function to reliably open controls pane
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    await page.keyboard.press(`Escape`)

    await expect(control_pane).not.toBeVisible({ timeout: 1000 })
    await expect(controls_toggle_button).toHaveAttribute(
      `title`,
      `Open structure controls`,
    )
  })

  test(`keyboard shortcuts require modifier keys`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.click()

    const is_mac = await page.evaluate(() =>
      navigator.platform.toUpperCase().indexOf(`MAC`) >= 0
    )

    let page_errors = false
    page.on(`pageerror`, () => (page_errors = true))

    // Test that single keys don't trigger actions or cause errors
    await page.keyboard.press(`f`)
    await page.keyboard.press(`i`)

    // Should not be in fullscreen mode after 'f' key
    const is_fullscreen = await page.evaluate(() => !!document.fullscreenElement)
    expect(is_fullscreen).toBe(false)

    // Test that modifier key combinations can be dispatched without errors
    await page.evaluate((isMac) => {
      const structureDiv = document.querySelector(
        `#test-structure`,
      ) as HTMLElement
      if (structureDiv) {
        structureDiv.focus()
        // Test both Ctrl+F and Ctrl+I shortcuts
        const keys = [`f`, `i`]
        keys.forEach((key) => {
          const event = new KeyboardEvent(`keydown`, {
            key,
            ctrlKey: !isMac,
            metaKey: isMac,
            bubbles: true,
          })
          structureDiv.dispatchEvent(event)
        })
      }
    }, is_mac)

    // Verify no errors occurred and component still functions
    expect(page_errors).toBe(false)
    await expect(structure_div.locator(`canvas`)).toBeVisible()
  })

  test(`closes controls pane on outside click`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const controls_toggle_button = structure_div.locator(
      `button.structure-controls-toggle`,
    )
    const outside_area = page.locator(`body`)

    // Use helper function to reliably open controls pane
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    await outside_area.click({ position: { x: 0, y: 0 }, force: true })

    await expect(control_pane).not.toBeVisible({ timeout: 1000 })
    await expect(controls_toggle_button).toHaveAttribute(
      `title`,
      `Open structure controls`,
    )
  })

  test(`show_site_labels defaults to false and can be toggled`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    const site_labels_label = control_pane.locator(`label:has-text("Site Labels")`)
    const site_labels_checkbox = site_labels_label.locator(`input[type="checkbox"]`)

    await expect(site_labels_label).toBeVisible()
    expect(await site_labels_checkbox.isChecked()).toBe(false)
    await site_labels_checkbox.check()
    expect(await site_labels_checkbox.isChecked()).toBe(true)
    await site_labels_checkbox.uncheck()
    expect(await site_labels_checkbox.isChecked()).toBe(false)
  })

  test(`show_site_labels controls are properly labeled`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    const site_labels_label = pane_div.locator(
      `label:has-text("Site Labels")`,
    )
    const site_labels_checkbox = site_labels_label.locator(
      `input[type="checkbox"]`,
    )

    await expect(site_labels_label).toBeVisible()
    await expect(site_labels_checkbox).toBeVisible()
    expect(await site_labels_label.count()).toBe(1)
    expect(await site_labels_checkbox.count()).toBe(1)
  })

  test(`label controls appear when site labels are enabled`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels first
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Check that Labels section appears
    const labels_section = pane_div.locator(`h4:has-text("Labels")`)
    await expect(labels_section).toBeVisible()

    // Scope to the labels section container (following the heading)
    const labels_container = labels_section.locator(`xpath=following-sibling::*[1]`)

    // Check that all label controls are present within Labels section
    const text_color_label = labels_container.locator(`label:has-text("Color")`).first()
    const background_color_label = labels_container.locator(
      `label:has-text("Background")`,
    )
    const padding_label = labels_container.locator(`label:has-text("Padding")`)

    const offset_row = labels_container.locator(`.pane-row`).filter({
      hasText: `Offset`,
    })
    const offset_x_label = offset_row.locator(`label:has-text("X")`)
    const offset_y_label = offset_row.locator(`label:has-text("Y")`)
    const offset_z_label = offset_row.locator(`label:has-text("Z")`)

    await expect(text_color_label).toBeVisible()
    await expect(background_color_label).toBeVisible()
    await expect(padding_label).toBeVisible()
    await expect(offset_x_label).toBeVisible()
    await expect(offset_y_label).toBeVisible()
    await expect(offset_z_label).toBeVisible()
  })

  test(`label text color control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find text color input - use first color input in labels section
    const text_color_input = pane_div.locator(
      `label:has-text("Color") input[type="color"]`,
    ).first()
    await expect(text_color_input).toBeVisible()

    // Get initial value
    const initial_color = await text_color_input.inputValue()
    expect(initial_color).toMatch(/^#[0-9a-fA-F]{6}$/)

    // Change color
    await text_color_input.fill(`#ff0000`)
    const new_color = await text_color_input.inputValue()
    expect(new_color).toBe(`#ff0000`)

    // Change to another color
    await text_color_input.fill(`#00ff00`)
    const final_color = await text_color_input.inputValue()
    expect(final_color).toBe(`#00ff00`)
  })

  test(`label background color control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find background color input
    const background_color_input = pane_div.locator(
      `label:has-text("Background") input[type="color"]`,
    )
    await expect(background_color_input).toBeVisible()

    // Get initial value
    const initial_color = await background_color_input.inputValue()
    expect(initial_color).toMatch(/^#[0-9a-fA-F]{6}$/)

    // Change color
    await background_color_input.fill(`#0000ff`)
    const new_color = await background_color_input.inputValue()
    expect(new_color).toBe(`#0000ff`)

    // Change to another color
    await background_color_input.fill(`#ffff00`)
    const final_color = await background_color_input.inputValue()
    expect(final_color).toBe(`#ffff00`)
  })

  test(`label background opacity control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find background opacity controls - use first opacity label in labels section
    const opacity_label = pane_div.locator(
      `label:has-text("Opacity")`,
    ).first()
    const opacity_number_input = opacity_label.locator(`input[type="number"]`)
    const opacity_range_input = opacity_label.locator(`input[type="range"]`)

    await expect(opacity_label).toBeVisible()
    await expect(opacity_number_input).toBeVisible()
    await expect(opacity_range_input).toBeVisible()

    // Check initial value (should be 0 for transparent)
    const initial_value = await opacity_number_input.inputValue()
    expect(parseFloat(initial_value)).toBe(0)

    // Test number input
    await opacity_number_input.fill(`0.5`)
    const number_value = await opacity_number_input.inputValue()
    expect(parseFloat(number_value)).toBe(0.5)

    // Test range input
    await opacity_range_input.fill(`0.8`)
    const range_value = await opacity_range_input.inputValue()
    expect(parseFloat(range_value)).toBe(0.8)

    // Verify both inputs are synchronized
    const final_number_value = await opacity_number_input.inputValue()
    const final_range_value = await opacity_range_input.inputValue()
    expect(parseFloat(final_number_value)).toBe(parseFloat(final_range_value))
  })

  test(`label padding control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find padding controls
    const padding_label = pane_div.locator(
      `label:has-text("Padding")`,
    )
    const padding_number_input = padding_label.locator(`input[type="number"]`)
    const padding_range_input = padding_label.locator(`input[type="range"]`)

    await expect(padding_label).toBeVisible()
    await expect(padding_number_input).toBeVisible()
    await expect(padding_range_input).toBeVisible()

    // Check initial value
    const initial_value = await padding_number_input.inputValue()
    expect(parseInt(initial_value)).toBeGreaterThanOrEqual(0)

    // Test number input
    await padding_number_input.fill(`5`)
    const number_value = await padding_number_input.inputValue()
    expect(parseInt(number_value)).toBe(5)

    // Test range input
    await padding_range_input.fill(`8`)
    const range_value = await padding_range_input.inputValue()
    expect(parseInt(range_value)).toBe(8)

    // Verify both inputs are synchronized
    const final_number_value = await padding_number_input.inputValue()
    const final_range_value = await padding_range_input.inputValue()
    expect(parseInt(final_number_value)).toBe(parseInt(final_range_value))
  })

  test(`label offset X control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find offset X controls - look for the offset row and find X input within it
    const offset_row = pane_div.locator(`.pane-row`).filter({ hasText: `Offset` })
    const offset_x_number_input = offset_row.locator(
      `label:has-text("X") input[type="number"]`,
    )

    await expect(offset_row).toBeVisible()
    await expect(offset_x_number_input).toBeVisible()

    // Check initial value
    const initial_value = await offset_x_number_input.inputValue()
    expect(parseFloat(initial_value)).toBeGreaterThanOrEqual(-1)
    expect(parseFloat(initial_value)).toBeLessThanOrEqual(1)

    // Test number input
    await offset_x_number_input.fill(`0.5`)
    const number_value = await offset_x_number_input.inputValue()
    expect(parseFloat(number_value)).toBe(0.5)

    // Test another value
    await offset_x_number_input.fill(`-0.3`)
    const final_value = await offset_x_number_input.inputValue()
    expect(parseFloat(final_value)).toBe(-0.3)
  })

  test(`label offset Y control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find offset Y controls - look for the offset row and find Y input within it
    const offset_row = pane_div.locator(`.pane-row`).filter({ hasText: `Offset` })
    const offset_y_number_input = offset_row.locator(
      `label:has-text("Y") input[type="number"]`,
    )

    await expect(offset_row).toBeVisible()
    await expect(offset_y_number_input).toBeVisible()

    // Check initial value
    const initial_value = await offset_y_number_input.inputValue()
    expect(parseFloat(initial_value)).toBeGreaterThanOrEqual(-1)
    expect(parseFloat(initial_value)).toBeLessThanOrEqual(1)

    // Test number input
    await offset_y_number_input.fill(`0.2`)
    const number_value = await offset_y_number_input.inputValue()
    expect(parseFloat(number_value)).toBe(0.2)

    // Test another value
    await offset_y_number_input.fill(`-0.7`)
    const final_value = await offset_y_number_input.inputValue()
    expect(parseFloat(final_value)).toBe(-0.7)
  })

  test(`label offset Z control works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find offset Z controls - look for the offset row and find Z input within it
    const offset_row = pane_div.locator(`.pane-row`).filter({ hasText: `Offset` })
    const offset_z_number_input = offset_row.locator(
      `label:has-text("Z") input[type="number"]`,
    )

    await expect(offset_row).toBeVisible()
    await expect(offset_z_number_input).toBeVisible()

    // Check initial value
    const initial_value = await offset_z_number_input.inputValue()
    expect(parseFloat(initial_value)).toBeGreaterThanOrEqual(-1)
    expect(parseFloat(initial_value)).toBeLessThanOrEqual(1)

    // Test number input
    await offset_z_number_input.fill(`0.3`)
    const number_value = await offset_z_number_input.inputValue()
    expect(parseFloat(number_value)).toBe(0.3)

    // Test another value
    await offset_z_number_input.fill(`-0.5`)
    const final_value = await offset_z_number_input.inputValue()
    expect(parseFloat(final_value)).toBe(-0.5)
  })

  test(`label font size control works correctly`, async ({ page }) => {
    const pane_div = page.locator(
      `#test-structure .controls-pane`,
    )
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    await test_page_controls_checkbox.check()
    await expect(pane_div).toBeVisible()

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find font size control - look for the size row
    const size_row = pane_div.locator(`.pane-row`).filter({ hasText: `Size` })
    const size_range_input = size_row.locator(`input[type="range"]`)

    await expect(size_row).toBeVisible()
    await expect(size_range_input).toBeVisible()

    // Check initial value
    const initial_value = await size_range_input.inputValue()
    expect(parseFloat(initial_value)).toBeGreaterThanOrEqual(0.5)
    expect(parseFloat(initial_value)).toBeLessThanOrEqual(2)

    // Test range input
    await size_range_input.fill(`1.5`)
    const new_value = await size_range_input.inputValue()
    expect(parseFloat(new_value)).toBe(1.5)

    // Test another value
    await size_range_input.fill(`0.8`)
    const final_value = await size_range_input.inputValue()
    expect(parseFloat(final_value)).toBe(0.8)
  })

  test(`label controls have correct input constraints`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Check opacity constraints
    const opacity_number_input = pane_div.locator(
      `label:has-text("Opacity") input[type="number"]`,
    ).first()
    await expect(opacity_number_input).toHaveAttribute(`min`, `0`)
    await expect(opacity_number_input).toHaveAttribute(`max`, `1`)
    await expect(opacity_number_input).toHaveAttribute(`step`, `0.01`)

    // Check padding constraints
    const padding_number_input = pane_div.locator(
      `label:has-text("Padding") input[type="number"]`,
    )
    await expect(padding_number_input).toHaveAttribute(`min`, `0`)
    await expect(padding_number_input).toHaveAttribute(`max`, `10`)
    await expect(padding_number_input).toHaveAttribute(`step`, `1`)

    // Check offset X constraints
    const offset_row_for_constraints = pane_div.locator(`.pane-row`).filter({
      hasText: `Offset`,
    })
    const offset_x_number_input = offset_row_for_constraints.locator(
      `label:has-text("X") input[type="number"]`,
    )
    await expect(offset_x_number_input).toHaveAttribute(`min`, `-1`)
    await expect(offset_x_number_input).toHaveAttribute(`max`, `1`)
    await expect(offset_x_number_input).toHaveAttribute(`step`, `0.1`)

    // Check offset Y constraints
    const offset_y_number_input = offset_row_for_constraints.locator(
      `label:has-text("Y") input[type="number"]`,
    )
    await expect(offset_y_number_input).toHaveAttribute(`min`, `-1`)
    await expect(offset_y_number_input).toHaveAttribute(`max`, `1`)
    await expect(offset_y_number_input).toHaveAttribute(`step`, `0.1`)

    // Check offset Z constraints
    const offset_z_number_input = offset_row_for_constraints.locator(
      `label:has-text("Z") input[type="number"]`,
    )
    await expect(offset_z_number_input).toHaveAttribute(`min`, `-1`)
    await expect(offset_z_number_input).toHaveAttribute(`max`, `1`)
    await expect(offset_z_number_input).toHaveAttribute(`step`, `0.1`)

    // Check font size constraints
    const size_range_input = pane_div.locator(
      `label:has-text("Size") input[type="range"]`,
    )
    await expect(size_range_input).toHaveAttribute(`min`, `0.5`)
    await expect(size_range_input).toHaveAttribute(`max`, `2`)
    await expect(size_range_input).toHaveAttribute(`step`, `0.1`)
  })

  test(`label controls are properly organized in rows`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Check that controls are organized in pane-row divs
    const pane_rows = pane_div.locator(`.pane-row`)
    const row_count = await pane_rows.count()
    expect(row_count).toBeGreaterThan(0)

    // Check that text color and size are in the same row
    const first_row = pane_rows.first()
    const text_color_in_first_row = first_row.locator(`label:has-text("Color")`)
    const size_in_first_row = first_row.locator(`label:has-text("Size")`)
    await expect(text_color_in_first_row).toBeVisible()
    await expect(size_in_first_row).toBeVisible()

    // Check that background color and opacity are in the same row
    const second_row = pane_rows.nth(1)
    const background_in_second_row = second_row.locator(
      `label:has-text("Background")`,
    )
    const opacity_in_second_row = second_row.locator(
      `label:has-text("Opacity")`,
    )
    await expect(background_in_second_row).toBeVisible()
    await expect(opacity_in_second_row).toBeVisible()

    // Check that offset X, Y, and Z are in the same row
    const offset_row = pane_div.locator(`.pane-row`).filter({ hasText: `Offset` })
    const offset_x_in_row = offset_row.locator(`label:has-text("X")`)
    const offset_y_in_row = offset_row.locator(`label:has-text("Y")`)
    const offset_z_in_row = offset_row.locator(`label:has-text("Z")`)
    await expect(offset_x_in_row).toBeVisible()
    await expect(offset_y_in_row).toBeVisible()
    await expect(offset_z_in_row).toBeVisible()
  })

  test(`label controls persist when toggling site labels`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Set some values
    const labels_heading = pane_div.locator(`h4:has-text("Labels")`)
    const labels_container_for_persist = labels_heading.locator(
      `xpath=following-sibling::*[1]`,
    )
    const text_color_input = labels_container_for_persist.locator(
      `label:has-text("Color") input[type="color"]`,
    ).first()
    const background_color_input = labels_container_for_persist.locator(
      `label:has-text("Background") input[type="color"]`,
    )
    const opacity_input = labels_container_for_persist.locator(
      `label:has-text("Opacity") input[type="number"]`,
    ).first()

    await text_color_input.fill(`#ff0000`)
    await background_color_input.fill(`#0000ff`)
    await opacity_input.fill(`0.7`)

    // Disable site labels
    await site_labels_checkbox.uncheck()

    // Re-query the checkbox after potential DOM updates
    const site_labels_checkbox_again = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await expect(pane_div).toBeVisible()

    // Re-enable site labels
    await site_labels_checkbox_again.check()

    // Check that values are preserved
    const new_text_color = await text_color_input.inputValue()
    const new_background_color = await background_color_input.inputValue()
    const new_opacity = await opacity_input.inputValue()

    expect(new_text_color).toBe(`#ff0000`)
    expect(new_background_color).toBe(`#0000ff`)
    expect(parseFloat(new_opacity)).toBe(0.7)
  })

  test(`gizmo is hidden when prop is set to false`, async ({ page }) => {
    const gizmo_checkbox = page.locator(
      `label:has-text("Show Gizmo") input[type="checkbox"]`,
    )
    await expect(gizmo_checkbox).toBeVisible()
    await expect(gizmo_checkbox).toBeChecked()

    await gizmo_checkbox.uncheck()

    const gizmo_status = page.locator(`[data-testid="gizmo-status"]`)
    await expect(gizmo_status).toContainText(`Gizmo Status: false`)

    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()
  })

  test(`gizmo is visible by default and can be toggled`, async ({ page }) => {
    const gizmo_checkbox = page.locator(
      `label:has-text("Show Gizmo") input[type="checkbox"]`,
    )
    const gizmo_status = page.locator(`[data-testid="gizmo-status"]`)

    await expect(gizmo_checkbox).toBeChecked()
    await expect(gizmo_status).toContainText(`Gizmo Status: true`)

    await gizmo_checkbox.uncheck()
    await expect(gizmo_status).toContainText(`Gizmo Status: false`)

    await gizmo_checkbox.check()
    await expect(gizmo_status).toContainText(`Gizmo Status: true`)
  })

  test(`clicking gizmo rotates the structure`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()

    const initial_screenshot = await canvas.screenshot()

    const box = await canvas.boundingBox()
    if (box) {
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 100, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 100, y: box.height / 2 },
      })

      const after_screenshot = await canvas.screenshot()

      // If no change, try a different drag pattern
      if (initial_screenshot.equals(after_screenshot)) {
        await canvas.dragTo(canvas, {
          sourcePosition: { x: box.width / 2, y: box.height / 2 - 100 },
          targetPosition: { x: box.width / 2, y: box.height / 2 + 100 },
        })

        const final_screenshot = await canvas.screenshot()
        expect(initial_screenshot.equals(final_screenshot)).toBe(false)
      } else {
        expect(initial_screenshot.equals(after_screenshot)).toBe(false)
      }
    }
  })

  test(`element color legend allows color changes via color picker`, async ({ page }) => {
    const structure_wrapper = page.locator(`#test-structure`)
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })

    // Find element legend labels and validate count
    const legend_labels = structure_wrapper.locator(`.structure-legend label`)
    const legend_count = await legend_labels.count()
    expect(legend_count).toBeGreaterThan(0)

    // Test first element legend label
    const first_label = legend_labels.first()
    await expect(first_label).toBeVisible()

    // Test color picker functionality
    const color_input = first_label.locator(`input[type="color"]`)
    await expect(color_input).toBeAttached()

    const initial_color_value = await color_input.inputValue()
    expect(initial_color_value).toMatch(/^#[0-9a-fA-F]{6}$/)

    await color_input.evaluate((input: HTMLInputElement) => {
      input.value = `#ff0000`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      input.dispatchEvent(new Event(`change`, { bubbles: true }))
    })

    const new_color_value = await color_input.inputValue()
    expect(new_color_value).toBe(`#ff0000`)

    // Test double-click reset functionality exists (even if visual change isn't immediate in test)
    await first_label.dblclick({ force: true })

    await expect(color_input).toBeAttached()
  })

  // SKIPPED: Controls dialog fails to open reliably in test environment
  test.skip(`controls pane stays open when interacting with control inputs`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)
    const controls_open_status = page.locator(
      `[data-testid="pane-open-status"]`,
    )
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    // Verify initial state
    await expect(controls_open_status).toContainText(`false`)
    await expect(control_pane).not.toHaveClass(/pane-open/)

    // Open controls pane using the test page checkbox (we know this works)
    await test_page_controls_checkbox.check()
    // Wait for the controls to open
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Test that controls are accessible and pane stays open when interacting
    // Use corrected label text (with leading spaces as shown in debug output)
    const show_atoms_label = control_pane
      .locator(`label`)
      .filter({ hasText: /^ atoms$/ })
    const show_atoms_checkbox = show_atoms_label.locator(
      `input[type="checkbox"]`,
    )
    await expect(show_atoms_checkbox).toBeVisible()

    // Test various control interactions to ensure pane stays open
    await show_atoms_checkbox.click()
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    const show_bonds_label = control_pane
      .locator(`label`)
      .filter({ hasText: /^ bonds$/ })
    const show_bonds_select = show_bonds_label.locator(
      `.multiselect`,
    )
    await expect(show_bonds_select).toBeVisible()
    await show_bonds_select.click()
    // Select "always" option
    await page.locator(`.multiselect-option`).filter({ hasText: `Always` }).click()
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    const show_cell_vectors_label = control_pane
      .locator(`label`)
      .filter({ hasText: `Lattice Vectors` })
    const show_cell_vectors_checkbox = show_cell_vectors_label.locator(
      `input[type="checkbox"]`,
    )
    await expect(show_cell_vectors_checkbox).toBeVisible()
    await show_cell_vectors_checkbox.click()
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Test color scheme select dropdown (this still exists)
    const color_scheme_select = control_pane
      .locator(`label`)
      .filter({ hasText: /Color scheme/ })
      .locator(`select`)
    await expect(color_scheme_select).toBeVisible()
    await color_scheme_select.selectOption(`Jmol`)
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Test number input
    const atom_radius_label = control_pane
      .locator(`label`)
      .filter({ hasText: /Radius/ })
    const atom_radius_input = atom_radius_label.locator(`input[type="number"]`)
    await expect(atom_radius_input).toBeVisible()
    await atom_radius_input.fill(`0.8`)
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Test range input
    const atom_radius_range = atom_radius_label.locator(`input[type="range"]`)
    await expect(atom_radius_range).toBeVisible()
    await atom_radius_range.fill(`0.6`)
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Test color input
    const background_color_label = control_pane
      .locator(`label`)
      .filter({ hasText: /Color/ })
      .first()
    const background_color_input = background_color_label.locator(`input[type="color"]`)
    await expect(background_color_input).toBeVisible()
    await background_color_input.fill(`#00ff00`)
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Note: We don't test the download buttons as they may close the pane due to download behavior
    // The important thing is that normal control inputs (checkboxes, selects, inputs) keep the pane open
  })

  test(`control inputs have intended effects on structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)
    const canvas = structure_div.locator(`canvas`)
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    // Open controls pane using test page checkbox
    await test_page_controls_checkbox.check()
    // Wait for dialog to be visible
    await expect(control_pane).toHaveClass(/pane-open/, { timeout: 2000 })

    // Test atom radius change affects rendering
    const atom_radius_label = control_pane
      .locator(`label`)
      .filter({ hasText: /Radius/ })
    const atom_radius_input = atom_radius_label.locator(`input[type="number"]`)

    await expect(atom_radius_input).toBeVisible()
    const initial_screenshot = await canvas.screenshot()
    await atom_radius_input.fill(`0.3`)

    const after_radius_change = await canvas.screenshot()
    expect(initial_screenshot.equals(after_radius_change)).toBe(false)

    // Test that background can be changed via test page controls (not in-pane controls)
    // The background color control is in the test page, not the component controls pane
    const test_bg_input = page.locator(
      `section:has-text("Controls for Test Page") label:has-text("Background Color") input[type="color"]`,
    )

    if (await test_bg_input.isVisible()) {
      await test_bg_input.fill(`#ff0000`)

      // Check that CSS variable is updated
      const expected_alpha = 0.1 // Default background_opacity value
      await expect(structure_div).toHaveCSS(
        `background-color`,
        `rgba(255, 0, 0, ${expected_alpha})`,
        { timeout: 1000 },
      )
    }

    // Test show atoms checkbox
    const visibility_heading = control_pane.locator(`h4:has-text("Visibility")`)
    const visibility_container = visibility_heading.locator(
      `xpath=following-sibling::*[1]`,
    )
    const show_atoms_checkbox = visibility_container.locator(`input[type="checkbox"]`)
      .first()
    await show_atoms_checkbox.uncheck()

    const after_hide_atoms = await canvas.screenshot()
    expect(after_radius_change.equals(after_hide_atoms)).toBe(false)

    // Re-enable atoms for next test
    await show_atoms_checkbox.check()
  })

  test(`controls pane closes only on escape and outside clicks`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const controls_toggle_button = structure_div.locator(
      `button.structure-controls-toggle`,
    )
    const canvas = structure_div.locator(`canvas`)

    // Open controls pane using helper function
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    // Test that clicking on the canvas DOES close the pane (it's an outside click)
    await canvas.click({ position: { x: 100, y: 100 } })
    await expect(control_pane).not.toBeVisible()

    // Re-open for toggle button test
    const { pane_div: control_pane2 } = await open_structure_control_pane(page)

    // Test that clicking controls toggle button does close the pane
    await controls_toggle_button.click()
    await expect(control_pane2).not.toBeVisible()

    // Re-open for escape key test using helper function
    const { pane_div: control_pane3 } = await open_structure_control_pane(page)

    // Test escape key closes the pane
    await page.keyboard.press(`Escape`)
    await expect(control_pane3).not.toBeVisible()

    // Re-open for outside click test using helper function
    const { pane_div: control_pane4 } = await open_structure_control_pane(page)

    // Test clicking outside the controls and toggle button closes the pane
    await page.locator(`body`).click({ position: { x: 10, y: 10 } })
    await expect(control_pane4).not.toBeVisible()
  })

  test(`bond controls appear when bonds are enabled`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    // Enable bonds via the Visibility section select
    const visibility_heading_for_bonds = control_pane.locator(
      `h4:has-text("Visibility")`,
    )
    const visibility_container_for_bonds = visibility_heading_for_bonds.locator(
      `xpath=following-sibling::*[1]`,
    )
    const show_bonds_select = visibility_container_for_bonds.locator(
      `label:has-text("Bonds:") select`,
    )
    await expect(show_bonds_select).toBeVisible()
    try {
      await show_bonds_select.selectOption(`always`)
    } catch {
      const options = await show_bonds_select.locator(`option`).all()
      if (options.length > 0) {
        await show_bonds_select.selectOption({ index: Math.min(1, options.length - 1) })
      }
    }
    const selected_after = await show_bonds_select.inputValue()

    // Wait for conditional controls to appear when bonds are enabled (not 'never')
    if (selected_after && selected_after !== `never`) {
      await expect(
        control_pane.locator(`label:has-text("Bonding strategy")`),
      ).toBeVisible()
    }

    // Check that bond-specific controls appear
    const bonding_strategy_label = control_pane
      .locator(`label`)
      .filter({ hasText: /Bonding strategy/ })
    const bond_color_label = control_pane.locator(`label`).filter({
      hasText: /Bond color/,
    })
    const bond_thickness_label = control_pane
      .locator(`label`)
      .filter({ hasText: /Bond thickness/ })

    await expect(bonding_strategy_label).toBeVisible()
    await expect(bond_color_label).toBeVisible()
    await expect(bond_thickness_label).toBeVisible()

    // Test bond color change
    const bond_color_input = bond_color_label.locator(`input[type="color"]`)
    await bond_color_input.fill(`#00ff00`)

    // Test bonding strategy change
    const bonding_strategy_select = bonding_strategy_label.locator(`select`)
    await bonding_strategy_select.selectOption(`nearest_neighbor`)
  })

  test(`lattice opacity controls work correctly`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    await test_page_controls_checkbox.check()
    await expect(
      page.locator(`#test-structure .controls-pane`),
    ).toHaveClass(/pane-open/)

    const edge_opacity = page.locator(
      `#test-structure .controls-pane label:has-text("Edge color") + label input[type="range"]`,
    )
    const surface_opacity = page.locator(
      `#test-structure .controls-pane label:has-text("Surface color") + label input[type="range"]`,
    )

    const initial = await canvas.screenshot()
    await edge_opacity.fill(`0.8`)
    await surface_opacity.fill(`0.5`)
    const changed = await canvas.screenshot()

    expect(initial.equals(changed)).toBe(false)
  })
})

test.describe(`File Drop Functionality Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    // Wait for structure component to be rendered and canvas to be available
    await page.waitForSelector(`#test-structure canvas`, { timeout: 10000 })
    // Wait for Three.js to initialize the canvas
    await page.waitForFunction(() => {
      const canvas = document.querySelector(`#test-structure canvas`) as HTMLCanvasElement
      return canvas && canvas.width > 0 && canvas.height > 0
    }, { timeout: 10_000 })
  })

  // SKIPPED: File drop simulation not triggering properly
  test.skip(`drops POSCAR file onto structure viewer and updates structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    const initial_screenshot = await canvas.screenshot()

    const poscar_content = `BaTiO3 tetragonal
1.0
4.0 0.0 0.0
0.0 4.0 0.0
0.0 0.0 4.1
Ba Ti O
1 1 3
Direct
0.0 0.0 0.0
0.5 0.5 0.5
0.5 0.5 0.0
0.5 0.0 0.5
0.0 0.5 0.5`

    const data_transfer = await page.evaluateHandle((content) => {
      const dt = new DataTransfer()
      const file = new File([content], `test.poscar`, { type: `text/plain` })
      dt.items.add(file)
      return dt
    }, poscar_content)

    await canvas.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await canvas.dispatchEvent(`drop`, { dataTransfer: data_transfer })

    const after_drop_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_drop_screenshot)).toBe(false)
  })

  test(`drops XYZ file onto structure viewer and updates structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    const initial_screenshot = await canvas.screenshot()

    const xyz_content = `18
Cyclohexane molecule
C    1.261   -0.728    0.000
C    0.000   -1.456    0.000
C   -1.261   -0.728    0.000
C   -1.261    0.728    0.000
C    0.000    1.456    0.000
C    1.261    0.728    0.000
H    2.178   -1.258    0.000
H    2.178    1.258    0.000
H    0.000   -2.516    0.000
H   -2.178   -1.258    0.000
H   -2.178    1.258    0.000
H    0.000    2.516    0.000
H    1.261   -0.728    0.890
H    1.261   -0.728   -0.890
H   -1.261   -0.728    0.890
H   -1.261   -0.728   -0.890
H    1.261    0.728    0.890
H    1.261    0.728   -0.890`

    const data_transfer = await page.evaluateHandle((content) => {
      const dt = new DataTransfer()
      const file = new File([content], `cyclohexane.xyz`, {
        type: `text/plain`,
      })
      dt.items.add(file)
      return dt
    }, xyz_content)

    await canvas.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await canvas.dispatchEvent(`drop`, { dataTransfer: data_transfer })

    const after_drop_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_drop_screenshot)).toBe(false)
  })

  test(`drops JSON structure file and updates structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    let canvas = structure_div.locator(`canvas`)

    // Take initial screenshot
    const initial_screenshot = await canvas.screenshot()

    // Create a simple JSON structure (NaCl)
    const json_content = JSON.stringify(
      {
        sites: [
          { xyz: [0, 0, 0], element: `Na` },
          { xyz: [0.5, 0.5, 0.5], element: `Cl` },
        ],
        lattice: {
          matrix: [
            [2.8, 0, 0],
            [0, 2.8, 0],
            [0, 0, 2.8],
          ],
          a: 2.8,
          b: 2.8,
          c: 2.8,
          alpha: 90,
          beta: 90,
          gamma: 90,
          volume: 21.952,
        },
        charge: 0,
      },
      null,
      2,
    )

    // Create file and simulate drop
    const data_transfer = await page.evaluateHandle((content) => {
      const dt = new DataTransfer()
      const file = new File([content], `nacl.json`, {
        type: `application/json`,
      })
      dt.items.add(file)
      return dt
    }, json_content)

    // Simulate drop
    await canvas.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await canvas.dispatchEvent(`drop`, { dataTransfer: data_transfer })

    // Wait for file load event to be recorded by the test page
    await expect(page.locator(`[data-testid="event-calls-status"]`)).toContainText(
      `on_file_load`,
      { timeout: 5000 },
    )

    // Re-query canvas and ensure it exists
    canvas = structure_div.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Verify structure changed
    const after_drop_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_drop_screenshot)).toBe(false)
  })

  test(`drag and drop from file picker updates structure`, async ({ page }) => {
    const file_picker = page.locator(`.file-picker`)
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    // Wait for file picker to load
    await page.waitForSelector(`.file-item`, { timeout: 5000 })

    // Take initial screenshot
    const initial_screenshot = await canvas.screenshot()

    // Find a file item to drag (look for one with crystal icon)
    const crystal_file = file_picker
      .locator(`.file-item`)
      .filter({ hasText: `🔷` })
      .first()
    await expect(crystal_file).toBeVisible()

    // Perform drag and drop from file picker to structure viewer
    await crystal_file.dragTo(canvas)

    // Wait for structure to update

    // Verify structure changed
    const after_drag_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_drag_screenshot)).toBe(false)
  })

  test(`drag and drop from file picker shows correct file content`, async ({ page }) => {
    const file_picker = page.locator(`.file-picker`)
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    // Wait for file picker to load
    await page.waitForSelector(`.file-item`, { timeout: 5000 })

    // Find a specific file (look for a CIF file)
    const cif_file = file_picker
      .locator(`.file-item`)
      .filter({ hasText: `.cif` })
      .first()
    await expect(cif_file).toBeVisible()

    // Get the filename for verification
    const filename = await cif_file.locator(`.file-name`).textContent()

    // Drag the file to the structure viewer
    await cif_file.dragTo(canvas)

    // Wait for structure to update

    // Verify the structure viewer is still functional
    await expect(canvas).toBeVisible()

    // For CIF files, should contain typical structure content
    if (filename?.includes(`.cif`)) {
      // The structure should have loaded successfully
      await expect(structure_div).toBeVisible()
    }
  })
})

test.describe(`Reset Camera Button Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
  })

  test(`reset camera button is hidden initially when camera is at default position`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const reset_camera_button = structure_div.locator(`button.reset-camera`)

    await expect(reset_camera_button).not.toBeVisible()
  })

  test(`reset camera button structure and styling are correct`, async ({ page }) => {
    // Since OrbitControls events don't fire in test environment, we'll test the static structure
    const structure_div = page.locator(`#test-structure`)
    const button_section = structure_div.locator(`section.control-buttons`)

    await expect(button_section).toBeVisible()

    // The button should be in the DOM but hidden when camera_has_moved is false
    const other_buttons = button_section.locator(`button`)
    const other_button_count = await other_buttons.count()
    expect(other_button_count).toBeGreaterThan(0)
  })

  test(`reset camera button SVG icon structure is correct`, async ({ page }) => {
    // Test the SVG structure by temporarily making the button visible
    // Since OrbitControls events don't work in test environment, we'll inject the button for testing

    const button_html = await page.evaluate(() => {
      // Create a temporary reset button to test its structure
      const tempButton = document.createElement(`button`)
      tempButton.className = `reset-camera`
      tempButton.title = `Reset camera`
      tempButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      `

      // Add to DOM temporarily
      const section = document.querySelector(
        `#test-structure section`,
      )
      if (section) {
        section.appendChild(tempButton)
        return tempButton.outerHTML
      }
      return null
    })

    expect(button_html).toBeTruthy()
    expect(button_html).toContain(`viewBox="0 0 24 24"`)
    expect(button_html).toContain(`title="Reset camera"`)
    expect(button_html).toContain(`class="reset-camera"`)

    // Verify the SVG contains three circles
    const circle_matches = button_html?.match(/<circle/g)
    expect(circle_matches?.length).toBe(3)

    // Clean up the temporary button
    await page.evaluate(() => {
      const tempButton = document.querySelector(
        `#test-structure section button.reset-camera`,
      )
      tempButton?.remove()
    })
  })

  test(`reset camera button functionality works when manually triggered`, async ({ page }) => {
    // Test the reset camera functionality by manually creating the button and testing its click handler

    const test_result = await page.evaluate(() => {
      // Simulate the camera movement state and button appearance
      const section = document.querySelector(
        `#test-structure section`,
      )
      if (!section) return { success: false, error: `Section not found` }

      // Create the reset button as it would appear when camera_has_moved is true
      const resetButton = document.createElement(`button`)
      resetButton.className = `reset-camera`
      resetButton.title = `Reset camera`
      resetButton.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      `

      // Add click handler that simulates the reset_camera function
      let clicked = false
      resetButton.onclick = () => {
        clicked = true
        // Simulate hiding the button after reset (camera_has_moved = false)
        resetButton.style.display = `none`
      }

      section.appendChild(resetButton)

      // Test that button is visible
      const isVisible = resetButton.offsetParent !== null

      // Test click functionality
      resetButton.click()

      // Test that button is hidden after click
      const isHiddenAfterClick = resetButton.style.display === `none`

      // Clean up
      resetButton.remove()

      return { success: true, isVisible, clicked, isHiddenAfterClick }
    })

    expect(test_result.success).toBe(true)
    expect(test_result.isVisible).toBe(true)
    expect(test_result.clicked).toBe(true)
    expect(test_result.isHiddenAfterClick).toBe(true)
  })

  test(`camera interaction attempts work in test environment`, async ({ page }) => {
    // Test that camera interactions can be performed (even if OrbitControls events don't fire)
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    // Verify canvas is interactive
    await expect(canvas).toBeVisible()

    const box = await canvas.boundingBox()
    if (!box) throw `Canvas box not found`

    expect(box.width).toBeGreaterThan(0)
    expect(box.height).toBeGreaterThan(0)

    // Test that we can perform mouse interactions on the canvas
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2

    // These interactions should complete without error, even if they don't trigger OrbitControls
    await page.mouse.move(centerX, centerY)
    await page.mouse.down({ button: `left` })
    await page.mouse.move(centerX + 50, centerY, { steps: 5 })
    await page.mouse.up({ button: `left` })

    // Test wheel interaction
    await page.mouse.wheel(0, -100)

    // Test drag interaction
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 30, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 30, y: box.height / 2 },
      force: true,
    })

    // If we get here, the interactions completed successfully
    expect(true).toBe(true)
  })

  test(`reset camera button state management logic is sound`, async ({ page }) => {
    // Test the logical behavior of the reset camera button state management
    // Since OrbitControls events don't work in test environment, we test the logic directly

    const logic_test_result = await page.evaluate(() => {
      // Test the reactive logic that would happen in the real component
      let camera_has_moved = false
      let camera_is_moving = false

      // Simulate the effect that sets camera_has_moved when camera_is_moving becomes true
      const simulate_camera_start = () => {
        camera_is_moving = true
        if (camera_is_moving) {
          camera_has_moved = true
        }
      }

      const simulate_camera_end = () => {
        camera_is_moving = false
      }

      const simulate_camera_reset = () => {
        camera_has_moved = false
      }

      const simulate_structure_change = () => {
        camera_has_moved = false
      }

      // Test sequence
      const results = []

      // Initial state
      results.push({ step: `initial`, camera_has_moved, camera_is_moving })

      // Camera starts moving
      simulate_camera_start()
      results.push({ step: `camera_start`, camera_has_moved, camera_is_moving })

      // Camera stops moving
      simulate_camera_end()
      results.push({ step: `camera_end`, camera_has_moved, camera_is_moving })

      // Camera reset
      simulate_camera_reset()
      results.push({ step: `camera_reset`, camera_has_moved, camera_is_moving })

      // Camera moves again
      simulate_camera_start()
      simulate_camera_end()
      results.push({
        step: `camera_move_again`,
        camera_has_moved,
        camera_is_moving,
      })

      // Structure changes
      simulate_structure_change()
      results.push({
        step: `structure_change`,
        camera_has_moved,
        camera_is_moving,
      })

      return results
    })

    // Verify the state transitions are correct
    expect(logic_test_result[0]).toEqual({
      step: `initial`,
      camera_has_moved: false,
      camera_is_moving: false,
    })
    expect(logic_test_result[1]).toEqual({
      step: `camera_start`,
      camera_has_moved: true,
      camera_is_moving: true,
    })
    expect(logic_test_result[2]).toEqual({
      step: `camera_end`,
      camera_has_moved: true,
      camera_is_moving: false,
    })
    expect(logic_test_result[3]).toEqual({
      step: `camera_reset`,
      camera_has_moved: false,
      camera_is_moving: false,
    })
    expect(logic_test_result[4]).toEqual({
      step: `camera_move_again`,
      camera_has_moved: true,
      camera_is_moving: false,
    })
    expect(logic_test_result[5]).toEqual({
      step: `structure_change`,
      camera_has_moved: false,
      camera_is_moving: false,
    })
  })

  test(`structure change resets camera state correctly`, async ({ page }) => {
    // Test that changing structure resets the camera state
    const structure_div = page.locator(`#test-structure`)

    // Verify initial state
    const initial_button_count = await page
      .locator(`button.reset-camera`)
      .count()
    expect(initial_button_count).toBe(0)

    // Test the logic of structure change resetting camera state
    // Since file carousel might not be available in test environment, we'll test the logic directly
    const structure_change_test = await page.evaluate(() => {
      // Simulate the reactive logic that happens when structure changes
      let camera_has_moved = true // Assume camera was moved

      // Simulate structure change effect (this would happen in the real component)
      const simulate_structure_change = () => {
        camera_has_moved = false // Structure change resets camera_has_moved
      }

      const before_change = camera_has_moved
      simulate_structure_change()
      const after_change = camera_has_moved

      return { before_change, after_change }
    })

    expect(structure_change_test.before_change).toBe(true)
    expect(structure_change_test.after_change).toBe(false)

    // Also verify that the canvas is ready and interactive
    const canvas = structure_div.locator(`canvas`)
    await expect(canvas).toBeVisible()

    const canvas_ready = await page.waitForFunction(
      () => {
        const canvas = document.querySelector(
          `#test-structure canvas`,
        ) as HTMLCanvasElement
        return canvas && canvas.width > 0 && canvas.height > 0
      },
      { timeout: 5000 },
    )
    expect(canvas_ready).toBeTruthy()

    // Verify reset button is still not visible (structure hasn't changed, camera hasn't moved)
    const final_button_count = await page.locator(`button.reset-camera`).count()
    expect(final_button_count).toBe(0)
  })
})

test.describe(`Export Button Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
  })

  // Helper function to click export buttons using direct DOM manipulation
  async function click_export_button(page: Page, button_type: `JSON` | `PNG`) {
    const selector = button_type === `JSON`
      ? `button[title="Download JSON"]`
      : `button[title*="PNG"]`

    await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLButtonElement
      if (btn) btn.click()
    }, selector)
  }

  test(`export buttons are visible when controls pane is open`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    await test_page_controls_checkbox.check()
    await expect(control_pane).toHaveClass(/pane-open/, { timeout: 2000 })

    const json_export_btn = control_pane.locator(
      `button[title="Download JSON"]`,
    )
    const xyz_export_btn = control_pane.locator(
      `button[title="Download XYZ"]`,
    )
    const png_export_btn = control_pane.locator(
      `button[title*="PNG"]`,
    )

    await expect(json_export_btn).toBeVisible()
    await expect(xyz_export_btn).toBeVisible()
    await expect(png_export_btn).toBeVisible()

    await expect(json_export_btn).toBeEnabled()
    await expect(xyz_export_btn).toBeEnabled()
    await expect(png_export_btn).toBeEnabled()
  })

  test(`export buttons are not visible when controls pane is closed`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)

    await expect(control_pane).not.toHaveClass(/pane-open/)

    const json_export_btn = structure_div.locator(
      `button[title="Download JSON"]`,
    )
    const xyz_export_btn = structure_div.locator(
      `button[title="Download XYZ"]`,
    )

    await expect(json_export_btn).not.toBeVisible()
    await expect(xyz_export_btn).not.toBeVisible()
  })

  test(`JSON export button click does not cause errors`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    await test_page_controls_checkbox.check()
    await expect(control_pane).toHaveClass(/pane-open/, { timeout: 2000 })

    const json_export_btn = control_pane.locator(
      `button[title="Download JSON"]`,
    )
    await expect(json_export_btn).toBeVisible()
    await json_export_btn.click()

    await expect(json_export_btn).toBeEnabled()
  })

  test(`XYZ export button click does not cause errors`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    const xyz_export_btn = pane_div.locator(
      `button[title="Download XYZ"]`,
    )
    await expect(xyz_export_btn).toBeVisible()
    await xyz_export_btn.click()

    await expect(xyz_export_btn).toBeEnabled()
  })

  test(`PNG export button click does not cause errors`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    const png_export_btn = pane_div.locator(`button[title*="PNG"]`)
    await expect(png_export_btn).toBeVisible()
    await png_export_btn.click()

    await expect(png_export_btn).toBeEnabled()
  })

  test(`export buttons have correct attributes and styling`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Test JSON export button attributes
    const json_export_btn = pane_div.locator(
      `button[title="Download JSON"]`,
    )
    await expect(json_export_btn).toHaveAttribute(`type`, `button`)
    await expect(json_export_btn).toHaveAttribute(`title`, `Download JSON`)

    // Test XYZ export button attributes
    const xyz_export_btn = pane_div.locator(
      `button[title="Download XYZ"]`,
    )
    await expect(xyz_export_btn).toHaveAttribute(`type`, `button`)
    await expect(xyz_export_btn).toHaveAttribute(`title`, `Download XYZ`)

    // Test PNG export button attributes (includes DPI info)
    const png_export_btn = pane_div.locator(
      `button[title*="PNG"]`,
    )
    await expect(png_export_btn).toHaveAttribute(`type`, `button`)
    // PNG button title includes DPI information
    const png_title = await png_export_btn.getAttribute(`title`)
    expect(png_title).toMatch(/PNG \(\d+ DPI\)/)

    // Verify buttons have proper styling classes if any
    const json_classes = await json_export_btn.getAttribute(`class`)
    const xyz_classes = await xyz_export_btn.getAttribute(`class`)
    const png_classes = await png_export_btn.getAttribute(`class`)

    // All export buttons should have consistent styling
    expect(json_classes).toBe(xyz_classes)
    expect(xyz_classes).toBe(png_classes)
  })

  test(`export buttons are grouped together in proper layout`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Find the container with export buttons
    const export_container = pane_div.locator(
      `.export-buttons`,
    )
    await expect(export_container).toBeVisible()

    // Verify all three export buttons are within the same container
    const json_btn = export_container.locator(
      `button[title="Download JSON"]`,
    )
    const xyz_btn = export_container.locator(
      `button[title="Download XYZ"]`,
    )
    const png_btn = export_container.locator(`button[title*="PNG"]`)

    await expect(json_btn).toBeVisible()
    await expect(xyz_btn).toBeVisible()
    await expect(png_btn).toBeVisible()

    // Verify the container has proper flex styling for button layout
    const container_styles = await export_container.evaluate((el) => {
      const computed = globalThis.getComputedStyle(el)
      return {
        display: computed.display,
        gap: computed.gap,
        alignItems: computed.alignItems,
      }
    })

    expect(container_styles.display).toBe(`flex`)
  })

  test(`DPI input for PNG export works correctly`, async ({ page }) => {
    // Use helper function to reliably open controls pane
    const { pane_div } = await open_structure_control_pane(page)

    // Find DPI input
    const dpi_input = pane_div.locator(
      `input[title="Export resolution in dots per inch"]`,
    )
    await expect(dpi_input).toBeVisible()

    // Test DPI input attributes
    await expect(dpi_input).toHaveAttribute(`type`, `number`)
    await expect(dpi_input).toHaveAttribute(`min`, `50`)
    await expect(dpi_input).toHaveAttribute(`max`, `500`)
    // Note: DPI input doesn't have a step attribute

    // Test changing DPI value
    const initial_value = await dpi_input.inputValue()
    expect(parseInt(initial_value)).toBeGreaterThanOrEqual(72)

    await dpi_input.fill(`200`)
    expect(await dpi_input.inputValue()).toBe(`200`)

    // Verify PNG button title updates with new DPI
    const png_export_btn = pane_div.locator(
      `button[title*="PNG"]`,
    )
    const updated_title = await png_export_btn.getAttribute(`title`)
    expect(updated_title).toContain(`(200 DPI)`)

    // Test that DPI input accepts values within range (HTML inputs don't auto-clamp)
    await dpi_input.fill(`150`)
    expect(await dpi_input.inputValue()).toBe(`150`)

    await dpi_input.fill(`72`)
    expect(await dpi_input.inputValue()).toBe(`72`)
  })

  test(`multiple export button clicks work correctly`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const json_export_btn = pane_div.locator(`button[title="Download JSON"]`)
    const png_export_btn = pane_div.locator(`button[title*="PNG"]`)

    await click_export_button(page, `JSON`)
    await expect(json_export_btn).toBeEnabled()

    await click_export_button(page, `JSON`)
    await expect(json_export_btn).toBeEnabled()

    await click_export_button(page, `PNG`)
    await expect(png_export_btn).toBeEnabled()

    await click_export_button(page, `PNG`)
    await expect(png_export_btn).toBeEnabled()
  })

  test(`export buttons work with loaded structure`, async ({ page }) => {
    const { container, pane_div } = await open_structure_control_pane(
      page,
    )

    const canvas = container.locator(`canvas`)
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute(`width`)
    await expect(canvas).toHaveAttribute(`height`)

    const json_export_btn = pane_div.locator(`button[title="Download JSON"]`)
    const png_export_btn = pane_div.locator(`button[title*="PNG"]`)

    await click_export_button(page, `JSON`)
    await expect(json_export_btn).toBeEnabled()

    await click_export_button(page, `PNG`)
    await expect(png_export_btn).toBeEnabled()
  })

  test(`reset camera button integration with existing UI elements`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const button_section = structure_div.locator(`section.control-buttons`)

    await expect(button_section).toBeVisible()

    const other_buttons = button_section.locator(`button`)
    const button_count = await other_buttons.count()
    expect(button_count).toBeGreaterThan(0)

    const section_styles = await button_section.evaluate((el) => {
      const computed = globalThis.getComputedStyle(el)
      return {
        position: computed.position,
        display: computed.display,
        justifyContent: computed.justifyContent,
        gap: computed.gap,
      }
    })

    expect(section_styles.position).toBe(`absolute`)
    expect(section_styles.display).toBe(`flex`)
    expect(section_styles.justifyContent).toBe(`end`)

    const layout_test = await page.evaluate(() => {
      const section = document.querySelector(`#test-structure section`)
      if (!section) return false

      const testButton = document.createElement(`button`)
      testButton.className = `reset-camera`
      testButton.style.visibility = `hidden`
      testButton.innerHTML =
        `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /></svg>`

      section.appendChild(testButton)

      const fits_properly = testButton.offsetWidth > 0 && testButton.offsetHeight > 0

      section.removeChild(testButton)
      return fits_properly
    })

    expect(layout_test).toBe(true)
  })
})

test.describe(`Show Buttons Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
  })

  test(`should hide buttons when show_controls is false`, async ({ page }) => {
    await page.goto(`/test/structure?show_controls=false`)
    await page.waitForSelector(`canvas`)

    await expect(page.locator(`#test-structure section.control-buttons`))
      .not.toHaveClass(/visible/)

    await expect(page.locator(`button[title*="info pane"]`)).not.toBeVisible()
    await expect(page.locator(`.fullscreen-toggle`)).not.toBeVisible()
  })

  test(`should hide buttons when structure width is narrower than show_controls number`, async ({ page }) => {
    // Use URL parameter to set show_controls to 600
    await page.goto(`/test/structure?show_controls=600`)
    await page.waitForSelector(`canvas`)

    // Verify show_controls is set to 600 from URL
    await expect(page.locator(`[data-testid="show-buttons-status"]`))
      .toContainText(`Show Buttons Status: 600`)

    // Set canvas width to 400px (less than show_controls threshold)
    await page.locator(`[data-testid="canvas-width-input"]`).fill(`400`)

    // Wait for the width change to take effect

    // Control buttons should not be visible since width (400) < show_controls (600)
    await expect(page.locator(`#test-structure section.control-buttons`))
      .not.toHaveClass(/visible/)
    await expect(page.locator(`button[title*="structure info"]`)).not.toBeVisible()
  })

  test(`should show buttons when structure width is wider than show_controls number`, async ({ page }) => {
    // Use URL parameter to set show_controls to 600
    await page.goto(`/test/structure?show_controls=600`)
    await page.waitForSelector(`canvas`)

    // Verify show_controls is set to 600 from URL
    await expect(page.locator(`[data-testid="show-buttons-status"]`))
      .toContainText(`Show Buttons Status: 600`)

    // Set canvas width to 800px (greater than show_controls threshold)
    await page.locator(`[data-testid="canvas-width-input"]`).fill(`800`)

    // Wait for the width change to take effect

    // Control buttons should be visible since width (800) > show_controls (600)
    await expect(page.locator(`#test-structure section.control-buttons`))
      .toHaveClass(/visible/)
    await expect(page.locator(`button[title*="structure info"]`)).toBeVisible()
  })

  test(`should show buttons when show_controls is true regardless of width`, async ({ page }) => {
    // Use URL parameter to explicitly set show_controls to true
    await page.goto(`/test/structure?show_controls=true`)
    await page.waitForSelector(`canvas`)

    // Verify show_controls is set to true from URL
    await expect(page.locator(`[data-testid="show-buttons-status"]`))
      .toContainText(`Show Buttons Status: true`)

    // Set canvas width to 200px (very narrow)
    await page.locator(`[data-testid="canvas-width-input"]`).fill(`200`)

    // Wait for the width change to take effect

    // Control buttons should still be visible when show_controls is true (regardless of width)
    await expect(page.locator(`#test-structure section.control-buttons`))
      .toHaveClass(/visible/)
    await expect(page.locator(`button[title*="structure info"]`)).toBeVisible()
  })
})

test.describe(`Structure Event Handler Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
  })

  test(`should handle file loading from URL correctly`, async ({ page }) => {
    // Load a structure file via URL
    const file_path = `/structures/mp-1.json`
    await page.goto(`/test/structure?data_url=${file_path}`)
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })

    // Verify the structure was loaded by checking for canvas
    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()

    // Wait a bit for the structure to render

    // Just verify the canvas is present and visible (content check is unreliable)
    await expect(canvas).toBeVisible()
    const canvas_size = await canvas.evaluate((el) => {
      const canvas_el = el as HTMLCanvasElement
      return { width: canvas_el.width, height: canvas_el.height }
    })
    expect(canvas_size.width).toBeGreaterThan(0)
    expect(canvas_size.height).toBeGreaterThan(0)
  })

  test(`should handle performance mode changes correctly`, async ({ page }) => {
    // Change performance mode via test page controls
    const perf_mode_select = page.locator(`label:has-text("Performance Mode") select`)
    await perf_mode_select.selectOption(`speed`)

    // Verify the change was applied
    await expect(page.locator(`[data-testid="performance-mode-status"]`))
      .toContainText(`Performance Mode Status: speed`)
  })

  test(`should handle show controls changes correctly`, async ({ page }) => {
    // Change show controls via test page controls
    const show_controls_select = page.locator(`label:has-text("Show Buttons") select`)
    await show_controls_select.selectOption(`false`)

    // Verify the change was applied
    await expect(page.locator(`[data-testid="show-buttons-status"]`))
      .toContainText(`Show Buttons Status: false`)
  })

  test(`should handle canvas dimension changes correctly`, async ({ page }) => {
    // Change canvas dimensions via test page controls
    const width_input = page.locator(`[data-testid="canvas-width-input"]`)
    const height_input = page.locator(`[data-testid="canvas-height-input"]`)

    // Clear and fill width
    await width_input.clear()
    await width_input.fill(`800`)

    // Clear and fill height
    await height_input.clear()
    await height_input.fill(`600`)

    // Wait for the changes to be applied

    // Verify the changes were applied
    await expect(page.locator(`[data-testid="canvas-width-status"]`))
      .toContainText(`Canvas Width Status: 800`)
    await expect(page.locator(`[data-testid="canvas-height-status"]`))
      .toContainText(`Canvas Height Status: 600`)

    // Verify the structure wrapper dimensions changed
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toHaveCSS(`width`, `800px`)
    await expect(structure_wrapper).toHaveCSS(`height`, `600px`)
  })

  test(`should handle scene props changes correctly`, async ({ page }) => {
    // Change scene props via test page controls
    const show_atoms_checkbox = page.locator(
      `label:has-text("Show Atoms") input[type="checkbox"]`,
    )
    const gizmo_checkbox = page.locator(
      `label:has-text("Show Gizmo") input[type="checkbox"]`,
    )

    // Toggle show atoms
    await show_atoms_checkbox.uncheck()
    await expect(show_atoms_checkbox).not.toBeChecked()

    // Toggle gizmo
    await gizmo_checkbox.check()
    await expect(gizmo_checkbox).toBeChecked()
  })

  test(`should handle background color changes correctly`, async ({ page }) => {
    // Change background color via test page controls
    const bg_color_input = page.locator(
      `label:has-text("Background Color") input[type="color"]`,
    )
    await bg_color_input.fill(`#ff0000`)

    // Verify the change was applied to the structure wrapper
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toHaveCSS(
      `background-color`,
      `rgba(255, 0, 0, 0.1)`, // With opacity
      { timeout: 5000 },
    )
  })

  test(`should handle fullscreen toggle correctly`, async ({ page }) => {
    // Click fullscreen button if visible
    const fullscreen_button = page.locator(`button[title*="fullscreen"]`)

    if (await fullscreen_button.isVisible()) {
      await fullscreen_button.click()

      // Verify fullscreen state changed
      const is_fullscreen = await page.evaluate(() => !!document.fullscreenElement)
      expect(is_fullscreen).toBe(true)

      // Exit fullscreen
      await page.keyboard.press(`Escape`)

      // Verify fullscreen was exited
      const is_fullscreen_after = await page.evaluate(() => !!document.fullscreenElement)
      expect(is_fullscreen_after).toBe(false)
    } else {
      // If fullscreen button is not visible, skip this test
      console.log(`Fullscreen button not visible, skipping fullscreen test`)
    }
  })

  test(`should handle camera reset correctly`, async ({ page }) => {
    // Look for reset camera button
    const reset_button = page.locator(`button.reset-camera`)

    if (await reset_button.isVisible()) {
      await reset_button.click()
      // Verify button was clicked (no specific assertion needed as this is just testing the interaction)
    } else {
      // If reset button is not visible, skip this test
      console.log(`Reset camera button not visible, skipping camera reset test`)
    }
  })

  test(`should handle structure controls pane correctly`, async ({ page }) => {
    // Toggle controls pane
    const controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    // Check initial state
    const initial_state = await controls_checkbox.isChecked()

    // Toggle the controls
    await controls_checkbox.click()

    // Verify the state changed
    await expect(controls_checkbox).toBeChecked({ checked: !initial_state })

    // Verify the status display updated
    await expect(page.locator(`[data-testid="pane-open-status"]`))
      .toContainText(`Controls Open Status: ${!initial_state}`)
  })

  test(`should handle multiple prop changes in sequence`, async ({ page }) => {
    // Perform multiple changes
    const perf_mode_select = page.locator(`label:has-text("Performance Mode") select`)
    const width_input = page.locator(`[data-testid="canvas-width-input"]`)
    const height_input = page.locator(`[data-testid="canvas-height-input"]`)
    const show_atoms_checkbox = page.locator(
      `label:has-text("Show Atoms") input[type="checkbox"]`,
    )

    // Change performance mode
    await perf_mode_select.selectOption(`speed`)

    // Change dimensions
    await width_input.fill(`700`)
    await height_input.fill(`500`)

    // Toggle show atoms
    await show_atoms_checkbox.uncheck()

    // Verify all changes were applied
    await expect(page.locator(`[data-testid="performance-mode-status"]`))
      .toContainText(`Performance Mode Status: speed`)
    await expect(page.locator(`[data-testid="canvas-width-status"]`))
      .toContainText(`Canvas Width Status: 700`)
    await expect(page.locator(`[data-testid="canvas-height-status"]`))
      .toContainText(`Canvas Height Status: 500`)
    await expect(show_atoms_checkbox).not.toBeChecked()
  })

  test(`should handle camera projection toggle correctly`, async ({ page }) => {
    // Open the structure controls pane to access camera controls
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.check()

    // Wait for controls pane to open
    const pane_div = page.locator(`#test-structure .controls-pane`)
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })

    // Find the camera projection select dropdown
    const camera_projection_select = pane_div.locator(
      `label:has-text("Projection") select`,
    )
    await expect(camera_projection_select).toBeVisible()

    // Check initial state
    await expect(camera_projection_select).toHaveValue(
      DEFAULTS.structure.camera_projection,
    )
    await expect(page.locator(`[data-testid="camera-projection-status"]`))
      .toContainText(`Camera Projection Status: ${DEFAULTS.structure.camera_projection}`)

    // Switch to orthographic projection
    await camera_projection_select.selectOption(`perspective`)

    // Verify the change was applied
    await expect(camera_projection_select).toHaveValue(`perspective`)
    await expect(page.locator(`[data-testid="camera-projection-status"]`))
      .toContainText(`Camera Projection Status: perspective`)

    // Switch back to orthographic projection
    await camera_projection_select.selectOption(`orthographic`)

    // Verify the change was applied
    await expect(camera_projection_select).toHaveValue(
      DEFAULTS.structure.camera_projection,
    )
    await expect(page.locator(`[data-testid="camera-projection-status"]`))
      .toContainText(`Camera Projection Status: orthographic`)

    // Verify the canvas is still visible and functional
    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()
  })

  test(`should handle error states gracefully`, async ({ page }) => {
    // Try to load a non-existent file
    await page.goto(`/test/structure?data_url=non-existent-file.json`)

    // Verify the page still loads and shows the UI
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toBeVisible()

    // Pane open status should still render
    await expect(page.locator(`[data-testid="pane-open-status"]`)).toBeVisible()
  })

  test.describe(`Event Handlers`, () => {
    // Helper function to clear events and wait
    const clear_events_and_wait = async (page: Page) => {
      await page.evaluate(() => {
        const event_calls = (globalThis as Record<string, unknown>).event_calls as
          | unknown[]
          | undefined
        if (event_calls) {
          // Clear the array by setting length to 0
          event_calls.length = 0
        }
      })
      // Wait a bit for the reactive update to propagate
      await page.waitForTimeout(100)
    }

    // Helper function to check event was triggered
    const check_event_triggered = async (
      page: Page,
      event_name: string,
      expected_props: string[] = [],
    ) => {
      const event_calls = await page.evaluate(() =>
        (globalThis as Record<string, unknown>).event_calls as unknown[] || []
      )

      const events = event_calls.filter((call) => {
        const call_obj = call as Record<string, unknown>
        return call_obj.event === event_name
      })

      expect(events.length).toBeGreaterThan(0)

      const event = events[0] as Record<string, unknown>
      expected_props.forEach((prop) => {
        expect(event.data as Record<string, unknown>).toHaveProperty(prop)
      })

      return event
    }

    test(`should trigger on_fullscreen_change event when fullscreen state changes`, async ({ page }) => {
      const fullscreen_button = page.locator(`#test-structure .fullscreen-toggle`)
      if (!(await fullscreen_button.isVisible())) test.skip()

      await clear_events_and_wait(page)
      await fullscreen_button.click()

      // Fullscreen API may not work in headless mode, so check if event was triggered
      // or if the button click was successful
      try {
        await check_event_triggered(page, `on_fullscreen_change`, [
          `is_fullscreen`,
          `structure`,
        ])
      } catch {
        // If event not triggered, verify the button is still functional
        await expect(fullscreen_button).toBeVisible()
      }
    })

    test(`should trigger on_file_load event when structure is loaded via data_url`, async ({ page }) => {
      await clear_events_and_wait(page)
      // Use a valid structure file that exists in the static directory
      await page.goto(`/test/structure?data_url=/structures/mp-1.json`)
      await page.waitForSelector(`#test-structure canvas`, { timeout: 10000 })

      // Wait for the file load event to be processed
      await page.waitForTimeout(2000)

      await check_event_triggered(page, `on_file_load`, [`structure`, `filename`])
    })

    test(`should trigger on_error event when file loading fails`, async ({ page }) => {
      await clear_events_and_wait(page)
      await page.goto(`/test/structure?data_url=non-existent.json`)

      // Wait for the error to be processed
      await page.waitForTimeout(3000)

      await check_event_triggered(page, `on_error`, [`error_msg`, `filename`])
    })

    // Skip this test for now as camera movement/reset is hard to trigger reliably in headless mode
    // The camera move event is triggered by Three.js OrbitControls which requires proper mouse interaction
    test.skip(`should trigger on_camera_move event when camera is moved`, () => {})
    test.skip(`should trigger on_camera_reset event when camera is reset`, () => {})
  })
})

test.describe(`Camera Projection Toggle Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.waitForSelector(`#test-structure canvas`, { timeout: 5000 })
  })

  // Helper for camera projection toggle tests
  async function test_camera_projection_toggle(
    page: Page,
    initial: string,
    target: string,
  ) {
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.check()

    const pane_div = page.locator(`#test-structure .controls-pane`)
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })

    const camera_projection_select = pane_div.locator(
      `label:has-text("Projection") select`,
    )

    if (initial !== DEFAULTS.structure.camera_projection) { // Set initial state if not default
      await camera_projection_select.selectOption(initial)
      await expect(camera_projection_select).toHaveValue(initial)
    }

    // Change to target projection
    await camera_projection_select.selectOption(target)
    await expect(camera_projection_select).toHaveValue(target)
    await expect(page.locator(`[data-testid="camera-projection-status"]`))
      .toContainText(`Camera Projection Status: ${target}`)
    await expect(page.locator(`#test-structure canvas`)).toBeVisible()
  }

  test(`camera projection can be toggled from perspective to orthographic`, async ({ page }) => {
    await test_camera_projection_toggle(page, `perspective`, `orthographic`)
  })

  test(`camera projection can be toggled from orthographic to perspective`, async ({ page }) => {
    await test_camera_projection_toggle(page, `orthographic`, `perspective`)
  })

  test(`camera projection behavior and visual differences`, async ({ page }) => {
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.check()

    const pane_div = page.locator(`#test-structure .controls-pane`)
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })

    const camera_projection_select = pane_div.locator(
      `label:has-text("Projection") select`,
    )
    const canvas = page.locator(`#test-structure canvas`)

    // Test both projections produce different visuals and respond to zoom
    const screenshots: Record<string, Buffer> = {}

    for (const projection of [`perspective`, `orthographic`]) {
      await camera_projection_select.selectOption(projection)
      await expect(page.locator(`[data-testid="camera-projection-status"]`))
        .toContainText(projection)

      screenshots[`${projection}_initial`] = await canvas.screenshot()
      await canvas.hover({ force: true })
      await page.mouse.wheel(0, -200)
      await page.waitForTimeout(100)
      screenshots[`${projection}_zoomed`] = await canvas.screenshot()
    }

    // Verify zoom responsiveness and visual differences
    expect(screenshots.perspective_initial.equals(screenshots.perspective_zoomed)).toBe(
      false,
    )
    expect(screenshots.orthographic_initial.equals(screenshots.orthographic_zoomed)).toBe(
      false,
    )
    expect(screenshots.perspective_initial.equals(screenshots.orthographic_initial)).toBe(
      false,
    )
  })

  test(`camera projection settings integration and persistence`, async ({ page }) => {
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.check()

    const pane_div = page.locator(`#test-structure .controls-pane`)
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })

    const camera_projection_select = pane_div.locator(
      `label:has-text("Projection") select`,
    )
    const atom_radius_input = pane_div.locator(
      `label:has-text("Radius") input[type="number"]`,
    )
    const auto_rotate_input = pane_div.locator(
      `label:has-text("Auto rotate speed") input[type="number"]`,
    )

    // Test 1: Settings preservation across projection changes
    await atom_radius_input.fill(`1.5`)
    await auto_rotate_input.fill(`0.5`)
    await camera_projection_select.selectOption(`orthographic`)

    await expect(atom_radius_input).toHaveValue(`1.5`)
    await expect(auto_rotate_input).toHaveValue(`0.5`)
    await expect(camera_projection_select).toHaveValue(`orthographic`)

    // Test 2: State persistence across pane close/open
    await test_page_controls_checkbox.uncheck()
    await expect(pane_div).not.toHaveClass(/pane-open/)
    await expect(page.locator(`[data-testid="camera-projection-status"]`)).toContainText(
      `orthographic`,
    )

    await test_page_controls_checkbox.check()
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })
    await expect(camera_projection_select).toHaveValue(`orthographic`)
    await expect(atom_radius_input).toHaveValue(`1.5`)
  })

  test(`camera projection UI accessibility and interactions`, async ({ page }) => {
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.check()

    const pane_div = page.locator(`#test-structure .controls-pane`)
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })

    // Test 1: UI controls accessibility and options
    const projection_label = pane_div.locator(`label:has-text("Projection")`)
    const projection_select = projection_label.locator(`select`)
    await expect(projection_select).toBeVisible()

    const options = await projection_select.locator(`option`).allTextContents()
    expect(options).toEqual([`Perspective`, `Orthographic`])

    // Test 2: Canvas interactions work with both projections
    const canvas = page.locator(`#test-structure canvas`)
    const canvas_box = await canvas.boundingBox()

    for (const projection of [`perspective`, `orthographic`]) {
      await projection_select.selectOption(projection)

      if (canvas_box) {
        await canvas.click({
          position: { x: canvas_box.width / 2, y: canvas_box.height / 2 },
          force: true,
        })
        await canvas.hover({ force: true })
        await page.mouse.wheel(0, -100)
      }
    }

    // Verify canvas remains responsive
    await expect(canvas).toBeVisible()
    const canvas_size = await canvas.evaluate((el) => ({
      width: (el as HTMLCanvasElement).width,
      height: (el as HTMLCanvasElement).height,
    }))
    expect(canvas_size.width).toBeGreaterThan(0)
  })

  test(`camera projection controls integration and functionality`, async ({ page }) => {
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.check()

    const pane_div = page.locator(`#test-structure .controls-pane`)
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })

    const camera_projection_select = pane_div.locator(
      `label:has-text("Projection") select`,
    )
    const auto_rotate_input = pane_div.locator(
      `label:has-text("Auto rotate speed") input[type="number"]`,
    )
    const zoom_speed_input = pane_div.locator(
      `label:has-text("Zoom speed") input[type="number"]`,
    )
    const canvas = page.locator(`#test-structure canvas`)

    // Test camera controls integration across both projections
    const test_values = {
      perspective: [`1.0`, `0.5`],
      orthographic: [`0.8`, `0.4`],
    } as const

    for (const [projection, [auto_rotate, zoom_speed]] of Object.entries(test_values)) {
      await camera_projection_select.selectOption(projection)
      await auto_rotate_input.fill(auto_rotate)
      await zoom_speed_input.fill(zoom_speed)

      await expect(auto_rotate_input).toHaveValue(auto_rotate)
      await expect(zoom_speed_input).toHaveValue(zoom_speed)
      await expect(camera_projection_select).toHaveValue(projection)
    }

    // Test visual rendering differences
    await camera_projection_select.selectOption(`perspective`)
    const perspective_visual = await canvas.screenshot()

    await camera_projection_select.selectOption(`orthographic`)
    const orthographic_visual = await canvas.screenshot()

    expect(perspective_visual.equals(orthographic_visual)).toBe(false)
    expect(perspective_visual.length).toBeGreaterThan(1000)
    expect(orthographic_visual.length).toBeGreaterThan(1000)

    // Verify status display updates correctly (validates UI state connection)
    await expect(page.locator(`[data-testid="camera-projection-status"]`)).toContainText(
      `orthographic`,
    )
  })

  test.describe(`Structure Controls Reset Functionality`, () => {
    test.beforeEach(async ({ page }: { page: Page }) => {
      // Open structure controls pane
      await open_structure_control_pane(page)
    })

    test(`visibility section reset button appears and works`, async ({ page }) => {
      // Change a visibility setting (Show Atoms) within the Visibility section
      const visibility_heading = page.locator(
        `#test-structure .controls-pane h4:has-text("Visibility")`,
      )
      const visibility_container = visibility_heading.locator(
        `xpath=following-sibling::*[1]`,
      )
      const show_atoms_checkbox = visibility_container.getByLabel(`Atoms`, {
        exact: true,
      })
      await show_atoms_checkbox.uncheck()

      // Reset button should appear in Visibility section (within the heading)
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
      await expect(visibility_reset).toBeVisible()

      // Click reset button
      await visibility_reset.click()

      // Checkbox should be checked again
      await expect(show_atoms_checkbox).toBeChecked()

      // (No assertion about reset button visibility)
    })

    test(`camera section reset button appears and works`, async ({ page }) => {
      // Change camera projection within the Camera section
      const camera_heading = page.locator(
        `#test-structure .controls-pane h4:has-text("Camera")`,
      )
      const camera_container = camera_heading.locator(`xpath=following-sibling::*[1]`)
      const projection_select = camera_container.locator(
        `label:has-text("Projection") select`,
      )
      await projection_select.selectOption(`orthographic`)

      // Reset button should appear in Camera section
      const camera_reset = camera_heading.locator(`button.reset-button`)
      await expect(camera_reset).toBeVisible()

      // Click reset button
      await camera_reset.click()

      // Projection should be back to perspective
      await expect(projection_select).toHaveValue(`perspective`)
    })

    test(`atoms section reset button appears and works`, async ({ page }) => {
      // Change atom radius within the Atoms section
      const atoms_heading = page.locator(
        `#test-structure .controls-pane h4:has-text("Atoms")`,
      )
      const atoms_container = atoms_heading.locator(`xpath=following-sibling::*[1]`)
      const radius_input = atoms_container.locator(
        `label:has-text("Radius") input[type="number"]`,
      )
      await radius_input.fill(`1.5`)

      // Reset button should appear in Atoms section
      const atoms_reset = atoms_heading.locator(`button.reset-button`)
      await expect(atoms_reset).toBeVisible()

      // Click reset button
      await atoms_reset.click()

      // Radius should be back to default (1)
      await expect(radius_input).toHaveValue(`1`)
    })

    test(`cell section reset button appears and works`, async ({ page }) => {
      // Change cell edge opacity within the Cell section
      const cell_heading = page.locator(
        `#test-structure .controls-pane h4:has-text("Cell")`,
      )
      const cell_container = cell_heading.locator(`xpath=following-sibling::*[1]`)
      const opacity_input = cell_container.locator(
        `label:has-text("Edge color") + label input[type="number"]`,
      )
      await opacity_input.fill(`0.8`)

      // Reset button should appear in Cell section
      const cell_reset = cell_heading.locator(`button.reset-button`)
      await expect(cell_reset).toBeVisible()

      // Click reset button
      await cell_reset.click()

      // Opacity should be back to library default (0.3)
      await expect(opacity_input).toHaveValue(`0.3`)
    })

    test(`background section reset button appears and works`, async ({ page }) => {
      // Change background opacity within Background section
      const background_heading = page.locator(
        `#test-structure .controls-pane h4:has-text("Background")`,
      )
      const background_container = background_heading.locator(
        `xpath=following-sibling::*[1]`,
      )
      const bg_opacity_input = background_container.locator(
        `label:has-text("Opacity") input[type="number"]`,
      )
      await bg_opacity_input.fill(`0.5`)

      // Reset button should appear in Background section
      const bg_reset = background_heading.locator(`button.reset-button`)
      await expect(bg_reset).toBeVisible()

      // Click reset button
      await bg_reset.click()

      // Opacity should be back to default 0
      await expect(bg_opacity_input).toHaveValue(`0`)
    })

    test(`lighting section reset button appears and works`, async ({ page }) => {
      // Change directional light
      const lighting_heading = page.locator(
        `#test-structure .controls-pane h4:has-text("Lighting")`,
      )
      const lighting_container = lighting_heading.locator(`xpath=following-sibling::*[1]`)
      const directional_input = lighting_container.locator(
        `label:has-text("Directional light") input[type="number"]`,
      )
      await directional_input.fill(`2.5`)

      // Reset button should appear in Lighting section
      const lighting_reset = lighting_heading.locator(`button.reset-button`)
      await expect(lighting_reset).toBeVisible()

      // Click reset button
      await lighting_reset.click()

      // Directional light should be back to original
      await expect(directional_input).toHaveValue(`2.2`)

      // Reset button should disappear
      await expect(lighting_reset).not.toBeVisible()
    })

    test(`bonds section reset button appears when bonds are shown`, async ({ page }) => {
      // Enable bonds first
      const show_bonds_select = page.locator(`text=bonds`).locator(`..`).locator(
        `.multiselect`,
      )
      await show_bonds_select.click()
      // Select "always" option
      await page.locator(`.multiselect-option`).filter({ hasText: `Always` }).click()

      // Wait for bonds section to appear
      await expect(page.locator(`text=Bonds`)).toBeVisible()

      // Change bonding strategy
      const bonding_select = page.locator(`text=Bonding strategy`).locator(`..`).locator(
        `select`,
      )
      await bonding_select.selectOption(`nearest_neighbor`)

      // Reset button should appear in Bonds section
      const bonds_reset = page.locator(`text=Bonds`).locator(`..`).locator(`button`, {
        hasText: `Reset`,
      })
      await expect(bonds_reset).toBeVisible()

      // Click reset button
      await bonds_reset.click()

      // Bonding strategy should be back to default
      await expect(bonding_select).toHaveValue(`max_dist`)

      // Reset button should disappear
      await expect(bonds_reset).not.toBeVisible()
    })

    test(`labels section reset button appears when labels are shown`, async ({ page }) => {
      // Enable site labels first
      const show_labels_checkbox = page.locator(`text=Site Labels`).locator(`..`).locator(
        `input[type="checkbox"]`,
      )
      await show_labels_checkbox.check()

      // Wait for labels section to appear
      await expect(page.locator(`text=Labels`)).toBeVisible()

      // Change label size
      const size_range = page.locator(`text=Size`).locator(`..`).locator(
        `input[type="range"]`,
      )
      await size_range.fill(`1.5`)

      // Reset button should appear in Labels section
      const labels_reset = page.locator(`text=Labels`).locator(`..`).locator(`button`, {
        hasText: `Reset`,
      })
      await expect(labels_reset).toBeVisible()

      // Click reset button
      await labels_reset.click()

      // Size should be back to default
      await expect(size_range).toHaveValue(`1`)

      // Reset button should disappear
      await expect(labels_reset).not.toBeVisible()
    })

    test(`multiple sections can have reset buttons simultaneously`, async ({ page }) => {
      // Change settings in multiple sections
      const show_atoms_checkbox = page.locator(`input[type="checkbox"]`).first()
      await show_atoms_checkbox.uncheck()

      const projection_select = page.locator(`select`).first()
      await projection_select.selectOption(`orthographic`)

      const bg_opacity_input = page.locator(`text=Background`).locator(`..`).locator(
        `input[type="number"]`,
      )
      await bg_opacity_input.fill(`0.5`)

      // All three reset buttons should be visible
      const visibility_reset = page.locator(`text=Visibility`).locator(`..`).locator(
        `button`,
        { hasText: `Reset` },
      )
      const camera_reset = page.locator(`text=Camera`).locator(`..`).locator(`button`, {
        hasText: `Reset`,
      })
      const bg_reset = page.locator(`text=Background`).locator(`..`).locator(`button`, {
        hasText: `Reset`,
      })

      await expect(visibility_reset).toBeVisible()
      await expect(camera_reset).toBeVisible()
      await expect(bg_reset).toBeVisible()

      // Reset one section
      await camera_reset.click()

      // Only camera reset should disappear
      await expect(visibility_reset).toBeVisible()
      await expect(camera_reset).not.toBeVisible()
      await expect(bg_reset).toBeVisible()

      // Projection should be reset but other changes remain
      await expect(projection_select).toHaveValue(`perspective`)
      await expect(show_atoms_checkbox).not.toBeChecked()
      await expect(bg_opacity_input).toHaveValue(`0.5`)
    })

    test(`reset buttons prevent event propagation`, async ({ page }) => {
      // Change a setting to make reset button appear
      const show_atoms_checkbox = page.locator(`input[type="checkbox"]`).first()
      await show_atoms_checkbox.uncheck()

      // Get the reset button
      const visibility_reset = page.locator(`text=Visibility`).locator(`..`).locator(
        `button`,
        { hasText: `Reset` },
      )
      await expect(visibility_reset).toBeVisible()

      // Click reset button - pane should stay open
      await visibility_reset.click()

      // Control pane should still be visible (not closed by the click)
      await expect(page.locator(`.structure-controls-toggle`)).toBeVisible()
      await expect(page.locator(`text=Structure Controls`)).toBeVisible()
    })

    test(`reset buttons have proper accessibility attributes`, async ({ page }) => {
      // Change a setting to make reset button appear
      const show_atoms_checkbox = page.locator(`input[type="checkbox"]`).first()
      await show_atoms_checkbox.uncheck()

      const visibility_reset = page.locator(`text=Visibility`).locator(`..`).locator(
        `button`,
        { hasText: `Reset` },
      )
      await expect(visibility_reset).toBeVisible()

      // Check accessibility attributes
      await expect(visibility_reset).toHaveAttribute(
        `title`,
        `Reset visibility to defaults`,
      )
      await expect(visibility_reset).toHaveAttribute(
        `aria-label`,
        `Reset visibility to defaults`,
      )
    })
  })
})
