import { THEME_OPTIONS, type ThemeMode } from '$lib/theme'
import { expect, type Locator, type Page, test } from '@playwright/test'

test.describe(`ThemeControl`, () => {
  const themes = THEME_OPTIONS.map((option) => option.value)
  const theme_icons = THEME_OPTIONS.map((option) => option.icon)

  test.beforeEach(async ({ page }) => {
    // Ensure clean state for each test
    await page.addInitScript(() => localStorage.removeItem(`matterviz-theme`))
  })

  // ThemeControl lives in the root layout, so it's identical on every route. We
  // land on the lightweight /acknowledgements markdown page instead of the heavy
  // homepage (multiple periodic tables + 3D scenes) so the layout hydrates fast
  // even under CI contention -- selectOption only triggers ThemeControl's
  // reactive effect after hydration. We also avoid waitUntil: `networkidle`
  // (Playwright discourages it as flaky); auto-retrying assertions are the real
  // readiness signal.
  const light_route = `/acknowledgements`

  async function get_theme_control(page: Page) {
    await page.goto(light_route)
    const control = page.locator(`.theme-control`)
    await expect(control).toBeVisible({ timeout: 15_000 })
    return control
  }

  // Select a (non-auto) theme, retrying until ThemeControl's reactive effect has
  // run. selectOption updates the native <select> immediately, but the effect
  // that applies the theme + writes localStorage only attaches after Svelte
  // hydration. An inline FOUC script in app.html sets data-theme pre-hydration,
  // so the attribute merely existing is NOT a hydration signal -- but it flips to
  // `mode` once the effect runs, which is what we retry on. This replaces the
  // previous flaky `networkidle` wait that raced hydration under CI contention.
  async function select_theme(page: Page, control: Locator, mode: ThemeMode) {
    await expect(async () => {
      await control.selectOption(mode)
      await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, mode, {
        timeout: 1500,
      })
    }).toPass({ timeout: 15_000 })
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
      // select_theme retries until the applied data-theme matches `theme`
      await select_theme(page, theme_control, theme)
      await expect(html_element).toHaveAttribute(`data-theme`, theme, { timeout: 15_000 })

      // Use expect.poll for evaluated values
      const expected_scheme = theme === `white` || theme === `light` ? `light` : `dark`
      await expect
        .poll(
          () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme),
          { timeout: 15_000 },
        )
        .toBe(expected_scheme)
    }
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
    // Use a fresh context without addInitScript to properly test persistence
    const context = await browser.newContext()
    const page = await context.newPage()

    // Clear any existing theme preference and navigate. Use lightweight routes
    // (layout hydrates fast under CI contention) and avoid waitUntil:
    // `networkidle` (flaky); select_theme gates the interaction on hydration and
    // assertions auto-retry.
    await page.goto(light_route)
    await page.evaluate(() => localStorage.removeItem(`matterviz-theme`))
    await page.reload()

    let theme_control = page.locator(`.theme-control`)
    await expect(theme_control).toBeVisible({ timeout: 15_000 })

    // Set theme (retries until hydrated) and check localStorage
    await select_theme(page, theme_control, `dark`)

    // Use expect.poll for evaluated values
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem(`matterviz-theme`)), {
        timeout: 15_000,
      })
      .toBe(`dark`)

    // Test persistence across reload (no addInitScript to interfere)
    await page.reload()
    theme_control = page.locator(`.theme-control`)
    await expect(theme_control).toBeVisible({ timeout: 15_000 })

    await expect(theme_control).toHaveValue(`dark`, { timeout: 15_000 })
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`, {
      timeout: 15_000,
    })

    // Test persistence across navigation to a different (also lightweight) route
    // -- not the heavy /bohr-atoms page (~118 animated SVG atoms) that was timing
    // out under CI's software renderer.
    await page.goto(`/how-to`)
    const nav_theme_control = page.locator(`.theme-control`)
    await expect(nav_theme_control).toBeVisible({ timeout: 15_000 })
    await expect(nav_theme_control).toHaveValue(`dark`, { timeout: 15_000 })
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `dark`, {
      timeout: 15_000,
    })

    await context.close()
  })
})
