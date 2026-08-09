import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

// The element matrix is ~103x103 and opts into `virtualize`. Windowing is measured from real
// layout, so it can only be exercised in a browser.
test.describe(`HeatmapMatrix virtualization`, () => {
  const matrix = `.scroll-container .grid`

  // The window is derived from layout, so it settles a frame or two after load
  const settle = async (page: Page) => {
    await page.locator(matrix).first().scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (selector) =>
        (document.querySelector(selector)?.querySelectorAll(`.cell`).length ?? 0) > 50,
      matrix,
    )
    await page.waitForTimeout(500)
  }

  // Coverage, not just cell count: a window that is too small still renders a tidy block of
  // cells, it just leaves visible grid area blank. Measuring how far the rendered cells reach
  // is what catches that — the stride is tile size plus gap, and a `0px` gap once fell back
  // to 12px, shrinking the window to a third of the visible columns.
  const coverage = (page: Page) =>
    page.evaluate((selector) => {
      const grid = document.querySelector(selector)
      if (!grid) throw new Error(`no matrix found for ${selector}`)
      const cells = [...grid.querySelectorAll<HTMLElement>(`.cell[data-x][data-y]`)]
      if (cells.length === 0) throw new Error(`matrix rendered no cells`)
      const view = grid.getBoundingClientRect()
      const rects = cells.map((cell) => cell.getBoundingClientRect())
      const xs = cells.map((cell) => Number(cell.dataset.x))
      return {
        // how far right/down the rendered block reaches, relative to the visible area
        covered_right: Math.max(...rects.map((rect) => rect.right)) - view.left,
        covered_bottom: Math.max(...rects.map((rect) => rect.bottom)) - view.top,
        view_width: view.width,
        view_height: view.height,
        content_width: grid.scrollWidth,
        min_x: Math.min(...xs),
        max_x: Math.max(...xs),
      }
    }, matrix)

  test(`covers the visible area when the matrix overflows`, async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 800 })
    await page.goto(`/plot/heatmap-matrix`, { waitUntil: `load` })
    await settle(page)

    const before = await coverage(page)
    expect(before.content_width).toBeGreaterThan(before.view_width) // precondition: overflows
    expect(before.covered_right).toBeGreaterThanOrEqual(before.view_width)
    expect(before.covered_bottom).toBeGreaterThanOrEqual(before.view_height)
    expect(before.min_x).toBe(0)

    await page.evaluate((selector) => {
      const grid = document.querySelector(selector)
      if (grid) grid.scrollLeft = 300
    }, matrix)
    await page.waitForTimeout(400)

    const after = await coverage(page)
    expect(after.min_x).toBeGreaterThan(before.min_x) // window tracked the scroll
    expect(after.max_x).toBeGreaterThan(before.max_x)
  })
})
