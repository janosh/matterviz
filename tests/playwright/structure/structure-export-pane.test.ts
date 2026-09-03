import { expect, test } from '@playwright/test'
import { goto_structure_test, IS_CI, open_structure_export_pane } from '../helpers'

test.describe(`StructureExportPane Tests`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `StructureExportPane tests timeout in CI`)
    // always-visible controls: in hover mode the canvas intercepts the toggle's hit test
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`export pane and control pane have mutual exclusion`, async ({ page }) => {
    const { container: structure, pane_div: export_pane } =
      await open_structure_export_pane(page)
    const export_toggle = structure.locator(`.structure-export-toggle`)

    // Opening control pane closes export pane (mutual exclusion)
    const control_toggle = structure.locator(`.structure-controls-toggle`)
    await control_toggle.click()
    const control_pane = structure.locator(`.draggable-pane.controls-pane`)
    await expect(control_pane).toBeVisible()
    await expect(export_pane).toBeHidden()

    // Opening export pane closes control pane
    await export_toggle.click()
    await expect(export_pane).toBeVisible()
    await expect(control_pane).toBeHidden()

    // Toggling the export pane closed keeps the DPI edit for the next open
    const dpi_input = export_pane.locator(`input[type="number"][title*="dots per inch"]`)
    await dpi_input.fill(`250`)
    await export_toggle.click()
    await expect(export_pane).toBeHidden()
    await export_toggle.click()
    await expect(export_pane).toBeVisible()
    await expect(dpi_input).toHaveValue(`250`)
  })

  test(`copying two formats in sequence shows checkmark feedback each time`, async ({
    page,
  }) => {
    await page.context().grantPermissions([`clipboard-write`])
    const { pane_div } = await open_structure_export_pane(page)

    for (const format of [`JSON`, `XYZ`]) {
      const copy_btn = pane_div.locator(`button[title="Copy ${format} to clipboard"]`)
      await expect(copy_btn).toHaveText(`📋`)
      await copy_btn.click()
      await expect(copy_btn).toHaveText(`✅`)
      await expect(copy_btn).toHaveText(`📋`)
    }
  })

  const text_format_tooltips = [
    { label: `JSON`, expected_text: `Pymatgen`, link_href: `pymatgen.org` },
    { label: `XYZ`, expected_text: `ASE`, link_href: `wiki.fysik.dtu.dk/ase` },
    { label: `CIF`, expected_text: `IUCr`, link_href: `iucr.org` },
    { label: `POSCAR`, expected_text: `VASP`, link_href: `vasp.at` },
  ]
  for (const { label, expected_text, link_href } of text_format_tooltips) {
    test(`${label} format label shows tooltip with link on hover`, async ({ page }) => {
      const { pane_div } = await open_structure_export_pane(page)
      await pane_div.getByText(label, { exact: true }).hover()

      // svelte-widgets tooltips mount on document.body, where the docs header has its own:
      // match on text, or a second tooltip makes every assertion below a strict-mode violation
      const tooltip_elem = page.locator(`.custom-tooltip`, { hasText: expected_text })
      await expect(tooltip_elem).toBeVisible()
      const tooltip_link = tooltip_elem.locator(`a[href*="${link_href}"]`)
      await expect(tooltip_link).toBeVisible()
      await expect(tooltip_link).toHaveAttribute(`target`, `_blank`)

      // Move the pointer clear of BOTH label and tooltip. Hovering the section heading is not
      // enough: the tooltip is placed to the left of its label, so for some formats it covers
      // the heading and keeping the cursor on it holds the tooltip open.
      await page.mouse.move(2, 2)
      await expect(tooltip_elem).toBeHidden()
    })
  }
})
