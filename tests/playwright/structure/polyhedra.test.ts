import { expect, type Locator, type Page, test } from '@playwright/test'
import { collect_console_errors, expect_canvas_changed, wait_for_3d_canvas } from '../helpers'

// these recompute/redraw heavy supercell+polyhedra scenes; CI's software WebGL under worker
// contention needs extra headroom for the canvas to change, so give the change detection a
// longer timeout than the default
const canvas_change_timeout = 30_000

const control_checkbox = (page: Page, label: string): Locator =>
  page.locator(`.controls label`).filter({ hasText: label }).locator(`input[type="checkbox"]`)

test.describe(`Coordination Polyhedra Demo`, () => {
  let console_errors: string[]
  let canvas: Locator

  test.beforeEach(async ({ page }) => {
    console_errors = collect_console_errors(page)
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    canvas = await wait_for_3d_canvas(page, `.bleed-1400`)
  })

  test(`renders demo page with crystal and SF6 viewers, no console errors`, async ({
    page,
  }) => {
    await expect(page.locator(`h1`)).toContainText(`Coordination Polyhedra`)
    // Two Structure viewers on the page: crystal demo + SF6 molecule
    await expect(page.locator(`.structure canvas`)).toHaveCount(2)
    expect(console_errors).toEqual([])
  })

  test(`structure selector switches structures and polyhedra re-render`, async ({ page }) => {
    test.slow()
    const initial = await canvas.screenshot()
    await page.getByRole(`button`, { name: /rutile/ }).click()
    // {#key} remounts the viewer, so wait for the fresh canvas
    const new_canvas = await wait_for_3d_canvas(page, `.bleed-1400`)
    await expect_canvas_changed(new_canvas, initial, canvas_change_timeout)
  })

  test(`opacity slider and edge/hide-center toggles re-render the scene`, async ({ page }) => {
    test.slow()
    const before_opacity = await canvas.screenshot()
    await page.locator(`.controls input[type="range"]`).fill(`0.1`)
    await expect_canvas_changed(canvas, before_opacity, canvas_change_timeout)

    const before_edges = await canvas.screenshot()
    await control_checkbox(page, `Edges`).uncheck()
    await expect_canvas_changed(canvas, before_edges, canvas_change_timeout)

    const before_hide = await canvas.screenshot()
    await control_checkbox(page, `Hide center atoms`).check()
    await expect_canvas_changed(canvas, before_hide, canvas_change_timeout)
  })

  test(`Ba spectator polyhedra hidden by default, force-include draws them`, async ({
    page,
  }) => {
    test.slow()
    await page.getByRole(`button`, { name: /BaTiO/ }).click()
    const new_canvas = await wait_for_3d_canvas(page, `.bleed-1400`)

    const ba_toggle = control_checkbox(page, `Ba polyhedra`)
    await expect(ba_toggle).not.toBeChecked() // spectator A-site hidden by default

    const before = await new_canvas.screenshot()
    await ba_toggle.check()
    await expect_canvas_changed(new_canvas, before, canvas_change_timeout)
  })
})
