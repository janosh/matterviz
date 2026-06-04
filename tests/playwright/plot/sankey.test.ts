import { expect, test } from '@playwright/test'
import { IS_CI } from '../helpers'

test.describe(`Sankey Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/sankey`, { waitUntil: `networkidle` })
  })

  test(`renders nodes, links and labels`, async ({ page }) => {
    test.skip(IS_CI, `Sankey rendering flaky in CI`)
    const plot = page.locator(`#basic-sankey .sankey`)
    await expect(plot).toBeVisible()

    // 6 nodes, 5 links in the basic flow fixture
    await expect(plot.locator(`.nodes rect`)).toHaveCount(6)
    await expect(plot.locator(`.links path`)).toHaveCount(5)
    await expect(plot.locator(`.node-label`).first()).toBeVisible()
  })

  test(`gradient mode emits one linearGradient per link and a legend`, async ({ page }) => {
    const plot = page.locator(`#gradient-sankey .sankey`)
    await expect(plot).toBeVisible()
    await expect(plot.locator(`linearGradient`)).toHaveCount(5)
    await expect(plot.locator(`.legend`)).toBeVisible()
  })

  test(`shows tooltip and updates handler info on node hover`, async ({ page }) => {
    test.skip(IS_CI, `hover flaky in CI`)
    const section = page.locator(`#handlers-sankey`)
    const plot = section.locator(`.sankey`)
    await plot.locator(`.nodes rect`).first().hover()
    await expect(plot.locator(`.plot-tooltip`)).toBeVisible()
    await expect(section.locator(`.handler-info`)).toContainText(`Node:`)
  })

  test(`opens the controls pane`, async ({ page }) => {
    const section = page.locator(`#vertical-sankey`)
    await section.locator(`.sankey-controls-toggle`).click()
    await expect(section.locator(`.sankey-controls-pane`)).toBeVisible()
  })
})
