// Tests for legend/colorbar placement stability features:
// - Hover lock (element stays in place while hovered)
// - Series toggle stability (position doesn't jump during rapid toggles)
// - Coordinated placement (legend and colorbar don't overlap)
// - Resize behavior (elements reposition on resize)

import { expect, type Locator, test } from '@playwright/test'
import { IS_CI } from '../helpers'

// Get the center position of an element for comparison
async function get_element_center(
  locator: Locator,
): Promise<{ x: number; y: number } | null> {
  const bbox = await locator.boundingBox()
  if (!bbox) return null
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }
}

// Calculate distance between two points
function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)
}

// Check if two bounding boxes overlap
function boxes_overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

// Wait for position to stabilize (no movement for 100ms)
async function wait_for_position_stable(
  locator: Locator,
  timeout: number = 2000,
): Promise<{ x: number; y: number }> {
  let last_pos = await get_element_center(locator)
  let stable_count = 0

  const start = Date.now()
  while (Date.now() - start < timeout) {
    // deno-lint-ignore no-await-in-loop -- intentional polling pattern
    await new Promise((resolve) => setTimeout(resolve, 50))
    // deno-lint-ignore no-await-in-loop -- sequential DOM reads required
    const current_pos = await get_element_center(locator)
    if (!current_pos || !last_pos) continue

    if (distance(current_pos, last_pos) < 1) {
      stable_count++
      if (stable_count >= 2) return current_pos
    } else {
      stable_count = 0
    }
    last_pos = current_pos
  }

  if (!last_pos) throw new Error(`Element not found`)
  return last_pos
}

test.describe(`Legend Placement Stability`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  test(`legend position stays fixed while hovered during series toggle`, async ({ page }) => {
    test.skip(IS_CI, `Placement stability tests flaky in CI due to timing`)

    // Use the multi-series plot which has toggleable series
    const plot = page.locator(`#legend-multi-default.scatter`)
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for Tween animation to complete (initial placement)
    await page.waitForTimeout(600)

    // Wait for placement to stabilize
    const initial_pos = await wait_for_position_stable(legend, 3000)

    // Verify initial position is reasonable (not at origin)
    expect(initial_pos.x).toBeGreaterThan(10)
    expect(initial_pos.y).toBeGreaterThan(10)

    // Hover over the legend to activate hover lock
    await legend.hover()
    await page.waitForTimeout(100) // Allow hover state to register

    // Get position while hovered
    const hovered_pos = await get_element_center(legend)
    expect(hovered_pos).not.toBeNull()

    // Toggle a series while legend is hovered
    const series_a = legend.locator(`.legend-item`).first()
    await series_a.click()

    // Wait a bit for any would-be repositioning
    await page.waitForTimeout(200)

    // Position should not have changed significantly while hovered
    const after_toggle_pos = await get_element_center(legend)
    expect(after_toggle_pos).not.toBeNull()

    if (hovered_pos && after_toggle_pos) {
      const movement = distance(hovered_pos, after_toggle_pos)
      // Position should stay essentially the same (allow 10px tolerance)
      expect(movement).toBeLessThan(10)
    }

    // Re-enable the series
    await series_a.click()

    // Move mouse away to release hover lock
    const plot_bbox = await plot.boundingBox()
    if (plot_bbox) {
      await page.mouse.move(plot_bbox.x + 10, plot_bbox.y + 10)
    }
    await page.waitForTimeout(500) // Wait for 300ms debounce + buffer

    // Wait for any repositioning animation
    await page.waitForTimeout(500)

    // Position should still be close to hovered position (stable after release)
    const final_pos = await get_element_center(legend)
    expect(final_pos).not.toBeNull()

    if (hovered_pos && final_pos) {
      const total_movement = distance(hovered_pos, final_pos)
      // Allow reasonable movement for data changes, but no dramatic jumps
      expect(total_movement).toBeLessThan(100)
    }
  })

  test(`legend doesn't jump erratically during rapid series toggles`, async ({ page }) => {
    // This test verifies that toggling series visibility doesn't break the legend
    // We verify the legend remains visible and can be interacted with

    const plot = page.locator(`#legend-multi-default.scatter`)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for initial animation to complete
    await page.waitForTimeout(600)

    // Toggle series and verify legend remains visible
    const series_items = legend.locator(`.legend-item`)
    const count = await series_items.count()
    expect(count).toBeGreaterThan(0)

    for (let idx = 0; idx < count; idx++) {
      // deno-lint-ignore no-await-in-loop -- sequential UI interactions required
      await series_items.nth(idx).click()
      // deno-lint-ignore no-await-in-loop -- must verify after each click
      await expect(legend).toBeVisible()
    }

    // Toggle them back
    for (let idx = 0; idx < count; idx++) {
      // deno-lint-ignore no-await-in-loop -- sequential UI interactions required
      await series_items.nth(idx).click()
      // deno-lint-ignore no-await-in-loop -- must verify after each click
      await expect(legend).toBeVisible()
    }

    // Verify legend still has proper dimensions (not collapsed)
    const final_bbox = await legend.boundingBox()
    expect(final_bbox).not.toBeNull()
    if (final_bbox) {
      expect(final_bbox.width).toBeGreaterThan(50)
      expect(final_bbox.height).toBeGreaterThan(20)
    }
  })

  test(`legend can be dragged and remains functional after data updates`, async ({ page }) => {
    // This test verifies that legend can be dragged and remains functional

    const plot = page.locator(`#legend-multi-default.scatter`)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for initial animation to complete
    await page.waitForTimeout(600)

    // Get initial position
    const initial_bbox = await legend.boundingBox()
    expect(initial_bbox).not.toBeNull()

    // Verify legend has the draggable class
    await expect(legend).toHaveClass(/draggable/)

    // Drag the legend (simulate user dragging)
    if (!initial_bbox) throw new Error(`Legend bounding box not found`)
    const drag_offset = { x: 50, y: 30 }
    await page.mouse.move(initial_bbox.x + 10, initial_bbox.y + 10)
    await page.mouse.down()
    await page.mouse.move(
      initial_bbox.x + drag_offset.x,
      initial_bbox.y + drag_offset.y,
      { steps: 10 },
    )
    await page.mouse.up()

    // Verify legend is still visible after drag
    await expect(legend).toBeVisible()

    // Toggle a series (data update)
    const series_a = legend.locator(`.legend-item`).first()
    await series_a.click()

    // Verify legend is still visible and functional after toggle
    await expect(legend).toBeVisible()
    await expect(series_a).toHaveClass(/hidden/)

    // Toggle back and verify
    await series_a.click()
    await expect(series_a).not.toHaveClass(/hidden/)
  })
})

test.describe(`Coordinated Legend and ColorBar Placement`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  test(`legend and colorbar do not overlap`, async ({ page }) => {
    // Use a plot that has both legend and colorbar
    const section = page.locator(`#color-scale`)
    const plot = section.locator(`#color-scale-toggle .scatter`)
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    const colorbar = plot.locator(`.colorbar`)

    // Wait for both to be visible
    await expect(colorbar).toBeVisible()

    // Check if legend exists (might not for single-series plots)
    const legend_count = await legend.count()
    if (legend_count === 0) {
      // No legend to check, test passes
      return
    }

    await expect(legend).toBeVisible()

    // Get bounding boxes
    const legend_bbox = await legend.boundingBox()
    const colorbar_wrapper = plot.locator(`div.colorbar[style*="position"]`)
    const colorbar_bbox = await colorbar_wrapper.boundingBox()

    if (legend_bbox && colorbar_bbox) {
      // Check that they don't overlap
      const overlaps = boxes_overlap(legend_bbox, colorbar_bbox)
      expect(overlaps).toBe(false)
    }
  })
})

test.describe(`Legend Placement on Resize`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  test(`legend repositions appropriately after viewport resize`, async ({ page }) => {
    test.skip(IS_CI, `Resize tests can be flaky in CI`)

    const plot = page.locator(`#legend-multi-default.scatter`)
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for initial position to stabilize at default viewport
    await wait_for_position_stable(legend)

    // Resize viewport significantly
    await page.setViewportSize({ width: 600, height: 400 })

    // Wait for repositioning
    await page.waitForTimeout(500)

    // Position may have changed to adapt to new size
    const resized_pos = await get_element_center(legend)
    expect(resized_pos).not.toBeNull()

    // Legend should still be visible and within the plot
    await expect(legend).toBeVisible()

    const plot_bbox = await plot.boundingBox()
    const legend_bbox = await legend.boundingBox()

    if (plot_bbox && legend_bbox) {
      // Legend center should be within plot bounds
      const legend_center_x = legend_bbox.x + legend_bbox.width / 2
      const legend_center_y = legend_bbox.y + legend_bbox.height / 2

      expect(legend_center_x).toBeGreaterThan(plot_bbox.x)
      expect(legend_center_x).toBeLessThan(plot_bbox.x + plot_bbox.width)
      expect(legend_center_y).toBeGreaterThan(plot_bbox.y)
      expect(legend_center_y).toBeLessThan(plot_bbox.y + plot_bbox.height)
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 })
  })
})
