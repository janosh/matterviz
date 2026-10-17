<script lang="ts">
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { Point2D, Vec2, Vec3 } from '#lib/math.js'
  import {
    bind_renderer,
    create_scene_camera,
    resolve_scene_controls,
    scene_interactivity,
    SceneCamera,
    SceneLights,
  } from '#lib/scene/index.js'
  import type { SceneControlProps, ThreltePointerEvent } from '#lib/scene/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { ortho_zoom_for_extent } from '#lib/structure/camera-fit.js'
  import { T } from '@threlte/core'
  import {
    bz_fit_extent,
    bz_hover_data,
    default_camera_position,
    k_lattice_inverse,
    bz_mark_sizes,
    k_space_size,
    polyhedron_centroid,
  } from './geometry'
  import KPath from './KPath.svelte'
  import PolyhedronMesh from './PolyhedronMesh.svelte'
  import ReciprocalVectors from './ReciprocalVectors.svelte'
  import type {
    BrillouinZoneData,
    BrillouinZoneSettings,
    BZHoverData,
    IrreducibleBZData,
    KPathData,
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
    k_path = { points: [], labels: [], branches: [] },
    hovered_k_point = null,
    highlighted_k_points = [],
    hovered_qpoint_index = null,
    highlighted_qpoint_range = null,
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
      k_path?: KPathData
      hovered_k_point?: Vec3 | null
      // Persistently marked k-points (Cartesian), e.g. the symmetry point a popup was opened for
      highlighted_k_points?: Vec3[]
      hovered_qpoint_index?: number | null
      highlighted_qpoint_range?: Vec2 | null
      hover_data?: BZHoverData | null
      on_kpath_hover?: (qpoint_index: number | null, screen_position?: Point2D) => void
    } = $props()

  const controls = $derived(resolve_scene_controls(scene_controls))

  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  // One target per pointer event: the k-path wins over the IBZ wedge inside the zone, which
  // wins over the zone (their pick_rank), else the front-most
  const { set_hover_enabled, touch_hover } = scene_interactivity()

  // BZ centroid as rotation center; mean k-vector magnitude for camera positioning
  const rotation_target = $derived(polyhedron_centroid(bz_data?.vertices))
  const bz_size = $derived(k_space_size(bz_data?.k_lattice))
  const mark_sizes = $derived(bz_mark_sizes(bz_size, edge_width))
  const computed_camera_position = $derived(default_camera_position(bz_size))
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
      set_hover_enabled(!moving)
      if (!moving) return
      clear_hover()
      on_kpath_hover?.(null)
    },
  })

  // Inverse of k_lattice for Cartesian->fractional conversion
  const k_lattice_inv = $derived(k_lattice_inverse(bz_data?.k_lattice))

  // The hovered triangle of the zone and of the IBZ wedge, whose polygon face lights up
  const hovered_face = $state<Record<`zone` | `ibz`, number | null>>({ zone: null, ibz: null })
  const clear_hover = () => {
    hover_data = null
    hovered_face.zone = null
    hovered_face.ibz = null
  }

  // Threlte drops an unmounted mesh without a pointerleave
  $effect(() => {
    if (!show_ibz && hover_data?.is_ibz) clear_hover()
  })

  const hover_at = (position_cartesian: Vec3, screen_position: Point2D, is_ibz = false) => {
    if (!bz_data) return
    const ibz_volume = ibz_data?.volume ?? null
    hover_data = bz_hover_data(bz_data, k_lattice_inv, position_cartesian, screen_position, {
      is_ibz,
      ibz_volume,
    })
  }
  const handle_hover = (
    { point, nativeEvent, faceIndex }: ThreltePointerEvent,
    is_ibz: boolean,
  ) => {
    hovered_face[is_ibz ? `ibz` : `zone`] = faceIndex ?? null
    hover_at(
      [point.x, point.y, point.z],
      { x: nativeEvent.clientX, y: nativeEvent.clientY },
      is_ibz,
    )
  }
  // a hovered k-path point gets the zone tooltip at its k-point
  const handle_kpath_hover = (qpoint_idx: number | null, screen_position?: Point2D) => {
    const position = k_path.points[qpoint_idx ?? -1]
    if (position && screen_position) hover_at(position, screen_position)
    else hover_data = null
    on_kpath_hover?.(qpoint_idx, screen_position)
  }
</script>

<SceneCamera
  {camera_projection}
  position={computed_camera_position}
  fov={controls.fov}
  zoom={scene_camera.zoom}
  reset_zoom={scene_camera.reset_to_fit}
  orbit_props={scene_camera.orbit_props}
  gizmo={controls.gizmo}
/>

<SceneLights ambient={controls.ambient_light} directional={controls.directional_light} />

<T.Group>
  {#if bz_data}
    <PolyhedronMesh
      polyhedron={bz_data}
      color={surface_color}
      opacity={surface_opacity}
      {edge_color}
      edge_width={mark_sizes.edge}
      hovered_face={hovered_face.zone}
      {...touch_hover({
        onpointermove: (event: ThreltePointerEvent) => handle_hover(event, false),
        onpointerleave: clear_hover,
      })}
    />

    <!-- Irreducible BZ wedge, outlined in its own colour -->
    {#if show_ibz && ibz_data}
      <PolyhedronMesh
        polyhedron={ibz_data}
        color={ibz_color}
        opacity={ibz_opacity}
        edge_width={mark_sizes.edge * 1.5}
        hovered_face={hovered_face.ibz}
        {...touch_hover({
          onpointermove: (event: ThreltePointerEvent) => handle_hover(event, true),
          onpointerleave: clear_hover,
        })}
        pick_rank={1}
      />
    {/if}

    <!-- Reciprocal lattice vectors -->
    {#if show_vectors && bz_data.k_lattice}
      <ReciprocalVectors k_lattice={bz_data.k_lattice} {vector_scale} size={bz_size} />
    {/if}

    <KPath
      path={k_path}
      {hovered_k_point}
      {highlighted_k_points}
      {hovered_qpoint_index}
      {highlighted_qpoint_range}
      on_kpath_hover={handle_kpath_hover}
      {touch_hover}
      size={bz_size}
      {edge_width}
    />

    <!-- Pinned k-points: sized with the zone and drawn over its faces, edges and labels so they
    stay legible at popup scale (symmetry points sit on the zone surface, half inside it) -->
    {#each highlighted_k_points as k_point}
      <T.Mesh position={k_point} renderOrder={999}>
        <T.SphereGeometry args={[bz_size * 0.045, 24, 24]} />
        <T.MeshStandardMaterial
          color={HIGHLIGHT.pin}
          emissive={HIGHLIGHT.pin}
          emissiveIntensity={1.5}
          transparent
          depthTest={false}
        />
      </T.Mesh>
    {/each}
  {/if}
</T.Group>
