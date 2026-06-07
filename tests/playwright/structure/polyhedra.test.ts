import { expect, type Page, test } from '@playwright/test'
import { expect_canvas_changed, wait_for_3d_canvas } from '../helpers'

const collect_console_errors = (page: Page): string[] => {
  const console_errors: string[] = []
  page.on(`console`, (msg) => {
    if (msg.type() === `error`) console_errors.push(msg.text())
  })
  return console_errors
}

test.describe(`Coordination Polyhedra Demo`, () => {
  test(`renders demo page without console errors`, async ({ page }) => {
    const console_errors = collect_console_errors(page)
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    await expect(page.locator(`h1`)).toContainText(`Coordination Polyhedra`)
    await wait_for_3d_canvas(page, `.bleed-1400`)
    expect(console_errors).toEqual([])
  })

  // these recompute/redraw heavy supercell+polyhedra scenes; CI's software WebGL under worker
  // contention needs extra headroom for the canvas to change, so mark them slow + give the
  // change detection a longer timeout than the default
  const canvas_change_timeout = 30_000

  test(`structure selector switches structures and polyhedra re-render`, async ({ page }) => {
    test.slow()
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    const canvas = await wait_for_3d_canvas(page, `.bleed-1400`)
    const initial = await canvas.screenshot()

    await page.getByRole(`button`, { name: /rutile/ }).click()
    // {#key} remounts the viewer, so wait for the fresh canvas
    const new_canvas = await wait_for_3d_canvas(page, `.bleed-1400`)
    await expect_canvas_changed(new_canvas, initial, canvas_change_timeout)
  })

  test(`opacity slider and edge/hide-center toggles re-render the scene`, async ({ page }) => {
    test.slow()
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    const canvas = await wait_for_3d_canvas(page, `.bleed-1400`)

    const before_opacity = await canvas.screenshot()
    await page.locator(`.controls input[type="range"]`).fill(`0.1`)
    await expect_canvas_changed(canvas, before_opacity, canvas_change_timeout)

    const before_edges = await canvas.screenshot()
    await page
      .locator(`.controls label`)
      .filter({ hasText: `Edges` })
      .locator(`input[type="checkbox"]`)
      .uncheck()
    await expect_canvas_changed(canvas, before_edges, canvas_change_timeout)

    const before_hide = await canvas.screenshot()
    await page
      .locator(`.controls label`)
      .filter({ hasText: `Hide center atoms` })
      .locator(`input[type="checkbox"]`)
      .check()
    await expect_canvas_changed(canvas, before_hide, canvas_change_timeout)
  })

  test(`Ba spectator polyhedra hidden by default, force-include draws them`, async ({
    page,
  }) => {
    test.slow()
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    await page.getByRole(`button`, { name: /BaTiO/ }).click()
    const canvas = await wait_for_3d_canvas(page, `.bleed-1400`)

    const ba_toggle = page
      .locator(`.controls label`)
      .filter({ hasText: `Ba polyhedra` })
      .locator(`input[type="checkbox"]`)
    await expect(ba_toggle).not.toBeChecked() // spectator A-site hidden by default

    const before = await canvas.screenshot()
    await ba_toggle.check()
    await expect_canvas_changed(canvas, before, canvas_change_timeout)
  })

  test(`molecule section renders SF6 octahedron viewer`, async ({ page }) => {
    await page.goto(`/structure/polyhedra`, { waitUntil: `networkidle` })
    // Two Structure viewers on the page: crystal demo + SF6 molecule
    await expect(page.locator(`.structure canvas`)).toHaveCount(2)
  })
})
