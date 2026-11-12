// Smoke coverage for IsobaricTernaryPhaseDiagram on its demo route: the isothermal section
// canvas renders and tracks the viewport, the 2D/3D view toggle swaps canvases, the prism's
// cutting plane probes compositions on hover and drags the temperature, and a dropped
// entries file recomputes the diagram. Every test fails on a console/page error, navigation
// and first render included.
import { expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import {
  decode_canvas_png,
  drop_file,
  IS_CI,
  require_bbox,
  test_without_errors as test,
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

  test(`renders the section canvas and follows the viewport`, async ({ page }) => {
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
  })

  // The plane's pointerdown pauses OrbitControls, but the controls see the press first and
  // dispatch `start`; hover raycasts switched off on that start used to starve the drag of the
  // pointermoves it follows, so the plane never moved
  test(`3D prism view swaps in, its cutting plane drags the temperature, 2D swaps back`, async ({
    page,
  }) => {
    const toggle = page.locator(`${DIAGRAM} .view-toggle`)
    await expect(toggle.getByRole(`button`, { name: `2D section` })).toHaveAttribute(
      `aria-pressed`,
      `true`,
    )
    await toggle.getByRole(`button`, { name: `3D prism` }).click()
    await expect(page.locator(SECTION_CANVAS)).toHaveCount(0)
    const canvas = page.locator(`${DIAGRAM} .prism-canvas canvas`)
    await expect(canvas).toBeVisible({ timeout: LOAD_TIMEOUT })
    await expect(page.locator(`${DIAGRAM} .phase-event-list li`).first()).toBeVisible({
      timeout: LOAD_TIMEOUT,
    })
    // mid-sweep puts the plane through the orbit target, i.e. under the canvas center
    const kelvin = page.getByLabel(`Temperature in Kelvin`)
    const [t_min, t_max] = await kelvin.evaluate((input: HTMLInputElement) => [
      Number(input.min),
      Number(input.max),
    ])
    await kelvin.fill(String(Math.round((t_min + t_max) / 2)))
    await kelvin.press(`Enter`)
    // the event in effect is marked by its accent edge alone (0px wide with border-style none)
    const active_event = page.locator(`${DIAGRAM} .phase-event-list li.active`)
    await expect(active_event).toHaveCSS(`background-color`, `rgba(0, 0, 0, 0)`)
    await expect(active_event).not.toHaveCSS(`border-left-color`, `rgba(0, 0, 0, 0)`)
    await expect(active_event).not.toHaveCSS(`border-left-width`, `0px`)
    const t_before = Number(await kelvin.inputValue())
    const box = await require_bbox(canvas, `prism canvas`)
    const [center_x, center_y] = [box.x + box.width / 2, box.y + box.height / 2]
    // hovering the plane probes a composition, a click without dragging pins it (T unchanged)
    await page.mouse.move(center_x + 40, center_y + 15, { steps: 4 })
    await expect(page.locator(`.ternary-tooltip`)).toContainText(/Li\s*=\s*[\d.]+\s*%/)
    await page.mouse.click(center_x + 40, center_y + 15)
    expect(Number(await kelvin.inputValue())).toBe(t_before)
    await page.mouse.move(center_x, center_y)
    await page.mouse.down()
    await page.mouse.move(center_x, center_y - 80, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => Number(await kelvin.inputValue())).toBeGreaterThan(t_before)

    await toggle.getByRole(`button`, { name: `2D section` }).click()
    await expect(page.locator(SECTION_CANVAS)).toBeVisible()
  })

  // The section's pinned probe sits on a second canvas and the prism's labels are HTML over
  // the GPU canvas: a capture of the one main canvas lost both
  test(`PNG export includes the pinned probe and the prism labels`, async ({ page }) => {
    const toggle_pane = async () => {
      await page.locator(`${DIAGRAM} .diagram-title`).hover() // header buttons reveal on hover
      await page.locator(`${DIAGRAM} .pd-export-toggle`).click()
    }
    const export_png = async () => {
      await toggle_pane()
      const downloaded = page.waitForEvent(`download`)
      await page.getByRole(`button`, { name: `Download PNG`, exact: true }).click()
      const path = await (await downloaded).path()
      if (!path) throw new Error(`No PNG downloaded`)
      await toggle_pane()
      return readFile(path)
    }
    const unpinned = await export_png()
    const section = await require_bbox(page.locator(SECTION_CANVAS), `section canvas`)
    await page.mouse.click(section.x + section.width / 2, section.y + section.height * 0.6)
    expect((await export_png()).equals(unpinned)).toBe(false)

    await page
      .locator(`${DIAGRAM} .view-toggle`)
      .getByRole(`button`, { name: `3D prism` })
      .click()
    const canvas = page.locator(`${DIAGRAM} .prism-canvas canvas`)
    await expect(canvas).toBeVisible({ timeout: LOAD_TIMEOUT })
    const label = page.locator(`${DIAGRAM} .prism-canvas .axis-label`).first()
    await expect(label).toBeVisible({ timeout: LOAD_TIMEOUT })
    const boxes = [await require_bbox(canvas, `prism`), await require_bbox(label, `label`)]
    const png = await decode_canvas_png(page, await export_png())
    // glyph edges antialias into many shades where the bare scene behind a label is flat
    const shades = await png.evaluate(({ data, width }, [frame, text]) => {
      const scale = width / frame.width
      const [left, top] = [(text.x - frame.x) * scale, (text.y - frame.y) * scale]
      const colors = new Set<number>()
      for (let row = Math.floor(top); row < top + text.height * scale; row++)
        for (let col = Math.floor(left); col < left + text.width * scale; col++) {
          const idx = (row * width + col) * 4
          colors.add((data[idx] << 16) | (data[idx + 1] << 8) | data[idx + 2])
        }
      return colors.size
    }, boxes)
    expect(shades).toBeGreaterThan(4)
    await png.dispose()
  })

  test(`a dropped entries file recomputes the diagram`, async ({ page }) => {
    await drop_file(page, page.locator(DIAGRAM), TOY_ENTRIES, `toy.json`, `application/json`)
    // the demo titles the diagram by the dropped file's stem
    await expect(page.locator(`${DIAGRAM} .diagram-title`)).toHaveText(`toy · 7 entries`)
    await expect(page.locator(DIAGRAM)).toHaveAttribute(`aria-label`, /K-Na-Li ternary/)
    // the alert live region stays mounted; no error message may sit in it
    await expect(page.locator(`${DIAGRAM} [role="alert"] .status-message`)).toHaveCount(0)
    await expect(page.locator(SECTION_CANVAS)).toBeVisible()
    await expect(page.locator(`${DIAGRAM} .stable-count`)).toHaveText(/\d+ stable/, {
      timeout: LOAD_TIMEOUT,
    })
  })
})
