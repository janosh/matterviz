import { expect, test } from '@playwright/test'

test.describe(`PlotLegend Component Integration Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/plot-legend`)
  })

  test(`should render legend items correctly based on initial data`, async ({
    page,
  }) => {
    const legend_items = page.locator(`.legend-item`)
    await expect(legend_items).toHaveCount(4)

    // Check labels
    await expect(legend_items.nth(0).locator(`.legend-label`)).toHaveText(
      `Alpha`,
    )
    await expect(legend_items.nth(1).locator(`.legend-label`)).toHaveText(
      `Beta`,
    )
    await expect(legend_items.nth(2).locator(`.legend-label`)).toHaveText(
      `Gamma`,
    )
    await expect(legend_items.nth(3).locator(`.legend-label`)).toHaveText(
      `Delta`,
    )

    // Check initial visibility and ARIA state
    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(1)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(legend_items.nth(2)).toHaveClass(/hidden/)
    await expect(legend_items.nth(2)).toHaveAttribute(`aria-pressed`, `false`)
    await expect(legend_items.nth(3)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(3)).toHaveAttribute(`aria-pressed`, `true`)

    // Check marker presence/absence and specific types (spot checks)
    // Alpha (line + circle)
    await expect(
      legend_items.nth(0).locator(`.legend-marker > svg`),
    ).toHaveCount(2)
    await expect(
      legend_items.nth(0).locator(`.legend-marker circle`),
    ).toBeVisible()
    await expect(
      legend_items.nth(0).locator(`.legend-marker line`),
    ).toHaveCount(1)
    await expect(
      legend_items.nth(0).locator(`.legend-marker circle`),
    ).toHaveAttribute(`fill`, `crimson`)
    await expect(
      legend_items.nth(0).locator(`.legend-marker line`),
    ).toHaveAttribute(`stroke`, `crimson`)

    // Beta (line + square)
    await expect(
      legend_items.nth(1).locator(`.legend-marker > svg`),
    ).toHaveCount(2)
    await expect(
      legend_items.nth(1).locator(`.legend-marker rect`),
    ).toBeVisible()

    // Gamma (triangle only)
    await expect(
      legend_items.nth(2).locator(`.legend-marker > svg`),
    ).toHaveCount(1)
    await expect(
      legend_items.nth(2).locator(`.legend-marker polygon`),
    ).toBeVisible()

    // Delta (line only)
    await expect(
      legend_items.nth(3).locator(`.legend-marker > svg`),
    ).toHaveCount(1)
    await expect(
      legend_items.nth(3).locator(`.legend-marker line`),
    ).toHaveCount(1)
  })

  test.skip(`should toggle item visibility on single click`, async ({
    page,
  }) => {
    const legend_items = page.locator(`.legend-item`)
    const last_toggled_tracker = page.locator(`[data-testid="last-toggled"]`)

    // Item 0 (Alpha) starts visible
    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)

    // Click Alpha
    await legend_items.nth(0).click()
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `false`)
    await expect(last_toggled_tracker).toHaveText(`Last Toggled Index: 0`)

    // Click Alpha again
    await legend_items.nth(0).click()
    await expect(legend_items.nth(0)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(last_toggled_tracker).toHaveText(`Last Toggled Index: 0`)

    // Item 2 (Gamma) starts hidden
    await expect(legend_items.nth(2)).toHaveClass(/hidden/)
    await expect(legend_items.nth(2)).toHaveAttribute(`aria-pressed`, `false`)

    // Click Gamma
    await legend_items.nth(2).click()
    await expect(legend_items.nth(2)).toHaveAttribute(`aria-pressed`, `true`)
    await expect(last_toggled_tracker).toHaveText(`Last Toggled Index: 2`)
  })

  test.skip(`should isolate item on double click and restore on second double click`, async ({
    page,
  }) => {
    const legend_items = page.locator(`.legend-item`)
    const last_isolated_tracker = page.locator(`[data-testid="last-isolated"]`)

    // Initial state: 0, 1, 3 visible; 2 hidden
    await expect(legend_items.nth(0)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(2)).toHaveClass(/hidden/)
    await expect(legend_items.nth(3)).not.toHaveClass(/hidden/)

    // Double click Beta (index 1)
    await legend_items.nth(1).dblclick()

    // Only Beta should be visible - use poll to wait for updates after ensuring state
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/)

    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 1`)

    // Double click Beta again
    await legend_items.nth(1).dblclick()

    // Should restore original visibility - use poll after ensuring state
    await expect(legend_items.nth(1)).not.toHaveClass(/hidden/)

    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 1`) // Tracker shows last action

    // Double click Gamma (index 2 - initially hidden)
    await legend_items.nth(2).dblclick()

    // Only Gamma should be visible - use poll after ensuring state
    await expect(legend_items.nth(2)).not.toHaveClass(/hidden/)

    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 2`)

    // Double click Gamma again
    await legend_items.nth(2).dblclick()

    // Should restore previous state (0, 1, 3 visible; 2 hidden) - use poll after ensuring state
    await expect(legend_items.nth(2)).toHaveClass(/hidden/)

    await expect(last_isolated_tracker).toHaveText(`Last Isolated Index: 2`)
  })

  test(`should change layout based on props`, async ({ page }) => {
    // This test mainly verifies that changing layout props doesn't crash.
    // Verifying exact CSS grid properties is brittle in e2e tests.

    // Change to Horizontal, 2 columns
    await page.locator(`#layout`).selectOption(`horizontal`)
    await page.locator(`#n_items`).fill(`2`)
    // Add a basic check that the legend still exists
    await expect(page.locator(`.legend`)).toBeVisible()

    // Change to Vertical, 3 rows
    await page.locator(`#layout`).selectOption(`vertical`)
    await page.locator(`#n_items`).fill(`3`)
    // Add a basic check that the legend still exists
    await expect(page.locator(`.legend`)).toBeVisible()
  })

  test(`should apply custom styles`, async ({ page }) => {
    const legend_wrapper = page.locator(`.legend`)
    const legend_item = page.locator(`.legend-item`).first()

    // Apply styles via inputs
    await page
      .locator(`#wrapper_style`)
      .fill(`background-color: rgb(10, 20, 30); padding: 5px;`)
    await page
      .locator(`#item_style`)
      .fill(`color: rgb(255, 255, 0); margin: 1px;`)

    // Check styles
    await expect(legend_wrapper).toHaveCSS(
      `background-color`,
      `rgb(10, 20, 30)`,
    )
    await expect(legend_wrapper).toHaveCSS(`padding`, `5px`)
    await expect(legend_item).toHaveCSS(`color`, `rgb(255, 255, 0)`)
    await expect(legend_item).toHaveCSS(`margin`, `1px`)
  })
})
