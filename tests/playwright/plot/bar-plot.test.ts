import { expect, test } from '@playwright/test'

test.describe(`BarPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bar-plot`, { waitUntil: `networkidle` })
  })

  test(`renders basic bar plot with axes and bars`, async ({ page }) => {
    const section = page.locator(`#basic-bar`)
    const plot = section.locator(`.bar-plot`)
    await expect(plot).toBeVisible()

    // Bars render - select bars by their role attribute to avoid clipPath rects
    const bars = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(bars.first()).toBeVisible()
    await expect(bars).toHaveCount(4) // Should have 4 bars

    // Axes render with some ticks
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
  })

  test(`legend renders for multiple series and toggles visibility`, async ({ page }) => {
    const section = page.locator(`#legend-bar`)
    const plot = section.locator(`.bar-plot`)
    await expect(plot).toBeVisible()

    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    const items = legend.locator(`.legend-item`)
    await expect(items).toHaveCount(2)

    // Initial: both visible -> bars exist
    const initial_bars = await plot.locator(`svg rect[fill]:not([fill="none"])`).count()
    expect(initial_bars).toBeGreaterThan(0)

    // Toggle first series -> bar count should decrease
    await items.first().click()
    await expect
      .poll(async () => await plot.locator(`svg rect[fill]:not([fill="none"])`).count())
      .toBeLessThan(initial_bars)

    // Toggle back -> bar count should be restored to initial
    await items.first().click()
    await expect
      .poll(async () => await plot.locator(`svg rect[fill]:not([fill="none"])`).count())
      .toBe(initial_bars)
  })

  test(`zoom drag and double-click reset works`, async ({ page }) => {
    const plot = page.locator(`#basic-bar .bar-plot`)
    const svg = plot.locator(`svg[role="button"]`)

    // Wait for initial ticks
    await expect(plot.locator(`g.x-axis .tick text`).first()).toBeVisible()

    const get_range = async (axis: `x` | `y`) => {
      const tick_texts = await plot.locator(`g.${axis}-axis .tick text`).allTextContents()
      return tick_texts.join(`,`)
    }

    const initial_x = await get_range(`x`)
    const initial_y = await get_range(`y`)

    const box = await svg.boundingBox()
    if (!box) throw `SVG bbox not found`

    // Ensure drag is large enough (needs > 5px in both dimensions)
    const start_x = box.x + box.width * 0.2
    const start_y = box.y + box.height * 0.8
    const end_x = box.x + box.width * 0.8
    const end_y = box.y + box.height * 0.2

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()

    // Check if zoom rectangle appears during drag
    await page.mouse.move(end_x, end_y, { steps: 10 })
    const zoom_rect = plot.locator(`.zoom-rect`)
    await expect(zoom_rect).toBeVisible({ timeout: 1000 })

    await page.mouse.up()

    // Wait for zoom to take effect and ticks to update
    await page.waitForTimeout(100)

    // After zoom ticks differ
    const zoomed_x = await get_range(`x`)
    const zoomed_y = await get_range(`y`)
    expect(zoomed_x).not.toBe(initial_x)
    expect(zoomed_y).not.toBe(initial_y)

    // Reset
    await svg.dblclick()
    const reset_x = await get_range(`x`)
    const reset_y = await get_range(`y`)
    expect(reset_x).toBe(initial_x)
    expect(reset_y).toBe(initial_y)
  })

  test(`tooltip appears on bar hover with formatted values`, async ({ page }) => {
    const plot = page.locator(`#basic-bar .bar-plot`)
    const bar = plot.locator(`svg rect[fill]:not([fill="none"])`).first()
    await expect(bar).toBeVisible()
    await bar.hover({ force: true })

    const tooltip = plot.locator(`.tooltip`)
    await expect(tooltip).toBeVisible()
  })

  test(`cursor is not pointer when no click handler provided`, async ({ page }) => {
    const plot = page.locator(`#basic-bar .bar-plot`)
    const bar = plot.locator(`svg rect[fill]:not([fill="none"])`).first()
    await expect(bar).toBeVisible()

    // Check cursor is not pointer (no click handler)
    const cursor = await bar.evaluate((el) => globalThis.getComputedStyle(el).cursor)
    expect(cursor).not.toBe(`pointer`)
  })

  test(`on_bar_hover and on_bar_click handlers with pointer cursor`, async ({ page }) => {
    const section = page.locator(`#handlers-bar`)
    const plot = section.locator(`.bar-plot`)
    await expect(plot).toBeVisible()

    const bars = plot.locator(`svg rect[role="button"]`)
    const bar_count = await bars.count()
    expect(bar_count).toBeGreaterThan(0)

    const first_bar = bars.first()

    // Check cursor is pointer (click handler is defined)
    const cursor = await first_bar.evaluate((el) =>
      globalThis.getComputedStyle(el).cursor
    )
    expect(cursor).toBe(`pointer`)

    const info = section.locator(`.handler-info`)
    const hover_p = info.locator(`p`).first()
    const click_p = info.locator(`p`).last()

    // Initial state
    await expect(hover_p).toContainText(`Hover over a bar`)
    await expect(click_p).toContainText(`Click on a bar`)

    // Test hover
    await first_bar.hover()
    await page.waitForTimeout(100)
    await expect(hover_p).toContainText(`Hovering:`)

    // Test click
    await first_bar.click()
    await expect(click_p).toContainText(`Clicked:`)

    // Test hover clears on mouse leave
    await page.mouse.move(0, 0)
    await expect(hover_p).toContainText(`Hover over a bar`)
  })

  test(`controls pane toggles grid and updates tick formats`, async ({ page }) => {
    const section = page.locator(`#basic-bar`)
    const plot = section.locator(`.bar-plot`)
    await expect(plot).toBeVisible()

    // Open controls via toggle button rendered by DraggablePane
    const toggle = section.locator(`.pane-toggle`)
    await expect(toggle).toBeVisible()
    await toggle.click()

    const pane = section.locator(`.draggable-pane`)
    await expect(pane).toBeVisible()

    // Toggle x grid
    const x_grid_checkbox = pane.getByLabel(/x-axis\s*grid/i)
    await expect(x_grid_checkbox).toBeVisible()
    await x_grid_checkbox.scrollIntoViewIfNeeded()
    const initial_grid_lines = await plot.locator(`g.x-axis .tick line:not([y1='0'])`)
      .count()
    await x_grid_checkbox.evaluate((el) => {
      const input = el as HTMLInputElement
      input.checked = false
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      input.dispatchEvent(new Event(`change`, { bubbles: true }))
    })
    const no_grid_lines = await plot.locator(`g.x-axis .tick line:not([y1='0'])`).count()
    expect(no_grid_lines).toBe(0)
    await x_grid_checkbox.evaluate((el) => {
      const input = el as HTMLInputElement
      input.checked = true
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      input.dispatchEvent(new Event(`change`, { bubbles: true }))
    })
    const restored_grid_lines = await plot.locator(`g.x-axis .tick line:not([y1='0'])`)
      .count()
    expect(restored_grid_lines).toBeGreaterThanOrEqual(initial_grid_lines)

    // Change x tick format
    const x_format = pane.locator(`input[type="text"]`).first()
    await x_format.fill(`.1f`)
    await expect(plot.locator(`g.x-axis .tick text`).first()).toHaveText(/\d+\.\d/)
  })

  test(`orientation switch flips bar orientation`, async ({ page }) => {
    const section = page.locator(`#basic-bar`)
    const plot = section.locator(`.bar-plot`)
    await expect(plot).toBeVisible()
    const bars = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(bars.first()).toBeVisible()
    const before_boxes = (await bars.all()).slice(0, 12)
    const before_dims =
      (await Promise.all(before_boxes.map(async (h) => await h.boundingBox())))
        .filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    const vertical_count_before = before_dims.filter((bb) => bb.height > bb.width).length
    const horizontal_count_before =
      before_dims.filter((bb) => bb.width > bb.height).length
    expect(vertical_count_before).toBeGreaterThan(horizontal_count_before)

    // Open controls and switch orientation to Horizontal
    const toggle = section.locator(`.pane-toggle`)
    await expect(toggle).toBeVisible()
    await toggle.click()
    const pane = section.locator(`.draggable-pane`)
    await expect(pane).toBeVisible()

    const select = pane.locator(`#orientation-select`)
    await expect(select).toBeVisible()
    await select.selectOption(`horizontal`)
    // After change, majority of bars should be horizontal
    const after_boxes = (await bars.all()).slice(0, 12)
    const after_dims =
      (await Promise.all(after_boxes.map(async (h) => await h.boundingBox())))
        .filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    const horizontal_count_after = after_dims.filter((bb) => bb.width > bb.height).length
    const vertical_count_after = after_dims.filter((bb) => bb.height > bb.width).length
    expect(horizontal_count_after).toBeGreaterThan(vertical_count_after)
  })

  test(`stacked mode handles positive and negative stacking separately and respects visibility`, async ({ page }) => {
    const plot = page.locator(`#stacked-mixed`)
    await expect(plot).toBeVisible()

    // Collect bars for first x index (approx top-left group); two series -> two rects per x
    const rects = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(rects.first()).toBeVisible()

    // Measure y positions to verify one bar is above baseline and one below when values have different signs
    const rect_boxes = (await rects.elementHandles()).slice(0, 4)
    const boxes = (
      await Promise.all(rect_boxes.map(async (h) => await h.boundingBox()))
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    // There should be at least two bars with different vertical placement for mixed signs
    const ys = boxes.map((bb) => bb.y)
    const min_y = Math.min(...ys)
    const max_y = Math.max(...ys)
    expect(max_y - min_y).toBeGreaterThan(0)

    // Toggle visibility of first series; remaining series should shift to its own baseline (no stacking contribution from hidden)
    const legend = plot.locator(`.legend`)
    const items = legend.locator(`.legend-item`)
    await expect(items).toHaveCount(2)
    const initial_first_rect_box = await rects.first().boundingBox()
    await items.first().click()
    await expect
      .poll(async () => (await rects.first().boundingBox())?.y ?? -1)
      .not.toBe(initial_first_rect_box?.y ?? -1)
  })

  test(`zero-value bars render with minimal height/width and tooltips still appear`, async ({ page }) => {
    const plot = page.locator(`#zero-values`)
    await expect(plot).toBeVisible()
    const rects = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(rects.first()).toBeVisible()
    // zero bars should not have negative size
    const boxes = (
      await Promise.all(
        (await rects.all()).slice(0, 4).map(async (h) => await h.boundingBox()),
      )
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    expect(Math.min(...boxes.map((bb) => bb.width))).toBeGreaterThan(0)
    expect(Math.min(...boxes.map((bb) => bb.height))).toBeGreaterThan(0)
    await rects.first().hover({ force: true })
    await expect(plot.locator(`.tooltip`)).toBeVisible()
  })

  test(`per-bar width arrays change bar widths`, async ({ page }) => {
    const plot = page.locator(`#width-array`)
    await expect(plot).toBeVisible()
    const rects = await plot.locator(`svg rect[fill]:not([fill="none"])`).all()
    const boxes = (
      await Promise.all(rects.slice(0, 4).map(async (h) => await h.boundingBox()))
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    const widths = boxes.map((bb) => bb.width)
    // Expect at least two distinct widths
    const distinct = new Set(widths.map((w) => Math.round(w)))
    expect(distinct.size).toBeGreaterThan(1)
  })

  test(`horizontal stacked mixed also separates positive/negative properly`, async ({ page }) => {
    const plot = page.locator(`#stacked-mixed-horizontal`)
    await expect(plot).toBeVisible()
    const rects = plot.locator(`svg rect[fill]:not([fill="none"])`)
    await expect(rects.first()).toBeVisible()
    const boxes = (
      await Promise.all(
        (await rects.all()).slice(0, 4).map(async (h) => await h.boundingBox()),
      )
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))
    const xs = boxes.map((bb) => bb.x)
    const min_x = Math.min(...xs)
    const max_x = Math.max(...xs)
    expect(max_x - min_x).toBeGreaterThan(0)
  })

  test(`y2 axis renders when series assigned to y2`, async ({ page }) => {
    const plot = page.locator(`#y2-axis-bar .bar-plot`)
    await expect(plot).toBeVisible()

    // Check that y2-axis renders
    const y2_axis = plot.locator(`g.y2-axis`)
    await expect(y2_axis).toBeVisible()

    // Check that y2-axis has ticks
    const y2_ticks = y2_axis.locator(`.tick`)
    await expect(y2_ticks.first()).toBeVisible()
    expect(await y2_ticks.count()).toBeGreaterThan(0)

    // Check that both y1 and y2 axis have visible bars
    const bars = plot.locator(`svg rect[role="button"]`)
    await expect(bars.first()).toBeVisible()
    expect(await bars.count()).toBeGreaterThan(0)
  })

  test(`y2 axis scaling is independent of y1 axis`, async ({ page }) => {
    const plot = page.locator(`#y2-different-scale .bar-plot`)
    await expect(plot).toBeVisible()

    // Get tick values from y1 and y2 axes
    const y1_ticks = await plot.locator(`g.y-axis .tick text`).allTextContents()
    const y2_ticks = await plot.locator(`g.y2-axis .tick text`).allTextContents()

    // Verify both axes have ticks
    expect(y1_ticks.length).toBeGreaterThan(0)
    expect(y2_ticks.length).toBeGreaterThan(0)

    // Verify they have different ranges (independent scaling)
    expect(y1_ticks.join(`,`)).not.toBe(y2_ticks.join(`,`))
  })

  test(`stacked mode stacks series on same y-axis separately`, async ({ page }) => {
    const plot = page.locator(`#y2-stacked .bar-plot`)
    await expect(plot).toBeVisible()

    // Get bars for both series
    const bars = plot.locator(`svg rect[role="button"]`)
    await expect(bars.first()).toBeVisible()

    // There should be bars from both y1 and y2 series
    const bar_count = await bars.count()
    expect(bar_count).toBeGreaterThan(0)

    // Verify stacking by checking bar positions
    const first_bars = (await bars.all()).slice(0, 4)
    const boxes = (
      await Promise.all(first_bars.map(async (h) => await h.boundingBox()))
    ).filter((bb): bb is Exclude<typeof bb, null> => Boolean(bb))

    // Bars should be positioned at different y coordinates
    const ys = boxes.map((bb) => bb.y)
    const unique_ys = new Set(ys.map((y_val) => Math.round(y_val)))
    expect(unique_ys.size).toBeGreaterThan(1)
  })

  test(`zoom updates both y1 and y2 ranges`, async ({ page }) => {
    const plot = page.locator(`#y2-axis-bar .bar-plot`)
    const svg = plot.locator(`svg[role="button"]`)

    // Scroll to the plot to ensure it's in viewport
    await plot.scrollIntoViewIfNeeded()

    // Wait for initial ticks
    await expect(plot.locator(`g.y-axis .tick text`).first()).toBeVisible()
    await expect(plot.locator(`g.y2-axis .tick text`).first()).toBeVisible()

    const get_range = async (axis: `y` | `y2`) => {
      const tick_texts = await plot.locator(`g.${axis}-axis .tick text`).allTextContents()
      return tick_texts.join(`,`)
    }

    const initial_y1 = await get_range(`y`)
    const initial_y2 = await get_range(`y2`)

    const box = await svg.boundingBox()
    if (!box) throw `SVG bbox not found`

    // Ensure drag is large enough (needs > 5px in both dimensions)
    const start_x = box.x + box.width * 0.2
    const start_y = box.y + box.height * 0.8
    const end_x = box.x + box.width * 0.8
    const end_y = box.y + box.height * 0.2

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()

    // Check if zoom rectangle appears during drag
    await page.mouse.move(end_x, end_y, { steps: 10 })
    const zoom_rect = plot.locator(`.zoom-rect`)
    await expect(zoom_rect).toBeVisible({ timeout: 1000 })

    await page.mouse.up()

    // After zoom ticks differ - use polling for more reliable checks
    await expect
      .poll(async () => await get_range(`y`), { timeout: 2000 })
      .not.toBe(initial_y1)
    await expect
      .poll(async () => await get_range(`y2`), { timeout: 2000 })
      .not.toBe(initial_y2)

    // Reset
    await svg.dblclick()
    await expect
      .poll(async () => await get_range(`y`), { timeout: 2000 })
      .toBe(initial_y1)
    await expect
      .poll(async () => await get_range(`y2`), { timeout: 2000 })
      .toBe(initial_y2)
  })

  test(`line series can use y2 axis`, async ({ page }) => {
    const plot = page.locator(`#y2-line-series .bar-plot`)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot).toBeVisible()

    // Check that line series renders
    const line = plot.locator(`g.line-series polyline`)
    await expect(line.first()).toBeVisible()

    // Check that y2 axis exists
    const y2_axis = plot.locator(`g.y2-axis`)
    await expect(y2_axis).toBeVisible()
  })
})
