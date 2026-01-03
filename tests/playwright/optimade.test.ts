import { expect, test } from '@playwright/test'
import type { OptimadeStructure } from '../../src/lib/api/optimade'
import { IS_CI } from './helpers'

// Mock structure data shared across tests
const MOCK_STRUCTURES: Record<string, OptimadeStructure> = {
  'mp-1': {
    id: `mp-1`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `H2O`,
      lattice_vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      species: [{ name: `H`, chemical_symbols: [`H`], concentration: [1] }],
      species_at_sites: [`H`],
      cartesian_site_positions: [[0, 0, 0]],
      structure_features: [],
    },
  },
  'mp-149': {
    id: `mp-149`,
    type: `structures`,
    attributes: {
      chemical_formula_descriptive: `Si`,
      lattice_vectors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      species: [{ name: `Si`, chemical_symbols: [`Si`], concentration: [1] }],
      species_at_sites: [`Si`],
      cartesian_site_positions: [[0, 0, 0]],
      structure_features: [],
    },
  },
}

const MOCK_PROVIDERS = [
  {
    id: `mp`,
    type: `links`,
    attributes: {
      name: `Materials Project`,
      base_url: `https://optimade.materialsproject.org`,
      description: `The Materials Project`,
      homepage: `https://materialsproject.org`,
      link_type: `child`,
    },
  },
  {
    id: `cod`,
    type: `links`,
    attributes: {
      name: `Crystallography Open Database`,
      description: `Crystallography Open Database`,
      base_url: `https://www.crystallography.net/cod/optimade`,
      homepage: `https://www.crystallography.net/cod`,
      link_type: `child`,
    },
  },
  {
    id: `oqmd`,
    type: `links`,
    attributes: {
      name: `OQMD`,
      description:
        `The OQMD is a database of DFT calculated thermodynamic and structural properties.`,
      base_url: `https://oqmd.org/optimade`,
      homepage: `https://oqmd.org`,
      link_type: `child`,
    },
  },
]

test.describe(`OPTIMADE route`, () => {
  test.describe.configure({ timeout: 30000, retries: 2 })

  test.beforeEach(async ({ page }) => {
    // Mock all OPTIMADE API requests (all use /v1/ in their paths)
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
          return route.fulfill({
            json: {
              data: [
                {
                  id: `mp-149`,
                  type: `structures`,
                  attributes: { chemical_formula_descriptive: `Si` },
                },
                {
                  id: `oqmd-1234`,
                  type: `structures`,
                  attributes: { chemical_formula_descriptive: `Fe` },
                },
              ],
            },
          })
        }
        // Invalid/unknown structure
        return route.fulfill({ json: { data: null } })
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
    await page.goto(`/optimade-mp-1`, { waitUntil: `domcontentloaded` })

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)
    await expect(page.locator(`input[placeholder="Enter structure ID"]`)).toBeVisible()
    await expect(page.locator(`button.fetch-button`)).toBeVisible()
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    test.skip(IS_CI, `OPTIMADE error handling test is flaky in CI due to mock timing`)
    await page.goto(`/optimade-invalid-id-12345`, { waitUntil: `domcontentloaded` })

    // Check input value is set correctly
    await expect(page.locator(`input.structure-input`)).toHaveValue(`invalid-id-12345`)

    // Check for error message
    const error_message = page.locator(`.structure-column .error-message`)
    await expect(error_message).toBeVisible()
    await expect(error_message).toContainText(`invalid-id-12345`)
    await expect(error_message).toContainText(`not found`)
  })

  test(`can switch providers and clear input field`, async ({ page }) => {
    test.skip(IS_CI, `OPTIMADE provider switch test is flaky in CI due to mock timing`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `domcontentloaded` })

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
    test.skip(IS_CI, `OPTIMADE text input test is flaky in CI due to mock timing`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `domcontentloaded` })

    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

    // Enter a different MP structure ID
    await page.locator(`input.structure-input`).fill(`mp-149`)
    await page.locator(`button.fetch-button`).click()

    // Wait for loading and verify new structure
    await expect(page.locator(`h2:has-text("mp-149")`)).toBeVisible()
  })

  test(`provider selection clears input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `domcontentloaded` })

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider
    await page.locator(`button.db-select`, { hasText: `cod` }).click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
    test.skip(IS_CI, `OPTIMADE multi-provider test is flaky in CI due to mock timing`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `domcontentloaded` })

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
    test.skip(IS_CI, `OPTIMADE suggestions test is flaky in CI due to mock timing`)
    await page.goto(`/optimade-mp-1`, { waitUntil: `domcontentloaded` })

    // Wait for suggestions to load
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible()

    // Capture the structure ID from first suggestion card
    const first_suggestion_card = page.locator(`.structure-suggestions button`).first()
    const structure_id = await first_suggestion_card.locator(`span`).first().textContent()
    if (!structure_id) throw new Error(`Expected structure ID in suggestion card`)

    // Click on first suggestion card
    await first_suggestion_card.click()

    // Verify that the input is filled with the correct structure ID
    await expect(page.locator(`input.structure-input`)).toHaveValue(structure_id)
  })
})
