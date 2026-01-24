// deno-lint-ignore-file no-await-in-loop
import element_data from '$lib/element/data'
import {
  CATEGORY_COUNTS,
  ELEM_HEATMAP_KEYS,
  ELEMENT_CATEGORIES,
  format_num,
} from '$lib/labels'
import { expect, type Page, test } from '@playwright/test'
import { IS_CI, random_sample } from './helpers'

test.describe(`Periodic Table`, () => {
  test(`in default state`, async ({ page }) => {
    test.skip(IS_CI, `Periodic table tests timeout/flake in CI due to page load timing`)
    await page.goto(`/`, { waitUntil: `networkidle` })

    // Get the first periodic table on the page (homepage has multiple periodic tables)
    const periodic_table = page.locator(`.periodic-table`).first()
    await expect(periodic_table).toBeVisible({ timeout: 20000 })

    // Wait for periodic table to load by waiting for at least one element tile
    const tiles = periodic_table.locator(`.element-tile`)
    await expect(tiles.first()).toBeVisible({ timeout: 20000 })

    const tile_count = await tiles.count()
    const n_lanthanide_actinide_placeholders = 2
    expect(tile_count).toBe(element_data.length + n_lanthanide_actinide_placeholders)

    for (const category of ELEMENT_CATEGORIES) {
      let count = CATEGORY_COUNTS[category] as number
      // Scope selector to the first periodic table
      const category_tiles_selector = periodic_table.locator(
        `[data-category="${category}"]`,
      )
      // add 1 to expected count since lanthanides and actinides have placeholder
      // tiles showing where in the periodic table their rows insert
      if ([`lanthanide`, `actinide`].includes(category)) count += 1
      const category_tiles = await category_tiles_selector.count()
      expect(category_tiles, category).toBe(count)
    }
  })

  test(`shows stats on hover element`, async ({ page }) => {
    test.skip(IS_CI, `Hover stats tests flaky in CI due to mouse event timing`)
    await page.goto(`/`, { waitUntil: `networkidle` })

    // Wait for element tiles to be visible
    const hydrogen_tile = page.locator(`.element-tile`).filter({ hasText: `H` }).first()
    await expect(hydrogen_tile).toBeVisible({ timeout: 20000 })

    // force: true needed because element tiles have layered content (symbol, number, name)
    // that can intercept hover events depending on mouse position within the tile
    await hydrogen_tile.hover({ force: true })

    // Check for stats display - use flexible assertion with retry
    await expect(page.locator(`text=1 - Hydrogen`)).toBeVisible({ timeout: 5000 })
  })

  test(`can hover random elements without throwing errors`, async ({ page }) => {
    // Skip in CI - page loading can be slow causing tiles.count() to timeout
    test.skip(IS_CI, `Periodic table rendering unreliable in headless CI`)

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
    await expect(tiles.first()).toBeVisible({ timeout: 20000 })
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
    // Configure retries for tooltip tests which can be timing-sensitive
    test.describe.configure({ retries: 2 })

    test.beforeEach(() => {
      test.skip(IS_CI, `Tooltip hover tests flaky in CI due to timing`)
    })

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
      await expect(tooltip).toHaveCount(0, { timeout: 5000 })
    }

    test(`shows default tooltip on element hover when no heatmap is selected`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      // Wait for element tiles to render before hovering
      await page.waitForSelector(`.element-tile`, { timeout: 10000 })

      // Get the first periodic table container (PeriodicTableDemo) which has tooltip enabled
      const periodic_table = page.locator(`.periodic-table`).first()
      await expect(periodic_table).toBeVisible({ timeout: 10000 })

      // Hover on the H tile within the first periodic table
      const h_tile = periodic_table.locator(`.element-tile`).filter({ hasText: `H` })
        .first()
      await expect(h_tile).toBeVisible({ timeout: 5000 })
      // force: true needed - element tiles have stacked text content that intercepts hover
      await h_tile.hover({ force: true })

      // Get tooltip within the same periodic table container - use retry for visibility
      const tooltip = periodic_table.locator(`.tooltip`)
      await expect(async () => {
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toContainText(`Hydrogen`)
      }).toPass({ timeout: 10000 })
      await expect(tooltip).toContainText(`H • 1`)
    })

    test(`shows custom tooltip with heatmap data when heatmap is selected`, async ({ page }) => {
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })
      const multiselect = page.locator(`div.multiselect[data-id="heatmap-select"]`)
      await expect(multiselect).toBeVisible()

      // force: true needed - svelte-multiselect has SVG icons overlaying the clickable input
      await multiselect.click({ force: true })

      const option_list = multiselect.locator(`ul.options`)
      await expect(option_list).toBeVisible({ timeout: 5000 })
      const first_option = option_list.locator(`li`).first()
      await first_option.click()

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

      // Wait for element tiles to render
      await page.waitForSelector(`.element-tile`, { timeout: 10000 })

      const h_tile = get_element_tile(page, `H`)
      await expect(h_tile).toBeVisible({ timeout: 5000 })
      await h_tile.hover({ force: true })

      const tooltip = get_tooltip(page)
      // Use toPass for robust visibility check
      await expect(async () => {
        await expect(tooltip).toBeVisible()
      }).toPass({ timeout: 5000 })

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

        // Wait for element tiles to render
        await page.waitForSelector(`.element-tile`, { timeout: 10000 })

        await clear_tooltip(page)

        const element_tile = page
          .locator(`.element-tile`)
          .filter({
            hasText: new RegExp(`^\\s*${element.number}\\s+${element.symbol}`),
          })
          .first()

        await expect(element_tile).toBeVisible({ timeout: 5000 })
        await element_tile.hover({ force: true })

        const tooltip = get_tooltip(page)
        // Use toPass for robust tooltip visibility
        await expect(async () => {
          await expect(tooltip).toBeVisible()
          await expect(tooltip).toContainText(element.name)
        }).toPass({ timeout: 5000 })
        await expect(tooltip).toContainText(
          `${element.symbol} • ${element.number}`,
        )
      })
    }

    test(`tooltip works with heatmap property selected`, async ({ page }) => {
      // Skip in CI - multiselect dropdown interactions are unreliable in headless CI
      test.skip(IS_CI, `Multiselect dropdown interactions flaky in CI`)
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      // Use scoped selector for heatmap multiselect
      const multiselect = page.locator(`div.multiselect[data-id="heatmap-select"]`)
      await expect(multiselect).toBeVisible()

      // Open multiselect dropdown - force: true needed due to overlaying SVG icons
      await multiselect.click({ force: true })

      // Wait for dropdown to be visible
      const option_list = multiselect.locator(`ul.options`)
      await expect(option_list).toBeVisible({ timeout: 10000 })

      // Select Atomic mass property
      const option = option_list.locator(`li`, { hasText: `Atomic mass` })
      await expect(option).toBeVisible()
      await option.click()

      // Close dropdown by clicking outside before hovering on tile
      await page.mouse.click(10, 10)
      await expect(option_list).not.toBeVisible()

      // Hover over Carbon element
      const carbon_tile = get_element_tile(page, `C`)
      await carbon_tile.hover()

      // Verify tooltip shows element info with heatmap active
      const tooltip = get_tooltip(page)
      await expect(tooltip).toBeVisible()
      await expect(tooltip).toContainText(`Carbon`)
      await expect(tooltip).toContainText(`C • 6`)
    })
  })

  test.describe(`in heatmap mode`, () => {
    // Configure retries for heatmap mode tests which involve dropdown interactions
    test.describe.configure({ retries: 2 })

    test(`displays elemental heat values`, async ({ page }) => {
      // Skip in CI - multiselect dropdown interactions are unreliable in headless CI
      test.skip(IS_CI, `Multiselect dropdown interactions flaky in CI`)
      await page.goto(`/periodic-table`, { waitUntil: `networkidle` })

      // Use specific data-id selector for heatmap multiselect
      const multiselect = page.locator(`div.multiselect[data-id="heatmap-select"]`)
      await expect(multiselect).toBeVisible()

      // force: true needed - svelte-multiselect has SVG icons overlaying the clickable input
      await multiselect.click({ force: true })

      // Wait for dropdown list to be visible - look within the multiselect
      const option_list = multiselect.locator(`ul.options`)
      await expect(option_list).toBeVisible({ timeout: 20000 })

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
})
