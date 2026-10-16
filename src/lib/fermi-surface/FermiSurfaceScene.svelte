<script lang="ts">
  import type { BrillouinZoneData, BZHoverData } from '#lib/brillouin/index.js'
  import {
    bz_fit_extent,
    cartesian_to_fractional,
    default_camera_position,
    k_cell_fit_extent,
    k_lattice_inverse,
    bz_mark_sizes,
    k_space_size,
    polyhedron_centroid,
    PolyhedronMesh,
    ReciprocalVectors,
  } from '#lib/brillouin/index.js'
  import type { Point2D, Vec3 } from '#lib/math.js'
  import { resolve_value_range } from '#lib/plot/core/scales.js'
  import {
    bind_renderer,
    create_scene_camera,
    scene_interactivity,
    resolve_scene_controls,
    SceneCamera,
    SceneLights,
  } from '#lib/scene/index.js'
  import type { SceneControlProps, ThreltePointerEvent } from '#lib/scene/index.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { ortho_zoom_for_extent } from '#lib/structure/camera-fit.js'
  import { T } from '@threlte/core'
  import {
    BufferGeometry,
    ClippingGroup,
    DoubleSide,
    Matrix4,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Plane,
    Vector3,
  } from 'three/webgpu'
  import { property_label as display_label, sheet_color } from './constants'
  import {
    apply_vertex_colors,
    build_isosurface_geometry,
    nearest_face_vertex,
    property_value_range,
    property_names,
    vertex_property,
  } from './geometry'
  import { IDENTITY_4x4, lattice_point_group_matrices } from './symmetry'
  import { reciprocal_cell_section, slice_plane_normal } from './compute'
  import SlicePlane from '#lib/isosurface/SlicePlane.svelte'
  import KPath from '#lib/brillouin/KPath.svelte'
  import type { ComponentProps } from 'svelte'
  import type {
    FermiHoverData,
    FermiIsosurface,
    FermiSurfaceData,
    FermiSurfaceSettings,
    SpinChannel,
  } from './types'

  let {
    fermi_data,
    bz_data,
    camera_projection = DEFAULTS.fermi.camera_projection,
    // Fermi surface styling
    color_property = DEFAULTS.fermi.color_property,
    color_scale = DEFAULTS.fermi.color_scale,
    property_name: requested_property, // coloured by in `property` mode (default: the first)
    property_label, // display label of the unnamed property (see DEFAULT_PROPERTY_NAME)
    representation = DEFAULTS.fermi.representation,
    surface_opacity = DEFAULTS.fermi.surface_opacity,
    selected_bands,
    selected_spins,
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
    slice_plane, // the 2D slice plane (h k l)·k = distance to mark, cut to the data's cell
    k_marker = null, // k-point (Cartesian Å⁻¹) to mark with a dot, e.g. a FermiSlice's cursor
    k_path,
    scene = $bindable(),
    camera = $bindable(),
    hover_data = $bindable<FermiHoverData | null>(null),
    kpath_hover_data = $bindable<BZHoverData | null>(null),
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
      property_name?: string
      property_label?: string
      slice_plane?: { miller_indices: Vec3; distance: number }
      k_marker?: Vec3 | null
      // a band structure's k-path to draw (its hovered point is the k_marker dot)
      k_path?: Omit<ComponentProps<typeof KPath>, `size` | `edge_width` | `hovered_k_point`>
      selected_bands?: number[]
      selected_spins?: SpinChannel[]
      hover_data?: FermiHoverData | null
      kpath_hover_data?: BZHoverData | null // the hovered k-path point, for a zone tooltip
    } = $props()

  const controls = $derived(resolve_scene_controls(scene_controls))
  const SLICE_PLANE_COLOR = `#f59e0b`

  // Transparent surfaces depth-sort correctly because renderer.sortObjects defaults to true
  const threlte = bind_renderer((threlte_scene, threlte_camera) => {
    scene = threlte_scene
    camera = threlte_camera
  })

  // Characteristic scene size, used for clipping and camera positioning
  const scene_size = $derived(k_space_size(fermi_data?.k_lattice))

  // Keeps points with normal·point + constant ≥ 0: those past the position along the axis,
  // or before it when flipped
  const clip_plane = $derived.by(() => {
    if (!clip_enabled) return null
    const sign = clip_flip ? -1 : 1
    const normal = new Vector3().setComponent({ x: 0, y: 1, z: 2 }[clip_axis], sign)
    return new Plane(normal, -sign * clip_position * scene_size)
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

  // Only the front-most visible sheet gets the pointer event; a k-path drawn through the zone
  // wins over sheets in front of it (its pick_rank), or most of it could not be hovered
  const { enabled: hover_enabled } = scene_interactivity({ clip_plane: () => clip_plane })

  let visible_surfaces = $derived(
    fermi_data?.isosurfaces.filter(
      ({ band_index, spin }) =>
        (selected_bands?.includes(band_index) ?? true) &&
        (selected_spins?.includes(spin) ?? true),
    ) ?? [],
  )

  // Mean vertex distance from Γ: inner sheets render first so outer transparent shells blend
  // over them
  function mean_radius({ positions }: FermiIsosurface): number {
    let sum = 0
    for (let idx = 0; idx < positions.length; idx += 3) {
      sum += Math.hypot(positions[idx], positions[idx + 1], positions[idx + 2])
    }
    return positions.length ? (3 * sum) / positions.length : 0
  }
  // Render order per surface (inner = lower = first)
  let surface_render_orders = $derived(
    new Map(
      visible_surfaces
        .map((surface) => ({ surface, radius: mean_radius(surface) }))
        .toSorted((surf_a, surf_b) => surf_a.radius - surf_b.radius)
        .map(({ surface }, idx) => [surface, idx]),
    ),
  )

  // `property` maps the per-vertex scalars through the colour scale; band/spin colouring is a
  // single material colour per surface
  const use_vertex_colors = $derived(color_property === `property`)
  const property_name = $derived(
    requested_property ?? property_names(fermi_data?.isosurfaces ?? [])[0],
  )

  // Colour value range: set color_scale.value_range ends, else the property's finite values
  // across all visible surfaces
  let property_range = $derived(
    resolve_value_range(color_scale, () =>
      property_value_range(visible_surfaces, property_name),
    ),
  )

  const get_surface_color = ({ band_index, spin }: FermiIsosurface): string =>
    sheet_color(band_index, spin, color_property)

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
    const spec = use_vertex_colors ? { color_scale, value_range: property_range } : null
    for (const [idx, geometry] of geometries.entries()) {
      const values = vertex_property(visible_surfaces[idx], property_name)
      if (geometry) apply_vertex_colors(geometry, values, spec)
    }
    threlte.invalidate()
  })

  // Tiling draws up to 48 copies (cubic), so it is auto-disabled above 50k triangles
  let total_triangles = $derived(
    visible_surfaces.reduce((sum, surface) => sum + surface.indices.length / 3, 0),
  )
  let effective_tile_bz = $derived(tile_bz && total_triangles < 50_000)
  const rotation_target = $derived(polyhedron_centroid(bz_data?.vertices)) // BZ centroid
  $effect(() => {
    if (tile_bz && !effective_tile_bz) {
      console.warn(`Fermi surface has ${total_triangles} triangles, BZ tiling auto-disabled`)
    }
  })

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
    // a drag would raycast up to 48 tiled meshes per pointermove, and the tooltip popping in
    // and out as the sheets sweep under the cursor reads as the surface flickering
    set_camera_is_moving: (moving) => {
      hover_enabled.set(!moving)
      if (!moving) return
      hover_data = null
      kpath_hover_data = null
    },
  })

  // Only the transparency flag feeds the material set: the opacity value itself is written in
  // place below, so an opacity-slider tick does not rebuild (and recompile) every material.
  const is_transparent = $derived(surface_opacity < 1)
  // Translucent sheets keep writing depth, which layers inner and outer bands but makes
  // (nearly) coincident sheets — up and down channels of a non-magnetic calculation exported as
  // two spin surfaces — z-fight, so each surface gets its own depth bias. WebGPU truncates the
  // bias to an integer, hence whole-number steps wide enough to cover the numeric mismatch. The
  // slope term stays shared: a per-surface slope would reorder distinct sheets at grazing angles
  const SURFACE_DEPTH_BIAS_STEP = 8
  const make_material = (surface_idx: number, color: string | true) => {
    const material =
      representation === `wireframe`
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
    material.vertexColors = color === true
    if (color !== true) material.color.set(color)
    material.transparent = is_transparent
    // three draws a transparent DoubleSide material as back- then front-face passes, and one
    // raycast picks either side (an open sheet seen from its concave side shows only back faces)
    material.side = DoubleSide
    return material
  }
  // One material per surface, shared by every symmetry copy so a tiled cubic surface needs 1
  // material rather than 48 — hence built here instead of via <T.Mesh*Material>, which
  // would instantiate one per <T.Mesh>. Cached by all make_material reads, so re-extracted sheets
  // (every frame of a mu drag) skip three's ~2 ms node-builder pass for each new material
  const material_cache = new Map<string, MeshBasicMaterial | MeshStandardMaterial>()
  const materials = $derived(
    visible_surfaces.map((surface, surface_idx) => {
      // A surface without per-vertex properties keeps its flat colour even in property mode,
      // otherwise vertexColors would read a missing attribute
      const color =
        (use_vertex_colors && vertex_property(surface, property_name) !== undefined) ||
        get_surface_color(surface)
      const key = `${representation}|${surface_idx}|${color}|${is_transparent}`
      const material = material_cache.get(key) ?? make_material(surface_idx, color)
      material_cache.set(key, material)
      return material
    }),
  )
  $effect(() => {
    const used = new Set(materials)
    for (const [key, material] of material_cache) {
      if (used.has(material)) continue
      material.dispose()
      material_cache.delete(key)
    }
  })
  $effect(() => () => {
    for (const material of material_cache.values()) material.dispose()
  })
  // Opacity is a per-frame uniform, so write it in place and repaint rather than rebuild
  $effect(() => {
    for (const material of materials) material.opacity = surface_opacity
    threlte.invalidate()
  })

  // Where the 2D slice cuts the cell the surfaces live in (Γ-centred parallelepiped or zone);
  // empty when the plane misses it
  const slice_polygon = $derived.by((): Vec3[] => {
    if (!slice_plane || !fermi_data) return []
    const { miller_indices, distance } = slice_plane
    // (0 0 0) defines no plane; FermiSlice reports that error
    if (miller_indices.every((idx) => idx === 0)) return []
    const normal = slice_plane_normal(fermi_data.k_lattice, miller_indices)
    // the drawn zone, nothing while it is missing
    return reciprocal_cell_section(fermi_data, normal, distance, bz_data?.edges ?? [])
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

  // The hovered k-path point as a Brillouin zone viewer hover, also passed on to the caller
  const on_kpath_hover = (qpoint_idx: number | null, screen_position?: Point2D) => {
    const position_cartesian = k_path?.path.points[qpoint_idx ?? -1]
    kpath_hover_data =
      position_cartesian && screen_position && bz_data
        ? {
            position_cartesian,
            position_fractional: cartesian_to_fractional(k_lattice_inv, position_cartesian),
            screen_position,
            is_ibz: false,
            bz_order: bz_data.order,
            bz_volume: bz_data.volume,
            ibz_volume: null,
            symmetry_multiplicity: null,
          }
        : null
    k_path?.on_kpath_hover?.(qpoint_idx, screen_position)
  }

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
    let property_values: Record<string, number> | undefined
    if (surface.properties && event.face) {
      const local_point = event.point.clone().applyMatrix4(inverse_symmetry_ops[sym_idx])
      const vertex_idx = nearest_face_vertex(geometry, event.face, local_point)
      property_values = Object.fromEntries(
        Object.entries(surface.properties).map(([name, values]) => [
          display_label(name, property_label),
          values[vertex_idx],
        ]),
      )
    }
    // The colouring property leads the tooltip, when this sheet has it
    const active_label =
      property_name !== undefined && surface.properties?.[property_name]
        ? display_label(property_name, property_label)
        : undefined

    const { clientX, clientY } = event.nativeEvent
    hover_data = {
      band_index: surface.band_index,
      spin: surface.spin,
      position_cartesian,
      position_fractional,
      screen_position: { x: clientX, y: clientY },
      surface_color,
      property_value: active_label === undefined ? undefined : property_values?.[active_label],
      property_name: active_label,
      property_values,
      is_tiled: effective_tile_bz,
      symmetry_index: sym_idx,
      n_symmetry_ops: symmetry_ops.length,
    }
  }
</script>

<SceneCamera
  {camera_projection}
  position={default_camera_position(scene_size)}
  fov={controls.fov}
  zoom={scene_camera.zoom}
  reset_zoom={scene_camera.reset_to_fit}
  orbit_props={scene_camera.orbit_props}
  gizmo={controls.gizmo}
/>

<SceneLights
  ambient={controls.ambient_light}
  directional={controls.directional_light}
  fill={0.5}
/>

<T is={clipping_group}>
  <!-- Brillouin zone overlay -->
  {#if show_bz && bz_data}
    <PolyhedronMesh
      polyhedron={bz_data}
      color="#888888"
      opacity={bz_opacity}
      edge_color="#333333"
      edge_width={bz_mark_sizes(scene_size, DEFAULTS.brillouin.edge_width).edge}
    />
  {/if}

  <!-- Reciprocal lattice vectors -->
  {#if show_vectors && fermi_data?.k_lattice}
    <ReciprocalVectors k_lattice={fermi_data.k_lattice} size={scene_size} />
  {/if}

  <SlicePlane polygon={slice_polygon} color={SLICE_PLANE_COLOR} />

  {#if k_path}
    <KPath
      {...k_path}
      size={scene_size}
      edge_width={DEFAULTS.brillouin.edge_width}
      {on_kpath_hover}
    />
  {/if}
  {#if k_marker}
    <!-- drawn on top of everything so the dot stays visible inside or behind sheets -->
    <T.Mesh position={k_marker} renderOrder={1001}>
      <T.SphereGeometry args={[0.015 * scene_size, 16, 12]} />
      <T.MeshBasicMaterial color={SLICE_PLANE_COLOR} depthTest={false} transparent />
    </T.Mesh>
  {/if}

  <!-- Fermi surfaces (with optional symmetry tiling) -->
  {#each visible_surfaces as surface, surface_idx (`surface-${surface.band_index}-${surface.spin}-${surface_idx}`)}
    {@const geometry = geometries[surface_idx]}
    {@const surface_color = get_surface_color(surface)}
    {@const renderOrder = surface_render_orders.get(surface) ?? surface_idx}

    {#if geometry}
      {#each symmetry_ops as sym_matrix, sym_idx (`sym-${sym_idx}`)}
        <T.Mesh
          {geometry}
          material={materials[surface_idx]}
          matrix={sym_matrix}
          matrixAutoUpdate={false}
          {renderOrder}
          onpointermove={(event: ThreltePointerEvent) =>
            handle_pointer_move(event, surface, geometry, surface_color, sym_idx)}
          onpointerleave={() => (hover_data = null)}
        />
      {/each}
    {/if}
  {/each}
</T>
