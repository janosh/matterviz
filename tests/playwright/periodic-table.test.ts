import { ELEM_HEATMAP_KEYS, format_num } from '#lib/labels.js'
import { expect, type Locator, type Page, test } from '@playwright/test'
import element_data from './element-data'
import { require_bbox } from './helpers'

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

  test(`keeps tile tracks equal, lazy demos fit their content and color bars inside their insets across widths`, async ({
    page,
  }) => {
    await page.goto(`/periodic-table`)

    const periodic_table = page.locator(`.periodic-table`).first()
    await expect(periodic_table).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole(`button`, { name: /Periodic Table Controls/ })).toBeVisible()

    const tiles = periodic_table.locator(`.element-tile`)
    await expect(tiles.first()).toBeVisible({ timeout: 20000 })
    const n_lanthanide_actinide_placeholders = 2
    expect(await tiles.count()).toBe(element_data.length + n_lanthanide_actinide_placeholders)

    const auto_grid = page.locator(`.table-grid`).first()
    const auto_tables = auto_grid.locator(`.periodic-table`)
    // LazyDemo's "loaded" rule was scoped to its own children, so it never matched a demo's
    // root and every loaded demo kept the 500px placeholder height, leaving gaps under short
    // tables. Checked before the width loop below restyles these tables.
    await test.step(`a loaded lazy demo shrinks to its content`, async () => {
      const demo = auto_grid.locator(`.lazy-demo`).first()
      // re-scroll until it loads: a scroll before hydration reaches no IntersectionObserver
      await expect(async () => {
        await demo.scrollIntoViewIfNeeded()
        await expect(demo.locator(`.periodic-table`)).toBeVisible({ timeout: 2000 })
      }).toPass({ timeout: 20_000 })
      const [demo_box, table_box] = await Promise.all([
        require_bbox(demo, `lazy demo`),
        require_bbox(demo.locator(`.periodic-table`), `periodic table`),
      ])
      expect(table_box.height).toBeLessThan(400)
      expect(demo_box.height).toBeCloseTo(table_box.height, 0)
    })
    await auto_grid.scrollIntoViewIfNeeded()
    await expect(auto_tables.locator(`.colorbar .label`)).toHaveText([
      `Atomic Mass`,
      `Density`,
      `Boiling Point`,
    ])

    for (const width of [120, 200, 480, 1000]) {
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

      await auto_tables.evaluateAll((elements, next_width) => {
        for (const element of elements) {
          element.style.width = `${next_width}px`
          element.style.setProperty(`--ptable-min-tile-size`, `0`)
        }
      }, width)
      // Titles, gradients and every tick must fit without clipping or covering element tiles.
      await expect
        .poll(() =>
          auto_tables.locator(`.auto-colorbar-inset`).evaluateAll((insets) =>
            insets.map((inset) => {
              const bounds = inset.getBoundingClientRect()
              return [...inset.querySelectorAll(`.label, .bar, .tick-label`)].every((part) => {
                const box = part.getBoundingClientRect()
                return (
                  box.left > bounds.left - 0.5 &&
                  box.right < bounds.right + 0.5 &&
                  box.top > bounds.top - 0.5 &&
                  box.bottom < bounds.bottom + 0.5
                )
              })
            }),
          ),
        )
        .toEqual([true, true, true])
    }
  })

  // span.value used to out-specify the multi-value rules, so long labels (H density
  // 0.0000899) never shrank and spilled past the tile edge
  test(`multi-value labels stay inside their tiles across widths`, async ({ page }) => {
    // the multi-value demo is a LazyDemo below the default 720px fold, so open it in view
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/periodic-table`)
    const labels = page.locator(`.multi-value`)
    await expect(labels.first()).toBeVisible({ timeout: 20000 })
    await expect(labels.filter({ hasText: /^0\.0000899$/ })).toHaveCount(1)
    for (const width of [1280, 900]) {
      await page.setViewportSize({ width, height: 900 })
      const overflowing = await labels.evaluateAll((nodes) =>
        nodes.flatMap((node) => {
          const rect = node.getBoundingClientRect()
          const tile = node.closest(`.element-tile`)?.getBoundingClientRect()
          if (!tile || rect.width === 0) return []
          const overflow = Math.max(
            tile.left - rect.left,
            rect.right - tile.right,
            tile.top - rect.top,
            rect.bottom - tile.bottom,
          )
          return overflow > 0.5
            ? [`${node.textContent?.trim()} by ${overflow.toFixed(1)}px`]
            : []
        }),
      )
      expect(overflowing, `width ${width}`).toEqual([])
    }
  })

  // A custom inset taller than periods 1–3 must overlay the slot, not stretch those rows
  // (which would open gaps between H/Li/Na and leave period-4 tiles a different size).
  test(`a tall inset does not stretch element-tile rows`, async ({ page }) => {
    expect((await page.goto(`/plot/color-scales`))?.status()).toBe(200)
    const table = page.locator(`.periodic-table`).first()
    await expect(table).toBeVisible({ timeout: 20_000 })
    const tile = (symbol: string) => table.locator(`[data-element-symbol="${symbol}"]`)
    await expect(tile(`H`)).toBeVisible({ timeout: 20_000 })

    const row_gap = async (above: string, below: string) => {
      const [upper, lower] = await Promise.all([
        tile(above).evaluate((element) => element.getBoundingClientRect().bottom),
        tile(below).evaluate((element) => element.getBoundingClientRect().top),
      ])
      return lower - upper
    }
    expect(Math.abs((await row_gap(`H`, `Li`)) - (await row_gap(`K`, `Rb`)))).toBeLessThan(1)

    const heights = await table
      .locator(`.element-tile`)
      .evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      )
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5)

    const inset = table.locator(`.table-inset`)
    const [inset_box, h_box, sc_box] = await Promise.all(
      [inset, tile(`H`), tile(`Sc`)].map((locator) => require_bbox(locator)),
    )
    expect(Math.abs(inset_box.y - h_box.y)).toBeLessThan(2)
    expect(inset_box.y + inset_box.height).toBeLessThanOrEqual(sc_box.y + 2)

    const tick_bottom = await table
      .locator(`.colorbar .tick-label`)
      .evaluateAll((ticks) =>
        Math.max(...ticks.map((tick) => tick.getBoundingClientRect().bottom)),
      )
    expect(sc_box.y - tick_bottom).toBeGreaterThan(8)

    // Scale bar must span the inset hole, not shrink to the color-scale chip (~14em).
    const scale_box = await require_bbox(table.locator(`section > .colorbar`))
    expect(scale_box.width).toBeGreaterThan(inset_box.width * 0.7)
  })

  test.describe(`tooltips`, () => {
    // Configure retries for tooltip tests which can be timing-sensitive
    test.describe.configure({ retries: 2 })

    const get_element_tile = (page: Page, symbol: string) =>
      page.locator(`.periodic-table [data-element-symbol="${symbol}"]`).first()

    const get_tooltip = (page: Page) => page.locator(`.periodic-table .plot-tooltip`)

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

    // The default tooltip runs first: selecting a heatmap changes tile and tooltip content
    test(`default tooltip follows the hovered element; heatmap selection shows values and custom tooltip`, async ({
      page,
    }) => {
      await page.goto(`/periodic-table`)

      await test.step(`default tooltip content follows the hovered element`, async () => {
        const hydrogen_tile = get_element_tile(page, `H`)
        // right-edge tile, where the tooltip used to wrap "Ne • 10" onto a third line
        const neon_tile = get_element_tile(page, `Ne`)

        const tooltip = await hover_until_tooltip(page, hydrogen_tile)
        await expect(tooltip).toContainText(`Hydrogen`, { timeout: 15_000 })
        await expect(tooltip).toContainText(`H • 1`)
        const initial_box = await require_bbox(tooltip)

        await hover_until_tooltip(page, neon_tile)
        await expect(tooltip).toContainText(`Neon`)
        await expect(tooltip).toContainText(`Ne • 10`)
        const new_box = await require_bbox(tooltip)

        expect(new_box.x).not.toBe(initial_box.x)
        expect(new_box.height).toBeCloseTo(initial_box.height, 0) // same two lines
      })

      await test.step(`selected heatmap values and custom tooltip`, async () => {
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
        await expect(get_element_tile(page, hydrogen.symbol)).toContainText(
          format_num(heatmap_value),
        )

        await page.mouse.click(10, 10)
        await expect(option_list).not.toBeVisible()

        const tooltip = await hover_until_tooltip(page, get_element_tile(page, `C`))
        await expect(tooltip).toContainText(`Carbon`, { timeout: 15_000 })
        await expect(tooltip).toContainText(`C • 6`)
        await expect(tooltip).toContainText(/Position:|Column|Row/)
        await expect(tooltip).toContainText(/Range:|Min|Max/)
      })
    })
  })
})

test(`periodic-table settings update rendered styles and reset each section`, async ({
  page,
}) => {
  await page.goto(`/periodic-table`, { waitUntil: `networkidle` })
  await page.getByRole(`button`, { name: `Periodic Table Controls`, exact: true }).click()
  const controls = page.locator(`.controls-grid`)
  const css_value = (property: string) =>
    page.evaluate(
      (css_property) =>
        getComputedStyle(document.documentElement).getPropertyValue(css_property).trim(),
      property,
    )
  for (const [key, value, property, expected] of [
    [`tile_gap`, `1cqw`, `--ptable-gap`, `1cqw`],
    [`tile_border_radius`, `3`, `--elem-tile-border-radius`, `3pt`],
    [`inner_transition_offset`, `1`, `--ptable-inner-transition-offset`, `1`],
    [`tile_transition_duration`, `0.8`, `--elem-tile-transition-duration`, `0.8s`],
    [`hover_border_width`, `3`, `--elem-tile-hover-border-width`, `3px`],
    [`symbol_font_size`, `50`, `--elem-symbol-font-size`, `50cqw`],
    [`number_font_size`, `30`, `--elem-number-font-size`, `30cqw`],
    [`name_font_size`, `20`, `--elem-name-font-size`, `20cqw`],
    [`value_font_size`, `24`, `--elem-value-font-size`, `24cqw`],
    [`symbol_font_weight`, `700`, `--elem-symbol-font-weight`, `700`],
    [`number_font_weight`, `600`, `--elem-number-font-weight`, `600`],
    [`tooltip_font_size`, `18`, `--plot-tooltip-font-size`, `18px`],
    [`tooltip_border_radius`, `12`, `--plot-tooltip-border-radius`, `12px`],
    [`tooltip_padding`, `8px 12px`, `--plot-tooltip-padding`, `8px 12px`],
    [`tooltip_line_height`, `1.5`, `--plot-tooltip-line-height`, `1.5`],
  ]) {
    const row = controls.locator(`[data-key="${key}"]`)
    const input = row.locator(`input:not([type=range])`)
    const original = await input.inputValue()
    const original_css = await css_value(property)
    await input.fill(value)
    await expect.poll(() => css_value(property)).toBe(expected)
    const range = row.locator(`input[type=range]`)
    if (await range.count()) await expect(range).toHaveValue(value)
    await row.getByRole(`button`, { name: /^Reset/ }).click()
    await expect(input).toHaveValue(original)
    await expect.poll(() => css_value(property)).toBe(original_css)
  }
  const table = page.locator(`.periodic-table`).first()
  for (const row of await controls.locator(`.category-colors label[data-key]`).all()) {
    const category = await row.getAttribute(`data-key`)
    const tiles = table.locator(`[data-category="${category}"]`)
    const original = await tiles
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    await row.locator(`input`).fill(`#123456`)
    await expect(tiles.first()).toHaveCSS(`background-color`, `rgb(18, 52, 86)`)
    await row.getByRole(`button`, { name: /^Reset/ }).click()
    await expect(tiles.first()).toHaveCSS(`background-color`, original)
  }
  const original_gap = await table.evaluate((element) => getComputedStyle(element).gap)
  await controls.locator(`[data-key="tile_gap"] input`).fill(`1cqw`)
  await expect
    .poll(() => table.evaluate((element) => getComputedStyle(element).gap))
    .not.toBe(original_gap)
  await controls
    .getByRole(`button`, { name: `Reset element tiles to defaults`, exact: true })
    .click()
  await expect(table).toHaveCSS(`gap`, original_gap)

  const automatic = controls.getByRole(`checkbox`, { name: `Automatic font contrast` })
  const font_color = controls.getByLabel(`Tile font color`, { exact: true })
  // picking a color turns automatic contrast off; the swatch is never disabled
  await expect(automatic).toBeChecked()
  await expect(font_color).toBeEnabled()
  await font_color.fill(`#ff0000`)
  await expect(automatic).not.toBeChecked()
  await expect(table.locator(`[data-element-symbol="H"]`)).toHaveCSS(`color`, `rgb(255, 0, 0)`)
  await controls
    .getByRole(`button`, { name: `Reset element tiles to defaults`, exact: true })
    .click()
  await expect(automatic).toBeChecked()
  await expect(font_color).toHaveValue(`#ffffff`)

  const alignment = controls.locator(`[data-key="tooltip_text_align"] select`)
  await alignment.selectOption(`left`)
  await expect.poll(() => css_value(`--plot-tooltip-text-align`)).toBe(`left`)
  const background = controls.locator(`[data-key="tooltip_bg_color"] input`)
  await background.fill(`#123456`)
  await expect.poll(() => css_value(`--plot-tooltip-bg`)).toBe(`#123456`)
  await controls
    .getByRole(`button`, { name: `Reset tooltip to defaults`, exact: true })
    .click()
  await expect(alignment).toHaveValue(`center`)
  await expect(background).toHaveValue(`#000000`)
})
