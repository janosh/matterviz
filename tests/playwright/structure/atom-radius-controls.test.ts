import { expect, type Locator, type Page, test } from '@playwright/test'
import { goto_structure_test, set_input_value } from '../helpers'

test.describe(`Atom Radius Controls`, () => {
  let page: Page
  let canvas: Locator
  let legend: Locator

  const get_first_legend_item = () => legend.locator(`.legend-item`).first()

  const open_remap_dropdown = async (item: Locator) => {
    await item.locator(`label`).click({ button: `right` })
    const dropdown = item.locator(`.remap-dropdown`)
    await expect(dropdown).toBeVisible()
    return dropdown
  }

  // Clicks canvas at a position, returns true if site was selected
  const try_click_at = async (x_ratio: number, y_ratio: number): Promise<boolean> => {
    const box = await canvas.boundingBox()
    if (!box) return false
    await canvas.click({ position: { x: box.width * x_ratio, y: box.height * y_ratio } })
    await page.waitForTimeout(150)
    return (await legend.locator(`.site-radius-control`).count()) > 0
  }

  // Clicks canvas at multiple positions until an atom is selected
  const select_site_on_canvas = async (): Promise<Locator> => {
    const selected = (await try_click_at(0.5, 0.5)) || (await try_click_at(0.4, 0.4)) ||
      (await try_click_at(0.6, 0.6)) || (await try_click_at(0.3, 0.5)) ||
      (await try_click_at(0.7, 0.5))
    if (!selected) {
      throw new Error(`Could not select any site after trying multiple positions`)
    }
    return legend.locator(`.site-radius-control`)
  }

  test.beforeEach(async ({ page: p }) => {
    page = p
    await goto_structure_test(page)
    canvas = page.locator(`#test-structure canvas`)
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
    const dropdown = await open_remap_dropdown(item)
    const radius_input = dropdown.locator(`.radius-control input[type="number"]`)
    const reset_btn = dropdown.locator(`.radius-control .reset-btn`)
    const initial_value = await radius_input.inputValue()
    const initial_screenshot = await canvas.screenshot()

    // Change radius to a different valid value - reset button appears
    const new_value = parseFloat(initial_value) < 1 ? `1.5` : `0.5`
    await set_input_value(radius_input, new_value)
    await expect(reset_btn).toBeVisible()

    // Close dropdown and verify canvas changed
    await page.mouse.click(10, 10)
    await page.waitForTimeout(100)
    expect(initial_screenshot.equals(await canvas.screenshot())).toBe(false)

    // Reopen and reset
    await open_remap_dropdown(item)
    await reset_btn.click()
    await expect(radius_input).toHaveValue(initial_value)
    await expect(reset_btn).toHaveCount(0)
  })

  test(`site radius: control appears on selection with working reset`, async () => {
    // Initially no site control
    await expect(legend.locator(`.site-radius-control`)).toHaveCount(0)

    // Select atom - control must appear
    const site_control = await select_site_on_canvas()
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
})
