// deno-lint-ignore-file no-window
import { expect, test } from '@playwright/test'
import {
  expect_canvas_changed,
  get_canvas_timeout,
  wait_for_3d_canvas,
  wait_for_canvas_rendered,
} from '../helpers'

const TEST_URL = `/test/scatter-plot-3d`
const CONTAINER_SELECTOR = `#test-scatter-3d`

test.describe(`ScatterPlot3D`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
  })

  test(`renders 3D canvas with content`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    await expect(canvas).toBeVisible()
  })

  test(`gizmo is visible with correct size`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const gizmo = page.locator(`${CONTAINER_SELECTOR} .scatter3d-gizmo`)
    await expect(gizmo).toBeVisible({ timeout: get_canvas_timeout() })

    const box = await gizmo.boundingBox()
    if (!box) throw new Error(`Gizmo bounding box not found`)
    expect(box.width).toBeGreaterThan(50)
    expect(box.height).toBeGreaterThan(50)
  })

  test(`gizmo click triggers camera rotation`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)

    const gizmo = page.locator(`${CONTAINER_SELECTOR} .scatter3d-gizmo`)
    const box = await gizmo.boundingBox()
    if (!box) throw new Error(`Gizmo bounding box not found`)

    const initial = await canvas.screenshot()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(500)
    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })

  // Verify CSS properties that enable gizmo clickability
  for (
    const { selector, prop, expected, compare } of [
      { selector: `.scatter3d-gizmo`, prop: `zIndex`, expected: 1000, compare: `gte` },
      {
        selector: `.scatter3d-gizmo`,
        prop: `pointerEvents`,
        expected: `auto`,
        compare: `eq`,
      },
      { selector: `.axis-label`, prop: `pointerEvents`, expected: `none`, compare: `eq` },
      { selector: `.tick-label`, prop: `pointerEvents`, expected: `none`, compare: `eq` },
    ] as const
  ) {
    test(`${selector} has ${prop} ${compare} ${expected}`, async ({ page }) => {
      await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      const el = page.locator(`${CONTAINER_SELECTOR} ${selector}`).first()
      await expect(el).toBeVisible({ timeout: get_canvas_timeout() })

      const value = await el.evaluate(
        (node, p) => window.getComputedStyle(node)[p as keyof CSSStyleDeclaration],
        prop,
      )
      if (compare === `gte`) {
        expect(parseInt(value as string, 10)).toBeGreaterThanOrEqual(expected as number)
      } else {
        expect(value).toBe(expected)
      }
    })
  }

  test(`drag to rotate changes view`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const initial = await canvas.screenshot()

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 100, cy + 50, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })

  test(`scroll wheel zoom changes view`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const initial = await canvas.screenshot()

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -200)
    await page.waitForTimeout(300)

    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })

  test(`controls pane toggle visible on hover`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const container = page.locator(CONTAINER_SELECTOR)
    await container.hover()
    await expect(container.locator(`button.pane-toggle`)).toBeVisible({ timeout: 5000 })
  })

  test(`controls pane opens on toggle click`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const container = page.locator(CONTAINER_SELECTOR)
    await container.hover()

    const toggle = container.locator(`button.pane-toggle`)
    await expect(toggle).toBeVisible({ timeout: 5000 })
    await toggle.click()

    await expect(container.locator(`.draggable-pane`)).toBeVisible({ timeout: 5000 })
  })
})

// Helper to open controls pane
async function open_controls_pane(page: import('@playwright/test').Page) {
  const container = page.locator(CONTAINER_SELECTOR)
  await container.hover()
  const toggle = container.locator(`button.pane-toggle`)
  await expect(toggle).toBeVisible({ timeout: 5000 })
  await toggle.click()
  const pane = container.locator(`.draggable-pane`)
  await expect(pane).toBeVisible({ timeout: 5000 })
  return pane
}

test.describe(`ScatterPlot3D Projections`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
  })

  test(`projections section exists in controls pane`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    // Find Projections section by title
    const projections_section = pane.locator(`text=Projections`).first()
    await expect(projections_section).toBeVisible()
  })

  test(`projection checkboxes are unchecked by default`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    // Find projection checkboxes by their labels
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      // deno-lint-ignore no-await-in-loop -- sequential verification required
      await expect(checkbox).not.toBeChecked()
    }
  })

  // Test each projection plane toggle
  for (const plane of [`XY`, `XZ`, `YZ`] as const) {
    test(`toggling ${plane} projection changes canvas`, async ({ page }) => {
      const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      await wait_for_canvas_rendered(canvas)
      const pane = await open_controls_pane(page)

      const initial = await canvas.screenshot()

      // Find and click the projection checkbox
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      await checkbox.click()
      await expect(checkbox).toBeChecked()
      await page.waitForTimeout(200)

      await expect_canvas_changed(canvas, initial, get_canvas_timeout())
    })
  }

  test(`multiple projections can be enabled simultaneously`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    // Enable all three projections
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      // deno-lint-ignore no-await-in-loop -- sequential clicks required
      await checkbox.click()
      // deno-lint-ignore no-await-in-loop -- sequential verification required
      await expect(checkbox).toBeChecked()
    }

    // Verify all are checked
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      // deno-lint-ignore no-await-in-loop -- sequential verification required
      await expect(checkbox).toBeChecked()
    }
  })

  test(`opacity slider has correct default value and range`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    const opacity_slider = pane.locator(`input[type="range"]`).first()
    await expect(opacity_slider).toHaveValue(`0.3`)
    await expect(opacity_slider).toHaveAttribute(`min`, `0`)
    await expect(opacity_slider).toHaveAttribute(`max`, `1`)
    await expect(opacity_slider).toHaveAttribute(`step`, `0.05`)

    const opacity_number = pane.locator(`input[type="number"]`).first()
    await expect(opacity_number).toHaveValue(`0.3`)
  })

  test(`size slider has correct default value and range`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    // Size slider is the second range input in Projections section
    const size_slider = pane.locator(`input[type="range"]`).nth(1)
    await expect(size_slider).toHaveValue(`0.5`)
    await expect(size_slider).toHaveAttribute(`min`, `0.1`)
    await expect(size_slider).toHaveAttribute(`max`, `1`)
    await expect(size_slider).toHaveAttribute(`step`, `0.05`)

    const size_number = pane.locator(`input[type="number"]`).nth(1)
    await expect(size_number).toHaveValue(`0.5`)
  })

  test(`opacity slider changes projection appearance`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    // Enable XY projection first
    const xy_checkbox = pane.locator(`label`).filter({ hasText: `XY` }).locator(
      `input[type="checkbox"]`,
    )
    await xy_checkbox.click()
    await page.waitForTimeout(200)

    const before_opacity_change = await canvas.screenshot()

    // Change opacity to max
    const opacity_slider = pane.locator(`input[type="range"]`).first()
    await opacity_slider.fill(`1`)
    await page.waitForTimeout(200)

    await expect_canvas_changed(canvas, before_opacity_change, get_canvas_timeout())
  })

  test(`size slider changes projection appearance`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    // Enable XY projection first
    const xy_checkbox = pane.locator(`label`).filter({ hasText: `XY` }).locator(
      `input[type="checkbox"]`,
    )
    await xy_checkbox.click()
    await page.waitForTimeout(200)

    const before_size_change = await canvas.screenshot()

    // Change size to max
    const size_slider = pane.locator(`input[type="range"]`).nth(1)
    await size_slider.fill(`1`)
    await page.waitForTimeout(200)

    await expect_canvas_changed(canvas, before_size_change, get_canvas_timeout())
  })

  test(`opacity number input syncs with slider`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    const opacity_number = pane.locator(`input[type="number"]`).first()
    await opacity_number.fill(`0.7`)
    await opacity_number.press(`Enter`)

    const opacity_slider = pane.locator(`input[type="range"]`).first()
    await expect(opacity_slider).toHaveValue(`0.7`)
  })

  test(`size number input syncs with slider`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    const size_number = pane.locator(`input[type="number"]`).nth(1)
    await size_number.fill(`0.8`)
    await size_number.press(`Enter`)

    const size_slider = pane.locator(`input[type="range"]`).nth(1)
    await expect(size_slider).toHaveValue(`0.8`)
  })

  test(`reset button resets projections to defaults`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    // Enable all projections and change sliders
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      // deno-lint-ignore no-await-in-loop -- sequential clicks required
      await checkbox.click()
    }
    const opacity_slider = pane.locator(`input[type="range"]`).first()
    await opacity_slider.fill(`0.8`)
    const size_slider = pane.locator(`input[type="range"]`).nth(1)
    await size_slider.fill(`0.9`)

    // Find and click reset button in Projections section
    // Reset buttons are in SettingsSection headers
    const projections_header = pane.locator(`text=Projections`).first()
    const reset_btn = projections_header.locator(`..`).locator(`button[title="Reset"]`)
    await reset_btn.click()

    // Verify all checkboxes are unchecked
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      // deno-lint-ignore no-await-in-loop -- sequential verification required
      await expect(checkbox).not.toBeChecked()
    }

    // Verify sliders are at defaults
    await expect(opacity_slider).toHaveValue(`0.3`)
    await expect(size_slider).toHaveValue(`0.5`)
  })

  test(`disabling projection removes it from canvas`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    // Enable XY projection
    const xy_checkbox = pane.locator(`label`).filter({ hasText: `XY` }).locator(
      `input[type="checkbox"]`,
    )
    await xy_checkbox.click()
    await page.waitForTimeout(200)
    const with_projection = await canvas.screenshot()

    // Disable XY projection
    await xy_checkbox.click()
    await expect(xy_checkbox).not.toBeChecked()
    await page.waitForTimeout(200)

    await expect_canvas_changed(canvas, with_projection, get_canvas_timeout())
  })

  test(`projections update when camera rotates`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    // Enable all projections
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = pane.locator(`label`).filter({ hasText: plane }).locator(
        `input[type="checkbox"]`,
      )
      // deno-lint-ignore no-await-in-loop -- sequential clicks required
      await checkbox.click()
    }
    await page.waitForTimeout(200)
    const initial = await canvas.screenshot()

    // Close pane to rotate canvas
    await page.keyboard.press(`Escape`)
    await page.waitForTimeout(100)

    // Rotate camera by dragging
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 150, cy + 100, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(300)

    // Projections should have moved with camera (canvas should be different)
    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })
})
