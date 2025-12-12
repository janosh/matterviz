<script lang="ts">
  import type { D3ColorSchemeName, D3InterpolateName } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import type {
    AxisConfig3D,
    CameraProjection3D,
    DataSeries3D,
    DisplayConfig3D,
    InternalPoint3D,
    ScaleType,
    Scatter3DHandlerEvent,
    StyleOverrides3D,
    Surface3DConfig,
  } from '$lib/plot/types'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { Camera, Scene } from 'three'
  import * as THREE from 'three'
  import { get_series_color } from './data-transform'
  import { create_color_scale, create_size_scale } from './scales'
  import Surface3D from './Surface3D.svelte'

  type InstancedPointGroup = {
    color: string
    radius: number
    points: InternalPoint3D[]
  }

  let {
    series = [],
    x_axis = {},
    y_axis = {},
    z_axis = {},
    display = {},
    styles = {},
    surfaces = [],
    color_scale = { type: `linear`, scheme: `interpolateViridis` },
    size_scale = { type: `linear`, radius_range: [0.05, 0.2] },
    camera_position = [10, 10, 10] as [number, number, number],
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
    series?: DataSeries3D[]
    x_axis?: AxisConfig3D
    y_axis?: AxisConfig3D
    z_axis?: AxisConfig3D
    display?: DisplayConfig3D
    styles?: StyleOverrides3D
    surfaces?: Surface3DConfig[]
    color_scale?: {
      type?: ScaleType
      scheme?: D3ColorSchemeName | D3InterpolateName
      value_range?: [number, number]
    }
    size_scale?: {
      type?: ScaleType
      radius_range?: [number, number]
      value_range?: [number, number]
    }
    camera_position?: [number, number, number]
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
    hovered_point?: InternalPoint3D | null
    on_point_click?: (data: Scatter3DHandlerEvent) => void
    on_point_hover?: (data: Scatter3DHandlerEvent | null) => void
    tooltip?: Snippet<[Scatter3DHandlerEvent]>
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
    width?: number
    height?: number
  } = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
  })

  extras.interactivity()

  const scene_size = 10
  const half = scene_size / 2

  // Flatten all points from series
  let all_points = $derived(
    series
      .filter(Boolean)
      .flatMap((srs, series_idx) =>
        srs.x.map((x_val, point_idx) => ({
          x: x_val,
          y: srs.y[point_idx],
          z: srs.z[point_idx],
          series_idx,
          point_idx,
          color_value: srs.color_values?.[point_idx] ?? null,
          size_value: srs.size_values?.[point_idx] ?? null,
          metadata: Array.isArray(srs.metadata)
            ? srs.metadata[point_idx]
            : srs.metadata,
          point_style: Array.isArray(srs.point_style)
            ? srs.point_style[point_idx]
            : srs.point_style,
        }))
      ),
  )

  // Compute axis ranges with padding
  function compute_range(
    values: number[],
    axis_range?: [number | null, number | null],
  ): [number, number] {
    if (axis_range?.[0] != null && axis_range?.[1] != null) {
      return axis_range as [number, number]
    }
    const valid = values.filter(isFinite)
    if (valid.length === 0) return [0, 1]
    const min_val = Math.min(...valid)
    const max_val = Math.max(...valid)
    const pad = (max_val - min_val) * 0.05 || 0.5
    return [axis_range?.[0] ?? min_val - pad, axis_range?.[1] ?? max_val + pad]
  }

  let x_range = $derived(compute_range(all_points.map((pt) => pt.x), x_axis.range))
  let y_range = $derived(compute_range(all_points.map((pt) => pt.y), y_axis.range))
  let z_range = $derived(compute_range(all_points.map((pt) => pt.z), z_axis.range))

  // Normalize value to [-half, half] scene coordinates
  function normalize(value: number, range: [number, number]): number {
    const [min_val, max_val] = range
    return ((value - min_val) / (max_val - min_val || 1) - 0.5) * scene_size
  }

  // Color/size scales
  let all_color_values = $derived(
    all_points.map((pt) => pt.color_value).filter((val): val is number =>
      val != null
    ),
  )
  let auto_color_range = $derived.by((): [number, number] => {
    if (all_color_values.length === 0) return [0, 1]
    return [Math.min(...all_color_values), Math.max(...all_color_values)]
  })
  let all_size_values = $derived(
    all_points.map((pt) => pt.size_value).filter((val): val is number => val != null),
  )
  let color_scale_fn = $derived(create_color_scale(color_scale, auto_color_range))
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))

  // Process points with normalized positions
  let processed_points = $derived(
    all_points.map((pt): InternalPoint3D => ({
      ...pt,
      x: normalize(pt.x, x_range),
      y: normalize(pt.y, y_range),
      z: normalize(pt.z, z_range),
    })),
  )

  // Group points by color+size for instanced rendering
  let instanced_point_groups = $derived.by((): InstancedPointGroup[] => {
    const groups: Record<string, InstancedPointGroup> = {}
    for (const point of processed_points) {
      const srs = series[point.series_idx]
      if (!(srs?.visible ?? true)) continue
      const color = point.color_value != null
        ? color_scale_fn(point.color_value)
        : point.point_style?.fill ?? get_series_color(point.series_idx)
      const radius = point.size_value != null
        ? size_scale_fn(point.size_value)
        : (point.point_style?.radius ?? styles.point?.size ?? 2) * 0.05
      const key = `${color}-${radius.toFixed(3)}`
      groups[key] ??= { color, radius, points: [] }
      groups[key].points.push(point)
    }
    return Object.values(groups)
  })

  // Generate axis ticks
  function generate_ticks(range: [number, number], count: number = 5): number[] {
    const [min_val, max_val] = range
    const step = (max_val - min_val) / (count - 1)
    return Array.from({ length: count }, (_, idx) => min_val + idx * step)
  }

  let x_ticks = $derived(generate_ticks(x_range))
  let y_ticks = $derived(generate_ticks(y_range))
  let z_ticks = $derived(generate_ticks(z_range))

  // Create axis line geometry
  function create_axis_geometry(
    start: [number, number, number],
    end: [number, number, number],
  ): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      `position`,
      new THREE.Float32BufferAttribute([...start, ...end], 3),
    )
    return geometry
  }

  // Handle point interactions
  function handle_point_enter(point: InternalPoint3D) {
    hovered_point = point
    if (!on_point_hover) return
    const orig = all_points.find((pt) =>
      pt.series_idx === point.series_idx && pt.point_idx === point.point_idx
    )
    if (!orig) return
    on_point_hover({
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
      event: new MouseEvent(`pointerenter`),
      point,
    })
  }

  function handle_point_leave() {
    hovered_point = null
    on_point_hover?.(null)
  }

  function handle_point_click(point: InternalPoint3D, event: MouseEvent) {
    if (!on_point_click) return
    const orig = all_points.find((pt) =>
      pt.series_idx === point.series_idx && pt.point_idx === point.point_idx
    )
    if (!orig) return
    on_point_click({
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
    })
  }

  // Gizmo props
  let gizmo_props = $derived(
    typeof gizmo === `boolean`
      ? gizmo
        ? { background: { enabled: false }, offset: { left: 5, bottom: 5 } }
        : null
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
    target: [0, 0, 0] as [number, number, number],
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
  type Vec3 = [number, number, number]

  // Memoized axis geometries (main axis lines)
  let axis_geometries = $derived({
    x: create_axis_geometry([-half, -half, -half], [half, -half, -half]),
    y: create_axis_geometry([-half, -half, -half], [-half, half, -half]),
    z: create_axis_geometry([-half, -half, -half], [-half, -half, half]),
  })

  // Axis rendering configuration
  let axes_config = $derived([
    {
      key: `x` as AxisKey,
      color: `#ef4444`,
      axis: x_axis,
      ticks: x_ticks,
      range: x_range,
      get_tick_pos: (val: number): Vec3 => [normalize(val, x_range), -half, -half],
      get_tick_end: (
        val: number,
      ): Vec3 => [normalize(val, x_range), -half - tick_length, -half],
      get_grid_lines: (val: number): [Vec3, Vec3][] => {
        const pos = normalize(val, x_range)
        return [
          [[pos, -half, -half], [pos, half, -half]],
          [[pos, -half, -half], [pos, -half, half]],
        ]
      },
      tick_label_pos: (
        val: number,
      ): Vec3 => [normalize(val, x_range), -half - 0.4, -half],
      axis_label_pos: [0, -half - 0.9, -half] as Vec3,
    },
    {
      key: `y` as AxisKey,
      color: `#22c55e`,
      axis: y_axis,
      ticks: y_ticks,
      range: y_range,
      get_tick_pos: (val: number): Vec3 => [-half, normalize(val, y_range), -half],
      get_tick_end: (
        val: number,
      ): Vec3 => [-half - tick_length, normalize(val, y_range), -half],
      get_grid_lines: (val: number): [Vec3, Vec3][] => {
        const pos = normalize(val, y_range)
        return [
          [[-half, pos, -half], [half, pos, -half]],
          [[-half, pos, -half], [-half, pos, half]],
        ]
      },
      tick_label_pos: (
        val: number,
      ): Vec3 => [-half - 0.5, normalize(val, y_range), -half],
      axis_label_pos: [-half - 1, 0, -half] as Vec3,
    },
    {
      key: `z` as AxisKey,
      color: `#3b82f6`,
      axis: z_axis,
      ticks: z_ticks,
      range: z_range,
      get_tick_pos: (val: number): Vec3 => [-half, -half, normalize(val, z_range)],
      get_tick_end: (
        val: number,
      ): Vec3 => [-half, -half - tick_length, normalize(val, z_range)],
      get_grid_lines: (val: number): [Vec3, Vec3][] => {
        const pos = normalize(val, z_range)
        return [
          [[-half, -half, pos], [half, -half, pos]],
          [[-half, -half, pos], [-half, half, pos]],
        ]
      },
      tick_label_pos: (
        val: number,
      ): Vec3 => [-half, -half - 0.4, normalize(val, z_range)],
      axis_label_pos: [-half, -half, 0] as Vec3,
    },
  ])
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
    zoom={Math.min(width, height) / scene_size / 2 || 50}
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

<!-- Axes with ticks and grid -->
{#if display.show_axes !== false}
  {#each axes_config as
    {
  key,
  color,
  axis,
  ticks,
  get_tick_pos,
  get_tick_end,
  get_grid_lines,
  tick_label_pos,
  axis_label_pos,
}
    (key)
  }
    <!-- Main axis line -->
    <T.Line>
      <T is={axis_geometries[key]} />
      <T.LineBasicMaterial {color} linewidth={2} />
    </T.Line>
    <!-- Ticks and grid -->
    {#each ticks as tick_val (tick_val)}
      <T.Line>
        <T is={create_axis_geometry(get_tick_pos(tick_val), get_tick_end(tick_val))} />
        <T.LineBasicMaterial {color} />
      </T.Line>
      {#if display.show_grid !== false}
        {#each get_grid_lines(tick_val) as [start, end], grid_idx (grid_idx)}
          <T.Line>
            <T is={create_axis_geometry(start, end)} />
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
{#each surfaces.filter((srf) => srf.visible !== false) as
  surface
  (surface.id ?? surfaces.indexOf(surface))
}
  <Surface3D config={surface} {x_range} {y_range} {z_range} {scene_size} />
{/each}

<!-- Instanced scatter points -->
{#each instanced_point_groups as group (`${group.color}-${group.radius}`)}
  <extras.InstancedMesh
    key="{group.color}-{group.radius}"
    range={group.points.length}
    frustumCulled={false}
  >
    <T.SphereGeometry args={[1, sphere_segments, sphere_segments]} />
    <T.MeshStandardMaterial color={group.color} />
    {#each group.points as point (`${point.series_idx}-${point.point_idx}`)}
      <extras.Instance
        position={[point.x, point.y, point.z]}
        scale={group.radius}
        onpointerenter={() => handle_point_enter(point)}
        onpointerleave={handle_point_leave}
        onclick={(evt: MouseEvent) => handle_point_click(point, evt)}
      />
    {/each}
  </extras.InstancedMesh>
{/each}

<!-- Hover highlight -->
{#if hovered_point}
  {@const hp = hovered_point}
  {@const group = instanced_point_groups.find((grp) =>
    grp.points.some((pt) =>
      pt.series_idx === hp.series_idx && pt.point_idx === hp.point_idx
    )
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
  {@const orig = all_points.find((pt) =>
    pt.series_idx === hp.series_idx && pt.point_idx === hp.point_idx
  )}
  {#if orig}
    {@const tooltip_data = {
    x: orig.x,
    y: orig.y,
    z: orig.z,
    metadata: hp.metadata ?? null,
    label: series[hp.series_idx]?.label ?? null,
    series_idx: hp.series_idx,
    x_axis,
    y_axis,
    z_axis,
    x_formatted: format_num(orig.x, x_axis.format || `.3~g`),
    y_formatted: format_num(orig.y, y_axis.format || `.3~g`),
    z_formatted: format_num(orig.z, z_axis.format || `.3~g`),
    color_value: orig.color_value,
    fullscreen: false,
    event: new MouseEvent(`pointerenter`),
    point: hp,
  }}
    <extras.HTML position={[hp.x, hp.y + 0.3, hp.z]} center>
      {#if tooltip}
        {@render tooltip(tooltip_data)}
      {:else}
        <div class="tooltip">
          <div>x: {tooltip_data.x_formatted}</div>
          <div>y: {tooltip_data.y_formatted}</div>
          <div>z: {tooltip_data.z_formatted}</div>
          {#if orig.color_value != null}
            <div>value: {format_num(orig.color_value, `.3~g`)}</div>
          {/if}
        </div>
      {/if}
    </extras.HTML>
  {/if}
{/if}

<style>
  .axis-label,
  .tick-label {
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
