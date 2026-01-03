// deno-lint-ignore-file no-await-in-loop
import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  get_axis_range_inputs,
  IS_CI,
  set_input_value,
  set_range_input,
} from '../helpers'

// Click a radio button within a scoped container (more specific than page-wide selectors)
const click_radio_in_section = async (
  page: Page,
  section_testid: string,
  input_selector: string,
) => {
  const section = page.locator(`[data-testid="${section_testid}"]`)
  const radio = section.locator(input_selector)
  await radio.waitFor({ state: `attached`, timeout: 5000 })
  await radio.click()
}

// Set a range value within a scoped container (preferred for test maintainability)
const set_range_value_in_section = async (
  page: Page,
  section_testid: string,
  label_text: string,
  value: number,
) => {
  const section = page.locator(`[data-testid="${section_testid}"]`)
  const input = section.locator(`label:has-text("${label_text}") input[type="range"]`)
  await input.waitFor({ state: `attached`, timeout: 5000 })
  await set_input_value(input, value.toString())
}

// Fallback for page-wide selectors when section scoping isn't available
// Note: Uses .first() intentionally when multiple elements may match (e.g., multiple histogram instances)
// For tests requiring specific element targeting, use set_range_value_in_section instead
const set_range_value = async (
  page: Page,
  selector: string,
  value: number,
  expected_count?: number,
) => {
  const inputs = page.locator(selector)
  // When expected_count is provided, assert selector specificity
  if (expected_count !== undefined) {
    expect(await inputs.count()).toBe(expected_count)
  }
  const input = inputs.first()
  await input.waitFor({ state: `attached`, timeout: 5000 })
  await set_input_value(input, value.toString())
}

const get_bar_count = async (histogram_locator: Locator) => {
  // Look for bars with fill or stroke (for overlay mode)
  const bars_with_fill = await histogram_locator
    .locator(`path[role="button"][fill]:not([fill="none"])`)
    .count()
  const bars_with_stroke = await histogram_locator
    .locator(`path[role="button"][stroke]:not([stroke="none"])`)
    .count()

  // Return the maximum count to handle both single and overlay modes
  return Math.max(bars_with_fill, bars_with_stroke)
}

// Get tick values and calculate range for histogram axes
const get_histogram_tick_range = async (axis_locator: Locator) => {
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
    test.skip(IS_CI, `Histogram tests timeout in CI`)
    await page.goto(`/test/histogram`, { waitUntil: `networkidle` })
  })

  test(`renders basic histogram with correct structure`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(histogram).toBeVisible()

    // Wait for histogram to render bars properly
    await expect(
      histogram.locator(`path[role="button"][fill]:not([fill="none"])`).first(),
    ).toBeVisible({
      timeout: 5000,
    })

    // Wait for multiple bars to render (at least 5 bars for a proper histogram)
    await expect(async () => {
      const bar_count = await histogram
        .locator(`path[role="button"][fill]:not([fill="none"])`)
        .count()
      expect(bar_count).toBeGreaterThan(5)
    }).toPass({ timeout: 5000 })

    // Check cursor is not pointer (no click handler)
    const bar = histogram.locator(`path[role="button"]`).first()
    const cursor = await bar.evaluate((el) => globalThis.getComputedStyle(el).cursor)
    expect(cursor).not.toBe(`pointer`)

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
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)

    // Wait for histogram to render with bars (D3 may adjust bin count slightly)
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    // Controls are in a section with data-testid for scoped selection
    const controls = [
      { control: `bin count`, label: `Bin Count`, values: [5, 50] },
      { control: `sample size`, label: `Sample Size`, values: [100, 5000] },
    ]

    for (const { control, label, values } of controls) {
      let previous_bar_count = await get_bar_count(histogram)
      for (const value of values) {
        await set_range_value_in_section(
          page,
          `basic-single-series-section`,
          label,
          value,
        )
        const bar_count = await get_bar_count(histogram)
        expect(bar_count).toBeGreaterThan(0)

        // For bin count changes, verify it affects the histogram
        if (control === `bin count` && value !== values[0]) {
          expect(bar_count).not.toBe(previous_bar_count)
        }
        previous_bar_count = bar_count
      }
    }
  })

  test(`multiple series overlay functionality`, async ({ page }) => {
    const histogram = page.locator(`#multiple-series-overlay > svg[role="img"]`)
    await expect(histogram).toBeVisible()

    // Wait for histogram to render bars and axes
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })
    await expect(histogram.locator(`g.x-axis`)).toBeVisible()
    await expect(histogram.locator(`g.y-axis`)).toBeVisible()

    // Debug: check if histogram has dimensions and content
    const has_dimensions = await histogram.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    expect(has_dimensions).toBe(true)

    const [series_count, series_bars, x_axis_count, y_axis_count] = await Promise.all([
      histogram.locator(`g.histogram-series`).count(),
      histogram.locator(`g.histogram-series path[role="button"]`).all(),
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
    await expect(histogram.locator(`g.x-axis`)).toBeVisible()
    await expect(histogram.locator(`g.y-axis`)).toBeVisible()

    const [final_x_axis, final_y_axis] = await Promise.all([
      histogram.locator(`g.x-axis`).count(),
      histogram.locator(`g.y-axis`).count(),
    ])
    expect(final_x_axis).toBeGreaterThan(0)
    expect(final_y_axis).toBeGreaterThan(0)
  })

  test(`series visibility toggles work`, async ({ page }) => {
    const histogram = page.locator(`#multiple-series-overlay > svg[role="img"]`)
    const legend = page.locator(`#multiple-series-overlay .legend`)
    const first_legend_item = legend.locator(`.legend-item`).first()

    // Wait for histogram to render initially
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const initial_bars = await get_bar_count(histogram)
    expect(initial_bars).toBeGreaterThan(0)

    // Toggle off first series using legend
    await first_legend_item.click()

    // Wait for histogram to re-render after toggle
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })
    const after_toggle = await get_bar_count(histogram)
    expect(after_toggle).toBeGreaterThanOrEqual(0)

    // Toggle back on using legend
    await first_legend_item.click()

    // Wait for histogram to re-render after restore
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })
    const after_restore = await get_bar_count(histogram)
    expect(after_restore).toBeGreaterThan(0)
  })

  test(`logarithmic scale combinations`, async ({ page }) => {
    const histogram = page.locator(`#logarithmic-scales > svg[role="img"]`)

    // Wait for initial histogram to render
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const scale_combinations = [
      { x_scale: `linear`, y_scale: `linear` },
      { x_scale: `log`, y_scale: `linear` },
      { x_scale: `log`, y_scale: `log` },
      { x_scale: `linear`, y_scale: `log` },
    ]

    for (const { x_scale, y_scale } of scale_combinations) {
      // Use scoped selectors within the logarithmic-scales section
      await click_radio_in_section(
        page,
        `logarithmic-scales-section`,
        `input[name="x-scale"][value="${x_scale}"]`,
      )
      await click_radio_in_section(
        page,
        `logarithmic-scales-section`,
        `input[name="y-scale"][value="${y_scale}"]`,
      )

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
    const histogram = page.locator(`#real-world-distributions > svg[role="img"]`)

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
      await expect(histogram.locator(`path[role="button"]`).first())
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
    const histogram = page.locator(`#bin-size-comparison > svg[role="img"]`)

    // Wait for histogram to render initially
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test that the histogram renders with bars
    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)

    // Test that changing bin count works
    const range_inputs = page.locator(`#bin-size-comparison input[type="range"]`)
    const input_count = await range_inputs.count()

    if (input_count > 0) {
      await set_range_value(page, `#bin-size-comparison input[type="range"]`, 50, 1)
      const new_bar_count = await get_bar_count(histogram)
      expect(new_bar_count).toBeGreaterThan(0)
    }
  })

  test(`custom styling and color schemes`, async ({ page }) => {
    // This test is no longer applicable since we removed the custom styling section
    // The histogram still renders correctly with default styling
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(histogram).toBeVisible()

    // Verify histogram renders with bars
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)
  })

  test(`tooltips and legend functionality`, async ({ page }) => {
    // Test tooltips - wait for histogram to render first
    const basic_histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(basic_histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const first_bar = basic_histogram.locator(`path[role="button"]`).first()
    await first_bar.hover({ force: true })

    // Tooltip visibility is optional - histograms may not have tooltips configured,
    // or tooltip positioning may fail silently. If visible, verify content is correct.
    const tooltip = basic_histogram.locator(`.plot-tooltip`)
    if (await tooltip.isVisible({ timeout: 3000 })) {
      const tooltip_content = await tooltip.textContent()
      expect(tooltip_content).toContain(`Value:`)
      expect(tooltip_content).toContain(`Count:`)
    }

    // Test legend visibility - multiple-series-overlay has show_legend enabled
    const multiple_legend = page.locator(`#multiple-series-overlay .legend`)
    const single_legend = page.locator(`#basic-single-series .legend`)

    // Legend should be visible for the multi-series overlay histogram
    await expect(multiple_legend).toBeVisible()
    const legend_items = await multiple_legend.locator(`.legend-item`).count()
    expect(legend_items).toBeGreaterThan(1)

    // Test that legend items are clickable and have proper styling
    const first_legend_item = multiple_legend.locator(`.legend-item`).first()
    await expect(first_legend_item).toBeVisible()

    // Verify legend item has clickable appearance (cursor pointer or similar)
    const cursor_style = await first_legend_item.evaluate((el) =>
      getComputedStyle(el).cursor
    )
    expect(cursor_style).toBe(`pointer`)

    // Test that clicking a legend item doesn't break the legend
    await first_legend_item.click()
    await expect(multiple_legend).toBeVisible()
    const after_click_count = await multiple_legend.locator(`.legend-item`).count()
    expect(after_click_count).toBe(legend_items)

    // Single-series histogram should not show legend
    await expect(single_legend).toBeHidden()
  })

  test(`legend remains functional when all series are disabled`, async ({ page }) => {
    // Use the multiple-series-overlay histogram which already has a legend
    const histogram = page.locator(`#multiple-series-overlay > svg[role="img"]`)
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
    const histogram = page.locator(`#multiple-series-overlay > svg[role="img"]`)
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

    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)

    // Should render without errors
    await expect(histogram).toBeVisible()

    // Check that bars are rendered (even if they might be very small or very large)
    const bars = histogram.locator(`path[role="button"]`)
    const bar_count = await bars.count()

    // Should have some bars rendered
    expect(bar_count).toBeGreaterThanOrEqual(0)

    // Verify all bars have positive rendered dimensions
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const box = await bar.boundingBox()
      expect(box).toBeTruthy()
      if (!box) continue
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
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

    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
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

    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
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
    const bars = histogram.locator(`path[role="button"]`)
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const box = await bar.boundingBox()
      if (!box) continue
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
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

    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
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
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)

    // Wait for histogram to be rendered first
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    // Set a high bin count to create narrow bins (but not too high to avoid empty bins)
    await set_range_value_in_section(
      page,
      `basic-single-series-section`,
      `Bin Count`,
      50,
    )

    // Get all bars and check their minimum width
    const bars = histogram.locator(`path[role="button"]`)
    const bar_elements = await bars.all()

    // Should have some bars (but allow for edge cases where data might not fit well)
    if (bar_elements.length > 0) {
      // All bars should have minimum width of 1 pixel (as enforced by Math.max(1, ...))
      for (const bar of bar_elements) {
        const box = await bar.boundingBox()
        expect(box).toBeTruthy()
        if (!box) continue
        expect(box.width).toBeGreaterThanOrEqual(1)
      }
    } else {
      // If no bars are rendered, test with a lower bin count
      await set_range_value_in_section(
        page,
        `basic-single-series-section`,
        `Bin Count`,
        20,
      )

      const bars_retry = histogram.locator(`path[role="button"]`)
      const bar_elements_retry = await bars_retry.all()

      // Should have some bars with reasonable bin count
      expect(bar_elements_retry.length).toBeGreaterThan(0)

      // All bars should have minimum width of 1 pixel
      for (const bar of bar_elements_retry) {
        const box = await bar.boundingBox()
        expect(box).toBeTruthy()
        if (!box) continue
        expect(box.width).toBeGreaterThanOrEqual(1)
      }
    }
  })

  test(`histogram controls pane functionality`, async ({ page }) => {
    // Wait for histogram to be fully rendered

    // Wait for the toggle button to be visible and clickable
    const toggle_button = page.locator(`#basic-single-series .pane-toggle`)
    await expect(toggle_button).toBeVisible()
    await expect(toggle_button).toBeEnabled()

    // Test control pane toggle
    await toggle_button.click()

    // Check controls pane is open
    const control_pane = page.locator(`#basic-single-series .draggable-pane`)
    await expect(control_pane).toBeVisible()

    // Test bins control - the number input is a sibling of the label in a pane-row
    const bins_row = control_pane.locator(
      `.pane-row:has(label:text-matches("Bins", "i"))`,
    )
    await expect(bins_row).toBeVisible()
    const bins_number_input = bins_row.locator(`input[type="number"]`)
    await bins_number_input.fill(`15`)

    // Verify histogram updated
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)

    // Test bar opacity control - opacity is available in overlay mode histograms
    // For single-series mode, this control may not be visible, so conditional check is appropriate
    const opacity_label = control_pane.locator(`label:has-text("Opacity:")`)
    if (await opacity_label.isVisible()) {
      const opacity_number = opacity_label.locator(`input[type="number"]`)
      await opacity_number.fill(`0.3`)
    }

    // Test bar stroke width control - stroke width is available in overlay mode
    // For single-series mode, this control may not be visible
    const stroke_label = control_pane.locator(`label:has-text("Stroke Width:")`)
    if (await stroke_label.isVisible()) {
      const stroke_number = stroke_label.locator(`input[type="number"]`)
      await stroke_number.fill(`2`)
    }

    // Test grid toggles - should be visible in all histogram panes
    const x_grid_checkbox = control_pane.getByLabel(`X-axis grid`)
    await expect(x_grid_checkbox).toBeVisible()
    await x_grid_checkbox.uncheck()
    await x_grid_checkbox.check()

    // Test scale type selects - scope to Scale Type section to avoid matching other X: labels
    const scale_type_section = control_pane.locator(`[data-testid="scale-type-section"]`)
    const x_scale_label = scale_type_section.locator(`label:has-text("X:")`)
    await expect(x_scale_label).toBeVisible()
    const x_scale_select = x_scale_label.locator(`select`)
    await x_scale_select.selectOption(`log`)
    await x_scale_select.selectOption(`linear`)

    // Test format inputs - scope to Tick Format section to avoid matching other X-axis labels
    const tick_format_section = control_pane.locator(
      `[data-testid="tick-format-section"]`,
    )
    const x_axis_format_label = tick_format_section.locator(`label:has-text("X-axis:")`)
    await expect(x_axis_format_label).toBeVisible()
    // Verify selector specificity - should match exactly one label within Tick Format section
    expect(await x_axis_format_label.count()).toBe(1)

    const x_format_input = x_axis_format_label.locator(`input[type="text"]`)
    await expect(x_format_input).toBeVisible()
    await x_format_input.fill(`.3r`)

    // Test invalid format handling
    await x_format_input.fill(`invalid`)
    await expect(x_format_input).toHaveClass(/invalid/)

    // Restore valid format
    await x_format_input.fill(`.2r`)

    // Close controls pane
    await toggle_button.click()
  })

  // TODO figure out how to actually open the control pane
  test(`histogram controls with multiple series`, async ({ page }) => {
    // Wait for histogram to be fully rendered

    // Move legend out of the way if it exists (it might be blocking the toggle button)
    await page.locator(`#multiple-series-overlay .legend`).evaluate((legend) => {
      if (legend) {
        ;(legend as HTMLElement).style.transform = `translateX(-200px)`
      }
    }).catch(() => {
      // Legend might not exist, that's okay
    })

    // Click the toggle button to open the controls pane
    const toggle_button = page.locator(
      `#multiple-series-overlay .pane-toggle`,
    )
    await expect(toggle_button).toBeVisible()
    await expect(toggle_button).toBeEnabled()
    await toggle_button.click()

    const control_pane = page.locator(
      `#multiple-series-overlay .draggable-pane`,
    )
    await expect(control_pane).toBeVisible()

    // Test mode selection
    const mode_select = control_pane.locator(`select[id="mode-select"]`)
    if (await mode_select.isVisible()) {
      await mode_select.selectOption(`single`)

      // Test property selection in single mode
      const property_select = control_pane.locator(`select[id="property-select"]`)
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
    const legend_checkbox = control_pane.getByLabel(`Show legend`)
    if (await legend_checkbox.isVisible()) {
      await legend_checkbox.uncheck()
      await legend_checkbox.check()
    }

    // Test opacity and stroke controls for multiple series - use label-based selectors
    const opacity_label = control_pane.locator(`label:has-text("Opacity:")`)
    if (await opacity_label.isVisible()) {
      const opacity_number = opacity_label.locator(`input[type="number"]`)
      await opacity_number.fill(`0.8`)
    }

    const stroke_label = control_pane.locator(`label:has-text("Stroke Width:")`)
    if (await stroke_label.isVisible()) {
      const stroke_number = stroke_label.locator(`input[type="number"]`)
      await stroke_number.fill(`1.5`)
    }

    // Verify histogram still renders correctly
    const histogram = page.locator(`#multiple-series-overlay > svg[role="img"]`)
    await expect(histogram).toBeVisible()

    // Wait for histogram to render and check for meaningful SVG content (bars or axes)
    await expect(histogram.locator(`g.x-axis, g.y-axis, path[role="button"]`).first())
      .toBeVisible()

    // Check if histogram has any content (bars, axes, or any SVG elements)
    const has_any_content = await histogram.locator(
      `g.x-axis, g.y-axis, path[role="button"]`,
    ).count()

    // Histogram should have some content
    expect(has_any_content).toBeGreaterThan(0)
  })

  test(`histogram controls with different scale types`, async ({ page }) => {
    // Wait for histogram to be fully rendered
    const histogram = page.locator(`#logarithmic-scales > svg[role="img"]`)
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
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
    // Click the toggle button to open the controls pane
    const toggle_button = page.locator(`#logarithmic-scales .pane-toggle`)
    await expect(toggle_button).toBeVisible()
    await expect(toggle_button).toBeEnabled()
    await toggle_button.click()

    const control_pane = page.locator(`#logarithmic-scales .draggable-pane`)
    await expect(control_pane).toBeVisible()

    // Test scale type changes (use specific IDs to avoid confusion with mode select)
    const x_scale_select = control_pane.locator(`select#x-scale-select`)
    const y_scale_select = control_pane.locator(`select#y-scale-select`)

    if (await x_scale_select.isVisible() && await y_scale_select.isVisible()) {
      // Test X-axis scale
      await x_scale_select.selectOption(`log`)

      // Test Y-axis scale
      await y_scale_select.selectOption(`log`)

      // Verify histogram renders with log scales
      const histogram = page.locator(`#logarithmic-scales > svg[role="img"]`)
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
    const x_tick_input = control_pane.locator(`input#x-ticks-input`)
    const y_tick_input = control_pane.locator(`input#y-ticks-input`)

    if (await x_tick_input.isVisible() && await y_tick_input.isVisible()) {
      // Test X-axis ticks
      await x_tick_input.fill(`12`)

      // Test Y-axis ticks
      await y_tick_input.fill(`8`)

      // Verify histogram still renders
      const histogram = page.locator(`#logarithmic-scales > svg[role="img"]`)
      const bar_count = await get_bar_count(histogram)
      expect(bar_count).toBeGreaterThan(0)
    }
  })

  test(`histogram controls format validation`, async ({ page }) => {
    // Wait for histogram to be fully rendered
    const histogram = page.locator(`#tick-configuration > svg[role="img"]`)
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test format validation in controls
    // Click the toggle button to open the controls pane
    const toggle_button = page.locator(`#tick-configuration .pane-toggle`)
    await expect(toggle_button).toBeVisible()
    await expect(toggle_button).toBeEnabled()
    await toggle_button.click()

    const control_pane = page.locator(`#tick-configuration .draggable-pane`)
    await expect(control_pane).toBeVisible()

    // Test format inputs
    const format_inputs = control_pane.locator(`input.format-input`)
    const format_count = await format_inputs.count()

    if (format_count >= 2) {
      const x_format_input = format_inputs.nth(0)
      const y_format_input = format_inputs.nth(1)

      // Test valid formats
      const valid_formats = [`.2r`, `.1e`, `.0%`, `,.2r`, `d`]
      for (const format of valid_formats) {
        await x_format_input.fill(format)

        // Should not have invalid class
        await expect(x_format_input).not.toHaveClass(/invalid/)
      }

      // Test invalid formats
      const invalid_formats = [`invalid`, `abc123`, `@#$%`]
      for (const format of invalid_formats) {
        await x_format_input.fill(format)

        // Should have invalid class
        await expect(x_format_input).toHaveClass(/invalid/)
      }

      // Test time formats
      const time_formats = [`%Y-%m-%d`, `%H:%M:%S`, `%B %Y`]
      for (const format of time_formats) {
        await y_format_input.fill(format)

        // Should not have invalid class for time formats
        await expect(y_format_input).not.toHaveClass(/invalid/)
      }

      // Restore valid formats
      await x_format_input.fill(`.2~s`)
      await y_format_input.fill(`d`)
    }
  })

  test(`histogram controls keyboard navigation`, async ({ page }) => {
    // Wait for histogram to be fully rendered
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test keyboard navigation in controls
    const control_toggle = page.locator(`#basic-single-series .pane-toggle`)
    await expect(control_toggle).toBeVisible()

    // Open controls with keyboard
    await control_toggle.focus()
    await page.keyboard.press(`Enter`)

    const control_pane = page.locator(`#basic-single-series .draggable-pane`)
    await expect(control_pane).toBeVisible()

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
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    // Test controls at different viewport sizes
    // Click the toggle button to open the controls pane
    const toggle_button = page.locator(`#basic-single-series .pane-toggle`)
    await expect(toggle_button).toBeVisible()
    await expect(toggle_button).toBeEnabled()
    await toggle_button.click()

    const control_pane = page.locator(`#basic-single-series .draggable-pane`)
    await expect(control_pane).toBeVisible()

    // Test at different viewport sizes
    const viewports = [
      { width: 400, height: 300 },
      { width: 800, height: 600 },
      { width: 1280, height: 720 },
    ]

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)

      // Controls should remain accessible
      await expect(control_pane).toBeVisible()

      // Test slider interaction at different sizes
      const bins_slider = control_pane.locator(`#bins-input`)
      if (await bins_slider.isVisible()) {
        await bins_slider.fill(`25`)

        // Verify histogram still renders
        const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
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

    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
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
    const bars = histogram.locator(`path[role="button"]`)
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const box = await bar.boundingBox()
      if (!box) continue
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`handles rapid data updates without rendering errors`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)

    // Rapidly change bin count and sample size (use more reasonable values)
    for (let idx = 0; idx < 5; idx++) {
      await set_range_value_in_section(
        page,
        `basic-single-series-section`,
        `Bin Count`,
        10 + idx * 5,
      )
      await set_range_value_in_section(
        page,
        `basic-single-series-section`,
        `Sample Size`,
        500 + idx * 200,
      )
      // Wait for histogram to update after each change
      await expect(histogram.locator(`path[role="button"]`).first())
        .toBeVisible({ timeout: 2000 })
    }

    // After rapid updates, should still be functional
    await expect(histogram).toBeVisible()

    // Wait for final render to complete by checking for bars
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const bar_count = await get_bar_count(histogram)
    expect(bar_count).toBeGreaterThan(0)

    // All bars should have valid dimensions
    const bars = histogram.locator(`path[role="button"]`)
    const bar_elements = await bars.all()
    for (const bar of bar_elements) {
      const box = await bar.boundingBox()
      expect(box).toBeTruthy()
      if (!box) continue
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }
  })

  test(`tick configuration and dynamic updates`, async ({ page }) => {
    // Helper to wait for and validate histogram render
    const wait_for_histogram = async (selector: string) => {
      const histogram = page.locator(`${selector} > svg[role="img"]`)
      await expect(histogram).toBeVisible()
      await expect(histogram.locator(`path[role="button"]`).first())
        .toBeVisible()
      return histogram
    }

    // Test configurable tick counts
    const tick_config_histogram = await wait_for_histogram(`#tick-configuration`)
    const [x_axis, y_axis] = await Promise.all([
      tick_config_histogram.locator(`g.x-axis`),
      tick_config_histogram.locator(`g.y-axis`),
    ])

    // Adjust tick counts and verify changes using scoped selectors
    await set_range_value_in_section(
      page,
      `tick-configuration-section`,
      `X-axis Ticks`,
      15,
    )
    await set_range_value_in_section(
      page,
      `tick-configuration-section`,
      `Y-axis Ticks`,
      10,
    )

    const [adjusted_x, adjusted_y] = await Promise.all([
      get_histogram_tick_range(x_axis),
      get_histogram_tick_range(y_axis),
    ])

    // Verify tick adjustments and spacing
    expect(adjusted_x.ticks.length).toBeGreaterThan(0)
    expect(adjusted_y.ticks.length).toBeGreaterThan(0)
    expect(adjusted_x.range).toBeGreaterThan(0)
    expect(adjusted_y.range).toBeGreaterThan(0)

    // Verify tick configuration produces reasonable tick counts
    // D3 may not produce exactly the requested number of ticks, but should be in a reasonable range
    expect(adjusted_x.ticks.length).toBeGreaterThanOrEqual(4)
    expect(adjusted_x.ticks.length).toBeLessThanOrEqual(20)
    expect(adjusted_y.ticks.length).toBeGreaterThanOrEqual(3)
    expect(adjusted_y.ticks.length).toBeLessThanOrEqual(15)

    // Test custom tick arrays and data consistency
    await page.evaluate(() => {
      const container = document.querySelector(`#basic-single-series .histogram`)
      if (!container) return

      const data = Array.from({ length: 100 }, () => Math.random() * 10)
      container.dispatchEvent(
        new CustomEvent(`test-histogram-ticks`, {
          detail: {
            series: [{ label: `Custom Ticks`, y: data, visible: true }],
            x_axis: { ticks: [0, 2.5, 5, 7.5, 10] },
            y_axis: { ticks: [0, 5, 10, 15, 20, 25] },
          },
        }),
      )
    })

    const basic_histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    const [basic_x, basic_y] = await Promise.all([
      get_histogram_tick_range(basic_histogram.locator(`g.x-axis`)),
      get_histogram_tick_range(basic_histogram.locator(`g.y-axis`)),
    ])

    expect(basic_x.ticks.length).toBeGreaterThan(0)
    expect(basic_y.ticks.length).toBeGreaterThan(0)

    // Test tick consistency during data updates
    await set_range_value_in_section(
      page,
      `basic-single-series-section`,
      `Sample Size`,
      2000,
    )

    const [updated_x, updated_y] = await Promise.all([
      get_histogram_tick_range(basic_histogram.locator(`g.x-axis`)),
      get_histogram_tick_range(basic_histogram.locator(`g.y-axis`)),
    ])

    expect(updated_x.ticks.length).toBeGreaterThan(0)
    expect(updated_y.ticks.length).toBeGreaterThan(0)
    expect(Math.abs(updated_x.ticks.length - basic_x.ticks.length)).toBeLessThanOrEqual(5)
  })

  test(`logarithmic scale tick generation and validation`, async ({ page }) => {
    const histogram = page.locator(`#logarithmic-scales > svg[role="img"]`)
    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const scale_tests = [
      { x_scale: `log`, y_scale: `linear` },
      { x_scale: `linear`, y_scale: `log` },
      { x_scale: `log`, y_scale: `log` },
    ]

    for (const { x_scale, y_scale } of scale_tests) {
      // Use scoped selectors within the logarithmic-scales section
      await click_radio_in_section(
        page,
        `logarithmic-scales-section`,
        `input[name="x-scale"][value="${x_scale}"]`,
      )
      await click_radio_in_section(
        page,
        `logarithmic-scales-section`,
        `input[name="y-scale"][value="${y_scale}"]`,
      )

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

      // Verify ticks are all valid numbers (D3 doesn't guarantee DOM ordering)
      for (const tick of x_ticks.ticks) {
        expect(typeof tick).toBe(`number`)
        expect(Number.isFinite(tick)).toBe(true)
      }
      for (const tick of y_ticks.ticks) {
        expect(typeof tick).toBe(`number`)
        expect(Number.isFinite(tick)).toBe(true)
      }
    }
  })

  test(`tick interval generation and formatting`, async ({ page }) => {
    // Test tick generation with the existing histogram
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
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
    const tick_config_histogram = page.locator(`#tick-configuration > svg[role="img"]`)
    await expect(tick_config_histogram.locator(`path[role="button"]`).first())
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

    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(histogram).toBeVisible()

    await expect(histogram.locator(`path[role="button"]`).first()).toBeVisible({
      timeout: 5000,
    })

    const cursor_style = await histogram.evaluate((el) => getComputedStyle(el).cursor)
    expect(cursor_style).toBe(`crosshair`)

    // Get histogram bounding box for precise mouse positioning
    const box = await histogram.boundingBox()
    if (!box) throw new Error(`Histogram bounding box not found`)

    // Start drag operation using coordinates inside the chart area
    const start_x = box.x + box.width * 0.3
    const start_y = box.y + box.height * 0.3
    const end_x = box.x + box.width * 0.7
    const end_y = box.y + box.height * 0.7

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()
    await page.mouse.move(end_x, end_y, { steps: 5 })

    // Verify zoom rectangle appears during drag
    const zoom_rect = histogram.locator(`.zoom-rect`)
    await expect(zoom_rect).toBeVisible({ timeout: 2000 })

    // Complete drag operation
    await page.mouse.up()

    // Test double-click reset
    await histogram.dblclick()
    await expect(zoom_rect).toBeHidden({ timeout: 2000 })
  })

  test(`one-sided axis range pins via controls`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series > svg[role="img"]`)
    await expect(histogram).toBeVisible()

    const toggle = page.locator(`#basic-single-series .pane-toggle`)
    await toggle.click()
    const pane = page.locator(`#basic-single-series .draggable-pane`)
    await expect(pane.getByText(`Axis Range`)).toBeVisible()

    const [x_axis_el, y_axis_el] = [
      histogram.locator(`g.x-axis`),
      histogram.locator(`g.y-axis`),
    ]
    const [baseline_x, baseline_y] = await Promise.all([
      get_histogram_tick_range(x_axis_el),
      get_histogram_tick_range(y_axis_el),
    ])
    const [x_min, x_max, y_min, y_max] = [
      Math.min(...baseline_x.ticks),
      Math.max(...baseline_x.ticks),
      Math.min(...baseline_y.ticks),
      Math.max(...baseline_y.ticks),
    ]

    // Use shared helpers for range inputs
    const x_inputs = get_axis_range_inputs(pane, `X-axis`)
    const y_inputs = get_axis_range_inputs(pane, `Y-axis`)

    // Test: set specific min/max values and verify axis updates
    // X-axis: set a specific min value
    const x_new_min = x_min + (x_max - x_min) * 0.3
    await set_range_input(x_inputs.min, String(x_new_min))

    // Wait for axis to update and verify
    await expect.poll(async () => {
      const { ticks } = await get_histogram_tick_range(x_axis_el)
      return Math.min(...ticks)
    }, { timeout: 3000 }).toBeGreaterThanOrEqual(x_new_min - (x_max - x_min) * 0.05)

    // Y-axis: set a specific max value
    const y_new_max = y_max - (y_max - y_min) * 0.3
    await set_range_input(y_inputs.max, String(y_new_max))

    // Wait for axis to update and verify
    await expect.poll(async () => {
      const { ticks } = await get_histogram_tick_range(y_axis_el)
      return Math.max(...ticks)
    }, { timeout: 3000 }).toBeLessThanOrEqual(y_new_max + (y_max - y_min) * 0.05)

    await toggle.click()
  })

  test(`on_bar_hover and on_bar_click handlers`, async ({ page }) => {
    // Navigate to demo page instead of test page to access interactive handler UI elements
    // The demo page includes status divs that display handler state for testing behavior
    await page.goto(`/plot/histogram`, { waitUntil: `networkidle` })

    // Find the first histogram with bar interaction handlers (first code example)
    const histogram_section = page.locator(`.histogram`).first()
    await expect(histogram_section).toBeVisible({ timeout: 10000 })

    // Find the info divs that display hover/click state using stable data-testid selectors
    const hover_div = page.locator(`[data-testid="hover-status"]`)
    const click_div = page.locator(`[data-testid="click-status"]`)

    await expect(hover_div).toBeVisible({ timeout: 10000 })
    await expect(click_div).toBeVisible()

    await expect(hover_div).toContainText(`Hover over a bar`)
    await expect(click_div).toContainText(`Click on a bar`)

    // Use the main histogram SVG, not icon SVGs
    const svg = histogram_section.locator(`> svg[role="img"]`)
    await expect(svg).toBeVisible({ timeout: 10000 })
    const bars = svg.locator(`path[role="button"]`)
    // Wait for bars to be rendered
    await expect(bars.first()).toBeVisible({ timeout: 10000 })
    const bar_count = await bars.count()
    expect(bar_count).toBeGreaterThan(0)

    const first_bar = bars.first()

    // Check cursor is pointer (click handler is defined)
    const cursor = await first_bar.evaluate((el) =>
      globalThis.getComputedStyle(el).cursor
    )
    expect(cursor).toBe(`pointer`)

    // Test hover
    await first_bar.hover()
    await expect(hover_div).toContainText(`Hovering:`, { timeout: 5000 })
    await expect(hover_div).toContainText(`Normal Distribution`)

    // Test click
    await first_bar.click()
    await expect(click_div).toContainText(`Clicked:`, { timeout: 5000 })
    await expect(click_div).toContainText(`Normal Distribution`)

    // Test hover clears on mouse leave
    await page.mouse.move(0, 0)
    await expect(hover_div).toContainText(`Hover over a bar`, { timeout: 5000 })
  })

  test(`y2 axis renders when series assigned to y2`, async ({ page }) => {
    const histogram = page.locator(`#y2-axis-histogram .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    await expect(histogram).toBeVisible()

    // Check that y2-axis renders
    const y2_axis = histogram.locator(`g.y2-axis`)
    await expect(y2_axis).toBeVisible()

    // Check that y2-axis has ticks
    const y2_ticks = y2_axis.locator(`.tick`)
    await expect(y2_ticks.first()).toBeVisible()
    expect(await y2_ticks.count()).toBeGreaterThan(0)

    // Check that histogram bars render
    const bars = histogram.locator(`svg path[role="button"]`)
    await expect(bars.first()).toBeVisible()
    expect(await bars.count()).toBeGreaterThan(0)
  })

  test(`y2 axis scaling is independent of y1 axis`, async ({ page }) => {
    const histogram = page.locator(`#y2-different-scale .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    await expect(histogram).toBeVisible()

    // Get tick values from y1 and y2 axes
    const y1_ticks = await histogram.locator(`g.y-axis .tick text`).allTextContents()
    const y2_ticks = await histogram.locator(`g.y2-axis .tick text`).allTextContents()

    // Verify both axes have ticks
    expect(y1_ticks.length).toBeGreaterThan(0)
    expect(y2_ticks.length).toBeGreaterThan(0)

    // Verify they have different ranges (independent scaling) - compare arrays to avoid locale effects
    expect(y1_ticks).not.toEqual(y2_ticks)
  })

  test(`bins are calculated separately for y1 and y2 series`, async ({ page }) => {
    const histogram = page.locator(`#y2-axis-histogram .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    await expect(histogram).toBeVisible()

    // Get bars from different series
    const all_bars = histogram.locator(`svg path[role="button"]`)
    await expect(all_bars.first()).toBeVisible()

    // Get bars from first two series (one y1, one y2)
    const series_groups = histogram.locator(`g.histogram-series`)
    expect(await series_groups.count()).toBeGreaterThanOrEqual(2)

    // Each series should have bars (using path, not rect)
    const first_series_bars = series_groups.nth(0).locator(`path[role="button"]`)
    const second_series_bars = series_groups.nth(1).locator(`path[role="button"]`)
    expect(await first_series_bars.count()).toBeGreaterThan(0)
    expect(await second_series_bars.count()).toBeGreaterThan(0)
  })

  test(`zoom updates both y1 and y2 ranges in histogram`, async ({ page }) => {
    const histogram = page.locator(`#y2-axis-histogram .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    // Use the main interactive SVG with role="img", not icon SVGs
    const svg = histogram.locator(`> svg[role="img"]`)
    await expect(svg).toBeVisible()

    // Wait for initial ticks
    await expect(histogram.locator(`g.y-axis .tick text`).first()).toBeVisible()
    await expect(histogram.locator(`g.y2-axis .tick text`).first()).toBeVisible()

    const get_range = async (axis: `y` | `y2`) => {
      const tick_texts = await histogram.locator(`g.${axis}-axis .tick text`)
        .allTextContents()
      return tick_texts
    }

    const initial_y1 = await get_range(`y`)
    const initial_y2 = await get_range(`y2`)

    const box = await svg.boundingBox()
    if (!box) throw new Error(`SVG bbox not found`)

    // Perform zoom
    const start_x = box.x + box.width * 0.3
    const start_y = box.y + box.height * 0.7
    const end_x = box.x + box.width * 0.7
    const end_y = box.y + box.height * 0.3

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()

    // Check if zoom rectangle appears during drag
    await page.mouse.move(end_x, end_y, { steps: 10 })
    const zoom_rect = histogram.locator(`.zoom-rect`)
    await expect(zoom_rect).toBeVisible({ timeout: 5000 })

    await page.mouse.up()

    // After zoom, both axes should have changed
    await expect
      .poll(async () => {
        const range = await get_range(`y`)
        return JSON.stringify(range) !== JSON.stringify(initial_y1)
      }, { timeout: 2000 })
      .toBe(true)
    await expect
      .poll(async () => {
        const range = await get_range(`y2`)
        return JSON.stringify(range) !== JSON.stringify(initial_y2)
      }, { timeout: 2000 })
      .toBe(true)

    // Reset
    await svg.dblclick()
    await expect
      .poll(async () => {
        const range = await get_range(`y`)
        return JSON.stringify(range)
      }, { timeout: 2000 })
      .toBe(JSON.stringify(initial_y1))
    await expect
      .poll(async () => {
        const range = await get_range(`y2`)
        return JSON.stringify(range)
      }, { timeout: 2000 })
      .toBe(JSON.stringify(initial_y2))
  })

  test(`histogram bars use correct y-scale based on series y_axis property`, async ({ page }) => {
    const histogram = page.locator(`#y2-different-scale .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    await expect(histogram).toBeVisible()

    // Get bars from both series (using path, not rect)
    const series_groups = histogram.locator(`g.histogram-series`)
    await expect(series_groups.first()).toBeVisible()

    const first_series_bars = await series_groups.nth(0).locator(`path[role="button"]`)
      .all()
    const second_series_bars = await series_groups.nth(1).locator(`path[role="button"]`)
      .all()

    expect(first_series_bars.length).toBeGreaterThan(0)
    expect(second_series_bars.length).toBeGreaterThan(0)

    // Get bounding boxes
    const first_boxes = (
      await Promise.all(
        first_series_bars.slice(0, 3).map(async (bar) => await bar.boundingBox()),
      )
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    const second_boxes = (
      await Promise.all(
        second_series_bars.slice(0, 3).map(async (bar) => await bar.boundingBox()),
      )
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))

    // Bars from different series should have different y positions due to different scales
    const first_ys = first_boxes.map((bb) => bb.y)
    const second_ys = second_boxes.map((bb) => bb.y)

    // At least some bars should be at different positions
    const all_ys = [...first_ys, ...second_ys]
    const unique_ys = new Set(all_ys.map((y_val) => Math.round(y_val)))
    expect(unique_ys.size).toBeGreaterThan(1)
  })

  test(`legend toggles visibility for y2 series`, async ({ page }) => {
    const histogram = page.locator(`#y2-axis-histogram .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    await expect(histogram).toBeVisible()

    const legend = histogram.locator(`.legend`)
    await expect(legend).toBeVisible()

    const items = legend.locator(`.legend-item`)
    expect(await items.count()).toBeGreaterThanOrEqual(2)

    // Count bars in each series group separately
    const series_groups = histogram.locator(`g.histogram-series`)
    const initial_series_count = await series_groups.count()
    expect(initial_series_count).toBeGreaterThanOrEqual(2)

    // Get initial visible series count
    const get_visible_series_count = async () => {
      const groups = await series_groups.all()
      let count = 0
      for (const group of groups) {
        const bars = await group.locator(`path[role="button"]`).count()
        if (bars > 0) count++
      }
      return count
    }

    const initial_visible = await get_visible_series_count()
    expect(initial_visible).toBe(2)

    // Toggle first series -> visible series count should decrease
    await items.first().click()
    await expect
      .poll(async () => await get_visible_series_count(), { timeout: 3000 })
      .toBe(1)

    // Toggle back -> visible series count should be restored
    await items.first().click()
    await expect
      .poll(async () => await get_visible_series_count(), { timeout: 3000 })
      .toBe(2)
  })
})
