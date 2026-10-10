import { expect, test } from '@playwright/test'
import {
  drag_plot_area,
  expect_synced_y_ticks,
  get_chart_svg,
  measure_plot_area,
  numeric_y_ticks,
  require_bbox,
  reset_plot_area,
} from '../helpers'

test.describe(`BandsAndDos Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bands-and-dos`, { waitUntil: `networkidle` })
  })

  test(`renders bands and DOS side by side in a grid with a shared y-axis`, async ({
    page,
  }) => {
    const container = page.locator(`[data-testid="bands-and-dos-default"]`)
    expect(await container.evaluate((element) => getComputedStyle(element).display)).toBe(
      `grid`,
    )
    const plots = container.locator(`.scatter`)
    await expect(plots).toHaveCount(2)
    const [bands_plot, dos_plot] = [plots.first(), plots.nth(1)]
    for (const plot of [bands_plot, dos_plot]) {
      expect(await plot.locator(`path[fill="none"]`).count()).toBeGreaterThan(0)
      await expect(plot.locator(`g.x-axis`)).toBeVisible()
      await expect(plot.locator(`g.y-axis`)).toBeVisible()
    }
    // bands label high-symmetry points (Γ, X, ...), DOS has numeric x ticks
    expect((await bands_plot.locator(`g.x-axis text`).allTextContents()).join(``)).toMatch(
      /[ΓXM]/,
    )
    const dos_x_ticks = await dos_plot.locator(`g.x-axis text`).allTextContents()
    expect(dos_x_ticks.some((tick) => !isNaN(Number(tick)))).toBe(true)

    // Shared top/bottom padding must align the actual drawable regions, not only
    // the equal-height outer plot containers.
    const bands_clip = bands_plot.locator(`clipPath rect`)
    const dos_clip = dos_plot.locator(`clipPath rect`)
    await expect(async () => {
      for (const attribute of [`y`, `height`]) {
        expect(await bands_clip.getAttribute(attribute)).toBe(
          await dos_clip.getAttribute(attribute),
        )
      }
      // shared y-axis: tick values overlap significantly
      const [bands_y_ticks, dos_y_ticks] = await Promise.all([
        numeric_y_ticks(bands_plot),
        numeric_y_ticks(dos_plot),
      ])
      const common_ticks = bands_y_ticks.filter((tick) => dos_y_ticks.includes(tick))
      expect(common_ticks.length).toBeGreaterThan(bands_y_ticks.length / 2)
      expect(bands_y_ticks.length).toBeGreaterThan(2)
      expect(dos_y_ticks.length).toBeGreaterThan(2)
    }).toPass({ timeout: 15_000 })
  })

  test(`y-axis zoom, reset, and re-enabled sync propagate without stale ranges`, async ({
    page,
  }) => {
    const container = page.locator(`[data-testid="bands-and-dos-default"]`)
    const plots = container.locator(`.scatter`)
    const bands_plot = plots.first()
    const dos_plot = plots.nth(1)
    const initial_ticks = await numeric_y_ticks(dos_plot)
    const dos_area = await measure_plot_area(dos_plot)
    await drag_plot_area(page, dos_area)
    await expect.poll(() => numeric_y_ticks(dos_plot)).not.toEqual(initial_ticks)
    await expect_synced_y_ticks(dos_plot, bands_plot)
    const zoomed_ticks = await numeric_y_ticks(dos_plot)

    await page.getByTestId(`toggle-y-zoom-sync`).click()
    const bands_area = await measure_plot_area(bands_plot)
    await reset_plot_area(bands_plot, bands_area)
    await expect(async () => {
      expect(await numeric_y_ticks(bands_plot)).toEqual(initial_ticks)
      expect(await numeric_y_ticks(dos_plot)).toEqual(zoomed_ticks)
    }).toPass({ timeout: 10_000 })

    await page.getByTestId(`toggle-y-zoom-sync`).click()
    await expect_synced_y_ticks(bands_plot, dos_plot, zoomed_ticks)

    await reset_plot_area(dos_plot, dos_area)
    await expect_synced_y_ticks(bands_plot, dos_plot, initial_ticks)
  })

  test(`applies custom widths and passes props to subcomponents`, async ({ page }) => {
    // Check custom widths
    const custom_container = page.locator(`[data-testid="bands-and-dos-custom-widths"]`)
    await expect(custom_container).toBeVisible()
    await expect(custom_container).toHaveAttribute(`style`, /grid-template-columns/)

    // Check bands props passed
    const bands_container = page.locator(`[data-testid="bands-and-dos-bands-styling"]`)
    const bands_path = bands_container
      .locator(`.scatter`)
      .first()
      .locator(`path[fill="none"]`)
      .first()
    expect(
      await bands_path.evaluate((element) => getComputedStyle(element).stroke),
    ).toBeTruthy()

    // Check DOS props passed (normalization)
    const dos_container = page.locator(`[data-testid="bands-and-dos-dos-norm"]`)
    await expect(dos_container.locator(`.scatter`).nth(1).locator(`g.y-axis`)).toBeVisible()
  })

  test(`independent y-axes keep their own ranges and render children`, async ({ page }) => {
    await page.locator(`#independent-axes`).scrollIntoViewIfNeeded()
    const container = page.locator(`[data-testid="bands-and-dos-independent-axes"]`)
    const custom_overlay = container.locator(`.custom-overlay`)
    await expect(custom_overlay).toBeVisible()
    await expect(custom_overlay).toHaveText(`Custom Overlay`)

    const plots = container.locator(`.scatter`)
    await expect(plots).toHaveCount(2)
    const [bands_y_ticks, dos_y_ticks] = await Promise.all(
      [plots.first(), plots.nth(1)].map(async (plot) =>
        (await plot.locator(`g.y-axis text`).allTextContents())
          .map(Number)
          .filter((num) => !isNaN(num)),
      ),
    )
    expect(bands_y_ticks.length).toBeGreaterThan(2)
    expect(dos_y_ticks.length).toBeGreaterThan(2)
    // high_freq_dos spans frequencies 10-30, far above the bands' range
    expect(Math.abs(Math.max(...bands_y_ticks) - Math.max(...dos_y_ticks))).toBeGreaterThan(5)
  })

  test(`hovering over DOS shows reference lines in both plots`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-and-dos-default"]`)
    const plots = container.locator(`.scatter`)
    const bands_plot = plots.first()
    const dos_plot = plots.nth(1)

    // Initially no reference lines should be visible
    const initial_bands_lines = await bands_plot.locator(`line[stroke-dasharray]`).count()
    const initial_dos_lines = await dos_plot.locator(`line[stroke-dasharray]`).count()

    // Hover over DOS plot
    const dos_svg = get_chart_svg(dos_plot)
    const dos_box = await require_bbox(dos_svg, `DOS plot`)
    await page.mouse.move(dos_box.x + dos_box.width / 2, dos_box.y + dos_box.height / 2)

    await expect(async () => {
      const hovered_bands_lines = await bands_plot.locator(`line[stroke-dasharray]`).count()
      const hovered_dos_lines = await dos_plot.locator(`line[stroke-dasharray]`).count()
      expect(hovered_bands_lines).toBeGreaterThan(initial_bands_lines)
      expect(hovered_dos_lines).toBeGreaterThan(initial_dos_lines)
    }).toPass({ timeout: 15_000 })
  })

  // Fermi level alignment tests - verifies BandsAndDos fermi_level prop takes precedence
  // over any fermi_level in bands_props/dos_props, ensuring Bands and DOS are aligned
  const fermi_alignment_cases = [
    { anchor: `#electronic-bands`, testid: `bands-and-dos-electronic`, tolerance: 15 },
    {
      anchor: `#electronic-spin-polarized`,
      testid: `bands-and-dos-spin-polarized`,
      tolerance: 30,
    },
  ] as const

  for (const { anchor, testid, tolerance } of fermi_alignment_cases) {
    test(`Fermi level lines aligned in ${testid}`, async ({ page }) => {
      await page.locator(anchor).scrollIntoViewIfNeeded()
      const container = page.locator(`[data-testid="${testid}"]`)
      await expect(container).toBeVisible()
      // Wait for plots to render rather than fixed delay
      const plots = container.locator(`.scatter`)
      await expect(plots).toHaveCount(2)

      const bands_fermi = plots.first().locator(`.fermi-level-line`)
      const dos_fermi = plots.nth(1).locator(`.fermi-level-line`)

      await expect(bands_fermi).toHaveCount(1, { timeout: 15_000 })
      await expect(dos_fermi).toHaveCount(1, { timeout: 15_000 })

      // Fermi lines should be at approximately the same y position
      await expect(async () => {
        const [bands_y1, dos_y1] = await Promise.all([
          bands_fermi.getAttribute(`y1`),
          dos_fermi.getAttribute(`y1`),
        ])
        if (!bands_y1 || !dos_y1) throw new Error(`Fermi level y-coordinates not found`)
        expect(Math.abs(Number(bands_y1) - Number(dos_y1))).toBeLessThanOrEqual(tolerance)
      }).toPass({ timeout: 15_000 })
    })
  }
})
