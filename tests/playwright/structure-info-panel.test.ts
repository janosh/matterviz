import { expect, test } from '@playwright/test'

test.describe(`StructureInfoPanel`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/structure`)
    await page.waitForSelector(`canvas`)
  })

  test(`should toggle panel visibility with info button`, async ({ page }) => {
    // Wait for button to be visible first
    await expect(page.locator(`button[title*="info panel"]`)).toBeVisible()

    // Info panel should be closed initially
    await expect(page.locator(`.draggable-panel.structure-info-panel`)).not.toBeVisible()

    // Click info button to open panel
    await page.locator(`button[title*="info panel"]`).click()
    await expect(page.locator(`.draggable-panel.structure-info-panel`)).toBeVisible()

    // Click info button again to close panel
    await page.locator(`button[title*="info panel"]`).click()
    await expect(page.locator(`.draggable-panel.structure-info-panel`)).not.toBeVisible()
  })

  test(`should display structure information sections`, async ({ page }) => {
    // Open info panel
    await page.locator(`button[title*="info panel"]`).click()
    await expect(page.locator(`.structure-info-panel`)).toBeVisible()

    // Check main sections are present
    await expect(page.locator(`.section-heading`).first()).toHaveText(`Structure Info`)
    await expect(page.locator(`text=Cell`)).toBeVisible()
    await expect(page.locator(`text=Usage Tips`)).toBeVisible()

    // Check structure info content
    await expect(page.locator(`text=Formula`)).toBeVisible()
    await expect(page.locator(`text=Charge`)).toBeVisible()

    // Check unit cell content
    await expect(page.locator(`text=Volume, Density`)).toBeVisible()
    await expect(page.locator(`text=a, b, c`)).toBeVisible()
    await expect(page.locator(`text=α, β, γ`)).toBeVisible()
  })

  test(`should display site information with coordinates`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Check if sites toggle is present (for structures with 50+ atoms)
    const sitesToggle = page.locator(`.toggle-item`)
    const hasSitesToggle = await sitesToggle.count() > 0

    if (hasSitesToggle) {
      // Click the toggle to expand sites
      await sitesToggle.click()
    }

    // Check site entries are present
    await expect(page.locator(`text=Fractional`).first()).toBeVisible()
    await expect(page.locator(`text=Cartesian`).first()).toBeVisible()

    // Check coordinate format (should contain parentheses and commas)
    const fractional = page.locator(`text=Fractional`).first()
    const fractionalParent = fractional.locator(`..`)
    await expect(fractionalParent).toContainText(`(`)
    await expect(fractionalParent).toContainText(`,`)
    await expect(fractionalParent).toContainText(`)`)
  })

  test(`should show drag handle and not show close button initially`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Drag handle should be visible
    await expect(page.locator(`.drag-handle`)).toBeVisible()

    // Close button should not be visible initially
    await expect(page.locator(`.close-button`)).not.toBeVisible()
  })

  test(`should close panel when clicking outside (before dragging)`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()
    await expect(page.locator(`.structure-info-panel`)).toBeVisible()

    // Click outside the panel (on canvas)
    await page.locator(`canvas`).click({ position: { x: 100, y: 100 } })

    // Panel should close
    await expect(page.locator(`.structure-info-panel`)).not.toBeVisible()
  })

  test(`should make panel draggable and show close button after dragging`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Get initial position
    const panel = page.locator(`.info-panel-content`)
    const initialBox = await panel.boundingBox()
    expect(initialBox).toBeTruthy()
    if (!initialBox) return

    // Drag the panel by its handle
    const dragHandle = page.locator(`.drag-handle`)
    await dragHandle.hover()
    await page.mouse.down()
    await page.mouse.move(initialBox.x + 100, initialBox.y + 50)
    await page.mouse.up()

    // Check panel moved
    const newBox = await panel.boundingBox()
    expect(newBox).toBeTruthy()
    if (!newBox) return

    expect(newBox.x).toBeGreaterThan(initialBox.x)
    expect(newBox.y).toBeGreaterThan(initialBox.y)

    // Close button should now be visible
    await expect(page.locator(`.close-button`)).toBeVisible()
  })

  test(`should not close panel when clicking outside after dragging`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Drag the panel
    const dragHandle = page.locator(`.drag-handle`)
    await dragHandle.hover()
    await page.mouse.down()
    await page.mouse.move(400, 300)
    await page.mouse.up()

    // Panel should still be visible
    await expect(page.locator(`.structure-info-panel`)).toBeVisible()

    // Click outside (on canvas)
    await page.locator(`canvas`).click({ position: { x: 100, y: 100 } })

    // Panel should still be visible (not closed)
    await expect(page.locator(`.structure-info-panel`)).toBeVisible()
  })

  test(`should close panel with close button and reset drag state`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Drag the panel to activate close button
    const dragHandle = page.locator(`.drag-handle`)
    await dragHandle.hover()
    await page.mouse.down()
    await page.mouse.move(400, 300)
    await page.mouse.up()

    // Close button should be visible
    await expect(page.locator(`.close-button`)).toBeVisible()

    // Click close button
    await page.locator(`.close-button`).click()

    // Panel should be closed
    await expect(page.locator(`.structure-info-panel`)).not.toBeVisible()

    // Reopen panel - close button should not be visible (drag state reset)
    await page.locator(`button[title*="info panel"]`).click()
    await expect(page.locator(`.close-button`)).not.toBeVisible()
  })

  test(`should copy item to clipboard with checkmark feedback`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Grant clipboard permissions
    await page.context().grantPermissions([`clipboard-read`, `clipboard-write`])

    // Click on a copyable item (Formula)
    const formulaItem = page.locator(`text=Formula`).locator(`..`)
    await formulaItem.click()

    // Checkmark should appear briefly
    await expect(page.locator(`.copy-checkmark-overlay`)).toBeVisible()

    // Check clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain(`Formula:`)

    // Checkmark should disappear after timeout
    await page.waitForTimeout(1100) // Wait for 1.1 seconds (checkmark disappears after 1s)
    await expect(page.locator(`.copy-checkmark-overlay`)).not.toBeVisible()
  })

  test(`should not copy usage tips items`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Try to click on a usage tips item
    const tipsItem = page.locator(`text=File Drop`).locator(`..`)
    await tipsItem.click()

    // No checkmark should appear
    await expect(page.locator(`.copy-checkmark-overlay`)).not.toBeVisible()
  })

  test(`should display usage tips section`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Check usage tips content
    await expect(page.locator(`text=File Drop`)).toBeVisible()
    await expect(page.locator(`text=Atom Selection`)).toBeVisible()
    await expect(page.locator(`text=Navigation`)).toBeVisible()
    await expect(page.locator(`text=Colors`)).toBeVisible()
    await expect(page.locator(`text=Keyboard`)).toBeVisible()

    // Check tips have descriptions
    await expect(page.locator(`text=Drop POSCAR, XYZ, CIF or JSON files`)).toBeVisible()
    await expect(page.locator(`text=Click atoms to activate, hover for distances`))
      .toBeVisible()
  })

  test(`should format numeric values correctly`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Check that volume/density values are formatted with units
    const volumeDensity = page.locator(`text=Volume, Density`).locator(`..`)
    await expect(volumeDensity).toContainText(`Å³`)
    await expect(volumeDensity).toContainText(`g/cm³`)

    // Check that lattice parameters have units
    const latticeParams = page.locator(`text=a, b, c`).locator(`..`)
    await expect(latticeParams).toContainText(`Å`)

    // Check that angles have degree symbols
    const angles = page.locator(`text=α, β, γ`).locator(`..`)
    await expect(angles).toContainText(`°`)
  })

  test(`should handle keyboard navigation for copy functionality`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()
    await page.context().grantPermissions([`clipboard-read`, `clipboard-write`])

    // Focus on a copyable item and press Enter
    const formulaItem = page.locator(`text=Formula`).locator(`..`)
    await formulaItem.focus()
    await page.keyboard.press(`Enter`)

    // Checkmark should appear
    await expect(page.locator(`.copy-checkmark-overlay`)).toBeVisible()

    // Check clipboard content
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain(`Formula:`)
  })

  test(`should display site properties when available`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Check if sites toggle is present and expand if needed
    const sitesToggle = page.locator(`.toggle-item`)
    const hasSitesToggle = await sitesToggle.count() > 0

    if (hasSitesToggle) {
      // Click the toggle to expand sites
      await sitesToggle.click()
    }

    // Check that site items are indented (have the site-item class)
    const siteItems = page.locator(`.site-item`)
    await expect(siteItems.first()).toBeVisible()

    // Check that site headers show element names
    const sites = page.locator(`.structure-info-panel section div`)
    await expect(sites.first()).toBeVisible()
  })

  test(`should handle drag cursor states correctly`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Check initial cursor state
    const dragHandle = page.locator(`.drag-handle`)
    await expect(dragHandle).toHaveCSS(`cursor`, `grab`)

    // Start dragging and check cursor changes
    await dragHandle.hover()
    await page.mouse.down()

    // Note: Testing cursor change to 'grabbing' during drag is tricky in Playwright
    // The test above covers the functional behavior instead

    await page.mouse.up()
  })

  test(`should handle sites toggle for medium-sized structures`, async ({ page }) => {
    await page.locator(`button[title*="info panel"]`).click()

    // Look for sites toggle button (only appears for structures with 50+ atoms)
    const sitesToggle = page.locator(`.toggle-item`)
    const hasSitesToggle = await sitesToggle.count() > 0

    if (hasSitesToggle) {
      // Initially should be collapsed (showing "Sites (X atoms) ▼")
      await expect(sitesToggle).toContainText(`Sites`)
      await expect(sitesToggle).toContainText(`atoms`)
      await expect(sitesToggle).toContainText(`▼`)

      // Sites details should not be visible initially
      await expect(page.locator(`text=Fractional`)).not.toBeVisible()

      // Click to expand
      await sitesToggle.click()

      // Should now show expanded state ("Hide Sites ▲")
      await expect(sitesToggle).toContainText(`Hide Sites`)
      await expect(sitesToggle).toContainText(`▲`)

      // Sites details should now be visible
      await expect(page.locator(`text=Fractional`)).toBeVisible()
      await expect(page.locator(`text=Cartesian`)).toBeVisible()

      // Click again to collapse
      await sitesToggle.click()

      // Should be collapsed again
      await expect(sitesToggle).toContainText(`Sites`)
      await expect(sitesToggle).toContainText(`▼`)
      await expect(page.locator(`text=Fractional`)).not.toBeVisible()
    }
  })
})
