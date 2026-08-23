import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  bounding_boxes,
  expect_shift_drag_pans,
  expect_zoom_shrinks_axes,
  get_axis_range_inputs,
  get_tick_range,
  open_plot_controls,
  set_input_value,
  set_range_input,
  tick_texts,
  wait_for_bars,
} from '../helpers'

// Move a test-page range slider (scoped to its section) to the given value
const set_section_range = async (
  page: Page,
  section_testid: string,
  label_text: string,
  value: number,
) => {
  const input = page
    .locator(`[data-testid="${section_testid}"]`)
    .locator(`label:has-text("${label_text}") input[type="range"]`)
  await set_input_value(input, value.toString())
}

const bar_count = (plot: Locator) => plot.locator(`path[role="button"]`).count()
const series_groups = (plot: Locator) => plot.locator(`g.histogram-series`)
// re-binning changes bar counts, so count the series that still render any bar
const visible_series_count = async (plot: Locator): Promise<number> => {
  const groups = await series_groups(plot).all()
  const counts = await Promise.all(
    groups.map((group) => group.locator(`path[role="button"]`).count()),
  )
  return counts.filter((count) => count > 0).length
}

test.describe(`Histogram Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/histogram`, { waitUntil: `networkidle` })
  })

  test(`renders bars and axes, bin count and sample size re-bin the data`, async ({
    page,
  }) => {
    const histogram = page.locator(`#basic-single-series`)
    const bars = await wait_for_bars(histogram)
    await expect.poll(() => bar_count(histogram)).toBeGreaterThan(5)
    await expect(histogram.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(histogram.locator(`g.y-axis .tick`).first()).toBeVisible()
    // no click handler -> no pointer cursor
    await expect(bars.first()).not.toHaveCSS(`cursor`, `pointer`)

    // fewer bins -> fewer bars; 50 narrow bins keep the 1px minimum bar width
    const initial = await bar_count(histogram)
    await set_section_range(page, `basic-single-series-section`, `Bin Count`, 5)
    await expect.poll(() => bar_count(histogram)).toBeLessThan(initial)
    await set_section_range(page, `basic-single-series-section`, `Bin Count`, 50)
    await expect.poll(() => bar_count(histogram)).toBeGreaterThan(initial)
    for (const box of await bounding_boxes(bars)) {
      expect(box.width).toBeGreaterThanOrEqual(1)
      expect(box.height).toBeGreaterThan(0)
    }

    // rapid sample-size changes keep the plot rendering
    for (const sample_size of [100, 2000, 5000]) {
      await set_section_range(page, `basic-single-series-section`, `Sample Size`, sample_size)
      await expect(bars.first()).toBeVisible()
    }
  })

  test(`log scale combinations render bars and positive-only log ticks`, async ({ page }) => {
    const section = page.locator(`[data-testid="logarithmic-scales-section"]`)
    const histogram = page.locator(`#logarithmic-scales`)
    await wait_for_bars(histogram)

    for (const [x_scale, y_scale] of [
      [`log`, `linear`],
      [`log`, `log`],
      [`linear`, `log`],
      [`linear`, `linear`],
    ] as const) {
      await section.locator(`input[name="x-scale"][value="${x_scale}"]`).click()
      await section.locator(`input[name="y-scale"][value="${y_scale}"]`).click()
      await expect(histogram.locator(`g.x-axis .tick text`).first()).toBeVisible()
      await expect(histogram.locator(`g.y-axis .tick text`).first()).toBeVisible()
      await expect.poll(() => bar_count(histogram)).toBeGreaterThan(0)
      for (const [axis, scale] of [
        [`x`, x_scale],
        [`y`, y_scale],
      ] as const) {
        const { ticks } = await get_tick_range(histogram.locator(`g.${axis}-axis`))
        expect(ticks.length, `${axis} ticks`).toBeGreaterThan(0)
        if (scale === `log`)
          expect(
            ticks.every((tick) => tick > 0),
            `${axis} log`,
          ).toBe(true)
      }
    }
  })

  test(`overlay mode draws stroked series, shows tooltip and a toggling legend`, async ({
    page,
  }) => {
    const histogram = page.locator(`#multiple-series-overlay`)
    const bars = await wait_for_bars(histogram)
    expect(await series_groups(histogram).count()).toBeGreaterThan(1)
    expect(Number(await bars.first().getAttribute(`stroke-width`))).toBeGreaterThan(0)

    await bars.first().hover({ force: true })
    const tooltip = histogram.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`Value:`)
    await expect(tooltip).toContainText(`Count:`)

    const legend = histogram.locator(`.legend`)
    await expect(legend).toBeVisible()
    const items = legend.locator(`.legend-item`)
    const item_count = await items.count()
    expect(item_count).toBeGreaterThan(1)
    await expect(items.first()).toHaveCSS(`cursor`, `pointer`)
    // single-series histogram shows no legend
    await expect(page.locator(`#basic-single-series .legend`)).toHaveCount(0)

    // toggle each series off and on, then all off: no bars but legend and axes remain
    const visible_series = () => visible_series_count(histogram)
    expect(await visible_series()).toBe(item_count)
    for (let idx = 0; idx < item_count; idx++) {
      await items.nth(idx).click()
      await expect(items.nth(idx)).toHaveClass(/hidden/)
      await expect.poll(visible_series).toBe(item_count - 1)
      await items.nth(idx).click()
      await expect(items.nth(idx)).not.toHaveClass(/hidden/)
      await expect.poll(visible_series).toBe(item_count)
    }
    for (let idx = 0; idx < item_count; idx++) await items.nth(idx).click()
    await expect(bars).toHaveCount(0)
    await expect(legend).toBeVisible()
    await expect(items).toHaveCount(item_count)
    await expect(histogram.locator(`g.x-axis`)).toBeVisible()
    await expect(histogram.locator(`g.y-axis`)).toBeVisible()
    for (let idx = 0; idx < item_count; idx++) await items.nth(idx).click()
    await expect.poll(visible_series).toBe(item_count)
  })

  test(`controls pane re-bins and switches scale type`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series`)
    await wait_for_bars(histogram)
    const initial_bars = await bar_count(histogram)
    const { pane } = await open_plot_controls(histogram)

    const bins_input = pane
      .locator(`label`)
      .filter({ hasText: /Bins/i })
      .locator(`input[type="number"]`)
    await bins_input.fill(`5`)
    await expect.poll(() => bar_count(histogram)).not.toBe(initial_bars)

    const initial_y = await get_tick_range(histogram.locator(`g.y-axis`))
    const y_scale_select = pane
      .locator(`[data-testid="scale-type-section"] label:has(span:text-is("Y"))`)
      .locator(`select`)
    await y_scale_select.selectOption(`log`)
    await expect
      .poll(async () => (await get_tick_range(histogram.locator(`g.y-axis`))).ticks)
      .not.toEqual(initial_y.ticks)
    await y_scale_select.selectOption(`linear`)
  })

  test(`controls pane opens with Enter on its toggle and closes with Escape`, async ({
    page,
  }) => {
    const histogram = page.locator(`#basic-single-series`)
    await wait_for_bars(histogram)
    await histogram.hover()
    await histogram.locator(`button.pane-toggle`).focus()
    await page.keyboard.press(`Enter`)
    const pane = histogram.locator(`.draggable-pane`)
    await expect(pane).toBeVisible()
    await page.keyboard.press(`Escape`)
    await expect(pane).toBeHidden()
  })

  test(`controls pane mode/property selects and bar style inputs drive the overlay`, async ({
    page,
  }) => {
    const histogram = page.locator(`#multiple-series-overlay`)
    const bars = await wait_for_bars(histogram)
    const { pane } = await open_plot_controls(histogram)

    const mode_select = pane.getByRole(`combobox`, { name: `Mode` })
    await mode_select.selectOption(`single`)
    const property_select = pane.getByRole(`combobox`, { name: `Property` })
    await expect(property_select).toBeVisible()
    expect(await property_select.locator(`option`).count()).toBeGreaterThan(1)
    await property_select.selectOption({ index: 1 })
    await expect(property_select).not.toHaveValue(``)
    await expect.poll(() => series_groups(histogram).count()).toBe(1)
    await mode_select.selectOption(`overlay`)
    await expect.poll(() => series_groups(histogram).count()).toBeGreaterThan(1)

    const legend_checkbox = pane.getByLabel(`Show legend`)
    await legend_checkbox.uncheck()
    await expect(histogram.locator(`.legend`)).toHaveCount(0)
    await legend_checkbox.check()
    await expect(histogram.locator(`.legend`)).toBeVisible()

    for (const [label, value, attribute] of [
      [`Opacity`, `0.8`, `opacity`],
      [`Stroke width`, `1.5`, `stroke-width`],
    ] as const) {
      await pane
        .locator(`label:has(span:text-is("${label}")) input[type="number"]`)
        .fill(value)
      await expect(bars.first()).toHaveAttribute(attribute, value)
    }
  })

  test(`drag zoom shrinks both axes and double-click resets`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series`)
    await wait_for_bars(histogram)
    await expect(histogram.locator(`> svg[role="application"]`)).toHaveCSS(
      `cursor`,
      `crosshair`,
    )
    await expect_zoom_shrinks_axes(page, histogram)
  })

  test(`Shift+drag pans the histogram instead of zooming`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series`)
    await wait_for_bars(histogram)
    await expect_shift_drag_pans(page, histogram)
  })

  test(`one-sided axis range pins via controls`, async ({ page }) => {
    const histogram = page.locator(`#basic-single-series`)
    await wait_for_bars(histogram)
    const { pane } = await open_plot_controls(histogram)
    await expect(pane.getByText(`Axis range`)).toBeVisible()

    const x_axis_el = histogram.locator(`g.x-axis`)
    const y_axis_el = histogram.locator(`g.y-axis`)
    const [baseline_x, baseline_y] = await Promise.all([
      get_tick_range(x_axis_el),
      get_tick_range(y_axis_el),
    ])
    const [x_min, x_max] = [Math.min(...baseline_x.ticks), Math.max(...baseline_x.ticks)]
    const [y_min, y_max] = [Math.min(...baseline_y.ticks), Math.max(...baseline_y.ticks)]

    // X-axis: pin only the min; ticks must not extend below it (5% tick rounding slack)
    const x_new_min = x_min + (x_max - x_min) * 0.3
    await set_range_input(get_axis_range_inputs(pane, `X`).min, String(x_new_min))
    await expect
      .poll(async () => Math.min(...(await get_tick_range(x_axis_el)).ticks))
      .toBeGreaterThanOrEqual(x_new_min - (x_max - x_min) * 0.05)

    // Y-axis: pin only the max
    const y_new_max = y_max - (y_max - y_min) * 0.3
    await set_range_input(get_axis_range_inputs(pane, `Y`).max, String(y_new_max))
    await expect
      .poll(async () => Math.max(...(await get_tick_range(y_axis_el)).ticks))
      .toBeLessThanOrEqual(y_new_max + (y_max - y_min) * 0.05)
  })

  test(`on_bar_hover and on_bar_click handlers fire from real pointer events`, async ({
    page,
  }) => {
    // the demo page wires handlers to status divs; the test page has none
    await page.goto(`/plot/histogram`, { waitUntil: `networkidle` })
    const histogram = page.locator(`.histogram`).first()
    const hover_div = page.locator(`[data-testid="hover-status"]`)
    const click_div = page.locator(`[data-testid="click-status"]`)
    await expect(hover_div).toContainText(`Hover over a bar`)
    await expect(click_div).toContainText(`Click on a bar`)

    const bars = await wait_for_bars(histogram.locator(`> svg[role="application"]`))
    await expect(bars.first()).toHaveCSS(`cursor`, `pointer`)
    await bars.first().hover()
    await expect(hover_div).toContainText(`Hovering:`)
    await expect(hover_div).toContainText(`Normal Distribution`)
    await bars.first().click()
    await expect(click_div).toContainText(`Clicked:`)
    await page.mouse.move(0, 0)
    await expect(hover_div).toContainText(`Hover over a bar`)
  })

  test(`y2 series bin separately, scale independently, zoom together and toggle via legend`, async ({
    page,
  }) => {
    const histogram = page.locator(`#y2-axis-histogram .histogram`)
    await histogram.scrollIntoViewIfNeeded()
    await wait_for_bars(histogram)
    await expect(histogram.locator(`g.y2-axis .tick`).first()).toBeVisible()
    await expect(series_groups(histogram)).toHaveCount(2)
    expect(await visible_series_count(histogram)).toBe(2)

    // zoom changes both count axes, reset restores both
    const initial_y1 = await tick_texts(histogram, `y`)
    const initial_y2 = await tick_texts(histogram, `y2`)
    await expect_zoom_shrinks_axes(page, histogram)
    await expect.poll(() => tick_texts(histogram, `y2`)).toEqual(initial_y2)
    await expect.poll(() => tick_texts(histogram, `y`)).toEqual(initial_y1)

    // legend hides one series' bars and restores them
    const items = histogram.locator(`.legend .legend-item`)
    await expect(items).toHaveCount(2)
    await items.first().click()
    await expect.poll(() => visible_series_count(histogram)).toBe(1)
    await items.first().click()
    await expect.poll(() => visible_series_count(histogram)).toBe(2)

    // different magnitudes get different count axes, so bars sit at distinct heights
    const scaled = page.locator(`#y2-different-scale .histogram`)
    await scaled.scrollIntoViewIfNeeded()
    await wait_for_bars(scaled)
    expect(await tick_texts(scaled, `y`)).not.toEqual(await tick_texts(scaled, `y2`))
    const top_ys = new Set<number>()
    for (const idx of [0, 1]) {
      const bars = series_groups(scaled).nth(idx).locator(`path[role="button"]`)
      for (const box of await bounding_boxes(bars, 3)) top_ys.add(Math.round(box.y))
    }
    expect(top_ys.size).toBeGreaterThan(1)
  })
})
