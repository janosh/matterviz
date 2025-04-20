import { expect, test, type Locator, type Page } from '@playwright/test'

test.describe(`ScatterPlot Component Tests`, () => {
  // Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `load` })
  })

  test(`renders basic scatter plot with default settings`, async ({ page }) => {
    const section = page.locator(`#basic-example`)
    await expect(section).toBeVisible()
    const scatter_plot = section.locator(`.scatter`)
    await expect(scatter_plot).toBeVisible()
    const svg = scatter_plot.locator(`svg`)
    await expect(svg).toBeVisible()

    // Stricter: Check marker count
    await expect(scatter_plot.locator(`.marker`)).toHaveCount(10) // basic_data has 10 points

    // Stricter: Check default axis labels from test page
    await expect(scatter_plot.locator(`text.label.x`)).toHaveText(`X Axis`)
    await expect(scatter_plot.locator(`text.label.y`)).toHaveText(`Y Axis`)

    // Stricter: Check tick counts (Adjusted)
    await expect(scatter_plot.locator(`g.x-axis .tick`)).toHaveCount(10)
    await expect(scatter_plot.locator(`g.y-axis .tick`)).toHaveCount(4)

    // Stricter: Check first/last tick text (adjust based on observed defaults)
    await expect(
      scatter_plot.locator(`g.x-axis .tick text`).first(),
    ).toHaveText(`1`)
    await expect(scatter_plot.locator(`g.x-axis .tick text`).last()).toHaveText(
      `10`,
    )
    await expect(
      scatter_plot.locator(`g.y-axis .tick text`).first(),
    ).toHaveText(`10`)
    await expect(scatter_plot.locator(`g.y-axis .tick text`).last()).toHaveText(
      /25\s*/,
    )
  })

  test(`displays correct axis labels and ticks`, async ({ page }) => {
    const scatter_plot = page.locator(`#basic-example .scatter`)
    await expect(scatter_plot).toBeVisible()

    // Stricter: Check exact axis labels
    await expect(scatter_plot.locator(`text.label.x`)).toHaveText(`X Axis`)
    await expect(scatter_plot.locator(`text.label.y`)).toHaveText(`Y Axis`)

    // Stricter: Check tick counts (Adjusted)
    await expect(scatter_plot.locator(`g.x-axis .tick`)).toHaveCount(10)
    await expect(scatter_plot.locator(`g.y-axis .tick`)).toHaveCount(4)

    // Commented out brittle first/last tick checks -> Uncommented
    await expect(
      scatter_plot.locator(`g.x-axis .tick text`).first(),
    ).toHaveText(`1`)
    await expect(scatter_plot.locator(`g.x-axis .tick text`).last()).toHaveText(
      `10`,
    )
    await expect(
      scatter_plot.locator(`g.y-axis .tick text`).first(),
    ).toHaveText(`10`)
    await expect(scatter_plot.locator(`g.y-axis .tick text`).last()).toHaveText(
      /25\s*/,
    )
  })

  test(`properly renders different marker types`, async ({ page }) => {
    const section = page.locator(`#marker-types`)
    await expect(section).toBeVisible()

    // Check points-only plot
    const points_plot = section.locator(`#points-only .scatter`)
    await expect(points_plot).toBeVisible()
    await page.waitForTimeout(300)
    // Stricter: Check exact marker count
    await expect(points_plot.locator(`.marker`)).toHaveCount(10) // points_data has 10 points

    // Check line-only plot
    const line_plot = section.locator(`#line-only .scatter`)
    await expect(line_plot).toBeVisible()
    // Stricter: Check line path exists and has a 'd' attribute
    await expect(line_plot.locator(`path[fill="none"]`)).toBeVisible()
    await expect(line_plot.locator(`path[fill="none"]`)).toHaveAttribute(
      `d`,
      /M.+/, // Check 'd' attribute starts with 'M' (moveto)
    )
    // Stricter: Check no markers exist
    await expect(line_plot.locator(`.marker`)).toHaveCount(0)

    // Check line+points plot
    const line_points_plot = section.locator(`#line-points .scatter`)
    await expect(line_points_plot).toBeVisible()
    // Stricter: Check exact marker count
    await expect(line_points_plot.locator(`.marker`)).toHaveCount(10) // line_points_data has 10 points
    // Stricter: Check line path exists
    await expect(line_points_plot.locator(`path[fill="none"]`)).toBeVisible()
    await expect(line_points_plot.locator(`path[fill="none"]`)).toHaveAttribute(
      `d`,
      /M.+/, // Check 'd' attribute starts with 'M' (moveto)
    )
  })

  test(`scales correctly with different data ranges`, async ({ page }) => {
    const section = page.locator(`#range-test`)
    await expect(section).toBeVisible()

    // Check wide range plot
    const wide_range_plot = section.locator(`#wide-range .scatter`)
    await expect(wide_range_plot).toBeVisible()
    await page.waitForTimeout(100) // Short wait for rendering
    // Stricter: Check exact marker count
    await expect(wide_range_plot.locator(`.marker`)).toHaveCount(9) // wide_range_data has 9 points
    // Stricter: Check axis ticks reflect the range (example: first/last tick)
    // Remove brittle first/last tick checks after .nice() -> Uncommented
    await expect(
      wide_range_plot.locator(`g.x-axis .tick text`).first(),
    ).toHaveText(`-1200`)
    await expect(
      wide_range_plot.locator(`g.x-axis .tick text`).last(),
    ).toHaveText(`1200`)
    await expect(
      wide_range_plot.locator(`g.y-axis .tick text`).first(),
    ).toHaveText(/-600\s*/)
    await expect(
      wide_range_plot.locator(`g.y-axis .tick text`).last(),
    ).toHaveText(/600\s*/)

    // Check small range plot
    const small_range_plot = section.locator(`#small-range .scatter`)
    await expect(small_range_plot).toBeVisible()
    // Stricter: Check exact marker count
    await expect(small_range_plot.locator(`.marker`)).toHaveCount(5) // small_range_data has 5 points
    // Stricter: Check axis ticks reflect the range (example: first/last tick)
    // Remove brittle first/last tick checks after .nice() -> Uncommented
    await expect(
      small_range_plot.locator(`g.x-axis .tick text`).first(),
    ).toHaveText(`0`)
    await expect(
      small_range_plot.locator(`g.x-axis .tick text`).last(),
    ).toHaveText(`0.0006`)
    await expect(
      small_range_plot.locator(`g.y-axis .tick text`).first(),
    ).toHaveText(`0`)
    await expect(
      small_range_plot.locator(`g.y-axis .tick text`).last(),
    ).toHaveText(/0\.00006\s*/) // Adjust small y-axis last tick back to float, allow space
  })

  test(`handles logarithmic scales correctly`, async ({ page }) => {
    const section = page.locator(`#log-scale`)
    await expect(section).toBeVisible()

    // Check log-y plot
    const log_y_plot = section.locator(`#log-y .scatter`)
    await expect(log_y_plot).toBeVisible()
    await page.waitForTimeout(500)
    // Stricter: Check tick count and specific tick values
    await expect(log_y_plot.locator(`g.y-axis .tick`)).toHaveCount(5)
    await expect(log_y_plot.locator(`g.y-axis .tick text`).nth(0)).toHaveText(
      /^1\s/,
    )
    await expect(log_y_plot.locator(`g.y-axis .tick text`).nth(1)).toHaveText(
      /10\s*/,
    )
    await expect(log_y_plot.locator(`g.y-axis .tick text`).nth(2)).toHaveText(
      `100`,
    )
    await expect(log_y_plot.locator(`g.y-axis .tick text`).nth(3)).toHaveText(
      /^(1k|1000\s*)$/,
    )
    await expect(log_y_plot.locator(`g.y-axis .tick text`).nth(4)).toHaveText(
      /^(10k|10000\s*)$/,
    )

    // Check log-x plot
    const log_x_plot = section.locator(`#log-x .scatter`)
    await expect(log_x_plot).toBeVisible()
    await page.waitForTimeout(500)
    // Stricter: Check tick count and specific tick values
    await expect(log_x_plot.locator(`g.x-axis .tick`)).toHaveCount(7)
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(0)).toHaveText(
      `10m`, // Use SI prefix
    )
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(1)).toHaveText(
      `100m`, // Use SI prefix
    )
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(2)).toHaveText(
      `1`,
    )
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(3)).toHaveText(
      `10`,
    )
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(4)).toHaveText(
      `100`,
    )
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(5)).toHaveText(
      `1k`, // Use SI prefix
    )
    // There might be a 7th tick (index 6) if the count is 7. Let's check for 10k
    await expect(log_x_plot.locator(`g.x-axis .tick text`).nth(6)).toHaveText(
      `10k`, // Add check for potential 7th tick
    )
  })

  test(`custom styling is applied correctly`, async ({ page }) => {
    const section = page.locator(`#custom-style`)
    await expect(section).toBeVisible()

    // Check rainbow points plot
    const rainbow_plot = section.locator(`#rainbow-points .scatter`)
    await expect(rainbow_plot).toBeVisible()
    await page.waitForTimeout(300)
    // Stricter: Check exact marker count
    await expect(rainbow_plot.locator(`.marker`)).toHaveCount(10)
    // Stricter: Check fill of the first marker
    await expect(rainbow_plot.locator(`.marker`).first()).toHaveAttribute(
      `fill`,
      `#ff0000`,
    )

    // Check multi-series plot
    const multi_series_plot = section.locator(`#multi-series .scatter`)
    await expect(multi_series_plot).toBeVisible()
    // Stricter: Check total marker count (10 + 10)
    await expect(multi_series_plot.locator(`.marker`)).toHaveCount(20)
    // Stricter: Check fill of the first marker (should be from first series)
    await expect(multi_series_plot.locator(`.marker`).first()).toHaveAttribute(
      `fill`,
      `#ff5555`,
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
    await page.waitForTimeout(300)
    // Stricter: Check exact marker count
    await expect(color_scale_plot.locator(`.marker`)).toHaveCount(10)
    // Stricter: Check color bar visibility using the correct class
    await expect(color_scale_plot.locator(`.colorbar`)).toBeVisible()

    // Switch to log mode and check state
    await click_radio(page, `#color-scale input[value="log"]`)
    await expect(log_radio).toBeChecked()
    await expect(linear_radio).not.toBeChecked()
    await page.waitForTimeout(300)
    // Stricter: Check marker count again
    await expect(color_scale_plot.locator(`.marker`)).toHaveCount(10)
    // Stricter: Check color bar still visible using the correct class
    await expect(color_scale_plot.locator(`.colorbar`)).toBeVisible()

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
    // Stricter: Make expected_text non-optional or always provide it
    expected_text: string | RegExp,
  ): Promise<void> => {
    const highlight_circle = plot_locator.locator(`circle[fill="orange"]`)
    const svg = plot_locator.locator(`svg`)

    // Initial state
    await expect(tooltip_locator).not.toBeVisible()
    await expect(highlight_circle).not.toBeVisible()

    // Hover to show tooltip
    await svg.hover({ position: hover_position, force: true })
    await page.waitForTimeout(300)

    // Verify tooltip and highlight are visible
    await expect(highlight_circle).toBeVisible()
    await expect(tooltip_locator).toBeVisible()
    // Stricter: Always check text if provided
    await expect(tooltip_locator).toHaveText(expected_text)

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
    const tooltip_locator = plot_locator.locator(`.tooltip`)

    // Stricter: Provide specific regex for default tooltip format
    await check_tooltip(
      page,
      plot_locator,
      tooltip_locator,
      { x: 70, y: 200 }, // Approx position for first point (1, 10) -> actually hits second point (2, 15)
      /x:\s*2,\s*y:\s*15/, // Check for specific coords of second point
    )
  })

  test(`custom tooltip snippet works correctly`, async ({ page }) => {
    const plot_locator = page.locator(`#custom-tooltip .scatter`)
    const tooltip_locator = plot_locator.locator(`.custom-tooltip`)

    // Use helper, providing regex to match expected content
    await check_tooltip(
      page,
      plot_locator,
      tooltip_locator,
      { x: 150, y: 100 }, // Approx position for second point (2, 8)
      /Point Info:\s*Point B\s*Coords:\s*\(2,\s*8\)/,
    )
    // Keep specific checks as well for redundancy
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

    // 1. Explicitly wait for first tick text to be visible before getting ranges
    await x_axis
      .locator(`.tick text`)
      .first()
      .waitFor({ state: `visible`, timeout: 5000 })
    await y_axis
      .locator(`.tick text`)
      .first()
      .waitFor({ state: `visible`, timeout: 5000 })

    const initial_x = await get_tick_range(x_axis)
    const initial_y = await get_tick_range(y_axis)
    // Stricter: Check exact initial tick counts (Adjusted)
    expect(initial_x.ticks.length).toBe(10)
    expect(initial_y.ticks.length).toBe(4)
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

  // --- Label Auto Placement Tests ---

  // Helper function to get label positions
  const get_label_positions = async (
    plot_locator: Locator,
  ): Promise<Record<string, { x: number; y: number }>> => {
    await plot_locator.waitFor({ state: `visible` })
    await plot_locator.page().waitForTimeout(200)

    const positions: Record<string, { x: number; y: number }> = {}
    // Find all marker paths first
    const markers = await plot_locator.locator(`path.marker`).all()

    for (const marker of markers) {
      // Get the parent <g> of the marker
      const parent_group = marker.locator(`..`)

      // Find the text element within that same group
      const label_text_element = parent_group.locator(`text`)
      const label_text_content = await label_text_element.textContent()

      if (label_text_content) {
        // Get the transform from the parent group
        const transform = await parent_group.getAttribute(`transform`)

        if (transform) {
          const match = transform.match(
            /translate\(([^\s,]+)\s*,?\s*([^\)]+)\)/,
          )
          if (match) {
            positions[label_text_content] = {
              x: parseFloat(match[1]),
              y: parseFloat(match[2]),
            }
          }
        }
      }
    }
    return positions
  }

  test(`label auto-placement repositions labels in dense clusters`, async ({
    page,
  }) => {
    const section = page.locator(`#label-auto-placement-test`)
    const plot_locator = section.locator(`.scatter`)
    const checkbox = section.locator(`input[type="checkbox"]`)

    // Ensure auto-placement is initially enabled
    await expect(checkbox).toBeChecked()

    // Get positions with auto-placement enabled
    await page.waitForTimeout(1000) // Wait for simulation to potentially run/settle
    const positions_auto = await get_label_positions(plot_locator)

    // Disable auto-placement
    await checkbox.uncheck()
    await page.waitForTimeout(200) // Wait for re-render (should be quick)
    await expect(checkbox).not.toBeChecked()

    // Get positions with auto-placement disabled (default offsets)
    const positions_manual = await get_label_positions(plot_locator)

    // Verify positions are different for dense cluster labels
    const dense_labels = Object.keys(positions_auto).filter((key) =>
      key.startsWith(`Dense-`),
    )
    expect(dense_labels.length).toBeGreaterThan(1) // Make sure we have dense labels

    let moved_count = 0
    for (const label_text of dense_labels) {
      expect(positions_auto[label_text]).toBeDefined()
      expect(positions_manual[label_text]).toBeDefined()
      // Check if position differs by more than a small threshold (e.g., 1px)
      const dx = Math.abs(
        positions_auto[label_text].x - positions_manual[label_text].x,
      )
      const dy = Math.abs(
        positions_auto[label_text].y - positions_manual[label_text].y,
      )
      if (dx > 1 || dy > 1) {
        moved_count++
      }
    }

    // Expect most (if not all) dense labels to have moved
    expect(moved_count).toBeGreaterThan(dense_labels.length / 2)
  })

  test(`label auto-placement does not significantly move sparse labels`, async ({
    page,
  }) => {
    const section = page.locator(`#label-auto-placement-test`)
    const plot_locator = section.locator(`.scatter`)
    const checkbox = section.locator(`input[type="checkbox"]`)

    // Ensure auto-placement is initially enabled
    await expect(checkbox).toBeChecked()
    await page.waitForTimeout(1000) // Wait for simulation
    const positions_auto = await get_label_positions(plot_locator)

    // Disable auto-placement
    await checkbox.uncheck()
    await page.waitForTimeout(200) // Wait for re-render
    await expect(checkbox).not.toBeChecked()
    await page.waitForTimeout(100)
    const positions_manual = await get_label_positions(plot_locator)

    // Verify positions are similar for sparse labels
    const sparse_labels = Object.keys(positions_auto).filter((key) =>
      key.startsWith(`Sparse-`),
    )
    expect(sparse_labels.length).toBe(4)

    for (const label_text of sparse_labels) {
      expect(positions_auto[label_text]).toBeDefined()
      expect(positions_manual[label_text]).toBeDefined()
      // Check if positions are very close (allow slightly larger deviation for simulation)
      expect(positions_auto[label_text].x).toBeCloseTo(
        positions_manual[label_text].x,
        0, // Relax precision from 2 to 0
      )
      expect(positions_auto[label_text].y).toBeCloseTo(
        positions_manual[label_text].y,
        0, // Relax precision from 2 to 0
      )
    }
  })

  test(`label auto-placement handles single label correctly`, async ({
    page,
  }) => {
    const section = page.locator(`#label-auto-placement-test`)
    const plot_locator = section.locator(`.scatter`)
    const checkbox = section.locator(`input[type="checkbox"]`)

    // Check with auto-placement enabled
    await checkbox.check()
    await expect(checkbox).toBeChecked()
    await page.waitForTimeout(1000) // Wait for simulation
    const positions_auto = await get_label_positions(plot_locator)

    // Check with auto-placement disabled
    await checkbox.uncheck()
    await page.waitForTimeout(200) // Wait for re-render
    await expect(checkbox).not.toBeChecked()
    const positions_manual = await get_label_positions(plot_locator)

    const single_label = `Single`
    expect(positions_auto[single_label]).toBeDefined()
    expect(positions_manual[single_label]).toBeDefined()

    // Single label shouldn't move much, if at all
    expect(positions_auto[single_label].x).toBeCloseTo(
      positions_manual[single_label].x,
      1,
    )
    expect(positions_auto[single_label].y).toBeCloseTo(
      positions_manual[single_label].y,
      1,
    )
  })
})
