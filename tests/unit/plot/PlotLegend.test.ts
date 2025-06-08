// @vitest-environment happy-dom
import { PlotLegend, type LegendItem } from '$lib/plot'
import { mount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { doc_query } from '..'

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
  beforeEach(() => {
    // Clear body before each test
    document.body.innerHTML = ``
  })

  afterEach(() => {
    // Clean up DOM after each test
    document.body.innerHTML = ``
  })

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
    const first_marker_svgs =
      first_item.querySelectorAll(`.legend-marker > svg`)
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
    const second_marker_svgs =
      second_item.querySelectorAll(`.legend-marker > svg`)
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
    const third_marker_svgs =
      third_item.querySelectorAll(`.legend-marker > svg`)
    expect(third_marker_svgs.length).toBe(1) // Only marker shape svg
    expect(third_marker_svgs[0].querySelector(`polygon`)).toBeTruthy() // triangle
    expect(
      third_marker_svgs[0].querySelector(`polygon`)?.getAttribute(`fill`),
    ).toBe(`green`)

    // Check item with only line
    const fourth_item = items[3]
    expect(fourth_item.getAttribute(`aria-pressed`)).toBe(`true`)
    const fourth_marker_svgs =
      fourth_item.querySelectorAll(`.legend-marker > svg`)
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

    const items = document.querySelectorAll(`.legend-item`)

    // Click first item
    ;(items[0] as HTMLElement).click()
    expect(mock_toggle).toHaveBeenCalledTimes(1)
    expect(mock_toggle).toHaveBeenCalledWith(0) // series_idx 0

    // Click third item
    ;(items[2] as HTMLElement).click()
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
})
