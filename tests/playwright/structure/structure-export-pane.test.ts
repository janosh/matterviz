import { expect, type Page, test } from '@playwright/test'
import { get_canvas_timeout, goto_structure_test } from '../helpers'

async function open_export_pane(page: Page) {
  const export_toggle = page.locator(`.structure-export-toggle`).first()
  await expect(export_toggle).toBeVisible()

  await export_toggle.click()

  // Wait for the pane to appear - it's a draggable-pane with export-pane class
  const pane_div = page.locator(`.draggable-pane.export-pane`).first()
  await expect(pane_div).toBeVisible({ timeout: 30000 })
  return { export_toggle, pane_div }
}

test.describe(`StructureExportPane Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
    // Wait for the export toggle to appear (WebGL/3D rendering takes longer in CI)
    await page.waitForSelector(`.structure-export-toggle`, {
      timeout: get_canvas_timeout(),
    })
  })

  test(`toggle button visibility and tooltip`, async ({ page }) => {
    const export_toggle = page.locator(`.structure-export-toggle`).first()
    await expect(export_toggle).toBeVisible()
    await expect(export_toggle).toHaveAttribute(`title`, `Export Structure`)
  })

  test(`opens and closes export pane`, async ({ page }) => {
    const { export_toggle, pane_div } = await open_export_pane(page)
    await expect(pane_div).toBeVisible()

    // Verify sections are present
    await expect(pane_div.locator(`h4:has-text("Export as text")`)).toBeVisible()
    await expect(pane_div.locator(`h4:has-text("Export as image")`)).toBeVisible()
    await expect(pane_div.locator(`h4:has-text("Export as 3D model")`)).toBeVisible()

    // Close pane
    await export_toggle.click()
    await expect(pane_div).toBeHidden()
  })

  test(`displays all export format buttons`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    // Text formats - check they appear in the export buttons section
    const text_formats = [`JSON`, `XYZ`, `CIF`, `POSCAR`]
    await Promise.all(
      text_formats.map((format) => expect(pane_div.getByText(format)).toBeVisible()),
    )

    // 3D formats
    await Promise.all([
      expect(pane_div.getByText(`GLB`)).toBeVisible(),
      expect(pane_div.getByText(`OBJ`)).toBeVisible(),
    ])
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

    // Find the JSON copy button specifically
    const copy_btn = pane_div.locator(`button[title="Copy JSON to clipboard"]`)

    await expect(copy_btn).toHaveText(`📋`)
    await copy_btn.click()
    await expect(copy_btn).toHaveText(`✅`, { timeout: get_canvas_timeout() })
    await expect(copy_btn).toHaveText(`📋`, { timeout: 2000 })
  })

  test(`PNG export section with DPI controls`, async ({ page }) => {
    const { pane_div } = await open_export_pane(page)

    await expect(pane_div.locator(`h4:has-text("Export as image")`)).toBeVisible()

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
    await expect(pane_div).toBeHidden()

    await export_toggle.click()
    await expect(pane_div).toBeVisible()

    const dpi_input_reopened = pane_div.locator(
      `input[type="number"][title*="dots per inch"]`,
    )
    await expect(dpi_input_reopened).toHaveValue(`250`)
  })

  test(`multiple formats can be copied in sequence`, async ({ page }) => {
    await page.context().grantPermissions([`clipboard-write`])
    const { pane_div } = await open_export_pane(page)

    // Copy JSON
    const json_copy = pane_div.locator(`button[title="Copy JSON to clipboard"]`)
    await json_copy.click()
    await expect(json_copy).toHaveText(`✅`, { timeout: get_canvas_timeout() })
    // Wait for checkmark to reset before next copy
    await expect(json_copy).not.toHaveText(`✅`, { timeout: 2000 })

    // Copy XYZ
    const xyz_copy = pane_div.locator(`button[title="Copy XYZ to clipboard"]`)
    await xyz_copy.click()
    await expect(xyz_copy).toHaveText(`✅`, { timeout: get_canvas_timeout() })
  })

  test(`export pane and control pane have mutual exclusion`, async ({ page }) => {
    const { pane_div: export_pane, export_toggle } = await open_export_pane(page)
    await expect(export_pane).toBeVisible()

    // Opening control pane closes export pane (mutual exclusion)
    const control_toggle = page.locator(`.structure-controls-toggle`).first()
    await control_toggle.click()

    const control_pane = page.locator(`.draggable-pane.controls-pane`).first()
    await expect(control_pane).toBeVisible()
    await expect(export_pane).toBeHidden() // Export pane closes when control pane opens

    // Opening export pane closes control pane
    await export_toggle.click()
    await expect(export_pane).toBeVisible()
    await expect(control_pane).toBeHidden() // Control pane closes when export pane opens

    // Toggle back to control pane
    await control_toggle.click()
    await expect(control_pane).toBeVisible()
    await expect(export_pane).toBeHidden() // Mutual exclusion still applies
  })

  test.describe(`format label hover tooltips`, () => {
    const text_format_tooltips = [
      {
        label: `JSON`,
        expected_text: `Pymatgen`,
        description: `Python Materials Genomics`,
        link_href: `pymatgen.org`,
      },
      {
        label: `XYZ`,
        expected_text: `ASE`,
        description: `Atomic Simulation Environment`,
        link_href: `wiki.fysik.dtu.dk/ase`,
      },
      {
        label: `CIF`,
        expected_text: `IUCr`,
        description: `Crystallographic Information File`,
        link_href: `iucr.org`,
      },
      {
        label: `POSCAR`,
        expected_text: `VASP`,
        description: `Vienna Ab initio Simulation Package`,
        link_href: `vasp.at`,
      },
    ]

    for (const { label, expected_text, description, link_href } of text_format_tooltips) {
      test(`${label} format shows tooltip on hover`, async ({ page }) => {
        const { pane_div } = await open_export_pane(page)

        // Use getByText for reliable span matching
        const label_span = pane_div.getByText(label, { exact: true })
        await expect(label_span).toBeVisible()
        await label_span.hover()

        // Wait for tooltip to appear (svelte-multiselect custom-tooltip)
        const tooltip_elem = page.locator(`.custom-tooltip`).first()
        await expect(tooltip_elem).toBeVisible({ timeout: 3000 })

        // Verify tooltip contains expected content
        const tooltip_text = await tooltip_elem.textContent()
        expect(tooltip_text).toContain(expected_text)
        expect(tooltip_text).toContain(description)

        // Verify tooltip contains clickable link with correct href
        const tooltip_link = tooltip_elem.locator(`a[href*="${link_href}"]`)
        await expect(tooltip_link).toBeVisible()
        await expect(tooltip_link).toHaveAttribute(`target`, `_blank`)
      })
    }

    test(`tooltip disappears when mouse leaves label`, async ({ page }) => {
      const { pane_div } = await open_export_pane(page)

      const json_label = pane_div.getByText(`JSON`, { exact: true })
      await json_label.hover()

      const tooltip_elem = page.locator(`.custom-tooltip`).first()
      await expect(tooltip_elem).toBeVisible({ timeout: 3000 })

      // Move mouse away from the label
      await pane_div.locator(`h4:has-text("Export as text")`).hover()
      await expect(tooltip_elem).toBeHidden({ timeout: 3000 })
    })
  })
})
