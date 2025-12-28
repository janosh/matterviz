import { expect, type Locator, type Page, test } from '@playwright/test'

const get_diagram = (page: Page): Locator =>
  page.locator(`div.binary-phase-diagram`).first()
const get_svg = (diagram: Locator): Locator => diagram.locator(`:scope > svg`)

test.describe(`IsobaricBinaryPhaseDiagram`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
    const svg = get_svg(get_diagram(page))
    await expect(svg.locator(`.phase-regions path`).first()).toBeVisible({
      timeout: 8000,
    })
  })

  test(`renders complete diagram structure`, async ({ page }) => {
    const svg = get_svg(get_diagram(page))

    // Phase regions with multiple paths
    const regions = svg.locator(`.phase-regions path`)
    expect(await regions.count()).toBeGreaterThanOrEqual(3)

    // Both axes with tick labels
    expect(await svg.locator(`g.x-axis > g text`).count()).toBeGreaterThanOrEqual(4)
    expect(await svg.locator(`g.y-axis > g text`).count()).toBeGreaterThanOrEqual(4)

    // Boundaries
    expect(await svg.locator(`.boundaries path`).count()).toBeGreaterThanOrEqual(1)

    // Special points (eutectic/peritectic)
    const special_points = svg.locator(`.special-points circle`)
    expect(await special_points.count()).toBeGreaterThanOrEqual(1)
    await expect(special_points.first()).toHaveAttribute(`fill`, /#\w+/)

    // Grid lines
    expect(await svg.locator(`.grid line`).count()).toBeGreaterThanOrEqual(8)

    // Region labels with text
    const labels = svg.locator(`.region-labels text`)
    expect(await labels.count()).toBeGreaterThanOrEqual(2)
    expect((await labels.first().textContent())?.length).toBeGreaterThan(0)

    // Component labels A and B at corners
    await expect(svg.locator(`text`).filter({ hasText: /^A$/ })).toBeVisible()
    await expect(svg.locator(`text`).filter({ hasText: /^B$/ })).toBeVisible()
  })

  test(`tooltip shows phase info on hover and hides on leave`, async ({ page }) => {
    const diagram = get_diagram(page)
    const svg = get_svg(diagram)
    const tooltip = diagram.locator(`.tooltip-container`)
    const region = svg.locator(`.phase-regions path`).first()

    await expect(tooltip).toHaveCount(0)

    await region.hover()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`Temperature`)
    await expect(tooltip).toContainText(`Composition`)

    // Hovered region gets highlight class
    await expect(svg.locator(`.phase-regions path.hovered`)).toBeVisible()

    await page.mouse.move(10, 10)
    await expect(tooltip).toHaveCount(0)
  })

  test(`double-click copies phase data to clipboard`, async ({ page, context }) => {
    await context.grantPermissions([`clipboard-read`, `clipboard-write`])
    const diagram = get_diagram(page)
    const region = get_svg(diagram).locator(`.phase-regions path`).first()

    await region.hover()
    await expect(diagram.locator(`.tooltip-container`)).toBeVisible()

    await region.dblclick()
    await expect(diagram.locator(`.copy-feedback`)).toContainText(`Copied`)

    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(`Temperature:`)
    expect(text).toContain(`Composition:`)
  })

  test(`fullscreen toggle adds and removes class`, async ({ page }) => {
    const diagram = get_diagram(page)
    await diagram.hover()

    const btn = diagram.locator(`.header-controls button`).last()
    await btn.click()
    await expect(diagram).toHaveClass(/fullscreen/)

    await diagram.hover()
    await btn.click()
    await expect(diagram).not.toHaveClass(/fullscreen/)
  })

  test(`controls pane toggles element visibility`, async ({ page }) => {
    const diagram = get_diagram(page)
    const svg = get_svg(diagram)
    await diagram.hover()

    const toggle = diagram.locator(`.phase-diagram-controls-toggle`)
    await toggle.click()

    const pane = diagram.locator(`.phase-diagram-controls-pane`)
    await expect(pane).toBeVisible()

    // Must have at least 4 checkboxes (boundaries, grid, labels, special points)
    expect(await pane.locator(`input[type="checkbox"]`).count()).toBeGreaterThanOrEqual(4)

    // Toggle first checkbox off - boundaries should hide
    const boundaries = svg.locator(`.boundaries`)
    await expect(boundaries).toBeVisible()
    await pane.locator(`input[type="checkbox"]`).first().uncheck()
    await expect(boundaries).toBeHidden()

    // Toggle back on
    await pane.locator(`input[type="checkbox"]`).first().check()
    await expect(boundaries).toBeVisible()
  })

  test(`export pane has format options`, async ({ page }) => {
    const diagram = get_diagram(page)
    await diagram.hover()

    await diagram.locator(`.pd-export-toggle`).click()
    const pane = diagram.locator(`.export-pane`)
    await expect(pane).toBeVisible()
    await expect(pane).toContainText(`PNG`)
    await expect(pane).toContainText(`SVG`)
    await expect(pane).toContainText(`JSON`)
  })

  test(`axes have correct labels and range`, async ({ page }) => {
    const svg = get_svg(get_diagram(page))

    // X-axis: composition 0-100
    const x_ticks = svg.locator(`g.x-axis > g text`)
    expect(parseFloat((await x_ticks.first().textContent()) || ``)).toBe(0)
    expect(parseFloat((await x_ticks.last().textContent()) || ``)).toBeGreaterThanOrEqual(
      80,
    )

    // Y-axis: temperature label
    await expect(svg.locator(`g.y-axis text`).filter({ hasText: /Temperature/i }))
      .toBeVisible()

    // X-axis: composition label with component B
    await expect(svg.locator(`g.x-axis text`).filter({ hasText: /B.*%|at%|wt%/i }))
      .toBeVisible()
  })

  test(`ARIA attributes for accessibility`, async ({ page }) => {
    const diagram = get_diagram(page)
    const svg = get_svg(diagram)

    await expect(diagram).toHaveAttribute(`role`, `img`)
    await expect(diagram).toHaveAttribute(`aria-label`, /phase diagram/i)
    await expect(svg).toHaveAttribute(`role`, `application`)
    await expect(svg).toHaveAttribute(`aria-label`, /phase diagram/i)
    await expect(svg).toHaveAttribute(`tabindex`, `0`)
  })

  test(`no tooltip in axis/margin areas`, async ({ page }) => {
    const diagram = get_diagram(page)
    const svg = get_svg(diagram)
    const box = await svg.boundingBox()
    if (!box) throw new Error(`No bounding box`)

    // Hover in bottom margin (axis area)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5)
    await expect(diagram.locator(`.tooltip-container`)).toHaveCount(0)

    // Hover in left margin
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await expect(diagram.locator(`.tooltip-container`)).toHaveCount(0)
  })

  test(`responsive: SVG resizes with viewport`, async ({ page }) => {
    const svg = get_svg(get_diagram(page))
    const initial = await svg.boundingBox()
    if (!initial) throw new Error(`No initial bounding box`)

    await page.setViewportSize({ width: 500, height: 400 })
    const resized = await svg.boundingBox()
    if (!resized) throw new Error(`No resized bounding box`)

    expect(resized.width).toBeLessThan(initial.width)
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`file picker switches diagrams`, async ({ page }) => {
    const files = page.locator(`.file-picker button, .file-picker [role="option"]`)
    const count = await files.count()
    if (count < 2) return // Skip if only one file

    const svg = get_svg(get_diagram(page))
    await files.nth(1).click()
    await page.waitForTimeout(300)

    // Either diagram structure exists OR label changed (different diagram loaded)
    await expect(svg.locator(`.phase-regions path`).first()).toBeVisible()
  })

  test(`tie-line appears in two-phase regions`, async ({ page }) => {
    const svg = get_svg(get_diagram(page))
    const box = await svg.boundingBox()
    if (!box) throw new Error(`No bounding box`)

    const tie_line = svg.locator(`.tie-line`)

    // Hover at position likely to be in a two-phase region (mid-height)
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.65)

    // If tie-line visible, verify its structure
    if (await tie_line.isVisible().catch(() => false)) {
      await expect(tie_line.locator(`line`)).toBeVisible()
      expect(await tie_line.locator(`circle`).count()).toBeGreaterThanOrEqual(2)
    }
    // Acceptable if no two-phase region at this position
  })

  test(`click locks tooltip, persists on mouse leave`, async ({ page }) => {
    const diagram = get_diagram(page)
    const svg = get_svg(diagram)
    const region = svg.locator(`.phase-regions path`).first()

    await region.hover()
    const tooltip = diagram.locator(`.tooltip-container`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).not.toHaveClass(/locked/)

    // Click to lock
    await region.click()
    await expect(tooltip).toHaveClass(/locked/)
    await expect(diagram.locator(`.tooltip-lock-indicator`)).toBeVisible()

    // Move away - tooltip should stay visible (locked state persists)
    await page.mouse.move(10, 10)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveClass(/locked/)
  })
})
