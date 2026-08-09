import { expect, test } from '@playwright/test'

test(`installation icon fits the command line`, async ({ page }) => {
  test.slow()
  await page.goto(`/`, { waitUntil: `commit` })
  const install_code = page.locator(
    `code[title="For use in JavaScript/TypeScript/NodeJS."]`,
  )
  const npm_icon = install_code.locator(
    `a[href="https://www.npmjs.com/package/matterviz"] svg`,
  )
  await expect(npm_icon).toBeVisible()

  const icon_to_font_ratio = await npm_icon.evaluate((svg) => {
    const code = svg.closest(`code`)
    if (!code) throw new Error(`NPM icon is not inside the install command`)
    return svg.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(code).fontSize)
  })
  expect(icon_to_font_ratio).toBeLessThanOrEqual(1.1)
})
