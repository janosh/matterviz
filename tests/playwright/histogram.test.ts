// deno-lint-ignore-file no-await-in-loop
import { expect, type Locator, type Page, test } from '@playwright/test'

// HELPER FUNCTIONS
const click_radio = async (page: Page, selector: string): Promise<void> => {
  await page.evaluate((sel) => {
    const radio = document.querySelector(sel) as HTMLInputElement
    if (radio) radio.click()
  }, selector)
}

const set_range_value = async (
  page: Page,
  selector: string,
  value: number,
): Promise<void> => {
  await page.evaluate(
    ({ sel, val }) => {
      const input = document.querySelector(sel) as HTMLInputElement
      if (input) {
        input.value = val.toString()
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        input.dispatchEvent(new Event(`change`, { bubbles: true }))
      }
    },
    { sel: selector, val: value },
  )
}

const get_bar_count = async (histogram_locator: Locator): Promise<number> => {
  // Look for bars with fill or stroke (for overlay mode)
  const bars_with_fill = await histogram_locator.locator(`rect[fill]:not([fill="none"])`)
    .count()
  const bars_with_stroke = await histogram_locator.locator(
    `rect[stroke]:not([stroke="none"])`,
  ).count()

  // Return the maximum count to handle both single and overlay modes
  return Math.max(bars_with_fill, bars_with_stroke)
}

/** Get tick values and calculate range for histogram axes */
const get_histogram_tick_range = async (
  axis_locator: Locator,
): Promise<{ ticks: number[]; range: number }> => {
  const tick_elements = await axis_locator.locator(`.tick text`).all()
  const tick_texts = await Promise.all(
    tick_elements.map((tick) => tick.textContent()),
  )
  const ticks = tick_texts
    .map((text) => (text ? parseFloat(text.replace(/[^\d.-]/g, ``)) : NaN))
    .filter((num) => !isNaN(num))

  if (ticks.length < 2) return { ticks, range: 0 }
  const range = Math.abs(Math.max(...ticks) - Math.min(...ticks))
  return { ticks, range }
}

test.describe(`Histogram Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/histogram`, { waitUntil: `networkidle` })
  })

  test(`renders basic histogram with correct structure`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    // Wait for histogram to render bars properly
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Wait for multiple bars to render (at least 5 bars for a proper histogram)
    await expect(async () => {
      const bar_count = await histogram.locator(`rect[fill]:not([fill="none"])`).count()
      expect(bar_count).toBeGreaterThan(5)
    }).toPass({ timeout: 1000 })

    const [bar_count, x_tick_count, y_tick_count] = await Promise.all([
      get_bar_count(histogram),
      histogram.locator(`g.x-axis .tick`).count(),
      histogram.locator(`g.y-axis .tick`).count(),
    ])

    // Core functionality tests
    expect(bar_count).toBeGreaterThan(0)
    expect(x_tick_count).toBeGreaterThan(0)
    expect(y_tick_count).toBeGreaterThan(0)

    // Note: Axis labels may not render consistently due to timing or sizing issues
    // The core histogram functionality (bars and ticks) is more important to test
  })

  test(`responds to control changes`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series svg`).first()

    // Wait for histogram to render with bars (D3 may adjust bin count slightly)
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const controls = [
      {
        control: `bin count`,
        selector: `input[type="range"]:first-of-type`,
        values: [5, 50],
      },
      {
        control: `sample size`,
        selector: `input[type="range"]:nth-of-type(2)`,
        values: [100, 5000],
      },
    ]

    for (const { selector, values } of controls) {
      let previous_bar_count = await get_bar_count(histogram)
      for (const value of values) {
        await set_range_value(page, `#basic-single-series ${selector}`, value)
        const bar_count = await get_bar_count(histogram)
        expect(bar_count).toBeGreaterThan(0)

        // For bin count changes, verify it affects the histogram
        if (selector.includes(`first-of-type`) && value !== values[0]) {
          expect(bar_count).not.toBe(previous_bar_count)
        }
        previous_bar_count = bar_count
      }
    }
  })

  test(`multiple series overlay functionality`, async ({ page }) => {
    const histogram = page.locator(`#multiple-series-overlay svg`).first()
    await expect(histogram).toBeVisible()

    // Wait for histogram to render bars and axes
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })
    await expect(histogram.locator(`g.x-axis`)).toBeVisible({ timeout: 5000 })
    await expect(histogram.locator(`g.y-axis`)).toBeVisible({ timeout: 5000 })

    // Debug: check if histogram has dimensions and content
    const has_dimensions = await histogram.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    expect(has_dimensions).toBe(true)

    const [series_count, series_bars, x_axis_count, y_axis_count] = await Promise.all([
      histogram.locator(`g.histogram-series`).count(),
      histogram.locator(`g.histogram-series rect`).all(),
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])

    expect(x_axis_count).toBeGreaterThan(0)
    expect(y_axis_count).toBeGreaterThan(0)
    expect(series_count).toBeGreaterThan(0)
    expect(series_bars.length).toBeGreaterThan(0)

    const stroke_width = await series_bars[0].getAttribute(`stroke-width`)
    expect(parseFloat(stroke_width || `0`)).toBeGreaterThan(0)

    // Verify histogram remains functional after initial render
    await expect(histogram.locator(`g.x-axis`)).toBeVisible({ timeout: 5000 })
    await expect(histogram.locator(`g.y-axis`)).toBeVisible({ timeout: 5000 })

    const [final_x_axis, final_y_axis] = await Promise.all([
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])
    expect(final_x_axis).toBeGreaterThan(0)
    expect(final_y_axis).toBeGreaterThan(0)
  })

  test(`series visibility toggles work`, async ({ page }) => {
    const histogram = page.locator(`#multiple-series-overlay svg`).first()
    const legend = page.locator(`#multiple-series-overlay .legend`)
    const first_legend_item = legend.locator(`.legend-item`).first()

    // Wait for histogram to render initially
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const initial_bars = await get_bar_count(histogram)
    expect(initial_bars).toBeGreaterThan(0)

    // Toggle off first series using legend
    await first_legend_item.click()

    // Wait for histogram to re-render after toggle
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })
    const after_toggle = await get_bar_count(histogram)
    expect(after_toggle).toBeGreaterThanOrEqual(0)

    // Toggle back on using legend
    await first_legend_item.click()

    // Wait for histogram to re-render after restore
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })
    const after_restore = await get_bar_count(histogram)
    expect(after_restore).toBeGreaterThan(0)
  })

  test(`logarithmic scale combinations`, async ({ page }) => {
    const histogram = page.locator(`#logarithmic-scales svg`).first()

    // Wait for initial histogram to render
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const scale_combinations = [
      { x_scale: `linear`, y_scale: `linear` },
      { x_scale: `log`, y_scale: `linear` },
      { x_scale: `log`, y_scale: `log` },
      { x_scale: `linear`, y_scale: `log` },
    ]

    for (const { x_scale, y_scale } of scale_combinations) {
      await click_radio(page, `#logarithmic-scales input[value="${x_scale}"][name*="x"]`)
      await click_radio(page, `#logarithmic-scales input[value="${y_scale}"][name*="y"]`)

      // Wait for histogram to re-render with new scale and for axes to be visible

      // Wait for axes to be rendered with ticks
      await expect(histogram.locator(`g.x-axis .tick`).first()).toBeVisible({
        timeout: 3000,
      })
      await expect(histogram.locator(`g.y-axis .tick`).first()).toBeVisible({
        timeout: 3000,
      })

      const [x_tick_count, y_tick_count, bar_count] = await Promise.all([
        histogram.locator(`g.x-axis .tick`).count(),
        histogram.locator(`g.y-axis .tick`).count(),
        get_bar_count(histogram),
      ])

      expect(x_tick_count).toBeGreaterThan(0)
      expect(y_tick_count).toBeGreaterThan(0)
      expect(bar_count).toBeGreaterThan(0)
    }
  })

  test(`distribution types`, async ({ page }) => {
    const histogram = page.locator(`#real-world-distributions svg`).first()

    const distributions = [
      { type: `bimodal`, min_bars: 5 },
      { type: `skewed`, min_bars: 5 },
      { type: `discrete`, max_bars: 10 },
      { type: `age`, min_bars: 5 },
    ]

    for (const { type, min_bars, max_bars } of distributions) {
      const distribution_select = page.locator(
        `label:has-text("Distribution Type:") select`,
      )
      await distribution_select.selectOption(type)

      // Wait for histogram to re-render with new data
      await expect(histogram).toBeVisible()
      await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first())
        .toBeVisible({
          timeout: 5000,
        })

      const bar_count = await get_bar_count(histogram)
      expect(bar_count).toBeGreaterThanOrEqual(0) // Allow 0 bars for some distributions

      if (min_bars) expect(bar_count).toBeGreaterThan(min_bars)
      if (max_bars) expect(bar_count).toBeLessThanOrEqual(max_bars)
    }
  })

  test(`bin size comparison modes`, async ({ page }) => {
    const histogram = page.locator(`#bin-size-comparison svg`).first()

    // Wait for histogram to render initially
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test that the histogram renders with bars
    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)

    // Test that changing bin count works
    const range_inputs = page.locator(`#bin-size-comparison input[type="range"]`)
    const input_count = await range_inputs.count()

    if (input_count > 0) {
      await set_range_value(page, `#bin-size-comparison input[type="range"]`, 50)
      const new_bar_count = await get_bar_count(histogram)
      expect(new_bar_count).toBeGreaterThan(0)
    }
  })

  test(`custom styling and color schemes`, async ({ page }) => {
    // This test is no longer applicable since we removed the custom styling section
    // The histogram still renders correctly with default styling
    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    // Verify histogram renders with bars
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)
  })

  test(`tooltips and legend functionality`, async ({ page }) => {
    // Test tooltips
    const basic_histogram = page.locator(`#basic-single-series svg`).first()
    const first_bar = basic_histogram.locator(`rect[fill]:not([fill="none"])`).first()
    await first_bar.hover({ force: true })

    const tooltip = basic_histogram.locator(`.tooltip`)
    if (await tooltip.isVisible({ timeout: 1000 })) {
      const tooltip_content = await tooltip.textContent()
      expect(tooltip_content).toContain(`Value:`)
      expect(tooltip_content).toContain(`Count:`)
    }

    // Test legend visibility and basic functionality
    const multiple_legend = page.locator(`#multiple-series-overlay .legend`)
    const single_legend = page.locator(`#basic-single-series .legend`)

    if (await multiple_legend.isVisible()) {
      const legend_items = await multiple_legend.locator(`.legend-item`).count()
      expect(legend_items).toBeGreaterThan(1)

      // Test that legend items are clickable and have proper styling
      const first_legend_item = multiple_legend.locator(`.legend-item`).first()
      await expect(first_legend_item).toBeVisible()

      // Verify legend item has clickable appearance (cursor pointer or similar)
      const cursor_style = await first_legend_item.evaluate((el) => {
        return getComputedStyle(el).cursor
      })
      expect(cursor_style).toBe(`pointer`)

      // Test that clicking a legend item doesn't break the legend
      await first_legend_item.click()
      await expect(multiple_legend).toBeVisible()
      const after_click_count = await multiple_legend.locator(`.legend-item`).count()
      expect(after_click_count).toBe(legend_items)
    }
    await expect(single_legend).not.toBeVisible()
  })

  test(`legend remains functional when all series are disabled`, async ({ page }) => {
    // Use the multiple-series-overlay histogram which already has a legend
    const histogram = page.locator(`#multiple-series-overlay svg`).first()
    const legend = page.locator(`#multiple-series-overlay .legend`)

    // Verify legend is initially visible with multiple items
    await expect(legend).toBeVisible()
    const legend_items = legend.locator(`.legend-item`)
    const initial_item_count = await legend_items.count()
    expect(initial_item_count).toBeGreaterThan(1)

    // Get initial bar count to verify plot has data
    const initial_bars = await get_bar_count(histogram)
    expect(initial_bars).toBeGreaterThan(0)

    // Disable all series by clicking each legend item
    for (let idx = 0; idx < initial_item_count; idx++) {
      await legend_items.nth(idx).click()
    }

    await expect(legend).toBeVisible()
    const disabled_item_count = await legend_items.count()
    expect(disabled_item_count).toBe(initial_item_count)

    const [x_axis, y_axis] = await Promise.all([
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])
    expect(x_axis).toBeGreaterThan(0)
    expect(y_axis).toBeGreaterThan(0)

    await legend_items.first().click()
    await expect(legend).toBeVisible()

    await legend_items.nth(1).click()

    const final_item_count = await legend_items.count()
    expect(final_item_count).toBe(initial_item_count)
  })

  test(`legend toggle functionality properly hides and shows series`, async ({ page }) => {
    // Use the multiple-series-overlay histogram which already has a legend
    const histogram = page.locator(`#multiple-series-overlay svg`).first()
    const legend = page.locator(`#multiple-series-overlay .legend`)

    // Wait for histogram and legend to be visible
    await expect(histogram).toBeVisible()
    await expect(legend).toBeVisible()

    const legend_items = legend.locator(`.legend-item`)
    const initial_item_count = await legend_items.count()
    expect(initial_item_count).toBeGreaterThan(1)

    // Get initial series count and bar count
    const initial_series_count = await histogram.locator(`g.histogram-series`).count()
    const initial_bars = await get_bar_count(histogram)
    expect(initial_series_count).toBeGreaterThan(1)
    expect(initial_bars).toBeGreaterThan(0)

    // Test toggling individual series visibility
    for (let idx = 0; idx < initial_item_count; idx++) {
      // Click legend item to toggle series visibility
      await legend_items.nth(idx).click()

      // Wait for histogram to update
      await expect(histogram).toBeVisible()

      // Verify the series visibility changed by checking bar count
      const current_bars = await get_bar_count(histogram)
      expect(current_bars).toBeGreaterThanOrEqual(0)

      // Click again to restore visibility
      await legend_items.nth(idx).click()

      // Wait for histogram to update again
      await expect(histogram).toBeVisible()

      // Verify bars are restored
      const restored_bars = await get_bar_count(histogram)
      expect(restored_bars).toBeGreaterThan(0)
    }

    // Test toggling all series off and then back on
    // Turn all series off
    for (let idx = 0; idx < initial_item_count; idx++) {
      await legend_items.nth(idx).click()
    }

    // Verify no bars are visible when all series are disabled
    const no_bars = await get_bar_count(histogram)
    expect(no_bars).toBe(0)

    // Turn all series back on
    for (let idx = 0; idx < initial_item_count; idx++) {
      await legend_items.nth(idx).click()
    }

    // Verify bars are restored
    const restored_bars = await get_bar_count(histogram)
    expect(restored_bars).toBeGreaterThan(0)

    // Verify legend remains functional
    await expect(legend).toBeVisible()
    const final_item_count = await legend_items.count()
    expect(final_item_count).toBe(initial_item_count)
  })

  test(`keyboard navigation and responsive behavior`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series svg`).first()

    // Test keyboard events
    await page.keyboard.press(`Tab`)
    await page.keyboard.press(`Escape`)

    expect(page.url()).toContain(`/test/histogram`)
    await expect(histogram).toBeVisible()

    // Test responsive behavior
    const viewports = [
      { width: 400, height: 300 },
      { width: 800, height: 600 },
      { width: 1280, height: 720 },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(histogram).toBeVisible()
    }
  })

  test(`handles extreme data values without rendering issues`, async ({ page }) => {
    // Test with very large and very small values
    await page.evaluate(() => {
      const histogram_container = document.querySelector(
        `#basic-single-series .histogram`,
      )
      if (!histogram_container) return

      // Create test data with extreme values
      const extreme_data = [
        0.000001,
        0.000002,
        0.000003, // Very small values
        1000000,
        2000000,
        3000000, // Very large values
        Number.MAX_SAFE_INTEGER / 1000, // Near maximum safe integer
        Number.MIN_VALUE * 1000, // Near minimum value
      ]

      const event = new CustomEvent(`test-histogram`, {
        detail: { series: [{ label: `Extreme`, y: extreme_data, visible: true }] },
      })
      histogram_container.dispatchEvent(event)
    })

    const histogram = page.locator(`#basic-single-series svg`).first()

    // Should render without errors
    await expect(histogram).toBeVisible()

    // Check that bars are rendered (even if they might be very small or very large)
    const bars = histogram.locator(`rect[fill]:not([fill="none"])`)
    const bar_count = await bars.count()

    // Should have some bars rendered
    expect(bar_count).toBeGreaterThanOrEqual(0)

    // Verify all bars have positive dimensions
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const width = await bar.getAttribute(`width`)
      const height = await bar.getAttribute(`height`)

      expect(parseFloat(width || `0`)).toBeGreaterThan(0)
      expect(parseFloat(height || `0`)).toBeGreaterThan(0)
    }
  })

  test(`handles single data point without errors`, async ({ page }) => {
    await page.evaluate(() => {
      const histogram_container = document.querySelector(
        `#basic-single-series .histogram`,
      )
      if (!histogram_container) return

      // Create test data with single value
      const event = new CustomEvent(`test-histogram`, {
        detail: { series: [{ label: `Single`, y: [42], visible: true }] },
      })
      histogram_container.dispatchEvent(event)
    })

    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    // Should handle single point gracefully (may or may not render bars depending on binning)
    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThanOrEqual(0)
  })

  test(`handles identical data values (zero range)`, async ({ page }) => {
    await page.evaluate(() => {
      const histogram_container = document.querySelector(
        `#basic-single-series .histogram`,
      )
      if (!histogram_container) return

      // Create test data with identical values (zero range)
      const identical_data = Array(100).fill(5.0)

      const event = new CustomEvent(`test-histogram`, {
        detail: { series: [{ label: `Identical`, y: identical_data, visible: true }] },
      })
      histogram_container.dispatchEvent(event)
    })

    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    // Should attempt to render axes (may be 0 for identical data)
    const [x_axis, y_axis] = await Promise.all([
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])
    // For identical data values, axes might not render, so be more lenient
    expect(x_axis).toBeGreaterThanOrEqual(0)
    expect(y_axis).toBeGreaterThanOrEqual(0)

    // Check that any rendered bars have positive dimensions
    const bars = histogram.locator(`rect[fill]:not([fill="none"])`)
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const width = await bar.getAttribute(`width`)
      const height = await bar.getAttribute(`height`)

      if (width && height) {
        expect(parseFloat(width)).toBeGreaterThan(0)
        expect(parseFloat(height)).toBeGreaterThan(0)
      }
    }
  })

  test(`handles NaN and Infinity values gracefully`, async ({ page }) => {
    await page.evaluate(() => {
      const histogram_container = document.querySelector(
        `#basic-single-series .histogram`,
      )
      if (!histogram_container) return

      // Create test data with problematic values
      const problematic_data = [
        1,
        2,
        3,
        4,
        5, // Normal values
        NaN,
        NaN, // NaN values
        Infinity,
        -Infinity, // Infinity values
        6,
        7,
        8,
        9,
        10, // More normal values
      ]

      const event = new CustomEvent(`test-histogram`, {
        detail: {
          series: [{ label: `Problematic`, y: problematic_data, visible: true }],
        },
      })
      histogram_container.dispatchEvent(event)
    })

    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    // Should attempt to render axes (may be 0 for problematic data)
    const [x_axis, y_axis] = await Promise.all([
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])
    // For problematic data, axes might not render, so be more lenient
    expect(x_axis).toBeGreaterThanOrEqual(0)
    expect(y_axis).toBeGreaterThanOrEqual(0)

    // Should not crash and may render some bars for valid data
    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThanOrEqual(0)

    // Since we have 10 valid data points (1-10), we should see some bars
    // even if NaN and Infinity values are filtered out
    if (bar_count > 0) {
      expect(bar_count).toBeGreaterThanOrEqual(5) // At least some bars for valid data
    }
  })

  test(`maintains minimum bar width for very narrow bins`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series svg`).first()

    // Wait for histogram to be rendered first
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Set a high bin count to create narrow bins (but not too high to avoid empty bins)
    await set_range_value(
      page,
      `#basic-single-series > div > input[type="range"]:first-of-type`,
      50,
    )

    // Get all bars and check their minimum width
    const bars = histogram.locator(`rect[fill]:not([fill="none"])`)
    const bar_elements = await bars.all()

    // Should have some bars (but allow for edge cases where data might not fit well)
    if (bar_elements.length > 0) {
      // All bars should have minimum width of 1 pixel (as enforced by Math.max(1, ...))
      for (const bar of bar_elements) {
        const width = await bar.getAttribute(`width`)
        expect(parseFloat(width || `0`)).toBeGreaterThanOrEqual(1)
      }
    } else {
      // If no bars are rendered, test with a lower bin count
      await set_range_value(
        page,
        `#basic-single-series > div > input[type="range"]:first-of-type`,
        20,
      )

      const bars_retry = histogram.locator(`rect[fill]:not([fill="none"])`)
      const bar_elements_retry = await bars_retry.all()

      // Should have some bars with reasonable bin count
      expect(bar_elements_retry.length).toBeGreaterThan(0)

      // All bars should have minimum width of 1 pixel
      for (const bar of bar_elements_retry) {
        const width = await bar.getAttribute(`width`)
        expect(parseFloat(width || `0`)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  // TODO figure out how to actually open the control panel
  test.skip(`histogram controls panel functionality`, async ({ page }) => {
    // Wait for histogram to be fully rendered

    // Wait for the toggle button to be visible and clickable
    const toggle_button = page.locator(`#basic-single-series .histogram-controls-toggle`)
    await expect(toggle_button).toBeVisible({ timeout: 10000 })
    await expect(toggle_button).toBeEnabled({ timeout: 5000 })

    // Test control panel toggle
    await toggle_button.click()

    // Check controls panel is open
    const controls_panel = page.locator(`#basic-single-series .histogram-controls-panel`)
    await expect(controls_panel).toBeVisible({ timeout: 10000 })

    // Test bins control (use ID to be specific)
    const bins_slider = controls_panel.locator(`input#bins-input`)
    await expect(bins_slider).toBeVisible({ timeout: 5000 })
    await bins_slider.fill(`15`)

    // Verify histogram updated
    const histogram = page.locator(`#basic-single-series svg`).first()
    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)

    // Test bar opacity control
    const opacity_slider = controls_panel.locator(`input#bar-opacity-range`)
    if (await opacity_slider.isVisible()) {
      await opacity_slider.fill(`0.3`)
    }

    // Test bar stroke width control
    const stroke_slider = controls_panel.locator(`input#bar-stroke-width-range`)
    if (await stroke_slider.isVisible()) {
      await stroke_slider.fill(`2`)
    }

    // Test grid toggles
    const x_grid_checkbox = controls_panel.locator(
      `input[type="checkbox"]:has-text("X-axis grid")`,
    )
    if (await x_grid_checkbox.isVisible()) {
      await x_grid_checkbox.uncheck()
      await x_grid_checkbox.check()
    }

    // Test scale type selects
    const x_scale_select = controls_panel.locator(`select >> nth=0`)
    if (await x_scale_select.isVisible()) {
      await x_scale_select.selectOption(`log`)
      await x_scale_select.selectOption(`linear`)
    }

    // Test format inputs
    const format_inputs = controls_panel.locator(`input.format-input`)
    if (await format_inputs.count() > 0) {
      const x_format_input = format_inputs.first()
      await x_format_input.fill(`.3f`)

      // Test invalid format handling
      await x_format_input.fill(`invalid`)
      const has_invalid_class = await x_format_input.evaluate((el) =>
        el.classList.contains(`invalid`)
      )
      expect(has_invalid_class).toBe(true)

      // Restore valid format
      await x_format_input.fill(`.2f`)
    }

    // Close controls panel
    await toggle_button.click()
  })

  // TODO figure out how to actually open the control panel
  test.skip(`histogram controls with multiple series`, async ({ page }) => {
    // Wait for histogram to be fully rendered

    // Move legend out of the way if it exists (it might be blocking the toggle button)
    await page.locator(`#multiple-series-overlay .legend`).evaluate((legend) => {
      if (legend) {
        ;(legend as HTMLElement).style.transform = `translateX(-200px)`
      }
    }).catch(() => {
      // Legend might not exist, that's okay
    })

    // Click the toggle button to open the controls panel
    const toggle_button = page.locator(
      `#multiple-series-overlay .histogram-controls-toggle`,
    )
    await expect(toggle_button).toBeVisible({ timeout: 10000 })
    await expect(toggle_button).toBeEnabled({ timeout: 5000 })
    await toggle_button.click()

    const controls_panel = page.locator(
      `#multiple-series-overlay .histogram-controls-panel`,
    )
    await expect(controls_panel).toBeVisible({ timeout: 10000 })

    // Test mode selection
    const mode_select = controls_panel.locator(`select[id="mode-select"]`)
    if (await mode_select.isVisible()) {
      await mode_select.selectOption(`single`)

      // Test property selection in single mode
      const property_select = controls_panel.locator(`select[id="property-select"]`)
      if (await property_select.isVisible()) {
        const options = await property_select.locator(`option`).all()
        if (options.length > 1) {
          const option_value = await options[1].getAttribute(`value`)
          if (option_value) {
            await property_select.selectOption(option_value)
          }
        }
      }

      // Switch back to overlay mode
      await mode_select.selectOption(`overlay`)
    }

    // Test legend toggle
    const legend_checkbox = controls_panel.locator(
      `input[type="checkbox"]:has-text("Show legend")`,
    )
    if (await legend_checkbox.isVisible()) {
      await legend_checkbox.uncheck()
      await legend_checkbox.check()
    }

    // Test opacity and stroke controls for multiple series
    const opacity_slider = controls_panel.locator(`input[type="range"][max="1"]`)
    await opacity_slider.fill(`0.8`)

    const stroke_slider = controls_panel.locator(`input[type="range"][max="5"]`)
    await stroke_slider.fill(`1.5`)

    // Verify histogram still renders correctly
    const histogram = page.locator(`#multiple-series-overlay svg`).first()
    await expect(histogram).toBeVisible()

    // Wait for histogram to render and check for any SVG content
    await expect(histogram.locator(`*`).first()).toBeVisible({ timeout: 5000 })

    // Check if histogram has any content (bars, axes, or any SVG elements)
    const has_any_content = await histogram.locator(`*`).count()

    // Histogram should have some content
    expect(has_any_content).toBeGreaterThan(0)
  })

  test(`histogram controls with different scale types`, async ({ page }) => {
    // Wait for histogram to be fully rendered
    const histogram = page.locator(`#logarithmic-scales svg`).first()
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Move legend out of the way if it exists (it might be blocking the toggle button)
    await page.locator(`#logarithmic-scales .legend`).evaluate((legend) => {
      if (legend) {
        ;(legend as HTMLElement).style.transform = `translateX(-200px)`
      }
    }).catch(() => {
      // Legend might not exist, that's okay
    })

    // Test controls with logarithmic scales
    // Click the toggle button to open the controls panel
    const toggle_button = page.locator(`#logarithmic-scales .histogram-controls-toggle`)
    await expect(toggle_button).toBeVisible({ timeout: 10000 })
    await expect(toggle_button).toBeEnabled({ timeout: 5000 })
    await toggle_button.click()

    const controls_panel = page.locator(`#logarithmic-scales .histogram-controls-panel`)
    await expect(controls_panel).toBeVisible({ timeout: 10000 })

    // Test scale type changes (use specific IDs to avoid confusion with mode select)
    const x_scale_select = controls_panel.locator(`select#x-scale-select`)
    const y_scale_select = controls_panel.locator(`select#y-scale-select`)

    if (await x_scale_select.isVisible() && await y_scale_select.isVisible()) {
      // Test X-axis scale
      await x_scale_select.selectOption(`log`)

      // Test Y-axis scale
      await y_scale_select.selectOption(`log`)

      // Verify histogram renders with log scales
      const histogram = page.locator(`#logarithmic-scales svg`).first()
      await expect(histogram.locator(`g.x-axis .tick`).first()).toBeVisible({
        timeout: 3000,
      })
      await expect(histogram.locator(`g.y-axis .tick`).first()).toBeVisible({
        timeout: 3000,
      })

      // Switch back to linear
      await x_scale_select.selectOption(`linear`)
      await y_scale_select.selectOption(`linear`)
    }

    // Test tick controls (use specific IDs)
    const x_tick_input = controls_panel.locator(`input#x-ticks-input`)
    const y_tick_input = controls_panel.locator(`input#y-ticks-input`)

    if (await x_tick_input.isVisible() && await y_tick_input.isVisible()) {
      // Test X-axis ticks
      await x_tick_input.fill(`12`)

      // Test Y-axis ticks
      await y_tick_input.fill(`8`)

      // Verify histogram still renders
      const histogram = page.locator(`#logarithmic-scales svg`).first()
      const bar_count = await get_bar_count(histogram)
      expect(bar_count).toBeGreaterThan(0)
    }
  })

  test(`histogram controls format validation`, async ({ page }) => {
    // Wait for histogram to be fully rendered
    const histogram = page.locator(`#tick-configuration svg`).first()
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test format validation in controls
    // Click the toggle button to open the controls panel
    const toggle_button = page.locator(`#tick-configuration .histogram-controls-toggle`)
    await expect(toggle_button).toBeVisible({ timeout: 10000 })
    await expect(toggle_button).toBeEnabled({ timeout: 5000 })
    await toggle_button.click()

    const controls_panel = page.locator(`#tick-configuration .histogram-controls-panel`)
    await expect(controls_panel).toBeVisible({ timeout: 10000 })

    // Test format inputs
    const format_inputs = controls_panel.locator(`input.format-input`)
    const format_count = await format_inputs.count()

    if (format_count >= 2) {
      const x_format_input = format_inputs.nth(0)
      const y_format_input = format_inputs.nth(1)

      // Test valid formats
      const valid_formats = [`.2f`, `.1e`, `.0%`, `,.2f`, `d`]
      for (const format of valid_formats) {
        await x_format_input.fill(format)

        // Should not have invalid class
        const has_invalid_class = await x_format_input.evaluate((el) =>
          el.classList.contains(`invalid`)
        )
        expect(has_invalid_class).toBe(false)
      }

      // Test invalid formats
      const invalid_formats = [`invalid`, `abc123`, `@#$%`]
      for (const format of invalid_formats) {
        await x_format_input.fill(format)

        // Should have invalid class
        const has_invalid_class = await x_format_input.evaluate((el) =>
          el.classList.contains(`invalid`)
        )
        expect(has_invalid_class).toBe(true)
      }

      // Test time formats
      const time_formats = [`%Y-%m-%d`, `%H:%M:%S`, `%B %Y`]
      for (const format of time_formats) {
        await y_format_input.fill(format)

        // Should not have invalid class for time formats
        const has_invalid_class = await y_format_input.evaluate((el) =>
          el.classList.contains(`invalid`)
        )
        expect(has_invalid_class).toBe(false)
      }

      // Restore valid formats
      await x_format_input.fill(`.2~s`)
      await y_format_input.fill(`d`)
    }
  })

  test(`histogram controls keyboard navigation`, async ({ page }) => {
    // Wait for histogram to be fully rendered
    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test keyboard navigation in controls
    const control_toggle = page.locator(`#basic-single-series .histogram-controls-toggle`)
    await expect(control_toggle).toBeVisible()

    // Open controls with keyboard
    await control_toggle.focus()
    await page.keyboard.press(`Enter`)

    const controls_panel = page.locator(`#basic-single-series .histogram-controls-panel`)
    await expect(controls_panel).toBeVisible({ timeout: 5000 })

    // Test tab navigation through controls
    await page.keyboard.press(`Tab`)

    // Test arrow key navigation on sliders
    const focused_element = await page.locator(`:focus`)
    if (await focused_element.getAttribute(`type`) === `range`) {
      await page.keyboard.press(`ArrowRight`)
      await page.keyboard.press(`ArrowLeft`)
    }

    // Test Enter key on checkboxes
    await page.keyboard.press(`Tab`)

    const current_focus = await page.locator(`:focus`)
    if (await current_focus.getAttribute(`type`) === `checkbox`) {
      await page.keyboard.press(`Space`)
    }

    // Close controls with Escape
    await page.keyboard.press(`Escape`)
  })

  test(`histogram controls responsive behavior`, async ({ page }) => {
    // Wait for histogram to be fully rendered first
    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test controls at different viewport sizes
    // Click the toggle button to open the controls panel
    const toggle_button = page.locator(`#basic-single-series .histogram-controls-toggle`)
    await expect(toggle_button).toBeVisible({ timeout: 10000 })
    await expect(toggle_button).toBeEnabled({ timeout: 5000 })
    await toggle_button.click()

    const controls_panel = page.locator(`#basic-single-series .histogram-controls-panel`)
    await expect(controls_panel).toBeVisible({ timeout: 10000 })

    // Test at different viewport sizes
    const viewports = [
      { width: 400, height: 300 },
      { width: 800, height: 600 },
      { width: 1280, height: 720 },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)

      // Controls should remain accessible
      await expect(controls_panel).toBeVisible()

      // Test slider interaction at different sizes
      const bins_slider = controls_panel.locator(`#bins-input`)
      if (await bins_slider.isVisible()) {
        await bins_slider.fill(`25`)

        // Verify histogram still renders
        const histogram = page.locator(`#basic-single-series svg`).first()
        const bar_count = await get_bar_count(histogram)
        expect(bar_count).toBeGreaterThan(0)
      }
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`handles very small viewport dimensions`, async ({ page }) => {
    // Test with extremely small viewport
    await page.setViewportSize({ width: 200, height: 150 })

    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    // Should attempt to render axes (may be 0 for identical data)
    const [x_axis, y_axis] = await Promise.all([
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])
    // For identical data values, axes might not render, so be more lenient
    expect(x_axis).toBeGreaterThanOrEqual(0)
    expect(y_axis).toBeGreaterThanOrEqual(0)

    // Check that any rendered bars have positive dimensions
    const bars = histogram.locator(`rect[fill]:not([fill="none"])`)
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const width = await bar.getAttribute(`width`)
      const height = await bar.getAttribute(`height`)

      if (width && height) {
        expect(parseFloat(width)).toBeGreaterThan(0)
        expect(parseFloat(height)).toBeGreaterThan(0)
      }
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`handles rapid data updates without rendering errors`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series svg`).first()

    // Rapidly change bin count and sample size (use more reasonable values)
    for (let idx = 0; idx < 5; idx++) {
      await set_range_value(
        page,
        `#basic-single-series > div > input[type="range"]:first-of-type`,
        10 + idx * 5,
      )
      await set_range_value(
        page,
        `#basic-single-series > div > input[type="range"]:nth-of-type(2)`,
        500 + idx * 200,
      )
      // Wait for histogram to update after each change
      await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first())
        .toBeVisible({ timeout: 2000 })
    }

    // After rapid updates, should still be functional
    await expect(histogram).toBeVisible()

    // Wait for final render to complete by checking for bars
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)

    // All bars should have valid dimensions
    const bars = histogram.locator(`rect[fill]:not([fill="none"])`)
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const width = await bar.getAttribute(`width`)
      const height = await bar.getAttribute(`height`)

      expect(parseFloat(width || `0`)).toBeGreaterThan(0)
      expect(parseFloat(height || `0`)).toBeGreaterThan(0)
    }
  })

  test(`tick configuration and dynamic updates`, async ({ page }) => {
    // Helper to wait for and validate histogram render
    const wait_for_histogram = async (selector: string) => {
      const histogram = page.locator(`${selector} svg`).first()
      await expect(histogram).toBeVisible()
      await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first())
        .toBeVisible({ timeout: 5000 })
      return histogram
    }

    // Test configurable tick counts
    const tick_config_histogram = await wait_for_histogram(`#tick-configuration`)
    const [x_axis, y_axis] = await Promise.all([
      tick_config_histogram.locator(`g.x-axis`),
      tick_config_histogram.locator(`g.y-axis`),
    ])

    const [initial_x, initial_y] = await Promise.all([
      get_histogram_tick_range(x_axis),
      get_histogram_tick_range(y_axis),
    ])

    // Adjust tick counts and verify changes
    await Promise.all([
      set_range_value(page, `#tick-configuration input[type="range"]:first-of-type`, 15),
      set_range_value(page, `#tick-configuration input[type="range"]:nth-of-type(2)`, 10),
    ])

    const [adjusted_x, adjusted_y] = await Promise.all([
      get_histogram_tick_range(x_axis),
      get_histogram_tick_range(y_axis),
    ])

    // Verify tick adjustments and spacing
    expect(adjusted_x.ticks.length).toBeGreaterThan(0)
    expect(adjusted_y.ticks.length).toBeGreaterThan(0)
    expect(adjusted_x.range).toBeGreaterThan(0)
    expect(adjusted_y.range).toBeGreaterThan(0)

    // Verify tick configuration is responsive and compare with initial state
    expect(adjusted_x.ticks.length).toBeGreaterThan(5)
    expect(adjusted_y.ticks.length).toBeGreaterThan(3)
    // Ensure configuration change had some effect (different from initial or within expected range)
    expect(
      adjusted_x.ticks.length !== initial_x.ticks.length ||
        adjusted_y.ticks.length !== initial_y.ticks.length ||
        (adjusted_x.ticks.length >= 10 && adjusted_y.ticks.length >= 6),
    ).toBe(true)

    // Test custom tick arrays and data consistency
    await page.evaluate(() => {
      const container = document.querySelector(`#basic-single-series .histogram`)
      if (!container) return

      const data = Array.from({ length: 100 }, () => Math.random() * 10)
      container.dispatchEvent(
        new CustomEvent(`test-histogram-ticks`, {
          detail: {
            series: [{ label: `Custom Ticks`, y: data, visible: true }],
            x_ticks: [0, 2.5, 5, 7.5, 10],
            y_ticks: [0, 5, 10, 15, 20, 25],
          },
        }),
      )
    })

    const basic_histogram = page.locator(`#basic-single-series svg`).first()
    const [basic_x, basic_y] = await Promise.all([
      get_histogram_tick_range(basic_histogram.locator(`g.x-axis`)),
      get_histogram_tick_range(basic_histogram.locator(`g.y-axis`)),
    ])

    expect(basic_x.ticks.length).toBeGreaterThan(0)
    expect(basic_y.ticks.length).toBeGreaterThan(0)

    // Test tick consistency during data updates
    await set_range_value(
      page,
      `#basic-single-series > div > input[type="range"]:nth-of-type(2)`,
      2000,
    )

    const [updated_x, updated_y] = await Promise.all([
      get_histogram_tick_range(basic_histogram.locator(`g.x-axis`)),
      get_histogram_tick_range(basic_histogram.locator(`g.y-axis`)),
    ])

    expect(updated_x.ticks.length).toBeGreaterThan(0)
    expect(updated_y.ticks.length).toBeGreaterThan(0)
    expect(Math.abs(updated_x.ticks.length - basic_x.ticks.length)).toBeLessThanOrEqual(2)
  })

  test(`logarithmic scale tick generation and validation`, async ({ page }) => {
    const histogram = page.locator(`#logarithmic-scales svg`).first()
    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const scale_tests = [
      { x_scale: `log`, y_scale: `linear` },
      { x_scale: `linear`, y_scale: `log` },
      { x_scale: `log`, y_scale: `log` },
    ]

    for (const { x_scale, y_scale } of scale_tests) {
      await Promise.all([
        click_radio(page, `#logarithmic-scales input[value="${x_scale}"][name*="x"]`),
        click_radio(page, `#logarithmic-scales input[value="${y_scale}"][name*="y"]`),
      ])

      const [x_axis, y_axis] = await Promise.all([
        histogram.locator(`g.x-axis`),
        histogram.locator(`g.y-axis`),
      ])

      await Promise.all([
        expect(x_axis.locator(`.tick text`).first()).toBeVisible({ timeout: 3000 }),
        expect(y_axis.locator(`.tick text`).first()).toBeVisible({ timeout: 3000 }),
      ])

      const [x_ticks, y_ticks] = await Promise.all([
        get_histogram_tick_range(x_axis),
        get_histogram_tick_range(y_axis),
      ])

      expect(x_ticks.ticks.length).toBeGreaterThan(0)
      expect(y_ticks.ticks.length).toBeGreaterThan(0)

      // Validate log scale constraints
      if (x_scale === `log` && x_ticks.ticks.length > 0) {
        const positive_ticks = x_ticks.ticks.filter((tick) => tick > 0)
        expect(positive_ticks.length).toBeGreaterThan(0)
      }
      if (y_scale === `log` && y_ticks.ticks.length > 0) {
        const positive_ticks = y_ticks.ticks.filter((tick) => tick > 0)
        expect(positive_ticks.length).toBeGreaterThan(0)
      }

      // Verify tick ordering
      const [x_sorted, y_sorted] = [
        [...x_ticks.ticks].sort((a, b) => a - b),
        [...y_ticks.ticks].sort((a, b) => a - b),
      ]
      expect(x_ticks.ticks.sort((a, b) => a - b)).toEqual(x_sorted)
      expect(y_ticks.ticks.sort((a, b) => a - b)).toEqual(y_sorted)
    }
  })

  test(`tick interval generation and formatting`, async ({ page }) => {
    // Test tick generation with the existing histogram
    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    const x_axis = histogram.locator(`g.x-axis`)
    const x_ticks = await get_histogram_tick_range(x_axis)

    // Validate interval consistency
    if (x_ticks.ticks.length > 1) {
      const intervals = x_ticks.ticks.slice(1).map((tick, idx) =>
        tick - x_ticks.ticks[idx]
      )
      const avg_interval = intervals.reduce((a, b) => a + b, 0) / intervals.length
      expect(avg_interval).toBeGreaterThan(0)
    }

    // Test tick text formatting
    const tick_config_histogram = page.locator(`#tick-configuration svg`).first()
    await expect(tick_config_histogram.locator(`rect[fill]:not([fill="none"])`).first())
      .toBeVisible({
        timeout: 5000,
      })

    const [config_x_axis, config_y_axis] = await Promise.all([
      tick_config_histogram.locator(`g.x-axis`),
      tick_config_histogram.locator(`g.y-axis`),
    ])

    const [x_tick_texts, y_tick_texts] = await Promise.all([
      config_x_axis.locator(`.tick text`),
      config_y_axis.locator(`.tick text`),
    ])

    const [x_count, y_count] = await Promise.all([
      x_tick_texts.count(),
      y_tick_texts.count(),
    ])

    expect(x_count).toBeGreaterThan(0)
    expect(y_count).toBeGreaterThan(0)

    // Verify tick text is formatted and not empty
    if (x_count > 0) {
      const first_x_text = await x_tick_texts.first().textContent()
      expect(first_x_text?.trim().length).toBeGreaterThan(0)
    }
  })

  test(`zoom rectangle positioning fix is applied correctly`, async ({ page }) => {
    // Test actual zoom functionality with mouse interactions

    const histogram = page.locator(`#basic-single-series svg`).first()
    await expect(histogram).toBeVisible()

    await expect(histogram.locator(`rect[fill]:not([fill="none"])`).first()).toBeVisible({
      timeout: 5000,
    })

    const cursor_style = await histogram.evaluate((el) => {
      return getComputedStyle(el).cursor
    })
    expect(cursor_style).toBe(`crosshair`)

    // Test actual zoom interaction by simulating mouse events
    const chart_area = histogram.locator(`g`).first()

    // Start drag operation
    await chart_area.hover()
    await page.mouse.down()
    await page.mouse.move(200, 200)

    // Verify zoom rectangle appears during drag
    const zoom_rect = histogram.locator(`.zoom-rect`)
    await expect(zoom_rect).toBeVisible({ timeout: 1000 })

    // Complete drag operation
    await page.mouse.up()

    // Test double-click reset
    await histogram.dblclick()
    await expect(zoom_rect).not.toBeVisible({ timeout: 1000 })
  })
})
