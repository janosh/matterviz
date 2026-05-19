import { expect, test } from '@playwright/test'
import { expect_canvas_changed, IS_CI, wait_for_3d_canvas } from '../helpers'

// Get non-white pixel count to detect if content is rendered.
function count_non_white_pixels(buffer: Uint8Array): number {
  let non_white = 0
  for (let idx = 0; idx < buffer.length; idx += 4) {
    const red = buffer[idx]
    const green = buffer[idx + 1]
    const blue = buffer[idx + 2]
    if (red < 250 || green < 250 || blue < 250) non_white++
  }
  return non_white
}

test.describe(`Bond component`, () => {
  test.beforeEach(() => {
    test.skip(IS_CI, `Bonds tests timeout in CI`)
  })

  test(`renders bonds and handles rotation/zoom without errors`, async ({ page }) => {
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    // wait_for_3d_canvas ensures canvas is visible with non-zero dimensions
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    const initial = await canvas.screenshot()
    expect(initial.length).toBeGreaterThan(1000)

    // Assert 3: Scene has rendered content (not blank)
    const initial_pixels = count_non_white_pixels(initial)
    expect(initial_pixels).toBeGreaterThan(100)

    // Assert 4-5: Rotation works and changes view
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (box) {
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
        force: true,
      })
      // Poll for canvas change (handles GPU timing variations)
      await expect_canvas_changed(canvas, initial)
      const rotated = await canvas.screenshot()
      const rotated_pixels = count_non_white_pixels(rotated)
      expect(rotated_pixels).toBeGreaterThan(100)

      // Assert 6-7: Zoom works and changes view
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -200)
      await expect_canvas_changed(canvas, rotated)
      const zoomed = await canvas.screenshot()
      expect(count_non_white_pixels(zoomed)).toBeGreaterThan(100)
    }
    // Assert 8: No console errors
    expect(console_errors).toHaveLength(0)
  })

  test(`bonds visible from multiple angles with proper gradients`, async ({ page }) => {
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) return

    // Assert 1: Initial view has content
    const initial = await canvas.screenshot()
    expect(count_non_white_pixels(initial)).toBeGreaterThan(100)

    // Assert 2-3: Horizontal rotation changes view
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      force: true,
    })
    await expect_canvas_changed(canvas, initial)
    const horizontal = await canvas.screenshot()
    expect(count_non_white_pixels(horizontal)).toBeGreaterThan(100)

    // Assert 4-5: Vertical rotation also changes view
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2, y: box.height / 2 - 50 },
      targetPosition: { x: box.width / 2, y: box.height / 2 + 50 },
      force: true,
    })
    await expect_canvas_changed(canvas, horizontal)
    const vertical = await canvas.screenshot()
    expect(count_non_white_pixels(vertical)).toBeGreaterThan(100)

    // Assert 6: All three views are distinct
    await expect_canvas_changed(canvas, initial)
    // Assert 7: No console errors
    expect(console_errors).toHaveLength(0)
  })

  test(`edit-bonds context menu sets explicit bond order`, async ({ page }) => {
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.evaluate(() => {
      const structure = {
        sites: [
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [-0.7, 0, 0],
            label: `C1`,
            properties: {},
          },
          {
            species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [0.7, 0, 0],
            label: `O1`,
            properties: {},
          },
        ],
        properties: {
          bonds: [{ site_idx_1: 0, site_idx_2: 1, order: 1 }],
        },
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
    })

    const canvas = await wait_for_3d_canvas(page, `#test-structure`)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    if (!box) return

    await canvas.click({
      button: `right`,
      position: { x: box.width / 2, y: box.height / 2 },
    })
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(`Bond Order`)
    await menu.getByRole(`button`, { name: `Double` }).click()

    await expect(menu).toBeHidden()
    await canvas.click({
      button: `right`,
      position: { x: box.width / 2, y: box.height / 2 },
    })
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(`Bond Order (2)`)
    await expect.poll(() =>
      page.evaluate(() => (globalThis as Record<string, unknown>).structure_bonds)
    ).toEqual([{ site_idx_1: 0, site_idx_2: 1, order: 2 }])
    expect(console_errors).toHaveLength(0)
  })

  // CO2 (O=C=O) molecule with NO explicit bonds: the electroneg_ratio
  // bonding strategy auto-detects two C-O connectivity bonds. With
  // auto_bond_order OFF they render single (1 cylinder each); ON, perception
  // relabels both as double (2 cylinders each) -> more rendered geometry.
  // Shifted so the C-O1 bond midpoint is at the world origin (canvas center),
  // matching the existing edit-bonds test's center-click convention.
  const dispatch_co2 = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const structure = {
        sites: [
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-0.58, 0, 0],
            xyz: [-0.58, 0, 0],
            label: `C1`,
            properties: {},
          },
          {
            species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
            abc: [0.58, 0, 0],
            xyz: [0.58, 0, 0],
            label: `O1`,
            properties: {},
          },
          {
            species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
            abc: [-1.74, 0, 0],
            xyz: [-1.74, 0, 0],
            label: `O2`,
            properties: {},
          },
        ],
        properties: {},
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: { camera_position: [0, 0, 8], show_bonds: `always` },
        }),
      )
    })

  test(`auto bond-order toggle changes rendered bond geometry`, async ({ page }) => {
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await dispatch_co2(page)
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // auto_bond_order OFF (default): C-O bonds render as single cylinders.
    const single = await canvas.screenshot()
    const single_pixels = count_non_white_pixels(single)
    expect(single_pixels).toBeGreaterThan(100)

    // Enable perception via the same scene-props mechanism the test page uses.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, { detail: { auto_bond_order: true } }),
      )
    })

    // Perception turns both C=O into double bonds: each single cylinder
    // becomes two offset cylinders. The bond geometry is regenerated, so the
    // rendered scene must visibly change (same canvas-diff heuristic the
    // existing "gradients" test uses), while still rendering bond content.
    await expect_canvas_changed(canvas, single)
    const doubled = await canvas.screenshot()
    expect(count_non_white_pixels(doubled)).toBeGreaterThan(100)

    expect(console_errors).toHaveLength(0)
  })

  test(`aromatic display toggle switches benzene representation`, async ({ page }) => {
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    // Planar benzene ring (6 C in a hexagon, 1.39 Å radius), no explicit
    // bonds -> connectivity ring detected, perception flags it aromatic.
    await page.evaluate(() => {
      const ring = Array.from({ length: 6 }, (_, k) => {
        const angle = (k * Math.PI) / 3
        return {
          species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
          abc: [0, 0, 0],
          xyz: [Math.cos(angle) * 1.39, Math.sin(angle) * 1.39, 0],
          label: `C${k + 1}`,
          properties: {},
        }
      })
      const structure = { sites: ring, properties: {} }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            camera_position: [0, 0, 8],
            show_bonds: `always`,
            auto_bond_order: true,
            aromatic_display: `aromatic`,
          },
        }),
      )
    })
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // aromatic mode: all 6 ring bonds rendered with the 1.5 representation
    // (asymmetric-radius double cylinders).
    const aromatic = await canvas.screenshot()
    expect(count_non_white_pixels(aromatic)).toBeGreaterThan(100)

    // Switch to Kekulé: ring bonds become alternating single (1 cylinder)
    // and double (2 equal cylinders) -> the rendered bond pattern differs.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, { detail: { aromatic_display: `kekule` } }),
      )
    })
    await expect_canvas_changed(canvas, aromatic)
    const kekule = await canvas.screenshot()
    expect(count_non_white_pixels(kekule)).toBeGreaterThan(100)

    expect(console_errors).toHaveLength(0)
  })

  test(`manual override wins over perceived bond order`, async ({ page }) => {
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await dispatch_co2(page)
    // Enable perception: both C=O connectivity bonds are perceived as double.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, { detail: { auto_bond_order: true } }),
      )
    })
    const canvas = await wait_for_3d_canvas(page, `#test-structure`)

    // Drive the SAME edit-bonds context menu the existing explicit-order test
    // uses, targeting the C-O1 bond midpoint (world origin -> canvas center).
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    // The default test-page canvas (800x500) extends below the 720px viewport,
    // so its center is off-screen. Scroll it into view and right-click at
    // absolute coords via page.mouse (the same mouse-driven approach the
    // "site labels" test in this file uses) - this avoids Locator.click's
    // stale-box re-scroll, which otherwise loops on pointer interception.
    const right_click_bond_center = async () => {
      await canvas.scrollIntoViewIfNeeded()
      const box = await canvas.boundingBox()
      expect(box).toBeTruthy()
      if (!box) throw new Error(`canvas has no bounding box`)
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.click(cx, cy, { button: `right` })
    }

    await right_click_bond_center()
    const menu = page.locator(`#test-structure .bond-context-menu`)
    await expect(menu).toBeVisible()
    // Pre-override: the menu reports the PERCEIVED order. Perception relabels
    // this C-O connectivity bond as a double (2) - non-vacuous proof that
    // perception is actually driving the order before any manual override.
    await expect(menu).toContainText(`Bond Order (2)`)
    // Manually override to Triple - must win over the perceived double.
    await menu.getByRole(`button`, { name: `Triple` }).click()
    await expect(menu).toBeHidden()

    // Re-open the menu on the same bond: it must now report order 3, proving
    // the manual bond_order_overrides path takes precedence over perception.
    await right_click_bond_center()
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(`Bond Order (3)`)
    // The override is recorded in the bound bonds list (globalThis hook),
    // not the perceived order - concrete proof of precedence.
    await expect.poll(() =>
      page.evaluate(() =>
        (globalThis as Record<string, unknown>).structure_bonds as unknown
      )
    ).toContainEqual(expect.objectContaining({ order: 3 }))
    expect(console_errors).toHaveLength(0)
  })

  test(`site labels avoid adjacent bond directions`, async ({ page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    await page.evaluate(() => {
      const structure = {
        sites: [
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-2.4, 0, 0],
            xyz: [-2.4, 0, 0],
            label: `C1`,
            properties: {},
          },
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-1.2, 0, 0],
            xyz: [-1.2, 0, 0],
            label: `C2`,
            properties: {},
          },
          {
            species: [{ element: `O`, occu: 1, oxidation_state: 0 }],
            abc: [0, 0, 0],
            xyz: [0, 0, 0],
            label: `O1`,
            properties: {},
          },
          {
            species: [{ element: `N`, occu: 1, oxidation_state: 0 }],
            abc: [1.2, 0, 0],
            xyz: [1.2, 0, 0],
            label: `N1`,
            properties: {},
          },
          {
            species: [{ element: `C`, occu: 1, oxidation_state: 0 }],
            abc: [-1.2, 1.25, 0],
            xyz: [-1.2, 1.25, 0],
            label: `C3`,
            properties: {},
          },
        ],
        properties: {
          bonds: [
            { site_idx_1: 0, site_idx_2: 1, order: 1 },
            { site_idx_1: 1, site_idx_2: 2, order: 2 },
            { site_idx_1: 2, site_idx_2: 3, order: 3 },
            { site_idx_1: 1, site_idx_2: 4, order: `aromatic` },
          ],
        },
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            camera_position: [0, 0, 12],
            show_site_labels: true,
            show_site_indices: true,
            bonding_options: { strength_threshold: 10 },
          },
        }),
      )
    })

    await wait_for_3d_canvas(page, `#test-structure`)
    const label = (text: string) =>
      page.locator(`#test-structure .atom-label`).filter({ hasText: text })
    const label_center = async (text: string) => {
      const box = await label(text).boundingBox()
      expect(box).toBeTruthy()
      if (!box) throw new Error(`Missing ${text} label`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    await expect(label(`C-1`)).toBeVisible()
    await expect(label(`C-2`)).toBeVisible()

    const before_c1 = await label_center(`C-1`)
    const before_c2 = await label_center(`C-2`)
    const before_o3 = await label_center(`O-3`)
    const before_midline_y = (before_c1.y + before_o3.y) / 2
    const before_vertical_gap = before_c2.y - before_midline_y
    const before_horizontal_span = before_o3.x - before_c1.x

    expect(before_vertical_gap).toBeGreaterThan(10)

    const canvas = page.locator(`#test-structure canvas`)
    const canvas_box = await canvas.boundingBox()
    expect(canvas_box).toBeTruthy()
    if (!canvas_box) return

    await canvas.hover({
      position: { x: canvas_box.width / 2, y: canvas_box.height / 2 },
    })
    for (let wheel_idx = 0; wheel_idx < 8; wheel_idx++) {
      await page.mouse.wheel(0, -700)
    }
    await page.waitForTimeout(500)

    const after_c1 = await label_center(`C-1`)
    const after_c2 = await label_center(`C-2`)
    const after_o3 = await label_center(`O-3`)
    const after_midline_y = (after_c1.y + after_o3.y) / 2
    const after_vertical_gap = after_c2.y - after_midline_y
    const after_horizontal_span = after_o3.x - after_c1.x
    const horizontal_scale = after_horizontal_span / before_horizontal_span
    const vertical_gap_scale = after_vertical_gap / before_vertical_gap

    expect(after_horizontal_span).toBeGreaterThan(before_horizontal_span * 2)
    expect(vertical_gap_scale).toBeLessThan(horizontal_scale)
  })
})
