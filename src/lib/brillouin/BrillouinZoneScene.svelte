<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import {
    bind_renderer,
    create_scene_camera,
    HOVER_THROTTLE_MS,
    resolve_scene_controls,
    SceneCamera,
    SceneLights,
  } from '$lib/scene'
  import type { SceneControlProps, ThreltePointerEvent } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import { ortho_zoom_for_extent } from '$lib/structure/camera-fit'
  import Cylinder from '$lib/structure/Cylinder.svelte'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import {
    bz_fit_extent,
    cartesian_to_fractional,
    default_camera_position,
    k_lattice_inverse,
    k_space_size,
    polyhedron_centroid,
  } from './geometry'
  import PolyhedronMesh from './PolyhedronMesh.svelte'
  import ReciprocalVectors from './ReciprocalVectors.svelte'
  import type {
    BrillouinZoneData,
    BrillouinZoneSettings,
    BZHoverData,
    IrreducibleBZData,
  } from './types'

  let {
    bz_data,
    camera_projection = DEFAULTS.brillouin.camera_projection,
    surface_color = DEFAULTS.brillouin.surface_color,
    surface_opacity = DEFAULTS.brillouin.surface_opacity,
    edge_color = DEFAULTS.brillouin.edge_color,
    edge_width = DEFAULTS.brillouin.edge_width,
    show_vectors = DEFAULTS.brillouin.show_vectors,
    vector_scale = DEFAULTS.brillouin.vector_scale,
    show_ibz = DEFAULTS.brillouin.show_ibz,
    ibz_data = null,
    ibz_color = DEFAULTS.brillouin.ibz_color,
    ibz_opacity = DEFAULTS.brillouin.ibz_opacity,
    scene = $bindable(),
    camera = $bindable(),
    k_path_points = [],
    k_path_labels = [],
    hovered_k_point = null,
    highlighted_k_points = [],
    hovered_qpoint_index = null,
    hover_data = $bindable<BZHoverData | null>(null),
    on_kpath_hover,
    width = 0,
    height = 0,
    // camera/lighting/interaction props, resolved against the shared defaults below
    ...scene_controls
  }: SceneControlProps &
    Partial<Omit<BrillouinZoneSettings, `bz_order`>> & {
      bz_data?: BrillouinZoneData
      width?: number // viewport size, needed to turn the relative initial_zoom into a fit
      height?: number
      ibz_data?: IrreducibleBZData | null
      k_path_points?: Vec3[]
      k_path_labels?: { position: Vec3; label: string | null }[]
      hovered_k_point?: Vec3 | null
      // Persistently marked k-points (Cartesian), e.g. the symmetry point a popup was opened for
      highlighted_k_points?: Vec3[]
      hovered_qpoint_index?: number | null
      hover_data?: BZHoverData | null
      on_kpath_hover?: (qpoint_index: number | null) => void
    } = $props()

  const controls = $derived(resolve_scene_controls(scene_controls))

  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  const { enabled: hover_enabled } = extras.interactivity()

  // BZ centroid as rotation center; mean k-vector magnitude for camera positioning
  const rotation_target = $derived(polyhedron_centroid(bz_data?.vertices))
  const bz_size = $derived(k_space_size(bz_data?.k_lattice))
  const computed_camera_position = $derived(default_camera_position(bz_size))
  // Label chips are HTML drawn over the canvas and cover the sphere at their point, so a
  // highlighted point also tints its chip (tolerance scaled to the zone: positions come from
  // the same fold but may be recomputed by the caller)
  const is_highlighted = (position: Vec3) =>
    highlighted_k_points.some((point) => math.euclidean_dist(point, position) < 1e-6 * bz_size)

  // initial_zoom is relative (50 = fit to the shorter viewport edge), so it has to go through
  // ortho_zoom_for_extent — handing it to the camera raw treats it as an absolute zoom and
  // renders the zone several times too small.
  const measured = $derived(width > 0 && height > 0)
  const scene_camera = create_scene_camera({
    controls: () => ({ ...controls, camera_projection }),
    target: () => rotation_target,
    fit_zoom: () =>
      measured
        ? ortho_zoom_for_extent(
            bz_fit_extent(bz_data?.vertices, bz_data?.k_lattice),
            width,
            height,
            controls.initial_zoom,
          )
        : controls.initial_zoom,
    measured: () => measured,
    camera: () => camera,
    // No hover while orbiting: a drag would raycast the zone, wedge and every k-path proxy on
    // each pointermove, and the tooltip popping in and out under the cursor reads as flicker
    set_camera_is_moving: (moving) => {
      hover_enabled.set(!moving)
      if (!moving) return
      ibz_hovered = false
      hover_data = null
      on_kpath_hover?.(null)
    },
  })

  // K-path styling. The invisible hover proxy is twice the visible thickness so the cursor
  // snaps to the path even when it isn't directly over the thin visible segment.
  const KPATH_THICKNESS = 0.012
  const KPATH_HOVER_THICKNESS = KPATH_THICKNESS * 2

  // Threshold for skipping k-path segments that bridge a path discontinuity (e.g. `U|K`).
  // Band paths are densely sampled, so legit segments are tiny; a discontinuity jumps by
  // a fraction of the zone. Skip segments far longer than the median sampling step.
  const k_path_seg_cutoff = $derived.by(() => {
    if (k_path_points.length < 3) return Infinity
    const lens = k_path_points
      .slice(1)
      .map((pt, idx) => Math.hypot(...math.subtract(pt, k_path_points[idx])))
      .toSorted((len_a, len_b) => len_a - len_b)
    return lens[Math.floor(lens.length / 2)] * 10
  })

  // Inverse of k_lattice for Cartesian->fractional conversion
  const k_lattice_inv = $derived(k_lattice_inverse(bz_data?.k_lattice))

  // Throttle state for pointer move events
  let last_hover_time = 0
  let last_hover_mesh: `bz` | `ibz` | null = null

  // Track IBZ hover state - IBZ takes priority over BZ
  let ibz_hovered = false
  $effect(() => {
    if (!show_ibz) {
      ibz_hovered = false
      // Clear hover tooltip if it was showing IBZ data
      if (hover_data?.is_ibz) hover_data = null
    }
  })

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
  fov={controls.fov}
  zoom={scene_camera.zoom}
  orbit_props={scene_camera.orbit_props}
  gizmo={controls.gizmo}
/>

<SceneLights ambient={controls.ambient_light} directional={controls.directional_light} />

<T.Group position={rotation_target}>
  {#if bz_data}
    <PolyhedronMesh
      polyhedron={bz_data}
      color={surface_color}
      opacity={surface_opacity}
      {edge_color}
      {edge_width}
      onpointermove={(event) => handle_hover(event, false)}
      onpointerleave={() => handle_leave(false)}
    />

    <!-- Irreducible BZ wedge, outlined in its own colour -->
    {#if show_ibz && ibz_data}
      <PolyhedronMesh
        polyhedron={ibz_data}
        color={ibz_color}
        opacity={ibz_opacity}
        edge_width={edge_width * 1.5}
        onpointermove={(event) => handle_hover(event, true)}
        onpointerleave={() => handle_leave(true)}
      />
    {/if}

    <!-- Reciprocal lattice vectors -->
    {#if show_vectors && bz_data.k_lattice}
      <ReciprocalVectors k_lattice={bz_data.k_lattice} {vector_scale} size={bz_size} />
    {/if}

    <!-- K-path visualization -->
    {#if k_path_points.length > 1}
      {#each k_path_points.slice(0, -1) as from_point, idx (`${from_point}-${k_path_points[idx + 1]}#${idx}`)}
        {@const to_point = k_path_points[idx + 1]}
        {@const seg_len = Math.hypot(...math.subtract(to_point, from_point))}
        {@const is_hovered =
          hovered_qpoint_index !== null &&
          (idx === hovered_qpoint_index || idx === hovered_qpoint_index - 1)}
        {#if seg_len <= k_path_seg_cutoff}
          <Cylinder
            from={from_point}
            to={to_point}
            thickness={KPATH_THICKNESS}
            color={is_hovered ? `#ff6b35` : `#ffcc00`}
          />
          <!-- Invisible wider proxy: lets the cursor snap to the path within ~2× its radius -->
          <Cylinder
            from={from_point}
            to={to_point}
            thickness={KPATH_HOVER_THICKNESS}
            opacity={0}
            onpointermove={(event: ThreltePointerEvent) => handle_kpath_hover(event, idx)}
            onpointerleave={() => on_kpath_hover?.(null)}
          />
        {/if}
      {/each}
    {/if}

    <!-- Symmetry point spheres + labels at labeled k-path points -->
    {#each k_path_labels as { position, label }, idx (`${label}-${idx}`)}
      {#if label}
        {@const highlighted = is_highlighted(position)}
        <T.Mesh position={[position[0], position[1], position[2]]}>
          <T.SphereGeometry args={[0.015, 16, 16]} />
          <T.MeshStandardMaterial color="#ffcc00" metalness={0.3} roughness={0.7} />
        </T.Mesh>
        <extras.HTML center position={position.map((coord) => coord * 1.1) as Vec3}>
          <span
            style:background={highlighted ? `#ff2020` : `rgba(0, 0, 0, 0.3)`}
            style:font-weight={highlighted ? `bold` : null}
            style="padding: 0 3px; border-radius: 2px; color: white"
          >
            {label}
          </span>
        </extras.HTML>
      {/if}
    {/each}

    <!-- Hovered k-point highlight -->
    {#if hovered_k_point}
      <T.Mesh position={hovered_k_point}>
        <T.SphereGeometry args={[0.03, 16, 16]} />
        <T.MeshStandardMaterial color="#ff0000" emissive="#ff0000" emissiveIntensity={1.2} />
      </T.Mesh>
    {/if}

    <!-- Pinned k-points: sized with the zone and drawn over its faces, edges and labels so they
    stay legible at popup scale (symmetry points sit on the zone surface, half inside it) -->
    {#each highlighted_k_points as k_point}
      <T.Mesh position={k_point} renderOrder={999}>
        <T.SphereGeometry args={[bz_size * 0.045, 24, 24]} />
        <T.MeshStandardMaterial
          color="#ff2020"
          emissive="#ff2020"
          emissiveIntensity={1.5}
          transparent
          depthTest={false}
        />
      </T.Mesh>
    {/each}
  {/if}
</T.Group>
