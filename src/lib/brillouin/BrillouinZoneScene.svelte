<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { bind_renderer, build_orbit_props, SceneCamera } from '$lib/scene'
  import type { SceneControlProps, ThreltePointerEvent } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import Cylinder from '$lib/structure/Cylinder.svelte'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import {
    cartesian_to_fractional,
    default_camera_position,
    k_lattice_inverse,
    k_space_size,
    polyhedron_centroid,
    polyhedron_geometry,
  } from './geometry'
  import ReciprocalVectors from './ReciprocalVectors.svelte'
  import type { BrillouinZoneData, BZHoverData, IrreducibleBZData } from './types'

  let {
    bz_data = $bindable(),
    camera_position = $bindable(),
    camera_projection = $bindable(`perspective`),
    surface_color = $bindable(`#4488ff`),
    surface_opacity = $bindable(0.3),
    edge_color = $bindable(`#000000`),
    edge_width = $bindable(0.002),
    show_vectors = $bindable(true),
    vector_scale = $bindable(1.0),
    // Irreducible BZ options
    show_ibz = false,
    ibz_data = null as IrreducibleBZData | null,
    ibz_color = `#ff8844`,
    ibz_opacity = 0.5,
    rotation_damping = DEFAULTS.structure.rotation_damping,
    max_zoom = DEFAULTS.structure.max_zoom,
    min_zoom = DEFAULTS.structure.min_zoom,
    rotate_speed = DEFAULTS.structure.rotate_speed,
    zoom_speed = DEFAULTS.structure.zoom_speed,
    pan_speed = DEFAULTS.structure.pan_speed,
    zoom_to_cursor = DEFAULTS.structure.zoom_to_cursor,
    fov = DEFAULTS.structure.fov,
    initial_zoom = DEFAULTS.structure.initial_zoom,
    ambient_light = DEFAULTS.structure.ambient_light,
    directional_light = DEFAULTS.structure.directional_light,
    gizmo = DEFAULTS.structure.show_gizmo,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    scene = $bindable(),
    camera = $bindable(),
    k_path_points = [],
    k_path_labels = [],
    hovered_k_point = null,
    hovered_qpoint_index = null,
    hover_data = $bindable<BZHoverData | null>(null),
    on_kpath_hover,
  }: SceneControlProps & {
    bz_data?: BrillouinZoneData
    camera_position?: Vec3 | undefined
    surface_color?: string
    surface_opacity?: number
    edge_color?: string
    edge_width?: number
    show_vectors?: boolean
    vector_scale?: number
    // Irreducible BZ options
    show_ibz?: boolean
    ibz_data?: IrreducibleBZData | null
    ibz_color?: string
    ibz_opacity?: number
    k_path_points?: Vec3[]
    k_path_labels?: { position: Vec3; label: string | null }[]
    hovered_k_point?: Vec3 | null
    hovered_qpoint_index?: number | null
    hover_data?: BZHoverData | null
    on_kpath_hover?: (qpoint_index: number | null) => void
  } = $props()

  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  extras.interactivity()

  // BZ centroid as rotation center; mean k-vector magnitude for camera positioning
  const rotation_target = $derived(polyhedron_centroid(bz_data?.vertices))
  const bz_size = $derived(k_space_size(bz_data?.k_lattice))
  const computed_camera_position = $derived(
    camera_position || default_camera_position(bz_size),
  )

  const orbit_controls_props = $derived(
    build_orbit_props({
      camera_projection,
      target: rotation_target,
      rotate_speed,
      zoom_speed,
      zoom_to_cursor,
      pan_speed,
      max_zoom,
      min_zoom,
      auto_rotate,
      rotation_damping,
    }),
  )

  // K-path styling. The invisible hover proxy is twice the visible thickness so the cursor
  // snaps to the path even when it isn't directly over the thin visible segment.
  const KPATH_THICKNESS = 0.012
  const KPATH_HOVER_THICKNESS = KPATH_THICKNESS * 2

  // Threshold for skipping k-path segments that bridge a path discontinuity (e.g. `U|K`).
  // Band paths are densely sampled, so legit segments are tiny; a discontinuity jumps by
  // a fraction of the zone. Skip segments far longer than the median sampling step.
  const k_path_seg_cutoff = $derived.by(() => {
    if (!k_path_points || k_path_points.length < 3) return Infinity
    const lens = k_path_points
      .slice(1)
      .map((pt, idx) => Math.hypot(...math.subtract(pt as Vec3, k_path_points[idx] as Vec3)))
      .sort((len_a, len_b) => len_a - len_b)
    return lens[Math.floor(lens.length / 2)] * 10
  })

  const bz_geometry = $derived(
    bz_data ? polyhedron_geometry(bz_data.vertices, bz_data.faces) : null,
  )
  const ibz_geometry = $derived(
    show_ibz && ibz_data ? polyhedron_geometry(ibz_data.vertices, ibz_data.faces) : null,
  )

  // Separate effects to avoid disposing one geometry when only the other changes
  $effect(() => {
    const prev = bz_geometry
    return () => prev?.dispose()
  })
  $effect(() => {
    const prev = ibz_geometry
    return () => prev?.dispose()
  })

  // Inverse of k_lattice for Cartesian->fractional conversion
  const k_lattice_inv = $derived(k_lattice_inverse(bz_data?.k_lattice))

  // Throttle state for pointer move events
  let last_hover_time = 0
  let last_hover_mesh: `bz` | `ibz` | null = null
  const HOVER_THROTTLE_MS = 16 // ~60fps

  // Reset throttle when bz_data changes to ensure immediate response
  $effect(() => {
    if (bz_data) {
      last_hover_time = 0
      last_hover_mesh = null
    }
  })

  // Track IBZ hover state - IBZ takes priority over BZ
  let ibz_hovered = false
  $effect(() => {
    if (!show_ibz) {
      ibz_hovered = false
      // Clear hover tooltip if it was showing IBZ data
      if (hover_data?.is_ibz) hover_data = null
    }
  })

  // Create hover data from pointer event
  function create_hover_data(event: ThreltePointerEvent, is_ibz: boolean): BZHoverData | null {
    if (!bz_data) return null

    const position_cartesian: Vec3 = [event.point.x, event.point.y, event.point.z]
    const position_fractional = cartesian_to_fractional(k_lattice_inv, position_cartesian)

    const { clientX, clientY } = event.nativeEvent
    const ibz_vol = ibz_data?.volume ?? null
    // Round to nearest integer since symmetry multiplicity is the point group order
    const symmetry_multiplicity =
      ibz_vol != null && ibz_vol > 0 ? Math.round(bz_data.volume / ibz_vol) : null

    return {
      position_cartesian,
      position_fractional,
      screen_position: { x: clientX, y: clientY },
      is_ibz,
      bz_order: bz_data.order,
      bz_volume: bz_data.volume,
      ibz_volume: ibz_vol,
      symmetry_multiplicity,
    }
  }

  // Throttled hover handler - IBZ takes priority over BZ
  function handle_hover(event: ThreltePointerEvent, is_ibz: boolean): void {
    if (is_ibz) ibz_hovered = true
    else if (ibz_hovered) return // BZ defers to IBZ

    const mesh = is_ibz ? `ibz` : `bz`
    const now = performance.now()
    // Bypass throttle when switching meshes for responsive transitions
    if (last_hover_mesh === mesh && now - last_hover_time < HOVER_THROTTLE_MS) return

    last_hover_time = now
    last_hover_mesh = mesh
    hover_data = create_hover_data(event, is_ibz)
  }

  // Leave handler - IBZ clears state, BZ only clears if IBZ not hovered
  function handle_leave(is_ibz: boolean): void {
    if (is_ibz) ibz_hovered = false
    if (is_ibz || !ibz_hovered) hover_data = null
  }

  // K-path hover: report the nearer endpoint's q-point index of the hovered segment
  function handle_kpath_hover(event: ThreltePointerEvent, seg_idx: number): void {
    const { point } = event
    const [from, to] = [k_path_points[seg_idx], k_path_points[seg_idx + 1]]
    if (!from || !to) return
    const dist_sq = (pt: Vec3) =>
      (point.x - pt[0]) ** 2 + (point.y - pt[1]) ** 2 + (point.z - pt[2]) ** 2
    on_kpath_hover?.(dist_sq(from) <= dist_sq(to) ? seg_idx : seg_idx + 1)
  }
</script>

<SceneCamera
  {camera_projection}
  position={computed_camera_position}
  {fov}
  zoom={initial_zoom}
  orbit_props={orbit_controls_props}
  {gizmo}
/>

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.AmbientLight intensity={ambient_light} />

<T.Group position={rotation_target}>
  {#if bz_data}
    <!-- Brillouin zone surface mesh -->
    {#if bz_geometry}
      <T.Mesh
        geometry={bz_geometry}
        onpointermove={(event: ThreltePointerEvent) => handle_hover(event, false)}
        onpointerleave={() => handle_leave(false)}
      >
        <T.MeshStandardMaterial
          color={surface_color}
          transparent
          opacity={surface_opacity}
          side={2}
          depthWrite={false}
        />
      </T.Mesh>
    {/if}

    <!-- BZ edges -->
    {#each bz_data.edges as edge_segment, edge_idx (`bz-edge-${edge_idx}`)}
      {@const [from, to] = edge_segment}
      <Cylinder {from} {to} thickness={edge_width} color={edge_color} />
    {/each}

    <!-- Irreducible BZ surface mesh -->
    {#if show_ibz && ibz_geometry}
      <T.Mesh
        geometry={ibz_geometry}
        onpointermove={(event: ThreltePointerEvent) => handle_hover(event, true)}
        onpointerleave={() => handle_leave(true)}
      >
        <T.MeshStandardMaterial
          color={ibz_color}
          transparent
          opacity={ibz_opacity}
          side={2}
          depthWrite={false}
        />
      </T.Mesh>
    {/if}

    <!-- IBZ edges -->
    {#if show_ibz && ibz_data}
      {#each ibz_data.edges as edge_segment, edge_idx (`ibz-edge-${edge_idx}`)}
        {@const [from, to] = edge_segment}
        <Cylinder {from} {to} thickness={edge_width * 1.5} color={ibz_color} />
      {/each}
    {/if}

    <!-- Reciprocal lattice vectors -->
    {#if show_vectors && bz_data.k_lattice}
      <ReciprocalVectors k_lattice={bz_data.k_lattice} {vector_scale} size={bz_size} />
    {/if}

    <!-- K-path visualization -->
    {#if k_path_points && k_path_points.length > 1}
      {#each k_path_points.slice(0, -1) as from_point, idx (`${from_point}-${k_path_points[idx + 1]}#${idx}`)}
        {@const to_point = k_path_points[idx + 1]}
        {@const seg_len = Math.hypot(...math.subtract(to_point as Vec3, from_point as Vec3))}
        {@const is_hovered =
          hovered_qpoint_index !== null &&
          (idx === hovered_qpoint_index || idx === hovered_qpoint_index - 1)}
        {#if seg_len <= k_path_seg_cutoff}
          <Cylinder
            from={from_point as Vec3}
            to={to_point as Vec3}
            thickness={KPATH_THICKNESS}
            color={is_hovered ? `#ff6b35` : `#ffcc00`}
          />
          <!-- Invisible wider proxy: lets the cursor snap to the path within ~2× its radius -->
          <Cylinder
            from={from_point as Vec3}
            to={to_point as Vec3}
            thickness={KPATH_HOVER_THICKNESS}
            opacity={0}
            onpointermove={(event: ThreltePointerEvent) => handle_kpath_hover(event, idx)}
            onpointerleave={() => on_kpath_hover?.(null)}
          />
        {/if}
      {/each}
    {/if}

    <!-- Symmetry point spheres at labeled k-path points -->
    {#if k_path_labels}
      {#each k_path_labels as { position, label }, idx (`sphere-${idx}`)}
        {#if label}
          <T.Mesh position={[position[0], position[1], position[2]]}>
            <T.SphereGeometry args={[0.015, 16, 16]} />
            <T.MeshStandardMaterial color="#ffcc00" metalness={0.3} roughness={0.7} />
          </T.Mesh>
        {/if}
      {/each}
    {/if}

    <!-- Symmetry point labels on k-path -->
    {#if k_path_labels}
      {#each k_path_labels as { position, label }, idx (`${label}-${idx}`)}
        {#if label}
          <extras.HTML center position={position.map((coord) => coord * 1.1) as Vec3}>
            <span
              style="background: rgba(0, 0, 0, 0.3); padding: 0 3px; border-radius: 2px; color: white"
            >
              {label}
            </span>
          </extras.HTML>
        {/if}
      {/each}
    {/if}

    <!-- Hovered k-point highlight -->
    {#if hovered_k_point}
      <T.Mesh position={hovered_k_point}>
        <T.SphereGeometry args={[0.03, 16, 16]} />
        <T.MeshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={1.2} />
      </T.Mesh>
    {/if}
  {/if}
</T.Group>
