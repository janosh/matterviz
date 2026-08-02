import { DEFAULTS } from '$lib/settings'
import { expect, type Locator, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import {
  canvas_screenshot,
  dispatch_cancelable_keydown,
  drop_file,
  enter_edit_atoms_mode,
  expect_canvas_changed,
  get_canvas_timeout,
  goto_structure_test,
  IS_CI,
  open_structure_control_pane,
  open_structure_export_pane,
  select_view_layout as select_structure_layout,
  sweep_gizmo_handles,
  wait_for_3d_canvas,
} from '../helpers'

const is_mac = process.platform === `darwin`

// each h4 section title in the controls pane is followed by the element holding its controls
const section_body = (heading: Locator): Locator =>
  heading.locator(`xpath=following-sibling::*[1]`)
const controls_pane_of = (page: Page): Locator =>
  page.locator(`#test-structure .controls-pane`)
const opacity_of = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => Number(getComputedStyle(element).opacity))

type EventCall = { event: string; data?: unknown }
const clear_events = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const event_calls = Reflect.get(globalThis, `event_calls`)
    if (!Array.isArray(event_calls)) throw new Error(`event_calls is unavailable`)
    event_calls.length = 0
  })
const get_event_calls = (page: Page): Promise<EventCall[]> =>
  page.evaluate(
    () => (Reflect.get(globalThis, `event_calls`) as EventCall[] | undefined) ?? [],
  )
const events_named = async (page: Page, event_name: string): Promise<EventCall[]> =>
  (await get_event_calls(page)).filter(({ event }) => event === event_name)
const set_viewer_size = async (
  structure_div: Locator,
  width: number,
  height: number,
): Promise<void> => {
  await structure_div.evaluate(
    (element, size) => {
      element.style.setProperty(`--struct-width`, `${size.width}px`)
      element.style.setProperty(`--struct-height`, `${size.height}px`)
    },
    { width, height },
  )
}
const wait_for_event = async (
  page: Page,
  event_name: string,
  expected_props: string[],
  timeout = get_canvas_timeout(),
): Promise<EventCall> => {
  await expect
    .poll(async () => (await events_named(page, event_name)).length, { timeout })
    .toBeGreaterThan(0)
  const event = (await events_named(page, event_name)).at(-1)
  if (!event) throw new Error(`${event_name} was not emitted`)
  for (const prop of expected_props) {
    expect(event.data as Record<string, unknown>, event_name).toHaveProperty(prop)
  }
  return event
}

const compressed_source_path = `/structures/source-loop.json.gz`
const compressed_source_filename =
  compressed_source_path.split(`/`).at(-1) ?? compressed_source_path
const source_structure = JSON.stringify({
  lattice: {
    matrix: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
  },
  sites: [
    {
      species: [{ element: `H`, occu: 1 }],
      abc: [0, 0, 0],
      xyz: [0, 0, 0],
      label: `H1`,
      properties: {},
    },
  ],
})

async function expect_compressed_source_url(
  page: Page,
  route_path: string,
  heading_tag: string,
): Promise<void> {
  const requests: string[] = []
  await page.route(`**${compressed_source_path}`, (route) =>
    route.fulfill({ body: gzipSync(source_structure), contentType: `application/gzip` }),
  )
  page.on(`request`, (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith(compressed_source_path.replace(/\.gz$/, ``))) requests.push(path)
  })

  await page.goto(`${route_path}?file=${compressed_source_filename}`, {
    waitUntil: `networkidle`,
  })

  expect(new URL(page.url()).searchParams.get(`file`)).toBe(compressed_source_filename)
  await expect(page.locator(`.structure ${heading_tag}`).first()).toHaveText(
    `source-loop.json`,
    { timeout: get_canvas_timeout() * 4 },
  )
  expect(requests.length).toBeGreaterThan(0)
  expect(new Set(requests)).toEqual(new Set([compressed_source_path]))
}
test(`/structure keeps the compressed source URL after loading`, ({ page }) =>
  expect_compressed_source_url(page, `/structure`, `h3`))
test(`/structure/symmetry keeps the compressed source URL after loading`, ({ page }) =>
  expect_compressed_source_url(page, `/structure/symmetry`, `h2`))

test.describe(`Structure Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`renders Structure component with canvas`, async ({ page }) => {
    test.skip(IS_CI, `Structure canvas size test flaky in CI`)
    const structure_wrapper = page.locator(`#test-structure`)
    await expect(structure_wrapper).toBeVisible()

    const canvas = structure_wrapper.locator(`canvas`)
    await expect(canvas).toBeVisible()
    // Three.js uses CSS sizing, not HTML attributes
    const canvas_timeout = get_canvas_timeout()
    await expect(canvas).toHaveCSS(`width`, `800px`, { timeout: canvas_timeout })
    await expect(canvas).toHaveCSS(`height`, `500px`, { timeout: canvas_timeout })

    await expect(page.locator(`[data-testid="pane-open-status"]`)).toContainText(`false`)

    await expect(page.locator(`[data-testid="canvas-width-status"]`)).toContainText(`800`)
    await expect(page.locator(`[data-testid="canvas-height-status"]`)).toContainText(`500`)
  })

  test(`measure mode controls visible by default and hide when disabled`, async ({ page }) => {
    const measure_dropdown = page.locator(`#test-structure .measure-mode-dropdown`)
    await expect(measure_dropdown).toBeVisible()

    // Navigate with enable_measure_mode=false
    await goto_structure_test(page, `/test/structure?enable_measure_mode=false`)
    await expect(page.locator(`#test-structure .measure-mode-dropdown`)).toHaveCount(0)
  })

  test(`CellSelect appears on hover and hides on mouse leave`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)
    const supercell = structure.locator(`.cell-select`)

    // Initially hidden
    await expect(supercell).toHaveCSS(`opacity`, `0`)

    // Visible on hover
    await structure.hover()
    await expect(supercell).toHaveCSS(`opacity`, `1`)

    // Hidden after mouse leaves
    await page.mouse.move(0, 0)
    await expect(supercell).toHaveCSS(`opacity`, `0`)
  })

  test(`CellSelect toggle has an opaque theme-aware surface`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)
    const toggle = structure.locator(`.cell-select .toggle-btn`)
    const expect_colors = async (
      color_scheme: `light` | `dark`,
      background: string,
      color: string,
    ) => {
      await page.evaluate((scheme) => {
        document.documentElement.style.colorScheme = scheme
      }, color_scheme)
      await expect(toggle).toHaveCSS(`background-color`, background)
      await expect(toggle).toHaveCSS(`color`, color)
    }

    await expect_colors(`light`, `rgb(255, 255, 255)`, `rgb(26, 26, 26)`)
    await expect_colors(`dark`, `rgb(47, 49, 55)`, `rgb(238, 238, 238)`)
  })

  test(`CellSelect typography stays legible in narrow legends`, async ({ page }) => {
    await page.locator(`[data-testid="canvas-width-input"]`).fill(`260`)
    await expect(page.locator(`[data-testid="canvas-width-status"]`)).toContainText(`260`)

    const structure = page.locator(`#test-structure`)
    await structure.hover()
    const cell_select = structure.locator(`.cell-select`)
    await cell_select.dispatchEvent(`mouseenter`)
    await expect(cell_select.locator(`.dropdown`)).toBeVisible()

    const get_font_size = (selector: string): Promise<number> =>
      structure
        .locator(selector)
        .first()
        .evaluate((element) => Number(getComputedStyle(element).fontSize.replace(`px`, ``)))
    const legend_label_size = await get_font_size(`.atom-legend .legend-item label`)
    const toggle_size = await get_font_size(`.cell-select .toggle-btn`)
    const preset_size = await get_font_size(`.cell-select .preset-btn`)
    const preset_gap = await structure
      .locator(`.cell-select .supercell-grid`)
      .evaluate((element) => Number(getComputedStyle(element).gap.replace(`px`, ``)))
    const preset_padding = await structure
      .locator(`.cell-select .preset-btn`)
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return {
          top: Number(style.paddingTop.replace(`px`, ``)),
          right: Number(style.paddingRight.replace(`px`, ``)),
        }
      })

    expect(toggle_size).toBeCloseTo(legend_label_size, 1)
    expect(preset_size).toBeGreaterThanOrEqual(legend_label_size)
    expect(preset_gap).toBeGreaterThanOrEqual(3)
    // preset buttons stay compact in narrow legends (line-height removed; padding kept tight at ≤1px)
    expect(preset_padding.top).toBeLessThanOrEqual(1)
    expect(preset_padding.right).toBeLessThanOrEqual(1)
  })

  test(`reacts to background_color prop change from test page`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const background_color_input = page.locator(
      `section:has-text("Controls for Test Page") label:has-text("Background Color") input[type="color"]`,
    )

    await background_color_input.fill(`#ff0000`)
    await expect(structure_div).toHaveCSS(`background-color`, `rgba(255, 0, 0, 0.1)`, {
      timeout: get_canvas_timeout(),
    })
  })

  test(`updates bound dimensions from test page controls`, async ({ page }) => {
    const width_input = page.locator(`label:has-text("Canvas Width") input[type="number"]`)
    const height_input = page.locator(`label:has-text("Canvas Height") input[type="number"]`)
    const canvas_width_status = page.locator(`[data-testid="canvas-width-status"]`)
    const canvas_height_status = page.locator(`[data-testid="canvas-height-status"]`)

    await width_input.fill(`700`)
    await height_input.fill(`450`)

    await expect(canvas_width_status).toContainText(`700`)
    await expect(canvas_height_status).toContainText(`450`)
  })

  // This test navigates 3 times sequentially - needs extra time in CI
  test(`performance_mode prop can be set via URL parameters`, async ({ page }) => {
    test.setTimeout(IS_CI ? 90_000 : 30_000)
    const perf_mode_status = page.locator(`[data-testid="performance-mode-status"]`)
    const perf_mode_select = page.locator(`label:has-text("Performance Mode") select`)

    const test_cases = [
      { param: `speed`, expected: `speed` },
      { param: `quality`, expected: `quality` },
      { param: `invalid`, expected: `quality` },
    ]

    // Test sequentially (avoid navigation conflicts)
    for (const { param, expected } of test_cases) {
      await page.goto(`/test/structure?performance_mode=${param}`, {
        waitUntil: `load`,
      })
      await wait_for_3d_canvas(page, `#test-structure`)
      await expect(perf_mode_status).toContainText(`Performance Mode Status: ${expected}`)
      await expect(perf_mode_select).toHaveValue(expected)
    }
  })

  test(`fullscreen prop is bindable and updates from test page controls`, async ({ page }) => {
    const status = page.locator(`[data-testid="fullscreen-status"]`)
    const checkbox = page.locator(`[data-testid="fullscreen-checkbox"]`)

    await expect(status).toContainText(`false`)
    await expect(checkbox).not.toBeChecked()

    await checkbox.click({ force: true })
    await expect(status).toContainText(`true`)
    await expect(checkbox).toBeChecked()

    await checkbox.evaluate((input: HTMLInputElement) => {
      input.checked = false
      input.dispatchEvent(new Event(`change`, { bubbles: true }))
    })
    await expect(status).toContainText(`false`)
    await expect(checkbox).not.toBeChecked()
  })

  test(`keyboard shortcuts require modifier keys`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.click()

    // keep the message, not just a flag: a bare `expected false` says nothing about which
    // error fired, and under CI's software WebGPU a lost device can surface here
    const page_errors: string[] = []
    page.on(`pageerror`, (error) => page_errors.push(error.message))

    // Test that single keys don't trigger actions or cause errors
    await page.keyboard.press(`f`)
    await page.keyboard.press(`i`)

    // Should not be in fullscreen mode after 'f' key
    const is_fullscreen = await page.evaluate(() => Boolean(document.fullscreenElement))
    expect(is_fullscreen).toBe(false)

    const primary_modifier = is_mac ? `metaKey` : `ctrlKey`
    for (const key of [`f`, `i`]) {
      await expect(
        dispatch_cancelable_keydown(structure_div, { key, [primary_modifier]: true }),
      ).resolves.toBe(false)
    }

    // Verify no errors occurred and component still functions
    expect(page_errors).toEqual([])
    await expect(structure_div.locator(`canvas`)).toBeVisible()
  })

  test(`both site labels and site indices can be enabled simultaneously`, async ({ page }) => {
    const { pane_div: control_pane } = await open_structure_control_pane(page)

    const site_labels_checkbox = control_pane.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    const site_indices_checkbox = control_pane.locator(
      `label:has-text("Site Indices") input[type="checkbox"]`,
    )
    const labels_heading = control_pane.locator(`h4:has-text("Labels")`)

    // With both off, Labels is gated on Site Labels alone
    await expect(labels_heading).toBeHidden()
    await site_labels_checkbox.check()
    await expect(labels_heading).toBeVisible()
    await site_labels_checkbox.uncheck()
    await expect(labels_heading).toBeHidden()

    // Enable both — Labels stays up, and either checkbox keeps it visible
    await site_labels_checkbox.check()
    await site_indices_checkbox.check()
    await expect(site_labels_checkbox).toBeChecked()
    await expect(site_indices_checkbox).toBeChecked()
    await expect(labels_heading).toBeVisible()

    await site_labels_checkbox.uncheck()
    await expect(site_labels_checkbox).not.toBeChecked()
    await expect(site_indices_checkbox).toBeChecked()
    await expect(labels_heading).toBeVisible()

    await site_indices_checkbox.uncheck()
    await expect(site_indices_checkbox).not.toBeChecked()
    await expect(labels_heading).toBeHidden()

    await site_indices_checkbox.check()
    await expect(labels_heading).toBeVisible()
  })

  test(`label styling controls echo values and enforce input constraints`, async ({
    page,
  }) => {
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels to reveal the Labels section
    await pane_div.locator(`label:has-text("Site Labels") input[type="checkbox"]`).check()
    const labels_heading = pane_div.locator(`h4:has-text("Labels")`)
    await expect(labels_heading).toBeVisible()
    const labels_container = section_body(labels_heading)
    const offset_row = labels_container.locator(`.pane-row`).filter({ hasText: `Offset` })

    // Color pickers echo filled values
    const color_cases = [
      {
        name: `text color`,
        input: labels_container.locator(`label:has-text("Color") input[type="color"]`).first(),
        fill: `#ff0000`,
      },
      {
        name: `background color`,
        input: labels_container.locator(`label:has-text("Background") input[type="color"]`),
        fill: `#0000ff`,
      },
    ]
    for (const { name, input, fill } of color_cases) {
      await expect(input, name).toBeVisible()
      expect(await input.inputValue(), name).toMatch(/^#[0-9a-fA-F]{6}$/)
      await input.fill(fill)
      expect(await input.inputValue(), name).toBe(fill)
    }

    // Numeric inputs echo filled values and carry expected min/max/step constraints
    const opacity_label = labels_container.locator(`label:has-text("Opacity")`).first()
    const padding_label = labels_container.locator(`label:has-text("Padding")`)

    // Default label background must be fully transparent (opacity 0) — assert before
    // the fill loop below overwrites it
    await expect(opacity_label.locator(`input[type="number"]`)).toHaveValue(`0`)
    const numeric_cases = [
      {
        name: `opacity number`,
        input: opacity_label.locator(`input[type="number"]`),
        fill: `0.5`,
        attrs: { min: `0`, max: `1`, step: `0.01` },
      },
      {
        name: `opacity range`,
        input: opacity_label.locator(`input[type="range"]`),
        fill: `0.8`,
      },
      {
        name: `padding number`,
        input: padding_label.locator(`input[type="number"]`),
        fill: `5`,
        attrs: { min: `0`, max: `10`, step: `1` },
      },
      {
        name: `padding range`,
        input: padding_label.locator(`input[type="range"]`),
        fill: `8`,
      },
      ...[
        { axis: `X`, fill: `0.5` },
        { axis: `Y`, fill: `-0.7` },
        { axis: `Z`, fill: `0.3` },
      ].map(({ axis, fill }) => ({
        name: `offset ${axis}`,
        input: offset_row.locator(`label:has-text("${axis}") input[type="number"]`),
        fill,
        attrs: { min: `-1`, max: `1`, step: `0.1` },
      })),
      {
        name: `font size range`,
        input: labels_container.locator(`label:has-text("Size") input[type="range"]`),
        fill: `1.5`,
        attrs: { min: `0.5`, max: `2`, step: `0.1` },
      },
    ]
    for (const { name, input, fill, attrs } of numeric_cases) {
      await expect(input, name).toBeVisible()
      for (const [attr, expected] of Object.entries(attrs ?? {})) {
        await expect(input, `${name} ${attr}`).toHaveAttribute(attr, expected)
      }
      await input.fill(fill)
      expect(Number(await input.inputValue()), name).toBe(Number(fill))
    }

    // Number and range inputs for the same setting stay synchronized
    expect(await opacity_label.locator(`input[type="number"]`).inputValue()).toBe(
      await opacity_label.locator(`input[type="range"]`).inputValue(),
    )
    expect(await padding_label.locator(`input[type="number"]`).inputValue()).toBe(
      await padding_label.locator(`input[type="range"]`).inputValue(),
    )
  })

  test(`label controls persist when toggling site labels`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    // Enable site labels
    const site_labels_checkbox = pane_div.locator(
      `label:has-text("Site Labels") input[type="checkbox"]`,
    )
    await site_labels_checkbox.check()

    // Set some values
    const labels_heading = pane_div.locator(`h4:has-text("Labels")`)
    const labels_container_for_persist = section_body(labels_heading)
    const text_color_input = labels_container_for_persist
      .locator(`label:has-text("Color") input[type="color"]`)
      .first()
    const background_color_input = labels_container_for_persist.locator(
      `label:has-text("Background") input[type="color"]`,
    )
    const opacity_input = labels_container_for_persist
      .locator(`label:has-text("Opacity") input[type="number"]`)
      .first()

    await text_color_input.fill(`#ff0000`)
    await background_color_input.fill(`#0000ff`)
    await opacity_input.fill(`0.7`)

    // Disable site labels
    await site_labels_checkbox.uncheck()

    await expect(pane_div).toBeVisible()

    await site_labels_checkbox.check()
    await expect(text_color_input).toHaveValue(`#ff0000`)
    await expect(background_color_input).toHaveValue(`#0000ff`)
    await expect(opacity_input).toHaveValue(`0.7`)
  })

  test(`gizmo is visible by default and can be toggled`, async ({ page }) => {
    const gizmo_checkbox = page.locator(`label:has-text("Show Gizmo") input[type="checkbox"]`)
    const gizmo_status = page.locator(`[data-testid="gizmo-status"]`)

    await expect(gizmo_checkbox).toBeChecked()
    await expect(gizmo_status).toContainText(`Gizmo Status: true`)

    await gizmo_checkbox.uncheck()
    await expect(gizmo_status).toContainText(`Gizmo Status: false`)

    await gizmo_checkbox.check()
    await expect(gizmo_status).toContainText(`Gizmo Status: true`)
  })

  test(`dragging the canvas orbits the camera`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()

    // Reset lives in the controls pane and is hidden at the default camera
    await expect(page.locator(`#test-structure button.reset-camera`)).toBeHidden()

    const initial_screenshot = await canvas.screenshot()

    const box = await canvas.boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 100, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 100, y: box.height / 2 },
    })

    // Poll for canvas change (GPU timing variations)
    // If first drag doesn't work, try vertical drag
    try {
      await expect_canvas_changed(canvas, initial_screenshot, 3000)
    } catch {
      // Take fresh baseline before second drag to avoid false positives
      // from delayed first drag rendering
      const baseline_before_second_drag = await canvas.screenshot()
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2, y: box.height / 2 - 100 },
        targetPosition: { x: box.width / 2, y: box.height / 2 + 100 },
      })
      await expect_canvas_changed(canvas, baseline_before_second_drag)
    }
  })

  test(`invalid FOVs do not break perspective auto-placement`, async ({ page }) => {
    const perspective_fit_errors: string[] = []
    page.on(`pageerror`, ({ message }) => {
      if (message.includes(`Invalid perspective fit`)) {
        perspective_fit_errors.push(message)
      }
    })
    await page.evaluate(async () => {
      for (const fov of [200, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
        window.dispatchEvent(
          new CustomEvent(`set-scene-props`, {
            detail: {
              camera_position: [0, 0, 0],
              camera_projection: `perspective`,
              fov,
            },
          }),
        )
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      for (let frame_idx = 0; frame_idx < 2; frame_idx++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    })
    expect(perspective_fit_errors).toEqual([])
  })

  test(`clicking a gizmo handle flies the camera`, async ({ page }) => {
    test.skip(IS_CI, `SwiftShader lacks reliable gizmo hit testing`)
    // the legend needs this much room, and its mode toggle is our viewer-active signal
    await page.setViewportSize({ width: 1400, height: 1200 })
    const canvas = page.locator(`#test-structure canvas`)
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)

    // the gizmo only draws while the viewer is active, so hover before probing
    await page.mouse.move(box.x + 40, box.y + 40)
    await expect(page.locator(`#test-structure .atom-legend .mode-toggle`)).toHaveCSS(
      `opacity`,
      `1`,
    )

    const handles = await sweep_gizmo_handles(canvas)
    expect(handles.length, `gizmo handles under the pointer`).toBeGreaterThan(0)
    const candidates = [handles[0], handles[Math.floor(handles.length / 2)], handles.at(-1)]
    let camera_position: unknown
    for (const candidate of candidates) {
      if (!candidate) continue
      await page.mouse.move(candidate.x, candidate.y)
      await page.waitForTimeout(100)
      await clear_events(page)
      await page.mouse.click(candidate.x, candidate.y)
      try {
        const event = await wait_for_event(page, `on_camera_move`, [`camera_position`], 1500)
        camera_position = (event.data as Record<string, unknown>).camera_position
        break
      } catch {
        // A sweep can include edge pixels that only hover a handle; try its center candidate.
      }
    }
    expect(camera_position).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
  })

  test(`controls pane stays open when interacting with control inputs`, async ({ page }) => {
    const { pane_div: control_pane } = await open_structure_control_pane(page)
    const controls_open_status = page.locator(`[data-testid="controls-open-status"]`)

    const atom_radius_label = control_pane.locator(`label`).filter({ hasText: /Radius/ })
    const interactions: {
      name: string
      input: Locator
      act: (input: Locator) => Promise<unknown>
    }[] = [
      {
        // exact match to avoid matching "Image Atoms" or "Same size atoms"
        name: `show atoms checkbox`,
        input: control_pane.getByRole(`checkbox`, { name: `Atoms`, exact: true }),
        act: (input) => input.click(),
      },
      {
        // Bonds uses a native select element with label "Bonds:"
        name: `bonds select`,
        input: control_pane.locator(`label`).filter({ hasText: `Bonds:` }).locator(`select`),
        act: (input) => input.selectOption(`always`),
      },
      {
        name: `lattice vectors checkbox`,
        input: control_pane
          .locator(`label`)
          .filter({ hasText: `Lattice Vectors` })
          .locator(`input[type="checkbox"]`),
        act: (input) => input.click(),
      },
      {
        name: `atom radius number`,
        input: atom_radius_label.locator(`input[type="number"]`),
        act: (input) => input.fill(`0.8`),
      },
      {
        name: `atom radius range`,
        input: atom_radius_label.locator(`input[type="range"]`),
        act: (input) => input.fill(`0.6`),
      },
      {
        // color input in the Background section (h4 title followed by section)
        name: `background color`,
        input: control_pane.locator(`h4:has-text("Background") + section input[type="color"]`),
        act: (input) => input.fill(`#00ff00`),
      },
    ]

    // Note: We don't test the download buttons as they may close the pane due to download behavior
    // The important thing is that normal control inputs (checkboxes, selects, inputs) keep the pane open
    for (const { name, input, act } of interactions) {
      await expect(input, name).toBeVisible()
      await act(input)
      await expect(controls_open_status, name).toContainText(`true`)
      await expect(control_pane, name).toHaveClass(/pane-open/)
    }
  })

  test(`control inputs have intended effects on structure`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const { pane_div: control_pane } = await open_structure_control_pane(page)
    const canvas = structure_div.locator(`canvas`)

    // Test atom radius change affects rendering
    const atom_radius_label = control_pane.locator(`label`).filter({ hasText: /Radius/ })
    const atom_radius_input = atom_radius_label.locator(`input[type="number"]`)

    await expect(atom_radius_input).toBeVisible()
    const initial_screenshot = await canvas.screenshot()
    await atom_radius_input.fill(`0.3`)

    // Poll for canvas change after radius change (GPU timing variations)
    await expect_canvas_changed(canvas, initial_screenshot)
    const after_radius_change = await canvas.screenshot()

    // Test show atoms checkbox
    const visibility_heading = control_pane.locator(`h4:has-text("Visibility")`)
    const show_atoms_checkbox = section_body(visibility_heading)
      .locator(`input[type="checkbox"]`)
      .first()
    await show_atoms_checkbox.uncheck()

    // Poll for canvas change after hiding atoms
    await expect_canvas_changed(canvas, after_radius_change)

    // Re-enable atoms for next test
    await show_atoms_checkbox.check()
  })

  test(`controls pane closes only on escape and outside clicks`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const controls_toggle_button = structure_div.locator(`button.structure-controls-toggle`)
    const canvas = structure_div.locator(`canvas`)
    const controls_open_status = page.locator(`[data-testid="controls-open-status"]`)

    const close_actions: { name: string; close: () => Promise<unknown> }[] = [
      // clicking the canvas counts as an outside click, so it closes the pane too
      { name: `canvas click`, close: () => canvas.click({ position: { x: 100, y: 100 } }) },
      { name: `toggle button`, close: () => controls_toggle_button.click() },
      { name: `escape key`, close: () => page.keyboard.press(`Escape`) },
      {
        name: `outside click`,
        close: () => page.locator(`body`).click({ position: { x: 10, y: 10 } }),
      },
    ]

    for (const { name, close } of close_actions) {
      const { pane_div } = await open_structure_control_pane(page)
      await close()
      await expect(controls_open_status, name).toContainText(`false`)
      await expect(pane_div, name).toBeHidden()
    }

    // tooltip attachment moves title to data-original-title
    await expect(controls_toggle_button).toHaveAttribute(
      `data-original-title`,
      `Structure controls`,
    )
  })

  test(`selected_sites controls highlight spheres (no labels/lines)`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const initial_screenshot = await canvas.screenshot()
    await page.locator(`[data-testid="btn-set-selected"]`).click()
    await expect_canvas_changed(canvas, initial_screenshot)

    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(0)

    const selected_screenshot = await canvas.screenshot()
    await page.locator(`[data-testid="btn-clear-selected"]`).click()
    await expect_canvas_changed(canvas, selected_screenshot)
    await expect(labels).toHaveCount(0)
  })

  test(`measured_sites shows selection order labels and measurement overlays`, async ({
    page,
  }) => {
    await page.locator(`[data-testid="btn-set-measured"]`).click()

    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveText([`1`, `2`, `3`])

    await page.locator(`[data-testid="btn-clear-measured"]`).click()
    await expect(labels).toHaveCount(0)
  })

  test(`reset selection button clears both measured_sites and selected_sites`, async ({
    page,
  }) => {
    const structure = page.locator(`#test-structure`)

    // Set measured sites (which also sets selected_sites)
    await page.locator(`[data-testid="btn-set-measured"]`).click()

    // Verify selection labels are shown (these are DOM elements driven by selected_sites)
    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(3)

    // Find and click the reset selection button in the measure mode dropdown
    const reset_button = structure.locator(
      `button[aria-label="Reset selection and bond edits"]`,
    )
    await expect(reset_button).toBeVisible()
    await reset_button.click()

    // Verify selection labels are cleared (confirming selected_sites was cleared)
    // The pulsating animation is driven by selected_sites, so clearing it stops the animation
    await expect(labels).toHaveCount(0)

    // Verify the reset button disappears after reset (since measured_sites is empty)
    await expect(reset_button).toBeHidden()

    // Verify we can set measured sites again (proving state was fully reset)
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)

    // Clean up
    await page.locator(`[data-testid="btn-clear-measured"]`).click()
  })

  test(`selections are cleared on supercell scaling and image atoms toggle`, async ({
    page,
  }) => {
    const labels = page.locator(`.selection-label`)

    // Supercell scaling clears selections
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)
    await page.locator(`[data-testid="supercell-input"]`).fill(`2x2x2`)
    await expect(labels).toHaveCount(0)

    // Image atoms toggle clears selections
    await page.locator(`[data-testid="supercell-input"]`).fill(`1x1x1`)
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)
    await page.locator(`[data-testid="image-atoms-checkbox"]`).click()
    await expect(labels).toHaveCount(0)
  })
})

test.describe(`File Drop Functionality Tests`, () => {
  // File drop tests use synthetic DataTransfer events which are unreliable in headless CI
  // Keep skipped - these work locally but not in CI due to browser security restrictions
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Synthetic file drop events unreliable in headless CI`)
    await goto_structure_test(page)
  })

  const drop_cases: {
    name: string
    filename: string
    content: string
    mime?: string
    expect_load_event?: boolean
  }[] = [
    {
      name: `drops POSCAR file onto structure viewer and updates structure`,
      filename: `test.poscar`,
      content: `BaTiO3 tetragonal
1.0
4.0 0.0 0.0
0.0 4.0 0.0
0.0 0.0 4.1
Ba Ti O
1 1 3
Direct
0.0 0.0 0.0
0.5 0.5 0.5
0.5 0.5 0.0
0.5 0.0 0.5
0.0 0.5 0.5`,
    },
    {
      name: `drops XYZ file onto structure viewer and updates structure`,
      filename: `cyclohexane.xyz`,
      content: `18
Cyclohexane molecule
C    1.261   -0.728    0.000
C    0.000   -1.456    0.000
C   -1.261   -0.728    0.000
C   -1.261    0.728    0.000
C    0.000    1.456    0.000
C    1.261    0.728    0.000
H    2.178   -1.258    0.000
H    2.178    1.258    0.000
H    0.000   -2.516    0.000
H   -2.178   -1.258    0.000
H   -2.178    1.258    0.000
H    0.000    2.516    0.000
H    1.261   -0.728    0.890
H    1.261   -0.728   -0.890
H   -1.261   -0.728    0.890
H   -1.261   -0.728   -0.890
H    1.261    0.728    0.890
H    1.261    0.728   -0.890`,
    },
    {
      name: `drops JSON structure file and updates structure`,
      filename: `nacl.json`,
      mime: `application/json`,
      expect_load_event: true,
      content: JSON.stringify(
        {
          sites: [
            {
              species: [{ element: `Na`, occu: 1, oxidation_state: 0 }],
              xyz: [0, 0, 0],
              abc: [0, 0, 0],
              label: `Na`,
              properties: {},
            },
            {
              species: [{ element: `Cl`, occu: 1, oxidation_state: 0 }],
              xyz: [1.4, 1.4, 1.4],
              abc: [0.5, 0.5, 0.5],
              label: `Cl`,
              properties: {},
            },
          ],
          lattice: {
            matrix: [
              [2.8, 0, 0],
              [0, 2.8, 0],
              [0, 0, 2.8],
            ],
            pbc: [true, true, true],
            a: 2.8,
            b: 2.8,
            c: 2.8,
            alpha: 90,
            beta: 90,
            gamma: 90,
            volume: 21.952,
          },
          charge: 0,
        },
        null,
        2,
      ),
    },
  ]

  for (const { name, filename, content, mime, expect_load_event } of drop_cases) {
    test(name, async ({ page }) => {
      const structure_div = page.locator(`#test-structure`)
      const canvas = structure_div.locator(`canvas`)

      // Wait for canvas to be fully rendered before capturing the baseline
      await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })
      const initial_screenshot = await canvas.screenshot()

      await drop_file(page, structure_div, content, filename, mime)

      if (expect_load_event) {
        await expect(page.locator(`[data-testid="event-calls-status"]`)).toContainText(
          `on_file_load`,
          { timeout: get_canvas_timeout() },
        )
      }

      await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })
      // Poll for canvas change after structure load
      await expect_canvas_changed(canvas, initial_screenshot)
    })
  }

  // Regression: commit 10477bb9 added scene_props.camera_target for comparison-view
  // sync. It persisted across structure loads, causing the orbit center to shift to a
  // corner of the new cell instead of its center. The fix clears camera_target in
  // parse_file_content so rotation_target (unit cell center) takes precedence.
  test(`rotation center resets to new lattice center after file drop`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)
    await expect(canvas).toBeVisible({ timeout: get_canvas_timeout() })

    // Rotate the initial structure (CsCl, ~6.26 Å cubic, center ≈ 3.13)
    // to populate scene_props.camera_target with the old structure's orbit center
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`Canvas has no bounding box`)
    const cx = box.width / 2
    const cy = box.height / 2
    await canvas.dragTo(canvas, {
      sourcePosition: { x: cx - 60, y: cy },
      targetPosition: { x: cx + 60, y: cy },
    })
    await page.waitForTimeout(300)

    // Drop a BaTiO3 POSCAR (4 Å cubic, center = [2, 2, 2])
    const poscar = [
      `BaTiO3\n1.0`,
      `4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0`,
      `Ba Ti O\n1 1 3\nDirect`,
      `0.0 0.0 0.0\n0.5 0.5 0.5\n0.5 0.5 0.0\n0.5 0.0 0.5\n0.0 0.5 0.5`,
    ].join(`\n`)
    const pre_drop = await canvas.screenshot()
    await drop_file(page, structure_div, poscar, `BaTiO3.poscar`)

    // Wait for the new structure to load and render
    await expect_canvas_changed(canvas, pre_drop)
    // Also verify on_file_load fired (confirms parse_file_content ran)
    await expect(page.locator(`[data-testid="event-calls-status"]`)).toContainText(
      `on_file_load`,
      {
        timeout: get_canvas_timeout(),
      },
    )

    // Clear stale camera events from first rotation, then rotate the new structure.
    await clear_events(page)
    const post_load = await canvas.screenshot()
    await canvas.dragTo(canvas, {
      sourcePosition: { x: cx - 80, y: cy },
      targetPosition: { x: cx + 80, y: cy },
    })
    await expect_canvas_changed(canvas, post_load)

    // Orbit target should be near BaTiO3 center [2,2,2], not stale CsCl center [~3.13,~3.13,~3.13]
    const event = await wait_for_event(page, `on_camera_move`, [`camera_target`])
    const camera_target = (event.data as Record<string, unknown>).camera_target as number[]
    expect(camera_target).toEqual(camera_target.map(() => expect.closeTo(2, 0)))
  })
})

test.describe(`Export Button Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Use show_controls=always so buttons are visible and clickable without hover
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`JSON, XYZ, and PNG export buttons trigger downloads`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    for (const title_selector of [`Download JSON`, `Download XYZ`, `PNG`]) {
      const export_btn = export_pane.locator(`button[title*="${title_selector}"]`)
      await expect(export_btn).toBeVisible()
      const [download] = await Promise.all([page.waitForEvent(`download`), export_btn.click()])
      expect(await download.path()).toBeTruthy()
      await expect(export_btn).toBeEnabled()
    }
  })

  test(`DPI input updates PNG export button title`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    const dpi_input = export_pane.locator(`input[title="Export resolution in dots per inch"]`)
    await expect(dpi_input).toBeVisible()
    await expect(dpi_input).toHaveAttribute(`min`, `50`)
    await expect(dpi_input).toHaveAttribute(`max`, `600`)
    expect(Number(await dpi_input.inputValue())).toBeGreaterThanOrEqual(72)

    await dpi_input.fill(`200`)
    await expect(dpi_input).toHaveValue(`200`)
    await expect(export_pane.locator(`button[title*="PNG"]`)).toHaveAttribute(
      `title`,
      /\(200 DPI\)/,
    )
  })
})

test.describe(`Show Buttons Tests`, () => {
  // load the test page with the given show_controls mode, confirm the prop arrived from the
  // URL, and hand back the control-buttons section
  const goto_show_controls = async (page: Page, mode: string): Promise<Locator> => {
    await goto_structure_test(page, `/test/structure?show_controls=${mode}`)
    await expect(page.locator(`[data-testid="show-buttons-status"]`)).toContainText(
      `Show Buttons Status: ${mode}`,
    )
    return page.locator(`#test-structure section.control-buttons`)
  }

  test(`show_controls=never keeps buttons hidden`, async ({ page }) => {
    const control_buttons = await goto_show_controls(page, `never`)
    await expect(control_buttons).not.toHaveClass(/always-visible|hover-visible/)
    await page.locator(`#test-structure`).hover()
    await expect(page.locator(`.structure-info-toggle`)).toBeHidden()
    await expect(page.locator(`.fullscreen-toggle`)).toBeHidden()
  })

  test(`show_controls=hover reveals buttons on hover`, async ({ page }) => {
    const control_buttons = await goto_show_controls(page, `hover`)
    await expect(control_buttons).toHaveClass(/hover-visible/)
    await expect(control_buttons).toHaveCSS(`opacity`, `0`)
    await page.locator(`#test-structure`).hover()
    await expect(control_buttons).toHaveCSS(`opacity`, `1`)
    await expect(page.locator(`.structure-info-toggle`)).toBeVisible()
  })

  test(`show_controls=always keeps buttons visible`, async ({ page }) => {
    const control_buttons = await goto_show_controls(page, `always`)
    await expect(control_buttons).toHaveClass(/always-visible/)
    await expect(control_buttons).toHaveCSS(`opacity`, `1`)
    await expect(page.locator(`.structure-info-toggle`)).toBeVisible()
    await expect(page.locator(`.fullscreen-toggle`)).toBeVisible()
  })
})

test.describe(`Structure Event Handler Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Use show_controls=always so buttons are visible and clickable without hover
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test.describe(`Event Handlers`, () => {
    const wait_for_camera_move = async (
      page: Page,
    ): Promise<{ camera_target: number[]; camera_zoom: number }> => {
      const event = await wait_for_event(page, `on_camera_move`, [
        `camera_target`,
        `camera_zoom`,
      ])
      const { camera_target, camera_zoom } = event.data as {
        camera_target: number[]
        camera_zoom: number
      }
      expect(camera_target.every(Number.isFinite), `camera_target`).toBe(true)
      expect(Number.isFinite(camera_zoom), `camera_zoom`).toBe(true)
      return { camera_target, camera_zoom }
    }

    // scrolled into view because a wheel off-screen scrolls the page instead of reaching
    // the canvas, and because boundingBox() is only meaningful once the canvas is laid out
    const canvas_box = async (page: Page) => {
      const canvas = page.locator(`#test-structure canvas`).first()
      await canvas.scrollIntoViewIfNeeded()
      const box = await canvas.boundingBox()
      if (!box) throw new Error(`Canvas bounding box not found`)
      return { canvas, box }
    }

    const drag_camera = async (page: Page) => {
      const { box } = await canvas_box(page)
      const center_y = box.y + box.height / 2
      await page.mouse.move(box.x + box.width / 2 - 80, center_y)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 80, center_y, { steps: 5 })
      await page.waitForTimeout(250) // cross the 200 ms active-move sync interval
      await page.mouse.up()
      return box
    }

    test(`should trigger on_fullscreen_change event when fullscreen state changes`, async ({
      page,
    }) => {
      const fullscreen_button = page.locator(`#test-structure .fullscreen-toggle`)
      await clear_events(page)
      await fullscreen_button.click()

      const event = await wait_for_event(page, `on_fullscreen_change`, [
        `fullscreen`,
        `structure`,
      ])
      expect(event.data).toMatchObject({ fullscreen: true })
    })

    test(`should trigger on_file_load event when structure is loaded via data_url`, async ({
      page,
    }) => {
      await clear_events(page)
      // Use a valid structure file that exists in the static directory
      await goto_structure_test(page, `/test/structure?data_url=/structures/mp-1.json`)

      await wait_for_event(page, `on_file_load`, [`structure`, `filename`])
    })

    test(`should trigger on_error event when file loading fails`, async ({ page }) => {
      await clear_events(page)
      await page.goto(`/test/structure?data_url=non-existent.json`)

      await wait_for_event(page, `on_error`, [`error_msg`, `filename`])

      // UI should still render gracefully despite the load failure
      await expect(page.locator(`#test-structure`)).toBeVisible()
      await expect(page.locator(`[data-testid="pane-open-status"]`)).toBeVisible()
    })

    test(`camera movement emits distinct on_camera_move events`, async ({ page }) => {
      test.skip(IS_CI, `Camera drag via OrbitControls unreliable in headless CI`)
      await clear_events(page)
      await drag_camera(page)
      await wait_for_camera_move(page)
      const camera_moves = await events_named(page, `on_camera_move`)
      expect(camera_moves.length).toBeGreaterThan(1)
      for (let move_idx = 1; move_idx < camera_moves.length; move_idx++) {
        expect(camera_moves[move_idx].data).not.toEqual(camera_moves[move_idx - 1].data)
      }
    })

    // Nothing dollies a perspective camera's zoom, so it has none to report. The multi-view
    // grid makes this reachable: its primary pane — the one wired to on_camera_move — is the
    // perspective view, and a payload carrying `camera_zoom: undefined` would claim otherwise.
    test(`perspective camera moves omit zoom`, async ({ page }) => {
      test.skip(IS_CI, `Camera drag via OrbitControls unreliable in headless CI`)
      await page.evaluate(() => {
        globalThis.dispatchEvent(
          new CustomEvent(`set-scene-props`, {
            detail: { camera_projection: `perspective` },
          }),
        )
      })
      await clear_events(page)
      await drag_camera(page)
      const move = await wait_for_event(page, `on_camera_move`, [`camera_target`])
      expect(move.data).not.toHaveProperty(`camera_zoom`)
    })

    test(`should trigger on_camera_reset event when camera is reset`, async ({ page }) => {
      test.skip(IS_CI, `Camera drag via OrbitControls unreliable in headless CI`)
      // Move the camera so camera_has_moved flips true and the reset button appears
      await clear_events(page)
      const initial_box = await drag_camera(page)
      const { camera_target: target_before_reset } = await wait_for_camera_move(page)
      await clear_events(page)
      await open_structure_control_pane(page)
      const reset_btn = page.locator(`#test-structure .controls-pane button.reset-camera`)
      await expect(reset_btn).toBeVisible({ timeout: get_canvas_timeout() })
      await reset_btn.click()
      const reset_event = await wait_for_event(page, `on_camera_reset`, [
        `structure`,
        `camera_target`,
        `camera_zoom`,
      ])
      const { camera_target: reset_target, camera_zoom: reset_zoom } = reset_event.data as {
        camera_target: number[]
        camera_zoom: number
      }
      expect(reset_target).toEqual(
        target_before_reset.map((coord) => expect.closeTo(coord, 12)),
      )

      await set_viewer_size(
        page.locator(`#test-structure`),
        Math.round(initial_box.width * 0.65),
        initial_box.height,
      )
      const resized_box = (await canvas_box(page)).box
      await clear_events(page)
      await page.mouse.move(
        resized_box.x + resized_box.width / 2,
        resized_box.y + resized_box.height / 2,
      )
      await page.mouse.wheel(0, -120)
      await wait_for_camera_move(page)
      await clear_events(page)
      await reset_btn.click()
      const resized_reset = await wait_for_event(page, `on_camera_reset`, [`camera_zoom`])
      const { camera_zoom: resized_zoom } = resized_reset.data as { camera_zoom: number }
      expect(resized_zoom / reset_zoom).toBeCloseTo(
        Math.min(resized_box.width, resized_box.height) /
          Math.min(initial_box.width, initial_box.height),
        2,
      )
    })

    test(`click without camera movement does not report a move`, async ({ page }) => {
      const { canvas, box } = await canvas_box(page)
      await clear_events(page)

      await canvas.click({
        position: { x: box.width / 2, y: box.height / 2 },
        force: true,
      })
      await page.waitForTimeout(100) // include the post-end damping settle sync
      expect(await events_named(page, `on_camera_move`)).toHaveLength(0)

      await open_structure_control_pane(page)
      await expect(
        page.locator(`#test-structure .controls-pane button.reset-camera`),
      ).toHaveCount(0)
    })

    // Wheel zoom must leave the orbit target alone: with zoomToCursor the target follows the
    // pointer and zooming back out never returns it, so a few flicks walk the structure into a
    // corner. Zooming also has to register as a camera move — OrbitControls fires start and end
    // in the same tick for a wheel, and the reset control only appears once a move is reported.
    test(`wheel zoom reports during auto-rotate and leaves the orbit target put`, async ({
      page,
    }) => {
      const { box } = await canvas_box(page)
      await page.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent(`set-scene-props`, { detail: { auto_rotate: 1 } }),
        )
      })

      await clear_events(page)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, -120)
      const { camera_target: target_before, camera_zoom: zoom_before } =
        await wait_for_camera_move(page)

      // zoom in and back out far off-center, where cursor zoom would drag the target along
      await clear_events(page)
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8)
      for (const delta of [-120, -120, -120, 120, 120]) await page.mouse.wheel(0, delta)

      const { camera_target: target_after, camera_zoom: zoom_after } =
        await wait_for_camera_move(page)
      expect(zoom_after).toBeGreaterThan(zoom_before)
      for (const [axis_idx, coord] of target_after.entries()) {
        expect(coord, `axis ${axis_idx}`).toBeCloseTo(target_before[axis_idx], 6)
      }

      await open_structure_control_pane(page)
      await expect(
        page.locator(`#test-structure .controls-pane button.reset-camera`),
      ).toBeVisible({ timeout: get_canvas_timeout() })
    })

    test(`pressing r resets the camera; Shift+R does not`, async ({ page }) => {
      test.skip(IS_CI, `Camera drag via OrbitControls unreliable in headless CI`)
      const box = await drag_camera(page)
      await clear_events(page)
      // mouse.move, not hover(): the shortcut only needs the pointer over the viewer, and
      // hover()'s actionability check trips on the overlays the drag leaves behind
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.keyboard.press(`Shift+R`)
      expect(await events_named(page, `on_camera_reset`)).toHaveLength(0)
      await page.keyboard.press(`r`)
      await wait_for_event(page, `on_camera_reset`, [`structure`, `camera_target`])
    })
  })
})

test.describe(`Camera Projection Toggle Tests`, () => {
  // Retry flaky screenshot comparison tests (WebGL rendering timing varies)
  test.describe.configure({ retries: 2 })

  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`camera projection behavior and visual differences`, async ({ page }) => {
    test.setTimeout(IS_CI ? 90_000 : 45_000)
    const canvas = page.locator(`#test-structure canvas`)

    // Test both projections produce different visuals and respond to zoom
    const screenshots: Record<string, Buffer> = {}

    for (const projection of [`perspective`, `orthographic`]) {
      // Re-open the controls pane each iteration (canvas.click closes it via click-outside)
      const { pane_div } = await open_structure_control_pane(page)
      const camera_projection_select = pane_div.locator(`label:has-text("Projection") select`)
      await expect(camera_projection_select).toBeVisible()
      await camera_projection_select.scrollIntoViewIfNeeded()
      await camera_projection_select.selectOption(projection)
      await expect(camera_projection_select).toHaveValue(projection)
      // Let camera/projection updates settle before visual assertions.
      await page.waitForTimeout(100)

      screenshots[`${projection}_initial`] = await canvas_screenshot(canvas)
      await canvas.hover({ force: true })
      await canvas.click({ force: true })
      // Dispatch multiple wheel events to reduce CI flakiness from dropped inputs.
      await page.mouse.wheel(0, -250)
      await page.mouse.wheel(0, -250)
      // Wait for zoom to be applied (screenshot should differ from initial)
      await expect_canvas_changed(canvas, screenshots[`${projection}_initial`])
      screenshots[`${projection}_zoomed`] = await canvas_screenshot(canvas)
    }

    // Verify zoom responsiveness and visual differences
    expect(screenshots.perspective_initial.equals(screenshots.perspective_zoomed)).toBe(false)
    expect(screenshots.orthographic_initial.equals(screenshots.orthographic_zoomed)).toBe(
      false,
    )
    expect(screenshots.perspective_initial.equals(screenshots.orthographic_initial)).toBe(
      false,
    )
  })

  test(`camera projection settings integration and persistence`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const camera_projection_select = pane_div.locator(`label:has-text("Projection") select`)
    const atom_radius_input = pane_div.locator(`label:has-text("Radius") input[type="number"]`)
    const auto_rotate_input = pane_div.locator(
      `label:has-text("Auto-rotate speed") input[type="number"]`,
    )

    // Test 1: Settings preservation across projection changes
    await atom_radius_input.fill(`1.5`)
    await auto_rotate_input.fill(`0.5`)
    await camera_projection_select.selectOption(`orthographic`)

    await expect(atom_radius_input).toHaveValue(`1.5`)
    await expect(auto_rotate_input).toHaveValue(`0.5`)
    await expect(camera_projection_select).toHaveValue(`orthographic`)

    // Test 2: State persistence across pane close/open
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.uncheck()
    await expect(pane_div).not.toHaveClass(/pane-open/)
    // Note: camera-projection-status doesn't update because scene_props binding is one-directional
    // Instead we verify the select value persists after reopening

    await test_page_controls_checkbox.check()
    await expect(pane_div).toHaveClass(/pane-open/, { timeout: 2000 })
    await expect(camera_projection_select).toHaveValue(`orthographic`)
    await expect(atom_radius_input).toHaveValue(`1.5`)
  })

  test.describe(`Structure Controls Reset Functionality`, () => {
    // each section title in the controls pane also carries that section's reset button
    const pane_heading = (page: Page, section: string): Locator =>
      controls_pane_of(page).locator(`h4:has-text("${section}")`)
    const projection_select_of = (page: Page): Locator =>
      controls_pane_of(page).locator(`label:has-text("Projection") select`)
    const show_atoms_checkbox_of = (page: Page): Locator =>
      section_body(pane_heading(page, `Visibility`)).getByLabel(`Atoms`, { exact: true })

    test.beforeEach(async ({ page }: { page: Page }) => {
      // Open structure controls pane
      await open_structure_control_pane(page)
    })

    test(`visibility section reset button appears and works`, async ({ page }) => {
      const visibility_heading = pane_heading(page, `Visibility`)
      const show_atoms_checkbox = show_atoms_checkbox_of(page)
      await show_atoms_checkbox.uncheck()

      // Reset button should appear in Visibility section (within the heading)
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
      await expect(visibility_reset).toBeVisible()
      await expect(visibility_reset).toHaveAttribute(`title`, `Reset visibility to defaults`)
      await expect(visibility_reset).toHaveAttribute(
        `aria-label`,
        `Reset visibility to defaults`,
      )

      await visibility_reset.click()

      await expect(show_atoms_checkbox).toBeChecked()
      // Reset clicks must not propagate to the pane's outside-click handler
      await expect(page.locator(`[data-testid="controls-open-status"]`)).toContainText(`true`)
    })

    test(`camera section reset button appears and works`, async ({ page }) => {
      // Camera has no reset button yet, nothing in the section differs from its default
      const camera_heading = pane_heading(page, `Camera`)
      await camera_heading.scrollIntoViewIfNeeded()
      const camera_reset = camera_heading.locator(`button.reset-button`)

      const projection_select = projection_select_of(page)
      await projection_select.scrollIntoViewIfNeeded()
      const initial_value = await projection_select.inputValue()
      const new_value = initial_value === `perspective` ? `orthographic` : `perspective`
      await projection_select.selectOption(new_value)
      await expect(projection_select).toHaveValue(new_value)

      // Reset button should now appear in Camera section (DOM update, not canvas rendering)
      await expect(camera_reset).toBeVisible({ timeout: 3000 })
      await camera_reset.click()

      // Projection should be back to initial value (the default captured on mount)
      await expect(projection_select).toHaveValue(initial_value)
    })

    // Every section's reset button follows one lifecycle: absent until something in that
    // section differs from its default, then it restores the default and disappears again.
    // Table-driven so a new section costs one row, and so the whole cycle is checked for each
    // — previously most sections only asserted that the button showed up.
    const reset_sections: {
      section: string
      control: string
      change: string
      default_value: string
      reveal?: string // checkbox that must be on before the section renders at all
      // Cell and Background keep their reset button after resetting: the control is back at
      // its default but the section still reads as modified. Pinning the observed behavior
      // per section (rather than skipping the check) keeps the inconsistency visible — if
      // either is fixed, this fails and the flag comes off.
      reset_stays_visible?: boolean
    }[] = [
      {
        section: `Atoms`,
        control: `label:has-text("Radius") input[type="number"]`,
        change: `1.5`,
        default_value: `${DEFAULTS.structure.atom_radius}`,
      },
      {
        section: `Cell`,
        control: `label:has-text("Edge color") + label input[type="number"]`,
        change: `0.8`,
        default_value: `0.3`,
        reset_stays_visible: true,
      },
      {
        section: `Background`,
        control: `label:has-text("Opacity") input[type="number"]`,
        change: `0.5`,
        default_value: `0`,
        reset_stays_visible: true,
      },
      {
        section: `Lighting`,
        control: `label:has-text("Directional light") input[type="number"]`,
        change: `2.5`,
        default_value: `2.2`,
      },
      {
        section: `Labels`,
        control: `label:has-text("Size") input[type="range"]`,
        change: `1.5`,
        default_value: `1`,
        reveal: `label:has-text("Site Labels") input[type="checkbox"]`,
      },
    ]

    for (const row of reset_sections) {
      const { section, control, change, default_value, reveal, reset_stays_visible } = row
      test(`${section} reset restores the section default`, async ({ page }) => {
        if (reveal) await page.locator(reveal).check()

        const heading = pane_heading(page, section)
        await expect(heading).toBeVisible()
        const reset = heading.locator(`button.reset-button`)
        await expect(reset).toBeHidden() // nothing in this section differs from default yet

        const input = section_body(heading).locator(control)
        await input.scrollIntoViewIfNeeded()
        await input.fill(change)

        // DOM update, not canvas rendering — a short timeout is plenty
        await expect(reset).toBeVisible({ timeout: 3000 })
        await reset.click()

        await expect(input).toHaveValue(default_value)
        if (reset_stays_visible) await expect(reset).toBeVisible()
        else await expect(reset).toBeHidden()
      })
    }

    test(`bonds section reset button appears when bonds are shown`, async ({ page }) => {
      const controls_pane = controls_pane_of(page)

      // Enable bonds via the "Bonds:" select in Visibility section
      const show_bonds_select = controls_pane.locator(`label:has-text("Bonds:") select`)
      await show_bonds_select.scrollIntoViewIfNeeded()
      await show_bonds_select.selectOption(`always`)

      // Bonds section and its controls appear once bonds are shown
      const bonds_heading = pane_heading(page, `Bonds`)
      await expect(bonds_heading).toBeVisible({ timeout: 3000 })
      await expect(
        controls_pane.locator(`label:has(select):has-text("Strategy")`),
      ).toBeVisible()
      await expect(
        controls_pane.locator(`label:has(input[type="color"]):has-text("Color")`).last(),
      ).toBeVisible()
      await expect(controls_pane.locator(`label:has-text("Thickness")`)).toBeVisible()

      const strategy_select = controls_pane.locator(`label:has-text("Strategy") select`)
      await strategy_select.scrollIntoViewIfNeeded()
      const initial_value = await strategy_select.inputValue()
      const new_value =
        initial_value === `explicit_only` ? `electroneg_ratio` : `explicit_only`
      await strategy_select.selectOption(new_value)
      await expect(strategy_select).toHaveValue(new_value)

      const bonds_reset = bonds_heading.locator(`button.reset-button`)
      await expect(bonds_reset).toBeVisible({ timeout: 3000 })
      await bonds_reset.click()

      await expect(strategy_select).toHaveValue(initial_value)
    })

    test(`multiple sections can have reset buttons simultaneously`, async ({ page }) => {
      // Change setting in Visibility section
      const visibility_heading = pane_heading(page, `Visibility`)
      const show_atoms_checkbox = show_atoms_checkbox_of(page)
      await show_atoms_checkbox.uncheck()

      // Change setting in Camera section - toggle to opposite of current value
      const camera_heading = pane_heading(page, `Camera`)
      const projection_select = projection_select_of(page)
      await projection_select.scrollIntoViewIfNeeded()
      const initial_projection = await projection_select.inputValue()
      const new_projection =
        initial_projection === `perspective` ? `orthographic` : `perspective`
      await projection_select.selectOption(new_projection)

      // Change setting in Background section - use the specific Opacity label with exact match
      const bg_heading = pane_heading(page, `Background`)
      const bg_opacity_input = section_body(bg_heading).locator(`input[type="number"]`)
      await bg_opacity_input.scrollIntoViewIfNeeded()
      const initial_opacity = await bg_opacity_input.inputValue()
      const new_opacity = initial_opacity === `0.5` ? `0.8` : `0.5`
      await bg_opacity_input.fill(new_opacity)

      // All three reset buttons should be visible (in their respective headings)
      const visibility_reset = visibility_heading.locator(`button.reset-button`)
      const camera_reset = camera_heading.locator(`button.reset-button`)
      const bg_reset = bg_heading.locator(`button.reset-button`)

      // DOM updates, not canvas rendering - use shorter timeout
      await expect(visibility_reset).toBeVisible({ timeout: 3000 })
      await expect(camera_reset).toBeVisible({ timeout: 3000 })
      await expect(bg_reset).toBeVisible({ timeout: 3000 })

      // Reset one section
      await camera_reset.scrollIntoViewIfNeeded()
      await camera_reset.click()

      // Only camera reset should disappear
      await expect(visibility_reset).toBeVisible()
      await expect(camera_reset).toBeHidden()
      await expect(bg_reset).toBeVisible()

      // Projection should be reset to initial, other changes remain
      await expect(projection_select).toHaveValue(initial_projection)
      await expect(show_atoms_checkbox).not.toBeChecked()
      await expect(bg_opacity_input).toHaveValue(new_opacity)
    })
  })
})

test.describe(`Structure Rotation Controls Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  const rotation_axes_of = (pane: Locator) => {
    const axes = pane.locator(`.rotation-axes`)
    return {
      numbers: axes.locator(`input[type="number"]`),
      ranges: axes.locator(`input[type="range"]`),
    }
  }
  const expect_axis_values = async (inputs: Locator, values: string[]): Promise<void> => {
    for (const [axis_idx, value] of values.entries()) {
      await expect(inputs.nth(axis_idx), `axis ${axis_idx}`).toHaveValue(value)
    }
  }

  test(`rotation controls clamp out-of-range values on input`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const { numbers, ranges } = rotation_axes_of(pane_div)
    const x_number_input = numbers.first()
    const x_range_input = ranges.first()

    // The range slider always reflects the clamped then normalized value,
    // even if the number input temporarily shows the raw input
    const clamp_cases = [
      { input: `999`, expected: `0` }, // clamped to 360 → 360 % 360 = 0
      { input: `-90`, expected: `0` }, // negative clamped to 0
      { input: `360`, expected: `0` }, // 360 % 360 = 0
      { input: `359`, expected: `359` }, // stays 359
      { input: `361`, expected: `0` }, // clamped to 360 → 0
      { input: `720`, expected: `0` }, // clamped to 360 → 0
      { input: `180`, expected: `180` }, // valid value passes through
    ]
    for (const { input, expected } of clamp_cases) {
      await x_number_input.fill(input)
      await expect(x_range_input).toHaveValue(expected)
    }

    // Changing the range slider updates the number input
    await x_range_input.fill(`270`)
    await expect(x_number_input).toHaveValue(`270`)
    await expect(x_range_input).toHaveValue(`270`)
  })

  test(`all three axis controls work independently`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const { numbers, ranges } = rotation_axes_of(pane_div)

    await expect(numbers).toHaveCount(3)
    await expect(ranges).toHaveCount(3)
    await expect_axis_values(numbers, [`0`, `0`, `0`])
    await expect_axis_values(ranges, [`0`, `0`, `0`])

    // Set different values for each axis
    for (const [axis_idx, value] of [`30`, `60`, `90`].entries()) {
      await numbers.nth(axis_idx).fill(value)
    }

    // Verify all values are set correctly and independently
    await expect_axis_values(numbers, [`30`, `60`, `90`])
    await expect_axis_values(ranges, [`30`, `60`, `90`])

    // Modify one axis and verify others remain unchanged
    await numbers.nth(1).fill(`120`)
    await expect_axis_values(numbers, [`30`, `120`, `90`])
  })

  test(`rotation controls reset with Camera section reset button`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const { numbers } = rotation_axes_of(pane_div)

    // Set some non-zero values
    for (const [axis_idx, value] of [`45`, `90`, `135`].entries()) {
      await numbers.nth(axis_idx).fill(value)
    }
    await expect_axis_values(numbers, [`45`, `90`, `135`])

    await pane_div.locator(`h4:has-text("Camera")`).locator(`button.reset-button`).click()

    await expect_axis_values(numbers, [`0`, `0`, `0`])
  })

  test(`rotation controls persist across pane close/open`, async ({ page }) => {
    const { pane_div } = await open_structure_control_pane(page)

    const { numbers } = rotation_axes_of(pane_div)

    // Set rotation values
    for (const [axis_idx, value] of [`120`, `240`, `300`].entries()) {
      await numbers.nth(axis_idx).fill(value)
    }

    // Close the pane
    const test_page_controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await test_page_controls_checkbox.uncheck()
    await expect(pane_div).not.toHaveClass(/pane-open/)

    // Reopen the pane
    await test_page_controls_checkbox.check()
    await expect(pane_div).toHaveClass(/pane-open/)

    // Verify values persisted
    await expect_axis_values(numbers, [`120`, `240`, `300`])
  })
})

test.describe(`Element Visibility Toggle`, () => {
  // Retry flaky screenshot comparison tests (WebGL rendering timing varies)
  test.describe.configure({ retries: 2 })

  const legend_item = (page: Page, idx = 0): Locator =>
    page.locator(`#test-structure .atom-legend .legend-item`).nth(idx)

  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page)
  })

  test(`hover chrome reveals repeatedly`, async ({ page }) => {
    // Regression: `viewer_active` was a `$derived(hovered || focused)` reading the $bindable
    // `hovered` prop, which went stale after the first hover/leave cycle so the mode toggle
    // only appeared on the very first mouseenter until page reload.
    await page.setViewportSize({ width: 1400, height: 1200 })
    const toggle = page.locator(`#test-structure .atom-legend .mode-toggle`)
    const box = await page.locator(`#test-structure canvas`).boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)

    for (let cycle = 0; cycle < 3; cycle++) {
      await page.mouse.move(box.x + 40, box.y + 40) // hover the canvas (not the icon)
      await expect(toggle).toHaveCSS(`opacity`, `1`)
      await page.mouse.move(3, 3) // move off the viewer
      await expect(toggle).toHaveCSS(`opacity`, `0`)
    }
  })

  test(`element badge tooltip uses light theme colors`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: `light` })
    await page.locator(`#test-structure`).hover()
    const label = legend_item(page).locator(`label`)
    await label.hover({ force: true })
    const tooltip = page.locator(`.custom-tooltip`)
    await expect(tooltip).toBeVisible()

    const { background_color, text_color } = await tooltip.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        background_color: style.backgroundColor,
        text_color: style.color,
      }
    })

    expect(background_color).not.toMatch(/rgba?\(0,\s*0,\s*0/)
    expect(text_color).not.toMatch(/rgb\(255,\s*255,\s*255\)/)
  })

  test(`toggling elements hides/shows atoms with visual feedback`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const first_item = legend_item(page)
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    // Capture initial state
    const initial_screenshot = await canvas.screenshot()
    const initial_opacity = await opacity_of(label)
    // Initial check - tooltip stores in data-original-title
    await expect(toggle_button).toHaveAttribute(`data-original-title`, /Hide .+ atoms/)

    // Hide element
    await first_item.hover()
    await toggle_button.click()

    // Verify hidden state (assertion includes built-in retry)
    await expect(label).toHaveClass(/hidden/)
    // Poll for canvas change after hiding element
    await expect_canvas_changed(canvas, initial_screenshot)

    // Wait for CSS transition to complete (opacity 0.2s ease)
    await expect(async () => {
      const hidden_opacity = await opacity_of(label)
      expect(hidden_opacity).toBeLessThan(initial_opacity)
      // CSS sets .element-legend label.hidden { opacity: 0.4 }
      expect(hidden_opacity).toBeGreaterThan(0.3)
      expect(hidden_opacity).toBeLessThan(0.5)
    }).toPass({ timeout: 2000 })

    // After toggle, the button should have 'element-hidden' class (indicates atoms are hidden)
    await expect(toggle_button).toHaveClass(/element-hidden/)
    const hidden_screenshot = await canvas.screenshot()

    // Show
    await toggle_button.click()
    await expect(label).not.toHaveClass(/hidden/)
    // Poll for canvas change after showing element
    await expect_canvas_changed(canvas, hidden_screenshot)
  })

  test(`color picker remains functional with toggle button`, async ({ page }) => {
    const label = legend_item(page).locator(`label`)
    const color_input = label.locator(`input[type="color"]`)

    // Verify label is clickable and element remains visible
    await label.click({ position: { x: 10, y: 10 } })
    await expect(label).not.toHaveClass(/hidden/)

    // Test color change functionality
    await color_input.evaluate((input: HTMLInputElement) => {
      input.value = `#ff0000`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
    })
    await expect(color_input).toHaveValue(`#ff0000`)

    // Double-click to reset color
    await label.dblclick({ position: { x: 10, y: 10 } })
    await expect(color_input).not.toHaveValue(`#ff0000`)
    expect((await color_input.inputValue()).length).toBe(7)
  })

  test(`multiple elements work independently`, async ({ page }) => {
    await goto_structure_test(
      page,
      `/test/structure?data_url=/structures/mp-1207297-Ac2Br2O1-tetragonal.json`,
    )
    const canvas = page.locator(`#test-structure canvas`)
    const legend_items = page.locator(`#test-structure .atom-legend .legend-item`)
    await expect(legend_items.nth(1)).toBeAttached()
    const item_count = await legend_items.count()
    expect(item_count).toBeGreaterThanOrEqual(2)

    const initial_screenshot = await canvas.screenshot()
    const first_item = legend_item(page, 0)
    const second_item = legend_item(page, 1)
    const first_label = first_item.locator(`label`)
    const second_label = second_item.locator(`label`)

    // Hide first element
    await first_item.hover()
    await first_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).toHaveClass(/hidden/)
    await expect(second_label).not.toHaveClass(/hidden/)
    await expect_canvas_changed(canvas, initial_screenshot)
    const after_first = await canvas.screenshot()

    // Hide second element
    await second_item.hover()
    await second_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).toHaveClass(/hidden/)
    await expect(second_label).toHaveClass(/hidden/)
    await expect_canvas_changed(canvas, after_first)

    // Show first element only
    await first_item.locator(`button.toggle-visibility`).click()
    await expect(first_label).not.toHaveClass(/hidden/)
    await expect(second_label).toHaveClass(/hidden/)
  })

  test(`hidden state persists and button visibility works`, async ({ page }) => {
    const first_item = legend_item(page)
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    // Button hidden initially
    expect(await opacity_of(toggle_button)).toBe(0)

    // Button visible on hover - wait for opacity to change
    await first_item.hover()
    await expect(async () => {
      expect(await opacity_of(toggle_button)).toBeGreaterThan(0)
    }).toPass({ timeout: get_canvas_timeout() })

    // Hide element
    await toggle_button.click()
    await expect(label).toHaveClass(/hidden/)

    // Button stays visible when element hidden (via element-hidden class which sets opacity: 1)
    await page.mouse.move(0, 0)
    await expect(toggle_button).toHaveClass(/element-hidden/)
    await expect(async () => {
      expect(await opacity_of(toggle_button)).toBeGreaterThan(0.9)
    }).toPass({ timeout: 2000 })

    // Hidden state persists through control pane interactions
    const controls_checkbox = page.locator(
      `label:has-text("Controls Open") input[type="checkbox"]`,
    )
    await controls_checkbox.check()
    await controls_checkbox.uncheck()
    await expect(label).toHaveClass(/hidden/)
  })
})

test.describe(`Edit Atoms Mode`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Edit-atoms tests require WebGL for 3D canvas interactions
    test.skip(IS_CI, `Edit atoms tests require WebGL, skip in CI`)
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  async function select_atom_for_delete(page: Page): Promise<void> {
    await page.locator(`[data-testid="btn-select-site-0"]`).click()
    await page.locator(`#test-structure`).focus()
    await page.keyboard.press(`Delete`)
  }

  const undo_redo_btns = (structure_div: Locator) => ({
    undo: structure_div.locator(`button[aria-label*="Undo"]`),
    redo: structure_div.locator(`button[aria-label*="Redo"]`),
  })

  test(`empty edit-atoms undo redo shortcuts are not canceled`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    const primary_modifier = is_mac ? `metaKey` : `ctrlKey`
    for (const init of [
      { key: `z`, [primary_modifier]: true },
      { key: `y`, [primary_modifier]: true },
      { key: `z`, [primary_modifier]: true, shiftKey: true },
    ]) {
      await expect(dispatch_cancelable_keydown(structure_div, init)).resolves.toBe(true)
    }
  })

  test(`undo/redo buttons hidden in distance/angle modes`, async ({ page }) => {
    // Check default distance mode - no undo/redo buttons
    const structure_div = page.locator(`#test-structure`)
    const { undo: undo_btn } = undo_redo_btns(structure_div)
    await expect(undo_btn).toHaveCount(0)

    // Switch to edit-atoms to verify they appear
    await enter_edit_atoms_mode(page)
    await expect(undo_btn).toBeVisible()

    // Switch back to distance mode via the dropdown
    const measure_button = structure_div.getByRole(`button`, { name: `Measure / Edit` })
    await measure_button.click()
    const distance_option = structure_div.locator(`.view-mode-option`).filter({
      hasText: `Distance`,
    })
    await expect(distance_option).toBeVisible()
    await distance_option.click()
    await expect(undo_btn).toHaveCount(0)
  })

  test(`undo restores state and enables redo`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const { undo: undo_btn, redo: redo_btn } = undo_redo_btns(page.locator(`#test-structure`))
    await expect(undo_btn).toBeDisabled()
    await expect(redo_btn).toBeDisabled()

    await select_atom_for_delete(page)

    // Wait for undo to become available, then click it
    await expect(undo_btn).toBeEnabled({ timeout: 2000 })
    await undo_btn.click({ force: true })

    // Redo should now be enabled
    await expect(redo_btn).toBeEnabled({ timeout: 2000 })
  })

  test(`keyboard shortcuts Ctrl+Z/Y work for undo/redo`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    await select_atom_for_delete(page)

    const { undo: undo_btn, redo: redo_btn } = undo_redo_btns(page.locator(`#test-structure`))
    await expect(undo_btn).toBeEnabled({ timeout: 2000 })

    const undo_combo = is_mac ? `Meta+z` : `Control+z`
    const redo_combo = is_mac ? `Meta+y` : `Control+y`

    // Undo
    await page.keyboard.press(undo_combo)
    await expect(redo_btn).toBeEnabled({ timeout: 2000 })

    // Redo
    await page.keyboard.press(redo_combo)

    // Undo should be enabled (redo just put item back on undo stack)
    await expect(undo_btn).toBeEnabled({ timeout: 2000 })
  })

  test(`add atom via A key shows element input`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    // Focus wrapper for keyboard events
    await structure_div.focus()

    // Press A to enter add-atom mode
    await page.keyboard.press(`a`)

    // Should show element input
    const add_input = structure_div.locator(`.add-atom-input`)
    await expect(add_input).toBeVisible({ timeout: 2000 })

    // Press Escape to cancel
    await page.keyboard.press(`Escape`)
    await expect(add_input).not.toBeVisible({ timeout: 2000 })
  })

  test(`edit mode persists across interactions`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    const { undo: undo_btn } = undo_redo_btns(structure_div)

    // Verify edit mode active
    await expect(undo_btn).toBeVisible({ timeout: 2000 })

    // Click on the canvas
    const canvas = structure_div.locator(`canvas`)
    await canvas.click({ position: { x: 50, y: 50 }, force: true })

    // Undo/redo buttons should still be visible
    await expect(undo_btn).toBeVisible({ timeout: 2000 })
  })

  test(`history count badges show correct counts`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)

    // Initially no count badges
    await expect(structure_div.locator(`.history-count`)).toHaveCount(0)

    // Delete an atom to create history
    await select_atom_for_delete(page)

    // Should show undo count badge with "1"
    const count_badge = structure_div.locator(`.history-count`).first()
    await expect(count_badge).toBeVisible({ timeout: 2000 })
    await expect(count_badge).toHaveText(`1`)
  })
})

test.describe(`Responsive edit controls`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`keeps the bond-edit toolbar inside a narrow viewer on a second row`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    await set_viewer_size(structure_div, 300, 500)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    const edit_toolbar = structure_div.locator(`.edit-mode-toolbar`)
    const [structure_box, controls_box, toolbar_box] = await Promise.all([
      structure_div.boundingBox(),
      structure_div.locator(`section.control-buttons`).boundingBox(),
      edit_toolbar.boundingBox(),
    ])
    if (!structure_box || !controls_box || !toolbar_box) {
      throw new Error(`responsive control boxes were not rendered`)
    }
    expect(toolbar_box.x).toBeGreaterThanOrEqual(structure_box.x - 1)
    expect(toolbar_box.x + toolbar_box.width).toBeLessThanOrEqual(
      structure_box.x + structure_box.width + 1,
    )
    expect(toolbar_box.y).toBeGreaterThanOrEqual(controls_box.y + controls_box.height)
    expect(toolbar_box.y + toolbar_box.height).toBeLessThanOrEqual(
      structure_box.y + structure_box.height + 1,
    )
  })
})

test.describe(`Multi-side view (2x2 grid)`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`collapses and restores multi-view across its responsive size threshold`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    const layout_button = structure_div.getByRole(`button`, {
      name: /^View layout:/,
    })
    await expect(layout_button).toBeVisible()
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    await expect(structure_div).toHaveClass(/multi-view/)

    await set_viewer_size(structure_div, 599, 399)
    await expect(layout_button).toHaveCount(0)
    await expect(structure_div).not.toHaveClass(/multi-view/)

    await set_viewer_size(structure_div, 800, 600)
    await expect(layout_button).toBeVisible()
    await expect(structure_div).toHaveClass(/multi-view/)
  })

  // Both grid tests below drive interactions that only settle once the panes have painted.
  // On CI's software WebGPU — an adapter that hands out a device but composites nothing — the
  // layout never finishes switching back and the cell-select dropdown never opens, while every
  // structural assertion around them passes. Gated on IS_CI rather than a pixel probe because
  // the byte-size heuristic tried earlier reported a blank 800x500 canvas as painted.
  const GRID_NEEDS_PIXELS = `grid interactions need a composited frame, unavailable in CI`

  test(`toggle splits canvas into 4 viewports and back`, async ({ page }) => {
    test.skip(IS_CI, GRID_NEEDS_PIXELS)
    // each sweep probe costs a frame, and a frame here draws all 4 panes (~1 min under load)
    test.setTimeout(IS_CI ? 180_000 : 120_000)
    const structure_div = page.locator(`#test-structure`)

    // Handle spread on screen, which scales with the gizmo box — the only way to measure a
    // gizmo with no DOM element. Hover first since it draws only while the viewer is active.
    const gizmo_span = async (canvas: Locator): Promise<number> => {
      const box = await canvas.boundingBox()
      if (!box) throw new Error(`canvas has no bounding box`)
      await page.mouse.move(box.x + 40, box.y + 40)
      await expect(page.locator(`#test-structure .atom-legend .mode-toggle`)).toHaveCSS(
        `opacity`,
        `1`,
      )
      const hits = await sweep_gizmo_handles(canvas)
      expect(hits.length, `gizmo handles on this canvas`).toBeGreaterThan(0)
      const xs = hits.map((hit) => hit.x)
      const ys = hits.map((hit) => hit.y)
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    }

    // Single view: one viewport cell, no grid
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
    await expect(structure_div.locator(`.viewport-stage.multi`)).toHaveCount(0)
    const single_span = await gizmo_span(structure_div.locator(`canvas`).first())

    await select_structure_layout(structure_div, `3D 2×2 grid`)

    // The primary perspective pane stays unlabeled so the global filename can use
    // the top-left corner; the three fixed-direction panes retain their labels.
    await expect(structure_div).toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-stage.multi`)).toBeVisible()
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(4)
    await expect(structure_div.locator(`.viewport-stage.multi canvas`)).toHaveCount(4, {
      timeout: get_canvas_timeout(),
    })
    const labels = structure_div.locator(`.viewport-label`)
    await expect(labels).toHaveCount(3)
    await expect(labels.nth(0)).toHaveText(`Front`)

    // Each pane occupies roughly a quarter of the viewer (clearly smaller than full width)
    const wrapper_box = await structure_div.boundingBox()
    if (!wrapper_box) throw new Error(`structure wrapper has no bounding box`)
    for (let pane_idx = 0; pane_idx < 4; pane_idx++) {
      await expect
        .poll(async () => {
          const cell_box = await structure_div
            .locator(`.viewport-cell`)
            .nth(pane_idx)
            .boundingBox()
          return cell_box?.width ?? Number.POSITIVE_INFINITY
        })
        .toBeLessThan(wrapper_box.width * 0.75)
      const cell_box = await structure_div
        .locator(`.viewport-cell`)
        .nth(pane_idx)
        .boundingBox()
      if (!cell_box) throw new Error(`viewport cell ${pane_idx} has no bounding box`)
      expect(cell_box.width).toBeGreaterThan(50)
    }

    // Panes are ~half the viewer, so StructureViewport hands them a smaller gizmo. Ties
    // responsive_gizmo_size (unit-tested) to what renders, now that the old `.responsive-gizmo`
    // DOM box is gone with three-viewport-gizmo's HTML overlay.
    const pane_span = await gizmo_span(
      structure_div.locator(`.viewport-stage.multi canvas`).first(),
    )
    expect(pane_span).toBeLessThan(single_span * 0.8)

    // Toggle back to single view
    await select_structure_layout(structure_div, `3D single view`)
    await expect(structure_div).not.toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-stage.multi`)).toHaveCount(0)
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
    await expect(structure_div.locator(`canvas`)).toHaveCount(1, {
      timeout: get_canvas_timeout(),
    })
  })

  test(`legend controls stay interactive above active grid panes`, async ({ page }) => {
    test.skip(IS_CI, GRID_NEEDS_PIXELS)
    const structure_div = page.locator(`#test-structure`)
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    const cells = structure_div.locator(`.viewport-cell`)
    await cells.nth(3).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(3)).toHaveClass(/active/)

    const receives_pointer_at_center = (locator: Locator): Promise<boolean> =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const topmost = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        return topmost !== null && element.contains(topmost)
      })

    const cell_select = structure_div.locator(`.cell-select`)
    const cell_toggle = cell_select.locator(`.toggle-btn`)
    const element_badge = structure_div.locator(`.atom-legend .legend-item label`).first()
    await expect(cell_select).toHaveCSS(`opacity`, `1`)
    expect(await receives_pointer_at_center(cell_toggle)).toBe(true)
    expect(await receives_pointer_at_center(element_badge)).toBe(true)
    await cell_toggle.click()
    await expect(cell_select.locator(`.dropdown`)).toBeVisible()
  })

  test(`Cmd/Ctrl+G toggles between grid and single view`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.focus() // viewer must be focused to receive the shortcut
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)

    const grid_shortcut = `${is_mac ? `Meta` : `Control`}+g`
    await page.keyboard.press(grid_shortcut)
    await expect(structure_div).toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(4)

    await page.keyboard.press(grid_shortcut)
    await expect(structure_div).not.toHaveClass(/multi-view/)
    await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
  })

  // Regression: the hover tooltip must be able to overflow its own pane into
  // neighboring panes instead of being clipped/occluded by them. Only the active
  // pane is allowed to overflow (and is raised above siblings); inactive panes clip.
  test(`active pane allows tooltip overflow, inactive panes clip`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    const cells = structure_div.locator(`.viewport-cell`)
    await expect(cells).toHaveCount(4)

    const overflow_of = (idx: number) =>
      cells.nth(idx).evaluate((node) => getComputedStyle(node).overflow)

    // Activate pane 0 explicitly: selecting the dropdown option may leave the pointer
    // over another pane when the menu closes.
    await cells.nth(0).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(0)).toHaveClass(/active/)
    expect(await overflow_of(0)).toBe(`visible`)
    expect(await cells.nth(0).evaluate((node) => getComputedStyle(node).zIndex)).toBe(`1`)
    expect(await overflow_of(1)).toBe(`hidden`)

    // Activating another pane moves the overflow allowance to it
    await cells.nth(2).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(2)).toHaveClass(/active/)
    expect(await overflow_of(2)).toBe(`visible`)
    expect(await overflow_of(0)).toBe(`hidden`)
  })

  test(`repeated toggling settles on the right canvas count without leaking contexts`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas_timeout = get_canvas_timeout()

    for (let cycle = 0; cycle < 3; cycle++) {
      await select_structure_layout(structure_div, `3D 2×2 grid`)
      await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(4)
      await expect(structure_div.locator(`.viewport-stage.multi canvas`)).toHaveCount(4, {
        timeout: canvas_timeout,
      })
      await select_structure_layout(structure_div, `3D single view`)
      await expect(structure_div.locator(`.viewport-cell`)).toHaveCount(1)
      await expect(structure_div.locator(`canvas`)).toHaveCount(1, {
        timeout: canvas_timeout,
      })
    }
  })
})
