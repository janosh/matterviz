import type { ScatterPlotOptions, BarPlotOptions, HistogramOptions } from '$lib/plot'
import type { BandsOptions, DosOptions } from '$lib/spectral'
import type { StructureOptions } from '$lib/structure'
import type { BrillouinZoneOptions } from '$lib/brillouin'
import ElementScatter from '$lib/plot/scatter/ElementScatter.svelte'
import { element_data } from '$lib/element'
import type { InternalPoint } from '$lib/plot/core/types'
import { selected } from '$lib/state.svelte'
import { flushSync, mount, tick, type ComponentProps } from 'svelte'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import { bind_props, expect_plot_controls, mount_sized } from '../setup'

// Atomic radii for first 10 elements (H through Ne)
const y_values = [53, 31, 167, 112, 87, 77, 75, 73, 71, 69]

describe(`ElementScatter`, () => {
  afterEach(() => (selected.element = null)) // module-global, so don't leak between tests

  test(`presentation props cannot replace computed data`, async () => {
    expectTypeOf<
      Extract<
        keyof ComponentProps<typeof ElementScatter>,
        'series' | 'data_loader' | 'selected_series_idx'
      >
    >().toEqualTypeOf<never>()
    type ForbiddenOptions =
      | 'series'
      | 'data_loader'
      | 'selected_series_idx'
      | 'structure'
      | 'structure_series_key'
      | 'band_structs'
      | 'doses'
      | 'bz_data'
      | 'k_path_points'
    type Options = ScatterPlotOptions &
      BarPlotOptions &
      HistogramOptions &
      BandsOptions &
      DosOptions &
      StructureOptions &
      BrillouinZoneOptions
    expectTypeOf<Extract<keyof Options, ForbiddenOptions>>().toEqualTypeOf<never>()
    // JavaScript callers can still pass extra keys: owned data must win at runtime too.
    const props = {
      y: y_values,
      series: [{ x: [999], y: [999], label: `injected data` }],
      show_legend: true,
    }
    const root = await mount_sized(ElementScatter, props, { selector: `.scatter` })
    expect(root.textContent).not.toContain(`injected data`)
    expect(root.querySelectorAll(`.marker`)).toHaveLength(y_values.length)
  })

  test(`forwards axis selection and visibility notifications`, async () => {
    const on_axis_change = vi.fn()
    const on_hidden_series_change = vi.fn()
    const on_toggle = vi.fn()
    const props: ComponentProps<typeof ElementScatter> = {
      y: y_values,
      show_legend: true,
      on_axis_change,
      on_hidden_series_change,
      legend: { on_toggle },
      x_axis: {
        label: `Number`,
        selected_key: `number`,
        options: [
          { key: `number`, label: `Number` },
          { key: `mass`, label: `Mass` },
        ],
      },
    }
    const root = await mount_sized(ElementScatter, props, { selector: `.scatter` })
    root.querySelector<HTMLButtonElement>(`button.axis-trigger`)?.click()
    flushSync()
    const option = [...document.querySelectorAll<HTMLButtonElement>(`[role="option"]`)].find(
      (candidate) => candidate.textContent?.includes(`Mass`),
    )
    expect(option).toBeDefined()
    option?.click()
    await tick()
    expect(on_axis_change).toHaveBeenCalledWith(`x`, `mass`)
    root.querySelector<HTMLElement>(`.legend-item`)?.click()
    await tick()
    expect(on_toggle).toHaveBeenCalledOnce()
    expect(on_hidden_series_change).toHaveBeenCalledOnce()
    expect(on_hidden_series_change.mock.calls[0][0]).toHaveLength(1)
    expect(root.querySelector(`.legend-item`)?.getAttribute(`aria-pressed`)).toBe(`false`)
  })

  test.each<[string, Partial<ComponentProps<typeof ElementScatter>>, (string | RegExp)[]]>([
    [
      `atomic number, symbol, and name`,
      { tooltip_point: { x: 6, y: 77, series_idx: 0, point_idx: 5 } },
      [/6\s+C\s+-\s+Carbon/],
    ],
    [
      `y-axis label and unit`,
      { y_axis: { label: `Atomic Radius` }, y_unit: ` pm` },
      [`Atomic Radius`, `pm`],
    ],
    [`default value label`, {}, [`Value`]],
  ])(`tooltip shows %s`, async (_name, props, expected) => {
    document.body.replaceChildren()
    mount(ElementScatter, {
      target: document.body,
      props: {
        y: y_values,
        hovered: true,
        tooltip_point: { x: 1, y: 53, series_idx: 0, point_idx: 0 },
        ...props,
      },
    })
    await tick()
    const text = document.querySelector(`.plot-tooltip`)?.textContent ?? ``
    for (const fragment of expected) expect(text).toMatch(fragment)
  })

  test(`forwards flat control props and round-trips controls_open`, async () => {
    expect.hasAssertions()
    document.body.replaceChildren()
    const controls_state = { controls_open: true }
    mount(ElementScatter, {
      target: document.body,
      props: bind_props(
        {
          y: y_values,
          show_controls: true,
          controls_toggle_props: { 'data-testid': `element-toggle` },
          controls_pane_props: { 'data-testid': `element-pane` },
        },
        controls_state,
      ),
    })
    await tick()

    await expect_plot_controls(document, controls_state, `element`)
  })

  // The plot styles a marker as hovered off `tooltip_point` alone, so leaving it set once the
  // pointer has left the periodic table strands that marker enlarged and brightened.
  test(`mirrors the hovered element tile onto tooltip_point and clears it again`, async () => {
    document.body.replaceChildren()
    const state: { tooltip_point: InternalPoint | null } = { tooltip_point: null }
    mount(ElementScatter, {
      target: document.body,
      props: bind_props({ y: y_values }, state),
    })

    selected.element = element_data.find((elem) => elem.number === 6) ?? null
    await tick()
    expect(state.tooltip_point).toMatchObject({ x: 6, y: 77, point_idx: 5 })

    selected.element = null // pointer left the table
    await tick()
    expect(state.tooltip_point).toBeNull()
  })
})
