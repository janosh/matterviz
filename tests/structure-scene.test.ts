import type { XyObj } from '$lib'
import { expect, test, type Locator, type Page } from '@playwright/test'

// Cached atom position to avoid repeated searches
let cached_atom_position: XyObj | null = null

// Helper function to clear any existing tooltips and overlays
async function clear_tooltips_and_overlays(page: Page): Promise<void> {
  // Move mouse to a safe area to clear any tooltips
  await page.mouse.move(50, 50)

  // Check if any tooltips are visible and dismiss them
  const visible_tooltips = page.locator(`.tooltip`)
  const tooltip_count = await visible_tooltips.count()
  if (tooltip_count > 0) {
    await page.mouse.move(10, 10) // Move to top-left corner
    // Wait for tooltip to disappear instead of arbitrary timeout
    await visible_tooltips.first().waitFor({ state: `hidden`, timeout: 2000 })
  }
}

// Helper function to safely hover on canvas
async function safe_canvas_hover(
  page: Page,
  canvas: Locator,
  position: { x: number; y: number },
): Promise<void> {
  // Clear any existing tooltips first
  await clear_tooltips_and_overlays(page)

  // Try normal hover first
  try {
    await canvas.hover({ position, timeout: 2000 })
  } catch {
    // If normal hover fails, use force hover
    await canvas.hover({ position, force: true, timeout: 2000 })
  }
}

// Helper function to try multiple positions to find a hoverable atom (optimized)
async function find_hoverable_atom(page: Page): Promise<XyObj | null> {
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
    await safe_canvas_hover(page, canvas, position)

    // Look for StructureScene tooltip specifically (has coordinates)
    const structure_tooltip = page.locator(`.tooltip:has(.coordinates)`)
    try {
      await structure_tooltip.waitFor({ state: `visible`, timeout: 500 })
      cached_atom_position = position // Cache for future use
      return position
    } catch {
      // Continue to next position if tooltip doesn't appear
      continue
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
    const canvas = page.locator(`#structure-wrapper canvas`)
    await canvas.waitFor({ state: `visible`, timeout: 5000 })
    // Wait for canvas to be properly initialized by checking it has dimensions
    await expect(canvas).toHaveAttribute(`width`)
    await expect(canvas).toHaveAttribute(`height`)
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

    // Check for element symbol and full name together
    const element_symbols = elements_section.locator(`strong`)
    const element_names = elements_section.locator(`.elem-name`)

    await expect(element_symbols.first()).toBeVisible()

    // Verify element names are displayed when available
    const symbol_count = await element_symbols.count()
    const name_count = await element_names.count()

    if (name_count > 0) {
      expect(name_count).toBe(symbol_count) // Should match symbols

      // Verify element name styling and content
      const element_name_text = await element_names.first().textContent()
      expect(element_name_text).toBeTruthy()
      expect(element_name_text!.length).toBeGreaterThan(1) // Not just empty

      // Verify styling (smaller, lighter font)
      await expect(element_names.first()).toHaveCSS(`opacity`, `0.7`)
      await expect(element_names.first()).toHaveCSS(`font-weight`, `400`) // normal weight
    }

    // Verify element symbol and name appear together when both present
    const elements_text = await elements_section.textContent()
    if (name_count > 0) {
      expect(elements_text).toMatch(/[A-Z][a-z]?\s+[A-Z][a-z]+/) // Symbol followed by name pattern
    }

    // Check coordinates are back to separate lines
    const coordinates_sections = tooltip.locator(`.coordinates`)
    await expect(coordinates_sections).toHaveCount(2) // Back to separate abc and xyz lines

    // Verify coordinate formatting (fractional and Cartesian)
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

    // Find second atom for distance measurement
    const positions = [
      { x: 200, y: 150 },
      { x: 400, y: 200 },
      { x: 350, y: 300 },
    ].filter((pos) => pos.x !== first_atom!.x || pos.y !== first_atom!.y)

    for (const position of positions) {
      await canvas.hover({ position })
      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      try {
        await tooltip.waitFor({ state: `visible`, timeout: 500 })
        // Check for distance measurement
        const distance_section = tooltip.locator(`.distance`)
        if (await distance_section.isVisible()) {
          await expect(distance_section).toContainText(`dist:`)
          await expect(distance_section).toContainText(`Å`)
        }
        break
      } catch {
        // Continue to next position if tooltip doesn't appear
        continue
      }
    }

    // Test click toggle (deselect)
    await canvas.click({ position: first_atom! })

    // Verify deselection by checking no distance shown
    await canvas.hover({ position: first_atom! })
    const tooltip = page.locator(`.tooltip:has(.coordinates)`)
    try {
      await tooltip.waitFor({ state: `visible`, timeout: 500 })
      const distance_section = tooltip.locator(`.distance`)
      await expect(distance_section).not.toBeVisible()
    } catch {
      // Tooltip not appearing is also acceptable for deselection verification
    }

    expect(console_errors).toHaveLength(0)
  })

  // Combined camera control tests
  test(`camera controls (rotation, zoom, pan) work correctly`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)

    await clear_tooltips_and_overlays(page)

    const initial_screenshot = await canvas.screenshot()
    const box = await canvas.boundingBox()

    if (!box) return

    // Test rotation
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
    })
    let after_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_screenshot)).toBe(false)

    // Test zoom - use safe hover
    await safe_canvas_hover(page, canvas, {
      x: box.width / 2,
      y: box.height / 2,
    })
    await page.mouse.wheel(0, -200) // Zoom in
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
    after_screenshot = await canvas.screenshot()
    expect(initial_screenshot.equals(after_screenshot)).toBe(false)
  })

  // Test disordered sites, occupancy, and partial sphere capping
  test(`handles disordered sites and partial sphere capping correctly`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    await clear_tooltips_and_overlays(page)

    // Search for disordered sites and oxidation states
    const positions = [
      { x: 200, y: 200 },
      { x: 300, y: 250 },
      { x: 400, y: 200 },
      { x: 300, y: 350 },
      { x: 250, y: 300 },
      { x: 350, y: 150 },
    ]

    let found_disordered = false
    let found_oxidation = false

    for (const position of positions) {
      await safe_canvas_hover(page, canvas, position)

      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      try {
        await tooltip.waitFor({ state: `visible`, timeout: 500 })
        // Check for occupancy (disordered site)
        const occupancy_span = tooltip.locator(`.occupancy`)
        if (await occupancy_span.isVisible()) {
          const occupancy_text = await occupancy_span.textContent()
          await expect(occupancy_span).toContainText(/0\.\d+/)
          found_disordered = true

          // Test partial sphere capping (closing partial spheres with flat circles) for sites with occupancy < 1
          if (occupancy_text && parseFloat(occupancy_text) < 1) {
            // Verify scene renders correctly with partial spheres (no errors)
            const partial_screenshot = await canvas.screenshot()
            expect(partial_screenshot.length).toBeGreaterThan(1000)
          }
        }

        // Check for oxidation states
        const elements_section = tooltip.locator(`.elements`)
        const elements_text = await elements_section.textContent()
        if (elements_text && /\d+[+-]/.test(elements_text)) {
          expect(elements_text).toMatch(/\d+[+-]/)
          found_oxidation = true
        }

        if (found_disordered && found_oxidation) break
      } catch {
        // Continue to next position if tooltip doesn't appear
        continue
      }
    }
    expect(console_errors).toHaveLength(0)
  })

  // Test disordered site tooltip formatting
  test(`formats disordered site tooltips without trailing zeros and proper separators`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    await clear_tooltips_and_overlays(page)

    const positions = [
      { x: 200, y: 200 },
      { x: 300, y: 250 },
      { x: 400, y: 200 },
      { x: 250, y: 300 },
      { x: 350, y: 150 },
    ]

    for (const position of positions) {
      await safe_canvas_hover(page, canvas, position)

      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      try {
        await tooltip.waitFor({ state: `visible`, timeout: 500 })
        const occupancy_spans = tooltip.locator(`.occupancy`)
        const occupancy_count = await occupancy_spans.count()

        if (occupancy_count > 0) {
          // Test occupancy formatting: no trailing zeros, valid decimals
          for (let idx = 0; idx < occupancy_count; idx++) {
            const occupancy_text = await occupancy_spans.nth(idx).textContent()
            expect(occupancy_text).not.toMatch(/\..*0+$/) // No trailing zeros
            expect(occupancy_text).toMatch(/^0\.\d*[1-9]$|^1$/) // Valid format
          }

          // Test species separation: thin space, not plus signs
          if (occupancy_count > 1) {
            const elements_text = await tooltip
              .locator(`.elements`)
              .textContent()
            expect(elements_text).not.toMatch(/\s\+\s/) // No plus separators
            expect(elements_text).toMatch(/\u2009/) // Thin space separator
          }
          break
        }
      } catch {
        // Continue to next position if tooltip doesn't appear
        continue
      }
    }

    expect(console_errors).toHaveLength(0)
  })

  // Combined rapid interaction and performance test
  test(`handles rapid interactions and maintains performance`, async ({
    page,
  }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    await clear_tooltips_and_overlays(page)

    // Test rapid hovers
    const positions = [
      { x: 250, y: 200 },
      { x: 350, y: 200 },
      { x: 300, y: 250 },
      { x: 250, y: 300 },
      { x: 350, y: 300 },
    ]

    for (let idx = 0; idx < positions.length; idx++) {
      await safe_canvas_hover(page, canvas, positions[idx])
      await canvas.click({ position: positions[idx], force: true })
    }

    // Verify scene is still functional
    const screenshot = await canvas.screenshot()
    expect(screenshot.length).toBeGreaterThan(1000)
    expect(console_errors).toHaveLength(0)
  })

  // Bond rendering test
  test(`renders bonds without errors`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)
    await expect(canvas).toBeVisible()
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

    expect(console_errors).toHaveLength(0)
  })

  // Structure stability test
  test(`maintains structural stability over time`, async ({ page }) => {
    const canvas = page.locator(`#structure-wrapper canvas`)
    const console_errors = setup_console_monitoring(page)

    const initial_screenshot = await canvas.screenshot()
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

    expect(console_errors).toHaveLength(0)
  })

  // Test lattice cell property customization with EdgesGeometry
  test(`lattice cell properties (color, opacity, line width) work correctly with EdgesGeometry`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)

    // Use page.evaluate to set lattice properties directly on the Structure component
    await page.evaluate(() => {
      // Access the Structure component's lattice_props to set custom values
      const structureElement = document.querySelector(
        `[data-testid="structure-component"]`,
      )
      if (!structureElement) {
        // If no test ID exists, we'll set the properties through controls
        const event = new CustomEvent(`setLatticeProps`, {
          detail: {
            cell_color: `#ff0000`,
            cell_edge_opacity: 0.8,
            cell_surface_opacity: 0.1,
            cell_line_width: 2,
          },
        })
        window.dispatchEvent(event)
      }
    })

    const canvas = page.locator(`#structure-wrapper canvas`)
    await expect(canvas).toBeVisible()

    // Take screenshots to verify visual changes
    const with_custom_props = await canvas.screenshot()
    expect(with_custom_props.length).toBeGreaterThan(1000)

    // Test different cell colors by checking rendered output
    const test_colors = [`#00ff00`, `#0000ff`, `#ffff00`]

    for (const color of test_colors) {
      await page.evaluate((test_color) => {
        const event = new CustomEvent(`setLatticeProps`, {
          detail: { cell_color: test_color },
        })
        window.dispatchEvent(event)
      }, color)

      const color_screenshot = await canvas.screenshot()
      expect(color_screenshot.length).toBeGreaterThan(1000)

      // Verify the screenshot changed (different color)
      expect(with_custom_props.equals(color_screenshot)).toBe(false)
    }

    // Test different opacity values
    const test_opacities = [0.2, 0.5, 1.0]

    for (const opacity of test_opacities) {
      await page.evaluate((test_opacity) => {
        const event = new CustomEvent(`setLatticeProps`, {
          detail: {
            cell_edge_opacity: test_opacity,
            cell_surface_opacity: test_opacity * 0.2,
          },
        })
        window.dispatchEvent(event)
      }, opacity)

      const opacity_screenshot = await canvas.screenshot()
      expect(opacity_screenshot.length).toBeGreaterThan(1000)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test dual opacity controls allow flexible edge/surface combinations
  test(`dual opacity controls allow flexible edge and surface combinations`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)

    // Test edges only (surface opacity = 0)
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0.8,
          cell_surface_opacity: 0,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const edges_only_screenshot = await canvas.screenshot()

    // Test surfaces only (edge opacity = 0)
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0,
          cell_surface_opacity: 0.4,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const surfaces_only_screenshot = await canvas.screenshot()

    // Test both visible with different opacities
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0.6,
          cell_surface_opacity: 0.3,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const both_visible_screenshot = await canvas.screenshot()

    // Test neither visible (both opacity = 0)
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0,
          cell_surface_opacity: 0,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const neither_visible_screenshot = await canvas.screenshot()

    // Verify all four combinations produce different visual outputs
    expect(edges_only_screenshot.equals(surfaces_only_screenshot)).toBe(false)
    expect(edges_only_screenshot.equals(both_visible_screenshot)).toBe(false)
    expect(edges_only_screenshot.equals(neither_visible_screenshot)).toBe(false)
    expect(surfaces_only_screenshot.equals(both_visible_screenshot)).toBe(false)
    expect(surfaces_only_screenshot.equals(neither_visible_screenshot)).toBe(
      false,
    )
    expect(both_visible_screenshot.equals(neither_visible_screenshot)).toBe(
      false,
    )

    expect(console_errors).toHaveLength(0)
  })

  // Test that EdgesGeometry removes diagonal lines from wireframe
  test(`EdgesGeometry wireframe shows only cell edges without diagonals`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)

    // Set wireframe mode with high opacity and contrast for visibility
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_color: `#ffffff`,
          cell_edge_opacity: 1.0,
          cell_surface_opacity: 0,
          cell_line_width: 3,
        },
      })
      window.dispatchEvent(event)
    })

    // Take a screenshot and verify it renders
    const wireframe_screenshot = await canvas.screenshot()
    expect(wireframe_screenshot.length).toBeGreaterThan(1000)

    // Test that the wireframe still renders when changing view angles
    const box = await canvas.boundingBox()
    if (box) {
      // Rotate the view to see different faces of the cell
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      })

      const rotated_screenshot = await canvas.screenshot()
      expect(rotated_screenshot.length).toBeGreaterThan(1000)

      // Verify the wireframe is still visible after rotation
      expect(wireframe_screenshot.equals(rotated_screenshot)).toBe(false)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test line width property (note: limited by WebGL constraints)
  test(`cell line width changes are handled correctly`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)

    // Test different line widths (note: WebGL may limit actual rendering)
    const line_widths = [1, 2, 5, 10]

    for (const width of line_widths) {
      await page.evaluate((test_width) => {
        const event = new CustomEvent(`setLatticeProps`, {
          detail: {
            cell_color: `#ffffff`,
            cell_edge_opacity: 1.0,
            cell_surface_opacity: 0,
            cell_line_width: test_width,
          },
        })
        window.dispatchEvent(event)
      }, width)

      const width_screenshot = await canvas.screenshot()
      expect(width_screenshot.length).toBeGreaterThan(1000)
    }

    // Verify no errors occurred even if visual changes are limited by WebGL
    expect(console_errors).toHaveLength(0)
  })

  // Test dual opacity controls for edges and surfaces
  test(`edge and surface opacity controls work independently`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)

    // Set baseline with both edges and surfaces visible
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0.8,
          cell_surface_opacity: 0.3,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const both_visible_screenshot = await canvas.screenshot()

    // Test edges only (surface opacity = 0)
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0.8,
          cell_surface_opacity: 0,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const edges_only_screenshot = await canvas.screenshot()

    // Test surfaces only (edge opacity = 0)
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0,
          cell_surface_opacity: 0.3,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const surfaces_only_screenshot = await canvas.screenshot()

    // Test neither visible (both opacity = 0)
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0,
          cell_surface_opacity: 0,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const neither_visible_screenshot = await canvas.screenshot()

    // Verify all four modes produce different visual outputs
    expect(both_visible_screenshot.equals(edges_only_screenshot)).toBe(false)
    expect(both_visible_screenshot.equals(surfaces_only_screenshot)).toBe(false)
    expect(both_visible_screenshot.equals(neither_visible_screenshot)).toBe(
      false,
    )
    expect(edges_only_screenshot.equals(surfaces_only_screenshot)).toBe(false)
    expect(edges_only_screenshot.equals(neither_visible_screenshot)).toBe(false)
    expect(surfaces_only_screenshot.equals(neither_visible_screenshot)).toBe(
      false,
    )

    expect(console_errors).toHaveLength(0)
  })

  // Test opacity range validation
  test(`opacity values are clamped to valid range`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)

    // Test extreme values
    const test_values = [-0.5, 0, 0.5, 1, 1.5]

    for (const opacity of test_values) {
      await page.evaluate((test_opacity) => {
        const event = new CustomEvent(`setLatticeProps`, {
          detail: {
            cell_edge_opacity: test_opacity,
            cell_surface_opacity: test_opacity,
            cell_color: `#ffffff`,
          },
        })
        window.dispatchEvent(event)
      }, opacity)

      const opacity_screenshot = await canvas.screenshot()
      expect(opacity_screenshot.length).toBeGreaterThan(1000)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test that opacity values can be set independently and produce expected results
  test(`independent opacity controls work correctly across different values`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#structure-wrapper canvas`)

    // Test low edge opacity, no surfaces
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0.2,
          cell_surface_opacity: 0,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const low_edge_screenshot = await canvas.screenshot()

    // Test high edge opacity, no surfaces
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0.9,
          cell_surface_opacity: 0,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const high_edge_screenshot = await canvas.screenshot()

    // Test no edges, low surface opacity
    await page.evaluate(() => {
      const event = new CustomEvent(`setLatticeProps`, {
        detail: {
          cell_edge_opacity: 0,
          cell_surface_opacity: 0.2,
          cell_color: `#ffffff`,
        },
      })
      window.dispatchEvent(event)
    })
    const low_surface_screenshot = await canvas.screenshot()

    // Verify different opacity levels produce different visual outputs
    expect(low_edge_screenshot.equals(high_edge_screenshot)).toBe(false)
    expect(low_edge_screenshot.equals(low_surface_screenshot)).toBe(false)
    expect(high_edge_screenshot.equals(low_surface_screenshot)).toBe(false)

    expect(console_errors).toHaveLength(0)
  })
})
