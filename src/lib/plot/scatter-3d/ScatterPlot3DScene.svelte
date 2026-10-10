<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { TooltipValue } from '#lib/tooltip/index.js'
  import { format_num } from '#lib/labels.js'
  import { sanitize_html } from '#lib/sanitize.js'
  import { in_range, type Vec2, type Vec3 } from '#lib/math.js'
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
  } from '#lib/plot/core/types.js'
  import { SCALE_DEFAULTS } from '#lib/plot/core/types.js'
  import type { SceneControlProps } from '#lib/scene/index.js'
  import {
    bind_renderer,
    create_scene_camera,
    dispose_on_change,
    front_hit,
    line_geometry,
    SceneCamera,
    SceneLights,
  } from '#lib/scene/index.js'
  import { T, useTask, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { scaleLinear } from 'd3-scale'
  import { type ComponentProps, onDestroy, type Snippet, untrack } from 'svelte'
  import * as THREE from 'three/webgpu'
  import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js'
  import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
  import { plot_color } from '#lib/colors/index.js'
  import { first_point_style } from '#lib/plot/core/data-transform.js'
  import ReferenceLine3D from '#lib/plot/scatter-3d/ReferenceLine3D.svelte'
  import ReferencePlane from '#lib/plot/scatter-3d/ReferencePlane.svelte'
  import {
    box_clipping_planes,
    hover_marker_geometry,
    normalize_to_scene,
    SCENE_SIZE,
  } from '#lib/plot/scatter-3d/scene-coords.js'
  import PointInstances, {
    type InstanceEvent,
    type InstanceProjection,
  } from '#lib/plot/scatter-3d/PointInstances.svelte'
  import type { InstanceTween } from '#lib/plot/scatter-3d/instance-tween.svelte.js'
  import {
    create_instance_tween,
    INSTANCE_STRIDE,
    pack_instances,
  } from '#lib/plot/scatter-3d/instance-tween.svelte.js'
  import { SETTLE_MS } from '#lib/plot/core/settling-tween.svelte.js'
  import { collect_size_range, create_size_scale } from '#lib/plot/core/scales.js'
  import Surface3D from '#lib/plot/scatter-3d/Surface3D.svelte'

  let {
    series = [],
    ranges,
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
    point_tween = {},
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
    fullscreen = false,
  }: Omit<SceneControlProps, `zoom_to_cursor` | `initial_zoom`> & {
    series?: DataSeries3D<Metadata>[]
    // Final data-coordinate ranges, computed by the host alongside its controls.
    ranges: Record<`x` | `y` | `z`, Vec2>
    x_axis?: Omit<AxisConfig3D, `range`>
    y_axis?: Omit<AxisConfig3D, `range`>
    z_axis?: Omit<AxisConfig3D, `range`>
    display?: DisplayConfig3D
    styles?: StyleOverrides3D
    surfaces?: Surface3DConfig[]
    ref_lines?: RefLine3D[]
    ref_planes?: RefPlane[]
    // Color scale function for color_values (computed once by the ScatterPlot3D wrapper)
    color_scale_fn?: (value: number) => string
    size_scale?: SizeScaleConfig
    camera_position?: Vec3
    sphere_segments?: number
    // Marker position, size and colour glide to new data or encodings; `{ duration: 0 }` snaps
    point_tween?: InstanceTween
    hovered_point?: InternalPoint3D<Metadata> | null
    on_point_click?: (data: Scatter3DHandlerEvent<Metadata>) => void
    on_point_hover?: (data: Scatter3DHandlerEvent<Metadata> | null) => void
    tooltip?: Snippet<[Scatter3DHandlerEvent<Metadata>]>
    tooltip_portal?: HTMLElement
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    width?: number
    height?: number
    fullscreen?: boolean // reported in handler events, like the 2D charts
  } = $props()

  // Mirrors scene/camera into bindable props and tags the canvas so export_canvas_as_png can re-render at export DPI
  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  const { enabled: hover_enabled } = extras.interactivity({
    // Overlapping points must pick the front surface, not the last (farthest) hit.
    filter: (hits) => front_hit(hits),
  })

  type AxisKey = `x` | `y` | `z`

  // In Three.js, Y is vertical. We map user's Z → Three.js Y (vertical) and user's Y →
  // Three.js Z (depth). So scene_z here refers to Three.js Y.
  const [scene_x, scene_y, scene_z] = SCENE_SIZE
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
    // No point hover while orbiting: a drag would raycast every instance on each pointermove,
    // and the highlight sphere + tooltip hopping between points under the cursor reads as flicker
    set_camera_is_moving: (moving) => {
      hover_enabled.set(!moving)
      if (moving && hovered_point) {
        hovered_point = null
        on_point_hover?.(null)
      }
    },
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

  const { x: x_range, y: y_range, z: z_range } = $derived(ranges)

  const normalize_x = (value: number) => normalize_to_scene(value, x_range, scene_x)
  const normalize_y = (value: number) => normalize_to_scene(value, y_range, scene_y)
  const normalize_z = (value: number) => normalize_to_scene(value, z_range, scene_z)

  // Size scale (the color scale is computed by the wrapper and passed as a prop)
  // the type alone, so radius changes don't re-scan the size values
  const size_scale_type = $derived(size_scale.type)
  const auto_size_range = $derived(collect_size_range(series, size_scale_type))
  let size_scale_fn = $derived(create_size_scale(size_scale, auto_size_range))

  // One marker: `key` identifies the same logical point across data changes
  type PointInstance = {
    key: string
    point: InternalPoint3D<Metadata>
    position: Vec3
    radius: number
    color: string
  }

  const point_key = (point: Pick<InternalPoint3D<Metadata>, `series_idx` | `point_idx`>) =>
    `${point.series_idx}-${point.point_idx}`
  // User Z → Three.js Y (vertical), user Y → Three.js Z (depth)
  const to_scene = ([coord_x, coord_y, coord_z]: Vec3): Vec3 => [
    normalize_x(coord_x),
    normalize_z(coord_z),
    normalize_y(coord_y),
  ]

  // Every in-range point of every visible series, in (series_idx, point_idx) order, with its
  // scene position, radius and color. Out-of-range and non-finite points are left out.
  let point_instances = $derived.by(() => {
    const instances: PointInstance[] = []
    series.forEach((srs, series_idx) => {
      if (!srs || !(srs.visible ?? true)) return
      const { metadata, point_style } = srs
      for (let point_idx = 0; point_idx < srs.x.length; point_idx++) {
        const coords: Vec3 = [srs.x[point_idx], srs.y[point_idx], srs.z[point_idx]]
        const [coord_x, coord_y, coord_z] = coords
        if (!in_range(coord_x, x_range) || !in_range(coord_y, y_range)) continue
        if (!in_range(coord_z, z_range)) continue
        const point: InternalPoint3D<Metadata> = {
          x: coord_x,
          y: coord_y,
          z: coord_z,
          series_idx,
          point_idx,
          color_value: srs.color_values?.[point_idx] ?? null,
          size_value: srs.size_values?.[point_idx] ?? null,
          metadata: Array.isArray(metadata) ? metadata[point_idx] : metadata,
          point_style: Array.isArray(point_style) ? point_style[point_idx] : point_style,
        }
        instances.push({
          point,
          key: point_key(point),
          position: to_scene(coords),
          color:
            point.color_value != null
              ? color_scale_fn(point.color_value)
              : (point.point_style?.fill ?? plot_color(series_idx)),
          radius:
            point.size_value != null
              ? size_scale_fn(point.size_value)
              : (point.point_style?.radius ?? styles.point?.size ?? 2) * 0.05,
        })
      }
    })
    return instances
  })
  const idx_by_key = $derived(new Map(point_instances.map(({ key }, idx) => [key, idx])))

  // New data (or a hidden series) leaves no pointer event behind: keep the hovered point
  // tracking the same logical point's current values and position, or drop it once gone
  $effect.pre(() => {
    const lookup = idx_by_key
    untrack(() => {
      if (!hovered_point) return
      const next = point_instances[lookup.get(point_key(hovered_point)) ?? -1]?.point ?? null
      if (next !== hovered_point) hovered_point = next
    })
  })

  // One clock glides every marker and its shadows to new data or encodings. Changes within
  // SETTLE_MS of mount are the plot appearing, not the data moving, so they snap like the 2D
  // markers' settling tween, as do plots too big to rewrite every instance each frame.
  const tween = create_instance_tween()
  const settled_at = performance.now() + SETTLE_MS
  const max_tweened_instances = 20_000
  $effect.pre(() => {
    const instances = point_instances
    untrack(() => {
      const now = performance.now()
      const snap = now < settled_at || instances.length > max_tweened_instances
      const keys = instances.map(({ key }) => key)
      tween.retarget(
        keys,
        pack_instances(instances),
        now,
        snap ? { duration: 0 } : point_tween,
      )
    })
  })
  // Like the task above, runs every frame without forcing renders: only a moving tween
  // rewrites the instance buffers, which invalidates
  useTask(() => tween.step(performance.now()), { autoInvalidate: false })
  // The hovered marker as drawn, so the halo and tooltip ride along with a moving point
  const hover_drawn = $derived.by(() => {
    const idx = hovered_point && idx_by_key.get(point_key(hovered_point))
    if (idx == null) return null
    const [pos_x, pos_y, pos_z, radius] = tween.current.subarray(idx * INSTANCE_STRIDE)
    return { position: [pos_x, pos_y, pos_z] as Vec3, radius }
  })

  // One sphere mesh for every point: instance transforms carry each radius
  const point_geometry = $derived(
    new THREE.SphereGeometry(1, sphere_segments, sphere_segments),
  )
  const projection_geometry = new THREE.SphereGeometry(1, 8, 8)
  const point_material = new THREE.MeshStandardMaterial()
  const projection_material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
  })
  dispose_on_change(() => [point_geometry])
  onDestroy(() => {
    projection_geometry.dispose()
    point_material.dispose()
    projection_material.dispose()
  })

  const instance_point = (event: InstanceEvent) =>
    point_instances[event.instanceId ?? -1]?.point ?? null
  // Threlte keys hover by instanceId, so moving between instances fires leave, then enter
  const point_events = {
    onpointerenter: (event: InstanceEvent) => {
      const point = instance_point(event)
      if (!point) return
      hovered_point = point
      on_point_hover?.(make_event_data(point))
    },
    onpointerleave: () => {
      hovered_point = null
      on_point_hover?.(null)
    },
    onclick: (event: InstanceEvent) => {
      const point = instance_point(event)
      if (!point) return
      const native = event.nativeEvent
      on_point_click?.(
        make_event_data(point, native instanceof MouseEvent ? native : undefined),
      )
    },
  }

  // Projection settings - render point shadows on background planes
  let proj_opacity = $derived(display.projection_opacity ?? 0.3)
  let proj_scale = $derived(display.projection_scale ?? 0.5)

  $effect(() => {
    projection_material.opacity = proj_opacity
    invalidate()
  })

  // Point shadows on the enabled background planes: each fixes one scene axis at the
  // backside position, at proj_scale of the point size
  let projection_layers = $derived(
    ([`xy`, `xz`, `yz`] as const)
      .filter((key) => display.projections?.[key])
      .map((key): { key: string; projection: InstanceProjection } => ({
        key,
        projection:
          key === `xy`
            ? { axis: 1, at: pos.y, scale: proj_scale }
            : key === `xz`
              ? { axis: 2, at: pos.z, scale: proj_scale }
              : { axis: 0, at: pos.x, scale: proj_scale },
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
    const inputs: SeriesLineInput[] = []
    for (const [series_idx, srs] of series.entries()) {
      const line_style = srs?.line_style
      if (!line_style || !(srs.visible ?? true)) continue
      // Lines run through every finite point, in range or not: the box's clipping group cuts
      // them at the axes instead of dropping whole segments
      const positions: number[] = []
      for (let point_idx = 0; point_idx < srs.x.length; point_idx++) {
        const coords: Vec3 = [srs.x[point_idx], srs.y[point_idx], srs.z[point_idx]]
        if (coords.every(Number.isFinite)) positions.push(...to_scene(coords))
      }
      if (positions.length < 6) continue // < 2 points
      inputs.push({
        series_idx,
        positions,
        color: line_style.stroke ?? first_point_style(srs)?.fill ?? plot_color(series_idx),
        width: line_style.stroke_width ?? 2,
        dashed: Boolean(line_style.line_dash),
      })
    }
    return inputs
  })

  const same_line_input = (prev: SeriesLineData, next: SeriesLineInput): boolean =>
    prev.color === next.color &&
    prev.width === next.width &&
    prev.dashed === next.dashed &&
    prev.positions.length === next.positions.length &&
    prev.positions.every((coord, idx) => coord === next.positions[idx])

  // Reassign the array without proxying every coordinate; identity checks below reuse lines.
  let series_lines: SeriesLineData[] = $state.raw([])

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

  // Build event data for point interactions (the point is in data coordinates)
  function make_event_data(
    point: InternalPoint3D<Metadata>,
    event?: MouseEvent,
  ): Scatter3DHandlerEvent<Metadata> {
    const { series_idx, x: coord_x, y: coord_y, z: coord_z } = point
    const srs = series[series_idx]
    return {
      x: coord_x,
      y: coord_y,
      z: coord_z,
      metadata: point.metadata ?? null,
      label: srs?.label ?? null,
      series_idx,
      x_axis,
      y_axis,
      z_axis,
      x_formatted: format_num(coord_x, x_axis.format || `.3~g`),
      y_formatted: format_num(coord_y, y_axis.format || `.3~g`),
      z_formatted: format_num(coord_z, z_axis.format || `.3~g`),
      color_value: point.color_value,
      fullscreen,
      event,
      point,
    }
  }

  // Everything drawn from data (lines, surfaces, reference lines/planes) stays inside the box
  const box_clip = box_clipping_planes(scene_x, scene_y, scene_z)
  // The box's 12 edges, for display.show_bounding_box (the BoxGeometry never reaches the GPU)
  const bounding_box_geometry = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(scene_x, scene_z, scene_y),
  )
  onDestroy(() => bounding_box_geometry.dispose())

  // User x/y/z map to scene x/z/y. Each axis supplies its orientation and label offsets;
  // spine, tick, and grid geometry follow the same construction in that local frame.
  let axes_config = $derived(
    [
      {
        key: `x` as AxisKey,
        color: `#ef4444`,
        axis: x_axis,
        ticks: x_ticks,
        half: half_x,
        cross_half: half_z,
        depth_half: half_y,
        cross: pos.y,
        depth: pos.z,
        sign: sign_y,
        normalize: normalize_x,
        orient: (along: number, cross: number, depth: number): Vec3 => [along, cross, depth],
        tick_label_pos: (val: number): Vec3 => [normalize_x(val), pos.y + sign_y * 0.4, pos.z],
        axis_label_pos: [0, pos.y + sign_y * 0.9, pos.z] as Vec3,
      },
      {
        key: `y` as AxisKey,
        color: `#22c55e`,
        axis: y_axis,
        ticks: y_ticks,
        half: half_y,
        cross_half: half_z,
        depth_half: half_x,
        cross: pos.y,
        depth: pos.x,
        sign: sign_y,
        normalize: normalize_y,
        orient: (along: number, cross: number, depth: number): Vec3 => [depth, cross, along],
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
        half: half_z,
        cross_half: half_x,
        depth_half: half_y,
        cross: pos.x,
        depth: pos.z,
        sign: sign_x,
        normalize: normalize_z,
        orient: (along: number, cross: number, depth: number): Vec3 => [cross, along, depth],
        tick_label_pos: (val: number): Vec3 => [pos.x + sign_x * 0.5, normalize_z(val), pos.z],
        axis_label_pos: [pos.x + sign_x, 0, pos.z] as Vec3,
      },
    ].map(
      ({ half, cross_half, depth_half, cross, depth, sign, normalize, orient, ...entry }) => ({
        ...entry,
        line_geom: line_geometry(orient(-half, cross, depth), orient(half, cross, depth)),
        tick_geoms: entry.ticks.map((val) =>
          line_geometry(
            orient(normalize(val), cross, depth),
            orient(normalize(val), cross + sign * 0.15, depth),
          ),
        ),
        grid_geoms: entry.ticks.map((val) => {
          const along = normalize(val)
          const across = line_geometry(
            orient(along, -cross_half, depth),
            orient(along, cross_half, depth),
          )
          const behind = line_geometry(
            orient(along, cross, -depth_half),
            orient(along, cross, depth_half),
          )
          return entry.key === `y` ? [behind, across] : [across, behind]
        }),
      }),
    ),
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
      <T is={line_geom} dispose={false} />
      <T.LineBasicMaterial {color} linewidth={2} />
    </T.Line>
    <!-- Ticks and grid -->
    {#each ticks as tick_val, tick_idx (tick_val)}
      <T.Line>
        <T is={tick_geoms[tick_idx]} dispose={false} />
        <T.LineBasicMaterial {color} />
      </T.Line>
      {#if display.show_grid !== false}
        {#each grid_geoms[tick_idx] as grid_geom, grid_idx (grid_idx)}
          <T.Line>
            <T is={grid_geom} dispose={false} />
            <T.LineBasicMaterial color="#888" opacity={0.4} transparent />
          </T.Line>
        {/each}
      {/if}
      <extras.HTML position={tick_label_pos(tick_val)} center zIndexRange={[1, 0]}>
        <span class="tick-label">{format_num(tick_val, axis.format || `.2~g`)}</span>
      </extras.HTML>
    {/each}
    <!-- Axis label -->
    {#if display.show_axis_labels !== false}
      <extras.HTML position={axis_label_pos} center zIndexRange={[1, 0]}>
        <span class="axis-label" style:color
          >{@html sanitize_html(axis.label || key.toUpperCase())}</span
        >
      </extras.HTML>
    {/if}
  {/each}
{/if}

{#if display.show_bounding_box}
  <T.LineSegments>
    <T is={bounding_box_geometry} dispose={false} />
    <T.LineBasicMaterial color="#888" />
  </T.LineSegments>
{/if}

<T is={THREE.ClippingGroup} clippingPlanes={box_clip}>
  <!-- Surfaces -->
  {#each surfaces.filter((srf) => srf.visible !== false) as surface (surface.id ?? surfaces.indexOf(surface))}
    <Surface3D config={surface} {x_range} {y_range} {z_range} {scene_x} {scene_y} {scene_z} />
  {/each}

  <!-- Reference Planes -->
  {#each ref_planes.filter((plane) => plane.visible !== false) as ref_plane, plane_idx (ref_plane.id ?? plane_idx)}
    <ReferencePlane {ref_plane} {ranges} />
  {/each}

  <!-- Reference Lines -->
  {#each ref_lines.filter((line) => line.visible !== false) as ref_line, line_idx (ref_line.id ?? line_idx)}
    <ReferenceLine3D {ref_line} {ranges} />
  {/each}

  <!-- Series lines connecting points (fat lines using Line2) -->
  {#each series_lines as line_data (line_data.series_idx)}
    <T is={line_data.line2} />
  {/each}
</T>

<!-- All points in one InstancedMesh, picked by instanceId -->
<PointInstances
  packed={tween.current}
  geometry={point_geometry}
  material={point_material}
  {...point_events}
/>

<!-- Plane Projections - render point shadows on enabled background planes -->
{#each projection_layers as { key, projection } (key)}
  <PointInstances
    packed={tween.current}
    {projection}
    geometry={projection_geometry}
    material={projection_material}
  />
{/each}

<!-- Hover highlight -->
{#if hovered_point}
  {@const hover_point = hovered_point}
  {#if hover_drawn}
    {@const hover_geometry = hover_marker_geometry(hover_drawn.radius)}
    <T.Mesh position={hover_drawn.position} scale={hover_geometry.radius}>
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

    {@const data = make_event_data(hover_point)}
    <extras.HTML
      position={hover_drawn.position}
      calculatePosition={hover_geometry.tooltip_position}
      style="translate: -50% -100%; pointer-events: none"
      portal={tooltip_portal}
      zIndexRange={[1000, 1000]}
    >
      {#if tooltip}
        {@render tooltip(data)}
      {:else}
        <div class="tooltip">
          {#each [[`x`, x_axis, data.x_formatted], [`y`, y_axis, data.y_formatted], [`z`, z_axis, data.z_formatted]] as const as [name, axis, value] (name)}
            <div><TooltipValue label={axis.label || name} {value} unit={axis.unit} /></div>
          {/each}
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
