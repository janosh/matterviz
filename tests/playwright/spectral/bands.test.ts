import { expect, type Locator, test } from '@playwright/test'
import { require_bbox } from '../helpers'

const band_paths = (plot: Locator) => plot.locator(`svg path[fill="none"]`)
const x_axis_labels = async (plot: Locator) =>
  (await plot.locator(`g.x-axis text`).allTextContents()).join(`,`)

// SVG path elements have zero-size bounding boxes, so force: true is needed for hover. The
// nearest point can resolve to a neighbouring band, so re-hover until the tooltip matches.
const hover_expect_tooltip = (plot: Locator, path: Locator, expected: (string | RegExp)[]) =>
  expect(async () => {
    await path.hover({ force: true })
    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 500 })
    for (const text of expected) await expect(tooltip).toContainText(text, { timeout: 500 })
  }).toPass({ timeout: 5000 })

test.describe(`Bands Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bands`, { waitUntil: `networkidle` })
  })

  test(`renders single band structure with axes and high-symmetry labels`, async ({
    page,
  }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    await expect(plot).toBeVisible()
    // 4 bands expected from mock data
    const paths = band_paths(plot)
    await expect(paths.first()).toBeVisible()
    await expect(paths).toHaveCount(4)

    await expect(plot.locator(`g.x-axis`)).toBeVisible()
    await expect(plot.locator(`g.y-axis`)).toBeVisible()
    const x_labels = await x_axis_labels(plot)
    expect(x_labels).toContain(`Γ`)
    expect(x_labels).toContain(`X`)
    const y_ticks = await plot.locator(`g.y-axis text`).allTextContents()
    expect(y_ticks.filter((tick) => !isNaN(Number(tick))).length).toBeGreaterThan(2)
  })

  // path_count null only requires that bands rendered
  for (const [id, path_count, x_labels] of [
    [`union-path`, null, []],
    [`intersection-path`, null, []],
    [`union-non-canonical`, null, [`K`]], // K only exists in alt_path
    // U-K is discontinuous and draws no paths: 2 continuous branches × 4 bands
    [`discontinuity`, 8, [`U | K`, `Γ`, `X`, `L`]],
    [`electronic-spin-down-only`, 4, []],
  ] as const) {
    test(`renders ${id} plot with band paths and labels`, async ({ page }) => {
      const plot = page.getByTestId(`${id}-plot`)
      await expect(plot).toBeVisible()
      const paths = band_paths(plot)
      await expect(paths.first()).toBeVisible()
      if (path_count !== null) await expect(paths).toHaveCount(path_count)
      const labels = await x_axis_labels(plot)
      for (const label of x_labels) expect(labels).toContain(label)
    })
  }

  test(`renders multiple band structures with toggleable legend`, async ({ page }) => {
    const plot = page.getByTestId(`multiple-bands-plot`)
    const paths = band_paths(plot)
    const legend = plot.locator(`.legend`)
    await expect(legend).toBeVisible()
    const legend_items = legend.locator(`.legend-item`)
    await expect(legend_items).toHaveCount(2)
    await expect(legend).toContainText(`BS1`)
    await expect(legend).toContainText(`BS2`)

    // 2 structures × 4 bands
    await expect(paths).toHaveCount(8)
    await legend_items.first().click()
    await expect(paths).toHaveCount(4, { timeout: 2000 })
    await legend_items.first().click()
    await expect(paths).toHaveCount(8, { timeout: 2000 })
  })

  test(`applies custom line styling and hides legend when configured`, async ({ page }) => {
    const first_path = band_paths(page.getByTestId(`custom-styling-plot`)).first()
    await expect(first_path).toBeVisible()
    expect(await first_path.evaluate((el) => getComputedStyle(el).stroke)).toBeTruthy()
    await expect(page.getByTestId(`no-legend-plot`).locator(`.legend`)).toBeHidden()
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const initial_box = await require_bbox(plot, `plot`)
    await page.setViewportSize({ width: 800, height: 600 })
    await expect
      .poll(async () => (await plot.boundingBox())?.width, { timeout: 2000 })
      .not.toBe(initial_box.width)
    await expect(plot).toBeVisible()
  })

  test(`shows error state for strict mode path mismatches`, async ({ page }) => {
    const plot = page.getByTestId(`strict-mismatch-plot`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`svg`)).toHaveCount(0)
    await expect(plot).toContainText(`different q-point paths`)
  })

  test(`tooltip shows frequency, path and band index, and hides when the mouse leaves`, async ({
    page,
  }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const first_path = band_paths(plot).first()
    await expect(first_path).toBeVisible()
    await hover_expect_tooltip(plot, first_path, [`THz`, `→`, /Band:\s*\d+/])

    const box = await require_bbox(plot, `plot`)
    await page.mouse.move(box.x - 50, box.y - 50)
    await expect(plot.locator(`.plot-tooltip`)).toBeHidden()
  })

  test(`tooltip shows series label with multiple band structures`, async ({ page }) => {
    const plot = page.getByTestId(`multiple-bands-plot`)
    const first_path = band_paths(plot).first()
    await expect(first_path).toBeVisible()
    await hover_expect_tooltip(plot, first_path, [/BS[12]/, `THz`, `→`])
  })

  test(`tooltip switches band index and content between bands`, async ({ page }) => {
    const plot = page.getByTestId(`single-bands-plot`)
    const paths = band_paths(plot)
    await expect(paths.first()).toBeVisible()
    const tooltip = plot.locator(`.plot-tooltip`)
    await hover_expect_tooltip(plot, paths.nth(0), [/Band:\s*1/])
    await hover_expect_tooltip(plot, paths.nth(2), [/Band:\s*3/])

    // Bounding-box centers can resolve to the same nearby discrete point, so target
    // exact endpoints on the lowest and highest bands.
    const hover_path_start = async (path_idx: number) => {
      const screen_point = await paths.nth(path_idx).evaluate((element) => {
        const svg_path = element as SVGPathElement
        const screen_matrix = svg_path.getScreenCTM()
        if (!screen_matrix) throw new Error(`Band path has no screen transform`)
        const path_start = svg_path.getPointAtLength(0).matrixTransform(screen_matrix)
        return { x: path_start.x + 2, y: path_start.y }
      })
      await page.mouse.move(screen_point.x, screen_point.y)
    }
    await expect(async () => {
      await hover_path_start(3)
      await expect(tooltip).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 5000 })
    const first_text = await tooltip.textContent()
    expect(first_text).toBeTruthy()
    await expect(async () => {
      await hover_path_start(0)
      expect(await tooltip.textContent()).not.toBe(first_text)
    }).toPass({ timeout: 5000 })
  })

  test(`applies phonon unit conversion and renders custom highlight region`, async ({
    page,
  }) => {
    const plot = page.getByTestId(`phonon-units-highlight-plot`)
    await expect(plot).toBeVisible()
    // unit lives in the y-axis label ("Frequency (cm⁻¹)"), not the tick text
    await expect(plot.locator(`.axis-label.y-label`)).toContainText(`cm⁻¹`)
    await expect(plot.locator(`svg path`).first()).toBeVisible()
  })

  test(`renders electronic spin overlay channels and gap annotation`, async ({ page }) => {
    const plot = page.getByTestId(`electronic-spin-overlay-plot`)
    await expect(plot).toBeVisible()
    const line_paths = band_paths(plot)
    await expect(line_paths.first()).toBeVisible()
    expect(await line_paths.count()).toBeGreaterThan(4)
    await expect(plot.locator(`svg text`).filter({ hasText: `Eg:` })).toBeVisible()
  })
})
