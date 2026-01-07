// @vitest-environment happy-dom
import { type LegendItem, PlotLegend } from '$lib/plot'
import { mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

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
  const event = new KeyboardEvent(`keydown`, { key, bubbles: true })
  element.dispatchEvent(event)
}

describe(`PlotLegend`, () => {
  test(`renders with default props and basic data`, () => {
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data },
    })

    const wrapper = doc_query(`.legend`)
    expect(wrapper).toBeTruthy()
    // Default layout is vertical, 1 column
    expect(wrapper.style.gridTemplateColumns).toBe(`auto`)
    expect(wrapper.style.gridTemplateRows).toBe(`repeat(1, auto)`)

    const items = document.querySelectorAll(`.legend-item`)
    expect(items.length).toBe(default_series_data.length)

    // Check first item details (visible)
    const first_item = items[0]
    expect(first_item.classList.contains(`hidden`)).toBe(false)
    expect(first_item.getAttribute(`role`)).toBe(`button`)
    expect(first_item.getAttribute(`tabindex`)).toBe(`0`)
    expect(first_item.getAttribute(`aria-pressed`)).toBe(`true`)
    expect(first_item.getAttribute(`aria-label`)).toBe(
      `Toggle visibility for Series 1`,
    )
    expect(first_item.querySelector(`.legend-label`)?.textContent).toBe(
      `Series 1`,
    )
    const first_marker_svgs = first_item.querySelectorAll(`.legend-marker > svg`)
    expect(first_marker_svgs.length).toBe(2) // line + marker
    expect(
      first_marker_svgs[0].querySelector(`line`)?.getAttribute(`stroke`),
    ).toBe(`red`)
    expect(
      first_marker_svgs[0]
        .querySelector(`line`)
        ?.getAttribute(`stroke-dasharray`),
    ).toBe(`solid`)
    expect(
      first_marker_svgs[1].querySelector(`circle`)?.getAttribute(`fill`),
    ).toBe(`red`)

    // Check second item (hidden)
    const second_item = items[1]
    expect(second_item.classList.contains(`hidden`)).toBe(true)
    expect(second_item.getAttribute(`role`)).toBe(`button`)
    expect(second_item.getAttribute(`tabindex`)).toBe(`0`)
    expect(second_item.getAttribute(`aria-pressed`)).toBe(`false`)
    expect(second_item.getAttribute(`aria-label`)).toBe(
      `Toggle visibility for Series 2`,
    )
    expect(second_item.querySelector(`.legend-label`)?.textContent).toBe(
      `Series 2`,
    )
    const second_marker_svgs = second_item.querySelectorAll(`.legend-marker > svg`)
    expect(second_marker_svgs.length).toBe(2) // line + marker
    expect(
      second_marker_svgs[0].querySelector(`line`)?.getAttribute(`stroke`),
    ).toBe(`blue`)
    expect(
      second_marker_svgs[0]
        .querySelector(`line`)
        ?.getAttribute(`stroke-dasharray`),
    ).toBe(`dashed`)
    expect(
      second_marker_svgs[1].querySelector(`rect`)?.getAttribute(`fill`),
    ).toBe(`blue`)

    // Check item with only marker
    const third_item = items[2]
    expect(third_item.getAttribute(`aria-pressed`)).toBe(`true`)
    const third_marker_svgs = third_item.querySelectorAll(`.legend-marker > svg`)
    expect(third_marker_svgs.length).toBe(1) // Only marker shape svg
    expect(third_marker_svgs[0].querySelector(`polygon`)).toBeTruthy() // triangle
    expect(
      third_marker_svgs[0].querySelector(`polygon`)?.getAttribute(`fill`),
    ).toBe(`green`)

    // Check item with only line
    const fourth_item = items[3]
    expect(fourth_item.getAttribute(`aria-pressed`)).toBe(`true`)
    const fourth_marker_svgs = fourth_item.querySelectorAll(`.legend-marker > svg`)
    expect(fourth_marker_svgs.length).toBe(1) // Only line svg
    expect(fourth_marker_svgs[0].querySelector(`line`)).toBeTruthy() // line
    expect(
      fourth_marker_svgs[0].querySelector(`line`)?.getAttribute(`stroke`),
    ).toBe(`purple`)
    expect(
      fourth_marker_svgs[0]
        .querySelector(`line`)
        ?.getAttribute(`stroke-dasharray`),
    ).toBe(`Dotted`)

    // Check item with empty display_style (FIXED assertion)
    const fifth_item = items[4]
    expect(fifth_item.getAttribute(`aria-pressed`)).toBe(`true`)
    const fifth_marker_span = fifth_item.querySelector(`.legend-marker`)
    expect(fifth_marker_span?.querySelector(`svg`)).toBeNull() // Check no SVG rendered inside
  })

  test(`applies horizontal layout correctly`, () => {
    mount(PlotLegend, {
      target: document.body,
      props: {
        series_data: default_series_data,
        layout: `horizontal`,
        layout_tracks: 3, // 3 columns
      },
    })

    const wrapper = doc_query(`.legend`)
    expect(wrapper.style.gridTemplateColumns).toBe(`repeat(3, auto)`)
    expect(wrapper.style.gridTemplateRows).toBe(``) // No rows constraint for horizontal
  })

  test(`applies vertical layout correctly with multiple rows (n_items > 1)`, () => {
    mount(PlotLegend, {
      target: document.body,
      props: {
        series_data: default_series_data,
        layout: `vertical`,
        layout_tracks: 2, // Request 2 rows (uncommon, implies 1 column over 2 rows)
      },
    })

    const wrapper = doc_query(`.legend`)
    expect(wrapper.style.gridTemplateColumns).toBe(`auto`) // Still 1 column
    expect(wrapper.style.gridTemplateRows).toBe(`repeat(2, auto)`) // 2 rows defined
  })

  test(`renders different marker shapes and line types`, () => {
    const test_data: LegendItem[] = [
      {
        label: `Circle/Solid`,
        visible: true,
        series_idx: 0,
        display_style: {
          symbol_type: `Circle`,
          line_dash: `solid`,
          line_color: `currentColor`,
        },
      },
      {
        label: `Square/Dashed`,
        visible: true,
        series_idx: 1,
        display_style: {
          symbol_type: `Square`,
          line_dash: `dashed`,
          line_color: `currentColor`,
        },
      },
      {
        label: `Triangle/Dotted`,
        visible: true,
        series_idx: 2,
        display_style: {
          symbol_type: `Triangle`,
          line_dash: `dotted`,
          line_color: `currentColor`,
        },
      },
      {
        label: `Cross`,
        visible: true,
        series_idx: 3,
        display_style: { symbol_type: `Cross`, symbol_color: `orange` }, // Added color
      },
      {
        label: `Star`,
        visible: true,
        series_idx: 4,
        display_style: { symbol_type: `Star`, symbol_color: `magenta` }, // Added color
      },
    ]
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: test_data },
    })

    const items = document.querySelectorAll(`.legend-item`)
    expect(items.length).toBe(5)

    // Circle/Solid
    const item1_marker_svgs = items[0].querySelectorAll(`.legend-marker > svg`)
    expect(item1_marker_svgs.length).toBe(2) // Line + Marker
    expect(
      item1_marker_svgs[0]
        .querySelector(`line`)
        ?.getAttribute(`stroke-dasharray`),
    ).toBe(`solid`)
    expect(item1_marker_svgs[1].querySelector(`circle`)).toBeTruthy()
    expect(
      item1_marker_svgs[1].querySelector(`circle`)?.getAttribute(`fill`),
    ).toBe(`currentColor`) // Default color

    // Square/Dashed
    const item2_marker_svgs = items[1].querySelectorAll(`.legend-marker > svg`)
    expect(item2_marker_svgs.length).toBe(2)
    expect(
      item2_marker_svgs[0]
        .querySelector(`line`)
        ?.getAttribute(`stroke-dasharray`),
    ).toBe(`dashed`)
    expect(item2_marker_svgs[1].querySelector(`rect`)).toBeTruthy()
    expect(
      item2_marker_svgs[1].querySelector(`rect`)?.getAttribute(`fill`),
    ).toBe(`currentColor`)

    // Triangle/Dotted
    const item3_marker_svgs = items[2].querySelectorAll(`.legend-marker > svg`)
    expect(item3_marker_svgs.length).toBe(2)
    expect(
      item3_marker_svgs[0]
        .querySelector(`line`)
        ?.getAttribute(`stroke-dasharray`),
    ).toBe(`dotted`)
    expect(item3_marker_svgs[1].querySelector(`polygon`)).toBeTruthy() // triangle
    expect(
      item3_marker_svgs[1].querySelector(`polygon`)?.getAttribute(`fill`),
    ).toBe(`currentColor`)

    // Cross (only marker)
    const item4_marker_svgs = items[3].querySelectorAll(`.legend-marker > svg`)
    expect(item4_marker_svgs.length).toBe(1)
    const cross_path = item4_marker_svgs[0].querySelector(`path`)
    expect(cross_path).toBeTruthy() // cross path
    expect(cross_path?.getAttribute(`stroke`)).toBe(`orange`)
    expect(cross_path?.getAttribute(`fill`)).toBe(`none`)

    // Star (only marker)
    const item5_marker_svgs = items[4].querySelectorAll(`.legend-marker > svg`)
    expect(item5_marker_svgs.length).toBe(1)
    const star_polygon = item5_marker_svgs[0].querySelector(`polygon`)
    expect(star_polygon).toBeTruthy() // star polygon
    expect(star_polygon?.getAttribute(`fill`)).toBe(`magenta`)
  })

  test(`applies marker and line colors correctly`, () => {
    const test_data: LegendItem[] = [
      {
        label: `Red`,
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
        label: `Blue Marker Only`,
        visible: true,
        series_idx: 1,
        display_style: { symbol_type: `Square`, symbol_color: `blue` }, // No line
      },
      {
        label: `Green Line Only`,
        visible: true,
        series_idx: 2,
        display_style: { line_dash: `solid`, line_color: `green` }, // No marker
      },
    ]
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: test_data },
    })

    const items = document.querySelectorAll(`.legend-item`)

    // Red
    const item1_marker_svgs = items[0].querySelectorAll(`.legend-marker > svg`)
    expect(item1_marker_svgs.length).toBe(2)
    expect(
      item1_marker_svgs[0].querySelector(`line`)?.getAttribute(`stroke`),
    ).toBe(`red`)
    expect(
      item1_marker_svgs[1].querySelector(`circle`)?.getAttribute(`fill`),
    ).toBe(`red`)

    // Blue Marker Only
    const item2_marker_svgs = items[1].querySelectorAll(`.legend-marker > svg`)
    expect(item2_marker_svgs.length).toBe(1) // Only marker SVG rendered
    expect(
      item2_marker_svgs[0].querySelector(`rect`)?.getAttribute(`fill`),
    ).toBe(`blue`)

    // Green Line Only
    const item3_marker_svgs = items[2].querySelectorAll(`.legend-marker > svg`)
    expect(item3_marker_svgs.length).toBe(1) // Only line SVG rendered
    expect(
      item3_marker_svgs[0].querySelector(`line`)?.getAttribute(`stroke`),
    ).toBe(`green`)
  })

  test(`calls on_toggle with correct series_idx on click`, () => {
    const mock_toggle = vi.fn()
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data, on_toggle: mock_toggle },
    })

    const items = document.querySelectorAll<HTMLElement>(`.legend-item`)
    items[0].click() // Click first item
    expect(mock_toggle).toHaveBeenCalledTimes(1)
    expect(mock_toggle).toHaveBeenCalledWith(0) // series_idx 0
    items[2].click() // Click third item
    expect(mock_toggle).toHaveBeenCalledTimes(2)
    expect(mock_toggle).toHaveBeenCalledWith(2) // series_idx 2
  })

  test(`calls on_toggle with correct series_idx on Enter/Space keydown`, () => {
    const mock_toggle = vi.fn()
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data, on_toggle: mock_toggle },
    })

    const items = document.querySelectorAll(`.legend-item`)

    // Simulate Enter on second item
    simulate_keyboard_event(items[1], `Enter`)
    expect(mock_toggle).toHaveBeenCalledTimes(1)
    expect(mock_toggle).toHaveBeenCalledWith(1) // series_idx 1

    // Simulate Space on fourth item
    simulate_keyboard_event(items[3], ` `) // Note: key is ' ' (space)
    expect(mock_toggle).toHaveBeenCalledTimes(2)
    expect(mock_toggle).toHaveBeenCalledWith(3) // series_idx 3

    // Simulate another key (should not trigger)
    simulate_keyboard_event(items[0], `a`)
    expect(mock_toggle).toHaveBeenCalledTimes(2) // No extra call
  })

  test(`applies wrapper_style and item_style`, () => {
    const wrapper_style = `background: black; padding: 15px;`
    const item_style = `color: white; margin: 2px;`
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: default_series_data, wrapper_style, item_style },
    })

    const wrapper = doc_query(`.legend`)
    expect(wrapper.style.background).toBe(`black`)
    expect(wrapper.style.padding).toBe(`15px`)

    const first_item = doc_query(`.legend-item`)
    expect(first_item.style.color).toBe(`white`)
    expect(first_item.style.margin).toBe(`2px`)
  })

  test(`renders correctly with empty series_data`, () => {
    mount(PlotLegend, { target: document.body, props: { series_data: [] } })
    const wrapper = doc_query(`.legend`)
    expect(wrapper).toBeTruthy()
    expect(wrapper.innerHTML.trim()).toBe(``) // Should be empty
  })

  test(`renders correctly with only one series`, () => {
    const single_series = [default_series_data[0]]
    mount(PlotLegend, {
      target: document.body,
      props: { series_data: single_series },
    })
    const wrapper = doc_query(`.legend`)
    expect(wrapper).toBeTruthy()
    const items = document.querySelectorAll(`.legend-item`)
    expect(items.length).toBe(1)
    expect(items[0].querySelector(`.legend-label`)?.textContent).toBe(
      `Series 1`,
    )
    // Check ARIA attributes for single item
    expect(items[0].getAttribute(`role`)).toBe(`button`)
    expect(items[0].getAttribute(`tabindex`)).toBe(`0`)
    expect(items[0].getAttribute(`aria-pressed`)).toBe(`true`)
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

    test.each([
      {
        desc: `renders group headers and items`,
        expects: { headers: 2, items: 6, indented: 5, grouped_class: true },
      },
    ])(`$desc`, ({ expects }) => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data() },
      })

      expect(doc_query(`.legend`).classList.contains(`grouped`)).toBe(
        expects.grouped_class,
      )
      expect(document.querySelectorAll(`.legend-group-header`).length).toBe(
        expects.headers,
      )
      expect(document.querySelectorAll(`.legend-item`).length).toBe(expects.items)
      expect(document.querySelectorAll(`.legend-item.indented`).length).toBe(
        expects.indented,
      )

      const group_labels = Array.from(document.querySelectorAll(`.legend-group-header`))
        .map((h) => h.querySelector(`.group-label`)?.textContent)
      expect(group_labels).toEqual([`Li₂O`, `NaCl`])
    })

    test(`group header hidden class reflects item visibility`, () => {
      const all_hidden: LegendItem[] = [
        {
          label: `A`,
          visible: false,
          series_idx: 0,
          legend_group: `Hidden`,
          display_style: {},
        },
        {
          label: `B`,
          visible: false,
          series_idx: 1,
          legend_group: `Hidden`,
          display_style: {},
        },
      ]
      mount(PlotLegend, { target: document.body, props: { series_data: all_hidden } })
      expect(doc_query(`.legend-group-header`).classList.contains(`hidden`)).toBe(true)
    })

    test.each([
      {
        event_type: `click`,
        handler: `on_group_toggle`,
        group_idx: 0,
        expected_group: `Li₂O`,
        expected_indices: [0, 1, 2],
      },
      {
        event_type: `dblclick`,
        handler: `on_group_double_click`,
        group_idx: 1,
        expected_group: `NaCl`,
        expected_indices: [3, 4],
      },
    ])(
      `$handler called on $event_type`,
      ({ event_type, handler, group_idx, expected_group, expected_indices }) => {
        const mock_handler = vi.fn()
        mount(PlotLegend, {
          target: document.body,
          props: { series_data: make_grouped_data(), [handler]: mock_handler },
        })

        const headers = document.querySelectorAll<HTMLElement>(`.legend-group-header`)
        headers[group_idx].dispatchEvent(new MouseEvent(event_type, { bubbles: true }))

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
      expect(document.querySelectorAll(`.legend-item`).length).toBe(6)

      // Click to collapse
      chevron.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      await tick()
      expect(chevron.classList.contains(`collapsed`)).toBe(true)
      expect(document.querySelectorAll(`.legend-item`).length).toBe(3) // 6 - 3 Li₂O items

      // Keyboard (Enter) to expand
      chevron.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
      await tick()
      expect(chevron.classList.contains(`collapsed`)).toBe(false)
      expect(document.querySelectorAll(`.legend-item`).length).toBe(6)
    })

    test(`no grouping when legend_group not set`, () => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: default_series_data },
      })

      expect(doc_query(`.legend`).classList.contains(`grouped`)).toBe(false)
      expect(document.querySelectorAll(`.legend-group-header`).length).toBe(0)
      expect(document.querySelectorAll(`.legend-item.indented`).length).toBe(0)
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
        headers[group_idx].dispatchEvent(
          new KeyboardEvent(`keydown`, { key, bubbles: true }),
        )

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
      chevron.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      await tick()
      expect(chevron.getAttribute(`aria-label`)).toBe(`Expand group Li₂O`)
    })

    test(`collapsing one group does not affect other groups`, async () => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: make_grouped_data() },
      })

      expect(document.querySelectorAll(`.legend-item`).length).toBe(6)

      // Collapse first group (Li₂O)
      const chevrons = document.querySelectorAll(`.group-chevron`)
      chevrons[0].dispatchEvent(new MouseEvent(`click`, { bubbles: true }))
      await tick()

      expect(document.querySelectorAll(`.legend-item`).length).toBe(3) // 6 - 3 Li₂O
      expect(chevrons[1].classList.contains(`collapsed`)).toBe(false)
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

      header.dispatchEvent(new MouseEvent(`click`, { bubbles: true }))

      expect(mock_toggle).toHaveBeenCalled()
      expect(chevron.classList.contains(`collapsed`)).toBe(false)
    })
  })

  describe(`fill region legend items`, () => {
    const fill_series_data: LegendItem[] = [
      {
        label: `Data Series`,
        visible: true,
        series_idx: 0,
        display_style: { symbol_type: `Circle`, symbol_color: `blue` },
      },
      {
        label: `Fill Region`,
        visible: true,
        series_idx: -1, // Fill items use fill_idx instead
        item_type: `fill`,
        fill_idx: 0,
        display_style: {
          fill_color: `steelblue`,
          fill_opacity: 0.3,
          edge_color: `darkblue`,
        },
      },
      {
        label: `Hidden Fill`,
        visible: false,
        series_idx: -1,
        item_type: `fill`,
        fill_idx: 1,
        display_style: { fill_color: `red`, fill_opacity: 0.5 },
      },
    ]

    test(`renders fill swatch with correct styling and hidden state`, () => {
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: fill_series_data },
      })
      const items = document.querySelectorAll(`.legend-item`)

      // Regular series: no fill swatch
      expect(items[0].classList.contains(`fill-item`)).toBe(false)
      expect(items[0].querySelector(`.fill-swatch`)).toBeNull()

      // Fill region: has swatch with correct styling
      expect(items[1].classList.contains(`fill-item`)).toBe(true)
      const rect = items[1].querySelector(`.fill-swatch rect`)
      expect(rect?.getAttribute(`fill`)).toBe(`steelblue`)
      expect(rect?.getAttribute(`stroke`)).toBe(`darkblue`)

      // Hidden state
      expect(items[1].classList.contains(`hidden`)).toBe(false)
      expect(items[2].classList.contains(`hidden`)).toBe(true)
    })

    test(`on_fill_toggle routes click/keyboard to correct handler`, () => {
      document.body.innerHTML = ``
      const on_toggle = vi.fn()
      const on_fill_toggle = vi.fn()

      mount(PlotLegend, {
        target: document.body,
        props: { series_data: fill_series_data, on_toggle, on_fill_toggle },
      })
      const items = document.querySelectorAll<HTMLElement>(`.legend-item`)

      // Regular series click → on_toggle
      items[0].click()
      expect(on_toggle).toHaveBeenCalledWith(0)
      expect(on_fill_toggle).not.toHaveBeenCalled()
      on_toggle.mockClear()

      // Fill item click → on_fill_toggle
      items[1].click()
      expect(on_fill_toggle).toHaveBeenCalledWith(0)
      expect(on_toggle).not.toHaveBeenCalled()
      on_fill_toggle.mockClear()

      // Fill item keyboard → on_fill_toggle
      items[1].dispatchEvent(
        new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }),
      )
      expect(on_fill_toggle).toHaveBeenCalledWith(0)
    })

    test(`on_fill_double_click called for fill item dblclick`, () => {
      const on_fill_double_click = vi.fn()
      mount(PlotLegend, {
        target: document.body,
        props: { series_data: fill_series_data, on_fill_double_click },
      })
      document.querySelectorAll<HTMLElement>(`.legend-item`)[1].dispatchEvent(
        new MouseEvent(`dblclick`, { bubbles: true }),
      )
      expect(on_fill_double_click).toHaveBeenCalledWith(0)
    })

    test(`fill swatch uses defaults for missing opacity and edge`, () => {
      const data: LegendItem[] = [{
        label: `Minimal`,
        visible: true,
        series_idx: -1,
        item_type: `fill`,
        fill_idx: 0,
        display_style: { fill_color: `green` }, // No fill_opacity or edge_color
      }]
      mount(PlotLegend, { target: document.body, props: { series_data: data } })
      const rect = doc_query(`.fill-swatch rect`)
      expect(rect.getAttribute(`fill-opacity`)).toBe(`0.3`)
      expect(rect.getAttribute(`stroke`)).toBe(`none`)
    })
  })
})
