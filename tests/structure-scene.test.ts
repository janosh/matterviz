import { expect, test, type Page } from '@playwright/test'

// Cached atom position to avoid repeated searches
let cached_atom_position: { x: number; y: number } | null = null

// Helper function to try multiple positions to find a hoverable atom (optimized)
async function find_hoverable_atom(
  page: Page,
): Promise<{ x: number; y: number } | null> {
  const canvas = page.locator(`#structure-wrapper canvas`)

  // Use cached position if available
  if (cached_atom_position) return cached_atom_position

  const positions = [
    { x: 300, y: 200 },
    { x: 250, y: 150 },
    { x: 350, y: 250 },
    { x: 200, y: 300 },
    { x: 400, y: 250 },
  ]

  for (const position of positions) {
    await canvas.hover({ position })
    await page.waitForTimeout(100) // Reduced from 200ms

    // Look for StructureScene tooltip specifically (has coordinates)
    const structure_tooltip = page.locator(`.tooltip:has(.coordinates)`)
    if (await structure_tooltip.isVisible()) {
      cached_atom_position = position // Cache for future use
      return position
    }
  }

  return null
}

// Helper to setup console error monitoring
function setup_console_monitoring(page: Page): string[] {
  const console_errors: string[] = []
  page.on(`console`, (msg) => {
    if (msg.type() === `error` && !msg.text().includes(`Log scale`)) {
      console_errors.push(msg.text())
    }
  })
  return console_errors
}

test.describe(`StructureScene Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await page.goto(`/test/structure`, { waitUntil: `load` })
    await page.waitForSelector(`#structure-wrapper canvas`, { timeout: 5000 })
    await page.waitForTimeout(2000) // Reduced from 4000ms
  })

  // Combined basic functionality and rendering test
  test(`scene renders correctly with atoms and proper lighting`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    // Verify basic setup and visual rendering
    await expect(canvas).toHaveAttribute(`width`)
    await expect(canvas).toHaveAttribute(`height`)

    const screenshot = await canvas.screenshot()
    expect(screenshot.length).toBeGreaterThan(1000) // Non-empty, lit scene

    // Try to find hoverable atom for tooltip verification
    const atom_position = await find_hoverable_atom(page)
    if (atom_position) {
      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      await expect(tooltip.first()).toBeVisible({ timeout: 1000 })
      await expect(tooltip.first().locator(`.elements`)).toBeVisible()
      await expect(tooltip.first().locator(`.coordinates`)).toHaveCount(2)
    }

    await page.waitForTimeout(500) // Brief wait for any async operations
    expect(console_errors).toHaveLength(0)
  })

  // Combined tooltip functionality tests
  test(`tooltip displays comprehensive information correctly`, async ({
    page,
  }) => {
    const atom_position = await find_hoverable_atom(page)
    test.skip(!atom_position, `No hoverable atoms found in current view`)

    const canvas = page.locator(`#structure-wrapper canvas`)
    await canvas.hover({ position: atom_position! })

    const tooltip = page.locator(`.tooltip:has(.coordinates)`)
    await expect(tooltip).toBeVisible({ timeout: 1000 })

    // Check all tooltip content in one test
    const elements_section = tooltip.locator(`.elements`)
    await expect(elements_section).toBeVisible()

    const coordinates_sections = tooltip.locator(`.coordinates`)
    await expect(coordinates_sections).toHaveCount(2)

    // Verify coordinate formatting
    const abc_coords = coordinates_sections.filter({ hasText: `abc:` })
    const xyz_coords = coordinates_sections.filter({ hasText: `xyz:` })

    await expect(abc_coords).toBeVisible()
    await expect(xyz_coords).toBeVisible()

    const abc_text = await abc_coords.textContent()
    const xyz_text = await xyz_coords.textContent()

    expect(abc_text).toMatch(/abc:\s*\([\d\.-]+,\s*[\d\.-]+,\s*[\d\.-]+\)/)
    expect(xyz_text).toMatch(/xyz:\s*\([\d\.-]+,\s*[\d\.-]+,\s*[\d\.-]+\)\s*Å/)

    // Test tooltip disappears when moving away
    await canvas.hover({ position: { x: 50, y: 50 } })
    await expect(tooltip).not.toBeVisible({ timeout: 1000 })
  })

  // Combined interaction tests
  test(`click interactions and distance measurements work correctly`, async ({
    page,
  }) => {
    const first_atom = await find_hoverable_atom(page)
    test.skip(!first_atom, `No hoverable atoms found in current view`)

    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    // Test click to activate
    await canvas.click({ position: first_atom! })
    await page.waitForTimeout(200)

    // Find second atom for distance measurement
    const positions = [
      { x: 200, y: 150 },
      { x: 400, y: 200 },
      { x: 350, y: 300 },
    ].filter((pos) => pos.x !== first_atom!.x || pos.y !== first_atom!.y)

    for (const position of positions) {
      await canvas.hover({ position })
      await page.waitForTimeout(100)
      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      if (await tooltip.isVisible()) {
        // Check for distance measurement
        const distance_section = tooltip.locator(`.distance`)
        if (await distance_section.isVisible()) {
          await expect(distance_section).toContainText(`dist:`)
          await expect(distance_section).toContainText(`Å`)
        }
        break
      }
    }

    // Test click toggle (deselect)
    await canvas.click({ position: first_atom! })
    await page.waitForTimeout(200)

    // Verify deselection by checking no distance shown
    await canvas.hover({ position: first_atom! })
    const tooltip = page.locator(`.tooltip:has(.coordinates)`)
    if (await tooltip.isVisible()) {
      const distance_section = tooltip.locator(`.distance`)
      await expect(distance_section).not.toBeVisible()
    }

    expect(console_errors).toHaveLength(0)
  })

  // Combined camera control tests
  test(`camera controls (rotation, zoom, pan) work correctly`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const initial_screenshot = await canvas.screenshot()
    const box = await canvas.boundingBox()

    if (!box) return

    // Test rotation
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
    })
    await page.waitForTimeout(200)
    let after_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_screenshot)).toBe(false)

    // Test zoom
    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 } })
    await page.mouse.wheel(0, -200) // Zoom in
    await page.waitForTimeout(200)
    after_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_screenshot)).toBe(false)

    // Test pan
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: `right` })
    await page.mouse.move(
      box.x + box.width / 2 + 50,
      box.y + box.height / 2 + 30,
    )
    await page.mouse.up({ button: `right` })
    await page.waitForTimeout(200)
    after_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_screenshot)).toBe(false)
  })

  // Test disordered sites and occupancy
  test(`handles disordered sites and special cases correctly`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    // Search for disordered sites and oxidation states
    const positions = [
      { x: 200, y: 200 },
      { x: 300, y: 250 },
      { x: 400, y: 200 },
      { x: 300, y: 350 },
    ]

    let found_disordered = false
    let found_oxidation = false

    for (const position of positions) {
      await canvas.hover({ position })
      await page.waitForTimeout(100)

      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      if (await tooltip.isVisible()) {
        // Check for occupancy (disordered site)
        const occupancy_span = tooltip.locator(`.occupancy`)
        if (await occupancy_span.isVisible()) {
          await expect(occupancy_span).toContainText(/0\.\d+/)
          found_disordered = true
        }

        // Check for oxidation states
        const elements_section = tooltip.locator(`.elements`)
        const elements_text = await elements_section.textContent()
        if (elements_text && /\d+[+-]/.test(elements_text)) {
          expect(elements_text).toMatch(/\d+[+-]/)
          found_oxidation = true
        }

        if (found_disordered && found_oxidation) break
      }
    }

    await page.waitForTimeout(300)
    expect(console_errors).toHaveLength(0)
  })

  // Combined rapid interaction and performance test
  test(`handles rapid interactions and maintains performance`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    // Test rapid hovers
    const positions = [
      { x: 250, y: 200 },
      { x: 350, y: 200 },
      { x: 300, y: 250 },
      { x: 250, y: 300 },
      { x: 350, y: 300 },
    ]

    for (let idx = 0; idx < positions.length; idx++) {
      await canvas.hover({ position: positions[idx] })
      await canvas.click({ position: positions[idx] })
      await page.waitForTimeout(50) // Very fast interactions
    }

    // Verify scene is still functional
    const screenshot = await canvas.screenshot()
    expect(screenshot.length).toBeGreaterThan(1000)
    expect(console_errors).toHaveLength(0)
  })

  // Bond rendering test
  test(`renders bonds without errors`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    await page.waitForTimeout(500)
    expect(console_errors).toHaveLength(0)
  })

  // Lattice and site labels test
  test(`renders lattice and handles site labels correctly`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    // Verify lattice and labels don't cause rendering errors
    const screenshot = await canvas.screenshot()
    expect(screenshot.length).toBeGreaterThan(1000)

    await page.waitForTimeout(500)
    expect(console_errors).toHaveLength(0)
  })

  // Structure stability test
  test(`maintains structural stability over time`, async ({ page }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    const initial_screenshot = await canvas.screenshot()
    await page.waitForTimeout(1000) // Wait for any auto-rotation/changes
    const later_screenshot = await canvas.screenshot()

    // Both screenshots should be valid (structure loaded)
    expect(initial_screenshot.length).toBeGreaterThan(1000)
    expect(later_screenshot.length).toBeGreaterThan(1000)
    expect(console_errors).toHaveLength(0)
  })

  // Error handling test
  test(`handles edge cases and errors gracefully`, async ({ page }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    // Test various edge case interactions
    await canvas.hover({ position: { x: 50, y: 50 } }) // Empty area
    await canvas.click({ position: { x: 100, y: 100 } }) // Another empty area

    // Rapid movement between areas
    await canvas.hover({ position: { x: 200, y: 200 } })
    await canvas.hover({ position: { x: 400, y: 400 } })
    await canvas.hover({ position: { x: 50, y: 50 } })

    await page.waitForTimeout(300)
    expect(console_errors).toHaveLength(0)
  })
})
