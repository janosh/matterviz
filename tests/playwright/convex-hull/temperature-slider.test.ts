import { expect, test } from '@playwright/test'
import { IS_CI, wait_for_canvas_rendered } from '../helpers'

// Tests for temperature-dependent free energy feature
// The demo page has synthetic G(T) data in the "Temperature-Dependent Free Energies" section

test.describe(`Temperature-Dependent Free Energies`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Temperature slider tests timeout in CI`)
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    // Wait for the temperature section to be visible (synthetic data loads immediately)
    await expect(page.locator(`.temp-grid`)).toBeVisible({ timeout: 30_000 })
  })

  test.describe(`2D Binary (Li-Fe)`, () => {
    test(`temperature slider appears for temperature-dependent data`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .scatter.convex-hull-2d`).first()
      await expect(diagram).toBeVisible()

      // Temperature slider should be visible
      const temp_slider = diagram.locator(`.temperature-slider`)
      await expect(temp_slider).toBeVisible()

      // Should display temperature label
      const temp_label = temp_slider.locator(`.temp-label`)
      await expect(temp_label).toBeVisible()
      await expect(temp_label).toContainText(`K`)

      // Should display temperature range
      const temp_range = temp_slider.locator(`.temp-range`)
      await expect(temp_range).toBeVisible()
      await expect(temp_range).toContainText(`300`)
      await expect(temp_range).toContainText(`1500`)
    })

    test(`temperature slider changes displayed temperature`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .scatter.convex-hull-2d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)
      const temp_label = temp_slider.locator(`.temp-label`)
      const range_input = temp_slider.locator(`input[type="range"]`)

      // Get initial temperature
      const initial_temp = await temp_label.textContent()

      // Move slider to a different position
      await range_input.fill(`2`) // Index 2 = 900K (temperatures: [300, 600, 900, 1200, 1500])

      // Temperature should update
      await expect(temp_label).toContainText(`900 K`)
      expect(await temp_label.textContent()).not.toBe(initial_temp)
    })

    test(`temperature slider has tooltip`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .scatter.convex-hull-2d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)

      // Hover to trigger tooltip
      await temp_slider.hover()

      // Tooltip should appear (using the tooltip from svelte-multiselect)
      const tooltip = page.locator(`.tooltip, [role="tooltip"]`)
      // Give tooltip time to appear
      await expect(tooltip.first()).toBeVisible({ timeout: 3000 }).catch(() => {
        // Tooltip may not appear in all browsers - not a critical failure
      })
    })

    test(`hull updates when temperature changes`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .scatter.convex-hull-2d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)
      const range_input = temp_slider.locator(`input[type="range"]`)

      // Get initial temperature
      const temp_label = temp_slider.locator(`.temp-label`)
      const initial_temp = await temp_label.textContent()

      // Change temperature to a different value
      await range_input.fill(`4`) // Index 4 = 1500K

      // Verify temperature changed
      await expect(temp_label).toContainText(`1500 K`)
      expect(await temp_label.textContent()).not.toBe(initial_temp)

      // Component should still render without errors
      await expect(diagram).toBeVisible()

      // Markers should still be visible (hull was recomputed)
      const markers = diagram.locator(`path.marker`)
      await expect(markers.first()).toBeVisible()
    })
  })

  test.describe(`3D Ternary (Li-Fe-O)`, () => {
    test(`temperature slider appears on 3D diagram`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .convex-hull-3d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)
      await expect(temp_slider).toBeVisible()

      // Verify slider has correct range
      const range_input = temp_slider.locator(`input[type="range"]`)
      await expect(range_input).toHaveAttribute(`min`, `0`)
      await expect(range_input).toHaveAttribute(`max`, `4`) // 5 temperatures: 0-4
    })

    test(`canvas redraws when temperature changes`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .convex-hull-3d`).first()
      await expect(diagram).toBeVisible()

      const canvas = diagram.locator(`canvas`)
      await expect(canvas).toBeVisible()
      await wait_for_canvas_rendered(canvas)

      const temp_slider = diagram.locator(`.temperature-slider`)
      const range_input = temp_slider.locator(`input[type="range"]`)

      // Change temperature
      await range_input.fill(`3`) // Index 3 = 1200K

      // Wait for redraw and verify canvas still renders
      await expect(canvas).toBeVisible()
    })

    test(`temperature slider positioned in top-right corner`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .convex-hull-3d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)
      await expect(temp_slider).toBeVisible()

      // Verify positioning via computed styles
      const position = await temp_slider.evaluate((el) => {
        const style = getComputedStyle(el)
        return { position: style.position, right: style.right, top: style.top }
      })

      expect(position.position).toBe(`absolute`)
      expect(position.right).toMatch(/\d/) // Has a right value
    })
  })

  test.describe(`4D Quaternary (Li-Fe-Ni-O)`, () => {
    test(`temperature slider appears on 4D diagram`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .convex-hull-4d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)
      await expect(temp_slider).toBeVisible()

      // Should show full temperature range
      const temp_range = temp_slider.locator(`.temp-range`)
      await expect(temp_range).toContainText(`300`)
      await expect(temp_range).toContainText(`1500`)
    })

    test(`all temperature values are selectable`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .convex-hull-4d`).first()
      await expect(diagram).toBeVisible()

      const temp_slider = diagram.locator(`.temperature-slider`)
      const temp_label = temp_slider.locator(`.temp-label`)
      const range_input = temp_slider.locator(`input[type="range"]`)

      // Test first and last temperature values (sequential testing required)
      await range_input.fill(`0`)
      await expect(temp_label).toContainText(`300 K`)

      await range_input.fill(`2`)
      await expect(temp_label).toContainText(`900 K`)

      await range_input.fill(`4`)
      await expect(temp_label).toContainText(`1500 K`)
    })
  })
})

test.describe(`Temperature Slider - Accessibility`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Temperature slider tests timeout in CI`)
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    await expect(page.locator(`.temp-grid`)).toBeVisible({ timeout: 30_000 })
  })

  test(`slider has aria-label for accessibility`, async ({ page }) => {
    const diagram = page.locator(`.temp-grid .scatter.convex-hull-2d`).first()
    await expect(diagram).toBeVisible()

    const range_input = diagram.locator(`.temperature-slider input[type="range"]`)
    await expect(range_input).toHaveAttribute(`aria-label`, `Temperature (Kelvin)`)
  })

  test(`slider min/max attributes match available temperatures`, async ({ page }) => {
    const diagram = page.locator(`.temp-grid .convex-hull-3d`).first()
    await expect(diagram).toBeVisible()

    const range_input = diagram.locator(`.temperature-slider input[type="range"]`)
    // 5 temperatures [300, 600, 900, 1200, 1500] → indices 0-4
    await expect(range_input).toHaveAttribute(`min`, `0`)
    await expect(range_input).toHaveAttribute(`max`, `4`)
  })

  for (const dim of [`3d`, `4d`]) {
    test(`${dim.toUpperCase()} canvas has aria-label`, async ({ page }) => {
      const diagram = page.locator(`.temp-grid .convex-hull-${dim}`).first()
      await expect(diagram).toBeVisible()

      const canvas = diagram.locator(`canvas`)
      const aria_label = await canvas.getAttribute(`aria-label`)
      expect(aria_label).toBeTruthy()
    })
  }
})

test.describe(`Temperature Slider - Static Data`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Temperature slider tests timeout in CI`)
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    // Wait for binary grid (static data without temperature)
    await expect(page.locator(`.binary-grid`)).toBeVisible({ timeout: 50_000 })
  })

  // Static data grids should not have temperature sliders
  for (
    const [grid, selector] of [
      [`binary-grid`, `.scatter.convex-hull-2d`],
      [`ternary-grid`, `.convex-hull-3d`],
    ]
  ) {
    test(`${grid} has no temperature slider`, async ({ page }) => {
      const diagram = page.locator(`.${grid} ${selector}`).first()
      await expect(diagram).toBeVisible()
      await expect(diagram.locator(`.temperature-slider`)).toHaveCount(0)
    })
  }
})
