import type { Vec2 } from '$lib/math'
import { PlotControls, SankeyControls, SunburstControls, TernaryControls } from '$lib/plot'
import type { AxisConfig } from '$lib/plot'
import type { TicksOption } from '$lib/plot/core/scales'
import { resolve_axis_range } from '$lib/plot/core/interactions'
import { DEFAULTS } from '$lib/settings'
import { type ComponentProps, flushSync, mount, tick } from 'svelte'
import { describe, expect, test, vi } from 'vitest'
import { bind_props, doc_query } from '../setup'

const type_into = (input: HTMLInputElement, value: string) => {
  input.value = value
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
  flushSync()
}

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
    // finite values replace the min; empty or non-finite input clears it so the auto min applies
    test.each([
      { value: `42`, desc: `valid integer`, expected_range: [42, 50] },
      { value: `3.14`, desc: `valid float`, expected_range: [3.14, 50] },
      { value: `-10`, desc: `negative number`, expected_range: [-10, 50] },
      { value: ``, desc: `empty string`, expected_range: [null, 50] },
      { value: `1e`, desc: `partial exponential (NaN)`, expected_range: [null, 50] },
      { value: `1e999`, desc: `overflow (Infinity)`, expected_range: [null, 50] },
      { value: `-1e999`, desc: `overflow (-Infinity)`, expected_range: [null, 50] },
      { value: `abc`, desc: `non-numeric (NaN)`, expected_range: [null, 50] },
    ])(`sanitizes $desc: "$value"`, ({ value, expected_range }) => {
      const state = $state<{ x_axis: AxisConfig }>({ x_axis: { range: [5, 50] } })
      const auto_ranges = { x: [0, 100] as Vec2 }
      mount_controls(bind_props({ auto_ranges }, state))
      const input = doc_query<HTMLInputElement>(`input.range-input`)
      type_into(input, value)
      expect(input.classList.contains(`invalid`)).toBe(false)
      expect(state.x_axis.range).toEqual(expected_range)
    })
  })

  describe(`auto range fallback`, () => {
    test.each([{ x: [0, 100] as Vec2 }, { x2: [0, 100] as Vec2 }])(
      `partial automatic ranges %j preserve cleared endpoints`,
      (auto_ranges) => {
        const state = $state<{ y_axis: AxisConfig }>({ y_axis: { range: [0.2, 0.8] } })
        mount_controls(bind_props({ auto_ranges }, state))
        const row = [...document.querySelectorAll(`.axis-fields label`)].find(
          (label) => label.querySelector(`span`)?.textContent === `Y`,
        )
        const inputs = row?.querySelectorAll<HTMLInputElement>(`input.range-input`)
        if (inputs?.length !== 2) throw new Error(`Missing Y range inputs`)
        type_into(inputs[0], ``)
        expect(state.y_axis.range).toEqual([null, 0.8])
        type_into(inputs[1], ``)
        expect(state.y_axis.range).toEqual([null, null])
        type_into(inputs[0], `0.25`)
        expect(state.y_axis.range).toEqual([0.25, null])
      },
    )

    // Optional ranges are the source of truth for secondary-axis controls.
    test.each([
      { secondary_range: [0, 25] as Vec2, expected: 6 },
      { secondary_range: undefined, expected: 4 },
    ])(
      `renders $expected range inputs with y2 range=$secondary_range`,
      ({ secondary_range, expected }) => {
        mount_controls({
          auto_ranges: { x: [0, 100], y: [0, 50], y2: secondary_range },
        })
        expect(document.querySelectorAll(`input.range-input`)).toHaveLength(expected)
      },
    )

    test(`flags inverted ranges, applies valid ones and resets after an axis disappears`, async () => {
      let x2_range = $state<Vec2 | undefined>([0, 100])
      let auto_x = $state<Vec2>([0, 100])
      const state = $state<{ x_axis: AxisConfig }>({ x_axis: {} })
      const resolved_range = () => resolve_axis_range(state.x_axis, auto_x)
      const props: ComponentProps<typeof PlotControls> = {
        get auto_ranges() {
          return { x: auto_x, x2: x2_range }
        },
      }
      mount_controls(bind_props(props, state))
      const [x_min, x_max] = [
        ...document.querySelectorAll<HTMLInputElement>(`input.range-input`),
      ]
      type_into(x_min, `50`)
      expect(state.x_axis.range).toEqual([50, null])
      expect(resolved_range()).toEqual([50, 100])
      flushSync(() => (auto_x = [0, 200]))
      expect(resolved_range()).toEqual([50, 200])
      expect(x_max.value).toBe(``)
      type_into(x_max, `20`) // min >= max: both inputs flagged, range left untouched
      expect(x_min.classList.contains(`invalid`)).toBe(true)
      expect(x_max.classList.contains(`invalid`)).toBe(true)
      expect(state.x_axis.range).toEqual([50, null])
      type_into(x_max, `80`)
      expect(x_min.classList.contains(`invalid`)).toBe(false)
      expect(state.x_axis.range).toEqual([50, 80])

      await tick()
      flushSync(() => (x2_range = undefined))
      doc_query<HTMLButtonElement>(
        `button[aria-label="Restore axis range to initial values"]`,
      ).click()
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
      const state = $state({ x_axis: { format: `.3f` } })
      mount_controls(bind_props({}, state))
      const input = doc_query<HTMLInputElement>(`input[type="text"]`)
      type_into(input, format)
      expect(input.classList.contains(`invalid`)).toBe(!valid)
      expect(state.x_axis.format).toBe(valid ? format : `.3f`)
    })

    test(`reset restores the format the axis was mounted with`, () => {
      const state = $state({ x_axis: { format: `.3f` }, y_axis: { format: `.1e` } })
      mount_controls(bind_props({}, state))
      const input = doc_query<HTMLInputElement>(`[data-testid="tick-format-section"] input`)
      type_into(input, `.1e`)
      expect(state.x_axis.format).toBe(`.1e`)
      type_into(input, `invalid`)
      expect(input.classList.contains(`invalid`)).toBe(true)
      state.y_axis = { format: `.4f` }
      flushSync()
      expect(input.value).toBe(`invalid`)
      doc_query<HTMLButtonElement>(
        `button[aria-label="Restore tick format to initial values"]`,
      ).click()
      flushSync()
      expect(state.x_axis.format).toBe(`.3f`)
      expect(input.value).toBe(`.3f`)
      expect(input.classList.contains(`invalid`)).toBe(false)
      type_into(input, `invalid`)
      state.x_axis = { format: `.0%` }
      flushSync()
      expect(input.value).toBe(`.0%`)
      expect(input.classList.contains(`invalid`)).toBe(false)
    })

    test(`format inputs fill their grid column`, () => {
      mount_controls({ auto_ranges: { x2: [0, 1], y2: [0, 1] } })
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

    test(`writes integer counts into the live axis ticks, empty hands back to auto`, () => {
      const state = $state<{ x_axis: { ticks?: number }; y_axis: { ticks?: number } }>({
        x_axis: {},
        y_axis: { ticks: 4 },
      })
      mount_controls(bind_props({ auto_ranges: { x2: [0, 1] as Vec2 } }, state))
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
      doc_query<HTMLButtonElement>(
        `button[aria-label="Restore ticks to initial values"]`,
      ).click()
      flushSync()
      expect(state.x_axis.ticks).toBeUndefined()
      expect(state.y_axis.ticks).toBe(4)
    })

    test.each([[0, 5, 10], { 0: `start`, 10: `end` }, `day`] satisfies TicksOption[])(
      `custom ticks %j survive in-place edits and replacement by a count`,
      (initial_ticks) => {
        const state = $state<{ x_axis: AxisConfig }>({
          x_axis: { ticks: structuredClone(initial_ticks) },
        })
        mount_controls(bind_props({}, state))
        const [x_input] = tick_inputs()
        expect(x_input.disabled).toBe(true)
        expect(x_input.placeholder).toBe(`custom`)
        if (Array.isArray(state.x_axis.ticks)) state.x_axis.ticks[0] = 1
        else if (typeof state.x_axis.ticks === `object`) state.x_axis.ticks[0] = `changed`
        else state.x_axis.ticks = `month`
        flushSync()
        doc_query<HTMLButtonElement>(
          `button[aria-label="Restore ticks to initial values"]`,
        ).click()
        flushSync()
        expect(state.x_axis.ticks).toEqual(initial_ticks)
        // Replacing a custom configuration with a count must preserve the same reset baseline.
        state.x_axis = { ticks: 7 }
        flushSync()
        expect(x_input.disabled).toBe(false)
        expect(x_input.value).toBe(`7`)
        doc_query<HTMLButtonElement>(
          `button[aria-label="Restore ticks to initial values"]`,
        ).click()
        flushSync()
        expect(state.x_axis.ticks).toEqual(initial_ticks)
        expect(x_input.disabled).toBe(true)
      },
    )
  })

  describe(`display controls`, () => {
    const get_checkboxes_in_group = (label: string): HTMLInputElement[] => [
      ...(document
        .querySelector(`.control-group[data-label="${label}"]`)
        ?.querySelectorAll<HTMLInputElement>(`input[type="checkbox"]`) ?? []),
    ]

    test(`renders correct number of grid controls and resets them`, async () => {
      let display = $state.raw({ x_grid: true, y_grid: true, y2_grid: true })
      const state = {
        get display() {
          return display
        },
        set display(value) {
          display = value
        },
      }
      const initial_display = state.display
      mount_controls(bind_props({ auto_ranges: { y2: [0, 1] as Vec2 } }, state))
      const grids = get_checkboxes_in_group(`grid`)
      expect(grids).toHaveLength(3)
      expect(
        document.querySelector(`button[aria-label="Restore display to initial values"]`),
      ).toBeNull()

      grids[0].click()
      await tick()
      expect(state.display.x_grid).toBe(false)

      doc_query<HTMLButtonElement>(
        `button[aria-label="Restore display to initial values"]`,
      ).click()
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
        document.querySelector(`button[aria-label="Restore display to initial values"]`),
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
      mount_controls({ auto_ranges: { x: x_range, y: y_range } })
      const zero_lines = get_checkboxes_in_group(`zero line`)
      expect(zero_lines).toHaveLength(expected)
    })
  })

  test.each([false, `never`, { mode: `never` }, { hidden: [`controls`] }] as const)(
    `controls visibility %j`,
    (show_controls) => {
      mount_controls({ show_controls })
      expect(document.querySelector(`.plot-controls-pane`)).toBeNull()
    },
  )

  test(`packs related display and axis fields onto shared rows`, async () => {
    mount_controls({ auto_ranges: { x: [0, 1], y: [0, 1] } })
    // Shared names avoid the old empty-prefix "-controls-*" classes.
    expect(document.querySelector(`.plot-controls-toggle`)).not.toBeNull()
    expect(doc_query(`.plot-controls-pane`).classList.contains(`compact-settings`)).toBe(true)
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
    mount_controls({ auto_ranges: { x: [0, 100] } })
    const input = doc_query<HTMLInputElement>(`input.range-input`)
    const blur_spy = vi.spyOn(input, `blur`)
    input.value = `10`
    input.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Enter`, bubbles: true }))
    expect(blur_spy).toHaveBeenCalled()
  })
})

// Authored non-default values must be compared against the defaults restored by Reset.
test.each([
  ...(
    [
      { title: `scale type`, x_axis: { scale_type: `log` } },
      { title: `y2 sync`, y2_axis: { sync: { mode: `align`, align_value: 5 } } },
    ] as const
  ).map(({ title, ...props }) => ({
    title,
    mount_controls: () =>
      mount(PlotControls, {
        target: document.body,
        props: { controls_open: true, auto_ranges: { y2: [0, 1] }, ...props },
      }),
  })),
  {
    title: `sankey`,
    mount_controls: () =>
      mount(SankeyControls, {
        target: document.body,
        props: { controls_open: true, node_width: 40 },
      }),
  },
  ...([`sunburst`, `treemap`] as const).map((chart) => ({
    title: chart,
    mount_controls: () =>
      mount(SunburstControls, {
        target: document.body,
        props: { chart, controls_open: true, max_depth: 3 },
      }),
  })),
  {
    title: `grid`,
    mount_controls: () =>
      mount(TernaryControls, {
        target: document.body,
        props: { controls_open: true, grid_step: 0.25 },
      }),
  },
])(
  `$title reset clears authored deviations from defaults`,
  async ({ title, mount_controls }) => {
    mount_controls()
    await tick()
    const selector = `button[title="Reset ${title} to defaults"]`
    doc_query<HTMLButtonElement>(selector).click()
    await tick()
    expect(document.querySelector(selector)).toBeNull()
  },
)
