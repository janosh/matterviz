import { expect, type Locator, type Page, test } from '@playwright/test'
import { collect_console_errors, collect_page_errors, get_chart_svg } from '../helpers'

// Alt+drag a rect across the given fractions of a plot's svg
const alt_drag = async (page: Page, plot: Locator, from: number, to: number) => {
  const box = await get_chart_svg(plot).boundingBox()
  if (!box) throw new Error(`plot svg has no bounding box`)
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
  const console_errors = collect_console_errors(page)
  const page_errors = collect_page_errors(page)
  await page.goto(`/plot/linked-brushing`, { waitUntil: `networkidle` })
  const [radius_plot, melting_plot] = [0, 1].map((idx) => page.locator(`.scatter`).nth(idx))
  await expect(radius_plot.locator(`path.marker`).first()).toBeVisible()
  const dimmed = (plot: Locator) => plot.locator(`path.marker.is-dimmed`)
  await expect(dimmed(radius_plot)).toHaveCount(0)

  await alt_drag(page, radius_plot, 0.3, 0.7)
  // The brushed plot rings what it picked; both plots dim the rest by element symbol
  const n_rings = await radius_plot.locator(`circle.effect-ring.selected`).count()
  expect(n_rings).toBeGreaterThan(0)
  await expect(page.getByText(`${n_rings} selected:`)).toBeVisible()
  const n_radius = await radius_plot.locator(`path.marker`).count()
  await expect(dimmed(radius_plot)).toHaveCount(n_radius - n_rings)
  const n_melting_dimmed = await dimmed(melting_plot).count()
  expect(n_melting_dimmed).toBeGreaterThan(0)
  expect(n_melting_dimmed).toBeLessThan(await melting_plot.locator(`path.marker`).count())

  // Clicking a tile toggles that element. Helium has no Pauling electronegativity, so it is
  // never in the radius plot and the brush above cannot have picked it.
  await page.locator(`[data-element-symbol="He"]`).click()
  await expect(page.getByText(`${n_rings + 1} selected:`)).toBeVisible()
  await expect(radius_plot.locator(`circle.effect-ring.selected`)).toHaveCount(0)

  await page.getByRole(`button`, { name: `Clear` }).click()
  await expect(dimmed(radius_plot)).toHaveCount(0)
  await expect(dimmed(melting_plot)).toHaveCount(0)
  expect(console_errors).toEqual([])
  expect(page_errors).toEqual([])
})
