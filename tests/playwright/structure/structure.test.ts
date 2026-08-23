import { expect, type Locator, type Page, test } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import { gzipSync } from 'node:zlib'
import {
  canvas_box,
  canvas_screenshot,
  dispatch_cancelable_keydown,
  drag_canvas,
  drop_file,
  enter_edit_atoms_mode,
  expect_canvas_changed,
  expect_canvas_changed_by,
  get_canvas_timeout,
  goto_structure_test,
  IS_CI,
  open_structure_control_pane,
  open_structure_export_pane,
  primary_modifier,
  primary_modifier_key,
  require_bbox,
  select_view_layout as select_structure_layout,
  set_scene_props,
  structure_canvas,
  sweep_gizmo_handles,
} from '../helpers'

const section_body = (pane: Locator, title: string): Locator =>
  pane.getByRole(`region`, { name: title, exact: true })
const opacity_of = (locator: Locator): Promise<number> =>
  locator.evaluate((element) => Number(getComputedStyle(element).opacity))

type EventCall = { event: string; data?: unknown }
const clear_events = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const event_calls = Reflect.get(globalThis, `event_calls`)
    if (!Array.isArray(event_calls)) throw new Error(`event_calls is unavailable`)
    event_calls.length = 0
  })
const events_named = async (page: Page, event_name: string): Promise<EventCall[]> =>
  (
    await page.evaluate(
      () => (Reflect.get(globalThis, `event_calls`) as EventCall[] | undefined) ?? [],
    )
  ).filter(({ event }) => event === event_name)
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
// The gizmo and legend chrome only draw while the viewer is active, so hover the canvas
// (clear of the chrome) and wait for the legend's mode toggle to fade in
const activate_viewer = async (page: Page, canvas: Locator): Promise<void> => {
  const box = await canvas_box(canvas)
  await page.mouse.move(box.x + 40, box.y + 40)
  await expect(page.locator(`#test-structure .atom-legend .mode-toggle`)).toHaveCSS(
    `opacity`,
    `1`,
  )
}

// BaTiO3 perovskite POSCAR, 4 Å cubic unless the c axis is stretched
const batio3_poscar = (c = 4.0) =>
  `BaTiO3
1.0
4.0 0.0 0.0
0.0 4.0 0.0
0.0 0.0 ${c}
Ba Ti O
1 1 3
Direct
0.0 0.0 0.0
0.5 0.5 0.5
0.5 0.5 0.0
0.5 0.0 0.5
0.0 0.5 0.5`

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

test.describe(`compressed source URL`, () => {
  const routes = [
    [`/structure`, `h3`],
    [`/structure/symmetry`, `h2`],
  ]
  for (const [route_path, heading_tag] of routes) {
    test(`${route_path} keeps the compressed source URL after loading`, async ({ page }) => {
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
    })
  }
})

test.describe(`Structure Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page)
  })

  test(`settings pane reflows inside a narrow two-column comparison`, async ({ page }) => {
    await goto_structure_test(page, `/test/structure?comparison=true&show_controls=always`)
    const comparison = page.locator(`.structure-test-layout.comparison`)
    await expect(comparison.locator(`.structure`)).toHaveCount(2)

    const structure = comparison.locator(`#test-structure`)
    await structure.getByRole(`button`, { name: `Structure controls` }).click()
    const pane = structure.locator(`.controls-pane`)
    await expect(pane).toBeVisible()

    await expect
      .poll(() =>
        pane.evaluate((pane_element) => {
          const viewer = pane_element.closest(`.structure`)
          const content = pane_element.querySelector(`.pane-content`)
          const control_tab = pane_element.querySelector(`.control-tab`)
          if (!viewer || !content || !control_tab) throw new Error(`Incomplete pane geometry`)
          const viewer_rect = viewer.getBoundingClientRect()
          const pane_rect = pane_element.getBoundingClientRect()
          const tab_rect = control_tab.getBoundingClientRect()
          return {
            narrow: viewer_rect.width < 420,
            contained:
              pane_rect.left >= viewer_rect.left - 1 &&
              Math.max(pane_rect.right, tab_rect.right) <= viewer_rect.right + 1,
            reflowed: content.scrollWidth <= content.clientWidth,
          }
        }),
      )
      .toEqual({ narrow: true, contained: true, reflowed: true })
  })

  test(`measure mode controls visible by default and hide when disabled`, async ({ page }) => {
    const measure_dropdown = page.locator(`#test-structure .measure-mode-dropdown`)
    await expect(measure_dropdown).toBeVisible()

    await goto_structure_test(page, `/test/structure?enable_measure_mode=false`)
    await expect(measure_dropdown).toHaveCount(0)
  })

  test(`CellSelect appears on hover and hides on mouse leave`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)
    const supercell = structure.locator(`.cell-select`)

    await expect(supercell).toHaveCSS(`opacity`, `0`)
    await structure.hover()
    await expect(supercell).toHaveCSS(`opacity`, `1`)
    await page.mouse.move(0, 0)
    await expect(supercell).toHaveCSS(`opacity`, `0`)
  })

  test(`CellSelect toggle has an opaque theme-aware surface`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)
    const toggle = structure.locator(`.cell-select .toggle-btn`)
    // color-mix() may serialize as oklab()/color(srgb …); rgb() omits alpha when opaque.
    const is_opaque_css_color = (value: string): boolean => {
      if (value === `transparent`) return false
      if (
        value.startsWith(`oklab(`) ||
        value.startsWith(`oklch(`) ||
        value.startsWith(`color(`)
      ) {
        const alpha_part = value.split(`/`)[1]
        if (!alpha_part) return true
        return Number(alpha_part.replace(`)`, ``).trim()) === 1
      }
      const match = /rgba?\((?<channels>[^)]+)\)/u.exec(value)
      if (!match) return false
      const parts = match[1].split(`,`).map((part) => Number(part.trim()))
      return parts.length === 3 || parts[3] === 1
    }
    // Resolve --cell-select-hover-surface without needing a real :hover (pointer-events
    // on .cell-select is none until the structure is hovered).
    const hover_surface_of = (): Promise<string> =>
      toggle.evaluate((el) => {
        const cell = el.closest(`.cell-select`)
        if (!(cell instanceof HTMLElement)) throw new Error(`missing .cell-select`)
        const probe = document.createElement(`div`)
        cell.append(probe)
        probe.style.backgroundColor = `var(--cell-select-hover-surface)`
        const background = getComputedStyle(probe).backgroundColor
        probe.remove()
        return background
      })
    const background_of = () => toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
    const backgrounds: string[] = []
    for (const color_scheme of [`light`, `dark`] as const) {
      await page.evaluate((scheme) => {
        document.documentElement.style.colorScheme = scheme
      }, color_scheme)
      await expect.poll(background_of).not.toBe(backgrounds.at(-1))
      const background = await background_of()
      expect(is_opaque_css_color(background), `${color_scheme} background`).toBe(true)
      const hover_bg = await hover_surface_of()
      expect(is_opaque_css_color(hover_bg), `${color_scheme} hover surface`).toBe(true)
      expect(hover_bg).not.toBe(background)
      backgrounds.push(background)
    }
  })

  test(`CellSelect typography stays legible in narrow legends`, async ({ page }) => {
    const structure = page.locator(`#test-structure`)
    await structure.evaluate((el) => el.style.setProperty(`--struct-min-width`, `0`))
    await set_viewer_size(structure, 260, 400)
    await expect.poll(() => structure.evaluate((el) => el.clientWidth)).toBeLessThan(300)
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

    expect(toggle_size).toBeCloseTo(legend_label_size, 1)
    expect(preset_size).toBeGreaterThanOrEqual(legend_label_size)
  })

  test(`reacts to background_color prop change from test page`, async ({ page }) => {
    const background_color_input = page.locator(
      `section:has-text("Controls for Test Page") label:has-text("Background Color") input[type="color"]`,
    )
    await background_color_input.fill(`#ff0000`)
    await expect(page.locator(`#test-structure`)).toHaveCSS(
      `background-color`,
      `rgba(255, 0, 0, 0.1)`,
      { timeout: get_canvas_timeout() },
    )
  })

  test(`keyboard shortcuts require modifier keys`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await structure_div.click()

    // single keys don't trigger actions: not fullscreen after 'f'
    await page.keyboard.press(`f`)
    await page.keyboard.press(`i`)
    expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false)

    for (const key of [`f`, `i`]) {
      await expect(
        dispatch_cancelable_keydown(structure_div, { key, [primary_modifier]: true }),
      ).resolves.toBe(false)
    }

    // The renderer remains mounted after the keyboard interactions. Do not assert on unrelated
    // page errors here: CI's SwiftShader adapter can report transient GPU allocation failures.
    await expect(structure_div.locator(`canvas`)).toBeVisible()
  })

  test(`dragging the canvas orbits the camera`, async ({ page }) => {
    const canvas = structure_canvas(page)
    // Reset lives in the controls pane and is hidden at the default camera
    await expect(page.locator(`#test-structure button.reset-camera`)).toBeHidden()
    await expect_canvas_changed_by(canvas, () => drag_canvas(canvas, { dx: 200 }))
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
    const canvas = structure_canvas(page)
    await activate_viewer(page, canvas)

    const handles = await sweep_gizmo_handles(canvas)
    expect(handles.length, `gizmo handles under the pointer`).toBeGreaterThan(0)
    // A sweep can include edge pixels that only hover a handle, so try up to three candidates
    // and accept the first whose click reports a camera move.
    const candidates = [handles[0], handles[Math.floor(handles.length / 2)], handles.at(-1)]
    let camera_position: unknown
    for (const candidate of candidates) {
      if (!candidate) continue
      await page.mouse.move(candidate.x, candidate.y)
      await clear_events(page)
      await page.mouse.click(candidate.x, candidate.y)
      try {
        const event = await wait_for_event(page, `on_camera_move`, [`camera_position`], 1500)
        camera_position = (event.data as Record<string, unknown>).camera_position
        break
      } catch {
        // next candidate
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
        // exact match to avoid matching "Image atoms"
        name: `show atoms checkbox`,
        input: control_pane.getByRole(`checkbox`, { name: `Atoms`, exact: true }),
        act: (input) => input.click(),
      },
      {
        // Bonds visibility is a native select in the Visibility section. Matched on the
        // label's own span: a label's text also carries every <option>, so "has text Bonds"
        // alone would not distinguish it.
        name: `bonds select`,
        input: control_pane.locator(`label:has(span:text-is("Bonds")) select`),
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
        name: `background color`,
        input: section_body(control_pane, `Background`).locator(`input[type="color"]`),
        act: (input) => input.fill(`#00ff00`),
      },
    ]

    // Download buttons are left out: they may close the pane through the download itself
    for (const { name, input, act } of interactions) {
      await expect(input, name).toBeVisible()
      await act(input)
      await expect(controls_open_status, name).toContainText(`true`)
      await expect(control_pane, name).toHaveClass(/pane-open/)
    }
  })

  test(`control inputs have intended effects on structure`, async ({ page }) => {
    const { pane_div: control_pane } = await open_structure_control_pane(page)
    const canvas = structure_canvas(page)

    const atom_radius_input = control_pane
      .locator(`label`)
      .filter({ hasText: /Radius/ })
      .locator(`input[type="number"]`)
    await expect_canvas_changed_by(canvas, () => atom_radius_input.fill(`0.3`))

    const show_atoms_checkbox = section_body(control_pane, `Visibility`)
      .locator(`input[type="checkbox"]`)
      .first()
    await expect_canvas_changed_by(canvas, () => show_atoms_checkbox.uncheck())
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

    await expect(controls_toggle_button).toHaveAttribute(`aria-label`, `Structure controls`)
  })

  test(`selected_sites controls highlight spheres (no labels/lines)`, async ({ page }) => {
    const canvas = structure_canvas(page)
    const labels = page.locator(`.selection-label`)
    await expect_canvas_changed_by(canvas, () =>
      page.locator(`[data-testid="btn-set-selected"]`).click(),
    )
    await expect(labels).toHaveCount(0)
    await expect_canvas_changed_by(canvas, () =>
      page.locator(`[data-testid="btn-clear-selected"]`).click(),
    )
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
    // measured sites also set selected_sites, which drive the selection labels
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    const labels = page.locator(`.selection-label`)
    await expect(labels).toHaveCount(3)

    const reset_button = page.locator(
      `#test-structure button[aria-label="Reset selection and bond edits"]`,
    )
    await expect(reset_button).toBeVisible()
    await reset_button.click()

    // labels (and the pulsating animation they share a source with) clear, and the reset
    // button leaves with the now-empty measured_sites
    await expect(labels).toHaveCount(0)
    await expect(reset_button).toBeHidden()
  })

  test(`selections are cleared on supercell scaling and image atoms toggle`, async ({
    page,
  }) => {
    const labels = page.locator(`.selection-label`)
    const supercell_input = page.locator(`[data-testid="supercell-input"]`)

    // Supercell scaling clears selections
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)
    await supercell_input.fill(`2x2x2`)
    await expect(labels).toHaveCount(0)

    // Image atoms toggle clears selections
    await supercell_input.fill(`1x1x1`)
    await page.locator(`[data-testid="btn-set-measured"]`).click()
    await expect(labels).toHaveCount(3)
    await page.locator(`[data-testid="image-atoms-checkbox"]`).click()
    await expect(labels).toHaveCount(0)
  })

  test(`camera projection behavior and visual differences`, async ({ page }) => {
    test.setTimeout(IS_CI ? 90_000 : 45_000)
    const canvas = structure_canvas(page)

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
})

test.describe(`File Drop Functionality Tests`, () => {
  // File drop tests use synthetic DataTransfer events which are unreliable in headless CI
  // Keep skipped - these work locally but not in CI due to browser security restrictions
  test.beforeEach(async ({ page }) => {
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
      content: batio3_poscar(4.1),
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
      await expect_canvas_changed_by(structure_div.locator(`canvas`), async () => {
        await drop_file(page, structure_div, content, filename, mime)
        if (expect_load_event) await wait_for_event(page, `on_file_load`, [])
      })
    })
  }

  // Regression: commit 10477bb9 added scene_props.camera_target for comparison-view
  // sync. It persisted across structure loads, causing the orbit center to shift to a
  // corner of the new cell instead of its center. The fix clears camera_target in
  // parse_file_content so rotation_target (unit cell center) takes precedence.
  test(`rotation center resets to new lattice center after file drop`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const canvas = structure_div.locator(`canvas`)

    // Rotate the initial structure (CsCl, ~6.26 Å cubic, center ≈ 3.13)
    // to populate scene_props.camera_target with the old structure's orbit center
    await expect_canvas_changed_by(canvas, () => drag_canvas(canvas, { dx: 120 }))
    await wait_for_event(page, `on_camera_move`, [`camera_target`])

    // Drop a BaTiO3 POSCAR (4 Å cubic, center = [2, 2, 2]) and wait for it to load and render
    await expect_canvas_changed_by(canvas, async () => {
      await drop_file(page, structure_div, batio3_poscar(), `BaTiO3.poscar`)
      await wait_for_event(page, `on_file_load`, []) // confirms parse_file_content ran
    })

    // Clear stale camera events from first rotation, then rotate the new structure.
    await clear_events(page)
    await expect_canvas_changed_by(canvas, () => drag_canvas(canvas, { dx: 160 }))

    // Orbit target should be near BaTiO3 center [2,2,2], not stale CsCl center [~3.13,~3.13,~3.13]
    const event = await wait_for_event(page, `on_camera_move`, [`camera_target`])
    const camera_target = (event.data as Record<string, unknown>).camera_target as number[]
    expect(camera_target).toEqual(camera_target.map(() => expect.closeTo(2, 0)))
  })
})

test.describe(`Export Button Tests`, () => {
  test.beforeEach(async ({ page }) => {
    // Use show_controls=always so buttons are visible and clickable without hover
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`JSON, XYZ, and PNG export buttons trigger downloads`, async ({ page }) => {
    const { pane_div: export_pane } = await open_structure_export_pane(page)

    const export_cases = [
      { title_selector: `Download JSON`, extension: `.json` },
      { title_selector: `Download XYZ`, extension: `.xyz` },
      { title_selector: `PNG`, extension: `.png` },
    ]
    for (const { title_selector, extension } of export_cases) {
      const export_btn = export_pane.locator(`button[title*="${title_selector}"]`)
      await expect(export_btn).toBeVisible()
      // Cap each wait: a hung GPU toBlob used to burn the whole 90s test budget on PNG.
      const [download] = await Promise.all([
        page.waitForEvent(`download`, { timeout: 20_000 }),
        export_btn.click(),
      ])
      expect(await download.path()).toBeTruthy()
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\${extension}$`, `u`))
      await expect(export_btn).toBeEnabled()
    }
  })
})

test.describe(`Show Buttons Tests`, () => {
  // control-buttons opacity before and after hovering the viewer (`never` renders no toggles)
  const show_controls_cases = [
    { mode: `never`, css_class: null, opacity: null },
    { mode: `hover`, css_class: `hover-visible`, opacity: [`0`, `1`] },
    { mode: `always`, css_class: `always-visible`, opacity: [`1`, `1`] },
  ]
  for (const { mode, css_class, opacity } of show_controls_cases) {
    test(`show_controls=${mode} reveals buttons ${mode}`, async ({ page }) => {
      await goto_structure_test(page, `/test/structure?show_controls=${mode}`)
      const control_buttons = page.locator(`#test-structure section.control-buttons`)
      const info_toggle = page.locator(`.structure-info-toggle`)
      if (css_class) await expect(control_buttons).toHaveClass(new RegExp(css_class))
      else await expect(control_buttons).not.toHaveClass(/always-visible|hover-visible/)
      if (opacity) await expect(control_buttons).toHaveCSS(`opacity`, opacity[0])
      await page.locator(`#test-structure`).hover()
      if (opacity) {
        await expect(control_buttons).toHaveCSS(`opacity`, opacity[1])
        await expect(info_toggle).toBeVisible()
      } else await expect(info_toggle).toBeHidden()
    })
  }
})

test.describe(`Structure Event Handler Tests`, () => {
  test.beforeEach(async ({ page }) => {
    // Use show_controls=always so buttons are visible and clickable without hover
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

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

  const drag_camera = async (page: Page) => {
    const box = await canvas_box(structure_canvas(page))
    const center_y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2 - 80, center_y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 80, center_y, { steps: 5 })
    await page.waitForTimeout(250) // cross the 200 ms active-move sync interval
    await page.mouse.up()
    return box
  }
  const reset_camera_button = (page: Page) =>
    page.locator(`#test-structure .controls-pane button.reset-camera`)

  test(`should trigger on_fullscreen_change event when fullscreen state changes`, async ({
    page,
  }) => {
    await clear_events(page)
    await page.locator(`#test-structure > section.control-buttons > .fullscreen-btn`).click()

    const event = await wait_for_event(page, `on_fullscreen_change`, [
      `fullscreen`,
      `structure`,
    ])
    expect(event.data).toMatchObject({ fullscreen: true })
  })

  test(`should trigger on_file_load event when structure is loaded via data_url`, async ({
    page,
  }) => {
    // Use a valid structure file that exists in the static directory
    await goto_structure_test(page, `/test/structure?data_url=/structures/mp-1.json`)
    await wait_for_event(page, `on_file_load`, [`structure`, `filename`])
  })

  test(`should trigger on_error event when file loading fails`, async ({ page }) => {
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
    await set_scene_props(page, { camera_projection: `perspective` })
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
    const reset_btn = reset_camera_button(page)
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
    expect(reset_target).toEqual(target_before_reset.map((coord) => expect.closeTo(coord, 12)))

    await set_viewer_size(
      page.locator(`#test-structure`),
      Math.round(initial_box.width * 0.65),
      initial_box.height,
    )
    const resized_box = await canvas_box(structure_canvas(page))
    await clear_events(page)
    // Wheel over the canvas's left edge, not its center: the open pane is anchored to the
    // viewer's right side and covers the middle, where the scroll would go to the pane.
    await page.mouse.move(
      resized_box.x + resized_box.width * 0.15,
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
    const canvas = structure_canvas(page)
    const box = await canvas_box(canvas)
    await clear_events(page)

    await canvas.click({
      position: { x: box.width / 2, y: box.height / 2 },
      force: true,
    })
    await page.waitForTimeout(100) // include the post-end damping settle sync
    expect(await events_named(page, `on_camera_move`)).toHaveLength(0)

    await open_structure_control_pane(page)
    await expect(reset_camera_button(page)).toHaveCount(0)
  })

  // Wheel zoom must leave the orbit target alone: with zoomToCursor the target follows the
  // pointer and zooming back out never returns it, so a few flicks walk the structure into a
  // corner. Zooming also has to register as a camera move — OrbitControls fires start and end
  // in the same tick for a wheel, and the reset control only appears once a move is reported.
  test(`wheel zoom reports during auto-rotate and leaves the orbit target put`, async ({
    page,
  }) => {
    const canvas = structure_canvas(page)
    const box = await canvas_box(canvas)
    const wheel = (x_ratio: number, y_ratio: number, delta_y: number) =>
      canvas.dispatchEvent(`wheel`, {
        bubbles: true,
        cancelable: true,
        clientX: box.x + box.width * x_ratio,
        clientY: box.y + box.height * y_ratio,
        deltaY: delta_y,
      })
    await set_scene_props(page, { auto_rotate: 1 })

    await clear_events(page)
    await wheel(0.5, 0.5, -120)
    const { camera_target: target_before, camera_zoom: zoom_before } =
      await wait_for_camera_move(page)

    // zoom in and back out far off-center, where cursor zoom would drag the target along
    await clear_events(page)
    for (const delta of [-120, -120, -120, 120, 120]) await wheel(0.8, 0.8, delta)

    const { camera_target: target_after, camera_zoom: zoom_after } =
      await wait_for_camera_move(page)
    expect(zoom_after).toBeGreaterThan(zoom_before)
    for (const [axis_idx, coord] of target_after.entries()) {
      expect(coord, `axis ${axis_idx}`).toBeCloseTo(target_before[axis_idx], 6)
    }

    await open_structure_control_pane(page)
    await expect(reset_camera_button(page)).toBeVisible({ timeout: get_canvas_timeout() })
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

test.describe(`Element Visibility Toggle`, () => {
  const legend_item = (page: Page, idx = 0): Locator =>
    page.locator(`#test-structure .atom-legend .legend-item`).nth(idx)

  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page)
  })

  test(`hover chrome reveals repeatedly`, async ({ page }) => {
    // Regression: `viewer_active` was a `$derived(hovered || focused)` reading the $bindable
    // `hovered` prop, which went stale after the first hover/leave cycle so the mode toggle
    // only appeared on the very first mouseenter until page reload.
    await page.setViewportSize({ width: 1400, height: 1200 })
    const toggle = page.locator(`#test-structure .atom-legend .mode-toggle`)
    const canvas = structure_canvas(page)

    for (let cycle = 0; cycle < 3; cycle++) {
      await activate_viewer(page, canvas)
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
    const canvas = structure_canvas(page)
    const first_item = legend_item(page)
    const toggle_button = first_item.locator(`button.toggle-visibility`)
    const label = first_item.locator(`label`)

    const initial_opacity = await opacity_of(label)
    await expect(toggle_button).toHaveAttribute(`aria-label`, /Hide .+ atoms/)

    // Hide element
    await expect_canvas_changed_by(canvas, async () => {
      await first_item.hover()
      await toggle_button.click()
      await expect(label).toHaveClass(/hidden/)
    })

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

    // Show
    await expect_canvas_changed_by(canvas, async () => {
      await toggle_button.click()
      await expect(label).not.toHaveClass(/hidden/)
    })
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
  test.beforeEach(async ({ page }) => {
    // Edit-atoms tests require WebGL for 3D canvas interactions
    test.skip(IS_CI, `Edit atoms tests require WebGL, skip in CI`)
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  const undo_redo_btns = (structure_div: Locator) => ({
    undo: structure_div.locator(`button[aria-label*="Undo"]`),
    redo: structure_div.locator(`button[aria-label*="Redo"]`),
  })

  test(`empty edit-atoms undo redo shortcuts are not canceled`, async ({ page }) => {
    await enter_edit_atoms_mode(page)

    const structure_div = page.locator(`#test-structure`)
    for (const init of [
      { key: `z`, [primary_modifier]: true },
      { key: `y`, [primary_modifier]: true },
      { key: `z`, [primary_modifier]: true, shiftKey: true },
    ]) {
      await expect(dispatch_cancelable_keydown(structure_div, init)).resolves.toBe(true)
    }
  })

  test(`undo/redo buttons only exist in edit-atoms mode`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    const { undo: undo_btn } = undo_redo_btns(structure_div)
    await expect(undo_btn).toHaveCount(0)

    await enter_edit_atoms_mode(page)
    await expect(undo_btn).toBeVisible()
    // clicking the canvas keeps edit mode active
    await structure_div.locator(`canvas`).click({ position: { x: 50, y: 50 }, force: true })
    await expect(undo_btn).toBeVisible()

    // Switch back to distance mode via the dropdown
    await structure_div.getByRole(`button`, { name: `Measure / Edit` }).click()
    const distance_option = structure_div.locator(`.view-mode-option`).filter({
      hasText: `Distance`,
    })
    await expect(distance_option).toBeVisible()
    await distance_option.click()
    await expect(undo_btn).toHaveCount(0)
  })

  test(`deleting a selected atom enables undo, then redo via buttons and shortcuts`, async ({
    page,
  }) => {
    await enter_edit_atoms_mode(page)
    const structure_div = page.locator(`#test-structure`)
    const { undo: undo_btn, redo: redo_btn } = undo_redo_btns(structure_div)
    await expect(undo_btn).toBeDisabled()
    await expect(redo_btn).toBeDisabled()
    await expect(structure_div.locator(`.history-count`)).toHaveCount(0)

    await page.locator(`[data-testid="btn-select-site-0"]`).click()
    await structure_div.focus()
    await page.keyboard.press(`Delete`)

    await expect(structure_div.locator(`.history-count`).first()).toHaveText(`1`)
    await expect(undo_btn).toBeEnabled()
    await undo_btn.click({ force: true })
    await expect(redo_btn).toBeEnabled()

    // Redo via keyboard puts the deletion back on the undo stack, undo via keyboard pops it
    await structure_div.focus()
    await page.keyboard.press(`${primary_modifier_key}+y`)
    await expect(undo_btn).toBeEnabled()
    await expect(redo_btn).toBeDisabled()
    await page.keyboard.press(`${primary_modifier_key}+z`)
    await expect(redo_btn).toBeEnabled()
  })
})

test.describe(`Responsive edit controls`, () => {
  test.beforeEach(async ({ page }) => {
    await goto_structure_test(page, `/test/structure?show_controls=always`)
  })

  test(`keeps the bond-edit toolbar inside a narrow viewer on a second row`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    await set_viewer_size(structure_div, 300, 500)
    await page.locator(`[data-testid="btn-set-edit-bonds"]`).click()

    const [structure_box, controls_box, toolbar_box] = await Promise.all([
      require_bbox(structure_div, `structure`),
      require_bbox(structure_div.locator(`section.control-buttons`), `control buttons`),
      require_bbox(structure_div.locator(`.edit-mode-toolbar`), `edit toolbar`),
    ])
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
  test.beforeEach(async ({ page }) => {
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
    const cells = structure_div.locator(`.viewport-cell`)
    const multi_stage = structure_div.locator(`.viewport-stage.multi`)

    // Handle spread on screen, which scales with the gizmo box — the only way to measure a
    // gizmo with no DOM element. Hover first since it draws only while the viewer is active.
    const gizmo_span = async (canvas: Locator): Promise<number> => {
      await activate_viewer(page, canvas)
      const hits = await sweep_gizmo_handles(canvas)
      expect(hits.length, `gizmo handles on this canvas`).toBeGreaterThan(0)
      const xs = hits.map((hit) => hit.x)
      const ys = hits.map((hit) => hit.y)
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    }

    // Single view: one viewport cell, no grid
    await expect(cells).toHaveCount(1)
    await expect(multi_stage).toHaveCount(0)
    const single_span = await gizmo_span(structure_div.locator(`canvas`).first())

    await select_structure_layout(structure_div, `3D 2×2 grid`)

    // The primary perspective pane stays unlabeled so the global filename can use
    // the top-left corner; the three fixed-direction panes retain their labels.
    await expect(structure_div).toHaveClass(/multi-view/)
    await expect(multi_stage).toBeVisible()
    await expect(cells).toHaveCount(4)
    await expect(multi_stage.locator(`canvas`)).toHaveCount(4, {
      timeout: get_canvas_timeout(),
    })
    const labels = structure_div.locator(`.viewport-label`)
    await expect(labels).toHaveCount(3)
    await expect(labels.nth(0)).toHaveText(`Front`)

    // Each pane occupies roughly a quarter of the viewer (clearly smaller than full width)
    const wrapper_box = await require_bbox(structure_div, `structure wrapper`)
    for (let pane_idx = 0; pane_idx < 4; pane_idx++) {
      await expect(async () => {
        const { width } = await require_bbox(cells.nth(pane_idx), `viewport cell ${pane_idx}`)
        expect(width).toBeLessThan(wrapper_box.width * 0.75)
        expect(width).toBeGreaterThan(50)
      }).toPass({ timeout: get_canvas_timeout() })
    }

    // Panes are ~half the viewer, so StructureViewport hands them a smaller gizmo. Ties
    // responsive_gizmo_size (unit-tested) to what renders, now that the old `.responsive-gizmo`
    // DOM box is gone with three-viewport-gizmo's HTML overlay.
    const pane_span = await gizmo_span(multi_stage.locator(`canvas`).first())
    expect(pane_span).toBeLessThan(single_span * 0.8)

    // Toggle back to single view
    await select_structure_layout(structure_div, `3D single view`)
    await expect(structure_div).not.toHaveClass(/multi-view/)
    await expect(multi_stage).toHaveCount(0)
    await expect(cells).toHaveCount(1)
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
    const cells = structure_div.locator(`.viewport-cell`)
    await structure_div.focus() // viewer must be focused to receive the shortcut
    await expect(cells).toHaveCount(1)

    const grid_shortcut = `${primary_modifier_key}+g`
    await page.keyboard.press(grid_shortcut)
    await expect(structure_div).toHaveClass(/multi-view/)
    await expect(cells).toHaveCount(4)

    await page.keyboard.press(grid_shortcut)
    await expect(structure_div).not.toHaveClass(/multi-view/)
    await expect(cells).toHaveCount(1)
  })

  test(`active pane raises overlays while its canvas stays clipped`, async ({ page }) => {
    const structure_div = page.locator(`#test-structure`)
    await select_structure_layout(structure_div, `3D 2×2 grid`)
    const cells = structure_div.locator(`.viewport-cell`)
    await expect(cells).toHaveCount(4)

    await cells.nth(0).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(0)).toHaveClass(/active/)
    await expect(cells.nth(0)).toHaveCSS(`overflow`, `visible`)
    await expect(cells.nth(0)).toHaveCSS(`z-index`, `1`)
    await expect(cells.nth(0).locator(`canvas`).locator(`..`)).toHaveCSS(`overflow`, `hidden`)

    await cells.nth(2).hover({ position: { x: 20, y: 20 } })
    await expect(cells.nth(2)).toHaveClass(/active/)
    await expect(cells.nth(2)).toHaveCSS(`z-index`, `1`)
  })

  test(`repeated toggling settles on the right canvas count without leaking contexts`, async ({
    page,
  }) => {
    const structure_div = page.locator(`#test-structure`)
    const cells = structure_div.locator(`.viewport-cell`)
    const canvas_timeout = get_canvas_timeout()

    for (let cycle = 0; cycle < 3; cycle++) {
      await select_structure_layout(structure_div, `3D 2×2 grid`)
      await expect(cells).toHaveCount(4)
      await expect(structure_div.locator(`.viewport-stage.multi canvas`)).toHaveCount(4, {
        timeout: canvas_timeout,
      })
      await select_structure_layout(structure_div, `3D single view`)
      await expect(cells).toHaveCount(1)
      await expect(structure_div.locator(`canvas`)).toHaveCount(1, {
        timeout: canvas_timeout,
      })
    }
  })
})
