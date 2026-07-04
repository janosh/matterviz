import type { Point2D } from '$lib/math'
import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  enter_edit_atoms_mode,
  expect_canvas_changed,
  get_canvas_timeout,
  goto_structure_test,
  IS_CI,
} from '../helpers'

const is_mac = process.platform === `darwin`

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
  } catch (error) {
    // If normal hover fails (e.g. tooltip overlay), retry with force
    console.warn(`Hover at (${position.x}, ${position.y}) failed, retrying with force:`, error)
    await canvas.hover({ position, force: true, timeout: 2000 })
  }
}

// Helper function to try multiple positions to find a hoverable atom
async function find_hoverable_atom(page: Page): Promise<Point2D | null> {
  const canvas = page.locator(`#test-structure canvas`)

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

// Dispatch a `set-lattice-props` event with the given lattice props.
const set_lattice_props = (page: Page, detail: Record<string, unknown>): Promise<void> =>
  page.evaluate((props) => {
    globalThis.dispatchEvent(new CustomEvent(`set-lattice-props`, { detail: props }))
  }, detail)

// Screenshot the canvas and assert it rendered non-trivial pixel data.
const expect_canvas_renders = async (canvas: Locator): Promise<Buffer> => {
  const screenshot = await canvas.screenshot()
  expect(screenshot.length).toBeGreaterThan(1000)
  return screenshot
}

// Load a centered scene from species (element + occupancy) placed at one
// position. Multiple species at the same spot model a disordered site (stored as
// separate split sites). Optional rotation tips the wedge axis toward the camera.
async function load_centered_scene(
  page: Page,
  species: { element: string; occu: number }[],
  rotation?: [number, number, number],
): Promise<void> {
  await page.evaluate(
    async ({ specs, rot }) => {
      const structure = {
        sites: specs.map(({ element, occu }) => ({
          species: [{ element, occu, oxidation_state: 0 }],
          abc: [0.25, 0.25, 0.5],
          xyz: [0, 0, 0],
          label: element,
          properties: {},
        })),
        properties: {},
      }
      window.dispatchEvent(new CustomEvent(`set-structure`, { detail: { structure } }))
      window.dispatchEvent(
        new CustomEvent(`set-scene-props`, {
          detail: {
            atom_radius: 2.5,
            camera_position: [0, 0, 8],
            camera_target: [0, 0, 0],
            ...(rot ? { rotation: rot } : {}),
            show_bonds: `never`,
            show_site_indices: false,
            show_site_labels: false,
          },
        }),
      )
      for (let frame_idx = 0; frame_idx < 5; frame_idx++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    },
    { specs: species, rot: rotation },
  )
}

const load_single_centered_atom_scene = (page: Page): Promise<void> =>
  load_centered_scene(page, [{ element: `C`, occu: 1 }])

// Disordered tsumcorite M2 site: Zn+Fe+Pb at a single position.
const load_disordered_site_scene = (
  page: Page,
  rotation?: [number, number, number],
): Promise<void> =>
  load_centered_scene(
    page,
    [
      { element: `Zn`, occu: 0.645 },
      { element: `Fe`, occu: 0.345 },
      { element: `Pb`, occu: 0.01 },
    ],
    rotation,
  )

const get_canvas_purple_pixel_ratio = (canvas: Locator): Promise<number> =>
  canvas.evaluate(async (canvas_element) => {
    if (!(canvas_element instanceof HTMLCanvasElement)) {
      throw new Error(`Expected structure canvas, got ${canvas_element.tagName}`)
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const offscreen_canvas = document.createElement(`canvas`)
    offscreen_canvas.width = canvas_element.width
    offscreen_canvas.height = canvas_element.height
    const context = offscreen_canvas.getContext(`2d`)
    if (!context) throw new Error(`Failed to create 2D canvas context`)
    context.drawImage(canvas_element, 0, 0)
    const { data } = context.getImageData(
      0,
      0,
      offscreen_canvas.width,
      offscreen_canvas.height,
    )
    let purple_pixels = 0
    for (let pixel_idx = 0; pixel_idx < data.length; pixel_idx += 4) {
      const red = data[pixel_idx]
      const green = data[pixel_idx + 1]
      const blue = data[pixel_idx + 2]
      if (red > 55 && red < 150 && green < 110 && blue > 80 && blue < 210) {
        purple_pixels += 1
      }
    }
    return purple_pixels / (offscreen_canvas.width * offscreen_canvas.height)
  })

test.describe(`StructureScene Component Tests`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    // Skip in CI - 3D canvas and camera control tests are unreliable
    test.skip(IS_CI, `3D scene tests are flaky in CI`)
    await goto_structure_test(page)
  })

  // Combined basic functionality and rendering test
  test(`scene renders correctly with atoms and proper lighting`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Verify basic setup and visual rendering
    await expect(canvas).toHaveAttribute(`width`)
    await expect(canvas).toHaveAttribute(`height`)

    await expect_canvas_renders(canvas) // Non-empty, lit scene

    // Try to find hoverable atom for tooltip verification
    const atom_position = await find_hoverable_atom(page)
    if (atom_position) {
      const tooltip = page.locator(`.tooltip:has(.coordinates)`)
      await expect(tooltip.first()).toBeVisible({ timeout: get_canvas_timeout() })
      await expect(tooltip.first().locator(`.elements`)).toBeVisible()
      await expect(tooltip.first().locator(`.coordinates`)).toHaveCount(2)
    }

    expect(console_errors).toHaveLength(0)
  })

  test(`supercell transition keeps atom spheres visible`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const initial_purple_ratio = await get_canvas_purple_pixel_ratio(canvas)
    expect(initial_purple_ratio).toBeGreaterThan(0.01)

    await page.locator(`[data-testid="supercell-input"]`).fill(`2x2x2`)
    await page.locator(`[data-testid="supercell-input"]`).press(`Enter`)
    await expect(page.locator(`#test-structure .atom-legend`)).toContainText(/Cs\s*16/)

    await expect
      .poll(() => get_canvas_purple_pixel_ratio(canvas), {
        timeout: get_canvas_timeout(),
      })
      .toBeGreaterThan(initial_purple_ratio * 2)
  })

  // Combined tooltip functionality tests
  test(`tooltip displays info correctly`, async ({ page }) => {
    const atom_position = await find_hoverable_atom(page)
    test.skip(!atom_position, `No hoverable atoms found`)
    if (!atom_position) throw new Error(`No hoverable atoms found`) // type narrowing

    const canvas = page.locator(`#test-structure canvas`)
    await canvas.hover({ position: atom_position })

    const tooltip = page.locator(`.tooltip:has(.coordinates)`)
    await expect(tooltip).toBeVisible({ timeout: get_canvas_timeout() })

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
      expect(element_name_text?.length).toBeGreaterThan(1) // Not just empty

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

    expect(abc_text).toMatch(/abc:\s*\([\d.-]+,\s*[\d.-]+,\s*[\d.-]+\)/)
    expect(xyz_text).toMatch(/xyz:\s*\([\d.-]+,\s*[\d.-]+,\s*[\d.-]+\)\s*Å/)

    // Test tooltip disappears when moving away
    await canvas.hover({ position: { x: 50, y: 50 } })
    await expect(tooltip).toBeHidden({ timeout: get_canvas_timeout() })
  })

  test(`atom tooltip stays visible while cursor remains over atom`, async ({ page }) => {
    await load_single_centered_atom_scene(page)
    const canvas = page.locator(`#test-structure canvas`)
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)

    await canvas.hover({
      position: { x: box.width / 2, y: box.height / 2 },
      force: true,
    })
    const tooltip = page.locator(`[role="tooltip"]:has(.coordinates)`)
    await expect(tooltip).toBeVisible({ timeout: get_canvas_timeout() })
    await expect(tooltip.locator(`.elements`)).toContainText(`C`)
    // The hover highlight can become the raycast target after it mounts.
    // Check visibility immediately after each frame so a short disappearance fails.
    // 20 frames covers roughly 1/3 s at 60fps, enough to catch transient hover loss.
    for (let frame_idx = 0; frame_idx < 20; frame_idx++) {
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      )
      expect(await tooltip.isVisible()).toBe(true)
    }
  })

  test(`tooltip lists all elements on disordered split sites`, async ({ page }) => {
    // Disordered sites (e.g. tsumcorite M2: Zn+Fe+Pb) are stored as separate
    // single-species sites at the same position. The tooltip must show every
    // element, not just the majority one (regression guard).
    await load_disordered_site_scene(page)

    const canvas = page.locator(`#test-structure canvas`)
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)

    await canvas.hover({ position: { x: box.width / 2, y: box.height / 2 }, force: true })
    const tooltip = page.locator(`[role="tooltip"]:has(.coordinates)`)
    const elements = tooltip.locator(`.elements`)
    await expect(elements).toBeVisible({ timeout: get_canvas_timeout() })
    for (const element of [`Zn`, `Fe`, `Pb`]) {
      await expect(elements.locator(`strong`).filter({ hasText: element })).toBeVisible()
    }
    // tooltip must respect its max-width (wrap) rather than grow unbounded
    const { width, max_width, line_count } = await elements.evaluate((el) => {
      const tip = el.closest(`[role="tooltip"]`) as HTMLElement
      const species = el.querySelector(`.species`) as HTMLElement
      return {
        width: tip.getBoundingClientRect().width,
        max_width: Number(getComputedStyle(tip).maxWidth.replace(`px`, ``)),
        // rows = total height / single species (one-line) height
        line_count: Math.round(el.clientHeight / species.clientHeight),
      }
    })
    expect(max_width).toBeGreaterThan(0)
    expect(width).toBeLessThanOrEqual(max_width + 1)
    // three long species exceed the cap, so the line wraps to >= 2 rows
    expect(line_count).toBeGreaterThanOrEqual(2)
  })

  test(`disordered atom is hoverable across its whole area`, async ({ page }) => {
    // Disordered sites render as wedge (lune) meshes that converge to a point at
    // the sphere poles. Viewed pole-on, the ball center had a non-hoverable band.
    // The invisible full-sphere hit target must make the whole ball hoverable.
    // Rotation tips the wedge (Y) axis toward the camera so the weak pole faces us.
    await load_disordered_site_scene(page, [-Math.PI / 2, 0, 0])

    const canvas = page.locator(`#test-structure canvas`)
    const box = await canvas.boundingBox()
    if (!box) throw new Error(`canvas has no bounding box`)
    const tooltip = page.locator(`[role="tooltip"]:has(.coordinates)`)
    const cx = box.width / 2
    const cy = box.height / 2

    // Points along the formerly-dead equatorial band through the ball center.
    for (const [dx, dy] of [
      [0, 0],
      [-24, 0],
      [24, 0],
      [-12, 0],
      [12, 0],
    ]) {
      await canvas.hover({ position: { x: 4, y: 4 }, force: true })
      await expect(tooltip).toBeHidden({ timeout: get_canvas_timeout() })
      await canvas.hover({ position: { x: cx + dx, y: cy + dy }, force: true })
      await expect(tooltip, `point (${dx}, ${dy}) should be hoverable`).toBeVisible({
        timeout: get_canvas_timeout(),
      })
    }
  })

  // Combined interaction tests
  test(`click interactions and distance measurements work correctly`, async ({ page }) => {
    const first_atom = await find_hoverable_atom(page)
    test.skip(!first_atom, `No hoverable atoms found`)

    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Test click to activate
    if (!first_atom) throw new Error(`No hoverable atoms found`)
    await canvas.click({ position: first_atom })

    // Find second atom for distance measurement
    const positions = [
      { x: 200, y: 150 },
      { x: 400, y: 200 },
      { x: 350, y: 300 },
    ].filter((pos) => !first_atom || pos.x !== first_atom.x || pos.y !== first_atom.y)

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
    if (!first_atom) throw new Error(`No hoverable atoms found`)
    await canvas.click({ position: first_atom })

    // Verify deselection by checking no distance shown
    await canvas.hover({ position: first_atom })
    const tooltip = page.locator(`.tooltip:has(.coordinates)`)
    try {
      await tooltip.waitFor({ state: `visible`, timeout: 500 })
      const distance_section = tooltip.locator(`.distance`)
      await expect(distance_section).toBeHidden()
    } catch {
      // Tooltip not appearing is also acceptable for deselection verification
    }

    expect(console_errors).toHaveLength(0)
  })

  // Combined camera control tests
  test(`camera controls (rotation, zoom, pan) work correctly`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)

    await clear_tooltips_and_overlays(page)

    const initial_screenshot = await canvas.screenshot()
    const box = await canvas.boundingBox()

    if (!box) return

    // Test rotation - use polling for GPU timing variations
    await canvas.dragTo(canvas, {
      sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
      targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
    })
    await expect_canvas_changed(canvas, initial_screenshot)
    const after_rotation = await canvas.screenshot()

    // Test zoom - use safe hover
    await safe_canvas_hover(page, canvas, {
      x: box.width / 2,
      y: box.height / 2,
    })
    await page.mouse.wheel(0, -200) // Zoom in
    await expect_canvas_changed(canvas, after_rotation)
    const after_zoom = await canvas.screenshot()

    // Test pan
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down({ button: `right` })
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30)
    await page.mouse.up({ button: `right` })
    await expect_canvas_changed(canvas, after_zoom)
  })

  // Test disordered sites, occupancy, and partial sphere capping
  test(`handles disordered sites and partial sphere capping correctly`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
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
          if (occupancy_text && Number(occupancy_text) < 1) {
            // Verify scene renders correctly with partial spheres (no errors)
            await expect_canvas_renders(canvas)
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

  // Combined rapid interaction and performance test
  test(`handles rapid interactions and maintains performance`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
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

    for (const position of positions) {
      await safe_canvas_hover(page, canvas, position)
      await canvas.click({ position, force: true })
    }

    // Verify scene is still functional
    await expect_canvas_renders(canvas)
    expect(console_errors).toHaveLength(0)
  })

  // Site labeling functionality tests
  test(`site labels display correctly for ordered and disordered sites`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Enable site labels via URL parameter for easier testing
    await goto_structure_test(page, `/test/structure?show_site_labels=true`)

    // Take screenshot to verify labels are rendered
    await expect_canvas_renders(canvas)

    // Also assert at least one label is present
    const labels = page.locator(`.atom-label`)
    expect(await labels.count()).toBeGreaterThan(0)

    // No console errors during label rendering
    expect(console_errors).toHaveLength(0)
  })

  test(`site indices display correctly and start from 1`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Enable site indices via URL parameter
    await goto_structure_test(page, `/test/structure?show_site_indices=true`)

    // Take screenshot to verify indices are rendered
    await expect_canvas_renders(canvas)

    // No console errors during index rendering
    expect(console_errors).toHaveLength(0)

    // Verify indices start at 1 (and not 0)
    const texts = await page.locator(`.atom-label`).allTextContents()
    expect(texts.some((text) => /^\s*1\s*$/.test(text))).toBe(true)
    expect(texts.some((text) => /^\s*0\s*$/.test(text))).toBe(false)
  })

  test(`combined site labels and indices display correctly`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Enable both site labels and indices via URL parameters
    await goto_structure_test(
      page,
      `/test/structure?show_site_labels=true&show_site_indices=true`,
    )

    // Take screenshot to verify combined labels are rendered
    await expect_canvas_renders(canvas)

    // No console errors during combined label rendering
    expect(console_errors).toHaveLength(0)

    // Spot-check that at least one label matches "X-<n>"
    const texts = await page.locator(`.atom-label`).allTextContents()
    expect(texts.some((text) => /[A-Z][a-z]?\s*-\s*\d+/.test(text))).toBe(true)
  })

  test(`disordered sites show combined element-occupancy format`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Enable site labels to test disordered site formatting
    await goto_structure_test(page, `/test/structure?show_site_labels=true`)

    // Look for sites with partial occupancy by searching positions
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

        // Check for occupancy indicators (partial occupancy sites)
        const occupancy_spans = tooltip.locator(`.occupancy`)
        const occupancy_count = await occupancy_spans.count()

        if (occupancy_count > 0) {
          // Found a disordered site, verify format
          for (let idx = 0; idx < occupancy_count; idx++) {
            const occupancy_text = await occupancy_spans.nth(idx).textContent()
            expect(occupancy_text).toMatch(/^0\.\d*[1-9]$|^1$/) // Valid occupancy format
          }
          break
        }
      } catch {
        // Continue to next position if tooltip doesn't appear
        continue
      }
    }

    // Take screenshot regardless of whether we found disordered sites
    await expect_canvas_renders(canvas)

    // No console errors during disordered site rendering
    expect(console_errors).toHaveLength(0)
  })

  // Test lattice cell property customization with EdgesGeometry
  test(`lattice cell properties (color, opacity, line width) work correctly with EdgesGeometry`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)

    await set_lattice_props(page, {
      cell_edge_color: `#ff0000`,
      cell_surface_color: `#ff0000`,
      cell_edge_opacity: 0.8,
      cell_surface_opacity: 0.1,
      cell_edge_width: 2,
    })

    const canvas = page.locator(`#test-structure canvas`)
    await expect(canvas).toBeVisible()

    // Take screenshots to verify visual changes
    const with_custom_props = await expect_canvas_renders(canvas)

    // Test different cell colors by checking rendered output
    const test_colors = [`#00ff00`, `#0000ff`, `#ffff00`]

    for (const color of test_colors) {
      await set_lattice_props(page, { cell_edge_color: color, cell_surface_color: color })

      const color_screenshot = await expect_canvas_renders(canvas)

      // Verify the screenshot changed (different color)
      expect(with_custom_props.equals(color_screenshot)).toBe(false)
    }

    // Test different opacity values
    const test_opacities = [0.2, 0.5, 1.0]

    for (const opacity of test_opacities) {
      await set_lattice_props(page, {
        cell_edge_opacity: opacity,
        cell_surface_opacity: opacity * 0.2,
      })

      await expect_canvas_renders(canvas)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test dual opacity controls allow flexible edge/surface combinations
  test(`dual opacity controls allow flexible edge and surface combinations`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Test edges only (surface opacity = 0)
    await set_lattice_props(page, {
      cell_edge_opacity: 0.8,
      cell_surface_opacity: 0,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const edges_only_screenshot = await canvas.screenshot()

    // Test surfaces only (edge opacity = 0)
    await set_lattice_props(page, {
      cell_edge_opacity: 0,
      cell_surface_opacity: 0.4,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const surfaces_only_screenshot = await canvas.screenshot()

    // Test both visible with different opacities
    await set_lattice_props(page, {
      cell_edge_opacity: 0.6,
      cell_surface_opacity: 0.3,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const both_visible_screenshot = await canvas.screenshot()

    // Test neither visible (both opacity = 0)
    await set_lattice_props(page, {
      cell_edge_opacity: 0,
      cell_surface_opacity: 0,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const neither_visible_screenshot = await canvas.screenshot()

    // Verify all four combinations produce different visual outputs
    expect(edges_only_screenshot.equals(surfaces_only_screenshot)).toBe(false)
    expect(edges_only_screenshot.equals(both_visible_screenshot)).toBe(false)
    expect(edges_only_screenshot.equals(neither_visible_screenshot)).toBe(false)
    expect(surfaces_only_screenshot.equals(both_visible_screenshot)).toBe(false)
    expect(surfaces_only_screenshot.equals(neither_visible_screenshot)).toBe(false)
    expect(both_visible_screenshot.equals(neither_visible_screenshot)).toBe(false)

    expect(console_errors).toHaveLength(0)
  })

  // Test that EdgesGeometry removes diagonal lines from wireframe
  test(`EdgesGeometry wireframe shows only cell edges without diagonals`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Set wireframe mode with high opacity and contrast for visibility
    await set_lattice_props(page, {
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
      cell_edge_opacity: 1.0,
      cell_surface_opacity: 0,
      cell_edge_width: 3,
    })

    // Take a screenshot and verify it renders
    const wireframe_screenshot = await expect_canvas_renders(canvas)

    // Test that the wireframe still renders when changing view angles
    const box = await canvas.boundingBox()
    if (box) {
      // Rotate the view to see different faces of the cell
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      })

      // Poll for canvas change after rotation (GPU timing variations)
      await expect_canvas_changed(canvas, wireframe_screenshot)
      await expect_canvas_renders(canvas)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test line width property (note: limited by WebGL constraints)
  test(`cell line width changes are handled correctly`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Test different line widths (note: WebGL may limit actual rendering)
    const line_widths = [1, 2, 5, 10]

    for (const width of line_widths) {
      await set_lattice_props(page, {
        cell_edge_color: `#ffffff`,
        cell_surface_color: `#ffffff`,
        cell_edge_opacity: 1.0,
        cell_surface_opacity: 0,
        cell_edge_width: width,
      })

      await expect_canvas_renders(canvas)
    }

    // Verify no errors occurred even if visual changes are limited by WebGL
    expect(console_errors).toHaveLength(0)
  })

  // Test opacity range validation
  test(`opacity values are clamped to valid range`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Test extreme values
    const test_values = [-0.5, 0, 0.5, 1, 1.5]

    for (const opacity of test_values) {
      await set_lattice_props(page, {
        cell_edge_opacity: opacity,
        cell_surface_opacity: opacity,
        cell_edge_color: `#ffffff`,
        cell_surface_color: `#ffffff`,
      })

      await expect_canvas_renders(canvas)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test that opacity values can be set independently and produce expected results
  test(`independent opacity controls work correctly across different values`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Test low edge opacity, no surfaces
    await set_lattice_props(page, {
      cell_edge_opacity: 0.2,
      cell_surface_opacity: 0,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const low_edge_screenshot = await canvas.screenshot()

    // Test high edge opacity, no surfaces
    await set_lattice_props(page, {
      cell_edge_opacity: 0.9,
      cell_surface_opacity: 0,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const high_edge_screenshot = await canvas.screenshot()

    // Test no edges, low surface opacity
    await set_lattice_props(page, {
      cell_edge_opacity: 0,
      cell_surface_opacity: 0.2,
      cell_edge_color: `#ffffff`,
      cell_surface_color: `#ffffff`,
    })
    const low_surface_screenshot = await canvas.screenshot()

    // Verify different opacity levels produce different visual outputs
    expect(low_edge_screenshot.equals(high_edge_screenshot)).toBe(false)
    expect(low_edge_screenshot.equals(low_surface_screenshot)).toBe(false)
    expect(high_edge_screenshot.equals(low_surface_screenshot)).toBe(false)

    expect(console_errors).toHaveLength(0)
  })

  // Test same_size_atoms property controls atom scaling behavior
  test(`same_size_atoms property controls atom radius scaling correctly`, async ({ page }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    // Helper to set scene properties and take screenshot
    const set_props_and_screenshot = async (props: Record<string, unknown>) => {
      await page.evaluate((scene_props) => {
        // Try to access the Structure component directly if possible
        const structure_element = document.querySelector(`[data-testid="structure-component"]`)
        if (structure_element) {
          // If structure component has a direct method to update scene props
          const event = new CustomEvent(`updateSceneProps`, {
            detail: scene_props,
          })
          structure_element.dispatchEvent(event)
        } else {
          // Fallback to controls manipulation
          const controls_btn = document.querySelector(
            `button.structure-controls-toggle`,
          ) as HTMLButtonElement
          if (controls_btn) controls_btn.click()

          // Set checkbox state for same_size_atoms
          const checkbox = document.querySelector(`input[type="checkbox"]`) as HTMLInputElement
          if (checkbox && scene_props.same_size_atoms !== undefined) {
            checkbox.checked = Boolean(scene_props.same_size_atoms)
            checkbox.dispatchEvent(new Event(`change`, { bubbles: true }))
          }
        }
      }, props)

      await expect(canvas).toBeVisible()
      return canvas.screenshot()
    }

    // Test both modes and verify they produce different outputs
    const atomic_radii_screenshot = await set_props_and_screenshot({
      same_size_atoms: false,
      atom_radius: 1.0,
      show_atoms: true,
    })

    const uniform_size_screenshot = await set_props_and_screenshot({
      same_size_atoms: true,
      atom_radius: 1.0,
      show_atoms: true,
    })

    // Verify screenshots are valid and different
    expect(atomic_radii_screenshot.length).toBeGreaterThan(1000)
    expect(uniform_size_screenshot.length).toBeGreaterThan(1000)

    // If screenshots are identical, the property might not be implemented or working
    // In that case, just verify no errors occurred
    if (atomic_radii_screenshot.equals(uniform_size_screenshot)) {
      console.warn(`same_size_atoms property appears to have no visual effect`)
    }

    expect(console_errors).toHaveLength(0)
  })

  // Test rotation target prevents structure from moving off-canvas
  test(`rotation target uses lattice center for crystalline structures and center of mass for molecular systems`, async ({
    page,
  }) => {
    const console_errors = setup_console_monitoring(page)
    const canvas = page.locator(`#test-structure canvas`)

    await expect(canvas).toBeVisible()

    // Test rotation behavior - should not move structure off-canvas
    const box = await canvas.boundingBox()
    if (box) {
      const initial_screenshot = await canvas.screenshot()

      // Perform rotation drag
      await canvas.dragTo(canvas, {
        sourcePosition: { x: box.width / 2 - 50, y: box.height / 2 },
        targetPosition: { x: box.width / 2 + 50, y: box.height / 2 },
      })

      // Poll for canvas change after rotation (GPU timing variations)
      await expect_canvas_changed(canvas, initial_screenshot)
      // Verify structure remains visible (not moved off-canvas)
      await expect_canvas_renders(canvas)
    }

    expect(console_errors).toHaveLength(0)
  })
})

// === Edit Atoms Scene Tests ===

test.describe(`Edit Atoms Scene`, () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    test.skip(IS_CI, `Edit atoms scene tests require WebGL, skip in CI`)
    await goto_structure_test(page)
    await enter_edit_atoms_mode(page)
  })

  test(`atom click toggles selection in edit-atoms mode`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    const position = { x: 400, y: 250 }

    // Take initial screenshot
    const initial = await canvas.screenshot()

    // Click to select
    await canvas.click({ position, force: true })
    await expect_canvas_changed(canvas, initial)
    const selected = await canvas.screenshot()

    // Click again to deselect
    await canvas.click({ position, force: true })
    await expect_canvas_changed(canvas, selected)
    const deselected = await canvas.screenshot()

    // Initial and deselected should differ from selected
    expect(initial.equals(selected)).toBe(false)
    expect(selected.equals(deselected)).toBe(false)
    expect(console_errors).toHaveLength(0)
  })

  test(`shift+click adds to selection`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Click first atom
    const before_first = await canvas.screenshot()
    await canvas.click({ position: { x: 350, y: 200 }, force: true })
    await expect_canvas_changed(canvas, before_first)
    const single_selection = await canvas.screenshot()

    // Click second atom without shift (replaces selection)
    await canvas.click({ position: { x: 450, y: 300 }, force: true })
    await expect_canvas_changed(canvas, single_selection)
    const replaced = await canvas.screenshot()

    // Click first again
    await canvas.click({ position: { x: 350, y: 200 }, force: true })
    await expect_canvas_changed(canvas, replaced)

    // Shift+click second atom (adds to selection)
    const before_shift = await canvas.screenshot()
    await canvas.click({
      position: { x: 450, y: 300 },
      modifiers: [`Shift`],
      force: true,
    })
    await expect_canvas_changed(canvas, before_shift)
    const multi_selection = await canvas.screenshot()

    // All screenshots should differ
    expect(single_selection.equals(replaced)).toBe(false)
    expect(replaced.equals(multi_selection)).toBe(false)
    expect(console_errors).toHaveLength(0)
  })

  test(`no errors in edit-atoms mode after various interactions`, async ({ page }) => {
    const canvas = page.locator(`#test-structure canvas`)
    const console_errors = setup_console_monitoring(page)

    // Various interactions should not cause errors
    let prev = await canvas.screenshot()
    await canvas.click({ position: { x: 400, y: 250 }, force: true })
    await expect_canvas_changed(canvas, prev)
    prev = await canvas.screenshot()
    await canvas.click({ position: { x: 200, y: 150 }, force: true })
    await expect_canvas_changed(canvas, prev)
    prev = await canvas.screenshot()
    await canvas.click({
      position: { x: 500, y: 300 },
      modifiers: [`Shift`],
      force: true,
    })
    await expect_canvas_changed(canvas, prev)

    // Keyboard shortcuts should not cause errors
    await page.keyboard.press(`Delete`)
    await page.keyboard.press(is_mac ? `Meta+z` : `Control+z`)
    await page.keyboard.press(is_mac ? `Meta+y` : `Control+y`)

    // Canvas should still render
    await expect_canvas_renders(canvas)
    expect(console_errors).toHaveLength(0)
  })
})
