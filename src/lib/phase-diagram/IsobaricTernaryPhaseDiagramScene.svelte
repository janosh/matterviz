<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import { T, useTask, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import type { Camera, Scene } from 'three'
  import * as THREE from 'three'
  import type {
    TernaryPhaseDiagramConfig,
    TernaryPhaseDiagramData,
    TernaryPhaseHoverInfo,
    TernaryPhaseRegion,
  } from './types'
  import {
    get_phase_color,
    merge_ternary_config,
    PHASE_COLOR_HEX,
    ternary_to_scene_xyz,
    TRIANGLE_VERTICES,
  } from './utils'

  type Props = {
    data: TernaryPhaseDiagramData
    config?: Partial<TernaryPhaseDiagramConfig>
    // Slice state
    slice_temperature?: number
    slice_ratio?: number
    show_isothermal_plane?: boolean
    show_vertical_plane?: boolean
    // Display options
    show_labels?: boolean
    show_special_points?: boolean
    show_grid?: boolean
    region_opacity?: number
    render_mode?: `transparent` | `solid`
    // Camera
    camera_position?: Vec3
    auto_rotate?: number
    // Hover state
    hovered_region?: TernaryPhaseRegion | null
    on_region_hover?: (info: TernaryPhaseHoverInfo | null) => void
    on_slice_temperature_change?: (temperature: number) => void
    // Bindings
    scene?: Scene
    camera?: Camera
    orbit_controls?: ComponentProps<typeof extras.OrbitControls>[`ref`]
  }

  let {
    data,
    config = {},
    slice_temperature = $bindable(),
    slice_ratio = $bindable(0.5),
    show_isothermal_plane = $bindable(true),
    show_vertical_plane = $bindable(false),
    show_labels = true,
    show_special_points = true,
    show_grid = true,
    region_opacity = $bindable(0.6),
    render_mode = $bindable(`transparent`),
    camera_position = [8, 6, 8],
    auto_rotate = 0,
    hovered_region = $bindable(null),
    on_region_hover,
    on_slice_temperature_change,
    scene = $bindable(),
    camera = $bindable(),
    orbit_controls = $bindable(),
  }: Props = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
  })

  extras.interactivity()

  // Merged config with defaults
  const merged_config = $derived(merge_ternary_config(config))

  // Scene dimensions
  const scene_height = 5
  const prism_scale = 5

  // Temperature range from data
  const t_range = $derived<[number, number]>(
    data.temperature_range as [number, number],
  )
  const t_min = $derived(t_range[0])
  const t_max = $derived(t_range[1])

  // Initialize slice temperature to midpoint if not set
  $effect(() => {
    if (slice_temperature === undefined) {
      slice_temperature = (t_min + t_max) / 2
    }
  })

  // Triangle vertices in scene coordinates
  const triangle_vertices_scene = $derived(
    TRIANGLE_VERTICES.map(([tri_x, tri_y]) => {
      const centroid_x = (TRIANGLE_VERTICES[0][0] + TRIANGLE_VERTICES[1][0] +
        TRIANGLE_VERTICES[2][0]) / 3
      const centroid_y = (TRIANGLE_VERTICES[0][1] + TRIANGLE_VERTICES[1][1] +
        TRIANGLE_VERTICES[2][1]) / 3
      return [
        (tri_x - centroid_x) * prism_scale,
        (tri_y - centroid_y) * prism_scale,
      ] as [number, number]
    }),
  )

  // Prism frame geometry - edges of the triangular prism
  const prism_edges = $derived.by(() => {
    const edges: Array<{ start: Vec3; end: Vec3 }> = []
    const [v0, v1, v2] = triangle_vertices_scene

    // Bottom triangle (T_min)
    edges.push({ start: [v0[0], 0, v0[1]], end: [v1[0], 0, v1[1]] })
    edges.push({ start: [v1[0], 0, v1[1]], end: [v2[0], 0, v2[1]] })
    edges.push({ start: [v2[0], 0, v2[1]], end: [v0[0], 0, v0[1]] })

    // Top triangle (T_max)
    edges.push({
      start: [v0[0], scene_height, v0[1]],
      end: [v1[0], scene_height, v1[1]],
    })
    edges.push({
      start: [v1[0], scene_height, v1[1]],
      end: [v2[0], scene_height, v2[1]],
    })
    edges.push({
      start: [v2[0], scene_height, v2[1]],
      end: [v0[0], scene_height, v0[1]],
    })

    // Vertical edges
    edges.push({ start: [v0[0], 0, v0[1]], end: [v0[0], scene_height, v0[1]] })
    edges.push({ start: [v1[0], 0, v1[1]], end: [v1[0], scene_height, v1[1]] })
    edges.push({ start: [v2[0], 0, v2[1]], end: [v2[0], scene_height, v2[1]] })

    return edges
  })

  // Create geometry for phase regions
  function create_region_geometry(region: TernaryPhaseRegion): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    const positions: number[] = []
    const colors: number[] = []

    // Get color for this region
    const color_hex = region.color || get_phase_color(region.name)
    const color = new THREE.Color(color_hex)

    // Convert vertices to scene coordinates
    const scene_vertices = region.vertices.map((v) =>
      ternary_to_scene_xyz(v[0], v[1], v[2], v[3], t_range, scene_height)
    )

    // Add triangular faces
    for (const face of region.faces) {
      if (face.length < 3) continue

      // Triangulate the face (assuming it's already triangular or we take first 3)
      for (let idx = 1; idx < face.length - 1; idx++) {
        const v0 = scene_vertices[face[0]]
        const v1 = scene_vertices[face[idx]]
        const v2 = scene_vertices[face[idx + 1]]

        positions.push(v0[0], v0[1], v0[2])
        positions.push(v1[0], v1[1], v1[2])
        positions.push(v2[0], v2[1], v2[2])

        colors.push(color.r, color.g, color.b)
        colors.push(color.r, color.g, color.b)
        colors.push(color.r, color.g, color.b)
      }
    }

    geometry.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    return geometry
  }

  // Region geometries (reactive)
  const region_geometries = $derived(
    data.regions.map((region) => ({
      region,
      geometry: create_region_geometry(region),
      is_hovered: hovered_region?.id === region.id,
    })),
  )

  // Isothermal slice plane position
  const slice_plane_y = $derived.by(() => {
    if (slice_temperature === undefined) return scene_height / 2
    const t_norm = (slice_temperature - t_min) / (t_max - t_min)
    return t_norm * scene_height
  })

  // Temperature axis ticks
  const temp_ticks = $derived.by(() => {
    const count = 6
    const ticks: Array<{ value: number; y: number; label: string }> = []
    for (let idx = 0; idx <= count; idx++) {
      const fraction = idx / count
      const temp_value = t_min + fraction * (t_max - t_min)
      ticks.push({
        value: temp_value,
        y: fraction * scene_height,
        label: format_num(temp_value, `.0f`),
      })
    }
    return ticks
  })

  // Component labels at triangle vertices
  const component_labels = $derived(
    data.components.map((comp, idx) => ({
      label: comp,
      position: [
        triangle_vertices_scene[idx][0],
        -0.3,
        triangle_vertices_scene[idx][1],
      ] as Vec3,
    })),
  )

  // Dynamic backside positions for axis labels
  let axis_pos = $state({ x: -3, z: -2 })

  useTask(() => {
    if (!camera) return
    const cam = camera.position
    axis_pos.x = cam.x > 0 ? -3 : 3
    axis_pos.z = cam.z > 0 ? -2 : 2
  })

  // Handle region hover
  function handle_region_pointer_enter(
    region: TernaryPhaseRegion,
    event: PointerEvent,
  ) {
    hovered_region = region
    on_region_hover?.({
      region,
      composition: [0.33, 0.33, 0.34], // Approximate - would need raycasting for exact
      temperature: slice_temperature ?? (t_min + t_max) / 2,
      position: { x: event.clientX, y: event.clientY },
    })
  }

  function handle_region_pointer_leave() {
    hovered_region = null
    on_region_hover?.(null)
  }

  // Handle slice plane drag
  let is_dragging_slice = $state(false)

  function handle_slice_plane_drag(event: PointerEvent) {
    if (!is_dragging_slice || !camera) return

    // Project mouse position to get Y coordinate
    const rect = (event.target as HTMLElement)?.getBoundingClientRect?.()
    if (!rect) return

    const mouse_y = 1 - (event.clientY - rect.top) / rect.height
    const new_y = Math.max(
      0,
      Math.min(scene_height, mouse_y * scene_height * 2 - scene_height / 2),
    )
    const new_temp = t_min + (new_y / scene_height) * (t_max - t_min)

    slice_temperature = Math.max(t_min, Math.min(t_max, new_temp))
    on_slice_temperature_change?.(slice_temperature)
  }

  // Cleanup geometries on unmount
  $effect(() => {
    return () => {
      for (const { geometry } of region_geometries) {
        geometry.dispose()
      }
    }
  })
</script>

<!-- Camera with Orbit Controls -->
<T.PerspectiveCamera
  makeDefault
  position={camera_position}
  fov={50}
  near={0.1}
  far={1000}
>
  <extras.OrbitControls
    bind:ref={orbit_controls}
    enableDamping
    dampingFactor={0.05}
    autoRotate={auto_rotate > 0}
    autoRotateSpeed={auto_rotate}
  >
    <extras.Gizmo
      placement="bottom-left"
      size={80}
      offset={{ left: 10, bottom: 10 }}
    />
  </extras.OrbitControls>
</T.PerspectiveCamera>

<!-- Lighting -->
<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[10, 10, 5]} intensity={0.8} />
<T.DirectionalLight position={[-5, 5, -5]} intensity={0.4} />

<!-- Prism Frame -->
{#each prism_edges as edge, idx (idx)}
  <T.Line>
    <T.BufferGeometry>
      <T.BufferAttribute
        args={[new Float32Array([...edge.start, ...edge.end]), 3]}
        attach="attributes-position"
      />
    </T.BufferGeometry>
    <T.LineBasicMaterial color={0x1a1a1a} linewidth={2} />
  </T.Line>
{/each}

<!-- Phase Regions -->
{#each region_geometries as { region, geometry, is_hovered } (region.id)}
  <T.Mesh
    {geometry}
    onpointerenter={(event: PointerEvent) => handle_region_pointer_enter(region, event)}
    onpointerleave={handle_region_pointer_leave}
  >
    <T.MeshStandardMaterial
      vertexColors
      transparent={render_mode === `transparent`}
      opacity={is_hovered ? Math.min(1, region_opacity + 0.2) : region_opacity}
      side={THREE.DoubleSide}
      depthWrite={render_mode === `solid`}
    />
  </T.Mesh>
{/each}

<!-- Isothermal Slice Plane -->
{#if show_isothermal_plane && slice_temperature !== undefined}
  <T.Mesh
    position.y={slice_plane_y}
    rotation.x={-Math.PI / 2}
    onpointerdown={() => is_dragging_slice = true}
    onpointerup={() => is_dragging_slice = false}
    onpointermove={handle_slice_plane_drag}
  >
    <T.CircleGeometry args={[4, 3]} />
    <T.MeshBasicMaterial
      color={PHASE_COLOR_HEX.tie_line}
      transparent
      opacity={0.3}
      side={THREE.DoubleSide}
    />
  </T.Mesh>

  <!-- Slice plane outline -->
  {#each [[0, 1], [1, 2], [2, 0]] as [idx1, idx2] (`slice-edge-${idx1}-${idx2}`)}
    <T.Line>
      <T.BufferGeometry>
        <T.BufferAttribute
          args={[
            new Float32Array([
              triangle_vertices_scene[idx1][0],
              slice_plane_y,
              triangle_vertices_scene[idx1][1],
              triangle_vertices_scene[idx2][0],
              slice_plane_y,
              triangle_vertices_scene[idx2][1],
            ]),
            3,
          ]}
          attach="attributes-position"
        />
      </T.BufferGeometry>
      <T.LineBasicMaterial color={PHASE_COLOR_HEX.tie_line} linewidth={2} />
    </T.Line>
  {/each}
{/if}

<!-- Component Labels at Triangle Vertices -->
{#if show_labels}
  {#each component_labels as { label, position } (label)}
    <extras.Text
      text={label}
      {position}
      fontSize={0.4}
      color={merged_config.colors.text}
      anchorX="center"
      anchorY="middle"
      font="https://cdn.jsdelivr.net/npm/three/examples/fonts/helvetiker_regular.typeface.json"
    />
  {/each}
{/if}

<!-- Temperature Axis -->
{#if show_grid}
  <!-- Axis line -->
  <T.Line>
    <T.BufferGeometry>
      <T.BufferAttribute
        args={[
          new Float32Array([
            axis_pos.x,
            0,
            axis_pos.z,
            axis_pos.x,
            scene_height,
            axis_pos.z,
          ]),
          3,
        ]}
        attach="attributes-position"
      />
    </T.BufferGeometry>
    <T.LineBasicMaterial color={merged_config.colors.axis} />
  </T.Line>

  <!-- Temperature ticks and labels -->
  {#each temp_ticks as tick (tick.value)}
    <!-- Tick mark -->
    <T.Line>
      <T.BufferGeometry>
        <T.BufferAttribute
          args={[
            new Float32Array([
              axis_pos.x,
              tick.y,
              axis_pos.z,
              axis_pos.x - 0.2,
              tick.y,
              axis_pos.z,
            ]),
            3,
          ]}
          attach="attributes-position"
        />
      </T.BufferGeometry>
      <T.LineBasicMaterial color={merged_config.colors.axis} />
    </T.Line>

    <!-- Tick label -->
    <extras.Text
      text={tick.label}
      position={[axis_pos.x - 0.5, tick.y, axis_pos.z]}
      fontSize={0.25}
      color={merged_config.colors.text}
      anchorX="right"
      anchorY="middle"
      font="https://cdn.jsdelivr.net/npm/three/examples/fonts/helvetiker_regular.typeface.json"
    />
  {/each}

  <!-- Temperature axis label -->
  <extras.Text
    text="T ({data.temperature_unit ?? `K`})"
    position={[axis_pos.x - 1, scene_height / 2, axis_pos.z]}
    fontSize={0.3}
    color={merged_config.colors.text}
    anchorX="center"
    anchorY="middle"
    rotation.z={Math.PI / 2}
    font="https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hiJ-Ek-_EeA.woff2"
  />
{/if}

<!-- Special Points -->
{#if show_special_points && data.special_points}
  {#each data.special_points as point (point.id)}
    {@const pos = ternary_to_scene_xyz(
    point.position[0],
    point.position[1],
    point.position[2],
    point.position[3],
    t_range,
    scene_height,
  )}
    <T.Mesh position={pos}>
      <T.SphereGeometry args={[0.1, 16, 16]} />
      <T.MeshStandardMaterial color={merged_config.colors.special_point} />
    </T.Mesh>
    {#if point.label}
      <extras.Text
        text={point.label}
        position={[pos[0], pos[1] + 0.2, pos[2]]}
        fontSize={0.2}
        color={merged_config.colors.text}
        anchorX="center"
        anchorY="bottom"
        font="https://cdn.jsdelivr.net/npm/three/examples/fonts/helvetiker_regular.typeface.json"
      />
    {/if}
  {/each}
{/if}
