import { expect, test } from '@playwright/test'

test(`trajectory spectroscopy demo renders four linked molecular facets and provenance`, async ({
  page,
}) => {
  await page.goto(`/trajectory/spectroscopy`, { waitUntil: `networkidle` })
  const facets = page.getByTestId(`trajectory-spectroscopy-facets`)
  await expect(facets).toBeVisible()
  await expect(facets.locator(`[data-facet-key]`)).toHaveCount(4)
  await expect(facets).toContainText(`H2O`)
  await expect(facets).toContainText(`NH3`)
  await expect(facets).toContainText(`CH4`)
  await expect(facets).toContainText(`CO2`)
  await expect(facets).toContainText(`Relative Raman`)
  await expect(page.getByRole(`heading`, { name: `Reference provenance` })).toBeVisible()
  await expect(page.getByRole(`link`, { name: `NIST WebBook cross-reference` })).toHaveCount(4)
})
