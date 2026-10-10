// Tests for HTML rendering in ConvexHull component titles. Every dim shares one
// {@html sanitize_html(title)} path; the allowed tags are pinned in tests/vitest/sanitize.test.ts.

import { expect, type Page, test } from '@playwright/test'
import { dom_click } from './utils'

// Dimension configs: selector for diagram container
const DIMS = {
  '2d': `.scatter.convex-hull-2d`,
  '3d': `.convex-hull-3d`,
  '4d': `.convex-hull-4d`,
} as const

// Navigate to test page with HTML title. Avoid waitUntil: `networkidle`, which needs 500ms
// of network silence and can outlast the timeout when CI workers contend; the visibility
// assertion below gates on the state the tests actually depend on.
async function goto_with_title(page: Page, dim: keyof typeof DIMS, title: string) {
  await page.goto(
    `/test/convex-hull-performance?dim=${dim}&count=50&title=${encodeURIComponent(title)}`,
  )
  const diagram = page.locator(DIMS[dim])
  await expect(diagram).toBeVisible({ timeout: 20000 })
  return diagram
}

test.describe(`ConvexHull HTML Title Rendering`, () => {
  for (const dim of Object.keys(DIMS) as (keyof typeof DIMS)[]) {
    test(`${dim.toUpperCase()} diagram and controls pane titles render HTML, toolbar icons match`, async ({
      page,
    }) => {
      const diagram = await goto_with_title(page, dim, `X<sub>a</sub>Y<sup>+</sup>`)
      await expect(diagram.locator(`h3 sub`)).toHaveText(`a`)
      await expect(diagram.locator(`h3 sup`)).toHaveText(`+`)
      if (dim === `2d`) {
        const title_bottom = await diagram
          .locator(`h3`)
          .evaluate((element) => element.getBoundingClientRect().bottom)
        await expect
          .poll(() =>
            diagram
              .locator(`svg > line`)
              .first()
              .evaluate((element) => element.getBoundingClientRect().top),
          )
          .toBeGreaterThan(title_bottom)
      }
      const icons = diagram.locator(`:scope > .control-buttons > button > svg`)
      await expect(icons).toHaveCount(4)
      const sizes = await icons.evaluateAll((elements) =>
        elements.map((element) => {
          const { width, height } = element.getBoundingClientRect()
          return {
            width,
            height,
            font_size: Number(getComputedStyle(element).fontSize.slice(0, -2)),
          }
        }),
      )
      for (const { width, height, font_size } of sizes) {
        expect(height).toBe(width)
        expect(width).toBe(sizes[0].width)
        expect(width).toBe(font_size)
      }

      await dom_click(diagram.locator(`.legend-controls-btn`))
      const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
      await expect(controls).toBeVisible()
      await expect(controls.locator(`h4 sub`)).toHaveText(`a`)
      await expect(controls.locator(`h4 sup`)).toHaveText(`+`)
    })
  }
})
