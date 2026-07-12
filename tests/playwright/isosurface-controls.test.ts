import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  expect_canvas_changed,
  open_settings_pane,
  set_input_value,
  wait_for_canvas_rendered,
} from './helpers'

const ISO_URL = `/structure/isosurface?file=Si-CHGCAR.gz`

async function wait_for_isosurface(page: Page, url = ISO_URL) {
  await page.goto(url, { waitUntil: `networkidle` })
  await expect(page.locator(`text=Grid:`)).toBeVisible({ timeout: 15_000 })
}

// Get center of a bounding box, throwing if null
async function get_center(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Element has no bounding box`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Drag from a locator's center by a given offset
async function drag_from(page: Page, locator: Locator, dx: number, dy: number) {
  // Scroll element into view so mouse coordinates are within the viewport
  await locator.scrollIntoViewIfNeeded()
  const { x, y } = await get_center(locator)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}

test.describe(`Isosurface page`, () => {
  test.beforeEach(async ({ page }) => {
    await wait_for_isosurface(page)
  })

  test.describe(`Isosurface controls`, () => {
    test(`neg. lobe toggle adds and removes negative surface`, async ({ page }) => {
      const pane = await open_settings_pane(page)
      const neg_cb = pane.locator(`label:has-text("Neg. lobe") input[type="checkbox"]`)
      await expect(neg_cb).toBeVisible()
      await neg_cb.check()
      await expect(neg_cb).toBeChecked()
      await neg_cb.uncheck()
      await expect(neg_cb).not.toBeChecked()
    })

    test(`halo slider is present for periodic volumes`, async ({ page }) => {
      const pane = await open_settings_pane(page)
      const halo_slider = pane.locator(`label:has-text("Halo") input[type="range"]`)
      await expect(halo_slider).toBeVisible()
      await expect(halo_slider).toHaveValue(`0`)
    })
  })

  test.describe(`Volumetric slices`, () => {
    test(`switches between HKL, Cartesian, filled, and contour views`, async ({ page }) => {
      const slice = page.getByTestId(`volume-slice`)
      const canvas = slice.locator(`canvas`)
      await wait_for_canvas_rendered(canvas)
      expect(Number(await canvas.getAttribute(`width`))).toBeGreaterThanOrEqual(256)
      const initial = await canvas.screenshot()

      await page.getByLabel(`Slice plane mode`).selectOption(`cartesian`)
      await expect(page.getByLabel(`Cartesian point x`)).toBeVisible()
      await page.getByRole(`button`, { name: `XY`, exact: true }).click()
      await expect(page.getByLabel(`Cartesian normal z`)).toHaveValue(`1`)

      await page.getByLabel(`Slice rendering mode`).selectOption(`contours`)
      await expect_canvas_changed(canvas, initial)
      await page.getByLabel(`Slice rendering mode`).selectOption(`filled`)
      await expect(page.getByLabel(`Slice colormap`)).toBeVisible()
      await page.getByLabel(`Slice colormap`).selectOption(`interpolateViridis`)
      await expect(canvas).toBeVisible()
    })

    test(`masks pixels outside an oblique triclinic cross-section`, async ({ page }) => {
      await wait_for_isosurface(page, `/structure/isosurface?file=hBN-CHGCAR.gz`)
      await page.getByLabel(`Slice plane mode`).selectOption(`cartesian`)
      for (const axis of [`x`, `y`, `z`]) {
        await set_input_value(page.getByLabel(`Cartesian normal ${axis}`), `1`)
      }
      const canvas = page.getByTestId(`volume-slice`).locator(`canvas`)
      await wait_for_canvas_rendered(canvas)

      const alpha_values = await canvas.evaluate((canvas_element) => {
        const canvas_node = canvas_element as HTMLCanvasElement
        const pixels = canvas_node
          .getContext(`2d`)
          ?.getImageData(0, 0, canvas_node.width, canvas_node.height).data
        return pixels
          ? Array.from(
              { length: pixels.length / 4 },
              (_, pixel_idx) => pixels[pixel_idx * 4 + 3],
            )
          : []
      })
      expect(alpha_values).toContain(0)
      expect(alpha_values.some(Boolean)).toBe(true)
    })
  })

  test.describe(`DraggablePane resize grip`, () => {
    test(`resize grip is visible when pane is open`, async ({ page }) => {
      const pane = await open_settings_pane(page)
      await expect(pane.locator(`.resize-grip`)).toBeVisible()
    })

    test(`dragging resize grip changes pane width`, async ({ page }) => {
      const pane = await open_settings_pane(page)
      const initial_box = await pane.boundingBox()
      expect(initial_box).toBeTruthy()
      await drag_from(page, pane.locator(`.resize-grip`), 100, 0)
      await expect(pane).toBeVisible()
      const resized_box = await pane.boundingBox()
      expect(resized_box).toBeTruthy()
      expect(resized_box?.width).toBeGreaterThan((initial_box?.width ?? 0) + 50)
    })

    test(`double-clicking resize grip resets pane size`, async ({ page }) => {
      const pane = await open_settings_pane(page)
      await drag_from(page, pane.locator(`.resize-grip`), 150, 0)
      await expect(pane).toBeVisible()
      await pane.locator(`.resize-grip`).dblclick()
      const inline_width = await pane.evaluate((el) => el.style.width)
      expect(inline_width).toBe(``)
    })

    test(`control tab shows reset/close after drag, reset keeps pane open`, async ({
      page,
    }) => {
      const pane = await open_settings_pane(page)
      const tab = pane.locator(`.control-tab`)
      await expect(tab.locator(`.drag-handle`)).toBeVisible()
      await expect(tab.locator(`.reset-button`)).not.toBeVisible()

      await drag_from(page, tab.locator(`.drag-handle`), 20, 20)

      await expect(tab.locator(`.reset-button`)).toBeVisible()
      await expect(tab.locator(`.close-button`)).toBeVisible()

      await tab.locator(`.reset-button`).click()
      await expect(pane).toBeVisible()
    })
  })
})
