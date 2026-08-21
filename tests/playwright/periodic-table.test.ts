import { ELEM_HEATMAP_KEYS, format_num } from '$lib/labels'
import { expect, type Locator, type Page, test } from '@playwright/test'
import element_data from './element-data'

test.describe(`Periodic Table`, () => {
  // Open the heatmap multiselect dropdown, retrying the click until the options
  // list appears. Under CI contention svelte-widgets may not be hydrated when
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

  test(`renders the default table with equal tile tracks across widths`, async ({ page }) => {
    await page.goto(`/periodic-table`)

    const periodic_table = page.locator(`.periodic-table`).first()
    await expect(periodic_table).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole(`button`, { name: /Periodic Table Controls/ })).toBeVisible()

    const tiles = periodic_table.locator(`.element-tile`)
    await expect(tiles.first()).toBeVisible({ timeout: 20000 })
    const n_lanthanide_actinide_placeholders = 2
    expect(await tiles.count()).toBe(element_data.length + n_lanthanide_actinide_placeholders)

    for (const width of [1000, 480]) {
      await periodic_table.evaluate((element, next_width) => {
        element.style.width = `${next_width}px`
      }, width)
      const dimensions = await tiles.evaluateAll((elements) =>
        elements.flatMap((tile) => {
          const { width: tile_width, height: tile_height } = tile.getBoundingClientRect()
          return [tile_width, tile_height]
        }),
      )
      expect(Math.max(...dimensions) - Math.min(...dimensions)).toBeLessThan(0.5)
    }
  })

  // A custom inset taller than periods 1–3 must overlay the slot, not stretch those rows
  // (which would open gaps between H/Li/Na and leave period-4 tiles a different size).
  test(`a tall inset does not stretch element-tile rows`, async ({ page }) => {
    await page.goto(`/plot/color-scales`)
    const table = page.locator(`.periodic-table`).first()
    await expect(table).toBeVisible({ timeout: 20_000 })
    const tile = (symbol: string) => table.locator(`[data-element-symbol="${symbol}"]`)
    await expect(tile(`H`)).toBeVisible({ timeout: 20_000 })

    const row_gap = async (above: string, below: string) => {
      const [upper, lower] = await Promise.all([
        tile(above).evaluate((el) => el.getBoundingClientRect().bottom),
        tile(below).evaluate((el) => el.getBoundingClientRect().top),
      ])
      return lower - upper
    }
    expect(Math.abs((await row_gap(`H`, `Li`)) - (await row_gap(`K`, `Rb`)))).toBeLessThan(1)

    const heights = await table
      .locator(`.element-tile`)
      .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().height))
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5)

    const inset = table.locator(`.table-inset`)
    const [inset_box, h_box, sc_box] = await Promise.all([
      inset.boundingBox(),
      tile(`H`).boundingBox(),
      tile(`Sc`).boundingBox(),
    ])
    if (!inset_box || !h_box || !sc_box) throw new Error(`missing inset/tile boxes`)
    expect(Math.abs(inset_box.y - h_box.y)).toBeLessThan(2)
    expect(inset_box.y + inset_box.height).toBeLessThanOrEqual(sc_box.y + 2)

    const tick_bottom = await table
      .locator(`.colorbar .tick-label`)
      .evaluateAll((ticks) =>
        Math.max(...ticks.map((tick) => tick.getBoundingClientRect().bottom)),
      )
    expect(sc_box.y - tick_bottom).toBeGreaterThan(8)

    // Scale bar must span the inset hole, not shrink to the color-scale chip (~14em).
    const scale_box = await table.locator(`section > .colorbar`).boundingBox()
    if (!scale_box) throw new Error(`missing scale colorbar box`)
    expect(scale_box.width).toBeGreaterThan(inset_box.width * 0.7)
  })

  test.describe(`tooltips`, () => {
    // Configure retries for tooltip tests which can be timing-sensitive
    test.describe.configure({ retries: 2 })

    // test utilities
    const get_element_tile = (page: Page, selector: string) =>
      page.locator(`.element-tile`).filter({ hasText: selector }).first()

    const get_tooltip = (page: Page) => page.locator(`.tooltip`)

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

    test(`shows selected heatmap values and custom tooltip`, async ({ page }) => {
      await page.goto(`/periodic-table`)
      const option_list = await open_heatmap_select(page)
      const first_option = option_list.locator(`li`).first()
      await expect(first_option).toContainText(/atomic.*mass/i)
      await first_option.click()

      const first_heatmap_key = ELEM_HEATMAP_KEYS[0]
      const hydrogen = element_data.find(({ symbol }) => symbol === `H`)
      if (!first_heatmap_key || !hydrogen) throw new Error(`Missing atomic mass test data`)
      const heatmap_value = hydrogen[first_heatmap_key]
      if (typeof heatmap_value !== `number`)
        throw new Error(`Hydrogen atomic mass is not numeric`)
      await expect(
        page
          .locator(`.periodic-table`)
          .first()
          .locator(`[data-element-symbol="${hydrogen.symbol}"]`),
      ).toContainText(format_num(heatmap_value))

      await page.mouse.click(10, 10)
      await expect(option_list).not.toBeVisible()

      const tooltip = await hover_until_tooltip(page, get_element_tile(page, `C`))
      await expect(tooltip).toContainText(`Carbon`, { timeout: 15_000 })
      await expect(tooltip).toContainText(`C • 6`)

      // Check for enhanced data - but be more flexible about the format
      await expect(tooltip).toContainText(/Position:|Column|Row/)
      await expect(tooltip).toContainText(/Range:|Min|Max/)
    })

    test(`shows default tooltip content and follows the hovered element`, async ({ page }) => {
      await page.goto(`/periodic-table`)

      const hydrogen_tile = get_element_tile(page, `H`)
      const helium_tile = get_element_tile(page, `He`)

      const tooltip = await hover_until_tooltip(page, hydrogen_tile)
      await expect(tooltip).toContainText(`Hydrogen`, { timeout: 15_000 })
      await expect(tooltip).toContainText(`H • 1`)
      const initial_box = await tooltip.boundingBox()
      expect(initial_box).not.toBeNull()

      await hover_until_tooltip(page, helium_tile)
      await expect(tooltip).toContainText(`Helium`)
      const new_box = await tooltip.boundingBox()
      expect(new_box).not.toBeNull()
      if (!initial_box || !new_box) throw new Error(`Tooltip bounding box not found`)

      expect(new_box.x).not.toBe(initial_box.x)
    })
  })
})
