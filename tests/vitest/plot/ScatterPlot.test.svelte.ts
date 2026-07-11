import { ScatterPlot } from '$lib'
import type { Vec2 } from '$lib/math'
import type { DataSeries, FillRegion } from '$lib/plot'
import { get_series_color, get_series_symbol } from '$lib/plot/core/data-transform'
import { DEFAULT_SERIES_COLORS, DEFAULT_SERIES_SYMBOLS } from '$lib/plot/core/types'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query, mount_sized, resize_element, svg_query } from '../setup'

afterEach(() => vi.restoreAllMocks())

const basic = {
  x: [1, 2, 3, 4, 5],
  y: [5, 3, 8, 2, 7],
  point_style: { fill: `steelblue`, radius: 5 },
}

const mount_sized_scatter_plot = (
  props: Partial<ComponentProps<typeof ScatterPlot>>,
): Promise<HTMLElement> => mount_sized(ScatterPlot, props, { selector: `.scatter` })

const visible_marker_count = (series: DataSeries[]): number =>
  series.reduce((sum, srs) => {
    const markers = srs.markers ?? `line+points`
    return markers.includes(`points`) ? sum + srs.y.length : sum
  }, 0)
const marker_radius = (marker: Element): number => {
  const path = marker.getAttribute(`d`) ?? ``
  const match = /^M(?<radius>-?\d*\.?\d+(?:e-?\d+)?),0/i.exec(path)
  if (!match?.groups?.radius) {
    throw new Error(`Could not read marker radius from path "${path}"`)
  }
  return Math.abs(Number(match.groups.radius))
}
const hover = async (element: Element): Promise<void> => {
  element.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
  await tick()
}

type LegendGroupingCase = {
  desc: string
  series: DataSeries[]
  props: Partial<ComponentProps<typeof ScatterPlot>>
}

describe(`ScatterPlot`, () => {
  test.each([
    {
      series: [basic],
      x_axis: { range: [null, null] as [null, null] },
      y_axis: { range: [null, null] as [null, null] },
      markers: `points`,
      expected_markers: 5,
    },
    {
      series: [{ ...basic, y: [5, 3, 20, 2, 7] }],
      x_axis: { range: [null, null] as [null, null] },
      y_axis: { range: [0, 10] as Vec2 },
      markers: `line`,
      expected_markers: 4,
    },
    {
      series: [{ ...basic, x: [0, 1, 2, 3, 10] }],
      x_axis: { range: [0, 5] as Vec2 },
      y_axis: { range: [null, null] as [null, null] },
      markers: `line+points`,
      expected_markers: 4,
    },
    { series: [], markers: `points`, expected_markers: 0 },
    { series: [basic], legend: null, expected_markers: 5 },
    {
      series: [
        basic,
        { x: [1, 2, 3], y: [2, 5, 3], point_style: { fill: `orangered`, radius: 4 } },
      ],
      markers: `line+points`,
      expected_markers: 8,
    },
  ])(`renders with series/limits/markers`, async ({ expected_markers, ...props }) => {
    const plot = await mount_sized_scatter_plot(props)
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(expected_markers)
    if (props.legend === null) expect(plot.querySelector(`.legend`)).toBeNull()
  })

  test(`does not render a colorbar in a zero-sized plot`, async () => {
    vi.spyOn(HTMLElement.prototype, `clientWidth`, `get`).mockReturnValue(0)
    vi.spyOn(HTMLElement.prototype, `clientHeight`, `get`).mockReturnValue(0)
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{ ...basic, color_values: basic.x }],
        color_bar: {},
      },
    })
    await tick()
    expect(document.querySelector(`.colorbar-wrapper`)).toBeNull()
  })

  test.each([
    [`points only`, `points`, 5, 3],
    [`line+points`, `line+points`, 5, 2.5],
    [`dense points only`, `points`, 101, 2.5],
    [`dense line+points`, `line+points`, 101, 2],
  ] as const)(
    `uses smaller default marker radius for %s`,
    async (_desc, markers, count, radius) => {
      const series = [
        {
          x: Array.from({ length: count }, (_, idx) => idx),
          y: Array.from({ length: count }, (_, idx) => idx % 10),
          markers,
        },
      ]
      const plot = await mount_sized_scatter_plot({ series, legend: null })
      expect(marker_radius(plot.querySelector(`.marker`) as Element)).toBeCloseTo(radius, 6)
    },
  )

  test(`keeps explicit marker radius`, async () => {
    const count = 101
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: Array.from({ length: count }, (_, idx) => idx),
          y: Array.from({ length: count }, (_, idx) => idx % 10),
          markers: `line+points`,
          point_style: { radius: 6 },
        },
      ],
      legend: null,
    })

    expect(marker_radius(plot.querySelector(`.marker`) as Element)).toBeCloseTo(6, 6)
  })

  // guards the line_style.curve -> <Line> wiring (the Line unit test alone wouldn't catch
  // ScatterPlot dropping `curve={ls?.curve}`). cubic `C` commands appear only for splines.
  test.each([
    [`linear`, false], // straight segments -> no cubic Bézier anywhere
    [`monotone`, true], // default spline -> cubic Bézier present
  ] as const)(
    `line_style.curve=%s flows through to the rendered line`,
    async (curve, cubic) => {
      const series: DataSeries[] = [
        { x: [0, 1, 2, 3], y: [0, 8, 1, 9], markers: `line`, line_style: { curve } },
      ]
      const plot = await mount_sized_scatter_plot({
        series,
        line_tween: { duration: 0 }, // disable path morph so the final `d` is set synchronously
        legend: null,
      })
      const has_cubic = [...plot.querySelectorAll(`path`)].some((path) =>
        (path.getAttribute(`d`) ?? ``).includes(`C`),
      )
      expect(has_cubic).toBe(cubic)
    },
  )

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    const plot = await mount_sized_scatter_plot({
      series: [
        { x: [1, 2, 3], y: [10, 20, 30], label: `Primary` },
        { x: [100, 200, 300], y: [5, 15, 25], x_axis: `x2`, label: `Secondary` },
      ],
      x2_axis: { label: `Temperature (K)` },
    })
    expect(plot.querySelector(`g.x2-axis`)).toBeInstanceOf(SVGGElement)
    expect(plot.querySelector(`.x2-label`)?.textContent).toBe(`Temperature (K)`)
  })

  test.each([
    {
      x: [0, 10, 20, 30, 40, 50],
      x_axis: { ticks: -10, format: `.0r` },
      y_axis: { ticks: -5, format: `.0r` },
    },
    {
      x: Array.from({ length: 12 }, (_, idx) =>
        new Date().setMonth(new Date().getMonth() - (12 - idx)),
      ),
      x_axis: { ticks: `month`, format: `%b %Y` },
    },
  ])(`tick formatting`, async ({ x, x_axis, y_axis }) => {
    const y = [12, 24, 36, 48, 60, 72]
    const plot = await mount_sized_scatter_plot({
      series: [{ x, y, point_style: { fill: `steelblue`, radius: 5 } }],
      x_axis,
      y_axis,
    })
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(6)
    expect(plot.querySelectorAll(`.x-axis .tick text`).length).toBeGreaterThan(1)
    expect(plot.querySelectorAll(`.y-axis .tick text`).length).toBeGreaterThan(1)
  })

  describe(`default tooltip content`, () => {
    const tooltip_text = async (props: Record<string, unknown>): Promise<string> => {
      document.body.replaceChildren()
      mount(ScatterPlot, { target: document.body, props: { hovered: true, ...props } })
      await tick()
      return document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    }

    test(`shows axis labels instead of bare x/y`, async () => {
      const text = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30] }],
        x_axis: { label: `Time (s)` },
        y_axis: { label: `Speed` },
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      })
      expect(text).toContain(`Time (s)`)
      expect(text).toContain(`Speed`)
    })

    test(`shows series label only when multiple series`, async () => {
      const multi = await tooltip_text({
        series: [
          { x: [1, 2, 3], y: [10, 20, 30], label: `Alpha` },
          { x: [1, 2, 3], y: [5, 15, 25], label: `Beta` },
        ],
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      })
      expect(multi).toContain(`Alpha`)

      const single = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30], label: `Only` }],
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 },
      })
      expect(single).not.toContain(`Only`)
    })

    test(`shows color value with title, falls back to "Color"`, async () => {
      const with_title = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30], color_values: [100, 200, 300] }],
        color_bar: { title: `Temperature` },
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1, color_value: 200 },
      })
      expect(with_title).toContain(`Temperature`)
      expect(with_title).toContain(`200`)

      const no_title = await tooltip_text({
        series: [{ x: [1, 2, 3], y: [10, 20, 30], color_values: [100, 200, 300] }],
        color_bar: {},
        tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1, color_value: 200 },
      })
      expect(no_title).toContain(`Color`)
      expect(no_title).toContain(`200`)
    })
  })

  test(`invalid data`, async () => {
    const invalid = [
      {
        x: [1, 2, null, 4, 5] as (number | null)[],
        y: [5, 4, undefined, 2, 1] as (number | null)[],
      },
      null,
      undefined,
      { x: [10, 20, 30, 40, 50], y: [10, 20, 30] },
      { x: [100, 200, 300], y: [10, 20, 30] },
    ] as DataSeries[]
    const invalid_plot = await mount_sized_scatter_plot({ series: invalid })
    expect(invalid_plot.querySelectorAll(`.marker`)).toHaveLength(10)
    document.body.replaceChildren()

    const out_of_range_plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 2, 3], y: [4, 5, 6] }],
      x_axis: { range: [100, 200] },
      y_axis: { range: [100, 200] },
    })
    expect(out_of_range_plot.querySelectorAll(`.marker`)).toHaveLength(0)
  })

  test.each([
    { y: [-10, -5, 0, 5, 10], y_range: [-15, 15] as Vec2 },
    { y: [5, 10, 15, 20, 25], y_range: [0, 30] as Vec2 },
  ])(`zero lines`, async ({ y, y_range }) => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 2, 3, 4, 5], y }],
      y_axis: { range: y_range },
    })
    expect(plot.querySelectorAll(`.zero-line`)).toHaveLength(1)
  })

  test.each([
    {
      tooltip_point: {
        x: new Date(2023, 5, 15).getTime(),
        y: 123.45,
        series_idx: 0,
        point_idx: 0,
      },
      x_axis: { format: `%b %d, %Y` },
      y_axis: { format: `.2r` },
    },
    { tooltip_point: { x: 2, y: 20, series_idx: 0, point_idx: 1 } },
  ])(`tooltip format`, async (props) => {
    const plot = await mount_sized_scatter_plot({
      series: [{ x: [1, 2, 3], y: [10, 20, 30] }],
      hovered: true,
      ...props,
    })
    expect(plot.querySelector(`.plot-tooltip`)?.textContent).toMatch(/x|Jun|20|123/)
  })

  test(`children prop`, () => {
    let called = false
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [basic],
        children: createRawSnippet(() => {
          called = true
          return {
            render: () => `<div class="custom-scatter-child">Custom overlay content</div>`,
          }
        }),
      },
    })
    expect(called).toBe(true)
    expect(document.querySelector(`.custom-scatter-child`)?.textContent).toBe(
      `Custom overlay content`,
    )
  })

  test.each([
    { selected_point: { series_idx: 0, point_idx: 2 }, desc: `middle point` },
    { selected_point: { series_idx: 0, point_idx: 0 }, desc: `first point` },
    { selected_point: { series_idx: 0, point_idx: 4 }, desc: `last point` },
    { selected_point: null, desc: `null (no selection)` },
  ])(`selected_point accepts $desc`, async ({ selected_point }) => {
    const plot = await mount_sized_scatter_plot({ series: [basic], selected_point })
    expect(plot.querySelectorAll(`.effect-ring.selected`)).toHaveLength(selected_point ? 1 : 0)
  })

  test(`falls back for auto labels before placement is available`, async () => {
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [
          {
            x: [1],
            y: [1],
            point_label: { text: `Fallback`, auto_placement: true },
          },
        ],
        style: `width: 400px; height: 300px`,
      },
    })
    await tick()

    expect(document.querySelector(`.label-text`)?.textContent).toBe(`Fallback`)
  })

  test(`hides auto labels culled by max_neighbors`, async () => {
    const coords = [...Array.from({ length: 6 }, (_val, idx) => 1 + idx * 0.001), 100]
    const plot = await mount_sized_scatter_plot({
      series: [
        {
          x: coords,
          y: coords,
          point_label: coords.map((_coord, idx) => ({
            text: idx < 6 ? `C${idx}` : `Lonely`,
            auto_placement: true,
            font_size: `10px`,
          })),
        },
      ],
      label_placement_config: { max_neighbors: { count: 1, radius: 30 }, sa_iterations: 0 },
    })

    expect(
      [...plot.querySelectorAll(`.label-text`)].map((label) => label.textContent),
    ).toEqual([`Lonely`])
  })

  test.each<LegendGroupingCase>([
    {
      desc: `with legend_group and legend config`,
      series: [
        {
          x: [1, 2],
          y: [2, 4],
          label: `PBE`,
          legend_group: `DFT`,
          point_style: { fill: `blue` },
        },
        {
          x: [1, 2],
          y: [2.1, 4.1],
          label: `MACE`,
          legend_group: `ML`,
          point_style: { fill: `red` },
        },
        { x: [1, 2], y: [2.2, 4.2], label: `Experiment`, point_style: { fill: `green` } },
      ],
      props: { legend: { draggable: false } },
    },
    {
      desc: `with hidden legend_group`,
      series: [
        { x: [1, 2], y: [2, 4], legend_group: `DFT`, visible: false },
        { x: [1, 2], y: [3, 5], legend_group: `ML`, visible: true },
      ],
      props: {},
    },
    {
      desc: `same label in different legend_groups (no dedupe)`,
      series: [
        {
          x: [1, 2],
          y: [2, 4],
          label: `Energy`,
          legend_group: `DFT`,
          point_style: { fill: `blue` },
        },
        {
          x: [1, 2],
          y: [3, 5],
          label: `Energy`,
          legend_group: `ML`,
          point_style: { fill: `red` },
        },
      ],
      props: { legend: { draggable: false } },
    },
    {
      desc: `same label in same legend_group (deduped)`,
      series: [
        {
          x: [1, 2],
          y: [2, 4],
          label: `Energy`,
          legend_group: `DFT`,
          point_style: { fill: `blue` },
        },
        {
          x: [1, 2],
          y: [3, 5],
          label: `Energy`,
          legend_group: `DFT`,
          point_style: { fill: `red` },
        },
      ],
      props: { legend: { draggable: false } },
    },
    {
      desc: `same label without legend_group (deduped)`,
      series: [
        { x: [1, 2], y: [2, 4], label: `Energy`, point_style: { fill: `blue` } },
        { x: [1, 2], y: [3, 5], label: `Energy`, point_style: { fill: `red` } },
      ],
      props: { legend: { draggable: false } },
    },
    // NOTE: Legend deduplication counts are tested in Playwright since JSDOM lacks proper dimensions
  ])(`legend grouping: renders $desc`, async ({ series, props }) => {
    const plot = await mount_sized_scatter_plot({ series, ...props })
    expect(plot.querySelectorAll(`.marker`)).toHaveLength(
      series
        .filter((srs) => srs.visible !== false)
        .reduce((sum, srs) => sum + srs.y.length, 0),
    )
  })

  // NOTE: Cursor behavior tests for ScatterPlot SVG and points are in Playwright
  // since vitest/happy-dom lacks proper dimensions for rendering points.
  // The cursor logic is tested indirectly via:
  // - FillArea.test.ts (cursor based on click handlers and hover_style.cursor)
  // - ScatterPoint.test.ts (style.cursor prop application)

  describe(`auto-cycling series colors and symbols`, () => {
    test(`DEFAULT_SERIES_COLORS and DEFAULT_SERIES_SYMBOLS are valid`, () => {
      // Colors: 10 distinct valid hex
      expect(DEFAULT_SERIES_COLORS).toHaveLength(10)
      expect(new Set(DEFAULT_SERIES_COLORS).size).toBe(10)
      for (const color of DEFAULT_SERIES_COLORS) expect(color).toMatch(/^#[0-9a-f]{6}$/i)
      // Symbols: 7 distinct valid D3 names
      expect(DEFAULT_SERIES_SYMBOLS).toHaveLength(7)
      expect(new Set(DEFAULT_SERIES_SYMBOLS).size).toBe(7)
      const valid = [`Circle`, `Square`, `Triangle`, `Cross`, `Diamond`, `Star`, `Wye`]
      for (const sym of DEFAULT_SERIES_SYMBOLS) expect(valid).toContain(sym)
    })

    test.each([
      { desc: `single series`, count: 1 },
      { desc: `multiple series (3)`, count: 3 },
      { desc: `cycling past colors (15)`, count: 15 },
      { desc: `mixed markers`, count: 3, markers: [`line+points`, `points`, `line`] },
    ])(`renders $desc without explicit styles`, async ({ count, markers }) => {
      const series: DataSeries[] = Array.from({ length: count }, (_, idx) => ({
        x: [1, 2, 3],
        y: [idx + 1, idx + 2, idx + 3],
        ...(markers
          ? {
              markers: markers[idx % markers.length] as `line` | `points` | `line+points`,
            }
          : {}),
      }))
      const plot = await mount_sized_scatter_plot({ series })
      expect(plot.querySelectorAll(`.marker`)).toHaveLength(visible_marker_count(series))
    })

    test.each([
      { desc: `explicit fill`, props: { point_style: { fill: `purple` } } },
      {
        desc: `explicit symbol_type`,
        props: { point_style: { symbol_type: `Star` as const } },
      },
      {
        desc: `explicit line stroke`,
        props: { markers: `line` as const, line_style: { stroke: `red` } },
      },
    ])(`$desc overrides auto styling`, async ({ props }) => {
      const series: DataSeries[] = [
        { x: [1, 2, 3], y: [1, 2, 3] },
        { x: [1, 2, 3], y: [3, 2, 1], ...props },
      ]
      const plot = await mount_sized_scatter_plot({ series })
      expect(plot.querySelectorAll(`.marker`)).toHaveLength(visible_marker_count(series))
    })

    test(`cycling logic: modulo wrapping and unique combinations`, () => {
      // Modulo wrapping for colors (length 10) and symbols (length 7)
      expect(get_series_color(0)).toBe(get_series_color(10))
      expect(get_series_color(1)).toBe(get_series_color(11))
      expect(get_series_symbol(0)).toBe(get_series_symbol(7))
      expect(get_series_symbol(1)).toBe(get_series_symbol(8))
      // LCM(10,7) = 70 unique color+symbol combinations
      const combos = new Set(
        Array.from(
          { length: 70 },
          (_, idx) => `${get_series_color(idx)}-${get_series_symbol(idx)}`,
        ),
      )
      expect(combos.size).toBe(70)
    })

    test.each([
      { idx: 0, color: `#4e79a7`, symbol: `Circle` },
      { idx: 1, color: `#f28e2c`, symbol: `Square` },
      { idx: 2, color: `#e15759`, symbol: `Triangle` },
      { idx: 3, color: `#76b7b2`, symbol: `Cross` },
      { idx: 4, color: `#59a14f`, symbol: `Diamond` },
    ])(`index $idx maps to $color and $symbol`, ({ idx, color, symbol }) => {
      expect(get_series_color(idx)).toBe(color)
      expect(get_series_symbol(idx)).toBe(symbol)
    })

    test(`adjacent indices return different values (catches off-by-one)`, () => {
      expect(get_series_color(0)).not.toBe(get_series_color(1))
      expect(get_series_symbol(0)).not.toBe(get_series_symbol(1))
    })
  })

  describe(`aria-label on SVG`, () => {
    // SVG only renders when container has width/height. We test by mounting
    // with the same setup used by other passing render tests.
    test(`derives from axis labels`, async () => {
      const plot = await mount_sized_scatter_plot({
        series: [basic],
        x_axis: { label: `Temperature` },
        y_axis: { label: `Pressure` },
      })
      const svg = plot.querySelector(`svg[role="application"]`)
      if (!(svg instanceof SVGSVGElement)) throw new Error(`ScatterPlot SVG not rendered`)

      expect(svg.getAttribute(`aria-label`)).toBe(`Temperature vs Pressure`)
      expect(plot.querySelector(`.x-axis .axis-label`)?.textContent).toContain(`Temperature`)
      expect(plot.querySelector(`.y-axis .axis-label`)?.textContent).toContain(`Pressure`)
    })
  })

  test(`keeps fallback-index and explicit-id fill hovers distinct`, async () => {
    const make_fills = (): FillRegion[] => [
      { id: `lead`, lower: 0, upper: 0.1, fill: `transparent` },
      { lower: 0.2, upper: 0.4, fill: `steelblue` },
      { id: `1`, lower: 0.5, upper: 0.7, fill: `slategray` },
    ]
    const state = { fill_regions: make_fills() }
    await mount_sized_scatter_plot(
      bind_props(
        {
          series: [{ x: [0, 1], y: [0, 1] }],
          x_axis: { range: [0, 1] as Vec2 },
          y_axis: { range: [0, 1] as Vec2 },
          legend: null,
        },
        state,
      ),
    )

    const fallback_fill = () => svg_query(`[aria-label="Fill region 1"]`)
    const explicit_id_fill = () => svg_query(`[aria-label="Fill region 2"]`)
    await hover(fallback_fill())
    expect(fallback_fill().classList.contains(`hovered`)).toBe(true)
    expect(explicit_id_fill().classList.contains(`hovered`)).toBe(false)

    state.fill_regions = make_fills()
    flushSync()
    await tick()
    expect(fallback_fill().classList.contains(`hovered`)).toBe(true)
  })

  test(`keeps unique fill ID hover stable when source index changes`, async () => {
    const state = $state({
      fill_regions: [{ id: `target`, lower: 0, upper: 0.2, fill: `steelblue` }],
    })
    mount(ScatterPlot, {
      target: document.body,
      props: bind_props(
        {
          series: [{ x: [0, 1], y: [0, 1] }],
          x_axis: { range: [0, 1] as Vec2 },
          y_axis: { range: [0, 1] as Vec2 },
          legend: null,
          style: `width: 400px; height: 300px;`,
        },
        state,
      ),
    })
    await resize_element(doc_query(`.scatter`), 400, 300)

    await hover(svg_query(`[aria-label="Fill region 0"]`))
    state.fill_regions = [
      { id: `inserted`, lower: 0.3, upper: 0.4, fill: `transparent` },
      { id: `target`, lower: 0, upper: 0.2, fill: `steelblue` },
    ]
    flushSync()
    await tick()

    const fills = document.querySelectorAll<SVGGElement>(`.fill-region`)
    expect(fills).toHaveLength(2)
    expect(fills[1].classList.contains(`hovered`)).toBe(true)
  })

  test(`keeps duplicate fill IDs keyed and hovered independently`, async () => {
    const fill_regions: FillRegion[] = [
      { id: `duplicate`, lower: 0, upper: 0.2, fill: `steelblue` },
      { id: `duplicate`, lower: 0.4, upper: 0.6, fill: `slategray` },
    ]
    await mount_sized_scatter_plot({
      series: [{ x: [0, 1], y: [0, 1] }],
      x_axis: { range: [0, 1] as Vec2 },
      y_axis: { range: [0, 1] as Vec2 },
      fill_regions,
      legend: null,
    })

    const fills = document.querySelectorAll<SVGGElement>(`.fill-region`)
    expect(fills).toHaveLength(fill_regions.length)

    await hover(fills[0])
    expect(fills[0].classList.contains(`hovered`)).toBe(true)
    expect(fills[1].classList.contains(`hovered`)).toBe(false)
  })

  test(`hidden fill keeps its legend item so it can be toggled back on`, async () => {
    const state = $state({
      fill_regions: [
        { id: `band`, label: `Band`, lower: 0, upper: 0.5, fill: `steelblue` },
      ] as FillRegion[],
    })
    mount(ScatterPlot, {
      target: document.body,
      props: bind_props(
        {
          series: [{ x: [0, 1], y: [0, 1] }],
          x_axis: { range: [0, 1] as Vec2 },
          y_axis: { range: [0, 1] as Vec2 },
          legend: {},
          style: `width: 400px; height: 300px;`,
        },
        state,
      ),
    })
    await resize_element(doc_query(`.scatter`), 400, 300)
    await tick()

    const fill_item = () =>
      [...document.querySelectorAll<HTMLElement>(`.legend-item.fill-item`)].find((el) =>
        el.textContent?.includes(`Band`),
      )

    // fill renders and has a legend item
    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(1)
    expect(fill_item()).toBeDefined()

    // hide it (what clicking the legend fill item does via the fill_regions binding)
    state.fill_regions = [{ ...state.fill_regions[0], visible: false }]
    flushSync()
    await tick()

    // fill no longer drawn, but the legend item persists (greyed) so it can be toggled back
    expect(document.querySelectorAll(`.fill-region`)).toHaveLength(0)
    expect(fill_item()?.classList.contains(`hidden`)).toBe(true)

    // hovering the hidden fill's legend item must not mark it active (nothing renders to highlight)
    fill_item()?.dispatchEvent(new MouseEvent(`mouseenter`, { bubbles: true }))
    flushSync()
    await tick()
    expect(fill_item()?.classList.contains(`active`)).toBe(false)
  })

  test(`log axis clamps non-positive fill coords to the domain floor, not a tiny epsilon`, async () => {
    // lower edge at y=0 is non-positive on a log axis: must clamp to y_min (bottom edge), not
    // 1e-10 which maps far outside the plot.
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [1, 10, 100], y: [2, 20, 80] }],
        x_axis: { range: [1, 100] as Vec2 },
        y_axis: { scale_type: `log`, range: [1, 100] as Vec2 },
        fill_regions: [{ lower: 0, upper: { type: `series`, series_idx: 0 } }],
      },
    })
    // wait for the path Tween to settle (`d` unchanged across two polls) so we read the final
    // coords, not a wild mid-animation frame — deterministic instead of a fixed sleep
    let last_d = ``
    const settled_d = await vi.waitFor(
      () => {
        const path_d = doc_query(`.fill-region path`).getAttribute(`d`) ?? ``
        const settled = path_d !== `` && path_d === last_d
        last_d = path_d
        if (!settled) throw new Error(`fill path not settled`)
        return path_d
      },
      { timeout: 2000 },
    )

    const coords = (settled_d.match(/-?\d+\.?\d*/g) ?? []).map(Number)
    expect(coords.length).toBeGreaterThan(0) // guard: Math.max(...[]) is -Infinity, a false pass
    expect(Math.max(...coords.map(Math.abs))).toBeLessThan(1000)
  })

  // Dense grid covering the whole plot so no decoration can avoid overlapping data
  const dense_grid = (grid_n: number): { x: number[]; y: number[] } => {
    const x: number[] = []
    const y: number[] = []
    for (let row = 0; row < grid_n; row++) {
      for (let col = 0; col < grid_n; col++) {
        x.push((row / (grid_n - 1)) * 100)
        y.push((col / (grid_n - 1)) * 100)
      }
    }
    return { x, y }
  }

  test(`legend auto-moves to the bottom margin when interior overlap is unavoidable`, async () => {
    const grid = dense_grid(12)
    await mount_sized_scatter_plot({
      series: [
        { ...grid, label: `Dense`, markers: `points` },
        { x: [50], y: [50], label: `B`, markers: `points` },
      ],
      legend: {},
      x_axis: { range: [0, 100] as Vec2 },
      y_axis: { range: [0, 100] as Vec2 },
    })
    await tick()
    // default interior placement would be top-left (~10px); auto-outside drops it into the
    // reserved bottom margin (~height - footprint - gap), well below mid-plot
    const legend = doc_query<HTMLElement>(`.legend`)
    expect(Number(legend.style.top.replace(`px`, ``))).toBeGreaterThan(150)
  })

  test(`non-responsive legend avoids layout reads when data changes`, async () => {
    vi.spyOn(HTMLElement.prototype, `offsetWidth`, `get`).mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, `offsetHeight`, `get`).mockReturnValue(60)
    const layout_spy = vi
      .spyOn(Element.prototype, `getBoundingClientRect`)
      .mockReturnValue(DOMRect.fromRect({ width: 100, height: 60 }))
    const series = $state<DataSeries[]>([
      { ...basic, label: `A` },
      { ...basic, label: `B` },
    ])
    const plot = await mount_sized_scatter_plot({ series, legend: { responsive: false } })
    await resize_element(plot, 401, 300)
    await tick()
    const legend = doc_query<HTMLElement>(`.legend`)
    const initial_position = { left: legend.style.left, top: legend.style.top }
    layout_spy.mockClear()

    series[0].y = [6, 4, 9, 3, 8]
    flushSync()
    await tick()
    expect(layout_spy).not.toHaveBeenCalled()
    expect({ left: legend.style.left, top: legend.style.top }).toEqual(initial_position)
  })

  // rect-zoom must zoom y2 series too when sync is 'none' (the default) - BarPlot,
  // Histogram and BoxPlot all do; only the synced/align modes derive y2 from y1
  test(`rect-zoom updates y2 range when y2 sync is 'none'`, async () => {
    const state = { y2_axis: {} as Record<string, unknown> }
    const plot = await mount_sized_scatter_plot(
      bind_props(
        {
          series: [
            { x: [1, 2, 3], y: [1, 2, 3] },
            { x: [1, 2, 3], y: [10, 20, 30], y_axis: `y2` as const },
          ],
        },
        state,
      ),
    )
    const svg = plot.querySelector(`svg[role="application"]`) // chart svg, not control icons
    if (!svg) throw new Error(`svg not found`)
    svg.dispatchEvent(
      new MouseEvent(`mousedown`, { clientX: 100, clientY: 50, bubbles: true }),
    )
    window.dispatchEvent(new MouseEvent(`mousemove`, { clientX: 300, clientY: 200 }))
    window.dispatchEvent(new MouseEvent(`mouseup`, { clientX: 300, clientY: 200 }))
    await tick()
    const y2_range = state.y2_axis.range as Vec2 | undefined
    if (!y2_range) throw new Error(`y2_axis.range not set by rect-zoom`)
    expect(y2_range.every(Number.isFinite)).toBe(true)
    expect(y2_range[0]).toBeLessThan(y2_range[1])
    expect(y2_range[1] - y2_range[0]).toBeLessThan(20) // narrower than full data span
  })

  // Regression guard for effect_update_depth_exceeded: with an explicit y range the
  // range-sync effect assigns zoom_y_range a fresh array every run, and the y2-sync
  // branch reads it back - a tracked read would re-trigger the effect forever. Svelte's
  // loop guard logs via console.error and throws, so a clean mount proves the fix.
  test(`explicit y range + y2 sync mounts without a reactive loop`, async () => {
    const errors: unknown[][] = []
    const error_spy = vi
      .spyOn(console, `error`)
      .mockImplementation((...args) => void errors.push(args))
    try {
      await mount_sized_scatter_plot({
        series: [
          { x: [1, 2, 3], y: [1, 2, 3] },
          { x: [1, 2, 3], y: [10, 20, 30], y_axis: `y2` },
        ],
        y_axis: { range: [0, 5] as Vec2 },
        y2_axis: { sync: `synced` },
      })
    } finally {
      error_spy.mockRestore()
    }
    expect(errors.map(String).join(`\n`)).toBe(``)
  })
})
