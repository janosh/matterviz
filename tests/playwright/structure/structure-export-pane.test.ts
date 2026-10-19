import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  goto_structure_test,
  open_structure_export_pane,
  webgl_on_ci_for_tagged,
} from '../helpers'

webgl_on_ci_for_tagged()

test.describe(`StructureExportPane Tests`, { tag: `@webgl` }, () => {
  test(`format tooltips link their docs; copy shows checkmarks; download keeps its name`, async ({
    page,
  }) => {
    // always-visible controls: in hover mode the canvas intercepts the toggle's hit test
    await goto_structure_test(page, `/test/structure?show_controls=always`)
    await page.context().grantPermissions([`clipboard-write`])
    const { pane_div } = await open_structure_export_pane(page)

    await test.step(`format labels show tooltips linking their docs on hover`, async () => {
      for (const [label, expected_text, link_href] of [
        [`JSON`, `Pymatgen`, `pymatgen.org`],
        [`XYZ`, `ASE`, `wiki.fysik.dtu.dk/ase`],
        [`CIF`, `IUCr`, `iucr.org`],
        [`POSCAR`, `VASP`, `vasp.at`],
      ]) {
        await pane_div.getByText(label, { exact: true }).hover()
        // format hints open as hover popovers named by ExportPane's export_label snippet
        const tooltip_elem = page
          .getByRole(`dialog`, { name: `Export format details` })
          .filter({ hasText: expected_text })
        await expect(tooltip_elem, label).toBeVisible()
        const tooltip_link = tooltip_elem.locator(`a[href*="${link_href}"]`)
        await expect(tooltip_link, label).toBeVisible()
        await expect(tooltip_link, label).toHaveAttribute(`target`, `_blank`)

        // Move the pointer clear of BOTH label and tooltip: the tooltip sits left of its label
        // and can cover the section heading, so hovering that would hold it open.
        await page.mouse.move(2, 2)
        await expect(tooltip_elem, label).toBeHidden()
      }
    })

    await test.step(`copying two formats in sequence shows checkmark feedback each time`, async () => {
      for (const format of [`JSON`, `XYZ`]) {
        const copy_btn = pane_div.locator(`button[title="Copy ${format} to clipboard"]`)
        await expect(copy_btn).toHaveText(`📋`)
        await copy_btn.click()
        await expect(copy_btn).toHaveText(`✅`)
        await expect(copy_btn).toHaveText(`📋`)
      }
    })

    await test.step(`JSON download uses the entered file name`, async () => {
      await pane_div
        .getByRole(`textbox`, { name: `File name`, exact: true })
        .fill(`My crystal`)
      const downloaded = page.waitForEvent(`download`)
      await pane_div.getByRole(`button`, { name: `Download JSON`, exact: true }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe(`My crystal.json`)
      const path = await download.path()
      if (!path) throw new Error(`Missing exported structure`)
      expect(JSON.parse(await readFile(path, `utf8`)).sites.length).toBeGreaterThan(0)
    })
  })
})
