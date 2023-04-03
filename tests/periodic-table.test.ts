import { expect, test } from '@playwright/test'
import element_data from '../src/lib/element-data.ts'
import {
  categories,
  category_counts,
  heatmap_keys,
  heatmap_labels,
  pretty_num,
} from '../src/lib/labels.ts'

test.describe(`Periodic Table`, () => {
  test(`in default state`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

    const element_tiles = await page.$$(`.element-tile`)
    expect(element_tiles).toHaveLength(element_data.length + 2)

    for (const category of categories) {
      let count = category_counts[category] as number
      const css_cls = `.${category.replaceAll(` `, `-`)}`
      // add 1 to expected count since lanthanides and actinides have placeholder
      // tiles showing where in the periodic table their rows insert
      if ([`lanthanide`, `actinide`].includes(category)) count += 1
      expect(await page.$$(css_cls), category).toHaveLength(count as number)
    }
  })

  test(`shows stats on hover element`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

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
    await page.goto(`/`, { waitUntil: `networkidle` })

    const element_tiles = await page.$$(`.element-tile`)
    for (const element_tile of element_tiles) {
      await element_tile.hover()
    }

    expect(logs, logs).toHaveLength(0)
  })

  test.describe(`in heatmap mode`, () => {
    test(`displays elemental heat values`, async ({ page }) => {
      await page.goto(`/`, { waitUntil: `networkidle` })

      // select all heatmaps in sequence making sure non of them crash
      for (const heatmap_label of Object.keys(heatmap_labels)) {
        await page.click(`div.multiselect`)
        // somehow clicking twice helps not to get stuck with a closed multi-select dropdown
        await page.click(`div.multiselect`)
        await page.click(`text=${heatmap_label}`)
      }

      for (const _ of [...Array(5)]) {
        // check 5 random element tiles display the expected heatmap value

        const rand_idx = Math.floor(Math.random() * element_data.length)
        const random_element = element_data[rand_idx]

        const heatmap_val = pretty_num(random_element[heatmap_keys.at(-1)])

        // make sure heatmap value is displayed correctly
        const text = `${rand_idx + 1} ${random_element.symbol} ${heatmap_val}`
        const elem_tile = await page.$(`text=${text}`, { strict: true })
        await page.pause()
        expect(elem_tile, `selector text=${text}`).not.toBeNull()
      }
    })
  })
})
