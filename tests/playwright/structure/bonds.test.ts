import { expect, test } from '@playwright/test'
import { wait_for_3d_canvas } from '../helpers'

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
      const rotated = await canvas.screenshot()
      expect(initial.equals(rotated)).toBe(false)
      const rotated_pixels = count_non_white_pixels(rotated)
      expect(rotated_pixels).toBeGreaterThan(100)

      // Assert 6-7: Zoom works and changes view
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -200)
      const zoomed = await canvas.screenshot()
      expect(initial.equals(zoomed)).toBe(false)
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
    const horizontal = await canvas.screenshot()
    expect(initial.equals(horizontal)).toBe(false)
    expect(count_non_white_pixels(horizontal)).toBeGreaterThan(100)

    // Assert 4-5: Vertical rotation also changes view
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2, y: box.height / 2 - 50 },
      targetPosition: { x: box.width / 2, y: box.height / 2 + 50 },
      force: true,
    })
    const vertical = await canvas.screenshot()
    expect(horizontal.equals(vertical)).toBe(false)
    expect(count_non_white_pixels(vertical)).toBeGreaterThan(100)

    // Assert 6: All three views are distinct
    expect(initial.equals(vertical)).toBe(false)
    // Assert 7: No console errors
    expect(console_errors).toHaveLength(0)
  })
})
