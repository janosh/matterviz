import { expect, type Locator, type Page, test } from '@playwright/test'

const ISO_URL = `/structure/isosurface?file=Si-CHGCAR.gz`

async function wait_for_isosurface(page: Page) {
  await page.goto(ISO_URL, { waitUntil: `networkidle` })
  await expect(page.locator(`text=Grid:`)).toBeVisible({ timeout: 15_000 })
}

async function open_settings_pane(page: Page) {
  await page.evaluate(() => {
    const style = document.createElement(`style`)
    style.textContent =
      `.hover-visible { opacity: 1 !important; pointer-events: auto !important; }`
    document.head.appendChild(style)
  })
  const gear = page.locator(`button.structure-controls-toggle`)
  await expect(gear).toBeVisible({ timeout: 5000 })
  await gear.click()
  const pane = page.locator(`.controls-pane`)
  await expect(pane).toBeVisible({ timeout: 5000 })
  return pane
}

// Get center of a bounding box, throwing if null
async function get_center(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`Element has no bounding box`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Drag from a locator's center by a given offset
async function drag_from(
  page: Page,
  locator: Locator,
  dx: number,
  dy: number,
) {
  const { x, y } = await get_center(locator)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}

test.describe(`Isosurface controls`, () => {
  test.beforeEach(async ({ page }) => {
    await wait_for_isosurface(page)
  })

  test(`neg. lobe toggle adds and removes negative surface`, async ({ page }) => {
    const pane = await open_settings_pane(page)
    const neg_cb = pane.locator(`label:has-text("Neg. lobe") input[type="checkbox"]`)
    await expect(neg_cb).toBeVisible()
    await neg_cb.check()
    await expect(neg_cb).toBeChecked()
    await neg_cb.uncheck()
    await expect(neg_cb).not.toBeChecked()
  })

  test(`halo slider is present for periodic volumes`, async ({ page }) => {
    const pane = await open_settings_pane(page)
    const halo_slider = pane.locator(`label:has-text("Halo") input[type="range"]`)
    await expect(halo_slider).toBeVisible()
    await expect(halo_slider).toHaveValue(`0`)
  })
})

test.describe(`DraggablePane resize grip`, () => {
  test.beforeEach(async ({ page }) => {
    await wait_for_isosurface(page)
  })

  test(`resize grip is visible when pane is open`, async ({ page }) => {
    const pane = await open_settings_pane(page)
    await expect(pane.locator(`.resize-grip`)).toBeVisible()
  })

  test(`dragging resize grip changes pane width`, async ({ page }) => {
    const pane = await open_settings_pane(page)
    const initial_box = await pane.boundingBox()
    expect(initial_box).toBeTruthy()
    await drag_from(page, pane.locator(`.resize-grip`), 100, 0)
    await expect(pane).toBeVisible()
    const resized_box = await pane.boundingBox()
    expect(resized_box).toBeTruthy()
    expect(resized_box?.width).toBeGreaterThan((initial_box?.width ?? 0) + 50)
  })

  test(`double-clicking resize grip resets pane size`, async ({ page }) => {
    const pane = await open_settings_pane(page)
    await drag_from(page, pane.locator(`.resize-grip`), 150, 0)
    await expect(pane).toBeVisible()
    await pane.locator(`.resize-grip`).dblclick()
    const inline_width = await pane.evaluate((el) => el.style.width)
    expect(inline_width).toBe(``)
  })

  test(`control tab shows reset/close after drag, reset keeps pane open`, async ({ page }) => {
    const pane = await open_settings_pane(page)
    const tab = pane.locator(`.control-tab`)
    await expect(tab.locator(`.drag-handle`)).toBeVisible()
    await expect(tab.locator(`.reset-button`)).not.toBeVisible()

    await drag_from(page, tab.locator(`.drag-handle`), 20, 20)

    await expect(tab.locator(`.reset-button`)).toBeVisible()
    await expect(tab.locator(`.close-button`)).toBeVisible()

    await tab.locator(`.reset-button`).click()
    await expect(pane).toBeVisible()
  })
})
