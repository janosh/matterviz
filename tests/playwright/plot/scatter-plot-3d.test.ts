import type { Vec3 } from '$lib/math'
import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  expect_canvas_changed,
  expect_gizmo_click_flies_camera,
  get_canvas_timeout,
  IS_CI,
  wait_for_3d_canvas,
  wait_for_canvas_rendered,
} from '../helpers'

// One typed browser-test probe keeps the page and Playwright assertions in sync.
export interface ScatterProbe {
  set_count: (count: number) => void
  set_view: (position: Vec3) => Promise<void>
  zoom: () => number
  hover: () => number | null
  targets: () => { point_idx: number; x: number; y: number; depth: number }[]
  instances: () => {
    count: number
    matrices: number[]
    colors: number[]
    projection: boolean
  }[]
}
declare global {
  interface Window {
    scatter_probe: ScatterProbe
  }
}

const TEST_URL = `/test/scatter-plot-3d`
const CONTAINER_SELECTOR = `#test-scatter-3d`

// Opens the controls pane and asserts it got there, so callers that only need the pane don't
// repeat the toggle dance — and the one test that is *about* opening it can just call this.
async function open_controls_pane(page: Page): Promise<Locator> {
  const container = page.locator(CONTAINER_SELECTOR)
  await container.hover()
  const toggle = container.locator(`button.pane-toggle`)
  await expect(toggle).toBeVisible({ timeout: 5000 })
  await toggle.click()
  const pane = container.locator(`.draggable-pane`)
  await expect(pane).toBeVisible({ timeout: 5000 })
  return pane
}

test(`portalled tooltip can escape while the canvas stays clipped`, async ({ page }) => {
  await page.goto(TEST_URL, { waitUntil: `networkidle` })
  const container = page.locator(CONTAINER_SELECTOR)
  expect(
    await container.evaluate((element) => {
      const canvas_host = element.querySelector(`canvas`)?.parentElement
      if (!(canvas_host instanceof HTMLElement)) throw new Error(`Missing canvas host`)
      const probe = document.createElement(`span`)
      probe.style.cssText = `position:absolute;right:-40px;top:100px;width:80px;height:40px;z-index:1000`
      element.append(probe)
      const rect = probe.getBoundingClientRect()
      return {
        canvas_clipped: getComputedStyle(canvas_host).overflow === `hidden`,
        tooltip_visible:
          document.elementFromPoint(rect.right - 10, rect.top + rect.height / 2) === probe,
      }
    }),
  ).toEqual({ canvas_clipped: true, tooltip_visible: true })
})

test(`sized points and projections share meshes and resize their instance buffers`, async ({
  page,
}) => {
  test.skip(IS_CI, `Requires a hardware WebGPU adapter`)
  await page.goto(`${TEST_URL}?points=64&varying_sizes&projections`)
  await page.waitForFunction(() => Boolean(window.scatter_probe))
  const read = () => page.evaluate(() => window.scatter_probe.instances())
  for (const count of [64, 256, 0, 11]) {
    if (count !== 64)
      await page.evaluate((next_count) => window.scatter_probe.set_count(next_count), count)
    if (count === 0) {
      await expect.poll(read).toEqual([])
      continue
    }
    await expect
      .poll(async () => (await read()).map((mesh) => mesh.count))
      .toEqual([count, count, count, count])
    await expect
      .poll(async () => {
        const meshes = await read()
        // Matrices/colors are uploaded on the next render task, after count changes.
        return meshes.every(
          (mesh) => mesh.matrices.length === count * 16 && mesh.matrices.at(-16) !== 1,
        )
      })
      .toBe(true)
    const meshes = await read()
    expect(meshes.map((mesh) => mesh.projection)).toEqual([false, true, true, true])
    for (const mesh of meshes) {
      expect(mesh.colors).toHaveLength(count * 3)
      for (let idx = 0; idx < count; idx++) {
        const expected_radius =
          (0.05 + (0.15 * idx) / (count - 1)) * (mesh.projection ? 0.5 : 1)
        // Instance matrices are f32: allow one f32 epsilon relative to radius.
        for (const diagonal of [0, 5, 10])
          expect(
            Math.abs(mesh.matrices[idx * 16 + diagonal] - expected_radius),
          ).toBeLessThanOrEqual(expected_radius * 2 ** -23)
        expect(mesh.matrices[idx * 16 + 15]).toBe(1)
      }
      if (mesh.projection) expect(mesh.colors).toEqual(meshes[0].colors)
    }
  }
})

test(`hover follows rotated markers and its tooltip never intercepts the pointer`, async ({
  page,
}) => {
  test.skip(IS_CI, `Requires a hardware WebGPU adapter`)
  await page.goto(`${TEST_URL}?points=16&varying_sizes`)
  const container = page.locator(CONTAINER_SELECTOR)
  await wait_for_canvas_rendered(await wait_for_3d_canvas(page, CONTAINER_SELECTOR))
  for (const position of [
    [12, 0, 0],
    [8, 8, 8],
    [0.01, 12, 0.01],
  ] satisfies Vec3[]) {
    await page.evaluate(
      (next_position) => window.scatter_probe.set_view(next_position),
      position,
    )
    // Camera binding, orbit controls, and instance matrices settle over render frames.
    let marker_y = 0
    await expect
      .poll(async () => {
        const targets = await page.evaluate(() => window.scatter_probe.targets())
        const bounds = await container.boundingBox()
        if (!bounds) return false
        const target = targets.find(
          ({ x, y }) =>
            x > bounds.x + 100 &&
            x < bounds.x + bounds.width - 100 &&
            y > bounds.y + 120 &&
            y < bounds.y + bounds.height - 30,
        )
        if (!target) return false
        await page.mouse.move(target.x - 2, target.y)
        await page.mouse.move(target.x, target.y)
        const hovered = await page.evaluate(() => window.scatter_probe.hover())
        marker_y = target.y
        return hovered === target.point_idx
      })
      .toBe(true)
    const tooltip = container.locator(`.tooltip`)
    await expect(tooltip).toBeVisible()
    const tooltip_bounds = await tooltip.boundingBox()
    if (!tooltip_bounds) throw new Error(`Missing tooltip bounds at camera ${position}`)
    const gap = marker_y - tooltip_bounds.y - tooltip_bounds.height
    expect(gap).toBeGreaterThan(7) // 8px clearance plus the projected halo radius
    expect(gap).toBeLessThan(32) // small test markers must not leave a large detached gap
    expect(
      await tooltip.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
        )?.tagName
      }),
    ).toBe(`CANVAS`)
    await expect(tooltip.locator(`..`)).toHaveCSS(`pointer-events`, `none`)
  }

  // With two samples, normalization places them on opposite ends of this diagonal.
  // Looking straight down it overlaps both spheres: index 1 is the nearer surface.
  await page.evaluate(async () => {
    window.scatter_probe.set_count(2)
    await window.scatter_probe.set_view([-10, 5, 10])
  })
  await expect
    .poll(async () => {
      const bounds = await container.boundingBox()
      if (!bounds) return null
      await page.mouse.move(bounds.x + bounds.width / 2 - 2, bounds.y + bounds.height / 2)
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return page.evaluate(() => window.scatter_probe.hover())
    })
    .toBe(1)
})

test.describe(`ScatterPlot3D`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ScatterPlot3D tests timeout in CI due to WebGL software rendering`)
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
  })

  // Both helpers assert: wait_for_3d_canvas requires a visible, non-zero-size canvas and
  // wait_for_canvas_rendered requires it to have actually painted.
  test(`renders 3D canvas with content`, async ({ page }) => {
    await wait_for_canvas_rendered(await wait_for_3d_canvas(page, CONTAINER_SELECTOR))
  })

  // Text overlays must not swallow pointer events meant for the canvas below them
  for (const selector of [`.axis-label`, `.tick-label`]) {
    test(`${selector} does not intercept pointer events`, async ({ page }) => {
      await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      const label = page.locator(`${CONTAINER_SELECTOR} ${selector}`).first()
      await expect(label).toBeVisible({ timeout: get_canvas_timeout() })
      await expect(label).toHaveCSS(`pointer-events`, `none`)
    })
  }

  test(`gizmo handles stay reachable beside the color bar and fly the camera`, async ({
    page,
  }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)

    // No CSS can lift an in-canvas gizmo above the ColorBar/Legend, so only its bottom offset
    // keeps it clear. The sweep's synthetic moves ignore overlays; the real click below is what
    // fails if one covers the gizmo.
    await expect_gizmo_click_flies_camera(canvas, {
      probe: 110,
      steps: 11,
      bottom_offset: 65,
    })
  })

  test(`drag to rotate changes view`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const initial = await canvas.screenshot()

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 50, {
      steps: 10,
    })
    await page.mouse.up()

    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })

  test(`scroll wheel zoom changes view`, async ({ page }) => {
    const controls_pane = await open_controls_pane(page)
    await controls_pane
      .getByRole(`combobox`, { name: /Projection/ })
      .selectOption(`orthographic`)
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const initial = await canvas.screenshot()

    const initial_box = await canvas.boundingBox()
    if (!initial_box) throw new Error(`Canvas bounding box not found`)

    await page.mouse.move(
      initial_box.x + initial_box.width / 2,
      initial_box.y + initial_box.height / 2,
    )
    await page.mouse.wheel(0, -200)

    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
    const read_zoom = (): Promise<number> => page.evaluate(() => window.scatter_probe.zoom())
    const zoom_before_resize = await read_zoom()

    await page.locator(CONTAINER_SELECTOR).evaluate((element) => {
      element.style.width = `320px`
    })
    await expect
      .poll(async () => (await canvas.boundingBox())?.width)
      .toBeLessThan(initial_box.width)
    const resized_box = await canvas.boundingBox()
    if (!resized_box) throw new Error(`Resized canvas bounding box not found`)
    // The page fixes height at 500px, so 320px makes width the shorter edge. Asserted rather
    // than assumed: the fit zoom follows min(width, height), so a resize that left the height
    // shorter would not move it and the ratio below would hold vacuously.
    expect(resized_box.width).toBeLessThan(resized_box.height)
    await expect.poll(read_zoom).not.toBe(zoom_before_resize)
    const zoom_after_resize = await read_zoom()
    expect(zoom_after_resize / Math.min(resized_box.width, resized_box.height)).toBeCloseTo(
      zoom_before_resize / Math.min(initial_box.width, initial_box.height),
      6,
    )
  })

  test(`controls pane edits and resets axis labels and camera projection`, async ({
    page,
  }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)
    const axis_label = pane.getByRole(`textbox`, { name: `X label`, exact: true })
    const initial_label = await axis_label.inputValue()
    const x_min = pane.getByRole(`spinbutton`, { name: `X min`, exact: true })
    const x_max = pane.getByRole(`spinbutton`, { name: `X max`, exact: true })
    await expect(x_min).toHaveValue(`-1.2`)
    await expect(x_max).toHaveValue(`1.2`)
    await x_min.fill(`0`)
    await expect(x_max).toHaveValue(`1.2`)
    await axis_label.fill(`Energy`)
    const reset_axes = pane.getByRole(`button`, {
      name: `Reset axes to defaults`,
      exact: true,
    })
    await expect(reset_axes).toBeVisible()
    await reset_axes.click()
    await expect(axis_label).toHaveValue(initial_label)
    await expect(reset_axes).toHaveCount(0)
    const before = await canvas.screenshot()
    const projection = pane.getByRole(`combobox`, { name: `Projection`, exact: true })
    await projection.selectOption(`orthographic`)
    await expect_canvas_changed(canvas, before, get_canvas_timeout())
    await pane.getByRole(`button`, { name: `Reset camera to defaults`, exact: true }).click()
    await expect(projection).toHaveValue(`perspective`)
    await expect(
      pane.getByRole(`button`, { name: `Reset camera to defaults`, exact: true }),
    ).toHaveCount(0)
  })
})

test.describe(`ScatterPlot3D Projections`, () => {
  // Helper to get projection checkbox
  const get_projection_checkbox = (pane: Locator, plane: string) =>
    pane.locator(`label`).filter({ hasText: plane }).locator(`input[type="checkbox"]`)

  // Each setting is a <label> grid row wrapping both number and range inputs.
  const get_slider_row = (pane: Locator, label: string) =>
    pane.locator(`label`).filter({ hasText: label })

  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ScatterPlot3D tests timeout in CI due to WebGL software rendering`)
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
  })

  // Parameterized tests for each projection plane toggle
  for (const plane of [`XY`, `XZ`, `YZ`] as const) {
    test(`toggling ${plane} projection changes canvas`, async ({ page }) => {
      const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      await wait_for_canvas_rendered(canvas)
      const pane = await open_controls_pane(page)
      const initial = await canvas.screenshot()

      const checkbox = get_projection_checkbox(pane, plane)
      await expect(checkbox).not.toBeChecked() // verify default unchecked
      await checkbox.click()
      await expect(checkbox).toBeChecked()

      await expect_canvas_changed(canvas, initial, get_canvas_timeout())
    })
  }

  for (const [label, default_val, min, test_val] of [
    [`Opacity`, `0.3`, `0`, `0.7`],
    [`Size`, `0.5`, `0.1`, `0.8`],
  ]) {
    test(`${label}: defaults, projection appearance, and number input sync`, async ({
      page,
    }) => {
      const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
      await wait_for_canvas_rendered(canvas)
      const pane = await open_controls_pane(page)
      const row = get_slider_row(pane, label)
      const slider = row.locator(`input[type="range"]`)
      const number_input = row.locator(`input[type="number"]`)
      await expect(slider).toHaveValue(default_val)
      await expect(slider).toHaveAttribute(`min`, min)
      await expect(slider).toHaveAttribute(`max`, `1`)
      await expect(slider).toHaveAttribute(`step`, `0.05`)
      await expect(number_input).toHaveValue(default_val)

      // Enable XY, then change the slider to its maximum and verify a visible change.
      await get_projection_checkbox(pane, `XY`).click()
      await page.waitForTimeout(200)
      const before = await canvas.screenshot()
      await slider.fill(`1`)
      await expect_canvas_changed(canvas, before, get_canvas_timeout())

      await number_input.fill(test_val)
      await number_input.press(`Enter`)
      await expect(slider).toHaveValue(test_val)
    })
  }

  test(`reset button resets projections to defaults`, async ({ page }) => {
    await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    const pane = await open_controls_pane(page)

    // Enable all projections and change sliders. Asserting each stays checked as we go also
    // covers that the three planes are independent and can be on simultaneously.
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      const checkbox = get_projection_checkbox(pane, plane)
      await checkbox.click()
      await expect(checkbox).toBeChecked()
    }
    const opacity_row = get_slider_row(pane, `Opacity`)
    const size_row = get_slider_row(pane, `Size`)
    await opacity_row.locator(`input[type="range"]`).fill(`0.8`)
    await size_row.locator(`input[type="range"]`).fill(`0.9`)

    // Click reset button in Projections section specifically
    await pane.locator(`button[title="Reset projections to defaults"]`).click()

    // Verify reset to defaults
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      await expect(get_projection_checkbox(pane, plane)).not.toBeChecked()
    }
    await expect(opacity_row.locator(`input[type="range"]`)).toHaveValue(`0.3`)
    await expect(size_row.locator(`input[type="range"]`)).toHaveValue(`0.5`)
  })

  test(`disabling projection removes it from canvas`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    const xy_checkbox = get_projection_checkbox(pane, `XY`)
    await xy_checkbox.click()
    await page.waitForTimeout(200)
    const with_projection = await canvas.screenshot()

    await xy_checkbox.click()
    await expect(xy_checkbox).not.toBeChecked()

    await expect_canvas_changed(canvas, with_projection, get_canvas_timeout())
  })

  test(`projections update when camera rotates`, async ({ page }) => {
    const canvas = await wait_for_3d_canvas(page, CONTAINER_SELECTOR)
    await wait_for_canvas_rendered(canvas)
    const pane = await open_controls_pane(page)

    // Enable all projections
    for (const plane of [`XY`, `XZ`, `YZ`]) {
      await get_projection_checkbox(pane, plane).click()
    }
    await page.waitForTimeout(200)
    const initial = await canvas.screenshot()

    // Close pane and rotate camera
    await page.keyboard.press(`Escape`)
    await page.waitForTimeout(100)

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas bounding box not found`)

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 100, {
      steps: 10,
    })
    await page.mouse.up()

    await expect_canvas_changed(canvas, initial, get_canvas_timeout())
  })
})
