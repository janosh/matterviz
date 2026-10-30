import { expect, test } from '@playwright/test'

// Narrow, the plot and structure stack in one column: the hidden pane divider leaves a rule
test(`a narrow NEB viewer rules off its structure under the plot`, async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 1000 })
  await page.goto(`/neb`, { waitUntil: `networkidle` })
  const panes = page.locator(`.neb-viewer .panes`).first()
  await expect(panes.locator(`:scope > .pane-divider`)).toBeHidden()
  const structure = panes.locator(`:scope > .structure-pane`)
  await expect(structure).toHaveCSS(`border-top-width`, `1px`)
})
