import { expect, type Locator, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { load_all_demos, open_plot_controls, test_without_errors as test } from '../helpers'

// Demo order on the page: iron (derived regions, uncertainty), water (explicit regions,
// critical point, swapped log axes), minimal two-phase example
const diagram = (page: Page, idx: number): Locator =>
  page.locator(`div.pt-phase-diagram`).nth(idx)

// Client coordinates of the point `fraction` along a boundary's drawn path
const point_on_boundary = (plot: Locator, boundary_id: string, fraction: number) =>
  plot.locator(`[data-boundary="${boundary_id}"]`).evaluate((path, frac) => {
    if (!(path instanceof SVGPathElement) || !path.ownerSVGElement) {
      throw new Error(`boundary is not a path in an svg`)
    }
    const point = path.getPointAtLength(path.getTotalLength() * frac)
    const svg_box = path.ownerSVGElement.getBoundingClientRect()
    return { x: svg_box.left + point.x, y: svg_box.top + point.y }
  }, fraction)

// Hover a region at its label (labels ignore pointer events, so the region underneath gets it)
const hover_label = async (page: Page, plot: Locator, name: string): Promise<void> => {
  const box = await plot.locator(`.region-labels text`, { hasText: name }).boundingBox()
  if (!box) throw new Error(`no visible label ${name}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

test.describe(`PressureTemperaturePhaseDiagram`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram/pressure-temperature`, { waitUntil: `networkidle` })
    await load_all_demos(page)
    await expect(page.locator(`div.pt-phase-diagram`)).toHaveCount(3)
    // every demo renders as given: no validation errors or unnamed-region warnings
    await expect(page.locator(`div.pt-phase-diagram .status-message`)).toHaveCount(0)
    await diagram(page, 0).scrollIntoViewIfNeeded()
  })

  test(`renders derived regions, boundaries with bands, triple points, axes and legend`, async ({
    page,
  }) => {
    const plot = diagram(page, 0)
    for (const [selector, count] of [
      [`.regions path`, 5],
      [`.boundary`, 7],
      [`.uncertainty-band`, 7],
      [`.special-point[data-type="triple"]`, 3],
      [`.legend-item`, 6],
    ] as const) {
      await expect(plot.locator(selector), selector).toHaveCount(count)
    }
    for (const phase of [`alpha`, `gamma`, `delta`, `epsilon`, `liquid`]) {
      await expect(plot.locator(`.regions path[data-phase="${phase}"]`)).toHaveCount(1)
    }
    // the δ field is a sliver on a linear pressure axis, so its label is dropped
    await expect(plot.locator(`.region-labels text`)).toHaveCount(4)
    await expect(plot.locator(`.region-labels text`, { hasText: `δ-Fe` })).toHaveCount(0)
    await expect(plot.locator(`.x-label`)).toHaveText(`Pressure (GPa)`)
    await expect(plot.locator(`.y-label`)).toHaveText(`Temperature (K)`)
    await expect(plot.locator(`svg[role="application"]`)).toHaveAttribute(
      `aria-label`,
      `Fe pressure-temperature phase diagram`,
    )
  })

  test(`hover shows the phase, a boundary's standard errors, and click pins the point`, async ({
    page,
  }) => {
    const plot = diagram(page, 0)
    const tooltip = plot.locator(`.plot-tooltip`)

    await hover_label(page, plot, `ε-Fe`)
    await expect(tooltip).toContainText(`ε-Fe`)
    await expect(tooltip).toContainText(`hcp`)
    await expect(tooltip).toContainText(/P\s*[\d.]+\s*GPa/)
    await expect(tooltip).not.toContainText(`±`)

    const on_line = await point_on_boundary(plot, `gamma-epsilon`, 0.4)
    await page.mouse.move(on_line.x, on_line.y)
    await expect(tooltip).toContainText(`γ-Fe ⇌ ε-Fe`)
    await expect(tooltip).toContainText(`±`)
    await expect(plot.locator(`[data-boundary="gamma-epsilon"]`)).toHaveClass(/lit/)
    const hovered_text = await tooltip.textContent()

    await page.mouse.click(on_line.x, on_line.y)
    await expect(plot.locator(`.pin-marker`)).toBeVisible()
    await expect(tooltip).toHaveClass(/pinned/)
    // a pinned tooltip ignores further hovers
    await hover_label(page, plot, `Liquid`)
    await expect(tooltip).toContainText((hovered_text ?? ``).trim())
    await expect(tooltip).not.toContainText(`Liquid`)

    await page.keyboard.press(`Escape`)
    await expect(plot.locator(`.pin-marker`)).toHaveCount(0)
    await expect(tooltip).not.toHaveClass(/pinned/)
  })

  test(`controls switch uncertainty style, log pressure, units and swapped axes`, async ({
    page,
  }) => {
    const plot = diagram(page, 0)
    const { pane } = await open_plot_controls(plot)

    await pane.getByLabel(`Uncertainty`).selectOption(`bars`)
    await expect(plot.locator(`.uncertainty-band`)).toHaveCount(0)
    await expect(plot.locator(`.error-bars`)).toHaveCount(7) // one capped-bar path per boundary
    await pane.getByLabel(`Uncertainty`).selectOption(`none`)
    await expect(plot.locator(`.error-bars`)).toHaveCount(0)

    // log pressure through the shared scale select of whichever axis carries pressure
    // selects wrapped in a <label> with a <span> caption, as PlotControls renders them
    const labeled_select = (caption: string, scope = ``) =>
      pane.locator(`${scope} label:has(span:text-is("${caption}")) select`)
    const scale_select = (axis: `X` | `Y`) =>
      labeled_select(axis, `[data-testid="scale-type-section"]`)
    await scale_select(`X`).selectOption(`log`)
    // decades from the lowest positive pressure (0.7 GPa) up to 150 GPa
    await expect(plot.locator(`g.x-axis .tick text`)).toContainText([`1`, `10`, `100`])

    await labeled_select(`Pressure`).selectOption(`kbar`)
    await expect(plot.locator(`.x-label`)).toHaveText(`Pressure (kbar)`)
    await labeled_select(`Temperature`).selectOption(`°C`)
    await expect(plot.locator(`.y-label`)).toHaveText(`Temperature (°C)`)

    await pane.getByLabel(`Swap axes`).check()
    await expect(plot.locator(`.x-label`)).toHaveText(`Temperature (°C)`)
    await expect(plot.locator(`.y-label`)).toHaveText(`Pressure (kbar)`)
    // the log scale follows pressure onto the y axis
    await expect(scale_select(`Y`)).toHaveValue(`log`)
    await expect(scale_select(`X`)).toHaveValue(`linear`)
    await expect(plot.locator(`g.y-axis .tick text`).filter({ hasText: /^1k$/ })).toHaveCount(
      1,
    )
  })

  test(`legend toggles a phase's region and the export pane downloads the input JSON`, async ({
    page,
  }) => {
    const plot = diagram(page, 0)
    await plot.locator(`.legend-item`, { hasText: `α-Fe` }).click()
    await expect(plot.locator(`.regions path`)).toHaveCount(4)
    await expect(plot.locator(`.regions path[data-phase="alpha"]`)).toHaveCount(0)
    await plot.locator(`.legend-item`, { hasText: `α-Fe` }).click()
    await expect(plot.locator(`.regions path`)).toHaveCount(5)

    await plot.hover()
    await plot.locator(`button.export-toggle`).click()
    const downloaded = page.waitForEvent(`download`)
    await page
      .locator(`.export-pane:visible`)
      .getByRole(`button`, { name: `Download JSON`, exact: true })
      .click()
    const download = await downloaded
    expect(download.suggestedFilename()).toBe(`Fe-phase-diagram.json`)
    const path = await download.path()
    if (!path) throw new Error(`no downloaded JSON`)
    const exported = JSON.parse(await readFile(path, `utf8`))
    expect(exported.system).toBe(`Fe`)
    expect(exported.boundaries).toHaveLength(7)
  })

  test(`water diagram draws explicit regions, the critical point and swapped log axes`, async ({
    page,
  }) => {
    const plot = diagram(page, 1)
    await plot.scrollIntoViewIfNeeded()
    await expect(plot.locator(`.regions path`)).toHaveCount(4)
    await expect(plot.locator(`.special-point[data-type="critical"]`)).toHaveCount(1)
    await expect(plot.locator(`.x-label`)).toHaveText(`Temperature (°C)`)
    await expect(plot.locator(`.y-label`)).toHaveText(`Pressure (bar)`)

    const box = await plot.locator(`.special-point[data-type="critical"]`).boundingBox()
    if (!box) throw new Error(`critical point marker not rendered`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toContainText(`Critical point`)
    // 647.096 K and 22.064 MPa shown in the display units
    await expect(tooltip).toContainText(/373\.9\s*°C/)
    await expect(tooltip).toContainText(/220\.\d\s*bar/)
  })
})
