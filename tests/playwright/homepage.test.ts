import { expect } from '@playwright/test'
import { test_without_errors as test } from './helpers'

test(`landing page hydrates with correctly sized icons and defers offscreen demos`, async ({
  page,
}) => {
  test.slow()
  await page.goto(`/`, { waitUntil: `commit` })
  const npm_icon = page.locator(
    `code[title="For use in JavaScript/TypeScript/NodeJS."] a[href="https://www.npmjs.com/package/matterviz"] svg`,
  )
  await expect(npm_icon).toBeVisible()

  const icon_to_font_ratio = await npm_icon.evaluate((svg) => {
    const code = svg.closest(`code`)
    if (!code) throw new Error(`NPM icon is not inside the install command`)
    const font_px = Number(getComputedStyle(code).fontSize.replace(`px`, ``))
    return svg.getBoundingClientRect().height / font_px
  })
  expect(icon_to_font_ratio).toBeLessThanOrEqual(1.1)

  // Navigation must hydrate before the expensive demos and datasets farther down the page.
  await expect
    .poll(async () => {
      await page.getByRole(`button`, { name: `Open search`, exact: true }).click()
      return page.getByRole(`dialog`, { name: `Search the MatterViz site` }).isVisible()
    })
    .toBe(true)
  await page.keyboard.press(`Escape`)
  await expect(page.locator(`.structure canvas`)).toHaveCount(2)
  await expect(
    page.locator(`.trajectory, .fermi-surface, .hull-grid, .periodic-table`),
  ).toHaveCount(0)
})

// A plot in the table inset sits inside the table, so the tint that makes a standalone plot
// read as its own panel shows up as a stray grey box, and full-size axis labels dwarf a plot
// that small. Asserted on the inset, which hands both to whatever it holds: putting a plot in
// there means picking a heatmap from a dropdown.
test(`periodic table inset neutralises the plot panel tint and shrinks its labels`, async ({
  page,
}) => {
  test.slow()
  await page.goto(`/`, { waitUntil: `commit` })
  await page
    .getByRole(`region`, { name: `Periodic table`, exact: true })
    .scrollIntoViewIfNeeded()

  const inset = page.locator(`.table-inset`).first()
  await expect(inset).toBeVisible()
  await expect(inset).toHaveCSS(`--plot-bg`, `transparent`)
  // axis titles take this directly, tick labels 0.8em of it
  await expect(inset).toHaveCSS(`--scatter-font-size`, `12px`)
  await expect(inset).toHaveCSS(`--scatter-fullscreen-font-size`, `16px`)
  const fullscreen_bg = await inset.evaluate((node) =>
    getComputedStyle(node).getPropertyValue(`--scatter-fullscreen-bg`).trim(),
  )
  expect(fullscreen_bg).not.toBe(``)
  expect(fullscreen_bg).not.toBe(`transparent`)

  // The anchor exists before loading and remains unique after the demo mounts.
  const heatmap_heading = page.getByRole(`heading`, {
    name: `Multi-value Heatmap`,
    exact: true,
  })
  await page.goto(`/#2-fold-split-diagonal`, { waitUntil: `commit` })
  await expect(
    page
      .getByRole(`region`, { name: `Multi-value heatmap`, exact: true })
      .locator(`.periodic-table`),
  ).toBeVisible()
  await expect(heatmap_heading).toHaveCount(1)
  await expect(
    page.getByRole(`heading`, { name: `2-fold Split (Diagonal)`, exact: true }),
  ).toHaveCount(1)
})
