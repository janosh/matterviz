import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  expect_canvas_changed_by,
  goto_structure_test,
  IS_CI,
  set_input_value,
  structure_canvas,
} from '../helpers'

test.describe(`Atom Radius Controls`, () => {
  let page: Page
  let legend: Locator

  // Opens remap dropdown and returns fresh locator (always re-query to avoid stale refs)
  // Uses dispatchEvent('contextmenu') instead of mouse right-click for better CI stability
  // (avoids potential browser context menu interference in headless environments)
  const open_remap_dropdown = async (item: Locator) => {
    await item.locator(`label`).dispatchEvent(`contextmenu`)
    const dropdown = item.locator(`.remap-dropdown`)
    await expect(dropdown).toBeVisible()
    return dropdown
  }

  test.beforeEach(async ({ page: p }) => {
    test.skip(IS_CI, `Atom radius controls need a WebGL canvas, flaky in headless CI`)
    page = p
    await goto_structure_test(page)
    legend = page.locator(`#test-structure .atom-legend`)
    await expect(legend.locator(`.legend-item`).first()).toBeVisible()
  })

  test(`element radius: change shows reset, affects canvas, reset restores`, async () => {
    const canvas = structure_canvas(page)
    const item = legend.locator(`.legend-item`).first()
    let dropdown = await open_remap_dropdown(item)
    let radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    let reset_btn = dropdown.locator(`.radius-control .reset-btn`)
    await expect(dropdown.locator(`.radius-control .unit`)).toContainText(`Å`)
    await expect(reset_btn).toHaveCount(0)
    const initial_value = await radius_input.inputValue()

    const new_value = Number(initial_value) < 1 ? `1.5` : `0.5`
    // radius propagates to the rendering once the dropdown closes
    await expect_canvas_changed_by(canvas, async () => {
      await set_input_value(radius_input, new_value)
      await expect(reset_btn).toBeVisible()
      await expect(radius_input).toHaveValue(new_value)
      await page.mouse.click(10, 10)
      await expect(dropdown).not.toBeVisible()
    })

    // Reopen dropdown and re-query locators (DOM may be recreated, avoiding stale refs)
    dropdown = await open_remap_dropdown(item)
    radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    reset_btn = dropdown.locator(`.radius-control .reset-btn`)
    await expect(radius_input).toHaveValue(new_value)

    await expect_canvas_changed_by(canvas, async () => {
      await reset_btn.click()
      await expect(radius_input).toHaveValue(initial_value)
      await expect(reset_btn).toHaveCount(0)
      await page.mouse.click(10, 10)
      await expect(dropdown).not.toBeVisible()
    })
  })

  test(`site radius: control appears on single selection in edit-atoms mode`, async () => {
    const site_control = legend.locator(`.site-radius-control`)
    await expect(site_control).toHaveCount(0)

    // site-radius-control only surfaces in edit-atoms mode (Structure gates
    // atom_legend_selected_sites behind measure_mode === `edit-atoms`)
    await page.locator(`[data-testid="btn-set-edit-atoms"]`).click()
    await page.locator(`[data-testid="btn-select-site-0"]`).click()
    await expect(site_control).toBeVisible()
    await expect(site_control.locator(`.unit`)).toContainText(`Å`)
    await expect(site_control.locator(`.site-label`)).toBeVisible()

    const radius_input = site_control.locator(`input[type="number"]`)
    const reset_btn = site_control.locator(`.reset-btn`)
    const initial_value = await radius_input.inputValue()
    await expect(reset_btn).toHaveCount(0)

    await set_input_value(radius_input, `0.5`)
    await expect(reset_btn).toBeVisible()
    await reset_btn.click()
    await expect(radius_input).toHaveValue(initial_value)
    await expect(reset_btn).toHaveCount(0)
  })
})
