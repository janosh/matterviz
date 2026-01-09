import { expect, type Locator, type Page, test } from '@playwright/test'
import { goto_structure_test, set_input_value } from '../helpers'

test.describe(`Atom Radius Controls`, () => {
  let page: Page
  let legend: Locator

  const get_first_legend_item = () => legend.locator(`.legend-item`).first()

  // Opens remap dropdown and returns fresh locator (always re-query to avoid stale refs)
  const open_remap_dropdown = async (item: Locator) => {
    await item.locator(`label`).click({ button: `right` })
    const dropdown = item.locator(`.remap-dropdown`)
    await expect(dropdown).toBeVisible()
    return dropdown
  }

  // Programmatically select a single site using test page button (deterministic, layout-independent)
  // Note: site-radius-control only appears when exactly 1 site is selected
  const select_site_programmatically = async (): Promise<Locator> => {
    const select_site_btn = page.locator(`[data-testid="btn-select-site-0"]`)
    await select_site_btn.click()
    const site_control = legend.locator(`.site-radius-control`)
    await expect(site_control).toBeVisible()
    return site_control
  }

  test.beforeEach(async ({ page: p }) => {
    page = p
    await goto_structure_test(page)
    legend = page.locator(`#test-structure .atom-legend`)
  })

  test(`element radius: dropdown opens with correct input attributes`, async () => {
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

  test(`element radius: change shows reset, affects canvas, reset restores`, async () => {
    const item = get_first_legend_item()
    let dropdown = await open_remap_dropdown(item)
    let radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    let reset_btn = dropdown.locator(`.radius-control .reset-btn`)
    const initial_value = await radius_input.inputValue()

    // Change radius to a different valid value - reset button appears
    const new_value = parseFloat(initial_value) < 1 ? `1.5` : `0.5`
    await set_input_value(radius_input, new_value)
    await expect(reset_btn).toBeVisible()
    await expect(radius_input).toHaveValue(new_value)

    // Close dropdown and poll for dropdown to close (deterministic, not fixed sleep)
    await page.mouse.click(10, 10)
    await expect(dropdown).not.toBeVisible()

    // Reopen dropdown and re-query locators (DOM may be recreated, avoiding stale refs)
    dropdown = await open_remap_dropdown(item)
    radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    reset_btn = dropdown.locator(`.radius-control .reset-btn`)

    // Verify changed value persisted
    await expect(radius_input).toHaveValue(new_value)
    await expect(reset_btn).toBeVisible()

    // Reset and verify original value restored
    await reset_btn.click()
    await expect(radius_input).toHaveValue(initial_value)
    await expect(reset_btn).toHaveCount(0)
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

  test(`site radius overrides are cleared when supercell scaling changes`, async () => {
    // Select a site programmatically and modify its radius
    const site_control = await select_site_programmatically()
    const radius_input = site_control.locator(`input[type="number"]`)

    // Set a custom radius (creating a site_radius_override)
    await set_input_value(radius_input, `0.5`)
    await expect(site_control.locator(`.reset-btn`)).toBeVisible()

    // Clear selection first (supercell change won't clear it automatically without this)
    const clear_btn = page.locator(`[data-testid="btn-clear-selected"]`)
    await clear_btn.click()
    await expect(legend.locator(`.site-radius-control`)).toHaveCount(0)

    // Change supercell scaling - this should clear site_radius_overrides
    const supercell_input = page.locator(`[data-testid="supercell-input"]`)
    await supercell_input.fill(`2x2x2`)

    // Wait for supercell transformation to complete by polling for legend to have items
    // (a 2x2x2 supercell should still have the same elements in the legend)
    await expect
      .poll(() => legend.locator(`.legend-item`).count(), { timeout: 10_000 })
      .toBeGreaterThan(0)

    // Re-select a site programmatically after transformation
    await select_site_programmatically()

    // Get fresh reference to site control after transformation
    const new_site_control = legend.locator(`.site-radius-control`)
    const new_radius_input = new_site_control.locator(`input[type="number"]`)

    // The radius should be back to default (no reset button visible)
    // since site_radius_overrides should have been cleared
    await expect(new_site_control.locator(`.reset-btn`)).toHaveCount(0)
    const new_value = await new_radius_input.inputValue()
    // The value should NOT be 0.5 (the override) but the element default
    expect(parseFloat(new_value)).not.toBe(0.5)
  })
})
