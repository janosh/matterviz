import { expect, test } from '@playwright/test'
import { ensure_pane_visible, open_info_and_controls } from './utils'

test.describe(`ConvexHull4D (Quaternary)`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/convex-hull`, { waitUntil: `networkidle` })
    // Wait for data to fully load - check for canvas inside diagram which only renders after data loads
    const quaternary_grid = page.locator(`.quaternary-grid`).first()
    await expect(quaternary_grid).toBeVisible({ timeout: 50000 })
    // Wait for at least one diagram with a canvas to be rendered (indicates data is loaded and rendered)
    const diagram_canvas = quaternary_grid.locator(`.convex-hull-4d canvas`).first()
    await expect(diagram_canvas).toBeVisible({ timeout: 5000 })
  })

  test(`enable_click_selection=false prevents entry selection`, async ({ page }) => {
    await page.goto(
      `/test/convex-hull-performance?dim=4d&count=100&click_selection=false`,
      { waitUntil: `networkidle` },
    )
    const diagram = page.locator(`.convex-hull-4d`)
    await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    const canvas = diagram.locator(`canvas`)
    const box = await canvas.boundingBox()
    if (box) {
      // Click grid of positions to ensure we hit an entry
      const offsets = [-0.3, -0.15, 0, 0.15, 0.3]
      const positions = offsets.flatMap((x) =>
        offsets.map((y) => ({ x: box.width * (0.5 + x), y: box.height * (0.5 + y) }))
      )
      await positions.reduce(
        (chain, pos) => chain.then(() => canvas.click({ position: pos })),
        Promise.resolve(),
      )
      await expect(diagram).toHaveAttribute(`data-has-selection`, `false`)
    }
  })

  test(`renders quaternary diagram canvas and opens panes`, async ({ page }) => {
    await expect(page.getByRole(`heading`, { name: `Convex Hulls` })).toBeVisible()
    const quaternary_grid = page.locator(`.quaternary-grid`)
    await expect(quaternary_grid).toBeVisible()

    const diagram = quaternary_grid.locator(`.convex-hull-4d`).first()
    await expect(diagram).toBeVisible()

    const canvas = diagram.locator(`canvas`)
    await expect(canvas).toBeVisible()

    // Open info pane
    const info_btn = diagram.locator(`.info-btn`)
    await info_btn.click()
    // Scoped pane inside this diagram
    const info_pane = diagram.locator(`.draggable-pane.convex-hull-info-pane`)
    await expect(info_pane).toBeVisible()

    // Open legend controls pane
    const legend_btn = diagram.locator(`.legend-controls-btn`)
    await legend_btn.click()
    const controls_pane = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
    await expect(controls_pane).toBeVisible()
  })

  test(`camera rotation controls accept updates`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .convex-hull-4d`).first()
    await expect(diagram).toBeVisible()

    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
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
    const diagram = page.locator(`.quaternary-grid .convex-hull-4d`).first()
    await expect(diagram).toBeVisible()

    const { info, controls } = await open_info_and_controls(diagram)

    // Switch to energy mode
    await controls.getByText(`Energy`, { exact: true }).click()
    // Raise threshold to include more unstable points
    const number_input = controls.locator(`input.threshold-input`).first()
    await number_input.fill(`0.5`)
    // Ensure info pane is in front and visible before asserting
    await ensure_pane_visible(info, diagram.locator(`.info-btn`))
    await expect(info.getByText(`Convex Hull Stats`, { exact: false }))
      .toBeVisible()
    await expect(info.getByText(`Total entries in`, { exact: false }))
      .toBeVisible()
  })

  test(`computes hull distances on-the-fly when data is incomplete`, async ({ page }) => {
    // Use the performance test page which has controlled data input
    await page.goto(`/test/convex-hull-performance?dim=4d&count=20`, {
      waitUntil: `networkidle`,
    })
    const diagram = page.locator(`.convex-hull-4d`)
    await expect(diagram).toBeVisible()

    // Open info pane and verify stats are displayed
    await diagram.locator(`.info-btn`).click()
    const info = diagram.locator(`.draggable-pane.convex-hull-info-pane`)
    await expect(info).toBeVisible()

    // Verify unstable/stable counts are finite numbers
    const unstable_text = await info.getByTestId(`hull-visible-unstable`).textContent()
    const unstable_match = unstable_text?.match(/([0-9]+)\s*\/\s*([0-9]+)/)
    expect(unstable_match).toBeTruthy()
    expect(Number.isFinite(Number(unstable_match?.[1]))).toBe(true)

    const stable_text = await info.getByTestId(`hull-visible-stable`).textContent()
    const stable_match = stable_text?.match(/([0-9]+)\s*\/\s*([0-9]+)/)
    expect(stable_match).toBeTruthy()
    expect(Number(stable_match?.[1])).toBeGreaterThanOrEqual(4) // At least elemental refs
  })

  test(`displays energy above hull color bar in energy mode`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .convex-hull-4d`).first()
    await expect(diagram).toBeVisible()

    // Open legend controls and switch to energy mode
    await diagram.locator(`.legend-controls-btn`).click()
    const controls = diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
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

  test(`drag state resets on mouseup outside and suppresses immediate clicks`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .convex-hull-4d`).first()
    const box = await diagram.locator(`canvas`).boundingBox()
    if (!box) return

    // Drag on canvas then release outside
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 50, cy + 50)
    await page.mouse.move(box.x + box.width + 100, box.y - 100)
    await page.mouse.up()

    // Verify subsequent click works (drag state reset)
    await diagram.locator(`.info-btn`).click()
    await expect(diagram.locator(`.draggable-pane.convex-hull-info-pane`)).toBeVisible()

    // Drag then immediately click should be suppressed
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + 30, cy + 30)
    await page.mouse.up()
    await diagram.locator(`canvas`).click({
      position: { x: box.width / 2, y: box.height / 2 },
    })
    await expect(diagram.locator(`.structure-popup`)).toBeHidden({ timeout: 5000 })
  })

  test(`hull facets render and are toggleable`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .convex-hull-4d`).first()
    const canvas = diagram.locator(`canvas`)
    const count_semi_transparent = () =>
      canvas.evaluate((el) => {
        const ctx = (el as HTMLCanvasElement).getContext(`2d`)
        if (!ctx) return 0
        const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
        let count = 0
        for (
          let idx = 3;
          idx < data.length;
          idx += 4
        ) if (data[idx] > 0 && data[idx] < 255) count++
        return count
      })
    const initial = await count_semi_transparent()
    expect(initial).toBeGreaterThan(100)

    await diagram.locator(`.legend-controls-btn`).click()
    await diagram.locator(`.draggable-pane.convex-hull-controls-pane`)
      .getByText(`Hull Faces`).locator(`..`).locator(`input[type="checkbox"]`).click()
    // Longer timeout for CI - canvas updates can be slow
    await expect(async () =>
      expect(await count_semi_transparent()).toBeLessThan(initial / 2)
    ).toPass({ timeout: 5000 })
  })

  test(`hull content is centered and within boundaries`, async ({ page }) => {
    const canvas = page.locator(`.quaternary-grid .convex-hull-4d canvas`).first()
    const { centered, within_bounds, pixel_count } = await canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext(`2d`)
      if (!ctx) return { centered: false, within_bounds: false, pixel_count: 0 }
      const { width, height } = el as HTMLCanvasElement
      const { data } = ctx.getImageData(0, 0, width, height)
      let min_x = width, max_x = 0, min_y = height, max_y = 0, count = 0
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
      const cx = (min_x + max_x) / 2, cy = (min_y + max_y) / 2
      return {
        centered: Math.abs(cx - width / 2) / width < 0.3 &&
          Math.abs(cy - height / 2) / height < 0.3,
        within_bounds: min_x >= 5 && max_x <= width - 5 && min_y >= 5 &&
          max_y <= height - 5,
        pixel_count: count,
      }
    })
    expect(pixel_count).toBeGreaterThan(1000)
    expect(centered).toBe(true)
    expect(within_bounds).toBe(true)
  })

  test(`hull opacity slider works`, async ({ page }) => {
    const diagram = page.locator(`.quaternary-grid .convex-hull-4d`).first()
    const canvas = diagram.locator(`canvas`)
    const get_avg_alpha = () =>
      canvas.evaluate((el) => {
        const ctx = (el as HTMLCanvasElement).getContext(`2d`)
        if (!ctx) return 0
        const { data } = ctx.getImageData(0, 0, el.clientWidth, el.clientHeight)
        let total = 0, count = 0
        for (let idx = 3; idx < data.length; idx += 4) {
          if (data[idx] > 0 && data[idx] < 255) {
            total += data[idx]
            count++
          }
        }
        return count > 0 ? total / count : 0
      })
    const initial = await get_avg_alpha()
    await diagram.locator(`.legend-controls-btn`).click()
    await diagram.locator(
      `.draggable-pane.convex-hull-controls-pane input[type="range"][aria-label*="opacity"]`,
    ).fill(`0.2`)
    // Longer timeout for CI - canvas updates can be slow
    await expect(async () => expect(await get_avg_alpha()).toBeGreaterThan(initial))
      .toPass({ timeout: 5000 })
  })
})
