import { expect, type Locator, type Page, test } from '@playwright/test'
import { require_bbox, webgl_on_ci_for_tagged, zoom_wheel } from './helpers'

webgl_on_ci_for_tagged()

// Every gated 3D viewer, through its demo page: an idle viewer lets a plain wheel scroll the
// page (unprevented) and flashes the hint, while ⌘ + wheel reaches its zoom handler (prevented)
// and leaves the page put. Structure and the convex hull have their own specs.
const VIEWERS: [string, (page: Page) => Promise<Locator>][] = [
  [`/reciprocal/brillouin-zone`, gated_root],
  [`/reciprocal/fermi-surface`, gated_root],
  [`/plot/scatter-plot-3d`, gated_root],
  [`/convex-hull/chempot-diagram`, gated_root],
  [
    `/phase-diagram/ternary`,
    async (page) => {
      const root = page.locator(`.ternary-phase-diagram`).first()
      await root.getByRole(`button`, { name: `3D prism` }).click()
      await expect(root.locator(`.prism-canvas canvas`)).toBeVisible({ timeout: 30_000 })
      await page.mouse.move(0, 0) // the toggle click activated the viewer; leaving resets it
      return root
    },
  ],
]

// The first viewer root holding a wheel-zoom hint and a visible canvas
async function gated_root(page: Page): Promise<Locator> {
  const root = page
    .locator(`:has(> .wheel-zoom-hint)`)
    .filter({ has: page.locator(`canvas:visible`) })
    .first()
  await expect(root).toBeVisible({ timeout: 30_000 })
  return root
}

// Wheel over the root's canvas, plain or with ⌘ (zoom); returns how far the page scrolled and
// whether the wheel's default was prevented (read off the event after every handler ran)
async function wheel_over(page: Page, root: Locator, zoom = false) {
  const canvas = root.locator(`canvas:visible`).first()
  await canvas.scrollIntoViewIfNeeded()
  await page.evaluate(() => globalThis.scrollBy(0, -40)) // room to scroll down
  const box = await require_bbox(canvas, `canvas`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  const start_y = await page.evaluate(() => {
    const record = (event: WheelEvent) => Object.assign(globalThis, { last_wheel: event })
    globalThis.addEventListener(`wheel`, record, { capture: true, once: true })
    return globalThis.scrollY
  })
  await (zoom ? zoom_wheel(page, 200) : page.mouse.wheel(0, 200))
  // A plain wheel scrolls with an animation that a software-rendered (CI WebGL) viewer can
  // stall past any fixed wait, so wait for the page to move; a zoom must leave it put
  if (zoom) await page.waitForTimeout(300)
  else
    await page
      .waitForFunction((start) => globalThis.scrollY !== start, start_y, { timeout: 5000 })
      .catch(() => {}) // the assertion below reports a page that never scrolled
  await page.waitForTimeout(100) // let the scroll settle
  return page.evaluate((start) => {
    const { last_wheel } = globalThis as unknown as { last_wheel?: WheelEvent }
    return { scrolled: globalThis.scrollY - start, prevented: last_wheel?.defaultPrevented }
  }, start_y)
}

test.describe(`cooperative wheel zoom`, { tag: `@webgl` }, () => {
  // oxlint-disable-next-line vitest/prefer-each -- Playwright has no test.each.
  for (const [route, find_root] of VIEWERS) {
    test(`${route}: idle plain wheel scrolls the page, ⌘ + wheel zooms`, async ({ page }) => {
      await page.goto(route, { waitUntil: `domcontentloaded` })
      const root = await find_root(page)
      const plain = await wheel_over(page, root)
      expect(plain.prevented).toBe(false)
      expect(plain.scrolled).toBeGreaterThan(0)
      // every demo viewer runs the default `active` mode
      await expect(root.locator(`.wheel-zoom-hint`)).toContainText(
        /(?:⌘|Ctrl) \+ scroll to zoom · click to interact/,
      )

      const zoom = await wheel_over(page, root, true)
      expect(zoom).toEqual({ scrolled: 0, prevented: true })
    })
  }
})
