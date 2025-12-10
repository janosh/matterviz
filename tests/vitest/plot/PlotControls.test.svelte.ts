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

    test(`handles various input scenarios`, () => {
      mount_controls({ auto_x_range: [0, 100] })
      const [x_min, x_max, y_min] = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input.range-input`),
      )

      // Valid values
      x_min.value = `10`
      x_min.dispatchEvent(new Event(`input`, { bubbles: true }))
      x_max.value = `90`
      x_max.dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(x_min.classList.contains(`invalid`)).toBe(false)

      // Non-finite value
      x_min.value = `1e`
      x_min.dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(x_min.classList.contains(`invalid`)).toBe(false)

      // Empty values
      x_min.value = ``
      x_min.dispatchEvent(new Event(`input`, { bubbles: true }))
      x_max.value = ``
      x_max.dispatchEvent(new Event(`input`, { bubbles: true }))

      // Test y-axis to ensure all axes work
      y_min.value = `5`
      y_min.dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(y_min.value).toBe(`5`)
    })
  })

  describe(`auto range fallback`, () => {
    test(`handles all three axes and y2 visibility`, () => {
      mount_controls({
        has_y2_points: true,
        auto_x_range: [0, 100],
        auto_y_range: [0, 50],
        auto_y2_range: [0, 25],
      })

      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input.range-input`),
      )
      expect(inputs.length).toBe(6) // 2 per axis

      // Test input updates work
      inputs[0].value = `10`
      inputs[0].dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(inputs[0].value).toBe(`10`)
    })

    test(`hides y2 inputs when has_y2_points is false`, () => {
      mount_controls({ has_y2_points: false })
      expect(document.querySelectorAll(`input.range-input`).length).toBe(4)
    })
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

    test(`handles all three axis formats`, () => {
      mount_controls({ has_y2_points: true })
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="text"]`),
      )

      inputs.forEach((input, idx) => {
        input.value = [`.2r`, `.0%`, `.1e`][idx]
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        expect(input.classList.contains(`invalid`)).toBe(false)
      })
    })
  })

  describe(`display controls`, () => {
    test(`renders correct number of grid controls`, () => {
      mount_controls({ has_y2_points: true })
      const grids = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`),
      )
        .filter((cb) => cb.parentElement?.textContent?.includes(`grid`))
      expect(grids.length).toBe(3)
    })

    test.each([
      { x_range: [-10, 10], y_range: [-5, 5], expected: 2 },
      { x_range: [0, 10], y_range: [-5, 5], expected: 2 },
      { x_range: [1, 10], y_range: [-5, 5], expected: 1 },
      { x_range: [-10, 10], y_range: [1, 5], expected: 1 },
      { x_range: [1, 10], y_range: [1, 5], expected: 0 },
    ])(
      `shows $expected zero line controls for ranges`,
      ({ x_range, y_range, expected }) => {
        mount_controls({ x_range, y_range, auto_x_range: x_range, auto_y_range: y_range })
        const zero_lines = Array.from(
          document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`),
        )
          .filter((cb) => cb.parentElement?.textContent?.includes(`zero line`))
        expect(zero_lines.length).toBe(expected)
      },
    )
  })

  test(`tick controls visibility`, () => {
    mount_controls({ show_ticks: false })
    expect(
      Array.from(document.querySelectorAll(`section`))
        .find((section) => section.textContent?.includes(`Ticks`)),
    ).toBeUndefined()

    mount_controls({ show_ticks: true })
    const tick_inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>(`input[type="number"]`),
    )
      .filter((input) => input.parentElement?.textContent?.toLowerCase().includes(`axis`))

    const x_tick = tick_inputs.find((i) =>
      i.parentElement?.textContent?.includes(`X-axis`)
    )
    if (x_tick) {
      x_tick.value = `10`
      x_tick.dispatchEvent(new Event(`input`, { bubbles: true }))
      expect(x_tick.value).toBe(`10`)
    }
  })

  test(`has reset buttons for control sections`, () => {
    mount_controls({ x_range: [-10, 10], y_range: [-5, 5] })
    const sections = Array.from(document.querySelectorAll(`section`))

    const expected_sections = [`Display`, `Axis Range`, `Tick Format`]
    expected_sections.forEach((name) => {
      const section = sections.find((section) => section.textContent?.includes(name))
      const reset = section?.querySelector<HTMLButtonElement>(`button`)
      expect(reset).not.toBeNull()
    })
  })

  test(`controls visibility toggles`, () => {
    mount(PlotControls, {
      target: document.body,
      props: { show_controls: false, controls_open: true },
    })
    expect(document.querySelector(`.plot-controls-pane`)).toBeNull()
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
