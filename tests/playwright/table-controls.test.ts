import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.beforeEach(async ({ page }) => {
  await page.goto(`/test/toggle-menu`, { waitUntil: `networkidle` })
  // Portaling happens after hydration; SSR buttons can be clicked before handlers exist.
  await expect(page.locator(`body > .column-menu`).first()).toBeAttached()
})

test(`table settings reset authored overrides and preserve column widths`, async ({
  page,
}) => {
  const table = page.locator(`#table-controls`)
  await table.locator(`.pane-toggle`).click()
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
  await table.getByTitle(`Next page`, { exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(`Gamma`)
  await table.locator(`.page-size-select`).selectOption(`3`)
  await expect(rows).toHaveCount(3)
  await table.getByRole(`button`, { name: `Search`, exact: true }).click()
  await table.locator(`input[type=search]`).fill(`Beta`)
  await expect(rows).toHaveCount(1)
  await expect(rows).toContainText(`Beta`)
  for (const format of [`csv`, `json`, `md`, `tex`]) {
    await table.getByRole(`button`, { name: `Export`, exact: true }).click()
    const downloaded = page.waitForEvent(`download`)
    await table.getByRole(`button`, { name: format.toUpperCase(), exact: true }).click()
    const download = await downloaded
    expect(download.suggestedFilename()).toBe(`table-export.${format}`)
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
  await table.locator(`summary[aria-label="Columns"]`).click()
  const column_menu = page.locator(`.column-menu:visible`)
  await column_menu.getByLabel(`Score`, { exact: true }).uncheck()
  await expect(score_header).toHaveCount(0)
  await table
    .getByRole(`button`, { name: `Reset all columns to defaults`, exact: true })
    .click()
  await expect(score_header).toBeVisible()
  await table.locator(`summary[aria-label="Columns"]`).click()
  await rows.first().getByRole(`checkbox`).check()
  const clear_selection = table.getByTitle(`Clear 1 selected rows`)
  await expect(clear_selection).toBeVisible()
  await clear_selection.click()
  await expect(rows.first().getByRole(`checkbox`)).not.toBeChecked()
})
