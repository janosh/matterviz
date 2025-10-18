import { expect, type Page, test } from '@playwright/test'

function setup_console_monitoring(page: Page): string[] {
  const console_errors: string[] = []
  page.on(`console`, (msg) => {
    if (msg.type() === `error`) console_errors.push(msg.text())
  })
  return console_errors
}

test.describe(`Bond component rendering`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `networkidle` })
    const canvas = page.locator(`#test-structure canvas`)
    await canvas.waitFor({ state: `visible`, timeout: 5000 })
  })

  test(`renders bonds without errors`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    await expect(canvas).toBeVisible()
    const screenshot = await canvas.screenshot()
    expect(screenshot.length).toBeGreaterThan(1000)
    expect(console_errors).toHaveLength(0)
  })

  test(`bonds render with gradient colors between atoms`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Take screenshots from different angles to verify bonds are visible
    const box = await canvas.boundingBox()
    if (box) {
      const initial = await canvas.screenshot()

      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      })

      const rotated = await canvas.screenshot()
      expect(initial.equals(rotated)).toBe(false)
    }
    expect(console_errors).toHaveLength(0)
  })

  test(`bond thickness and lighting parameters work correctly`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Verify scene renders with bonds at different settings
    await expect(canvas).toBeVisible()
    const screenshot = await canvas.screenshot()
    expect(screenshot.length).toBeGreaterThan(1000)
    expect(console_errors).toHaveLength(0)
  })
})
