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
  import type { Vec2, Vec3 } from '$lib/math'
  import {
    bind_renderer,
    create_scene_camera,
    resolve_scene_controls,
    SceneCamera,
    SceneLights,
  } from '$lib/scene'
  import type { SceneControlProps, ThreltePointerEvent } from '$lib/scene'
  import { DEFAULTS } from '$lib/settings'
  import { ortho_zoom_for_extent } from '$lib/structure/camera-fit'
  import { T } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import {
    BackSide,
    BufferGeometry,
    ClippingGroup,
    DoubleSide,
    FrontSide,
    Matrix4,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Plane,
    Vector3,
  } from 'three/webgpu'
  import { BAND_COLORS, SPIN_COLORS } from './constants'
  import {
    apply_vertex_colors,
    build_isosurface_geometry,
    has_vertex_properties,
    nearest_face_vertex,
  } from './geometry'
  import { IDENTITY_4x4, lattice_point_group_matrices } from './symmetry'
  import type {
    FermiHoverData,
    FermiIsosurface,
    FermiSurfaceData,
    FermiSurfaceSettings,
  } from './types'

  let {
    fermi_data,
    bz_data,
    camera_projection = DEFAULTS.fermi.camera_projection,
    // Fermi surface styling
    color_property = DEFAULTS.fermi.color_property,
    color_scale = DEFAULTS.fermi.color_scale,
    // Name of the per-vertex property shown in the hover tooltip
    property_label = `Property`,
    representation = DEFAULTS.fermi.representation,
    surface_opacity = DEFAULTS.fermi.surface_opacity,
    selected_bands,
    // BZ styling
    show_bz = DEFAULTS.fermi.show_bz,
    bz_opacity = DEFAULTS.fermi.bz_opacity,
    show_vectors = DEFAULTS.fermi.show_vectors,
    tile_bz = DEFAULTS.fermi.tile_bz,
    // Clipping plane
    clip_enabled = DEFAULTS.fermi.clip_enabled,
    clip_axis = DEFAULTS.fermi.clip_axis,
    clip_position = DEFAULTS.fermi.clip_position,
    clip_flip = DEFAULTS.fermi.clip_flip,
    scene = $bindable(),
    camera = $bindable(),
    hover_data = $bindable<FermiHoverData | null>(null),
    width = 0,
    height = 0,
    // camera/lighting/interaction props, resolved against the shared defaults below
    ...scene_controls
  }: SceneControlProps &
    Partial<Omit<FermiSurfaceSettings, `mu` | `interpolation_factor`>> & {
      fermi_data?: FermiSurfaceData
      bz_data?: BrillouinZoneData
      width?: number // viewport size, needed to turn the relative initial_zoom into a fit
      height?: number
      property_label?: string
      selected_bands?: number[]
      hover_data?: FermiHoverData | null
    } = $props()

  const controls = $derived(resolve_scene_controls(scene_controls))

  // Transparent surfaces depth-sort correctly because renderer.sortObjects defaults to true
  const threlte = bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  // Characteristic scene size, used for clipping and camera positioning
  const scene_size = $derived(k_space_size(fermi_data?.k_lattice))

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

  const { enabled: hover_enabled } = extras.interactivity()

  let visible_surfaces = $derived(
    fermi_data?.isosurfaces.filter(
      (surface) => selected_bands === undefined || selected_bands.includes(surface.band_index),
    ) ?? [],
  )

  // Mean vertex distance from origin: inner sheets (small radius) render first so outer
  // transparent shells blend over them
  function compute_surface_radius(surface: FermiIsosurface): number {
    const { positions } = surface
    if (positions.length === 0) return 0
    let sum = 0
    for (let idx = 0; idx < positions.length; idx += 3) {
      sum += Math.hypot(positions[idx], positions[idx + 1], positions[idx + 2])
    }
    return sum / (positions.length / 3)
  }

  // Render order per surface (inner = lower = first). Plain Map: rebuilt wholesale by the
  // derived, never mutated, so nothing reads it reactively.
  let surface_render_orders = $derived(
    new Map(
      visible_surfaces
        .map((surface) => ({ surface, radius: compute_surface_radius(surface) }))
        .toSorted((surf_a, surf_b) => surf_a.radius - surf_b.radius)
        .map(({ surface }, idx) => [surface, idx]),
    ),
  )

  // `property` maps the per-vertex scalars through the colour scale; band/spin colouring is a
  // single material colour per surface
  const use_vertex_colors = $derived(color_property === `property`)

  // Property range for color scaling across all visible surfaces
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
    if (color_property === `spin` && surface.spin) return SPIN_COLORS[surface.spin]
    return BAND_COLORS[surface.band_index % BAND_COLORS.length]
  }

  // One BufferGeometry per visible surface object, built once and kept for as long as the
  // surface stays visible: the positions/normals/index buffers are shared with the surface, so
  // a colour-mode or colour-scale change only rewrites the colour attribute (see the effect
  // below) instead of re-uploading the mesh. A surface that leaves the scene (deselected band,
  // new fermi_data) has its geometry disposed and evicted, so a later reappearance uploads a
  // fresh one rather than reviving a disposed object. Plain Map: the cache is bookkeeping,
  // not state the template reads.
  const geometry_cache = new Map<FermiIsosurface, BufferGeometry | null>()
  let geometries = $derived(
    visible_surfaces.map((surface) => {
      let geometry = geometry_cache.get(surface)
      if (geometry === undefined) {
        geometry = build_isosurface_geometry(surface)
        geometry_cache.set(surface, geometry)
      }
      return geometry
    }),
  )
  $effect(() => {
    const visible = new Set(visible_surfaces)
    for (const [surface, geometry] of geometry_cache) {
      if (visible.has(surface)) continue
      geometry?.dispose()
      geometry_cache.delete(surface)
    }
  })
  $effect(() => () => {
    for (const geometry of geometry_cache.values()) geometry?.dispose()
    geometry_cache.clear()
  })

  // Vertex-colour attributes follow the colour property/scale/range; mutating the geometry
  // bypasses the <T> props Threlte watches, so the on-demand renderer is told to repaint
  $effect(() => {
    const spec = use_vertex_colors
      ? { colormap: color_scale, color_range: property_range }
      : null
    for (const [idx, geometry] of geometries.entries()) {
      if (geometry) apply_vertex_colors(geometry, visible_surfaces[idx], spec)
    }
    threlte.invalidate()
  })

  // Tiling draws up to 48 copies (cubic), so it is auto-disabled above this triangle count
  const MAX_TRIANGLES_FOR_TILING = 50_000
  let total_triangles = $derived(
    visible_surfaces.reduce((sum, surface) => sum + surface.indices.length / 3, 0),
  )
  let effective_tile_bz = $derived(tile_bz && total_triangles < MAX_TRIANGLES_FOR_TILING)

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

  const computed_camera_position = $derived(default_camera_position(scene_size))

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
  const measured = $derived(width > 0 && height > 0)
  const scene_camera = create_scene_camera({
    controls: () => ({ ...controls, camera_projection }),
    target: () => rotation_target,
    fit_zoom: () =>
      measured
        ? ortho_zoom_for_extent(fit_extent, width, height, controls.initial_zoom)
        : controls.initial_zoom,
    measured: () => measured,
    camera: () => camera,
    // No hover while orbiting/zooming (OrbitControls fires start/end around wheel zooms too):
    // a drag would raycast up to 96 tiled meshes per pointermove, and the tooltip popping in
    // and out as the sheets sweep under the cursor reads as the surface flickering
    set_camera_is_moving: (moving) => {
      hover_enabled.set(!moving)
      if (moving) hover_data = null
    },
  })

  // Render passes per surface: transparent surfaces draw back faces first and front faces on
  // top (two passes), opaque and wireframe surfaces draw both sides in one. Only the
  // transparency flag feeds the material set: the opacity value itself is written in place
  // below, so an opacity-slider tick does not rebuild (and recompile) every material.
  type MaterialPass = `wireframe` | `front` | `back`
  const is_transparent = $derived(surface_opacity < 1)
  const material_passes = $derived<MaterialPass[]>(
    representation === `wireframe`
      ? [`wireframe`]
      : is_transparent
        ? [`back`, `front`]
        : [`front`],
  )
  // Translucent sheets keep writing depth, which layers inner and outer bands but makes
  // (nearly) coincident sheets — up and down channels of a non-magnetic calculation exported as
  // two spin surfaces — z-fight, so each surface gets its own depth bias. WebGPU truncates the
  // bias to an integer, hence whole-number steps wide enough to cover the numeric mismatch. The
  // slope term stays shared: a per-surface slope would reorder distinct sheets at grazing angles
  const SURFACE_DEPTH_BIAS_STEP = 8
  const make_material = (
    surface: FermiIsosurface,
    surface_idx: number,
    pass: MaterialPass,
  ) => {
    const material =
      pass === `wireframe`
        ? new MeshBasicMaterial({ wireframe: true })
        : new MeshStandardMaterial({
            metalness: 0.1,
            roughness: 0.6,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: SURFACE_DEPTH_BIAS_STEP * (surface_idx + 1),
            // three's WebGPU backend (r174–r185, mrdoob/three.js#34405) omits the polygon
            // offset from its pipeline cache key, so materials differing only in bias would share
            // one pipeline. The stencil mask is in the key and inert with the stencil buffer off
            // (three's default), so a distinct mask forces one pipeline per surface. Drop once fixed
            stencilFuncMask: surface_idx + 1,
          })
    // A surface without per-vertex properties keeps its flat colour even in property mode,
    // otherwise vertexColors would read a missing attribute
    material.vertexColors = use_vertex_colors && has_vertex_properties(surface)
    if (!material.vertexColors) material.color.set(get_surface_color(surface))
    material.transparent = is_transparent
    material.side =
      pass === `back` ? BackSide : pass === `front` && is_transparent ? FrontSide : DoubleSide
    return material
  }
  // One material per (surface, pass), shared by every symmetry copy so a tiled cubic surface
  // needs 2 materials rather than 96 — hence built here instead of via <T.Mesh*Material>, which
  // would instantiate one per <T.Mesh>. Rebuilt whenever colouring, transparency or
  // representation change (a handful of objects; three reuses the compiled pipeline for
  // identical parameters) and the previous set is disposed by the effect below. A surface whose
  // geometry failed to build never renders, so it gets no materials.
  const materials = $derived(
    visible_surfaces.map((surface, surface_idx) =>
      geometries[surface_idx]
        ? material_passes.map((pass) => make_material(surface, surface_idx, pass))
        : null,
    ),
  )
  const live_materials = $derived(materials.flatMap((passes) => passes ?? []))
  $effect(() => {
    const current = live_materials
    return () => {
      for (const material of current) material.dispose()
    }
  })
  // Opacity is a per-frame uniform, so write it in place and repaint rather than rebuild
  $effect(() => {
    for (const material of live_materials) material.opacity = surface_opacity
    threlte.invalidate()
  })

  // Inverse of k_lattice for Cartesian->fractional conversion (cached)
  const k_lattice_inv = $derived(k_lattice_inverse(fermi_data?.k_lattice))

  // Point-group operations used to tile the stored wedge/cell over the full zone. Derived from
  // the lattice so hexagonal/tetragonal data is not replicated with spurious cubic copies.
  const symmetry_ops = $derived(
    effective_tile_bz && fermi_data
      ? lattice_point_group_matrices(fermi_data.k_lattice)
      : [IDENTITY_4x4],
  )
  // Inverses map a hovered world point back into the untiled geometry's local space; built
  // once per tiling change rather than per pointer event
  const inverse_symmetry_ops = $derived(
    symmetry_ops.map((sym_matrix) => new Matrix4().fromArray(sym_matrix).invert()),
  )

  // Build hover data from a pointer event on a (possibly symmetry-tiled) surface mesh. The
  // per-vertex property comes from the hit triangle's nearest corner, so no throttle is needed
  function handle_pointer_move(
    event: ThreltePointerEvent,
    surface: FermiIsosurface,
    geometry: BufferGeometry,
    surface_color: string,
    sym_idx: number,
  ): void {
    // event.point is in world space (after sym_matrix transformation)
    const position_cartesian: Vec3 = [event.point.x, event.point.y, event.point.z]
    const position_fractional = cartesian_to_fractional(k_lattice_inv, position_cartesian)

    // The corner lookup happens in local space: the geometry's positions are the raw surface
    // vertices before sym_matrix
    let property_value: number | undefined
    if (surface.properties && event.face) {
      const local_point = event.point.clone().applyMatrix4(inverse_symmetry_ops[sym_idx])
      property_value =
        surface.properties[nearest_face_vertex(geometry, event.face, local_point)]
    }

    const { clientX, clientY } = event.nativeEvent
    hover_data = {
      band_index: surface.band_index,
      spin: surface.spin,
      position_cartesian,
      position_fractional,
      screen_position: { x: clientX, y: clientY },
      surface_color,
      property_value,
      property_name: property_value === undefined ? undefined : property_label,
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
  fov={controls.fov}
  zoom={scene_camera.zoom}
  orbit_props={scene_camera.orbit_props}
  gizmo={controls.gizmo}
/>

<SceneLights
  ambient={controls.ambient_light}
  directional={controls.directional_light}
  fill={0.5}
/>

<T is={clipping_group} position={rotation_target}>
  <!-- Brillouin zone overlay -->
  {#if show_bz && bz_data}
    <PolyhedronMesh
      polyhedron={bz_data}
      color="#888888"
      opacity={bz_opacity}
      edge_color="#333333"
      edge_width={0.002}
    />
  {/if}

  <!-- Reciprocal lattice vectors -->
  {#if show_vectors && fermi_data?.k_lattice}
    <ReciprocalVectors k_lattice={fermi_data.k_lattice} size={scene_size} />
  {/if}

  <!-- Fermi surfaces (with optional symmetry tiling) -->
  {#each visible_surfaces as surface, surface_idx (`surface-${surface.band_index}-${surface.spin}-${surface_idx}`)}
    {@const geometry = geometries[surface_idx]}
    {@const surface_color = get_surface_color(surface)}
    {@const renderOrder = surface_render_orders.get(surface) ?? surface_idx}

    {#if geometry}
      {#each symmetry_ops as sym_matrix, sym_idx (`sym-${sym_idx}`)}
        <!-- Passes of one surface draw consecutively (back before front) and inner surfaces
             before outer ones -->
        {#each material_passes as pass, pass_idx (pass)}
          <!-- Both passes stay pickable: the raycast honours material.side, and an open sheet
               seen from its concave side only hits the back-face pass -->
          <T.Mesh
            {geometry}
            material={materials[surface_idx]?.[pass_idx]}
            matrix={sym_matrix}
            matrixAutoUpdate={false}
            renderOrder={renderOrder * material_passes.length + pass_idx}
            onpointermove={(event: ThreltePointerEvent) =>
              handle_pointer_move(event, surface, geometry, surface_color, sym_idx)}
            onpointerleave={clear_hover}
          />
        {/each}
      {/each}
    {/if}
  {/each}
</T>
