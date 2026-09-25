import { ScatterPlot3D, ScatterPlot3DControls } from '$lib/plot'
import ScatterPlot3DScene from '$lib/plot/scatter-3d/ScatterPlot3DScene.svelte'
import Surface3D from '$lib/plot/scatter-3d/Surface3D.svelte'
import ReferencePlane from '$lib/plot/scatter-3d/ReferencePlane.svelte'
import ScatterTestPage from '../../../src/routes/test/scatter-plot-3d/+page.svelte'
import type {
  AxisConfig3D,
  DataSeries3D,
  DisplayConfig3D,
  Scatter3DHandlerEvent,
  Surface3DConfig,
} from '$lib/plot/core/types'
import {
  hover_marker_geometry,
  normalize_to_scene,
  sample_surface,
  get_3d_auto_ranges,
  span_or,
} from '$lib/plot/scatter-3d/scene-coords'
import { resolve_axis_range } from '$lib/plot/core/interactions'
import { mount_scene } from '../scene/mount'
import { type ComponentProps, createRawSnippet, flushSync, mount, tick, unmount } from 'svelte'
import {
  type BufferGeometry,
  ClippingGroup,
  EdgesGeometry,
  InstancedMesh,
  Line,
  LineSegments,
  Matrix4,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
} from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from 'vitest'
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
  x_range: [-10, 10],
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
    x: Math.sin(v_param) * Math.cos(u_param) * 10,
    y: Math.sin(v_param) * Math.sin(u_param) * 0.5,
    z: Math.cos(v_param) * 0.5,
  }),
  opacity: 0.6,
}

const triangulated_surface: Surface3DConfig = {
  type: `triangulated`,
  points: [
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 0.5, y: 1, z: 0.5 },
  ],
  triangles: [[0, 1, 2]],
  opacity: 0.8,
}

test.each([`surface`, `axes`, `reference plane`] as const)(
  `%s releases replaced geometry without Threlte retaining or disposing it again`,
  async (kind) => {
    const inputs = $state({ extent: 1 })
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const { scene, disposable_objects, unmount_scene } = mount_scene((anchor) => {
      if (kind === `surface`)
        return Surface3D(anchor, {
          config: {
            type: `grid`,
            resolution: 3,
            wireframe: true,
            z_fn: (coord_x: number, coord_y: number) => coord_x + coord_y,
          },
          get x_range(): [number, number] {
            return [0, inputs.extent]
          },
        })
      if (kind === `reference plane`)
        return ReferencePlane(anchor, {
          ref_plane: { type: `xy`, z: 0, style: { wireframe: true } },
          get ranges(): ComponentProps<typeof ReferencePlane>[`ranges`] {
            return { x: [0, inputs.extent], y: [0, 1], z: [0, 1] }
          },
        })
      return ScatterPlot3DScene(anchor, {
        get ranges(): ComponentProps<typeof ScatterPlot3DScene>[`ranges`] {
          return { x: [0, inputs.extent], y: [0, inputs.extent], z: [0, inputs.extent] }
        },
        x_axis: { ticks: [0, 1] },
        y_axis: { ticks: [0, 1] },
        z_axis: { ticks: [0, 1] },
        display: { show_axis_labels: false },
        gizmo: false,
      })
    })
    const geometries = new Map<BufferGeometry, ReturnType<typeof vi.spyOn>>()
    try {
      for (const extent of [1, 2, 4, 1]) {
        inputs.extent = extent
        flushSync()
        const active = new Set<BufferGeometry>()
        scene.traverse((object) => {
          if (!(object instanceof Mesh || object instanceof Line)) return
          const { geometry } = object
          // Background planes own their constructor-created geometry through Threlte.
          if ([`BufferGeometry`, `WireframeGeometry`].includes(geometry.type))
            active.add(geometry)
        })
        expect(active.size).toBe(kind === `axes` ? 21 : 2)
        for (const geometry of active) {
          if (!geometries.has(geometry))
            geometries.set(geometry, vi.spyOn(geometry, `dispose`))
        }
        for (const [geometry, dispose] of geometries) {
          expect(dispose).toHaveBeenCalledTimes(active.has(geometry) ? 0 : 1)
          if (!active.has(geometry)) expect(disposable_objects.has(geometry)).toBe(false)
        }
      }
    } finally {
      await unmount_scene()
    }
    for (const dispose of geometries.values()) expect(dispose).toHaveBeenCalledTimes(1)
  },
)

// Every object under `root` of the given class
const find_objects = <Ctor extends new (...args: never[]) => Object3D>(
  root: Object3D,
  type: Ctor,
): InstanceType<Ctor>[] => {
  const found: InstanceType<Ctor>[] = []
  root.traverse((object) => {
    if (object instanceof type) found.push(object as InstanceType<Ctor>)
  })
  return found
}

describe(`ScatterPlot3DScene geometry`, () => {
  // Scene position of a data point in the [0, 4]^3 test box: user z is Three.js y
  const scene_pos = (data_x: number, data_y: number, data_z: number) => [
    normalize_to_scene(data_x, [0, 4], 10),
    normalize_to_scene(data_z, [0, 4], 5),
    normalize_to_scene(data_y, [0, 4], 10),
  ]
  const mount_points = (
    state: { series: DataSeries3D[]; hovered_point?: unknown },
    extra: Partial<ComponentProps<typeof ScatterPlot3DScene>> = {},
  ) => {
    const portal = document.createElement(`div`)
    document.body.append(portal)
    const tooltip = createRawSnippet((data: () => Scatter3DHandlerEvent) => ({
      render: () => `<span class="tip"></span>`,
      setup: (node: Element) => {
        $effect(() => {
          const { x, y, z, fullscreen } = data()
          node.textContent = `${x},${y},${z} ${fullscreen}`
        })
      },
    }))
    const mounted = mount_scene((anchor) =>
      ScatterPlot3DScene(anchor, {
        get series() {
          return state.series
        },
        ranges: { x: [0, 4], y: [0, 4], z: [0, 4] },
        gizmo: false,
        tooltip,
        tooltip_portal: portal,
        get hovered_point() {
          return (state.hovered_point ?? null) as never
        },
        set hovered_point(value) {
          state.hovered_point = value
        },
        ...extra,
      }),
    )
    flushSync()
    return { ...mounted, portal }
  }

  // Every point used to be its own <Instance>, re-uploaded each frame so the on-demand scene
  // never went idle, and points outside a narrowed axis range drew outside the box
  test(`draws in-range points as one InstancedMesh and stops rendering once idle`, async () => {
    const state = $state({
      series: [
        { x: [1, 2, 3, 3.5, 9, 1], y: [1, 1, 3, 0.5, 1, 1], z: [1, 3, 3, 2, 1, -5] },
      ] as DataSeries3D[],
    })
    const { scene, render_frame, unmount_scene } = mount_points(state)
    const instances = () => {
      const [mesh, ...stale] = find_objects(scene, InstancedMesh)
      expect(stale).toHaveLength(0)
      return mesh
    }
    const position_of = (mesh: InstancedMesh, idx: number) => {
      const matrix = new Matrix4()
      mesh.getMatrixAt(idx, matrix)
      return new Vector3().setFromMatrixPosition(matrix).toArray()
    }
    try {
      expect(instances().count).toBe(4)
      expect(position_of(instances(), 1)).toEqual(scene_pos(2, 1, 3))
      for (let frame = 0; frame < 3; frame++) render_frame()
      expect(Array.from({ length: 5 }, render_frame)).toEqual(Array(5).fill(false))
      // outgrowing the mesh's capacity swaps in a larger one and renders again
      state.series = [{ x: [0, 1, 2, 3, 4], y: [4, 3, 2, 1, 0], z: [0, 1, 2, 3, 4] }]
      flushSync()
      expect(render_frame()).toBe(true)
      expect(instances().count).toBe(5)
      expect(position_of(instances(), 4)).toEqual(scene_pos(4, 0, 4))
    } finally {
      await unmount_scene()
    }
  })

  // tooltip_point / event.point used to carry scene coordinates with y and z swapped
  test(`hover reports data coordinates and follows data changes`, async () => {
    const state = $state<{ series: DataSeries3D[]; hovered_point: unknown }>({
      series: [{ x: [1, 2, 3], y: [0.5, 1.5, 2.5], z: [3, 2, 1] }],
      hovered_point: null,
    })
    const { portal, scene, render_frame, unmount_scene } = mount_points(state, {
      fullscreen: true,
    })
    const tip_text = () => portal.querySelector(`.tip`)?.textContent
    try {
      state.hovered_point = { x: 2, y: 1.5, z: 2, series_idx: 0, point_idx: 1 }
      flushSync()
      render_frame()
      expect(tip_text()).toBe(`2,1.5,2 true`)
      // the hover halo is the one mesh drawn without depth testing
      const halo = find_objects(scene, Mesh).findLast(
        (mesh) => !Array.isArray(mesh.material) && !mesh.material.depthTest,
      )
      expect(halo?.position.toArray()).toEqual(scene_pos(2, 1.5, 2))
      // same logical point, new values: the tooltip moves with it
      state.series = [{ x: [1, 3, 3], y: [0.5, 0.5, 2.5], z: [3, 1, 1] }]
      flushSync()
      flushSync()
      render_frame()
      expect(state.hovered_point).toMatchObject({ x: 3, y: 0.5, z: 1, point_idx: 1 })
      expect(tip_text()).toBe(`3,0.5,1 true`)
      // the point is gone: hover clears instead of describing a stale point
      state.series = [{ x: [1], y: [1], z: [1] }]
      flushSync()
      expect(state.hovered_point).toBeNull()
      expect(tip_text()).toBeUndefined()
    } finally {
      await unmount_scene()
    }
  })

  test(`clips data geometry to the box and draws the bounding box on request`, async () => {
    const state = $state({
      series: [
        { x: [1, 2, 3], y: [1, 2, 3], z: [1, 2, 3], line_style: { stroke: `red` } },
      ] as DataSeries3D[],
    })
    const { scene, unmount_scene } = mount_points(state, {
      display: { show_bounding_box: true },
      surfaces: [grid_surface],
    })
    try {
      const [group, ...others] = find_objects(scene, ClippingGroup)
      expect(others).toHaveLength(0)
      // the planes keep the 10 x 5 x 10 box (user z is Three.js y) and cut just outside it
      const inside = (point: number[]) =>
        group.clippingPlanes.every(
          (plane) => plane.distanceToPoint(new Vector3().fromArray(point)) >= 0,
        )
      // oxfmt-ignore
      const probes = [[5, 2.5, 5], [0, 0, 0], [5.1, 0, 0], [0, 2.6, 0], [0, 0, -5.1]]
      expect(probes.map(inside)).toEqual([true, true, false, false, false])
      // the series line and the surface are clipped, the point mesh is range-filtered
      const clipped_types = new Set<string>()
      group.traverse((object) => clipped_types.add(object.type))
      expect([...clipped_types]).toEqual(expect.arrayContaining([`Line2`, `Mesh`]))
      const edges = find_objects(scene, LineSegments).filter(
        (line) => line.geometry instanceof EdgesGeometry,
      )
      expect(edges).toHaveLength(1)
    } finally {
      await unmount_scene()
    }
  })

  // NaN vertices (z undefined off the disk) used to poison the normals of their neighbours
  test(`surface drops triangles touching non-finite vertices`, async () => {
    const { scene, unmount_scene } = mount_scene((anchor) =>
      Surface3D(anchor, {
        config: {
          type: `grid`,
          resolution: 25,
          x_range: [-1, 1],
          y_range: [-1, 1],
          z_fn: (x_val: number, y_val: number) => Math.sqrt(1 - x_val ** 2 - y_val ** 2),
        },
        x_range: [-1, 1],
        y_range: [-1, 1],
        z_range: [0, 1],
      }),
    )
    flushSync()
    try {
      const geometry: BufferGeometry | undefined = find_objects(scene, Mesh).at(-1)?.geometry
      if (!geometry) throw new Error(`no surface mesh`)
      for (const name of [`position`, `normal`])
        expect([...geometry.getAttribute(name).array].every(Number.isFinite)).toBe(true)
      const index_count = geometry.index?.count ?? 0
      expect(index_count).toBeGreaterThan(0)
      expect(index_count).toBeLessThan(24 * 24 * 6)
    } finally {
      await unmount_scene()
    }
  })
})

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
    const pane = query(container, `.draggable-pane`)
    expect(pane.style.display).toBe(props.controls_open ? `grid` : `none`)
  })

  test.each<[string, ComponentProps<typeof ScatterPlot3D>, string]>([
    [
      `misaligned 3D coordinates`,
      { series: [{ id: `points`, x: [1, 2, 3], y: [1, 2], z: [1, 2, 3, 4] }] },
      `Series "points": aligned arrays must have equal lengths, got x=3, y=2, z=4`,
    ],
    // the scene maps axes linearly, so an untyped caller's log axis used to draw silently linear
    [
      `non-linear axis scale types`,
      { series: [basic_series], z_axis: { scale_type: `log` as never } },
      `ScatterPlot3D axes are linear, got scale_type [null,null,"log"]`,
    ],
  ])(`rejects %s`, (_desc, props, message) => {
    expect(() => {
      mounted_component = mount(ScatterPlot3D, { target: container, props })
      flushSync()
    }).toThrow(message)
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
    const group = query(container, `.legend-group-header .group-label`)
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
  // Each surface extends beyond the scatter samples, so controls must include its bounds.
  test.each([
    { name: `scatter`, max_value: 5.5, surface: undefined },
    ...[grid_surface, parametric_surface, triangulated_surface].map((surface) => ({
      name: surface.type,
      max_value: 12,
      surface,
    })),
  ])(
    `$name controls preserve default display and independently automatic axis bounds`,
    async ({ surface, max_value }) => {
      const controls_state = $state<{ display: DisplayConfig3D; x_axis: AxisConfig3D }>({
        display: {},
        x_axis: { label: `X`, range: [0.25, null] },
      })
      mounted_component = mount(ScatterPlot3D, {
        target: container,
        props: bind_props(
          { series: [basic_series], surfaces: surface ? [surface] : [], controls_open: true },
          controls_state,
        ),
      })
      await tick()

      const show_axes = query<HTMLInputElement>(container, `input[type="checkbox"]`)
      const x_min = query<HTMLInputElement>(container, `[aria-label="X min"]`)
      const x_max = query<HTMLInputElement>(container, `[aria-label="X max"]`)
      expect(show_axes.checked).toBe(true)
      expect(x_min.value).toBe(`0.25`)
      expect(x_max.value).toBe(``)
      expect(Number(x_max.placeholder)).toBe(max_value)

      show_axes.click()
      x_min.value = `2`
      x_min.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()

      expect(controls_state.display).toEqual({ show_axes: false })
      controls_state.display.projections = { xy: true }
      controls_state.display.projection_opacity = 0.7
      controls_state.display.projection_scale = 0.9
      flushSync()
      query<HTMLButtonElement>(
        container,
        `button[title="Reset projections to defaults"]`,
      ).click()
      flushSync()
      expect(controls_state.display).toEqual({
        show_axes: false,
        projections: { xy: false, xz: false, yz: false },
        projection_opacity: 0.3,
        projection_scale: 0.5,
      })
      query<HTMLButtonElement>(container, `button[title="Reset display to defaults"]`).click()
      flushSync()
      expect(controls_state.display).toMatchObject({
        show_axes: true,
        show_grid: true,
        show_axis_labels: true,
        show_bounding_box: false,
        projection_opacity: 0.3,
        projection_scale: 0.5,
      })
      expect(
        container.querySelector(`button[title="Reset projections to defaults"]`),
      ).toBeNull()
      expect(container.querySelector(`button[title="Reset display to defaults"]`)).toBeNull()
      expect(controls_state.x_axis).toEqual({ label: `X`, range: [2, null] })
      // Manual edits preserve an automatic opposite bound, exact small values, and clearing.
      for (const [value, expected] of [
        [`0.00000001`, 1e-8],
        [``, null],
      ] as const) {
        x_min.value = value
        x_min.dispatchEvent(new Event(`input`, { bubbles: true }))
        flushSync()
        expect(controls_state.x_axis.range).toEqual([expected, null])
        expect(x_min.value).toBe(expected === null ? `` : String(expected))
      }
      x_max.value = `7`
      x_max.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
      expect(controls_state.x_axis.range).toEqual([null, 7])
      const label_input = query<HTMLInputElement>(container, `[aria-label="X label"]`)
      label_input.value = `Energy`
      label_input.dispatchEvent(new Event(`input`, { bubbles: true }))
      flushSync()
      expect(controls_state.x_axis.label).toBe(`Energy`)
      query<HTMLButtonElement>(
        container,
        `button[title="Restore axes to initial values"]`,
      ).click()
      flushSync()
      expect(controls_state.x_axis).toEqual({ label: `X`, range: [0.25, null] })
      expect(x_min.value).toBe(`0.25`)
      expect(
        container.querySelector(`button[title="Restore axes to initial values"]`),
      ).toBeNull()
    },
  )

  test(`standalone controls expose show_controls and a two-way controls_open`, async () => {
    const controls_state = { controls_open: true }
    mounted_component = mount(ScatterPlot3DControls, {
      target: container,
      props: bind_props(
        {
          auto_ranges: {
            x: [0, 5] as [number, number],
            y: [0, 10] as [number, number],
            z: [0, 3] as [number, number],
          },
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
      props: { show_controls: false },
    })
    await tick()
    expect(container.querySelector(`.draggable-pane`)).toBeNull()
  })
})

describe(`scene coordinates`, () => {
  // oxfmt-ignore
  test.each<[[number | null, number | null], [number, number]]>([
    [[null, null], [0, 5.5]],
    [[0.123, null], [0.123, 5.5]],
    [[1e-8, null], [1e-8, 5.5]],
    [[null, 4.987], [0, 4.987]],
    [[0.123, 4.987], [0.123, 4.987]],
    [[100, null], [100, 110]],
    [[null, -100], [-110, -100]],
    [[5.5, null], [5.5, 11]],
    [[null, 0], [-5.5, 0]],
    [[4.987, 0.123], [4.987, 0.123]],
  ])(
    `manual bounds %j only expand automatic endpoints when needed`,
    (range, expected) => {
      const auto_ranges = get_3d_auto_ranges([{ x: [0, 5], y: [0, 5], z: [0, 5] }], [])
      expect(resolve_axis_range({ range }, auto_ranges.x)).toEqual(expected)
    },
  )

  test(`filters large triangulated surfaces and includes their bounds, skipping hidden series`, () => {
    const count = 200_000 // spreading these into push() exceeds the JS argument limit
    const points = Array.from({ length: count }, (_, idx) => ({ x: idx, y: -idx, z: 2 * idx }))
    points.push({ x: NaN, y: 1, z: 0 }, { x: 1, y: Infinity, z: 0 })
    Object.freeze(points)
    const sampled = sample_surface({ type: `triangulated`, points })
    expect(sampled).toHaveLength(count)
    expect(sampled).not.toBe(points)
    expect(sampled[0]).toBe(points[0])
    expect(sampled.at(-1)).toBe(points[count - 1])
    expect(points).toHaveLength(count + 2)
    // a legend-hidden series draws nothing, so it must not widen the axes either
    const hidden = { x: [1e9], y: [1e9], z: [1e9], visible: false }
    expect(get_3d_auto_ranges([basic_series, hidden], sampled)).toEqual({
      x: [0, 220_000],
      y: [-220_000, 20_000],
      z: [0, 450_000],
    })
    expect(
      get_3d_auto_ranges(
        [],
        [
          { x: -0, y: NaN, z: Infinity },
          { x: 0, y: 2, z: NaN },
        ],
      ),
    ).toEqual({
      x: [-1, 1],
      y: [1.8, 2.2],
      z: [0, 1],
    })
  })

  // Bounds used an 11x11 grid over [-1, 1] while the surface draws `resolution` points over
  // the plot's x/y: a narrow peak between samples poked out of the box
  test(`surface bounds sample the drawn vertex grid`, () => {
    const peak = (x_val: number, y_val: number) =>
      Math.exp(-((x_val - 0.37) ** 2 + (y_val - 0.37) ** 2) * 200)
    const surface: Surface3DConfig = { type: `grid`, resolution: 101, z_fn: peak }
    const samples = sample_surface(surface, { x: [0, 1], y: [0, 1] })
    expect(samples).toHaveLength(101 * 101)
    expect(Math.max(...samples.map(({ z }) => z))).toBeCloseTo(1, 12)
    // spanning the plot's x/y, it has nothing to add until those ranges are known
    expect(sample_surface(surface)).toEqual([])
  })

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
