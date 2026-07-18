import { expect, test } from '@playwright/test'
import { expect_bottom_within, get_chart_svg } from '../helpers'

test(`keeps the multi-structure layout bounded and responsive`, async ({ page }) => {
  await page.goto(`/structure/coordination`, { waitUntil: `networkidle` })

  const plot = page.locator(`.bar-plot`).nth(1)
  const structure_grid = page.locator(`.selected-structures-grid`)
  const structure_tiles = structure_grid.locator(`.structure-tile`)
  await expect(plot).toBeVisible()
  await expect(structure_grid).toBeVisible()
  await expect(structure_tiles).toHaveCount(3)

  await expect_bottom_within(get_chart_svg(plot), plot.locator(`.axis-label.x-label`))
  const [plot_bounds, grid_bounds, last_tile_bounds] = await Promise.all([
    plot.boundingBox(),
    structure_grid.boundingBox(),
    structure_tiles.last().boundingBox(),
  ])
  if (!plot_bounds || !grid_bounds || !last_tile_bounds) {
    throw new Error(`Missing coordination layout bounds`)
  }
  expect(grid_bounds.height).toBeCloseTo(plot_bounds.height, 0)
  expect(last_tile_bounds.width).toBeCloseTo(grid_bounds.width, 0)
  expect(await structure_grid.evaluate((grid) => grid.scrollWidth <= grid.clientWidth)).toBe(
    true,
  )

  await page.setViewportSize({ width: 900, height: 1000 })
  const [responsive_plot_bounds, top_right, bottom_left, bottom_right] = await Promise.all([
    plot.boundingBox(),
    ...[0, 1, 2].map((tile_idx) => structure_tiles.nth(tile_idx).boundingBox()),
  ])
  if (!responsive_plot_bounds || !top_right || !bottom_left || !bottom_right) {
    throw new Error(`Missing responsive coordination layout bounds`)
  }

  expect(top_right.x).toBeGreaterThan(responsive_plot_bounds.x)
  expect(top_right.y).toBeCloseTo(responsive_plot_bounds.y, 0)
  expect(bottom_left.x).toBeCloseTo(responsive_plot_bounds.x, 0)
  expect(bottom_left.y).toBeGreaterThan(responsive_plot_bounds.y)
  expect(bottom_right.x).toBeGreaterThan(responsive_plot_bounds.x)
  expect(bottom_right.y).toBeGreaterThan(responsive_plot_bounds.y)
  const plot_area = responsive_plot_bounds.width * responsive_plot_bounds.height
  for (const bounds of [top_right, bottom_left, bottom_right]) {
    expect(bounds.width * bounds.height).toBeLessThan(plot_area)
  }
})
