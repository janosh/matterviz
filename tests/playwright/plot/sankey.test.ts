import { expect, test } from '@playwright/test'

// Counts, gradients, legend and handler payloads are pinned in tests/vitest/plot/Sankey.test.ts;
// this checks a real pointer hover reaches the laid-out node
test(`shows tooltip and updates handler info on node hover`, async ({ page }) => {
  await page.goto(`/test/sankey`, { waitUntil: `networkidle` })
  const section = page.locator(`#handlers-sankey`)
  const plot = section.locator(`.sankey`)
  await plot.locator(`.nodes rect`).first().hover()
  await expect(plot.locator(`.plot-tooltip`)).toBeVisible()
  await expect(section.locator(`.handler-info`)).toContainText(`Node:`)
})
