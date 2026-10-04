import { THEME_OPTIONS, type ThemeMode } from '#lib/theme/index.js'
import { expect, type Locator, type Page, test } from '@playwright/test'

test.describe(`ThemeControl`, () => {
  const themes = THEME_OPTIONS.map((option) => option.value)
  const theme_icons = THEME_OPTIONS.map((option) => option.icon)

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem(`matterviz-theme`))
  })

  // ThemeControl lives in the root layout, so the light markdown page hydrates it fastest
  // under CI contention (the homepage carries periodic tables and 3D scenes)
  const light_route = `/acknowledgements`

  async function get_theme_control(page: Page) {
    await page.goto(light_route)
    const control = page.locator(`.theme-control`)
    await expect(control).toBeVisible({ timeout: 15_000 })
    return control
  }

  // The effect applying a theme only attaches after hydration, and app.html's inline FOUC
  // script sets data-theme before that, so retry the selection until data-theme flips to it
  async function select_theme(page: Page, control: Locator, mode: ThemeMode) {
    await expect(async () => {
      await control.selectOption(mode)
      await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, mode, {
        timeout: 1500,
      })
    }).toPass({ timeout: 15_000 })
  }

  test(`lists every theme option and applies each one's color scheme`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const options = theme_control.locator(`option`)
    await expect(options).toHaveCount(5)
    for (let idx = 0; idx < themes.length; idx++) {
      await expect(options.nth(idx)).toHaveText(
        new RegExp(`${theme_icons[idx]}.*${themes[idx]}`, `i`),
      )
    }

    for (const theme of themes.filter((theme_name) => theme_name !== `auto`)) {
      await select_theme(page, theme_control, theme)
      const expected_scheme = theme === `white` || theme === `light` ? `light` : `dark`
      await expect
        .poll(
          () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
          { timeout: 15_000 },
        )
        .toBe(expected_scheme)
    }
  })

  test(`changes color theme from the command menu`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    await select_theme(page, theme_control, `white`)
    const menu_label = `Search the MatterViz site`
    const dialog = page.getByRole(`dialog`, { name: menu_label })
    await page.getByRole(`button`, { name: `Open search` }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole(`combobox`, { name: menu_label }).fill(`dark colour appearance`)
    await dialog.getByRole(`option`, { name: /dark color theme/i }).click()
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`)
    await expect(theme_control).toHaveValue(`dark`)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem(`matterviz-theme`)))
      .toBe(`dark`)

    await page.keyboard.press(`Control+K`)
    await expect(dialog).toBeVisible()
    await dialog.getByRole(`combobox`, { name: menu_label }).fill(`white colour appearance`)
    await dialog.getByRole(`option`, { name: /white color theme/i }).click()
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `white`)
    await expect(theme_control).toHaveValue(`white`)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem(`matterviz-theme`)))
      .toBe(`white`)
  })

  test(`syntax highlighting colors follow app theme not OS preference`, async ({ page }) => {
    // Regression: starry-night gates its dark palette behind a prefers-color-scheme
    // media query; starry_night_theme_plugin (vite.config.ts) re-targets it to
    // data-theme so a manually chosen dark theme uses the dark palette even when
    // the OS prefers light. Variable name + colors below verified against
    // @wooorm/starry-night@3.9.0: storage-modifier-import is near-black (#1f2328) in
    // the light palette and must become the readable dark value (#f0f6fc).
    await page.emulateMedia({ colorScheme: `light` })
    const theme_control = await get_theme_control(page)
    await select_theme(page, theme_control, `dark`)

    await expect
      .poll(
        () =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement)
              .getPropertyValue(`--color-prettylights-syntax-storage-modifier-import`)
              .trim(),
          ),
        { timeout: 15_000 },
      )
      .toBe(`#f0f6fc`)
  })

  test(`auto theme responds to system preference`, async ({ page }) => {
    const theme_control = await get_theme_control(page)
    const html_element = page.locator(`html`)

    await theme_control.selectOption(`auto`)

    // Test dark preference
    await page.emulateMedia({ colorScheme: `dark` })
    await expect(html_element).toHaveAttribute(`data-theme`, `dark`, { timeout: 15_000 })

    // Test light preference
    await page.emulateMedia({ colorScheme: `light` })
    await expect(html_element).toHaveAttribute(`data-theme`, `light`, { timeout: 15_000 })
  })

  test(`persists preferences and handles page navigation`, async ({ browser }) => {
    // a fresh context without the beforeEach init script, which would wipe the stored theme
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(light_route)
    await page.evaluate(() => localStorage.removeItem(`matterviz-theme`))
    await page.reload()
    const theme_control = page.locator(`.theme-control`)
    await expect(theme_control).toBeVisible({ timeout: 15_000 })
    await select_theme(page, theme_control, `dark`)
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem(`matterviz-theme`)), {
        timeout: 15_000,
      })
      .toBe(`dark`)

    // survives a reload and a navigation (a light route: the heavy /bohr-atoms page timed
    // out under CI's software renderer)
    for (const reload of [true, false]) {
      if (reload) await page.reload()
      else await page.goto(`/acknowledgements`)
      await expect(theme_control).toHaveValue(`dark`, { timeout: 15_000 })
      await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`, {
        timeout: 15_000,
      })
    }
    await context.close()
  })
})
