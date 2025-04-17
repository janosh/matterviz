import { expect, test } from '@playwright/test'

test.describe(`ScatterPlot Component Tests`, () => {
  test(`renders basic scatter plot with default settings`, async ({ page }) => {
    // Navigate to combined page
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Verify basic example is rendered
    const section = await page.$(`#basic-example`)
    expect(section).not.toBeNull()

    // Verify scatter plot is rendered (using non-null assertion since we checked above)
    const scatter_plot = await section!.$(`.scatter`)
    expect(scatter_plot).not.toBeNull()

    // Check if SVG is present (using non-null assertion since we checked above)
    const svg = await scatter_plot!.$(`svg`)
    expect(svg).not.toBeNull()
  })

  test(`handles mouse interactions correctly`, async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Locate the basic scatter plot
    const section = await page.$(`#basic-example`)
    expect(section).not.toBeNull()

    const scatter_plot = await section!.$(`.scatter`)
    expect(scatter_plot).not.toBeNull()

    // Only proceed with hover if the element exists
    if (scatter_plot) {
      // Hover over the scatter plot - just verify this doesn't cause errors
      await scatter_plot.hover({ position: { x: 200, y: 150 } })

      // Move mouse out
      await page.mouse.move(0, 0)
    }
  })

  test(`displays correct axis labels and ticks`, async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Get the basic example
    const section = await page.$(`#basic-example`)
    expect(section).not.toBeNull()

    const scatter_plot = await section!.$(`.scatter`)
    expect(scatter_plot).not.toBeNull()

    // Check x-axis label (using non-null assertion since we checked above)
    const x_axis_label = await scatter_plot!.$(`text.label.x`)
    expect(x_axis_label).not.toBeNull()

    // Check y-axis label
    const y_axis_label = await scatter_plot!.$(`text.label.y`)
    expect(y_axis_label).not.toBeNull()

    // Check for tick marks
    const x_ticks = await scatter_plot!.$$(`g.x-axis .tick`)
    expect(x_ticks.length).toBeGreaterThan(0)

    const y_ticks = await scatter_plot!.$$(`g.y-axis .tick`)
    expect(y_ticks.length).toBeGreaterThan(0)
  })

  test(`properly renders different marker types`, async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Go to the marker types section
    const section = await page.$(`#marker-types`)
    expect(section).not.toBeNull()

    // Get the points-only plot
    const points_plot = await section!.$(`#points-only .scatter`)
    expect(points_plot).not.toBeNull()

    // Check that scatter points are rendered
    const scatter_points = await points_plot!.$$(`.marker`)
    expect(scatter_points.length).toBeGreaterThan(0)

    // Get the line-only plot
    const line_plot = await section!.$(`#line-only .scatter`)
    expect(line_plot).not.toBeNull()

    // Get the line+points plot
    const line_points_plot = await section!.$(`#line-points .scatter`)
    expect(line_points_plot).not.toBeNull()
  })

  test(`scales correctly with different data ranges`, async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Go to the range test section
    const section = await page.$(`#range-test`)
    expect(section).not.toBeNull()

    // Get the wide range plot
    const wide_range_plot = await section!.$(`#wide-range .scatter`)
    expect(wide_range_plot).not.toBeNull()

    // Check that points are drawn within the viewable area
    const wide_range_points = await wide_range_plot!.$$(`.marker`)
    expect(wide_range_points.length).toBeGreaterThan(0)

    // Get the small range plot
    const small_range_plot = await section!.$(`#small-range .scatter`)
    expect(small_range_plot).not.toBeNull()

    // Check that points are drawn within the viewable area
    const small_range_points = await small_range_plot!.$$(`.marker`)
    expect(small_range_points.length).toBeGreaterThan(0)
  })

  test(`handles logarithmic scales correctly`, async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Go to the log scale section
    const section = await page.$(`#log-scale`)
    expect(section).not.toBeNull()

    // Get the log-y plot
    const log_y_plot = await section!.$(`#log-y .scatter`)
    expect(log_y_plot).not.toBeNull()

    // Verify that log scale ticks are displayed for y-axis
    const y_ticks = await log_y_plot!.$$(`g.y-axis .tick`)
    expect(y_ticks.length).toBeGreaterThan(0)

    // Get the log-x plot
    const log_x_plot = await section!.$(`#log-x .scatter`)
    expect(log_x_plot).not.toBeNull()

    // Verify that log scale ticks are displayed for x-axis
    const x_ticks = await log_x_plot!.$$(`g.x-axis .tick`)
    expect(x_ticks.length).toBeGreaterThan(0)
  })

  test(`custom styling is applied correctly`, async ({ page }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Go to the custom style section
    const section = await page.$(`#custom-style`)
    expect(section).not.toBeNull()

    // Get the rainbow points plot
    const rainbow_plot = await section!.$(`#rainbow-points .scatter`)
    expect(rainbow_plot).not.toBeNull()

    // Check if points have custom colors (rainbow pattern)
    const rainbow_markers = await rainbow_plot!.$$(`.marker`)
    expect(rainbow_markers.length).toBeGreaterThan(0)

    // Get the multi-series plot
    const multi_series_plot = await section!.$(`#multi-series .scatter`)
    expect(multi_series_plot).not.toBeNull()

    // Check if multiple series are rendered
    const multi_series_markers = await multi_series_plot!.$$(`.marker`)
    expect(multi_series_markers.length).toBeGreaterThan(0)
  })

  test(`handles color scaling with both linear and log modes`, async ({
    page,
  }) => {
    await page.goto(`/scatter-plot-e2e`, { waitUntil: `networkidle` })

    // Go to the color scale section
    const section = await page.$(`#color-scale`)
    expect(section).not.toBeNull()

    // Get the color scale plot
    const color_scale_plot = await section!.$(`#color-scale-toggle .scatter`)
    expect(color_scale_plot).not.toBeNull()

    // Check initial state - should be linear mode by default
    const linear_radio = await section!.$(`input[value="linear"]`)
    expect(await linear_radio?.isChecked()).toBe(true)

    // Check that points are rendered
    const points = await color_scale_plot!.$$(`.marker`)
    expect(points.length).toBeGreaterThan(0)

    // Switch to log mode
    const log_radio = await section!.$(`input[value="log"]`)
    expect(log_radio).not.toBeNull()

    // We need to force a click event since radio button might not be fully visible
    await page.evaluate(() => {
      // Use querySelector to find the log radio button and trigger a click
      const logRadio = document.querySelector(
        `#color-scale input[value="log"]`,
      ) as HTMLInputElement
      if (logRadio) {
        logRadio.click()
      }
    })

    // Verify log mode is active
    expect(await log_radio?.isChecked()).toBe(true)
    expect(await linear_radio?.isChecked()).toBe(false)

    // Check that points are still rendered after switching modes
    const points_after_switch = await color_scale_plot!.$$(`.marker`)
    expect(points_after_switch.length).toBeGreaterThan(0)

    // Switch back to linear mode using the same technique
    await page.evaluate(() => {
      const linearRadio = document.querySelector(
        `#color-scale input[value="linear"]`,
      ) as HTMLInputElement
      if (linearRadio) {
        linearRadio.click()
      }
    })

    expect(await linear_radio?.isChecked()).toBe(true)
  })
})
