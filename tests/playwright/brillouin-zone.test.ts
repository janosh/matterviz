import { expect, type Page, test } from '@playwright/test'
import {
  require_bbox,
  wait_for_3d_canvas,
  expect_centered,
  expect_centered_card,
  expect_inline_spinner,
  webgl_on_ci_for_tagged,
  zoom_wheel,
} from './helpers'

webgl_on_ci_for_tagged()

const BZ_SELECTOR = `#test-brillouin-zone`
const status_locator = (page: Page, test_id: string) =>
  page.locator(`section`, { hasText: `Status` }).locator(`[data-testid="${test_id}"]`)
// IBZ computation requires moyo-wasm symmetry analysis which can be slow,
// especially in CI with software rendering. 10s accommodates most structures.
const IBZ_LOAD_TIMEOUT = 10000

test(`loading overlay stays centered and compact in wide and narrow viewers`, async ({
  page,
}) => {
  const load_gate = Promise.withResolvers<undefined>()
  await page.route(
    (url) => url.pathname === `/pending.poscar`,
    async (route) => {
      await load_gate.promise
      await route.fulfill({ body: `Si\n1\n3 0 0\n0 3 0\n0 0 3\nSi\n1\nDirect\n0 0 0\n` })
    },
  )
  await page.goto(`/test/brillouin-zone?source=/pending.poscar`, {
    waitUntil: `domcontentloaded`,
  })
  const viewer = page.locator(BZ_SELECTOR)
  const loading = viewer.locator(`.task-status.overlay`)
  await expect(loading.getByRole(`status`)).toHaveText(`Loading structure...`)
  try {
    for (const width of [800, 160]) {
      await viewer.evaluate((element, size) => {
        element.style.setProperty(`--bz-width`, `${size}px`)
        element.style.setProperty(`--bz-min-width`, `0`)
      }, width)
      const bounds = await require_bbox(viewer)
      const { status, label } = await expect_inline_spinner(loading)
      expect_centered(status, bounds)
      expect(status.width).toBeLessThan(bounds.width - 24)
      expect(label.x + label.width).toBeLessThan(bounds.x + bounds.width)
    }
  } finally {
    load_gate.resolve(undefined)
  }
  await expect(loading).toBeHidden()
})

test.describe(`BrillouinZone Component Tests`, { tag: `@webgl` }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/brillouin-zone`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, BZ_SELECTOR)
  })

  test(`bound inputs and the fullscreen checkbox update their status readouts`, async ({
    page,
  }) => {
    // inputs bound to the status readouts; bz-order's readout repeats in the Status section
    for (const [setting, initial, changed] of [
      [`bz-order`, `1`, `2`],
      [`ibz-color`, `#ff8844`, `#00ff00`],
      [`ibz-opacity`, `0.5`, `0.8`],
    ]) {
      const status = status_locator(page, setting)
      await expect(status, `${setting} initial`).toHaveText(initial)
      await page.locator(`#${setting}`).fill(changed)
      await expect(status, `${setting} changed`).toHaveText(changed)
    }

    // fullscreen last, since it covers the page's other controls
    const fullscreen_status = page.locator(`[data-testid="fullscreen-status"]`)
    const fullscreen_checkbox = page.locator(`[data-testid="fullscreen-checkbox"]`)
    await expect(fullscreen_status).toHaveText(`false`)
    await expect(fullscreen_checkbox).not.toBeChecked()

    await fullscreen_checkbox.click({ force: true })
    await expect(fullscreen_status).toHaveText(`true`)
    await expect(fullscreen_checkbox).toBeChecked()

    // the fullscreen viewer can cover the checkbox, so uncheck it programmatically
    await fullscreen_checkbox.evaluate((element: HTMLInputElement) => {
      element.checked = false
      element.dispatchEvent(new Event(`change`, { bubbles: true }))
    })
    await expect(fullscreen_status).toHaveText(`false`)
    await expect(fullscreen_checkbox).not.toBeChecked()
  })

  test(`camera projection toggles, orthographic zoom fits the zone and the clipped canvas rotates and zooms`, async ({
    page,
  }) => {
    await test.step(`projection toggle and orthographic fit`, async () => {
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
        const box = await require_bbox(canvas, `BZ canvas`)
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

    // projection is back to perspective; the restored 800px width is the page default
    await test.step(`clipped canvas rotation and zoom`, async () => {
      const viewer = page.locator(BZ_SELECTOR)
      const canvas = viewer.locator(`canvas`)
      await expect(viewer).toHaveCSS(`overflow`, `visible`)
      await expect(canvas.locator(`..`)).toHaveCSS(`overflow`, `hidden`)
      await expect(canvas).toHaveAttribute(`width`, /^[1-9]\d*$/)
      await expect(canvas).toHaveAttribute(`height`, /^[1-9]\d*$/)
      const box = await require_bbox(canvas, `BZ canvas`)

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
      await zoom_wheel(page, -200)

      // Poll until canvas screenshot differs from rotated (zoom applied)
      await expect(async () => {
        const zoomed = await canvas.screenshot()
        expect(zoomed.equals(rotated)).toBe(false)
      }).toPass({ timeout: 5000 })
    })
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
    // fields take the pane's control size (--pane-input-font-size, 0.85em), not the label's
    const px = (size: string | null) => Number(size?.replace(`px`, ``))
    expect(px(fields[0].font)).toBeCloseTo(0.85 * px(fields[0].row_font), 1)
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
})

// tests navigating to their own URL stay outside the describe above to skip its page load
test.describe(`BrillouinZone URL-driven loads`, { tag: `@webgl` }, () => {
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

  test(`triggers on_file_load with source`, async ({ page }) => {
    await page.goto(`/test/brillouin-zone?source=/structures/mp-1.json`, {
      waitUntil: `networkidle`,
    })
    await wait_for_3d_canvas(page, BZ_SELECTOR, 20_000)
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
    const viewer = page.locator(BZ_SELECTOR)
    // the card inside StatusMessage's alert live region (display: contents, so no box itself)
    const alert = viewer.locator(`[role="alert"] > .status-message`)
    for (const width of [800, 320]) {
      await viewer.evaluate((element, size) => {
        element.style.setProperty(`--bz-width`, `${size}px`)
      }, width)
      await expect_centered_card(alert, viewer)
    }
    await alert.getByRole(`button`, { name: `Dismiss message` }).click()
    await expect(alert).toHaveCount(0)
  })
})
