import { expect, type Locator, test } from '@playwright/test'
import { IS_CI } from '../helpers'

// The demo page has synthetic G(T) data in the "Temperature-Dependent Free Energies" section
test.describe(`Temperature-dependent free energies`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Temperature slider tests timeout in CI`)
    await page.goto(`/convex-hull#temperature-dependent-free-energies`, {
      waitUntil: `networkidle`,
    })
    // synthetic data loads immediately once the section mounts
    await expect(page.locator(`.temp-grid`)).toBeVisible({ timeout: 30_000 })
    await page.locator(`.temp-grid > .lazy-demo`).last().scrollIntoViewIfNeeded()
  })

  const marker_positions = (diagram: Locator) => () =>
    diagram
      .locator(`path.marker`)
      .evaluateAll((markers) =>
        markers.map((marker) => marker.parentElement?.getAttribute(`transform`)),
      )

  test(`2D binary slider shows its K range, and the hull follows temperature`, async ({
    page,
  }) => {
    const diagram = page.locator(`.temp-grid .scatter.convex-hull-2d`).first()
    const temp_slider = diagram.locator(`.temperature-slider`)
    const temp_label = temp_slider.locator(`.slider-header`)
    await expect(temp_label).toContainText(`K`)
    await expect(temp_slider.locator(`.slider-range`)).toContainText(`300`)
    await expect(temp_slider.locator(`.slider-range`)).toContainText(`1500`)
    const range_input = temp_slider.locator(`input[type="range"]`)
    await expect(range_input).toHaveAttribute(`aria-label`, `Temperature (Kelvin)`)

    const temp_input = temp_label.locator(`input[type="number"]`)
    await expect(temp_input).not.toHaveValue(`900`)
    await range_input.fill(`900`)
    await expect(temp_input).toHaveValue(`900`)

    const temperature = diagram.getByRole(`spinbutton`, { name: `Temperature (Kelvin)` })
    await expect(diagram.locator(`path.marker`).first()).toBeVisible()
    const initial_positions = await marker_positions(diagram)()
    await temperature.fill(`1500`)
    await temperature.press(`Tab`)
    await expect(temperature).toHaveValue(`1500`)
    await expect.poll(marker_positions(diagram)).not.toEqual(initial_positions)
  })

  test(`3D ternary slider spans 300-1500 K in the top-right corner`, async ({ page }) => {
    const diagram = page.locator(`.temp-grid .convex-hull-3d`).first()
    await expect(diagram.locator(`canvas[aria-label]`)).toHaveAttribute(`aria-label`, /.+/)
    const temp_slider = diagram.locator(`.temperature-slider`)
    const range_input = temp_slider.locator(`input[type="range"]`)
    await expect(range_input).toHaveAttribute(`min`, `300`)
    await expect(range_input).toHaveAttribute(`max`, `1500`)

    // right half of the diagram, below the control-button row
    const [slider_box, diagram_box] = await Promise.all([
      temp_slider.boundingBox(),
      diagram.boundingBox(),
    ])
    if (!slider_box || !diagram_box) throw new Error(`missing bounding boxes`)
    expect(slider_box.x).toBeGreaterThan(diagram_box.x + diagram_box.width / 2)
    expect(slider_box.x + slider_box.width).toBeLessThanOrEqual(
      diagram_box.x + diagram_box.width,
    )
    expect(slider_box.y).toBeGreaterThan(diagram_box.y)
    expect(slider_box.y).toBeLessThan(diagram_box.y + diagram_box.height / 2)
  })

  test(`4D quaternary slider selects every temperature in its range`, async ({ page }) => {
    const diagram = page.locator(`.temp-grid .convex-hull-4d`).first()
    await expect(diagram.locator(`canvas[aria-label]`)).toHaveAttribute(`aria-label`, /.+/)
    const temp_slider = diagram.locator(`.temperature-slider`)
    await expect(temp_slider.locator(`.slider-range`)).toContainText(`300`)
    await expect(temp_slider.locator(`.slider-range`)).toContainText(`1500`)
    const temp_input = temp_slider.locator(`.slider-header input[type="number"]`)
    const range_input = temp_slider.locator(`input[type="range"]`)
    // sequential: each fill must land before the next
    for (const temp of [`300`, `900`, `1500`]) {
      await range_input.fill(temp)
      await expect(temp_input).toHaveValue(temp)
    }
  })

  test(`gas pressure updates its chemical potential and rendered hull`, async ({ page }) => {
    await page.locator(`#gas-atmosphere-control`).scrollIntoViewIfNeeded()
    const diagram = page.locator(`.gas-grid .scatter.convex-hull-2d`).first()
    await expect(diagram.locator(`path.marker`).first()).toBeVisible()
    const pressure = diagram.getByRole(`textbox`, { name: `O2 pressure (bar)` })
    const potential = diagram.locator(`.pressure-controls .sr-only`)
    const initial_potential = await potential.textContent()
    const initial_positions = await marker_positions(diagram)()
    await pressure.fill(`1e-6`)
    await pressure.press(`Tab`)
    await expect(pressure).toHaveValue(`1e-6`)
    await expect(potential).not.toHaveText(initial_potential ?? ``)
    await expect.poll(marker_positions(diagram)).not.toEqual(initial_positions)
    await pressure.fill(`invalid`)
    await pressure.press(`Tab`)
    await expect(pressure).toHaveValue(`1e-6`)
  })
})

test.describe(`Temperature Slider - Static Data`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Temperature slider tests timeout in CI`)
    await page.goto(`/convex-hull#binary-chemical-systems`, { waitUntil: `networkidle` })
    // Wait for binary grid (static data without temperature)
    await expect(page.locator(`.binary-grid`)).toBeVisible({ timeout: 50_000 })
  })

  // Static data grids should not have temperature sliders
  for (const [grid, selector] of [
    [`binary-grid`, `.scatter.convex-hull-2d`],
    [`ternary-grid`, `.convex-hull-3d`],
  ]) {
    test(`${grid} has no temperature slider`, async ({ page }) => {
      await page
        .locator(
          grid === `ternary-grid` ? `#ternary-chemical-systems` : `#binary-chemical-systems`,
        )
        .scrollIntoViewIfNeeded()
      const diagram = page.locator(`.${grid} ${selector}`).first()
      await expect(diagram).toBeVisible()
      await expect(diagram.locator(`.temperature-slider`)).toHaveCount(0)
    })
  }
})
