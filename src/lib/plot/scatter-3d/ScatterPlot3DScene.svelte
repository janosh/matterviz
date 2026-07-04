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
  import { bind_renderer } from '$lib/scene'
  import { T, useTask } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { scaleLinear } from 'd3-scale'
  import { type ComponentProps, onDestroy, type Snippet, untrack } from 'svelte'
  import type { Camera, Scene } from 'three'
  import * as THREE from 'three'
  import { Line2 } from 'three/examples/jsm/lines/Line2.js'
  import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
  import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
  import { get_series_color } from '$lib/plot/core/data-transform'
  import { normalize_to_scene } from '$lib/plot/core/reference-line'
  import ReferenceLine3D from '$lib/plot/core/components/ReferenceLine3D.svelte'
  import ReferencePlane from '$lib/plot/core/components/ReferencePlane.svelte'
  import { create_size_scale } from '$lib/plot/core/scales'
  import Surface3D from '$lib/plot/scatter-3d/Surface3D.svelte'

  let {
    series = [],
    series_visibility = [],
    x_axis = {},
    y_axis = {},
    z_axis = {},
    display = {},
    styles = {},
    surfaces = [],
    ref_lines = [],
    ref_planes = [],
    color_scale_fn = () => get_series_color(0),
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
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
    width = 0,
    height = 0,
  }: {
    series?: DataSeries3D<Metadata>[]
    series_visibility?: boolean[]
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
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
    hovered_point?: InternalPoint3D<Metadata> | null
    on_point_click?: (data: Scatter3DHandlerEvent<Metadata>) => void
    on_point_hover?: (data: Scatter3DHandlerEvent<Metadata> | null) => void
    tooltip?: Snippet<[Scatter3DHandlerEvent<Metadata>]>
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

  // Scene dimensions: x/y are horizontal (2:2), z is vertical (1)
  // Note: In Three.js, Y is vertical. We map user's Z → Three.js Y (vertical)
  // and user's Y → Three.js Z (depth). So scene_z here refers to Three.js Y.
  const scene_x = 10 // user X → Three.js X (horizontal)
  const scene_y = 10 // user Y → Three.js Z (depth/horizontal)
  const scene_z = 5 // user Z → Three.js Y (vertical)
  const half_x = scene_x / 2
  const half_y = scene_y / 2
  const half_z = scene_z / 2

  // Dynamic backside positions - axes/grids/planes always face away from camera
  // pos.x/y/z are the Three.js positions where axes attach (backside of cube)
  let pos = $state({ x: -half_x, y: -half_z, z: -half_y })

  // Update backside positions when camera crosses axis planes
  useTask(() => {
    if (!camera) return
    const cam = camera.position
    // Only update when sign changes to avoid triggering geometry recreation every frame
    const new_x = cam.x > 0 ? -half_x : half_x
    const new_y = cam.y > 0 ? -half_z : half_z
    const new_z = cam.z > 0 ? -half_y : half_y
    if (pos.x !== new_x) pos.x = new_x
    if (pos.y !== new_y) pos.y = new_y
    if (pos.z !== new_z) pos.z = new_z
  })

  // Sign helpers for tick/label offsets (point outward from cube center)
  const sign_x = $derived(pos.x < 0 ? -1 : 1)
  const sign_y = $derived(pos.y < 0 ? -1 : 1)

  // Flatten all points from series
  let all_points = $derived(
    series.filter(Boolean).flatMap((srs, series_idx) =>
      srs.x.map((x_val, point_idx) => ({
        x: x_val,
        y: srs.y[point_idx],
        z: srs.z[point_idx],
        series_idx,
        point_idx,
        color_value: srs.color_values?.[point_idx] ?? null,
        size_value: srs.size_values?.[point_idx] ?? null,
        metadata: Array.isArray(srs.metadata) ? srs.metadata[point_idx] : srs.metadata,
        point_style: Array.isArray(srs.point_style)
          ? srs.point_style[point_idx]
          : srs.point_style,
      })),
    ),
  )

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

  // Compute axis range with D3's nice(); data_min/data_max are the finite extent (Infinity/-Infinity when empty)
  function compute_range(
    [data_min, data_max]: Vec2,
    range?: [number | null, number | null],
  ): Vec2 {
    if (range?.[0] != null && range?.[1] != null) return range as Vec2
    if (data_min > data_max) return [0, 1] // no finite values
    let [min, max] = [data_min, data_max]
    const pad = min === max ? (min === 0 ? 1 : Math.abs(min * 0.1)) : (max - min) * 0.05
    if (range?.[0] == null) min -= pad
    if (range?.[1] == null) max += pad
    return scaleLinear()
      .domain([range?.[0] ?? min, range?.[1] ?? max])
      .nice()
      .domain() as Vec2
  }

  // Collect xyz extents from points and surfaces in one pass (no intermediate arrays)
  let surface_samples = $derived(surfaces.flatMap(sample_surface))
  let data_extents = $derived.by(() => {
    const extents = {
      x: [Infinity, -Infinity] as Vec2,
      y: [Infinity, -Infinity] as Vec2,
      z: [Infinity, -Infinity] as Vec2,
    }
    for (const points of [all_points, surface_samples]) {
      for (const pt of points) {
        for (const axis of [`x`, `y`, `z`] as const) {
          const val = pt[axis]
          if (!isFinite(val)) continue
          const extent = extents[axis]
          if (val < extent[0]) extent[0] = val
          if (val > extent[1]) extent[1] = val
        }
      }
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
  let all_size_values = $derived(
    all_points.map((pt) => pt.size_value).filter((val): val is number => val != null),
  )
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))

  // Process points with normalized positions
  // Swap Y/Z for Three.js: user Z → Three.js Y (vertical), user Y → Three.js Z (depth)
  let processed_points = $derived(
    all_points.map(
      (pt): InternalPoint3D<Metadata> => ({
        ...pt,
        x: normalize_x(pt.x), // user X → Three.js X
        y: normalize_z(pt.z), // user Z → Three.js Y (vertical)
        z: normalize_y(pt.y), // user Y → Three.js Z (depth)
      }),
    ),
  )

  // Group points by radius, with per-instance colors
  type RadiusGroup = {
    radius: number
    points: InternalPoint3D<Metadata>[]
    colors: string[]
  }

  let radius_groups = $derived.by((): RadiusGroup[] => {
    const groups: Record<string, RadiusGroup> = {}
    for (const pt of processed_points) {
      const srs = series[pt.series_idx]
      if (!(series_visibility[pt.series_idx] ?? srs?.visible ?? true)) continue
      const color =
        pt.color_value != null
          ? color_scale_fn(pt.color_value)
          : (pt.point_style?.fill ?? get_series_color(pt.series_idx))
      const radius =
        pt.size_value != null
          ? size_scale_fn(pt.size_value)
          : (pt.point_style?.radius ?? styles.point?.size ?? 2) * 0.05
      const key = radius.toFixed(4)
      ;(groups[key] ??= { radius, points: [], colors: [] }).points.push(pt)
      groups[key].colors.push(color)
    }
    return Object.values(groups)
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
      .map(
        (key): ProjectionConfig => ({
          key,
          get_pos:
            key === `xy`
              ? (pt) => [pt.x, pos.y, pt.z]
              : key === `xz`
                ? (pt) => [pt.x, pt.y, pos.z]
                : (pt) => [pos.x, pt.y, pt.z],
        }),
      ),
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
    material: LineMaterial
  }

  // Per-series fat-line inputs (ordered positions + resolved stroke style) as a derived so
  // the effect below can diff against previous lines and only rebuild what changed
  let line_inputs = $derived.by((): SeriesLineInput[] => {
    const eligible: SeriesLineInput[] = []
    const positions_by_series = new Map<number, number[]>()
    for (let series_idx = 0; series_idx < series.length; series_idx++) {
      const srs = series[series_idx]
      const line_style = srs?.line_style
      if (!line_style) continue
      if (!(series_visibility[series_idx] ?? srs.visible ?? true)) continue
      const positions: number[] = []
      positions_by_series.set(series_idx, positions)
      const color =
        line_style.stroke ??
        (Array.isArray(srs.point_style) ? srs.point_style[0]?.fill : srs.point_style?.fill) ??
        get_series_color(series_idx)
      eligible.push({
        series_idx,
        positions,
        color,
        width: line_style.stroke_width ?? 2,
        dashed: Boolean(line_style.line_dash),
      })
    }
    // processed_points are emitted in (series_idx, point_idx) order, so one ordered pass replaces the old per-series filter + sort
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
        // Create LineMaterial for fat lines (linewidth is in pixels when resolution
        // is set). Use placeholder resolution; the separate resolution effect updates it
        const material = new LineMaterial({
          color: new THREE.Color(input.color).getHex(),
          linewidth: input.width, // Width in pixels
          dashed: input.dashed,
          dashScale: input.dashed ? 2 : 1,
          dashSize: 0.1,
          gapSize: 0.05,
          resolution: new THREE.Vector2(1, 1),
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

  // Update LineMaterial resolution when canvas size changes
  $effect(() => {
    const canvas_width = width || 1
    const canvas_height = height || 1
    for (const line_data of series_lines) {
      line_data.material.resolution.set(canvas_width, canvas_height)
    }
  })

  // Cleanup on component destroy
  onDestroy(() => {
    for (const { geometry, material } of series_lines) {
      geometry.dispose()
      material.dispose()
    }
    Object.values(axis_geometries).forEach((geom) => geom.dispose())
    for (const data of Object.values(axis_geom_data)) {
      data.tick_geoms.forEach((geom) => geom.dispose())
      data.grid_geoms.flat().forEach((geom) => geom.dispose())
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

  // Create axis line geometry - reuses a shared Float32Array for efficiency
  function create_line_geometry(start: Vec3, end: Vec3): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array([...start, ...end])
    geometry.setAttribute(`position`, new THREE.BufferAttribute(positions, 3))
    return geometry
  }

  // Build event data for point interactions
  function make_event_data(
    point: InternalPoint3D<Metadata>,
    event?: MouseEvent,
  ): Scatter3DHandlerEvent<Metadata> | null {
    const orig = all_points.find(
      (pt) => pt.series_idx === point.series_idx && pt.point_idx === point.point_idx,
    )
    if (!orig) return null
    return {
      x: orig.x,
      y: orig.y,
      z: orig.z,
      metadata: point.metadata ?? null,
      label: series[point.series_idx]?.label ?? null,
      series_idx: point.series_idx,
      x_axis,
      y_axis,
      z_axis,
      x_formatted: format_num(orig.x, x_axis.format || `.3~g`),
      y_formatted: format_num(orig.y, y_axis.format || `.3~g`),
      z_formatted: format_num(orig.z, z_axis.format || `.3~g`),
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

  // Gizmo props - parent (ScatterPlot3D) handles className and ColorBar offset adjustments
  let gizmo_props = $derived(
    gizmo === false
      ? null
      : gizmo === true
        ? { background: { enabled: false }, offset: { left: 5, bottom: 5 } }
        : gizmo,
  )

  // Orbit controls - snappy with minimal inertia
  let orbit_controls_props = $derived({
    enableRotate: rotate_speed > 0,
    rotateSpeed: rotate_speed,
    enableZoom: zoom_speed > 0,
    zoomSpeed: zoom_speed,
    enablePan: pan_speed > 0,
    panSpeed: pan_speed,
    target: [0, 0, 0] as Vec3,
    maxZoom: max_zoom,
    minZoom: min_zoom,
    autoRotate: Boolean(auto_rotate),
    autoRotateSpeed: auto_rotate,
    enableDamping: rotation_damping > 0,
    dampingFactor: rotation_damping,
  })

  // Axis configuration for rendering
  const tick_length = 0.15
  type AxisKey = `x` | `y` | `z`
  const AXIS_KEYS: readonly AxisKey[] = [`x`, `y`, `z`]

  // Main axis line geometries - updated when backside positions change
  let axis_geometries: Record<AxisKey, THREE.BufferGeometry> = $state({
    x: create_line_geometry([-half_x, -half_z, -half_y], [half_x, -half_z, -half_y]),
    y: create_line_geometry([-half_x, -half_z, -half_y], [-half_x, -half_z, half_y]),
    z: create_line_geometry([-half_x, -half_z, -half_y], [-half_x, half_z, -half_y]),
  })

  $effect(() => {
    // Capture pos values for dependency tracking
    const { x: px, y: py, z: pz } = pos
    untrack(() => {
      for (const key of AXIS_KEYS) axis_geometries[key].dispose()
    })
    // X-axis: spans full X, positioned at backside Y and Z
    axis_geometries.x = create_line_geometry([-half_x, py, pz], [half_x, py, pz])
    // Y-axis (user Y → Three.js Z): spans full Z, positioned at backside X and Y
    axis_geometries.y = create_line_geometry([px, py, -half_y], [px, py, half_y])
    // Z-axis (user Z → Three.js Y): spans full Y, positioned at backside X and Z
    axis_geometries.z = create_line_geometry([px, -half_z, pz], [px, half_z, pz])
  })

  // Axis rendering config - all positions use backside `pos` values
  let axes_config = $derived([
    {
      key: `x` as AxisKey,
      color: `#ef4444`,
      axis: x_axis,
      ticks: x_ticks,
      range: x_range,
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
      range: y_range,
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
      range: z_range,
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
  ])

  // Pre-computed geometries for tick marks and grid lines, indexed by axis and tick position
  type AxisGeomData = {
    tick_geoms: THREE.BufferGeometry[]
    grid_geoms: THREE.BufferGeometry[][]
  }
  const empty_geom_data = (): AxisGeomData => ({ tick_geoms: [], grid_geoms: [] })
  let axis_geom_data: Record<AxisKey, AxisGeomData> = $state({
    x: empty_geom_data(),
    y: empty_geom_data(),
    z: empty_geom_data(),
  })

  // Recreate tick/grid geometries when axes config changes
  $effect(() => {
    const config = axes_config
    // Dispose old geometries (untracked to avoid dependency cycle)
    untrack(() => {
      for (const key of AXIS_KEYS) {
        axis_geom_data[key].tick_geoms.forEach((geom) => geom.dispose())
        axis_geom_data[key].grid_geoms.flat().forEach((geom) => geom.dispose())
      }
    })
    for (const { key, ticks, get_tick_pos, get_tick_end, get_grid_lines } of config) {
      axis_geom_data[key] = {
        tick_geoms: ticks.map((val) =>
          create_line_geometry(get_tick_pos(val), get_tick_end(val)),
        ),
        grid_geoms: ticks.map((val) =>
          get_grid_lines(val).map(([start, end]) => create_line_geometry(start, end)),
        ),
      }
    }
  })
</script>

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault position={camera_position} {fov} near={0.1} far={1000}>
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_controls_props}>
      {#if gizmo_props}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera
    makeDefault
    position={camera_position}
    zoom={Math.min(width, height) / Math.max(scene_x, scene_y) / 2 || 50}
    near={-100}
    far={1000}
  >
    <extras.OrbitControls bind:ref={orbit_controls} {...orbit_controls_props}>
      {#if gizmo_props}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.OrthographicCamera>
{/if}

<!-- Lighting -->
<T.DirectionalLight position={[10, 20, 10]} intensity={directional_light} />
<T.DirectionalLight position={[-10, -10, -10]} intensity={directional_light * 0.3} />
<T.AmbientLight intensity={ambient_light} />

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
  {#each axes_config as { key, color, axis, ticks, tick_label_pos, axis_label_pos } (key)}
    <!-- Main axis line -->
    <T.Line>
      <T is={axis_geometries[key]} />
      <T.LineBasicMaterial {color} linewidth={2} />
    </T.Line>
    <!-- Ticks and grid -->
    {#each ticks as tick_val, tick_idx (tick_val)}
      {#if axis_geom_data[key].tick_geoms[tick_idx]}
        <T.Line>
          <T is={axis_geom_data[key].tick_geoms[tick_idx]} />
          <T.LineBasicMaterial {color} />
        </T.Line>
      {/if}
      {#if display.show_grid !== false}
        {#each axis_geom_data[key].grid_geoms[tick_idx] ?? [] as grid_geom, grid_idx (grid_idx)}
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
    <extras.HTML position={axis_label_pos} center>
      <span class="axis-label" style:color>{axis.label || key.toUpperCase()}</span>
    </extras.HTML>
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
  {@const group = radius_groups.find((grp) =>
    grp.points.some((pt) => pt.series_idx === hp.series_idx && pt.point_idx === hp.point_idx),
  )}
  <T.Mesh position={[hp.x, hp.y, hp.z]} scale={(group?.radius ?? 0.1) * 1.5}>
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
    <extras.HTML position={[hp.x, hp.y + 0.3, hp.z]} center>
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
