// deno-lint-ignore-file no-await-in-loop -- Playwright tests require sequential awaits for UI interactions
import { expect, type Locator, type Page, test } from '@playwright/test'

const LOAD_TIMEOUT = 8000

// Fixture-like helper returning both diagram and svg
function get_diagram_elements(page: Page): { diagram: Locator; svg: Locator } {
  const diagram = page.locator(`div.binary-phase-diagram`).first()
  return { diagram, svg: diagram.locator(`:scope > svg`) }
}

test.describe(`IsobaricBinaryPhaseDiagram`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/phase-diagram`, { waitUntil: `networkidle` })
    const { svg } = get_diagram_elements(page)
    await expect(svg.locator(`.phase-regions path`).first()).toBeVisible({
      timeout: LOAD_TIMEOUT,
    })
  })

  test(`renders complete diagram structure`, async ({ page }) => {
    const { svg } = get_diagram_elements(page)

    // Phase regions with multiple paths
    const regions = svg.locator(`.phase-regions path`)
    expect(await regions.count()).toBeGreaterThanOrEqual(3)

    // Both axes with tick labels
    expect(await svg.locator(`g.x-axis > g text`).count()).toBeGreaterThanOrEqual(4)
    expect(await svg.locator(`g.y-axis > g text`).count()).toBeGreaterThanOrEqual(4)

    // Boundaries
    expect(await svg.locator(`.boundaries path`).count()).toBeGreaterThanOrEqual(1)

    // Special points (eutectic/peritectic) - select marker circles, not hit-areas
    const special_point_markers = svg.locator(`.special-points .special-point-marker`)
    expect(await special_point_markers.count()).toBeGreaterThanOrEqual(1)
    await expect(special_point_markers.first()).toHaveAttribute(`fill`, /#\w+/)

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
    const { diagram, svg } = get_diagram_elements(page)
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
    const { diagram, svg } = get_diagram_elements(page)
    const region = svg.locator(`.phase-regions path`).first()

    await region.hover()
    await expect(diagram.locator(`.tooltip-container`)).toBeVisible()

    await region.dblclick()
    await expect(diagram.locator(`.copy-feedback`)).toContainText(`Copied`)

    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(`Temperature:`)
    expect(text).toContain(`Composition:`)
  })

  test(`fullscreen toggle adds and removes class`, async ({ page }) => {
    const { diagram } = get_diagram_elements(page)
    await diagram.hover()

    const btn = diagram.locator(`.header-controls button`).last()
    await btn.click()
    await expect(diagram).toHaveClass(/fullscreen/)

    await diagram.hover()
    await btn.click()
    await expect(diagram).not.toHaveClass(/fullscreen/)
  })

  test(`controls pane toggles element visibility`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
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

  test(`export pane has format options and functional buttons`, async ({ page }) => {
    const { diagram } = get_diagram_elements(page)
    await diagram.hover()

    await diagram.locator(`.pd-export-toggle`).click()
    const pane = diagram.locator(`.export-pane`)
    await expect(pane).toBeVisible()

    // Format labels present
    await expect(pane).toContainText(`PNG`)
    await expect(pane).toContainText(`SVG`)
    await expect(pane).toContainText(`JSON`)

    // Download and copy buttons exist (some may be disabled until SVG renders)
    const buttons = pane.locator(`button`)
    expect(await buttons.count()).toBeGreaterThanOrEqual(4) // 2 per format minimum

    // DPI input exists
    await expect(pane.locator(`input[type="number"]`)).toBeVisible()
  })

  test(`axes have correct labels and range`, async ({ page }) => {
    const { svg } = get_diagram_elements(page)

    // X-axis: composition 0-100
    const x_ticks = svg.locator(`g.x-axis > g text`)
    expect(parseFloat((await x_ticks.first().textContent()) || ``)).toBe(0)
    expect(parseFloat((await x_ticks.last().textContent()) || ``)).toBeGreaterThanOrEqual(
      80,
    )

    // Y-axis: temperature label
    await expect(
      svg.locator(`g.y-axis text`).filter({ hasText: /Temperature/i }),
    ).toBeVisible()

    // X-axis: composition label with component B
    await expect(
      svg.locator(`g.x-axis text`).filter({ hasText: /B.*%|at%|wt%/i }),
    ).toBeVisible()
  })

  test(`ARIA attributes for accessibility`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)

    await expect(diagram).toHaveAttribute(`role`, `img`)
    await expect(diagram).toHaveAttribute(`aria-label`, /phase diagram/i)
    await expect(svg).toHaveAttribute(`role`, `application`)
    await expect(svg).toHaveAttribute(`aria-label`, /phase diagram/i)
    await expect(svg).toHaveAttribute(`tabindex`, `0`)
  })

  test(`no tooltip in axis/margin areas`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
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
    const { svg } = get_diagram_elements(page)
    const initial = await svg.boundingBox()
    if (!initial) throw new Error(`No initial bounding box`)

    await page.setViewportSize({ width: 500, height: 400 })
    const resized = await svg.boundingBox()
    if (!resized) throw new Error(`No resized bounding box`)

    expect(resized.width).toBeLessThan(initial.width)
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`file picker switches diagrams`, async ({ page }) => {
    const { svg } = get_diagram_elements(page)
    const files = page.locator(`.file-picker .file-item`)
    const count = await files.count()
    if (count < 2) test.skip(true, `Requires at least 2 diagram files to test switching`)

    // Capture initial state
    const initial_regions = await svg.locator(`.phase-regions path`).count()
    const initial_label = await svg.locator(`.region-labels text`).first().textContent()

    // Click a non-active file (find first file that's not currently active)
    const inactive_file = files.filter({ hasNot: page.locator(`.active`) }).first()
    await inactive_file.click()

    // Wait for the clicked file to become active (diagram has loaded)
    await expect(inactive_file).toHaveClass(/active/, { timeout: 5000 })

    // Verify something changed (region count or label text)
    const new_regions = await svg.locator(`.phase-regions path`).count()
    const new_label = await svg.locator(`.region-labels text`).first().textContent()
    expect(new_regions !== initial_regions || new_label !== initial_label).toBe(true)
  })

  test(`tie-line and lever rule in two-phase regions`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)

    // Check if diagram has two-phase regions (labeled with "+")
    const two_phase_label = svg.locator(`.region-labels text`).filter({ hasText: /\+/ })
    if ((await two_phase_label.count()) === 0) test.skip()

    // Scroll diagram into view first
    await svg.scrollIntoViewIfNeeded()

    // Get SVG bounding box and scan for tie-line by hovering at grid positions
    const box = await svg.boundingBox()
    if (!box) throw new Error(`No SVG bounding box`)

    const tie_line = svg.locator(`.tie-line`)
    let found_tie_line = false

    // Scan middle portion of diagram where two-phase regions typically are
    const margin = { left: 60, right: 15, top: 25, bottom: 50 }
    const plot_left = box.x + margin.left
    const plot_right = box.x + box.width - margin.right
    const plot_top = box.y + margin.top
    const plot_bottom = box.y + box.height - margin.bottom

    // Scan positions covering α+L (left side) and β+L (right side) regions
    outer: for (const x_frac of [0.1, 0.15, 0.2, 0.7, 0.75, 0.8]) {
      for (const y_frac of [0.3, 0.4, 0.5, 0.6]) {
        const x_pos = plot_left + (plot_right - plot_left) * x_frac
        const y_pos = plot_top + (plot_bottom - plot_top) * y_frac
        await page.mouse.move(x_pos, y_pos)

        if (await tie_line.isVisible().catch(() => false)) {
          found_tie_line = true

          // Verify tie-line structure (2 lines: white outline + colored, 3 circles: 2 endpoints + cursor)
          expect(await tie_line.locator(`line`).count()).toBe(2)
          expect(await tie_line.locator(`circle`).count()).toBe(3)

          // Lever rule section should appear in tooltip
          const tooltip = diagram.locator(`.tooltip-container`)
          await expect(tooltip).toBeVisible()
          await expect(tooltip.locator(`.lever`)).toBeVisible()
          await expect(tooltip).toContainText(`Lever Rule`)
          break outer
        }
      }
    }

    expect(found_tie_line).toBe(true)
  })

  test(`click locks tooltip, persists on mouse leave`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
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

  test(`click again unlocks tooltip`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
    const region = svg.locator(`.phase-regions path`).first()

    // Lock tooltip
    await region.hover()
    await region.click()
    const tooltip = diagram.locator(`.tooltip-container`)
    await expect(tooltip).toHaveClass(/locked/)

    // Click again to unlock
    await region.click()
    await expect(tooltip).not.toHaveClass(/locked/)

    // Move away - tooltip should disappear now
    await page.mouse.move(10, 10)
    await expect(tooltip).toHaveCount(0)
  })

  test(`Escape key unlocks tooltip`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
    const region = svg.locator(`.phase-regions path`).first()

    // Lock tooltip
    await region.hover()
    await region.click()
    const tooltip = diagram.locator(`.tooltip-container`)
    await expect(tooltip).toHaveClass(/locked/)

    // Press Escape to unlock
    await page.keyboard.press(`Escape`)
    await expect(tooltip).not.toHaveClass(/locked/)
  })

  test(`Enter/Space toggles tooltip lock when SVG focused`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
    const region = svg.locator(`.phase-regions path`).first()

    await region.hover()
    const tooltip = diagram.locator(`.tooltip-container`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).not.toHaveClass(/locked/)

    // Focus SVG and press Enter to lock
    await svg.focus()
    await page.keyboard.press(`Enter`)
    await expect(tooltip).toHaveClass(/locked/)

    // Press Space to unlock
    await page.keyboard.press(`Space`)
    await expect(tooltip).not.toHaveClass(/locked/)
  })

  for (const modifier of [`Control`, `Meta`]) {
    test(`${modifier}+Shift+E toggles export pane`, async ({ page }) => {
      const { diagram } = get_diagram_elements(page)
      const pane = diagram.locator(`.export-pane`)

      await expect(pane).toBeHidden()

      await page.keyboard.press(`${modifier}+Shift+E`)
      await expect(pane).toBeVisible()

      await page.keyboard.press(`${modifier}+Shift+E`)
      await expect(pane).toBeHidden()
    })
  }

  test(`special points have labels and correct styling`, async ({ page }) => {
    const { svg } = get_diagram_elements(page)
    const special_points = svg.locator(`.special-points`)

    await expect(special_points).toBeVisible()

    // Select marker circles specifically (not hit-area circles which are transparent)
    const markers = special_points.locator(`.special-point-marker`)
    expect(await markers.count()).toBeGreaterThanOrEqual(1)

    // Check styling: fill color, white stroke
    const first_marker = markers.first()
    await expect(first_marker).toHaveAttribute(`fill`, /#\w+/)
    await expect(first_marker).toHaveAttribute(`stroke`, `white`)

    // Check for label text if present
    const labels = special_points.locator(`text`)
    if ((await labels.count()) > 0) {
      expect((await labels.first().textContent())?.length).toBeGreaterThan(0)
    }
  })
})
