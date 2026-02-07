import { expect, test } from '@playwright/test'
import { IS_CI } from '../helpers'
import { dom_click, get_canvas_hash, open_controls_pane, open_info_pane } from './utils'

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
      for (const off of [0, 0.3, -0.3]) {
        // deno-lint-ignore no-await-in-loop
        await canvas.click({
          position: { x: box.width * (0.5 + off), y: box.height * (0.5 + off) },
        })
      }
      await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    }
  })

  test(`renders ternary diagram canvas and toggles hull faces`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Convex Hulls` })).toBeVisible()
    const ternary_grid = page.locator(`.ternary-grid`).first()
    await expect(ternary_grid).toBeVisible()

    const diagram = ternary_grid.locator(`.convex-hull-3d`).first()
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

    // Info pane is conditionally rendered (needs phase_stats data)
    const info = await open_info_pane(page, diagram)
    if (!(await info.isVisible({ timeout: 3000 }))) {
      test.skip(true, `Info pane not available — phase_stats not yet computed`)
      return
    }
    await expect(info.getByText(`Convex Hull Stats`, { exact: false }))
      .toBeVisible({ timeout: 5000 })
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
    const controls = await open_controls_pane(page, diagram)
    await expect(controls).toBeVisible({ timeout: 10_000 })
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
        // deno-lint-ignore no-await-in-loop
        await page.mouse.click(test_x, test_y)
        // deno-lint-ignore no-await-in-loop
        await page.waitForTimeout(30)
        // deno-lint-ignore no-await-in-loop
        if ((await diagram.getAttribute(`data-has-selection`)) === `true`) {
          entry_pos = { x: test_x, y: test_y }
          break outer
        }
      }
    }
    if (!entry_pos) {
      test.skip(true, `No selectable entry found — Svelte 5 click handler not reachable`)
      return
    }

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
    const box = await canvas.boundingBox()
    if (!box) return

    // Move mouse to center of canvas to trigger hover on a compound
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

    // Check if tooltip appears with fractional compositions
    const tooltip = page.locator(`.plot-tooltip`)
    if (await tooltip.isVisible({ timeout: 5000 })) {
      const tooltip_text = await tooltip.textContent()
      // Verify fractional compositions don't have long decimals like "666.67"
      if (tooltip_text?.includes(`Fractional:`)) {
        expect(tooltip_text).not.toMatch(/\d{3,}\.\d+/)
      }
    }
  })

  test(`face color mode buttons and color picker are present`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const controls = await open_controls_pane(page, diagram)
    await expect(controls).toBeVisible({ timeout: 10_000 })

    // All 4 mode buttons should be present with Uniform active by default
    const mode_buttons = controls.locator(`.face-color-mode-buttons`)
    await expect(mode_buttons).toBeVisible()
    for (const label of [`Uniform`, `Energy`, `Element`, `Index`]) {
      // deno-lint-ignore no-await-in-loop
      await expect(mode_buttons.getByText(label)).toBeVisible()
    }
    await expect(mode_buttons.getByText(`Uniform`)).toHaveClass(/active/)

    // In default (uniform) mode, color picker should be visible
    await expect(controls.locator(`input[type="color"]`).first()).toBeVisible()
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

  test(`t shortcut changes canvas view after drag`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) throw new Error(`Canvas bounding box not found`)

    await page.waitForTimeout(1000)
    const initial = (await canvas.screenshot()).toString(`base64`)

    // Drag to rotate
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 50, {
      steps: 8,
    })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const dragged = (await canvas.screenshot()).toString(`base64`)
    expect(dragged).not.toBe(initial)

    // Press t for top-down — should change view again
    await canvas.focus()
    await canvas.press(`t`)
    await page.waitForTimeout(300)
    expect((await canvas.screenshot()).toString(`base64`)).not.toBe(dragged)
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
        // deno-lint-ignore no-await-in-loop
        await page.mouse.dblclick(
          box.x + box.width * x_frac,
          box.y + box.height * y_frac,
        )
        // deno-lint-ignore no-await-in-loop
        await page.waitForTimeout(100)
        // deno-lint-ignore no-await-in-loop
        popup_opened = await diagram.locator(`.structure-popup`).isVisible()
      }
    }

    if (!popup_opened) {
      test.skip(true, `Could not find selectable entry to open popup`)
      return
    }

    await expect(diagram.locator(`.structure-popup`)).toBeVisible()
    await canvas.press(`Escape`)
    await expect(diagram.locator(`.structure-popup`)).toBeHidden()
  })

  test(`controls pane: no scroll overflow, pointer-events, drag isolation`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const pane = await open_controls_pane(page, diagram)
    await expect(pane).toBeVisible({ timeout: 10_000 })

    // scrollHeight should not exceed clientHeight (no hidden scrollable content)
    const { scroll_height, client_height } = await pane.evaluate((el) => ({
      scroll_height: el.scrollHeight,
      client_height: el.clientHeight,
    }))
    expect(scroll_height).toBeLessThanOrEqual(client_height + 2)

    // Pane has pointer-events: auto (prevents event leaking to canvas)
    expect(await pane.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(`auto`)

    // Dragging the handle should NOT rotate the hull behind it
    const canvas = diagram.locator(`canvas`).first()
    const hash_before = await get_canvas_hash(canvas)

    const drag_handle = pane.locator(`.drag-handle`)
    const handle_box = await drag_handle.boundingBox()
    expect(handle_box).toBeTruthy()
    if (!handle_box) throw new Error(`Drag handle bounding box not found`)

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
    expect(await get_canvas_hash(canvas)).toBe(hash_before)
  })

  test(`color scale selector is present in controls pane`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const controls = await open_controls_pane(page, diagram)
    await expect(controls).toBeVisible({ timeout: 10_000 })

    // Color scale label should be clickable, multiselect should be rendered
    const color_label = controls.getByText(`Color scale`, { exact: true })
    await expect(color_label).toBeVisible()
    expect(await color_label.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      `pointer`,
    )
    await expect(controls.locator(`.multiselect`)).toBeVisible()
  })
})
