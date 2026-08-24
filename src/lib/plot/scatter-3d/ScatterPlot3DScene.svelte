<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { format_num } from '$lib/labels'
  import type { Vec2, Vec3 } from '$lib/math'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    DisplayConfig3D,
    InternalPoint3D,
    RefLine3D,
    RefPlane,
    Scatter3DHandlerEvent,
    SizeScaleConfig,
    StyleOverrides3D,
    Surface3DConfig,
  } from '$lib/plot/core/types'
  import { SCALE_DEFAULTS } from '$lib/plot/core/types'
  import type { GizmoOptions } from '$lib/scene'
  import {
    bind_renderer,
    create_scene_camera,
    dispose_on_change,
    line_geometry,
    SceneCamera,
    SceneLights,
  } from '$lib/scene'
  import { T, useTask, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { scaleLinear } from 'd3-scale'
  import { type ComponentProps, onDestroy, type Snippet, untrack } from 'svelte'
  import type { Camera, Scene } from 'three/webgpu'
  import * as THREE from 'three/webgpu'
  import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js'
  import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
  import { plot_color } from '$lib/colors'
  import { first_point_style } from '$lib/plot/core/data-transform'
  import ReferenceLine3D from '$lib/plot/scatter-3d/ReferenceLine3D.svelte'
  import ReferencePlane from '$lib/plot/scatter-3d/ReferencePlane.svelte'
  import { normalize_to_scene } from '$lib/plot/scatter-3d/scene-coords'
  import {
    accumulate_extent,
    collect_size_values,
    create_size_scale,
    empty_extent,
    nice_range_from_extent,
    type RunningExtent,
  } from '$lib/plot/core/scales'
  import Surface3D from '$lib/plot/scatter-3d/Surface3D.svelte'

  let {
    series = [],
    x_axis = {},
    y_axis = {},
    z_axis = {},
    display = {},
    styles = {},
    surfaces = [],
    ref_lines = [],
    ref_planes = [],
    color_scale_fn = () => plot_color(0),
    size_scale = SCALE_DEFAULTS.size_3d,
    camera_position = [10, 10, 10] as Vec3,
    camera_projection = `perspective` as CameraProjection3D,
    auto_rotate = 0,
    rotation_damping = 0,
    fov = 50,
    min_zoom = 0.1,
    max_zoom = 100,
    rotate_speed = 2,
    zoom_speed = 2,
    pan_speed = 2,
    ambient_light = 0.6,
    directional_light = 0.8,
    sphere_segments = 16,
    gizmo = true,
    hovered_point = $bindable(null),
    on_point_click,
    on_point_hover,
    tooltip,
    tooltip_portal,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    width = 0,
    height = 0,
  }: {
    series?: DataSeries3D<Metadata>[]
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    styles?: StyleOverrides3D
    surfaces?: Surface3DConfig[]
    ref_lines?: RefLine3D[]
    ref_planes?: RefPlane[]
    // Color scale function for color_values (computed once by the ScatterPlot3D wrapper)
    color_scale_fn?: (value: number) => string
    size_scale?: SizeScaleConfig
    camera_position?: Vec3
    camera_projection?: CameraProjection3D
    auto_rotate?: number
    rotation_damping?: number
    fov?: number
    min_zoom?: number
    max_zoom?: number
    rotate_speed?: number
    zoom_speed?: number
    pan_speed?: number
    ambient_light?: number
    directional_light?: number
    sphere_segments?: number
    gizmo?: boolean | GizmoOptions
    hovered_point?: InternalPoint3D<Metadata> | null
    on_point_click?: (data: Scatter3DHandlerEvent<Metadata>) => void
    on_point_hover?: (data: Scatter3DHandlerEvent<Metadata> | null) => void
    tooltip?: Snippet<[Scatter3DHandlerEvent<Metadata>]>
    tooltip_portal?: HTMLElement
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    width?: number
    height?: number
  } = $props()

  // Mirrors scene/camera into bindable props and tags the canvas so export_canvas_as_png can re-render at export DPI
  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  extras.interactivity()

  type AxisKey = `x` | `y` | `z`

  // Scene dimensions: x/y are horizontal (2:2), z is vertical (1)
  // Note: In Three.js, Y is vertical. We map user's Z → Three.js Y (vertical)
  // and user's Y → Three.js Z (depth). So scene_z here refers to Three.js Y.
  const scene_x = 10 // user X → Three.js X (horizontal)
  const scene_y = 10 // user Y → Three.js Z (depth/horizontal)
  const scene_z = 5 // user Z → Three.js Y (vertical)
  const half_x = scene_x / 2
  const half_y = scene_y / 2
  const half_z = scene_z / 2
  let fit_zoom = $derived(Math.min(width, height) / Math.max(scene_x, scene_y) / 2 || 50)
  // Orbit controls - snappy with minimal inertia; the orbit target is the cube center
  const scene_camera = create_scene_camera({
    controls: () => ({
      camera_projection,
      rotate_speed,
      zoom_speed,
      zoom_to_cursor: false,
      pan_speed,
      auto_rotate,
      rotation_damping,
      min_zoom,
      max_zoom,
    }),
    target: () => [0, 0, 0],
    fit_zoom: () => fit_zoom,
    measured: () => width > 0 && height > 0,
    camera: () => camera,
  })

  // Dynamic backside positions - axes/grids/planes always face away from camera
  // pos.x/y/z are the Three.js positions where axes attach (backside of cube)
  let pos = $state({ x: -half_x, y: -half_z, z: -half_y })

  const { invalidate } = useThrelte()

  // Update backside positions when the camera crosses axis planes. autoInvalidate defaults to
  // true, which parks the task in the scheduler's `autoInvalidations` for its whole lifetime
  // and re-renders the on-demand scene every frame, idle or not. Opting out still runs the
  // task each frame — the main stage is ungated — so crossings are still caught.
  useTask(
    () => {
      if (!camera) return
      const cam = camera.position
      // Only update when sign changes to avoid triggering geometry recreation every frame
      const new_x = cam.x > 0 ? -half_x : half_x
      const new_y = cam.y > 0 ? -half_z : half_z
      const new_z = cam.z > 0 ? -half_y : half_y
      if (pos.x === new_x && pos.y === new_y && pos.z === new_z) return
      pos.x = new_x
      pos.y = new_y
      pos.z = new_z
      invalidate() // axes/grids move with `pos`, and nothing else requests that frame
    },
    { autoInvalidate: false },
  )

  // Sign helpers for tick/label offsets (point outward from cube center)
  const sign_x = $derived(pos.x < 0 ? -1 : 1)
  const sign_y = $derived(pos.y < 0 ? -1 : 1)

  // Sample surface points for range calculation (10x10 grid)
  function sample_surface(surface: Surface3DConfig): { x: number; y: number; z: number }[] {
    const grid_steps = 10
    const pts: { x: number; y: number; z: number }[] = []
    if (surface.type === `grid` && surface.z_fn) {
      const [x0, x1] = surface.x_range ?? [-1, 1]
      const [y0, y1] = surface.y_range ?? [-1, 1]
      for (let idx_x = 0; idx_x <= grid_steps; idx_x++) {
        for (let idx_y = 0; idx_y <= grid_steps; idx_y++) {
          const x = x0 + (idx_x / grid_steps) * (x1 - x0),
            y = y0 + (idx_y / grid_steps) * (y1 - y0)
          pts.push({ x, y, z: surface.z_fn(x, y) })
        }
      }
    } else if (surface.type === `parametric` && surface.parametric_fn) {
      const [u0, u1] = surface.u_range ?? [0, 1]
      const [v0, v1] = surface.v_range ?? [0, 1]
      for (let idx_u = 0; idx_u <= grid_steps; idx_u++) {
        for (let idx_v = 0; idx_v <= grid_steps; idx_v++) {
          pts.push(
            surface.parametric_fn(
              u0 + (idx_u / grid_steps) * (u1 - u0),
              v0 + (idx_v / grid_steps) * (v1 - v0),
            ),
          )
        }
      }
    } else if (surface.type === `triangulated` && surface.points) {
      pts.push(...surface.points)
    }
    return pts.filter((pt) => isFinite(pt.x) && isFinite(pt.y) && isFinite(pt.z))
  }

  // Axis range: explicit bounds win as given; otherwise the finite extent is padded (5% of the
  // span, or 10% of a lone value) and niced like every 2D axis
  const compute_range = (
    extent: RunningExtent,
    range: [number | null, number | null] = [null, null],
  ): Vec2 =>
    range[0] != null && range[1] != null
      ? [range[0], range[1]]
      : nice_range_from_extent(extent, range, `linear`, 0.05)

  // xyz extents straight off the series arrays (hidden series included, so a legend toggle
  // never re-scales the cube) plus the sampled surfaces; no per-point objects are built here
  let surface_samples = $derived(surfaces.flatMap(sample_surface))
  let data_extents = $derived.by(() => {
    const extents = { x: empty_extent(), y: empty_extent(), z: empty_extent() }
    for (const srs of series) {
      if (!srs) continue
      for (const axis of [`x`, `y`, `z`] as const) accumulate_extent(extents[axis], srs[axis])
    }
    for (const axis of [`x`, `y`, `z`] as const) {
      accumulate_extent(
        extents[axis],
        surface_samples.map((pt) => pt[axis]),
      )
    }
    return extents
  })
  let x_range = $derived(compute_range(data_extents.x, x_axis.range))
  let y_range = $derived(compute_range(data_extents.y, y_axis.range))
  let z_range = $derived(compute_range(data_extents.z, z_axis.range))

  const normalize_x = (value: number) => normalize_to_scene(value, x_range, scene_x)
  const normalize_y = (value: number) => normalize_to_scene(value, y_range, scene_y)
  const normalize_z = (value: number) => normalize_to_scene(value, z_range, scene_z)

  // Size scale (the color scale is computed by the wrapper and passed as a prop)
  let size_scale_fn = $derived(create_size_scale(size_scale, collect_size_values(series)))

  // Every point of every visible series in scene coordinates, built in one pass and in
  // (series_idx, point_idx) order. Swap Y/Z for Three.js: user Z → Three.js Y (vertical),
  // user Y → Three.js Z (depth).
  let processed_points = $derived.by(() => {
    const points: InternalPoint3D<Metadata>[] = []
    series.forEach((srs, series_idx) => {
      if (!srs || !(srs.visible ?? true)) return
      const { metadata, point_style } = srs
      for (let point_idx = 0; point_idx < srs.x.length; point_idx++) {
        points.push({
          x: normalize_x(srs.x[point_idx]),
          y: normalize_z(srs.z[point_idx]),
          z: normalize_y(srs.y[point_idx]),
          series_idx,
          point_idx,
          color_value: srs.color_values?.[point_idx] ?? null,
          size_value: srs.size_values?.[point_idx] ?? null,
          metadata: Array.isArray(metadata) ? metadata[point_idx] : metadata,
          point_style: Array.isArray(point_style) ? point_style[point_idx] : point_style,
        })
      }
    })
    return points
  })

  // Group points by radius, with per-instance colors
  type RadiusGroup = {
    radius: number
    points: InternalPoint3D<Metadata>[]
    colors: string[]
  }

  const point_key = (pt: InternalPoint3D<Metadata>) => `${pt.series_idx}-${pt.point_idx}`

  // point_radii lets the hover highlight look up a point's radius in O(1) instead of scanning
  // every group's points
  let { radius_groups, point_radii } = $derived.by(() => {
    const groups: Record<string, RadiusGroup> = {}
    const radii = new Map<string, number>()
    for (const pt of processed_points) {
      const color =
        pt.color_value != null
          ? color_scale_fn(pt.color_value)
          : (pt.point_style?.fill ?? plot_color(pt.series_idx))
      const radius =
        pt.size_value != null
          ? size_scale_fn(pt.size_value)
          : (pt.point_style?.radius ?? styles.point?.size ?? 2) * 0.05
      const key = radius.toFixed(4)
      ;(groups[key] ??= { radius, points: [], colors: [] }).points.push(pt)
      groups[key].colors.push(color)
      radii.set(point_key(pt), radius)
    }
    return { radius_groups: Object.values(groups), point_radii: radii }
  })

  // Projection settings - render point shadows on background planes
  let proj_opacity = $derived(display.projection_opacity ?? 0.3)
  let proj_scale = $derived(display.projection_scale ?? 0.5)

  // Projection plane configs: each fixes one axis to the backside position
  type ProjectionConfig = {
    key: `xy` | `xz` | `yz`
    get_pos: (pt: InternalPoint3D<Metadata>) => Vec3
  }
  let projection_configs = $derived(
    ([`xy`, `xz`, `yz`] as const)
      .filter((key) => display.projections?.[key])
      .map((key): ProjectionConfig => ({
        key,
        get_pos:
          key === `xy`
            ? (pt) => [pt.x, pos.y, pt.z]
            : key === `xz`
              ? (pt) => [pt.x, pt.y, pos.z]
              : (pt) => [pos.x, pt.y, pt.z],
      })),
  )

  // Series line data for connecting points
  type SeriesLineInput = {
    series_idx: number
    positions: number[]
    color: string
    width: number
    dashed: boolean
  }
  type SeriesLineData = SeriesLineInput & {
    line2: Line2
    geometry: LineGeometry
    material: THREE.Line2NodeMaterial
  }

  // Per-series fat-line inputs (ordered positions + resolved stroke style) as a derived so
  // the effect below can diff against previous lines and only rebuild what changed
  let line_inputs = $derived.by((): SeriesLineInput[] => {
    const eligible: SeriesLineInput[] = []
    const positions_by_series = new Map<number, number[]>()
    for (let series_idx = 0; series_idx < series.length; series_idx++) {
      const srs = series[series_idx]
      const line_style = srs?.line_style
      if (!line_style || !(srs.visible ?? true)) continue
      const positions: number[] = []
      positions_by_series.set(series_idx, positions)
      const color = line_style.stroke ?? first_point_style(srs)?.fill ?? plot_color(series_idx)
      eligible.push({
        series_idx,
        positions,
        color,
        width: line_style.stroke_width ?? 2,
        dashed: Boolean(line_style.line_dash),
      })
    }
    // processed_points are in (series_idx, point_idx) order, so one pass fills every polyline
    for (const pt of processed_points) {
      positions_by_series.get(pt.series_idx)?.push(pt.x, pt.y, pt.z)
    }
    return eligible.filter((input) => input.positions.length >= 6) // >= 2 points
  })

  const same_line_input = (prev: SeriesLineData, next: SeriesLineInput): boolean =>
    prev.color === next.color &&
    prev.width === next.width &&
    prev.dashed === next.dashed &&
    prev.positions.length === next.positions.length &&
    prev.positions.every((coord, idx) => coord === next.positions[idx])

  // Track previous lines for reuse/cleanup
  let series_lines: SeriesLineData[] = $state([])

  $effect(() => {
    const inputs = line_inputs
    untrack(() => {
      const prev_by_idx = new Map(series_lines.map((line) => [line.series_idx, line]))
      const next_lines = inputs.map((input): SeriesLineData => {
        const prev = prev_by_idx.get(input.series_idx)
        if (prev && same_line_input(prev, input)) {
          prev_by_idx.delete(input.series_idx) // reused - don't dispose below
          return prev
        }
        // Create fat line geometry (LineGeometry for Line2)
        const geometry = new LineGeometry()
        geometry.setPositions(input.positions)
        // Node material for fat lines; it reads screen size from the viewport internally,
        // so linewidth is in pixels without any resolution uniform to maintain.
        const material = new THREE.Line2NodeMaterial({
          color: new THREE.Color(input.color).getHex(),
          linewidth: input.width, // Width in pixels
          dashed: input.dashed,
          scale: input.dashed ? 2 : 1, // node materials name the dash scale `scale`
          dashSize: 0.1,
          gapSize: 0.05,
        })
        const line2 = new Line2(geometry, material)
        line2.computeLineDistances()
        return { ...input, line2, geometry, material }
      })
      // Dispose lines that were replaced or removed
      for (const stale of prev_by_idx.values()) {
        stale.geometry.dispose()
        stale.material.dispose()
      }
      // Skip reassignment when every line was reused to avoid invalidating consumers
      const unchanged =
        next_lines.length === series_lines.length &&
        next_lines.every((line, idx) => line === series_lines[idx])
      if (!unchanged) series_lines = next_lines
    })
  })

  // Lines reused across effect runs are only released here (axis geometries are derived and
  // disposed by dispose_on_change below)
  onDestroy(() => {
    for (const { geometry, material } of series_lines) {
      geometry.dispose()
      material.dispose()
    }
  })

  // Generate axis ticks using D3's smart tick generation
  function gen_ticks(range: Vec2, ticks?: AxisConfig3D[`ticks`]): number[] {
    if (Array.isArray(ticks)) return ticks
    const [min, max] = range
    if (!isFinite(min) || !isFinite(max) || min === max) return [min]
    const count = typeof ticks === `number` ? ticks : 5
    return scaleLinear().domain([min, max]).ticks(count)
  }

  let x_ticks = $derived(gen_ticks(x_range, x_axis.ticks))
  let y_ticks = $derived(gen_ticks(y_range, y_axis.ticks))
  let z_ticks = $derived(gen_ticks(z_range, z_axis.ticks))

  // Build event data for point interactions. The point carries scene coordinates, so the
  // original data values are read straight from the series (null if the series shrank under a
  // stale hovered point).
  function make_event_data(
    point: InternalPoint3D<Metadata>,
    event?: MouseEvent,
  ): Scatter3DHandlerEvent<Metadata> | null {
    const { series_idx, point_idx } = point
    const srs = series[series_idx]
    if (!srs || point_idx >= srs.x.length) return null
    const [x, y, z] = [srs.x[point_idx], srs.y[point_idx], srs.z[point_idx]]
    return {
      x,
      y,
      z,
      metadata: point.metadata ?? null,
      label: srs.label ?? null,
      series_idx,
      x_axis,
      y_axis,
      z_axis,
      x_formatted: format_num(x, x_axis.format || `.3~g`),
      y_formatted: format_num(y, y_axis.format || `.3~g`),
      z_formatted: format_num(z, z_axis.format || `.3~g`),
      color_value: point.color_value,
      fullscreen: false,
      event,
      point,
    }
  }

  function handle_point_enter(point: InternalPoint3D<Metadata>) {
    hovered_point = point
    const data = make_event_data(point)
    if (data) on_point_hover?.(data)
  }

  function handle_point_click(point: InternalPoint3D<Metadata>, event: MouseEvent) {
    const data = make_event_data(point, event)
    if (data) on_point_click?.(data)
  }

  // Axis configuration for rendering
  const tick_length = 0.15

  // Axis rendering config - all positions use backside `pos` values. Each entry also owns its
  // line geometries (main axis, ticks, grid), rebuilt as a whole when pos/ticks/ranges change.
  // Main axis lines: X spans full X at backside Y/Z; user Y (Three.js Z) spans full Z at
  // backside X/Y; user Z (Three.js Y) spans full Y at backside X/Z.
  let axes_config = $derived(
    [
      {
        key: `x` as AxisKey,
        color: `#ef4444`,
        axis: x_axis,
        ticks: x_ticks,
        line_geom: line_geometry([-half_x, pos.y, pos.z], [half_x, pos.y, pos.z]),
        get_tick_pos: (val: number): Vec3 => [normalize_x(val), pos.y, pos.z],
        get_tick_end: (val: number): Vec3 => [
          normalize_x(val),
          pos.y + sign_y * tick_length,
          pos.z,
        ],
        get_grid_lines: (val: number): [Vec3, Vec3][] => {
          const px = normalize_x(val)
          return [
            [
              [px, -half_z, pos.z],
              [px, half_z, pos.z],
            ],
            [
              [px, pos.y, -half_y],
              [px, pos.y, half_y],
            ],
          ]
        },
        tick_label_pos: (val: number): Vec3 => [normalize_x(val), pos.y + sign_y * 0.4, pos.z],
        axis_label_pos: [0, pos.y + sign_y * 0.9, pos.z] as Vec3,
      },
      {
        key: `y` as AxisKey,
        color: `#22c55e`,
        axis: y_axis,
        ticks: y_ticks,
        line_geom: line_geometry([pos.x, pos.y, -half_y], [pos.x, pos.y, half_y]),
        get_tick_pos: (val: number): Vec3 => [pos.x, pos.y, normalize_y(val)],
        get_tick_end: (val: number): Vec3 => [
          pos.x,
          pos.y + sign_y * tick_length,
          normalize_y(val),
        ],
        get_grid_lines: (val: number): [Vec3, Vec3][] => {
          const py = normalize_y(val)
          return [
            [
              [-half_x, pos.y, py],
              [half_x, pos.y, py],
            ],
            [
              [pos.x, -half_z, py],
              [pos.x, half_z, py],
            ],
          ]
        },
        tick_label_pos: (val: number): Vec3 => [
          pos.x + sign_x * 0.5,
          pos.y + sign_y * 0.4,
          normalize_y(val),
        ],
        axis_label_pos: [
          pos.x,
          pos.y + sign_y * 0.9,
          pos.z < 0 ? half_y + 0.5 : -half_y - 0.5,
        ] as Vec3,
      },
      {
        key: `z` as AxisKey,
        color: `#3b82f6`,
        axis: z_axis,
        ticks: z_ticks,
        line_geom: line_geometry([pos.x, -half_z, pos.z], [pos.x, half_z, pos.z]),
        get_tick_pos: (val: number): Vec3 => [pos.x, normalize_z(val), pos.z],
        get_tick_end: (val: number): Vec3 => [
          pos.x + sign_x * tick_length,
          normalize_z(val),
          pos.z,
        ],
        get_grid_lines: (val: number): [Vec3, Vec3][] => {
          const pz = normalize_z(val)
          return [
            [
              [-half_x, pz, pos.z],
              [half_x, pz, pos.z],
            ],
            [
              [pos.x, pz, -half_y],
              [pos.x, pz, half_y],
            ],
          ]
        },
        tick_label_pos: (val: number): Vec3 => [pos.x + sign_x * 0.5, normalize_z(val), pos.z],
        axis_label_pos: [pos.x + sign_x, 0, pos.z] as Vec3,
      },
    ].map((entry) => ({
      ...entry,
      tick_geoms: entry.ticks.map((val) =>
        line_geometry(entry.get_tick_pos(val), entry.get_tick_end(val)),
      ),
      grid_geoms: entry.ticks.map((val) =>
        entry.get_grid_lines(val).map(([start, end]) => line_geometry(start, end)),
      ),
    })),
  )

  // Release the previous axis/tick/grid geometries whenever axes_config rebuilds and on unmount
  dispose_on_change(() =>
    axes_config.flatMap(({ line_geom, tick_geoms, grid_geoms }) => [
      line_geom,
      ...tick_geoms,
      ...grid_geoms.flat(),
    ]),
  )
</script>

<SceneCamera
  {camera_projection}
  position={camera_position}
  {fov}
  zoom={scene_camera.zoom}
  near={0.1}
  ortho_near={-100}
  far={1000}
  orbit_props={scene_camera.orbit_props}
  {gizmo}
  bind:orbit_controls
/>

<SceneLights
  ambient={ambient_light}
  directional={directional_light}
  fill={0.3}
  key_position={[10, 20, 10]}
  fill_position={[-10, -10, -10]}
/>

<!-- Background planes with subtle shading - always on backside relative to camera -->
{#if display.show_grid !== false}
  {@const plane_mat = {
    color: `#888`,
    opacity: 0.04,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  }}
  <T.Mesh position={[0, pos.y, 0]} rotation.x={-Math.PI / 2} renderOrder={-1}>
    <T.PlaneGeometry args={[scene_x, scene_y]} />
    <T.MeshBasicMaterial {...plane_mat} />
  </T.Mesh>
  <T.Mesh position={[0, 0, pos.z]} renderOrder={-1}>
    <T.PlaneGeometry args={[scene_x, scene_z]} />
    <T.MeshBasicMaterial {...plane_mat} />
  </T.Mesh>
  <T.Mesh position={[pos.x, 0, 0]} rotation.y={Math.PI / 2} renderOrder={-1}>
    <T.PlaneGeometry args={[scene_y, scene_z]} />
    <T.MeshBasicMaterial {...plane_mat} />
  </T.Mesh>
{/if}

<!-- Axes with ticks and grid -->
{#if display.show_axes !== false}
  {#each axes_config as { key, color, axis, ticks, tick_label_pos, axis_label_pos, line_geom, tick_geoms, grid_geoms } (key)}
    <!-- Main axis line -->
    <T.Line>
      <T is={line_geom} />
      <T.LineBasicMaterial {color} linewidth={2} />
    </T.Line>
    <!-- Ticks and grid -->
    {#each ticks as tick_val, tick_idx (tick_val)}
      <T.Line>
        <T is={tick_geoms[tick_idx]} />
        <T.LineBasicMaterial {color} />
      </T.Line>
      {#if display.show_grid !== false}
        {#each grid_geoms[tick_idx] as grid_geom, grid_idx (grid_idx)}
          <T.Line>
            <T is={grid_geom} />
            <T.LineBasicMaterial color="#888" opacity={0.4} transparent />
          </T.Line>
        {/each}
      {/if}
      <extras.HTML position={tick_label_pos(tick_val)} center>
        <span class="tick-label">{format_num(tick_val, axis.format || `.2~g`)}</span>
      </extras.HTML>
    {/each}
    <!-- Axis label -->
    {#if display.show_axis_labels !== false}
      <extras.HTML position={axis_label_pos} center>
        <span class="axis-label" style:color>{axis.label || key.toUpperCase()}</span>
      </extras.HTML>
    {/if}
  {/each}
{/if}

<!-- Surfaces -->
{#each surfaces.filter((srf) => srf.visible !== false) as surface (surface.id ?? surfaces.indexOf(surface))}
  <Surface3D config={surface} {x_range} {y_range} {z_range} {scene_x} {scene_y} {scene_z} />
{/each}

<!-- Reference Planes -->
{#each (ref_planes ?? []).filter((plane) => plane.visible !== false) as ref_plane, plane_idx (ref_plane.id ?? plane_idx)}
  <ReferencePlane
    {ref_plane}
    scene_size={[scene_x, scene_y, scene_z]}
    ranges={{ x: x_range, y: y_range, z: z_range }}
  />
{/each}

<!-- Reference Lines -->
{#each (ref_lines ?? []).filter((line) => line.visible !== false) as ref_line, line_idx (ref_line.id ?? line_idx)}
  <ReferenceLine3D
    {ref_line}
    scene_size={[scene_x, scene_y, scene_z]}
    ranges={{ x: x_range, y: y_range, z: z_range }}
  />
{/each}

<!-- Series lines connecting points (fat lines using Line2) -->
{#each series_lines as line_data (line_data.series_idx)}
  <T is={line_data.line2} />
{/each}

<!-- Instanced scatter points with per-instance colors and event handling -->
{#each radius_groups as group (group.radius)}
  <extras.InstancedMesh
    limit={group.points.length}
    range={group.points.length}
    frustumCulled={false}
  >
    <T.SphereGeometry args={[1, sphere_segments, sphere_segments]} />
    <T.MeshStandardMaterial vertexColors={false} />
    {#each group.points as point, idx (`${point.series_idx}-${point.point_idx}`)}
      <extras.Instance
        position={[point.x, point.y, point.z]}
        scale={group.radius}
        color={group.colors[idx]}
        onpointerenter={() => handle_point_enter(point)}
        onpointerleave={() => {
          hovered_point = null
          on_point_hover?.(null)
        }}
        onclick={(evt: MouseEvent) => handle_point_click(point, evt)}
      />
    {/each}
  </extras.InstancedMesh>
{/each}

<!-- Plane Projections - render point shadows on enabled background planes -->
{#each projection_configs as { key, get_pos } (key)}
  {#each radius_groups as group (group.radius)}
    <extras.InstancedMesh
      limit={group.points.length}
      range={group.points.length}
      frustumCulled={false}
    >
      <T.SphereGeometry args={[1, 8, 8]} />
      <T.MeshBasicMaterial transparent opacity={proj_opacity} depthWrite={false} />
      {#each group.points as point, idx (`${key}-${point.series_idx}-${point.point_idx}`)}
        <extras.Instance
          position={get_pos(point)}
          scale={group.radius * proj_scale}
          color={group.colors[idx]}
        />
      {/each}
    </extras.InstancedMesh>
  {/each}
{/each}

<!-- Hover highlight -->
{#if hovered_point}
  {@const hp = hovered_point}
  <T.Mesh position={[hp.x, hp.y, hp.z]} scale={(point_radii.get(point_key(hp)) ?? 0.1) * 1.5}>
    <T.SphereGeometry args={[1, 16, 16]} />
    <T.MeshStandardMaterial
      color="white"
      transparent
      opacity={0.4}
      emissive="white"
      emissiveIntensity={0.3}
      depthTest={false}
      depthWrite={false}
    />
  </T.Mesh>
{/if}

<!-- Tooltip -->
{#if hovered_point}
  {@const hp = hovered_point}
  {@const data = make_event_data(hp)}
  {#if data}
    <extras.HTML position={[hp.x, hp.y + 0.3, hp.z]} center portal={tooltip_portal}>
      {#if tooltip}
        {@render tooltip(data)}
      {:else}
        <div class="tooltip">
          <div>x: {data.x_formatted}</div>
          <div>y: {data.y_formatted}</div>
          <div>z: {data.z_formatted}</div>
          {#if data.color_value != null}
            <div>value: {format_num(data.color_value, `.3~g`)}</div>
          {/if}
        </div>
      {/if}
    </extras.HTML>
  {/if}
{/if}

<style>
  :is(.axis-label, .tick-label) {
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
  .axis-label {
    font-size: 13px;
    font-weight: 600;
  }
  .tick-label {
    font-size: 10px;
    color: var(--text-color, #333);
  }
  .tooltip {
    background: var(--scatter3d-tooltip-bg, rgba(0, 0, 0, 0.85));
    color: var(--scatter3d-tooltip-color, white);
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
  .tooltip div {
    line-height: 1.4;
  }
</style>
