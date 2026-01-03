// deno-lint-ignore-file no-await-in-loop
import { THEME_OPTIONS } from '$lib/theme'
import { expect, type Page, test } from '@playwright/test'

test.describe(`ThemeControl`, () => {
  const themes = THEME_OPTIONS.map((option) => option.value)
  const theme_icons = THEME_OPTIONS.map((option) => option.icon)

  test.beforeEach(async ({ page }) => {
    // Ensure clean state for each test
    await page.addInitScript(() => localStorage.removeItem(`matterviz-theme`))
  })

  // Helper function to get theme control and wait for it
  async function get_theme_control(page: Page) {
    await page.goto(`/`, { waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`, { timeout: 10000 })
    const control = page.locator(`.theme-control`)
    await expect(control).toBeVisible({ timeout: 5000 })
    return control
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

      // Check DOM attribute with retry for timing issues
      await expect(async () => {
        await expect(html_element).toHaveAttribute(`data-theme`, theme)
      }).toPass({ timeout: 5000 })

      // Check color-scheme computed style
      const expected_scheme = theme === `white` || theme === `light` ? `light` : `dark`
      await expect(async () => {
        const color_scheme = await page.evaluate(() =>
          getComputedStyle(document.documentElement).colorScheme
        )
        expect(color_scheme).toBe(expected_scheme)
      }).toPass({ timeout: 5000 })
    }
  })

  test(`auto theme responds to system preference`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const html_element = page.locator(`html`)

    await theme_control.selectOption(`auto`)

    // Test dark preference with retry
    await page.emulateMedia({ colorScheme: `dark` })
    await expect(async () => {
      await expect(html_element).toHaveAttribute(`data-theme`, `dark`)
    }).toPass({ timeout: 5000 })

    // Test light preference with retry
    await page.emulateMedia({ colorScheme: `light` })
    await expect(async () => {
      await expect(html_element).toHaveAttribute(`data-theme`, `light`)
    }).toPass({ timeout: 5000 })
  })

  test(`persists preferences and handles page navigation`, async ({ page }) => {
    let theme_control = await get_theme_control(page)

    // Set theme and check localStorage
    await theme_control.selectOption(`dark`)

    await expect(async () => {
      const saved_theme = await page.evaluate(() =>
        localStorage.getItem(`matterviz-theme`)
      )
      expect(saved_theme).toBe(`dark`)
    }).toPass({ timeout: 3000 })

    // Test persistence across reload
    await page.reload({ waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`, { timeout: 10000 })
    theme_control = page.locator(`.theme-control`)

    await expect(theme_control).toHaveValue(`dark`, { timeout: 5000 })
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`, {
      timeout: 5000,
    })

    // Test persistence across navigation
    await page.goto(`/bohr-atoms`, { waitUntil: `networkidle` })
    await page.waitForSelector(`.theme-control`, { timeout: 10000 })
    await expect(page.locator(`.theme-control`)).toHaveValue(`dark`, { timeout: 5000 })
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`, {
      timeout: 5000,
    })
  })
})
