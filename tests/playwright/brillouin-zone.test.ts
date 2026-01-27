import { expect, type Page, test } from '@playwright/test'
import { IS_CI, wait_for_3d_canvas } from './helpers'

const BZ_SELECTOR = `#test-brillouin-zone`
// IBZ computation requires moyo-wasm symmetry analysis which can be slow,
// especially in CI with software rendering. 10s accommodates most structures.
const IBZ_LOAD_TIMEOUT = 10000

test.describe(`BrillouinZone Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `BrillouinZone tests timeout in CI`)
    await page.goto(`/test/brillouin-zone`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, BZ_SELECTOR)
  })

  test(`renders canvas with dimensions`, async ({ page }) => {
    const canvas = page.locator(`${BZ_SELECTOR} canvas`)
    await expect(canvas).toBeVisible()
    expect(await canvas.getAttribute(`width`)).toBeTruthy()
    expect(await canvas.getAttribute(`height`)).toBeTruthy()
  })

  test(`BZ order control updates`, async ({ page }) => {
    const order_input = page.locator(`#bz-order`)
    await order_input.fill(`2`)
    await expect(page.locator(`[data-testid="bz-order"]`)).toHaveText(`2`)
    await order_input.fill(`1`)
    await expect(page.locator(`[data-testid="bz-order"]`)).toHaveText(`1`)
  })

  test(`camera projection toggles`, async ({ page }) => {
    const projection = page.locator(`#camera-projection`)
    await expect(projection).toHaveValue(`perspective`)
    await projection.selectOption(`orthographic`)
    await expect(page.locator(`[data-testid="camera-projection"]`)).toHaveText(
      `orthographic`,
    )
    await projection.selectOption(`perspective`)
  })

  test(`controls pane toggles`, async ({ page }) => {
    const checkbox = page.locator(`#controls-open`)
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect(page.locator(`[data-testid="controls-open"]`)).toHaveText(`true`)
    await checkbox.uncheck()
    await expect(page.locator(`[data-testid="controls-open"]`)).toHaveText(`false`)
  })

  test(`info pane toggles`, async ({ page }) => {
    const checkbox = page.locator(`#info-pane-open`)
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect(page.locator(`[data-testid="info-pane-open"]`)).toHaveText(`true`)
    await checkbox.uncheck()
  })

  test(`show controls setting cycles`, async ({ page }) => {
    const select = page.locator(`#show-controls`)
    const status = page.locator(`[data-testid="show-controls"]`)

    await select.selectOption(`false`)
    await expect(status).toHaveText(`false`)
    await select.selectOption(`true`)
    await expect(status).toHaveText(`true`)
    await select.selectOption(`600`)
    await expect(status).toHaveText(`600`)
  })

  test(`handles camera rotation and zoom`, async ({ page }) => {
    const canvas = page.locator(`${BZ_SELECTOR} canvas`)
    const box = await canvas.boundingBox()
    expect(box, `Canvas bounding box should be available`).toBeTruthy()
    if (!box) return // TypeScript narrowing

    const initial = await canvas.screenshot()
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
    })

    // Poll until canvas screenshot differs from initial (rotation applied)
    let rotated = initial
    await expect(async () => {
      rotated = await canvas.screenshot()
      expect(rotated.equals(initial)).toBe(false)
    }).toPass({ timeout: 5000 })

    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
    await page.mouse.wheel(0, -200)

    // Poll until canvas screenshot differs from rotated (zoom applied)
    await expect(async () => {
      const zoomed = await canvas.screenshot()
      expect(zoomed.equals(rotated)).toBe(false)
    }).toPass({ timeout: 5000 })
  })

  test(`fullscreen prop is bindable`, async ({ page }) => {
    const status = page.locator(`[data-testid="fullscreen-status"]`)
    const checkbox = page.locator(`[data-testid="fullscreen-checkbox"]`)

    await expect(status).toHaveText(`false`)
    await expect(checkbox).not.toBeChecked()

    await checkbox.click({ force: true })
    await expect(status).toHaveText(`true`)
    await expect(checkbox).toBeChecked()

    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>(
        `[data-testid="fullscreen-checkbox"]`,
      )
      if (el) {
        el.checked = false
        el.dispatchEvent(new Event(`change`, { bubbles: true }))
      }
    })
    await expect(status).toHaveText(`false`)
    await expect(checkbox).not.toBeChecked()
  })

  test(`Escape closes panes`, async ({ page }) => {
    await page.locator(`#controls-open`).check()
    await expect(page.locator(`[data-testid="controls-open"]`)).toHaveText(`true`)
    await page.locator(BZ_SELECTOR).click()
    await page.keyboard.press(`Escape`)
    await expect(page.locator(`[data-testid="controls-open"]`)).toHaveText(`false`)
  })
})

test.describe(`BrillouinZone File Drop Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `BrillouinZone file drop tests timeout in CI`)
    await page.goto(`/test/brillouin-zone`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, BZ_SELECTOR)
  })

  test(`handles file drops`, async ({ page }) => {
    const poscar = `Test Structure
1.0
3.0 0.0 0.0
0.0 3.0 0.0
0.0 0.0 3.0
Si
1
Direct
0.0 0.0 0.0`

    const data_transfer = await page.evaluateHandle(
      (content) => {
        const dt = new DataTransfer()
        dt.items.add(new File([content], `test.poscar`, { type: `text/plain` }))
        return dt
      },
      poscar,
    )

    const bz = page.locator(BZ_SELECTOR)
    await bz.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await bz.dispatchEvent(`drop`, { dataTransfer: data_transfer })
    await data_transfer.dispose()
    // Wait for canvas to be ready after file drop
    await expect(page.locator(`${BZ_SELECTOR} canvas`)).toBeVisible()
  })
})

test.describe(`BrillouinZone Event Handler Tests`, () => {
  test.beforeEach(() => {
    test.skip(
      IS_CI,
      `BrillouinZone 3D tests timeout in CI due to WebGL software rendering`,
    )
  })

  test(`triggers on_file_load with data_url`, async ({ page }) => {
    await page.goto(`/test/brillouin-zone?data_url=/structures/mp-1.json`, {
      waitUntil: `networkidle`,
    })
    await page.waitForSelector(`${BZ_SELECTOR} canvas`, { timeout: 20000 })
    await expect(page.locator(`[data-testid="events"]`)).toContainText(`on_file_load`, {
      timeout: IBZ_LOAD_TIMEOUT,
    })
  })

  test(`triggers on_error on failed load`, async ({ page }) => {
    await page.goto(`/test/brillouin-zone?data_url=/non-existent.json`, {
      waitUntil: `networkidle`,
    })
    // Error handling may take time in CI
    await expect(page.locator(`[data-testid="events"]`)).toContainText(`on_error`, {
      timeout: 20000,
    })
  })
})

test.describe(`BrillouinZone IBZ (Irreducible Brillouin Zone) Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `BrillouinZone IBZ tests timeout in CI`)
    await page.goto(`/test/brillouin-zone`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, BZ_SELECTOR)
  })

  test(`IBZ toggle control works`, async ({ page }) => {
    const checkbox = page.locator(`#show-ibz`)
    const status = page.locator(`[data-testid="show-ibz"]`)

    await expect(checkbox).not.toBeChecked()
    await expect(status).toHaveText(`false`)

    await checkbox.check()
    await expect(status).toHaveText(`true`)
    await expect(checkbox).toBeChecked()

    await checkbox.uncheck()
    await expect(status).toHaveText(`false`)
  })

  test(`IBZ data loads when enabled`, async ({ page }) => {
    const checkbox = page.locator(`#show-ibz`)
    const data_status = page.locator(`[data-testid="ibz-data-status"]`)
    const vertices_count = page.locator(`[data-testid="ibz-vertices-count"]`)

    // Initially null
    await expect(data_status).toHaveText(`null`)
    await expect(vertices_count).toHaveText(`0`)

    // Enable IBZ
    await checkbox.check()

    // Wait for IBZ data to load (async operation via moyo-wasm)
    await expect(data_status).toHaveText(`loaded`, { timeout: IBZ_LOAD_TIMEOUT })

    // Should have vertices
    await expect(async () => {
      const count = await vertices_count.textContent()
      expect(parseInt(count || `0`)).toBeGreaterThan(0)
    }).toPass({ timeout: 5000 })
  })

  test(`IBZ color control updates`, async ({ page }) => {
    const color_input = page.locator(`#ibz-color`)
    const color_status = page.locator(`[data-testid="ibz-color"]`)

    await expect(color_status).toHaveText(`#ff8844`)

    await color_input.fill(`#00ff00`)
    await expect(color_status).toHaveText(`#00ff00`)
  })

  test(`IBZ opacity control updates`, async ({ page }) => {
    const opacity_input = page.locator(`#ibz-opacity`)
    const opacity_status = page.locator(`[data-testid="ibz-opacity"]`)

    await expect(opacity_status).toHaveText(`0.5`)

    await opacity_input.fill(`0.8`)
    await expect(opacity_status).toHaveText(`0.8`)
  })

  test(`IBZ renders differently from full BZ`, async ({ page }) => {
    const canvas = page.locator(`${BZ_SELECTOR} canvas`)
    const show_ibz = page.locator(`#show-ibz`)

    // Screenshot without IBZ
    const without_ibz = await canvas.screenshot()

    // Enable IBZ and wait for it to load
    await show_ibz.check()
    await expect(page.locator(`[data-testid="ibz-data-status"]`)).toHaveText(`loaded`, {
      timeout: IBZ_LOAD_TIMEOUT,
    })

    // Screenshot with IBZ - should be different (retry handles render timing)
    await expect(async () => {
      const with_ibz = await canvas.screenshot()
      expect(with_ibz.equals(without_ibz)).toBe(false)
    }).toPass({ timeout: 5000 })
  })

  test(`IBZ can be enabled via URL parameter`, async ({ page }) => {
    await page.goto(`/test/brillouin-zone?show_ibz=true`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, BZ_SELECTOR)

    const checkbox = page.locator(`#show-ibz`)
    const status = page.locator(`[data-testid="show-ibz"]`)

    await expect(checkbox).toBeChecked()
    await expect(status).toHaveText(`true`)

    // IBZ data should load automatically
    await expect(page.locator(`[data-testid="ibz-data-status"]`)).toHaveText(`loaded`, {
      timeout: IBZ_LOAD_TIMEOUT,
    })
  })

  test(`IBZ data cleared when disabled`, async ({ page }) => {
    const checkbox = page.locator(`#show-ibz`)
    const data_status = page.locator(`[data-testid="ibz-data-status"]`)

    // Enable IBZ and wait for data
    await checkbox.check()
    await expect(data_status).toHaveText(`loaded`, { timeout: IBZ_LOAD_TIMEOUT })

    // Disable IBZ
    await checkbox.uncheck()
    await expect(data_status).toHaveText(`null`)
  })
})
