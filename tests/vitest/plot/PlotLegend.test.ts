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
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'
import { describe, expect, test, vi } from 'vitest'
import { doc_query, keydown, mouse } from '../setup'

const legend_item = (
  label: string,
  series_idx: number,
  display_style: LegendItem['display_style'] = {},
  extra: Partial<LegendItem> = {},
): LegendItem => ({ label, visible: true, series_idx, display_style, ...extra })
const mount_legend = (props: Partial<ComponentProps<typeof PlotLegend>> = {}) =>
  mount(PlotLegend, {
    target: document.body,
    props: { series_data: default_series_data, ...props },
  })

const default_series_data: LegendItem[] = [
  legend_item(`Series 1`, 0, {
    symbol_type: `Circle`,
    symbol_color: `red`,
    line_dash: `solid`,
    line_color: `red`,
  }),
  legend_item(
    `Series 2`,
    1,
    {
      symbol_type: `Square`,
      symbol_color: `blue`,
      line_dash: `dashed`,
      line_color: `blue`,
    },
    { visible: false },
  ),
  legend_item(`Series 3`, 2, {
    symbol_type: `Triangle`,
    symbol_color: `green`,
    // No line
  }),
  legend_item(`Series 4`, 3, {
    // No marker
    line_dash: `Dotted`,
    line_color: `purple`,
  }),
  legend_item(`Series 5 (Varied)`, 4),
]

describe(`PlotLegend`, () => {
  // Each item renders a toggle button whose marker shows its line and/or symbol style
  test.each([
    [0, `true`, false, 2, [`red`, `solid`], `red`],
    [1, `false`, true, 2, [`blue`, `dashed`], `blue`],
    [2, `true`, false, 1, null, `green`],
    [3, `true`, false, 1, [`purple`, `Dotted`], null],
    [4, `true`, false, 0, null, null],
  ] as const)(
    `renders item %i with its marker`,
    (idx, pressed, hidden, svgs, line, symbol) => {
      mount_legend()
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
    },
  )

  test.each([
    [`horizontal`, 3, undefined, `repeat(3, auto)`, ``, ``],
    // Vertical tracks are rows in one column, filled column-first.
    [`vertical`, 2, undefined, `auto`, `repeat(2, auto)`, `column`],
    [`horizontal`, `auto`, 166, `repeat(2, auto)`, ``, ``],
    [`vertical`, `auto`, 41, `auto`, `repeat(2, auto)`, `column`],
  ] as const)(
    `%s layout with %s tracks`,
    (layout, layout_tracks, available_edge_length, columns, rows, flow) => {
      mount_legend({
        layout,
        layout_tracks,
        available_edge_length,
        ...(layout_tracks === `auto`
          ? { item_extents: default_series_data.map(() => ({ width: 80, height: 20 })) }
          : {}),
      })
      const { style } = doc_query(`.legend`)
      expect(style.gridTemplateColumns).toBe(columns)
      expect(style.gridTemplateRows).toBe(rows)
      expect(style.gridAutoFlow).toBe(flow)
    },
  )

  test(`auto tracks include grouped legend headers`, () => {
    const series_data: LegendItem[] = [
      legend_item(`First`, 0, {}, { legend_group: `Group` }),
      legend_item(`Second`, 1, {}, { legend_group: `Group` }),
    ]
    mount_legend({
      series_data,
      layout: `vertical`,
      layout_tracks: `auto`,
      available_edge_length: 32,
      item_extents: [{ height: 10 }, { height: 10 }, { height: 10 }],
    })

    expect(doc_query(`.legend`).style.gridTemplateRows).toBe(`repeat(3, auto)`)
  })

  test(`reports hovered item and marks active series`, () => {
    const on_item_hover = vi.fn()
    mount_legend({ active_series_idx: 1, on_item_hover })

    const items = document.querySelectorAll(`.legend-item`)
    expect(items[1].classList.contains(`active`)).toBe(true)

    items[2].dispatchEvent(mouse(`mouseenter`))
    expect(on_item_hover).toHaveBeenLastCalledWith(expect.objectContaining({ series_idx: 2 }))

    items[2].dispatchEvent(mouse(`mouseleave`))
    expect(on_item_hover).toHaveBeenLastCalledWith(null)
  })

  test(`patterned swatches paint a half-scale tile in the item color, translucent colors included`, () => {
    const series_data: LegendItem[] = [
      legend_item(`Marker`, 0, {
        symbol_type: `Square`,
        symbol_color: `rgba(70, 130, 180, 0.5)`,
        pattern: `/`,
      }),
      legend_item(
        `Fill`,
        -1,
        { fill_color: `steelblue`, pattern: { shape: `dots`, size: 8 } },
        { item_type: `fill`, fill_idx: 0 },
      ),
    ]
    mount_legend({ series_data })
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
      legend_item(`Series 1`, 0),
      legend_item(`Fill A`, -1, {}, { item_type: `fill`, fill_idx: 0 }),
      legend_item(`Fill B`, -1, {}, { item_type: `fill`, fill_idx: 1 }),
    ]
    mount_legend({ series_data, active_fill_idx: 1, on_item_hover })

    const items = document.querySelectorAll(`.legend-item`)
    // active_fill_idx=1 marks only the Fill B item (fill_idx 1), not the series or Fill A
    expect([...items].map((item) => item.classList.contains(`active`))).toEqual([
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
    const series_data = Array.from({ length: 13 }, (_, idx): LegendItem =>
      legend_item(idx === 10 ? `Target series` : `Series ${idx}`, idx),
    )
    mount_legend({ series_data })

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
      legend_item(`Test ${symbol_type}`, 0, { symbol_type, symbol_color: `#123456` }),
    ]
    mount_legend({ series_data: data })
    const path = doc_query(`.legend-marker > svg > path`, SVGPathElement)
    expect(path.getAttribute(`d`)).toBe(d3_symbol().type(shape).size(50)())
    expect(path.getAttribute(`fill`)).toBe(stroke_only ? `none` : `#123456`)
    expect(path.getAttribute(`stroke`)).toBe(stroke_only ? `#123456` : `none`)
  })

  test(`calls on_toggle with the series_idx on click and Enter/Space (other keys ignored)`, () => {
    const mock_toggle = vi.fn()
    mount_legend({ on_toggle: mock_toggle })
    const items = document.querySelectorAll<HTMLElement>(`.legend-item`)
    items[0].click()
    items[2].click()
    items[1].dispatchEvent(keydown(`Enter`))
    items[3].dispatchEvent(keydown(` `))
    items[0].dispatchEvent(keydown(`a`))
    expect(mock_toggle.mock.calls).toEqual([[0], [2], [1], [3]])
  })

  test(`drags from legend background and removes window listeners on mouseup`, () => {
    const [on_drag_start, on_drag, on_drag_end] = [vi.fn(), vi.fn(), vi.fn()]
    mount_legend({ on_drag_start, on_drag, on_drag_end })
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
    mount_legend({ style, item_style })

    const wrapper = doc_query(`.legend`)
    expect(wrapper.style.backgroundColor).toBe(`black`)
    expect(wrapper.style.padding).toBe(`15px`)

    const first_item = doc_query(`.legend-item`)
    expect(first_item.style.color).toBe(`white`)
    expect(first_item.style.margin).toBe(`2px`)
  })

  test(`renders correctly with empty series_data`, () => {
    mount_legend({ series_data: [] })
    const wrapper = doc_query(`.legend`)
    expect(wrapper).toBeInstanceOf(HTMLElement)
    expect(wrapper.querySelector(`.legend-item`)).toBeNull()
    expect(wrapper.querySelector(`.legend-filter`)).toBeNull()
  })

  test(`keeps an auto-layout empty legend on one valid CSS track`, () => {
    mount_legend({ series_data: [], layout_tracks: `auto`, available_edge_length: 0 })
    expect(doc_query(`.legend`).style.gridTemplateRows).toBe(`repeat(1, auto)`)
  })

  describe(`legend groups`, () => {
    // Helper to create grouped test data
    const make_grouped_data = (): LegendItem[] => [
      legend_item(`Li-Li`, 0, { line_color: `red` }, { legend_group: `Li₂O` }),
      legend_item(`Li-O`, 1, { line_color: `blue` }, { legend_group: `Li₂O` }),
      legend_item(`O-O`, 2, { line_color: `green` }, { visible: false, legend_group: `Li₂O` }),
      legend_item(`Na-Na`, 3, { line_color: `orange` }, { legend_group: `NaCl` }),
      legend_item(`Na-Cl`, 4, { line_color: `purple` }, { legend_group: `NaCl` }),
      legend_item(`Ungrouped`, 5, { line_color: `gray` }),
    ]

    test(`renders group controls without starting legend drag`, () => {
      const on_drag_start = vi.fn()
      mount_legend({ series_data: make_grouped_data(), on_drag_start })

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
      [`click`, 0, `Li₂O`, [0, 1, 2], undefined],
      [`click`, 0, `Li₂O`, [0, 1, 2], `Li-O`],
      [`dblclick`, 1, `NaCl`, [3, 4], undefined],
      [`Enter`, 0, `Li₂O`, [0, 1, 2], undefined],
      [` `, 1, `NaCl`, [3, 4], undefined],
    ] as const)(
      `group event %s targets group %i: case %#`,
      async (event, group_idx, group, indices, filter_value) => {
        const handler = vi.fn()
        mount_legend({
          series_data: make_grouped_data(),
          filter_threshold: filter_value ? 1 : undefined,
          [event === `dblclick` ? `on_group_double_click` : `on_group_toggle`]: handler,
        })
        if (filter_value) {
          const filter = doc_query(`.legend-filter`, HTMLInputElement)
          filter.value = filter_value
          filter.dispatchEvent(new Event(`input`, { bubbles: true }))
          await tick()
          expect(document.querySelectorAll(`.legend-item`)).toHaveLength(1)
        }
        const header =
          document.querySelectorAll<HTMLElement>(`.legend-group-header`)[group_idx]
        header.dispatchEvent(
          event === `click` || event === `dblclick` ? mouse(event) : keydown(event),
        )
        expect(handler).toHaveBeenCalledWith(group, indices)
      },
    )

    test(`chevron toggles group collapse on click and keyboard`, async () => {
      mount_legend({ series_data: make_grouped_data() })

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
      mount_legend({ series_data: make_grouped_data(), collapsed_groups: collapsed })

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
      mount_legend()

      expect(doc_query(`.legend`).classList.contains(`grouped`)).toBe(false)
      expect(document.querySelectorAll(`.legend-group-header`)).toHaveLength(0)
      expect(document.querySelectorAll(`.legend-item.indented`)).toHaveLength(0)
    })

    test(`group header and chevron aria attributes`, async () => {
      mount_legend({ series_data: make_grouped_data() })

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
      const data: LegendItem[] = visibilities.map((vis, idx) =>
        legend_item(`Item${idx}`, idx, {}, { visible: vis, legend_group: `Group` }),
      )
      mount_legend({ series_data: data })
      expect(doc_query(`.legend-group-header`).classList.contains(`hidden`)).toBe(
        expected_hidden,
      )
    })

    test(`clicking group header toggles visibility without collapsing`, () => {
      const mock_toggle = vi.fn()
      mount_legend({ series_data: make_grouped_data(), on_group_toggle: mock_toggle })

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
      mount_legend({ series_data, ...props })
    const fill_series_data: LegendItem[] = [
      legend_item(`Data Series`, 0, { symbol_type: `Circle`, symbol_color: `blue` }),
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

    test.each<[FillGradient, string, number, Record<string, string>]>([
      [
        {
          type: `linear`,
          angle: 90,
          stops: [
            [0, `red`],
            [0.5, `yellow`],
            [1, `green`],
          ],
        },
        `yellow`,
        3,
        { gradientTransform: `rotate(90, 0.5, 0.5)` },
      ],
      [
        {
          type: `radial`,
          center: { x: 0.3, y: 0.7 },
          stops: [
            [0, `white`],
            [1, `black`],
          ],
        },
        `gray`,
        5,
        { cx: `0.3`, cy: `0.7` },
      ],
    ])(`renders gradient swatch %j`, (gradient, fill_color, fill_idx, attributes) => {
      mount_fills([fill_item({ fill_color, fill_gradient: gradient }, { fill_idx })])
      const element = doc_query(`${gradient.type}Gradient`)
      // IDs include an instance token and the fill index; the chip must reference that exact ID.
      expect(element.id).toMatch(new RegExp(`^legend-grad-.+-${fill_idx}$`))
      expect(doc_query(`.fill-swatch rect`).getAttribute(`fill`)).toBe(`url(#${element.id})`)
      for (const [name, value] of Object.entries(attributes))
        expect(element.getAttribute(name)).toBe(value)
      const stops = element.querySelectorAll(`stop`)
      expect(stops).toHaveLength(gradient.stops.length)
      for (const [idx, [offset, color]] of gradient.stops.entries()) {
        expect(stops[idx].getAttribute(`offset`)).toBe(`${offset * 100}%`)
        expect(stops[idx].getAttribute(`stop-color`)).toBe(color)
      }
    })
  })
})
