import { rects_overlap } from '$lib/plot/core/layout'
import { expect, type Locator, test } from '@playwright/test'
import {
  expect_shift_drag_pans,
  expect_zoom_shrinks_axes,
  is_present,
  open_plot_controls,
} from '../helpers'

// Bars render as <path> (rounded-rect path) with an aria-label.
const bars_of = (plot: Locator) => plot.locator(`svg path[aria-label^="bar "]`)
const first_boxes = async (plot: Locator, count = 4) =>
  (
    await Promise.all(
      (await bars_of(plot).all()).slice(0, count).map((bar) => bar.boundingBox()),
    )
  ).filter(is_present)
const tick_texts = (plot: Locator, axis: `x` | `y` | `y2`) =>
  plot.locator(`g.${axis}-axis .tick text`).allTextContents()

test.describe(`BarPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bar-plot`, { waitUntil: `networkidle` })
  })

  test(`renders bars inside the clip area with axes and a hover tooltip`, async ({ page }) => {
    const plot = page.locator(`#basic-bar .bar-plot`)
    const bars = bars_of(plot)
    await expect(bars).toHaveCount(4)
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()

    const bounds = await plot.locator(`svg[role="application"]`).evaluate((svg) => {
      const clip_rect = svg.querySelector<SVGRectElement>(`clipPath rect`)
      const bar_paths = svg.querySelectorAll<SVGGraphicsElement>(`path[aria-label^="bar "]`)
      const first_bar = bar_paths.item(0)
      const last_bar = bar_paths.item(bar_paths.length - 1)
      if (!clip_rect || !first_bar || !last_bar)
        throw new Error(`Missing bar or clip geometry`)
      const first_box = first_bar.getBBox()
      const last_box = last_bar.getBBox()
      const clip_x = clip_rect.x.baseVal.value
      return {
        clip_x,
        clip_right: clip_x + clip_rect.width.baseVal.value,
        first_x: first_box.x,
        last_right: last_box.x + last_box.width,
      }
    })
    expect(bounds.first_x).toBeGreaterThanOrEqual(bounds.clip_x - 0.001)
    expect(bounds.last_right).toBeLessThanOrEqual(bounds.clip_right + 0.001)

    // hover shows a tooltip; without a click handler the cursor is not a pointer
    await bars.first().hover()
    await expect(plot.locator(`.plot-tooltip`)).toBeVisible()
    await expect(bars.first()).not.toHaveCSS(`cursor`, `pointer`)
  })

  test(`legend avoids bars and tooltips, survives resize, and toggles series`, async ({
    page,
  }) => {
    const plot = page.locator(`#legend-bar .bar-plot`)
    const bars = bars_of(plot)
    const legend = plot.locator(`.legend`)
    const items = legend.locator(`.legend-item`)
    await expect(items).toHaveCount(2)

    const legend_bar_overlap_count = () =>
      plot.evaluate((root) => {
        const legend_rect = root.querySelector(`.legend`)?.getBoundingClientRect()
        if (!legend_rect) throw new Error(`Missing legend geometry`)
        return [...root.querySelectorAll<SVGGraphicsElement>(`svg path[aria-label^="bar "]`)]
          .map((bar_path) => bar_path.getBoundingClientRect())
          .filter(
            (bar_rect) =>
              legend_rect.left < bar_rect.right &&
              legend_rect.right > bar_rect.left &&
              legend_rect.top < bar_rect.bottom &&
              legend_rect.bottom > bar_rect.top,
          ).length
      })
    await expect.poll(legend_bar_overlap_count).toBe(0)

    // Container resize reruns the unified solver without accumulating its old reservation.
    const plot_width_before = await plot.evaluate((root) => root.clientWidth)
    await page.setViewportSize({ width: 640, height: 900 })
    await expect
      .poll(() => plot.evaluate((root) => root.clientWidth))
      .not.toBe(plot_width_before)
    await expect.poll(legend_bar_overlap_count).toBe(0)

    await bars.first().hover({ force: true })
    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible()
    const [legend_box, tooltip_box] = await Promise.all([
      legend.boundingBox(),
      tooltip.boundingBox(),
    ])
    if (!legend_box || !tooltip_box) throw new Error(`missing legend/tooltip geometry`)
    expect(rects_overlap(legend_box, tooltip_box)).toBe(false)

    const initial_bars = await bars.count()
    expect(initial_bars).toBeGreaterThan(0)
    await items.first().click()
    await expect.poll(() => bars.count()).toBeLessThan(initial_bars)
    await items.first().click()
    await expect.poll(() => bars.count()).toBe(initial_bars)
  })

  test(`drag zoom shrinks both axes and double-click resets`, async ({ page }) => {
    await expect_zoom_shrinks_axes(page, page.locator(`#basic-bar .bar-plot`))
  })

  test(`Shift+drag pans the bar plot instead of zooming`, async ({ page }) => {
    await expect_shift_drag_pans(page, page.locator(`#basic-bar .bar-plot`))
  })

  test(`on_bar_hover and on_bar_click handlers with pointer cursor`, async ({ page }) => {
    const section = page.locator(`#handlers-bar`)
    const first_bar = bars_of(section.locator(`.bar-plot`)).first()
    await expect(first_bar).toHaveCSS(`cursor`, `pointer`)

    const info = section.locator(`.handler-info`)
    const hover_p = info.locator(`p`).first()
    const click_p = info.locator(`p`).last()
    await expect(hover_p).toContainText(`Hover over a bar`)
    await expect(click_p).toContainText(`Click on a bar`)

    await first_bar.hover()
    await expect(hover_p).toContainText(`Hovering:`)
    await first_bar.click()
    await expect(click_p).toContainText(`Clicked:`)
    await page.mouse.move(0, 0)
    await expect(hover_p).toContainText(`Hover over a bar`)
  })

  test(`controls pane toggles grid, reformats ticks and flips orientation`, async ({
    page,
  }) => {
    const plot = page.locator(`#basic-bar .bar-plot`)
    const bars = bars_of(plot)
    await expect(bars.first()).toBeVisible()
    const dims_before = await first_boxes(plot, 12)
    // with range_padding 0 the 4 wide bars aren't majority-vertical; just require
    // unambiguous verticals to exist so the flip below is observable
    const vertical_before = dims_before.filter((bb) => bb.height > bb.width).length
    expect(vertical_before).toBeGreaterThan(0)

    const { pane } = await open_plot_controls(plot)

    const grid_lines = plot.locator(`g.x-axis .tick line:not([y1='0'])`)
    const initial_grid_lines = await grid_lines.count()
    expect(initial_grid_lines).toBeGreaterThan(0)
    const x_grid_checkbox = pane.locator(`[data-label="grid"]`).getByLabel(`X`)
    await x_grid_checkbox.uncheck()
    await expect(grid_lines).toHaveCount(0)
    await x_grid_checkbox.check()
    await expect.poll(() => grid_lines.count()).toBeGreaterThanOrEqual(initial_grid_lines)

    await pane.locator(`input[type="text"]`).first().fill(`.1r`)
    await expect(plot.locator(`g.x-axis .tick text`).first()).toHaveText(/^\d+(?:\.\d+)?$/)

    await pane.getByRole(`combobox`).first().selectOption(`horizontal`)
    await expect
      .poll(async () => {
        const dims = await first_boxes(plot, 12)
        const horizontal = dims.filter((bb) => bb.width > bb.height).length
        const vertical = dims.filter((bb) => bb.height > bb.width).length
        return horizontal > vertical && vertical < vertical_before
      })
      .toBe(true)
  })

  test(`stacked mode separates positive and negative stacks and respects visibility`, async ({
    page,
  }) => {
    for (const [plot_id, axis] of [
      [`#stacked-mixed`, `y`],
      [`#stacked-mixed-horizontal`, `x`],
    ] as const) {
      const plot = page.locator(plot_id)
      await expect(bars_of(plot).first()).toBeVisible()
      // mixed signs place bars on both sides of the baseline
      const positions = (await first_boxes(plot)).map((bb) => bb[axis])
      expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(0)
    }

    // hiding a series removes its stacking contribution, shifting the remaining bars
    const plot = page.locator(`#stacked-mixed`)
    const rects = bars_of(plot)
    const items = plot.locator(`.legend .legend-item`)
    await expect(items).toHaveCount(2)
    const initial_first_rect_box = await rects.first().boundingBox()
    await items.first().click()
    await expect
      .poll(async () => (await rects.first().boundingBox())?.y ?? -1)
      .not.toBe(initial_first_rect_box?.y ?? -1)
  })

  test(`per-bar width arrays change bar widths`, async ({ page }) => {
    const widths = (await first_boxes(page.locator(`#width-array`))).map((bb) => bb.width)
    expect(new Set(widths.map((width) => Math.round(width))).size).toBeGreaterThan(1)
  })

  test(`y2 series get an independent axis, zoom together and line series can use y2`, async ({
    page,
  }) => {
    const plot = page.locator(`#y2-axis-bar .bar-plot`)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot.locator(`g.y2-axis .tick`).first()).toBeVisible()
    await expect(bars_of(plot).first()).toBeVisible()
    const initial_y2 = await tick_texts(plot, `y2`)
    await expect_zoom_shrinks_axes(page, plot)
    await expect.poll(() => tick_texts(plot, `y2`)).toEqual(initial_y2)

    // series with 100x larger values get their own tick scale, so stacks land at different heights
    const scaled = page.locator(`#y2-different-scale .bar-plot`)
    await scaled.scrollIntoViewIfNeeded()
    await expect(scaled.locator(`g.y2-axis .tick text`).first()).toBeVisible()
    expect(await tick_texts(scaled, `y`)).not.toEqual(await tick_texts(scaled, `y2`))
    const stacked = page.locator(`#y2-stacked .bar-plot`)
    await stacked.scrollIntoViewIfNeeded()
    await expect(bars_of(stacked).first()).toBeVisible()
    const ys = (await first_boxes(stacked)).map((bb) => Math.round(bb.y))
    expect(new Set(ys).size).toBeGreaterThan(1)

    const line_plot = page.locator(`#y2-line-series .bar-plot`)
    await line_plot.scrollIntoViewIfNeeded()
    await expect(line_plot.locator(`g.line-series polyline`).first()).toBeVisible()
    await expect(line_plot.locator(`g.y2-axis`)).toBeVisible()
  })

  // CATEGORICAL BAR CHART TESTS

  test(`categorical bars label the category axis, honor custom order and flip with orientation`, async ({
    page,
  }) => {
    const plot = page.locator(`#categorical-bar .bar-plot`)
    await plot.scrollIntoViewIfNeeded()
    await expect(bars_of(plot).first()).toBeVisible()
    const x_ticks = await tick_texts(plot, `x`)
    for (const material of [`Si`, `GaAs`, `Diamond`, `CdTe`])
      expect(x_ticks).toContain(material)
    expect(x_ticks).not.toContain(`0`)

    // stacked: union of all categories = 6 ticks; missing categories pad with y=0
    const stacked = page.locator(`#categorical-stacked .bar-plot`)
    await stacked.scrollIntoViewIfNeeded()
    await expect(bars_of(stacked).first()).toBeVisible()
    expect(await tick_texts(stacked, `x`)).toHaveLength(6)
    const y_max = Math.max(
      ...(await tick_texts(stacked, `y`)).map(Number).filter(Number.isFinite),
    )
    expect(y_max).toBeGreaterThan(0)
    expect(y_max).toBeLessThan(20)

    // horizontal: categories move to the y axis
    const horizontal = page.locator(`#categorical-horizontal .bar-plot`)
    await horizontal.scrollIntoViewIfNeeded()
    await expect(bars_of(horizontal).first()).toBeVisible()
    expect(await tick_texts(horizontal, `y`)).toContain(`Si`)
    expect(await tick_texts(horizontal, `x`)).not.toContain(`Si`)

    // explicit x_axis.categories filters and orders
    const custom = page.locator(`#categorical-custom-order .bar-plot`)
    await custom.scrollIntoViewIfNeeded()
    await expect(bars_of(custom).first()).toBeVisible()
    expect(await tick_texts(custom, `x`)).toEqual([`Diamond`, `GaN`, `Si`, `GaAs`])
  })

  test(`categorical tooltip and handlers show category_label`, async ({ page }) => {
    const section = page.locator(`#categorical-handlers`)
    const plot = section.locator(`.bar-plot`)
    await plot.scrollIntoViewIfNeeded()
    const bar = bars_of(plot).first()
    await bar.hover()
    await expect(plot.locator(`.plot-tooltip`)).toHaveText(/Oxygen|Silicon|Aluminum|Iron/)

    const info = section.locator(`.categorical-handler-info`)
    const element_name = /Oxygen|Silicon|Aluminum|Iron/
    await expect(info.locator(`p`).first()).toContainText(`Hovering:`)
    await expect(info.locator(`p`).first()).toHaveText(element_name)
    await bar.click()
    await expect(info.locator(`p`).last()).toContainText(`Clicked:`)
    await expect(info.locator(`p`).last()).toHaveText(element_name)
  })
})
