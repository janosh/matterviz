import { expect, type Page, test } from '@playwright/test'
import { IS_CI } from '../helpers'

const CI_MULTIPLIER = IS_CI ? 5 : 1
const LOAD_BUDGET_MS = 500 * CI_MULTIPLIER
const HOVER_BUDGET_MS = 12 * CI_MULTIPLIER
const CLICK_BUDGET_MS = 500 * CI_MULTIPLIER
// Shared deterministic point cloud; spreads y values without RNG overhead.
const PSEUDO_RANDOM_MULTIPLIER = 48_271

type PlotArea = { left: number; top: number; width: number; height: number }

async function wait_for_ready(page: Page) {
  const status = page.locator(`[data-testid="binned-scatter-status"]`)
  await expect(status).toHaveAttribute(`data-ready`, `true`, { timeout: 15_000 })
  return status
}

async function get_plot_area(page: Page): Promise<PlotArea> {
  return page.locator(`clipPath rect`).evaluate((rect) => ({
    left: Number(rect.getAttribute(`x`)),
    top: Number(rect.getAttribute(`y`)),
    width: Number(rect.getAttribute(`width`)),
    height: Number(rect.getAttribute(`height`)),
  }))
}

async function measure_plot_interaction(page: Page, click_target: `center` | `known-point`) {
  const known_point_bounds = click_target === `known-point` ? await get_plot_area(page) : null
  return page.evaluate(
    async ({ target, area, pseudo_random_multiplier }) => {
      const plot = document.querySelector<HTMLElement>(`.binned-scatter`)
      if (!plot) throw new Error(`Binned scatter plot not found`)
      const rect = plot.getBoundingClientRect()
      const samples: number[] = []

      for (let idx = 0; idx < 80; idx++) {
        const clientX = rect.left + rect.width * (0.15 + 0.7 * ((idx % 16) / 15))
        const clientY = rect.top + rect.height * (0.2 + 0.6 * (Math.floor(idx / 16) / 4))
        const start = performance.now()
        plot.dispatchEvent(
          new PointerEvent(`pointermove`, { bubbles: true, clientX, clientY }),
        )
        samples.push(performance.now() - start)
      }

      let clientX = rect.left + rect.width / 2
      let clientY = rect.top + rect.height / 2
      if (target === `known-point`) {
        if (!area) throw new Error(`Binned scatter plot area not found`)
        const data_x = 0.5
        const data_y = ((5_000 * pseudo_random_multiplier) % 1_000_000) / 1_000_000
        clientX = rect.left + area.left + ((data_x + 0.05) / 1.1) * area.width
        clientY = rect.top + area.top + (1 - (data_y + 0.05) / 1.1) * area.height
      }

      const click_start = performance.now()
      plot.dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX, clientY }))
      await Promise.resolve()

      const status_el = document.querySelector<HTMLElement>(
        `[data-testid="binned-scatter-status"]`,
      )
      return {
        hover_max_ms: Math.max(...samples),
        hover_avg_ms: samples.reduce((sum, value) => sum + value, 0) / samples.length,
        click_ms: performance.now() - click_start,
        zoom_count: Number(status_el?.dataset.zoomCount ?? 0),
        point_click_count: Number(status_el?.dataset.pointClickCount ?? 0),
      }
    },
    {
      target: click_target,
      area: known_point_bounds,
      pseudo_random_multiplier: PSEUDO_RANDOM_MULTIPLIER,
    },
  )
}

test(`loads and interacts with one million density points within browser latency budget`, async ({
  page,
}) => {
  await page.goto(`/test/binned-scatter?points=1000000`, {
    waitUntil: `domcontentloaded`,
  })
  const status = await wait_for_ready(page)
  const mount_ms = Number(await status.getAttribute(`data-mount-ms`))

  expect(await page.locator(`.colorbar .label`).textContent()).toBe(
    `Density (1,000,000 points)`,
  )
  expect(mount_ms).toBeLessThan(LOAD_BUDGET_MS)

  const timings = await measure_plot_interaction(page, `center`)

  expect(timings.hover_avg_ms).toBeLessThan(HOVER_BUDGET_MS)
  expect(timings.hover_max_ms).toBeLessThan(HOVER_BUDGET_MS * 3)
  expect(timings.click_ms).toBeLessThan(CLICK_BUDGET_MS)
  expect(timings.zoom_count).toBe(1)
})

test(`keeps point-mode hover and click lookup latency low`, async ({ page }) => {
  await page.goto(`/test/binned-scatter?mode=points&points=20000`, {
    waitUntil: `domcontentloaded`,
  })
  await wait_for_ready(page)

  const timings = await measure_plot_interaction(page, `known-point`)

  expect(timings.hover_avg_ms).toBeLessThan(HOVER_BUDGET_MS)
  expect(timings.hover_max_ms).toBeLessThan(HOVER_BUDGET_MS * 3)
  expect(timings.click_ms).toBeLessThan(HOVER_BUDGET_MS * 3)
  expect(timings.point_click_count).toBe(1)
})

test(`opens singleton density bins without a slow data scan`, async ({ page }) => {
  await page.goto(`/test/binned-scatter?mode=singleton`, {
    waitUntil: `domcontentloaded`,
  })
  await wait_for_ready(page)
  const singleton_bounds = await get_plot_area(page)

  const result = await page.evaluate(async (area) => {
    const plot = document.querySelector<HTMLElement>(`.binned-scatter`)
    if (!plot) throw new Error(`Binned scatter plot not found`)
    const rect = plot.getBoundingClientRect()
    const clientX = rect.left + area.left + 0.9 * area.width
    const clientY = rect.top + area.top + 0.1 * area.height
    const start = performance.now()
    plot.dispatchEvent(new MouseEvent(`click`, { bubbles: true, clientX, clientY }))
    await Promise.resolve()
    const status_el = document.querySelector<HTMLElement>(
      `[data-testid="binned-scatter-status"]`,
    )

    return {
      click_ms: performance.now() - start,
      point_click_count: Number(status_el?.dataset.pointClickCount ?? 0),
    }
  }, singleton_bounds)

  expect(result.click_ms).toBeLessThan(HOVER_BUDGET_MS)
  expect(result.point_click_count).toBe(1)
})
