import type { Route } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  MOCK_PROVIDERS,
  MOCK_STRUCTURES,
  MOCK_SUGGESTIONS,
} from '../fixtures/optimade-mocks'

test.describe(`OPTIMADE route`, () => {
  test.beforeEach(async ({ page }) => {
    // Extract target URL from CORS proxy requests
    const extract_target_url = (url: string): string | null => {
      // corsproxy.io: https://corsproxy.io/?https%3A%2F%2Ftarget.com
      const corsproxy_match = url.match(/corsproxy\.io\/\?(.+)/)
      if (corsproxy_match) return decodeURIComponent(corsproxy_match[1])

      // allorigins.win: https://api.allorigins.win/raw?url=https%3A%2F%2Ftarget.com
      const allorigins_match = url.match(/allorigins\.win\/raw\?url=(.+)/)
      if (allorigins_match) return decodeURIComponent(allorigins_match[1])

      // cors-anywhere: https://cors-anywhere.herokuapp.com/https://target.com
      const cors_anywhere_match = url.match(/cors-anywhere\.herokuapp\.com\/(.+)/)
      if (cors_anywhere_match) return cors_anywhere_match[1]

      // thingproxy: https://thingproxy.freeboard.io/fetch/https://target.com
      const thingproxy_match = url.match(/thingproxy\.freeboard\.io\/fetch\/(.+)/)
      if (thingproxy_match) return thingproxy_match[1]

      // cors.bridged.cc: https://cors.bridged.cc/https://target.com
      const bridged_match = url.match(/cors\.bridged\.cc\/(.+)/)
      if (bridged_match) return bridged_match[1]

      return null
    }

    // Check if URL is an OPTIMADE API request (direct or via proxy)
    const is_optimade_request = (url: string): boolean => {
      const target = extract_target_url(url) ?? url
      return (
        target.includes(`providers.optimade.org`) ||
        target.includes(`optimade.materialsproject.org`) ||
        target.includes(`crystallography.net`) ||
        target.includes(`oqmd.org`) ||
        target.includes(`odbx.io`) ||
        target.includes(`/v1/`) ||
        target.includes(`/structures`) ||
        target.includes(`/links`)
      )
    }

    // Handle OPTIMADE API responses
    const handle_optimade_request = (url: string, route: Route) => {
      const target = extract_target_url(url) ?? url

      // Provider links from providers.optimade.org
      if (target.includes(`providers.optimade.org`) && target.includes(`links`)) {
        return route.fulfill({ json: { data: MOCK_PROVIDERS } })
      }

      // Structure requests - match by ID in URL
      if (target.includes(`structures`)) {
        // Extract structure ID from URL path (e.g., /structures/mp-149?foo=bar -> mp-149)
        const struct_match = target.match(/\/structures\/([^/?]+)/)
        if (struct_match) {
          const struct_id = struct_match[1]
          const struct_data = MOCK_STRUCTURES[struct_id]
          if (struct_data) {
            return route.fulfill({ json: { data: struct_data } })
          }
        }
        // Suggestions query (page_limit or filter)
        if (target.includes(`page_limit`) || target.includes(`filter=`)) {
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
      if (target.includes(`links`)) {
        return route.fulfill({ json: { data: [] } })
      }

      // Catch-all for OPTIMADE requests - return empty data
      return route.fulfill({ json: { data: [] } })
    }

    // Asset extensions to allow through (local resources)
    const asset_extensions = [`.js`, `.css`, `.svg`, `.png`, `.webp`, `.woff`, `.woff2`]

    // Single route handler that intercepts all external requests
    // This ensures all OPTIMADE traffic is caught regardless of timing
    await page.route(`**/*`, (route) => {
      const url = route.request().url()

      // Let local/internal requests through
      const is_local = url.startsWith(`http://localhost`) ||
        url.startsWith(`http://127.0.0.1`)
      const is_internal = url.includes(`/_app/`) || url.includes(`/__`)
      const is_asset = asset_extensions.some((ext) => url.endsWith(ext))
      if (is_local || is_internal || is_asset) return route.continue()

      // Handle OPTIMADE requests with mocks
      if (is_optimade_request(url)) return handle_optimade_request(url, route)

      // Block any other external requests to prevent flakiness
      return route.abort()
    })
  })

  test(`page loads correctly`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)
    await expect(page.locator(`input[placeholder="Enter structure ID"]`)).toBeVisible()
    await expect(page.locator(`button.fetch-button`)).toBeVisible()
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    await page.goto(`/optimade-invalid-id-12345`)

    // Wait for providers to load first (triggers URL slug parsing)
    await expect(page.locator(`button.db-select`).first()).toBeVisible({ timeout: 15000 })

    // Check input value is set correctly (after providers load)
    await expect(page.locator(`input.structure-input`)).toHaveValue(`invalid-id-12345`)

    // Check for error message - mock returns OPTIMADE 404 with "Structure not found"
    const error_message = page.locator(`.structure-column .error-message`)
    await expect(error_message).toBeVisible({ timeout: 8000 })
    // Verify the app displays an error message (content varies based on mock vs real API)
    await expect(error_message).toContainText(/not found|failed|error/i)
  })

  test(`can switch providers and clear input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // Wait for providers to load and structure to be fetched
    await expect(page.locator(`button.db-select`).first()).toBeVisible({ timeout: 15000 })
    // Verify initial MP structure is loaded (h2 contains structure ID in span)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({ timeout: 10000 })

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

    // Wait for providers to load and structure to be fetched
    await expect(page.locator(`button.db-select`).first()).toBeVisible({ timeout: 15000 })
    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({ timeout: 10000 })

    // Enter a different MP structure ID
    await page.locator(`input.structure-input`).fill(`mp-149`)
    await page.locator(`button.fetch-button`).click()

    // Wait for loading and verify new structure
    await expect(page.locator(`h2:has-text("mp-149")`)).toBeVisible()
  })

  test(`provider selection clears input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // Wait for providers to load first
    await expect(page.locator(`button.db-select`).first()).toBeVisible({ timeout: 15000 })

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider
    await page.locator(`button.db-select`, { hasText: `cod` }).click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`)

    // Wait for providers to load and structure to be fetched
    await expect(page.locator(`button.db-select`).first()).toBeVisible({ timeout: 15000 })
    // Test MP provider (should already be loaded)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({ timeout: 10000 })

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

    // Wait for providers to load first
    await expect(page.locator(`button.db-select`).first()).toBeVisible({ timeout: 15000 })
    // Wait for suggestions to load (shown after providers and suggestions fetch)
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible({
      timeout: 10000,
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
