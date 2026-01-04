import { expect, test } from '@playwright/test'
import {
  MOCK_PROVIDERS,
  MOCK_STRUCTURES,
  MOCK_SUGGESTIONS,
} from '../fixtures/optimade-mocks'

test.describe(`OPTIMADE route`, () => {
  test.describe.configure({ timeout: 30000, retries: 2 })

  test.beforeEach(async ({ page }) => {
    // Mock all OPTIMADE API requests (all use /v1/ in their paths)
    // Route handlers are registered before any navigation to ensure mocks intercept requests
    await page.route(`**/v1/**`, (route) => {
      const url = route.request().url()

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
    })
  })

  test(`page loads correctly`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)
    await expect(page.locator(`input[placeholder="Enter structure ID"]`)).toBeVisible()
    await expect(page.locator(`button.fetch-button`)).toBeVisible()
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    await page.goto(`/optimade-invalid-id-12345`, { waitUntil: `networkidle` })

    // Check input value is set correctly
    await expect(page.locator(`input.structure-input`)).toHaveValue(`invalid-id-12345`)

    // Check for error message
    const error_message = page.locator(`.structure-column .error-message`)
    await expect(error_message).toBeVisible()
    await expect(error_message).toContainText(`invalid-id-12345`)
    await expect(error_message).toContainText(`not found`)
  })

  test(`can switch providers and clear input field`, async ({ page }) => {
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
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider
    await page.locator(`button.db-select`, { hasText: `cod` }).click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
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
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Wait for suggestions to load
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible()

    // Capture the structure ID from first suggestion card
    const first_suggestion_card = page.locator(`.structure-suggestions button`).first()
    const structure_id_span = first_suggestion_card.locator(`span`).first()
    await expect(structure_id_span).toHaveText(/.+/) // Assert non-empty text content
    const structure_id = (await structure_id_span.textContent()) as string

    // Click on first suggestion card
    await first_suggestion_card.click()

    // Verify that the input is filled with the correct structure ID
    await expect(page.locator(`input.structure-input`)).toHaveValue(structure_id)
  })
})
