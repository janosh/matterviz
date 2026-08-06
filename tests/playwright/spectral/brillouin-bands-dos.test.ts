import { expect, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import {
  drag_plot_area,
  get_chart_svg,
  IS_CI,
  measure_plot_area,
  numeric_y_ticks,
} from '../helpers'

const line_path_selector = `path.line, path[stroke]:not([stroke="none"])`
const default_bz_canvas_selector = `[data-testid="bz-bands-dos-default"] canvas`

const screenshot_default_bz_canvas = (page: Page): Promise<Buffer> =>
  page.locator(default_bz_canvas_selector).first().screenshot()

async function get_default_desktop_plots(page: Page) {
  await page.setViewportSize({ width: 1400, height: 800 })
  const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
  await container.evaluate((element) => {
    element.style.width = `1200px`
  })
  await expect(container).toHaveClass(/desktop/)
  const plots = container.locator(`.scatter`)
  const bands_plot = plots.first()
  const dos_plot = plots.nth(1)
  await expect(plots).toHaveCount(2)
  await Promise.all(
    [bands_plot, dos_plot].map((plot) =>
      expect(get_chart_svg(plot)).toBeVisible({ timeout: 30_000 }),
    ),
  )
  return { bands_plot, dos_plot }
}

// Serialize tests to avoid race conditions when multiple workers load the same heavy 3D page
test.describe.configure({ mode: `serial` })

test.describe(`BrillouinBandsDos Component Tests`, () => {
  // Cold compilation and 3D initialization can take over a minute in development.
  test.setTimeout(120_000)

  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `3D canvas tests are flaky in CI`)
    await page.goto(`/test/brillouin-bands-dos`, { waitUntil: `networkidle` })
    await expect(page.locator(default_bz_canvas_selector).first()).toBeVisible({
      timeout: 20000,
    })
  })

  test(`renders all three panels with content`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    await expect(bands_svg).toBeVisible({ timeout: 10_000 })
    await expect(bands_svg.locator(line_path_selector).first()).toBeVisible({
      timeout: 5000,
    })

    // DOS SVG - find by looking for the second SVG with axes
    const dos_svg = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(dos_svg).toBeVisible({ timeout: 10_000 })
    await expect(dos_svg.locator(`g.y-axis`)).toBeVisible({ timeout: 5000 })
    await expect(dos_svg.locator(line_path_selector).first()).toBeVisible({
      timeout: 5000,
    })

    // Check for high-symmetry labels in bands
    const x_labels = await bands_svg.locator(`g.x-axis text`).allTextContents()
    expect(x_labels.join(``)).toMatch(/Γ|GAMMA/)
  })

  test(`applies custom styling and column widths`, async ({ page }) => {
    // Custom widths
    const widths_container = page.locator(`[data-testid="bz-bands-dos-custom-widths"]`)
    const grid_style = await widths_container.evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns,
    )
    expect(grid_style).toBeTruthy()

    // Custom bands styling (red, thick lines)
    const styling_container = page.locator(`[data-testid="bz-bands-dos-bands-styling"]`)
    const first_path = styling_container
      .locator(`svg:has(g.x-axis)`)
      .first()
      .locator(line_path_selector)
      .first()
    const stroke = await first_path.evaluate((el) => getComputedStyle(el).stroke)
    expect(stroke).toContain(`rgb(255, 0, 0)`)
  })

  test(`handles independent y-axes and custom BZ appearance`, async ({ page }) => {
    // Independent axes with mismatched ranges
    const indep_container = page.locator(`[data-testid="bz-bands-dos-independent-axes"]`)
    const bands_y = await indep_container
      .locator(`svg:has(g.x-axis)`)
      .first()
      .locator(`g.y-axis text`)
      .allTextContents()
    const dos_y = await indep_container
      .locator(`svg:has(g.y-axis)`)
      .nth(1)
      .locator(`g.y-axis text`)
      .allTextContents()
    expect(bands_y).not.toEqual(dos_y)

    // BZ controls visible when enabled
    const controls_container = page.locator(`[data-testid="bz-bands-dos-with-controls"]`)
    await expect(controls_container.locator(`button.controls-toggle`)).toBeVisible()
  })

  test(`renders multiple structures with legend`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-multiple"]`)
    // There may be multiple legends (Bands and DOS both show legends for multiple series)
    // Just check that at least one legend exists and has the expected content
    const legend = container.locator(`.legend`).first()

    await expect(legend).toBeVisible()
    expect(await legend.locator(`.legend-item`).count()).toBeGreaterThanOrEqual(2)
    expect(await legend.textContent()).toContain(`DFT`)
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    await page.setViewportSize({ width: 800, height: 600 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    expect(await container.boundingBox()).toBeTruthy()

    await page.setViewportSize({ width: 1600, height: 1200 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    expect(await container.boundingBox()).toBeTruthy()
  })

  test(`BZ rotates with mouse drag`, async ({ page }) => {
    const bz_canvas = page.locator(default_bz_canvas_selector).first()
    await expect(bz_canvas).toBeVisible({ timeout: 10000 })
    const initial = await screenshot_default_bz_canvas(page)

    const box = await bz_canvas.boundingBox()
    if (!box) throw new Error(`Missing BZ canvas geometry`)
    const center_x = box.x + box.width / 2
    const center_y = box.y + box.height / 2
    await page.mouse.move(center_x, center_y)
    await page.mouse.down()
    await page.mouse.move(center_x + 50, center_y, { steps: 10 })
    await page.mouse.up()

    await expect(async () => {
      expect(initial.equals(await screenshot_default_bz_canvas(page))).toBe(false)
    }).toPass({ timeout: 5000 })
  })

  test(`shared y-axis synchronizes bands and DOS ticks`, async ({ page }) => {
    const { bands_plot, dos_plot } = await get_default_desktop_plots(page)

    // Equal outer panel heights are insufficient: the clipped drawable regions
    // must use the same top offset and height for matching y coordinates.
    const bands_clip = bands_plot.locator(`clipPath rect`)
    const dos_clip = dos_plot.locator(`clipPath rect`)
    await expect(async () => {
      for (const attribute of [`y`, `height`]) {
        expect(await bands_clip.getAttribute(attribute)).toBe(
          await dos_clip.getAttribute(attribute),
        )
      }
      expect(await numeric_y_ticks(bands_plot)).toEqual(await numeric_y_ticks(dos_plot))
    }).toPass({ timeout: 30_000 })
  })

  test(`desktop y-axis zoom and reset propagate from either panel`, async ({ page }) => {
    const { bands_plot, dos_plot } = await get_default_desktop_plots(page)
    const bands_svg = get_chart_svg(bands_plot)
    const dos_svg = get_chart_svg(dos_plot)
    const bands_area = await measure_plot_area(bands_plot)
    await expect.poll(() => numeric_y_ticks(bands_plot), { timeout: 10_000 }).not.toEqual([])
    const initial_bands_ticks = await numeric_y_ticks(bands_plot)
    await drag_plot_area(page, bands_area)

    await expect(async () => {
      const bands_ticks = await numeric_y_ticks(bands_plot)
      expect(bands_ticks).not.toEqual(initial_bands_ticks)
      expect(await numeric_y_ticks(dos_plot)).toEqual(bands_ticks)
    }).toPass({ timeout: 10_000 })

    await bands_svg.dblclick({
      position: {
        x: bands_area.clip.x + bands_area.clip.width / 2,
        y: bands_area.clip.y + bands_area.clip.height / 2,
      },
    })
    await expect(async () => {
      const bands_ticks = await numeric_y_ticks(bands_plot)
      expect(bands_ticks).toEqual(initial_bands_ticks)
      expect(await numeric_y_ticks(dos_plot)).toEqual(bands_ticks)
    }).toPass({ timeout: 10_000 })
    const reset_ticks = initial_bands_ticks

    const dos_area = await measure_plot_area(dos_plot)
    await drag_plot_area(page, dos_area)

    await expect(async () => {
      const dos_ticks = await numeric_y_ticks(dos_plot)
      expect(dos_ticks).not.toEqual(reset_ticks)
      expect(await numeric_y_ticks(bands_plot)).toEqual(dos_ticks)
    }).toPass({ timeout: 10_000 })
    await dos_svg.dblclick({
      position: {
        x: dos_area.clip.x + dos_area.clip.width / 2,
        y: dos_area.clip.y + dos_area.clip.height / 2,
      },
    })
    await expect(async () => {
      expect(await numeric_y_ticks(bands_plot)).toEqual(reset_ticks)
      expect(await numeric_y_ticks(dos_plot)).toEqual(reset_ticks)
    }).toPass({ timeout: 10_000 })
  })

  test(`desktop layout: three columns side by side`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    const grid_template = await container.evaluate(
      (el) => getComputedStyle(el).gridTemplateAreas,
    )

    // Desktop layout: bz bands dos
    expect(grid_template).toContain(`bz`)
    expect(grid_template).toContain(`bands`)
    expect(grid_template).toContain(`dos`)

    // All three components should be visible
    await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
  })

  test(`tablet layout: bands on top, BZ and DOS below`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    const grid_template = await container.evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        areas: style.gridTemplateAreas,
        columns: style.gridTemplateColumns,
      }
    })

    // Tablet layout should have bands spanning top, bz and dos below
    expect(grid_template.areas).toMatch(/bands.*bands/)
    expect(grid_template.areas).toContain(`bz`)
    expect(grid_template.areas).toContain(`dos`)

    // Should have 2 columns
    const column_count = grid_template.columns.split(` `).length
    expect(column_count).toBe(2)
  })

  test(`phone layout: all stacked vertically`, async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    await expect(async () => {
      const grid_template = await container.evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          areas: style.gridTemplateAreas,
          columns: style.gridTemplateColumns,
        }
      })

      // Phone layout: vertical stack
      const area_lines = grid_template.areas.split(`"`)
      expect(area_lines.length).toBeGreaterThanOrEqual(3)

      // Should have 1 column
      expect(grid_template.columns).not.toContain(` `)
    }).toPass({ timeout: 5000 })

    // All components still visible
    await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
  })

  test(`DOS orientation changes with viewport`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Desktop: horizontal DOS
    await page.setViewportSize({ width: 1400, height: 800 })
    const dos_svg_wide = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(dos_svg_wide).toBeVisible()
    const dos_box_wide = await dos_svg_wide.boundingBox()
    if (!dos_box_wide) throw new Error(`Missing desktop DOS geometry`)
    expect(dos_box_wide.width).toBeLessThan(dos_box_wide.height * 2)

    // Tablet/Phone: vertical DOS (wider than tall)
    await page.setViewportSize({ width: 800, height: 700 })
    const dos_svg_narrow = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(dos_svg_narrow).toBeVisible()
    const dos_box_narrow = await dos_svg_narrow.boundingBox()
    if (!dos_box_narrow) throw new Error(`Missing tablet DOS geometry`)
    expect(dos_box_narrow.width).toBeGreaterThan(dos_box_narrow.height * 0.5)
  })

  test(`BZ respects height constraints on tablet layout`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    const bz_canvas = container.locator(`canvas`).first()
    await expect(bz_canvas).toBeVisible()
    const canvas_box = await bz_canvas.boundingBox()
    const container_box = await container.boundingBox()

    if (!canvas_box || !container_box) throw new Error(`Missing tablet BZ geometry`)
    // BZ should not overflow container height
    expect(canvas_box.height).toBeLessThanOrEqual(container_box.height / 2 + 50)
  })

  test(`grid gap is applied consistently`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Test desktop
    await page.setViewportSize({ width: 1400, height: 700 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const gap_desktop = await container.evaluate((el) => getComputedStyle(el).gap)
    expect(gap_desktop).toBeTruthy()
    expect(gap_desktop).not.toBe(`0px`)

    // Test tablet
    await page.setViewportSize({ width: 800, height: 700 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const gap_tablet = await container.evaluate((el) => getComputedStyle(el).gap)
    expect(gap_tablet).toBeTruthy()
    expect(gap_tablet).not.toBe(`0px`)

    // Test phone
    await page.setViewportSize({ width: 500, height: 700 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const gap_phone = await container.evaluate((el) => getComputedStyle(el).gap)
    expect(gap_phone).toBeTruthy()
    expect(gap_phone).not.toBe(`0px`)
  })

  test(`responsive layout preserves interaction`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Test at tablet size
    await page.setViewportSize({ width: 800, height: 700 })
    const bz_canvas = container.locator(`canvas`).first()
    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    await expect(bz_canvas).toBeVisible()

    // BZ should still rotate
    const initial = await bz_canvas.screenshot()
    const box = await bz_canvas.boundingBox()
    if (!box) throw new Error(`Missing BZ canvas geometry`)
    await page.mouse.move(box.x + 50, box.y + 50)
    await page.mouse.down()
    await page.mouse.move(box.x + 100, box.y + 50)
    await page.mouse.up()
    await expect(async () => {
      expect(initial.equals(await bz_canvas.screenshot())).toBe(false)
    }).toPass({ timeout: 5000 })

    // Bands should still be hoverable
    await bands_svg
      .locator(line_path_selector)
      .first()
      .hover({
        position: { x: 50, y: 50 },
        force: true,
      })
  })

  test(`hovering over DOS shows reference lines in both bands and DOS`, async ({ page }) => {
    // Set desktop viewport to ensure consistent layout
    await page.setViewportSize({ width: 1400, height: 800 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    // In desktop layout (grid: bz bands dos), bands SVG is first, DOS SVG is second
    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    const dos_svg = container.locator(`svg:has(g.y-axis)`).nth(1)

    await expect(bands_svg).toBeVisible()
    await expect(dos_svg).toBeVisible()

    // Get initial count of dashed lines (fermi level lines may already exist)
    const initial_dashed_count = await bands_svg.locator(`line[stroke-dasharray]`).count()

    // Hover over DOS plot area (on a DOS path to trigger hover)
    const dos_path = dos_svg.locator(line_path_selector).first()
    await expect(dos_path).toBeVisible()
    await dos_path.hover({ force: true })

    // Wait for hover state to update - reference lines with stroke-dasharray should appear
    await expect(async () => {
      const current_dashed_count = await bands_svg.locator(`line[stroke-dasharray]`).count()
      // Reference line should be added on hover (in addition to any existing fermi level lines)
      expect(current_dashed_count).toBeGreaterThan(initial_dashed_count)
    }).toPass({ timeout: 3000 })
  })

  test(`renders children snippet content`, async ({ page }) => {
    // Navigate to section with children (multiple-structures)
    await page.locator(`#multiple-structures`).scrollIntoViewIfNeeded()

    // Find the container with children (multiple structures example)
    const container = page.locator(`[data-testid="bz-bands-dos-multiple"]`)
    await expect(container).toBeVisible()

    // Verify the custom overlay child element is rendered
    const custom_overlay = container.locator(`.custom-overlay`)
    await expect(custom_overlay).toBeVisible()
    await expect(custom_overlay).toHaveText(`Custom Overlay`)

    // Verify all three panels are still working
    await expect(container.locator(`canvas`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
  })
})
