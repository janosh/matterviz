import { PlotControls } from '$lib/plot'
import { DEFAULTS } from '$lib/settings'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'

describe(`PlotControls`, () => {
  const mount_controls = (props: ComponentProps<typeof PlotControls> = {}) => {
    props.show_controls ??= true
    props.controls_open ??= true
    return mount(PlotControls, {
      target: document.body,
      props,
    })
  }

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

    test(`flags inverted ranges, applies valid ones and resets after an axis disappears`, async () => {
      let has_x2_points = $state(true)
      const state = $state<{ x_axis: { range?: [number, number] } }>({ x_axis: {} })
      const props: ComponentProps<typeof PlotControls> = {
        get has_x2_points() {
          return has_x2_points
        },
        auto_x_range: [0, 100],
        auto_x2_range: [0, 100],
      }
      mount_controls(bind_props(props, state))
      const set_input = (input: HTMLInputElement, value: string) => {
        input.value = value
        input.dispatchEvent(new Event(`input`, { bubbles: true }))
        flushSync()
      }
      const [x_min, x_max] = [
        ...document.querySelectorAll<HTMLInputElement>(`input.range-input`),
      ]
      set_input(x_min, `50`)
      expect(state.x_axis.range).toEqual([50, 100]) // max falls back to the auto range
      set_input(x_max, `20`) // min >= max: both inputs flagged, range left untouched
      expect(x_min.classList.contains(`invalid`)).toBe(true)
      expect(x_max.classList.contains(`invalid`)).toBe(true)
      expect(state.x_axis.range).toEqual([50, 100])
      set_input(x_max, `80`)
      expect(x_min.classList.contains(`invalid`)).toBe(false)
      expect(state.x_axis.range).toEqual([50, 80])

      await tick()
      flushSync(() => (has_x2_points = false))
      doc_query<HTMLButtonElement>(`button[aria-label="Reset axis range to defaults"]`).click()
      flushSync()
      expect(state.x_axis.range).toBeUndefined()
      expect(x_min.value).toBe(``)
      expect(x_max.value).toBe(``)
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

    test(`reset restores the format the axis was mounted with`, () => {
      const state = $state<{ x_axis: { format?: string } }>({ x_axis: { format: `.3f` } })
      mount_controls(bind_props({}, state))
      const input = doc_query<HTMLInputElement>(`[data-testid="tick-format-section"] input`)
      input.value = `.1e`
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
      expect(state.x_axis.format).toBe(`.1e`)
      doc_query<HTMLButtonElement>(
        `button[aria-label="Reset tick format to defaults"]`,
      ).click()
      flushSync()
      expect(state.x_axis.format).toBe(`.3f`)
    })

    test(`format inputs fill their grid column`, () => {
      mount_controls({ has_x2_points: true, has_y2_points: true })
      const inputs = document.querySelectorAll<HTMLInputElement>(
        `[data-testid="tick-format-section"] input`,
      )
      expect(inputs).toHaveLength(4)
      for (const input of inputs) expect(getComputedStyle(input).width).toBe(`100%`)
    })
  })

  describe(`tick count inputs`, () => {
    const tick_inputs = () => [
      ...document.querySelectorAll<HTMLInputElement>(`[data-testid="ticks-section"] input`),
    ]
    const type_into = (input: HTMLInputElement, value: string) => {
      input.value = value
      input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
    }

    test(`writes integer counts into the live axis ticks, empty hands back to auto`, () => {
      const state = $state<{ x_axis: { ticks?: number }; y_axis: { ticks?: number } }>({
        x_axis: {},
        y_axis: { ticks: 4 },
      })
      mount_controls(bind_props({ has_x2_points: true }, state))
      const [x_input, x2_input, y_input] = tick_inputs()
      expect(tick_inputs().map((input) => input.value)).toEqual([``, ``, `4`])
      expect(tick_inputs().map((input) => input.placeholder)).toEqual([`auto`, `auto`, `auto`])
      type_into(x_input, `12`)
      expect(state.x_axis.ticks).toBe(12)
      // non-integers, zero/negatives and absurd counts are ignored, the input keeps its text
      for (const bad of [`2.5`, `0`, `-3`, `1000`]) type_into(x_input, bad)
      expect(state.x_axis.ticks).toBe(12)
      type_into(y_input, ``)
      expect(state.y_axis.ticks).toBeUndefined()
      // x2 has no binding here, so the input is still rendered and editable without throwing
      type_into(x2_input, `3`)
      doc_query<HTMLButtonElement>(`button[aria-label="Reset ticks to defaults"]`).click()
      flushSync()
      expect(state.x_axis.ticks).toBeUndefined()
      expect(state.y_axis.ticks).toBe(4)
    })

    test(`an explicit tick list disables the input instead of overwriting it`, () => {
      const state = $state<{ x_axis: { ticks?: number[] } }>({ x_axis: { ticks: [0, 5, 10] } })
      mount_controls(bind_props({}, state))
      const [x_input] = tick_inputs()
      expect(x_input.disabled).toBe(true)
      expect(x_input.placeholder).toBe(`custom`)
      expect(state.x_axis.ticks).toEqual([0, 5, 10])
    })
  })

  describe(`display controls`, () => {
    const get_checkboxes_in_group = (label: string): HTMLInputElement[] => [
      ...(document
        .querySelector(`.control-group[data-label="${label}"]`)
        ?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`) ?? []),
    ]

    test(`renders correct number of grid controls and resets them`, async () => {
      const state = $state({ display: { x_grid: true, y_grid: true, y2_grid: true } })
      const initial_display = state.display
      mount_controls(bind_props({ has_y2_points: true }, state))
      const grids = get_checkboxes_in_group(`grid`)
      expect(grids).toHaveLength(3)
      expect(
        document.querySelector(`button[aria-label="Reset display to defaults"]`),
      ).toBeNull()

      grids[0].click()
      await tick()
      expect(state.display.x_grid).toBe(false)

      doc_query<HTMLButtonElement>(`button[aria-label="Reset display to defaults"]`).click()
      await tick()
      expect(state.display).not.toBe(initial_display)
      expect(state.display).toMatchObject({
        x_grid: DEFAULTS.plot.display.x_grid,
        x_zero_line: DEFAULTS.plot.display.x_zero_line,
        x2_zero_line: false,
        y_zero_line: DEFAULTS.plot.display.y_zero_line,
        y2_zero_line: false,
        y2_grid: true,
      })
      expect(
        document.querySelector(`button[aria-label="Reset display to defaults"]`),
      ).toBeNull()
    })

    test(`does not fill missing display keys on mount`, () => {
      const display = $state({ x_grid: false })
      mount_controls({
        get display() {
          return display
        },
      })
      expect(display).toEqual({ x_grid: false })
    })

    test.each<{
      x_range: [number, number]
      y_range: [number, number]
      expected: number
    }>([
      { x_range: [-10, 10], y_range: [-5, 5], expected: 2 },
      { x_range: [0, 10], y_range: [-5, 5], expected: 2 },
      { x_range: [1, 10], y_range: [-5, 5], expected: 1 },
      { x_range: [-10, 10], y_range: [1, 5], expected: 1 },
      { x_range: [1, 10], y_range: [1, 5], expected: 0 },
    ])(`shows $expected zero line controls for ranges`, ({ x_range, y_range, expected }) => {
      mount_controls({ auto_x_range: x_range, auto_y_range: y_range })
      const zero_lines = get_checkboxes_in_group(`zero line`)
      expect(zero_lines).toHaveLength(expected)
    })
  })

  test(`controls visibility toggles`, () => {
    mount_controls({ show_controls: false })
    expect(document.querySelector(`.plot-controls-pane`)).toBeNull()

    // When shown, toggle + pane use the `plot-controls-*` prefix (regression guard:
    // an empty controls_name default produced leading-hyphen `-controls-*` names).
    document.body.innerHTML = ``
    mount_controls()
    expect(document.querySelector(`.plot-controls-toggle`)).not.toBeNull()
    const pane = document.querySelector(`.plot-controls-pane`)
    expect(pane).not.toBeNull()
    expect(pane?.classList.contains(`compact-settings`)).toBe(true)
  })

  test(`packs related display and axis fields onto shared rows`, async () => {
    mount_controls({ auto_x_range: [0, 1], auto_y_range: [0, 1] })
    // Poll for the rows instead of reading the DOM straight after mount: the pane's sections
    // fill in once the mount's queued effects have flushed.
    await vi.waitFor(() => {
      const display_row = doc_query(`section.ctrl-line`)
      expect(display_row.querySelector(`[data-label="zero line"]`)).not.toBeNull()
      expect(display_row.querySelector(`[data-label="grid"]`)).not.toBeNull()
      const range_row = doc_query(`section.axis-fields`)
      expect(range_row.querySelectorAll(`label`).length).toBeGreaterThanOrEqual(2)
    })
    expect(
      document
        .querySelector(`[data-testid="scale-type-section"]`)
        ?.classList.contains(`axis-fields`),
    ).toBe(true)
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
