import { ScatterPlot3D } from '$lib'
import { ScatterPlot3DControls } from '$lib/plot'
import type { DataSeries3D, Surface3DConfig } from '$lib/plot/core/types'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, expect_plot_controls } from '../setup'
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

  afterEach(() => {
    if (mounted_component) {
      void unmount(mounted_component)
      mounted_component = null
    }
    container.remove()
    vi.restoreAllMocks()
  })

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
    [
      `comprehensive configuration options`,
      {
        series: [
          {
            ...basic_series,
            color_values: [0, 0.25, 0.5, 0.75, 1],
            size_values: [1, 2, 3, 4, 5],
            line_style: { stroke: `red`, stroke_width: 2, line_dash: `5 3` },
          },
        ],
        surfaces: [grid_surface],
        x_axis: { label: `X Dimension`, range: [0, 10], ticks: [1, 5, 10] },
        y_axis: { label: `Y Dimension`, range: [0, 20], ticks: 4 },
        z_axis: { label: `Z Dimension`, range: [0, 5], format: `.2f` },
        display: { show_axes: false, show_grid: false },
        camera_position: [10, 10, 10],
        camera_projection: `orthographic`,
        gizmo: false,
        auto_rotate: 2,
        color_scale: { scheme: `interpolateViridis` },
        size_scale: { radius_range: [0.05, 0.3] },
        controls_open: true,
      },
    ],
    [`surface-only plot without series`, { series: [], surfaces: [grid_surface] }],
    // mismatched array lengths (y shorter, z longer) must not throw
    [
      `mismatched series array lengths`,
      { series: [{ x: [1, 2, 3], y: [1, 2], z: [1, 2, 3, 4] }] },
    ],
  ])(`mounts with %s`, async (_desc, props) => {
    mounted_component = mount(ScatterPlot3D, { target: container, props })
    await tick()
    expect(container.querySelector(`.scatter-3d`)).toBeInstanceOf(HTMLElement)
    const pane = container.querySelector(`.draggable-pane`)
    if (!(pane instanceof HTMLElement)) throw new Error(`controls pane not rendered`)
    expect(pane.style.display).toBe(props.controls_open ? `grid` : `none`)
  })

  const multi_series = [basic_series, { ...basic_series, label: `Other` }]
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
    mounted_component = mount(ScatterPlot3D, { target: container, props })
    await tick()
    expect(Boolean(container.querySelector(`.legend`))).toBe(expect_legend)
  })

  test.each([
    {
      name: `no-id replacement preserves visibility by index`,
      id_mode: `none` as const,
      expected_after_click: [true, false],
      expected_after_replacement: [true, false],
    },
    {
      name: `stable-id replacement preserves visibility`,
      id_mode: `unique` as const,
      expected_after_click: [true, false],
      expected_after_replacement: [true, false],
    },
    {
      name: `duplicate-id visibility does not leak between series`,
      id_mode: `duplicate` as const,
      expected_after_click: [true, false],
      expected_after_replacement: [true, false],
    },
    {
      name: `duplicate-id key cannot collide with a real id`,
      id_mode: `duplicate_collision` as const,
      expected_after_click: [true, false, false],
      expected_after_replacement: [true, false, false],
    },
  ])(`$name`, async ({ id_mode, expected_after_click, expected_after_replacement }) => {
    mounted_component = mount(ScatterPlot3DHarness, {
      target: container,
      props: { id_mode },
    })
    await tick()
    const legend_items = () => container.querySelectorAll<HTMLElement>(`.legend-item`)
    const hidden_states = () =>
      Array.from(legend_items(), (item) => item.classList.contains(`hidden`))

    expect(legend_items()).toHaveLength(expected_after_click.length)
    legend_items()[0].click()
    flushSync()
    expect(hidden_states()).toEqual(expected_after_click)

    container.querySelector<HTMLButtonElement>(`[data-testid="replace-series"]`)?.click()
    flushSync()
    expect(hidden_states()).toEqual(expected_after_replacement)
  })

  // The standalone controls component is exported from $lib/plot, so its prop names are
  // public API: it must speak controls_open/show_controls like every other *Controls
  // component rather than the generic DraggablePane `open`.
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

    void unmount(mounted_component)
    mounted_component = mount(ScatterPlot3DControls, {
      target: container,
      props: { series: [basic_series], show_controls: false },
    })
    await tick()
    expect(container.querySelector(`.draggable-pane`)).toBeNull()
  })
})
