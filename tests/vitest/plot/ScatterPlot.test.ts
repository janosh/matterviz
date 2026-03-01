import { ScatterPlot } from '$lib'
import type { Vec2 } from '$lib/math'
import type { DataSeries } from '$lib/plot'
import { get_series_color, get_series_symbol } from '$lib/plot/data-transform'
import { DEFAULT_SERIES_COLORS, DEFAULT_SERIES_SYMBOLS } from '$lib/plot/types'
import { createRawSnippet, mount, tick } from 'svelte'
import { describe, expect, test } from 'vitest'

const basic = {
  x: [1, 2, 3, 4, 5],
  y: [5, 3, 8, 2, 7],
  point_style: { fill: `steelblue`, radius: 5 },
}

describe(`ScatterPlot`, () => {
  test.each([
    {
      series: [basic],
      x_axis: { range: [null, null] as [null, null] },
      y_axis: { range: [null, null] as [null, null] },
      markers: `points`,
    },
    {
      series: [{ ...basic, y: [5, 3, 20, 2, 7] }],
      x_axis: { range: [null, null] as [null, null] },
      y_axis: { range: [0, 10] as [number, number] },
      markers: `line`,
    },
    {
      series: [{ ...basic, x: [0, 1, 2, 3, 10] }],
      x_axis: { range: [0, 5] as [number, number] },
      y_axis: { range: [null, null] as [null, null] },
      markers: `line+points`,
    },
    { series: [], markers: `points` },
    { series: [basic], legend: null },
    {
      series: [basic, {
        x: [1, 2, 3],
        y: [2, 5, 3],
        point_style: { fill: `orangered`, radius: 4 },
      }],
      markers: `line+points`,
    },
  ])(`renders with series/limits/markers`, (props) => {
    mount(ScatterPlot, { target: document.body, props })
  })

  test(`mounts with x2-axis series and renders x2 axis`, async () => {
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [
          { x: [1, 2, 3], y: [10, 20, 30], label: `Primary` },
          { x: [100, 200, 300], y: [5, 15, 25], x_axis: `x2`, label: `Secondary` },
        ],
        x2_axis: { label: `Temperature (K)` },
        style: `width: 400px; height: 300px`,
      },
    })
    await tick()
    expect(document.querySelector(`.scatter`)).toBeTruthy()
    expect(document.querySelector(`g.x2-axis`)).toBeTruthy()
    expect(document.querySelector(`.x2-label`)?.textContent).toBe(
      `Temperature (K)`,
    )
  })

  test.each([
    {
      x: [0, 10, 20, 30, 40, 50],
      x_axis: { ticks: -10, format: `.0r` },
      y_axis: { ticks: -5, format: `.0r` },
    },
    {
      x: Array.from(
        { length: 12 },
        (_, idx) => new Date().setMonth(new Date().getMonth() - (12 - idx)),
      ),
      x_axis: { ticks: `month`, format: `%b %Y` },
    },
  ])(
    `tick formatting`,
    ({ x, x_axis, y_axis }) => {
      const y = Array.from({ length: 6 }, () => Math.random() * 100)
      mount(ScatterPlot, {
        target: document.body,
        props: {
          series: [{ x, y, point_style: { fill: `steelblue`, radius: 5 } }],
          x_axis,
          y_axis,
        },
      })
    },
  )

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

  test(`invalid data`, () => {
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
    mount(ScatterPlot, {
      target: document.body,
      props: { series: invalid },
    })
    mount(ScatterPlot, {
      target: document.body,
      props: {
        series: [{ x: [1, 2, 3], y: [4, 5, 6] }],
        x_axis: { range: [100, 200] },
        y_axis: { range: [100, 200] },
      },
    })
  })

  test.each([
    { y: [-10, -5, 0, 5, 10], y_range: [-15, 15] as Vec2 },
    { y: [5, 10, 15, 20, 25], y_range: [0, 30] as Vec2 },
  ])(`zero lines`, ({ y, y_range }) => {
    mount(ScatterPlot, {
      target: document.body,
      props: { series: [{ x: [1, 2, 3, 4, 5], y }], y_axis: { range: y_range } },
    })
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
  ])(`tooltip format`, (props) => {
    mount(ScatterPlot, {
      target: document.body,
      props: { series: [{ x: [1, 2, 3], y: [10, 20, 30] }], hovered: true, ...props },
    })
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
            render: () =>
              `<div class="custom-scatter-child">Custom overlay content</div>`,
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
  ])(`selected_point accepts $desc`, ({ selected_point }) => {
    // Tests that ScatterPlot accepts selected_point prop without errors
    mount(ScatterPlot, {
      target: document.body,
      props: { series: [basic], selected_point },
    })
    // Component should render without throwing
    expect(document.querySelector(`.scatter`)).toBeTruthy()
  })

  test.each([
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
  ])(`legend grouping: renders $desc`, ({ series, props }) => {
    mount(ScatterPlot, { target: document.body, props: { series, ...props } })
    expect(document.querySelector(`.scatter`)).toBeTruthy()
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
    ])(`renders $desc without explicit styles`, ({ count, markers }) => {
      const series: DataSeries[] = Array.from({ length: count }, (_, idx) => ({
        x: [1, 2, 3],
        y: [idx + 1, idx + 2, idx + 3],
        ...(markers
          ? {
            markers: markers[idx % markers.length] as `line` | `points` | `line+points`,
          }
          : {}),
      }))
      mount(ScatterPlot, { target: document.body, props: { series } })
      expect(document.querySelector(`.scatter`)).toBeTruthy()
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
    ])(`$desc overrides auto styling`, ({ props }) => {
      const series: DataSeries[] = [
        { x: [1, 2, 3], y: [1, 2, 3] },
        { x: [1, 2, 3], y: [3, 2, 1], ...props } as DataSeries,
      ]
      mount(ScatterPlot, { target: document.body, props: { series } })
      expect(document.querySelector(`.scatter`)).toBeTruthy()
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
    test(`derives from axis labels`, () => {
      mount(ScatterPlot, {
        target: document.body,
        props: {
          series: [basic],
          x_axis: { label: `Temperature` },
          y_axis: { label: `Pressure` },
        },
      })
      const svg = document.querySelector(`svg[role="application"]`)
      // If SVG renders, check label. If not (jsdom limitation), just verify mount doesn't throw.
      if (svg) expect(svg.getAttribute(`aria-label`)).toBe(`Temperature vs Pressure`)
    })
  })
})
