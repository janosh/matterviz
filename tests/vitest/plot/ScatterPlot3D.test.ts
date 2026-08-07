import { ScatterPlot3D } from '$lib'
import { ScatterPlot3DControls } from '$lib/plot'
import type { DataSeries3D, Surface3DConfig } from '$lib/plot/core/types'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, expect_plot_controls, press_window_key } from '../setup'
import ScatterPlot3DHarness from './ScatterPlot3DHarness.svelte'

// Smoke tests to ensure component mounts without errors.
// Meaningful 3D rendering tests require Playwright visual regression testing,
// not jsdom-based unit tests which cannot verify WebGL/Three.js output.

const basic_series: DataSeries3D = {
  x: [1, 2, 3, 4, 5],
  y: [2, 4, 6, 8, 10],
  z: [1, 1, 2, 2, 3],
  point_style: { fill: `steelblue`, radius: 5 },
  label: `Test Series`,
}

const grid_surface: Surface3DConfig = {
  type: `grid`,
  x_range: [-1, 1],
  y_range: [-1, 1],
  resolution: 10,
  z_fn: (x_coord, y_coord) => x_coord * x_coord + y_coord * y_coord,
  color: `#3498db`,
  opacity: 0.7,
}

const parametric_surface: Surface3DConfig = {
  type: `parametric`,
  u_range: [0, Math.PI * 2],
  v_range: [0, Math.PI],
  resolution: [10, 10],
  parametric_fn: (u_param, v_param) => ({
    x: Math.sin(v_param) * Math.cos(u_param) * 0.5,
    y: Math.sin(v_param) * Math.sin(u_param) * 0.5,
    z: Math.cos(v_param) * 0.5,
  }),
  opacity: 0.6,
}

const triangulated_surface: Surface3DConfig = {
  type: `triangulated`,
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0.5, y: 1, z: 0.5 },
  ],
  triangles: [[0, 1, 2]],
  opacity: 0.8,
}

describe(`ScatterPlot3D smoke tests`, () => {
  let container: HTMLDivElement
  let mounted_component: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    container = document.createElement(`div`)
    document.body.append(container)
    // Suppress WebGL warnings in jsdom environment
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    vi.spyOn(console, `error`).mockImplementation(() => {})
  })

  afterEach(async () => {
    if (mounted_component) {
      await unmount(mounted_component)
      mounted_component = null
    }
    container.remove()
    vi.restoreAllMocks()
  })

  const mount_plot = async (props: ComponentProps<typeof ScatterPlot3D>): Promise<void> => {
    mounted_component = mount(ScatterPlot3D, { target: container, props })
    await tick()
  }

  test.each<[string, ComponentProps<typeof ScatterPlot3D>]>([
    [`series data`, { series: [basic_series] }],
    [`empty series`, { series: [] }],
    [
      `all surface types`,
      {
        series: [basic_series],
        surfaces: [grid_surface, parametric_surface, triangulated_surface],
      },
    ],
    [`open controls`, { series: [basic_series], controls_open: true }],
    [`surface-only plot without series`, { series: [], surfaces: [grid_surface] }],
    // mismatched array lengths (y shorter, z longer) must not throw
    [
      `mismatched series array lengths`,
      { series: [{ x: [1, 2, 3], y: [1, 2], z: [1, 2, 3, 4] }] },
    ],
  ])(`mounts with %s`, async (_desc, props) => {
    await mount_plot(props)
    expect(container.querySelector(`.scatter-3d`)).toBeInstanceOf(HTMLElement)
    const pane = container.querySelector(`.draggable-pane`)
    if (!(pane instanceof HTMLElement)) throw new Error(`controls pane not rendered`)
    expect(pane.style.display).toBe(props.controls_open ? `grid` : `none`)
  })

  const multi_series = [basic_series, { ...basic_series, label: `Other` }]
  const color_series = { ...basic_series, color_values: [0, 1, 2, 3, 4] }
  test.each<[string, ComponentProps<typeof ScatterPlot3D>, boolean]>([
    [`auto hides a single series`, { series: [basic_series] }, false],
    [
      `explicit true forces a one-series legend`,
      { series: [basic_series], show_legend: true },
      true,
    ],
    [`explicit false hides multiple`, { series: multi_series, show_legend: false }, false],
    [
      `legend=null overrides show_legend=true`,
      { series: multi_series, show_legend: true, legend: null },
      false,
    ],
    [`auto shows multiple series`, { series: multi_series }, true],
  ])(`legend visibility: %s`, async (_desc, props, expect_legend) => {
    await mount_plot(props)
    expect(Boolean(container.querySelector(`.legend`))).toBe(expect_legend)
  })

  test.each<[string, ComponentProps<typeof ScatterPlot3D>, boolean]>([
    [`color values`, { series: [color_series] }, true],
    [`no color values`, { series: [basic_series] }, false],
    [`color bar disabled`, { series: [color_series], color_bar: null }, false],
  ])(`color bar with %s`, async (_desc, props, expected) => {
    await mount_plot(props)
    expect(Boolean(container.querySelector(`.colorbar`))).toBe(expected)
  })

  test(`legend toggles series visibility and reports the change`, async () => {
    const on_series_visibility_change = vi.fn()
    await mount_plot({ series: multi_series, on_series_visibility_change })
    const first_item = container.querySelector<HTMLElement>(`.legend-item`)
    if (!first_item) throw new Error(`legend item not rendered`)
    first_item.click()
    flushSync()
    expect(first_item.classList.contains(`hidden`)).toBe(true)
    expect(on_series_visibility_change).toHaveBeenCalledWith(0, false)
  })

  test(`Escape exits fullscreen through the bindable prop`, async () => {
    const state = { fullscreen: true }
    await mount_plot(bind_props({ series: [basic_series] }, state))
    expect(container.querySelector(`.scatter-3d.fullscreen`)).not.toBeNull()
    const event = press_window_key({ key: `Escape` })
    expect(state.fullscreen).toBe(false)
    expect(event.defaultPrevented).toBe(true)
  })

  test.each([
    [`no-id replacement preserves visibility by index`, `none`, 2],
    [`stable-id replacement preserves visibility`, `unique`, 2],
    [`duplicate-id visibility does not leak between series`, `duplicate`, 2],
    [`duplicate-id key cannot collide with a real id`, `duplicate_collision`, 3],
  ] as const)(`%s`, async (_name, id_mode, item_count) => {
    mounted_component = mount(ScatterPlot3DHarness, {
      target: container,
      props: { id_mode },
    })
    await tick()
    const legend_items = () => container.querySelectorAll<HTMLElement>(`.legend-item`)
    const hidden_states = () =>
      Array.from(legend_items(), (item) => item.classList.contains(`hidden`))
    const expected_visibility = [true, ...Array(item_count - 1).fill(false)]

    expect(legend_items()).toHaveLength(expected_visibility.length)
    legend_items()[0].click()
    flushSync()
    expect(hidden_states()).toEqual(expected_visibility)

    container.querySelector<HTMLButtonElement>(`[data-testid="replace-series"]`)?.click()
    flushSync()
    expect(hidden_states()).toEqual(expected_visibility)
  })

  // The standalone controls component is exported from $lib/plot, so its prop names are
  // public API: it must speak controls_open/show_controls like every other *Controls
  // component rather than the generic DraggablePane `open`.
  test(`standalone controls write display and axis changes`, async () => {
    const controls_state = {
      display: { show_axes: true },
      x_axis: { label: `X`, range: [null, null] as [null, null] },
    }
    mounted_component = mount(ScatterPlot3DControls, {
      target: container,
      props: bind_props({ series: [basic_series] }, controls_state),
    })
    await tick()

    const show_axes = container.querySelector<HTMLInputElement>(`input[type="checkbox"]`)
    const x_min = container.querySelector<HTMLInputElement>(`[aria-label="X min"]`)
    if (!show_axes || !x_min) {
      throw new Error(`expected standalone 3D controls not rendered`)
    }

    show_axes.click()
    x_min.value = `2`
    x_min.dispatchEvent(new Event(`input`, { bubbles: true }))
    flushSync()

    expect(controls_state.display.show_axes).toBe(false)
    expect(controls_state.x_axis).toEqual({ label: `X`, range: [2, 5.2] })
  })

  test(`standalone controls expose show_controls and a two-way controls_open`, async () => {
    const controls_state = { controls_open: true }
    mounted_component = mount(ScatterPlot3DControls, {
      target: container,
      props: bind_props(
        {
          series: [basic_series],
          toggle_props: { 'data-testid': `scatter-3d-toggle` },
          pane_props: { 'data-testid': `scatter-3d-pane` },
        },
        controls_state,
      ),
    })
    await tick()
    await expect_plot_controls(container, controls_state, `scatter-3d`)

    await unmount(mounted_component)
    mounted_component = null
    mounted_component = mount(ScatterPlot3DControls, {
      target: container,
      props: { series: [basic_series], show_controls: false },
    })
    await tick()
    expect(container.querySelector(`.draggable-pane`)).toBeNull()
  })
})
