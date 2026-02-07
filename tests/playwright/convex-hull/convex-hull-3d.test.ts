import { expect, test } from '@playwright/test'
import { IS_CI } from '../helpers'
import { dom_click, get_canvas_hash, open_controls_pane } from './utils'

test.describe(`ConvexHull3D (Ternary)`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ConvexHull3D tests timeout in CI`)
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    // Wait for data to load - the ternary-grid only renders after loaded_data.size > 0
    await expect(page.locator(`.ternary-grid`).first()).toBeVisible({ timeout: 15_000 })
  })

  test(`control buttons have hover visibility and initial data attributes`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    // Verify initial state data attributes
    await expect(diagram).toHaveAttribute(`data-has-hover`, `false`)
    await expect(diagram).toHaveAttribute(`data-is-dragging`, `false`)
    expect(await diagram.locator(`.plot-tooltip`).count()).toBe(0)

    const control_buttons = diagram.locator(`section.control-buttons`)
    await expect(control_buttons).toBeAttached()
    await expect(control_buttons).toHaveClass(/hover-visible/)

    // Before hover, opacity should be 0
    expect(Number(await control_buttons.evaluate((el) => getComputedStyle(el).opacity)))
      .toBe(0)

    // After hover on the diagram, buttons should become visible
    await diagram.hover()
    await expect
      .poll(async () =>
        Number(await control_buttons.evaluate((el) => getComputedStyle(el).opacity))
      )
      .toBe(1)
  })

  test(`enable_click_selection=false prevents entry selection`, async ({ page }) => {
    // Performance test page generates synthetic data client-side (no network requests)
    // so shorter timeouts are appropriate for 100 entries
    test.setTimeout(30000)

    await page.goto(
      `/test/convex-hull-performance?dim=3d&count=100&click_selection=false`,
      { waitUntil: `networkidle`, timeout: 15000 },
    )
    const diagram = page.locator(`.convex-hull-3d`)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    const canvas = diagram.locator(`canvas`).first()
    const box = await canvas.boundingBox()
    if (box) {
      // Click multiple positions to ensure we hit an entry
      const positions = [0, 0.3, -0.3].map((off) => ({
        x: box.width * (0.5 + off),
        y: box.height * (0.5 + off),
      }))
      await positions.reduce(
        (chain, pos) => chain.then(() => canvas.click({ position: pos })),
        Promise.resolve(),
      )
      await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    }
  })

  test(`renders ternary diagram canvas and toggles hull faces`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Convex Hulls` })).toBeVisible()
    const ternary_grid = page.locator(`.ternary-grid`).first()
    await expect(ternary_grid).toBeVisible()

    const diagram = ternary_grid.locator(`.convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    // Open legend controls pane to toggle hull faces
    const legend_btn = diagram.locator(`.legend-controls-btn`)
    await dom_click(legend_btn)

    // Toggle hull faces via control pane switch if present
    const pane = page.locator(`.draggable-pane.convex-hull-controls-pane`).last()
    const hull_toggle = pane.getByText(`Hull Faces`, { exact: false })
    if (await hull_toggle.isVisible({ timeout: 2000 })) {
      await hull_toggle.click()
    }

    // Ensure canvas still renders after toggle
    await expect(canvas).toBeVisible()
  })

  test(`info pane stats show chemical system and counts`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()
    // Open info via DOM click to avoid overlay intercepts
    await dom_click(diagram.locator(`.info-btn`))
    const info = diagram.locator(`.draggable-pane.convex-hull-info-pane`)
    // Ensure content inside the pane is visible (not just attached)
    await expect(info.getByText(`Convex Hull Stats`, { exact: false }))
      .toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false })).toBeVisible()
    await expect(info.getByText(`Stability`)).toBeVisible()

    // Regression: verify unstable phases > 0 (catches possible e_above_hull placeholder bugs)
    const unstable_text = await info.getByTestId(`hull-visible-unstable`).textContent()
    const unstable_match = unstable_text?.match(/(\d+)/)
    const unstable_count = unstable_match ? parseInt(unstable_match[1], 10) : 0
    expect(unstable_count).toBeGreaterThan(0)
  })

  test(`camera elevation/azimuth controls accept numeric changes`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()
    await dom_click(diagram.locator(`.legend-controls-btn`))
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls).toBeVisible()
    const elev = controls.getByText(`Elev`).locator(`..`).locator(`input[type="number"]`)
      .first()
    const azim = controls.getByText(`Azim`).locator(`..`).locator(`input[type="number"]`)
      .first()
    await elev.fill(`45`)
    await azim.fill(`120`)
    await expect(diagram.locator(`canvas`).first()).toBeVisible()
  })

  test(`drag release does not trigger click callback`, async ({ page }) => {
    // Regression: dragging to rotate should not trigger on_point_click
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)

    const canvas = diagram.locator(`canvas`).first()
    const box = await canvas.boundingBox()
    expect(box, `Canvas bounding box not found - rendering may have failed`).toBeTruthy()
    if (!box) throw new Error(`Canvas bounding box not found`)

    // Find an entry by scanning - selection indicates we hit one
    let entry_pos: { x: number; y: number } | null = null
    outer: for (let x_frac = 0.3; x_frac <= 0.7; x_frac += 0.04) {
      for (let y_frac = 0.3; y_frac <= 0.7; y_frac += 0.04) {
        const [test_x, test_y] = [box.x + box.width * x_frac, box.y + box.height * y_frac]
        // deno-lint-ignore no-await-in-loop -- sequential scanning required
        await page.mouse.click(test_x, test_y)
        // deno-lint-ignore no-await-in-loop -- sequential scanning required
        await page.waitForTimeout(30)
        // deno-lint-ignore no-await-in-loop -- sequential scanning required
        if ((await diagram.getAttribute(`data-has-selection`)) === `true`) {
          entry_pos = { x: test_x, y: test_y }
          break outer
        }
      }
    }
    expect(entry_pos, `No selectable entry found - data may not be rendering`)
      .toBeTruthy()
    if (!entry_pos) throw new Error(`No selectable entry found`)

    // Clear selection by clicking corner
    await page.mouse.click(box.x + 5, box.y + 5)
    await page.waitForTimeout(50)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)

    // Drag operation should not trigger selection
    await page.mouse.move(entry_pos.x, entry_pos.y)
    await page.mouse.down()
    await page.mouse.move(entry_pos.x + 30, entry_pos.y + 30, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(50)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
  })

  test(`tooltip shows fractional compositions with unicode glyphs`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    // Move mouse to center of canvas to trigger hover on a compound
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

      // Check if tooltip appears with fractional compositions
      const tooltip = page.locator(`.plot-tooltip`)
      // Wait for tooltip to potentially appear (may not appear if not hovering over a point)
      if (await tooltip.isVisible({ timeout: 5000 })) {
        const tooltip_text = await tooltip.textContent()
        // Check that tooltip doesn't contain large decimal numbers like "666.67" or "333.33"
        // but may contain unicode fractions like ⅓, ½, ⅔, etc.
        if (tooltip_text && tooltip_text.includes(`Fractional:`)) {
          // If there are fractional compositions shown, verify they don't have long decimals
          expect(tooltip_text).not.toMatch(/\d{3,}\.\d+/)
          // Verify it might contain unicode fractions (optional, as composition varies)
          // Common fractions: ½ ⅓ ⅔ ¼ ¾ ⅕ ⅖ ⅗ ⅘
        }
      }
    }
  })

  test(`face color mode buttons are visible and clickable`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    // Open controls pane (use dom_click to bypass canvas pointer interception)
    await dom_click(diagram.locator(`.legend-controls-btn`))
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls).toBeVisible()

    // Verify face color mode buttons exist
    const mode_buttons = controls.locator(`.face-color-mode-buttons`)
    await expect(mode_buttons).toBeVisible()

    // Verify all 4 mode buttons are present
    await expect(mode_buttons.getByText(`Uniform`)).toBeVisible()
    await expect(mode_buttons.getByText(`Energy`)).toBeVisible()
    await expect(mode_buttons.getByText(`Element`)).toBeVisible()
    await expect(mode_buttons.getByText(`Index`)).toBeVisible()

    // Default should be uniform (Uniform button active)
    const uniform_btn = mode_buttons.getByText(`Uniform`)
    await expect(uniform_btn).toHaveClass(/active/)
  })

  test(`face color mode switch changes canvas rendering`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    const initial_hash = await get_canvas_hash(canvas)

    // Open controls and switch to facet_index mode (dom_click bypasses canvas interception)
    await dom_click(diagram.locator(`.legend-controls-btn`))
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
    await controls.locator(`.face-color-mode-buttons`).getByText(`Index`).click()

    // Verify canvas has changed
    await expect(async () => expect(await get_canvas_hash(canvas)).not.toBe(initial_hash))
      .toPass({ timeout: 5000 })
  })

  test(`uniform mode shows color picker, other modes hide it`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    await dom_click(diagram.locator(`.legend-controls-btn`))
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls).toBeVisible()

    // In default (uniform) mode, color picker should be visible
    const color_picker = controls.locator(`input[type="color"]`).first()
    await expect(color_picker).toBeVisible()

    // Switch to Index mode
    await controls.locator(`.face-color-mode-buttons`).getByText(`Index`).click()

    // Color picker should now be hidden
    await expect(color_picker).toBeHidden()

    // Switch back to Uniform mode
    await controls.locator(`.face-color-mode-buttons`).getByText(`Uniform`).click()

    // Color picker should be visible again
    await expect(color_picker).toBeVisible()
  })

  test(`gizmo wrapper has WebGL canvas, hover-visible behavior`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const gizmo = diagram.locator(`.gizmo-wrapper`)
    await expect(gizmo).toBeAttached()
    await expect(gizmo).toHaveClass(/hover-visible/)

    // Gizmo should contain a canvas (WebGL renderer) — 2 canvases total (hull + gizmo)
    await expect(gizmo.locator(`canvas`)).toBeAttached()
    await expect(diagram.locator(`canvas`)).toHaveCount(2)

    // Before hover, opacity should be 0
    expect(Number(await gizmo.evaluate((el) => getComputedStyle(el).opacity))).toBe(0)

    // After hovering the diagram, gizmo should become visible
    await diagram.hover()
    await expect
      .poll(async () =>
        Number(await gizmo.evaluate((el) => getComputedStyle(el).opacity))
      )
      .toBe(1)
  })

  test(`t shortcut sets top-down view`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) throw new Error(`Canvas bounding box not found`)

    // Wait for canvas to render content
    await page.waitForTimeout(1000)

    // Take initial screenshot
    const initial_screenshot = await canvas.screenshot()

    // Drag to rotate the canvas to a different view
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 50, {
      steps: 8,
    })
    await page.mouse.up()
    await page.waitForTimeout(300)

    // Confirm the view changed after drag (compare as base64 strings)
    const dragged_screenshot = await canvas.screenshot()
    expect(dragged_screenshot.toString(`base64`)).not.toBe(
      initial_screenshot.toString(`base64`),
    )

    // Press t for top-down view
    await canvas.focus()
    await canvas.press(`t`)
    await page.waitForTimeout(300)

    // Canvas should change again (back to top-down)
    const top_screenshot = await canvas.screenshot()
    expect(top_screenshot.toString(`base64`)).not.toBe(
      dragged_screenshot.toString(`base64`),
    )
  })

  test(`Escape key closes structure popup`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`).first()
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) throw new Error(`Canvas bounding box not found`)

    // Click around center to find a selectable entry and open its popup
    let popup_opened = false
    for (let x_frac = 0.3; x_frac <= 0.7 && !popup_opened; x_frac += 0.05) {
      for (let y_frac = 0.3; y_frac <= 0.7 && !popup_opened; y_frac += 0.05) {
        // deno-lint-ignore no-await-in-loop -- sequential scanning required
        await page.mouse.dblclick(
          box.x + box.width * x_frac,
          box.y + box.height * y_frac,
        )
        // deno-lint-ignore no-await-in-loop -- sequential scanning required
        await page.waitForTimeout(100)
        // deno-lint-ignore no-await-in-loop -- sequential scanning required
        popup_opened = await diagram.locator(`.structure-popup`).isVisible()
      }
    }

    if (!popup_opened) {
      test.skip(true, `Could not find selectable entry to open popup`)
      return
    }

    // Popup should be visible
    await expect(diagram.locator(`.structure-popup`)).toBeVisible()

    // Press Escape to close
    await canvas.press(`Escape`)
    await expect(diagram.locator(`.structure-popup`)).toBeHidden()
  })

  test(`controls pane has no unnecessary scroll overflow`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const pane = await open_controls_pane(page, diagram)
    await expect(pane).toBeVisible({ timeout: 10_000 })

    // scrollHeight should not exceed clientHeight (no hidden scrollable content)
    const { scroll_height, client_height } = await pane.evaluate((el) => ({
      scroll_height: el.scrollHeight,
      client_height: el.clientHeight,
    }))
    // Allow 2px tolerance for sub-pixel rounding
    expect(scroll_height).toBeLessThanOrEqual(client_height + 2)
  })

  test(`controls pane drag handle does not rotate hull`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const controls = await open_controls_pane(page, diagram)
    await expect(controls).toBeVisible({ timeout: 10_000 })

    // Verify pane has pointer-events: auto (prevents event leaking to canvas)
    const pointer_events = await controls.evaluate(
      (el) => getComputedStyle(el).pointerEvents,
    )
    expect(pointer_events).toBe(`auto`)

    const canvas = diagram.locator(`canvas`).first()
    const hash_before = await get_canvas_hash(canvas)

    // Find and drag the pane's drag handle
    const drag_handle = controls.locator(`.drag-handle`)
    const handle_box = await drag_handle.boundingBox()
    expect(handle_box).toBeTruthy()
    if (!handle_box) throw new Error(`Drag handle bounding box not found`)

    // Drag the handle (would rotate hull if events leaked through)
    await page.mouse.move(
      handle_box.x + handle_box.width / 2,
      handle_box.y + handle_box.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      handle_box.x + handle_box.width / 2 + 50,
      handle_box.y + handle_box.height / 2 + 30,
      { steps: 5 },
    )
    await page.mouse.up()
    await page.waitForTimeout(100)

    // Canvas should NOT have changed (hull didn't rotate)
    expect(await get_canvas_hash(canvas)).toBe(hash_before)
  })

  test(`color scale selector is present in controls pane`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const controls = await open_controls_pane(page, diagram)
    await expect(controls).toBeVisible({ timeout: 10_000 })

    // Color scale label and multiselect should both be present
    const color_label = controls.getByText(`Color scale`, { exact: true })
    await expect(color_label).toBeVisible()
    // The label should have cursor: pointer (clickable)
    const cursor = await color_label.evaluate((el) => getComputedStyle(el).cursor)
    expect(cursor).toBe(`pointer`)

    // Multiselect component should be rendered alongside the label
    const multiselect = controls.locator(`.multiselect`)
    await expect(multiselect).toBeVisible()
  })
})
