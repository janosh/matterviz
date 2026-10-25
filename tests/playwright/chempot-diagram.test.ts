import { type Download, expect, type Locator, type Page, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { require_bbox, expect_centered, webgl_on_ci_for_tagged, zoom_wheel } from './helpers'

webgl_on_ci_for_tagged()

const TEST_URL = `/convex-hull/chempot-diagram`

const get_diagram_by_heading = async (
  page: Page,
  heading_text: RegExp,
  diagram_selector: string,
): Promise<Locator> => {
  const section = page
    .locator(`section`)
    .filter({ has: page.getByRole(`heading`, { name: heading_text }) })
    .first()
  await expect(section).toBeVisible({ timeout: 20_000 })
  await section.scrollIntoViewIfNeeded()
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
  const shows_tooltip = async (x: number, y: number): Promise<boolean> => {
    await page.mouse.move(x, y)
    await page.waitForTimeout(80)
    return tooltip.isVisible()
  }
  const candidates = target_surface.locator(`path.marker, path[fill="transparent"]`)
  const candidate_count = await candidates.count()
  for (let candidate_idx = 0; candidate_idx < Math.min(candidate_count, 16); candidate_idx++) {
    const candidate_box = await candidates.nth(candidate_idx).boundingBox()
    if (!candidate_box) continue
    const click_x = candidate_box.x + candidate_box.width / 2
    const click_y = candidate_box.y + candidate_box.height / 2
    if (await shows_tooltip(click_x, click_y)) return { x: click_x, y: click_y }
  }

  const box = await require_bbox(target_surface, `target surface`)
  for (let x_frac = 0.15; x_frac <= 0.85; x_frac += 0.1) {
    for (let y_frac = 0.15; y_frac <= 0.85; y_frac += 0.1) {
      const click_x = box.x + box.width * x_frac
      const click_y = box.y + box.height * y_frac
      if (await shows_tooltip(click_x, click_y)) return { x: click_x, y: click_y }
    }
  }
  throw new Error(`Failed to find clickable phase region`)
}

// First point on a coarse grid (centre outwards along rows) where `surface` itself is the hit
// target, i.e. no pane, legend or label sits over it.
const find_uncovered_point = async (
  page: Page,
  surface: Locator,
): Promise<{ x: number; y: number }> => {
  const box = await require_bbox(surface, `uncovered-point surface`)
  for (const y_frac of [0.5, 0.65, 0.35, 0.8, 0.2]) {
    for (const x_frac of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      const point = { x: box.x + box.width * x_frac, y: box.y + box.height * y_frac }
      const is_hit = await surface.evaluate(
        (element, { x, y }) => document.elementFromPoint(x, y) === element,
        point,
      )
      if (is_hit) return point
    }
  }
  throw new Error(`No uncovered point on surface ${JSON.stringify(box)}`)
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

const open_pane = async (diagram: Locator, toggle: Locator, pane: Locator): Promise<void> => {
  await diagram.hover()
  // A clicked toggle's tooltip stays up while the toggle has focus and takes clicks during its
  // ~250 ms close, so a click right after focus moves on can land on it instead of this toggle
  await expect(diagram.page().locator(`.tooltip-content`)).toBeHidden()
  await toggle.click({ force: true })
  await expect(pane).toBeVisible()
}

// `name` is the pane's class infix: button.chempot-<name>-toggle opens .chempot-<name>-pane.
// Matched by class, not by the pane's contents, so relabelled sections don't hide a pane.
const get_pane = (diagram: Locator, name: string) => ({
  toggle: diagram.locator(`button.chempot-${name}-toggle`).first(),
  pane: diagram.locator(`.draggable-pane.chempot-${name}-pane`).first(),
})

const open_export_pane = async (diagram: Locator): Promise<Locator> => {
  const { toggle, pane } = get_pane(diagram, `export`)
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
  // PlotTooltip owns the pin hint; it retracts after a few seconds but stays in the DOM while pinned
  const pin_hint = tooltip.locator(`.pin-hint`)
  await expect(tooltip).toHaveClass(/\bpinned\b/)
  await expect(pin_hint).toHaveText(`Pinned · Esc to unpin`)
  await focus_target.focus()
  await page.keyboard.press(`Escape`)
  await expect(pin_hint).toHaveCount(0)
}
test.describe(`ChemPot Diagram interactions`, { tag: `@webgl` }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
    await expect(
      page.getByRole(`heading`, { name: `Chemical Potential Diagram` }),
    ).toBeVisible()
  })

  test(`2D tooltip lock unlocks with Escape; color controls swap colorbar and arity legend`, async ({
    page,
  }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /Binary System \(Li-O\)/,
      `.chempot-diagram-2d`,
    )
    const svg_surface = diagram.locator(`svg[role="application"]`).first()
    await expect(svg_surface).toBeVisible()
    const tooltip = diagram.locator(`.chempot-tooltip`)
    await assert_pin_toggle_and_escape(page, svg_surface, tooltip, diagram)
    // the unpinned hover tooltip must not linger over the controls below
    await page.mouse.move(0, 0)
    await expect(tooltip).toBeHidden()

    const controls_toggle = diagram.locator(`button.plot-controls-toggle`).first()
    const icons = diagram.locator(`.header-controls > button > svg`)
    await expect(icons).toHaveCount(3)
    const first = await require_bbox(icons.first())
    for (const icon of await icons.all()) expect_centered(await require_bbox(icon), first, `y`)
    const controls_pane = diagram
      .locator(`.draggable-pane`)
      .filter({
        hasText: `Color mode:`,
      })
      .first()
    await open_pane(diagram, controls_toggle, controls_pane)

    const color_mode_select = controls_pane.getByLabel(`Color mode:`)
    await color_mode_select.selectOption(`energy`)
    // the legend's bar; the controls pane's colour-scale picker draws preview bars of its own
    const colorbar = diagram.locator(`.chempot-legend .colorbar`)
    await expect(colorbar).toBeVisible()
    await expect(colorbar).toContainText(`Total energy (eV/atom)`)
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
    const { toggle: controls_toggle, pane: controls_pane } = get_pane(diagram, `controls`)
    await open_pane(diagram, controls_toggle, controls_pane)

    const projection = [`x`, `y`, `z`].map((axis) =>
      controls_pane.locator(`#chempot-proj-${axis}`).first(),
    )
    const read_projection = () => Promise.all(projection.map((select) => select.inputValue()))
    for (const select of projection) await expect(select).toBeVisible()
    await projection[0].selectOption(`O`)
    expect(new Set(await read_projection()).size).toBe(3)

    const preset_buttons = controls_pane.locator(`.projection-presets button`)
    await expect.poll(() => preset_buttons.count()).toBeGreaterThan(1)
    const alternate_preset = controls_pane
      .locator(`.projection-presets button:not(.selected)`)
      .first()
    const preset_text = ((await alternate_preset.textContent()) ?? ``).trim()
    expect(preset_text).toMatch(/^[A-Za-z]+-[A-Za-z]+-[A-Za-z]+$/)
    const expected_projection = preset_text.split(`-`)
    await alternate_preset.click()
    await expect.poll(read_projection).toEqual(expected_projection)

    const { toggle: formula_toggle, pane: formula_pane } = get_pane(diagram, `formula`)
    await expect(controls_toggle).toHaveCSS(`position`, `static`)
    // The gear must not cover the adjacent formula button in the chrome row.
    await expect
      .poll(() =>
        formula_toggle.evaluate((button) => {
          const rect = button.getBoundingClientRect()
          return button.contains(
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
          )
        }),
      )
      .toBe(true)
    await open_pane(diagram, formula_toggle, formula_pane)

    const checkboxes = formula_pane.locator(`input[type="checkbox"]`)
    await expect(checkboxes.first()).toBeVisible()
    await checkboxes.first().check({ force: true })
    await expect(checkboxes.first()).toBeChecked()

    const checked_formulas = formula_pane.locator(`input[type="checkbox"]:checked`)
    await formula_pane.getByRole(`button`, { name: `Clear` }).click()
    await expect(checked_formulas).toHaveCount(0)

    await formula_pane.getByRole(`button`, { name: `Surface` }).click()
    await expect.poll(() => checked_formulas.count()).toBeGreaterThan(0)

    const search_input = formula_pane.getByPlaceholder(`Formula filter`)
    await search_input.fill(`__no_matching_formula__`)
    await expect(formula_pane.locator(`.formula-empty`)).toBeVisible()
    await search_input.fill(``)
    await expect(formula_pane.locator(`.formula-empty`)).toBeHidden()
    await expect(formula_pane.locator(`input[type="checkbox"]`).first()).toBeVisible()
  })

  // Domain labels sit on their faces as HTML over the canvas; they must let the pointer through
  // to the face underneath (threlte's <HTML> wrapper takes pointer events by default)
  test(`hovering a domain's label shows that domain's tooltip`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 })
    const diagram = await get_diagram_by_heading(
      page,
      /Ternary System \(Li-Fe-O\) — 3D/,
      `.chempot-diagram-3d`,
    )
    await expect(diagram.locator(`canvas`).first()).toBeVisible()
    await expect.poll(() => diagram.locator(`.domain-label`).count()).toBeGreaterThan(5)
    const tooltip = diagram.locator(`.chempot-tooltip h4`)
    const labels = await diagram.locator(`.domain-label`).all()
    const checked: string[] = []
    for (const label of labels) {
      const text = ((await label.textContent()) ?? ``).replaceAll(/\s/g, ``)
      const box = await require_bbox(label, `${text} label`)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await expect(tooltip, `tooltip over the ${text} label`).toHaveText(text)
      checked.push(text)
    }
    expect(checked).toContain(`LiFeO2`)
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

    const phase_tooltip = diagram.locator(`.chempot-tooltip`)
    await assert_pin_toggle_and_escape(page, canvas, phase_tooltip, diagram)

    const export_pane = await open_export_pane(diagram)

    await expect_download_suffix(page, get_export_button(export_pane, `SVG`), `.svg`)
    const initial_zoom = await read_view_zoom(page, export_pane)
    // the open export pane covers the canvas centre of a side-by-side demo, so aim past it
    const free_point = await find_uncovered_point(page, canvas)
    await page.mouse.move(free_point.x, free_point.y)
    await zoom_wheel(page, -200)
    expect(await read_view_zoom(page, export_pane)).not.toBe(initial_zoom)

    // A pinned camera stops the diagram re-fitting itself, so Reset has to offer to undo it
    const { toggle: controls_toggle, pane: controls_pane } = get_pane(diagram, `controls`)
    await open_pane(diagram, controls_toggle, controls_pane)
    await expect(
      controls_pane.getByRole(`button`, { name: /Clear chempot overrides/i }),
    ).toBeVisible()
    // the pane overlays the canvas centre, and the reset below deliberately ignores pane clicks
    await controls_toggle.click({ force: true })
    await expect(controls_pane).toBeHidden()

    // double click hands framing back to the auto-fit the wheel just pinned. The click also
    // dismisses the export pane (DraggablePane closes on any outside press), so reopen it.
    await page.mouse.dblclick(free_point.x, free_point.y)
    const reopened_pane = await open_export_pane(diagram)
    expect(await read_view_zoom(page, reopened_pane)).toBeCloseTo(initial_zoom, 5)
    await expect_download_suffix(page, get_export_button(reopened_pane, `GLB`), `.glb`)
  })
})
