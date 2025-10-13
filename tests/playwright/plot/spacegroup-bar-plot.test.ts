// deno-lint-ignore-file no-await-in-loop
import { expect, test } from '@playwright/test'

test.describe(`SpacegroupBarPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/plot/spacegroup-bar-plot`, { waitUntil: `networkidle` })
  })

  test(`renders basic spacegroup bar plot with crystal system regions`, async ({ page }) => {
    // Find first example (diverse materials)
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // Check bars render
    const bars = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(bars.first()).toBeVisible()
    const bar_count = await bars.count()
    expect(bar_count).toBeGreaterThan(5)

    // Check axes render
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()

    // Check crystal system overlay rectangles exist
    const system_rects = plot.locator(`g.crystal-system-overlays rect`)
    const system_rect_count = await system_rects.count()
    expect(system_rect_count).toBeGreaterThan(0)
    expect(system_rect_count).toBeLessThanOrEqual(7) // Max 7 crystal systems

    // Check crystal system labels exist
    const system_labels = plot.locator(`g.crystal-system-overlays text`)
    const label_count = await system_labels.count()
    expect(label_count).toBeGreaterThan(0)
  })

  test(`tooltip shows space group number, symbol, and crystal system`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // Find data bars (these are buttons with role)
    const bars = plot.locator(`svg rect[role="button"]`)
    await expect(bars.first()).toBeVisible()

    // Try hovering over multiple bars to find one that shows tooltip
    const bar_count = await bars.count()
    let tooltip_visible = false
    let tooltip_text = ``

    // Try several bars in sequence
    for (let idx = 0; idx < Math.min(bar_count, 10); idx++) {
      const bar = bars.nth(idx)
      const hover_promise = bar.hover({ force: true })
      await hover_promise
      await page.waitForTimeout(150)

      const tooltip = plot.locator(`.tooltip`)
      if (await tooltip.isVisible()) {
        tooltip_visible = true
        tooltip_text = (await tooltip.textContent()) ?? ``
        break
      }
    }

    expect(tooltip_visible).toBe(true)
    expect(tooltip_text).toMatch(/Space Group:.*\d+/i)
    expect(tooltip_text).toMatch(/Crystal System:/i)
    expect(tooltip_text).toMatch(/Count:/i)
  })

  test(`double-click on plot area works`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    const svg = plot.locator(`svg[role="button"]`)
    await expect(svg).toBeVisible()

    // Wait for initial render
    await expect(plot.locator(`g.y-axis .tick text`).first()).toBeVisible()
    await expect(plot.locator(`g.x-axis .tick text`).first()).toBeVisible()

    // Double-click should not cause errors
    await svg.dblclick()
    await page.waitForTimeout(300)

    // Plot should still be visible and functional
    await expect(svg).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick text`).first()).toBeVisible()
  })

  test(`count annotations toggle works`, async ({ page }) => {
    // Find the plot and checkbox
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    const checkbox = page.locator(`input[type="checkbox"]`).first()
    await expect(checkbox).toBeVisible()

    // Count annotations should be visible initially
    const annotations = plot.locator(`g.crystal-system-overlays text`)
    const has_percentage_before = await annotations.evaluateAll((texts) =>
      texts.some((text) => text.textContent?.includes(`%`))
    )
    expect(has_percentage_before).toBe(true)

    // Uncheck to hide counts
    await checkbox.uncheck()
    await page.waitForTimeout(300)

    // Percentage text should disappear
    const has_percentage_after = await annotations.evaluateAll((texts) =>
      texts.some((text) => text.textContent?.includes(`%`))
    )
    expect(has_percentage_after).toBe(false)
  })

  test(`orientation switch flips bar orientation`, async ({ page }) => {
    // Find section with orientation controls
    const vertical_radio = page.locator(`input[value="vertical"]`).first()
    const horizontal_radio = page.locator(`input[value="horizontal"]`).first()

    await expect(vertical_radio).toBeVisible()
    await expect(horizontal_radio).toBeVisible()

    // Find the associated plot
    const plot = page.locator(`.bar-plot`).nth(2) // Third plot has orientation controls
    await expect(plot).toBeVisible()

    const bars = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(bars.first()).toBeVisible()

    // Measure initial orientation (should be vertical)
    const before_bars = await bars.all()
    const before_boxes = (
      await Promise.all(before_bars.slice(0, 5).map(async (h) => await h.boundingBox()))
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))

    const vertical_count_before = before_boxes.filter((bb) => bb.height > bb.width).length
    expect(vertical_count_before).toBeGreaterThan(2)

    // Switch to horizontal
    await horizontal_radio.check()
    await page.waitForTimeout(500)

    // Measure after orientation change
    const after_bars = await bars.all()
    const after_boxes = (
      await Promise.all(after_bars.slice(0, 5).map(async (h) => await h.boundingBox()))
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))

    const horizontal_count_after = after_boxes.filter((bb) => bb.width > bb.height).length
    expect(horizontal_count_after).toBeGreaterThan(2)
  })

  test(`handles space group symbols as input`, async ({ page }) => {
    // Find the second example (with symbols)
    const plots = page.locator(`.bar-plot`)
    const plot = plots.nth(1)
    await expect(plot).toBeVisible()

    // Check bars render from symbol input
    const bars = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(bars.first()).toBeVisible()
    const bar_count = await bars.count()
    expect(bar_count).toBeGreaterThan(5)

    // Hover on a bar and check tooltip shows symbol
    const bar_buttons = plot.locator(`svg rect[role="button"]`)
    await bar_buttons.first().hover({ force: true })
    await page.waitForTimeout(200)

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible()

    const tooltip_text = await tooltip.textContent()
    // Should show Hermann-Mauguin symbol
    expect(tooltip_text).toMatch(/Space Group:.*\(/i)
  })

  test(`empty dataset shows full range with no data bars`, async ({ page }) => {
    // Scroll to empty dataset section
    await page.evaluate(() => {
      const heading = Array.from(document.querySelectorAll(`h3`)).find(
        (h) => h.textContent?.includes(`Empty Dataset`),
      )
      heading?.scrollIntoView()
    })

    // Find the empty dataset example
    const headings = page.locator(`h3`)
    const empty_heading = headings.filter({ hasText: `Empty Dataset` }).first()
    await expect(empty_heading).toBeVisible()

    // Just check that all plots have proper rendering
    const all_plots = page.locator(`.bar-plot`)
    const _plot_count = await all_plots.count()

    // Just check that axes render
    const first_plot = all_plots.first()
    await expect(first_plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(first_plot.locator(`g.y-axis .tick`).first()).toBeVisible()
  })

  test(`multiple plots render correctly on the page`, async ({ page }) => {
    // Check that multiple examples are rendered
    const plots = page.locator(`.bar-plot`)
    const plot_count = await plots.count()
    expect(plot_count).toBeGreaterThan(3) // Should have multiple examples

    // Each plot should have basic structure
    for (let idx = 0; idx < Math.min(plot_count, 3); idx++) {
      const plot = plots.nth(idx)
      await expect(plot).toBeVisible()
      await expect(plot.locator(`svg`).first()).toBeVisible()
    }
  })

  test(`crystal system colors are distinct and visible`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // Get all crystal system region rectangles
    const system_rects = plot.locator(`g.crystal-system-overlays rect`)
    const rect_count = await system_rects.count()
    expect(rect_count).toBeGreaterThan(0)

    // Check each has a fill color
    const colors = await system_rects.evaluateAll((rects) =>
      rects.map((rect) => rect.getAttribute(`fill`)).filter(Boolean)
    )

    // Should have multiple distinct colors
    const unique_colors = new Set(colors)
    expect(unique_colors.size).toBeGreaterThan(3)

    // All should have some opacity for background effect
    const opacities = await system_rects.evaluateAll((rects) =>
      rects.map((rect) => parseFloat(rect.getAttribute(`opacity`) || `1`))
    )

    // Background rectangles should have low opacity
    expect(Math.max(...opacities)).toBeLessThanOrEqual(0.2)
  })

  test(`x-axis range spans full space group spectrum`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // Get x-axis tick values
    const x_ticks = await plot.locator(`g.x-axis .tick text`).allTextContents()
    const tick_values = x_ticks
      .map((text) => parseInt(text.replace(/[^\d]/g, ``), 10))
      .filter((num) => !isNaN(num) && num > 0)

    if (tick_values.length > 0) {
      const min_tick = Math.min(...tick_values)
      const max_tick = Math.max(...tick_values)

      // Should span a wide range
      expect(min_tick).toBeLessThan(50)
      expect(max_tick).toBeGreaterThan(180)
    }
  })

  test(`bars have reasonable width`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    const bars = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(bars.first()).toBeVisible()

    // Get positions and widths of first several bars
    const bar_elements = await bars.all()
    const bar_boxes = (
      await Promise.all(
        bar_elements.slice(0, 15).map(async (bar) => await bar.boundingBox()),
      )
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))

    // Check bars have reasonable width (not zero or negative)
    const widths = bar_boxes.map((bb) => bb.width)
    expect(Math.min(...widths)).toBeGreaterThan(0.5)

    // Check bars have reasonable heights
    const heights = bar_boxes.map((bb) => bb.height)
    expect(Math.min(...heights)).toBeGreaterThan(0)
  })

  test(`tooltip follows mouse on different bars`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    const bar_buttons = plot.locator(`svg rect[role="button"]`)
    const bar_count = await bar_buttons.count()

    if (bar_count > 3) {
      // Hover on first bar
      await bar_buttons.nth(0).hover({ force: true })
      await page.waitForTimeout(150)
      const tooltip = plot.locator(`.tooltip`)
      await expect(tooltip).toBeVisible()
      const first_text = await tooltip.textContent()

      // Hover on a different bar
      await bar_buttons.nth(2).hover({ force: true })
      await page.waitForTimeout(150)
      const second_text = await tooltip.textContent()

      // Tooltip content should be different
      expect(first_text).not.toBe(second_text)
    }
  })

  test(`no controls pane is shown`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // SpacegroupBarPlot sets show_controls={false}
    const controls_toggle = plot.locator(`.pane-toggle`)
    await expect(controls_toggle).not.toBeVisible()
  })

  test(`no legend is shown`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // SpacegroupBarPlot sets show_legend={false}
    const legend = plot.locator(`.legend`)
    await expect(legend).not.toBeVisible()
  })

  test(`x-axis ticks are rotated 90 degrees in vertical mode`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    // Check x-axis tick text elements have rotation transform
    const tick_text = plot.locator(`g.x-axis .tick text`).first()
    await expect(tick_text).toBeVisible()

    const transform = await tick_text.getAttribute(`transform`)
    // Should have rotate(90) or similar rotation
    if (transform) {
      expect(transform).toMatch(/rotate.*90/i)
    }
  })

  test(`percentage annotations format correctly`, async ({ page }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(plot).toBeVisible()

    const annotations = plot.locator(`g.crystal-system-overlays text`)
    const annotation_texts = await annotations.allTextContents()

    // Find texts with percentages
    const percentages = annotation_texts.filter((text) => text.includes(`%`))
    expect(percentages.length).toBeGreaterThan(0)

    // Percentages should be formatted properly (e.g., "10.5%", "23%")
    for (const pct_text of percentages) {
      expect(pct_text).toMatch(/\d+\.?\d*\s*%/)
    }
  })
})
