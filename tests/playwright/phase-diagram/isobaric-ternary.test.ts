// Smoke coverage for IsobaricTernaryPhaseDiagram on its demo route: the isothermal section
// canvas renders and tracks the viewport, the 2D/3D view toggle swaps canvases, and a dropped
// entries file recomputes the diagram.
import { expect, test } from '@playwright/test'
import {
  collect_console_errors,
  collect_page_errors,
  drop_file,
  IS_CI,
  require_bbox,
} from '../helpers'

const DIAGRAM = `.ternary-phase-diagram`
const SECTION_CANVAS = `${DIAGRAM} .ternary-section canvas[aria-label]`
// The demo's default system (hundreds of Alexandria entries) is fetched, then a worker sweeps
// its hull over temperature before the side panels fill in
const LOAD_TIMEOUT = IS_CI ? 60_000 : 20_000

// Li-Na-K toy system: three elements plus one binary per edge and one ternary compound
const phase = (composition: Record<string, number>, energy_per_atom: number) => {
  const atoms = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
  return { composition, energy_per_atom, energy: energy_per_atom * atoms }
}
const TOY_ENTRIES = JSON.stringify([
  phase({ Li: 1 }, 0),
  phase({ Na: 1 }, 0),
  phase({ K: 1 }, 0),
  phase({ Li: 1, Na: 1 }, -0.5),
  phase({ Li: 1, K: 1 }, -0.3),
  phase({ Na: 1, K: 1 }, -0.3),
  phase({ Li: 1, Na: 1, K: 1 }, -0.35),
])

test.describe(`IsobaricTernaryPhaseDiagram smoke`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram/ternary`, { waitUntil: `networkidle` })
    await expect(page.locator(SECTION_CANVAS)).toBeVisible({ timeout: LOAD_TIMEOUT })
  })

  test(`renders the section canvas without errors and follows the viewport`, async ({
    page,
  }) => {
    const console_errors = collect_console_errors(page)
    const page_errors = collect_page_errors(page)
    const canvas = page.locator(SECTION_CANVAS)
    const wide = await require_bbox(canvas, `ternary section canvas`)
    expect(wide.width).toBeGreaterThan(0)
    expect(wide.height).toBeGreaterThan(0)
    await expect(page.locator(`${DIAGRAM} .diagram-title`)).toContainText(
      /Li-Mn-O · \d+ entries/,
    )
    // the temperature sweep has finished once the event list has rows
    await expect(page.locator(`${DIAGRAM} .phase-event-list li`).first()).toBeVisible({
      timeout: LOAD_TIMEOUT,
    })

    await page.setViewportSize({ width: 600, height: 900 })
    await expect
      .poll(async () => (await require_bbox(canvas)).width, { timeout: LOAD_TIMEOUT })
      .toBeLessThan(wide.width)

    expect(page_errors).toEqual([])
    expect(console_errors).toEqual([])
  })

  test(`view toggle swaps the 2D section for the 3D prism and back`, async ({ page }) => {
    const toggle = page.locator(`${DIAGRAM} .view-toggle`)
    await expect(toggle.getByRole(`button`, { name: `2D section` })).toHaveAttribute(
      `aria-pressed`,
      `true`,
    )
    await toggle.getByRole(`button`, { name: `3D prism` }).click()
    await expect(page.locator(SECTION_CANVAS)).toHaveCount(0)
    await expect(page.locator(`${DIAGRAM} .prism-canvas canvas`)).toBeVisible({
      timeout: LOAD_TIMEOUT,
    })
    await toggle.getByRole(`button`, { name: `2D section` }).click()
    await expect(page.locator(SECTION_CANVAS)).toBeVisible()
  })

  test(`a dropped entries file recomputes the diagram`, async ({ page }) => {
    await drop_file(page, page.locator(DIAGRAM), TOY_ENTRIES, `toy.json`, `application/json`)
    // the demo titles the diagram by the dropped file's stem
    await expect(page.locator(`${DIAGRAM} .diagram-title`)).toHaveText(`toy · 7 entries`)
    await expect(page.locator(DIAGRAM)).toHaveAttribute(`aria-label`, /K-Na-Li ternary/)
    await expect(page.locator(`${DIAGRAM} [role="alert"]`)).toHaveCount(0)
    await expect(page.locator(SECTION_CANVAS)).toBeVisible()
    await expect(page.locator(`${DIAGRAM} .stable-count`)).toHaveText(/\d+ stable/, {
      timeout: LOAD_TIMEOUT,
    })
  })
})
