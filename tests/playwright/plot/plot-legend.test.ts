import { expect, test } from '@playwright/test'

// Rendering, layout, styles and marker shapes are covered by tests/vitest/plot/PlotLegend.test.ts;
// this only checks the click/double-click callbacks fire through a real browser event pipeline.
test(`legend items report single clicks via on_toggle and double clicks via on_double_click`, async ({
  page,
}) => {
  await page.goto(`/test/plot-legend`, { waitUntil: `networkidle` })
  const legend_items = page.locator(`#main-legend .legend-item`)
  const last_toggled = page.locator(`[data-testid="last-toggled"]`)
  const last_isolated = page.locator(`[data-testid="last-isolated"]`)
  await expect(legend_items).toHaveCount(5)
  await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)

  await legend_items.nth(0).click()
  await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `false`)
  await expect(last_toggled).toHaveText(`Last Toggled Index: 0`)
  await legend_items.nth(0).click()
  await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)

  await legend_items.nth(1).dblclick()
  await expect(last_isolated).toHaveText(`Last Isolated Index: 1`)
  await expect(last_toggled).toHaveText(`Last Toggled Index: null`)
})
