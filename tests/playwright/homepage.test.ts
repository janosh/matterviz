import { expect, test } from '@playwright/test'

test(`installation icon fits the command line`, async ({ page }) => {
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
})

// A plot in the table inset sits inside the table, so the tint that makes a standalone plot
// read as its own panel shows up as a stray grey box, and full-size axis labels dwarf a plot
// that small. Asserted on the inset, which hands both to whatever it holds: putting a plot in
// there means picking a heatmap from a dropdown, and this page streams a trajectory, so it
// never reaches the settled state Playwright needs to drive one.
test(`periodic table inset neutralises the plot panel tint and shrinks its labels`, async ({
  page,
}) => {
  test.slow()
  await page.goto(`/`, { waitUntil: `commit` })

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
})
