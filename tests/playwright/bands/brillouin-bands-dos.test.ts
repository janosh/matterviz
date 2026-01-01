import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

test.describe(`BrillouinBandsDos Component Tests`, () => {
  // Increase timeout for all tests in this file - 3D rendering is slow in CI
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/brillouin-bands-dos`, { waitUntil: `networkidle` })
    // Wait for the default container and basic structure to be present
    // Use longer timeout since WebGL/3D initialization can be slow in CI
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container).toBeVisible({ timeout: 20000 })
    // Wait for canvas (BZ) to be present - WebGL may take time to initialize
    await page.waitForSelector(`[data-testid="bz-bands-dos-default"] canvas`, {
      timeout: 20000,
    })
  })

  test(`renders all three panels with content`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Check all three panels render
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    await expect(bands_svg).toBeVisible({ timeout: 10000 })
    await expect(bands_svg.locator(`path[fill="none"]`).first())
      .toBeVisible({ timeout: 10000 })

    // DOS SVG - find by looking for the second SVG with axes
    const dos_svg = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(dos_svg).toBeVisible({ timeout: 10000 })
    await expect(dos_svg.locator(`g.y-axis`)).toBeVisible({ timeout: 10000 })
    await expect(dos_svg.locator(`path[fill="none"]`).first())
      .toBeVisible({ timeout: 5000 })

    // Check for high-symmetry labels in bands
    const x_labels = await bands_svg.locator(`g.x-axis text`).allTextContents()
    expect(x_labels.join()).toMatch(/Γ|GAMMA/)
  })

  test(`applies custom styling and column widths`, async ({ page }) => {
    // Custom widths
    const widths_container = page.locator(`[data-testid="bz-bands-dos-custom-widths"]`)
    const grid_style = await widths_container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(grid_style).toBeTruthy()

    // Custom bands styling (red, thick lines)
    const styling_container = page.locator(`[data-testid="bz-bands-dos-bands-styling"]`)
    const first_path = styling_container.locator(`svg:has(g.x-axis)`).first().locator(
      `path[fill="none"]`,
    ).first()
    const stroke = await first_path.evaluate((el) => getComputedStyle(el).stroke)
    expect(stroke).toContain(`rgb(255, 0, 0)`)
  })

  test(`handles independent y-axes and custom BZ appearance`, async ({ page }) => {
    // Independent axes with mismatched ranges
    const indep_container = page.locator(`[data-testid="bz-bands-dos-independent-axes"]`)
    const bands_y = await indep_container.locator(`svg:has(g.x-axis)`).first().locator(
      `g.y-axis text`,
    )
      .allTextContents()
    const dos_y = await indep_container.locator(`svg:has(g.y-axis)`).nth(1).locator(
      `g.y-axis text`,
    )
      .allTextContents()
    expect(bands_y).not.toEqual(dos_y)

    // BZ controls visible when enabled
    const controls_container = page.locator(`[data-testid="bz-bands-dos-with-controls"]`)
    await expect(controls_container.locator(`button.controls-toggle`)).toBeVisible()
  })

  test(`renders multiple structures with legend`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-multiple"]`)
    // There may be multiple legends (Bands and DOS both show legends for multiple series)
    // Just check that at least one legend exists and has the expected content
    const legend = container.locator(`.legend`).first()

    await expect(legend).toBeVisible()
    expect(await legend.locator(`.legend-item`).count()).toBeGreaterThanOrEqual(2)
    expect(await legend.textContent()).toContain(`DFT`)
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    await page.setViewportSize({ width: 800, height: 600 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    expect(await container.boundingBox()).toBeTruthy()

    await page.setViewportSize({ width: 1600, height: 1200 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    expect(await container.boundingBox()).toBeTruthy()
  })

  test(`hover synchronization updates BZ canvas`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    const bz_canvas = container.locator(`canvas`).first()
    const initial = await bz_canvas.screenshot()

    // Hover over band path
    await container.locator(`svg:has(g.x-axis)`).first().locator(`path[fill="none"]`)
      .first().hover({
        position: { x: 100, y: 100 },
        force: true, // Bypass pointer interception from overlapping SVG
      })

    // Wait for canvas to repaint by checking for any change
    await page.waitForFunction(() =>
      new Promise((resolve) => requestAnimationFrame(() => resolve(true)))
    )

    expect(Buffer.compare(initial, await bz_canvas.screenshot())).not.toBe(0)
  })

  test(`BZ rotates with mouse drag`, async ({ page }) => {
    const bz_canvas = page.locator(`[data-testid="bz-bands-dos-default"] canvas`).first()
    const initial = await bz_canvas.screenshot()

    const box = await bz_canvas.boundingBox()
    if (box) {
      const center_x = box.x + box.width / 2
      const center_y = box.y + box.height / 2
      await page.mouse.move(center_x, center_y)
      await page.mouse.down()
      await page.mouse.move(center_x + 50, center_y)
      await page.mouse.up()

      // Wait for canvas to repaint after drag
      await page.waitForFunction(() =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(true)))
      )
    }

    expect(Buffer.compare(initial, await bz_canvas.screenshot())).not.toBe(0)
  })

  test(`shared y-axis synchronizes bands and DOS ticks`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    const bands_y = await container.locator(`svg:has(g.x-axis)`).first().locator(
      `g.y-axis text`,
    )
      .allTextContents()
    const dos_y = await container.locator(`svg:has(g.y-axis)`).nth(1).locator(
      `g.y-axis text`,
    )
      .allTextContents()

    expect(bands_y.some((tick) => dos_y.includes(tick))).toBe(true)
  })

  test(`desktop layout: three columns side by side`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    const grid_template = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gridTemplateAreas)

    // Desktop layout: bz bands dos
    expect(grid_template).toContain(`bz`)
    expect(grid_template).toContain(`bands`)
    expect(grid_template).toContain(`dos`)

    // All three components should be visible
    await expect(container.locator(`canvas`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
  })

  test(`tablet layout: bands on top, BZ and DOS below`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    const grid_template = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          areas: style.gridTemplateAreas,
          columns: style.gridTemplateColumns,
        }
      })

    // Tablet layout should have bands spanning top, bz and dos below
    expect(grid_template.areas).toMatch(/bands.*bands/)
    expect(grid_template.areas).toContain(`bz`)
    expect(grid_template.areas).toContain(`dos`)

    // Should have 2 columns
    const column_count = grid_template.columns.split(` `).length
    expect(column_count).toBe(2)
  })

  test(`phone layout: all stacked vertically`, async ({ page }) => {
    await page.setViewportSize({ width: 500, height: 900 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    const grid_template = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => {
        const style = getComputedStyle(el)
        return {
          areas: style.gridTemplateAreas,
          columns: style.gridTemplateColumns,
        }
      })

    // Phone layout: vertical stack
    const area_lines = grid_template.areas.split(`"`)
    expect(area_lines.length).toBeGreaterThanOrEqual(3)

    // Should have 1 column
    expect(grid_template.columns).not.toContain(` `)

    // All components still visible
    await expect(container.locator(`canvas`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
  })

  test(`DOS orientation changes with viewport`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Desktop: horizontal DOS
    await page.setViewportSize({ width: 1400, height: 800 })
    const dos_svg_wide = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(dos_svg_wide).toBeVisible()
    const dos_box_wide = await dos_svg_wide.boundingBox()
    expect(dos_box_wide).toBeTruthy()
    if (dos_box_wide) {
      expect(dos_box_wide.width).toBeLessThan(dos_box_wide.height * 2)
    }

    // Tablet/Phone: vertical DOS (wider than tall)
    await page.setViewportSize({ width: 800, height: 700 })
    const dos_svg_narrow = container.locator(`svg:has(g.y-axis)`).nth(1)
    await expect(dos_svg_narrow).toBeVisible()
    const dos_box_narrow = await dos_svg_narrow.boundingBox()
    expect(dos_box_narrow).toBeTruthy()
    if (dos_box_narrow) {
      expect(dos_box_narrow.width).toBeGreaterThan(dos_box_narrow.height * 0.5)
    }
  })

  test(`BZ respects height constraints on tablet layout`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    const bz_canvas = container.locator(`canvas`).first()
    await expect(bz_canvas).toBeVisible()
    const canvas_box = await bz_canvas.boundingBox()
    const container_box = await container.boundingBox()

    expect(canvas_box).toBeTruthy()
    expect(container_box).toBeTruthy()

    if (canvas_box && container_box) {
      // BZ should not overflow container height
      expect(canvas_box.height).toBeLessThanOrEqual(container_box.height / 2 + 50)
    }
  })

  test(`grid gap is applied consistently`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Test desktop
    await page.setViewportSize({ width: 1400, height: 700 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const gap_desktop = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gap)
    expect(gap_desktop).toBeTruthy()
    expect(gap_desktop).not.toBe(`0px`)

    // Test tablet
    await page.setViewportSize({ width: 800, height: 700 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const gap_tablet = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gap)
    expect(gap_tablet).toBeTruthy()
    expect(gap_tablet).not.toBe(`0px`)

    // Test phone
    await page.setViewportSize({ width: 500, height: 700 })
    await expect(container.locator(`canvas`).first()).toBeVisible()
    const gap_phone = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gap)
    expect(gap_phone).toBeTruthy()
    expect(gap_phone).not.toBe(`0px`)
  })

  test(`responsive layout preserves interaction`, async ({ page }) => {
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)

    // Test at tablet size
    await page.setViewportSize({ width: 800, height: 700 })
    const bz_canvas = container.locator(`canvas`).first()
    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    await expect(bz_canvas).toBeVisible()

    // BZ should still rotate
    const initial = await bz_canvas.screenshot()
    const box = await bz_canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 50)
      await page.mouse.down()
      await page.mouse.move(box.x + 100, box.y + 50)
      await page.mouse.up()

      // Wait for canvas to repaint after drag
      await page.waitForFunction(() =>
        new Promise((resolve) => requestAnimationFrame(() => resolve(true)))
      )
    }
    expect(Buffer.compare(initial, await bz_canvas.screenshot())).not.toBe(0)

    // Bands should still be hoverable
    await bands_svg.locator(`path[fill="none"]`).first().hover({
      position: { x: 50, y: 50 },
      force: true,
    })
    await expect(bands_svg).toBeVisible()
  })

  test(`hovering over DOS shows reference lines in both bands and DOS`, async ({ page }) => {
    // Set desktop viewport to ensure consistent layout
    await page.setViewportSize({ width: 1400, height: 800 })
    const container = page.locator(`[data-testid="bz-bands-dos-default"]`)
    await expect(container.locator(`canvas`).first()).toBeVisible()

    // In desktop layout (grid: bz bands dos), bands SVG is first, DOS SVG is second
    const bands_svg = container.locator(`svg:has(g.x-axis)`).first()
    const dos_svg = container.locator(`svg:has(g.y-axis)`).nth(1)

    await expect(bands_svg).toBeVisible()
    await expect(dos_svg).toBeVisible()

    // Get initial count of dashed lines (fermi level lines may already exist)
    const initial_dashed_count = await bands_svg.locator(`line[stroke-dasharray]`).count()

    // Hover over DOS plot area (on a DOS path to trigger hover)
    const dos_path = dos_svg.locator(`path[fill="none"]`).first()
    await expect(dos_path).toBeVisible()
    await dos_path.hover({ force: true })

    // Wait for hover state to update - reference lines with stroke-dasharray should appear
    await expect(async () => {
      const current_dashed_count = await bands_svg.locator(`line[stroke-dasharray]`)
        .count()
      // Reference line should be added on hover (in addition to any existing fermi level lines)
      expect(current_dashed_count).toBeGreaterThan(initial_dashed_count)
    }).toPass({ timeout: 3000 })
  })

  test(`renders children snippet content`, async ({ page }) => {
    // Navigate to section with children (multiple-structures)
    await page.locator(`#multiple-structures`).scrollIntoViewIfNeeded()

    // Find the container with children (multiple structures example)
    const container = page.locator(`[data-testid="bz-bands-dos-multiple"]`)
    await expect(container).toBeVisible()

    // Verify the custom overlay child element is rendered
    const custom_overlay = container.locator(`.custom-overlay`)
    await expect(custom_overlay).toBeVisible()
    await expect(custom_overlay).toHaveText(`Custom Overlay`)

    // Verify all three panels are still working
    await expect(container.locator(`canvas`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.x-axis)`).first()).toBeVisible()
    await expect(container.locator(`svg:has(g.y-axis)`).nth(1)).toBeVisible()
  })
})
