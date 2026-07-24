import { DEFAULTS } from '$lib/settings'
import { expect, type Locator, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import {
  canvas_screenshot,
  dispatch_cancelable_keydown,
  drop_file,
  enter_edit_atoms_mode,
  expect_canvas_changed,
  get_canvas_timeout,
  goto_structure_test,
  IS_CI,
  open_structure_control_pane,
  open_structure_export_pane,
  select_view_layout as select_structure_layout,
  wait_for_3d_canvas,
} from '../helpers'

const is_mac = process.platform === `darwin`
const compressed_source_path = `/structures/source-loop.json.gz`
const compressed_source_filename =
  compressed_source_path.split(`/`).at(-1) ?? compressed_source_path
const source_structure = JSON.stringify({
  lattice: {
    matrix: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
  sites: [
    {
      species: [{ element: `H`, occu: 1 }],
      abc: [0, 0, 0],
      xyz: [0, 0, 0],
      label: `H1`,
      properties: {},
    },
  ],
})

async function expect_compressed_source_url(
  page: Page,
  route_path: string,
  heading_tag: string,
): Promise<void> {
  const requests: string[] = []
  await page.route(`**${compressed_source_path}`, (route) =>
    route.fulfill({ body: gzipSync(source_structure), contentType: `application/gzip` }),
  )
  page.on(`request`, (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith(compressed_source_path.replace(/\.gz$/, ``))) requests.push(path)
  })

  await page.goto(`${route_path}?file=${compressed_source_filename}`, {
    waitUntil: `networkidle`,
  })

  expect(new URL(page.url()).searchParams.get(`file`)).toBe(compressed_source_filename)
  await expect(page.locator(`.structure ${heading_tag}`).first()).toHaveText(
    `source-loop.json`,
    { timeout: get_canvas_timeout() * 4 },
  )
  expect(requests.length).toBeGreaterThan(0)
  expect(new Set(requests)).toEqual(new Set([compressed_source_path]))
}
test(`/structure keeps the compressed source URL after loading`, ({ page }) =>
  expect_compressed_source_url(page, `/structure`, `h3`))
test(`/structure/symmetry keeps the compressed source URL after loading`, ({ page }) =>
  expect_compressed_source_url(page, `/structure/symmetry`, `h2`))

test.describe(`Structure Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`renders Structure component with canvas`, async ({ page }) => {
    test.skip(IS_CI, `Structure canvas size test flaky in CI`)
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toBeVisible()

    const canvas = structure_wrapper.locator(`canvas`)
    await expect(canvas).toBeVisible()
    // Three.js uses CSS sizing, not HTML attributes
    const canvas_timeout = get_canvas_timeout()
    await expect(canvas).toHaveCSS(`width`, `800px`, { timeout: canvas_timeout })
    await expect(canvas).toHaveCSS(`height`, `500px`, { timeout: canvas_timeout })

    await expect(page.locator(`[data-testid="pane-open-status"]`)).toContainText(`false`)

    await page.waitForLoadState(`networkidle`)
    await expect(page.locator(`[data-testid="canvas-width-status"]`)).toContainText(`800`)
    await expect(page.locator(`[data-testid="canvas-height-status"]`)).toContainText(`500`)
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

  test(`CellSelect typography stays legible in narrow legends`, async ({ page }) => {
    await page.locator(`[data-testid="canvas-width-input"]`).fill(`260`)
    await expect(page.locator(`[data-testid="canvas-width-status"]`)).toContainText(`260`)

    const structure = page.locator(`#test-structure`)
    await structure.hover()
    const cell_select = structure.locator(`.cell-select`)
    await cell_select.dispatchEvent(`mouseenter`)
    await expect(cell_select.locator(`.dropdown`)).toBeVisible()

    const get_font_size = (selector: string): Promise<number> =>
      structure
        .locator(selector)
        .first()
        .evaluate((element) => Number(getComputedStyle(element).fontSize.replace(`px`, ``)))
    const legend_label_size = await get_font_size(`.atom-legend .legend-item label`)
    const toggle_size = await get_font_size(`.cell-select .toggle-btn`)
    const preset_size = await get_font_size(`.cell-select .preset-btn`)
    const preset_gap = await structure
      .locator(`.cell-select .supercell-grid`)
      .evaluate((element) => Number(getComputedStyle(element).gap.replace(`px`, ``)))
    const preset_padding = await structure
      .locator(`.cell-select .preset-btn`)
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          top: Number(style.paddingTop.replace(`px`, ``)),
          right: Number(style.paddingRight.replace(`px`, ``)),
        }
      })

    expect(toggle_size).toBeCloseTo(legend_label_size, 1)
    expect(preset_size).toBeGreaterThanOrEqual(legend_label_size)
    expect(preset_gap).toBeGreaterThanOrEqual(3)
    // preset buttons stay compact in narrow legends (line-height removed; padding kept tight at ≤1px)
    expect(preset_padding.top).toBeLessThanOrEqual(1)
    expect(preset_padding.right).toBeLessThanOrEqual(1)
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
    const width_input = page.locator(`label:has-text("Canvas Width") input[type="number"]`)
    const height_input = page.locator(`label:has-text("Canvas Height") input[type="number"]`)
    const canvas_width_status = page.locator(`[data-testid="canvas-width-status"]`)
    const canvas_height_status = page.locator(`[data-testid="canvas-height-status"]`)

    // Wait for initialization
    await expect(canvas_width_status).toContainText(`800`)
    await expect(canvas_height_status).toContainText(`500`)
    await expect(structure_wrapper_div).toHaveCSS(`width`, `800px`)
    await expect(structure_wrapper_div).toHaveCSS(`height`, `500px`)
    await expect(canvas).toHaveCSS(`width`, `800px`)

    // Canvas may inherit default height - check actual value
    const initial_canvas_height = await canvas.evaluate((el) => getComputedStyle(el).height)
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

  // This test navigates 3 times sequentially - needs extra time in CI
  test(`performance_mode prop can be set via URL parameters`, async ({ page }) => {
    test.setTimeout(IS_CI ? 90_000 : 30_000)
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
      await expect(perf_mode_status).toContainText(`Performance Mode Status: ${expected}`)
      await expect(perf_mode_select).toHaveValue(expected)
    }
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

  test(`keyboard shortcuts require modifier keys`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.click()

    let page_errors = false
    page.once(`pageerror`, () => (page_errors = true))

    // Test that single keys don't trigger actions or cause errors
    await page.keyboard.press(`f`)
    await page.keyboard.press(`i`)

    // Should not be in fullscreen mode after 'f' key
    const is_fullscreen = await page.evaluate(() => Boolean(document.fullscreenElement))
    expect(is_fullscreen).toBe(false)

    // Test that modifier key combinations can be dispatched without errors
    await page.evaluate((isMac) => {
      const structureDiv = document.querySelector(`#test-structure`) as HTMLElement
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
    await expect(site_labels_checkbox).toBeChecked()
    await expect(site_indices_checkbox).toBeChecked()

    // Verify Labels section is visible when site labels are enabled
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeVisible()

    // Disable one at a time to test independence
    await site_labels_checkbox.uncheck()
    await expect(site_labels_checkbox).not.toBeChecked()
    await expect(site_indices_checkbox).toBeChecked()

    // Labels section remains visible when Site Indices enabled
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeVisible()

    // Disable both - Labels section should hide
    await site_indices_checkbox.uncheck()
    await expect(site_indices_checkbox).not.toBeChecked()
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeHidden()

    // Re-enable site indices only
    await site_indices_checkbox.check()
    await expect(control_pane.locator(`h4:has-text("Labels")`)).toBeVisible()
  })

  test(`label styling controls echo values and enforce input constraints`, async ({
    page,
  }) => {
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels to reveal the Labels section
    await pane_div.locator(`label:has-text("Site Labels") input[type="checkbox"]`).check()
    const labels_heading = pane_div.locator(`h4:has-text("Labels")`)
    await expect(labels_heading).toBeVisible()
    const labels_container = labels_heading.locator(`xpath=following-sibling::*[1]`)
    const offset_row = labels_container.locator(`.pane-row`).filter({ hasText: `Offset` })

    // Color pickers echo filled values
    const color_cases = [
      {
        name: `text color`,
        input: labels_container.locator(`label:has-text("Color") input[type="color"]`).first(),
        fill: `#ff0000`,
      },
      {
        name: `background color`,
        input: labels_container.locator(`label:has-text("Background") input[type="color"]`),
        fill: `#0000ff`,
      },
    ]
    for (const { name, input, fill } of color_cases) {
      await expect(input, name).toBeVisible()
      expect(await input.inputValue(), name).toMatch(/^#[0-9a-fA-F]{6}$/)
      await input.fill(fill)
      expect(await input.inputValue(), name).toBe(fill)
    }

    // Numeric inputs echo filled values and carry expected min/max/step constraints
    const opacity_label = labels_container.locator(`label:has-text("Opacity")`).first()
    const padding_label = labels_container.locator(`label:has-text("Padding")`)

    // Default label background must be fully transparent (opacity 0) — assert before
    // the fill loop below overwrites it
    await expect(opacity_label.locator(`input[type="number"]`)).toHaveValue(`0`)
    const numeric_cases = [
      {
        name: `opacity number`,
        input: opacity_label.locator(`input[type="number"]`),
        fill: `0.5`,
        attrs: { min: `0`, max: `1`, step: `0.01` },
      },
      {
        name: `opacity range`,
        input: opacity_label.locator(`input[type="range"]`),
        fill: `0.8`,
      },
      {
        name: `padding number`,
        input: padding_label.locator(`input[type="number"]`),
        fill: `5`,
        attrs: { min: `0`, max: `10`, step: `1` },
      },
      {
        name: `padding range`,
        input: padding_label.locator(`input[type="range"]`),
        fill: `8`,
      },
      ...[
        { axis: `X`, fill: `0.5` },
        { axis: `Y`, fill: `-0.7` },
        { axis: `Z`, fill: `0.3` },
      ].map(({ axis, fill }) => ({
        name: `offset ${axis}`,
        input: offset_row.locator(`label:has-text("${axis}") input[type="number"]`),
        fill,
        attrs: { min: `-1`, max: `1`, step: `0.1` },
      })),
      {
        name: `font size range`,
        input: labels_container.locator(`label:has-text("Size") input[type="range"]`),
        fill: `1.5`,
        attrs: { min: `0.5`, max: `2`, step: `0.1` },
      },
    ]
    for (const { name, input, fill, attrs } of numeric_cases) {
      await expect(input, name).toBeVisible()
      for (const [attr, expected] of Object.entries(attrs ?? {})) {
        await expect(input, `${name} ${attr}`).toHaveAttribute(attr, expected)
      }
      await input.fill(fill)
      expect(Number(await input.inputValue()), name).toBe(Number(fill))
    }

    // Number and range inputs for the same setting stay synchronized
    expect(await opacity_label.locator(`input[type="number"]`).inputValue()).toBe(
      await opacity_label.locator(`input[type="range"]`).inputValue(),
    )
    expect(await padding_label.locator(`input[type="number"]`).inputValue()).toBe(
      await padding_label.locator(`input[type="range"]`).inputValue(),
    )
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
    const text_color_input = labels_container_for_persist
      .locator(`label:has-text("Color") input[type="color"]`)
      .first()
    const background_color_input = labels_container_for_persist.locator(
      `label:has-text("Background") input[type="color"]`,
    )
    const opacity_input = labels_container_for_persist
      .locator(`label:has-text("Opacity") input[type="number"]`)
      .first()

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
    expect(Number(new_opacity)).toBe(0.7)
  })

  test(`gizmo is visible by default and can be toggled`, async ({ page }) => {
    const gizmo_checkbox = page.locator(`label:has-text("Show Gizmo") input[type="checkbox"]`)
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

      // Poll for canvas change (GPU timing variations)
      // If first drag doesn't work, try vertical drag
      try {
        await expect_canvas_changed(canvas, initial_screenshot, 3000)
      } catch {
        // Take fresh baseline before second drag to avoid false positives
        // from delayed first drag rendering
        const baseline_before_second_drag = await canvas.screenshot()
        await canvas.dragTo(canvas, {
          sourcePosition: { x: box.width / 2, y: box.height / 2 - 100 },
          targetPosition: { x: box.width / 2, y: box.height / 2 + 100 },
        })
        await expect_canvas_changed(canvas, baseline_before_second_drag)
      }
    }
  })

  test(`controls pane stays open when interacting with control inputs`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const control_pane = structure_div.locator(`.controls-pane`)
    const controls_open_status = page.locator(`[data-testid="controls-open-status"]`)
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
    const show_bonds_label = control_pane.locator(`label`).filter({ hasText: `Bonds:` })
    const show_bonds_select = show_bonds_label.locator(`select`)
    await expect(show_bonds_select).toBeVisible()
    await show_bonds_select.selectOption(`always`)
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    const show_cell_vectors_label = control_pane
      .locator(`label`)
      .filter({ hasText: `Lattice Vectors` })
    const show_cell_vectors_checkbox =
      show_cell_vectors_label.locator(`input[type="checkbox"]`)
    await expect(show_cell_vectors_checkbox).toBeVisible()
    await show_cell_vectors_checkbox.click()
    await expect(controls_open_status).toContainText(`true`)
    await expect(control_pane).toHaveClass(/pane-open/)

    // Test number input
    const atom_radius_label = control_pane.locator(`label`).filter({ hasText: /Radius/ })
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
    const atom_radius_label = control_pane.locator(`label`).filter({ hasText: /Radius/ })
    const atom_radius_input = atom_radius_label.locator(`input[type="number"]`)

    await expect(atom_radius_input).toBeVisible()
    const initial_screenshot = await canvas.screenshot()
    await atom_radius_input.fill(`0.3`)

    // Poll for canvas change after radius change (GPU timing variations)
    await expect_canvas_changed(canvas, initial_screenshot)
    const after_radius_change = await canvas.screenshot()

    // Test show atoms checkbox
    const visibility_heading = control_pane.locator(`h4:has-text("Visibility")`)
    const visibility_container = visibility_heading.locator(`xpath=following-sibling::*[1]`)
    const show_atoms_checkbox = visibility_container.locator(`input[type="checkbox"]`).first()
    await show_atoms_checkbox.uncheck()

    // Poll for canvas change after hiding atoms
    await expect_canvas_changed(canvas, after_radius_change)

    // Re-enable atoms for next test
    await show_atoms_checkbox.check()
  })

  test(`controls pane closes only on escape and outside clicks`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const controls_toggle_button = structure_div.locator(`button.structure-controls-toggle`)
    const canvas = structure_div.locator(`canvas`)

    const { pane_div: control_pane } = await open_structure_control_pane(page)

    // Test that clicking on the canvas DOES close the pane (it's an outside click)
    await canvas.click({ position: { x: 100, y: 100 } })
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(`false`)
    await expect(control_pane).toBeHidden()

    // Re-open for toggle button test
    const { pane_div: control_pane2 } = await open_structure_control_pane(page)

    // Test that clicking controls toggle button does close the pane
    await controls_toggle_button.click()
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(`false`)
    await expect(control_pane2).toBeHidden()

    // Re-open for escape key test using helper function
    const { pane_div: control_pane3 } = await open_structure_control_pane(page)

    // Test escape key closes the pane
    await page.keyboard.press(`Escape`)
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(`false`)
    await expect(control_pane3).toBeHidden()

    // Re-open for outside click test using helper function
    const { pane_div: control_pane4 } = await open_structure_control_pane(page)

    // Test clicking outside the controls and toggle button closes the pane
    await page.locator(`body`).click({ position: { x: 10, y: 10 } })
    await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(`false`)
    await expect(control_pane4).toBeHidden()
    // tooltip attachment moves title to data-original-title
    await expect(controls_toggle_button).toHaveAttribute(
      `data-original-title`,
      `Structure controls`,
    )
  })

  test(`bond controls appear when bonds are enabled`, async ({ page }) => {
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    // Enable bonds via the Visibility section select
    const visibility_heading_for_bonds = control_pane.locator(`h4:has-text("Visibility")`)
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
    const bond_color_label = control_pane
      .locator(`label:has(input[type="color"]):has-text("Color")`)
      .last()
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

  test(`selected_sites controls highlight spheres (no labels/lines)`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const initial_screenshot = await canvas.screenshot()
    await page.locator(`[data-testid="btn-set-selected"]`).click()
    await expect_canvas_changed(canvas, initial_screenshot)

    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(0)

    const selected_screenshot = await canvas.screenshot()
    await page.locator(`[data-testid="btn-clear-selected"]`).click()
    await expect_canvas_changed(canvas, selected_screenshot)
    await expect(labels).toHaveCount(0)
  })

  test(`measured_sites shows selection order labels and measurement overlays`, async ({
    page,
  }) => {
    await page.locator(`[data-testid="btn-set-measured"]`).click()

    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(3)
    await expect(labels.nth(0)).toHaveText(`1`)
    await expect(labels.nth(1)).toHaveText(`2`)
    await expect(labels.nth(2)).toHaveText(`3`)

    await page.locator(`[data-testid="btn-clear-measured"]`).click()
    await expect(labels).toHaveCount(0)
  })

  test(`reset selection button clears both measured_sites and selected_sites`, async ({
    page,
  }) => {
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

  test(`selections are cleared on supercell scaling and image atoms toggle`, async ({
    page,
  }) => {
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

  test(`reset camera button is hidden initially when camera is at default position`, async ({
    page,
  }) => {
    const reset_camera_button = page.locator(`#test-structure button.reset-camera`)
    await expect(reset_camera_button).toBeHidden()
  })
})

test.describe(`File Drop Functionality Tests`, () => {
  // File drop tests use synthetic DataTransfer events which are unreliable in headless CI
  // Keep skipped - these work locally but not in CI due to browser security restrictions
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Synthetic file drop events unreliable in headless CI`)
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

    // Drop on structure wrapper with proper drag events
    await drop_file(page, structure_div, poscar_content, `test.poscar`)

    // Wait for structure to update with polling assertion
    await expect_canvas_changed(canvas, initial_screenshot)
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

    // Drop on structure wrapper
    await drop_file(page, structure_div, xyz_content, `cyclohexane.xyz`)

    // Wait for canvas to be visible and structure to update with polling assertion
    await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })
    await expect_canvas_changed(canvas, initial_screenshot)
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

    // Create file and simulate drop on structure wrapper
    await drop_file(page, structure_div, json_content, `nacl.json`, `application/json`)

    // Wait for file load event
    await expect(page.locator(`[data-testid="event-calls-status"]`)).toContainText(
      `on_file_load`,
      {
        timeout: get_canvas_timeout(),
      },
    )

    // Re-query canvas
    canvas = structure_div.locator(`canvas`)
    await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })

    // Poll for canvas change after structure load
    await expect_canvas_changed(canvas, initial_screenshot)
  })

  // Regression: commit 10477bb9 added scene_props.camera_target for comparison-view
  // sync. It persisted across structure loads, causing the orbit center to shift to a
  // corner of the new cell instead of its center. The fix clears camera_target in
  // parse_file_content so rotation_target (unit cell center) takes precedence.
  test(`rotation center resets to new lattice center after file drop`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)
    await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })

    // Rotate the initial structure (CsCl, ~6.26 Å cubic, center ≈ 3.13)
    // to populate scene_props.camera_target with the old structure's orbit center
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas has no bounding box`)
    const cx = box.width / 2
    const cy = box.height / 2
    await canvas.dragTo(canvas, {
      sourcePosition: { x: cx - 60, y: cy },
      targetPosition: { x: cx + 60, y: cy },
    })
    await page.waitForTimeout(300)

    // Drop a BaTiO3 POSCAR (4 Å cubic, center = [2, 2, 2])
    const poscar = [
      `BaTiO3\n1.0`,
      `4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0`,
      `Ba Ti O\n1 1 3\nDirect`,
      `0.0 0.0 0.0\n0.5 0.5 0.5\n0.5 0.5 0.0\n0.5 0.0 0.5\n0.0 0.5 0.5`,
    ].join(`\n`)
    const pre_drop = await canvas.screenshot()
    await drop_file(page, structure_div, poscar, `BaTiO3.poscar`)

    // Wait for the new structure to load and render
    await expect_canvas_changed(canvas, pre_drop)
    // Also verify on_file_load fired (confirms parse_file_content ran)
    await expect(page.locator(`[data-testid="event-calls-status"]`)).toContainText(
      `on_file_load`,
      {
        timeout: get_canvas_timeout(),
      },
    )

    // Clear stale camera target from first rotation, then rotate the NEW structure.
    // on_camera_move writes the orbit target to globalThis.camera_target.
    await page.evaluate(() => {
      ;(globalThis as Record<string, unknown>).camera_target = undefined
    })
    const post_load = await canvas.screenshot()
    await canvas.dragTo(canvas, {
      sourcePosition: { x: cx - 80, y: cy },
      targetPosition: { x: cx + 80, y: cy },
    })
    await expect_canvas_changed(canvas, post_load)

    // Orbit target should be near BaTiO3 center [2,2,2], not stale CsCl center [~3.13,~3.13,~3.13]
    const read_target = () =>
      page.evaluate(() => (globalThis as Record<string, unknown>).camera_target as number[])
    await expect(read_target).toPass({ timeout: get_canvas_timeout() })
    const camera_target = await read_target()
    expect(camera_target).toEqual(camera_target.map(() => expect.closeTo(2, 0)))
  })
})

test.describe(`Export Button Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Use show_controls=always so buttons are visible and clickable without hover
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`export button clicks do not cause errors`, async ({ page }) => {
    const { container, pane_div: export_pane } = await open_structure_export_pane(page)

    const canvas = container.locator(`canvas`)
    await expect(canvas).toBeVisible()
    await expect(canvas).toHaveAttribute(`width`)
    await expect(canvas).toHaveAttribute(`height`)

    for (const title_selector of [`Download JSON`, `Download XYZ`, `PNG`]) {
      const export_btn = export_pane.locator(`button[title*="${title_selector}"]`)
      await expect(export_btn).toBeVisible()
      const [download] = await Promise.all([page.waitForEvent(`download`), export_btn.click()])
      expect(await download.path()).toBeTruthy()
      await expect(export_btn).toBeEnabled()
    }
  })

  test(`DPI input for PNG export works correctly`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    // Find DPI input
    const dpi_input = export_pane.locator(`input[title="Export resolution in dots per inch"]`)
    await expect(dpi_input).toBeVisible()

    // Test DPI input attributes
    await expect(dpi_input).toHaveAttribute(`type`, `number`)
    await expect(dpi_input).toHaveAttribute(`min`, `50`)
    await expect(dpi_input).toHaveAttribute(`max`, `600`)
    // Note: DPI input doesn't have a step attribute

    // Test changing DPI value
    const initial_value = await dpi_input.inputValue()
    expect(Number(initial_value)).toBeGreaterThanOrEqual(72)

    await dpi_input.fill(`200`)
    await expect(dpi_input).toHaveValue(`200`)

    // Verify PNG button title updates with new DPI
    const png_export_btn = export_pane.locator(`button[title*="PNG"]`)
    await expect(png_export_btn).toHaveAttribute(`title`, /\(200 DPI\)/)

    // Test that DPI input accepts values within range (HTML inputs don't auto-clamp)
    await dpi_input.fill(`150`)
    await expect(dpi_input).toHaveValue(`150`)

    await dpi_input.fill(`72`)
    await expect(dpi_input).toHaveValue(`72`)
  })
})

test.describe(`Show Buttons Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`should hide buttons when show_controls is never`, async ({ page }) => {
    await page.goto(`/test/structure?show_controls=never`)
    await page.waitForSelector(`canvas`)

    // Verify show_controls is set to never from URL
    await expect(page.locator(`[data-testid="show-buttons-status"]`)).toContainText(
      `Show Buttons Status: never`,
    )

    // Control buttons should have no visibility class (stays hidden)
    const control_buttons = page.locator(`#test-structure section.control-buttons`)
    await expect(control_buttons).not.toHaveClass(/always-visible/)
    await expect(control_buttons).not.toHaveClass(/hover-visible/)

    // Buttons should not be visible even on hover
    await page.locator(`#test-structure`).hover()
    await expect(
      page.locator(`#test-structure button.structure-info-toggle`),
    ).not.toBeVisible()
    await expect(page.locator(`.fullscreen-toggle`)).toBeHidden()
  })

  test(`should show buttons on hover when show_controls is hover (default)`, async ({
    page,
  }) => {
    await page.goto(`/test/structure?show_controls=hover`)
    await page.waitForSelector(`canvas`)

    // Verify show_controls is set to hover from URL
    await expect(page.locator(`[data-testid="show-buttons-status"]`)).toContainText(
      `Show Buttons Status: hover`,
    )

    const control_buttons = page.locator(`#test-structure section.control-buttons`)
    await expect(control_buttons).toHaveClass(/hover-visible/)

    // Buttons should be hidden initially (opacity: 0)
    await expect(control_buttons).toHaveCSS(`opacity`, `0`)

    // Buttons should become visible on hover
    await page.locator(`#test-structure`).hover()
    await expect(control_buttons).toHaveCSS(`opacity`, `1`)
    await expect(page.locator(`#test-structure button.structure-info-toggle`)).toBeVisible()
  })

  test(`should always show buttons when show_controls is always`, async ({ page }) => {
    await page.goto(`/test/structure?show_controls=always`)
    await page.waitForSelector(`canvas`)

    // Verify show_controls is set to always from URL
    await expect(page.locator(`[data-testid="show-buttons-status"]`)).toContainText(
      `Show Buttons Status: always`,
    )

    const control_buttons = page.locator(`#test-structure section.control-buttons`)
    await expect(control_buttons).toHaveClass(/always-visible/)

    // Buttons should be visible immediately (no hover required)
    await expect(control_buttons).toHaveCSS(`opacity`, `1`)
    await expect(page.locator(`#test-structure button.structure-info-toggle`)).toBeVisible()
    await expect(page.locator(`.fullscreen-toggle`)).toBeVisible()
  })
})

test.describe(`Structure Event Handler Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Use show_controls=always so buttons are visible and clickable without hover
    await goto_structure_test(page, `/test/structure?show_controls=always`)
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
      const event_calls = await page.evaluate(
        () => ((globalThis as Record<string, unknown>).event_calls as unknown[]) || [],
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

    test(`should trigger on_fullscreen_change event when fullscreen state changes`, async ({
      page,
    }) => {
      const fullscreen_button = page.locator(`#test-structure .fullscreen-toggle`)
      await clear_events_and_wait(page)
      await fullscreen_button.click()

      await expect(async () => {
        const event = await check_event_triggered(page, `on_fullscreen_change`, [
          `fullscreen`,
          `structure`,
        ])
        expect(event.data).toMatchObject({ fullscreen: true })
      }).toPass({ timeout: get_canvas_timeout() })
    })

    test(`should trigger on_file_load event when structure is loaded via data_url`, async ({
      page,
    }) => {
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

      // UI should still render gracefully despite the load failure
      await expect(page.locator(`#test-structure`)).toBeVisible()
      await expect(page.locator(`[data-testid="pane-open-status"]`)).toBeVisible()
    })

    // Camera move/reset go through Three.js OrbitControls. The drag works in headless
    // (verified via globalThis.camera_target), but is unreliable in CI software GL.
    test(`should trigger on_camera_move event when camera is moved`, async ({ page }) => {
      test.skip(IS_CI, `Camera drag via OrbitControls unreliable in headless CI`)
      const canvas = page.locator(`#test-structure canvas`).first()
      await expect(canvas).toBeVisible()
      const box = await canvas.boundingBox()
      if (!box) throw new Error(`Canvas bounding box not found`)
      // on_camera_move writes the orbit target to globalThis.camera_target
      await page.evaluate(() => {
        ;(globalThis as Record<string, unknown>).camera_target = undefined
      })
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 80, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 80, y: box.height / 2 },
      })
      await expect
        .poll(
          () =>
            page.evaluate(() =>
              Array.isArray((globalThis as Record<string, unknown>).camera_target),
            ),
          { timeout: get_canvas_timeout() },
        )
        .toBe(true)
    })

    test(`should trigger on_camera_reset event when camera is reset`, async ({ page }) => {
      test.skip(IS_CI, `Camera drag via OrbitControls unreliable in headless CI`)
      const canvas = page.locator(`#test-structure canvas`).first()
      await expect(canvas).toBeVisible()
      const box = await canvas.boundingBox()
      if (!box) throw new Error(`Canvas bounding box not found`)
      // Move the camera so camera_has_moved flips true and the reset button appears
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 80, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 80, y: box.height / 2 },
      })
      await clear_events_and_wait(page)
      const reset_btn = page.locator(`#test-structure button.reset-camera`)
      await expect(reset_btn).toBeVisible({ timeout: get_canvas_timeout() })
      await reset_btn.click()
      await expect(async () => {
        await check_event_triggered(page, `on_camera_reset`, [`structure`, `camera_target`])
      }).toPass({ timeout: get_canvas_timeout() })
    })
  })
})

test.describe(`Camera Projection Toggle Tests`, () => {
  // Retry flaky screenshot comparison tests (WebGL rendering timing varies)
  test.describe.configure({ retries: 2 })

  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`camera projection behavior and visual differences`, async ({ page }) => {
    test.setTimeout(IS_CI ? 90_000 : 45_000)
    const canvas = page.locator(`#test-structure canvas`)

    // Test both projections produce different visuals and respond to zoom
    const screenshots: Record<string, Buffer> = {}

    for (const projection of [`perspective`, `orthographic`]) {
      // Re-open the controls pane each iteration (canvas.click closes it via click-outside)
      const { pane_div } = await open_structure_control_pane(page)
      const camera_projection_select = pane_div.locator(`label:has-text("Projection") select`)
      await expect(camera_projection_select).toBeVisible()
      await camera_projection_select.scrollIntoViewIfNeeded()
      await camera_projection_select.selectOption(projection)
      await expect(camera_projection_select).toHaveValue(projection)
      // Let camera/projection updates settle before visual assertions.
      await page.waitForTimeout(100)

      screenshots[`${projection}_initial`] = await canvas_screenshot(canvas)
      await canvas.hover({ force: true })
      await canvas.click({ force: true })
      // Dispatch multiple wheel events to reduce CI flakiness from dropped inputs.
      await page.mouse.wheel(0, -250)
      await page.mouse.wheel(0, -250)
      // Wait for zoom to be applied (screenshot should differ from initial)
      await expect_canvas_changed(canvas, screenshots[`${projection}_initial`])
      screenshots[`${projection}_zoomed`] = await canvas_screenshot(canvas)
    }

    // Verify zoom responsiveness and visual differences
    expect(screenshots.perspective_initial.equals(screenshots.perspective_zoomed)).toBe(false)
    expect(screenshots.orthographic_initial.equals(screenshots.orthographic_zoomed)).toBe(
      false,
    )
    expect(screenshots.perspective_initial.equals(screenshots.orthographic_initial)).toBe(
      false,
    )
  })

  test(`camera projection settings integration and persistence`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const camera_projection_select = pane_div.locator(`label:has-text("Projection") select`)
    const atom_radius_input = pane_div.locator(`label:has-text("Radius") input[type="number"]`)
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
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.uncheck()
    await expect(pane_div).not.toHaveClass(/pane-open/)
    // Note: camera-projection-status doesn't update because scene_props binding is one-directional
    // Instead we verify the select value persists after reopening

    await test_page_controls_checkbox.check()
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })
    await expect(camera_projection_select).toHaveValue(`orthographic`)
    await expect(atom_radius_input).toHaveValue(`1.5`)
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
      const visibility_container = visibility_heading.locator(`xpath=following-sibling::*[1]`)
      const show_atoms_checkbox = visibility_container.getByLabel(`Atoms`, {
        exact: true,
      })
      await show_atoms_checkbox.uncheck()

      // Reset button should appear in Visibility section (within the heading)
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
      await expect(visibility_reset).toBeVisible()
      await expect(visibility_reset).toHaveAttribute(`title`, `Reset visibility to defaults`)
      await expect(visibility_reset).toHaveAttribute(
        `aria-label`,
        `Reset visibility to defaults`,
      )

      // Click reset button
      await visibility_reset.click()

      // Checkbox should be checked again
      await expect(show_atoms_checkbox).toBeChecked()
      // Reset clicks must not propagate to the pane's outside-click handler
      await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(`true`)
    })

    test(`camera section reset button appears and works`, async ({ page }) => {
      const controls_pane = page.locator(`#test-structure .controls-pane`)

      // Check if Camera section already has a reset button (shouldn't if just opened)
      const camera_heading = controls_pane.locator(`h4:has-text("Camera")`)
      await camera_heading.scrollIntoViewIfNeeded()
      const camera_reset = camera_heading.locator(`button.reset-button`)

      // Find the camera projection select and change it
      const projection_select = controls_pane.locator(`label:has-text("Projection") select`)
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
      const atoms_heading = page.locator(`#test-structure .controls-pane h4:has-text("Atoms")`)
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

      // Radius should be back to default
      await expect(radius_input).toHaveValue(`${DEFAULTS.structure.atom_radius}`)
    })

    test(`cell section reset button appears and works`, async ({ page }) => {
      // Change cell edge opacity within the Cell section
      const cell_heading = page.locator(`#test-structure .controls-pane h4:has-text("Cell")`)
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
      const background_container = background_heading.locator(`xpath=following-sibling::*[1]`)
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
      const size_range = page
        .locator(`h4:has-text("Labels")`)
        .locator(`xpath=following-sibling::*[1]`)
        .locator(`label:has-text("Size") input[type="range"]`)
      await size_range.fill(`1.5`)

      // Reset button should appear in Labels section
      const labels_reset = page.locator(`h4:has-text("Labels")`).locator(`button.reset-button`)
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
      const visibility_container = visibility_heading.locator(`xpath=following-sibling::*[1]`)
      const show_atoms_checkbox = visibility_container.getByLabel(`Atoms`, {
        exact: true,
      })
      await show_atoms_checkbox.uncheck()

      // Change setting in Camera section - toggle to opposite of current value
      const camera_heading = controls_pane.locator(`h4:has-text("Camera")`)
      const projection_select = controls_pane.locator(`label:has-text("Projection") select`)
      await projection_select.scrollIntoViewIfNeeded()
      const initial_projection = await projection_select.inputValue()
      const new_projection =
        initial_projection === `perspective` ? `orthographic` : `perspective`
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
  })
})

test.describe(`Structure Rotation Controls Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`rotation controls clamp out-of-range values on input`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const x_number_input = rotation_axes.locator(`input[type="number"]`).first()
    const x_range_input = rotation_axes.locator(`input[type="range"]`).first()

    // The range slider always reflects the clamped then normalized value,
    // even if the number input temporarily shows the raw input
    const clamp_cases = [
      { input: `999`, expected: `0` }, // clamped to 360 → 360 % 360 = 0
      { input: `-90`, expected: `0` }, // negative clamped to 0
      { input: `360`, expected: `0` }, // 360 % 360 = 0
      { input: `359`, expected: `359` }, // stays 359
      { input: `361`, expected: `0` }, // clamped to 360 → 0
      { input: `720`, expected: `0` }, // clamped to 360 → 0
      { input: `180`, expected: `180` }, // valid value passes through
    ]
    for (const { input, expected } of clamp_cases) {
      await x_number_input.fill(input)
      await expect(x_range_input).toHaveValue(expected)
    }

    // Changing the range slider updates the number input
    await x_range_input.fill(`270`)
    await expect(x_number_input).toHaveValue(`270`)
    await expect(x_range_input).toHaveValue(`270`)
  })

  test(`all three axis controls work independently`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const rotation_axes = pane_div.locator(`.rotation-axes`)
    const number_inputs = rotation_axes.locator(`input[type="number"]`)
    const range_inputs = rotation_axes.locator(`input[type="range"]`)

    await expect(number_inputs).toHaveCount(3)
    await expect(range_inputs).toHaveCount(3)
    for (let axis_idx = 0; axis_idx < 3; axis_idx++) {
      await expect(number_inputs.nth(axis_idx)).toHaveValue(`0`)
      await expect(range_inputs.nth(axis_idx)).toHaveValue(`0`)
    }

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
})

test.describe(`Element Visibility Toggle`, () => {
  // Retry flaky screenshot comparison tests (WebGL rendering timing varies)
  test.describe.configure({ retries: 2 })

  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`hover chrome reveals repeatedly without remounting the gizmo`, async ({ page }) => {
    // Regression: `viewer_active` was a `$derived(hovered || focused)` reading the $bindable
    // `hovered` prop, which went stale after the first hover/leave cycle so the mode toggle (and
    // gizmo) only appeared on the very first mouseenter until page reload.
    await page.setViewportSize({ width: 1400, height: 1200 })
    const wrapper = page.locator(`#test-structure`)
    const toggle = page.locator(`#test-structure .atom-legend .mode-toggle`)
    const box = await page.locator(`#test-structure canvas`).boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)

    for (let cycle = 0; cycle < 3; cycle++) {
      await page.mouse.move(box.x + 40, box.y + 40) // hover the canvas (not the icon)
      await expect(toggle).toHaveCSS(`opacity`, `1`)
      await expect(wrapper).toHaveClass(/gizmo-visible/)
      await page.mouse.move(3, 3) // move off the viewer
      await expect(toggle).toHaveCSS(`opacity`, `0`)
      await expect(wrapper).not.toHaveClass(/gizmo-visible/)
      await expect(wrapper.locator(`.responsive-gizmo`)).toBeAttached()
    }
  })

  test(`element badge tooltip uses light theme colors`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: `light` })
    await page.locator(`#test-structure`).hover()
    const label = page.locator(`#test-structure .atom-legend .legend-item label`).first()
    await label.hover({ force: true })
    const tooltip = page.locator(`.custom-tooltip`)
    await expect(tooltip).toBeVisible()

    const { background_color, text_color } = await tooltip.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background_color: style.backgroundColor,
        text_color: style.color,
      }
    })

    expect(background_color).not.toMatch(/rgba?\(0,\s*0,\s*0/)
    expect(text_color).not.toMatch(/rgb\(255,\s*255,\s*255\)/)
  })

  test(`toggling elements hides/shows atoms with visual feedback`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const legend = page.locator(`#test-structure .atom-legend`)
    const first_item = legend.locator(`.legend-item`).first()
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    // Capture initial state
    const initial_screenshot = await canvas.screenshot()
    const initial_opacity = await label.evaluate((el) =>
      Number(globalThis.getComputedStyle(el).opacity),
    )
    // Initial check - tooltip stores in data-original-title
    await expect(toggle_button).toHaveAttribute(`data-original-title`, /Hide .+ atoms/)

    // Hide element
    await first_item.hover()
    await toggle_button.click()

    // Verify hidden state (assertion includes built-in retry)
    await expect(label).toHaveClass(/hidden/)
    // Poll for canvas change after hiding element
    await expect_canvas_changed(canvas, initial_screenshot)

    // Wait for CSS transition to complete (opacity 0.2s ease)
    await expect(async () => {
      const hidden_opacity = await label.evaluate((el) =>
        Number(globalThis.getComputedStyle(el).opacity),
      )
      expect(hidden_opacity).toBeLessThan(initial_opacity)
      // CSS sets .element-legend label.hidden { opacity: 0.4 }
      expect(hidden_opacity).toBeGreaterThan(0.3)
      expect(hidden_opacity).toBeLessThan(0.5)
    }).toPass({ timeout: 2000 })

    // After toggle, the button should have 'element-hidden' class (indicates atoms are hidden)
    await expect(toggle_button).toHaveClass(/element-hidden/)
    const hidden_screenshot = await canvas.screenshot()

    // Show
    await toggle_button.click()
    await expect(label).not.toHaveClass(/hidden/)
    // Poll for canvas change after showing element
    await expect_canvas_changed(canvas, hidden_screenshot)
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

  test(`multiple elements work independently`, async ({ page }) => {
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
    await expect_canvas_changed(canvas, initial_screenshot)
    const after_first = await canvas.screenshot()

    // Hide second element
    await second_item.hover()
    await second_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).toHaveClass(/hidden/)
    await expect(second_label).toHaveClass(/hidden/)
    await expect_canvas_changed(canvas, after_first)

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
      Number(globalThis.getComputedStyle(el).opacity),
    )
    expect(initial_opacity).toBe(0)

    // Button visible on hover - wait for opacity to change
    await first_item.hover()
    await expect(async () => {
      const hover_opacity = await toggle_button.evaluate((el) =>
        Number(globalThis.getComputedStyle(el).opacity),
      )
      expect(hover_opacity).toBeGreaterThan(0)
    }).toPass({ timeout: get_canvas_timeout() })

    // Hide element
    await toggle_button.click()
    await expect(label).toHaveClass(/hidden/)

    // Button stays visible when element hidden (via element-hidden class which sets opacity: 1)
    await page.mouse.move(0, 0)
    await expect(toggle_button).toHaveClass(/element-hidden/)
    await expect(async () => {
      const hidden_opacity = await toggle_button.evaluate((el) =>
        Number(globalThis.getComputedStyle(el).opacity),
      )
      expect(hidden_opacity).toBeGreaterThan(0.9)
    }).toPass({ timeout: 2000 })

    // Hidden state persists through control pane interactions
    const controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await controls_checkbox.check()
    await controls_checkbox.uncheck()
    await expect(label).toHaveClass(/hidden/)
  })
})

test.describe(`Edit Atoms Mode`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Edit-atoms tests require WebGL for 3D canvas interactions
    test.skip(IS_CI, `Edit atoms tests require WebGL, skip in CI`)
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  async function select_atom_for_delete(page: Page): Promise<void> {
    await page.locator(`[data-testid="btn-select-site-0"]`).click()
    await page.locator(`#test-structure`).focus()
    await page.keyboard.press(`Delete`)
  }

  test(`empty edit-atoms undo redo shortcuts are not canceled`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    const primary_modifier = is_mac ? `metaKey` : `ctrlKey`
    for (const init of [
      { key: `z`, [primary_modifier]: true },
      { key: `y`, [primary_modifier]: true },
      { key: `z`, [primary_modifier]: true, shiftKey: true },
    ]) {
      await expect(dispatch_cancelable_keydown(structure_div, init)).resolves.toBe(true)
    }
  })

  test(`undo/redo buttons hidden in distance/angle modes`, async ({ page }) => {
    // Check default distance mode - no undo/redo buttons
    const structure_div = page.locator(`#test-structure`)
    const undo_btn = structure_div.locator(`button[aria-label*="Undo"]`)
    await expect(undo_btn).toHaveCount(0)

    // Switch to edit-atoms to verify they appear
    await enter_edit_atoms_mode(page)
    await expect(undo_btn).toBeVisible()

    // Switch back to distance mode via the dropdown
    const measure_button = structure_div.getByRole(`button`, { name: `Measure / Edit` })
    await measure_button.click()
    const distance_option = structure_div.locator(`.view-mode-option`).filter({
      hasText: `Distance`,
    })
    await expect(distance_option).toBeVisible()
    await distance_option.click()
    await expect(undo_btn).toHaveCount(0)
  })

  test(`undo restores state and enables redo`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    const undo_btn = structure_div.locator(`button[aria-label*="Undo"]`)
    const redo_btn = structure_div.locator(`button[aria-label*="Redo"]`)
    await expect(undo_btn).toBeDisabled()
    await expect(redo_btn).toBeDisabled()

    await select_atom_for_delete(page)

    // Wait for undo to become available, then click it
    await expect(undo_btn).toBeEnabled({ timeout: 2000 })
    await undo_btn.click({ force: true })

    // Redo should now be enabled
    await expect(redo_btn).toBeEnabled({ timeout: 2000 })
  })

  test(`keyboard shortcuts Ctrl+Z/Y work for undo/redo`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    await select_atom_for_delete(page)

    const undo_btn = structure_div.locator(`button[aria-label*="Undo"]`)
    await expect(undo_btn).toBeEnabled({ timeout: 2000 })

    const undo_combo = is_mac ? `Meta+z` : `Control+z`
    const redo_combo = is_mac ? `Meta+y` : `Control+y`

    // Undo
    await page.keyboard.press(undo_combo)
    const redo_btn = structure_div.locator(`button[aria-label*="Redo"]`)
    await expect(redo_btn).toBeEnabled({ timeout: 2000 })

    // Redo
    await page.keyboard.press(redo_combo)

    // Undo should be enabled (redo just put item back on undo stack)
    await expect(undo_btn).toBeEnabled({ timeout: 2000 })
  })

  test(`add atom via A key shows element input`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    // Focus wrapper for keyboard events
    await structure_div.focus()

    // Press A to enter add-atom mode
    await page.keyboard.press(`a`)

    // Should show element input
    const add_input = structure_div.locator(`.add-atom-input`)
    await expect(add_input).toBeVisible({ timeout: 2000 })

    // Press Escape to cancel
    await page.keyboard.press(`Escape`)
    await expect(add_input).not.toBeVisible({ timeout: 2000 })
  })

  test(`edit mode persists across interactions`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    const undo_btn = structure_div.locator(`button[aria-label*="Undo"]`)

    // Verify edit mode active
    await expect(undo_btn).toBeVisible({ timeout: 2000 })

    // Click on the canvas
    const canvas = structure_div.locator(`canvas`)
    await canvas.click({ position: { x: 50, y: 50 }, force: true })

    // Undo/redo buttons should still be visible
    await expect(undo_btn).toBeVisible({ timeout: 2000 })
  })

  test(`history count badges show correct counts`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)

    // Initially no count badges
    await expect(structure_div.locator(`.history-count`)).toHaveCount(0)

    // Delete an atom to create history
    await select_atom_for_delete(page)

    // Should show undo count badge with "1"
    const count_badge = structure_div.locator(`.history-count`).first()
    await expect(count_badge).toBeVisible({ timeout: 2000 })
    await expect(count_badge).toHaveText(`1`)
  })
})

const set_viewer_size = async (
  structure_div: Locator,
  width: number,
  height: number,
): Promise<void> => {
  await structure_div.evaluate(
    (element, size) => {
      element.style.setProperty(`--struct-width`, `${size.width}px`)
      element.style.setProperty(`--struct-height`, `${size.height}px`)
    },
    { width, height },
  )
}

test.describe(`Responsive edit controls`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`keeps the bond-edit toolbar inside a narrow viewer on a second row`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    await set_viewer_size(structure_div, 300, 500)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    const edit_toolbar = structure_div.locator(`.edit-mode-toolbar`)
    const [structure_box, controls_box, toolbar_box] = await Promise.all([
      structure_div.boundingBox(),
      structure_div.locator(`section.control-buttons`).boundingBox(),
      edit_toolbar.boundingBox(),
    ])
    if (!structure_box || !controls_box || !toolbar_box) {
      throw new Error(`responsive control boxes were not rendered`)
    }
    expect(toolbar_box.x).toBeGreaterThanOrEqual(structure_box.x - 1)
    expect(toolbar_box.x + toolbar_box.width).toBeLessThanOrEqual(
      structure_box.x + structure_box.width + 1,
    )
    expect(toolbar_box.y).toBeGreaterThanOrEqual(controls_box.y + controls_box.height)
    expect(toolbar_box.y + toolbar_box.height).toBeLessThanOrEqual(
      structure_box.y + structure_box.height + 1,
    )
  })
})

test.describe(`Multi-side view (2x2 grid)`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`collapses and restores multi-view across its responsive size threshold`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    const layout_button = structure_div.getByRole(`button`, {
      name: /^View layout:/,
    })
    await expect(layout_button).toBeVisible()
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    await expect(structure_div).toHaveClass(/multi-view/)

    await set_viewer_size(structure_div, 599, 399)
    await expect(layout_button).toHaveCount(0)
    await expect(structure_div).not.toHaveClass(/multi-view/)

    await set_viewer_size(structure_div, 800, 600)
    await expect(layout_button).toBeVisible()
    await expect(structure_div).toHaveClass(/multi-view/)
  })

  test(`toggle splits canvas into 4 viewports and back`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)

    // Single view: one viewport cell, no grid
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
    await expect(structure_div.locator(`.viewport-stage.multi`)).toHaveCount(0)
    const single_gizmo_box = await structure_div.locator(`.responsive-gizmo`).boundingBox()
    if (!single_gizmo_box) throw new Error(`single-view gizmo has no bounding box`)

    await select_structure_layout(structure_div, `3D 2×2 grid`)

    // The primary perspective pane stays unlabeled so the global filename can use
    // the top-left corner; the three fixed-direction panes retain their labels.
    await expect(structure_div).toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-stage.multi`)).toBeVisible()
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(4)
    await expect(structure_div.locator(`.viewport-stage.multi canvas`)).toHaveCount(4, {
      timeout: get_canvas_timeout(),
    })
    const grid_gizmo_box = await structure_div
      .locator(`.responsive-gizmo`)
      .first()
      .boundingBox()
    if (!grid_gizmo_box) throw new Error(`multi-view gizmo has no bounding box`)
    expect(grid_gizmo_box.width / single_gizmo_box.width).toBeCloseTo(0.6, 1)
    expect(grid_gizmo_box.height / single_gizmo_box.height).toBeCloseTo(0.6, 1)
    const labels = structure_div.locator(`.viewport-label`)
    await expect(labels).toHaveCount(3)
    await expect(labels.nth(0)).toHaveText(`Front`)

    // Each pane occupies roughly a quarter of the viewer (clearly smaller than full width)
    const wrapper_box = await structure_div.boundingBox()
    if (!wrapper_box) throw new Error(`structure wrapper has no bounding box`)
    for (let pane_idx = 0; pane_idx < 4; pane_idx++) {
      await expect
        .poll(async () => {
          const cell_box = await structure_div
            .locator(`.viewport-cell`)
            .nth(pane_idx)
            .boundingBox()
          return cell_box?.width ?? Number.POSITIVE_INFINITY
        })
        .toBeLessThan(wrapper_box.width * 0.75)
      const cell_box = await structure_div
        .locator(`.viewport-cell`)
        .nth(pane_idx)
        .boundingBox()
      if (!cell_box) throw new Error(`viewport cell ${pane_idx} has no bounding box`)
      expect(cell_box.width).toBeGreaterThan(50)
    }

    // Toggle back to single view
    await select_structure_layout(structure_div, `3D single view`)
    await expect(structure_div).not.toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-stage.multi`)).toHaveCount(0)
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
    await expect(structure_div.locator(`canvas`)).toHaveCount(1, {
      timeout: get_canvas_timeout(),
    })
  })

  test(`legend controls stay interactive above active grid panes`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    const cells = structure_div.locator(`.viewport-cell`)
    await cells.nth(3).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(3)).toHaveClass(/active/)

    const receives_pointer_at_center = (locator: Locator): Promise<boolean> =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const topmost = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        return topmost !== null && element.contains(topmost)
      })

    const cell_select = structure_div.locator(`.cell-select`)
    const cell_toggle = cell_select.locator(`.toggle-btn`)
    const element_badge = structure_div.locator(`.atom-legend .legend-item label`).first()
    await expect(cell_select).toHaveCSS(`opacity`, `1`)
    expect(await receives_pointer_at_center(cell_toggle)).toBe(true)
    expect(await receives_pointer_at_center(element_badge)).toBe(true)
    await cell_toggle.click()
    await expect(cell_select.locator(`.dropdown`)).toBeVisible()
  })

  test(`Cmd/Ctrl+G toggles between grid and single view`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.focus() // viewer must be focused to receive the shortcut
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)

    const grid_shortcut = `${is_mac ? `Meta` : `Control`}+g`
    await page.keyboard.press(grid_shortcut)
    await expect(structure_div).toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(4)

    await page.keyboard.press(grid_shortcut)
    await expect(structure_div).not.toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
  })

  // Regression: the hover tooltip must be able to overflow its own pane into
  // neighboring panes instead of being clipped/occluded by them. Only the active
  // pane is allowed to overflow (and is raised above siblings); inactive panes clip.
  test(`active pane allows tooltip overflow, inactive panes clip`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    const cells = structure_div.locator(`.viewport-cell`)
    await expect(cells).toHaveCount(4)

    const overflow_of = (idx: number) =>
      cells.nth(idx).evaluate((node) => getComputedStyle(node).overflow)

    // Activate pane 0 explicitly: selecting the dropdown option may leave the pointer
    // over another pane when the menu closes.
    await cells.nth(0).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(0)).toHaveClass(/active/)
    expect(await overflow_of(0)).toBe(`visible`)
    expect(await cells.nth(0).evaluate((node) => getComputedStyle(node).zIndex)).toBe(`1`)
    expect(await overflow_of(1)).toBe(`hidden`)

    // Activating another pane moves the overflow allowance to it
    await cells.nth(2).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(2)).toHaveClass(/active/)
    expect(await overflow_of(2)).toBe(`visible`)
    expect(await overflow_of(0)).toBe(`hidden`)
  })

  test(`repeated toggling settles on the right canvas count without leaking contexts`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas_timeout = get_canvas_timeout()

    for (let cycle = 0; cycle < 3; cycle++) {
      await select_structure_layout(structure_div, `3D 2×2 grid`)
      await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(4)
      await expect(structure_div.locator(`.viewport-stage.multi canvas`)).toHaveCount(4, {
        timeout: canvas_timeout,
      })
      await select_structure_layout(structure_div, `3D single view`)
      await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
      await expect(structure_div.locator(`canvas`)).toHaveCount(1, {
        timeout: canvas_timeout,
      })
    }
  })
})
