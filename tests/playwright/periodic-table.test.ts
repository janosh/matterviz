import {
  CATEGORY_COUNTS,
  ELEM_HEATMAP_KEYS,
  ELEMENT_CATEGORIES,
  format_num,
} from '$lib/labels'
import { expect, type Locator, type Page, test } from '@playwright/test'
import element_data from './element-data'
import { random_sample } from './helpers'

test.describe(`Periodic Table`, () => {
  // Open the heatmap multiselect dropdown, retrying the click until the options
  // list appears. Under CI contention svelte-multiselect may not be hydrated when
  // the first click lands (so it no-ops); re-clicking once interactive opens it.
  // Returns the options list locator. Short inner timeout lets toPass re-click.
  const open_heatmap_select = async (page: Page) => {
    const multiselect = page.locator(`div.multiselect[data-id="heatmap-select"]`)
    await expect(multiselect).toBeVisible({ timeout: 15_000 })
    const option_list = multiselect.locator(`ul.options`)
    await expect(async () => {
      await multiselect.click({ force: true })
      await expect(option_list).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20_000 })
    return option_list
  }

  test(`in default state`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

    // Get the first periodic table on the page (homepage has multiple periodic tables)
    const periodic_table = page.locator(`.ptable-grid`).first()
    await expect(periodic_table).toBeVisible({ timeout: 20000 })

    // Wait for periodic table to load by waiting for at least one element tile
    const tiles = periodic_table.locator(`.element-tile`)
    await expect(tiles.first()).toBeVisible({ timeout: 20000 })

    const tile_count = await tiles.count()
    const n_lanthanide_actinide_placeholders = 2
    expect(tile_count).toBe(element_data.length + n_lanthanide_actinide_placeholders)

    for (const category of ELEMENT_CATEGORIES) {
      let count = CATEGORY_COUNTS[category]
      // Scope selector to the first periodic table
      const category_tiles_selector = periodic_table.locator(`[data-category="${category}"]`)
      // add 1 to expected count since lanthanides and actinides have placeholder
      // tiles showing where in the periodic table their rows insert
      if ([`lanthanide`, `actinide`].includes(category)) count += 1
      const category_tiles = await category_tiles_selector.count()
      expect(category_tiles, category).toBe(count)
    }
  })

  test(`shows stats on hover element`, async ({ page }) => {
    await page.goto(`/`, { waitUntil: `networkidle` })

    // Wait for element tiles to be visible
    const hydrogen_tile = page.locator(`.element-tile`).filter({ hasText: `H` }).first()
    await expect(hydrogen_tile).toBeVisible({ timeout: 20000 })

    // force: true needed because element tiles have layered content (symbol, number, name)
    // that can intercept hover events depending on mouse position within the tile
    await hydrogen_tile.hover({ force: true })

    // Check for stats display - use flexible assertion with retry
    await expect(page.locator(`text=1 - Hydrogen`)).toBeVisible({ timeout: 15_000 })
  })

  test(`can hover random elements without throwing errors`, async ({ page }) => {
    const logs: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) logs.push(msg.text())
    })
    await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

    // Wait for periodic table to be fully rendered
    const tiles = page.locator(`.element-tile`)
    await expect(tiles.first()).toBeVisible({ timeout: 20000 })
    expect(await tiles.count()).toBeGreaterThan(0)

    const tile_count = await tiles.count()
    const indices = random_sample([...Array(tile_count).keys()], 3)
    for (const idx of indices) {
      const tile = tiles.nth(idx)
      await tile.scrollIntoViewIfNeeded()
      await tile.hover({ timeout: 15_000 })
    }

    expect(logs, logs.join(`\n`)).toHaveLength(0)
  })

  test.describe(`tooltips`, () => {
    // Configure retries for tooltip tests which can be timing-sensitive
    test.describe.configure({ retries: 2 })

    // test utilities
    const get_element_tile = (page: Page, selector: string) =>
      page.locator(`.element-tile`).filter({ hasText: selector }).first()

    const get_tooltip = (page: Page) => page.locator(`.tooltip`)

    const clear_tooltip = async (page: Page) => {
      // Move mouse away from any element tile to trigger tooltip hide
      await page.mouse.move(0, 0)
      // The tooltip uses conditional rendering ({#if tooltip_visible}),
      // so when hidden, it doesn't exist in the DOM at all
      const tooltip = page.locator(`.tooltip`)
      await expect(tooltip).toHaveCount(0, { timeout: 15_000 })
    }

    // Hover an element tile until its tooltip appears, returning the tooltip
    // locator. Retries the whole hover (move away first to re-arm mouseenter)
    // because a single hover landing before the page is interactive (common
    // under CI contention) leaves the mouse stationary, so retrying only the
    // assertion can't make the tooltip appear. Short inner timeout lets toPass
    // re-hover instead of blocking on one attempt.
    const hover_until_tooltip = async (page: Page, tile: Locator) => {
      const tooltip = get_tooltip(page)
      await expect(async () => {
        await page.mouse.move(0, 0)
        await tile.hover({ force: true })
        await expect(tooltip).toBeVisible({ timeout: 2000 })
      }).toPass({ timeout: 15_000 })
      return tooltip
    }

    test(`shows default tooltip on element hover when no heatmap is selected`, async ({
      page,
    }) => {
      await page.goto(`/periodic-table`)

      // Wait for element tiles to render before hovering
      await page.waitForSelector(`.element-tile`, { timeout: 10000 })

      // Get the first periodic table container (PeriodicTableDemo) which has tooltip enabled
      const periodic_table = page.locator(`.ptable-grid`).first()
      await expect(periodic_table).toBeVisible({ timeout: 10000 })

      // Hover on the H tile within the first periodic table (retries until tooltip shows)
      const h_tile = periodic_table.locator(`.element-tile`).filter({ hasText: `H` }).first()
      await expect(h_tile).toBeVisible({ timeout: 15_000 })

      const tooltip = await hover_until_tooltip(page, h_tile)
      await expect(tooltip).toContainText(`Hydrogen`, { timeout: 15_000 })
      await expect(tooltip).toContainText(`H • 1`)
    })

    test(`shows custom tooltip with heatmap data when heatmap is selected`, async ({
      page,
    }) => {
      await page.goto(`/periodic-table`)
      const option_list = await open_heatmap_select(page)
      const first_option = option_list.locator(`li`).first()
      await first_option.click()

      // Close dropdown by clicking outside before hovering on tile
      await page.mouse.click(10, 10)
      await expect(option_list).not.toBeVisible()

      const tooltip = await hover_until_tooltip(page, get_element_tile(page, `C`))
      await expect(tooltip).toContainText(`Carbon`, { timeout: 15_000 })
      await expect(tooltip).toContainText(`C • 6`)

      // Check for enhanced data - but be more flexible about the format
      await expect(tooltip).toContainText(/Position:|Column|Row/)
      await expect(tooltip).toContainText(/Range:|Min|Max/)
    })

    test(`tooltip follows mouse position`, async ({ page }) => {
      await page.goto(`/periodic-table`)

      const hydrogen_tile = get_element_tile(page, `H`)
      const helium_tile = get_element_tile(page, `He`)

      const tooltip = await hover_until_tooltip(page, hydrogen_tile)
      const initial_box = await tooltip.boundingBox()
      expect(initial_box).not.toBeNull()

      await hover_until_tooltip(page, helium_tile)
      const new_box = await tooltip.boundingBox()
      expect(new_box).not.toBeNull()
      if (!initial_box || !new_box) throw new Error(`Tooltip bounding box not found`)

      expect(new_box.x).not.toBe(initial_box.x)
    })

    test(`tooltip disappears when mouse leaves element`, async ({ page }) => {
      await page.goto(`/periodic-table`)

      // Wait for element tiles to render
      await page.waitForSelector(`.element-tile`, { timeout: 10000 })

      const h_tile = get_element_tile(page, `H`)
      await expect(h_tile).toBeVisible({ timeout: 15_000 })

      const tooltip = await hover_until_tooltip(page, h_tile)

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
        await page.goto(`/periodic-table`)

        // Wait for element tiles to render
        await page.waitForSelector(`.element-tile`, { timeout: 10000 })

        const element_tile = page
          .locator(`.element-tile`)
          .filter({
            hasText: new RegExp(`^\\s*${element.number}\\s+${element.symbol}`),
          })
          .first()

        await expect(element_tile).toBeVisible({ timeout: 15_000 })

        const tooltip = await hover_until_tooltip(page, element_tile)
        await expect(tooltip).toContainText(element.name, { timeout: 15_000 })
        await expect(tooltip).toContainText(`${element.symbol} • ${element.number}`)
      })
    }
  })

  test.describe(`in heatmap mode`, () => {
    // Configure retries for heatmap mode tests which involve dropdown interactions
    test.describe.configure({ retries: 2 })

    test(`displays elemental heat values`, async ({ page }) => {
      await page.goto(`/periodic-table`)

      // Open the heatmap dropdown (retries click until hydrated under CI contention)
      const option_list = await open_heatmap_select(page)

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
          const escaped_val = heatmap_val.replaceAll(/[.*+?^${}()|[\]\\]/g, `\\$&`)
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
})
