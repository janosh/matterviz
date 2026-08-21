<script lang="ts">
  import type { BrillouinZoneData } from '$lib/brillouin'
  import {
    bz_fit_extent,
    cartesian_to_fractional,
    default_camera_position,
    k_cell_fit_extent,
    k_lattice_inverse,
    k_space_size,
    polyhedron_centroid,
    PolyhedronMesh,
    ReciprocalVectors,
  } from '$lib/brillouin'
  import type { D3InterpolateName } from '$lib/colors'
  import type { Matrix4Tuple, Vec2, Vec3 } from '$lib/math'
  import {
    bind_renderer,
    build_orbit_props,
    create_orthographic_zoom,
    SceneCamera,
  } from '$lib/scene'
  import type { SceneControlProps, ThreltePointerEvent } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import { ortho_zoom_for_extent } from '$lib/structure/camera-fit'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import { SvelteMap } from 'svelte/reactivity'
  import {
    BackSide,
    BufferGeometry,
    ClippingGroup,
    DoubleSide,
    FrontSide,
    Matrix4,
    OrthographicCamera,
    Plane,
    Vector3,
  } from 'three/webgpu'
  import * as constants from './constants'
  import { build_isosurface_geometry, nearest_vertex_index } from './geometry'
  import { IDENTITY_4x4, lattice_point_group_matrices } from './symmetry'
  import type {
    ColorProperty,
    FermiHoverData,
    FermiSurfaceData,
    FermiIsosurface,
    RepresentationMode,
  } from './types'

  let {
    fermi_data = $bindable(),
    bz_data = $bindable(),
    camera_position = $bindable(),
    camera_projection = $bindable(DEFAULTS.fermi.camera_projection),
    // Fermi surface styling
    color_property = DEFAULTS.fermi.color_property,
    color_scale = DEFAULTS.fermi.color_scale,
    representation = DEFAULTS.fermi.representation,
    surface_opacity = $bindable(DEFAULTS.fermi.surface_opacity),
    selected_bands,
    // BZ styling
    show_bz = DEFAULTS.fermi.show_bz,
    bz_color = `#888888`,
    bz_opacity = DEFAULTS.fermi.bz_opacity,
    bz_edge_color = `#333333`,
    bz_edge_width = 0.002,
    show_vectors = DEFAULTS.fermi.show_vectors,
    tile_bz = DEFAULTS.fermi.tile_bz,
    // Clipping plane
    clip_enabled = DEFAULTS.fermi.clip_enabled,
    clip_axis = DEFAULTS.fermi.clip_axis,
    clip_position = DEFAULTS.fermi.clip_position,
    clip_flip = DEFAULTS.fermi.clip_flip,
    vector_scale = 1.0,
    // Camera controls
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
    gizmo = DEFAULTS.structure.gizmo,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    scene = $bindable(),
    camera = $bindable(),
    hover_data = $bindable<FermiHoverData | null>(null),
    width = 0,
    height = 0,
  }: SceneControlProps & {
    fermi_data?: FermiSurfaceData
    bz_data?: BrillouinZoneData
    camera_position?: Vec3 | undefined
    width?: number // viewport size, needed to turn the relative initial_zoom into a fit
    height?: number
    color_property?: ColorProperty
    color_scale?: D3InterpolateName
    representation?: RepresentationMode
    surface_opacity?: number
    selected_bands?: number[]
    show_bz?: boolean
    bz_color?: string
    bz_opacity?: number
    bz_edge_color?: string
    bz_edge_width?: number
    show_vectors?: boolean
    tile_bz?: boolean
    clip_enabled?: boolean
    clip_axis?: `x` | `y` | `z`
    clip_position?: number
    clip_flip?: boolean
    vector_scale?: number
    hover_data?: FermiHoverData | null
  } = $props()

  // Transparent surfaces depth-sort correctly because renderer.sortObjects defaults to true
  const threlte = bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  // Characteristic scene size, used for clipping and camera positioning
  const scene_size = $derived(k_space_size(fermi_data?.k_lattice))

  // Compute clipping plane based on axis and position
  // Plane equation: dot(normal, point) + constant >= 0 means point is visible
  const clip_plane = $derived.by(() => {
    if (!clip_enabled) return null

    const axis_idx = { x: 0, y: 1, z: 2 }[clip_axis]
    const normal_arr: Vec3 = [0, 0, 0]
    normal_arr[axis_idx] = clip_flip ? -1 : 1

    const scaled_position = clip_position * scene_size
    // constant = -position for normal case (keep points >= position)
    // constant = +position for flipped case (keep points <= position)
    const constant = clip_flip ? scaled_position : -scaled_position

    return new Plane(new Vector3(...normal_arr), constant)
  })

  // Apply the clipping plane to every object in the scene. WebGPURenderer has no global
  // clippingPlanes; clipping is encoded in the scene graph instead, so this group wraps the
  // scene contents and its planes cascade to all descendants.
  const clipping_group = new ClippingGroup()

  $effect(() => {
    clipping_group.clippingPlanes = clip_plane ? [clip_plane] : []
    clipping_group.enabled = Boolean(clip_plane)
    // Mutating a three object bypasses the <T> props Threlte watches, so under this scene's
    // on-demand render mode nothing would repaint until the next unrelated invalidation.
    threlte.invalidate()
  })

  extras.interactivity()

  // Filter surfaces based on selected bands
  let visible_surfaces = $derived(
    fermi_data?.isosurfaces.filter(
      (surface) => selected_bands === undefined || selected_bands.includes(surface.band_index),
    ) ?? [],
  )

  // Compute average vertex distance from origin for each surface (used for render ordering)
  // Smaller distance = inner surface = render first (lower renderOrder)
  // Larger distance = outer surface = render last (higher renderOrder)
  function compute_surface_radius(surface: FermiIsosurface): number {
    if (surface.vertices.length === 0) return 0
    let sum = 0
    for (const vertex of surface.vertices) {
      sum += Math.hypot(vertex[0], vertex[1], vertex[2])
    }
    return sum / surface.vertices.length
  }

  // Map from surface to its render order based on size (inner surfaces first)
  let surface_render_orders = $derived.by((): Map<FermiIsosurface, number> => {
    const by_radius = visible_surfaces
      .map((surface) => ({ surface, radius: compute_surface_radius(surface) }))
      .toSorted((surf_a, surf_b) => surf_a.radius - surf_b.radius)
    // Smaller radius (inner) = lower order = rendered first
    return new SvelteMap(by_radius.map(({ surface }, idx) => [surface, idx]))
  })

  // Per-vertex scalar colouring applies to velocity/custom properties; band/spin colouring is
  // a single material colour per surface
  const use_vertex_colors = $derived(
    color_property === `velocity` || color_property === `custom`,
  )

  // Compute property range for color scaling
  let property_range = $derived.by((): Vec2 => {
    if (!use_vertex_colors) return [0, 1]
    let [min_val, max_val] = [Infinity, -Infinity]
    for (const surface of visible_surfaces) {
      if (!surface.properties) continue
      for (const prop of surface.properties) {
        if (prop < min_val) min_val = prop
        if (prop > max_val) max_val = prop
      }
    }
    if (min_val === Infinity) return [0, 1]
    return [min_val, max_val]
  })

  // Flat colour for a surface (material colour, tooltip background)
  function get_surface_color(surface: FermiIsosurface): string {
    if (color_property === `spin` && surface.spin) {
      return surface.spin === `up` ? `#e41a1c` : `#377eb8`
    }
    return constants.BAND_COLORS[surface.band_index % constants.BAND_COLORS.length]
  }

  // Indexed geometries, one per visible surface (same order as visible_surfaces). Rebuilt when
  // the surfaces, the colour property or the colour scale change; the previous set is disposed
  // by the effect below. Custom BufferGeometries are the only three resources needing manual
  // disposal here — materials created via <T.Mesh*Material> in the template are Threlte-owned.
  let geometries = $derived.by((): (BufferGeometry | null)[] => {
    const color_spec = use_vertex_colors
      ? { colormap: color_scale, color_range: property_range }
      : undefined
    return visible_surfaces.map((surface) => build_isosurface_geometry(surface, color_spec))
  })

  $effect(() => {
    const current = geometries
    return () => {
      for (const geometry of current) geometry?.dispose()
    }
  })

  // Count total triangles and auto-disable tiling for very large surfaces
  let total_triangles = $derived(
    visible_surfaces.reduce((sum, surface) => sum + surface.faces.length, 0),
  )
  let effective_tile_bz = $derived(
    tile_bz && total_triangles < constants.MAX_TRIANGLES_FOR_TILING,
  )

  // Warn user when tiling is auto-disabled
  $effect(() => {
    if (tile_bz && !effective_tile_bz && total_triangles > 0) {
      console.warn(
        `Fermi surface has ${total_triangles} triangles, auto-disabled BZ tiling for performance`,
      )
    }
  })

  // BZ centroid as rotation center
  const rotation_target = $derived(polyhedron_centroid(bz_data?.vertices))

  const computed_camera_position = $derived(
    camera_position || default_camera_position(scene_size),
  )

  // initial_zoom is relative (50 = fit to the shorter viewport edge), so it has to go through
  // ortho_zoom_for_extent — handing it to the camera raw treats it as an absolute zoom and
  // renders the zone several times too small. Tiling replicates by point-group symmetry, which
  // maps the zone onto itself, so it does not widen the extent.
  const fit_extent = $derived(
    Math.max(
      bz_fit_extent(bz_data?.vertices, fermi_data?.k_lattice),
      // Marching cubes leaves surfaces in the centered parallelepiped and does not clip them to
      // the Wigner-Seitz zone (see compute.ts), so for a skew lattice framing only the zone
      // crops them.
      k_cell_fit_extent(fermi_data?.k_lattice),
    ),
  )
  const fit_zoom = $derived(
    width > 0 && height > 0
      ? ortho_zoom_for_extent(fit_extent, width, height, initial_zoom)
      : initial_zoom,
  )
  const ortho_zoom = create_orthographic_zoom({
    fit_zoom: () => fit_zoom,
    min_zoom: () => min_zoom,
    max_zoom: () => max_zoom,
    measured: () => width > 0 && height > 0,
  })

  const orbit_controls_props = $derived(
    build_orbit_props({
      camera_projection,
      target: rotation_target,
      rotate_speed,
      zoom_speed,
      zoom_to_cursor,
      pan_speed,
      max_zoom: ortho_zoom.max_zoom,
      min_zoom: ortho_zoom.min_zoom,
      auto_rotate,
      rotation_damping,
      // keep the user's zoom as the baseline the next resize rescales from
      onend_extra: () => {
        if (camera instanceof OrthographicCamera) ortho_zoom.zoom = camera.zoom
      },
    }),
  )

  // Get material props for two-pass transparent rendering
  // Pass 1 (back faces): renders interior/back of surfaces first
  // Pass 2 (front faces): renders exterior/front of surfaces on top
  // This avoids z-fighting while showing both sides correctly
  const get_material_props = (
    surface_color: string,
    has_vertex_colors: boolean,
    surface_idx: number,
    pass: `front` | `back`,
  ) => {
    const is_transparent = surface_opacity < 1
    const base = {
      transparent: is_transparent,
      opacity: surface_opacity,
      // Two-pass: back faces first (pass=back), front faces second (pass=front)
      // For opaque: just use DoubleSide
      side: is_transparent ? (pass === `back` ? BackSide : FrontSide) : DoubleSide,
      depthWrite: true,
      depthTest: true,
      // Polygon offset helps separate overlapping geometry
      polygonOffset: true,
      polygonOffsetFactor: 1 + surface_idx * 0.5,
      polygonOffsetUnits: 1 + surface_idx * 0.5,
    }

    if (has_vertex_colors) return { ...base, vertexColors: true }
    return { ...base, color: surface_color }
  }

  // Inverse of k_lattice for Cartesian->fractional conversion (cached)
  const k_lattice_inv = $derived(k_lattice_inverse(fermi_data?.k_lattice))

  // Point-group operations used to tile the stored wedge/cell over the full zone. Derived from
  // the lattice so hexagonal/tetragonal data is not replicated with spurious cubic copies.
  const symmetry_ops = $derived(
    effective_tile_bz && fermi_data
      ? lattice_point_group_matrices(fermi_data.k_lattice)
      : [IDENTITY_4x4],
  )

  // Throttle state for pointer move events to avoid O(n) vertex lookups causing jank
  let last_hover_time = 0

  // Build hover data from a pointer event on a (possibly symmetry-tiled) surface mesh,
  // skipping the O(n) nearest-vertex lookup when called too frequently
  function handle_pointer_move(
    event: ThreltePointerEvent,
    surface: FermiIsosurface,
    geometry: BufferGeometry,
    surface_color: string,
    sym_idx: number,
    sym_matrix: Matrix4Tuple,
  ): void {
    const now = performance.now()
    if (now - last_hover_time < constants.HOVER_THROTTLE_MS) return
    last_hover_time = now

    // event.point is in world space (after sym_matrix transformation)
    const position_cartesian: Vec3 = [event.point.x, event.point.y, event.point.z]
    const position_fractional = cartesian_to_fractional(k_lattice_inv, position_cartesian)

    // Nearest vertex for the property lookup is found in local space: the geometry's
    // positions are the raw surface vertices before sym_matrix
    const local_point = event.point
      .clone()
      .applyMatrix4(new Matrix4().fromArray(sym_matrix).invert())
    const nearest_idx = nearest_vertex_index(geometry, [
      local_point.x,
      local_point.y,
      local_point.z,
    ])
    const property_value = surface.properties?.[nearest_idx]
    const has_velocities = fermi_data?.metadata?.has_velocities

    const { clientX, clientY } = event.nativeEvent
    hover_data = {
      band_index: surface.band_index,
      spin: surface.spin,
      position_cartesian,
      position_fractional,
      screen_position: { x: clientX, y: clientY },
      surface_color,
      property_value,
      property_name:
        property_value != null ? (has_velocities ? `velocity` : `custom`) : undefined,
      is_tiled: effective_tile_bz,
      symmetry_index: sym_idx,
      n_symmetry_ops: symmetry_ops.length,
    }
  }

  const clear_hover = () => {
    hover_data = null
  }
</script>

<SceneCamera
  {camera_projection}
  position={computed_camera_position}
  {fov}
  zoom={ortho_zoom.zoom}
  orbit_props={orbit_controls_props}
  {gizmo}
/>

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.DirectionalLight position={[-3, -5, -10]} intensity={directional_light * 0.5} />
<T.AmbientLight intensity={ambient_light} />

<T is={clipping_group} position={rotation_target}>
  <!-- Brillouin zone overlay -->
  {#if show_bz && bz_data}
    <PolyhedronMesh
      polyhedron={bz_data}
      color={bz_color}
      opacity={bz_opacity}
      edge_color={bz_edge_color}
      edge_width={bz_edge_width}
    />
  {/if}

  <!-- Reciprocal lattice vectors -->
  {#if show_vectors && fermi_data?.k_lattice}
    <ReciprocalVectors k_lattice={fermi_data.k_lattice} {vector_scale} size={scene_size} />
  {/if}

  <!-- Fermi surfaces (with optional symmetry tiling) -->
  {#each visible_surfaces as surface, surface_idx (`surface-${surface.band_index}-${surface.spin}-${surface_idx}`)}
    {@const geometry = geometries[surface_idx]}
    {@const surface_color = get_surface_color(surface)}
    {@const renderOrder = surface_render_orders.get(surface) ?? surface_idx}

    <!-- A surface without per-vertex properties falls back to its flat colour even in
         velocity/custom mode, otherwise vertexColors would read a missing attribute -->
    {#if geometry}
      {@const has_vertex_colors = geometry.hasAttribute(`color`)}
      {#each symmetry_ops as sym_matrix, sym_idx (`sym-${sym_idx}`)}
        {#snippet mesh_pass(order: number, pass: `wireframe` | `front` | `back`)}
          <T.Mesh
            {geometry}
            matrix={sym_matrix}
            matrixAutoUpdate={false}
            renderOrder={order}
            onpointermove={(event: ThreltePointerEvent) =>
              handle_pointer_move(
                event,
                surface,
                geometry,
                surface_color,
                sym_idx,
                sym_matrix,
              )}
            onpointerleave={clear_hover}
          >
            {#if pass === `wireframe`}
              <T.MeshBasicMaterial
                color={surface_color}
                wireframe
                transparent={surface_opacity < 1}
                opacity={surface_opacity}
                depthWrite={true}
                depthTest={true}
              />
            {:else}
              <T.MeshStandardMaterial
                {...get_material_props(surface_color, has_vertex_colors, surface_idx, pass)}
                metalness={0.1}
                roughness={0.6}
                flatShading={false}
              />
            {/if}
          </T.Mesh>
        {/snippet}

        {#if representation === `wireframe`}
          {@render mesh_pass(renderOrder, `wireframe`)}
        {:else if surface_opacity < 1}
          <!-- Two-pass transparent rendering: back faces first, front faces on top -->
          {@render mesh_pass(renderOrder * 2, `back`)}
          {@render mesh_pass(renderOrder * 2 + 1, `front`)}
        {:else}
          {@render mesh_pass(renderOrder, `front`)}
        {/if}
      {/each}
    {/if}
  {/each}
</T>
