import { expect, type Locator, type Page, test } from '@playwright/test'
import { IS_CI } from '../helpers'
import { readFile } from 'node:fs/promises'

// CI environments are slower - use longer timeouts
const LOAD_TIMEOUT = IS_CI ? 20_000 : 8000

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

  test(`renders accessible diagram structure, axes and styled special points`, async ({
    page,
  }) => {
    const { diagram, svg } = get_diagram_elements(page)
    for (const [selector, minimum] of [
      [`.phase-regions path`, 3],
      [`g.x-axis > g text`, 4],
      [`g.y-axis > g text`, 4],
      [`.boundaries path`, 1],
      [`.special-points .special-point-marker`, 1],
      [`.grid line`, 8],
      [`.region-labels text`, 2],
    ] as const)
      expect(await svg.locator(selector).count(), selector).toBeGreaterThanOrEqual(minimum)
    await expect(diagram).toHaveAttribute(`role`, `img`)
    await expect(diagram).toHaveAttribute(`aria-label`, /phase diagram/i)
    await expect(svg).toHaveAttribute(`role`, `application`)
    await expect(svg).toHaveAttribute(`aria-label`, /phase diagram/i)
    await expect(svg).toHaveAttribute(`tabindex`, `0`)
    await expect(svg.locator(`.region-labels text`).first()).not.toHaveText(``)
    for (const component of [`A`, `B`]) {
      await expect(
        svg.locator(`text`).filter({ hasText: new RegExp(`^${component}$`) }),
      ).toBeVisible()
    }
    const x_ticks = svg.locator(`g.x-axis > g text`)
    await expect(x_ticks.first()).toHaveText(`0`)
    expect(Number(await x_ticks.last().textContent())).toBeGreaterThanOrEqual(80)
    await expect(
      svg.locator(`g.y-axis text`).filter({ hasText: /Temperature/i }),
    ).toBeVisible()
    await expect(
      svg.locator(`g.x-axis text`).filter({ hasText: /B.*%|at%|wt%/i }),
    ).toBeVisible()
    const special_points = svg.locator(`.special-points`)
    await expect(special_points).toBeVisible()
    const marker = special_points.locator(`.special-point-marker`).first()
    await expect(marker).toHaveAttribute(`fill`, /#\w+/)
    await expect(marker).toHaveAttribute(`stroke`, `white`)
    const labels = special_points.locator(`text`)
    if (await labels.count()) await expect(labels.first()).not.toHaveText(``)
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
    await expect(diagram.locator(`.click-feedback`)).toBeVisible()

    const text = await page.evaluate(() => navigator.clipboard.readText())
    expect(text).toContain(`Temperature:`)
    expect(text).toContain(`Composition:`)
  })

  test(`fullscreen toggle adds and removes class`, async ({ page }) => {
    const { diagram } = get_diagram_elements(page)
    await diagram.hover()

    const btn = diagram.locator(`section.control-buttons .fullscreen-btn`)
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

    const reset_visibility = pane.getByRole(`button`, { name: `Reset visibility to defaults` })
    await reset_visibility.click()
    await expect(boundaries).toBeVisible()
    await expect(reset_visibility).toHaveCount(0)
  })

  test(`export pane has format options and functional buttons`, async ({ page }) => {
    const { diagram } = get_diagram_elements(page)
    await diagram.hover()

    await diagram.locator(`.pd-export-toggle`).click()
    const pane = diagram.locator(`.export-pane`)
    await expect(pane).toBeVisible()

    await pane.locator(`input[type="number"]`).fill(`96`)
    for (const format of [`SVG`, `PNG`, `JSON`]) {
      const downloaded = page.waitForEvent(`download`)
      await pane.getByRole(`button`, { name: `Download ${format}`, exact: true }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`))
      const filepath = await download.path()
      if (!filepath) throw new Error(`Missing ${format} download`)
      const contents = await readFile(filepath)
      expect(contents.length).toBeGreaterThan(100)
      if (format === `SVG`) expect(contents.toString()).toContain(`<svg`)
      else if (format === `PNG`) expect(contents.subarray(1, 4).toString()).toBe(`PNG`)
      else expect(JSON.parse(contents.toString()).components).toHaveLength(2)
    }
    await page.context().grantPermissions([`clipboard-read`, `clipboard-write`])
    for (const format of [`SVG`, `JSON`]) {
      await pane.getByRole(`button`, { name: `Copy ${format} to clipboard` }).click()
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toContain(format === `SVG` ? `<svg` : `"components"`)
    }
  })

  test(`editor updates the component name in the rendered diagram`, async ({ page }) => {
    const { diagram, svg } = get_diagram_elements(page)
    await diagram.locator(`.pd-editor-toggle`).click()
    const editor = diagram.locator(`.pd-editor-pane`)
    await editor.locator(`.json-value.string`).filter({ hasText: `"A"` }).first().dblclick()
    const input = editor.locator(`.edit-input`)
    await input.fill(`Edited`)
    await input.press(`Enter`)
    await expect(diagram).toHaveAttribute(`aria-label`, `Edited-B binary phase diagram`)
    await expect(svg.locator(`text`).filter({ hasText: `Edited` })).toBeVisible()
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
    test.skip((await files.count()) < 2, `Requires at least 2 diagram files to test switching`)
    const active_file = page.locator(`.file-picker .file-item.active`)
    await expect(active_file).toBeVisible({ timeout: 5000 })
    const initial_active_text = (await active_file.textContent())?.trim()
    // TDB files may not load properly; use an inactive JSON fixture.
    const candidate = page
      .locator(`.file-picker .file-item:not(.active)`)
      .filter({ hasText: /\.json/ })
      .first()
    test.skip((await candidate.count()) === 0, `No inactive JSON file found to test switching`)
    const filename = (await candidate.textContent())?.trim()
    if (!filename) throw new Error(`Inactive JSON file has no name`)
    await candidate.click()
    await expect(svg.locator(`.phase-regions path`).first()).toBeVisible({
      timeout: LOAD_TIMEOUT,
    })
    await expect(active_file).toContainText(filename.replace(/\.json(?:\.gz)?$/, ``), {
      timeout: 5000,
    })
    expect((await active_file.textContent())?.trim()).not.toBe(initial_active_text)
    expect(await svg.locator(`.phase-regions path`).count()).toBeGreaterThanOrEqual(1)
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

    // Scan middle portion of diagram where two-phase regions typically are
    const margin = { left: 60, right: 15, top: 25, bottom: 50 }
    const plot_left = box.x + margin.left
    const plot_right = box.x + box.width - margin.right
    const plot_top = box.y + margin.top
    const plot_bottom = box.y + box.height - margin.bottom

    // Scan positions covering α+L (left side) and β+L (right side) regions
    for (const x_frac of [0.1, 0.15, 0.2, 0.7, 0.75, 0.8]) {
      for (const y_frac of [0.3, 0.4, 0.5, 0.6]) {
        const x_pos = plot_left + (plot_right - plot_left) * x_frac
        const y_pos = plot_top + (plot_bottom - plot_top) * y_frac
        await page.mouse.move(x_pos, y_pos)

        if (await tie_line.isVisible().catch(() => false)) {
          // Verify tie-line structure (2 lines: white outline + colored, 3 circles: 2 endpoints + cursor)
          expect(await tie_line.locator(`line`).count()).toBe(2)
          expect(await tie_line.locator(`circle`).count()).toBe(3)

          // Lever rule section should appear in tooltip
          const tooltip = diagram.locator(`.tooltip-container`)
          await expect(tooltip).toBeVisible()
          await expect(tooltip.locator(`.lever`)).toBeVisible()
          await expect(tooltip).toContainText(`Lever Rule`)
          return
        }
      }
    }

    throw new Error(`No tie-line found in the two-phase scan positions`)
  })

  for (const unlock of [`click`, `Escape`]) {
    test(`click locks tooltip and ${unlock} unlocks it`, async ({ page }) => {
      const { diagram, svg } = get_diagram_elements(page)
      const region = svg.locator(`.phase-regions path`).first()
      const tooltip = diagram.locator(`.tooltip-container`)
      await region.hover()
      await expect(tooltip).toBeVisible()
      await expect(tooltip).not.toHaveClass(/locked/)
      await region.click()
      await expect(tooltip).toHaveClass(/locked/)
      await expect(diagram.locator(`.tooltip-lock-indicator`)).toBeVisible()
      if (unlock === `click`) {
        await page.mouse.move(10, 10)
        await expect(tooltip).toBeVisible()
        await expect(tooltip).toHaveClass(/locked/)
        await region.click()
      } else await page.keyboard.press(`Escape`)
      await expect(tooltip).not.toHaveClass(/locked/)
      await page.mouse.move(10, 10)
      await expect(tooltip).toHaveCount(0)
    })
  }

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

  test(`e toggles the export pane, its chords stay the browser's`, async ({ page }) => {
    const { diagram } = get_diagram_elements(page)
    const pane = diagram.locator(`.export-pane`)
    await expect(pane).toBeHidden()
    await diagram.hover() // the shortcut follows the pointer

    for (const chord of [`Control+Shift+E`, `Meta+Shift+E`, `Control+E`, `Meta+E`]) {
      await page.keyboard.press(chord)
      await expect(pane, chord).toBeHidden()
    }

    await page.keyboard.press(`e`)
    await expect(pane).toBeVisible()
    await page.keyboard.press(`e`)
    await expect(pane).toBeHidden()
  })
})
