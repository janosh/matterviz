import { expect, test } from '@playwright/test'

test.describe(`OPTIMADE route`, () => {
  test(`page loads correctly`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    await expect(page.locator(`h1`)).toContainText(`OPTIMADE Structure Explorer`)
    await expect(page.locator(`input[placeholder="Enter OPTIMADE structure ID"]`))
      .toBeVisible()
    await expect(page.locator(`button:has-text("Fetch structure")`)).toBeVisible()
  })

  test(`handles invalid structure ID gracefully`, async ({ page }) => {
    await page.goto(`/optimade-invalid-id-12345`, { waitUntil: `networkidle` })

    await expect(page.locator(`text=Structure invalid-id-12345 not found`)).toBeVisible({
      timeout: 5000,
    })
  })

  test(`can switch providers and clear input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

    // Click on OQMD provider button
    await page.locator(`button.provider-card:has-text("oqmd")`).click()

    // Wait for provider change and verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)

    // Verify OQMD provider is selected
    await expect(page.locator(`button.provider-card:has-text("oqmd")`)).toHaveClass(
      /selected/,
    )

    // Verify suggestions section appears (use partial text match)
    await expect(page.locator(`text=Suggested Structures from`)).toBeVisible()
  })

  test(`can load structure from different providers via text input`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Verify initial MP structure is loaded
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

    // Enter a different MP structure ID
    await page.locator(`input.structure-input`).fill(`mp-149`)
    await page.locator(`button.fetch-button`).click()

    // Wait for loading and verify new structure
    await expect(page.locator(`text=Loading structure data from`)).toBeVisible()
    await expect(page.locator(`h2:has-text("mp-149")`)).toBeVisible({ timeout: 5000 })
  })

  test(`provider selection clears input field`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Fill input with some text
    await page.locator(`input.structure-input`).fill(`test-structure-id`)

    // Click on a different provider (use first to avoid ambiguity)
    await page.locator(`button.provider-card:has-text("cod")`).first().click()

    // Verify input is cleared
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
  })

  test(`can navigate between multiple providers`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Test MP provider (should already be loaded)
    await expect(page.locator(`h2:has-text("mp-1")`)).toBeVisible()

    // Switch to COD provider
    await page.locator(`button.provider-card:has-text("cod")`).first().click()
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
    await expect(page.locator(`button.provider-card:has-text("cod")`).first())
      .toHaveClass(/selected/)

    // Switch back to MP provider
    await page.locator(`button.provider-card:has-text("mp")`).first().click()
    await expect(page.locator(`input.structure-input`)).toHaveValue(``)
    await expect(page.locator(`button.provider-card:has-text("mp")`).first()).toHaveClass(
      /selected/,
    )
  })

  test(`can click on suggested structures to load them`, async ({ page }) => {
    await page.goto(`/optimade-mp-1`, { waitUntil: `networkidle` })

    // Wait for suggestions to load
    await expect(page.locator(`text=Suggested Structures from`)).toBeVisible()

    // Capture the structure ID from first suggestion card
    const first_suggestion_card = page.locator(`.suggestion-card`).first()
    const structure_id = await first_suggestion_card.locator(`.suggestion-id`)
      .textContent()

    // Click on first suggestion card
    await first_suggestion_card.click()

    // Verify that the input is filled with the correct structure ID
    await expect(page.locator(`input.structure-input`)).toHaveValue(structure_id ?? ``)

    // Verify loading state appears
    await expect(page.locator(`text=Loading structure data from`)).toBeVisible()
  })
})
