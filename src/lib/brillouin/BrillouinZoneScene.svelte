<script lang="ts">
  import { HIGHLIGHT } from '#lib/colors/index.js'
  import type { Point2D, Vec2, Vec3 } from '#lib/math.js'
  import {
    bind_renderer,
    create_scene_camera,
    resolve_scene_controls,
    scene_interactivity,
    scene_key_walk,
    scene_pointer,
    SceneCamera,
    SceneLights,
  } from '#lib/scene/index.js'
  import type { SceneControlProps, TapEvent, ThreltePointerEvent } from '#lib/scene/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { mark_pin, type TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import { ortho_zoom_for_extent } from '#lib/structure/camera-fit.js'
  import { T } from '@threlte/core'
  import {
    bz_fit_extent,
    bz_hover_data,
    default_camera_position,
    face_anchors,
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
    BZHover,
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
    hovered = $bindable<BZHover | null>(null),
    pin = mark_pin<BZHover>(),
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
      hovered?: BZHover | null // the mark under the pointer
      pin?: TooltipPin<BZHover> // the host's, whose tooltip a click pins (else the scene's own)
      on_kpath_hover?: (qpoint_index: number | null, screen_position?: Point2D) => void
    } = $props()

  const controls = $derived(resolve_scene_controls(scene_controls))

  bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  // One target per pointer event: the k-path wins over the IBZ wedge inside the zone, which
  // wins over the zone (their pick_rank), else the front-most. A click on a mark pins its
  // tooltip, one on empty space unpins.
  const { set_hover_enabled, touch_hover } = scene_interactivity({
    on_click: () => pin.toggle(hovered),
    on_empty_click: () => pin.unpin(),
  })

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
      hovered = null
      on_kpath_hover?.(null)
    },
  })

  // Inverse of k_lattice for Cartesian->fractional conversion
  const k_lattice_inv = $derived(k_lattice_inverse(bz_data?.k_lattice))

  // The pinned mark, else the hovered one, keeps its face lit (see TooltipPin)
  const shown = $derived(pin.shown(hovered))
  const lit_face = (is_ibz: boolean) =>
    shown?.data.is_ibz === is_ibz ? (shown.face ?? null) : null

  // Threlte drops an unmounted mesh without a pointerleave
  $effect(() => {
    if (show_ibz) return
    if (hovered?.data.is_ibz) hovered = null
    if (pin.value?.data.is_ibz) pin.unpin()
  })

  const hover_at = (
    position_cartesian: Vec3,
    screen_position: Point2D,
    mark: string,
    { is_ibz = false, face }: { is_ibz?: boolean; face?: number } = {},
  ): BZHover | null => {
    if (!bz_data) return null
    const ibz_volume = ibz_data?.volume ?? null
    const data = bz_hover_data(bz_data, k_lattice_inv, position_cartesian, screen_position, {
      is_ibz,
      ibz_volume,
    })
    return { mark, data, face }
  }
  // The viewer root walks the zone's faces, then the IBZ wedge's, hovering each at its centroid
  const pointer_at = scene_pointer()
  const key_faces = $derived(
    [
      { polyhedron: bz_data, is_ibz: false },
      { polyhedron: show_ibz ? ibz_data : null, is_ibz: true },
    ].flatMap(({ polyhedron, is_ibz }) => {
      const anchors = polyhedron ? face_anchors(polyhedron) : []
      return anchors.map((anchor, face_idx) => ({
        ...anchor,
        is_ibz,
        face_idx,
        n_faces: anchors.length,
      }))
    }),
  )
  // A face's mark names its polygon, whichever of its triangles was hit
  const face_marks = $derived(
    new Map(
      key_faces.flatMap(({ is_ibz, face_idx, triangles }) =>
        triangles.map((triangle) => [`${is_ibz}:${triangle}`, `${is_ibz} face ${face_idx}`]),
      ),
    ),
  )
  const face_mark = (is_ibz: boolean, { faceIndex }: Pick<TapEvent, `faceIndex`>) =>
    face_marks.get(`${is_ibz}:${faceIndex}`) ?? `${is_ibz} face`
  const face_hover = (event: ThreltePointerEvent, is_ibz: boolean) => {
    const { point, nativeEvent, faceIndex } = event
    const screen_position = { x: nativeEvent.clientX, y: nativeEvent.clientY }
    return hover_at([point.x, point.y, point.z], screen_position, face_mark(is_ibz, event), {
      is_ibz,
      face: faceIndex ?? undefined,
    })
  }
  const walk_hover = ({ centroid, triangle, is_ibz }: (typeof key_faces)[number]) =>
    face_hover(pointer_at(centroid, { faceIndex: triangle }), is_ibz)
  scene_key_walk({
    targets: () => key_faces,
    hover: (face) => (hovered = walk_hover(face)),
    leave: () => (hovered = null),
    click: (face) => pin.toggle(walk_hover(face)),
    label: ({ is_ibz, face_idx, n_faces }) =>
      `${is_ibz ? `Irreducible zone` : `Brillouin zone`} face ${face_idx + 1} of ${n_faces}`,
  })
  // a hovered k-path point gets the zone tooltip at its k-point
  const handle_kpath_hover = (qpoint_idx: number | null, screen_position?: Point2D) => {
    const position = k_path.points[qpoint_idx ?? -1]
    hovered =
      position && screen_position
        ? hover_at(position, screen_position, `k-path ${qpoint_idx}`)
        : null
    on_kpath_hover?.(qpoint_idx, screen_position)
  }
  // a tap holds a face, not the whole polyhedron mesh, so a tap on another face moves the pin
  const face_events = (is_ibz: boolean) =>
    touch_hover(
      {
        onpointermove: (event: ThreltePointerEvent) => (hovered = face_hover(event, is_ibz)),
        onpointerleave: () => (hovered = null),
      },
      (event) => face_mark(is_ibz, event),
    )
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
      hovered_face={lit_face(false)}
      {...face_events(false)}
    />

    <!-- Irreducible BZ wedge, outlined in its own colour -->
    {#if show_ibz && ibz_data}
      <PolyhedronMesh
        polyhedron={ibz_data}
        color={ibz_color}
        opacity={ibz_opacity}
        edge_width={mark_sizes.edge * 1.5}
        hovered_face={lit_face(true)}
        {...face_events(true)}
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
