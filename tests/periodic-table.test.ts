import element_data from '$lib/element/data'
import {
  categories,
  category_counts,
  format_num,
  heatmap_keys,
  heatmap_labels,
} from '$lib/labels'
import { expect, test, type Page } from '@playwright/test'
import { random_sample } from '.'

test.describe(`Periodic Table`, () => {
  test(`in default state`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

    const element_tiles = await page.$$(`.element-tile`)
    const n_lanthanide_actinide_placeholders = 2
    expect(element_tiles).toHaveLength(
      element_data.length + n_lanthanide_actinide_placeholders,
    )

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

    for (const tile of random_sample(await page.$$(`.element-tile`), 5)) {
      await tile.hover()
    }

    expect(logs, logs.join(`\n`)).toHaveLength(0)
  })

  test.describe(`tooltips`, () => {
    // test utilities
    const get_element_tile = (page: Page, selector: string) =>
      page.locator(`.element-tile`).filter({ hasText: selector }).first()

    const get_tooltip = (page: Page) => page.locator(`.tooltip`)

    const clear_tooltip = async (page: Page) => {
      await page.mouse.move(0, 0)
      await page.waitForTimeout(100)
    }

    test(`shows default tooltip on element hover when no heatmap is selected`, async ({
      page,
    }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      await get_element_tile(page, `H`).hover()

      const tooltip = get_tooltip(page)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(`Hydrogen`)
      await expect(tooltip).toContainText(`H • 1`)
    })

    test(`shows custom tooltip with heatmap data when heatmap is selected`, async ({
      page,
    }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      // Select a heatmap property
      await page.click(`div.multiselect`)
      await page.click(`text=Atomic mass`)
      await page.waitForTimeout(500)

      await get_element_tile(page, `C`).hover()

      const tooltip = get_tooltip(page)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(`Carbon`)
      await expect(tooltip).toContainText(`C • 6`)
      await expect(tooltip).toContainText(`atomic_mass:`)

      // Check for enhanced data - position from element.column/row
      await expect(tooltip).toContainText(`Position: 14,2`)
      await expect(tooltip).toContainText(`Range:`)

      // Test with a different element
      await clear_tooltip(page)
      await get_element_tile(page, `O`).hover() // Oxygen at column 16, row 2

      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(`Position: 16,2`)
    })

    test(`tooltip follows mouse position`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      const hydrogen_tile = get_element_tile(page, `H`)
      const helium_tile = get_element_tile(page, `He`)
      const tooltip = get_tooltip(page)

      await hydrogen_tile.hover()
      await expect(tooltip).toBeVisible()
      const initial_box = await tooltip.boundingBox()
      expect(initial_box).not.toBeNull()

      await helium_tile.hover()
      await expect(tooltip).toBeVisible()
      const new_box = await tooltip.boundingBox()
      expect(new_box).not.toBeNull()

      expect(new_box!.x).not.toBe(initial_box!.x)
    })

    test(`tooltip disappears when mouse leaves element`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      await get_element_tile(page, `H`).hover()
      const tooltip = get_tooltip(page)
      await expect(tooltip).toBeVisible()

      await clear_tooltip(page)
      await expect(tooltip).not.toBeVisible()
    })

    // Streamlined content tests using shared data
    const test_elements = [
      { symbol: `H`, name: `Hydrogen`, number: `1` },
      { symbol: `O`, name: `Oxygen`, number: `8` },
      { symbol: `Fe`, name: `Iron`, number: `26` },
    ]

    for (const element of test_elements) {
      test(`tooltip shows correct content for ${element.name}`, async ({
        page,
      }) => {
        await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

        await clear_tooltip(page)

        const element_tile = page
          .locator(`.element-tile`)
          .filter({
            hasText: new RegExp(`^\\s*${element.number}\\s+${element.symbol}`),
          })
          .first()

        await element_tile.hover()

        const tooltip = get_tooltip(page)
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toContainText(element.name)
        await expect(tooltip).toContainText(
          `${element.symbol} • ${element.number}`,
        )
      })
    }

    test(`tooltip works with different heatmap properties`, async ({
      page,
    }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      const test_properties = [`Atomic mass`, `Boiling point`]

      for (const property of test_properties) {
        // Select heatmap property
        await page.click(`div.multiselect`)
        await page.click(`text=${property}`)
        await page.waitForTimeout(500)

        await get_element_tile(page, `C`).hover()

        const tooltip = get_tooltip(page)
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toContainText(`Carbon`)
        await expect(tooltip).toContainText(`C • 6`)

        // Reset selection
        await page.click(`div.multiselect`)
        const clear_option = page
          .locator(`[role="option"]`)
          .filter({ hasText: /^$/ })
          .first()
        if (await clear_option.isVisible()) {
          await clear_option.click()
        } else {
          await page.keyboard.press(`Escape`)
          await page.evaluate(() => {
            const select = document.querySelector(`select`)
            if (select) {
              select.value = ``
              select.dispatchEvent(new Event(`input`, { bubbles: true }))
            }
          })
        }
        await page.waitForTimeout(300)
      }
    })
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

      // check 5 random element tiles display the expected heatmap value
      for (const rand_elem of random_sample(element_data, 5)) {
        const last_heatmap_key = heatmap_keys.at(-1)
        if (!last_heatmap_key) continue
        const heatmap_value = rand_elem[last_heatmap_key]
        if (typeof heatmap_value !== `number`) continue
        const heatmap_val = format_num(heatmap_value)

        // make sure heatmap value is displayed correctly
        const text = `${rand_elem.number} ${rand_elem.symbol} ${heatmap_val}`
        const elem_tile = await page.$(`text=${text}`, { strict: true })
        await page.pause()
        expect(elem_tile, `selector text=${text}`).not.toBeNull()
      }
    })
  })
})
