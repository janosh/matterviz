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
