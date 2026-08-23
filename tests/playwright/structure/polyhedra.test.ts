import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  collect_console_errors,
  expect_canvas_changed,
  expect_canvas_changed_by,
  wait_for_3d_canvas,
} from '../helpers'

// these recompute/redraw heavy supercell+polyhedra scenes; CI's software WebGL under worker
// contention needs extra headroom for the canvas to change, so give the change detection a
// longer timeout than the default
const canvas_change_timeout = 30_000
const expect_redraw = (canvas: Locator, act: () => Promise<unknown>) =>
  expect_canvas_changed_by(canvas, act, canvas_change_timeout)

const demo_canvas = (page: Page) => wait_for_3d_canvas(page, `.bleed-1400`)
const control_checkbox = (page: Page, label: string): Locator =>
  page.locator(`.controls label`).filter({ hasText: label }).locator(`input[type="checkbox"]`)

test.describe(`Coordination Polyhedra Demo`, () => {
  let console_errors: string[]
  let canvas: Locator

  test.beforeEach(async ({ page }) => {
    console_errors = collect_console_errors(page)
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    canvas = await demo_canvas(page)
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
    const new_canvas = await demo_canvas(page)
    await expect_canvas_changed(new_canvas, initial, canvas_change_timeout)
  })

  test(`opacity slider and edge/hide-center toggles re-render the scene`, async ({ page }) => {
    test.slow()
    await expect_redraw(canvas, () =>
      page.locator(`.controls input[type="range"]`).fill(`0.1`),
    )
    await expect_redraw(canvas, () => control_checkbox(page, `Edges`).uncheck())
    await expect_redraw(canvas, () => control_checkbox(page, `Hide center atoms`).check())
  })

  test(`Ba spectator polyhedra hidden by default, force-include draws them`, async ({
    page,
  }) => {
    test.slow()
    await page.getByRole(`button`, { name: /BaTiO/ }).click()
    const new_canvas = await demo_canvas(page)

    const ba_toggle = control_checkbox(page, `Ba polyhedra`)
    await expect(ba_toggle).not.toBeChecked() // spectator A-site hidden by default
    await expect_redraw(new_canvas, () => ba_toggle.check())
  })
})
