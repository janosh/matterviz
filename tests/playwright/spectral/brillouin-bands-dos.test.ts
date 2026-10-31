import { expect, type Page, test } from '@playwright/test'
import {
  canvas_screenshot,
  drag_canvas,
  drag_plot_area,
  get_chart_svg,
  measure_plot_area,
  numeric_y_ticks,
  require_bbox,
  reset_plot_area,
  expect_canvas_changed,
  expect_combined_fullscreen,
  expect_same_clip_rows,
  expect_synced_y_ticks,
  webgl_on_ci_for_tagged,
} from '../helpers'

webgl_on_ci_for_tagged()

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

// Never run two of these at once: concurrent workers loading the same heavy 3D page race.
// A lock (unlike serial mode) still runs the remaining tests after one fails.
test.describe(
  `BandsAndDos with Brillouin zone`,
  { lock: `brillouin-3d`, tag: `@webgl` },
  () => {
    // Cold compilation and 3D initialization can take over a minute in development.
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
      await page.goto(`/test/brillouin-bands-dos`, { waitUntil: `networkidle` })
      await expect(page.locator(default_bz_canvas_selector).first()).toBeVisible({
        timeout: 20000,
      })
    })

    // at screen width the three panels sit side by side, each the full height
    test(`BZ, bands and DOS go fullscreen as one component`, async ({ page }) => {
      const panels = [`.scatter`, `.scatter >> nth=1`, `.brillouin-zone`]
      const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
      await expect_combined_fullscreen(container, panels, `.brillouin-zone`)
    })

    test(`renders panels, custom bands styling, BZ controls and multi-structure children`, async ({
      page,
    }) => {
      await test.step(`default component renders all three panels with content`, async () => {
        const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

        const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
        await expect(bands_svg).toBeVisible({ timeout: 10_000 })
        await expect(bands_svg.locator(line_path_selector).first()).toBeVisible({
          timeout: 5000,
        })

        const dos_svg = container.locator(`svg:has(g.y-axis)`).nth(1)
        await expect(dos_svg).toBeVisible({ timeout: 10_000 })
        await expect(dos_svg.locator(`g.y-axis`)).toBeVisible({ timeout: 5000 })
        await expect(dos_svg.locator(line_path_selector).first()).toBeVisible({
          timeout: 5000,
        })

        const x_labels = await bands_svg.locator(`g.x-axis text`).allTextContents()
        expect(x_labels.join(``)).toMatch(/Γ|GAMMA/)
      })

      await test.step(`custom bands styling`, async () => {
        // red, thick lines
        const styling_container = page.locator(`[data-testid="bz-bands-dos-bands-styling"]`)
        const first_path = styling_container
          .locator(`svg:has(g.x-axis)`)
          .first()
          .locator(line_path_selector)
          .first()
        const stroke = await first_path.evaluate((element) => getComputedStyle(element).stroke)
        expect(stroke).toContain(`rgb(255, 0, 0)`)
      })

      // independent y-axes are checked more strictly in bands-and-dos.test.ts
      await test.step(`BZ controls`, async () => {
        const controls_container = page.locator(`[data-testid="bz-bands-dos-with-controls"]`)
        await expect(controls_container.locator(`button.controls-toggle`)).toBeVisible()
      })

      await test.step(`multiple structures with legend and children snippet`, async () => {
        await page.locator(`#multiple-structures`).scrollIntoViewIfNeeded()
        const container = page.locator(`[data-testid="bz-bands-dos-multiple"]`)
        // Bands and DOS may each show a legend for multiple series
        const legend = container.locator(`.legend`).first()
        await expect(legend).toBeVisible()
        expect(await legend.locator(`.legend-item`).count()).toBeGreaterThanOrEqual(2)
        expect(await legend.textContent()).toContain(`DFT`)

        const custom_overlay = container.locator(`.custom-overlay`)
        await expect(custom_overlay).toBeVisible()
        await expect(custom_overlay).toHaveText(`Custom Overlay`)
        // all three panels still render alongside the child
        await expect(container.locator(`canvas`).first()).toBeVisible()
        await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
        await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
      })
    })

    test(`BZ rotates with mouse drag`, async ({ page }) => {
      const bz_canvas = page.locator(default_bz_canvas_selector).first()
      const initial = await canvas_screenshot(bz_canvas)
      await drag_canvas(bz_canvas, { dx: 50, steps: 10 })
      await expect_canvas_changed(bz_canvas, initial, 5000)
    })

    // hover reference lines and DOS-initiated zoom/reset are covered on the plain BandsAndDos
    // in bands-and-dos.test.ts; here the three-panel desktop grid keeps them aligned
    test(`desktop panels share y-axis rows and ticks; a bands zoom and reset propagate`, async ({
      page,
    }) => {
      const { bands_plot, dos_plot } = await get_default_desktop_plots(page)
      // plot control panes can extend beyond their grid cells
      await expect(bands_plot).toHaveCSS(`overflow`, `visible`)
      await expect(dos_plot).toHaveCSS(`overflow`, `visible`)

      await expect(() => expect_same_clip_rows(bands_plot, dos_plot)).toPass({
        timeout: 30_000,
      })
      await expect_synced_y_ticks(bands_plot, dos_plot)

      const bands_area = await measure_plot_area(bands_plot)
      const initial_bands_ticks = await numeric_y_ticks(bands_plot)
      await drag_plot_area(page, bands_area)
      await expect.poll(() => numeric_y_ticks(bands_plot)).not.toEqual(initial_bands_ticks)
      await expect_synced_y_ticks(bands_plot, dos_plot)

      await reset_plot_area(bands_plot, bands_area)
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
      const desktop_dos_box = await require_bbox(dos_svg, `desktop DOS`)
      expect(desktop_dos_box.width).toBeLessThan(desktop_dos_box.height * 2)

      const tablet = await set_layout(800, 700, `tablet`)
      expect(tablet.areas).toMatch(/bands.*bands/)
      expect_areas(tablet.areas, [`bz`, `dos`])
      expect(tablet.columns.split(` `)).toHaveLength(2)
      expect(tablet.gap).not.toMatch(/^$|^0px$/)
      const [canvas_box, container_box, tablet_dos_box] = await Promise.all([
        require_bbox(container.locator(`canvas`).first(), `tablet BZ canvas`),
        require_bbox(container, `tablet container`),
        require_bbox(dos_svg, `tablet DOS`),
      ])
      expect(canvas_box.height).toBeLessThanOrEqual(container_box.height / 2 + 50)
      expect(tablet_dos_box.width).toBeGreaterThan(tablet_dos_box.height * 0.5)

      const phone = await set_layout(500, 900, `phone`)
      expect(phone.areas.split(`"`).length).toBeGreaterThanOrEqual(3)
      expect(phone.columns).not.toContain(` `)
      expect(phone.gap).not.toMatch(/^$|^0px$/)
      await expect(bands_svg).toBeVisible()
      await expect(dos_svg).toBeVisible()
    })
  },
)
