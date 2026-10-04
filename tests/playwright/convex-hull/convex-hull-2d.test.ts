import { expect, type Locator, test } from '@playwright/test'
import { MAGNETIC_ORDERING_CATEGORY } from '#lib/convex-hull/types.js'
import { IS_CI } from '../helpers'
import { dom_click, open_info_and_controls } from './utils'

// Synthetic client-side data (no fixture download), a single hull and no rAF pulse loops:
// the heavy demo page starves protocol calls under load
test.describe(`ConvexHull2D on the performance page`, () => {
  test.beforeEach(() => {
    test.skip(IS_CI, `ConvexHull2D tests timeout in CI`)
  })

  test(`enable_click_selection=false prevents entry selection`, async ({ page }) => {
    await page.goto(`/test/convex-hull-performance?dim=2d&count=100&click_selection=false`, {
      waitUntil: `networkidle`,
      timeout: 15000,
    })
    const diagram = page.locator(`.scatter.convex-hull-2d`)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    const marker = diagram.locator(`path.marker`).first()
    await expect(marker).toBeVisible()
    await marker.click({ force: true })
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
  })

  test(`magnetic ordering filter toggle hides and restores shaped markers`, async ({
    page,
  }) => {
    await page.goto(`/test/convex-hull-performance?dim=2d&count=40&magnetic=true`, {
      waitUntil: `networkidle`,
      timeout: 15000,
    })
    const pd2d = page.locator(`.scatter.convex-hull-2d`)
    await expect(pd2d).toBeVisible()

    const markers = pd2d.locator(`path.marker`)
    await expect.poll(() => markers.count(), { timeout: 15000 }).toBeGreaterThan(0)
    const count_before = await markers.count()

    await dom_click(pd2d.locator(`.legend-controls-btn`))
    const controls = pd2d.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls.getByText(`Magnetic`, { exact: true })).toBeVisible()

    // One toggle per ordering present in data; swatch rendering is covered by
    // ConvexHullControls vitest.
    const toggles = controls.locator(`.category-filters .legend-item`)
    await expect(toggles).toHaveCount(Object.keys(MAGNETIC_ORDERING_CATEGORY.markers).length)

    // Hide FM entries -> fewer markers in the scatter plot
    const fm_toggle = toggles.filter({ hasText: /\bFM \(/ }).first()
    await dom_click(fm_toggle)
    await expect(fm_toggle).toHaveAttribute(`aria-pressed`, `false`)
    await expect.poll(() => markers.count(), { timeout: 15000 }).toBeLessThan(count_before)

    // Re-show FM -> marker count restored
    await dom_click(fm_toggle)
    await expect(fm_toggle).toHaveAttribute(`aria-pressed`, `true`)
    await expect.poll(() => markers.count(), { timeout: 15000 }).toBe(count_before)
  })
})

test.describe(`ConvexHull2D (Binary)`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ConvexHull2D tests timeout in CI`)
    // Extend the default 30s test timeout: it would kill the 50s data-load wait below
    // before it can succeed when parallel workers load this heavy page simultaneously
    test.setTimeout(90_000)
    await page.goto(`/convex-hull#binary-chemical-systems`, { waitUntil: `networkidle` })
    // binary-grid renders once ~2MB of gzipped JSON (~20MB raw) has loaded and parsed
    await expect(page.locator(`.binary-grid`).first()).toBeVisible({ timeout: 50000 })
  })

  const visible_unstable_counts = async (info: Locator) => {
    // Format: Visible unstable: X / Y
    const text = await info.getByTestId(`hull-visible-unstable`).textContent()
    const match = text?.match(/(?<visible>\d+)\s*\/\s*(?<total>\d+)/)
    if (!match) throw new Error(`unparsable visible-unstable text: ${text}`)
    return { visible: Number(match[1]), total: Number(match[2]) }
  }

  test(`renders hull and colorbar; color modes switch controls and 'Above hull' hides unstable points`, async ({
    page,
  }) => {
    await expect(page.getByRole(`heading`, { name: `Convex Hulls` })).toBeVisible()
    const pd2d = page.locator(`.binary-grid .scatter.convex-hull-2d`).first()
    await expect(pd2d.locator(`.colorbar`).first()).toBeAttached() // may start hidden
    await expect(pd2d.locator(`path[fill='none']`).first()).toBeVisible() // dashed hull lines

    const info_btn = pd2d.locator(`.info-btn`)
    await dom_click(info_btn)
    await expect(info_btn).toHaveAttribute(`aria-expanded`, `true`)
    const info = pd2d.locator(`.draggable-pane.convex-hull-info-pane`)
    const widths = await info
      .getByTestId(`tip-drag`)
      .locator(`span`)
      .evaluateAll((spans) => spans.map((span) => span.getBoundingClientRect().width))
    expect(widths).toHaveLength(2)
    const [label_width, value_width] = widths
    expect(value_width).toBeGreaterThan(label_width)

    const controls_btn = pd2d.locator(`.legend-controls-btn`)
    await dom_click(controls_btn)
    await expect(controls_btn).toHaveAttribute(`aria-expanded`, `true`)
    const controls = pd2d.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls.getByText(`Color mode`)).toBeVisible()
    await dom_click(controls.getByText(`Energy`, { exact: true }))
    await expect(controls.getByText(`Color scale`)).toBeVisible()
    // Stability mode swaps the Color scale selector for Points toggles
    await dom_click(controls.getByText(`Stability`, { exact: true }))
    await expect(controls.getByText(`Points`, { exact: true })).toBeVisible()
    await expect(controls.getByText(`Color scale`)).toHaveCount(0)

    await dom_click(controls.getByText(`Above hull`, { exact: false }))
    await expect.poll(async () => (await visible_unstable_counts(info)).visible).toBe(0)
  })

  test(`threshold slider filters entries and info pane reflects changes`, async ({ page }) => {
    const pd2d = page.locator(`.binary-grid .scatter.convex-hull-2d`).first()
    const { info, controls } = await open_info_and_controls(pd2d)
    const before = await visible_unstable_counts(info)
    const markers = pd2d.locator(`path.marker`)
    const count_before = await markers.count()

    const number_input = controls.getByRole(`spinbutton`, {
      name: `Points threshold (eV/atom)`,
    })
    await number_input.fill(`0`)
    await number_input.blur() // fires the change handlers

    await expect
      .poll(async () => (await visible_unstable_counts(info)).visible)
      .toBeLessThanOrEqual(before.visible)
    // lowering the threshold to 0 never adds markers
    const count_after = await markers.count()
    expect(count_after).toBeGreaterThan(0)
    expect(count_after).toBeLessThanOrEqual(count_before)
  })
})
