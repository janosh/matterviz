import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

test.describe(`BrillouinBandsDos Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/brillouin-bands-dos`, { waitUntil: `networkidle` })
    // Wait for WebGL/Three.js to initialize
    await page.waitForTimeout(500)
  })

  test(`renders all three panels with content`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)

    // Check all three panels render
    await expect(container.locator(`canvas`).first()).toBeVisible()
    await expect(container.locator(`svg`).nth(0).locator(`path[fill="none"]`).first())
      .toBeVisible()
    await expect(container.locator(`svg`).nth(1).locator(`path[fill="none"]`).first())
      .toBeVisible()

    // Check for high-symmetry labels in bands
    const x_labels = await container.locator(`svg`).nth(0).locator(`g.x-axis text`)
      .allTextContents()
    expect(x_labels.join()).toMatch(/Γ|GAMMA/)
  })

  test(`applies custom styling and column widths`, async ({ page }) => {
    // Custom widths
    const widths_container = page.locator(`[data-testid="bands-dos-bz-custom-widths"]`)
    const grid_style = await widths_container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns)
    expect(grid_style).toBeTruthy()

    // Custom bands styling (red, thick lines)
    const styling_container = page.locator(`[data-testid="bands-dos-bz-bands-styling"]`)
    const first_path = styling_container.locator(`svg`).nth(0).locator(
      `path[fill="none"]`,
    ).first()
    const stroke = await first_path.evaluate((el) => getComputedStyle(el).stroke)
    expect(stroke).toContain(`rgb(255, 0, 0)`)
  })

  test(`handles independent y-axes and custom BZ appearance`, async ({ page }) => {
    // Independent axes with mismatched ranges
    const indep_container = page.locator(`[data-testid="bands-dos-bz-independent-axes"]`)
    const bands_y = await indep_container.locator(`svg`).nth(0).locator(`g.y-axis text`)
      .allTextContents()
    const dos_y = await indep_container.locator(`svg`).nth(1).locator(`g.y-axis text`)
      .allTextContents()
    expect(bands_y).not.toEqual(dos_y)

    // BZ controls visible when enabled
    const controls_container = page.locator(`[data-testid="bands-dos-bz-with-controls"]`)
    await expect(controls_container.locator(`button.controls-toggle`)).toBeVisible()
  })

  test(`renders multiple structures with legend`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-multiple"]`)
    const legend = container.locator(`svg`).nth(0).locator(`.legend`)

    await expect(legend).toBeVisible()
    expect(await legend.locator(`.legend-item`).count()).toBeGreaterThanOrEqual(2)
    expect(await legend.textContent()).toContain(`DFT`)
  })

  test(`maintains responsive layout`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)

    await page.setViewportSize({ width: 800, height: 600 })
    await page.waitForTimeout(100)
    expect(await container.boundingBox()).toBeTruthy()

    await page.setViewportSize({ width: 1600, height: 1200 })
    await page.waitForTimeout(100)
    expect(await container.boundingBox()).toBeTruthy()
  })

  test(`hover synchronization updates BZ canvas`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)
    const bz_canvas = container.locator(`canvas`).first()
    const initial = await bz_canvas.screenshot()

    // Hover over band path
    await container.locator(`svg`).nth(0).locator(`path[fill="none"]`).first().hover({
      position: { x: 100, y: 100 },
    })
    await page.waitForTimeout(100)

    expect(Buffer.compare(initial, await bz_canvas.screenshot())).not.toBe(0)
  })

  test(`BZ rotates with mouse drag`, async ({ page }) => {
    const bz_canvas = page.locator(`[data-testid="bands-dos-bz-default"] canvas`).first()
    const initial = await bz_canvas.screenshot()

    const box = await bz_canvas.boundingBox()
    if (box) {
      const center_x = box.x + box.width / 2
      const center_y = box.y + box.height / 2
      await page.mouse.move(center_x, center_y)
      await page.mouse.down()
      await page.mouse.move(center_x + 50, center_y)
      await page.mouse.up()
      await page.waitForTimeout(200)
    }

    expect(Buffer.compare(initial, await bz_canvas.screenshot())).not.toBe(0)
  })

  test(`shared y-axis synchronizes bands and DOS ticks`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)
    const bands_y = await container.locator(`svg`).nth(0).locator(`g.y-axis text`)
      .allTextContents()
    const dos_y = await container.locator(`svg`).nth(1).locator(`g.y-axis text`)
      .allTextContents()

    expect(bands_y.some((tick) => dos_y.includes(tick))).toBe(true)
  })

  test(`desktop layout: three columns side by side`, async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.waitForTimeout(200)

    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)
    const grid_template = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gridTemplateAreas)

    // Desktop layout: bz bands dos
    expect(grid_template).toContain(`bz`)
    expect(grid_template).toContain(`bands`)
    expect(grid_template).toContain(`dos`)

    // All three components should be visible
    await expect(container.locator(`canvas`).first()).toBeVisible()
    await expect(container.locator(`svg`).nth(0)).toBeVisible()
    await expect(container.locator(`svg`).nth(1)).toBeVisible()
  })

  test(`tablet layout: bands on top, BZ and DOS below`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    await page.waitForTimeout(200)

    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)
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
    await page.waitForTimeout(200)

    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)
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
    await expect(container.locator(`svg`).nth(0)).toBeVisible()
    await expect(container.locator(`svg`).nth(1)).toBeVisible()
  })

  test(`DOS orientation changes with viewport`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)

    // Desktop: horizontal DOS
    await page.setViewportSize({ width: 1400, height: 800 })
    await page.waitForTimeout(200)
    const dos_svg_wide = container.locator(`svg`).nth(1)
    const dos_box_wide = await dos_svg_wide.boundingBox()
    expect(dos_box_wide).toBeTruthy()
    if (dos_box_wide) {
      expect(dos_box_wide.width).toBeLessThan(dos_box_wide.height * 2)
    }

    // Tablet/Phone: vertical DOS (wider than tall)
    await page.setViewportSize({ width: 800, height: 700 })
    await page.waitForTimeout(200)
    const dos_svg_narrow = container.locator(`svg`).nth(1)
    const dos_box_narrow = await dos_svg_narrow.boundingBox()
    expect(dos_box_narrow).toBeTruthy()
    if (dos_box_narrow) {
      expect(dos_box_narrow.width).toBeGreaterThan(dos_box_narrow.height * 0.5)
    }
  })

  test(`BZ respects height constraints on tablet layout`, async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    await page.waitForTimeout(200)

    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)
    const bz_canvas = container.locator(`canvas`).first()
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
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)

    // Test desktop
    await page.setViewportSize({ width: 1400, height: 700 })
    await page.waitForTimeout(100)
    const gap_desktop = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gap)
    expect(gap_desktop).toBeTruthy()
    expect(gap_desktop).not.toBe(`0px`)

    // Test tablet
    await page.setViewportSize({ width: 800, height: 700 })
    await page.waitForTimeout(100)
    const gap_tablet = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gap)
    expect(gap_tablet).toBeTruthy()
    expect(gap_tablet).not.toBe(`0px`)

    // Test phone
    await page.setViewportSize({ width: 500, height: 700 })
    await page.waitForTimeout(100)
    const gap_phone = await container
      .locator(`.bands-dos-brillouin`)
      .evaluate((el) => getComputedStyle(el).gap)
    expect(gap_phone).toBeTruthy()
    expect(gap_phone).not.toBe(`0px`)
  })

  test(`responsive layout preserves interaction`, async ({ page }) => {
    const container = page.locator(`[data-testid="bands-dos-bz-default"]`)

    // Test at tablet size
    await page.setViewportSize({ width: 800, height: 700 })
    await page.waitForTimeout(200)

    const bz_canvas = container.locator(`canvas`).first()
    const bands_svg = container.locator(`svg`).nth(0)

    // BZ should still rotate
    const initial = await bz_canvas.screenshot()
    const box = await bz_canvas.boundingBox()
    if (box) {
      await page.mouse.move(box.x + 50, box.y + 50)
      await page.mouse.down()
      await page.mouse.move(box.x + 100, box.y + 50)
      await page.mouse.up()
      await page.waitForTimeout(200)
    }
    expect(Buffer.compare(initial, await bz_canvas.screenshot())).not.toBe(0)

    // Bands should still be hoverable
    await bands_svg.locator(`path[fill="none"]`).first().hover({
      position: { x: 50, y: 50 },
    })
    await page.waitForTimeout(100)
    await expect(bands_svg).toBeVisible()
  })
})
