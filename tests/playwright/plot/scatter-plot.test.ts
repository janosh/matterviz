import { rects_overlap } from '$lib/plot/core/layout'
import { expect, type Locator, type Page, test } from '@playwright/test'
import {
  collect_console_errors,
  collect_page_errors,
  expect_shift_drag_pans,
  expect_zoom_shrinks_axes,
  get_chart_svg,
  get_tick_range,
  measure_plot_area,
  open_plot_controls,
  set_input_value,
  wait_for_stable_bbox,
} from '../helpers'

// Check if array values are in ascending order (empty arrays are vacuously ascending)
const is_ascending = (arr: number[]): boolean =>
  arr.every((val, idx) => idx === 0 || val >= arr[idx - 1])

// Set the four quadrant density sliders of the colorbar placement fixture
const set_density = async (
  section: Locator,
  densities: { tl: number; tr: number; bl: number; br: number },
): Promise<void> => {
  for (const [label_text, value] of [
    [`Top Left`, densities.tl],
    [`Top Right`, densities.tr],
    [`Bottom Left`, densities.bl],
    [`Bottom Right`, densities.br],
  ] as const) {
    await set_input_value(section.locator(`label:has-text('${label_text}') input`), `${value}`)
  }
}

// Which plot quadrant the colorbar's center lies in
const get_colorbar_quadrant = async (section: Locator): Promise<string> => {
  const plot_bbox = await section.locator(`.scatter`).boundingBox()
  const colorbar_bbox = await section.locator(`.colorbar`).boundingBox()
  if (!plot_bbox || !colorbar_bbox) return `unknown`
  const is_left = colorbar_bbox.x + colorbar_bbox.width / 2 < plot_bbox.x + plot_bbox.width / 2
  const is_top =
    colorbar_bbox.y + colorbar_bbox.height / 2 < plot_bbox.y + plot_bbox.height / 2
  return `${is_top ? `top` : `bottom`}-${is_left ? `left` : `right`}`
}

const bbox_area = async (locator: Locator): Promise<number> => {
  const bbox = await locator.boundingBox()
  return bbox ? bbox.width * bbox.height : 0
}

const get_svg_rect = (rect: Locator) =>
  rect.evaluate((el) => ({
    x: Number(el.getAttribute(`x`)),
    y: Number(el.getAttribute(`y`)),
    width: Number(el.getAttribute(`width`)),
    height: Number(el.getAttribute(`height`)),
  }))

// Hover a marker to show its tooltip. The SVG's onmouseenter must set hovered=true before
// onmousemove can pick the closest point, so enter the SVG first, then move to the marker.
const hover_to_show_tooltip = async (
  page: Page,
  plot: Locator,
  marker: Locator,
): Promise<Locator> => {
  const svg = get_chart_svg(plot)
  const tooltip = plot.locator(`.plot-tooltip`)
  await expect(async () => {
    const svg_bbox = await svg.boundingBox()
    const marker_bbox = await marker.boundingBox()
    if (!svg_bbox || !marker_bbox) throw new Error(`Bounding boxes not available`)
    await page.mouse.move(svg_bbox.x + 10, svg_bbox.y + 10)
    await page.mouse.move(
      marker_bbox.x + marker_bbox.width / 2,
      marker_bbox.y + marker_bbox.height / 2,
    )
    await expect(tooltip).toBeVisible()
  }).toPass({ timeout: 2000 })
  return tooltip
}

const legend_item = (plot: Locator, label: string) =>
  plot.locator(`.legend-item >> text=${label}`).locator(`..`)

test.describe(`ScatterPlot Component Tests`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
  })

  test(`renders basic scatter plot with correct axis labels and ticks`, async ({ page }) => {
    const scatter_plot = page.locator(`#basic-example .scatter`)
    await expect(scatter_plot.locator(`.axis-label.x-label`)).toHaveText(`X Axis`)
    await expect(scatter_plot.locator(`.axis-label.y-label`)).toHaveText(`Y Axis`)
    await expect(scatter_plot.locator(`path.marker`)).toHaveCount(10)

    for (const axis of [`x`, `y`] as const) {
      const axis_ticks = scatter_plot.locator(`g.${axis}-axis .tick`)
      const tick_count = await axis_ticks.count()
      expect(tick_count).toBeGreaterThanOrEqual(4)
      expect(tick_count).toBeLessThanOrEqual(15)
      const values = (await axis_ticks.locator(`text`).allTextContents())
        .map(Number)
        .filter((val) => !isNaN(val))
      expect(values.length).toBeGreaterThan(0)
      expect(is_ascending(values)).toBe(true)
      await expect(axis_ticks.locator(`text`).first()).toBeVisible()
      await expect(axis_ticks.locator(`text`).last()).toBeVisible()
    }
  })

  test(`auto renderer paints dense markers to a real canvas`, async ({ page }) => {
    const plot = page.locator(`#canvas-auto-renderer .scatter`)
    const canvas = plot.locator(`canvas.marker-canvas`)
    await plot.scrollIntoViewIfNeeded()
    await expect(canvas).toBeVisible()
    await expect(plot.locator(`path.marker`)).toHaveCount(0)
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const canvas_element = element as HTMLCanvasElement
          const context = canvas_element.getContext(`2d`)
          if (!context) return false
          const { data } = context.getImageData(
            0,
            0,
            canvas_element.width,
            canvas_element.height,
          )
          for (let alpha_idx = 3; alpha_idx < data.length; alpha_idx += 4) {
            if (data[alpha_idx] > 0) return true
          }
          return false
        }),
      )
      .toBe(true)
  })

  test(`marginals align with plot area, portal tooltips, recompute on zoom, and do not start zoom drags`, async ({
    page,
  }) => {
    const plot = page.locator(`#marginals-browser-regression .scatter`)
    const svg = get_chart_svg(plot)
    const top_strip = plot.locator(`.marginal-top`)
    const top_hit = plot.locator(`.marginal-hit-top`)
    const right_hit = plot.locator(`.marginal-hit-right`)
    // The chart area's own clip. Marginal strips derive theirs from the same id plus a
    // `-<side>` suffix, so exclude those to keep this matching a single rect.
    const plot_clip = svg.locator(
      `clipPath[id^="plot-area-clip-"]:not([id$="-top"]):not([id$="-right"]):not([id$="-bottom"]):not([id$="-left"]) rect`,
    )
    const zoom_rect = plot.locator(`rect.zoom-rect`)
    const x_axis = plot.locator(`g.x-axis`)
    const y_axis = plot.locator(`g.y-axis`)

    await plot.scrollIntoViewIfNeeded()
    await expect(top_strip.locator(`path[fill="none"]`)).toBeVisible()
    await expect(plot.locator(`.marginal-right rect`)).not.toHaveCount(0)
    await expect(plot.locator(`.marginal-axis-top .marginal-axis-title`)).toHaveText(
      `x density`,
    )

    // strips align with the plot area: top spans its width and sits above it,
    // right spans its height and sits to the right of it
    const [clip, top, right] = await Promise.all([
      get_svg_rect(plot_clip),
      get_svg_rect(top_hit),
      get_svg_rect(right_hit),
    ])
    expect(top.x).toBeCloseTo(clip.x, 1)
    expect(top.width).toBeCloseTo(clip.width, 1)
    expect(top.y + top.height).toBeLessThan(clip.y)
    expect(right.y).toBeCloseTo(clip.y, 1)
    expect(right.height).toBeCloseTo(clip.height, 1)
    expect(right.x).toBeGreaterThan(clip.x + clip.width)

    const top_hit_box = await top_hit.boundingBox()
    if (!top_hit_box) throw new Error(`top marginal hit box missing`)
    await page.mouse.move(
      top_hit_box.x + top_hit_box.width * 0.55,
      top_hit_box.y + top_hit_box.height * 0.45,
    )
    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`Energy`)
    await expect(tooltip).toContainText(`x density`)
    await expect.poll(() => tooltip.evaluate((el) => el.closest(`svg`) === null)).toBe(true)

    // a drag starting on the marginal hit area must not begin a zoom selection
    const before_drag = await get_tick_range(x_axis)
    await page.mouse.down()
    await page.mouse.move(top_hit_box.x + top_hit_box.width * 0.8, top_hit_box.y + 8)
    await expect(zoom_rect).toBeHidden()
    await page.mouse.up()
    await expect(zoom_rect).toBeHidden()
    expect(await get_tick_range(x_axis)).toEqual(before_drag)

    // zooming the host plot shrinks both axes and recomputes the top KDE
    const svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`scatter svg box missing`)
    const initial_x = await get_tick_range(x_axis)
    const initial_y = await get_tick_range(y_axis)
    const top_kde_before = await top_strip.locator(`path[fill="none"]`).getAttribute(`d`)

    await page.mouse.move(
      svg_box.x + clip.x + clip.width * 0.25,
      svg_box.y + clip.y + clip.height * 0.75,
    )
    await page.mouse.down()
    await page.mouse.move(
      svg_box.x + clip.x + clip.width * 0.65,
      svg_box.y + clip.y + clip.height * 0.35,
      { steps: 8 },
    )
    await expect(zoom_rect).toBeVisible()
    await page.mouse.up()
    await expect(zoom_rect).toBeHidden()

    await expect(async () => {
      const zoomed_x = await get_tick_range(x_axis)
      const zoomed_y = await get_tick_range(y_axis)
      const top_kde_after = await top_strip.locator(`path[fill="none"]`).getAttribute(`d`)
      expect(zoomed_x.range).toBeGreaterThan(0)
      expect(zoomed_y.range).toBeGreaterThan(0)
      expect(zoomed_x.range).toBeLessThan(initial_x.range)
      expect(zoomed_y.range).toBeLessThan(initial_y.range)
      expect(top_kde_after).not.toBe(top_kde_before)
    }).toPass({ timeout: 2000 })
  })

  test(`size_values scale markers, radius_range and log size scale reshape them`, async ({
    page,
  }) => {
    // Regression: size_values used to be ignored alongside per-point styling arrays
    const section = page.locator(`#point-sizing-spiral-test`)
    const markers = section.locator(`.scatter .marker`)
    await expect(markers.first()).toBeVisible()
    const marker_count = await markers.count()
    expect(marker_count).toBeGreaterThanOrEqual(3)
    const mid_idx = Math.floor(marker_count / 2)
    const last_idx = marker_count - 1

    // spiral radius grows with index, so do the markers
    let area_last = 0
    await expect(async () => {
      const area_0 = await bbox_area(markers.nth(0))
      const area_mid = await bbox_area(markers.nth(mid_idx))
      area_last = await bbox_area(markers.nth(last_idx))
      expect(area_0).toBeGreaterThan(0)
      expect(area_mid).toBeGreaterThan(area_0 * 0.9)
      expect(area_last).toBeGreaterThan(area_mid * 0.9)
      expect(area_last / area_0).toBeGreaterThan(2.5)
    }).toPass()

    // a larger radius_range max enlarges the biggest marker
    const max_size_input = section.locator(`input[aria-label="Max Size (px)"]`)
    await max_size_input.fill(`50`)
    await expect.poll(() => bbox_area(markers.nth(last_idx))).toBeGreaterThan(area_last * 1.2)

    // log size scale compresses the range: the biggest marker shrinks relative to linear
    await max_size_input.fill(`25`)
    let linear_area = 0
    await expect
      .poll(async () => (linear_area = await bbox_area(markers.nth(last_idx))))
      .toBeGreaterThan(0)
    await section.locator(`select[aria-label="Size Scale"]`).selectOption(`log`)
    await expect(async () => {
      const log_area = await bbox_area(markers.nth(last_idx))
      expect(log_area).toBeGreaterThan(linear_area * 0.3)
      expect(log_area).toBeLessThan(linear_area * 1.1)
    }).toPass()
  })

  test(`linear/log scale switches keep markers and colorbar without errors`, async ({
    page,
  }) => {
    const console_errors = collect_console_errors(page)
    const page_errors = collect_page_errors(page)

    // color scale toggle: markers and colorbar survive both modes
    const color_section = page.locator(`#color-scale`)
    const color_plot = color_section.locator(`#color-scale-toggle .scatter`)
    await expect(color_section.locator(`input[value="linear"]`)).toBeChecked()
    for (const mode of [`log`, `linear`]) {
      await color_section.locator(`input[value="${mode}"]`).click()
      await expect(color_section.locator(`input[value="${mode}"]`)).toBeChecked()
      await expect(color_plot.locator(`.marker`)).toHaveCount(10)
      await expect(color_plot.locator(`.colorbar`)).toBeVisible()
    }

    // y-axis scale transition with values near zero used to NaN during tweening
    const transition_section = page.locator(`#lin-log-transition`)
    const transition_plot = transition_section.locator(`.scatter`)
    for (const mode of [`log`, `linear`]) {
      await transition_section.locator(`input[value="${mode}"]`).click()
      await expect(transition_section.locator(`input[value="${mode}"]`)).toBeChecked()
      await expect(transition_plot.locator(`g.y-axis .tick`).first()).toBeVisible()
      await expect(transition_plot.locator(`.marker`).first()).toBeVisible()
    }

    expect(page_errors).toHaveLength(0)
    expect(console_errors).toHaveLength(0)
  })

  // INTERACTION TESTS

  test(`bind:hovered prop reflects hover state`, async ({ page }) => {
    const svg = get_chart_svg(page.locator(`#bind-hovered .scatter`))
    const hover_status = page.locator(`#hover-status`)
    await expect(hover_status).toHaveText(`false`)
    await svg.hover()
    await expect(hover_status).toHaveText(`true`)
    await page.mouse.move(0, 0)
    await expect(hover_status).toHaveText(`false`)
  })

  test(`point click/double-click events fire and give points a pointer cursor`, async ({
    page,
  }) => {
    const section = page.locator(`#point-event-test`)
    const first_marker = section.locator(`.scatter path.marker`).first()
    const clicked_text = section.locator(`[data-testid="last-clicked-point"]`)
    const double_clicked_text = section.locator(`[data-testid="last-double-clicked-point"]`)
    await expect(first_marker).toBeVisible()
    await expect(first_marker).toHaveCSS(`cursor`, `pointer`)
    // no handler -> no pointer cursor
    await expect(page.locator(`#basic-example .scatter path.marker`).first()).not.toHaveCSS(
      `cursor`,
      `pointer`,
    )

    await expect(clicked_text).toContainText(`Last Clicked Point: none`)
    await expect(double_clicked_text).toContainText(`Last Double-Clicked Point: none`)

    const clickable = first_marker.locator(`..`)
    await clickable.dispatchEvent(`click`)
    await expect(clicked_text).toContainText(
      `Last Clicked Point: Point: series 0, index 0 (x=1, y=2)`,
    )
    await expect(double_clicked_text).toContainText(`Last Double-Clicked Point: none`)
    await clickable.dispatchEvent(`dblclick`)
    await expect(double_clicked_text).toContainText(
      `Last Double-Clicked Point: DblClick: series 0, index 0 (x=1, y=2)`,
    )
  })

  test(`drag zoom shrinks both axes, extends past the plot edge, and resets`, async ({
    page,
  }) => {
    const plot = page.locator(`#basic-example .scatter`)
    const console_errors = collect_console_errors(page)
    const page_errors = collect_page_errors(page)
    await expect_zoom_shrinks_axes(page, plot)

    // a drag continuing outside the plot area keeps growing the zoom rect
    const zoom_rect = plot.locator(`rect.zoom-rect`)
    const { clip, svg_box } = await measure_plot_area(plot)
    await page.mouse.move(
      svg_box.x + clip.x + clip.width * 0.8,
      svg_box.y + clip.y + clip.height * 0.8,
    )
    await page.mouse.down()
    await page.mouse.move(svg_box.x + clip.x + 5, svg_box.y + clip.y + 5, { steps: 5 })
    await expect(zoom_rect).toBeVisible()
    const rect_inside = await zoom_rect.boundingBox()
    if (!rect_inside) throw new Error(`Rect box inside not found`)
    await page.mouse.move(svg_box.x - 50, svg_box.y - 50, { steps: 5 })
    await expect(zoom_rect).toBeVisible()
    const rect_outside = await zoom_rect.boundingBox()
    if (!rect_outside) throw new Error(`Rect box outside not found`)
    expect(rect_outside.width).toBeGreaterThan(rect_inside.width)
    expect(rect_outside.height).toBeGreaterThan(rect_inside.height)
    await page.mouse.up()
    await expect(zoom_rect).toBeHidden()
    await expect
      .poll(async () => (await get_tick_range(plot.locator(`g.x-axis`))).range)
      .toBeGreaterThan(0)

    expect(page_errors).toHaveLength(0)
    expect(console_errors).toHaveLength(0)
  })

  test(`legend interaction toggles and isolates series visibility`, async ({ page }) => {
    const plot = page.locator(`#legend-multi-default.scatter`)
    const series_a_item = legend_item(plot, `Series A`)
    const series_b_item = legend_item(plot, `Series B`)
    const markers = plot.locator(`g[data-series-id] .marker`)
    await expect(markers).toHaveCount(4)
    await expect(series_a_item).not.toHaveClass(/hidden/)
    await expect(series_b_item).not.toHaveClass(/hidden/)

    // single click hides / shows
    await series_a_item.click()
    await expect(markers).toHaveCount(2)
    await expect(series_a_item).toHaveClass(/hidden/)
    await series_a_item.click()
    await expect(markers).toHaveCount(4)
    await expect(series_a_item).not.toHaveClass(/hidden/)

    // double click isolates, clicking the other restores it
    await series_a_item.dblclick()
    await expect(markers).toHaveCount(2)
    await expect(series_a_item).not.toHaveClass(/hidden/)
    await expect(series_b_item).toHaveClass(/hidden/)
    await series_b_item.click()
    await expect(series_b_item).not.toHaveClass(/hidden/)
    await expect(markers).toHaveCount(4)
  })

  test(`axis ranges adapt to visible series and preserve on full hide`, async ({ page }) => {
    // Ranges adopt visible data (shrink + expand) but don't snap to [0,1]
    // default when all series are hidden
    const plot = page.locator(`#legend-multi-default.scatter`)
    const x_axis = plot.locator(`g.x-axis`)
    const y_axis = plot.locator(`g.y-axis`)
    const series_a_item = legend_item(plot, `Series A`)
    const series_b_item = legend_item(plot, `Series B`)
    await expect(plot.locator(`g[data-series-id] .marker`)).toHaveCount(4)
    await expect(y_axis.locator(`.tick text`).first()).toBeVisible()

    // Series A: x=[1,2] y=[3,4], Series B: x=[1,2] y=[1,2] -> combined y range spans [1,4]
    const initial_x = await get_tick_range(x_axis)
    const initial_y = await get_tick_range(y_axis)
    expect(initial_x.range).toBeGreaterThan(0)
    expect(initial_y.range).toBeGreaterThan(0)

    // Hide Series A - y range shrinks to Series B, x stays (both series share x)
    await series_a_item.click()
    await expect(series_a_item).toHaveClass(/hidden/)
    await expect
      .poll(async () => (await get_tick_range(y_axis)).range)
      .toBeLessThan(initial_y.range)
    expect((await get_tick_range(x_axis)).range).toBeGreaterThanOrEqual(initial_x.range * 0.95)

    // Show Series A again - ranges expand back
    await series_a_item.click()
    await expect
      .poll(async () => (await get_tick_range(y_axis)).range)
      .toBeGreaterThanOrEqual(initial_y.range * 0.95)

    // Hide both series - ranges stay at the last visible data range, not [0, 1]
    await series_a_item.click()
    await series_b_item.click()
    await expect(series_b_item).toHaveClass(/hidden/)
    expect((await get_tick_range(x_axis)).range).toBeGreaterThan(0)
    expect((await get_tick_range(y_axis)).range).toBeGreaterThan(0)

    await series_a_item.click()
    await series_b_item.click()
    await expect
      .poll(async () => (await get_tick_range(y_axis)).range)
      .toBeCloseTo(initial_y.range, 0)
  })

  test(`legend line color reflects color scale for color-mapped series`, async ({ page }) => {
    // color-mapped series with lines but no explicit line stroke
    const legend_item_el = page
      .locator(`#color-mapped-line-legend-test .scatter .legend .legend-item`)
      .first()
    const legend_line = legend_item_el.locator(`line[stroke]`)
    await expect(legend_line).toHaveCount(1)
    const legend_stroke = await legend_line.getAttribute(`stroke`)
    // the legend uses color_scale_fn instead of defaulting to black
    expect(legend_stroke).toMatch(/^#[0-9a-f]{6}$/i)
    expect(legend_stroke).not.toBe(`#000000`)
  })

  // one page per case: placement has hysteresis, so a colorbar already parked in a corner
  // need not move when another corner empties out later
  const colorbar_cases = [
    { expected_quadrant: `top-left`, densities: { tl: 0, tr: 50, bl: 50, br: 50 } },
    { expected_quadrant: `top-right`, densities: { tl: 50, tr: 0, bl: 50, br: 50 } },
    { expected_quadrant: `bottom-left`, densities: { tl: 50, tr: 50, bl: 0, br: 50 } },
    { expected_quadrant: `bottom-right`, densities: { tl: 50, tr: 50, bl: 50, br: 0 } },
  ]
  for (const { expected_quadrant, densities } of colorbar_cases) {
    test(`colorbar moves to ${expected_quadrant} when least dense`, async ({ page }) => {
      const section = page.locator(`#auto-colorbar-placement`)
      await section.scrollIntoViewIfNeeded()
      await set_density(section, densities)
      await expect
        .poll(() => get_colorbar_quadrant(section), { timeout: 3000 })
        .toBe(expected_quadrant)
    })
  }

  test(`legend and colorbar never overlap and colorbar placement matches its footprint`, async ({
    page,
  }) => {
    const plot = page.locator(`#color-scale #color-scale-toggle .scatter`)
    const colorbar = plot.locator(`.colorbar-wrapper`)
    await expect(colorbar).toBeVisible()
    await expect(colorbar).toHaveAttribute(`data-decoration-x`, /.+/)

    const dimensions = [`x`, `y`, `width`, `height`] as const
    const geometry = () =>
      plot.evaluate((plot_element, dimension_names) => {
        const colorbar_element = plot_element.querySelector<HTMLElement>(`.colorbar-wrapper`)
        if (!colorbar_element) throw new Error(`missing colorbar geometry`)
        const plot_box = plot_element.getBoundingClientRect()
        const boxes = [
          colorbar_element.getBoundingClientRect(),
          ...[...colorbar_element.querySelectorAll<HTMLElement>(`*`)]
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width > 0 || rect.height > 0),
        ]
        const left = Math.min(...boxes.map((rect) => rect.left))
        const top = Math.min(...boxes.map((rect) => rect.top))
        const right = Math.max(...boxes.map((rect) => rect.right))
        const bottom = Math.max(...boxes.map((rect) => rect.bottom))
        return {
          actual: [left - plot_box.left, top - plot_box.top, right - left, bottom - top],
          solved: dimension_names.map((dimension) =>
            Number(colorbar_element.getAttribute(`data-decoration-${dimension}`)),
          ),
        }
      }, dimensions)
    // the solved decoration box matches the rendered footprint once layout settles
    const expect_geometry_matches = async () => {
      let actual: number[] = []
      await expect(async () => {
        await wait_for_stable_bbox(colorbar, 1000)
        const current = await geometry()
        for (const [dimension_idx, value] of current.actual.entries()) {
          expect(value).toBeCloseTo(current.solved[dimension_idx], 0)
        }
        actual = current.actual
      }).toPass({ timeout: 3000 })
      return actual
    }
    const before = await expect_geometry_matches()

    const legend = plot.locator(`.legend`)
    if ((await legend.count()) > 0) {
      const [legend_bbox, colorbar_bbox] = await Promise.all([
        legend.boundingBox(),
        colorbar.boundingBox(),
      ])
      if (!legend_bbox || !colorbar_bbox) throw new Error(`missing legend/colorbar geometry`)
      expect(rects_overlap(legend_bbox, colorbar_bbox)).toBe(false)
    }

    await page.setViewportSize({ width: 900, height: 700 })
    const after = await expect_geometry_matches()
    for (const dimension_idx of [2, 3] as const) {
      expect(after[dimension_idx]).toBeCloseTo(before[dimension_idx], 0)
    }
  })

  // TOOLTIP AND STYLING TESTS

  // tooltip background follows point fill > stroke > line color, text contrasts with it
  const tooltip_precedence_cases = [
    {
      plot_id: `fill-plot`,
      expected_bg: `rgb(128, 0, 128)`,
      expected_text: `rgb(255, 255, 255)`,
    },
    { plot_id: `stroke-plot`, expected_bg: `rgb(255, 165, 0)`, expected_text: `rgb(0, 0, 0)` },
    {
      plot_id: `line-plot`,
      expected_bg: `rgb(0, 128, 0)`,
      expected_text: `rgb(255, 255, 255)`,
    },
  ]
  for (const { plot_id, expected_bg, expected_text } of tooltip_precedence_cases) {
    test(`tooltip color follows ${plot_id}`, async ({ page }) => {
      const plot = page.locator(`#tooltip-precedence-test #${plot_id}.scatter`)
      await plot.scrollIntoViewIfNeeded()
      const tooltip = await hover_to_show_tooltip(
        page,
        plot,
        plot.locator(`path.marker`).first(),
      )
      // toHaveCSS retries, avoiding flakes from reactive colors applied a tick after hover
      await expect(tooltip).toHaveCSS(`background-color`, expected_bg)
      await expect(tooltip).toHaveCSS(`color`, expected_text)
    })
  }

  test(`tooltip appears on hover, updates across markers and stays inside the plot`, async ({
    page,
  }) => {
    const plot = page.locator(`#basic-example .scatter`)
    const markers = plot.locator(`path.marker`)
    const tooltip = plot.locator(`.plot-tooltip`)
    await expect(markers).toHaveCount(10)
    await expect(tooltip).toBeHidden()

    await hover_to_show_tooltip(page, plot, markers.first())
    const first_tooltip_text = await tooltip.textContent()
    expect(first_tooltip_text).toBeTruthy()
    await hover_to_show_tooltip(page, plot, markers.nth(1))
    expect(await tooltip.textContent()).not.toBe(first_tooltip_text)

    // markers nearest the right and bottom edges must not push the tooltip out of the plot
    const plot_box = await plot.boundingBox()
    if (!plot_box) throw new Error(`plot has no bounding box`)
    const header_box = await plot.locator(`.header-controls`).boundingBox()
    const marker_boxes = await Promise.all(
      (await markers.all()).map(async (marker) => ({
        marker,
        bbox: await marker.boundingBox(),
      })),
    )
    // header controls sit on the top-right; skip markers under that overlay
    const hoverable = marker_boxes.filter(({ bbox }) => {
      if (!bbox) return false
      if (!header_box) return true
      const cx = bbox.x + bbox.width / 2
      const cy = bbox.y + bbox.height / 2
      return !(
        cx >= header_box.x &&
        cx <= header_box.x + header_box.width &&
        cy >= header_box.y &&
        cy <= header_box.y + header_box.height
      )
    })
    const rightmost = hoverable.toSorted((a, b) => (b.bbox?.x ?? 0) - (a.bbox?.x ?? 0))[0]
    const bottommost = hoverable.toSorted((a, b) => (b.bbox?.y ?? 0) - (a.bbox?.y ?? 0))[0]
    for (const { marker } of [rightmost, bottommost]) {
      await hover_to_show_tooltip(page, plot, marker)
      const tooltip_box = await tooltip.boundingBox()
      if (!tooltip_box) throw new Error(`tooltip has no bounding box`)
      expect(tooltip_box.x + tooltip_box.width).toBeLessThanOrEqual(
        plot_box.x + plot_box.width + 50,
      )
      expect(tooltip_box.y + tooltip_box.height).toBeLessThanOrEqual(
        plot_box.y + plot_box.height + 50,
      )
    }
    await plot.hover()
    await expect(tooltip).toBeHidden()
  })

  // Control Pane Tests

  test(`control pane toggles points and grid lines and closes via its toggle`, async ({
    page,
  }) => {
    const scatter_plot = page.locator(`#legend-multi-default.scatter`)
    const markers = scatter_plot.locator(`path.marker`)
    await expect(markers).toHaveCount(4)
    const { toggle, pane } = await open_plot_controls(scatter_plot)

    const show_points_checkbox = pane.getByLabel(`Show points`)
    await expect(show_points_checkbox).toBeChecked()
    await show_points_checkbox.uncheck()
    await expect(markers).toHaveCount(0)
    await show_points_checkbox.check()
    await expect(markers).toHaveCount(4)

    // grid lines are the tick lines that extend across the chart (not the short tick marks)
    const x_grid_lines = scatter_plot.locator(`g.x-axis .tick line:not([y1='0'])`)
    const initial_grid_lines = await x_grid_lines.count()
    expect(initial_grid_lines).toBeGreaterThan(0)
    const x_grid_checkbox = pane.locator(`[data-label="grid"]`).getByLabel(`X`)
    await expect(x_grid_checkbox).toBeChecked()
    await x_grid_checkbox.uncheck()
    await expect(x_grid_lines).toHaveCount(0)
    await x_grid_checkbox.check()
    await expect.poll(() => x_grid_lines.count()).toBeGreaterThanOrEqual(initial_grid_lines)

    await scatter_plot.hover()
    await toggle.click()
    await expect(pane).toBeHidden()
  })

  test(`tick format and scale type controls change axis ticks`, async ({ page }) => {
    const plot = page.locator(`#basic-example .scatter`)
    const x_axis = plot.locator(`g.x-axis`)
    const y_axis = plot.locator(`g.y-axis`)
    const y_tick_text = y_axis.locator(`.tick text`).first()
    await expect(y_tick_text).toBeVisible()
    const initial_y_ticks = await get_tick_range(y_axis)
    const initial_x_ticks = await get_tick_range(x_axis)
    const { pane } = await open_plot_controls(plot)

    // formats
    const tick_format_section = pane.getByTestId(`tick-format-section`)
    const x_format_input = tick_format_section.locator(
      `label:has(span:text-is("X-axis")) input[type="text"]`,
    )
    await x_format_input.fill(`.0%`)
    await expect(x_axis.locator(`.tick text`).first()).toContainText(`%`)
    await x_format_input.fill(`invalid`)
    await expect(x_format_input).toHaveClass(/invalid/)
    await x_format_input.fill(``)
    await tick_format_section
      .locator(`label:has(span:text-is("Y-axis")) input[type="text"]`)
      .fill(`.1e`)
    await expect(y_tick_text).toHaveText(/e[+-]?\d/)

    // scale types (regression for $bindable reactivity from PlotControls -> ScatterPlot)
    const scale_type_section = pane.locator(`[data-testid="scale-type-section"]`)
    const y_scale_select = scale_type_section.locator(`label:has(span:text-is("Y")) select`)
    await expect(y_scale_select).toHaveValue(`linear`)
    await y_scale_select.selectOption(`log`)
    await expect
      .poll(async () => (await get_tick_range(y_axis)).ticks)
      .not.toEqual(initial_y_ticks.ticks)
    const x_scale_select = scale_type_section.locator(`label:has(span:text-is("X")) select`)
    await x_scale_select.selectOption(`arcsinh`)
    await expect
      .poll(async () => (await get_tick_range(x_axis)).ticks)
      .not.toEqual(initial_x_ticks.ticks)

    await pane.getByRole(`button`, { name: `Reset scale type to defaults` }).click()
    await expect(x_scale_select).toHaveValue(`linear`)
    await expect(y_scale_select).toHaveValue(`linear`)
  })

  // CONTROL PRECEDENCE TESTS - explicit styling wins on page load and only user-modified
  // controls override it

  test(`explicit point and line styling is preserved on page load`, async ({ page }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    const crimson_markers = plot.locator(`g[data-series-id="0"] path.marker`)
    const green_markers = plot.locator(`g[data-series-id="1"] path.marker`)
    await expect(crimson_markers).toHaveCount(5)
    await expect(green_markers).toHaveCount(5)

    const first_crimson = crimson_markers.first()
    expect(await first_crimson.getAttribute(`fill`)).toContain(`crimson`)
    await expect(first_crimson).toHaveAttribute(`stroke`, `darkred`)
    await expect(first_crimson).toHaveAttribute(`stroke-width`, `3`)
    // radius 12 (not the control default 3) -> ~24px diameter plus stroke
    const crimson_bbox = await first_crimson.boundingBox()
    expect(crimson_bbox?.width).toBeGreaterThan(20)

    const first_green = green_markers.first()
    expect(await first_green.getAttribute(`fill`)).toContain(`forestgreen`)
    await expect(first_green).toHaveAttribute(`stroke-width`, `2`)
    // radius 8 < 12
    expect((await first_green.boundingBox())?.width).toBeLessThan(crimson_bbox?.width ?? NaN)

    const green_line = plot.locator(`g[data-series-id="1"] path[fill="none"]`)
    await expect(green_line).toHaveAttribute(`stroke`, `limegreen`)
    await expect(green_line).toHaveAttribute(`stroke-width`, `4`)
  })

  test(`touched controls override only their property; reset restores control defaults`, async ({
    page,
  }) => {
    const plot = page.locator(`#control-precedence-plot.scatter`)
    const crimson_marker = plot.locator(`g[data-series-id="0"] path.marker`).first()
    const green_marker = plot.locator(`g[data-series-id="1"] path.marker`).first()
    const green_line = plot.locator(`g[data-series-id="1"] path[fill="none"]`)
    const initial_width = (await crimson_marker.boundingBox())?.width ?? NaN
    const { pane } = await open_plot_controls(plot)

    // point size on series 0: marker grows, its color/stroke and series 1 are untouched
    await pane.locator(`[data-key="point.size"] input[type="range"]`).fill(`20`)
    await expect
      .poll(async () => (await crimson_marker.boundingBox())?.width ?? 0)
      .toBeGreaterThan(initial_width * 1.3)
    expect(await crimson_marker.getAttribute(`fill`)).toContain(`crimson`)
    await expect(crimson_marker).toHaveAttribute(`stroke`, `darkred`)
    await expect(crimson_marker).toHaveAttribute(`stroke-width`, `3`)
    expect(await green_marker.getAttribute(`fill`)).toContain(`forestgreen`)
    await expect(green_marker).toHaveAttribute(`stroke-width`, `2`)

    // section reset untouches every key in it, so the authored radius shows again
    await pane.getByRole(`button`, { name: `Reset point style to defaults` }).click()
    await expect
      .poll(async () => (await crimson_marker.boundingBox())?.width ?? 0)
      .toBeCloseTo(initial_width, 0)
    await expect(crimson_marker).toHaveAttribute(`stroke-width`, `3`)

    // line width on series 1: width changes, line color and points stay
    const series_select = pane.getByRole(`combobox`, { name: /Series/ })
    await series_select.selectOption(`1`)
    await pane.locator(`[data-key="line.width"] input[type="range"]`).fill(`8`)
    await expect(green_line).toHaveAttribute(`stroke-width`, `8`)
    await expect(green_line).toHaveAttribute(`stroke`, `limegreen`)
    expect(await green_marker.getAttribute(`fill`)).toContain(`forestgreen`)
  })

  test(`auto label placement keeps sparse and dense labels from overlapping`, async ({
    page,
  }) => {
    const section = page.locator(`#label-auto-placement-test`)
    const plot = section.locator(`.scatter`)
    const checkbox = section.getByRole(`checkbox`, { name: `Enable Auto Placement` })
    await checkbox.check()

    const expected_dense_label_count = 8
    // Wait until every dense label has a distinct final placement.
    await page.waitForFunction(
      (expected_count) => {
        const labels = [
          ...document.querySelectorAll(`#label-auto-placement-test g[data-series-id] text`),
        ].filter((label) => label.textContent?.startsWith(`Dense-`))
        const positions = labels.map((label) => {
          const { x, y } = label.getBoundingClientRect()
          return `${Math.round(x)},${Math.round(y)}`
        })
        return (
          labels.length === expected_count &&
          positions.every(
            (position, position_idx) => positions.indexOf(position) === position_idx,
          )
        )
      },
      expected_dense_label_count,
      { timeout: 2000 },
    )

    type LabelBox = {
      text: string
      bbox: { x: number; y: number; width: number; height: number }
    }
    const label_data: LabelBox[] = []
    for (const label_el of await plot.locator(`g[data-series-id] text`).all()) {
      const text = (await label_el.textContent()) ?? ``
      const bbox = await label_el.boundingBox()
      if (!bbox) throw new Error(`${text} has no measurable bounding box`)
      expect(bbox.width).toBeGreaterThan(0)
      expect(bbox.height).toBeGreaterThan(0)
      label_data.push({ text, bbox })
    }
    const sparse_labels = label_data.filter(({ text }) => text.startsWith(`Sparse-`))
    const dense_labels = label_data.filter(({ text }) => text.startsWith(`Dense-`))
    expect(sparse_labels).toHaveLength(4)
    expect(dense_labels).toHaveLength(expected_dense_label_count)

    for (const labels of [sparse_labels, dense_labels]) {
      for (const [label_idx, label] of labels.entries()) {
        for (const other of labels.slice(label_idx + 1)) {
          expect(
            rects_overlap(label.bbox, other.bbox),
            `${label.text} overlaps ${other.text}`,
          ).toBe(false)
        }
      }
    }

    // Sparse labels keep the left/right and low/high ordering of their markers
    const sparse_box = (text: string) => {
      const bbox = sparse_labels.find((datum) => datum.text === text)?.bbox
      if (!bbox) throw new Error(`${text} has no measurable bounding box`)
      return bbox
    }
    const [tl, tr, bl, br] = [`Sparse-TL`, `Sparse-TR`, `Sparse-BL`, `Sparse-BR`].map(
      sparse_box,
    )
    expect(Math.max(tl.x + tl.width, bl.x + bl.width)).toBeLessThan(Math.min(tr.x, br.x))
    expect(Math.max(bl.y + bl.height, br.y + br.height)).toBeLessThan(Math.min(tl.y, tr.y))
  })

  // PAN FUNCTIONALITY TESTS

  test(`Shift+drag pans the plot instead of zooming`, async ({ page }) => {
    await expect_shift_drag_pans(page, page.locator(`#basic-example .scatter`))
  })

  test(`cursor changes to grab/grabbing during pan`, async ({ page }) => {
    const svg = get_chart_svg(page.locator(`#basic-example .scatter`))
    await expect(svg).toHaveCSS(`cursor`, `crosshair`)
    await page.keyboard.down(`Shift`)
    await expect(svg).toHaveCSS(`cursor`, `grab`)

    const svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`SVG box not found`)
    await page.mouse.move(svg_box.x + 100, svg_box.y + 100)
    await page.mouse.down()
    // Cursor is set on document.body during pan drag
    await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe(`grabbing`)
    await page.mouse.up()
    await page.keyboard.up(`Shift`)
    await expect(svg).toHaveCSS(`cursor`, `crosshair`)
  })

  test(`pan requires focus for wheel events`, async ({ page }) => {
    const plot = page.locator(`#basic-example .scatter`)
    const svg = get_chart_svg(plot)
    const y_axis = plot.locator(`g.y-axis`)
    await expect(y_axis.locator(`.tick text`).first()).toBeVisible()
    const initial_y = await get_tick_range(y_axis)
    const svg_box = await svg.boundingBox()
    if (!svg_box) throw new Error(`SVG box not found`)
    const shift_wheel = async () => {
      await page.mouse.move(svg_box.x + svg_box.width / 2, svg_box.y + svg_box.height / 2)
      await page.keyboard.down(`Shift`)
      await page.mouse.wheel(0, 100)
      await page.keyboard.up(`Shift`)
    }

    // without focus the wheel is not captured
    await shift_wheel()
    expect((await get_tick_range(y_axis)).ticks).toEqual(initial_y.ticks)

    await svg.focus()
    await expect(svg).toBeFocused()
    await shift_wheel()
    await expect
      .poll(async () => (await get_tick_range(y_axis)).ticks)
      .not.toEqual(initial_y.ticks)
  })
})

// Legend placement stability (hover lock, toggle stability, drag, resize)
test.describe(`Legend Placement Stability`, () => {
  const plot_selector = `#legend-multi-default.scatter`

  test.beforeEach(async ({ page }) => {
    await page.goto(`/test/scatter-plot`, { waitUntil: `networkidle` })
    await page.locator(plot_selector).scrollIntoViewIfNeeded()
  })

  test(`smart placement keeps the legend inside the plot and away from markers`, async ({
    page,
  }) => {
    const plot = page.locator(plot_selector)
    const legend = plot.locator(`.legend`)
    // Wait for smart placement to move the legend away from the top-left fallback corner
    const legend_bbox = await wait_for_stable_bbox(legend)
    const plot_bbox = await plot.boundingBox()
    if (!plot_bbox) throw new Error(`plot has no bounding box`)
    const legend_center_x = legend_bbox.x + legend_bbox.width / 2
    const legend_center_y = legend_bbox.y + legend_bbox.height / 2
    expect(legend_center_x).toBeGreaterThan(plot_bbox.x)
    expect(legend_center_x).toBeLessThan(plot_bbox.x + plot_bbox.width)
    expect(legend_center_y).toBeGreaterThan(plot_bbox.y)
    expect(legend_center_y).toBeLessThan(plot_bbox.y + plot_bbox.height)

    // 5% of the plot diagonal is a reasonable clearance for a small dataset
    const marker_boxes = await Promise.all(
      (await plot.locator(`path.marker`).all()).map((marker) => marker.boundingBox()),
    )
    const min_distance = Math.min(
      ...marker_boxes.map((marker_bbox) =>
        marker_bbox
          ? Math.hypot(
              legend_center_x - (marker_bbox.x + marker_bbox.width / 2),
              legend_center_y - (marker_bbox.y + marker_bbox.height / 2),
            )
          : Infinity,
      ),
    )
    expect(min_distance).toBeGreaterThan(Math.hypot(plot_bbox.width, plot_bbox.height) * 0.05)
  })

  test(`legend position stays fixed while hovered during series toggles`, async ({ page }) => {
    const plot = page.locator(plot_selector)
    const legend = plot.locator(`.legend`)
    const initial_pos = await wait_for_stable_bbox(legend)

    await legend.hover()
    const series_a = legend.locator(`.legend-item`).first()
    await series_a.click()
    await expect(series_a).toHaveClass(/hidden/)
    // hover lock: the legend does not re-place while the pointer is on it
    const after_toggle = await legend.boundingBox()
    if (!after_toggle) throw new Error(`legend has no bounding box`)
    expect(
      Math.hypot(after_toggle.x - initial_pos.x, after_toggle.y - initial_pos.y),
    ).toBeLessThan(10)
    await series_a.click()

    // rapid toggling of every item leaves a sane legend behind
    const items = legend.locator(`.legend-item`)
    const count = await items.count()
    for (const hide of [true, false]) {
      for (let idx = 0; idx < count; idx++) {
        await items.nth(idx).click()
        if (hide) await expect(items.nth(idx)).toHaveClass(/hidden/)
        else await expect(items.nth(idx)).not.toHaveClass(/hidden/)
      }
    }
    const plot_bbox = await plot.boundingBox()
    if (!plot_bbox) throw new Error(`plot has no bounding box`)
    await page.mouse.move(plot_bbox.x + 10, plot_bbox.y + 10)
    const final_pos = await wait_for_stable_bbox(legend)
    expect(final_pos.width).toBeGreaterThan(50)
    expect(final_pos.height).toBeGreaterThan(20)
    // a released hover lock may re-place, but not across the plot
    expect(Math.hypot(final_pos.x - initial_pos.x, final_pos.y - initial_pos.y)).toBeLessThan(
      100,
    )
  })

  test(`dragging moves the legend, keeps it interactive and inside the plot after resize`, async ({
    page,
  }) => {
    // The test plot has legend padding (8px) to ensure clickable empty space for drag initiation.
    const plot = page.locator(plot_selector)
    const legend = plot.locator(`.legend`)
    await expect(legend).toHaveClass(/draggable/)
    const initial_bbox = await wait_for_stable_bbox(legend)

    // grab the padding (not an item) and drag by a fixed offset
    await page.mouse.move(initial_bbox.x + 4, initial_bbox.y + 4)
    await expect(legend).toHaveCSS(`cursor`, `grab`)
    await page.mouse.down()
    await page.mouse.move(initial_bbox.x + 4 + 80, initial_bbox.y + 4 + 40, { steps: 10 })
    await page.mouse.up()
    const after_drag = await wait_for_stable_bbox(legend)
    expect(
      Math.abs(after_drag.x - initial_bbox.x) > 20 ||
        Math.abs(after_drag.y - initial_bbox.y) > 20,
      `legend should move during drag`,
    ).toBe(true)

    // items still toggle, and toggling does not move a manually placed legend
    const first_item = legend.locator(`.legend-item`).first()
    await first_item.click()
    await expect(first_item).toHaveClass(/hidden/)
    await first_item.click()
    await expect(first_item).not.toHaveClass(/hidden/)
    const after_toggle = await wait_for_stable_bbox(legend)
    expect(after_toggle.x).toBeCloseTo(after_drag.x, 0)
    expect(after_toggle.y).toBeCloseTo(after_drag.y, 0)

    await page.setViewportSize({ width: 600, height: 400 })
    await expect
      .poll(async () => {
        const resized_plot = await plot.boundingBox()
        const resized_legend = await legend.boundingBox()
        if (!resized_plot || !resized_legend) return -Infinity
        return Math.min(
          resized_legend.x - resized_plot.x,
          resized_legend.y - resized_plot.y,
          resized_plot.x + resized_plot.width - resized_legend.x - resized_legend.width,
          resized_plot.y + resized_plot.height - resized_legend.y - resized_legend.height,
        )
      })
      .toBeGreaterThanOrEqual(-1)
  })
})
