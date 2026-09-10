import { expect, type Page, test } from '@playwright/test'
import { IS_CI, wait_for_3d_canvas } from './helpers'

const BZ_SELECTOR = `#test-brillouin-zone`
const status_locator = (page: Page, test_id: string) =>
  page.locator(`section`, { hasText: `Status` }).locator(`[data-testid="${test_id}"]`)
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
    const viewer = page.locator(BZ_SELECTOR)
    const canvas = viewer.locator(`canvas`)
    const canvas_host = canvas.locator(`..`)
    await expect(canvas).toBeVisible()
    await expect(viewer).toHaveCSS(`overflow`, `visible`)
    await expect(canvas_host).toHaveCSS(`overflow`, `hidden`)
    expect(await canvas.getAttribute(`width`)).toBeTruthy()
    expect(await canvas.getAttribute(`height`)).toBeTruthy()
  })

  test(`BZ order control updates`, async ({ page }) => {
    const order_input = page.locator(`#bz-order`)
    await order_input.fill(`2`)
    await expect(status_locator(page, `bz-order`)).toHaveText(`2`)
    await order_input.fill(`1`)
    await expect(status_locator(page, `bz-order`)).toHaveText(`1`)
  })

  test(`camera projection toggles and orthographic zoom fits the zone`, async ({ page }) => {
    const projection = page.locator(`#camera-projection`)
    await expect(projection).toHaveValue(`perspective`)
    await projection.selectOption(`orthographic`)
    await expect(status_locator(page, `camera-projection`)).toHaveText(`orthographic`)

    // initial_zoom (50) is relative to the fit, not an absolute camera zoom: passing it
    // through verbatim left the zone a few times too small and deaf to the viewport size
    const read_zoom = () =>
      page.evaluate(() => (globalThis as { read_bz_zoom?: () => number }).read_bz_zoom?.())
    const set_bz_width = async (css_width: string) => {
      await page.locator(BZ_SELECTOR).evaluate((element, width) => {
        ;(element as HTMLElement).style.setProperty(`--bz-width`, width)
      }, css_width)
      await page.waitForTimeout(200)
    }

    // Zoom per shorter canvas edge, the quantity the fit holds constant. Measured from the
    // canvas rather than the CSS width so borders or sub-pixel layout rounding can't turn a
    // correct fit into a failure — and so the assertion says what invariant it is checking.
    const canvas = page.locator(`${BZ_SELECTOR} canvas`)
    const zoom_per_edge = async (): Promise<number> => {
      const box = await canvas.boundingBox()
      if (!box) throw new Error(`BZ canvas bounding box not found`)
      return ((await read_zoom()) ?? 0) / Math.min(box.width, box.height)
    }

    const wide_zoom = await read_zoom()
    expect(wide_zoom).toBeGreaterThan(50)
    const wide_zoom_per_edge = await zoom_per_edge()
    // the page fixes height at 500px, so narrowing past it drives the shorter edge
    await set_bz_width(`400px`)
    await expect.poll(read_zoom).toBeLessThan(wide_zoom ?? 0)
    expect(await zoom_per_edge()).toBeCloseTo(wide_zoom_per_edge, 5)
    await set_bz_width(`800px`)
    await expect.poll(read_zoom).toBeCloseTo(wide_zoom ?? 0, 5)

    await projection.selectOption(`perspective`)
  })

  test(`controls pane toggles`, async ({ page }) => {
    const checkbox = page.locator(`#controls-open`)
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect(status_locator(page, `controls-open`)).toHaveText(`true`)
    const selects = page.locator(
      `${BZ_SELECTOR} .draggable-pane .settings-section.grid > label > select`,
    )
    await expect(selects).toHaveCount(2)
    const fields = await selects.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node)
        const { right, height } = node.getBoundingClientRect()
        return {
          right,
          height,
          margin: style.margin,
          font: style.fontSize,
          row_font: node.parentElement && getComputedStyle(node.parentElement).fontSize,
        }
      }),
    )
    // Collapsible groups indent their labels, but control heights and right edges align.
    expect(fields[0]).toEqual(fields[1])
    expect(fields[0].margin).toBe(`0px`)
    expect(fields[0].font).toBe(fields[0].row_font)
    const pane = page.locator(`${BZ_SELECTOR} .bz-controls`)
    const reset_edges = pane.getByRole(`button`, { name: `Reset edges to defaults` })
    await expect(reset_edges).toBeVisible()
    await reset_edges.click()
    await expect(pane.locator(`input[type="range"][step="0.001"]`)).toHaveValue(`0.002`)
    await expect(reset_edges).toHaveCount(0)
    await checkbox.uncheck()
    await expect(status_locator(page, `controls-open`)).toHaveText(`false`)
    const info_toggle = page.locator(`#info-pane-open`)
    await expect(info_toggle).not.toBeChecked()
    await info_toggle.check()
    await expect(status_locator(page, `info-pane-open`)).toHaveText(`true`)
    await info_toggle.uncheck()
    for (const mode of [`never`, `always`, `hover`]) {
      await page.locator(`#show-controls`).selectOption(mode)
      await expect(status_locator(page, `show-controls`)).toHaveText(mode)
    }
    await checkbox.check()
    await expect(status_locator(page, `controls-open`)).toHaveText(`true`)
    await page.locator(BZ_SELECTOR).click()
    await page.keyboard.press(`Escape`)
    await expect(status_locator(page, `controls-open`)).toHaveText(`false`)
  })

  test(`exports the rendered zone as PNG and JSON`, async ({ page }) => {
    const viewer = page.locator(BZ_SELECTOR)
    await viewer.hover()
    await viewer.locator(`.bz-export-toggle`).click()
    const pane = viewer.locator(`.export-pane`)
    await pane.locator(`input[type="number"]`).fill(`96`)
    for (const format of [`PNG`, `JSON`]) {
      const downloaded = page.waitForEvent(`download`)
      await pane.getByRole(`button`, { name: `Download ${format}`, exact: true }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`))
      expect(await download.failure()).toBeNull()
    }
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
      const element = document.querySelector<HTMLInputElement>(
        `[data-testid="fullscreen-checkbox"]`,
      )
      if (element) {
        element.checked = false
        element.dispatchEvent(new Event(`change`, { bubbles: true }))
      }
    })
    await expect(status).toHaveText(`false`)
    await expect(checkbox).not.toBeChecked()
  })
})

test.describe(`BrillouinZone Event Handler Tests`, () => {
  test.beforeEach(() => {
    test.skip(IS_CI, `BrillouinZone 3D tests timeout in CI due to WebGL software rendering`)
  })

  test(`triggers on_file_load with source`, async ({ page }) => {
    await page.goto(`/test/brillouin-zone?source=/structures/mp-1.json`, {
      waitUntil: `networkidle`,
    })
    await page.waitForSelector(`${BZ_SELECTOR} canvas`, { timeout: 20000 })
    await expect(page.locator(`[data-testid="events"]`)).toContainText(`on_file_load`, {
      timeout: IBZ_LOAD_TIMEOUT,
    })
  })

  test(`triggers on_error on failed load`, async ({ page }) => {
    await page.goto(`/test/brillouin-zone?source=/non-existent.json`, {
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

  test(`IBZ loads, changes the rendering and clears when disabled`, async ({ page }) => {
    const checkbox = page.locator(`#show-ibz`)
    const status = page.locator(`[data-testid="show-ibz"]`)
    const data_status = page.locator(`[data-testid="ibz-data-status"]`)
    const vertices_count = page.locator(`[data-testid="ibz-vertices-count"]`)
    const canvas = page.locator(`${BZ_SELECTOR} canvas`)
    await expect(checkbox).not.toBeChecked()
    await expect(status).toHaveText(`false`)
    await expect(data_status).toHaveText(`null`)
    await expect(vertices_count).toHaveText(`0`)
    const without_ibz = await canvas.screenshot()
    await checkbox.check()
    await expect(status).toHaveText(`true`)
    await expect(checkbox).toBeChecked()
    await expect(data_status).toHaveText(`loaded`, { timeout: IBZ_LOAD_TIMEOUT })
    await expect
      .poll(async () => Number(await vertices_count.textContent()), { timeout: 5000 })
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await canvas.screenshot()).equals(without_ibz), { timeout: 5000 })
      .toBe(false)
    await checkbox.uncheck()
    await expect(status).toHaveText(`false`)
    await expect(data_status).toHaveText(`null`)
  })

  for (const [setting, initial, changed] of [
    [`color`, `#ff8844`, `#00ff00`],
    [`opacity`, `0.5`, `0.8`],
  ]) {
    test(`IBZ ${setting} control updates`, async ({ page }) => {
      const status = page.locator(`[data-testid="ibz-${setting}"]`)
      await expect(status).toHaveText(initial)
      await page.locator(`#ibz-${setting}`).fill(changed)
      await expect(status).toHaveText(changed)
    })
  }

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
})
