import { expect, test } from '@playwright/test'

test(`corner and interior markers use a shape-following focus border`, async ({ page }) => {
  await page.goto(`/plot/ternary`, { waitUntil: `networkidle` })
  const plot = page.locator(`.ternary`).filter({ hasText: `Mixing path` })
  for (const point of [
    plot.locator(`[aria-label^="Endmembers:"]`).nth(1),
    plot.locator(`[aria-label^="Mixing path:"]`).nth(4),
  ]) {
    await point.click()
    await expect(point).toBeFocused()
    await expect(point).toHaveCSS(`outline-style`, `none`)
    await expect(point.locator(`.marker`)).toHaveCSS(`stroke-width`, `1.5px`)
    await expect(point.locator(`.marker`)).toHaveCSS(`vector-effect`, `non-scaling-stroke`)
    await point.press(`ArrowRight`)
    await expect(point).not.toBeFocused()
    const focused = plot.locator(`.points [data-ternary-idx]:focus`)
    await expect(focused).toHaveCSS(`outline-style`, `none`)
    await expect(focused.locator(`.marker`)).toHaveCSS(`stroke-width`, `1.5px`)
  }
})
