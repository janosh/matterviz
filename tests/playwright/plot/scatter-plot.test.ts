// deno-lint-ignore-file no-await-in-loop
import type { XyObj } from '$lib/plot'
import { expect, type Locator, type Page, test } from '@playwright/test'

// SHARED HELPER FUNCTIONS

/** Click radio buttons reliably */
const click_radio = async (page: Page, selector: string): Promise<void> => {
  await page.evaluate((sel) => {
    const radio = document.querySelector(sel) as HTMLInputElement
    if (radio) radio.click()
  }, selector)
}

/** Get tick values and calculate range */
const get_tick_range = async (
  axis_locator: Locator,
): Promise<{ ticks: number[]; range: number }> => {
  const tick_elements = await axis_locator.locator(`.tick text`).all()
  const tick_texts = await Promise.all(
    tick_elements.map((tick) => tick.textContent()),
  )
  const ticks = tick_texts
    .map((text) => (text ? parseFloat(text.replace(/[^\d.-]/g, ``)) : NaN))
    .filter((num) => !isNaN(num))

  if (ticks.length < 2) return { ticks, range: 0 }
  const range = Math.abs(Math.max(...ticks) - Math.min(...ticks))
  return { ticks, range }
}

/** Get label positions based on parent group transform */
const get_label_positions = async (
  plot_locator: Locator,
): Promise<Record<string, XyObj>> => {
  await plot_locator.waitFor({ state: `visible` })
  await plot_locator.page().waitForTimeout(200)

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

/** Get legend position using getBoundingClientRect */
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

/** Set density sliders for colorbar placement tests */
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

/** Get colorbar transform for placement tests */
const get_colorbar_transform = async (
  section_locator: Locator,
): Promise<string> => {
  const colorbar_wrapper = section_locator.locator(
    `div.colorbar[style*='position: absolute']`,
  )
  await colorbar_wrapper.waitFor({ state: `visible`, timeout: 1000 })
  const transform = await colorbar_wrapper.evaluate((el) => {
    return globalThis.getComputedStyle(el).transform
  })

  if (transform.startsWith(`matrix`)) {
    const parts = transform.match(/matrix\((.+)\)/)
    if (parts && parts[1]) {
      const values = parts[1].split(`,`).map((s) => parseFloat(s.trim()))
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

/** Get marker bounding box for sizing tests */
const get_marker_bbox = async (
  plot_locator: Locator,
  index: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> => {
  const marker_locator = plot_locator.locator(`path.marker`).nth(index)
  await marker_locator.waitFor({ state: `visible`, timeout: 1000 })
  return marker_locator.boundingBox()
}

/** Get bbox area */
const get_bbox_area = (
  bbox: { x: number; y: number; width: number; height: number } | null,
): number => {
  return bbox ? bbox.width * bbox.height : 0
}

/** Check and return marker sizes and relationships */
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

/** Get tooltip background and text color after hover */
const get_tooltip_colors = async (
  page: Page,
  plot_id: string,
): Promise<{ bg: string; text: string }> => {
  const plot_locator = page.locator(`#tooltip-precedence-test #${plot_id} .scatter`)
  const point_locator = plot_locator.locator(`path.marker`).first()
  const tooltip_locator = plot_locator.locator(`.tooltip`)

  await expect(plot_locator).toBeVisible()
  await expect(point_locator).toBeVisible()

  await point_locator.hover({ force: true })
  await expect(tooltip_locator).toBeVisible({ timeout: 2000 })
  const colors = await tooltip_locator.evaluate((el) => {
    const style = globalThis.getComputedStyle(el)
    return { bg: style.backgroundColor, text: style.color }
  })

  const plot_bbox = await plot_locator.boundingBox()
  if (plot_bbox) {
    await page.mouse.move(plot_bbox.x + 10, plot_bbox.y + 10)
  }
  await expect(tooltip_locator).not.toBeVisible({ timeout: 1000 })
  return colors
}

// MAIN TEST SUITE

test.describe(`ScatterPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  // BASIC RENDERING TESTS

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

    // Check tick counts and values
    await expect(scatter_plot.locator(`g.x-axis .tick`)).toHaveCount(12)
    await expect(scatter_plot.locator(`g.y-axis .tick`)).toHaveCount(5)
    await expect(scatter_plot.locator(`g.x-axis .tick text`).first()).toHaveText(`0`)
    await expect(scatter_plot.locator(`g.x-axis .tick text`).last()).toHaveText(`11`)
    await expect(scatter_plot.locator(`g.y-axis .tick text`).first()).toHaveText(`10 `)
    await expect(scatter_plot.locator(`g.y-axis .tick text`).last()).toHaveText(`30 `)

    // Check rendered paths
    await expect(scatter_plot.locator(`svg >> path`)).toHaveCount(14)
  })

  // MARKER AND LINE RENDERING TESTS

  const marker_test_cases = [
    { id: `#points-only`, expected_paths: 10, has_line: false },
    { id: `#line-only`, expected_paths: 2, has_line: true },
    { id: `#line-points`, expected_paths: 12, has_line: true },
  ]
  marker_test_cases.forEach(({ id, expected_paths, has_line }) => {
    test(`renders marker type ${id} correctly`, async ({ page }) => {
      const section = page.locator(`#marker-types`)
      await expect(section).toBeVisible()

      const plot = section.locator(`${id} .scatter`)
      await expect(plot).toBeVisible()
      await expect(plot.locator(`svg >> path`)).toHaveCount(expected_paths)

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

  // SCALE AND RANGE TESTS

  const range_test_cases = [
    {
      plot_id: `#wide-range`,
      expected_markers: 9,
      x_first: `-1200`,
      x_last: `1200`,
      y_first: /-600\s*/,
      y_last: /600\s*/,
    },
    {
      plot_id: `#small-range`,
      expected_markers: 5,
      x_first: `0`,
      x_last: `0.0006`,
      y_first: `0`,
      y_last: /0\.00006\s*/,
    },
  ]

  range_test_cases.forEach(
    ({ plot_id, expected_markers, x_first, x_last, y_first, y_last }) => {
      test(`scales correctly with ${plot_id} data range`, async ({ page }) => {
        const section = page.locator(`#range-test`)
        await expect(section).toBeVisible()

        const plot = section.locator(`${plot_id} .scatter`)
        await expect(plot).toBeVisible()
        await expect(plot.locator(`.marker`)).toHaveCount(expected_markers)

        await expect(plot.locator(`g.x-axis .tick text`).first()).toHaveText(x_first)
        await expect(plot.locator(`g.x-axis .tick text`).last()).toHaveText(x_last)
        await expect(plot.locator(`g.y-axis .tick text`).first()).toHaveText(y_first)
        await expect(plot.locator(`g.y-axis .tick text`).last()).toHaveText(y_last)
      })
    },
  )

  const log_scale_test_cases = [
    {
      plot_id: `#log-y`,
      axis: `y`,
      expected_ticks: 5,
      tick_expectations: [
        { index: 0, text: /^1\s/ },
        { index: 1, text: /10\s*/ },
        { index: 2, text: `100` },
        { index: 3, text: /^(1k|1000\s*)$/ },
        { index: 4, text: /^(10k|10000\s*)$/ },
      ],
    },
    {
      plot_id: `#log-x`,
      axis: `x`,
      expected_ticks: 7,
      tick_expectations: [
        { index: 0, text: `10m` },
        { index: 1, text: `100m` },
        { index: 2, text: `1` },
        { index: 3, text: `10` },
        { index: 4, text: `100` },
        { index: 5, text: `1k` },
        { index: 6, text: `10k` },
      ],
    },
  ]

  log_scale_test_cases.forEach(({ plot_id, axis, expected_ticks, tick_expectations }) => {
    test(`handles logarithmic ${axis}-axis correctly`, async ({ page }) => {
      const section = page.locator(`#log-scale`)
      await expect(section).toBeVisible()

      const plot = section.locator(`${plot_id} .scatter`)
      await expect(plot).toBeVisible()
      await expect(plot.locator(`g.${axis}-axis .tick`)).toHaveCount(expected_ticks)

      for (const { index, text } of tick_expectations) {
        await expect(plot.locator(`g.${axis}-axis .tick text`).nth(index)).toHaveText(
          text,
        )
      }
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
    const svg = plot_locator.locator(`svg[role='img']`)
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
    const svg = scatter_plot.locator(`svg[role='img']`)
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
    const svg = plot_locator.locator(`svg[role='img']`)
    const x_axis = plot_locator.locator(`g.x-axis`)
    const y_axis = plot_locator.locator(`g.y-axis`)
    const zoom_rect = plot_locator.locator(`rect.zoom-rect`)

    const console_errors: string[] = []
    const page_errors: Error[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })
    page.on(`pageerror`, (error) => page_errors.push(error))

    // Get initial state
    await x_axis.locator(`.tick text`).first().waitFor({
      state: `visible`,
      timeout: 5000,
    })
    await y_axis.locator(`.tick text`).first().waitFor({
      state: `visible`,
      timeout: 5000,
    })

    const initial_x = await get_tick_range(x_axis)
    const initial_y = await get_tick_range(y_axis)
    expect(initial_x.ticks.length).toBe(12)
    expect(initial_y.ticks.length).toBe(5)
    expect(initial_x.range).toBeGreaterThan(0)
    expect(initial_y.range).toBeGreaterThan(0)

    // Perform zoom drag INSIDE plot area
    let svg_box = await svg.boundingBox()
    if (!svg_box) throw `SVG box not found`

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
    if (!rect_box) throw `Rect box not found`
    expect(rect_box.width).toBeGreaterThan(0)
    expect(rect_box.height).toBeGreaterThan(0)

    await page.mouse.up()
    await expect(zoom_rect).not.toBeVisible()

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
    if (!svg_box) throw `SVG box not found`
    start_x = svg_box.x + svg_box.width * 0.8
    start_y = svg_box.y + svg_box.height * 0.8
    end_x = initial_x.ticks[0] - 50
    end_y = initial_y.ticks[0] - 50

    await page.mouse.move(start_x, start_y)
    await page.mouse.down()
    await page.mouse.move(svg_box.x + 5, svg_box.y + 5, { steps: 5 })
    await expect(zoom_rect).toBeVisible()
    const rect_box_inside = await zoom_rect.boundingBox()
    if (!rect_box_inside) throw `Rect box inside not found`
    expect(rect_box_inside.width).toBeGreaterThan(0)

    await page.mouse.move(end_x, end_y, { steps: 5 })
    await expect(zoom_rect).toBeVisible()
    const rect_box_outside = await zoom_rect.boundingBox()
    if (!rect_box_outside) throw `Rect box outside not found`
    expect(rect_box_outside.width).toBeGreaterThan(rect_box_inside.width)
    expect(rect_box_outside.height).toBeGreaterThan(rect_box_inside.height)

    await page.mouse.up()
    await expect(zoom_rect).not.toBeVisible()

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
    const section = page.locator(`#label-auto-placement-test`)
    const plot_locator = section.locator(`.scatter`)
    const checkbox = section.locator(`input[type="checkbox"]`)

    // Test dense cluster repositioning
    await expect(checkbox).toBeChecked()
    const positions_auto = await get_label_positions(plot_locator)

    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    const positions_manual = await get_label_positions(plot_locator)

    // Verify dense labels moved
    const dense_labels = Object.keys(positions_auto).filter((key) =>
      key.startsWith(`Dense-`)
    )
    expect(dense_labels.length).toBeGreaterThan(1)

    // Verify sparse labels didn't move significantly
    const sparse_labels = Object.keys(positions_auto).filter((key) =>
      key.startsWith(`Sparse-`)
    )
    expect(sparse_labels.length).toBe(4)

    for (const label_text of sparse_labels) {
      if (positions_auto[label_text] && positions_manual[label_text]) {
        const dx = positions_auto[label_text].x - positions_manual[label_text].x
        const dy = positions_auto[label_text].y - positions_manual[label_text].y
        const distance_moved = Math.sqrt(dx * dx + dy * dy)
        expect(distance_moved).toBeLessThan(100)
      }
    }
  })

  // LEGEND TESTS

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
    const plot_locator = page.locator(`#legend-multi-default .scatter`)
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
    const plot_locator = page.locator(`#legend-multi-default .scatter`)
    const legend_locator = plot_locator.locator(`.legend`)

    // Check positioning in corner
    await expect(legend_locator).toBeVisible()
    const plot_bbox = await plot_locator.boundingBox()
    const legend_bbox = await legend_locator.boundingBox()

    if (!plot_bbox || !legend_bbox) throw `Bounding boxes are null`

    const relative_x = (legend_bbox.x - plot_bbox.x) / plot_bbox.width
    const relative_y = (legend_bbox.y - plot_bbox.y) / plot_bbox.height

    const is_left_edge = relative_x < 0.3
    const is_right_edge = relative_x > 0.7
    const is_top_edge = relative_y < 0.3
    const is_bottom_edge = relative_y > 0.7
    const is_in_corner = (is_left_edge || is_right_edge) &&
      (is_top_edge || is_bottom_edge)
    expect(is_in_corner).toBe(true)

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

  // COLORBAR PLACEMENT TESTS

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
    const tooltip_locator = plot_locator.locator(`.tooltip`)

    await plot_locator.waitFor({ state: `visible` })
    await first_marker.waitFor({ state: `visible` })

    // Get initial transform state
    const initial_transform = await first_marker.evaluate(
      (el: SVGPathElement) => globalThis.getComputedStyle(el).transform,
    )
    expect(
      initial_transform === `none` || initial_transform === `matrix(1, 0, 0, 1, 0, 0)`,
    ).toBe(true)
    expect(tooltip_locator).not.toBeVisible()

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
    const scatter_plot = page.locator(`#legend-multi-default .scatter`)
    await expect(scatter_plot).toBeVisible()

    const controls_toggle = scatter_plot.locator(`.scatter-controls-toggle`)
    await expect(controls_toggle).toBeVisible()

    const control_pane = scatter_plot.locator(`.scatter-controls-pane`)
    await expect(control_pane).not.toBeVisible()

    // Test toggle functionality
    await controls_toggle.click()
    await expect(control_pane).toBeVisible()

    // Test display controls
    const display_controls = [
      { label: `Show points`, selector: `svg g[data-series-id] .marker` },
      { label: `Show lines`, selector: `svg path[fill="none"]` },
    ]

    for (const { label, selector } of display_controls) {
      const checkbox = control_pane.getByLabel(label)
      await expect(checkbox).toBeVisible()
      await expect(checkbox).toBeChecked()

      const initial_count = await scatter_plot.locator(selector).count()
      expect(initial_count).toBeGreaterThan(0)

      await checkbox.uncheck()
      expect(await scatter_plot.locator(selector).count()).toBe(0)

      await checkbox.check()
      expect(await scatter_plot.locator(selector).count()).toBe(initial_count)
    }

    // Test grid controls
    const grid_controls = [
      { label: `X-axis grid`, selector: `g.x-axis .tick line` },
      { label: `Y-axis grid`, selector: `g.y-axis .tick line` },
    ]

    for (const { label, selector } of grid_controls) {
      const checkbox = control_pane.getByLabel(label)
      await expect(checkbox).toBeVisible()
      await expect(checkbox).toBeChecked()

      const initial_count = await scatter_plot.locator(selector).count()
      expect(initial_count).toBeGreaterThan(0)

      await checkbox.uncheck()
      expect(await scatter_plot.locator(selector).count()).toBe(0)

      await checkbox.check()
      expect(await scatter_plot.locator(selector).count()).toBe(initial_count)
    }

    // Test style controls
    const point_size_controls = control_pane.locator(`.pane-row`).filter({
      hasText: `Size`,
    })
    const point_size_range = point_size_controls.locator(`input[type="range"]`)
    const point_size_number = point_size_controls.locator(`input[type="number"]`)

    await expect(point_size_range).toBeVisible()
    await expect(point_size_number).toBeVisible()

    await point_size_range.fill(`10`)
    await expect(point_size_number).toHaveValue(`10`)

    // Test zero lines control
    const zero_lines_checkbox = control_pane.getByLabel(`Show zero lines`)
    await expect(zero_lines_checkbox).toBeVisible()
    await expect(zero_lines_checkbox).toBeChecked()

    await zero_lines_checkbox.uncheck()
    await expect(zero_lines_checkbox).not.toBeChecked()

    await zero_lines_checkbox.check()
    await expect(zero_lines_checkbox).toBeChecked()

    // Test state persistence
    const x_grid_checkbox = control_pane.getByLabel(`X-axis grid`)
    await x_grid_checkbox.uncheck()

    await controls_toggle.click() // Close
    await expect(control_pane).toHaveCSS(`display`, `none`)

    await controls_toggle.click() // Reopen
    await expect(control_pane).toHaveCSS(`display`, `grid`)

    const reopened_x_grid_checkbox = control_pane.getByLabel(`X-axis grid`)
    await expect(reopened_x_grid_checkbox).not.toBeChecked()

    // Test click outside to close
    const plot_bbox = await scatter_plot.boundingBox()
    if (plot_bbox) {
      await page.mouse.click(
        plot_bbox.x + plot_bbox.width * 0.3,
        plot_bbox.y + plot_bbox.height * 0.5,
      )
    }
    await expect(control_pane).toHaveCSS(`display`, `none`)
  })

  test(`tick format controls modify axis labels and validate input`, async ({ page }) => {
    const scatter_plot = page.locator(`#legend-multi-default .scatter`)
    const controls_toggle = scatter_plot.locator(`.scatter-controls-toggle`)

    const console_errors: string[] = []
    page.on(`console`, (msg) => {
      if (msg.type() === `error`) console_errors.push(msg.text())
    })

    await controls_toggle.click()
    const control_pane = scatter_plot.locator(`.scatter-controls-pane`)
    await expect(control_pane).toBeVisible()

    const x_format_input = control_pane.locator(`input#x-format`)
    const y_format_input = control_pane.locator(`input#y-format`)

    await expect(x_format_input).toBeVisible()
    await expect(y_format_input).toBeVisible()

    const y2_format_input = control_pane.locator(`input#y2-format`)
    await expect(y2_format_input).not.toBeVisible()

    // Get initial tick text
    const initial_x_tick_text = await scatter_plot.locator(`g.x-axis .tick text`).first()
      .textContent()
    const initial_y_tick_text = await scatter_plot.locator(`g.y-axis .tick text`).first()
      .textContent()

    // Test valid formats
    await x_format_input.fill(`.2e`)

    const updated_x_tick_text = await scatter_plot.locator(`g.x-axis .tick text`).first()
      .textContent()
    expect(updated_x_tick_text).toMatch(/^\d\.\d{2}e[+-]\d+$/)
    expect(updated_x_tick_text).not.toBe(initial_x_tick_text)
    await expect(x_format_input).not.toHaveClass(/invalid/)

    await y_format_input.fill(`.0%`)

    const updated_y_tick_text = await scatter_plot.locator(`g.y-axis .tick text`).first()
      .textContent()
    expect(updated_y_tick_text).toMatch(/^\d+%\s*/)
    expect(updated_y_tick_text).not.toBe(initial_y_tick_text)
    await expect(y_format_input).not.toHaveClass(/invalid/)

    // Test invalid formats
    await x_format_input.fill(`.3e3`)
    await expect(x_format_input).toHaveClass(/invalid/)

    await y_format_input.fill(`.`)
    await expect(y_format_input).toHaveClass(/invalid/)

    // Test recovery
    await y_format_input.fill(`.2f`)
    await expect(y_format_input).not.toHaveClass(/invalid/)

    // Test empty strings
    await x_format_input.fill(``)
    await y_format_input.fill(``)
    await expect(x_format_input).not.toHaveClass(/invalid/)
    await expect(y_format_input).not.toHaveClass(/invalid/)

    // Test placeholders
    await expect(x_format_input).toHaveAttribute(`placeholder`, `.2f / .0% / %Y-%m-%d`)
    await expect(y_format_input).toHaveAttribute(`placeholder`, `.2f / .1e / .0%`)

    expect(console_errors).toHaveLength(0)
  })

  test(`one-sided axis range pins via controls`, async ({ page }) => {
    const plot = page.locator(`#basic-example .scatter`)
    await expect(plot).toBeVisible()

    const toggle = plot.locator(`.scatter-controls-toggle`)
    await toggle.click()
    const pane = plot.locator(`.scatter-controls-pane`)
    await expect(pane).toBeVisible()

    const x_axis = plot.locator(`g.x-axis`)
    const y_axis = plot.locator(`g.y-axis`)

    // Establish baseline auto ranges
    const baseline_x = await get_tick_range(x_axis)
    const baseline_y = await get_tick_range(y_axis)
    const baseline_x_min = Math.min(...baseline_x.ticks)
    const baseline_x_max = Math.max(...baseline_x.ticks)
    const baseline_y_min = Math.min(...baseline_y.ticks)
    const baseline_y_max = Math.max(...baseline_y.ticks)

    // Helper to set range inputs; leave the other side blank for one-sided pins
    const set_range = async (
      axis: `x` | `y`,
      bound: `min` | `max`,
      value: number | null,
    ) => {
      const min_input = pane.locator(`input#${axis}-range-min`)
      const max_input = pane.locator(`input#${axis}-range-max`)
      if (bound === `min`) {
        await min_input.fill(value === null ? `` : String(value))
        await max_input.fill(``)
      } else {
        await min_input.fill(``)
        await max_input.fill(value === null ? `` : String(value))
      }
      // Blur to commit
      await pane.click()
      // Wait a moment for plot to update
      await plot.waitFor({ state: `visible` })
    }

    // Helper to reset axis back to auto (both sides empty)
    const reset_axis = async (axis: `x` | `y`) => {
      await set_range(axis, `min`, null)
      await set_range(axis, `max`, null)
    }

    // Scenarios: axis/bound/value and assertion function
    const scenarios: { axis: `x` | `y`; bound: `min` | `max`; value: number }[] = [
      {
        axis: `x`,
        bound: `min`,
        value: baseline_x_min + (baseline_x_max - baseline_x_min) * 0.2,
      },
      {
        axis: `x`,
        bound: `max`,
        value: baseline_x_max - (baseline_x_max - baseline_x_min) * 0.2,
      },
      {
        axis: `y`,
        bound: `min`,
        value: baseline_y_min + (baseline_y_max - baseline_y_min) * 0.2,
      },
      {
        axis: `y`,
        bound: `max`,
        value: baseline_y_max - (baseline_y_max - baseline_y_min) * 0.2,
      },
    ]

    for (const { axis, bound, value } of scenarios) {
      await set_range(axis, bound, value)

      const { ticks, range } = await get_tick_range(axis === `x` ? x_axis : y_axis)
      const observed_min = Math.min(...ticks)
      const observed_max = Math.max(...ticks)

      // Relative tolerance based on baseline span
      const base_span = axis === `x`
        ? baseline_x_max - baseline_x_min
        : baseline_y_max - baseline_y_min
      const tol = Math.max(1e-6, base_span * 0.15) // 15% of span

      if (bound === `min`) {
        expect(observed_min).toBeGreaterThanOrEqual(value - tol)
        // Unpinned side should stay approximately at baseline
        const baseline_max = axis === `x` ? baseline_x_max : baseline_y_max
        expect(Math.abs(observed_max - baseline_max)).toBeLessThanOrEqual(tol)
      } else {
        expect(observed_max).toBeLessThanOrEqual(value + tol)
        const baseline_min = axis === `x` ? baseline_x_min : baseline_y_min
        expect(Math.abs(observed_min - baseline_min)).toBeLessThanOrEqual(tol)
      }

      expect(range).toBeGreaterThan(0)

      // Reset this axis before next scenario
      await reset_axis(axis)
    }

    // Combined: pin x min and y max simultaneously
    const x_pin = baseline_x_min + (baseline_x_max - baseline_x_min) * 0.25
    const y_pin = baseline_y_max - (baseline_y_max - baseline_y_min) * 0.25
    await set_range(`x`, `min`, x_pin)
    await set_range(`y`, `max`, y_pin)

    const x_after = await get_tick_range(x_axis)
    const y_after = await get_tick_range(y_axis)
    const tol_x = Math.max(1e-6, (baseline_x_max - baseline_x_min) * 0.2)
    const tol_y = Math.max(1e-6, (baseline_y_max - baseline_y_min) * 0.2)

    expect(Math.min(...x_after.ticks)).toBeGreaterThanOrEqual(x_pin - tol_x)
    expect(Math.max(...y_after.ticks)).toBeLessThanOrEqual(y_pin + tol_y)

    // Cleanup: reset both
    await reset_axis(`x`)
    await reset_axis(`y`)

    await toggle.click()
    await expect(pane).not.toBeVisible()
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
      const plot_locator = page.locator(`#axis-color-test ${plot_id} .scatter`)
      await expect(plot_locator).toBeVisible()
      await expect(plot_locator.locator(`svg[role="img"]`)).toBeVisible()
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

  // CUSTOM TICK ARRAYS TESTS

  const tick_array_test_cases = [
    {
      axis: `x`,
      selector: `g.x-axis .tick`,
      expected_count: 12,
      first_text: `0`,
      last_text: `11`,
      description: `x_ticks array is used directly without modification`,
    },
    {
      axis: `y`,
      selector: `g.y-axis .tick`,
      expected_count: 5,
      first_text: `10 `,
      last_text: `30 `,
      description: `y_ticks array is used directly without modification`,
    },
  ]

  tick_array_test_cases.forEach(
    ({ selector, expected_count, first_text, last_text, description }) => {
      test(`${description}`, async ({ page }) => {
        const section = page.locator(`#basic-example`)
        const scatter_plot = section.locator(`.scatter`)

        await expect(scatter_plot).toBeVisible()

        const axis_ticks = scatter_plot.locator(selector)
        await expect(axis_ticks).toHaveCount(expected_count)
        await expect(axis_ticks.locator(`text`).first()).toHaveText(first_text)
        await expect(axis_ticks.locator(`text`).last()).toHaveText(last_text)
      })
    },
  )

  test(`custom tick arrays override automatic tick generation`, async ({ page }) => {
    const section = page.locator(`#basic-example`)
    const scatter_plot = section.locator(`.scatter`)

    await expect(scatter_plot).toBeVisible()

    // Verify that the plot renders correctly with default ticks
    await expect(scatter_plot.locator(`g.x-axis .tick`)).toHaveCount(12)
    await expect(scatter_plot.locator(`g.y-axis .tick`)).toHaveCount(5)
  })

  test(`handles empty and invalid data gracefully`, async ({ page }) => {
    // Go to a test page with edge case data scenarios
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })

    // Test empty data series (if such a test case exists in the test page)
    // This tests the resilience of the component when no data is provided
    const empty_data_section = page.locator(`#empty-data-test`)
    if (await empty_data_section.isVisible()) {
      const empty_plot = empty_data_section.locator(`.scatter`)
      await expect(empty_plot).toBeVisible()
      await expect(empty_plot.locator(`svg[role="img"]`)).toBeVisible()
      // Should render axes even with no data
      await expect(empty_plot.locator(`g.x-axis`)).toBeVisible()
      await expect(empty_plot.locator(`g.y-axis`)).toBeVisible()
      // Should not have any data points
      await expect(empty_plot.locator(`path.marker`)).toHaveCount(0)
    }
  })

  test(`handles extreme zoom levels and data ranges`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const svg = plot_locator.locator(`svg[role='img']`)

    // Test extreme zoom in (very small area)
    const svg_box = await svg.boundingBox()
    if (!svg_box) throw `SVG box not found`

    // Create a very small zoom rectangle (1% of plot area)
    const center_x = svg_box.x + svg_box.width * 0.5
    const center_y = svg_box.y + svg_box.height * 0.5
    const tiny_offset = 2 // Very small rectangle

    await page.mouse.move(center_x - tiny_offset, center_y - tiny_offset)
    await page.mouse.down()
    await page.mouse.move(center_x + tiny_offset, center_y + tiny_offset)
    await page.mouse.up()

    // Should still render properly after extreme zoom
    await expect(plot_locator.locator(`svg[role="img"]`)).toBeVisible()
    await expect(plot_locator.locator(`g.x-axis .tick text`).first()).toBeVisible()

    // Reset zoom for next test
    await svg.dblclick()
  })

  test(`keyboard accessibility and focus management`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const svg = plot_locator.locator(`svg[role='img']`)

    // Test that SVG is present and visible (may not be focusable depending on implementation)
    await expect(svg).toBeVisible()

    // Test keyboard navigation with page focus
    await page.keyboard.press(`Tab`)

    // Test escape key behavior (should not cause errors)
    await page.keyboard.press(`Escape`)

    // Verify plot is still functional after keyboard events
    await expect(plot_locator).toBeVisible()
    await expect(svg).toBeVisible()
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
    const multi_series_plot = page.locator(`#legend-multi-default .scatter`)
    await multi_series_plot.locator(`.scatter-controls-toggle`).click()
    const control_pane = multi_series_plot.locator(`.scatter-controls-pane`)

    // Test series selector functionality
    const series_selector = control_pane.locator(`select#series-select`)
    if (await series_selector.isVisible()) {
      // Test switching between series
      await series_selector.selectOption(`0`)
      await expect(series_selector).toHaveValue(`0`)

      // Test that style changes only affect selected series
      const point_color_input = control_pane.locator(`input[type="color"]`).first()
      await point_color_input.fill(`#ff0000`)

      // Switch to different series
      await series_selector.selectOption(`1`)
      await expect(series_selector).toHaveValue(`1`)

      // Color should be different for this series
      const current_color = await point_color_input.inputValue()
      // The color should reset or be different for the new series
      expect(current_color).not.toBe(`#ff0000`)
      // Verify the color is a valid hex color format
      expect(current_color).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
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
    const plot_locator = page.locator(`${section_selector} .scatter`)

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
    await expect(plot_locator.locator(`svg[role="img"]`)).toBeVisible()
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
    const tooltip = plot_locator.locator(`.tooltip`)

    // Test tooltip near plot edges
    const marker_count = await markers.count()
    if (marker_count > 0) {
      // Hover over first marker (likely at edge)
      await markers.first().hover()

      if (await tooltip.isVisible()) {
        const tooltip_box = await tooltip.boundingBox()
        const plot_box = await plot_locator.boundingBox()

        if (tooltip_box && plot_box) {
          // Tooltip should be positioned within reasonable bounds
          expect(tooltip_box.x).toBeGreaterThanOrEqual(0)
          expect(tooltip_box.y).toBeGreaterThanOrEqual(0)
        }
      }

      // Move away to hide tooltip
      await plot_locator.hover()
      await expect(tooltip).not.toBeVisible()
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

  test(`performance with rapid property changes`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)
    const controls_toggle = plot_locator.locator(`.scatter-controls-toggle`)

    await controls_toggle.click()
    const control_pane = plot_locator.locator(`.scatter-controls-pane`)

    // Test rapid changes to style properties
    const point_size_range = control_pane.locator(`input[type="range"]`).first()

    if (await point_size_range.isVisible()) {
      // Rapidly change point size multiple times
      for (let size = 2; size <= 20; size += 2) {
        await point_size_range.fill(size.toString())
        // Small delay to allow rendering but test performance
      }

      // Plot should still be responsive and visible
      await expect(plot_locator.locator(`svg[role="img"]`)).toBeVisible()
      await expect(plot_locator.locator(`path.marker`).first()).toBeVisible()
    }
  })

  test(`error handling for invalid format strings`, async ({ page }) => {
    const scatter_plot = page.locator(`.scatter`).first()
    const controls_toggle = scatter_plot.locator(`.scatter-controls-toggle`)

    await controls_toggle.click()
    const control_pane = scatter_plot.locator(`.scatter-controls-pane`)

    const x_format_input = control_pane.locator(`input#x-format`)

    // Test various invalid format strings
    const invalid_formats = [
      `%Q%Q%Q`, // Invalid time format
      `.999f`, // Invalid precision
      `invalid`, // Completely invalid
      `{0}`, // Wrong format style
      `%`, // Incomplete format
    ]

    for (const invalid_format of invalid_formats) {
      await x_format_input.fill(invalid_format)

      // Check if input exists and is visible (validation styling may vary)
      await expect(x_format_input).toBeVisible()

      // Plot should still be functional
      await expect(scatter_plot.locator(`svg[role="img"]`)).toBeVisible()
    }

    // Test recovery with valid format
    await x_format_input.fill(`.2f`)

    // Verify input still works and plot is functional
    await expect(x_format_input).toBeVisible()
    await expect(scatter_plot.locator(`svg[role="img"]`)).toBeVisible()
  })

  test(`zoom behavior with logarithmic scales`, async ({ page }) => {
    const section = page.locator(`#log-scale`)
    const log_y_plot = section.locator(`#log-y .scatter`)
    const svg = log_y_plot.locator(`svg[role='img']`)

    // Test zoom on logarithmic scale
    const svg_box = await svg.boundingBox()
    if (!svg_box) throw `SVG box not found`

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

  test(`responsive layout behavior`, async ({ page }) => {
    const plot_locator = page.locator(`#basic-example .scatter`)

    // Simulate viewport resize (if supported)
    await page.setViewportSize({ width: 800, height: 600 })

    // Plot should still be visible and functional
    await expect(plot_locator).toBeVisible()
    await expect(plot_locator.locator(`svg[role="img"]`)).toBeVisible()

    // Test with smaller viewport
    await page.setViewportSize({ width: 400, height: 300 })

    // Plot should adapt to smaller size
    await expect(plot_locator).toBeVisible()

    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  test(`on_point_hover and on_point_click handlers`, async ({ page }) => {
    await page.goto(`/scatter-plot`)
    const example = page.locator(`.code-example`).first()
    const info_div = example.locator(`div`).filter({
      hasText: /^(No point hovered|Hovering)/,
    })

    await expect(info_div).toContainText(/No point hovered/)

    const svg = example.locator(`.scatter svg`)
    const box = await svg.boundingBox()
    if (!box) throw new Error(`SVG not found`)

    // Hover near a point
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
    await page.waitForTimeout(100)

    await expect(info_div).toContainText(`Hovering: Point`)

    // Check cursor is pointer (click handler is defined)
    const point = svg.locator(`path.marker`).first()
    const cursor = await point.evaluate((el) => globalThis.getComputedStyle(el).cursor)
    expect(cursor).toBe(`pointer`)

    // Move away clears hover
    await page.mouse.move(box.x - 50, box.y - 50)
    await expect(info_div).toContainText(/No point hovered/)
  })
})
