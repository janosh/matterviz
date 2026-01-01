import { expect, test } from '@playwright/test'
import process from 'node:process'

test.describe(`OPTIMADE route`, () => {
  // This page loads slowly due to external API mocking
  test.describe.configure({ timeout: 30000 })

  // Skip all OPTIMADE tests in CI - route mocking is unreliable
  test.beforeEach(() => {
    test.skip(
      process.env.CI === `true`,
      `OPTIMADE tests are flaky in CI due to route mocking timing`,
    )
  })

  test.beforeEach(async ({ page }) => {
    // Mock structure and links requests
    await page.route(`**/v1/**`, async (route) => {
      const url = route.request().url()
      if (url.includes(`providers.optimade.org/v1/links`)) {
        await route.fulfill({
          json: {
            data: [
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
            ],
          },
        })
      } else if (url.includes(`links`)) {
        // Mock provider links endpoint to avoid 404/HTML responses
        await route.fulfill({ json: { data: [] } })
      } else if (url.includes(`structures`)) {
        if (url.includes(`mp-1`)) {
          await route.fulfill({
            json: {
              data: {
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
            },
          })
        } else if (url.includes(`invalid-id`)) {
          await route.fulfill({ json: { data: null } })
        } else if (url.includes(`mp-149`)) {
          await route.fulfill({
            json: {
              data: {
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
            },
          })
        } else if (url.includes(`page_limit`)) {
          // Mock suggestions response
          await route.fulfill({
            json: {
              data: [
                {
                  id: `mp-149`,
                  type: `structures`,
                  attributes: {
                    chemical_formula_descriptive: `Si`,
                  },
                },
                {
                  id: `oqmd-1234`,
                  type: `structures`,
                  attributes: {
                    chemical_formula_descriptive: `Fe`,
                  },
                },
              ],
            },
          })
        } else {
          await route.fulfill({ status: 404, json: { errors: [{ title: `Not found` }] } })
        }
      } else {
        await route.continue()
      }
    })
  })

  test(`page loads correctly`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Explorer`)
    await expect(page.locator(`input[placeholder="Enter structure ID"]`))
      .toBeVisible({ timeout: 50000 })
    // Use class selector instead of :has-text() for more reliable matching
    await expect(page.locator(`button.fetch-button`)).toBeVisible({ timeout: 50000 })
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    await page.goto(`/optimade-invalid-id-12345`, { waitUntil: `networkidle` })

    // Check input value is set correctly
    await expect(page.locator(`input.structure-input`)).toHaveValue(`invalid-id-12345`)

    // Check for error message - wait longer as it requires API call in CI
    const error_message = page.locator(`.structure-column .error-message`)
    await expect(error_message).toBeVisible({ timeout: 15000 })
    await expect(error_message).toContainText(`invalid-id-12345`)
    await expect(error_message).toContainText(`not found`)
  })

  test(`can switch providers and clear input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Verify initial MP structure is loaded (needs longer timeout for API + 3D rendering)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({ timeout: 15000 })

    // Click on OQMD provider button
    await page.locator(`button.db-select`, { hasText: `oqmd` }).click()

    // Wait for provider change and verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)

    // Verify OQMD provider is selected
    // The selected class is on the parent div of the button
    await expect(page.locator(`.db-grid > div`, { hasText: `oqmd` })).toHaveClass(
      /selected/,
    )

    // Verify suggestions section appears (use partial text match)
    await expect(page.locator(`text=Suggested Structures`)).toBeVisible()
  })

  test(`can load structure from different providers via text input`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Verify initial MP structure is loaded (needs longer timeout for API + 3D rendering)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({ timeout: 15000 })

    // Enter a different MP structure ID
    await page.locator(`input.structure-input`).fill(`mp-149`)
    await page.locator(`button.fetch-button`).click()

    // Wait for loading and verify new structure
    await expect(page.locator(`h2:has-text("mp-149")`)).toBeVisible({ timeout: 15000 })
  })

  test(`provider selection clears input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider (use first to avoid ambiguity)
    await page.locator(`button.db-select`, { hasText: `cod` }).click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Test MP provider (should already be loaded, needs timeout for API + 3D rendering)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible({ timeout: 15000 })

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
    const structure_id = await first_suggestion_card.locator(`span`).first()
      .textContent()

    // Click on first suggestion card
    await first_suggestion_card.click()

    // Verify that the input is filled with the correct structure ID
    await expect(page.locator(`input.structure-input`)).toHaveValue(structure_id ?? ``)
  })
})
