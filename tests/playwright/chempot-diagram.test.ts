import { expect, type Locator, type Page, test } from '@playwright/test'
import { IS_CI } from './helpers'

const TEST_URL = `/chempot-diagram`

const get_section_by_heading = async (
  page: Page,
  heading_text: RegExp,
): Promise<Locator> => {
  const section = page.locator(`section`).filter({
    has: page.getByRole(`heading`, { name: heading_text }),
  }).first()
  await expect(section).toBeVisible({ timeout: 20_000 })
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

const click_until_visible_tooltip = async (
  page: Page,
  target_surface: Locator,
  tooltip: Locator,
): Promise<{ x: number; y: number }> => {
  const box = await target_surface.boundingBox()
  if (!box) throw new Error(`Target surface bounding box not found`)
  for (let x_frac = 0.25; x_frac <= 0.75; x_frac += 0.08) {
    for (let y_frac = 0.25; y_frac <= 0.75; y_frac += 0.08) {
      const click_x = box.x + box.width * x_frac
      const click_y = box.y + box.height * y_frac
      // deno-lint-ignore no-await-in-loop -- probing requires sequential clicks
      await page.mouse.click(click_x, click_y)
      // deno-lint-ignore no-await-in-loop -- small delay for hover/pick updates
      await page.waitForTimeout(40)
      // deno-lint-ignore no-await-in-loop -- visibility check after each probe
      if (await tooltip.isVisible()) return { x: click_x, y: click_y }
    }
  }
  throw new Error(`Failed to find clickable phase region`)
}

const expect_download_suffix = async (
  page: Page,
  trigger_button: Locator,
  expected_suffix: string,
): Promise<void> => {
  const [download] = await Promise.all([
    page.waitForEvent(`download`, { timeout: 20_000 }),
    trigger_button.click(),
  ])
  expect(download.suggestedFilename().endsWith(expected_suffix)).toBe(true)
}
const get_export_button = (export_pane: Locator, label_text: string): Locator =>
  export_pane.locator(`label:has-text("${label_text}") button`).first()

const count_checked = (checkboxes: Locator): Promise<number> =>
  checkboxes.evaluateAll((nodes) =>
    nodes.filter((node) => (node as HTMLInputElement).checked).length
  )

const open_pane = async (
  diagram: Locator,
  toggle: Locator,
  pane: Locator,
): Promise<void> => {
  await diagram.hover()
  await toggle.click({ force: true })
  await expect(pane).toBeVisible()
}

const assert_pin_toggle_and_escape = async (
  page: Page,
  surface: Locator,
  tooltip: Locator,
): Promise<void> => {
  const hit_point = await click_until_visible_tooltip(page, surface, tooltip)
  await page.mouse.click(hit_point.x, hit_point.y)
  await expect(tooltip).toContainText(`Pinned · Press Esc to unlock`)
  await page.mouse.click(hit_point.x, hit_point.y)
  await expect(tooltip).not.toContainText(`Pinned · Press Esc to unlock`)
  await page.mouse.click(hit_point.x, hit_point.y)
  await expect(tooltip).toContainText(`Pinned · Press Esc to unlock`)
  await page.keyboard.press(`Escape`)
  await expect(tooltip).toBeHidden()
}
const get_projection_values = (
  x_select: Locator,
  y_select: Locator,
  z_select: Locator,
): Promise<[string, string, string]> =>
  Promise.all([
    x_select.inputValue(),
    y_select.inputValue(),
    z_select.inputValue(),
  ]) as Promise<[string, string, string]>

test.describe(`ChemPot Diagram interactions`, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(IS_CI, `ChemPot interactions rely on WebGL-heavy rendering`)
    await page.goto(TEST_URL, { waitUntil: `networkidle` })
    await expect(page.getByRole(`heading`, { name: `Chemical Potential Diagram` }))
      .toBeVisible()
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
    await assert_pin_toggle_and_escape(page, svg_surface, tooltip)
  })

  test(`2D color controls switch between colorbar and arity legend`, async ({ page }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /Binary System \(Li-O\)/,
      `.chempot-diagram-2d`,
    )

    const controls_toggle = diagram.locator(`button.pane-toggle[title*="plot controls"]`)
      .first()
    const controls_pane = diagram.locator(`.draggable-pane`).filter({
      hasText: `Color mode:`,
    }).first()
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

  test(`3D projection controls and formula picker actions work in multinary mode`, async ({ page }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /YTOS Quaternary.*Ti-S-Y Projection/,
      `.chempot-diagram-3d`,
    )

    const controls_toggle = diagram.locator(
      `button.pane-toggle[title="3D plot controls"]`,
    ).first()
    const controls_pane = diagram.locator(`.draggable-pane`).filter({
      hasText: `ChemPot`,
    }).first()
    await open_pane(diagram, controls_toggle, controls_pane)

    const x_select = controls_pane.locator(`#chempot-proj-x`).first()
    const y_select = controls_pane.locator(`#chempot-proj-y`).first()
    const z_select = controls_pane.locator(`#chempot-proj-z`).first()
    await expect(x_select).toBeVisible()
    await expect(y_select).toBeVisible()
    await expect(z_select).toBeVisible()

    await x_select.selectOption(`Y`)
    const selected_projection = await get_projection_values(x_select, y_select, z_select)
    expect(new Set(selected_projection).size).toBe(3)

    const formula_toggle = diagram.locator(
      `button.pane-toggle[title="Formula overlays"]`,
    ).first()
    const formula_pane = diagram.locator(`.draggable-pane`).filter({
      hasText: `Formula Overlays`,
    }).first()
    await open_pane(diagram, formula_toggle, formula_pane)

    const checkboxes = formula_pane.locator(`input[type="checkbox"]`)
    await expect(checkboxes.first()).toBeVisible()
    await checkboxes.first().check()
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

    const preset_buttons = controls_pane.locator(`.projection-presets button`)
    await expect
      .poll(() => preset_buttons.count())
      .toBeGreaterThan(1)
    const alternate_preset = controls_pane.locator(
      `.projection-presets button:not(.selected)`,
    )
      .first()
    const preset_text = ((await alternate_preset.textContent()) ?? ``).trim()
    expect(preset_text).toMatch(/^[A-Za-z]+-[A-Za-z]+-[A-Za-z]+$/)
    await alternate_preset.click()
    await expect(alternate_preset).toHaveClass(/selected/)
    const expected_projection = preset_text.split(`-`)
    const projection_after_click = await get_projection_values(
      x_select,
      y_select,
      z_select,
    )
    expect(projection_after_click).toEqual(expected_projection)
  })

  test(`3D tooltip lock toggles and export actions download files`, async ({ page }) => {
    const diagram = await get_diagram_by_heading(
      page,
      /Ternary System \(Li-Co-O\)/,
      `.chempot-diagram-3d`,
    )
    const canvas = diagram.locator(`canvas`).first()
    await expect(canvas).toBeVisible()

    const phase_tooltip = diagram.locator(`.phase-tooltip`)
    await assert_pin_toggle_and_escape(page, canvas, phase_tooltip)

    const export_toggle = diagram.locator(
      `button.pane-toggle[title="Export chemical potential diagram"]`,
    ).first()
    const export_pane = diagram.locator(`.draggable-pane`).filter({
      hasText: `Export Image`,
    }).first()
    await open_pane(diagram, export_toggle, export_pane)

    await expect_download_suffix(page, get_export_button(export_pane, `SVG`), `.svg`)
    await expect_download_suffix(
      page,
      get_export_button(export_pane, `View`),
      `-view.json`,
    )
    await expect_download_suffix(page, get_export_button(export_pane, `GLB`), `.glb`)
  })
})
