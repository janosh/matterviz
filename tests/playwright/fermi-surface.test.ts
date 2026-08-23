// Smoke coverage for the FermiSurface viewer on its demo route: the WebGPU canvas renders and
// tracks the viewport, a control toggles, and a dropped BXSF grid replaces the demo file.
// Every test fails on a console/page error, navigation and first render included.
import { expect, type Page } from '@playwright/test'
import {
  drop_file,
  IS_CI,
  require_bbox,
  test_without_errors as test,
  wait_for_3d_canvas,
} from './helpers'

const VIEWER = `.fermi-surface`
// The demo's default IFermi mesh is fetched, parsed and uploaded to the GPU before the first
// frame; software WebGPU on CI takes a while to do that.
const LOAD_TIMEOUT = IS_CI ? 30_000 : 10_000

// 3x3x3 single-band grid whose centre point (8 eV) is the only one above the 7 eV Fermi
// level, so marching cubes yields one small closed surface
const TINY_BXSF = [
  `# Fermi energy: 7 eV`,
  `BEGIN_BLOCK_BANDGRID_3D`,
  `band_energies`,
  `BEGIN_BANDGRID_3D`,
  `1`,
  `3 3 3`,
  `0.0 0.0 0.0`,
  `1.0 0.0 0.0`,
  `0.0 1.0 0.0`,
  `0.0 0.0 1.0`,
  `BAND: 1`,
  `5 6 5 6 7 6 5 6 5`,
  `6 7 6 7 8 7 6 7 6`,
  `5 6 5 6 7 6 5 6 5`,
  `END_BANDGRID_3D`,
  `END_BLOCK_BANDGRID_3D`,
].join(`\n`)

// Force hover-only chrome visible so the gear toggle can be clicked without a pointer dance
const open_controls = async (page: Page) => {
  await page.addStyleTag({
    content: `.hover-visible { opacity: 1 !important; pointer-events: auto !important; }`,
  })
  await page.locator(`${VIEWER} button.controls-toggle`).click()
  const pane = page.locator(`${VIEWER} .fermi-controls`)
  await expect(pane).toBeVisible()
  return pane
}

test.describe(`FermiSurface smoke`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/reciprocal/fermi-surface`, { waitUntil: `networkidle` })
    await wait_for_3d_canvas(page, VIEWER, LOAD_TIMEOUT)
  })

  test(`renders the surface canvas and follows the viewport`, async ({ page }) => {
    const canvas = page.locator(`${VIEWER} canvas`)
    const wide = await require_bbox(canvas, `Fermi surface canvas`)
    expect(wide.width).toBeGreaterThan(0)
    expect(wide.height).toBeGreaterThan(0)
    // the demo marks the default file active in its picker once it has loaded
    await expect(page.locator(`.file-picker .file-item.active`)).toHaveCount(1)

    await page.setViewportSize({ width: 600, height: 800 })
    await expect
      .poll(async () => (await require_bbox(canvas)).width, { timeout: LOAD_TIMEOUT })
      .toBeLessThan(wide.width)
  })

  test(`Show BZ toggle hides the BZ opacity slider`, async ({ page }) => {
    const pane = await open_controls(page)
    const show_bz = pane.getByLabel(`Show BZ`)
    const bz_opacity = pane.getByLabel(`BZ opacity`)
    await expect(show_bz).toBeChecked()
    await expect(bz_opacity).toBeVisible()
    await show_bz.uncheck()
    await expect(bz_opacity).toBeHidden()
    await show_bz.check()
    await expect(bz_opacity).toBeVisible()
  })

  test(`a dropped BXSF grid replaces the demo file`, async ({ page }) => {
    const viewer = page.locator(VIEWER)
    await drop_file(page, viewer, TINY_BXSF, `tiny.bxsf`)
    await expect(viewer.locator(`.filename`)).toHaveText(`tiny.bxsf`, {
      timeout: LOAD_TIMEOUT,
    })
    await expect(viewer.locator(`.spinner`)).toHaveCount(0, { timeout: LOAD_TIMEOUT })
    await expect(viewer.locator(`[role="alert"], .status-message.error`)).toHaveCount(0)
    await wait_for_3d_canvas(page, VIEWER, LOAD_TIMEOUT)
  })
})
