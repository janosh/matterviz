import { expect, test } from '@playwright/test'
import { category_counts } from './element-data.test.ts'

test.describe(`Periodic Table`, async () => {
  test(`in default state`, async ({ page }) => {
    await page.goto(`/`)

    const element_tiles = await page.$$(`.element-tile`)
    expect(element_tiles).toHaveLength(118)

    for (const [category, count] of Object.entries(category_counts)) {
      const css_cls = `.${category.replaceAll(` `, `-`)}`
      expect(await page.$$(css_cls)).toHaveLength(count as number)
    }
  })

  test(`shows stats on hover element`, async ({ page }) => {
    await page.goto(`/`)

    await page.hover(`text=Hydrogen`)

    expect(await page.$(`text=1 - Hydrogen diatomic nonmetal`)).not.toBeNull()
  })

  test(`can hover every element without throwing errors`, async ({ page }) => {
    const logs: string[] = []
    page.on(`console`, (msg) => {
      if (
        msg.type() === `error` &&
        !msg.text().startsWith(`Failed to load resource:`)
      )
        logs.push(msg.text())
    })
    await page.goto(`/`)

    const element_tiles = await page.$$(`.element-tile`)
    for (const element_tile of element_tiles) {
      await element_tile.hover()
    }

    expect(logs).toHaveLength(0)
  })

  test(`in heatmap mode`, async ({ page }) => {
    test.skip(
      process.env.CI === `true`,
      `This test fails in CI at clicking click('text=Electronegativity')`
      // works locally, maybe due to faster CPU
    )

    await page.goto(`/`)

    await page.click(`[placeholder="Select a heat map"]`)

    // select electronegativity heatmap
    await page.click(`text=Electronegativity`)

    // make sure Fluorine electronegativity value is displayed correctly
    expect(await page.$(`text=9 F 3.98`)).not.toBeNull()
  })
})
