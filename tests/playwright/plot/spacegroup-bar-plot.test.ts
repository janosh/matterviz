import { expect, type Locator, test } from '@playwright/test'
import { bounding_boxes, expect_bottom_within, get_chart_svg } from '../helpers'

const bars_of = (plot: Locator) => plot.locator(`svg path[role="button"]`)

// Hover bars in turn until one raises the tooltip; resolves to its text and the bar's index
const hover_until_tooltip = async (
  plot: Locator,
  start_idx = 0,
): Promise<{ text: string; idx: number }> => {
  const bars = bars_of(plot)
  const tooltip = plot.locator(`.plot-tooltip`)
  const bar_count = await bars.count()
  for (let idx = start_idx; idx < Math.min(bar_count, start_idx + 10); idx++) {
    await bars.nth(idx).hover({ force: true })
    const shown = await tooltip
      .waitFor({ state: `visible`, timeout: 500 })
      .then(() => true)
      .catch(() => false)
    if (shown) return { text: (await tooltip.textContent()) ?? ``, idx }
  }
  throw new Error(`no tooltip after hovering bars ${start_idx}-${start_idx + 9}`)
}

const has_percentages = (annotations: Locator) =>
  annotations.evaluateAll((texts) => texts.some((text) => text.textContent?.includes(`%`)))

test.describe(`SpacegroupBarPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/plot/spacegroup-bar-plot`, { waitUntil: `networkidle` })
    await page.waitForSelector(`.bar-plot`, { timeout: 15000 })
  })

  test(`renders bars over the full spectrum with crystal system regions and no chrome`, async ({
    page,
  }) => {
    const plot = page.locator(`.bar-plot`).first() // diverse materials example
    const bars = bars_of(plot)
    await expect(bars.first()).toBeVisible()
    expect(await bars.count()).toBeGreaterThan(5)
    for (const { width, height } of await bounding_boxes(bars, 15)) {
      expect(width).toBeGreaterThan(0.5)
      expect(height).toBeGreaterThan(0)
    }

    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
    const first_x_tick = plot.locator(`g.x-axis .tick text`).first()
    await expect(first_x_tick).toHaveAttribute(`transform`, /rotate.*90/i) // vertical mode
    await expect_bottom_within(get_chart_svg(plot), plot.locator(`.axis-label.x-label`))
    const tick_values = (await plot.locator(`g.x-axis .tick text`).allTextContents())
      .map((text) => Number(text.replaceAll(/[^\d]/g, ``)))
      .filter((num) => num > 0)
    expect(Math.min(...tick_values)).toBeLessThan(50)
    expect(Math.max(...tick_values)).toBeGreaterThan(180)

    // at most 7 crystal systems, each a distinct faint background color
    const system_rects = plot.locator(`g.crystal-system-overlays rect`)
    const rect_count = await system_rects.count()
    expect(rect_count).toBeGreaterThan(0)
    expect(rect_count).toBeLessThanOrEqual(7)
    const fills = await system_rects.evaluateAll((rects) =>
      rects.map((rect) => [
        rect.getAttribute(`fill`),
        Number(rect.getAttribute(`opacity`) ?? 1),
      ]),
    )
    expect(new Set(fills.map(([fill]) => fill).filter(Boolean)).size).toBeGreaterThan(3)
    expect(Math.max(...fills.map(([, opacity]) => Number(opacity)))).toBeLessThanOrEqual(0.2)

    // SpacegroupBarPlot sets show_controls={false} and show_legend={false}
    await expect(plot.locator(`.pane-toggle`)).toBeHidden()
    await expect(plot.locator(`.legend`)).toBeHidden()

    // count annotations ("10.5%", "23%") show until their checkbox is unchecked
    const annotations = plot.locator(`g.crystal-system-overlays text`)
    const percentages = (await annotations.allTextContents()).filter((text) =>
      text.includes(`%`),
    )
    expect(percentages.length).toBeGreaterThan(0)
    for (const pct_text of percentages) expect(pct_text).toMatch(/\d+\.?\d*\s*%/)
    await page.locator(`input[type="checkbox"]`).first().uncheck()
    await expect.poll(() => has_percentages(annotations)).toBe(false)

    // double-clicking the plot area keeps it rendering
    await plot.locator(`svg[role="application"]`).dblclick()
    await expect(plot.locator(`g.y-axis .tick text`).first()).toBeVisible()
  })

  test(`tooltip shows space group, crystal system and count, and follows the hovered bar`, async ({
    page,
  }) => {
    const plot = page.locator(`.bar-plot`).first()
    await expect(bars_of(plot).first()).toBeVisible()
    const { text: first_text, idx } = await hover_until_tooltip(plot)
    expect(first_text).toMatch(/Space Group:.*\d+/i)
    expect(first_text).toMatch(/Crystal System:/i)
    expect(first_text).toMatch(/Count:/i)

    await bars_of(plot)
      .nth(idx + 2)
      .hover({ force: true })
    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).not.toHaveText(first_text)
    await expect(tooltip).toContainText(/Space Group:/i)

    // the second example takes Hermann-Mauguin symbols as input
    const symbol_plot = page.locator(`.bar-plot`).nth(1)
    await expect(bars_of(symbol_plot).first()).toBeVisible()
    expect(await bars_of(symbol_plot).count()).toBeGreaterThan(5)
    expect((await hover_until_tooltip(symbol_plot)).text).toMatch(/Space Group:.*\(/i)
  })

  test(`orientation switch flips bar orientation`, async ({ page }) => {
    const demo = page.locator(`.lazy-demo`).nth(2)
    await demo.scrollIntoViewIfNeeded()
    const horizontal_radio = page.locator(`input[value="horizontal"]`).first()
    await expect(page.locator(`input[value="vertical"]`).first()).toBeVisible({
      timeout: 10000,
    })
    const bars = bars_of(demo.locator(`.bar-plot`))
    await expect(bars.first()).toBeVisible({ timeout: 10000 }) // slow on CI

    const vertical = (await bounding_boxes(bars, 5)).filter(
      (bounds) => bounds.height > bounds.width,
    )
    expect(vertical.length).toBeGreaterThan(2)
    await horizontal_radio.check()
    await expect(async () => {
      const horizontal = (await bounding_boxes(bars, 5)).filter(
        (bounds) => bounds.width > bounds.height,
      )
      expect(horizontal.length).toBeGreaterThan(2)
    }).toPass({ timeout: 2000 })
  })
})
