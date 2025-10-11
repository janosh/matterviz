import { expect, type Page, test } from '@playwright/test'

async function open_export_pane(page: Page) {
  const export_toggle = page.locator(`.structure-export-toggle`).first()
  await expect(export_toggle).toBeVisible()
  await export_toggle.click()
  // Wait for the pane to appear - it's a draggable-pane with export-pane class
  const pane_div = page.locator(`.draggable-pane.export-pane`).first()
  await expect(pane_div).toBeVisible({ timeout: 10000 })
  return { export_toggle, pane_div }
}

test.describe(`StructureExportPane Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    // Wait for the export toggle to appear instead of canvas
    await page.waitForSelector(`.structure-export-toggle`, { timeout: 15000 })
  })

  test(`toggle button visibility and tooltip`, async ({ page }) => {
    const export_toggle = page.locator(`.structure-export-toggle`).first()
    await expect(export_toggle).toBeVisible()
    await expect(export_toggle).toHaveAttribute(`title`, `Export Structure`)
  })

  test(`displays all export format buttons`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    // Text formats
    const text_formats = [`JSON`, `XYZ`, `CIF`, `POSCAR`]
    await Promise.all(
      text_formats.map((format) =>
        expect(pane_div.getByText(format, { exact: true })).toBeVisible()
      ),
    )

    // 3D formats
    await expect(pane_div.getByText(`GLB`)).toBeVisible()
    await expect(pane_div.getByText(`OBJ`)).toBeVisible()
  })

  test(`text export buttons have download and copy actions with tooltips`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    const json_row = pane_div.locator(`div:has-text("JSON")`).first()
    const download_btn = json_row.locator(`button[title*="Download"]`).first()
    const copy_btn = json_row.locator(`button[title*="Copy"]`).first()

    await expect(download_btn).toBeVisible()
    await expect(download_btn).toHaveAttribute(
      `title`,
      expect.stringContaining(`Download`),
    )

    await expect(copy_btn).toBeVisible()
    await expect(copy_btn).toHaveAttribute(`title`, expect.stringContaining(`Copy`))
    await expect(copy_btn).toHaveAttribute(`title`, expect.stringContaining(`clipboard`))
  })

  test(`copy button shows checkmark feedback`, async ({ page }) => {
    await page.context().grantPermissions([`clipboard-write`])
    const { pane_div } = await open_export_pane(page)

    const copy_btn = pane_div
      .locator(`div:has-text("JSON")`)
      .first()
      .locator(`button[title*="Copy"]`)

    await expect(copy_btn).toHaveText(`📋`)
    await copy_btn.click()
    await expect(copy_btn).toHaveText(`✅`, { timeout: 1000 })
    await expect(copy_btn).toHaveText(`📋`, { timeout: 2000 })
  })

  test(`PNG export section with DPI controls`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    await expect(pane_div.locator(`h4:has-text("Export Images")`)).toBeVisible()

    const dpi_input = pane_div.locator(`input[type="number"][title*="dots per inch"]`)
    await expect(dpi_input).toBeVisible()
    await expect(dpi_input).toHaveValue(`150`)
    await expect(dpi_input).toHaveAttribute(`min`, `50`)
    await expect(dpi_input).toHaveAttribute(`max`, `500`)

    // Test changing DPI
    await dpi_input.fill(`300`)
    await expect(dpi_input).toHaveValue(`300`)

    // PNG button should be enabled
    const png_button = pane_div.locator(`label:has-text("PNG")`).locator(`button`).first()
    await expect(png_button).toBeEnabled()
  })

  test(`export pane state persists across toggle`, async ({ page }) => {
    const { export_toggle, pane_div } = await open_export_pane(page)

    const dpi_input = pane_div.locator(`input[type="number"][title*="dots per inch"]`)
    await dpi_input.fill(`250`)

    await export_toggle.click()
    await expect(pane_div).not.toBeVisible()

    await export_toggle.click()
    await expect(pane_div).toBeVisible()

    const dpi_input_reopened = pane_div.locator(
      `input[type="number"][title*="dots per inch"]`,
    )
    await expect(dpi_input_reopened).toHaveValue(`250`)
  })

  test(`all buttons have proper ARIA attributes`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    const buttons = pane_div.locator(`button`)
    const button_count = await buttons.count()

    expect(button_count).toBeGreaterThan(0)

    // Check first few buttons for ARIA compliance
    const checks = []
    for (let idx = 0; idx < Math.min(button_count, 5); idx++) {
      checks.push(expect(buttons.nth(idx)).toHaveAttribute(`type`, `button`))
    }
    await Promise.all(checks)
  })

  test(`multiple formats can be copied in sequence`, async ({ page }) => {
    await page.context().grantPermissions([`clipboard-write`])
    const { pane_div } = await open_export_pane(page)

    // Copy JSON
    const json_copy = pane_div
      .locator(`div:has-text("JSON")`)
      .first()
      .locator(`button[title*="Copy"]`)
    await json_copy.click()
    await expect(json_copy).toHaveText(`✅`, { timeout: 1000 })
    await page.waitForTimeout(1100)

    // Copy XYZ
    const xyz_copy = pane_div
      .locator(`div:has-text("XYZ")`)
      .first()
      .locator(`button[title*="Copy"]`)
    await xyz_copy.click()
    await expect(xyz_copy).toHaveText(`✅`, { timeout: 1000 })
  })

  test(`export pane works alongside control pane`, async ({ page }) => {
    const { pane_div: export_pane } = await open_export_pane(page)

    const control_toggle = page.locator(`.structure-controls-toggle`).first()
    await control_toggle.click()
    const control_pane = page.locator(`.controls-pane`).first()

    await expect(export_pane).toBeVisible()
    await expect(control_pane).toBeVisible()

    await control_toggle.click()
    await expect(control_pane).not.toBeVisible()
    await expect(export_pane).toBeVisible()
  })

  test(`keyboard navigation and rapid toggle`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    // Keyboard navigation
    const first_button = pane_div.locator(`.export-buttons button`).first()
    await first_button.focus()
    await expect(first_button).toBeFocused()
    await page.keyboard.press(`Tab`)
    const focused_element = await page.evaluate(() => document.activeElement?.tagName)
    expect(focused_element).toBe(`BUTTON`)
  })

  test(`responsive design and styling`, async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 600 })
    const { pane_div } = await open_export_pane(page)

    // Check pane classes and overflow
    const classes = await pane_div.getAttribute(`class`)
    expect(classes).toContain(`export-pane`)

    const styles = await pane_div.evaluate((el) => {
      const computed = globalThis.getComputedStyle(el)
      return { overflow: computed.overflow || computed.overflowY }
    })
    expect([`auto`, `scroll`, `visible`]).toContain(styles.overflow)

    // Check button styling consistency
    const buttons = pane_div.locator(`.export-buttons button`)
    const button_count = await buttons.count()
    expect(button_count).toBeGreaterThan(0)

    // Verify layout
    const export_buttons_div = pane_div.locator(`.export-buttons`).first()
    const layout_styles = await export_buttons_div.evaluate((el) => {
      const computed = globalThis.getComputedStyle(el)
      return { display: computed.display, flexWrap: computed.flexWrap }
    })
    expect(layout_styles.display).toBe(`flex`)
    expect(layout_styles.flexWrap).toBe(`wrap`)
  })
})
