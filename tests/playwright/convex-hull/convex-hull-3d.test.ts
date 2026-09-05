import { expect, type Page } from '@playwright/test'
import { MAGNETIC_ORDERING_CATEGORY } from '$lib/convex-hull/types'
import { opacity_of, require_bbox, test_without_errors as test } from '../helpers'
import {
  dom_click,
  get_canvas_hash,
  goto_perf_page,
  open_controls_pane,
  open_info_pane,
} from './utils'

const ternary_diagram = (page: Page) => page.locator(`.convex-hull-3d`).first()

// Probe a grid around the canvas center until `hit` reports an entry under the pointer
const scan_for_entry = async (
  box: { x: number; y: number; width: number; height: number },
  step: number,
  hit: (x: number, y: number) => Promise<boolean>,
): Promise<{ x: number; y: number }> => {
  for (let x_frac = 0.1; x_frac <= 0.9; x_frac += step) {
    for (let y_frac = 0.1; y_frac <= 0.9; y_frac += step) {
      const [x, y] = [box.x + box.width * x_frac, box.y + box.height * y_frac]
      if (await hit(x, y)) return { x, y }
    }
  }
  throw new Error(
    `No matching entry found in canvas scan: step=${step}, box=${JSON.stringify(box)}`,
  )
}

test.describe(`ConvexHullCanvas dim=3 (Ternary)`, () => {
  test.beforeEach(async ({ page }) => {
    // Reproducible synthetic entries, including five structures for popup tests.
    await page.addInitScript(() => {
      let seed = 42
      Math.random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
    })
    await goto_perf_page(page, `3d`, `count=10&hull_dist=10`)
    await expect(ternary_diagram(page)).toBeVisible()
  })

  test(`control buttons and gizmo are hover-visible, initial data attributes are unset`, async ({
    page,
  }) => {
    const diagram = ternary_diagram(page)
    await expect(diagram).toHaveAttribute(`data-has-hover`, `false`)
    await expect(diagram).toHaveAttribute(`data-is-dragging`, `false`)
    expect(await diagram.locator(`.plot-tooltip`).count()).toBe(0)

    // The hull owns base and highlight canvases, plus the gizmo's separate canvas.
    const gizmo = diagram.locator(`.gizmo-wrapper`)
    await expect(gizmo.locator(`canvas`)).toBeAttached()
    await expect(diagram.locator(`:scope > canvas`)).toHaveCount(2)

    const overlays = [diagram.locator(`.convex-hull-toolbar`), gizmo]
    for (const overlay of overlays) {
      await expect(overlay).toBeAttached()
      await expect(overlay).toHaveClass(/hover-visible/)
      expect(await opacity_of(overlay)).toBe(0)
    }
    await diagram.hover()
    for (const overlay of overlays) await expect.poll(() => opacity_of(overlay)).toBe(1)
  })

  test(`enable_click_selection=false prevents entry selection`, async ({ page }) => {
    test.setTimeout(30000)
    const diagram = await goto_perf_page(page, `3d`, `count=100&click_selection=false`)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    const canvas = diagram.locator(`canvas`).first()
    const box = await require_bbox(canvas, `canvas`)
    const entry_pos = await scan_for_entry(box, 0.04, async (x, y) => {
      await page.mouse.move(x, y)
      return (await diagram.getAttribute(`data-has-hover`)) === `true`
    })
    await page.mouse.click(entry_pos.x, entry_pos.y)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
  })

  test(`magnetic category toggle re-renders canvas (hide + restore)`, async ({ page }) => {
    // Isolated perf page: synthetic magnetic data, single hull, fast + deterministic.
    // Guards the visible_entries dep in the 3D re-render effect — without it the canvas
    // silently freezes when category (or stable/unstable) visibility toggles change.
    test.setTimeout(45000)
    const diagram = await goto_perf_page(page, `3d`, `count=60&magnetic=true`)
    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    // Wait until the canvas bitmap is stable for 3 consecutive samples (late label/
    // font/resize passes drift pixels for a few seconds after first paint)
    const wait_for_stable_canvas = async (): Promise<string> => {
      let [hash, consecutive_equal] = [await get_canvas_hash(canvas), 0]
      await expect
        .poll(
          async () => {
            const next_hash = await get_canvas_hash(canvas)
            consecutive_equal = next_hash === hash ? consecutive_equal + 1 : 0
            hash = next_hash
            return consecutive_equal
          },
          { timeout: 20000, intervals: [500] },
        )
        .toBeGreaterThanOrEqual(3)
      return hash
    }
    await wait_for_stable_canvas()

    const controls = await open_controls_pane(page, diagram)
    await expect(controls.getByText(`Magnetic`, { exact: true })).toBeVisible()
    const toggles = controls.locator(`.category-filters .legend-item`)
    await expect(toggles).toHaveCount(Object.keys(MAGNETIC_ORDERING_CATEGORY.markers).length)
    const fm_toggle = toggles.filter({ hasText: /\bFM \(/ }).first()

    // Warm-up toggle cycle: the very first re-render can differ from the initial paint
    // (font/text settling), so flush it before capturing the comparison baseline
    await dom_click(fm_toggle)
    await dom_click(fm_toggle)
    await expect(fm_toggle).toHaveAttribute(`aria-pressed`, `true`)
    const hash_before = await wait_for_stable_canvas()

    // Hide FM -> canvas must redraw with fewer points. get_canvas_hash reads the canvas
    // bitmap directly, so the opened controls pane overlay cannot pollute the comparison.
    await dom_click(fm_toggle)
    await expect(fm_toggle).toHaveAttribute(`aria-pressed`, `false`)
    await expect.poll(() => get_canvas_hash(canvas), { timeout: 10000 }).not.toBe(hash_before)

    // Re-show FM -> canvas restored to the exact original pixels
    await dom_click(fm_toggle)
    await expect(fm_toggle).toHaveAttribute(`aria-pressed`, `true`)
    await expect.poll(() => get_canvas_hash(canvas), { timeout: 10000 }).toBe(hash_before)
  })

  test(`renders ternary diagram canvas and toggles hull faces`, async ({ page }) => {
    const diagram = ternary_diagram(page)
    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    await dom_click(diagram.locator(`.legend-controls-btn`))
    const pane = page.locator(`.draggable-pane.convex-hull-controls-pane`).last()
    const hull_toggle = pane.getByText(`Hull Faces`, { exact: false })
    await hull_toggle.click()
    await expect(canvas).toBeVisible()
  })

  test(`info pane stats show chemical system and counts`, async ({ page }) => {
    const diagram = ternary_diagram(page)
    const info = await open_info_pane(page, diagram)
    await expect(info).toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false })).toBeVisible()
    await expect(info.getByText(`Stability`)).toBeVisible()

    // Regression: verify unstable phases > 0 (catches possible e_above_hull placeholder bugs)
    const unstable_text = await info.getByTestId(`hull-visible-unstable`).textContent()
    const unstable_match = unstable_text?.match(/(?<count>\d+)/)
    expect(unstable_match ? Number(unstable_match[1]) : 0).toBeGreaterThan(0)
  })

  test(`controls pane exposes camera inputs, face color modes and the color scale selector`, async ({
    page,
  }) => {
    const diagram = ternary_diagram(page)
    const controls = await open_controls_pane(page, diagram)
    await expect(controls).toBeVisible({ timeout: 10_000 })

    for (const [label, value] of [
      [`Elev`, `45`],
      [`Azim`, `120`],
    ] as const) {
      await controls
        .getByText(label)
        .locator(`..`)
        .locator(`input[type="number"]`)
        .first()
        .fill(value)
    }
    await expect(diagram.locator(`canvas`).first()).toBeVisible()

    // All 4 mode buttons present with Uniform active by default, which shows the color picker
    const mode_buttons = controls.locator(`.face-color-mode-buttons`)
    await expect(mode_buttons).toBeVisible()
    for (const label of [`Uniform`, `Energy`, `Element`, `Index`]) {
      await expect(mode_buttons.getByText(label)).toBeVisible()
    }
    await expect(mode_buttons.getByText(`Uniform`)).toHaveClass(/active/)
    await expect(controls.locator(`input[type="color"]`).first()).toBeVisible()

    // Color scale label is clickable and its multiselect rendered
    const color_label = controls.getByText(`Color scale`, { exact: true })
    await expect(color_label).toBeVisible()
    expect(await color_label.evaluate((el) => getComputedStyle(el).cursor)).toBe(`pointer`)
    await expect(controls.locator(`.multiselect`)).toBeVisible()
  })

  test(`drag release does not trigger click callback`, async ({ page }) => {
    // Regression: dragging to rotate should not trigger on_point_click
    const diagram = ternary_diagram(page)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    const box = await require_bbox(diagram.locator(`canvas`).first(), `canvas`)

    // Find an entry by scanning - selection indicates we hit one
    const entry_pos = await scan_for_entry(box, 0.04, async (x, y) => {
      await page.mouse.click(x, y)
      await page.waitForTimeout(30)
      return (await diagram.getAttribute(`data-has-selection`)) === `true`
    })

    // Clear selection by clicking corner
    await page.mouse.click(box.x + 5, box.y + 5)
    await page.waitForTimeout(50)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)

    // Drag operation should not trigger selection
    await page.mouse.move(entry_pos.x, entry_pos.y)
    await page.mouse.down()
    await page.mouse.move(entry_pos.x + 30, entry_pos.y + 30, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(50)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
  })

  test(`tooltip shows compact fractional compositions`, async ({ page }) => {
    const diagram = ternary_diagram(page)
    const box = await require_bbox(diagram.locator(`canvas`).first(), `canvas`)
    const tooltip = diagram.locator(`.plot-tooltip`)
    await scan_for_entry(box, 0.04, async (x, y) => {
      await page.mouse.move(x, y)
      return (await tooltip.allTextContents()).join(``).includes(`Fractional:`)
    })
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`Fractional:`)
    await expect(tooltip).not.toContainText(/\d{3,}\.\d+/)
  })

  test(`t shortcut changes canvas view after drag`, async ({ page }) => {
    const canvas = ternary_diagram(page).locator(`canvas`).first()
    await expect(canvas).toBeVisible()
    const box = await require_bbox(canvas, `canvas`)

    await page.waitForTimeout(1000)
    const initial = (await canvas.screenshot()).toString(`base64`)

    // Drag to rotate
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 50, {
      steps: 8,
    })
    await page.mouse.up()
    await page.waitForTimeout(300)

    const dragged = (await canvas.screenshot()).toString(`base64`)
    expect(dragged).not.toBe(initial)

    // Press t for top-down — should change view again
    await canvas.focus()
    await canvas.press(`t`)
    await page.waitForTimeout(300)
    expect((await canvas.screenshot()).toString(`base64`)).not.toBe(dragged)
  })

  test(`Escape key closes structure popup`, async ({ page }) => {
    const diagram = ternary_diagram(page)
    const canvas = diagram.locator(`canvas`).first()
    const box = await require_bbox(canvas, `canvas`)
    const popup = diagram.locator(`.structure-popup`)

    // Hover first: only click a compound known to carry a structure in this fixture.
    const tooltip = diagram.locator(`.plot-tooltip`)
    const entry_pos = await scan_for_entry(box, 0.02, async (x, y) => {
      await page.mouse.move(x, y)
      return (await tooltip.allTextContents()).some((text) => /test-[0-4]\b/.test(text))
    })
    await page.mouse.click(entry_pos.x, entry_pos.y)

    await expect(popup).toBeVisible()
    await canvas.press(`Escape`)
    await expect(popup).toBeHidden()
  })

  test(`controls pane: scrollable content, pointer-events, drag isolation`, async ({
    page,
  }) => {
    const diagram = ternary_diagram(page)
    const pane = await open_controls_pane(page, diagram)
    await expect(pane).toBeVisible({ timeout: 10_000 })

    // Short viewports keep all controls reachable through scrolling.
    const content = pane.locator(`.pane-content`).first()
    const remaining_scroll = await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight
      return element.scrollHeight - element.clientHeight - element.scrollTop
    })
    expect(remaining_scroll).toBeLessThanOrEqual(2)
    await content.evaluate((element) => (element.scrollTop = 0))

    // Pane has pointer-events: auto (prevents event leaking to canvas)
    expect(await pane.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(`auto`)

    // Dragging the handle should NOT rotate the hull behind it
    const canvas = diagram.locator(`canvas`).first()
    const hash_before = await get_canvas_hash(canvas)
    const handle_box = await require_bbox(pane.locator(`.drag-handle`), `drag handle`)
    const [handle_x, handle_y] = [
      handle_box.x + handle_box.width / 2,
      handle_box.y + handle_box.height / 2,
    ]
    await page.mouse.move(handle_x, handle_y)
    await page.mouse.down()
    await page.mouse.move(handle_x + 50, handle_y + 30, { steps: 5 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    expect(await get_canvas_hash(canvas)).toBe(hash_before)
  })
})
