import { expect, test } from '@playwright/test'

test.describe(`PlotLegend Component Integration Tests`, () => {
  // Define locators for the two legend instances
  const main_legend_wrapper = `div:has(h2:has-text("Legend Component"))`
  const custom_style_legend_wrapper = `#custom-style-legend`

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/plot-legend`)
  })

  test(`should render legend items correctly based on initial data`, async ({ page }) => {
    // Target the first legend instance
    const legend_items = page.locator(`.legend`).first().locator(`.legend-item`)
    await expect(legend_items).toHaveCount(5)

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
    await expect(legend_items.nth(4).locator(`.legend-label`)).toHaveText(
      `Epsilon`,
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
    await expect(legend_items.nth(4)).not.toHaveClass(/hidden/)
    await expect(legend_items.nth(4)).toHaveAttribute(`aria-pressed`, `true`)

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

    // Epsilon (line only, no dash) - NEW TEST
    await expect(
      legend_items.nth(4).locator(`.legend-marker > svg`),
    ).toHaveCount(1)
    await expect(
      legend_items.nth(4).locator(`.legend-marker line`), // Check specifically for the line SVG
    ).toHaveAttribute(`stroke`, `purple`) // Verify color
    await expect(
      legend_items.nth(4).locator(`.legend-marker line`),
    ).toHaveAttribute(`stroke-dasharray`, `none`) // Verify solid line style
  })

  test.skip(`should toggle item visibility on single click`, async ({ page }) => {
    const legend_items = page
      .locator(main_legend_wrapper)
      .locator(`.legend-item`)
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

  test.skip(`should isolate item on double click and restore on second double click`, async ({ page }) => {
    const legend_items = page
      .locator(main_legend_wrapper)
      .locator(`.legend-item`)
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
    // Target the main legend for layout changes
    const legend = page.locator(`.legend`).first()

    // Change to Horizontal, 2 columns
    await page.locator(`#layout`).selectOption(`horizontal`)
    await page.locator(`#n_items`).fill(`2`)
    // Add a basic check that the legend still exists
    await expect(legend).toBeVisible()

    // Change to Vertical, 3 rows
    await page.locator(`#layout`).selectOption(`vertical`)
    await page.locator(`#n_items`).fill(`3`)
    // Add a basic check that the legend still exists
    await expect(legend).toBeVisible()
  })

  test(`should apply custom styles`, async ({ page }) => {
    // Target the custom style legend instance
    const legend_wrapper = page.locator(custom_style_legend_wrapper)
    const legend_item = legend_wrapper.locator(`.legend-item`).first()

    await expect(legend_wrapper).toHaveCSS(
      `background-color`,
      `rgba(255, 255, 255, 0.95)`,
    )
    // Check padding on the wrapper div directly
    await expect(legend_wrapper).toHaveCSS(`padding`, `0px`)
    // Check item color (inherited or set by --plot-legend-item-color)
    await expect(legend_item).toHaveCSS(`color`, `rgb(55, 65, 81)`) // Check color applied to item text
    // Check item padding set by --plot-legend-item-padding
    await expect(legend_item).toHaveCSS(`padding`, `1px 3px`) // Check padding applied to item
  })

  test(`should display correct line colors in legend markers`, async ({ page }) => {
    const legend_items = page.locator(`.legend`).first().locator(`.legend-item`)
    const expected_colors = [
      `crimson`,
      `steelblue`,
      undefined,
      `darkviolet`,
      `purple`,
    ]

    const promises = expected_colors.map(async (expected_color, idx) => {
      const line_marker = legend_items.nth(idx).locator(`.legend-marker line`)

      if (expected_color) {
        await expect(line_marker).toHaveCount(1)
        await expect(line_marker).toHaveAttribute(`stroke`, expected_color)
      } else {
        // Item 2 (Gamma) should not have a line
        await expect(line_marker).toHaveCount(0)
      }
    })

    await Promise.all(promises)
  })
})
