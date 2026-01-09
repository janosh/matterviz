import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  assert_test_hook_exists,
  expect_canvas_changed,
  goto_structure_test,
  set_input_value,
} from '../helpers'

test.describe(`Atom Radius Controls`, () => {
  let page: Page
  let legend: Locator

  const get_first_legend_item = () => legend.locator(`.legend-item`).first()

  // Opens remap dropdown and returns fresh locator (always re-query to avoid stale refs)
  // Uses dispatchEvent('contextmenu') instead of mouse right-click for better CI stability
  // (avoids potential browser context menu interference in headless environments)
  const open_remap_dropdown = async (item: Locator) => {
    const label = item.locator(`label`)
    await label.dispatchEvent(`contextmenu`)
    const dropdown = item.locator(`.remap-dropdown`)
    await expect(dropdown).toBeVisible()
    return dropdown
  }

  // Programmatically select a single site using test page button (deterministic, layout-independent)
  // Note: site-radius-control only appears when exactly 1 site is selected
  // Uses assert_test_hook_exists for clearer failures if test page changes
  const select_site_programmatically = async (): Promise<Locator> => {
    const select_site_btn = await assert_test_hook_exists(
      page,
      `btn-select-site-0`,
      `Site selection button required for programmatic site selection`,
    )
    await select_site_btn.click()
    const site_control = legend.locator(`.site-radius-control`)
    await expect(site_control).toBeVisible()
    return site_control
  }

  test.beforeEach(async ({ page: p }) => {
    page = p
    await goto_structure_test(page)
    legend = page.locator(`#test-structure .atom-legend`)
    // Wait for legend items to be visible (CI can be slow to render atoms)
    await expect(legend.locator(`.legend-item`).first()).toBeVisible({ timeout: 10_000 })
  })

  test.skip(`element radius: dropdown opens with correct input attributes`, async () => {
    const dropdown = await open_remap_dropdown(get_first_legend_item())
    const radius_control = dropdown.locator(`.radius-control`)
    const radius_input = radius_control.locator(`input[type="number"]`)

    await expect(radius_control).toBeVisible()
    await expect(radius_input).toHaveAttribute(`min`, `0.1`)
    await expect(radius_input).toHaveAttribute(`max`, `5`)
    await expect(radius_input).toHaveAttribute(`step`, `0.05`)
    await expect(radius_control.locator(`.unit`)).toContainText(`Å`)
    await expect(radius_control.locator(`.reset-btn`)).toHaveCount(0)
  })

  test.skip(`element radius: change shows reset, affects canvas, reset restores`, async () => {
    const canvas = page.locator(`#test-structure canvas`)
    const item = get_first_legend_item()
    let dropdown = await open_remap_dropdown(item)
    let radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    let reset_btn = dropdown.locator(`.radius-control .reset-btn`)
    const initial_value = await radius_input.inputValue()

    // Capture canvas before radius change
    const canvas_before_change = await canvas.screenshot()

    // Change radius to a different valid value - reset button appears
    const new_value = parseFloat(initial_value) < 1 ? `1.5` : `0.5`
    await set_input_value(radius_input, new_value)
    await expect(reset_btn).toBeVisible()
    await expect(radius_input).toHaveValue(new_value)

    // Close dropdown and poll for dropdown to close (deterministic, not fixed sleep)
    await page.mouse.click(10, 10)
    await expect(dropdown).not.toBeVisible()

    // Verify canvas actually changed (radius propagated to WebGL rendering)
    await expect_canvas_changed(canvas, canvas_before_change)

    // Reopen dropdown and re-query locators (DOM may be recreated, avoiding stale refs)
    dropdown = await open_remap_dropdown(item)
    radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    reset_btn = dropdown.locator(`.radius-control .reset-btn`)

    // Verify changed value persisted
    await expect(radius_input).toHaveValue(new_value)
    await expect(reset_btn).toBeVisible()

    // Capture canvas before reset
    const canvas_before_reset = await canvas.screenshot()

    // Reset and verify original value restored
    await reset_btn.click()
    await expect(radius_input).toHaveValue(initial_value)
    await expect(reset_btn).toHaveCount(0)

    // Close dropdown and verify canvas reverted
    await page.mouse.click(10, 10)
    await expect(dropdown).not.toBeVisible()
    await expect_canvas_changed(canvas, canvas_before_reset)
  })

  test(`site radius: control appears on selection with working reset`, async () => {
    // Initially no site control
    await expect(legend.locator(`.site-radius-control`)).toHaveCount(0)

    // Select atom programmatically - control must appear
    const site_control = await select_site_programmatically()
    await expect(site_control.locator(`input[type="number"]`)).toBeVisible()
    await expect(site_control.locator(`.unit`)).toContainText(`Å`)
    await expect(site_control.locator(`.site-label`)).toBeVisible()

    // Modify radius - reset appears
    const radius_input = site_control.locator(`input[type="number"]`)
    const initial_value = await radius_input.inputValue()
    await expect(site_control.locator(`.reset-btn`)).toHaveCount(0)

    await set_input_value(radius_input, `0.5`)
    await expect(site_control.locator(`.reset-btn`)).toBeVisible()

    // Reset restores original
    await site_control.locator(`.reset-btn`).click()
    await expect(radius_input).toHaveValue(initial_value)
    await expect(site_control.locator(`.reset-btn`)).toHaveCount(0)
  })

  test(`dropdown contains radius control and element remap search`, async () => {
    const dropdown = await open_remap_dropdown(get_first_legend_item())

    await expect(dropdown.locator(`.radius-control`)).toBeVisible()
    await expect(dropdown.locator(`.remap-search`)).toBeVisible()

    await dropdown.locator(`.remap-search`).fill(`Fe`)
    await expect(dropdown.locator(`.remap-option`).first()).toContainText(`Fe`)
  })

  test.skip(`site radius overrides are cleared when supercell scaling changes`, async () => {
    // Select a site programmatically and modify its radius
    const site_control = await select_site_programmatically()
    const radius_input = site_control.locator(`input[type="number"]`)

    // Capture original default value before any modification
    const original_default = await radius_input.inputValue()

    // Set a custom radius different from default (creating a site_radius_override)
    const override_value = parseFloat(original_default) < 1 ? `1.5` : `0.5`
    await set_input_value(radius_input, override_value)
    await expect(site_control.locator(`.reset-btn`)).toBeVisible()

    // Clear selection first (supercell change won't clear it automatically without this)
    const clear_btn = await assert_test_hook_exists(
      page,
      `btn-clear-selected`,
      `Clear selection button required for supercell test`,
    )
    await clear_btn.click()
    await expect(legend.locator(`.site-radius-control`)).toHaveCount(0)

    // Capture canvas before supercell change to detect transformation completion
    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()
    const canvas_before = await canvas.screenshot()

    // Change supercell scaling - this should clear site_radius_overrides
    const supercell_input = await assert_test_hook_exists(
      page,
      `supercell-input`,
      `Supercell input required for supercell scaling test`,
    )
    await set_input_value(supercell_input, `2x2x2`)

    // Wait for supercell transformation to complete (2x2x2 renders 8x more atoms)
    await expect_canvas_changed(canvas, canvas_before, 10_000)

    // Re-select a site programmatically after transformation
    await select_site_programmatically()

    // Get fresh reference to site control after transformation
    const new_site_control = legend.locator(`.site-radius-control`)
    const new_radius_input = new_site_control.locator(`input[type="number"]`)

    // The radius should be back to default (no reset button visible)
    // since site_radius_overrides should have been cleared
    await expect(new_site_control.locator(`.reset-btn`)).toHaveCount(0)
    const new_value = await new_radius_input.inputValue()
    // Value should NOT be the override value - compare to original default or just verify reset hidden
    expect(parseFloat(new_value)).not.toBe(parseFloat(override_value))
  })
})
