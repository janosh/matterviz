import { PlotControls } from '$lib/plot'
import { mount } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { doc_query } from '../setup'

describe(`PlotControls`, () => {
  const mount_controls = (props = {}) =>
    mount(PlotControls, {
      target: document.body,
      props: { show_controls: true, controls_open: true, ...props },
    })

  describe(`range input handling`, () => {
    test.each([
      { value: `42`, desc: `valid integer` },
      { value: `3.14`, desc: `valid float` },
      { value: `-10`, desc: `negative number` },
      { value: ``, desc: `empty string` },
      { value: `1e`, desc: `partial exponential (NaN)` },
      { value: `1e999`, desc: `overflow (Infinity)` },
      { value: `-1e999`, desc: `overflow (-Infinity)` },
      { value: `abc`, desc: `non-numeric (NaN)` },
    ])(`sanitizes $desc: "$value"`, ({ value }) => {
      mount_controls({ auto_x_range: [0, 100] })
      const input = doc_query<HTMLInputElement>(`input.range-input`)
      input.value = value
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(input.classList.contains(`invalid`)).toBe(false)
    })
  })

  describe(`auto range fallback`, () => {
    // y2 range inputs only render when the plot has y2 series (2 inputs per visible axis)
    test.each([
      { has_y2_points: true, expected: 6 },
      { has_y2_points: false, expected: 4 },
    ])(
      `renders $expected range inputs when has_y2_points=$has_y2_points`,
      ({ has_y2_points, expected }) => {
        mount_controls({
          has_y2_points,
          auto_x_range: [0, 100],
          auto_y_range: [0, 50],
          auto_y2_range: [0, 25],
        })
        expect(document.querySelectorAll(`input.range-input`)).toHaveLength(expected)
      },
    )
  })

  describe(`format input validation`, () => {
    test.each([
      { format: `.2r`, valid: true },
      { format: `.0%`, valid: true },
      { format: `~s`, valid: true },
      { format: `d`, valid: true },
      { format: `.2e`, valid: true },
      { format: `%Y-%m-%d`, valid: true },
      { format: `%B %d, %Y`, valid: true },
      { format: ``, valid: true },
      { format: `xyz`, valid: false },
      { format: `.`, valid: false },
    ])(`validates "$format" as $valid`, ({ format, valid }) => {
      mount_controls()
      const input = doc_query<HTMLInputElement>(`input[type="text"]`)
      input.value = format
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(input.classList.contains(`invalid`)).toBe(!valid)
    })
  })

  describe(`display controls`, () => {
    // Helper to find checkboxes within a control group by data-label attribute.
    const get_checkboxes_in_group = (label: string) => {
      const group = document.querySelector(`.control-group[data-label="${label}"]`)
      return group
        ? Array.from(group.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`))
        : []
    }

    test(`renders correct number of grid controls`, () => {
      mount_controls({ has_y2_points: true })
      const grids = get_checkboxes_in_group(`grid`)
      expect(grids).toHaveLength(3)
    })

    test.each([
      { x_range: [-10, 10], y_range: [-5, 5], expected: 2 },
      { x_range: [0, 10], y_range: [-5, 5], expected: 2 },
      { x_range: [1, 10], y_range: [-5, 5], expected: 1 },
      { x_range: [-10, 10], y_range: [1, 5], expected: 1 },
      { x_range: [1, 10], y_range: [1, 5], expected: 0 },
    ])(`shows $expected zero line controls for ranges`, ({ x_range, y_range, expected }) => {
      mount_controls({ x_range, y_range, auto_x_range: x_range, auto_y_range: y_range })
      const zero_lines = get_checkboxes_in_group(`zero line`)
      expect(zero_lines).toHaveLength(expected)
    })
  })

  test(`tick controls section only renders when show_ticks`, () => {
    // section titles render in <h4> headers (not inside the <section> itself)
    const has_ticks_section = () =>
      Array.from(document.querySelectorAll(`h4`)).some((header) =>
        header.textContent?.includes(`Ticks`),
      )
    mount_controls({ show_ticks: false })
    expect(has_ticks_section()).toBe(false)

    document.body.innerHTML = ``
    mount_controls({ show_ticks: true })
    expect(has_ticks_section()).toBe(true)
  })

  test(`controls visibility toggles`, () => {
    mount_controls({ show_controls: false })
    expect(document.querySelector(`.plot-controls-pane`)).toBeNull()

    // When shown, toggle + pane use the `plot-controls-*` prefix (regression guard:
    // an empty controls_class default produced leading-hyphen `-controls-*` names).
    document.body.innerHTML = ``
    mount_controls()
    expect(document.querySelector(`.plot-controls-toggle`)).not.toBeNull()
    expect(document.querySelector(`.plot-controls-pane`)).not.toBeNull()
  })

  test(`Enter key blurs range input`, () => {
    mount_controls({ auto_x_range: [0, 100] })
    const input = doc_query<HTMLInputElement>(`input.range-input`)
    const blur_spy = vi.spyOn(input, `blur`)
    input.value = `10`
    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    expect(blur_spy).toHaveBeenCalled()
  })
})
