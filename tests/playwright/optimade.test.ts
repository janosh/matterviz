import { expect, test } from '@playwright/test'
import {
  MOCK_PROVIDERS,
  MOCK_STRUCTURES,
  MOCK_SUGGESTIONS,
} from '../fixtures/optimade-mocks'

// Timeout for waiting on async data loading (providers, structures).
// Despite mocking, we need extra time for:
// - Svelte 5 $effect reactivity (runs after initial render)
// - Component hydration after SSR
// - CI environment variability (software-rendered WebGL, slow I/O)
const DATA_LOAD_TIMEOUT = 30_000

test.describe(`OPTIMADE route`, () => {
  // Network mocking can be flaky in CI due to race conditions
  test.describe.configure({ retries: 2 })

  test.beforeEach(async ({ page }) => {
    // Mock fetch at the JS level instead of page.route() because route
    // interception is unreliable on CI for cross-origin requests (providers
    // never load, cause unknown). addInitScript patches fetch before any
    // page code runs, bypassing all browser network stack concerns.
    const mocks = JSON.stringify({
      providers: MOCK_PROVIDERS,
      structures: MOCK_STRUCTURES,
      suggestions: MOCK_SUGGESTIONS,
    })
    await page.addInitScript((serialized: string) => {
      const { providers, structures, suggestions } = JSON.parse(serialized)
      const _fetch = globalThis.fetch
      globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === `string`
          ? input
          : input instanceof URL
          ? input.href
          : input.url
        // Let local requests through unchanged
        if (url.startsWith(location.origin)) return _fetch.call(globalThis, input, init)
        // Decode CORS proxy wrappers to get the actual target URL
        const decoded = decodeURIComponent(url)
        const json = (body: unknown, status = 200) =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { 'Content-Type': `application/json` },
            }),
          )
        if (decoded.includes(`providers.optimade.org`) && decoded.includes(`links`)) {
          return json({ data: providers })
        }
        if (decoded.includes(`/structures`)) {
          const match = decoded.match(/\/structures\/([^/?]+)/)
          if (match?.[1] && structures[match[1]]) {
            return json({ data: structures[match[1]] })
          }
          if (decoded.includes(`page_limit`) || decoded.includes(`filter=`)) {
            return json({ data: suggestions })
          }
          return json(
            { errors: [{ detail: `Structure not found`, status: `404` }] },
            404,
          )
        }
        if (decoded.includes(`/links`)) return json({ data: [] })
        // Non-OPTIMADE external requests: let through (will fail naturally)
        return _fetch.call(globalThis, input, init)
      }
    }, mocks)
  })

  test(`page loads correctly`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)
    await expect(page.locator(`input[placeholder="Enter structure ID"]`)).toBeVisible()
    await expect(page.locator(`button.fetch-button`)).toBeVisible()
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    await page.goto(`/optimade-invalid-id-12345`, { waitUntil: `networkidle` })

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)

    // Wait for providers to load - either buttons appear or error message shown
    await expect(
      page.locator(`button.db-select`).first().or(
        page.locator(`.db-column .error-message`),
      ),
    ).toBeVisible({ timeout: DATA_LOAD_TIMEOUT })

    // If there's a providers error, click retry and wait again
    const providers_error_visible = await page.locator(`.db-column .error-message`)
      .isVisible()
    if (providers_error_visible) {
      await page.locator(`.retry-button`).click()
      await expect(page.locator(`button.db-select`).first()).toBeVisible({
        timeout: DATA_LOAD_TIMEOUT,
      })
    }

    // Check input value is set correctly (after providers load)
    await expect(page.locator(`input.structure-input`)).toHaveValue(`invalid-id-12345`)

    // Check for structure error message - mock returns OPTIMADE 404 with "Structure not found"
    const error_message = page.locator(`.structure-column .error-message`)
    await expect(error_message).toBeVisible({ timeout: DATA_LOAD_TIMEOUT })
    // Verify the app displays an error message (content varies based on mock vs real API)
    await expect(error_message).toContainText(/not found|failed|error/i)
  })

  test.skip(`can switch providers and clear input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // Wait for providers to load and structure to be fetched
    await expect(page.locator(`button.db-select`).first()).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    })
    // Verify initial MP structure is loaded (h2 contains structure ID in span)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    })

    // Click on OQMD provider button
    await page.locator(`button.db-select`, { hasText: `oqmd` }).click()

    // Wait for provider change and verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)

    // Verify OQMD provider is selected
    await expect(page.locator(`.db-grid > div`, { hasText: `oqmd` })).toHaveClass(
      /selected/,
    )

    // Verify suggestions section appears
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible()
  })

  test(`can load structure from different providers via text input`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // First wait for the page to be interactive (h1 should always be present)
    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)

    // Wait for providers to load - either buttons appear or error message shown
    // This handles both success and failure cases gracefully
    await expect(
      page.locator(`button.db-select`).first().or(page.locator(`.error-message`)),
    ).toBeVisible({ timeout: DATA_LOAD_TIMEOUT })

    // If there's an error, click retry and wait again
    const error_visible = await page.locator(`.error-message`).isVisible()
    if (error_visible) {
      await page.locator(`.retry-button`).click()
      await expect(page.locator(`button.db-select`).first()).toBeVisible({
        timeout: DATA_LOAD_TIMEOUT,
      })
    }

    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    })

    // Enter a different MP structure ID
    await page.locator(`input.structure-input`).fill(`mp-149`)
    await page.locator(`button.fetch-button`).click()

    // Wait for loading and verify new structure
    await expect(page.locator(`h2:has-text("mp-149")`)).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    })
  })

  test(`provider selection clears input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // First wait for the page to be interactive
    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)

    // Wait for providers to load - either buttons appear or error message shown
    await expect(
      page.locator(`button.db-select`).first().or(page.locator(`.error-message`)),
    ).toBeVisible({ timeout: DATA_LOAD_TIMEOUT })

    // If there's an error, click retry and wait again
    const error_visible = await page.locator(`.error-message`).isVisible()
    if (error_visible) {
      await page.locator(`.retry-button`).click()
      await expect(page.locator(`button.db-select`).first()).toBeVisible({
        timeout: DATA_LOAD_TIMEOUT,
      })
    }

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider
    await page.locator(`button.db-select`, { hasText: `cod` }).click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // First wait for the page to be interactive
    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)

    // Wait for providers to load - either buttons appear or error message shown
    await expect(
      page.locator(`button.db-select`).first().or(page.locator(`.error-message`)),
    ).toBeVisible({ timeout: DATA_LOAD_TIMEOUT })

    // If there's an error, click retry and wait again
    const error_visible = await page.locator(`.error-message`).isVisible()
    if (error_visible) {
      await page.locator(`.retry-button`).click()
      await expect(page.locator(`button.db-select`).first()).toBeVisible({
        timeout: DATA_LOAD_TIMEOUT,
      })
    }

    // Test MP provider (should already be loaded)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    })

    // Switch to COD provider
    await page.locator(`button.db-select`, { hasText: `cod` }).click()
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
    await expect(page.locator(`.db-grid > div`, { hasText: `cod` })).toHaveClass(
      /selected/,
    )

    // Switch back to MP provider
    await page.locator(`button.db-select`, { hasText: `mp` }).click()
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
    await expect(page.locator(`.db-grid > div`, { hasText: `mp` })).toHaveClass(
      /selected/,
    )
  })

  test(`can click on suggested structures to load them`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // First wait for the page to be interactive
    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)

    // Wait for providers to load - either buttons appear or error message shown
    await expect(
      page.locator(`button.db-select`).first().or(page.locator(`.error-message`)),
    ).toBeVisible({ timeout: DATA_LOAD_TIMEOUT })

    // If there's an error, click retry and wait again
    const error_visible = await page.locator(`.error-message`).isVisible()
    if (error_visible) {
      await page.locator(`.retry-button`).click()
      await expect(page.locator(`button.db-select`).first()).toBeVisible({
        timeout: DATA_LOAD_TIMEOUT,
      })
    }

    // Wait for suggestions to load (shown after providers and suggestions fetch)
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT,
    })

    // Click on a specific known suggestion (mp-149) that exists in MOCK_STRUCTURES
    // This avoids fragility if suggestion order changes
    const mp149_card = page.locator(`.structure-suggestions button`, {
      hasText: `mp-149`,
    })
    await expect(mp149_card).toBeVisible()
    await mp149_card.click()

    // Verify that the input is filled with the correct structure ID
    await expect(page.locator(`input.structure-input`)).toHaveValue(`mp-149`)
  })
})
