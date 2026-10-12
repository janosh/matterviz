import { expect, type Locator, type Page } from '@playwright/test'
import { get_chart_svg, require_bbox, test_without_errors as test } from '../helpers'

// Alt+drag a rect across the given fractions of a plot's svg
const alt_drag = async (page: Page, plot: Locator, from: number, to: number) => {
  const box = await require_bbox(get_chart_svg(plot), `plot svg`)
  await page.keyboard.down(`Alt`)
  await page.mouse.move(box.x + box.width * from, box.y + box.height * from)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to, box.y + box.height * to, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up(`Alt`)
}

test(`brushing one plot dims the same elements in the other plot and the periodic table`, async ({
  page,
}) => {
  await page.goto(`/plot/linked-brushing`, { waitUntil: `networkidle` })
  const [radius_plot, melting_plot] = [0, 1].map((idx) => page.locator(`.scatter`).nth(idx))
  await expect(radius_plot.locator(`path.marker`).first()).toBeVisible()
  const dimmed = (plot: Locator) => plot.locator(`path.marker.is-dimmed`)

  await alt_drag(page, radius_plot, 0.3, 0.7)
  // The brushed plot rings what it picked; both plots dim the rest by element symbol
  const n_rings = await radius_plot.locator(`circle.effect-ring.selected`).count()
  expect(n_rings).toBeGreaterThan(0)
  await expect(page.getByText(`${n_rings} selected:`)).toBeVisible()
  const n_radius = await radius_plot.locator(`path.marker`).count()
  await expect(dimmed(radius_plot)).toHaveCount(n_radius - n_rings)
  await expect(dimmed(melting_plot)).not.toHaveCount(0)

  // Clicking a tile toggles that element. Helium has no electronegativity, so it is
  // never in the radius plot and the brush above cannot have picked it.
  await page.locator(`[data-element-symbol="He"]`).click()
  await expect(page.getByText(`${n_rings + 1} selected:`)).toBeVisible()
  await expect(radius_plot.locator(`circle.effect-ring.selected`)).toHaveCount(0)

  await page.getByRole(`button`, { name: `Clear` }).click()
  await expect(dimmed(radius_plot)).toHaveCount(0)
  await expect(dimmed(melting_plot)).toHaveCount(0)
})
