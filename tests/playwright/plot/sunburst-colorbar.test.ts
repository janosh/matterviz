import { expect, test } from '@playwright/test'

const padding_by_side = { left: 40, right: 24 } as const
const colorbar_gap = 8

test.describe(`Sunburst vertical colorbars`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/sunburst-colorbar`)
  })

  for (const colorbar_side of [`left`, `right`] as const) {
    test(`${colorbar_side} colorbar and ticks stay inside their reserve`, async ({ page }) => {
      const plot = page.locator(`#vertical-colorbar-${colorbar_side} .sunburst`)
      const colorbar = plot.locator(`.colorbar`)
      const [plot_box, arcs_box, colorbar_box] = await Promise.all([
        plot.boundingBox(),
        plot.locator(`.arcs`).boundingBox(),
        colorbar.boundingBox(),
      ])
      if (!plot_box || !arcs_box || !colorbar_box) {
        throw new Error(`missing plot/arcs/colorbar bounding box`)
      }
      const tick_boxes = await colorbar.locator(`.tick-label`).evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect()
          return { x: rect.x, width: rect.width }
        }),
      )
      expect(tick_boxes.length).toBeGreaterThan(0)
      const plot_right = plot_box.x + plot_box.width
      const colorbar_right = colorbar_box.x + colorbar_box.width
      expect(colorbar_box.x).toBeGreaterThanOrEqual(plot_box.x)
      expect(colorbar_right).toBeLessThanOrEqual(plot_right)
      for (const tick_box of tick_boxes) {
        expect(tick_box.x).toBeGreaterThanOrEqual(colorbar_box.x)
        expect(tick_box.x + tick_box.width).toBeLessThanOrEqual(colorbar_right)
      }
      if (colorbar_side === `left`) {
        expect(colorbar_box.x).toBeCloseTo(plot_box.x + padding_by_side.left + colorbar_gap, 5)
        expect(colorbar_right).toBeLessThanOrEqual(arcs_box.x)
      } else {
        expect(colorbar_right).toBeCloseTo(
          plot_right - padding_by_side.right - colorbar_gap,
          5,
        )
        expect(colorbar_box.x).toBeGreaterThanOrEqual(arcs_box.x + arcs_box.width)
      }
    })
  }
})
