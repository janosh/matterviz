import { type Download, expect, type Locator, type Page, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { IS_CI } from './helpers'

const TEST_URL = `/convex-hull/chempot-diagram`

const get_section_by_heading = async (page: Page, heading_text: RegExp): Promise<Locator> => {
  const section = page
    .locator(`section`)
    .filter({
      has: page.getByRole(`heading`, { name: heading_text }),
    })
    .first()
  await expect(section).toBeVisible({ timeout: 20_000 })
  await section.scrollIntoViewIfNeeded()
  return section
}
const get_diagram_by_heading = async (
  page: Page,
  heading_text: RegExp,
  diagram_selector: string,
): Promise<Locator> => {
  const section = await get_section_by_heading(page, heading_text)
  const diagram = section.locator(diagram_selector).first()
  await expect(diagram).toBeVisible()
  return diagram
}

const find_tooltip_hit_point = async (
  page: Page,
  target_surface: Locator,
  tooltip: Locator,
): Promise<{ x: number; y: number }> => {
  await target_surface.scrollIntoViewIfNeeded()
  const candidates = target_surface.locator(`path.marker, path[fill="transparent"]`)
  const candidate_count = await candidates.count()
  for (let candidate_idx = 0; candidate_idx < Math.min(candidate_count, 16); candidate_idx++) {
    const candidate_box = await candidates.nth(candidate_idx).boundingBox()
    if (!candidate_box) continue
    const click_x = candidate_box.x + candidate_box.width / 2
    const click_y = candidate_box.y + candidate_box.height / 2
    await page.mouse.move(click_x, click_y)
    await page.waitForTimeout(80)
    if (await tooltip.isVisible()) return { x: click_x, y: click_y }
  }

  const box = await target_surface.boundingBox()
  if (!box) throw new Error(`Target surface bounding box not found`)
  for (let x_frac = 0.15; x_frac <= 0.85; x_frac += 0.1) {
    for (let y_frac = 0.15; y_frac <= 0.85; y_frac += 0.1) {
      const click_x = box.x + box.width * x_frac
      const click_y = box.y + box.height * y_frac
      await page.mouse.move(click_x, click_y)
      await page.waitForTimeout(80)
      if (await tooltip.isVisible()) return { x: click_x, y: click_y }
    }
  }
  throw new Error(`Failed to find clickable phase region`)
}

const expect_download_suffix = async (
  page: Page,
  trigger_button: Locator,
  expected_suffix: string,
): Promise<Download> => {
  const [download] = await Promise.all([
    page.waitForEvent(`download`, { timeout: 20_000 }),
    trigger_button.click(),
  ])
  expect(download.suggestedFilename().endsWith(expected_suffix)).toBe(true)
  return download
}
const get_export_button = (export_pane: Locator, label_text: string): Locator =>
  export_pane.locator(`.export-item:has-text("${label_text}") button`).first()

const count_checked = (checkboxes: Locator): Promise<number> =>
  checkboxes.evaluateAll(
    (nodes) => nodes.filter((node) => (node as HTMLInputElement).checked).length,
  )

const open_pane = async (diagram: Locator, toggle: Locator, pane: Locator): Promise<void> => {
  await diagram.hover()
  await toggle.click({ force: true })
  await expect(pane).toBeVisible()
}

// `toggle` is the pane's chrome button suffix, `label` text unique to that pane's contents
const get_pane = (diagram: Locator, toggle: string, label: string) => ({
  toggle: diagram.locator(`button.chempot-${toggle}-toggle`).first(),
  pane: diagram.locator(`.draggable-pane`).filter({ hasText: label }).first(),
})

const open_export_pane = async (diagram: Locator): Promise<Locator> => {
  const { toggle, pane } = get_pane(diagram, `export`, `Export Image`)
  await open_pane(diagram, toggle, pane)
  return pane
}

// The view snapshot is the only readout of the live camera, and each read costs a download.
const read_view_zoom = async (page: Page, export_pane: Locator): Promise<number> => {
  const view_button = get_export_button(export_pane, `View`)
  const download = await expect_download_suffix(page, view_button, `-view.json`)
  const view = JSON.parse(await readFile(await download.path(), `utf8`))
  expect(Number.isFinite(view.orthographic_zoom), `view snapshot zoom`).toBe(true)
  return view.orthographic_zoom
}

const assert_pin_toggle_and_escape = async (
  page: Page,
  surface: Locator,
  tooltip: Locator,
  focus_target: Locator = surface,
): Promise<void> => {
  const hit_point = await find_tooltip_hit_point(page, surface, tooltip)
  await page.mouse.click(hit_point.x, hit_point.y)
  await expect(tooltip).toContainText(`Pinned · Press Esc to unlock`)
  await focus_target.focus()
  await page.keyboard.press(`Escape`)
  await expect
    .poll(async () => ((await tooltip.count()) ? ((await tooltip.textContent()) ?? ``) : ``))
    .not.toContain(`Pinned · Press Esc to unlock`)
}
const get_projection_values = (
  x_select: Locator,
  y_select: Locator,
  z_select: Locator,
): Promise<[string, string, string]> =>
  Promise.all([x_select.inputValue(), y_select.inputValue(), z_select.inputValue()])

test.describe(`ChemPot Diagram interactions`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ChemPot interactions rely on WebGL-heavy rendering`)
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
    await expect(
      page.getByRole(`heading`, { name: `Chemical Potential Diagram` }),
    ).toBeVisible()
  })

  test(`2D tooltip lock toggles and unlocks with Escape`, async ({ page }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /Binary System \(Li-O\)/,
      `.chempot-diagram-2d`,
    )
    const svg_surface = diagram.locator(`svg[role="application"]`).first()
    await expect(svg_surface).toBeVisible()
    const tooltip = diagram.locator(`.tooltip`)
    await assert_pin_toggle_and_escape(page, svg_surface, tooltip, diagram)
  })

  test(`2D color controls switch between colorbar and arity legend`, async ({ page }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /Binary System \(Li-O\)/,
      `.chempot-diagram-2d`,
    )

    const controls_toggle = diagram.locator(`button.plot-controls-toggle`).first()
    const controls_pane = diagram
      .locator(`.draggable-pane`)
      .filter({
        hasText: `Color mode:`,
      })
      .first()
    await open_pane(diagram, controls_toggle, controls_pane)

    const color_mode_select = controls_pane.getByLabel(`Color mode:`)
    await color_mode_select.selectOption(`energy`)
    const colorbar = diagram.locator(`.colorbar`).first()
    await expect(colorbar).toBeVisible()
    await expect(colorbar).toContainText(`Energy per atom`)
    await expect(controls_pane.getByLabel(`Color scale:`)).toBeVisible()

    await color_mode_select.selectOption(`arity`)
    const arity_legend = diagram.locator(`.arity-legend`)
    await expect(arity_legend).toBeVisible()
    await expect(arity_legend).toContainText(`Unary`)
    await expect(arity_legend).toContainText(`Binary`)
    await expect(colorbar).toBeHidden()
    await expect(controls_pane.getByLabel(`Color scale:`)).toBeHidden()

    await color_mode_select.selectOption(`entries`)
    await expect(colorbar).toBeVisible()
    await expect(colorbar).toContainText(`Entry count`)
  })

  test(`3D projection controls and formula pane layering work in multinary mode`, async ({
    page,
  }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /YTOS Quaternary.*Ti-S-Y Projection/,
      `.chempot-diagram-3d`,
    )
    await expect(diagram).toHaveCSS(`overflow`, `visible`)
    await expect(diagram.locator(`canvas`).first().locator(`..`)).toHaveCSS(
      `overflow`,
      `hidden`,
    )
    const { toggle: controls_toggle, pane: controls_pane } = get_pane(
      diagram,
      `controls`,
      `ChemPot`,
    )
    await open_pane(diagram, controls_toggle, controls_pane)

    const x_select = controls_pane.locator(`#chempot-proj-x`).first()
    const y_select = controls_pane.locator(`#chempot-proj-y`).first()
    const z_select = controls_pane.locator(`#chempot-proj-z`).first()
    await expect(x_select).toBeVisible()
    await expect(y_select).toBeVisible()
    await expect(z_select).toBeVisible()

    await x_select.selectOption(`O`)
    const selected_projection = await get_projection_values(x_select, y_select, z_select)
    expect(new Set(selected_projection).size).toBe(3)

    const preset_buttons = controls_pane.locator(`.projection-presets button`)
    await expect.poll(() => preset_buttons.count()).toBeGreaterThan(1)
    const alternate_preset = controls_pane
      .locator(`.projection-presets button:not(.selected)`)
      .first()
    const preset_text = ((await alternate_preset.textContent()) ?? ``).trim()
    expect(preset_text).toMatch(/^[A-Za-z]+-[A-Za-z]+-[A-Za-z]+$/)
    const expected_projection = preset_text.split(`-`)
    await alternate_preset.click()
    await expect
      .poll(() => get_projection_values(x_select, y_select, z_select))
      .toEqual(expected_projection)

    const formula_toggle = diagram.locator(`button.chempot-formula-toggle`).first()
    const formula_pane = diagram
      .locator(`.draggable-pane`)
      .filter({
        hasText: `Formula Overlays`,
      })
      .first()
    await open_pane(diagram, formula_toggle, formula_pane)

    const checkboxes = formula_pane.locator(`input[type="checkbox"]`)
    await expect(checkboxes.first()).toBeVisible()
    await checkboxes.first().check({ force: true })
    await expect(checkboxes.first()).toBeChecked()

    await formula_pane.getByRole(`button`, { name: `Clear` }).click()
    await expect.poll(() => count_checked(checkboxes)).toBe(0)

    await formula_pane.getByRole(`button`, { name: `Surface` }).click()
    await expect.poll(() => count_checked(checkboxes)).toBeGreaterThan(0)

    const search_input = formula_pane.getByPlaceholder(`Formula filter`)
    await search_input.fill(`__no_matching_formula__`)
    await expect(formula_pane.locator(`.formula-empty`)).toBeVisible()
    await search_input.fill(``)
    await expect(formula_pane.locator(`.formula-empty`)).toBeHidden()
    await expect(formula_pane.locator(`input[type="checkbox"]`).first()).toBeVisible()
  })

  test(`3D tooltip lock toggles and export actions download files`, async ({ page }) => {
    test.setTimeout(60_000) // four downloads plus a tooltip hunt over a WebGPU canvas
    const diagram = await get_diagram_by_heading(
      page,
      /Ternary System \(Li-Co-O\)/,
      `.chempot-diagram-3d`,
    )
    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    // The axis frame and the domain names are HTML portaled over the canvas, so unlike anything
    // drawn into it they are assertable — and they are what a broken axis/label pass would drop.
    await expect(diagram.locator(`.axis-label`)).toHaveCount(3)
    await expect.poll(() => diagram.locator(`.tick-label`).count()).toBeGreaterThan(5)
    await expect.poll(() => diagram.locator(`.domain-label`).count()).toBeGreaterThan(0)

    const phase_tooltip = diagram.locator(`.phase-tooltip`)
    await assert_pin_toggle_and_escape(page, canvas, phase_tooltip, diagram)

    const export_pane = await open_export_pane(diagram)

    await expect_download_suffix(page, get_export_button(export_pane, `SVG`), `.svg`)
    const initial_zoom = await read_view_zoom(page, export_pane)
    const canvas_box = await canvas.boundingBox()
    if (!canvas_box) throw new Error(`ChemPot canvas bounding box unavailable`)
    await page.mouse.move(
      canvas_box.x + canvas_box.width / 2,
      canvas_box.y + canvas_box.height / 2,
    )
    await page.mouse.wheel(0, -200)
    expect(await read_view_zoom(page, export_pane)).not.toBe(initial_zoom)

    // A pinned camera stops the diagram re-fitting itself, so Reset has to offer to undo it
    const { toggle: controls_toggle, pane: controls_pane } = get_pane(
      diagram,
      `controls`,
      `ChemPot`,
    )
    await open_pane(diagram, controls_toggle, controls_pane)
    await expect(controls_pane.getByRole(`button`, { name: /Reset chempot/i })).toBeVisible()
    // the pane overlays the canvas centre, and the reset below deliberately ignores pane clicks
    await controls_toggle.click({ force: true })
    await expect(controls_pane).toBeHidden()

    // double click hands framing back to the auto-fit the wheel just pinned. The click also
    // dismisses the export pane (DraggablePane closes on any outside press), so reopen it.
    await page.mouse.dblclick(
      canvas_box.x + canvas_box.width / 2,
      canvas_box.y + canvas_box.height / 2,
    )
    const reopened_pane = await open_export_pane(diagram)
    expect(await read_view_zoom(page, reopened_pane)).toBeCloseTo(initial_zoom, 5)
    await expect_download_suffix(page, get_export_button(reopened_pane, `GLB`), `.glb`)
  })
})
