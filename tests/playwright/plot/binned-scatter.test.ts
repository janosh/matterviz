import { expect, type Page, test } from '@playwright/test'
import { IS_CI, svg_rect } from '../helpers'

const CI_MULTIPLIER = IS_CI ? 5 : 1
const LOAD_BUDGET_MS = 500 * CI_MULTIPLIER
const HOVER_BUDGET_MS = 12 * CI_MULTIPLIER
const CLICK_BUDGET_MS = 500 * CI_MULTIPLIER
// Shared deterministic point cloud; spreads y values without RNG overhead.
const PSEUDO_RANDOM_MULTIPLIER = 48_271

async function wait_for_ready(page: Page) {
  const status = page.locator(`[data-testid="binned-scatter-status"]`)
  await expect(status).toHaveAttribute(`data-ready`, `true`, { timeout: 15_000 })
  return status
}

const get_plot_area = (page: Page) => svg_rect(page.locator(`clipPath rect`))
// Pointer events are handled on the frame's SVG, which sits over the canvases
const PLOT_SVG = `.binned-scatter svg[role="application"]`

// Time 80 synthetic hovers spread over the plot
const measure_hovers = (page: Page) =>
  page.evaluate((selector) => {
    const plot = document.querySelector(selector)
    if (!plot) throw new Error(`Binned scatter plot not found`)
    const rect = plot.getBoundingClientRect()
    const samples = Array.from({ length: 80 }, (_, idx) => {
      const clientX = rect.left + rect.width * (0.15 + 0.7 * ((idx % 16) / 15))
      const clientY = rect.top + rect.height * (0.2 + 0.6 * (Math.floor(idx / 16) / 4))
      const start = performance.now()
      plot.dispatchEvent(new MouseEvent(`mousemove`, { bubbles: true, clientX, clientY }))
      return performance.now() - start
    })
    return {
      hover_max_ms: Math.max(...samples),
      hover_avg_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    }
  }, PLOT_SVG)

// Time a synthetic click at fractions of the plot area (from its top-left), or the SVG center
const time_click = async (page: Page, fractions?: [number, number]) => {
  const area = fractions ? await get_plot_area(page) : null
  return page.evaluate(
    async ({ selector, box, at }) => {
      const plot = document.querySelector(selector)
      if (!plot) throw new Error(`Binned scatter plot not found`)
      const rect = plot.getBoundingClientRect()
      const [clientX, clientY] =
        box && at
          ? [rect.left + box.x + at[0] * box.width, rect.top + box.y + at[1] * box.height]
          : [rect.left + rect.width / 2, rect.top + rect.height / 2]
      const start = performance.now()
      plot.dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX, clientY }))
      await Promise.resolve()
      const status = document.querySelector<HTMLElement>(
        `[data-testid="binned-scatter-status"]`,
      )
      return {
        click_ms: performance.now() - start,
        zoom_count: Number(status?.dataset.zoomCount ?? 0),
        point_click_count: Number(status?.dataset.pointClickCount ?? 0),
      }
    },
    { selector: PLOT_SVG, box: area, at: fractions },
  )
}

test(`loads and interacts with one million density points within browser latency budget`, async ({
  page,
}) => {
  await page.goto(`/test/binned-scatter?points=1000000`, {
    waitUntil: `domcontentloaded`,
  })
  const status = await wait_for_ready(page)
  // a missing (0) or malformed (NaN) attribute fails this too
  const mount_ms = Number(await status.getAttribute(`data-mount-ms`))
  expect(mount_ms).toBeGreaterThan(0)
  await expect(page.locator(`.colorbar .label`)).toHaveText(`Density (1,000,000 points)`)
  expect(mount_ms).toBeLessThan(LOAD_BUDGET_MS)

  const hovers = await measure_hovers(page)
  expect(hovers.hover_avg_ms).toBeLessThan(HOVER_BUDGET_MS)
  expect(hovers.hover_max_ms).toBeLessThan(HOVER_BUDGET_MS * 3)
  const click = await time_click(page)
  expect(click.click_ms).toBeLessThan(CLICK_BUDGET_MS)
  expect(click.zoom_count).toBe(1)
})

test(`keeps point-mode hover and click lookup latency low`, async ({ page }) => {
  await page.goto(`/test/binned-scatter?mode=points&points=20000`, {
    waitUntil: `domcontentloaded`,
  })
  await wait_for_ready(page)

  const hovers = await measure_hovers(page)
  expect(hovers.hover_avg_ms).toBeLessThan(HOVER_BUDGET_MS)
  expect(hovers.hover_max_ms).toBeLessThan(HOVER_BUDGET_MS * 3)
  // point 5000 of the page's grid: x = 0.5 and its pseudo-random y, inside 5% axis padding
  const data_y = ((5000 * PSEUDO_RANDOM_MULTIPLIER) % 1_000_000) / 1_000_000
  const click = await time_click(page, [0.55 / 1.1, 1 - (data_y + 0.05) / 1.1])
  expect(click.click_ms).toBeLessThan(HOVER_BUDGET_MS * 3)
  expect(click.point_click_count).toBe(1)
})

test(`opens singleton density bins without a slow data scan`, async ({ page }) => {
  await page.goto(`/test/binned-scatter?mode=singleton`, {
    waitUntil: `domcontentloaded`,
  })
  await wait_for_ready(page)
  const result = await time_click(page, [0.9, 0.1])
  expect(result.click_ms).toBeLessThan(HOVER_BUDGET_MS)
  expect(result.point_click_count).toBe(1)
})

// The demo imports its 3D structure popup on the first click, keeping three.js off the page
// load (see payload-budget.test.ts), so the click must still open it
test(`demo opens the lazily loaded structure popup on a density bin click`, async ({
  page,
}) => {
  await page.goto(`/plot/binned-scatter`, { waitUntil: `domcontentloaded` })
  const area = page.locator(`.binned-scatter svg[role="application"]`).first()
  await expect(area).toBeVisible()
  // The plot starts below the fold, where page.mouse events reach nothing
  await area.scrollIntoViewIfNeeded()
  // The colorbar and stats badge glide to their solved spots after mount and would take a
  // click aimed at a bin they pass over
  const decoration_rects = () =>
    page
      .locator(`.binned-scatter :is(.colorbar-wrapper, .annotation)`)
      .evaluateAll((elements) =>
        elements.map((element) => JSON.stringify(element.getBoundingClientRect())).join(`;`),
      )
  let previous_rects = ``
  await expect
    .poll(async () => {
      const rects = await decoration_rects()
      const settled = rects !== `` && rects === previous_rects
      previous_rects = rects
      return settled
    })
    .toBe(true)
  const box = await svg_rect(page.locator(`.binned-scatter clipPath rect`).first())
  const frame = await area.boundingBox()
  if (!frame) throw new Error(`binned scatter frame has no bounding box`)
  const tooltip = page.locator(`.binned-scatter .plot-tooltip`)
  let hit: { x: number; y: number } | null = null
  for (let frac = 0.1; frac <= 0.9 && !hit; frac += 0.05) {
    const [coord_x, coord_y] = [
      frame.x + box.x + box.width * frac,
      frame.y + box.y + box.height * (1 - frac),
    ]
    // Only a bin the plot itself receives counts: not one under the colorbar or badge
    const on_plot = await area.evaluate(
      (svg, [x, y]) => svg.contains(document.elementFromPoint(x, y)),
      [coord_x, coord_y],
    )
    if (!on_plot) continue
    await page.mouse.move(coord_x, coord_y)
    if (await tooltip.isVisible()) hit = { x: coord_x, y: coord_y }
  }
  if (!hit) throw new Error(`no occupied density bin along the plot diagonal`)
  await page.mouse.click(hit.x, hit.y)
  const popup = page.locator(`.structure-popup`)
  await expect(popup).toBeVisible({ timeout: 15_000 })
  await expect(popup.locator(`canvas`).first()).toBeVisible()
})
