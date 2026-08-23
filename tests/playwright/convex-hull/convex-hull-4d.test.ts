import { expect, type Locator, type Page, test } from '@playwright/test'
import { IS_CI, require_bbox } from '../helpers'
import { ensure_pane_visible, get_canvas_hash, open_info_and_controls } from './utils'

const quaternary_diagram = (page: Page) =>
  page.locator(`.quaternary-grid .convex-hull-4d`).first()
// the hull canvas comes before the gizmo's own canvas
const hull_canvas = (diagram: Locator) => diagram.locator(`canvas`).first()

// The performance page has controlled synthetic data and none of the slow data loading
const goto_perf_page = async (page: Page, query: string) => {
  await page.goto(`/test/convex-hull-performance?dim=4d&${query}`, {
    waitUntil: `networkidle`,
  })
  return page.locator(`.convex-hull-4d`).first()
}

const open_pane = async (diagram: Locator, kind: `info` | `controls`) => {
  await diagram.locator(kind === `info` ? `.info-btn` : `.legend-controls-btn`).click()
  const pane = diagram.locator(`.draggable-pane.convex-hull-${kind}-pane`)
  await expect(pane).toBeVisible()
  return pane
}

// Count and mean alpha of the semi-transparent pixels (the hull faces)
const semi_transparent_pixels = (canvas: Locator) =>
  canvas.evaluate((el) => {
    const ctx = (el as HTMLCanvasElement).getContext(`2d`)
    if (!ctx) return { count: 0, avg_alpha: 0 }
    const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
    let [count, total] = [0, 0]
    for (let idx = 3; idx < data.length; idx += 4) {
      if (data[idx] > 0 && data[idx] < 255) {
        count++
        total += data[idx]
      }
    }
    return { count, avg_alpha: count > 0 ? total / count : 0 }
  })

test.describe(`ConvexHullCanvas dim=4 (Quaternary)`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `Quaternary hull tests timeout in CI`)
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    // the grid appears once data loads; a diagram canvas means it has also rendered
    await expect(page.locator(`.quaternary-grid`).first()).toBeVisible({ timeout: 50000 })
    await expect(hull_canvas(quaternary_diagram(page))).toBeVisible({
      timeout: 5000,
    })
  })

  test(`enable_click_selection=false prevents entry selection`, async ({ page }) => {
    const diagram = await goto_perf_page(page, `count=100&click_selection=false`)
    await expect(diagram).toBeVisible({ timeout: 15000 })
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    const canvas = hull_canvas(diagram)
    await expect(canvas).toBeVisible({ timeout: 10000 })
    const box = await canvas.boundingBox()
    if (box) {
      // Click grid of positions to ensure we hit an entry
      for (const x_off of [-0.3, -0.15, 0, 0.15, 0.3]) {
        for (const y_off of [-0.3, -0.15, 0, 0.15, 0.3]) {
          await canvas.click({
            position: { x: box.width * (0.5 + x_off), y: box.height * (0.5 + y_off) },
          })
        }
      }
      await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    }
  })

  test(`renders quaternary diagram, opens panes, initial data attributes, camera inputs`, async ({
    page,
  }) => {
    await expect(page.getByRole(`heading`, { name: `Convex Hulls` })).toBeVisible()
    const diagram = quaternary_diagram(page)
    await expect(diagram).toHaveAttribute(`data-has-hover`, `false`)
    await expect(diagram).toHaveAttribute(`data-is-dragging`, `false`)
    expect(await diagram.locator(`.plot-tooltip`).count()).toBe(0)

    await open_pane(diagram, `info`)
    const controls = await open_pane(diagram, `controls`)
    for (const [label, value] of [
      [`φ`, `0.2`],
      [`θ`, `0.4`],
    ] as const) {
      await controls
        .getByText(label)
        .locator(`..`)
        .locator(`input[type="number"]`)
        .first()
        .fill(value)
    }
    await expect(hull_canvas(diagram)).toBeVisible()
  })

  test(`energy color mode shows the e_above_hull colorbar and threshold keeps stats visible`, async ({
    page,
  }) => {
    const diagram = quaternary_diagram(page)
    const { info, controls } = await open_info_and_controls(diagram)

    await controls.getByText(`Energy`, { exact: true }).click()
    const color_bar = diagram.locator(`.colorbar`).first()
    await expect(color_bar).toBeVisible()
    await expect(color_bar.getByText(/Energy above hull/i)).toBeVisible()

    // Raise threshold to include more unstable points
    await controls.getByLabel(`Points threshold (eV/atom)`).fill(`0.5`)
    // Ensure info pane is in front and visible before asserting
    await ensure_pane_visible(info, diagram.locator(`.info-btn`))
    await expect(info.getByText(`Convex Hull Stats`, { exact: false })).toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false })).toBeVisible()
  })

  test(`computes hull distances on-the-fly when data is incomplete`, async ({ page }) => {
    const diagram = await goto_perf_page(page, `count=20`)
    await expect(diagram).toBeVisible()
    const info = await open_pane(diagram, `info`)

    // Verify unstable/stable counts are finite numbers
    const visible_count = async (testid: string) => {
      const text = await info.getByTestId(testid).textContent()
      const match = text?.match(/(?<visible>[0-9]+)\s*\/\s*(?:[0-9]+)/)
      expect(match).toBeTruthy()
      return Number(match?.[1])
    }
    expect(Number.isFinite(await visible_count(`hull-visible-unstable`))).toBe(true)
    // At least elemental refs
    expect(await visible_count(`hull-visible-stable`)).toBeGreaterThanOrEqual(4)
  })

  test(`drag state resets on mouseup outside and suppresses immediate clicks`, async ({
    page,
  }) => {
    const diagram = quaternary_diagram(page)
    const box = await require_bbox(hull_canvas(diagram), `canvas`)

    // Drag on canvas then release outside
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 50, cy + 50)
    await page.mouse.move(box.x + box.width + 100, box.y - 100)
    await page.mouse.up()

    // Verify subsequent click works (drag state reset)
    await open_pane(diagram, `info`)

    // Drag then immediately click should be suppressed
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 30, cy + 30)
    await page.mouse.up()
    await hull_canvas(diagram).click({
      position: { x: box.width / 2, y: box.height / 2 },
    })
    await expect(diagram.locator(`.structure-popup`)).toBeHidden({ timeout: 5000 })
  })

  test(`hull facets render and are toggleable`, async ({ page }) => {
    const diagram = quaternary_diagram(page)
    const canvas = hull_canvas(diagram)
    const initial = (await semi_transparent_pixels(canvas)).count
    expect(initial).toBeGreaterThan(100)

    const controls = await open_pane(diagram, `controls`)
    await controls
      .getByText(`Hull Faces`)
      .locator(`..`)
      .locator(`input[type="checkbox"]`)
      .click()
    // Longer timeout for CI - canvas updates can be slow
    await expect
      .poll(async () => (await semi_transparent_pixels(canvas)).count, { timeout: 5000 })
      .toBeLessThan(initial / 2)
  })

  test(`hull content is centered and within boundaries`, async ({ page }) => {
    const canvas = hull_canvas(quaternary_diagram(page))
    const { centered, within_bounds, pixel_count } = await canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext(`2d`)
      if (!ctx) return { centered: false, within_bounds: false, pixel_count: 0 }
      const { width, height } = el as HTMLCanvasElement
      const { data } = ctx.getImageData(0, 0, width, height)
      let [min_x, max_x, min_y, max_y, count] = [width, 0, height, 0, 0]
      for (let y_idx = 0; y_idx < height; y_idx++) {
        for (let x_idx = 0; x_idx < width; x_idx++) {
          if (data[(y_idx * width + x_idx) * 4 + 3] > 10) {
            min_x = Math.min(min_x, x_idx)
            max_x = Math.max(max_x, x_idx)
            min_y = Math.min(min_y, y_idx)
            max_y = Math.max(max_y, y_idx)
            count++
          }
        }
      }
      const [cx, cy] = [(min_x + max_x) / 2, (min_y + max_y) / 2]
      return {
        centered:
          Math.abs(cx - width / 2) / width < 0.3 && Math.abs(cy - height / 2) / height < 0.3,
        within_bounds: min_x >= 5 && max_x <= width - 5 && min_y >= 5 && max_y <= height - 5,
        pixel_count: count,
      }
    })
    expect(pixel_count).toBeGreaterThan(1000)
    expect(centered).toBe(true)
    expect(within_bounds).toBe(true)
  })

  test(`hull opacity slider works`, async ({ page }) => {
    const diagram = quaternary_diagram(page)
    const canvas = hull_canvas(diagram)
    const initial = (await semi_transparent_pixels(canvas)).avg_alpha
    const controls = await open_pane(diagram, `controls`)
    await controls.locator(`input[type="range"][aria-label*="opacity"]`).fill(`0.2`)
    // Longer timeout for CI - canvas updates can be slow
    await expect
      .poll(async () => (await semi_transparent_pixels(canvas)).avg_alpha, { timeout: 5000 })
      .toBeGreaterThan(initial)
  })

  test(`face color mode buttons toggle the color picker and re-render the canvas`, async ({
    page,
  }) => {
    const diagram = quaternary_diagram(page)
    const canvas = hull_canvas(diagram)
    await expect(canvas).toBeVisible()
    const initial_hash = await get_canvas_hash(canvas)
    const controls = await open_pane(diagram, `controls`)

    // All 4 mode buttons present, Element active by default (no color picker)
    const mode_buttons = controls.locator(`.face-color-mode-buttons`)
    await expect(mode_buttons).toBeVisible()
    for (const label of [`Uniform`, `Energy`, `Element`, `Index`]) {
      await expect(mode_buttons.getByText(label)).toBeVisible()
    }
    await expect(mode_buttons.getByText(`Element`)).toHaveClass(/active/)
    const color_picker = controls.locator(`input[type="color"]`).first()
    await expect(color_picker).toBeHidden()

    await mode_buttons.getByText(`Uniform`).click()
    await expect(color_picker).toBeVisible()
    await mode_buttons.getByText(`Index`).click()
    await expect(color_picker).toBeHidden()
    // facet_index mode draws different face colors
    await expect.poll(() => get_canvas_hash(canvas), { timeout: 5000 }).not.toBe(initial_hash)
  })
})

// Standalone: the performance page avoids the slow quaternary-grid data loading above
test.describe(`ConvexHullCanvas dim=4 drag rotation`, () => {
  for (const [direction, axis, [dx, dy], expect_increase] of [
    [`right`, `y`, [80, 0], true],
    [`down`, `x`, [0, 80], false],
  ] as const) {
    test(`drag-${direction} ${expect_increase ? `increases` : `decreases`} rotation_${axis} (natural direction)`, async ({
      page,
    }) => {
      const diagram = await goto_perf_page(page, `count=20`)
      // the hull stacks a second, non-interactive canvas on top for the pulse rings
      const canvas = diagram.locator(`canvas:not(.pulse-overlay)`)
      await expect(canvas).toBeVisible({ timeout: 15000 })

      const rot_before = Number(await diagram.getAttribute(`data-rotation-${axis}`))
      expect(Number.isFinite(rot_before)).toBe(true)
      const box = await require_bbox(canvas, `canvas`)
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx + dx, cy + dy, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(50)

      const rot_after = Number(await diagram.getAttribute(`data-rotation-${axis}`))
      if (expect_increase) expect(rot_after).toBeGreaterThan(rot_before)
      else expect(rot_after).toBeLessThan(rot_before)
    })
  }
})
