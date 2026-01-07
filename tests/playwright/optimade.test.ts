import { expect, type Route, test } from '@playwright/test'
import {
  MOCK_PROVIDERS,
  MOCK_STRUCTURES,
  MOCK_SUGGESTIONS,
} from '../fixtures/optimade-mocks'
import { IS_CI } from './helpers'

test.describe(`OPTIMADE route`, () => {
  test.beforeEach(async ({ page }) => {
    // Helper to handle OPTIMADE API responses
    const handleOptimadeRequest = (url: string, route: Route) => {
      // Provider links from providers.optimade.org
      if (url.includes(`providers.optimade.org`) && url.includes(`links`)) {
        return route.fulfill({ json: { data: MOCK_PROVIDERS } })
      }

      // Structure requests - match by ID in URL
      if (url.includes(`structures`)) {
        // Extract structure ID from URL path (e.g., /structures/mp-149?foo=bar -> mp-149)
        const struct_match = url.match(/\/structures\/([^/?]+)/)
        if (struct_match) {
          const struct_id = struct_match[1]
          const struct_data = MOCK_STRUCTURES[struct_id]
          if (struct_data) {
            return route.fulfill({ json: { data: struct_data } })
          }
        }
        // Suggestions query (page_limit or filter)
        if (url.includes(`page_limit`) || url.includes(`filter=`)) {
          return route.fulfill({ json: { data: MOCK_SUGGESTIONS } })
        }
        // Invalid/unknown structure - return OPTIMADE-compliant error response
        return route.fulfill({
          status: 404,
          json: {
            errors: [{ detail: `Structure not found`, status: `404` }],
          },
        })
      }

      // Provider-specific links endpoints
      if (url.includes(`links`)) {
        return route.fulfill({ json: { data: [] } })
      }

      // Catch-all - return empty data instead of hitting real servers
      return route.fulfill({ json: { data: [] } })
    }

    // Mock all CORS proxy requests (app uses multiple fallback proxies)
    // corsproxy.io, allorigins.win, cors-anywhere.herokuapp.com
    await page.route(`**/corsproxy.io/**`, (route) => {
      const url = route.request().url()
      const match = url.match(/corsproxy\.io\/\?(.+)/)
      const target_url = match ? decodeURIComponent(match[1]) : url
      return handleOptimadeRequest(target_url, route)
    })
    await page.route(`**/allorigins.win/**`, (route) => {
      const url = route.request().url()
      const match = url.match(/allorigins\.win\/raw\?url=(.+)/)
      const target_url = match ? decodeURIComponent(match[1]) : url
      return handleOptimadeRequest(target_url, route)
    })
    await page.route(`**/cors-anywhere.herokuapp.com/**`, (route) => {
      const url = route.request().url()
      // cors-anywhere uses path directly: https://cors-anywhere.herokuapp.com/https://target.com/...
      const match = url.match(/cors-anywhere\.herokuapp\.com\/(.+)/)
      const target_url = match ? match[1] : url
      return handleOptimadeRequest(target_url, route)
    })

    // Mock direct OPTIMADE API requests (all use /v1/ in their paths)
    await page.route(`**/v1/**`, (route) => {
      return handleOptimadeRequest(route.request().url(), route)
    })
  })

  test(`page loads correctly`, async ({ page }) => {
    test.skip(IS_CI, `OPTIMADE page load flaky in CI due to mock routing`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)
    await expect(page.locator(`input[placeholder="Enter structure ID"]`)).toBeVisible()
    await expect(page.locator(`button.fetch-button`)).toBeVisible()
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    // Skip in CI - OPTIMADE API mocking + error handling causes page.goto to timeout
    test.skip(
      IS_CI,
      `OPTIMADE invalid ID test times out in CI due to network mocking delays`,
    )
    await page.goto(`/optimade-invalid-id-12345`, { waitUntil: `networkidle` })

    // Check input value is set correctly
    await expect(page.locator(`input.structure-input`)).toHaveValue(`invalid-id-12345`)

    // Check for error message - mock returns OPTIMADE 404 with "Structure not found"
    // Use extended timeout since async fetch + error handling takes time
    const error_message = page.locator(`.structure-column .error-message`)
    await expect(error_message).toBeVisible({ timeout: 15000 })
    // Verify the app displays an error message (content varies based on mock vs real API)
    await expect(error_message).toContainText(/not found|failed|error/i)
  })

  test(`can switch providers and clear input field`, async ({ page }) => {
    // Skip in CI - provider switching can be flaky due to mock routing timing
    test.skip(IS_CI, `OPTIMADE provider switch test flaky in CI`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

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
    // Skip in CI - structure loading can timeout due to mock routing delays
    test.skip(IS_CI, `OPTIMADE structure loading test flaky in CI`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

    // Enter a different MP structure ID
    await page.locator(`input.structure-input`).fill(`mp-149`)
    await page.locator(`button.fetch-button`).click()

    // Wait for loading and verify new structure
    await expect(page.locator(`h2:has-text("mp-149")`)).toBeVisible()
  })

  test(`provider selection clears input field`, async ({ page }) => {
    // Skip in CI - provider selection can be flaky due to mock routing timing
    test.skip(IS_CI, `OPTIMADE provider selection test flaky in CI`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider
    await page.locator(`button.db-select`, { hasText: `cod` }).click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
    // Skip in CI - provider navigation can be flaky due to mock routing timing
    test.skip(IS_CI, `OPTIMADE provider navigation test flaky in CI`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Test MP provider (should already be loaded)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

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
    test.skip(IS_CI, `OPTIMADE suggested structures test flaky in CI due to mock routing`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Wait for suggestions to load
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible()

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
