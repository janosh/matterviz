import { ScatterPlot3D, ScatterPlot3DControls } from '$lib/plot'
import ScatterTestPage from '../../../src/routes/test/scatter-plot-3d/+page.svelte'
import type { DataSeries3D, Surface3DConfig } from '$lib/plot/core/types'
import {
  hover_marker_geometry,
  normalize_to_scene,
  span_or,
} from '$lib/plot/scatter-3d/scene-coords'
import { type ComponentProps, flushSync, mount, tick, unmount } from 'svelte'
import { Object3D, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { mock_fullscreen, bind_props, expect_plot_controls, query } from '../setup'

vi.mock(`$app/environment`, () => ({ browser: false }))
vi.mock(`$app/state`, () => ({
  page: {
    url: {
      get searchParams(): never {
        throw new Error(`Cannot access url.searchParams on a page with prerendering enabled`)
      },
    },
  },
}))

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

  test(`page initializes without query access during prerendering`, async () => {
    mounted_component = mount(ScatterTestPage, { target: container })
    await tick()
    expect(container.querySelector(`#test-scatter-3d`)).toBeInstanceOf(HTMLElement)
  })

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

  // A caller's wrapper_style must append to the corner placement, not replace it
  test(`color bar keeps its corner placement when the caller styles it`, async () => {
    await mount_plot({
      series: [color_series],
      color_bar: { wrapper_style: `opacity: 0.5`, style: `border: 1px solid red` },
    })
    const wrapper = query(container, `.colorbar`)
    const style = wrapper.getAttribute(`style`) ?? ``
    expect(style).toContain(`position: absolute`)
    expect(style).toContain(`left: 2em`)
    expect(style).toContain(`opacity: 0.5`)
    // `style` rides the same root element, so it must survive the corner placement too
    expect(style).toContain(`border: 1px solid red`)
  })

  test(`maps the chart's fullscreen background onto the shared shell`, async () => {
    await mount_plot({ series: [basic_series] })
    expect(container.querySelector(`.scatter-3d`)?.getAttribute(`style`)).toContain(
      `--chart-shell-fullscreen-bg: var(--scatter3d-fullscreen-bg, var(--scatter3d-bg, var(--plot-bg, transparent)))`,
    )
  })

  test(`legend click hides the series and writes bound hidden_series`, async () => {
    const click_first_item = () => {
      const first_item = query(container, `.legend-item`)
      first_item.click()
      flushSync()
      return first_item
    }
    // unbound: the component owns visibility and greys out the legend entry
    const on_toggle = vi.fn()
    const on_double_click = vi.fn()
    const on_group_toggle = vi.fn()
    await mount_plot({
      series: multi_series.map((srs) => ({ ...srs, legend_group: `Group` })),
      legend: { on_toggle, on_double_click, on_group_toggle },
    })
    expect(click_first_item().classList.contains(`hidden`)).toBe(true)
    expect(on_toggle).toHaveBeenCalledExactlyOnceWith(0)
    query(container, `.legend-item`).dispatchEvent(
      new MouseEvent(`dblclick`, { bubbles: true }),
    )
    flushSync()
    expect(on_double_click).toHaveBeenCalledExactlyOnceWith(0)
    expect(query(container, `.legend-item`).classList.contains(`hidden`)).toBe(false)
    const group = query(container, `.legend-group-header`)
    for (const hidden_count of [0, 2]) {
      group.click()
      flushSync()
      expect(container.querySelectorAll(`.legend-item.hidden`)).toHaveLength(hidden_count)
    }
    expect(on_group_toggle).toHaveBeenCalledTimes(2)
    expect(on_group_toggle).toHaveBeenLastCalledWith(`Group`, [0, 1])
    // original series objects are replaced, never mutated
    expect(multi_series[0].visible).toBeUndefined()
    if (mounted_component) await unmount(mounted_component)

    // Bound: the toggle writes hidden IDs (plain state here, so
    // the DOM can't re-render from it - that path is covered above)
    const state = { series: multi_series, hidden_series: [] as (string | number)[] }
    await mount_plot(
      bind_props(
        {
          legend: {
            on_toggle: () => expect(state.hidden_series).toEqual([0]),
          },
        },
        state,
      ),
    )
    click_first_item()
    expect(state.series).toBe(multi_series)
    expect(state.hidden_series).toEqual([0])
  })

  test(`legend-hidden series stays hidden across one-way series replacement until the parent changes hidden_series`, async () => {
    const make_series = (first_extra: Partial<DataSeries3D> = {}): DataSeries3D[] => [
      { ...basic_series, id: `a`, ...first_extra },
      { ...basic_series, id: `b`, label: `Other` },
    ]
    const state = $state<{
      series: DataSeries3D[]
      hidden_series?: readonly (string | number)[]
    }>({ series: make_series() })
    // getter-only prop: one-way, so the component cannot write back into the parent
    await mount_plot({
      get series() {
        return state.series
      },
      get hidden_series() {
        return state.hidden_series
      },
      set hidden_series(value) {
        state.hidden_series = value
      },
    })
    const first_hidden = () =>
      container.querySelector<HTMLElement>(`.legend-item`)?.classList.contains(`hidden`)
    // the legend renders once the threlte canvas has mounted, so poll rather than flush
    await vi.waitFor(() => expect(container.querySelector(`.legend-item`)).not.toBeNull())
    container.querySelector<HTMLElement>(`.legend-item`)?.click()
    await vi.waitFor(() => expect(first_hidden()).toBe(true))
    expect(state.series[0].visible).toBeUndefined()

    // parent rebuilds the array (anywidget trait sync, notebook re-render, ...)
    state.series = make_series()
    flushSync()
    await vi.waitFor(() => expect(first_hidden()).toBe(true))

    // The host explicitly controls visibility without rewriting data.
    state.hidden_series = []
    flushSync()
    await vi.waitFor(() => expect(first_hidden()).toBe(false))
  })

  test(`browser exit updates the fullscreen binding`, async () => {
    mock_fullscreen()
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
    mounted_component = mount(ScatterPlot3DControls, {
      target: container,
      props: { series: [basic_series], show_controls: false },
    })
    await tick()
    expect(container.querySelector(`.draggable-pane`)).toBeNull()
  })
})

describe(`scene coordinates`, () => {
  test.each([`perspective`, `orthographic`] as const)(
    `%s tooltip clears the halo by 8 screen pixels at every orbit angle and zoom`,
    (projection) => {
      const size = { width: 800, height: 400 }
      const point = new Object3D()
      point.position.set(1, 0.5, -0.5)
      point.updateMatrixWorld()
      const camera =
        projection === `perspective`
          ? new PerspectiveCamera(60, 2, 0.1, 100)
          : new OrthographicCamera(-10, 10, 5, -5, 0.1, 100)
      for (const elevation of [0, Math.PI / 4, Math.PI / 2 - 0.001, Math.PI / 2]) {
        camera.position
          .copy(point.position)
          .add(new Vector3(10 * Math.cos(elevation), 10 * Math.sin(elevation), 0))
        camera.lookAt(point.position)
        camera.updateMatrixWorld()
        for (const zoom of [1, 2]) {
          camera.zoom = zoom
          camera.updateProjectionMatrix()
          for (const marker_radius of [0, 0.1, 0.25, 1]) {
            const geometry = hover_marker_geometry(marker_radius)
            // 1e-9 CSS pixels is far below visible precision for these matrix projections.
            const pixels_per_unit =
              projection === `perspective`
                ? (size.height * zoom) / (20 * Math.tan(Math.PI / 6))
                : (size.height * zoom) / 10
            const [pixel_x, pixel_y] = geometry.tooltip_position(point, camera, size)
            expect(Math.abs(geometry.radius - marker_radius * 1.15)).toBeLessThanOrEqual(
              Number.EPSILON,
            )
            expect(Math.abs(pixel_x - size.width / 2)).toBeLessThan(1e-9)
            expect(
              Math.abs(pixel_y - (size.height / 2 - geometry.radius * pixels_per_unit - 8)),
            ).toBeLessThan(1e-9)
          }
        }
      }
    },
  )

  test.each<[[number | null, number | null] | undefined, [number, number]]>([
    [undefined, [0, 100]],
    [
      [20, 80],
      [20, 80],
    ],
    [
      [null, 80],
      [0, 80],
    ],
    [
      [20, null],
      [20, 100],
    ],
    [
      [null, null],
      [0, 100],
    ],
  ])(`span_or(%j) fills nullish bounds from the range`, (span, expected) => {
    expect(span_or(span, [0, 100])).toEqual(expected)
  })

  test.each([
    [0, 10],
    [5, 0],
    [10, -10],
  ])(`normalize_to_scene centers %s in a [0, 10] range at %s`, (value, expected) => {
    expect(normalize_to_scene(value, [0, 10], 20)).toBeCloseTo(-expected)
    expect(normalize_to_scene(value, [3, 3], 20)).toBe(0) // degenerate range collapses
  })
})
