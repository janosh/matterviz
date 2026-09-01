// @vitest-environment happy-dom
import { type FillGradient, type LegendItem, PlotLegend } from '$lib/plot'
import {
  symbol as d3_symbol,
  symbolAsterisk,
  symbolCircle,
  symbolCross,
  symbolDiamond,
  symbolPlus,
  symbolSquare,
  symbolStar,
  symbolTimes,
  symbolTriangle,
  symbolWye,
} from 'd3-shape'
import { flushSync, mount, tick } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, keydown, mouse } from '../setup'

const default_series_data: LegendItem[] = [
  {
    label: `Series 1`,
    visible: true,
    series_idx: 0,
    display_style: {
      symbol_type: `Circle`,
      symbol_color: `red`,
      line_dash: `solid`,
      line_color: `red`,
    },
  },
  {
    label: `Series 2`,
    visible: false,
    series_idx: 1,
    display_style: {
      symbol_type: `Square`,
      symbol_color: `blue`,
      line_dash: `dashed`,
      line_color: `blue`,
    },
  },
  {
    label: `Series 3`,
    visible: true,
    series_idx: 2,
    display_style: {
      symbol_type: `Triangle`,
      symbol_color: `green`,
      // No line
    },
  },
  {
    label: `Series 4`,
    visible: true,
    series_idx: 3,
    display_style: {
      // No marker
      line_dash: `Dotted`,
      line_color: `purple`,
    },
  },
  {
    label: `Series 5 (Varied)`, // Test case for empty display_style
    visible: true,
    series_idx: 4,
    display_style: {},
  },
]

// Helper to simulate keyboard events
function simulate_keyboard_event(element: Element | null, key: string): void {
  if (!element) return
  const event = keydown(key)
  element.dispatchEvent(event)
}

describe(`PlotLegend`, () => {
  // Each item renders a toggle button whose marker shows its line and/or symbol style
  test.each([
    {
      idx: 0,
      pressed: `true`,
      hidden: false,
      svgs: 2,
      line: [`red`, `solid`],
      symbol: `red`,
    },
    {
      idx: 1,
      pressed: `false`,
      hidden: true,
      svgs: 2,
      line: [`blue`, `dashed`],
      symbol: `blue`,
    },
    {
      idx: 2,
      pressed: `true`,
      hidden: false,
      svgs: 1,
      line: null,
      symbol: `green`,
    },
    {
      idx: 3,
      pressed: `true`,
      hidden: false,
      svgs: 1,
      line: [`purple`, `Dotted`],
      symbol: null,
    },
    { idx: 4, pressed: `true`, hidden: false, svgs: 0, line: null, symbol: null },
  ])(`renders item $idx with its marker`, ({ idx, pressed, hidden, svgs, line, symbol }) => {
    mount(PlotLegend, { target: document.body, props: { series_data: default_series_data } })
    const wrapper = doc_query(`.legend`)
    // Default layout is vertical, 1 column
    expect(wrapper.style.gridTemplateColumns).toBe(`auto`)
    expect(wrapper.style.gridTemplateRows).toBe(`repeat(1, auto)`)
    expect(wrapper.style.gridAutoFlow).toBe(``)
    const items = document.querySelectorAll(`.legend-item`)
    expect(items).toHaveLength(default_series_data.length)

    const item = items[idx]
    const { label } = default_series_data[idx]
    expect(item.classList.contains(`hidden`)).toBe(hidden)
    expect(item.getAttribute(`role`)).toBe(`button`)
    expect(item.getAttribute(`tabindex`)).toBe(`0`)
    expect(item.getAttribute(`aria-pressed`)).toBe(pressed)
    expect(item.getAttribute(`aria-label`)).toBe(`Toggle visibility for ${label}`)
    expect(item.querySelector(`.legend-label`)?.textContent).toBe(label)
    expect(item.querySelectorAll(`.legend-marker > svg`)).toHaveLength(svgs)
    const line_el = item.querySelector(`.legend-marker line`)
    if (line) {
      expect(line_el?.getAttribute(`stroke`)).toBe(line[0])
      expect(line_el?.getAttribute(`stroke-dasharray`)).toBe(line[1])
    } else expect(line_el).toBeNull()
    const path = item.querySelector(`.legend-marker path`)
    if (symbol) expect(path?.getAttribute(`fill`)).toBe(symbol)
    else expect(path).toBeNull()
  })

  test.each([
    { layout: `horizontal`, layout_tracks: 3, columns: `repeat(3, auto)`, rows: ``, flow: `` },
    // vertical tracks are rows: 2 rows in 1 column, filled column-first
    {
      layout: `vertical`,
      layout_tracks: 2,
      columns: `auto`,
      rows: `repeat(2, auto)`,
      flow: `column`,
    },
  ] as const)(
    `$layout layout with $layout_tracks tracks`,
    ({ layout, layout_tracks, columns, rows, flow }) => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: default_series_data, layout, layout_tracks },
      })
      const wrapper = doc_query(`.legend`)
      expect(wrapper.style.gridTemplateColumns).toBe(columns)
      expect(wrapper.style.gridTemplateRows).toBe(rows)
      expect(wrapper.style.gridAutoFlow).toBe(flow)
    },
  )

  test.each([
    {
      layout: `horizontal`,
      available_edge_length: 166,
      item_extents: default_series_data.map(() => ({ width: 80, height: 20 })),
      expected_columns: `repeat(2, auto)`,
      expected_rows: ``,
      expected_auto_flow: ``,
    },
    {
      layout: `vertical`,
      available_edge_length: 41,
      item_extents: default_series_data.map(() => ({ width: 80, height: 20 })),
      expected_columns: `auto`,
      expected_rows: `repeat(2, auto)`,
      expected_auto_flow: `column`,
    },
  ] as const)(
    `auto-selects tracks for a $layout legend`,
    ({
      layout,
      available_edge_length,
      item_extents,
      expected_columns,
      expected_rows,
      expected_auto_flow,
    }) => {
      mount(PlotLegend, {
        target: document.body,
        props: {
          series_data: default_series_data,
          layout,
          layout_tracks: `auto`,
          available_edge_length,
          item_extents,
        },
      })

      const wrapper = doc_query(`.legend`)
      expect(wrapper.style.gridTemplateColumns).toBe(expected_columns)
      expect(wrapper.style.gridTemplateRows).toBe(expected_rows)
      expect(wrapper.style.gridAutoFlow).toBe(expected_auto_flow)
    },
  )

  test(`auto tracks include grouped legend headers`, () => {
    const series_data: LegendItem[] = [
      {
        label: `First`,
        visible: true,
        series_idx: 0,
        legend_group: `Group`,
        display_style: {},
      },
      {
        label: `Second`,
        visible: true,
        series_idx: 1,
        legend_group: `Group`,
        display_style: {},
      },
    ]
    mount(PlotLegend, {
      target: document.body,
      props: {
        series_data,
        layout: `vertical`,
        layout_tracks: `auto`,
        available_edge_length: 32,
        item_extents: [{ height: 10 }, { height: 10 }, { height: 10 }],
      },
    })

    expect(doc_query(`.legend`).style.gridTemplateRows).toBe(`repeat(3, auto)`)
  })

  test(`reports hovered item and marks active series`, () => {
    const on_item_hover = vi.fn()
    mount(PlotLegend, {
      target: document.body,
      props: {
        series_data: default_series_data,
        active_series_idx: 1,
        on_item_hover,
      },
    })

    const items = document.querySelectorAll(`.legend-item`)
    expect(items[1].classList.contains(`active`)).toBe(true)

    items[2].dispatchEvent(mouse(`mouseenter`))
    expect(on_item_hover).toHaveBeenLastCalledWith(expect.objectContaining({ series_idx: 2 }))

    items[2].dispatchEvent(mouse(`mouseleave`))
    expect(on_item_hover).toHaveBeenLastCalledWith(null)
  })

  test(`patterned swatches paint a half-scale tile in the item color, translucent colors included`, () => {
    const series_data: LegendItem[] = [
      {
        label: `Marker`,
        visible: true,
        series_idx: 0,
        display_style: {
          symbol_type: `Square`,
          symbol_color: `rgba(70, 130, 180, 0.5)`,
          pattern: `/`,
        },
      },
      {
        label: `Fill`,
        visible: true,
        series_idx: -1,
        item_type: `fill`,
        fill_idx: 0,
        display_style: { fill_color: `steelblue`, pattern: { shape: `dots`, size: 8 } },
      },
    ]
    mount(PlotLegend, { target: document.body, props: { series_data } })
    const [marker_def, fill_def] = document.querySelectorAll(`.legend-item pattern`)
    // 8px tile at legend scale 0.5 -> 4px swatch tile
    expect(marker_def.getAttribute(`width`)).toBe(`4`)
    // a translucent mark color has no known backdrop: the texture inherits instead of throwing
    expect(marker_def.querySelector(`rect`)?.getAttribute(`fill`)).toBe(
      `rgba(70, 130, 180, 0.5)`,
    )
    expect(marker_def.querySelector(`path`)?.getAttribute(`stroke`)).toBe(`currentColor`)
    expect(doc_query(`.legend-item path[fill^="url(#"]`).getAttribute(`fill`)).toBe(
      `url(#${marker_def.id})`,
    )
    // the fill swatch bakes its 0.7 tint into the tile and paints the rect at full opacity
    const swatch = doc_query(`.fill-swatch rect[fill^="url(#"]`)
    expect(swatch.getAttribute(`fill`)).toBe(`url(#${fill_def.id})`)
    expect(swatch.getAttribute(`fill-opacity`)).toBe(`1`)
    expect(fill_def.querySelector(`rect`)?.getAttribute(`fill`)).toBe(
      `rgba(70, 130, 180, 0.7)`,
    )
  })

  test(`fill legend items report the fill item on hover and honor active_fill_idx`, () => {
    const on_item_hover = vi.fn()
    const series_data: LegendItem[] = [
      { label: `Series 1`, visible: true, series_idx: 0, display_style: {} },
      {
        label: `Fill A`,
        visible: true,
        series_idx: -1,
        item_type: `fill`,
        fill_idx: 0,
        display_style: {},
      },
      {
        label: `Fill B`,
        visible: true,
        series_idx: -1,
        item_type: `fill`,
        fill_idx: 1,
        display_style: {},
      },
    ]
    mount(PlotLegend, {
      target: document.body,
      props: { series_data, active_fill_idx: 1, on_item_hover },
    })

    const items = document.querySelectorAll(`.legend-item`)
    // active_fill_idx=1 marks only the Fill B item (fill_idx 1), not the series or Fill A
    expect([...items].map((it) => it.classList.contains(`active`))).toEqual([
      false,
      false,
      true,
    ])

    // hovering a fill item reports the full item (with fill_idx) so the plot can highlight it
    items[1].dispatchEvent(mouse(`mouseenter`))
    expect(on_item_hover).toHaveBeenLastCalledWith(
      expect.objectContaining({ item_type: `fill`, fill_idx: 0 }),
    )
  })

  test(`filters large legends`, async () => {
    const series_data = Array.from({ length: 13 }, (_, idx): LegendItem => ({
      label: idx === 10 ? `Target series` : `Series ${idx}`,
      visible: true,
      series_idx: idx,
      display_style: {},
    }))
    mount(PlotLegend, { target: document.body, props: { series_data } })

    const filter = doc_query(`.legend-filter`, HTMLInputElement)
    filter.value = `target`
    filter.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()

    const items = document.querySelectorAll(`.legend-item`)
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain(`Target series`)
  })

  // The legend glyph is the plot's own d3 outline: filled symbols carry the color as
  // fill, d3's stroke-only ones (Asterisk, Plus, Times) as stroke
  test.each([
    [`Circle`, symbolCircle, false],
    [`Square`, symbolSquare, false],
    [`Triangle`, symbolTriangle, false],
    [`Cross`, symbolCross, false],
    [`Star`, symbolStar, false],
    [`Diamond`, symbolDiamond, false],
    [`Wye`, symbolWye, false],
    [`Plus`, symbolPlus, true],
    [`Times`, symbolTimes, true],
    [`Asterisk`, symbolAsterisk, true],
  ] as const)(`renders the %s symbol as its d3 path`, (symbol_type, shape, stroke_only) => {
    const data: LegendItem[] = [
      {
        label: `Test ${symbol_type}`,
        visible: true,
        series_idx: 0,
        display_style: { symbol_type, symbol_color: `#123456` },
      },
    ]
    mount(PlotLegend, { target: document.body, props: { series_data: data } })
    const path = doc_query(`.legend-marker > svg > path`, SVGPathElement)
    expect(path.getAttribute(`d`)).toBe(d3_symbol().type(shape).size(50)())
    expect(path.getAttribute(`fill`)).toBe(stroke_only ? `none` : `#123456`)
    expect(path.getAttribute(`stroke`)).toBe(stroke_only ? `#123456` : `none`)
  })

  test(`calls on_toggle with the series_idx on click and Enter/Space (other keys ignored)`, () => {
    const mock_toggle = vi.fn()
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data, on_toggle: mock_toggle },
    })
    const items = document.querySelectorAll<HTMLElement>(`.legend-item`)
    items[0].click()
    items[2].click()
    simulate_keyboard_event(items[1], `Enter`)
    simulate_keyboard_event(items[3], ` `)
    simulate_keyboard_event(items[0], `a`)
    expect(mock_toggle.mock.calls).toEqual([[0], [2], [1], [3]])
  })

  test(`drags from legend background and removes window listeners on mouseup`, () => {
    const [on_drag_start, on_drag, on_drag_end] = [vi.fn(), vi.fn(), vi.fn()]
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data, on_drag_start, on_drag, on_drag_end },
    })
    const legend = doc_query(`.legend`)
    legend.dispatchEvent(mouse(`mousedown`))
    flushSync()
    expect(on_drag_start).toHaveBeenCalledTimes(1)
    expect(legend.classList.contains(`is-dragging`)).toBe(true)
    window.dispatchEvent(new MouseEvent(`mousemove`))
    window.dispatchEvent(new MouseEvent(`mousemove`))
    expect(on_drag).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new MouseEvent(`mouseup`))
    flushSync()
    expect(on_drag_end).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new MouseEvent(`mousemove`))
    expect(on_drag).toHaveBeenCalledTimes(2) // listeners gone
    expect(legend.classList.contains(`is-dragging`)).toBe(false)
  })

  test(`applies style and item_style`, () => {
    // Use longhand background-color instead of shorthand background
    // because happy-dom doesn't properly parse CSS shorthand properties
    const style = `background-color: black; padding: 15px;`
    const item_style = `color: white; margin: 2px;`
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data, style, item_style },
    })

    const wrapper = doc_query(`.legend`)
    expect(wrapper.style.backgroundColor).toBe(`black`)
    expect(wrapper.style.padding).toBe(`15px`)

    const first_item = doc_query(`.legend-item`)
    expect(first_item.style.color).toBe(`white`)
    expect(first_item.style.margin).toBe(`2px`)
  })

  test(`renders correctly with empty series_data`, () => {
    mount(PlotLegend, { target: document.body, props: { series_data: [] } })
    const wrapper = doc_query(`.legend`)
    expect(wrapper).toBeInstanceOf(HTMLElement)
    expect(wrapper.querySelector(`.legend-item`)).toBeNull()
    expect(wrapper.querySelector(`.legend-filter`)).toBeNull()
  })

  test(`keeps an auto-layout empty legend on one valid CSS track`, () => {
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: [], layout_tracks: `auto`, available_edge_length: 0 },
    })
    expect(doc_query(`.legend`).style.gridTemplateRows).toBe(`repeat(1, auto)`)
  })

  describe(`legend groups`, () => {
    // Helper to create grouped test data
    const make_grouped_data = (): LegendItem[] => [
      {
        label: `Li-Li`,
        visible: true,
        series_idx: 0,
        legend_group: `Li₂O`,
        display_style: { line_color: `red` },
      },
      {
        label: `Li-O`,
        visible: true,
        series_idx: 1,
        legend_group: `Li₂O`,
        display_style: { line_color: `blue` },
      },
      {
        label: `O-O`,
        visible: false,
        series_idx: 2,
        legend_group: `Li₂O`,
        display_style: { line_color: `green` },
      },
      {
        label: `Na-Na`,
        visible: true,
        series_idx: 3,
        legend_group: `NaCl`,
        display_style: { line_color: `orange` },
      },
      {
        label: `Na-Cl`,
        visible: true,
        series_idx: 4,
        legend_group: `NaCl`,
        display_style: { line_color: `purple` },
      },
      {
        label: `Ungrouped`,
        visible: true,
        series_idx: 5,
        display_style: { line_color: `gray` },
      },
    ]

    test(`renders group controls without starting legend drag`, () => {
      const on_drag_start = vi.fn()
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data(), on_drag_start },
      })

      expect(doc_query(`.legend`).classList.contains(`grouped`)).toBe(true)
      expect(document.querySelectorAll(`.legend-group-header`)).toHaveLength(2)
      expect(document.querySelectorAll(`.legend-item`)).toHaveLength(6)
      expect(document.querySelectorAll(`.legend-item.indented`)).toHaveLength(5)

      const group_labels = Array.from(document.querySelectorAll(`.legend-group-header`)).map(
        (header) => header.querySelector(`.group-label`)?.textContent,
      )
      expect(group_labels).toEqual([`Li₂O`, `NaCl`])
      doc_query(`.group-chevron`).dispatchEvent(mouse(`mousedown`))
      expect(on_drag_start).not.toHaveBeenCalled()
    })

    test.each([
      {
        desc: `on_group_toggle called on click`,
        event_type: `click`,
        handler: `on_group_toggle`,
        group_idx: 0,
        expected_group: `Li₂O`,
        expected_indices: [0, 1, 2],
      },
      {
        desc: `filtered on_group_toggle keeps full group indices`,
        event_type: `click`,
        handler: `on_group_toggle`,
        group_idx: 0,
        filter_value: `Li-O`,
        expected_group: `Li₂O`,
        expected_indices: [0, 1, 2],
        expected_item_count: 1,
      },
      {
        desc: `on_group_double_click called on dblclick`,
        event_type: `dblclick`,
        handler: `on_group_double_click`,
        group_idx: 1,
        expected_group: `NaCl`,
        expected_indices: [3, 4],
      },
    ])(
      `$desc`,
      async ({
        event_type,
        handler,
        group_idx,
        filter_value,
        expected_group,
        expected_indices,
        expected_item_count,
      }) => {
        const mock_handler = vi.fn()
        mount(PlotLegend, {
          target: document.body,
          props: {
            series_data: make_grouped_data(),
            filter_threshold: filter_value ? 1 : undefined,
            [handler]: mock_handler,
          },
        })

        if (filter_value) {
          const filter = doc_query(`.legend-filter`, HTMLInputElement)
          filter.value = filter_value
          filter.dispatchEvent(new Event(`input`, { bubbles: true }))
          await tick()
          expect(document.querySelectorAll(`.legend-item`)).toHaveLength(expected_item_count)
        }

        const headers = document.querySelectorAll<HTMLElement>(`.legend-group-header`)
        headers[group_idx].dispatchEvent(mouse(event_type))

        expect(mock_handler).toHaveBeenCalledWith(expected_group, expected_indices)
      },
    )

    test(`chevron toggles group collapse on click and keyboard`, async () => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data() },
      })

      const chevron = doc_query(`.group-chevron`)
      expect(chevron.classList.contains(`collapsed`)).toBe(false)
      expect(document.querySelectorAll(`.legend-item`)).toHaveLength(6)

      // Click to collapse
      chevron.dispatchEvent(mouse(`click`))
      await tick()
      expect(chevron.classList.contains(`collapsed`)).toBe(true)
      expect(document.querySelectorAll(`.legend-item`)).toHaveLength(3) // 6 - 3 Li₂O items

      // Keyboard (Enter) to expand
      chevron.dispatchEvent(keydown(`Enter`))
      await tick()
      expect(chevron.classList.contains(`collapsed`)).toBe(false)
      expect(document.querySelectorAll(`.legend-item`)).toHaveLength(6)
    })

    test(`collapsed_groups prop controls initial collapse state`, async () => {
      // Start with Li₂O group collapsed via prop
      const collapsed = new SvelteSet([`Li₂O`])
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data(), collapsed_groups: collapsed },
      })

      const chevrons = document.querySelectorAll(`.group-chevron`)
      // Li₂O (first group) should be collapsed
      expect(chevrons[0].classList.contains(`collapsed`)).toBe(true)
      // NaCl (second group) should be expanded
      expect(chevrons[1].classList.contains(`collapsed`)).toBe(false)
      // Only 3 items visible (NaCl: 2 + Ungrouped: 1)
      expect(document.querySelectorAll(`.legend-item`)).toHaveLength(3)

      // Clicking chevron updates the bound set
      chevrons[0].dispatchEvent(mouse(`click`))
      await tick()
      expect(collapsed.has(`Li₂O`)).toBe(false) // Removed from set
      expect(document.querySelectorAll(`.legend-item`)).toHaveLength(6)
    })

    test(`no grouping when legend_group not set`, () => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: default_series_data },
      })

      expect(doc_query(`.legend`).classList.contains(`grouped`)).toBe(false)
      expect(document.querySelectorAll(`.legend-group-header`)).toHaveLength(0)
      expect(document.querySelectorAll(`.legend-item.indented`)).toHaveLength(0)
    })

    test.each([
      { key: `Enter`, group_idx: 0, expected_group: `Li₂O`, expected_indices: [0, 1, 2] },
      { key: ` `, group_idx: 1, expected_group: `NaCl`, expected_indices: [3, 4] },
    ])(
      `on_group_toggle called on keyboard $key`,
      ({ key, group_idx, expected_group, expected_indices }) => {
        const mock_handler = vi.fn()
        mount(PlotLegend, {
          target: document.body,
          props: { series_data: make_grouped_data(), on_group_toggle: mock_handler },
        })

        const headers = document.querySelectorAll<HTMLElement>(`.legend-group-header`)
        headers[group_idx].dispatchEvent(keydown(key))

        expect(mock_handler).toHaveBeenCalledWith(expected_group, expected_indices)
      },
    )

    test(`group header and chevron aria attributes`, async () => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data() },
      })

      // Header aria attributes
      const header = doc_query(`.legend-group-header`)
      expect(header.getAttribute(`role`)).toBe(`button`)
      expect(header.getAttribute(`tabindex`)).toBe(`0`)
      expect(header.getAttribute(`aria-expanded`)).toBe(`true`)
      expect(header.getAttribute(`aria-label`)).toBe(`Toggle group Li₂O`)

      // Chevron aria updates on collapse
      const chevron = doc_query(`.group-chevron`)
      expect(chevron.getAttribute(`aria-label`)).toBe(`Collapse group Li₂O`)
      chevron.dispatchEvent(mouse(`click`))
      await tick()
      expect(chevron.getAttribute(`aria-label`)).toBe(`Expand group Li₂O`)
    })

    test.each([
      {
        desc: `all hidden shows hidden class`,
        visibilities: [false, false],
        expected_hidden: true,
      },
      {
        desc: `mixed visibility shows no hidden class`,
        visibilities: [false, true],
        expected_hidden: false,
      },
    ])(`group header $desc`, ({ visibilities, expected_hidden }) => {
      const data: LegendItem[] = visibilities.map((vis, idx) => ({
        label: `Item${idx}`,
        visible: vis,
        series_idx: idx,
        legend_group: `Group`,
        display_style: {},
      }))
      mount(PlotLegend, { target: document.body, props: { series_data: data } })
      expect(doc_query(`.legend-group-header`).classList.contains(`hidden`)).toBe(
        expected_hidden,
      )
    })

    test(`clicking group header toggles visibility without collapsing`, () => {
      const mock_toggle = vi.fn()
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data(), on_group_toggle: mock_toggle },
      })

      const header = doc_query(`.legend-group-header`)
      const chevron = doc_query(`.group-chevron`)

      header.dispatchEvent(mouse(`click`))

      expect(mock_toggle).toHaveBeenCalled()
      expect(chevron.classList.contains(`collapsed`)).toBe(false)
    })
  })

  describe(`fill region legend items`, () => {
    const fill_item = (
      display_style: LegendItem[`display_style`],
      extra: Partial<LegendItem> = {},
    ): LegendItem => ({
      label: `Fill`,
      visible: true,
      series_idx: -1, // fill items use fill_idx instead
      item_type: `fill`,
      fill_idx: 0,
      fill_source_type: `fill_region`,
      fill_source_idx: 0,
      display_style,
      ...extra,
    })
    const mount_fills = (series_data: LegendItem[], props: Record<string, unknown> = {}) =>
      mount(PlotLegend, { target: document.body, props: { series_data, ...props } })
    const fill_series_data: LegendItem[] = [
      {
        label: `Data Series`,
        visible: true,
        series_idx: 0,
        display_style: { symbol_type: `Circle`, symbol_color: `blue` },
      },
      fill_item(
        { fill_color: `steelblue`, fill_opacity: 0.3, edge_color: `darkblue` },
        { label: `Fill Region` },
      ),
      fill_item(
        { fill_color: `red`, fill_opacity: 0.5 },
        { label: `Hidden Fill`, visible: false, fill_idx: 1, fill_source_idx: 1 },
      ),
    ]

    test(`renders fill swatch with correct styling and hidden state`, () => {
      mount_fills(fill_series_data)
      const items = document.querySelectorAll(`.legend-item`)

      // Regular series: no fill swatch
      expect(items[0].classList.contains(`fill-item`)).toBe(false)
      expect(items[0].querySelector(`.fill-swatch`)).toBeNull()

      // Fill region: has swatch with correct styling
      expect(items[1].classList.contains(`fill-item`)).toBe(true)
      const rect = items[1].querySelector(`.fill-swatch rect`)
      expect(rect?.getAttribute(`fill`)).toBe(`rgb(70, 130, 180)`)
      expect(rect?.getAttribute(`stroke`)).toBe(`darkblue`)

      // Hidden state
      expect(items[1].classList.contains(`hidden`)).toBe(false)
      expect(items[2].classList.contains(`hidden`)).toBe(true)
    })

    test(`fill items route click/keyboard/dblclick to the fill handlers`, () => {
      const on_toggle = vi.fn()
      const on_fill_toggle = vi.fn()
      const on_fill_double_click = vi.fn()
      mount_fills(fill_series_data, { on_toggle, on_fill_toggle, on_fill_double_click })
      const items = document.querySelectorAll<HTMLElement>(`.legend-item`)

      // Regular series click → on_toggle
      items[0].click()
      expect(on_toggle).toHaveBeenCalledWith(0)
      expect(on_fill_toggle).not.toHaveBeenCalled()
      on_toggle.mockClear()

      // Fill item click → on_fill_toggle with source_type and source_idx
      items[1].click()
      expect(on_fill_toggle).toHaveBeenCalledWith(`fill_region`, 0)
      expect(on_toggle).not.toHaveBeenCalled()
      on_fill_toggle.mockClear()

      // Fill item keyboard → on_fill_toggle
      items[1].dispatchEvent(keydown(`Enter`))
      expect(on_fill_toggle).toHaveBeenCalledWith(`fill_region`, 0)
      items[1].dispatchEvent(mouse(`dblclick`))
      expect(on_fill_double_click).toHaveBeenCalledWith(`fill_region`, 0)
    })

    test(`fill swatch uses defaults for missing opacity and edge`, () => {
      mount_fills([fill_item({ fill_color: `green` })]) // no fill_opacity or edge_color
      const rect = doc_query(`.fill-swatch rect`)
      expect(rect.getAttribute(`stroke`)).toBe(`none`)
      // default case (no display_style.fill_opacity) still renders the chip's fixed 0.7 opacity
      expect(rect.getAttribute(`fill-opacity`)).toBe(`0.7`)
    })

    // plot fills bake translucency into the color (e.g. rgba(...,0.15)); the legend chip forces the
    // color opaque so different fill colors stay distinguishable (fill-opacity alone can't override
    // the color's own alpha channel)
    test.each([
      [`rgba(52, 152, 219, 0.15)`, `rgb(52, 152, 219)`],
      [`rgba(231, 76, 60, 0.25)`, `rgb(231, 76, 60)`],
      [`#2ecc71`, `rgb(46, 204, 113)`],
    ])(`fill swatch renders %s opaque so colors stay distinct`, (fill_color, expected) => {
      mount_fills([fill_item({ fill_color, fill_opacity: 0.15 })])
      const rect = doc_query(`.fill-swatch rect`)
      // color forced opaque (strips faint baked-in alpha), then a light uniform fill-opacity
      expect(rect.getAttribute(`fill`)).toBe(expected)
      expect(rect.getAttribute(`fill-opacity`)).toBe(`0.7`)
    })

    test(`renders linear gradient swatch when fill_gradient provided`, () => {
      const gradient: FillGradient = {
        type: `linear`,
        angle: 90,
        stops: [
          [0, `red`],
          [0.5, `yellow`],
          [1, `green`],
        ],
      }
      mount_fills([
        fill_item({ fill_color: `yellow`, fill_gradient: gradient }, { fill_idx: 3 }),
      ])

      // Check gradient def is rendered (ID includes instance_id for uniqueness)
      const linear_grad = doc_query(`linearGradient`)
      expect(linear_grad.id).toMatch(/^legend-grad-.+-3$/) // legend-grad-<instance token>-<fill_idx>
      expect(linear_grad.getAttribute(`gradientTransform`)).toBe(`rotate(90, 0.5, 0.5)`)

      const stops = linear_grad.querySelectorAll(`stop`)
      expect(stops).toHaveLength(3)
      expect(stops[0].getAttribute(`offset`)).toBe(`0%`)
      expect(stops[0].getAttribute(`stop-color`)).toBe(`red`)
      expect(stops[1].getAttribute(`offset`)).toBe(`50%`)
      expect(stops[1].getAttribute(`stop-color`)).toBe(`yellow`)

      // Check rect uses gradient url (references the gradient by its ID)
      const rect = doc_query(`.fill-swatch rect`)
      expect(rect.getAttribute(`fill`)).toBe(`url(#${linear_grad.id})`)
    })

    test(`renders radial gradient swatch`, () => {
      const gradient: FillGradient = {
        type: `radial`,
        center: { x: 0.3, y: 0.7 },
        stops: [
          [0, `white`],
          [1, `black`],
        ],
      }
      mount_fills([
        fill_item({ fill_color: `gray`, fill_gradient: gradient }, { fill_idx: 5 }),
      ])

      const radial_grad = doc_query(`radialGradient`)
      expect(radial_grad.id).toMatch(/^legend-grad-.+-5$/) // legend-grad-<instance token>-<fill_idx>
      expect(radial_grad.getAttribute(`cx`)).toBe(`0.3`)
      expect(radial_grad.getAttribute(`cy`)).toBe(`0.7`)

      const rect = doc_query(`.fill-swatch rect`)
      expect(rect.getAttribute(`fill`)).toBe(`url(#${radial_grad.id})`)
    })
  })
})
