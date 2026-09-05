// Tests for HTML rendering in ConvexHull component titles.
// Verifies subscripts, superscripts, bold, italic render in diagram and controls pane titles.

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
  // Test all HTML element types on 2D (representative - same rendering code path)
  const HTML_CASES = [
    { tag: `sub`, title: `Li<sub>2</sub>O`, text: `2` },
    { tag: `sup`, title: `Fe<sup>3+</sup>-O`, text: `3+` },
    { tag: `b`, title: `<b>Stable</b> Phases`, text: `Stable` },
    { tag: `i`, title: `<i>Meta</i> Region`, text: `Meta` },
  ] as const

  for (const { tag, title, text } of HTML_CASES) {
    test(`2D diagram renders <${tag}>`, async ({ page }) => {
      const diagram = await goto_with_title(page, `2d`, title)
      const elem = diagram.locator(`h3 ${tag}`)
      await expect(elem).toHaveText(text)
    })
  }

  // Verify each dimension renders HTML in diagram title (one test per dim covers the code path)
  for (const dim of Object.keys(DIMS) as (keyof typeof DIMS)[]) {
    test(`${dim.toUpperCase()} diagram title and toolbar render consistently`, async ({
      page,
    }) => {
      const diagram = await goto_with_title(page, dim, `Test<sub>2</sub>Formula`)
      await expect(diagram.locator(`h3 sub`)).toHaveText(`2`)
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
        // 10% above the former 1.3em fullscreen icon; allow subpixel layout rounding.
        expect(width).toBeCloseTo(font_size * 1.3 * 1.1, 1)
      }
    })

    test(`${dim.toUpperCase()} controls pane title renders HTML`, async ({ page }) => {
      const diagram = await goto_with_title(page, dim, `X<sub>a</sub>Y<sup>+</sup>`)
      await dom_click(diagram.locator(`.legend-controls-btn`))
      const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
      await expect(controls).toBeVisible()
      await expect(controls.locator(`h4 sub`)).toHaveText(`a`)
      await expect(controls.locator(`h4 sup`)).toHaveText(`+`)
    })
  }

  // Regression: plain text still works
  test(`plain text title renders correctly`, async ({ page }) => {
    const title = `Simple Plain Title`
    const diagram = await goto_with_title(page, `2d`, title)
    await expect(diagram.locator(`h3`)).toHaveText(title)
  })

  // Complex formula with multiple subscripts
  test(`complex formula with multiple subscripts`, async ({ page }) => {
    const diagram = await goto_with_title(
      page,
      `3d`,
      `Li<sub>3</sub>V<sub>2</sub>(PO<sub>4</sub>)<sub>3</sub>`,
    )
    await expect(diagram.locator(`h3 sub`)).toHaveCount(4)
  })
})
