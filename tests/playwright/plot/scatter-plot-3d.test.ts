// deno-lint-ignore-file no-window
import { expect, test } from '@playwright/test'
import {
  expect_canvas_changed,
  get_canvas_timeout,
  IS_CI,
  wait_for_3d_canvas,
  wait_for_canvas_rendered,
} from '../helpers'

const TEST_URL = `/test/scatter-plot-3d`
const CONTAINER_SELECTOR = `#test-scatter-3d`

test.describe(`ScatterPlot3D`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ScatterPlot3D tests timeout in CI due to WebGL software rendering`)
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

  // Parameterized CSS property tests for gizmo clickability
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

// Helper to get projection checkbox
function get_projection_checkbox(
  pane: import('@playwright/test').Locator,
  plane: string,
) {
  return pane.locator(`label`).filter({ hasText: plane }).locator(
    `input[type="checkbox"]`,
  )
}

test.describe(`ScatterPlot3D Projections`, () => {
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

  test(`multiple projections can be enabled simultaneously`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = get_projection_checkbox(pane, plane)
      // deno-lint-ignore no-await-in-loop -- sequential clicks required
      await checkbox.click()
      // deno-lint-ignore no-await-in-loop -- sequential verification required
      await expect(checkbox).toBeChecked()
    }
  })

  // Helper to get slider row by label text for better selector specificity
  const get_slider_row = (pane: import('@playwright/test').Locator, label: string) =>
    pane.locator(`.pane-row`).filter({ hasText: label })

  // Parameterized slider default and range tests
  for (
    const { name, label, default_val, min, max } of [
      { name: `opacity`, label: `Opacity`, default_val: `0.3`, min: `0`, max: `1` },
      { name: `size`, label: `Size`, default_val: `0.5`, min: `0.1`, max: `1` },
    ] as const
  ) {
    test(`${name} slider has correct defaults (${default_val}, ${min}-${max})`, async ({ page }) => {
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
  for (
    const { name, label } of [
      { name: `opacity`, label: `Opacity` },
      { name: `size`, label: `Size` },
    ] as const
  ) {
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
  for (
    const { name, label, test_val } of [
      { name: `opacity`, label: `Opacity`, test_val: `0.7` },
      { name: `size`, label: `Size`, test_val: `0.8` },
    ] as const
  ) {
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

    // Enable all projections and change sliders
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      // deno-lint-ignore no-await-in-loop -- sequential clicks required
      await get_projection_checkbox(pane, plane).click()
    }
    const opacity_row = get_slider_row(pane, `Opacity`)
    const size_row = get_slider_row(pane, `Size`)
    await opacity_row.locator(`input[type="range"]`).fill(`0.8`)
    await size_row.locator(`input[type="range"]`).fill(`0.9`)

    // Click first reset button (Projections section is first with sliders)
    await pane.locator(`button[title="Reset"]`).first().click()

    // Verify reset to defaults
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      // deno-lint-ignore no-await-in-loop -- sequential verification required
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
      // deno-lint-ignore no-await-in-loop -- sequential clicks required
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
