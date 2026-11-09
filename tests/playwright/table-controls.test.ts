import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto(`/test/toggle-menu`, { waitUntil: `networkidle` })
  // SSR buttons can be clicked before their handlers exist
  await expect(page.locator(`h1`)).toHaveAttribute(`data-hydrated`, `true`)
})

test(`table settings reset authored overrides and preserve column widths`, async ({
  page,
}) => {
  const table = page.locator(`#table-controls`)
  await table.locator(`.control-pane-toggle`).click()
  const pane = page.locator(`.table-controls-pane`)
  for (const section of [`heatmap`, `display`, `column colors`]) {
    const reset = pane.getByRole(`button`, {
      name: `Reset ${section} to defaults`,
      exact: true,
    })
    await reset.click()
    await expect(reset).toHaveCount(0)
  }
  await expect(pane.getByLabel(`Show heatmap`, { exact: true })).toBeChecked()
  await expect(pane.getByLabel(`Row numbers`, { exact: true })).not.toBeChecked()
  const heatmap_rows = await pane
    .getByRole(`region`, { name: `Heatmap`, exact: true })
    .locator(`:scope > label`)
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().toJSON()))
  expect(heatmap_rows).toHaveLength(2)
  expect(heatmap_rows[1].top - heatmap_rows[0].bottom).toBeGreaterThanOrEqual(7.5)
  const score_cell = table.locator(`td[data-col="Score"]`).first()
  await expect(score_cell).toHaveCSS(`width`, `120px`)
  await expect
    .poll(() => score_cell.evaluate((element) => element.style.getPropertyValue(`--cell-bg`)))
    .not.toBe(``)
  const opacity = pane.locator(`input[type=number]`)
  await opacity.fill(`0.4`)
  await expect(pane.locator(`input[type=range]`)).toHaveValue(`0.4`)
  await pane.getByRole(`button`, { name: `Reset heatmap to defaults`, exact: true }).click()
  await expect(opacity).toHaveValue(`1`)
})

test(`table search, pagination, selection and export use the visible data`, async ({
  page,
}) => {
  const table = page.locator(`#table-controls`)
  const rows = table.locator(`tbody tr`)
  await expect(rows).toHaveCount(2)
  await table.getByRole(`button`, { name: `Next page`, exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(`Gamma`)
  await table.locator(`.page-size-select`).selectOption(`3`)
  await expect(rows).toHaveCount(3)
  await table.getByRole(`button`, { name: `Search`, exact: true }).click()
  await table.locator(`input[type=search]`).fill(`Beta`)
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(`Beta`)
  await table.locator(`button.export-toggle`).click()
  const filename = table.getByRole(`textbox`, { name: `File name`, exact: true })
  await filename.fill(`Selected rows`)
  const labels = { csv: `CSV`, json: `JSON`, md: `Markdown`, tex: `LaTeX` }
  for (const [format, label] of Object.entries(labels)) {
    await expect(filename).toHaveValue(`Selected rows`)
    const downloaded = page.waitForEvent(`download`)
    await table.getByRole(`button`, { name: `Download ${label}`, exact: true }).click()
    const download = await downloaded
    expect(download.suggestedFilename()).toBe(`Selected rows.${format}`)
    const path = await download.path()
    if (!path) throw new Error(`Missing downloaded ${format} path`)
    const content = await readFile(path, `utf8`)
    expect(content).toContain(`Beta`)
    expect(content).not.toContain(`Alpha`)
    expect(content).not.toContain(`Gamma`)
  }
  await table.getByRole(`button`, { name: `Clear`, exact: true }).click()
  await expect(rows).toHaveCount(3)
  const score_header = table.locator(`th[data-col-id="Score"]`)
  await score_header.click()
  await expect(score_header).toHaveAttribute(`aria-sort`, `descending`)
  await expect(rows).toContainText([`Alpha`, `Gamma`, `Beta`])
  await score_header.click()
  await expect(rows.first()).toContainText(`Beta`)
  await table.getByRole(`button`, { name: `Columns`, exact: true }).click()
  const column_menu = page.locator(`.column-menu:popover-open`)
  await column_menu.getByLabel(`Score`, { exact: true }).uncheck()
  await expect(score_header).toHaveCount(0)
  await table
    .getByRole(`button`, { name: `Reset all columns to defaults`, exact: true })
    .click()
  await expect(score_header).toBeVisible()
  await table.getByRole(`button`, { name: `Columns`, exact: true }).click() // closes the menu
  await rows.first().getByRole(`checkbox`).check()
  const clear_selection = table.getByTitle(`Clear 1 selected rows`)
  await expect(clear_selection).toBeVisible()
  await clear_selection.click()
  await expect(rows.first().getByRole(`checkbox`)).not.toBeChecked()
})

// The column menu (a native auto popover) and the export pane overlap, so opening either one
// must close the other: by light dismiss and the pane's outside-click close respectively
// oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
for (const first of [`columns`, `export`] as const) {
  test(`opening the ${first} menu closes the other`, async ({ page }) => {
    const table = page.locator(`#table-controls`)
    const columns_btn = table.getByRole(`button`, { name: `Columns`, exact: true })
    const export_btn = table.locator(`button.export-toggle`)
    const column_menu = page.locator(`.column-menu:popover-open`)
    const export_pane = table.getByRole(`textbox`, { name: `File name`, exact: true })
    const [open_first, open_second] =
      first === `columns` ? [columns_btn, export_btn] : [export_btn, columns_btn]
    const [first_menu, second_menu] =
      first === `columns` ? [column_menu, export_pane] : [export_pane, column_menu]
    await open_first.click()
    await expect(first_menu).toBeVisible()
    await open_second.click()
    await expect(second_menu).toBeVisible()
    await expect(first_menu).toBeHidden()
  })
}
