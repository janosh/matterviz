import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  canvas_screenshot,
  drag_plot_area,
  expect_canvas_changed,
  get_chart_svg,
  IS_CI,
  measure_plot_area,
  numeric_y_ticks,
} from '../helpers'

const line_path_selector = `path.line, path[stroke]:not([stroke="none"])`
const default_bz_canvas_selector = `[data-testid="bz-bands-dos-default"] canvas`

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

const expect_synced_y_ticks = (
  source_plot: Locator,
  target_plot: Locator,
  expected?: string[],
) =>
  expect(async () => {
    const source_ticks = await numeric_y_ticks(source_plot)
    if (expected) expect(source_ticks).toEqual(expected)
    expect(await numeric_y_ticks(target_plot)).toEqual(source_ticks)
  }).toPass({ timeout: 10_000 })

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

  test(`BZ rotates with mouse drag`, async ({ page }) => {
    const bz_canvas = page.locator(default_bz_canvas_selector).first()
    const initial = await canvas_screenshot(bz_canvas)

    const box = await bz_canvas.boundingBox()
    if (!box) throw new Error(`Missing BZ canvas geometry`)
    const center_x = box.x + box.width / 2
    const center_y = box.y + box.height / 2
    await page.mouse.move(center_x, center_y)
    await page.mouse.down()
    await page.mouse.move(center_x + 50, center_y, { steps: 10 })
    await page.mouse.up()

    await expect_canvas_changed(bz_canvas, initial, 5000)
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
    await expect.poll(() => numeric_y_ticks(bands_plot)).not.toEqual(initial_bands_ticks)
    await expect_synced_y_ticks(bands_plot, dos_plot)

    await bands_svg.dblclick({
      position: {
        x: bands_area.clip.x + bands_area.clip.width / 2,
        y: bands_area.clip.y + bands_area.clip.height / 2,
      },
    })
    await expect_synced_y_ticks(bands_plot, dos_plot, initial_bands_ticks)
    const dos_area = await measure_plot_area(dos_plot)
    await drag_plot_area(page, dos_area)
    await expect.poll(() => numeric_y_ticks(dos_plot)).not.toEqual(initial_bands_ticks)
    await expect_synced_y_ticks(dos_plot, bands_plot)
    await dos_svg.dblclick({
      position: {
        x: dos_area.clip.x + dos_area.clip.width / 2,
        y: dos_area.clip.y + dos_area.clip.height / 2,
      },
    })
    await expect_synced_y_ticks(bands_plot, dos_plot, initial_bands_ticks)
  })

  test(`responsive breakpoints keep layout, gap, and panel geometry`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    const read_grid = () =>
      container.evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          areas: style.gridTemplateAreas,
          columns: style.gridTemplateColumns,
          gap: style.gap,
        }
      })
    const set_layout = async (
      width: number,
      height: number,
      mode: `desktop` | `tablet` | `phone`,
      container_width = ``,
    ) => {
      await page.setViewportSize({ width, height })
      await container.evaluate(
        (element, forced_width) => (element.style.width = forced_width),
        container_width,
      )
      await expect(container).toHaveClass(new RegExp(mode))
      return read_grid()
    }
    const expect_areas = (areas: string, expected: string[]) => {
      for (const area of expected) expect(areas).toContain(area)
    }

    const desktop = await set_layout(1400, 800, `desktop`, `1200px`)
    expect_areas(desktop.areas, [`bz`, `bands`, `dos`])
    expect(desktop.gap).not.toMatch(/^$|^0px$/)
    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    const dos_svg = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(bands_svg).toBeVisible()
    await expect(dos_svg).toBeVisible()
    const desktop_dos_box = await dos_svg.boundingBox()
    if (!desktop_dos_box) throw new Error(`Missing desktop DOS geometry`)
    expect(desktop_dos_box.width).toBeLessThan(desktop_dos_box.height * 2)

    const tablet = await set_layout(800, 700, `tablet`)
    expect(tablet.areas).toMatch(/bands.*bands/)
    expect_areas(tablet.areas, [`bz`, `dos`])
    expect(tablet.columns.split(` `)).toHaveLength(2)
    expect(tablet.gap).not.toMatch(/^$|^0px$/)
    const [canvas_box, container_box, tablet_dos_box] = await Promise.all([
      container.locator(`canvas`).first().boundingBox(),
      container.boundingBox(),
      dos_svg.boundingBox(),
    ])
    if (!canvas_box || !container_box || !tablet_dos_box) {
      throw new Error(`Missing tablet panel geometry`)
    }
    expect(canvas_box.height).toBeLessThanOrEqual(container_box.height / 2 + 50)
    expect(tablet_dos_box.width).toBeGreaterThan(tablet_dos_box.height * 0.5)

    const phone = await set_layout(500, 900, `phone`)
    expect(phone.areas.split(`"`).length).toBeGreaterThanOrEqual(3)
    expect(phone.columns).not.toContain(` `)
    expect(phone.gap).not.toMatch(/^$|^0px$/)
    await expect(bands_svg).toBeVisible()
    await expect(dos_svg).toBeVisible()
  })

  test(`hovering over DOS shows reference lines in both bands and DOS`, async ({ page }) => {
    const { bands_plot, dos_plot } = await get_default_desktop_plots(page)
    const bands_svg = get_chart_svg(bands_plot)
    const dos_svg = get_chart_svg(dos_plot)

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
