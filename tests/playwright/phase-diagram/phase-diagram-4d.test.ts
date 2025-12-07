import { expect, test } from '@playwright/test'
import { ensure_pane_visible, open_info_and_controls } from './utils'

test.describe(`PhaseDiagram4D (Quaternary)`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
  })

  test(`renders quaternary diagram canvas and opens panes`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Phase Diagrams` })).toBeVisible()
    const quaternary_grid = page.locator(`.quaternary-grid`)
    await expect(quaternary_grid).toBeVisible()

    const diagram = quaternary_grid.locator(`.phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Open info pane
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    // Scoped pane inside this diagram
    const info_pane = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info_pane).toBeVisible()

    // Open legend controls pane
    const legend_btn = diagram.locator(`.legend-controls-btn`)
    await legend_btn.click()
    const controls_pane = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls_pane).toBeVisible()
  })

  test(`camera rotation controls accept updates`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible()

    const phi = controls.getByText(`φ`).locator(`..`).locator(`input[type="number"]`)
      .first()
    const theta = controls.getByText(`θ`).locator(`..`).locator(`input[type="number"]`)
      .first()
    await phi.fill(`0.2`)
    await theta.fill(`0.4`)
    await expect(diagram.locator(`canvas`)).toBeVisible()
  })

  test(`color mode + threshold impacts visible entries`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    const { info, controls } = await open_info_and_controls(diagram)

    // Switch to energy mode
    await controls.getByText(`Energy`, { exact: true }).click()
    // Raise threshold to include more unstable points
    const number_input = controls.locator(`input.threshold-input`).first()
    await number_input.fill(`0.5`)
    // Ensure info pane is in front and visible before asserting
    await ensure_pane_visible(info, diagram.locator(`.info-btn`))
    await expect(info.getByText(`Phase Diagram Stats`, { exact: false }))
      .toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false }))
      .toBeVisible()
  })

  test(`computes hull distances on-the-fly when data is incomplete`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    // Craft a minimal quaternary dataset with missing e_above_hull
    // Also includes edge cases: invalid energy values that should be filtered out
    const data = [
      // Elemental reference corners (always include)
      { composition: { A: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { B: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { C: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { D: 1 }, energy: 0, e_above_hull: 0 },
      // Elemental polymorph without e_above_hull (will be computed on-the-fly)
      { composition: { A: 1 }, energy: -0.1 },
      // Non-elemental stable without e_above_hull (marked stable)
      { composition: { A: 1, B: 1, C: 1, D: 1 }, energy: -4, is_stable: true },
      // Non-elemental without e_above_hull (will be computed on-the-fly)
      { composition: { A: 1, B: 1, C: 1, D: 1 }, energy: -3 },
      // Edge cases that should be filtered out (non-finite energies)
      { composition: { A: 1, B: 1 }, energy: NaN }, // NaN energy
      { composition: { A: 1, C: 1 }, energy: Infinity }, // Infinity energy
      { composition: { B: 1, D: 1 } }, // Missing energy entirely
    ]

    // Build DataTransfer with a JSON file and dispatch drop on the diagram
    const data_transfer = await page.evaluateHandle((json) => {
      const dt = new DataTransfer()
      const file = new File([JSON.stringify(json)], `pd.json`, {
        type: `application/json`,
      })
      dt.items.add(file)
      return dt
    }, data)

    // Dispatch dragover first for broader browser engine parity (esp. WebKit)
    await diagram.dispatchEvent(`dragover`, { dataTransfer: data_transfer })
    await diagram.dispatchEvent(`drop`, { dataTransfer: data_transfer })

    // Open info pane to read visible counts
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    const info = diagram.locator(`.draggable-pane.phase-diagram-info-pane`)
    await expect(info).toBeVisible()

    // With on-the-fly computation enabled, entries without precomputed e_above_hull
    // will have it computed automatically. The quaternary entry with energy=-3
    // will be evaluated against the hull and may be stable or slightly unstable
    // Invalid entries (NaN, Infinity, missing energy) should be filtered out gracefully
    const unstable_text = await info.getByTestId(`pd-visible-unstable`).textContent()
    expect(unstable_text).toBeTruthy()
    const unstable_match = unstable_text?.match(/([0-9]+)\s*\/\s*([0-9]+)/)
    expect(unstable_match).toBeTruthy()
    const u_visible = Number(unstable_match?.[1])
    const u_total = Number(unstable_match?.[2])
    expect(Number.isFinite(u_visible) && Number.isFinite(u_total)).toBe(true)

    // Expect stable entries to include at minimum the 4 elemental refs + 1 marked stable
    // The 3 invalid entries (NaN, Infinity, missing) should be filtered out
    const stable_text = await info.getByTestId(`pd-visible-stable`).textContent()
    const stable_match = stable_text?.match(/([0-9]+)\s*\/\s*([0-9]+)/)
    expect(stable_match).toBeTruthy()
    const s_visible = Number(stable_match?.[1])
    const s_total = Number(stable_match?.[2])
    expect(s_visible).toBeGreaterThanOrEqual(5)
    expect(s_total).toBeGreaterThanOrEqual(5)
  })

  test(`displays energy above hull color bar in energy mode`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    await expect(diagram).toBeVisible()

    // Open legend controls and switch to energy mode
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await expect(controls).toBeVisible()

    // Switch to energy color mode
    await controls.getByText(`Energy`, { exact: true }).click()

    // Verify color bar is visible
    const color_bar = diagram.locator(`.colorbar`).first()
    await expect(color_bar).toBeVisible()

    // Verify color bar title
    const color_bar_title = color_bar.getByText(/Energy above hull/i)
    await expect(color_bar_title).toBeVisible()
  })

  test(`resets drag state on mouseup outside canvas`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas_box = await diagram.locator(`canvas`).boundingBox()
    if (!canvas_box) return

    // Drag on canvas then release outside
    await page.mouse.move(
      canvas_box.x + canvas_box.width / 2,
      canvas_box.y + canvas_box.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      canvas_box.x + canvas_box.width / 2 + 50,
      canvas_box.y + canvas_box.height / 2 + 50,
    )
    await page.mouse.move(canvas_box.x + canvas_box.width + 100, canvas_box.y - 100)
    await page.mouse.up()

    // Verify subsequent click works (would be blocked if drag_started wasn't reset)
    await diagram.locator(`.info-btn`).click()
    await expect(diagram.locator(`.draggable-pane.phase-diagram-info-pane`)).toBeVisible()
  })

  test(`suppresses clicks immediately after drag to prevent accidental selections`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas = diagram.locator(`canvas`)
    const box = await canvas.boundingBox()
    if (!box) return

    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

    // Drag then immediately click
    await page.mouse.move(center.x, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x + 30, center.y + 30)
    await page.mouse.up()
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })

    // Click after drag should be suppressed (no structure popup)
    await expect(diagram.locator(`.structure-popup`)).toBeHidden({ timeout: 1000 })
  })

  test(`hull facets render and are toggleable`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas = diagram.locator(`canvas`)

    // Verify hull faces are visible by default (semi-transparent pixels)
    const initial_semi_transparent = await canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext(`2d`)
      if (!ctx) return 0
      const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
      let count = 0
      for (let idx = 3; idx < data.length; idx += 4) {
        if (data[idx] > 0 && data[idx] < 255) count++
      }
      return count
    })

    expect(initial_semi_transparent).toBeGreaterThan(100)

    // Toggle hull faces off via checkbox (find by "Hull Faces" section)
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`)
    await controls.getByText(`Hull Faces`).locator(`..`).locator(`input[type="checkbox"]`)
      .click()

    // Wait for semi-transparent pixels to decrease after toggle
    await expect(async () => {
      const after_toggle_semi_transparent = await canvas.evaluate((el) => {
        const ctx = (el as HTMLCanvasElement).getContext(`2d`)
        if (!ctx) return 0
        const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
        let count = 0
        for (let idx = 3; idx < data.length; idx += 4) {
          if (data[idx] > 0 && data[idx] < 255) count++
        }
        return count
      })
      expect(after_toggle_semi_transparent).toBeLessThan(initial_semi_transparent / 2)
    }).toPass({ timeout: 1000 })
  })

  test(`hull content stays centered`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas = diagram.locator(`canvas`)

    // Verify content is centered by checking bounding box of visible pixels
    const { centered, pixel_count } = await canvas.evaluate((el) => {
      const canvas_el = el as HTMLCanvasElement
      const ctx = canvas_el.getContext(`2d`)
      if (!ctx) return { centered: false, pixel_count: 0 }

      const { width, height } = canvas_el
      const { data } = ctx.getImageData(0, 0, width, height)

      let min_x = width
      let max_x = 0
      let min_y = height
      let max_y = 0
      let count = 0

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

      const center_x = (min_x + max_x) / 2
      const center_y = (min_y + max_y) / 2
      const x_diff = Math.abs(center_x - width / 2) / width
      const y_diff = Math.abs(center_y - height / 2) / height

      return {
        centered: x_diff < 0.3 && y_diff < 0.3,
        pixel_count: count,
      }
    })

    expect(pixel_count).toBeGreaterThan(1000)
    expect(centered).toBe(true)
  })

  test(`hull faces stay within boundaries`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas = diagram.locator(`canvas`)

    // Verify content stays mostly within canvas (not escaping tetrahedron)
    const { escapes_significantly } = await canvas.evaluate((el) => {
      const canvas_el = el as HTMLCanvasElement
      const ctx = canvas_el.getContext(`2d`)
      if (!ctx) return { escapes_significantly: true }

      const { width, height } = canvas_el
      const { data } = ctx.getImageData(0, 0, width, height)
      const strict_margin = 5 // Very tight margin

      let min_x = width
      let max_x = 0
      let min_y = height
      let max_y = 0

      for (let y_idx = 0; y_idx < height; y_idx++) {
        for (let x_idx = 0; x_idx < width; x_idx++) {
          if (data[(y_idx * width + x_idx) * 4 + 3] > 20) {
            min_x = Math.min(min_x, x_idx)
            max_x = Math.max(max_x, x_idx)
            min_y = Math.min(min_y, y_idx)
            max_y = Math.max(max_y, y_idx)
          }
        }
      }

      // Check if content significantly escapes canvas bounds
      const escapes = min_x < strict_margin || max_x > width - strict_margin ||
        min_y < strict_margin || max_y > height - strict_margin

      return { escapes_significantly: escapes }
    })

    // Main assertion: hull should not escape canvas bounds
    expect(escapes_significantly).toBe(false)
  })

  test(`hull opacity slider works`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .phase-diagram-4d`).first()
    const canvas = diagram.locator(`canvas`)

    const get_avg_alpha = () =>
      canvas.evaluate((el) => {
        const ctx = (el as HTMLCanvasElement).getContext(`2d`)
        if (!ctx) return 0
        const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
        let total = 0
        let count = 0
        for (let idx = 3; idx < data.length; idx += 4) {
          if (data[idx] > 0 && data[idx] < 255) {
            total += data[idx]
            count++
          }
        }
        return count > 0 ? total / count : 0
      })

    const initial_alpha = await get_avg_alpha()

    // Increase opacity via slider
    await diagram.locator(`.legend-controls-btn`).click()
    const slider = diagram.locator(`.draggable-pane.phase-diagram-controls-pane`).locator(
      `input[type="range"][aria-label*="opacity"]`,
    )
    await slider.fill(`0.2`)

    // Wait for alpha to actually increase
    await expect(async () => {
      const updated_alpha = await get_avg_alpha()
      expect(updated_alpha).toBeGreaterThan(initial_alpha)
    }).toPass({ timeout: 1000 })
  })
})
