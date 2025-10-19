import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

test.describe(`BrillouinBandsDos Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/bands-dos-brillouin`, { waitUntil: `networkidle` })
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
})
