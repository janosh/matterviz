import { rects_overlap } from '$lib/plot/layout'
import { expect, type Locator, test } from '@playwright/test'
import { IS_CI } from '../helpers'

// Helper functions for placement stability tests
async function get_element_center(
  locator: Locator,
): Promise<{ x: number; y: number } | null> {
  const bbox = await locator.boundingBox()
  if (!bbox) return null
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 }
}

function distance(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y)
}

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

test.describe(`PlotLegend Component Integration Tests`, () => {
  const main_legend_wrapper = `#main-legend`
  const custom_style_legend_wrapper = `#custom-style-legend`

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/plot-legend`, { waitUntil: `networkidle` })
  })

  test(`should render legend items correctly based on initial data`, async ({ page }) => {
    test.skip(IS_CI, `Plot legend rendering flaky in CI`)
    const legend_items = page.locator(main_legend_wrapper).locator(`.legend-item`)
    await expect(legend_items).toHaveCount(5)

    // Check labels
    await expect(legend_items.nth(0).locator(`.legend-label`)).toHaveText(`Alpha`)
    await expect(legend_items.nth(1).locator(`.legend-label`)).toHaveText(`Beta`)
    await expect(legend_items.nth(2).locator(`.legend-label`)).toHaveText(`Gamma`)
    await expect(legend_items.nth(3).locator(`.legend-label`)).toHaveText(`Delta`)
    await expect(legend_items.nth(4).locator(`.legend-label`)).toHaveText(`Epsilon`)

    // Check initial visibility and ARIA state
    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(1)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(legend_items.nth(2)).toHaveClass(/hidden/)
    await expect(legend_items.nth(2)).toHaveAttribute(`aria-pressed`, `false`)
    await expect(legend_items.nth(3)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(3)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(legend_items.nth(4)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(4)).toHaveAttribute(`aria-pressed`, `true`)

    // Check marker presence/absence and specific types
    await expect(legend_items.nth(0).locator(`.legend-marker > svg`)).toHaveCount(2)
    await expect(legend_items.nth(0).locator(`.legend-marker circle`)).toBeVisible()
    await expect(legend_items.nth(0).locator(`.legend-marker line`)).toHaveCount(1)
    await expect(legend_items.nth(0).locator(`.legend-marker circle`)).toHaveAttribute(
      `fill`,
      `crimson`,
    )
    await expect(legend_items.nth(0).locator(`.legend-marker line`)).toHaveAttribute(
      `stroke`,
      `crimson`,
    )
    await expect(legend_items.nth(1).locator(`.legend-marker > svg`)).toHaveCount(2)
    await expect(legend_items.nth(1).locator(`.legend-marker rect`)).toBeVisible()
    await expect(legend_items.nth(2).locator(`.legend-marker > svg`)).toHaveCount(1)
    await expect(legend_items.nth(2).locator(`.legend-marker polygon`)).toBeVisible()
    await expect(legend_items.nth(3).locator(`.legend-marker > svg`)).toHaveCount(1)
    await expect(legend_items.nth(3).locator(`.legend-marker line`)).toHaveCount(1)
    await expect(legend_items.nth(4).locator(`.legend-marker > svg`)).toHaveCount(1)
    await expect(legend_items.nth(4).locator(`.legend-marker line`)).toHaveAttribute(
      `stroke`,
      `purple`,
    )
    await expect(legend_items.nth(4).locator(`.legend-marker line`)).toHaveAttribute(
      `stroke-dasharray`,
      `none`,
    )
  })

  test(`should toggle item visibility on single click`, async ({ page }) => {
    const legend_items = page.locator(main_legend_wrapper).locator(`.legend-item`)
    const last_toggled_tracker = page.locator(`[data-testid="last-toggled"]`)

    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)

    await legend_items.nth(0).click()
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `false`, {
      timeout: 5000,
    })
    await expect(last_toggled_tracker).toHaveText(`Last Toggled Index: 0`, {
      timeout: 5000,
    })

    await legend_items.nth(0).click()
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`, {
      timeout: 5000,
    })
    await expect(last_toggled_tracker).toHaveText(`Last Toggled Index: 0`, {
      timeout: 5000,
    })

    await expect(legend_items.nth(2)).toHaveClass(/hidden/)
    await expect(legend_items.nth(2)).toHaveAttribute(`aria-pressed`, `false`)

    await legend_items.nth(2).click()
    await expect(legend_items.nth(2)).toHaveAttribute(`aria-pressed`, `true`, {
      timeout: 5000,
    })
    await expect(last_toggled_tracker).toHaveText(`Last Toggled Index: 2`, {
      timeout: 5000,
    })
  })

  test(`should isolate item on double click and restore on second double click`, async ({ page }) => {
    const legend_items = page.locator(main_legend_wrapper).locator(`.legend-item`)
    const last_isolated_tracker = page.locator(`[data-testid="last-isolated"]`)

    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(2)).toHaveClass(/hidden/)
    await expect(legend_items.nth(3)).not.toHaveClass(/hidden/)

    // Double click Beta (index 1) to isolate
    await legend_items.nth(1).dblclick()
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(0)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(2)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(3)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 1`, {
      timeout: 5000,
    })

    // Double click Beta again to restore
    await legend_items.nth(1).dblclick()
    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(2)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(3)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 1`, {
      timeout: 5000,
    })

    // Double click Gamma (index 2 - initially hidden) to isolate
    await legend_items.nth(2).dblclick()
    await expect(legend_items.nth(2)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(0)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(1)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(3)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 2`, {
      timeout: 5000,
    })

    // Double click Gamma again to restore
    await legend_items.nth(2).dblclick()
    await expect(legend_items.nth(2)).toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(legend_items.nth(3)).not.toHaveClass(/hidden/, { timeout: 5000 })
    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 2`, {
      timeout: 5000,
    })
  })

  test(`should change layout based on props`, async ({ page }) => {
    const legend = page.locator(main_legend_wrapper)

    await page.locator(`#layout`).selectOption(`horizontal`)
    await page.locator(`#n_items`).fill(`2`)
    await expect(legend).toBeVisible()

    await page.locator(`#layout`).selectOption(`vertical`)
    await page.locator(`#n_items`).fill(`3`)
    await expect(legend).toBeVisible()
  })

  test(`should apply custom styles`, async ({ page }) => {
    const legend_wrapper = page.locator(custom_style_legend_wrapper)
    const legend_item = legend_wrapper.locator(`.legend-item`).first()

    await expect(legend_wrapper).toHaveCSS(
      `background-color`,
      `rgba(255, 255, 255, 0.95)`,
    )
    await expect(legend_wrapper).toHaveCSS(`padding`, `0px`)
    await expect(legend_item).toHaveCSS(`color`, `rgb(55, 65, 81)`)
    await expect(legend_item).toHaveCSS(`padding`, `1px 3px`)
  })

  test(`should display correct line colors in legend markers`, async ({ page }) => {
    const legend_items = page.locator(main_legend_wrapper).locator(`.legend-item`)
    const expected_colors = [`crimson`, `steelblue`, undefined, `darkviolet`, `purple`]

    const promises = expected_colors.map(async (expected_color, idx) => {
      const line_marker = legend_items.nth(idx).locator(`.legend-marker line`)
      if (expected_color) {
        await expect(line_marker).toHaveCount(1)
        await expect(line_marker).toHaveAttribute(`stroke`, expected_color)
      } else {
        await expect(line_marker).toHaveCount(0)
      }
    })
    await Promise.all(promises)
  })
})

// Legend placement stability tests (hover lock, toggle stability, resize behavior)
test.describe(`Legend Placement Stability`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  test(`legend position stays fixed while hovered during series toggle`, async ({ page }) => {
    test.skip(IS_CI, `Placement stability tests flaky in CI due to timing`)

    const plot = page.locator(`#legend-multi-default.scatter`)
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for initial placement animation to complete
    const initial_pos = await wait_for_position_stable(legend, 3000)
    expect(initial_pos.x).toBeGreaterThan(10)
    expect(initial_pos.y).toBeGreaterThan(10)

    await legend.hover()
    // Hover state is immediate, no wait needed
    const hovered_pos = await get_element_center(legend)
    expect(hovered_pos).not.toBeNull()

    const series_a = legend.locator(`.legend-item`).first()
    await series_a.click()
    // Position should remain stable while hovered (hover lock)
    const after_toggle_pos = await get_element_center(legend)
    expect(after_toggle_pos).not.toBeNull()

    if (hovered_pos && after_toggle_pos) {
      const movement = distance(hovered_pos, after_toggle_pos)
      expect(movement).toBeLessThan(10)
    }

    await series_a.click()

    const plot_bbox = await plot.boundingBox()
    if (plot_bbox) {
      await page.mouse.move(plot_bbox.x + 10, plot_bbox.y + 10)
    }
    // Wait for hover debounce (300ms) to expire and position to stabilize
    const final_pos = await wait_for_position_stable(legend, 2000)
    expect(final_pos).not.toBeNull()

    if (hovered_pos && final_pos) {
      const total_movement = distance(hovered_pos, final_pos)
      expect(total_movement).toBeLessThan(100)
    }
  })

  test(`legend doesn't jump erratically during rapid series toggles`, async ({ page }) => {
    const plot = page.locator(`#legend-multi-default.scatter`)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for initial placement to stabilize
    const initial_pos = await wait_for_position_stable(legend, 2000)
    expect(initial_pos).not.toBeNull()

    const series_items = legend.locator(`.legend-item`)
    const count = await series_items.count()
    expect(count).toBeGreaterThan(0)

    for (let idx = 0; idx < count; idx++) {
      // deno-lint-ignore no-await-in-loop -- sequential UI interactions required
      await series_items.nth(idx).click()
      // deno-lint-ignore no-await-in-loop -- must verify after each click
      await expect(legend).toBeVisible()
    }

    for (let idx = 0; idx < count; idx++) {
      // deno-lint-ignore no-await-in-loop -- sequential UI interactions required
      await series_items.nth(idx).click()
      // deno-lint-ignore no-await-in-loop -- must verify after each click
      await expect(legend).toBeVisible()
    }

    const final_bbox = await legend.boundingBox()
    expect(final_bbox).not.toBeNull()
    if (final_bbox) {
      expect(final_bbox.width).toBeGreaterThan(50)
      expect(final_bbox.height).toBeGreaterThan(20)
    }
  })

  test(`legend can be dragged and remains functional after data updates`, async ({ page }) => {
    const plot = page.locator(`#legend-multi-default.scatter`)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Wait for initial placement to stabilize
    const initial_pos = await wait_for_position_stable(legend, 2000)
    expect(initial_pos).not.toBeNull()

    const initial_bbox = await legend.boundingBox()
    expect(initial_bbox).not.toBeNull()
    await expect(legend).toHaveClass(/draggable/)

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

    await expect(legend).toBeVisible()

    const series_a = legend.locator(`.legend-item`).first()
    await series_a.click()
    await expect(legend).toBeVisible()
    await expect(series_a).toHaveClass(/hidden/)

    await series_a.click()
    await expect(series_a).not.toHaveClass(/hidden/)
  })
})

test.describe(`Coordinated Legend and ColorBar Placement`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  test(`legend and colorbar do not overlap`, async ({ page }) => {
    const section = page.locator(`#color-scale`)
    const plot = section.locator(`#color-scale-toggle .scatter`)
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    const colorbar = plot.locator(`.colorbar`)

    await expect(colorbar).toBeVisible()

    const legend_count = await legend.count()
    if (legend_count === 0) return

    await expect(legend).toBeVisible()

    const legend_bbox = await legend.boundingBox()
    const colorbar_wrapper = plot.locator(`.colorbar-wrapper`)
    const colorbar_bbox = await colorbar_wrapper.boundingBox()

    if (legend_bbox && colorbar_bbox) {
      const overlaps = rects_overlap(legend_bbox, colorbar_bbox)
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

    await wait_for_position_stable(legend)

    await page.setViewportSize({ width: 600, height: 400 })
    // Wait for legend to reposition after resize
    const resized_pos = await wait_for_position_stable(legend, 2000)
    expect(resized_pos).not.toBeNull()
    await expect(legend).toBeVisible()

    const plot_bbox = await plot.boundingBox()
    const legend_bbox = await legend.boundingBox()

    if (plot_bbox && legend_bbox) {
      const legend_center_x = legend_bbox.x + legend_bbox.width / 2
      const legend_center_y = legend_bbox.y + legend_bbox.height / 2

      expect(legend_center_x).toBeGreaterThan(plot_bbox.x)
      expect(legend_center_x).toBeLessThan(plot_bbox.x + plot_bbox.width)
      expect(legend_center_y).toBeGreaterThan(plot_bbox.y)
      expect(legend_center_y).toBeLessThan(plot_bbox.y + plot_bbox.height)
    }

    await page.setViewportSize({ width: 1280, height: 720 })
  })
})
