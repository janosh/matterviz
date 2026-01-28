import { expect, test } from '@playwright/test'
import { IS_CI } from '../helpers'
import { dom_click } from './utils'

test.describe(`ConvexHull3D (Ternary)`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ConvexHull3D tests timeout in CI`)
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    // Wait for data to load - the ternary-grid only renders after loaded_data.size > 0
    await expect(page.locator(`.ternary-grid`).first()).toBeVisible({ timeout: 15_000 })
  })

  test(`control buttons have hover visibility by default`, async ({ page }) => {
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const control_buttons = diagram.locator(`.control-buttons`)
    await expect(control_buttons).toBeAttached()

    // Control buttons should have hover-visible class (default mode)
    await expect(control_buttons).toHaveClass(/hover-visible/)

    // Before hover, opacity should be 0
    const opacity_before = await control_buttons.evaluate(
      (el) => getComputedStyle(el).opacity,
    )
    expect(Number(opacity_before)).toBe(0)

    // After hover on the diagram, buttons should become visible
    await diagram.hover()
    await expect
      .poll(async () => {
        const op = await control_buttons.evaluate((el) => getComputedStyle(el).opacity)
        return Number(op)
      })
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
    const canvas = diagram.locator(`canvas`)
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

    const canvas = diagram.locator(`canvas`)
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
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls).toBeVisible()
    const elev = controls.getByText(`Elev`).locator(`..`).locator(`input[type="number"]`)
      .first()
    const azim = controls.getByText(`Azim`).locator(`..`).locator(`input[type="number"]`)
      .first()
    await elev.fill(`45`)
    await azim.fill(`120`)
    await expect(diagram.locator(`canvas`)).toBeVisible()
  })

  test(`drag release does not trigger click callback`, async ({ page }) => {
    // Regression: dragging to rotate should not trigger on_point_click
    const diagram = page.locator(`.ternary-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)

    const canvas = diagram.locator(`canvas`)
    const box = await canvas.boundingBox()
    if (!box) return

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
    if (!entry_pos) return // No selectable entry found

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

    const canvas = diagram.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Move mouse to center of canvas to trigger hover on a compound
    const box = await canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)

      // Check if tooltip appears with fractional compositions
      const tooltip = page.locator(`.tooltip`)
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
})
