import { expect, test, type Locator, type Page } from '@playwright/test'

test.describe(`ScatterPlot Component Tests`, () => {
  // Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })
  })

  test(`renders basic scatter plot with default settings`, async ({ page }) => {
    // Verify basic example is rendered
    const section = page.locator(`#basic-example`)
    await expect(section).toBeVisible()

    // Verify scatter plot is rendered
    const scatter_plot = section.locator(`.scatter`)
    await expect(scatter_plot).toBeVisible()

    // Check if SVG is present
    const svg = scatter_plot.locator(`svg`)
    await expect(svg).toBeVisible()
  })

  test(`handles mouse interactions correctly`, async ({ page }) => {
    const scatter_plot = page.locator(`#basic-example .scatter`)
    await expect(scatter_plot).toBeVisible()

    // Hover over the scatter plot - just verify this doesn't cause errors
    await scatter_plot.hover({ position: { x: 200, y: 150 } })

    // Move mouse out
    await page.mouse.move(0, 0)
  })

  test(`displays correct axis labels and ticks`, async ({ page }) => {
    const scatter_plot = page.locator(`#basic-example .scatter`)
    await expect(scatter_plot).toBeVisible()

    // Check axis labels
    await expect(scatter_plot.locator(`text.label.x`)).toBeVisible()
    await expect(scatter_plot.locator(`text.label.y`)).toBeVisible()

    // Check for tick marks
    expect(
      await scatter_plot.locator(`g.x-axis .tick`).count(),
    ).toBeGreaterThan(0)
    expect(
      await scatter_plot.locator(`g.y-axis .tick`).count(),
    ).toBeGreaterThan(0)
  })

  test(`properly renders different marker types`, async ({ page }) => {
    const section = page.locator(`#marker-types`)
    await expect(section).toBeVisible()

    // Check points-only plot
    const points_plot = section.locator(`#points-only .scatter`)
    await expect(points_plot).toBeVisible()
    expect(await points_plot.locator(`.marker`).count()).toBeGreaterThan(0)

    // Check line-only plot (existence is enough)
    const line_plot = section.locator(`#line-only .scatter`)
    await expect(line_plot).toBeVisible()

    // Check line+points plot (existence is enough)
    const line_points_plot = section.locator(`#line-points .scatter`)
    await expect(line_points_plot).toBeVisible()
  })

  test(`scales correctly with different data ranges`, async ({ page }) => {
    const section = page.locator(`#range-test`)
    await expect(section).toBeVisible()

    // Check wide range plot
    const wide_range_plot = section.locator(`#wide-range .scatter`)
    await expect(wide_range_plot).toBeVisible()
    expect(await wide_range_plot.locator(`.marker`).count()).toBeGreaterThan(0)

    // Check small range plot
    const small_range_plot = section.locator(`#small-range .scatter`)
    await expect(small_range_plot).toBeVisible()
    expect(await small_range_plot.locator(`.marker`).count()).toBeGreaterThan(0)
  })

  test(`handles logarithmic scales correctly`, async ({ page }) => {
    const section = page.locator(`#log-scale`)
    await expect(section).toBeVisible()

    // Check log-y plot
    const log_y_plot = section.locator(`#log-y .scatter`)
    await expect(log_y_plot).toBeVisible()
    expect(await log_y_plot.locator(`g.y-axis .tick`).count()).toBeGreaterThan(
      0,
    )

    // Check log-x plot
    const log_x_plot = section.locator(`#log-x .scatter`)
    await expect(log_x_plot).toBeVisible()
    expect(await log_x_plot.locator(`g.x-axis .tick`).count()).toBeGreaterThan(
      0,
    )
  })

  test(`custom styling is applied correctly`, async ({ page }) => {
    const section = page.locator(`#custom-style`)
    await expect(section).toBeVisible()

    // Check rainbow points plot
    const rainbow_plot = section.locator(`#rainbow-points .scatter`)
    await expect(rainbow_plot).toBeVisible()
    expect(await rainbow_plot.locator(`.marker`).count()).toBeGreaterThan(0)

    // Check multi-series plot
    const multi_series_plot = section.locator(`#multi-series .scatter`)
    await expect(multi_series_plot).toBeVisible()
    expect(await multi_series_plot.locator(`.marker`).count()).toBeGreaterThan(
      0,
    )
  })

  // Helper function to click radio buttons reliably
  const click_radio = async (page: Page, selector: string): Promise<void> => {
    await page.evaluate((sel) => {
      const radio = document.querySelector(sel) as HTMLInputElement
      if (radio) radio.click()
    }, selector)
  }

  test(`handles color scaling with both linear and log modes`, async ({
    page,
  }) => {
    const section = page.locator(`#color-scale`)
    await expect(section).toBeVisible()

    const color_scale_plot = section.locator(`#color-scale-toggle .scatter`)
    await expect(color_scale_plot).toBeVisible()

    const linear_radio = section.locator(`input[value="linear"]`)
    const log_radio = section.locator(`input[value="log"]`)

    // Check initial state (linear) and points
    await expect(linear_radio).toBeChecked()
    expect(await color_scale_plot.locator(`.marker`).count()).toBeGreaterThan(0)

    // Switch to log mode and check state
    await click_radio(page, `#color-scale input[value="log"]`)
    await expect(log_radio).toBeChecked()
    await expect(linear_radio).not.toBeChecked()
    expect(await color_scale_plot.locator(`.marker`).count()).toBeGreaterThan(0) // Points should still render

    // Switch back to linear mode
    await click_radio(page, `#color-scale input[value="linear"]`)
    await expect(linear_radio).toBeChecked()
  })

  // Helper to check tooltip visibility and interaction
  const check_tooltip = async (
    page: Page,
    plot_locator: Locator,
    tooltip_locator: Locator,
    hover_position: { x: number; y: number },
    expected_text?: string | RegExp,
  ): Promise<void> => {
    const highlight_circle = plot_locator.locator(`circle[fill="orange"]`)
    const svg = plot_locator.locator(`svg`)

    // Initial state
    await expect(tooltip_locator).not.toBeVisible()
    await expect(highlight_circle).not.toBeVisible()

    // Hover to show tooltip
    await svg.hover({ position: hover_position, force: true })
    await page.waitForTimeout(100) // Allow time for transitions/updates

    // Verify tooltip and highlight are visible
    await expect(highlight_circle).toBeVisible()
    await expect(tooltip_locator).toBeVisible()
    if (expected_text) {
      await expect(tooltip_locator).toHaveText(expected_text)
    }

    // Move mouse away
    await page.mouse.move(0, 0)
    await page.waitForTimeout(100)

    // Verify tooltip and highlight are hidden
    await expect(tooltip_locator).not.toBeVisible()
    await expect(highlight_circle).not.toBeVisible()
  }

  test(`tooltip appears on hover and disappears on mouse leave`, async ({
    page,
  }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const tooltip_locator = plot_locator.locator(`.default-tooltip`)

    await check_tooltip(
      page,
      plot_locator,
      tooltip_locator,
      { x: 70, y: 200 }, // Approx position for first point (1, 10)
      /x: [-+]?\d*\.?\d+, y: [-+]?\d*\.?\d+/, // Default format check
    )
  })

  test(`custom tooltip snippet works correctly`, async ({ page }) => {
    const plot_locator = page.locator(`#custom-tooltip .scatter`)
    const tooltip_locator = plot_locator.locator(`.custom-tooltip`)

    await check_tooltip(
      page,
      plot_locator,
      tooltip_locator,
      { x: 150, y: 100 }, // Approx position for second point (2, 8)
    )
    // Specific text checks after hover confirmation
    const svg = plot_locator.locator(`svg`)
    await svg.hover({ position: { x: 150, y: 100 }, force: true }) // Re-hover to check text
    await page.waitForTimeout(100) // Allow time for transitions/updates
    await expect(tooltip_locator).toContainText(`Point Info: Point B`)
    await expect(tooltip_locator).toContainText(`Coords: (2, 8)`)
    await page.mouse.move(0, 0) // Move away finally
  })

  test(`bind:hovered works correctly`, async ({ page }) => {
    const section = page.locator(`#bind-hovered`)
    const svg = section.locator(`.scatter svg`)
    const hover_status = page.locator(`#hover-status`)

    // Initial state: not hovered
    await expect(hover_status).toHaveText(`false`)

    // Hover over the plot
    await svg.hover({ position: { x: 100, y: 100 }, force: true })
    await page.waitForTimeout(50) // Allow time for transitions/updates
    await expect(hover_status).toHaveText(`true`) // Check immediately after hover

    // Move mouse away
    await page.mouse.move(0, 0)
    await page.waitForTimeout(50) // Allow time for transitions/updates
    await expect(hover_status).toHaveText(`false`) // Check immediately after moving away
  })

  // Helper function to get tick values as numbers and calculate range
  const get_tick_range = async (
    axis_locator: Locator,
  ): Promise<{ ticks: number[]; range: number }> => {
    const tick_elements = await axis_locator.locator(`.tick text`).all()
    const tick_texts = await Promise.all(
      tick_elements.map((tick) => tick.textContent()),
    )
    const ticks = tick_texts
      .filter((text): text is string => text !== null)
      .map((text) => parseFloat(text.replace(/[^\d.-]/g, ``))) // Clean text, parse as float
      .filter((num) => !isNaN(num)) // Filter out NaN values

    if (ticks.length < 2) {
      return { ticks, range: 0 } // Not enough ticks to calculate a meaningful range
    }
    const range = Math.abs(Math.max(...ticks) - Math.min(...ticks))
    return { ticks, range }
  }

  test(`zooms correctly on drag and resets on double-click`, async ({
    page,
  }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const svg = plot_locator.locator(`svg`)
    const x_axis = plot_locator.locator(`g.x-axis`)
    const y_axis = plot_locator.locator(`g.y-axis`)
    const zoom_rect = plot_locator.locator(`rect.zoom-rect`)

    // 1. Get initial tick values and ranges
    const initial_x = await get_tick_range(x_axis)
    const initial_y = await get_tick_range(y_axis)
    expect(initial_x.ticks.length).toBeGreaterThan(1)
    expect(initial_y.ticks.length).toBeGreaterThan(1)
    expect(initial_x.range).toBeGreaterThan(0)
    expect(initial_y.range).toBeGreaterThan(0)

    // 2. Perform zoom drag
    const svg_box = await svg.boundingBox()
    expect(svg_box).toBeTruthy()
    const start_x = svg_box!.x + svg_box!.width * 0.3 // Start drag 30% into the plot
    const start_y = svg_box!.y + svg_box!.height * 0.7 // Start drag 70% down
    const end_x = svg_box!.x + svg_box!.width * 0.7 // End drag 70% into the plot
    const end_y = svg_box!.y + svg_box!.height * 0.3 // End drag 30% down

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()
    // Rect might be 0x0 initially, so don't check visibility yet

    await page.mouse.move(end_x, end_y, { steps: 5 })
    // After moving, the rect should have dimensions and be visible
    await expect(zoom_rect).toBeVisible() // Check rect is still visible during move
    const rect_box = await zoom_rect.boundingBox()
    expect(rect_box).toBeTruthy()
    expect(rect_box!.width).toBeGreaterThan(0)
    expect(rect_box!.height).toBeGreaterThan(0)

    await page.mouse.up()
    await expect(zoom_rect).not.toBeVisible() // Check rect disappears
    await page.waitForTimeout(100) // Allow axes to update

    // 3. Verify ticks have changed and range decreased (zoomed)
    const zoomed_x = await get_tick_range(x_axis)
    const zoomed_y = await get_tick_range(y_axis)
    expect(zoomed_x.ticks).not.toEqual(initial_x.ticks) // Ticks themselves should change
    expect(zoomed_y.ticks).not.toEqual(initial_y.ticks)
    expect(zoomed_x.range).toBeLessThan(initial_x.range) // Range should decrease
    expect(zoomed_y.range).toBeLessThan(initial_y.range)
    expect(zoomed_x.range).toBeGreaterThan(0) // Range should still be positive
    expect(zoomed_y.range).toBeGreaterThan(0)

    // 4. Perform double-click to reset
    await svg.dblclick()
    await page.waitForTimeout(100) // Allow axes to update

    // 5. Verify ticks and ranges have reset to initial values
    const reset_x = await get_tick_range(x_axis)
    const reset_y = await get_tick_range(y_axis)
    expect(reset_x.ticks).toEqual(initial_x.ticks) // Ticks should be back to original
    expect(reset_y.ticks).toEqual(initial_y.ticks)
    expect(reset_x.range).toBeCloseTo(initial_x.range) // Range should be back to original (use toBeCloseTo for float precision)
    expect(reset_y.range).toBeCloseTo(initial_y.range)
  })
})
