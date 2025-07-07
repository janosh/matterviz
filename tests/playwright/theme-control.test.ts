// deno-lint-ignore-file no-await-in-loop
import { expect, type Page, test } from '@playwright/test'

test.describe(`ThemeControl`, () => {
  const themes = [`light`, `dark`, `white`, `black`, `auto`] as const
  const theme_icons = [`☀️`, `🌙`, `⚪`, `⚫`, `🔄`] as const

  // Helper function to get theme control and wait for it
  async function get_theme_control(page: Page) {
    await page.goto(`/`, { waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`, { timeout: 5000 })
    return page.locator(`.theme-control`)
  }

  test(`renders with all theme options`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    await expect(theme_control).toBeVisible()

    // Check scoped class contains theme-control
    const class_attr = await theme_control.getAttribute(`class`)
    expect(class_attr).toContain(`theme-control`)

    // Check all options are present with correct icons and count
    const options = theme_control.locator(`option`)
    await expect(options).toHaveCount(5)

    for (let idx = 0; idx < themes.length; idx++) {
      await expect(options.nth(idx)).toHaveText(
        new RegExp(`${theme_icons[idx]}.*${themes[idx]}`, `i`),
      )
    }
  })

  test(`applies all themes correctly`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const html_element = page.locator(`html`)

    for (const theme of themes.filter((t) => t !== `auto`)) {
      await theme_control.selectOption(theme)
      await page.waitForTimeout(100)

      // Check DOM attribute and color scheme
      await expect(html_element).toHaveAttribute(`data-theme`, theme)
      const color_scheme = await page.evaluate(() =>
        getComputedStyle(document.documentElement).colorScheme
      )
      expect(color_scheme).toBe(theme === `white` || theme === `light` ? `light` : `dark`)
    }
  })

  test(`auto theme responds to system preference`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const html_element = page.locator(`html`)

    await theme_control.selectOption(`auto`)
    await page.waitForTimeout(100)

    // Test dark preference
    await page.emulateMedia({ colorScheme: `dark` })
    await page.waitForTimeout(100)
    await expect(html_element).toHaveAttribute(`data-theme`, `dark`)

    // Test light preference
    await page.emulateMedia({ colorScheme: `light` })
    await page.waitForTimeout(100)
    await expect(html_element).toHaveAttribute(`data-theme`, `light`)
  })

  test(`persists preferences and handles page navigation`, async ({ page }) => {
    let theme_control = await get_theme_control(page)

    // Set theme and check localStorage
    await theme_control.selectOption(`dark`)
    await page.waitForTimeout(100)

    const saved_theme = await page.evaluate(() => localStorage.getItem(`matterviz-theme`))
    expect(saved_theme).toBe(`dark`)

    // Test persistence across reload
    await page.reload({ waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`)
    theme_control = page.locator(`.theme-control`)

    await expect(theme_control).toHaveValue(`dark`)
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`)

    // Test persistence across navigation
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`)
    await expect(page.locator(`.theme-control`)).toHaveValue(`dark`)
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`)
  })

  test(`styling and interaction work correctly`, async ({ page }) => {
    const theme_control = await get_theme_control(page)

    // Test positioning
    await expect(theme_control).toHaveCSS(`position`, `fixed`)
    const bottom_val = await theme_control.evaluate((el: Element) =>
      getComputedStyle(el).bottom
    )
    const left_val = await theme_control.evaluate((el: Element) =>
      getComputedStyle(el).left
    )
    const z_index_val = await theme_control.evaluate((el: Element) =>
      getComputedStyle(el).zIndex
    )

    expect(parseFloat(bottom_val)).toBeGreaterThan(0)
    expect(parseFloat(left_val)).toBeGreaterThan(0)
    expect(parseInt(z_index_val)).toBeGreaterThanOrEqual(100)

    // Test backdrop filter
    const backdrop_filter = await theme_control.evaluate((el: Element) =>
      getComputedStyle(el).backdropFilter
    )
    expect(backdrop_filter).toContain(`blur`)

    // Test hover styling
    const initial_shadow = await theme_control.evaluate((el: Element) =>
      getComputedStyle(el).boxShadow
    )
    await theme_control.hover()
    const hover_shadow = await theme_control.evaluate((el: Element) =>
      getComputedStyle(el).boxShadow
    )
    expect(hover_shadow !== initial_shadow || hover_shadow !== `none`).toBe(true)

    // Test keyboard navigation
    await theme_control.focus()
    await page.keyboard.press(`ArrowDown`)
    await page.waitForTimeout(50)
    const selected_value = await theme_control.inputValue()
    expect(themes).toContain(selected_value as typeof themes[number])
  })

  test(`handles edge cases and stability`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const console_errors: string[] = []

    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    // Test rapid theme changes
    for (const theme of [`light`, `dark`, `white`, `black`, `auto`, `light`]) {
      await theme_control.selectOption(theme)
      await page.waitForTimeout(10)
    }
    expect(console_errors).toHaveLength(0)

    // Test initialization with no saved preference
    await page.evaluate(() => localStorage.removeItem(`matterviz-theme`))
    await page.goto(`/`, { waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`)

    const fresh_control = page.locator(`.theme-control`)
    await expect(fresh_control).toHaveValue(`auto`)
    const theme_attr = await page.locator(`html`).getAttribute(`data-theme`)
    expect([`light`, `dark`]).toContain(theme_attr)
  })

  test(`works across different routes`, async ({ page }) => {
    const test_routes = [`/`, `/bohr-atoms`, `/periodic-table`]

    for (const route of test_routes) {
      await page.goto(route, { waitUntil: `networkidle` })
      await page.waitForSelector(`.theme-control`, { timeout: 5000 })

      const theme_control = page.locator(`.theme-control`)
      await expect(theme_control).toBeVisible()

      await theme_control.selectOption(`dark`)
      await page.waitForTimeout(100)
      await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`)
    }
  })

  test(`handles all theme preferences correctly`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const html_element = page.locator(`html`)

    for (const theme of themes) {
      await theme_control.selectOption(theme)
      await page.waitForTimeout(100)

      // Check localStorage
      const saved_theme = await page.evaluate(() =>
        localStorage.getItem(`matterviz-theme`)
      )
      expect(saved_theme).toBe(theme)

      // Check DOM (auto resolves to system preference)
      if (theme === `auto`) {
        const theme_attr = await html_element.getAttribute(`data-theme`)
        expect([`light`, `dark`]).toContain(theme_attr)
      } else {
        await expect(html_element).toHaveAttribute(`data-theme`, theme)
      }
    }
  })
})
