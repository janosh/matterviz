import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  expect_canvas_changed,
  expect_gizmo_click_flies_camera,
  get_canvas_timeout,
  IS_CI,
  wait_for_3d_canvas,
  wait_for_canvas_rendered,
} from '../helpers'

const TEST_URL = `/test/scatter-plot-3d`
const CONTAINER_SELECTOR = `#test-scatter-3d`

// Opens the controls pane and asserts it got there, so callers that only need the pane don't
// repeat the toggle dance — and the one test that is *about* opening it can just call this.
async function open_controls_pane(page: Page): Promise<Locator> {
  const container = page.locator(CONTAINER_SELECTOR)
  await container.hover()
  const toggle = container.locator(`button.pane-toggle`)
  await expect(toggle).toBeVisible({ timeout: 5000 })
  await toggle.click()
  const pane = container.locator(`.draggable-pane`)
  await expect(pane).toBeVisible({ timeout: 5000 })
  return pane
}

test.describe(`ScatterPlot3D`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ScatterPlot3D tests timeout in CI due to WebGL software rendering`)
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
  })

  // Both helpers assert: wait_for_3d_canvas requires a visible, non-zero-size canvas and
  // wait_for_canvas_rendered requires it to have actually painted.
  test(`renders 3D canvas with content`, async ({ page }) => {
    await wait_for_canvas_rendered(await wait_for_3d_canvas(page, CONTAINER_SELECTOR))
  })

  // Text overlays must not swallow pointer events meant for the canvas below them
  for (const selector of [`.axis-label`, `.tick-label`]) {
    test(`${selector} does not intercept pointer events`, async ({ page }) => {
      await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      const label = page.locator(`${CONTAINER_SELECTOR} ${selector}`).first()
      await expect(label).toBeVisible({ timeout: get_canvas_timeout() })
      await expect(label).toHaveCSS(`pointer-events`, `none`)
    })
  }

  test(`gizmo handles stay reachable beside the color bar and fly the camera`, async ({
    page,
  }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)

    // No CSS can lift an in-canvas gizmo above the ColorBar/Legend, so only its bottom offset
    // keeps it clear. The sweep's synthetic moves ignore overlays; the real click below is what
    // fails if one covers the gizmo.
    await expect_gizmo_click_flies_camera(canvas, {
      probe: 110,
      steps: 11,
      bottom_offset: 65,
    })
  })

  test(`drag to rotate changes view`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const initial = await canvas.screenshot()

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, {
      steps: 10,
    })
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

  test(`controls pane opens on toggle click`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await open_controls_pane(page) // asserts the toggle appears and the pane opens
  })
})

test.describe(`ScatterPlot3D Projections`, () => {
  // Helper to get projection checkbox
  const get_projection_checkbox = (pane: Locator, plane: string) =>
    pane.locator(`label`).filter({ hasText: plane }).locator(`input[type="checkbox"]`)

  // Helper to get slider row by label text
  const get_slider_row = (pane: Locator, label: string) =>
    pane.locator(`.pane-row`).filter({ hasText: label })

  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ScatterPlot3D tests timeout in CI due to WebGL software rendering`)
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
  })

  // Parameterized tests for each projection plane toggle
  for (const plane of [`XY`, `XZ`, `YZ`] as const) {
    test(`toggling ${plane} projection changes canvas`, async ({ page }) => {
      const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      await wait_for_canvas_rendered(canvas)
      const pane = await open_controls_pane(page)
      const initial = await canvas.screenshot()

      const checkbox = get_projection_checkbox(pane, plane)
      await expect(checkbox).not.toBeChecked() // verify default unchecked
      await checkbox.click()
      await expect(checkbox).toBeChecked()
      await page.waitForTimeout(200)

      await expect_canvas_changed(canvas, initial, get_canvas_timeout())
    })
  }

  // Parameterized slider default and range tests
  for (const { name, label, default_val, min, max } of [
    { name: `opacity`, label: `Opacity`, default_val: `0.3`, min: `0`, max: `1` },
    { name: `size`, label: `Size`, default_val: `0.5`, min: `0.1`, max: `1` },
  ] as const) {
    test(`${name} slider has correct defaults (${default_val}, ${min}-${max})`, async ({
      page,
    }) => {
      await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      const pane = await open_controls_pane(page)

      const row = get_slider_row(pane, label)
      const slider = row.locator(`input[type="range"]`)
      await expect(slider).toHaveValue(default_val)
      await expect(slider).toHaveAttribute(`min`, min)
      await expect(slider).toHaveAttribute(`max`, max)
      await expect(slider).toHaveAttribute(`step`, `0.05`)

      await expect(row.locator(`input[type="number"]`)).toHaveValue(default_val)
    })
  }

  // Parameterized slider visual effect tests
  for (const { name, label } of [
    { name: `opacity`, label: `Opacity` },
    { name: `size`, label: `Size` },
  ] as const) {
    test(`${name} slider changes projection appearance`, async ({ page }) => {
      const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      await wait_for_canvas_rendered(canvas)
      const pane = await open_controls_pane(page)

      // Enable XY projection first
      await get_projection_checkbox(pane, `XY`).click()
      await page.waitForTimeout(200)
      const before = await canvas.screenshot()

      // Change slider to max
      await get_slider_row(pane, label).locator(`input[type="range"]`).fill(`1`)
      await page.waitForTimeout(200)

      await expect_canvas_changed(canvas, before, get_canvas_timeout())
    })
  }

  // Parameterized number input sync tests
  for (const { name, label, test_val } of [
    { name: `opacity`, label: `Opacity`, test_val: `0.7` },
    { name: `size`, label: `Size`, test_val: `0.8` },
  ] as const) {
    test(`${name} number input syncs with slider`, async ({ page }) => {
      await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      const pane = await open_controls_pane(page)

      const row = get_slider_row(pane, label)
      const number_input = row.locator(`input[type="number"]`)
      await number_input.fill(test_val)
      await number_input.press(`Enter`)

      await expect(row.locator(`input[type="range"]`)).toHaveValue(test_val)
    })
  }

  test(`reset button resets projections to defaults`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    // Enable all projections and change sliders. Asserting each stays checked as we go also
    // covers that the three planes are independent and can be on simultaneously.
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = get_projection_checkbox(pane, plane)
      await checkbox.click()
      await expect(checkbox).toBeChecked()
    }
    const opacity_row = get_slider_row(pane, `Opacity`)
    const size_row = get_slider_row(pane, `Size`)
    await opacity_row.locator(`input[type="range"]`).fill(`0.8`)
    await size_row.locator(`input[type="range"]`).fill(`0.9`)

    // Click reset button in Projections section specifically
    await pane.locator(`button[title="Reset projections to defaults"]`).click()

    // Verify reset to defaults
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      await expect(get_projection_checkbox(pane, plane)).not.toBeChecked()
    }
    await expect(opacity_row.locator(`input[type="range"]`)).toHaveValue(`0.3`)
    await expect(size_row.locator(`input[type="range"]`)).toHaveValue(`0.5`)
  })

  test(`disabling projection removes it from canvas`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    const xy_checkbox = get_projection_checkbox(pane, `XY`)
    await xy_checkbox.click()
    await page.waitForTimeout(200)
    const with_projection = await canvas.screenshot()

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
      await get_projection_checkbox(pane, plane).click()
    }
    await page.waitForTimeout(200)
    const initial = await canvas.screenshot()

    // Close pane and rotate camera
    await page.keyboard.press(`Escape`)
    await page.waitForTimeout(100)

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, {
      steps: 10,
    })
    await page.mouse.up()
    await page.waitForTimeout(300)

    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })
})
