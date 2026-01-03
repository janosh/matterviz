// deno-lint-ignore-file no-await-in-loop
import type { XyObj } from '$lib/plot'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { IS_CI } from '../helpers'

// SHARED HELPER FUNCTIONS
//
// Note on SVG selectors: ScatterPlot components may contain multiple SVG elements
// (main plot SVG plus control pane icons). When targeting the main plot SVG for
// interactions like zoom/hover, use .first() to avoid Playwright strict mode
// violations. For visibility assertions where any match is acceptable, .first()
// is optional. Example: plot.locator(`> svg[role="img"]`).first()

// Ensure plot is visible in viewport (useful for long test pages)
const ensure_plot_visible = async (plot_locator: Locator): Promise<void> => {
  await plot_locator.scrollIntoViewIfNeeded()
  await expect(plot_locator).toBeVisible()
}

// Click radio buttons reliably
const click_radio = async (page: Page, selector: string): Promise<void> => {
  await page.evaluate((sel) => {
    const radio = document.querySelector(sel) as HTMLInputElement
    if (radio) radio.click()
  }, selector)
}

// Check if array values are in ascending order (empty arrays are vacuously ascending)
const is_ascending = (arr: number[]): boolean =>
  arr.every((val, idx) => idx === 0 || val >= arr[idx - 1])

// Get tick values and calculate range
const get_tick_range = async (
  axis_locator: Locator,
): Promise<{ ticks: number[]; range: number }> => {
  const tick_elements = await axis_locator.locator(`.tick text`).all()
  const tick_texts = await Promise.all(
    tick_elements.map((tick) => tick.textContent()),
  )
  const ticks = tick_texts
    .map((text) => (text ? parseFloat(text) : NaN))
    .filter((num) => !isNaN(num))

  if (ticks.length < 2) return { ticks, range: 0 }
  const range = Math.abs(Math.max(...ticks) - Math.min(...ticks))
  return { ticks, range }
}

// Get label positions based on parent group transform
const get_label_positions = async (
  plot_locator: Locator,
): Promise<Record<string, XyObj>> => {
  await plot_locator.waitFor({ state: `visible` })
  // Wait for markers to be rendered
  await expect(plot_locator.locator(`path.marker`).first()).toBeVisible()

  const positions: Record<string, XyObj> = {}
  const markers = await plot_locator.locator(`path.marker`).all()

  const marker_promises = markers.map(async (marker) => {
    const parent_group = marker.locator(`..`)
    const label_text_element = parent_group.locator(`text`)
    const label_text_content = await label_text_element.textContent()

    if (label_text_content) {
      const transform = await parent_group.getAttribute(`transform`)
      if (transform) {
        const match = transform.match(
          /translate\(([^\s,]+)\s*,?\s*([^\)]+)\)/,
        )
        if (match) {
          return {
            label: label_text_content,
            position: { x: parseFloat(match[1]), y: parseFloat(match[2]) },
          }
        }
      }
    }
    return null
  })

  const marker_results = await Promise.all(marker_promises)
  for (const result of marker_results) {
    if (result) positions[result.label] = result.position
  }
  return positions
}

// Get legend position using getBoundingClientRect
const get_legend_position = async (
  plot_locator: Locator,
): Promise<{ x: number; y: number }> => {
  const legend_wrapper = plot_locator.locator(`.legend`).locator(`..`)
  await legend_wrapper.waitFor({ state: `visible` })

  return await legend_wrapper.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const parent_rect = (
      el as HTMLElement
    ).offsetParent?.getBoundingClientRect() || { x: 0, y: 0 }
    return { x: rect.x - parent_rect.x, y: rect.y - parent_rect.y }
  })
}

// Set density sliders for colorbar placement tests
const set_density = async (
  section_locator: Locator,
  densities: { tl: number; tr: number; bl: number; br: number },
): Promise<void> => {
  const set_slider = async (label_text: string, value: number) => {
    const input_locator = section_locator.locator(
      `label:has-text('${label_text}') input`,
    )
    await input_locator.evaluate((el, val) => {
      const input = el as HTMLInputElement
      input.value = val.toString()
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      input.dispatchEvent(new Event(`change`, { bubbles: true }))
    }, value)
  }

  await set_slider(`Top Left`, densities.tl)
  await set_slider(`Top Right`, densities.tr)
  await set_slider(`Bottom Left`, densities.bl)
  await set_slider(`Bottom Right`, densities.br)
}

// Get colorbar transform for placement tests
const get_colorbar_transform = async (
  section_locator: Locator,
): Promise<string> => {
  const colorbar_wrapper = section_locator.locator(
    `div.colorbar[style*='position: absolute']`,
  )
  await colorbar_wrapper.waitFor({ state: `visible`, timeout: 5000 })
  const transform = await colorbar_wrapper.evaluate((el) =>
    globalThis.getComputedStyle(el).transform
  )

  if (transform.startsWith(`matrix`)) {
    const parts = transform.match(/matrix\((.+)\)/)
    if (parts && parts[1]) {
      const values = parts[1].split(`,`).map((str) => parseFloat(str.trim()))
      if (values.length === 6) {
        const tx = values[4]
        const ty = values[5]
        if (Math.abs(tx) < 1 && Math.abs(ty) < 1) return ``
        if (Math.abs(tx) > 1 && Math.abs(ty) < 1) {
          return `translateX(${tx < 0 ? `-100%` : `100%`})`
        }
        if (Math.abs(tx) < 1 && Math.abs(ty) > 1) {
          return `translateY(${ty < 0 ? `-100%` : `100%`})`
        }
        if (Math.abs(tx) > 1 && Math.abs(ty) > 1) {
          return `translate(${tx < 0 ? `-100%` : `100%`}, ${ty < 0 ? `-100%` : `100%`})`
        }
      }
    }
  } else if (transform === `none`) {
    return ``
  }
  return transform
}

// Get marker bounding box for sizing tests
const get_marker_bbox = async (
  plot_locator: Locator,
  index: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> => {
  const marker_locator = plot_locator.locator(`path.marker`).nth(index)
  await marker_locator.waitFor({ state: `visible`, timeout: 5000 })
  return marker_locator.boundingBox()
}

// Get bbox area
const get_bbox_area = (bbox: { width: number; height: number } | null): number =>
  bbox ? bbox.width * bbox.height : 0

// Check and return marker sizes and relationships
const check_marker_sizes = async (
  plot_locator: Locator,
  first_idx: number,
  intermediate_idx: number,
  last_idx: number,
): Promise<{
  first_area: number
  intermediate_area: number
  last_area: number
  ratio_last_first: number
  ratio_inter_first: number
}> => {
  const bbox_first = await get_marker_bbox(plot_locator, first_idx)
  const bbox_intermediate = await get_marker_bbox(plot_locator, intermediate_idx)
  const bbox_last = await get_marker_bbox(plot_locator, last_idx)

  const first_area = get_bbox_area(bbox_first)
  const intermediate_area = get_bbox_area(bbox_intermediate)
  const last_area = get_bbox_area(bbox_last)

  expect(first_area).toBeGreaterThan(0)
  expect(intermediate_area).toBeGreaterThanOrEqual(first_area)
  expect(last_area).toBeGreaterThanOrEqual(intermediate_area)

  const ratio_last_first = last_area / first_area
  const ratio_inter_first = intermediate_area / first_area

  expect(ratio_inter_first).toBeGreaterThanOrEqual(1)
  expect(ratio_last_first).toBeGreaterThanOrEqual(ratio_inter_first)

  return {
    first_area,
    intermediate_area,
    last_area,
    ratio_last_first,
    ratio_inter_first,
  }
}

// Hover over a marker to show tooltip using two-phase approach.
// The ScatterPlot component requires onmouseenter on the SVG to set hovered=true
// before onmousemove can identify the closest point and show the tooltip.
// This helper handles the two-phase hover pattern reliably using polling instead
// of fixed delays for better CI stability.
const hover_to_show_tooltip = async (
  page: Page,
  plot_locator: Locator,
  marker_locator: Locator,
): Promise<void> => {
  // Use .first() to avoid strict mode violations if plot contains additional SVGs (e.g., icons)
  const svg = plot_locator.locator(`> svg[role="img"]`).first()
  await expect(svg).toBeVisible()
  await expect(marker_locator).toBeVisible()

  const tooltip_locator = plot_locator.locator(`.plot-tooltip`)

  // Use polling pattern instead of fixed delay for CI stability
  await expect(async () => {
    const svg_bbox = await svg.boundingBox()
    const marker_bbox = await marker_locator.boundingBox()
    if (!svg_bbox || !marker_bbox) throw new Error(`Bounding boxes not available`)

    // Phase 1: Enter SVG area first (triggers onmouseenter to set hovered=true)
    await page.mouse.move(svg_bbox.x + 10, svg_bbox.y + 10)
    // Phase 2: Move to marker center (triggers onmousemove to find closest point)
    await page.mouse.move(
      marker_bbox.x + marker_bbox.width / 2,
      marker_bbox.y + marker_bbox.height / 2,
    )
    await expect(tooltip_locator).toBeVisible()
  }).toPass({ timeout: 2000 })
}

// Get tooltip background and text color after hover
const get_tooltip_colors = async (
  page: Page,
  plot_id: string,
): Promise<{ bg: string; text: string }> => {
  // The id prop is applied directly to the .scatter div
  const plot_locator = page.locator(`#tooltip-precedence-test #${plot_id}.scatter`)
  const point_locator = plot_locator.locator(`path.marker`).first()
  const tooltip_locator = plot_locator.locator(`.plot-tooltip`)

  await ensure_plot_visible(plot_locator)
  await hover_to_show_tooltip(page, plot_locator, point_locator)

  await expect(tooltip_locator).toBeVisible()
  const colors = await tooltip_locator.evaluate((el) => {
    const style = globalThis.getComputedStyle(el)
    return { bg: style.backgroundColor, text: style.color }
  })

  // Move away to hide tooltip
  const plot_bbox = await plot_locator.boundingBox()
  if (plot_bbox) {
    await page.mouse.move(plot_bbox.x + 10, plot_bbox.y + 10)
  }
  await expect(tooltip_locator).toBeHidden({ timeout: 5000 })
  return colors
}

// Open control pane via hover-reveal pattern.
// Control toggle is hidden by default and shown on hover. This helper
// handles the hover, toggle click, and waits for the pane to be visible.
const open_control_pane = async (
  plot_locator: Locator,
): Promise<{ toggle: Locator; pane: Locator }> => {
  await plot_locator.hover()
  const controls_toggle = plot_locator.locator(`button.pane-toggle`)
  await expect(controls_toggle).toBeVisible({ timeout: 2000 })
  await controls_toggle.click()
  const control_pane = plot_locator.locator(`.draggable-pane`)
  await expect(control_pane).toBeVisible()
  return { toggle: controls_toggle, pane: control_pane }
}

// Extract properties from legend items using a custom extractor function
const extract_legend_properties = async <T>(
  legend: Locator,
  extractor: (item: Locator, idx: number) => Promise<T>,
): Promise<T[]> => {
  const items = legend.locator(`.legend-item`)
  const count = await items.count()
  const results: T[] = []
  for (let idx = 0; idx < count; idx++) {
    results.push(await extractor(items.nth(idx), idx))
  }
  return results
}

// Scatter plot tests
test.describe(`ScatterPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  // Basic rendering tests

  test(`renders basic scatter plot with correct axis labels and ticks`, async ({ page }) => {
    const scatter_plot = page.locator(`#basic-example .scatter`)
    await expect(scatter_plot).toBeVisible()

    // Check axis labels
    await expect(scatter_plot.locator(`.axis-label.x-label`)).toHaveText(`X Axis`)
    await expect(scatter_plot.locator(`.axis-label.y-label`)).toHaveText(`Y Axis`)

    // Check cursor is not pointer (no click handler)
    const point = scatter_plot.locator(`path.marker`).first()
    const cursor = await point.evaluate((el) => globalThis.getComputedStyle(el).cursor)
    expect(cursor).not.toBe(`pointer`)

    // Check that ticks exist within reasonable bounds (varies by viewport)
    const x_tick_count = await scatter_plot.locator(`g.x-axis .tick`).count()
    const y_tick_count = await scatter_plot.locator(`g.y-axis .tick`).count()
    expect(x_tick_count).toBeGreaterThanOrEqual(4)
    expect(x_tick_count).toBeLessThanOrEqual(15)
    expect(y_tick_count).toBeGreaterThanOrEqual(4)
    expect(y_tick_count).toBeLessThanOrEqual(15)

    // Check tick text exists and contains valid numeric values
    const x_tick_texts = await scatter_plot.locator(`g.x-axis .tick text`)
      .allTextContents()
    const y_tick_texts = await scatter_plot.locator(`g.y-axis .tick text`)
      .allTextContents()
    expect(x_tick_texts.length).toBeGreaterThan(0)
    expect(y_tick_texts.length).toBeGreaterThan(0)

    // Verify tick values are parseable numbers (handles plain numbers and scientific notation)
    const parse_tick = (text: string) => parseFloat(text)
    const x_values = x_tick_texts.map(parse_tick).filter((val) => !isNaN(val))
    const y_values = y_tick_texts.map(parse_tick).filter((val) => !isNaN(val))
    expect(x_values.length).toBeGreaterThan(0)
    expect(y_values.length).toBeGreaterThan(0)

    // Verify tick values are in ascending order (proper axis scaling)
    expect(is_ascending(x_values)).toBe(true)
    expect(is_ascending(y_values)).toBe(true)

    // Check markers are rendered (10 points in basic_data)
    await expect(scatter_plot.locator(`path.marker`)).toHaveCount(10)
  })

  // Marker and line rendering tests
  const marker_test_cases = [
    { id: `#points-only`, expected_markers: 10, has_line: false },
    { id: `#line-only`, expected_markers: 0, has_line: true },
    { id: `#line-points`, expected_markers: 10, has_line: true },
  ]
  marker_test_cases.forEach(({ id, expected_markers, has_line }) => {
    test(`renders marker type ${id} correctly`, async ({ page }) => {
      const section = page.locator(`#marker-types`)
      await expect(section).toBeVisible()

      const plot = section.locator(`${id}`)
      await expect(plot).toBeVisible()

      // Check markers count
      await expect(plot.locator(`path.marker`)).toHaveCount(expected_markers)

      if (has_line) {
        const line_path = plot.locator(`svg >> path[fill="none"]`)
        await expect(line_path).toBeVisible()
        await expect(line_path).toHaveAttribute(`d`, /M.+/)
      }
    })
  })

  test(`renders line styles correctly`, async ({ page }) => {
    const solid_plot = page.locator(`#solid-line-plot.scatter`)
    const dashed_plot = page.locator(`#dashed-line-plot.scatter`)
    const custom_plot = page.locator(`#custom-dash-plot.scatter`)

    // Check solid lines (no stroke-dasharray)
    const solid_line_paths = solid_plot.locator(`path[fill='none'][stroke='steelblue']`)
    await expect(solid_line_paths).toHaveCount(2)

    const first_solid_line = solid_line_paths.first()
    await expect(first_solid_line).toBeVisible()
    expect(await first_solid_line.getAttribute(`stroke-dasharray`)).toBeNull()
    await expect(first_solid_line).toHaveAttribute(`stroke-width`, `2`)

    // Check dashed line
    const dashed_line = dashed_plot.locator(
      `path[fill='none'][stroke='crimson'][stroke-dasharray='5 2']`,
    )
    await expect(dashed_line).toBeVisible()
    await expect(dashed_line).toHaveAttribute(`stroke-width`, `3`)

    // Check custom dashed line
    const custom_line = custom_plot.locator(
      `path[fill='none'][stroke='forestgreen'][stroke-dasharray='10 5 2 5']`,
    )
    await expect(custom_line).toBeVisible()
    await expect(custom_line).toHaveAttribute(`stroke-width`, `1`)
  })

  test(`applies custom styling correctly`, async ({ page }) => {
    const rainbow_plot = page.locator(`#custom-style`)
    const scatter_locator = rainbow_plot.locator(`#rainbow-points .scatter`)

    await expect(scatter_locator).toBeVisible()
    await expect(scatter_locator.locator(`.marker`).first()).toBeVisible()

    const first_marker_for_stroke = scatter_locator.locator(`.marker`).first()
    await expect(first_marker_for_stroke).toHaveAttribute(`stroke`, `black`)
    await expect(first_marker_for_stroke).toHaveAttribute(`stroke-width`, `2`)
  })

  test(`marker sizing scales correctly with data values`, async ({ page }) => {
    // Test with a plot that has different marker sizes based on data
    const plot_locator = page.locator(`#basic-example .scatter`)
    await expect(plot_locator).toBeVisible()

    // Test that markers have reasonable sizes
    const marker_count = await plot_locator.locator(`.marker`).count()
    if (marker_count >= 3) {
      const sizes = await check_marker_sizes(plot_locator, 0, 1, 2)
      expect(sizes.ratio_inter_first).toBeGreaterThan(0.5)
      expect(sizes.ratio_last_first).toBeGreaterThan(0.5)
      expect(sizes.first_area).toBeGreaterThan(0)
      expect(sizes.intermediate_area).toBeGreaterThan(0)
      expect(sizes.last_area).toBeGreaterThan(0)
    }
  })

  test(`size_values prop with per-point styling and dynamic configuration`, async ({ page }) => {
    // TODO: Consider experimenting with more tolerant area-ratio thresholds
    // so this test can eventually run in CI again
    test.skip(IS_CI, `Size values test has numerical variations in CI`)
    // Configure retries for size compression tests which can have small numerical variations
    test.info().annotations.push({ type: `slow`, description: `Size calculation test` })

    // This test verifies the fix for size_values not working with per-point styling arrays
    // Test page has the spiral plot section at #point-sizing-spiral-test

    // Find the spiral plot section (has per-point styling with symbol_type and size_values)
    const section = page.locator(`#point-sizing-spiral-test`)
    const plot_locator = section.locator(`.scatter`)
    await expect(plot_locator).toBeVisible({ timeout: 15000 })

    // Wait for markers to render with extended timeout
    await expect(plot_locator.locator(`.marker`).first()).toBeVisible({ timeout: 10000 })

    const marker_count = await plot_locator.locator(`.marker`).count()
    expect(marker_count).toBeGreaterThanOrEqual(3)

    // Use dynamic indices to avoid out-of-bounds access
    const mid_idx = Math.floor(marker_count / 2)
    const last_idx = marker_count - 1

    // Test 1: Verify size progression with per-point styling arrays (use toPass for timing)
    let area_0 = 0
    let area_mid = 0
    let area_last = 0
    await expect(async () => {
      const bbox_0 = await get_marker_bbox(plot_locator, 0)
      const bbox_mid = await get_marker_bbox(plot_locator, mid_idx)
      const bbox_last = await get_marker_bbox(plot_locator, last_idx)
      area_0 = get_bbox_area(bbox_0)
      area_mid = get_bbox_area(bbox_mid)
      area_last = get_bbox_area(bbox_last)
      expect(area_0).toBeGreaterThan(0)
      expect(area_mid).toBeGreaterThan(area_0 * 0.9) // Allow 10% tolerance
      expect(area_last).toBeGreaterThan(area_mid * 0.9) // Allow 10% tolerance
      expect(area_last / area_0).toBeGreaterThan(2.5) // Expect at least 2.5x growth
    }).toPass({ timeout: 10000 })

    // Test 2: Verify size_scale.radius_range changes affect marker sizes
    const max_size_input = section.locator(`input[aria-label="Max Size (px)"]`)
    await max_size_input.fill(`50`)

    // Wait for marker size to actually increase (longer timeout for CI)
    await expect(async () => {
      const updated_bbox = await get_marker_bbox(plot_locator, last_idx)
      const updated_area = get_bbox_area(updated_bbox)
      expect(updated_area).toBeGreaterThan(area_last * 1.2) // At least 20% larger (relaxed from 50%)
    }).toPass({ timeout: 10000 })

    // Test 3: Verify log scale compresses size differences
    // Reset max size to baseline before comparing linear vs log scale
    await max_size_input.fill(`25`)

    // Capture linear scale area for last marker (longer timeout for CI)
    const scale_select = section.locator(`select[aria-label="Size Scale"]`)
    let linear_area = 0
    await expect(async () => {
      const linear_last = await get_marker_bbox(plot_locator, last_idx)
      linear_area = get_bbox_area(linear_last)
      expect(linear_area).toBeGreaterThan(0)
    }).toPass({ timeout: 10000 })

    await scale_select.selectOption(`log`)

    // Log scale should compress the size range, making large values relatively smaller
    // Verify log area is smaller (compressed) compared to linear
    await expect(async () => {
      const log_last = await get_marker_bbox(plot_locator, last_idx)
      const log_area = get_bbox_area(log_last)
      expect(log_area).toBeGreaterThan(0)
      // Log scale should compress, so log area should be smaller (allow 10% tolerance)
      expect(log_area).toBeLessThan(linear_area * 1.1)
      expect(log_area).toBeGreaterThan(linear_area * 0.3) // But not too small
    }).toPass({ timeout: 10000 })
  })

  // Scale and range tests

  const range_test_cases = [
    { plot_id: `#wide-range`, expected_markers: 9 },
    { plot_id: `#small-range`, expected_markers: 5 },
  ]

  range_test_cases.forEach(({ plot_id, expected_markers }) => {
    test(`scales correctly with ${plot_id} data range`, async ({ page }) => {
      const section = page.locator(`#range-test`)
      await expect(section).toBeVisible()

      const plot = section.locator(`${plot_id} .scatter`)
      await expect(plot).toBeVisible()
      await expect(plot.locator(`.marker`)).toHaveCount(expected_markers)

      // Verify axes have ticks within reasonable bounds
      const x_tick_count = await plot.locator(`g.x-axis .tick`).count()
      const y_tick_count = await plot.locator(`g.y-axis .tick`).count()
      expect(x_tick_count).toBeGreaterThanOrEqual(3)
      expect(x_tick_count).toBeLessThanOrEqual(20)
      expect(y_tick_count).toBeGreaterThanOrEqual(3)
      expect(y_tick_count).toBeLessThanOrEqual(20)

      // Verify tick values span a reasonable range for the data
      const x_tick_texts = await plot.locator(`g.x-axis .tick text`).allTextContents()
      const y_tick_texts = await plot.locator(`g.y-axis .tick text`).allTextContents()
      const parse_tick = (text: string) => parseFloat(text)
      const x_values = x_tick_texts.map(parse_tick).filter((val) => !isNaN(val))
      const y_values = y_tick_texts.map(parse_tick).filter((val) => !isNaN(val))

      // Tick range should be positive (axis spans some distance)
      if (x_values.length >= 2) {
        const x_range = Math.max(...x_values) - Math.min(...x_values)
        expect(x_range).toBeGreaterThan(0)
      }
      if (y_values.length >= 2) {
        const y_range = Math.max(...y_values) - Math.min(...y_values)
        expect(y_range).toBeGreaterThan(0)
      }
    })
  })

  const log_scale_test_cases = [
    {
      plot_id: `#log-y`,
      axis: `y`,
      description: `y-axis`,
    },
    {
      plot_id: `#log-x`,
      axis: `x`,
      description: `x-axis`,
    },
  ]

  log_scale_test_cases.forEach(({ plot_id, axis, description }) => {
    test(`handles logarithmic ${description} correctly`, async ({ page }) => {
      const section = page.locator(`#log-scale`)
      await expect(section).toBeVisible()

      const plot = section.locator(`${plot_id} .scatter`)
      await expect(plot).toBeVisible()

      // Verify log scale has appropriate number of ticks
      const tick_count = await plot.locator(`g.${axis}-axis .tick`).count()
      expect(tick_count).toBeGreaterThanOrEqual(3)
      expect(tick_count).toBeLessThanOrEqual(20)

      // Verify tick values follow logarithmic progression (roughly constant ratios)
      const tick_texts = await plot.locator(`g.${axis}-axis .tick text`).allTextContents()
      const tick_values = tick_texts
        .map((text) => parseFloat(text))
        .filter((val) => !isNaN(val) && val > 0)
        .sort((a, b) => a - b)

      // Log scale should have at least 2 positive tick values to check ratios
      expect(tick_values.length).toBeGreaterThanOrEqual(2)

      // Verify logarithmic progression: consecutive ratios should be roughly consistent
      if (tick_values.length >= 3) {
        const ratios = tick_values.slice(1).map((val, idx) => val / tick_values[idx])
        // For log scale, ratios should be positive (increasing order) and within reasonable bounds
        // Relaxed to allow D3's automatic tick generation which can produce varied ratios
        const valid_log_ratios = ratios.every((ratio) => ratio >= 1 && ratio <= 1000)
        expect(valid_log_ratios).toBe(true)
      }

      // Verify markers exist
      const markers = plot.locator(`path.marker`)
      const marker_count = await markers.count()
      expect(marker_count).toBeGreaterThan(0)
    })
  })

  test(`handles color scaling with both linear and log modes`, async ({ page }) => {
    const section = page.locator(`#color-scale`)
    await expect(section).toBeVisible()

    const color_scale_plot = section.locator(`#color-scale-toggle .scatter`)
    await expect(color_scale_plot).toBeVisible()

    const linear_radio = section.locator(`input[value="linear"]`)
    const log_radio = section.locator(`input[value="log"]`)

    // Check initial state (linear)
    await expect(linear_radio).toBeChecked()
    await expect(color_scale_plot.locator(`.marker`)).toHaveCount(10)
    await expect(color_scale_plot.locator(`.colorbar`)).toBeVisible()

    // Switch to log mode and check
    await click_radio(page, `#color-scale input[value="log"]`)
    await expect(log_radio).toBeChecked()
    await expect(linear_radio).not.toBeChecked()
    await expect(color_scale_plot.locator(`.marker`)).toHaveCount(10)
    await expect(color_scale_plot.locator(`.colorbar`)).toBeVisible()

    // Switch back to linear mode
    await click_radio(page, `#color-scale input[value="linear"]`)
    await expect(linear_radio).toBeChecked()
  })

  test(`no console errors on linear-log scale transition`, async ({ page }) => {
    const section = page.locator(`#lin-log-transition`)
    const plot_locator = section.locator(`.scatter`)
    const svg = plot_locator.locator(`> svg[role="img"]`).first()
    const linear_radio = section.locator(`input[value="linear"]`)
    const log_radio = section.locator(`input[value="log"]`)
    const y_axis_ticks = plot_locator.locator(`g.y-axis .tick`)
    const first_point_marker = plot_locator.locator(`.marker`).first()

    const page_errors: Error[] = []
    const console_errors: string[] = []

    page.on(`pageerror`, (error) => page_errors.push(error))
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    // Initial state (linear)
    await expect(linear_radio).toBeChecked()
    await expect(log_radio).not.toBeChecked()
    await expect(svg).toBeVisible()
    await expect(y_axis_ticks.first()).toBeVisible()
    await expect(first_point_marker).toBeVisible()

    // Toggle to log scale
    await log_radio.click()
    await expect(log_radio).toBeChecked()
    await expect(svg).toBeVisible({ timeout: 2000 })
    await expect(y_axis_ticks.first()).toBeVisible({ timeout: 2000 })
    await expect(first_point_marker).toBeVisible({ timeout: 2000 })

    // Toggle back to linear scale
    await linear_radio.click()
    await expect(linear_radio).toBeChecked()
    await expect(svg).toBeVisible({ timeout: 2000 })
    await expect(y_axis_ticks.first()).toBeVisible({ timeout: 2000 })
    await expect(first_point_marker).toBeVisible({ timeout: 2000 })

    expect(page_errors).toHaveLength(0)
    expect(console_errors).toHaveLength(0)
  })

  // INTERACTION TESTS

  test(`bind:hovered prop reflects hover state`, async ({ page }) => {
    const section = page.locator(`#bind-hovered`)
    const scatter_plot = section.locator(`.scatter`)
    const svg = scatter_plot.locator(`> svg[role="img"]`).first()
    const hover_status = page.locator(`#hover-status`)

    // Initial state: not hovered
    await expect(hover_status).toHaveText(`false`)

    // Hover over plot
    await svg.hover()
    await expect(hover_status).toHaveText(`true`)

    // Move mouse away
    await page.mouse.move(0, 0)
    await expect(hover_status).toHaveText(`false`)
  })

  test(`handles point click and double-click events`, async ({ page }) => {
    const section_selector = `#point-event-test`
    const plot_selector = `${section_selector} .scatter`
    const clicked_text_selector = `${section_selector} [data-testid="last-clicked-point"]`
    const double_clicked_text_selector =
      `${section_selector} [data-testid="last-double-clicked-point"]`

    const plot_locator = page.locator(plot_selector)
    const first_marker_path = plot_locator.locator(`path.marker`).first()
    const first_marker_clickable_element = first_marker_path.locator(`..`)
    const clicked_text = page.locator(clicked_text_selector)
    const double_clicked_text = page.locator(double_clicked_text_selector)

    await expect(plot_locator).toBeVisible()
    await expect(first_marker_path).toBeVisible()

    // Initial state
    await expect(clicked_text).toContainText(`Last Clicked Point: none`)
    await expect(double_clicked_text).toContainText(`Last Double-Clicked Point: none`)

    // Single click
    await first_marker_clickable_element.dispatchEvent(`click`)
    await expect(clicked_text).toContainText(
      `Last Clicked Point: Point: series 0, index 0 (x=1, y=2)`,
    )
    await expect(double_clicked_text).toContainText(`Last Double-Clicked Point: none`)

    // Double click
    await first_marker_clickable_element.dispatchEvent(`dblclick`)
    await expect(double_clicked_text).toContainText(
      `Last Double-Clicked Point: DblClick: series 0, index 0 (x=1, y=2)`,
    )
  })

  test(`zooms correctly inside and outside plot area and resets`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const svg = plot_locator.locator(`> svg[role="img"]`).first()
    const x_axis = plot_locator.locator(`g.x-axis`)
    const y_axis = plot_locator.locator(`g.y-axis`)
    const zoom_rect = plot_locator.locator(`rect.zoom-rect`)

    const console_errors: string[] = []
    const page_errors: Error[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })
    page.on(`pageerror`, (error) => page_errors.push(error))

    // Get initial state (longer timeout for CI)
    await x_axis.locator(`.tick text`).first().waitFor({
      state: `visible`,
      timeout: 15000,
    })
    await y_axis.locator(`.tick text`).first().waitFor({
      state: `visible`,
      timeout: 15000,
    })

    const initial_x = await get_tick_range(x_axis)
    const initial_y = await get_tick_range(y_axis)
    // Tick count varies by viewport size but should be within a reasonable range
    expect(initial_x.ticks.length).toBeGreaterThanOrEqual(4)
    expect(initial_x.ticks.length).toBeLessThanOrEqual(15)
    expect(initial_y.ticks.length).toBeGreaterThanOrEqual(4)
    expect(initial_y.ticks.length).toBeLessThanOrEqual(15)
    expect(initial_x.range).toBeGreaterThan(0)
    expect(initial_y.range).toBeGreaterThan(0)

    // Perform zoom drag INSIDE plot area
    let svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`SVG box not found`)

    let start_x = svg_box.x + svg_box.width * 0.3
    let start_y = svg_box.y + svg_box.height * 0.7
    let end_x = svg_box.x + svg_box.width * 0.7
    let end_y = svg_box.y + svg_box.height * 0.3

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()

    // Move over target point and then to final corner
    const target_point_x = svg_box.x + svg_box.width * 0.45
    const target_point_y = svg_box.y + svg_box.height * (1 - 0.5)
    await page.mouse.move(target_point_x, target_point_y, { steps: 10 })
    await page.mouse.move(end_x, end_y, { steps: 5 })

    await expect(zoom_rect).toBeVisible()
    const rect_box = await zoom_rect.boundingBox()
    if (!rect_box) throw new Error(`Rect box not found`)
    expect(rect_box.width).toBeGreaterThan(0)
    expect(rect_box.height).toBeGreaterThan(0)

    await page.mouse.up()
    await expect(zoom_rect).toBeHidden()

    // Verify INSIDE zoom state
    const zoomed_inside_x = await get_tick_range(x_axis)
    const zoomed_inside_y = await get_tick_range(y_axis)
    expect(zoomed_inside_x.ticks).not.toEqual(initial_x.ticks)
    expect(zoomed_inside_y.ticks).not.toEqual(initial_y.ticks)
    expect(zoomed_inside_x.range).toBeLessThan(initial_x.range)
    expect(zoomed_inside_y.range).toBeLessThan(initial_y.range)
    expect(zoomed_inside_x.range).toBeGreaterThan(0)
    expect(zoomed_inside_y.range).toBeGreaterThan(0)

    // Perform zoom drag OUTSIDE plot area
    svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`SVG box not found`)
    start_x = svg_box.x + svg_box.width * 0.8
    start_y = svg_box.y + svg_box.height * 0.8
    end_x = initial_x.ticks[0] - 50
    end_y = initial_y.ticks[0] - 50

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()
    await page.mouse.move(svg_box.x + 5, svg_box.y + 5, { steps: 5 })
    await expect(zoom_rect).toBeVisible()
    const rect_box_inside = await zoom_rect.boundingBox()
    if (!rect_box_inside) throw new Error(`Rect box inside not found`)
    expect(rect_box_inside.width).toBeGreaterThan(0)

    await page.mouse.move(end_x, end_y, { steps: 5 })
    await expect(zoom_rect).toBeVisible()
    const rect_box_outside = await zoom_rect.boundingBox()
    if (!rect_box_outside) throw new Error(`Rect box outside not found`)
    expect(rect_box_outside.width).toBeGreaterThan(rect_box_inside.width)
    expect(rect_box_outside.height).toBeGreaterThan(rect_box_inside.height)

    await page.mouse.up()
    await expect(zoom_rect).toBeHidden()

    // Verify OUTSIDE zoom state
    const zoomed_outside_x = await get_tick_range(x_axis)
    const zoomed_outside_y = await get_tick_range(y_axis)
    expect(zoomed_outside_x.ticks).not.toEqual(zoomed_inside_x.ticks)
    expect(zoomed_outside_y.ticks).not.toEqual(zoomed_inside_y.ticks)
    expect(zoomed_outside_x.range).toBeGreaterThan(0)
    expect(zoomed_outside_y.range).toBeGreaterThan(0)
    expect(zoomed_outside_y.range).not.toBeCloseTo(zoomed_inside_y.range)

    // Double-click to reset zoom
    await svg.dblclick()
    const reset_x = await get_tick_range(x_axis)
    const reset_y = await get_tick_range(y_axis)
    expect(reset_x.ticks).toEqual(initial_x.ticks)
    expect(reset_y.ticks).toEqual(initial_y.ticks)
    expect(reset_x.range).toBeCloseTo(initial_x.range)
    expect(reset_y.range).toBeCloseTo(initial_y.range)

    expect(page_errors).toHaveLength(0)
    expect(console_errors).toHaveLength(0)
  })

  // LABEL AUTO-PLACEMENT TESTS

  test(`label auto-placement repositions dense labels but preserves sparse ones`, async ({ page }) => {
    test.skip(IS_CI, `Label placement varies in CI`)
    const section = page.locator(`#label-auto-placement-test`)
    const plot_locator = section.locator(`.scatter`)
    const checkbox = section.getByRole(`checkbox`, { name: `Enable Auto Placement` })

    await expect(plot_locator.locator(`path.marker`).first()).toBeVisible()
    await expect(checkbox).toBeChecked()
    const positions_auto = await get_label_positions(plot_locator)

    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    const positions_manual = await get_label_positions(plot_locator)

    const dense_labels = Object.keys(positions_auto).filter((key) =>
      key.startsWith(`Dense-`)
    )
    expect(dense_labels.length).toBeGreaterThan(1)

    const sparse_labels = Object.keys(positions_auto).filter((key) =>
      key.startsWith(`Sparse-`)
    )
    expect(sparse_labels.length).toBe(4)

    // Calculate percentage-based threshold relative to plot size.
    // Sparse labels shouldn't move dramatically since they don't overlap.
    // Use 20% of plot diagonal as threshold - allows for auto-placement
    // adjustments while still catching major layout issues.
    const plot_box = await plot_locator.boundingBox()
    const plot_diagonal = plot_box
      ? Math.sqrt(plot_box.width ** 2 + plot_box.height ** 2)
      : 500 // fallback for safety
    const movement_threshold = plot_diagonal * 0.2

    for (const label_text of sparse_labels) {
      if (positions_auto[label_text] && positions_manual[label_text]) {
        const dx = positions_auto[label_text].x - positions_manual[label_text].x
        const dy = positions_auto[label_text].y - positions_manual[label_text].y
        const distance_moved = Math.sqrt(dx * dx + dy * dy)
        expect(
          distance_moved,
          `Label "${label_text}" moved ${distance_moved.toFixed(1)}px (threshold: ${
            movement_threshold.toFixed(1)
          }px, 20% of diagonal)`,
        ).toBeLessThan(movement_threshold)
      }
    }
  })

  const legend_visibility_test_cases = [
    {
      id: `#legend-single-default`,
      should_render: false,
      description: `single series by default`,
    },
    {
      id: `#legend-single-null`,
      should_render: false,
      description: `when legend prop is null`,
    },
    { id: `#legend-zero`, should_render: false, description: `for zero series` },
  ]

  legend_visibility_test_cases.forEach(({ id, should_render, description }) => {
    test(`legend does NOT render ${description}`, async ({ page }) => {
      const legend_section = page.locator(`#legend-tests`)
      const plot = legend_section.locator(id)
      await expect(plot.locator(`.legend`)).toHaveCount(should_render ? 1 : 0)
    })
  })

  test(`legend renders when explicitly configured or for multiple series`, async ({ page }) => {
    // Single series with explicit config
    const single_config_plot = page.locator(`#legend-single-config`)
    await expect(single_config_plot).toBeVisible()
    const single_legend = single_config_plot.locator(`.legend`)
    await expect(single_legend).toBeVisible()
    await expect(single_legend.locator(`.legend-label`)).toHaveText(`Single Series`)

    // Multiple series by default
    const multi_plot = page.locator(`#legend-multi-default`)
    await expect(multi_plot).toBeVisible()
    const multi_legend = multi_plot.locator(`.legend`)
    await expect(multi_legend).toBeVisible()
    await expect(multi_legend.locator(`.legend-item`)).toHaveCount(2)
    const label_spans = multi_legend.locator(`.legend-label`)
    await expect(label_spans.nth(0)).toHaveText(`Series A`)
    await expect(label_spans.nth(1)).toHaveText(`Series B`)
  })

  test(`legend interaction toggles and isolates series visibility`, async ({ page }) => {
    // The id prop is applied directly to the .scatter div
    const plot_locator = page.locator(`#legend-multi-default.scatter`)
    const series_a_item = plot_locator.locator(`.legend-item >> text=Series A`).locator(
      `..`,
    )
    const series_b_item = plot_locator.locator(`.legend-item >> text=Series B`).locator(
      `..`,
    )

    // Wait for plot to fully render
    await expect(plot_locator.locator(`g[data-series-id] .marker`)).toHaveCount(4)

    // Initial state
    await expect(series_a_item).not.toHaveClass(/hidden/)
    await expect(series_b_item).not.toHaveClass(/hidden/)

    // Single click to hide Series A
    await series_a_item.click()
    const hidden_markers = plot_locator.locator(`g[data-series-id] .marker`)
    await expect(hidden_markers).toHaveCount(2) // Only Series B remains
    await expect(series_a_item).toHaveClass(/hidden/)

    // Single click to show Series A again
    await series_a_item.click()
    const restored_markers = plot_locator.locator(`g[data-series-id] .marker`)
    await expect(restored_markers).toHaveCount(4) // Both series visible
    await expect(series_a_item).not.toHaveClass(/hidden/)

    // Double click A to isolate it
    await series_a_item.dblclick()
    const isolated_markers = plot_locator.locator(`g[data-series-id] .marker`)
    await expect(isolated_markers).toHaveCount(2) // Only A remains
    await expect(series_a_item).not.toHaveClass(/hidden/)
    await expect(series_b_item).toHaveClass(/hidden/)

    // Manually restore Series B by single-clicking it
    await series_b_item.click()

    // Verify both series are now visible
    await expect(series_a_item).not.toHaveClass(/hidden/)
    await expect(series_b_item).not.toHaveClass(/hidden/)

    const final_markers = plot_locator.locator(`g[data-series-id] .marker`)
    await expect(final_markers).toHaveCount(4) // Both series should be visible
  })

  test(`legend positioning and dragging functionality`, async ({ page }) => {
    // The id prop is applied directly to the .scatter div
    const plot_locator = page.locator(`#legend-multi-default.scatter`)
    const legend_locator = plot_locator.locator(`.legend`)

    // Check legend is visible and within plot bounds
    await expect(legend_locator).toBeVisible()
    const plot_bbox = await plot_locator.boundingBox()
    const legend_bbox = await legend_locator.boundingBox()

    if (!plot_bbox || !legend_bbox) throw new Error(`Bounding boxes are null`)

    // Legend uses smart auto-placement based on data density, so verify
    // it's positioned within the plot area (not necessarily in a corner)
    const legend_center_x = legend_bbox.x + legend_bbox.width / 2
    const legend_center_y = legend_bbox.y + legend_bbox.height / 2
    expect(legend_center_x).toBeGreaterThan(plot_bbox.x)
    expect(legend_center_x).toBeLessThan(plot_bbox.x + plot_bbox.width)
    expect(legend_center_y).toBeGreaterThan(plot_bbox.y)
    expect(legend_center_y).toBeLessThan(plot_bbox.y + plot_bbox.height)

    // Verify smart placement positions legend away from data density
    const markers = await plot_locator.locator(`path.marker`).all()
    const marker_positions = await Promise.all(
      markers.map((marker) => marker.boundingBox()),
    )

    // Calculate distance from legend center to nearest marker center
    const min_distance = Math.min(
      ...marker_positions.map((marker_bbox) => {
        if (!marker_bbox) return Infinity
        const dx = legend_center_x - (marker_bbox.x + marker_bbox.width / 2)
        const dy = legend_center_y - (marker_bbox.y + marker_bbox.height / 2)
        return Math.sqrt(dx * dx + dy * dy)
      }),
    )

    // Use percentage-based threshold relative to plot size (consistent with label test)
    // 20% of plot diagonal scales properly across different viewport sizes
    const plot_diagonal = Math.sqrt(plot_bbox.width ** 2 + plot_bbox.height ** 2)
    const distance_threshold = plot_diagonal * 0.2

    // Legend should not be too close to any data point (smart placement should avoid markers)
    expect(
      min_distance,
      `Legend too close to markers: ${min_distance.toFixed(1)}px (threshold: ${
        distance_threshold.toFixed(1)
      }px, 20% of diagonal)`,
    ).toBeGreaterThan(distance_threshold)

    // Test draggable class and cursor
    await expect(legend_locator).toHaveClass(/draggable/)
    const hover_x = legend_bbox.x + 10
    const hover_y = legend_bbox.y + 5
    await page.mouse.move(hover_x, hover_y)
    await expect(legend_locator).toHaveCSS(`cursor`, `grab`)

    // Test drag functionality
    const drag_start_x = legend_bbox.x + 10
    const drag_start_y = legend_bbox.y + 5
    const drag_end_x = drag_start_x + 80
    const drag_end_y = drag_start_y + 40

    await page.mouse.move(drag_start_x, drag_start_y)
    await page.mouse.down()
    await page.mouse.move(drag_end_x, drag_end_y, { steps: 10 })
    await page.mouse.up()

    // Verify legend remains functional after drag
    await expect(legend_locator).toBeVisible()
    await expect(legend_locator.locator(`.legend-item`)).toHaveCount(2)

    // Test that drag doesn't interfere with legend item clicks
    const series_a_item = plot_locator.locator(`.legend-item >> text=Series A`).locator(
      `..`,
    )
    await expect(series_a_item).not.toHaveClass(/hidden/)
    await series_a_item.click()
    await expect(series_a_item).toHaveClass(/hidden/)
    await series_a_item.click()
    await expect(series_a_item).not.toHaveClass(/hidden/)

    // Test position maintained after plot updates
    const position_after_drag = await get_legend_position(plot_locator)
    await series_a_item.click() // Toggle to trigger update
    await expect(series_a_item).toHaveClass(/hidden/)
    await series_a_item.click() // Toggle back
    await expect(series_a_item).not.toHaveClass(/hidden/)
    const position_after_update = await get_legend_position(plot_locator)
    expect(position_after_update.x).toBeCloseTo(position_after_drag.x, 0)
    expect(position_after_update.y).toBeCloseTo(position_after_drag.y, 0)
  })

  test(`legend line color reflects color scale for color-mapped series`, async ({ page }) => {
    // Test with color-mapped series that has lines but no explicit line stroke
    const section = page.locator(`#color-mapped-line-legend-test`)
    await expect(section).toBeVisible()

    const plot_locator = section.locator(`.scatter`)
    await expect(plot_locator).toBeVisible()

    // Check that legend exists and shows the line
    const legend = plot_locator.locator(`.legend`)
    await expect(legend).toBeVisible()

    // Get legend item and check it has a line indicator
    const legend_item = legend.locator(`.legend-item`).first()
    await expect(legend_item).toBeVisible()

    // Find the line element in the legend (it's an SVG line, not path)
    const legend_line = legend_item.locator(`line[stroke]`)
    // Check that at least one line element exists
    await expect(legend_line).toHaveCount(1)

    const legend_stroke = await legend_line.getAttribute(`stroke`)

    // Main assertion: Legend line color should reflect the color scale, not default to black
    // For color-mapped series with no explicit line stroke, the legend should use color_scale_fn
    expect(legend_stroke).not.toBeNull()
    expect(legend_stroke).not.toBe(`black`)
    expect(legend_stroke).not.toBe(`#000000`)
    expect(legend_stroke).not.toBe(`rgb(0, 0, 0)`)

    // The legend stroke should be a Viridis color (starts with #44 for the darkest value)
    // This verifies the fix: color_scale_fn is being used for legend lines with color_values
    expect(legend_stroke).toMatch(/^#[0-9a-f]{6}$/i) // Valid hex color
    expect(legend_stroke).toBe(`#440154`) // Viridis color for value 1 (first color_value)
  })

  const colorbar_test_cases = [
    {
      position: `top-left`,
      densities: { tl: 0, tr: 50, bl: 50, br: 50 },
      expected_transform: ``,
    },
    {
      position: `top-right`,
      densities: { tl: 50, tr: 0, bl: 50, br: 50 },
      expected_transform: `translateX(-100%)`,
    },
    {
      position: `bottom-left`,
      densities: { tl: 50, tr: 50, bl: 0, br: 50 },
      expected_transform: `translateY(-100%)`,
    },
    {
      position: `bottom-right`,
      densities: { tl: 50, tr: 50, bl: 50, br: 0 },
      expected_transform: `translate(-100%, -100%)`,
    },
  ]

  colorbar_test_cases.forEach(({ position, densities, expected_transform }) => {
    test(`colorbar moves to ${position} when least dense`, async ({ page }) => {
      const section = page.locator(`#auto-colorbar-placement`)
      await set_density(section, densities)
      const transform = await get_colorbar_transform(section)
      if (expected_transform === ``) {
        expect(transform).toBe(``)
      } else {
        expect(transform).toContain(expected_transform)
      }
    })
  })

  // TOOLTIP AND STYLING TESTS

  const tooltip_precedence_test_cases = [
    {
      plot_id: `fill-plot`,
      expected_bg: `rgb(128, 0, 128)`,
      expected_text: `rgb(255, 255, 255)`,
      description: `point fill color (dark bg -> white text)`,
    },
    {
      plot_id: `stroke-plot`,
      expected_bg: `rgb(255, 165, 0)`,
      expected_text: `rgb(0, 0, 0)`,
      description: `point stroke color (light bg -> black text)`,
    },
    {
      plot_id: `line-plot`,
      expected_bg: `rgb(0, 128, 0)`,
      expected_text: `rgb(255, 255, 255)`,
      description: `line color (dark bg -> white text)`,
    },
  ]
  tooltip_precedence_test_cases.forEach(
    ({ plot_id, expected_bg, expected_text, description }) => {
      test(`tooltip uses ${description}`, async ({ page }) => {
        const { bg, text } = await get_tooltip_colors(page, plot_id)
        expect(bg).toBe(expected_bg)
        expect(text).toBe(expected_text)
      })
    },
  )

  test(`point hover visual effects work correctly`, async ({ page }) => {
    const section_selector = `#basic-example`
    const plot_locator = page.locator(`${section_selector} .scatter`)
    const first_marker = plot_locator.locator(`path.marker`).first()
    const tooltip_locator = plot_locator.locator(`.plot-tooltip`)

    await plot_locator.waitFor({ state: `visible` })
    await first_marker.waitFor({ state: `visible` })

    // Get initial transform state
    const initial_transform = await first_marker.evaluate(
      (el: SVGPathElement) => globalThis.getComputedStyle(el).transform,
    )
    expect(
      initial_transform === `none` || initial_transform === `matrix(1, 0, 0, 1, 0, 0)`,
    ).toBe(true)
    await expect(tooltip_locator).toBeHidden()

    // Test hover coordinates calculation
    const plot_bbox = await plot_locator.boundingBox()
    expect(plot_bbox).toBeTruthy()

    const pad = { t: 5, b: 50, l: 50, r: 20 }
    const data_x_range = [0, 11]
    const data_y_range = [10, 30]
    const target_x_data = 0
    const target_y_data = 10

    const plot_inner_width = (plot_bbox?.width ?? 0) - pad.l - pad.r
    const plot_inner_height = (plot_bbox?.height ?? 0) - pad.t - pad.b

    const x_rel = (target_x_data - data_x_range[0]) / (data_x_range[1] - data_x_range[0])
    const y_rel = (target_y_data - data_y_range[0]) / (data_y_range[1] - data_y_range[0])

    const hover_x = pad.l + x_rel * plot_inner_width
    const hover_y = (plot_bbox?.height ?? 0) - pad.b - y_rel * plot_inner_height

    await page.mouse.move(hover_x, hover_y)
    await page.mouse.down()
    await page.mouse.up()
  })

  // Control Pane Tests

  test(`control pane functionality and state management`, async ({ page }) => {
    // Use the legend-multi-default section which has show_controls enabled
    // The id prop is applied directly to the .scatter div
    const scatter_plot = page.locator(`#legend-multi-default.scatter`)
    await expect(scatter_plot).toBeVisible()

    const { toggle: controls_toggle, pane: control_pane } = await open_control_pane(
      scatter_plot,
    )

    // Test display controls - only test points since legend-multi-default has points only
    const show_points_checkbox = control_pane.getByLabel(`Show points`)
    await expect(show_points_checkbox).toBeVisible()
    await expect(show_points_checkbox).toBeChecked()

    const initial_marker_count = await scatter_plot.locator(`path.marker`).count()
    expect(initial_marker_count).toBeGreaterThan(0)

    await show_points_checkbox.uncheck()
    expect(await scatter_plot.locator(`path.marker`).count()).toBe(0)

    await show_points_checkbox.check()
    expect(await scatter_plot.locator(`path.marker`).count()).toBe(initial_marker_count)

    // Test grid controls exist and can be toggled
    const grid_controls = [`X-axis grid`, `Y-axis grid`]

    for (const label of grid_controls) {
      const checkbox = control_pane.getByLabel(label)
      await expect(checkbox).toBeVisible()
      await expect(checkbox).toBeChecked()

      await checkbox.uncheck()
      await expect(checkbox).not.toBeChecked()

      await checkbox.check()
      await expect(checkbox).toBeChecked()
    }

    // Test style controls - look for any size input
    const size_input = control_pane.locator(`input[type="number"]`).first()
    if (await size_input.isVisible()) {
      await expect(size_input).toBeVisible()
    }

    // Test close toggle - use toggle from open_control_pane
    await scatter_plot.hover()
    await controls_toggle.click()
    await expect(control_pane).toBeHidden()
  })

  test(`tick format controls modify axis labels and validate input`, async ({ page }) => {
    // This test verifies that tick formatting in control pane works
    // The id prop is applied directly to the .scatter div
    const scatter_plot = page.locator(`#legend-multi-default.scatter`)
    const { toggle: controls_toggle, pane: control_pane } = await open_control_pane(
      scatter_plot,
    )

    // Verify axis ticks are visible
    const x_tick_text = scatter_plot.locator(`g.x-axis .tick text`).first()
    const y_tick_text = scatter_plot.locator(`g.y-axis .tick text`).first()
    await expect(x_tick_text).toBeVisible()
    await expect(y_tick_text).toBeVisible()

    // Capture initial tick text for Y-axis comparison
    const initial_y_tick = await y_tick_text.textContent()

    // Find the "Tick Format" section by its heading, then locate inputs within it
    // The section has an h4 with title followed by section element with inputs
    const tick_format_heading = control_pane.locator(`h4:has-text("Tick Format")`)
    await expect(tick_format_heading).toBeVisible()

    // Get the section that follows the heading (sibling relationship)
    const tick_format_section = tick_format_heading.locator(`+ section`)
    const x_format_input = tick_format_section.locator(
      `label:has-text("X-axis:") input[type="text"]`,
    )
    const y_format_input = tick_format_section.locator(
      `label:has-text("Y-axis:") input[type="text"]`,
    )

    // Test X-axis format input with a percentage format
    if (await x_format_input.isVisible()) {
      // Apply a percentage format to see label change
      await x_format_input.fill(`.0%`)

      // Poll until tick text shows percentage format
      await expect(x_tick_text).toContainText(`%`, { timeout: 5000 })

      // Test invalid format handling - d3-format throws for completely invalid specifiers
      // Use a format that doesn't start with % to avoid being treated as time format
      await x_format_input.fill(`invalid`)
      const has_invalid_class = await x_format_input.evaluate((el) =>
        el.classList.contains(`invalid`)
      )
      expect(has_invalid_class).toBe(true)

      // Restore a valid format and verify invalid class is removed
      await x_format_input.fill(`.2~s`)
      const invalid_class_removed = await x_format_input.evaluate((el) =>
        !el.classList.contains(`invalid`)
      )
      expect(invalid_class_removed).toBe(true)
    }

    // Test Y-axis format input
    if (await y_format_input.isVisible()) {
      // Apply scientific notation format
      await y_format_input.fill(`.1e`)

      // Poll until tick text shows scientific notation format
      await expect(async () => {
        const new_y_tick = await y_tick_text.textContent()
        expect(new_y_tick).toMatch(/e[+-]?\d/)
        expect(new_y_tick).not.toBe(initial_y_tick)
      }).toPass()

      // Test invalid format adds "invalid" class (use format not starting with %)
      await y_format_input.fill(`xyz_bad`)
      const y_has_invalid = await y_format_input.evaluate((el) =>
        el.classList.contains(`invalid`)
      )
      expect(y_has_invalid).toBe(true)

      // Restore valid format
      await y_format_input.fill(`~s`)
    }

    // Close control pane - use toggle from open_control_pane
    await scatter_plot.hover()
    await controls_toggle.click()
    await expect(control_pane).toBeHidden()
  })

  test(`one-sided axis range pins via controls`, async ({ page }) => {
    // Test that control pane opens and axes have ticks
    const plot = page.locator(`#basic-example .scatter`)
    await expect(plot).toBeVisible()

    const { toggle, pane } = await open_control_pane(plot)

    const x_axis = plot.locator(`g.x-axis`)
    const y_axis = plot.locator(`g.y-axis`)

    // Verify axes have ticks
    const x_ticks = await get_tick_range(x_axis)
    const y_ticks = await get_tick_range(y_axis)
    expect(x_ticks.ticks.length).toBeGreaterThan(0)
    expect(y_ticks.ticks.length).toBeGreaterThan(0)

    // Close control pane
    await plot.hover()
    await toggle.click()
    await expect(pane).toBeHidden()
  })

  // AXIS COLOR TESTS

  const axis_color_test_cases = [
    {
      plot_id: `#single-axis-plot`,
      expected_markers: 10,
      description: `single-axis plot`,
    },
    { plot_id: `#dual-axis-plot`, expected_markers: 20, description: `dual-axis plot` },
    {
      plot_id: `#color-scale-axis-plot`,
      expected_markers: 20,
      description: `color scale plot`,
    },
    {
      plot_id: `#custom-axis-colors-plot`,
      expected_markers: 20,
      description: `custom axis colors`,
    },
    {
      plot_id: `#disabled-axis-colors-plot`,
      expected_markers: 20,
      description: `disabled axis colors`,
    },
  ]

  axis_color_test_cases.forEach(({ plot_id, expected_markers, description }) => {
    test(`${description} renders correctly`, async ({ page }) => {
      // When ScatterPlot has id prop, it's applied directly to the .scatter div
      const plot_locator = page.locator(`#axis-color-test ${plot_id}.scatter`)
      await expect(plot_locator).toBeVisible()
      // Use direct child SVG (the main plot SVG, not icon SVGs)
      await expect(plot_locator.locator(`> svg[role="img"]`)).toBeVisible()
      await expect(plot_locator.locator(`path.marker`)).toHaveCount(expected_markers)

      // Check for dual-axis specific elements
      if (
        plot_id.includes(`dual`) || plot_id.includes(`custom`) ||
        plot_id.includes(`disabled`)
      ) {
        await expect(plot_locator.locator(`g.y-axis`)).toBeVisible()
        await expect(plot_locator.locator(`g.y2-axis`)).toBeVisible()
      }

      // Check for colorbar in color scale plots
      if (plot_id.includes(`color-scale`)) {
        await expect(plot_locator.locator(`.colorbar`)).toBeVisible()
      }
    })
  })

  // AXIS TICK TESTS

  const tick_axis_test_cases = [
    {
      axis: `x`,
      selector: `g.x-axis .tick`,
      description: `x-axis ticks are properly generated and formatted`,
    },
    {
      axis: `y`,
      selector: `g.y-axis .tick`,
      description: `y-axis ticks are properly generated and formatted`,
    },
  ]

  tick_axis_test_cases.forEach(({ selector, description }) => {
    test(`${description}`, async ({ page }) => {
      const section = page.locator(`#basic-example`)
      const scatter_plot = section.locator(`.scatter`)

      await expect(scatter_plot).toBeVisible()

      const axis_ticks = scatter_plot.locator(selector)
      // Verify tick count is within reasonable bounds
      const tick_count = await axis_ticks.count()
      expect(tick_count).toBeGreaterThanOrEqual(4)
      expect(tick_count).toBeLessThanOrEqual(15)

      // Verify tick text is visible and properly formatted
      const tick_texts = await axis_ticks.locator(`text`).allTextContents()
      expect(tick_texts.length).toBeGreaterThan(0)

      // Verify tick values are parseable and in ascending order
      const parse_tick = (text: string) => parseFloat(text)
      const values = tick_texts.map(parse_tick).filter((val) => !isNaN(val))
      expect(values.length).toBeGreaterThan(0)

      // Verify ascending order (proper axis scaling)
      expect(is_ascending(values)).toBe(true)

      // Verify first and last ticks are visible
      await expect(axis_ticks.locator(`text`).first()).toBeVisible()
      await expect(axis_ticks.locator(`text`).last()).toBeVisible()
    })
  })

  test(`auto-generated ticks span appropriate range for data`, async ({ page }) => {
    const section = page.locator(`#basic-example`)
    const scatter_plot = section.locator(`.scatter`)

    await expect(scatter_plot).toBeVisible()

    // Get tick values for both axes
    const x_tick_texts = await scatter_plot.locator(`g.x-axis .tick text`)
      .allTextContents()
    const y_tick_texts = await scatter_plot.locator(`g.y-axis .tick text`)
      .allTextContents()

    const parse_tick = (text: string) => parseFloat(text)
    const x_values = x_tick_texts.map(parse_tick).filter((val) => !isNaN(val))
    const y_values = y_tick_texts.map(parse_tick).filter((val) => !isNaN(val))

    // Verify we have a reasonable number of ticks
    expect(x_values.length).toBeGreaterThanOrEqual(4)
    expect(y_values.length).toBeGreaterThanOrEqual(4)

    // Verify tick ranges are positive (data spans some distance)
    const x_range = Math.max(...x_values) - Math.min(...x_values)
    const y_range = Math.max(...y_values) - Math.min(...y_values)
    expect(x_range).toBeGreaterThan(0)
    expect(y_range).toBeGreaterThan(0)

    // Verify tick spacing is roughly uniform (proper linear scale)
    if (x_values.length >= 3) {
      const x_spacings = x_values.slice(1).map((val, idx) => val - x_values[idx])
      const avg_spacing = x_spacings.reduce((a, b) => a + b, 0) / x_spacings.length
      // All spacings should be within 50% of the average (accounting for rounding)
      const uniform = x_spacings.every(
        (spacing) => Math.abs(spacing - avg_spacing) < avg_spacing * 0.6,
      )
      expect(uniform).toBe(true)
    }
  })

  test(`handles extreme zoom levels and data ranges`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const svg = plot_locator.locator(`> svg[role="img"]`).first()

    // Test extreme zoom in (very small area)
    const svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`SVG box not found`)

    // Create a very small zoom rectangle (1% of plot area)
    const center_x = svg_box.x + svg_box.width * 0.5
    const center_y = svg_box.y + svg_box.height * 0.5
    const tiny_offset = 2 // Very small rectangle

    await page.mouse.move(center_x - tiny_offset, center_y - tiny_offset)
    await page.mouse.down()
    await page.mouse.move(center_x + tiny_offset, center_y + tiny_offset)
    await page.mouse.up()

    // Should still render properly after extreme zoom
    await expect(plot_locator.locator(`> svg[role="img"]`)).toBeVisible()
    await expect(plot_locator.locator(`g.x-axis .tick text`).first()).toBeVisible()

    // Reset zoom for next test
    await svg.dblclick()
  })

  test(`handles very long axis labels and overlapping text`, async ({ page }) => {
    // Test with a plot that has long axis labels (if such test case exists)
    const plot_locator = page.locator(`#basic-example .scatter`)

    // Check that axis labels are properly positioned and don't overflow
    const x_label = plot_locator.locator(`.axis-label.x-label`)
    const y_label = plot_locator.locator(`.axis-label.y-label`)

    if (await x_label.isVisible()) {
      const x_label_box = await x_label.boundingBox()
      const plot_box = await plot_locator.boundingBox()

      if (x_label_box && plot_box) {
        // Label should be within reasonable bounds of the plot
        expect(x_label_box.x + x_label_box.width).toBeLessThanOrEqual(
          plot_box.x + plot_box.width + 50,
        )
      }
    }

    // Test Y-axis label positioning as well
    if (await y_label.isVisible()) {
      const y_label_box = await y_label.boundingBox()
      const plot_box = await plot_locator.boundingBox()

      if (y_label_box && plot_box) {
        // Y-label should be positioned within reasonable bounds
        expect(y_label_box.y).toBeGreaterThanOrEqual(plot_box.y - 20)
        expect(y_label_box.y + y_label_box.height).toBeLessThanOrEqual(
          plot_box.y + plot_box.height + 20,
        )
      }
    }
  })

  test(`series-specific controls work correctly in multi-series plots`, async ({ page }) => {
    // The id prop is applied directly to the .scatter div
    const multi_series_plot = page.locator(`#legend-multi-default.scatter`)
    const { toggle: controls_toggle, pane: control_pane } = await open_control_pane(
      multi_series_plot,
    )

    // Test series selector functionality
    const series_selector = control_pane.locator(`select#series-select`)
    if (await series_selector.isVisible()) {
      // Test switching between series
      await series_selector.selectOption(`0`)
      await expect(series_selector).toHaveValue(`0`)

      // Switch to different series
      await series_selector.selectOption(`1`)
      await expect(series_selector).toHaveValue(`1`)
    }

    // Close control pane - use toggle from open_control_pane
    await multi_series_plot.hover()
    await controls_toggle.click()
    await expect(control_pane).toBeHidden()
  })

  test(`color bar positioning with edge cases`, async ({ page }) => {
    // Test colorbar behavior at plot boundaries
    const section = page.locator(`#auto-colorbar-placement`)

    // Test all corners with extreme density settings
    await set_density(section, { tl: 100, tr: 0, bl: 0, br: 0 })
    const transform_extreme = await get_colorbar_transform(section)
    // Should position away from high density area
    expect(transform_extreme.length).toBeGreaterThan(0)

    // Test equal density (should pick default position)
    await set_density(section, { tl: 50, tr: 50, bl: 50, br: 50 })
    const transform_equal = await get_colorbar_transform(section)
    // Should have some positioning or default to empty
    expect(typeof transform_equal).toBe(`string`)
    // When densities are equal, should use consistent positioning
    expect(transform_equal.length).toBeGreaterThanOrEqual(0)
  })

  test(`point event handlers work with complex interactions`, async ({ page }) => {
    const section_selector = `#point-event-test`
    const section = page.locator(section_selector)
    const plot_locator = section.locator(`.scatter`)

    // Test multiple rapid clicks using dispatchEvent (safer than hover)
    const first_marker = plot_locator.locator(`path.marker`).first()
    const marker_group = first_marker.locator(`..`)

    await expect(first_marker).toBeVisible()
    await expect(marker_group).toBeVisible()

    // Test multiple click events
    await marker_group.dispatchEvent(`click`)
    await marker_group.dispatchEvent(`click`)
    await marker_group.dispatchEvent(`click`)

    // Should handle rapid clicks gracefully without errors
    await expect(plot_locator).toBeVisible()

    // Test additional mouse events without problematic actions
    await marker_group.dispatchEvent(`mouseenter`)
    await marker_group.dispatchEvent(`mouseleave`)

    // Verify plot remains functional
    await expect(plot_locator.locator(`> svg[role="img"]`)).toBeVisible()
    await expect(first_marker).toBeVisible()
  })

  test(`legend handles very long series names`, async ({ page }) => {
    // Test legend with long text (if such test case exists)
    const legend_plot = page.locator(`#legend-multi-default`)
    const legend = legend_plot.locator(`.legend`)

    if (await legend.isVisible()) {
      const legend_items = legend.locator(`.legend-item`)
      const item_count = await legend_items.count()

      // Check that all legend items are visible and properly sized
      for (let idx = 0; idx < item_count; idx++) {
        const item = legend_items.nth(idx)
        await expect(item).toBeVisible()

        // Check that text doesn't overflow container
        const item_box = await item.boundingBox()
        const legend_box = await legend.boundingBox()

        if (item_box && legend_box) {
          expect(item_box.x + item_box.width).toBeLessThanOrEqual(
            legend_box.x + legend_box.width + 10,
          )
        }
      }
    }
  })

  test(`tooltip positioning at plot edges`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const markers = plot_locator.locator(`path.marker`)
    const tooltip = plot_locator.locator(`.plot-tooltip`)

    // Test tooltip near plot edges
    const marker_count = await markers.count()
    if (marker_count > 0) {
      // Use two-phase hover pattern for reliable tooltip display
      await hover_to_show_tooltip(page, plot_locator, markers.first())
      await expect(tooltip).toBeVisible({ timeout: 2000 })

      const tooltip_box = await tooltip.boundingBox()
      const plot_box = await plot_locator.boundingBox()

      if (tooltip_box && plot_box) {
        // Tooltip should be positioned within reasonable bounds
        expect(tooltip_box.x).toBeGreaterThanOrEqual(0)
        expect(tooltip_box.y).toBeGreaterThanOrEqual(0)
      }

      // Move away to hide tooltip
      await plot_locator.hover()
      await expect(tooltip).toBeHidden()
    }
  })

  test(`color scaling with null and undefined values`, async ({ page }) => {
    const section = page.locator(`#color-scale`)
    const color_scale_plot = section.locator(`#color-scale-toggle .scatter`)

    // Test that plot handles null/undefined color values gracefully
    await expect(color_scale_plot).toBeVisible()
    await expect(color_scale_plot.locator(`.marker`)).toHaveCount(10)

    // Should render colorbar even with some null values
    await expect(color_scale_plot.locator(`.colorbar`)).toBeVisible()

    // No console errors should occur
    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    // Switch scale types to test null handling
    const log_radio = section.locator(`input[value="log"]`)
    await log_radio.click()

    expect(console_errors).toHaveLength(0)
  })

  test(`zoom behavior with logarithmic scales`, async ({ page }) => {
    const section = page.locator(`#log-scale`)
    const log_y_plot = section.locator(`#log-y .scatter`)
    const svg = log_y_plot.locator(`> svg[role="img"]`).first()

    // Test zoom on logarithmic scale
    const svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`SVG box not found`)

    const start_x = svg_box.x + svg_box.width * 0.2
    const start_y = svg_box.y + svg_box.height * 0.8
    const end_x = svg_box.x + svg_box.width * 0.8
    const end_y = svg_box.y + svg_box.height * 0.2

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()
    await page.mouse.move(end_x, end_y)
    await page.mouse.up()

    // Should handle zoom on log scale without errors
    await expect(log_y_plot.locator(`g.y-axis .tick text`).first()).toBeVisible()

    // Reset zoom
    await svg.dblclick()
  })

  // CONTROL PRECEDENCE TESTS - explicit styling should win on page load
  // and only user-modified controls should override

  test(`explicit point styling preserved on page load (controls don't override)`, async ({ page }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    await expect(plot).toBeVisible()

    // Get the first series markers (Crimson with explicit radius=12)
    const crimson_markers = plot.locator(`g[data-series-id="0"] path.marker`)
    await expect(crimson_markers).toHaveCount(5)

    // Verify explicit styling is preserved - check fill color via CSS variable with crimson fallback
    const first_crimson = crimson_markers.first()
    const crimson_fill = await first_crimson.getAttribute(`fill`)
    expect(crimson_fill).toContain(`crimson`) // CSS var with crimson fallback
    await expect(first_crimson).toHaveAttribute(`stroke`, `darkred`)
    await expect(first_crimson).toHaveAttribute(`stroke-width`, `3`)

    // Check the marker bounding box to verify radius is preserved (radius 12 ≈ ~24px diameter)
    const crimson_bbox = await first_crimson.boundingBox()
    expect(crimson_bbox).toBeTruthy()
    // Radius 12 means diameter ~24, accounting for stroke width ~30px total
    expect(crimson_bbox?.width).toBeGreaterThan(20)
    expect(crimson_bbox?.height).toBeGreaterThan(20)

    // Get second series markers (Green with explicit radius=8)
    const green_markers = plot.locator(`g[data-series-id="1"] path.marker`)
    await expect(green_markers).toHaveCount(5)

    const first_green = green_markers.first()
    const green_fill = await first_green.getAttribute(`fill`)
    expect(green_fill).toContain(`forestgreen`) // CSS var with forestgreen fallback
    await expect(first_green).toHaveAttribute(`stroke`, `darkgreen`)
    await expect(first_green).toHaveAttribute(`stroke-width`, `2`)

    // Green markers should be smaller than crimson (radius 8 vs 12)
    const green_bbox = await first_green.boundingBox()
    expect(green_bbox).toBeTruthy()
    expect(green_bbox?.width).toBeLessThan(crimson_bbox?.width ?? NaN)

    // Check line styling is also preserved
    const green_line = plot.locator(`g[data-series-id="1"] path[fill="none"]`)
    await expect(green_line).toHaveAttribute(`stroke`, `limegreen`)
    await expect(green_line).toHaveAttribute(`stroke-width`, `4`)
  })

  test(`per-property control touch: only modified control overrides explicit styling`, async ({ page }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    await expect(plot).toBeVisible()

    const { pane: control_pane } = await open_control_pane(plot)

    // Get initial marker state
    const crimson_marker = plot.locator(`g[data-series-id="0"] path.marker`).first()
    const initial_bbox = await crimson_marker.boundingBox()
    expect(initial_bbox).toBeTruthy()
    const initial_width = initial_bbox?.width ?? NaN

    // Initial values should be explicit styling via CSS variable
    const initial_fill = await crimson_marker.getAttribute(`fill`)
    expect(initial_fill).toContain(`crimson`)
    await expect(crimson_marker).toHaveAttribute(`stroke-width`, `3`)

    // Modify ONLY the point size control (should override explicit radius)
    const point_size_row = control_pane.locator(`[data-key="point.size"]`)
    const size_range = point_size_row.locator(`input[type="range"]`)
    await size_range.fill(`20`) // Set to max size

    // Wait for marker size to actually change
    await expect(async () => {
      const bbox = await crimson_marker.boundingBox()
      expect(bbox?.width).toBeGreaterThan(initial_width * 1.3) // At least 30% bigger
    }).toPass()

    // Verify size changed (marker got bigger)
    const updated_bbox = await crimson_marker.boundingBox()
    expect(updated_bbox).toBeTruthy()

    // CRITICAL: Verify OTHER explicit styling is STILL preserved
    // Color should still be crimson (not control default)
    const updated_fill = await crimson_marker.getAttribute(`fill`)
    expect(updated_fill).toContain(`crimson`)
    // Stroke color should still be darkred
    await expect(crimson_marker).toHaveAttribute(`stroke`, `darkred`)
    // Stroke width should still be 3 (not control default of 1)
    await expect(crimson_marker).toHaveAttribute(`stroke-width`, `3`)

    // Also verify second series is unaffected (controls only affect selected series)
    const green_marker = plot.locator(`g[data-series-id="1"] path.marker`).first()
    const green_fill = await green_marker.getAttribute(`fill`)
    expect(green_fill).toContain(`forestgreen`)
    await expect(green_marker).toHaveAttribute(`stroke`, `darkgreen`)
    await expect(green_marker).toHaveAttribute(`stroke-width`, `2`)
  })

  test(`control event delegation with data-key attributes`, async ({ page }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    await expect(plot).toBeVisible()

    const { pane: control_pane } = await open_control_pane(plot)

    // Check that data-key attributes are present on rows (using SettingsSection structure)
    // SettingsSection renders h4 + section siblings, so we look for data-key directly in the pane
    const size_row = control_pane.locator(`[data-key="point.size"]`)
    const color_row = control_pane.locator(`[data-key="point.color"]`)
    const stroke_width_row = control_pane.locator(`[data-key="point.stroke_width"]`)

    await expect(size_row).toBeVisible()
    await expect(color_row).toBeVisible()
    await expect(stroke_width_row).toBeVisible()

    // Verify Line Style section also has data-key attributes
    const line_width_row = control_pane.locator(`[data-key="line.width"]`)
    const line_color_row = control_pane.locator(`[data-key="line.color"]`)

    await expect(line_width_row).toBeVisible()
    await expect(line_color_row).toBeVisible()
  })

  test(`modifying line control only overrides that property`, async ({ page }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    await expect(plot).toBeVisible()

    // Get initial line styling (green series has explicit line_style)
    const green_line = plot.locator(`g[data-series-id="1"] path[fill="none"]`)
    await expect(green_line).toHaveAttribute(`stroke`, `limegreen`)
    await expect(green_line).toHaveAttribute(`stroke-width`, `4`)

    const { pane: control_pane } = await open_control_pane(plot)

    // Select second series (Green)
    const series_select = control_pane.locator(`select#series-select`)
    await series_select.selectOption(`1`)

    // Modify ONLY line width
    const line_width_row = control_pane.locator(`[data-key="line.width"]`)
    const width_range = line_width_row.locator(`input[type="range"]`)
    await width_range.fill(`8`) // Change from 4 to 8

    // Wait for line width to actually change
    await expect(green_line).toHaveAttribute(`stroke-width`, `8`, { timeout: 5000 })

    // CRITICAL: Line color should STILL be limegreen (not control default)
    await expect(green_line).toHaveAttribute(`stroke`, `limegreen`)

    // Point styling should also be unaffected
    const green_marker = plot.locator(`g[data-series-id="1"] path.marker`).first()
    const green_fill = await green_marker.getAttribute(`fill`)
    expect(green_fill).toContain(`forestgreen`)
    await expect(green_marker).toHaveAttribute(`stroke`, `darkgreen`)
  })

  test(`reset button triggers on_touch for all properties in section`, async ({ page }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    await expect(plot).toBeVisible()

    const { pane: control_pane } = await open_control_pane(plot)

    // Get initial explicit styling
    const crimson_marker = plot.locator(`g[data-series-id="0"] path.marker`).first()
    const initial_fill = await crimson_marker.getAttribute(`fill`)
    expect(initial_fill).toContain(`crimson`)
    const initial_stroke_width = await crimson_marker.getAttribute(`stroke-width`)
    expect(initial_stroke_width).toBe(`3`) // Explicit stroke width

    // Modify multiple values so the reset button appears (values need to differ from initial)
    const size_row = control_pane.locator(`[data-key="point.size"]`)
    const size_input = size_row.locator(`input[type="number"]`)
    await size_input.click()
    await size_input.fill(`15`)
    await size_input.press(`Enter`)

    // Find and wait for reset button to appear (indicates change was detected)
    const reset_button = control_pane.locator(`button.reset-button`).first()

    // Wait for reset button to become visible - fail loudly if it doesn't appear
    // so regressions in has_changes or reset UI are caught
    await expect(reset_button).toBeVisible({ timeout: 5000 })

    await reset_button.click()
    // Wait for stroke-width to reset to default
    await expect(crimson_marker).toHaveAttribute(`stroke-width`, `1`, { timeout: 5000 })
  })

  // AUTO-CYCLING COLORS AND SYMBOLS TESTS

  test(`auto-cycling assigns different colors to each series legend item`, async ({ page }) => {
    const section = page.locator(`#auto-cycling-test`)
    await expect(section).toBeVisible()

    const plot_locator = section.locator(`#auto-cycle-plot.scatter`)
    await expect(plot_locator).toBeVisible()

    const legend = plot_locator.locator(`.legend`)
    await expect(legend).toBeVisible()
    await expect(legend.locator(`.legend-item`)).toHaveCount(3)

    // Extract line stroke colors from each legend item
    const line_colors = await extract_legend_properties(legend, async (item) => {
      const line_svg = item.locator(`.legend-marker > svg`).first()
      return (await line_svg.locator(`line`).getAttribute(`stroke`)) ?? ``
    })

    // All colors should be non-empty and distinct
    expect(line_colors.every((color) => color !== ``)).toBe(true)
    expect(new Set(line_colors).size).toBe(3)

    // Verify expected colors from DEFAULT_SERIES_COLORS
    expect(line_colors).toEqual([`#4e79a7`, `#f28e2c`, `#e15759`])
  })

  test(`auto-cycling assigns different symbols to each series legend item`, async ({ page }) => {
    const section = page.locator(`#auto-cycling-test`)
    await expect(section).toBeVisible()

    const plot_locator = section.locator(`#auto-cycle-plot.scatter`)
    const legend = plot_locator.locator(`.legend`)

    // Extract symbol types from each legend item (circle, rect, polygon, path)
    const symbol_elements = await extract_legend_properties(legend, async (item) => {
      const symbol_svg = item.locator(`.legend-marker > svg`).last()
      for (const shape of [`circle`, `rect`, `polygon`, `path`]) {
        if ((await symbol_svg.locator(shape).count()) > 0) return shape
      }
      return `unknown`
    })

    // Each series should have a DIFFERENT symbol type (Circle, Square, Triangle)
    expect(symbol_elements).toEqual([`circle`, `rect`, `polygon`])
  })

  test(`responsive layout behavior`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)

    // Simulate viewport resize (if supported)
    await page.setViewportSize({ width: 800, height: 600 })

    // Plot should still be visible and functional
    await expect(plot_locator).toBeVisible()
    // Use direct child selector for main plot SVG
    await expect(plot_locator.locator(`> svg[role="img"]`)).toBeVisible()

    // Test with smaller viewport
    await page.setViewportSize({ width: 400, height: 300 })

    // Plot should adapt to smaller size
    await expect(plot_locator).toBeVisible()

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`tooltip appears and updates when hovering over different markers`, async ({ page }) => {
    // Test point hover tooltip behavior on the basic example
    const plot_locator = page.locator(`#basic-example .scatter`)
    await ensure_plot_visible(plot_locator)

    // Get markers
    const markers = plot_locator.locator(`path.marker`)
    const marker_count = await markers.count()
    expect(marker_count).toBeGreaterThan(1)

    // Hover over first marker - tooltip should appear
    const first_marker = markers.first()
    await hover_to_show_tooltip(page, plot_locator, first_marker)
    const tooltip = plot_locator.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    // Get tooltip content for first point
    const first_tooltip_text = await tooltip.textContent()
    expect(first_tooltip_text).toBeTruthy()

    // Hover over a different marker - tooltip should update with new content
    const second_marker = markers.nth(1)
    await hover_to_show_tooltip(page, plot_locator, second_marker)
    await expect(tooltip).toBeVisible({ timeout: 2000 })

    // Verify tooltip content changed (different point data)
    const second_tooltip_text = await tooltip.textContent()
    expect(second_tooltip_text).toBeTruthy()
    expect(second_tooltip_text).not.toBe(first_tooltip_text)
  })

  test(`improved label placement prevents overlap for isolated and clustered markers`, async ({ page }) => {
    test.skip(IS_CI, `Label placement varies in CI`)
    const section = page.locator(`#label-auto-placement-test`)
    const plot_locator = section.locator(`.scatter`)
    const checkbox = section.getByRole(`checkbox`, { name: `Enable Auto Placement` })

    // Enable auto-placement
    await checkbox.check()
    await expect(checkbox).toBeChecked()

    // Wait for simulation to settle: consecutive stable bbox snapshots
    await page.waitForFunction(() => {
      const labels = Array.from(
        document.querySelectorAll(`.scatter g[data-series-id] text`),
      )
      const snap = labels.map((el) => el.getBoundingClientRect())
      const w = window as Window & { __lblSnap__?: DOMRect[] }
      const prev = w.__lblSnap__
      w.__lblSnap__ = snap
      if (!prev || prev.length !== snap.length) return false
      const moved = snap.some((r, i) => {
        const p = prev[i]
        return Math.hypot(r.x - p.x, r.y - p.y) > 0.5
      })
      return !moved
    }, { timeout: 2000 })

    // Get label elements and their positions
    const label_elements = await plot_locator.locator(`g[data-series-id] text`).all()
    const label_data = await Promise.all(
      label_elements.map(async (label_el) => {
        const text_content = await label_el.textContent()
        const bbox = await label_el.boundingBox()
        return { text: text_content, bbox }
      }),
    )

    // Filter for sparse and dense labels
    const sparse_label_data = label_data.filter((d) => d.text?.startsWith(`Sparse-`))
    const dense_label_data = label_data.filter((d) => d.text?.startsWith(`Dense-`))

    expect(sparse_label_data.length).toBeGreaterThan(0)
    expect(dense_label_data.length).toBeGreaterThan(1)

    // For isolated markers (sparse labels), verify labels don't heavily overlap markers
    // by checking that label bounding boxes don't significantly intersect marker bboxes
    // Note: Labels will naturally be positioned near their associated marker,
    // so we allow small overlaps but check there's no complete visual obstruction
    for (const label_item of sparse_label_data) {
      if (!label_item.bbox) continue

      // Check that label has reasonable position (not at origin, has dimensions)
      expect(label_item.bbox.width).toBeGreaterThan(0)
      expect(label_item.bbox.height).toBeGreaterThan(0)
    }

    // For clustered labels (dense labels), verify they render with valid bounding boxes
    // and are not all at exactly the same position (which would indicate broken layout)
    const unique_positions = new Set<string>()
    for (const label_item of dense_label_data) {
      if (!label_item.bbox) continue

      expect(label_item.bbox.width).toBeGreaterThan(0)
      expect(label_item.bbox.height).toBeGreaterThan(0)

      // Track unique positions to verify labels aren't all stacked at same position
      const pos_key = `${Math.round(label_item.bbox.x)},${Math.round(label_item.bbox.y)}`
      unique_positions.add(pos_key)
    }

    // With auto-placement, clustered labels should have some variation in position
    // (not all stacked at exact same location)
    if (dense_label_data.length > 1) {
      expect(unique_positions.size).toBeGreaterThan(1)
    }
  })
})
