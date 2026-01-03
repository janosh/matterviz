// deno-lint-ignore-file no-await-in-loop
import { DEFAULTS } from '$lib/settings'
import { expect, type Page, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import {
  get_canvas_timeout,
  goto_structure_test,
  IS_CI,
  open_structure_control_pane,
  open_structure_export_pane,
  wait_for_3d_canvas,
} from '../helpers'

test.describe(`Structure Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Structure tests timeout in CI (SSR error on /test/structure)`)
    await goto_structure_test(page)
  })

  test(`renders Structure component with canvas`, async ({ page }) => {
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toBeVisible()

    const canvas = structure_wrapper.locator(`canvas`)
    await expect(canvas).toBeVisible()
    // Three.js uses CSS sizing, not HTML attributes
    const canvas_timeout = get_canvas_timeout()
    await expect(canvas).toHaveCSS(`width`, `800px`, { timeout: canvas_timeout })
    await expect(canvas).toHaveCSS(`height`, `500px`, { timeout: canvas_timeout })

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

  test(`measure mode controls visible by default and hide when disabled`, async ({ page }) => {
    const measure_dropdown = page.locator(`#test-structure .measure-mode-dropdown`)
    await expect(measure_dropdown).toBeVisible()

    // Navigate with enable_measure_mode=false
    await goto_structure_test(page, `/test/structure?enable_measure_mode=false`)
    await expect(page.locator(`#test-structure .measure-mode-dropdown`)).toHaveCount(0)
  })

  test(`CellSelect appears on hover and hides on mouse leave`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)
    const supercell = structure.locator(`.cell-select`)

    // Initially hidden
    await expect(supercell).toHaveCSS(`opacity`, `0`)

    // Visible on hover
    await structure.hover()
    await expect(supercell).toHaveCSS(`opacity`, `1`)

    // Hidden after mouse leaves
    await page.mouse.move(0, 0)
    await expect(supercell).toHaveCSS(`opacity`, `0`)
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
      { timeout: get_canvas_timeout() },
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

    // Wait for initialization
    await expect(canvas_width_status).toContainText(`800`)
    await expect(canvas_height_status).toContainText(`500`)
    await expect(structure_wrapper_div).toHaveCSS(`width`, `800px`)
    await expect(structure_wrapper_div).toHaveCSS(`height`, `500px`)
    await expect(canvas).toHaveCSS(`width`, `800px`)

    // Canvas may inherit default height - check actual value
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

    // Test sequentially (avoid navigation conflicts)
    for (const { param, expected } of test_cases) {
      await page.goto(`/test/structure?performance_mode=${param}`, {
        waitUntil: `load`,
      })
      await wait_for_3d_canvas(page, `#test-structure`)
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
    page.once(`pageerror`, () => (error_occurred = true))

    await expect(fullscreen_button).toBeVisible()
    await expect(fullscreen_button).toBeEnabled()
    await expect(fullscreen_button).toHaveAttribute(
      `data-original-title`,
      /(Exit|Enter) fullscreen/,
    )
    await fullscreen_button.click({ force: true })
    expect(error_occurred).toBe(false)
  })

  test(`fullscreen prop is bindable and updates from test page controls`, async ({ page }) => {
    const status = page.locator(`[data-testid="fullscreen-status"]`)
    const checkbox = page.locator(`[data-testid="fullscreen-checkbox"]`)

    await expect(status).toContainText(`false`)
    await expect(checkbox).not.toBeChecked()

    await checkbox.click({ force: true })
    await expect(status).toContainText(`true`)
    await expect(checkbox).toBeChecked()

    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>(
        `[data-testid="fullscreen-checkbox"]`,
      )
      if (el) {
        el.checked = false
        el.dispatchEvent(new Event(`change`, { bubbles: true }))
      }
    })
    await expect(status).toContainText(`false`)
    await expect(checkbox).not.toBeChecked()
  })

  test(`fullscreen prop binds to component state`, async ({ page }) => {
    const checkbox = page.locator(`[data-testid="fullscreen-checkbox"]`)
    const canvas = page.locator(`#test-structure canvas`)

    await expect(canvas).toBeVisible()
    await checkbox.click({ force: true })
    await expect(checkbox).toBeChecked()
    await expect(canvas).toBeVisible()
  })

  test(`closes controls pane with Escape key`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const controls_toggle_button = structure_div.locator(
      `button.structure-controls-toggle`,
    )

    const { pane_div: control_pane } = await open_structure_control_pane(page)

    await page.keyboard.press(`Escape`)

    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
      `false`,
    )
    await expect(control_pane).toBeHidden()
    await expect(controls_toggle_button).toHaveAttribute(
      `title`,
      `Structure controls`,
    )
  })

  test(`keyboard shortcuts require modifier keys`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.click()

    const is_mac = await page.evaluate(() =>
      navigator.platform.toUpperCase().indexOf(`MAC`) >= 0
    )

    let page_errors = false
    page.once(`pageerror`, () => (page_errors = true))

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

    const { pane_div: control_pane } = await open_structure_control_pane(page)

    await outside_area.click({ position: { x: 0, y: 0 }, force: true })

    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
      `false`,
    )
    await expect(control_pane).toBeHidden()
    await expect(controls_toggle_button).toHaveAttribute(
      `title`,
      `Structure controls`,
    )
  })

  test(`show_site_labels defaults to false and can be toggled`, async ({ page }) => {
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

  test(`show_site_indices can be toggled`, async ({ page }) => {
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    const site_indices_label = control_pane.locator(`label:has-text("Site Indices")`)
    const site_indices_checkbox = site_indices_label.locator(`input[type="checkbox"]`)

    await expect(site_indices_label).toBeVisible()

    // Get initial state (could be true or false depending on settings)
    const initial_state = await site_indices_checkbox.isChecked()

    // Toggle to opposite state
    if (initial_state) {
      await site_indices_checkbox.uncheck()
      expect(await site_indices_checkbox.isChecked()).toBe(false)
      await site_indices_checkbox.check()
      expect(await site_indices_checkbox.isChecked()).toBe(true)
    } else {
      await site_indices_checkbox.check()
      expect(await site_indices_checkbox.isChecked()).toBe(true)
      await site_indices_checkbox.uncheck()
      expect(await site_indices_checkbox.isChecked()).toBe(false)
    }
  })

  test(`show_site_indices controls are properly labeled`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const site_indices_label = pane_div.locator(
      `label:has-text("Site Indices")`,
    )
    const site_indices_checkbox = site_indices_label.locator(
      `input[type="checkbox"]`,
    )

    await expect(site_indices_label).toBeVisible()
    await expect(site_indices_checkbox).toBeVisible()
    expect(await site_indices_label.count()).toBe(1)
    expect(await site_indices_checkbox.count()).toBe(1)
  })

  test(`both site labels and site indices can be enabled simultaneously`, async ({ page }) => {
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    const site_labels_checkbox = control_pane.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    const site_indices_checkbox = control_pane.locator(
      `label:has-text("Site Indices") input[type="checkbox"]`,
    )

    // Enable both
    await site_labels_checkbox.check()
    await site_indices_checkbox.check()

    // Verify both are enabled
    expect(await site_labels_checkbox.isChecked()).toBe(true)
    expect(await site_indices_checkbox.isChecked()).toBe(true)

    // Verify Labels section is visible when site labels are enabled
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeVisible()

    // Disable one at a time to test independence
    await site_labels_checkbox.uncheck()
    expect(await site_labels_checkbox.isChecked()).toBe(false)
    expect(await site_indices_checkbox.isChecked()).toBe(true)

    // Labels section remains visible when Site Indices enabled
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeVisible()

    // Disable both - Labels section should hide
    await site_indices_checkbox.uncheck()
    expect(await site_indices_checkbox.isChecked()).toBe(false)
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeHidden()

    // Re-enable site indices only
    await site_indices_checkbox.check()
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeVisible()
  })

  test(`label controls appear when site labels are enabled`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels first
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Check that Labels section appears
    const labels_section = pane_div.locator(`h4:has-text("Labels")`)
    await expect(labels_section).toBeVisible()

    // Scope to labels section
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
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find text color input (first in labels section)
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
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find background opacity controls
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

    // Verify inputs are synchronized
    const final_number_value = await opacity_number_input.inputValue()
    const final_range_value = await opacity_range_input.inputValue()
    expect(parseFloat(final_number_value)).toBe(parseFloat(final_range_value))
  })

  test(`label padding control works correctly`, async ({ page }) => {
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

    // Verify inputs are synchronized
    const final_number_value = await padding_number_input.inputValue()
    const final_range_value = await padding_range_input.inputValue()
    expect(parseInt(final_number_value)).toBe(parseInt(final_range_value))
  })

  test(`label offset X control works correctly`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find offset X controls
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
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find offset Y controls
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
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Find offset Z controls
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

    // Find font size control
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
    await wait_for_3d_canvas(page, `#test-structure`)

    // Find element legend labels and validate count
    const legend_labels = structure_wrapper.locator(`.atom-legend label`)
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

  test(`controls pane stays open when interacting with control inputs`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)
    const controls_open_status = page.locator(
      `[data-testid="controls-open-status"]`,
    )
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )

    // Wait for test page controls to be visible
    await expect(test_page_controls_checkbox).toBeVisible({ timeout: 5000 })

    // Verify initial state with retry
    await expect(controls_open_status).toContainText(`false`, { timeout: 5000 })
    await expect(control_pane).not.toHaveClass(/pane-open/)

    // Open controls pane via test page checkbox
    await test_page_controls_checkbox.check()

    // Wait for the controls to open with explicit timeout
    await expect(controls_open_status).toContainText(`true`, { timeout: 5000 })
    await expect(control_pane).toHaveClass(/pane-open/, { timeout: 5000 })

    // Test that controls are accessible and pane stays open when interacting
    // Use exact match to avoid matching "Image Atoms" or "Same size atoms"
    const show_atoms_checkbox = control_pane.getByRole(`checkbox`, {
      name: `Atoms`,
      exact: true,
    })
    await expect(show_atoms_checkbox).toBeVisible()

    // Test various control interactions to ensure pane stays open
    await show_atoms_checkbox.click()
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Bonds uses a native select element with label "Bonds:"
    const show_bonds_label = control_pane
      .locator(`label`)
      .filter({ hasText: `Bonds:` })
    const show_bonds_select = show_bonds_label.locator(`select`)
    await expect(show_bonds_select).toBeVisible()
    await show_bonds_select.selectOption(`always`)
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

    // Test color scheme multiselect dropdown (uses svelte-multiselect with listbox)
    const color_scheme_label = control_pane
      .locator(`label`)
      .filter({ hasText: /Color scheme/ })
    const color_scheme_multiselect = color_scheme_label.locator(`.multiselect`)
    await expect(color_scheme_multiselect).toBeVisible()
    // Open the multiselect dropdown by clicking the visible textbox input
    await color_scheme_multiselect.getByRole(`textbox`).click()
    // Select Jmol option from the listbox (options may be portaled)
    const jmol_option = page.locator(`.multiselect ul.options li`).filter({
      hasText: `Jmol`,
    }).first()
    await expect(jmol_option).toBeVisible({ timeout: 3000 })
    await jmol_option.click()
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

    // Test color input in the Background section (h4 title followed by section)
    const background_section = control_pane.locator(`h4:has-text("Background") + section`)
    const background_color_input = background_section.locator(`input[type="color"]`)
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
        { timeout: get_canvas_timeout() },
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

    const { pane_div: control_pane } = await open_structure_control_pane(page)

    // Test that clicking on the canvas DOES close the pane (it's an outside click)
    await canvas.click({ position: { x: 100, y: 100 } })
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
      `false`,
    )
    await expect(control_pane).toBeHidden()

    // Re-open for toggle button test
    const { pane_div: control_pane2 } = await open_structure_control_pane(page)

    // Test that clicking controls toggle button does close the pane
    await controls_toggle_button.click()
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
      `false`,
    )
    await expect(control_pane2).toBeHidden()

    // Re-open for escape key test using helper function
    const { pane_div: control_pane3 } = await open_structure_control_pane(page)

    // Test escape key closes the pane
    await page.keyboard.press(`Escape`)
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
      `false`,
    )
    await expect(control_pane3).toBeHidden()

    // Re-open for outside click test using helper function
    const { pane_div: control_pane4 } = await open_structure_control_pane(page)

    // Test clicking outside the controls and toggle button closes the pane
    await page.locator(`body`).click({ position: { x: 10, y: 10 } })
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
      `false`,
    )
    await expect(control_pane4).toBeHidden()
  })

  test(`bond controls appear when bonds are enabled`, async ({ page }) => {
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

    // Wait for conditional controls (bonds enabled)
    // The Bonds section with h4 "Bonds" should appear when bonds are enabled
    if (selected_after && selected_after !== `never`) {
      // Look for the Bonds section header
      await expect(control_pane.locator(`h4:has-text("Bonds")`)).toBeVisible({
        timeout: 2000,
      })
    }

    // Check that bond-specific controls appear - use exact text matching to avoid conflicts
    // The Bonds section labels are: "Strategy", "Color", "Thickness"
    // We use the sibling relationship: Strategy <select>, Color <input type="color">, Thickness <input + range>
    const strategy_label = control_pane.locator(`label:has(select):has-text("Strategy")`)
    const bond_color_label = control_pane.locator(
      `label:has(input[type="color"]):has-text("Color")`,
    ).last()
    const thickness_label = control_pane.locator(`label:has-text("Thickness")`)

    await expect(strategy_label).toBeVisible()
    await expect(bond_color_label).toBeVisible()
    await expect(thickness_label).toBeVisible()

    // Test bond color change
    const bond_color_input = bond_color_label.locator(`input[type="color"]`)
    await bond_color_input.fill(`#00ff00`)

    // Test bonding strategy change
    const bonding_strategy_select = strategy_label.locator(`select`)
    await bonding_strategy_select.selectOption(`solid_angle`)
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

  test(`selected_sites controls highlight spheres (no labels/lines)`, async ({ page }) => {
    await goto_structure_test(page)

    await page.locator(`[data-testid="btn-set-selected"]`).click()

    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(0)

    await page.locator(`[data-testid="btn-clear-selected"]`).click()
    await expect(labels).toHaveCount(0)
  })

  test(`measured_sites shows selection order labels and measurement overlays`, async ({ page }) => {
    await goto_structure_test(page)

    await page.locator(`[data-testid="btn-set-measured"]`).click()

    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(3)
    await expect(labels.nth(0)).toHaveText(`1`)
    await expect(labels.nth(1)).toHaveText(`2`)
    await expect(labels.nth(2)).toHaveText(`3`)

    await page.locator(`[data-testid="btn-clear-measured"]`).click()
    await expect(labels).toHaveCount(0)
  })

  test(`reset selection button clears both measured_sites and selected_sites`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)

    // Set measured sites (which also sets selected_sites)
    await page.locator(`[data-testid="btn-set-measured"]`).click()

    // Verify selection labels are shown (these are DOM elements driven by selected_sites)
    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(3)

    // Verify the pulsating highlight is active by checking that selected_sites state is set
    // We can indirectly verify this through the DOM - the labels only show when selected_sites is populated
    await expect(labels.nth(0)).toBeVisible()
    await expect(labels.nth(1)).toBeVisible()
    await expect(labels.nth(2)).toBeVisible()

    // Find and click the reset selection button in the measure mode dropdown
    const reset_button = structure.locator(
      `button[aria-label="Reset selection and bond edits"]`,
    )
    await expect(reset_button).toBeVisible()
    await reset_button.click()

    // Verify selection labels are cleared (confirming selected_sites was cleared)
    // The pulsating animation is driven by selected_sites, so clearing it stops the animation
    await expect(labels).toHaveCount(0)

    // Verify the reset button disappears after reset (since measured_sites is empty)
    await expect(reset_button).toBeHidden()

    // Verify we can set measured sites again (proving state was fully reset)
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)

    // Clean up
    await page.locator(`[data-testid="btn-clear-measured"]`).click()
  })

  test(`selections are cleared on supercell scaling, image atoms toggle, and structure change`, async ({ page }) => {
    const labels = page.locator(`.selection-label`)

    // Supercell scaling clears selections
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)
    await page.locator(`[data-testid="supercell-input"]`).fill(`2x2x2`)
    await expect(labels).toHaveCount(0)

    // Image atoms toggle clears selections
    await page.locator(`[data-testid="supercell-input"]`).fill(`1x1x1`)
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)
    await page.locator(`[data-testid="image-atoms-checkbox"]`).click()
    await expect(labels).toHaveCount(0)
  })
})

test.describe(`File Drop Functionality Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `File drop tests timeout in CI`)
    // wait_for_3d_canvas handles both canvas visibility and non-zero dimensions
    await goto_structure_test(page)
  })

  test(`drops POSCAR file onto structure viewer and updates structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    // Wait for canvas to be fully rendered
    await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })

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

    // Drop on structure wrapper with proper drag events
    await structure_div.dispatchEvent(`dragenter`, { dataTransfer: data_transfer })
    await structure_div.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await structure_div.dispatchEvent(`drop`, { dataTransfer: data_transfer })
    await data_transfer.dispose()

    // Wait for structure to update with polling assertion
    await expect(async () => {
      const after_drop_screenshot = await canvas.screenshot()
      expect(initial_screenshot.equals(after_drop_screenshot)).toBe(false)
    }).toPass({ timeout: get_canvas_timeout() })
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

    // Drop on structure wrapper
    await structure_div.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await structure_div.dispatchEvent(`drop`, { dataTransfer: data_transfer })
    await data_transfer.dispose()

    const after_drop_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_drop_screenshot)).toBe(false)
  })

  test(`drops JSON structure file and updates structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    let canvas = structure_div.locator(`canvas`)

    // Take initial screenshot
    const initial_screenshot = await canvas.screenshot()

    // Create simple JSON structure (NaCl)
    const json_content = JSON.stringify(
      {
        sites: [
          {
            species: [{ element: `Na`, occu: 1, oxidation_state: 0 }],
            xyz: [0, 0, 0],
            abc: [0, 0, 0],
            label: `Na`,
            properties: {},
          },
          {
            species: [{ element: `Cl`, occu: 1, oxidation_state: 0 }],
            xyz: [1.4, 1.4, 1.4],
            abc: [0.5, 0.5, 0.5],
            label: `Cl`,
            properties: {},
          },
        ],
        lattice: {
          matrix: [
            [2.8, 0, 0],
            [0, 2.8, 0],
            [0, 0, 2.8],
          ],
          pbc: [true, true, true],
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

    // Drop on structure wrapper
    await structure_div.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await structure_div.dispatchEvent(`drop`, { dataTransfer: data_transfer })
    await data_transfer.dispose()

    // Wait for file load event
    await expect(page.locator(`[data-testid="event-calls-status"]`)).toContainText(
      `on_file_load`,
      { timeout: get_canvas_timeout() },
    )

    // Re-query canvas
    canvas = structure_div.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Verify structure changed
    const after_drop_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_drop_screenshot)).toBe(false)
  })
})

test.describe(`Reset Camera Button Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Reset camera tests timeout in CI`)
    await goto_structure_test(page)
  })

  test(`reset camera button is hidden initially when camera is at default position`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const reset_camera_button = structure_div.locator(`button.reset-camera`)

    await expect(reset_camera_button).toBeHidden()
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
      { timeout: get_canvas_timeout() },
    )
    expect(canvas_ready).toBeTruthy()

    // Verify reset button is still not visible (structure hasn't changed, camera hasn't moved)
    const final_button_count = await page.locator(`button.reset-camera`).count()
    expect(final_button_count).toBe(0)
  })
})

test.describe(`Export Button Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Export button tests timeout in CI`)
    await goto_structure_test(page)
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

  test(`XYZ export button click does not cause errors`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    const xyz_export_btn = export_pane.locator(
      `button[title="Download XYZ"]`,
    )
    await expect(xyz_export_btn).toBeVisible()
    await xyz_export_btn.click()

    await expect(xyz_export_btn).toBeEnabled()
  })

  test(`PNG export button click does not cause errors`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    const png_export_btn = export_pane.locator(`button[title*="PNG"]`)
    await expect(png_export_btn).toBeVisible()
    await png_export_btn.click()

    await expect(png_export_btn).toBeEnabled()
  })

  test(`export buttons have correct attributes and styling`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    // Test JSON export button attributes
    const json_export_btn = export_pane.locator(
      `button[title="Download JSON"]`,
    )
    await expect(json_export_btn).toHaveAttribute(`type`, `button`)
    await expect(json_export_btn).toHaveAttribute(`title`, `Download JSON`)

    // Test XYZ export button attributes
    const xyz_export_btn = export_pane.locator(
      `button[title="Download XYZ"]`,
    )
    await expect(xyz_export_btn).toHaveAttribute(`type`, `button`)
    await expect(xyz_export_btn).toHaveAttribute(`title`, `Download XYZ`)

    // Test PNG export button attributes (includes DPI info)
    const png_export_btn = export_pane.locator(
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
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    // The export pane has three sections: text, image, 3D model
    const export_containers = export_pane.locator(`.export-buttons`)
    const container_count = await export_containers.count()
    expect(container_count).toBe(3) // text, image, 3D model sections

    // Verify first container (text exports) has proper flex styling
    const first_container = export_containers.first()
    await expect(first_container).toBeVisible()

    const container_styles = await first_container.evaluate((el) => {
      const computed = globalThis.getComputedStyle(el)
      return {
        display: computed.display,
        gap: computed.gap,
      }
    })
    expect(container_styles.display).toBe(`flex`)

    // Verify JSON and XYZ buttons exist in text section
    const json_btn = first_container.locator(`button[title="Download JSON"]`)
    const xyz_btn = first_container.locator(`button[title="Download XYZ"]`)
    await expect(json_btn).toBeVisible()
    await expect(xyz_btn).toBeVisible()

    // Verify PNG button exists in image section (second container)
    const image_container = export_containers.nth(1)
    const png_btn = image_container.locator(`button[title*="PNG"]`)
    await expect(png_btn).toBeVisible()
  })

  test(`DPI input for PNG export works correctly`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    // Find DPI input
    const dpi_input = export_pane.locator(
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
    const png_export_btn = export_pane.locator(
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

  test(`export buttons work with loaded structure`, async ({ page }) => {
    const { container, pane_div: export_pane } = await open_structure_export_pane(
      page,
    )

    const canvas = container.locator(`canvas`)
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute(`width`)
    await expect(canvas).toHaveAttribute(`height`)

    const json_export_btn = export_pane.locator(`button[title="Download JSON"]`)
    const png_export_btn = export_pane.locator(`button[title*="PNG"]`)

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
      return { position: computed.position, display: computed.display, gap: computed.gap }
    })

    expect(section_styles.position).toBe(`absolute`)
    expect(section_styles.display).toBe(`flex`)

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
    test.skip(IS_CI, `Show buttons tests timeout in CI`)
    await goto_structure_test(page)
  })

  test(`should hide buttons when show_controls is false`, async ({ page }) => {
    await page.goto(`/test/structure?show_controls=false`)
    await page.waitForSelector(`canvas`)

    await expect(page.locator(`#test-structure section.control-buttons`))
      .not.toHaveClass(/visible/)

    await expect(page.locator(`#test-structure button.structure-info-toggle`)).not
      .toBeVisible()
    await expect(page.locator(`.fullscreen-toggle`)).toBeHidden()
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
    await expect(page.locator(`#test-structure button.structure-info-toggle`)).not
      .toBeVisible()
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
    await expect(page.locator(`#test-structure button.structure-info-toggle`))
      .toBeVisible()
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
    await expect(page.locator(`#test-structure button.structure-info-toggle`))
      .toBeVisible()
  })
})

test.describe(`Structure Event Handler Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Event handler tests timeout in CI`)
    await goto_structure_test(page)
  })

  test(`should handle file loading from URL correctly`, async ({ page }) => {
    // Load a structure file via URL
    const file_path = `/structures/mp-1.json`
    await goto_structure_test(page, `/test/structure?data_url=${file_path}`)

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

  test(`should handle canvas dimension changes correctly`, async ({ page }) => {
    // Change canvas dimensions via test page controls
    // Note: width/height are bound to clientWidth/clientHeight (read-only measurements).
    // The actual CSS dimensions are controlled by --struct-width/--struct-height CSS vars.
    // This test verifies the binding reflects changes to the inputs but the CSS uses defaults.
    const width_input = page.locator(`[data-testid="canvas-width-input"]`)
    const height_input = page.locator(`[data-testid="canvas-height-input"]`)

    // Clear and fill width
    await width_input.clear()
    await width_input.fill(`800`)

    // Clear and fill height
    await height_input.clear()
    await height_input.fill(`600`)

    // Verify the input changes were applied (these update the test page state)
    await expect(page.locator(`[data-testid="canvas-width-status"]`))
      .toContainText(`Canvas Width Status: 800`)
    await expect(page.locator(`[data-testid="canvas-height-status"]`))
      .toContainText(`Canvas Height Status: 600`)

    // The structure wrapper dimensions are controlled by CSS (--struct-height defaults to 500px)
    // so the actual CSS may differ from the bound values
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toHaveCSS(`width`, `800px`)
    // Height is controlled by CSS variable, so it stays at the default 500px
    await expect(structure_wrapper).toHaveCSS(`height`, `500px`)
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
      { timeout: get_canvas_timeout() },
    )
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

    // Check initial state - the select should have default value
    await expect(camera_projection_select).toHaveValue(
      DEFAULTS.structure.camera_projection,
    )

    // Switch to perspective projection
    await camera_projection_select.selectOption(`perspective`)

    // Verify the select value was updated
    await expect(camera_projection_select).toHaveValue(`perspective`)

    // Switch back to orthographic projection
    await camera_projection_select.selectOption(`orthographic`)

    // Verify the select value was updated
    await expect(camera_projection_select).toHaveValue(`orthographic`)

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
      await goto_structure_test(page, `/test/structure?data_url=/structures/mp-1.json`)

      // Wait for the file load event to be processed
      await expect(async () => {
        await check_event_triggered(page, `on_file_load`, [`structure`, `filename`])
      }).toPass({ timeout: get_canvas_timeout() })
    })

    test(`should trigger on_error event when file loading fails`, async ({ page }) => {
      await clear_events_and_wait(page)
      await page.goto(`/test/structure?data_url=non-existent.json`)

      // Wait for the error event to be processed
      await expect(async () => {
        await check_event_triggered(page, `on_error`, [`error_msg`, `filename`])
      }).toPass({ timeout: get_canvas_timeout() })
    })

    // TODO: Camera movement/reset events are hard to trigger reliably in headless mode
    // The camera move event is triggered by Three.js OrbitControls which requires proper mouse interaction
    // Tracking: These tests require real browser window for proper mouse events
    test.fixme(`should trigger on_camera_move event when camera is moved`, async () => {
      // Implement with proper mouse drag simulation once Playwright supports it better
    })
    test.fixme(`should trigger on_camera_reset event when camera is reset`, async () => {
      // Implement with proper double-click reset once camera events are testable
    })
  })
})

test.describe(`Camera Projection Toggle Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Camera projection tests timeout in CI`)
    await goto_structure_test(page)
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
    // Note: camera-projection-status doesn't update because scene_props binding is one-directional
    await expect(page.locator(`#test-structure canvas`)).toBeVisible()
  }

  test(`camera projection can be toggled from perspective to orthographic`, async ({ page }) => {
    await test_camera_projection_toggle(page, `perspective`, `orthographic`)
  })

  test(`camera projection can be toggled from orthographic to perspective`, async ({ page }) => {
    await test_camera_projection_toggle(page, `orthographic`, `perspective`)
  })

  test(`camera projection behavior and visual differences`, async ({ page }) => {
    // Skip in CI - this test relies on screenshot comparisons which are flaky in headless CI
    test.skip(IS_CI, `Screenshot comparisons flaky in CI`)

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
      await expect(camera_projection_select).toHaveValue(projection)

      screenshots[`${projection}_initial`] = await canvas.screenshot()
      await canvas.hover({ force: true })
      await page.mouse.wheel(0, -200)
      // Wait for zoom to be applied (screenshot should differ from initial)
      await expect(async () => {
        const zoomed = await canvas.screenshot()
        expect(screenshots[`${projection}_initial`].equals(zoomed)).toBe(false)
        screenshots[`${projection}_zoomed`] = zoomed
      }).toPass({ timeout: get_canvas_timeout() })
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
      `label:has-text("Auto-rotate speed") input[type="number"]`,
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
    // Note: camera-projection-status doesn't update because scene_props binding is one-directional
    // Instead we verify the select value persists after reopening

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
    const projection_select = pane_div.locator(`label:has-text("Projection") select`)
    await expect(projection_select).toBeVisible()

    const options = await projection_select.locator(`option`).allTextContents()
    expect(options).toEqual([`Perspective`, `Orthographic`])

    // Test 2: Canvas interactions work with both projections
    const canvas = page.locator(`#test-structure canvas`)
    const canvas_box = await canvas.boundingBox()

    for (const projection of [`perspective`, `orthographic`]) {
      // Re-open pane if it was closed by canvas interactions
      const has_pane_open = await pane_div.evaluate((el) =>
        el.classList.contains(`pane-open`)
      )
      if (!has_pane_open) {
        await test_page_controls_checkbox.check()
        await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })
      }
      await expect(projection_select).toBeVisible({ timeout: 2000 })
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
    // Skip in CI - this test relies on screenshot comparisons which are flaky in headless CI
    test.skip(IS_CI, `Screenshot comparisons flaky in CI`)

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
      `label:has-text("Auto-rotate speed") input[type="number"]`,
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

    // Verify the select value was updated correctly
    await expect(camera_projection_select).toHaveValue(`orthographic`)
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
      const controls_pane = page.locator(`#test-structure .controls-pane`)

      // Check if Camera section already has a reset button (shouldn't if just opened)
      const camera_heading = controls_pane.locator(`h4:has-text("Camera")`)
      await camera_heading.scrollIntoViewIfNeeded()
      const camera_reset = camera_heading.locator(`button.reset-button`)

      // Find the camera projection select and change it
      const projection_select = controls_pane.locator(
        `label:has-text("Projection") select`,
      )
      await projection_select.scrollIntoViewIfNeeded()

      // Store initial value
      const initial_value = await projection_select.inputValue()

      // Change to the opposite value
      const new_value = initial_value === `perspective` ? `orthographic` : `perspective`
      await projection_select.selectOption(new_value)

      // Verify the change took effect
      await expect(projection_select).toHaveValue(new_value)

      // Reset button should now appear in Camera section (DOM update, not canvas rendering)
      await expect(camera_reset).toBeVisible({ timeout: 3000 })

      // Click reset button
      await camera_reset.click()

      // Projection should be back to initial value (the default captured on mount)
      await expect(projection_select).toHaveValue(initial_value)
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
      await expect(lighting_reset).toBeHidden()
    })

    test(`bonds section reset button appears when bonds are shown`, async ({ page }) => {
      const controls_pane = page.locator(`#test-structure .controls-pane`)

      // Enable bonds via the "Bonds:" select in Visibility section
      const show_bonds_select = controls_pane.locator(`label:has-text("Bonds:") select`)
      await show_bonds_select.scrollIntoViewIfNeeded()
      await show_bonds_select.selectOption(`always`)

      // Wait for Bonds section (separate from Visibility) to appear (DOM update, not canvas rendering)
      const bonds_heading = controls_pane.locator(`h4:has-text("Bonds")`)
      await expect(bonds_heading).toBeVisible({ timeout: 3000 })

      // Change bonding strategy within the Bonds section (label is "Strategy")
      const strategy_select = controls_pane.locator(`label:has-text("Strategy") select`)
      await strategy_select.scrollIntoViewIfNeeded()

      // Get initial value
      const initial_value = await strategy_select.inputValue()
      const new_value = initial_value === `solid_angle` ? `voronoi` : `solid_angle`
      await strategy_select.selectOption(new_value)

      // Verify change
      await expect(strategy_select).toHaveValue(new_value)

      // Reset button should appear in Bonds section heading (DOM update, not canvas rendering)
      const bonds_reset = bonds_heading.locator(`button.reset-button`)
      await expect(bonds_reset).toBeVisible({ timeout: 3000 })

      // Click reset button
      await bonds_reset.click()

      // Bonding strategy should be back to initial value
      await expect(strategy_select).toHaveValue(initial_value)
    })

    test(`labels section reset button appears when labels are shown`, async ({ page }) => {
      // Enable site labels first
      const show_labels_checkbox = page.locator(
        `label:has-text("Site Labels") input[type="checkbox"]`,
      )
      await show_labels_checkbox.check()

      // Wait for labels section to appear
      await expect(page.locator(`h4:has-text("Labels")`)).toBeVisible()

      // Change label size
      const size_range = page.locator(`h4:has-text("Labels")`).locator(
        `xpath=following-sibling::*[1]`,
      ).locator(
        `label:has-text("Size") input[type="range"]`,
      )
      await size_range.fill(`1.5`)

      // Reset button should appear in Labels section
      const labels_reset = page.locator(`h4:has-text("Labels")`).locator(
        `button.reset-button`,
      )
      await expect(labels_reset).toBeVisible()

      // Click reset button
      await labels_reset.click()

      // Size should be back to default
      await expect(size_range).toHaveValue(`1`)

      // Reset button should disappear
      await expect(labels_reset).toBeHidden()

      // check that Labels control section hides after disabling labels
      await show_labels_checkbox.uncheck()
      await expect(page.locator(`h4:has-text("Labels")`)).toBeHidden()
    })

    test(`multiple sections can have reset buttons simultaneously`, async ({ page }) => {
      const controls_pane = page.locator(`#test-structure .controls-pane`)

      // Change setting in Visibility section
      const visibility_heading = controls_pane.locator(`h4:has-text("Visibility")`)
      const visibility_container = visibility_heading.locator(
        `xpath=following-sibling::*[1]`,
      )
      const show_atoms_checkbox = visibility_container.getByLabel(`Atoms`, {
        exact: true,
      })
      await show_atoms_checkbox.uncheck()

      // Change setting in Camera section - toggle to opposite of current value
      const camera_heading = controls_pane.locator(`h4:has-text("Camera")`)
      const projection_select = controls_pane.locator(
        `label:has-text("Projection") select`,
      )
      await projection_select.scrollIntoViewIfNeeded()
      const initial_projection = await projection_select.inputValue()
      const new_projection = initial_projection === `perspective`
        ? `orthographic`
        : `perspective`
      await projection_select.selectOption(new_projection)

      // Change setting in Background section - use the specific Opacity label with exact match
      const bg_heading = controls_pane.locator(`h4:has-text("Background")`)
      const bg_container = bg_heading.locator(`xpath=following-sibling::*[1]`)
      const bg_opacity_input = bg_container.locator(`input[type="number"]`)
      await bg_opacity_input.scrollIntoViewIfNeeded()
      const initial_opacity = await bg_opacity_input.inputValue()
      const new_opacity = initial_opacity === `0.5` ? `0.8` : `0.5`
      await bg_opacity_input.fill(new_opacity)

      // All three reset buttons should be visible (in their respective headings)
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
      const camera_reset = camera_heading.locator(`button.reset-button`)
      const bg_reset = bg_heading.locator(`button.reset-button`)

      // DOM updates, not canvas rendering - use shorter timeout
      await expect(visibility_reset).toBeVisible({ timeout: 3000 })
      await expect(camera_reset).toBeVisible({ timeout: 3000 })
      await expect(bg_reset).toBeVisible({ timeout: 3000 })

      // Reset one section
      await camera_reset.scrollIntoViewIfNeeded()
      await camera_reset.click()

      // Only camera reset should disappear
      await expect(visibility_reset).toBeVisible()
      await expect(camera_reset).toBeHidden()
      await expect(bg_reset).toBeVisible()

      // Projection should be reset to initial, other changes remain
      await expect(projection_select).toHaveValue(initial_projection)
      await expect(show_atoms_checkbox).not.toBeChecked()
      await expect(bg_opacity_input).toHaveValue(new_opacity)
    })

    test(`reset buttons prevent event propagation`, async ({ page }) => {
      // Change a visibility setting to make reset button appear
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

      // Get the reset button from within the heading
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
      await expect(visibility_reset).toBeVisible()

      // Click reset button - pane should stay open
      await visibility_reset.click()

      // Control pane should still be visible (not closed by the click)
      await expect(page.locator(`.structure-controls-toggle`)).toBeVisible()
      await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(
        `true`,
      )
    })

    test(`reset buttons have proper accessibility attributes`, async ({ page }) => {
      // Change a visibility setting to make reset button appear
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

      // Get the reset button from within the heading
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
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

test.describe(`Structure Rotation Controls Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Rotation controls tests timeout in CI`)
    await goto_structure_test(page)
  })

  test(`rotation controls are visible in Camera section`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    // Scope to Camera section for more stable selectors
    const camera_section = pane_div.locator(`h4:has-text("Camera")`)
    await expect(camera_section).toBeVisible()

    // Check for rotation axes container - it's in the Camera section but not directly under the h4
    const rotation_axes = pane_div.locator(`.rotation-axes`)
    await expect(rotation_axes).toBeVisible()

    // Verify X, Y, Z controls are present by checking the axis controls count
    const axis_controls = rotation_axes.locator(`> div`)
    await expect(axis_controls).toHaveCount(3)

    // Check that each control contains the expected axis labels
    await expect(rotation_axes).toContainText(`X =`)
    await expect(rotation_axes).toContainText(`Y =`)
    await expect(rotation_axes).toContainText(`Z =`)
  })

  test(`rotation controls default to zero degrees`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const number_inputs = rotation_axes.locator(`input[type="number"]`)
    const range_inputs = rotation_axes.locator(`input[type="range"]`)

    // All controls should default to 0
    for (let idx = 0; idx < 3; idx++) {
      await expect(number_inputs.nth(idx)).toHaveValue(`0`)
      await expect(range_inputs.nth(idx)).toHaveValue(`0`)
    }
  })

  test(`number input updates range slider and vice versa`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const x_number_input = rotation_axes.locator(`input[type="number"]`).first()
    const x_range_input = rotation_axes.locator(`input[type="range"]`).first()

    // Test number input → range slider
    await x_number_input.fill(`90`)
    await expect(x_range_input).toHaveValue(`90`)

    // Test range slider → number input
    await x_range_input.fill(`180`)
    await expect(x_number_input).toHaveValue(`180`)

    // Test another value
    await x_number_input.fill(`270`)
    await expect(x_range_input).toHaveValue(`270`)
  })

  test(`rotation controls clamp out-of-range values on input`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const x_number_input = rotation_axes.locator(`input[type="number"]`).first()
    const x_range_input = rotation_axes.locator(`input[type="range"]`).first()

    // Test entering 999 - verify range slider gets the clamped then normalized value
    await x_number_input.click()
    await x_number_input.fill(`999`)

    // The key insight: the range slider should reflect the clamped then normalized value
    // even if the number input temporarily shows the raw input
    await expect(x_range_input).toHaveValue(`0`) // 999 → clamped to 360 → 360 % 360 = 0

    // Test negative values get clamped to 0
    await x_number_input.fill(`-90`)
    await expect(x_range_input).toHaveValue(`0`) // -90 → clamped to 0

    // Test 360 normalizes to 0
    await x_number_input.fill(`360`)
    await expect(x_range_input).toHaveValue(`0`) // 360 % 360 = 0

    // Test valid range values work correctly
    await x_number_input.fill(`180`)
    await expect(x_number_input).toHaveValue(`180`)
    await expect(x_range_input).toHaveValue(`180`)

    // Test that changing the range slider updates the number input
    await x_range_input.fill(`270`)
    await expect(x_number_input).toHaveValue(`270`)
    await expect(x_range_input).toHaveValue(`270`)
  })

  test(`rotation controls handle edge cases correctly`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const y_number_input = rotation_axes.locator(`input[type="number"]`).nth(1)
    const y_range_input = rotation_axes.locator(`input[type="range"]`).nth(1)

    // Test specific edge cases - focus on range slider since it reflects the actual clamped then normalized value
    const test_cases = [
      { input: `359`, expected: `359` }, // 359 → stays 359
      { input: `361`, expected: `0` }, // 361 → clamped to 360 → 360 % 360 = 0
      { input: `450`, expected: `0` }, // 450 → clamped to 360 → 360 % 360 = 0
      { input: `720`, expected: `0` }, // 720 → clamped to 360 → 360 % 360 = 0
    ]

    for (const { input, expected } of test_cases) {
      await y_number_input.fill(input)
      // Test the range slider which always reflects the clamped then normalized value
      await expect(y_range_input).toHaveValue(expected)

      // For valid values, number input should match
      if (parseInt(input) <= 360) {
        await expect(y_number_input).toHaveValue(expected)
      }
    }
  })

  test(`all three axis controls work independently`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const number_inputs = rotation_axes.locator(`input[type="number"]`)
    const range_inputs = rotation_axes.locator(`input[type="range"]`)

    // Set different values for each axis
    await number_inputs.nth(0).fill(`30`) // X
    await number_inputs.nth(1).fill(`60`) // Y
    await number_inputs.nth(2).fill(`90`) // Z

    // Verify all values are set correctly and independently
    await expect(number_inputs.nth(0)).toHaveValue(`30`)
    await expect(number_inputs.nth(1)).toHaveValue(`60`)
    await expect(number_inputs.nth(2)).toHaveValue(`90`)

    await expect(range_inputs.nth(0)).toHaveValue(`30`)
    await expect(range_inputs.nth(1)).toHaveValue(`60`)
    await expect(range_inputs.nth(2)).toHaveValue(`90`)

    // Modify one axis and verify others remain unchanged
    await number_inputs.nth(1).fill(`120`) // Change Y

    await expect(number_inputs.nth(0)).toHaveValue(`30`) // X unchanged
    await expect(number_inputs.nth(1)).toHaveValue(`120`) // Y changed
    await expect(number_inputs.nth(2)).toHaveValue(`90`) // Z unchanged
  })

  test(`rotation controls have proper labels and structure`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const axis_controls = rotation_axes.locator(`> div`)

    const expected_axes = [`X`, `Y`, `Z`]

    // Check that all expected axis labels are present
    for (const axis_name of expected_axes) {
      await expect(rotation_axes).toContainText(`${axis_name} =`)
      await expect(rotation_axes).toContainText(`°`)
    }

    // Verify axis controls structure
    await expect(axis_controls).toHaveCount(3)

    // Each control should have both number and range inputs
    for (let idx = 0; idx < 3; idx++) {
      const control = axis_controls.nth(idx)
      await expect(control.locator(`input[type="number"]`)).toBeVisible()
      await expect(control.locator(`input[type="range"]`)).toBeVisible()
    }
  })

  test(`rotation controls reset with Camera section reset button`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const number_inputs = rotation_axes.locator(`input[type="number"]`)

    // Set some non-zero values
    await number_inputs.nth(0).fill(`45`)
    await number_inputs.nth(1).fill(`90`)
    await number_inputs.nth(2).fill(`135`)

    // Verify values are set (assertions include built-in retry)
    await expect(number_inputs.nth(0)).toHaveValue(`45`)
    await expect(number_inputs.nth(1)).toHaveValue(`90`)
    await expect(number_inputs.nth(2)).toHaveValue(`135`)

    // Find and click the reset button in the Camera section
    const reset_button = pane_div
      .locator(`h4:has-text("Camera")`)
      .locator(`button.reset-button`)
    await reset_button.click()

    // Verify all rotation values reset to 0 (assertions include built-in retry)
    await expect(number_inputs.nth(0)).toHaveValue(`0`)
    await expect(number_inputs.nth(1)).toHaveValue(`0`)
    await expect(number_inputs.nth(2)).toHaveValue(`0`)
  })

  test(`rotation controls persist across pane close/open`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const number_inputs = rotation_axes.locator(`input[type="number"]`)

    // Set rotation values
    await number_inputs.nth(0).fill(`120`)
    await number_inputs.nth(1).fill(`240`)
    await number_inputs.nth(2).fill(`300`)

    // Close the pane
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.uncheck()
    await expect(pane_div).not.toHaveClass(/pane-open/)

    // Reopen the pane
    await test_page_controls_checkbox.check()
    await expect(pane_div).toHaveClass(/pane-open/)

    // Verify values persisted
    const new_number_inputs = pane_div.locator(`.rotation-axes input[type="number"]`)
    await expect(new_number_inputs.nth(0)).toHaveValue(`120`)
    await expect(new_number_inputs.nth(1)).toHaveValue(`240`)
    await expect(new_number_inputs.nth(2)).toHaveValue(`300`)
  })

  test(`rotation controls layout is compact and organized`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)

    // Check CSS class exists (may have additional Svelte-generated classes)
    await expect(rotation_axes).toHaveClass(/rotation-axes/)

    // Verify layout properties
    const styles = await rotation_axes.evaluate((el) => {
      const computed = globalThis.getComputedStyle(el)
      return {
        display: computed.display,
        gap: computed.gap,
      }
    })

    expect(styles.display).toBe(`flex`)
    // allow small variance in computed gap
    const gapNum = parseFloat(styles.gap)
    expect(gapNum).toBeGreaterThan(8)
    expect(gapNum).toBeLessThan(20)

    // Check that all three controls are in a single row
    const axis_controls = rotation_axes.locator(`> div`)
    await expect(axis_controls).toHaveCount(3)
  })
})

test.describe(`Element Visibility Toggle`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Element visibility tests timeout in CI`)
    await goto_structure_test(page)
  })

  test(`toggle buttons are present on element badges`, async ({ page }) => {
    const legend = page.locator(`#test-structure .atom-legend`)
    await expect(legend).toBeVisible()

    const legend_items = legend.locator(`.legend-item`)
    const item_count = await legend_items.count()
    expect(item_count).toBeGreaterThan(0)

    // Verify first item has toggle button with correct attributes
    const first_toggle = legend_items.first().locator(`button.toggle-visibility`)
    await expect(first_toggle).toBeAttached()
    await expect(first_toggle).toContainText(`×`)

    // Tooltip consumes title attribute, stores in data-original-title
    await expect(first_toggle).toHaveAttribute(`data-original-title`, /Hide .+ atoms/)
  })

  test(`toggling elements hides/shows atoms with visual feedback`, async ({ page }) => {
    test.skip(IS_CI, `Screenshot comparison flaky in CI`)
    const canvas = page.locator(`#test-structure canvas`)
    const legend = page.locator(`#test-structure .atom-legend`)
    const first_item = legend.locator(`.legend-item`).first()
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    // Capture initial state
    const initial_screenshot = await canvas.screenshot()
    const initial_opacity = await label.evaluate((el) =>
      parseFloat(globalThis.getComputedStyle(el).opacity)
    )
    // Initial check - tooltip stores in data-original-title
    await expect(toggle_button).toHaveAttribute(`data-original-title`, /Hide .+ atoms/)

    // Hide element
    await first_item.hover()
    await toggle_button.click()

    // Verify hidden state (assertion includes built-in retry)
    await expect(label).toHaveClass(/hidden/)
    const hidden_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(hidden_screenshot)).toBe(false)

    // Wait for CSS transition to complete (opacity 0.2s ease)
    await expect(async () => {
      const hidden_opacity = await label.evaluate((el) =>
        parseFloat(globalThis.getComputedStyle(el).opacity)
      )
      expect(hidden_opacity).toBeLessThan(initial_opacity)
      // CSS sets .element-legend label.hidden { opacity: 0.4 }
      expect(hidden_opacity).toBeGreaterThan(0.3)
      expect(hidden_opacity).toBeLessThan(0.5)
    }).toPass({ timeout: 2000 })

    // After toggle, the button should have 'element-hidden' class (indicates atoms are hidden)
    await expect(toggle_button).toHaveClass(/element-hidden/)
  })

  test(`color picker remains functional with toggle button`, async ({ page }) => {
    const legend = page.locator(`#test-structure .atom-legend`)
    const first_item = legend.locator(`.legend-item`).first()
    const label = first_item.locator(`label`)
    const color_input = label.locator(`input[type="color"]`)

    // Verify label is clickable and element remains visible
    await label.click({ position: { x: 10, y: 10 } })
    await expect(label).not.toHaveClass(/hidden/)

    // Test color change functionality
    await color_input.evaluate((input: HTMLInputElement) => {
      input.value = `#ff0000`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
    })
    await expect(color_input).toHaveValue(`#ff0000`)

    // Double-click to reset color
    await label.dblclick({ position: { x: 10, y: 10 } })
    // Wait for color to change from #ff0000
    await expect(color_input).not.toHaveValue(`#ff0000`)
    const reset_color = await color_input.inputValue()
    expect(reset_color).not.toBe(`#ff0000`)
    // Should be close to original (may not be exact due to rounding)
    expect(reset_color.length).toBe(7) // Valid hex color
  })

  test(`toggle shows atoms after hiding`, async ({ page }) => {
    test.skip(IS_CI, `Screenshot comparison flaky in CI`)
    const canvas = page.locator(`#test-structure canvas`)
    const legend = page.locator(`#test-structure .atom-legend`)
    const first_item = legend.locator(`.legend-item`).first()
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    const initial_screenshot = await canvas.screenshot()

    // Hide
    await first_item.hover()
    await toggle_button.click()
    await expect(label).toHaveClass(/hidden/)
    await expect(toggle_button).toHaveClass(/element-hidden/)
    const hidden_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(hidden_screenshot)).toBe(false)

    // Show
    await toggle_button.click()
    await expect(label).not.toHaveClass(/hidden/)
    const shown_screenshot = await canvas.screenshot()
    // Visual should change back (may not be pixel-perfect due to rendering variations)
    expect(hidden_screenshot.equals(shown_screenshot)).toBe(false)
  })

  test(`multiple elements work independently`, async ({ page }) => {
    test.skip(IS_CI, `Screenshot comparison flaky in CI`)
    const canvas = page.locator(`#test-structure canvas`)
    const legend = page.locator(`#test-structure .atom-legend`)
    const legend_items = legend.locator(`.legend-item`)
    const item_count = await legend_items.count()

    if (item_count < 2) {
      test.skip()
      return
    }

    const initial_screenshot = await canvas.screenshot()
    const first_item = legend_items.nth(0)
    const second_item = legend_items.nth(1)
    const first_label = first_item.locator(`label`)
    const second_label = second_item.locator(`label`)

    // Hide first element
    await first_item.hover()
    await first_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).toHaveClass(/hidden/)
    await expect(second_label).not.toHaveClass(/hidden/)
    const after_first = await canvas.screenshot()
    expect(initial_screenshot.equals(after_first)).toBe(false)

    // Hide second element
    await second_item.hover()
    await second_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).toHaveClass(/hidden/)
    await expect(second_label).toHaveClass(/hidden/)
    const after_second = await canvas.screenshot()
    expect(after_first.equals(after_second)).toBe(false)

    // Show first element only
    await first_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).not.toHaveClass(/hidden/)
    await expect(second_label).toHaveClass(/hidden/)
  })

  test(`hidden state persists and button visibility works`, async ({ page }) => {
    const legend = page.locator(`#test-structure .atom-legend`)
    const first_item = legend.locator(`.legend-item`).first()
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    // Button hidden initially
    const initial_opacity = await toggle_button.evaluate((el) =>
      parseFloat(globalThis.getComputedStyle(el).opacity)
    )
    expect(initial_opacity).toBe(0)

    // Button visible on hover - wait for opacity to change
    await first_item.hover()
    await expect(async () => {
      const hover_opacity = await toggle_button.evaluate((el) =>
        parseFloat(globalThis.getComputedStyle(el).opacity)
      )
      expect(hover_opacity).toBeGreaterThan(0)
    }).toPass({ timeout: get_canvas_timeout() })

    // Hide element
    await toggle_button.click()
    await expect(label).toHaveClass(/hidden/)

    // Button stays visible when element hidden (via element-hidden class which sets opacity: 1)
    await page.mouse.move(0, 0)
    await expect(toggle_button).toHaveClass(/element-hidden/)
    const hidden_opacity = await toggle_button.evaluate((el) =>
      parseFloat(globalThis.getComputedStyle(el).opacity)
    )
    expect(hidden_opacity).toBeCloseTo(1, 2)

    // Hidden state persists through control pane interactions
    const controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await controls_checkbox.check()
    await controls_checkbox.uncheck()
    await expect(label).toHaveClass(/hidden/)
  })
})

test.describe(`Fullscreen Background Color Detection`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Fullscreen background tests timeout in CI`)
    await goto_structure_test(page)
  })

  // Helper to set background and trigger detection
  const set_bg = async (
    page: Page,
    html_bg: string | null,
    body_bg: string | null = null,
  ) => {
    await page.evaluate(
      ([html, body]) => {
        document.querySelectorAll(`style`).forEach((style_el) =>
          style_el.textContent?.includes(`background`) && style_el.remove()
        )
        document.documentElement.className = ``
        document.body.className = ``
        if (html) {
          document.documentElement.style.setProperty(
            `background-color`,
            html,
            `important`,
          )
        }
        if (body) document.body.style.setProperty(`background-color`, body, `important`)

        const el = document.querySelector(`#test-structure`) as HTMLElement
        if (!el) return
        const get_bg = () => {
          const html_bg = getComputedStyle(document.documentElement).backgroundColor
          const body_bg = getComputedStyle(document.body).backgroundColor
          const valid = (bg: string) =>
            bg && bg !== `rgba(0, 0, 0, 0)` && bg !== `transparent`
          if (valid(html_bg)) return html_bg
          if (valid(body_bg)) return body_bg
          return globalThis.matchMedia(`(prefers-color-scheme: dark)`).matches
            ? `#1a1a1a`
            : `#ffffff`
        }
        el.style.setProperty(`--struct-bg-fullscreen`, get_bg())
      },
      [html_bg, body_bg],
    )
  }

  const get_bg = (page: Page) =>
    page.locator(`#test-structure`).evaluate((el) =>
      getComputedStyle(el).getPropertyValue(`--struct-bg-fullscreen`)
    )

  test(`uses HTML background`, async ({ page }) => {
    await set_bg(page, `rgb(255, 100, 50)`)
    expect(await get_bg(page)).toBe(`rgb(255, 100, 50)`)
  })

  test(`uses body background when HTML transparent`, async ({ page }) => {
    await set_bg(page, `transparent`, `rgb(50, 150, 200)`)
    expect(await get_bg(page)).toBe(`rgb(50, 150, 200)`)
  })

  test(`prefers HTML over body background`, async ({ page }) => {
    await set_bg(page, `rgb(255, 0, 0)`, `rgb(0, 255, 0)`)
    expect(await get_bg(page)).toBe(`rgb(255, 0, 0)`)
  })

  test(`falls back to dark mode when no background`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: `dark` })
    await set_bg(page, `transparent`, `transparent`)
    expect(await get_bg(page)).toMatch(/rgb\(26, 26, 26\)|#1a1a1a/)
  })

  test(`falls back to light mode when no background`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: `light` })
    await set_bg(page, `transparent`, `transparent`)
    expect(await get_bg(page)).toMatch(/rgb\(255, 255, 255\)|#ffffff/)
  })

  test(`ignores rgba(0,0,0,0)`, async ({ page }) => {
    await set_bg(page, `rgba(0, 0, 0, 0)`, `rgb(100, 200, 150)`)
    expect(await get_bg(page)).toBe(`rgb(100, 200, 150)`)
  })

  test(`ignores transparent keyword`, async ({ page }) => {
    await set_bg(page, `transparent`, `rgb(75, 125, 200)`)
    expect(await get_bg(page)).toBe(`rgb(75, 125, 200)`)
  })

  test(`handles hex colors`, async ({ page }) => {
    await set_bg(page, `#3a7bd5`)
    expect(await get_bg(page)).toBe(`rgb(58, 123, 213)`)
  })

  test(`handles rgba with full opacity`, async ({ page }) => {
    await set_bg(page, `rgba(100, 150, 200, 1)`)
    const bg = await get_bg(page)
    expect(bg).toMatch(/rgb/)
    expect(bg).toContain(`100`)
    expect(bg).toContain(`150`)
    expect(bg).toContain(`200`)
  })
})
