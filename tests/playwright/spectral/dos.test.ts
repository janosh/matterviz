import { expect, type Locator, type Page, test } from '@playwright/test'
import { get_chart_svg, require_bbox } from '../helpers'

const curves = (plot: Locator) => plot.locator(`path.line, path[stroke]:not([stroke="none"])`)

// Move onto points along the first curve until one raises the tooltip; resolves to its text
const hover_until_tooltip = async (page: Page, plot: Locator): Promise<string> => {
  const tooltip = plot.locator(`.plot-tooltip`)
  await plot.scrollIntoViewIfNeeded()
  const points = await curves(get_chart_svg(plot))
    .first()
    .evaluate((element) => {
      const path = element as SVGPathElement
      const screen_matrix = path.getScreenCTM()
      if (!screen_matrix) throw new Error(`DOS curve has no screen transform`)
      const length = path.getTotalLength()
      return [0.5, 0.3, 0.7, 0.2, 0.8].map((fraction) => {
        const point = path.getPointAtLength(fraction * length).matrixTransform(screen_matrix)
        return { x: point.x, y: point.y }
      })
    })
  for (const { x, y } of points) {
    await page.mouse.move(x - 2, y)
    await page.mouse.move(x, y)
    const shown = await expect(tooltip)
      .toBeVisible({ timeout: 500 })
      .then(() => true)
      .catch(() => false)
    if (shown) return (await tooltip.textContent()) ?? ``
  }
  throw new Error(`no DOS tooltip at any probed curve point: ${JSON.stringify(points)}`)
}

// position of the earliest of `labels` in tooltip text (-1 if none occur)
const first_idx = (text: string, labels: string[]): number => {
  const indices = labels.map((label) => text.indexOf(label)).filter((idx) => idx >= 0)
  return indices.length > 0 ? Math.min(...indices) : -1
}

test.describe(`DOS Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/dos`, { waitUntil: `networkidle` })
  })

  test(`renders single DOS with axes, hides configured legend and resizes`, async ({
    page,
  }) => {
    const plot = page.locator(`[data-testid="dos-single"]`)
    await expect(curves(plot.locator(`svg`)).first()).toBeVisible()
    await expect(plot.locator(`g.x-axis .tick`).first()).toBeVisible()
    await expect(plot.locator(`g.y-axis .tick`).first()).toBeVisible()
    await expect(page.locator(`[data-testid="dos-no-legend"] .legend`)).toBeHidden()

    const initial_box = await require_bbox(plot, `plot`)
    await page.setViewportSize({ width: 800, height: 600 })
    await expect
      .poll(async () => (await plot.boundingBox())?.width)
      .not.toBe(initial_box.width)
  })

  test(`multiple DOS get a toggleable legend and series-labelled tooltips`, async ({
    page,
  }) => {
    const plot = page.locator(`[data-testid="dos-multiple"]`)
    const legend = plot.locator(`.legend`)
    await expect(legend.locator(`.legend-item`)).toHaveText([/DOS1/, /DOS2/])

    // the series label heads the tooltip, above density and frequency/energy
    const text = await hover_until_tooltip(page, plot)
    const label_idx = text.search(/DOS[12]/)
    expect(label_idx, text).toBeGreaterThan(-1)
    expect(label_idx, text).toBeLessThan(first_idx(text, [`Density`, `Frequency`, `Energy`]))

    const svg_curves = curves(plot.locator(`svg`))
    await expect(svg_curves).toHaveCount(2)
    await legend.locator(`.legend-item`).first().click()
    await expect(svg_curves).toHaveCount(1, { timeout: 2000 })
  })

  test(`applies max and sum normalization`, async ({ page }) => {
    const max_plot = page.locator(`[data-testid="dos-max-norm"]`)
    await expect(curves(max_plot).first()).toBeVisible()
    const y_ticks = (await max_plot.locator(`g.y-axis text`).allTextContents())
      .map((tick) => Number(tick.replaceAll(/[^\d.\-+eE]/g, ``)))
      .filter(Number.isFinite)
    expect(Math.max(...y_ticks)).toBeLessThanOrEqual(1.01) // margin for tick rounding
    await expect(curves(page.locator(`[data-testid="dos-sum-norm"]`)).first()).toBeVisible()
  })

  test(`renders stacked DOS and applies Gaussian smearing`, async ({ page }) => {
    // the second stacked curve sits on the first, so it spans more height
    const stacked = curves(page.locator(`[data-testid="dos-stacked"]`))
    await expect(stacked).toHaveCount(2)
    const [box_1, box_2] = await Promise.all([
      require_bbox(stacked.nth(0), `stacked curve 1`),
      require_bbox(stacked.nth(1), `stacked curve 2`),
    ])
    expect(box_2.height).toBeGreaterThan(box_1.height)

    // smoothing/interpolation yields many drawing commands
    const smeared = curves(page.locator(`[data-testid="dos-smeared"]`)).first()
    await expect(smeared).toBeVisible()
    const path_d = (await smeared.getAttribute(`d`)) ?? ``
    expect((path_d.match(/[MLCQSTVHZ]/g) ?? []).length).toBeGreaterThan(5)
  })

  test(`horizontal orientation swaps axes`, async ({ page }) => {
    const plot = page.locator(`[data-testid="dos-horizontal"]`)
    await expect(curves(plot).first()).toBeVisible()
    for (const axis of [`x`, `y`]) {
      const ticks = await plot.locator(`g.${axis}-axis text`).allTextContents()
      expect(
        ticks.some((tick) => !Number.isNaN(Number(tick))),
        `${axis} ticks`,
      ).toBe(true)
    }
    await expect(plot.locator(`.x-label`)).toContainText(/Density/i)
    await expect(plot.locator(`.y-label`)).toContainText(/(?:Frequency|Energy)/i)
  })

  test(`converts frequencies to different units`, async ({ page }) => {
    for (const unit of [`eV`, `meV`]) {
      await expect(
        page.locator(`[data-testid="dos-${unit.toLowerCase()}"] .x-label`),
      ).toContainText(unit)
    }
  })

  // the y-axis quantity leads the tooltip: density when vertical, frequency when horizontal
  for (const [orientation, test_id] of [
    [`vertical`, `dos-single`],
    [`horizontal`, `dos-horizontal`],
  ] as const) {
    test(`${orientation} tooltip orders density and frequency, hides on leave`, async ({
      page,
    }) => {
      const plot = page.locator(`[data-testid="${test_id}"]`)
      const text = await hover_until_tooltip(page, plot)
      const density_idx = text.indexOf(`Density`)
      const freq_idx = first_idx(text, [`Frequency`, `Energy`])
      expect(density_idx, text).toBeGreaterThan(-1)
      expect(freq_idx, text).toBeGreaterThan(-1)
      if (orientation === `vertical`) {
        expect(text).toMatch(/Density.*:/)
        expect(density_idx).toBeLessThan(freq_idx)
      } else expect(freq_idx).toBeLessThan(density_idx)

      const box = await require_bbox(plot, `plot`)
      await page.mouse.move(box.x - 50, box.y - 50)
      await expect(plot.locator(`.plot-tooltip`)).toBeHidden()
    })
  }
})
