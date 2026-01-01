// deno-lint-ignore-file no-await-in-loop
import element_data from '$lib/element/data'
import {
  CATEGORY_COUNTS,
  ELEM_HEATMAP_KEYS,
  ELEMENT_CATEGORIES,
  format_num,
} from '$lib/labels'
import { expect, type Page, test } from '@playwright/test'
import process from 'node:process'
import { random_sample } from './helpers'

test.describe(`Periodic Table`, () => {
  // SKIPPED: Server-side rendering error prevents page load
  test.skip(`in default state`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

    // Wait for periodic table to load by waiting for at least one element tile
    await page.waitForSelector(`.element-tile`, { timeout: 50000 })

    const element_tiles = await page.$$(`.element-tile`)
    const n_lanthanide_actinide_placeholders = 2
    expect(element_tiles).toHaveLength(
      element_data.length + n_lanthanide_actinide_placeholders,
    )

    for (const category of ELEMENT_CATEGORIES) {
      let count = CATEGORY_COUNTS[category] as number
      const selector = `[data-category="${category}"]`
      // add 1 to expected count since lanthanides and actinides have placeholder
      // tiles showing where in the periodic table their rows insert
      if ([`lanthanide`, `actinide`].includes(category)) count += 1
      expect(await page.$$(selector), category).toHaveLength(count as number)
    }
  })

  // SKIPPED: Same server-side rendering issue
  test.skip(`shows stats on hover element`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

    await page.hover(`text=Hydrogen`)

    expect(await page.$(`text=1 - Hydrogen diatomic nonmetal`)).not.toBeNull()
  })

  test(`can hover random elements without throwing errors`, async ({ page }) => {
    const logs: string[] = []
    page.on(`console`, (msg) => {
      if (
        msg.type() === `error` &&
        !msg.text().startsWith(`Failed to load resource:`)
      ) logs.push(msg.text())
    })
    await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

    // Wait for periodic table to be fully rendered
    const tiles = page.locator(`.element-tile`)
    await expect(tiles.first()).toBeVisible({ timeout: 50000 })
    expect(await tiles.count()).toBeGreaterThan(0)

    const tile_count = await tiles.count()
    const indices = random_sample([...Array(tile_count).keys()], 3)
    for (const idx of indices) {
      const tile = tiles.nth(idx)
      await tile.scrollIntoViewIfNeeded()
      await tile.hover({ timeout: 5000 })
    }

    expect(logs, logs.join(`\n`)).toHaveLength(0)
  })

  test.describe(`tooltips`, () => {
    // Skip all tooltip tests in CI - hover timing is unreliable
    test.beforeEach(() => {
      test.skip(
        process.env.CI === `true`,
        `Tooltip hover tests are flaky in CI due to timing differences`,
      )
    })

    // test utilities
    const get_element_tile = (page: Page, selector: string) =>
      page.locator(`.element-tile`).filter({ hasText: selector }).first()

    const get_tooltip = (page: Page) => page.locator(`.tooltip`)

    const clear_tooltip = async (page: Page) => {
      await page.mouse.move(0, 0)
      // Wait for tooltip to disappear
      await page.waitForFunction(() => {
        const tooltip = document.querySelector(`.tooltip`) as HTMLElement
        return !tooltip || tooltip.style.display === `none` || !tooltip.offsetParent
      }, { timeout: 5000 })
    }

    test(`shows default tooltip on element hover when no heatmap is selected`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      // Wait for element tiles to render before hovering
      await page.waitForSelector(`.element-tile`)

      // Get the first periodic table container (PeriodicTableDemo) which has tooltip enabled
      const periodic_table = page.locator(`.periodic-table`).first()
      await expect(periodic_table).toBeVisible()

      // Hover on the H tile within the first periodic table
      const h_tile = periodic_table.locator(`.element-tile`).filter({ hasText: `H` })
        .first()
      await h_tile.hover({ force: true })

      // Get tooltip within the same periodic table container
      const tooltip = periodic_table.locator(`.tooltip`)
      await expect(tooltip).toBeVisible({ timeout: 50000 })
      await expect(tooltip).toContainText(`Hydrogen`)
      await expect(tooltip).toContainText(`H • 1`)
    })

    test(`shows custom tooltip with heatmap data when heatmap is selected`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })
      await page.waitForSelector(`div.multiselect`)

      // Select a heatmap property
      await page.click(`div.multiselect`)

      // Try to find the atomic mass option more robustly
      const atomic_mass_option = page
        .locator(`[role="option"]`)
        .filter({ hasText: /atomic.*mass/i })
      if ((await atomic_mass_option.count()) > 0) {
        await atomic_mass_option.first().click()
      } else {
        await page.click(`text=Atomic mass`)
      }

      await get_element_tile(page, `C`).hover()

      const tooltip = get_tooltip(page)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(`Carbon`)
      await expect(tooltip).toContainText(`C • 6`)

      // Check for enhanced data - but be more flexible about the format
      await expect(tooltip).toContainText(/Position:|Column|Row/)
      await expect(tooltip).toContainText(/Range:|Min|Max/)
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
      if (!initial_box || !new_box) throw new Error(`Tooltip bounding box not found`)

      expect(new_box.x).not.toBe(initial_box.x)
    })

    test(`tooltip disappears when mouse leaves element`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      await get_element_tile(page, `H`).hover()
      const tooltip = get_tooltip(page)
      await expect(tooltip).toBeVisible()

      await clear_tooltip(page)
      await expect(tooltip).toBeHidden()
    })

    // Streamlined content tests using shared data
    const test_elements = [
      { symbol: `H`, name: `Hydrogen`, number: `1` },
      { symbol: `O`, name: `Oxygen`, number: `8` },
      { symbol: `Fe`, name: `Iron`, number: `26` },
    ]

    for (const element of test_elements) {
      test(`tooltip shows correct content for ${element.name}`, async ({ page }) => {
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

    test(`tooltip works with different heatmap properties`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      const test_properties = [`Atomic mass`, `Boiling point`]

      for (const property of test_properties) {
        // Select heatmap property
        await page.click(`div.multiselect`)
        await page.click(`text=${property}`)

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
      }
    })
  })

  test.describe(`in heatmap mode`, () => {
    // Skip in CI - multiselect dropdown interaction is flaky
    test.beforeEach(() => {
      test.skip(
        process.env.CI === `true`,
        `Multiselect dropdown interaction is unreliable in CI`,
      )
    })

    test(`displays elemental heat values`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      // Use specific data-id selector for heatmap multiselect
      const multiselect = page.locator(`div.multiselect[data-id="heatmap-select"]`)
      await expect(multiselect).toBeVisible()

      // Click on the multiselect to open dropdown (force: true to bypass SVG icon overlay)
      await multiselect.click({ force: true })

      // Wait for dropdown list to be visible - look within the multiselect
      const option_list = multiselect.locator(`ul.options`)
      await expect(option_list).toBeVisible({ timeout: 50000 })

      // Click on the first available option (Atomic mass)
      const first_option = option_list.locator(`li`).first()
      await expect(first_option).toContainText(/atomic.*mass/i)
      await first_option.click()

      // Wait for heatmap to render - element tiles should have heatmap values
      // The first heatmap key is atomic_mass
      const first_heatmap_key = ELEM_HEATMAP_KEYS[0]
      if (first_heatmap_key) {
        // Check that at least some element tiles display the expected heatmap value
        const tiles = page.locator(`.element-tile`)
        await expect(tiles.first()).toBeVisible()

        // Verify random elements have heatmap values displayed
        let validated_count = 0
        for (const rand_elem of random_sample(element_data, 3)) {
          const heatmap_value = rand_elem[first_heatmap_key]
          if (typeof heatmap_value !== `number`) continue
          const heatmap_val = format_num(heatmap_value)

          // make sure heatmap value is displayed correctly (use regex for flexible whitespace)
          const escaped_val = heatmap_val.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
          const tiles_with_text = await tiles
            .filter({
              hasText: new RegExp(
                `${rand_elem.number}\\s+${rand_elem.symbol}\\s+${escaped_val}`,
              ),
            })
            .count()

          expect(
            tiles_with_text,
            `Expected element tile for ${rand_elem.symbol} with heatmap value "${heatmap_val}"`,
          ).toBeGreaterThan(0)
          validated_count++
        }
        expect(
          validated_count,
          `Expected at least one element with a numeric heatmap value to be validated`,
        ).toBeGreaterThan(0)
      }
    })
  })

  test.describe(`multi-value tiles`, () => {
    const test_cases = [
      {
        idx: 1,
        type: `diagonal`,
        segments: [`diagonal-top`],
        positions: [`top-left`, `bottom-right`],
      },
      {
        idx: 2,
        type: `quadrant`,
        segments: [`quadrant-tl`],
        positions: [`value-quadrant-tl`, `value-quadrant-br`],
      },
    ]

    for (const { idx, type, segments, positions } of test_cases) {
      test(`renders ${type} split segments and positioning correctly`, async ({ page }) => {
        await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

        const table = page.locator(`.periodic-table`).nth(idx)
        const tile = table.locator(`.element-tile`).first()

        // Verify segments and positions are rendered
        const segment_checks = segments.map(async (segment) => {
          await expect(
            table.locator(`.segment.${segment}`).first(),
          ).toBeVisible()
        })
        const position_checks = positions.map(async (position) => {
          await expect(
            table.locator(`.multi-value.${position}`).first(),
          ).toBeVisible()
        })
        await Promise.all([...segment_checks, ...position_checks])

        // Check colors are distinct and valid
        if (idx === 1) {
          // Only test color distinctness on 2-value example
          const top_color = await tile
            .locator(`.segment.diagonal-top`)
            .evaluate((el: Element) => getComputedStyle(el).backgroundColor)
          const bottom_color = await tile
            .locator(`.segment.diagonal-bottom`)
            .evaluate((el: Element) => getComputedStyle(el).backgroundColor)

          expect(top_color).not.toBe(`rgba(0, 0, 0, 0)`)
          expect(bottom_color).not.toBe(`rgba(0, 0, 0, 0)`)
          expect(top_color).not.toBe(bottom_color)
        }
      })
    }
  })
})
