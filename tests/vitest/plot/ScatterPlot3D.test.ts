import { ScatterPlot3D } from '$lib'
import { ScatterPlot3DControls } from '$lib/plot'
import type { DataSeries3D, Surface3DConfig } from '$lib/plot/core/types'
import scatter_plot_3d_source from '$lib/plot/scatter-3d/ScatterPlot3D.svelte?raw'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bind_props, expect_plot_controls } from '../setup'

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
  ])(`mounts with %s`, async (_desc, props) => {
    await mount_plot(props)
    expect(container.querySelector(`.scatter-3d`)).toBeInstanceOf(HTMLElement)
    const pane = container.querySelector(`.draggable-pane`)
    if (!(pane instanceof HTMLElement)) throw new Error(`controls pane not rendered`)
    expect(pane.style.display).toBe(props.controls_open ? `grid` : `none`)
  })

  test(`rejects misaligned 3D coordinates`, () => {
    expect(() => {
      mounted_component = mount(ScatterPlot3D, {
        target: container,
        props: {
          series: [{ id: `points`, x: [1, 2, 3], y: [1, 2], z: [1, 2, 3, 4] }],
        },
      })
      flushSync()
    }).toThrow(`Series "points": aligned arrays must have equal lengths, got x=3, y=2, z=4`)
    mounted_component = null
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

  test(`uses the configured fullscreen background`, () => {
    expect(scatter_plot_3d_source).toMatch(
      /div\.scatter-3d\.fullscreen[\s\S]+background: var\(--scatter3d-bg-fullscreen/,
    )
  })

  test(`legend click hides the series and writes visible=false into a bound series`, async () => {
    const click_first_item = () => {
      const first_item = container.querySelector<HTMLElement>(`.legend-item`)
      if (!first_item) throw new Error(`legend item not rendered`)
      first_item.click()
      flushSync()
      return first_item
    }
    // unbound: the component owns visibility and greys out the legend entry
    await mount_plot({ series: multi_series })
    expect(click_first_item().classList.contains(`hidden`)).toBe(true)
    // original series objects are replaced, never mutated
    expect(multi_series[0].visible).toBeUndefined()
    if (mounted_component) await unmount(mounted_component)

    // bound: the toggle is written back into the caller's series array (plain state here, so
    // the DOM can't re-render from it - that path is covered above)
    const state = { series: multi_series }
    await mount_plot(bind_props({}, state))
    click_first_item()
    expect(state.series.map((srs) => srs.visible ?? true)).toEqual([false, true])
  })

  test(`browser exit updates the fullscreen binding`, async () => {
    const state = { fullscreen: true }
    await mount_plot(bind_props({ series: [basic_series] }, state))
    expect(container.querySelector(`.scatter-3d.fullscreen`)).not.toBeNull()
    await document.exitFullscreen()
    flushSync()
    expect(state.fullscreen).toBe(false)
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
