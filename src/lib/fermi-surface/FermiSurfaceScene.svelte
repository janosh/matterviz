<script lang="ts">
  import { AXIS_COLORS, NEG_AXIS_COLORS } from '$lib/colors'
  import type { BrillouinZoneData } from '$lib/brillouin'
  import type { Matrix4Tuple, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import type { CameraProjection } from '$lib/settings'
  import { Arrow, Cylinder } from '$lib/structure'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import type { Camera, Scene } from 'three'
  import {
    BackSide,
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    FrontSide,
    Matrix4,
    Plane,
    Vector3,
  } from 'three'
  import * as constants from './constants'
  import { IDENTITY_4x4, OH_SYMMETRY_MATRICES } from './symmetry'
  import type {
    ColorProperty,
    FermiHoverData,
    FermiSurfaceData,
    Isosurface,
    RepresentationMode,
  } from './types'

  // Threlte pointer event type for mesh interactions
  type ThreltePointerEvent = { point: Vector3; nativeEvent: PointerEvent }

  let {
    fermi_data = $bindable(),
    bz_data = $bindable(),
    camera_position = $bindable(),
    camera_projection = $bindable(`perspective`),
    // Fermi surface styling
    color_property = `band`,
    color_scale = `interpolateViridis`,
    representation = `solid`,
    surface_opacity = $bindable(0.8),
    selected_bands,
    // BZ styling
    show_bz = true,
    bz_color = `#888888`,
    bz_opacity = 0.1,
    bz_edge_color = `#333333`,
    bz_edge_width = 0.02,
    show_vectors = true,
    tile_bz = false,
    // Clipping plane
    clip_enabled = false,
    clip_axis = `z`,
    clip_position = 0,
    clip_flip = false,
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
    gizmo = DEFAULTS.structure.show_gizmo,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    camera_is_moving = $bindable(false),
    scene = $bindable(),
    camera = $bindable(),
    hover_data = $bindable<FermiHoverData | null>(null),
  }: {
    fermi_data?: FermiSurfaceData
    bz_data?: BrillouinZoneData
    camera_position?: Vec3 | undefined
    camera_projection?: CameraProjection
    color_property?: ColorProperty
    color_scale?: string
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
    rotation_damping?: number
    max_zoom?: number
    min_zoom?: number
    rotate_speed?: number
    zoom_speed?: number
    pan_speed?: number
    zoom_to_cursor?: boolean
    fov?: number
    initial_zoom?: number
    ambient_light?: number
    directional_light?: number
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
    auto_rotate?: number
    camera_is_moving?: boolean
    scene?: Scene
    camera?: Camera
    hover_data?: FermiHoverData | null
  } = $props()

  const threlte = useThrelte()

  // Compute scene size for clipping (also used for camera positioning later)
  function get_scene_size(): number {
    if (!fermi_data?.k_lattice) return 10
    const mags = fermi_data.k_lattice.map((vec) => Math.hypot(...vec))
    return mags.reduce((sum, mag) => sum + mag, 0) / 3
  }

  // Compute clipping plane based on axis and position
  // Plane equation: dot(normal, point) + constant >= 0 means point is visible
  const clip_plane = $derived.by(() => {
    if (!clip_enabled) return null

    const axis_idx = { x: 0, y: 1, z: 2 }[clip_axis]
    const normal_arr: Vec3 = [0, 0, 0]
    normal_arr[axis_idx] = clip_flip ? -1 : 1

    const scaled_position = clip_position * get_scene_size()
    // constant = -position for normal case (keep points >= position)
    // constant = +position for flipped case (keep points <= position)
    const constant = clip_flip ? scaled_position : -scaled_position

    return new Plane(new Vector3(...normal_arr), constant)
  })

  // Apply clipping plane to renderer
  $effect(() => {
    if (!threlte.renderer) return

    if (clip_plane) {
      threlte.renderer.clippingPlanes = [clip_plane]
      threlte.renderer.localClippingEnabled = true
    } else {
      threlte.renderer.clippingPlanes = []
      threlte.renderer.localClippingEnabled = false
    }
  })

  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
    if (threlte.renderer) {
      // Enable object sorting for proper depth ordering of transparent surfaces
      threlte.renderer.sortObjects = true
      Object.assign(threlte.renderer.domElement, { __renderer: threlte.renderer })
    }
  })

  extras.interactivity()

  // Get color interpolator from d3
  const get_interpolator = (name: string): (t: number) => string => {
    const fn = d3_sc[name as keyof typeof d3_sc]
    return typeof fn === `function` ? fn : d3_sc.interpolateViridis
  }

  // Filter surfaces based on selected bands
  let visible_surfaces = $derived(
    fermi_data?.isosurfaces.filter((surface) =>
      selected_bands === undefined || selected_bands.includes(surface.band_index)
    ) ?? [],
  )

  // Compute average vertex distance from origin for each surface (used for render ordering)
  // Smaller distance = inner surface = render first (lower renderOrder)
  // Larger distance = outer surface = render last (higher renderOrder)
  function compute_surface_radius(surface: Isosurface): number {
    if (surface.vertices.length === 0) return 0
    let sum = 0
    for (const vertex of surface.vertices) {
      sum += Math.hypot(vertex[0], vertex[1], vertex[2])
    }
    return sum / surface.vertices.length
  }

  // Map from surface to its render order based on size (inner surfaces first)
  let surface_render_orders = $derived.by((): Map<Isosurface, number> => {
    const order_map = new SvelteMap<Isosurface, number>()
    if (visible_surfaces.length === 0) return order_map

    // Compute radius for each surface and sort by it
    const surfaces_with_radius = visible_surfaces.map((surface) => ({
      surface,
      radius: compute_surface_radius(surface),
    }))
    surfaces_with_radius.sort((a, b) => a.radius - b.radius)

    // Assign render order: smaller radius (inner) = lower order = rendered first
    for (let idx = 0; idx < surfaces_with_radius.length; idx++) {
      order_map.set(surfaces_with_radius[idx].surface, idx)
    }
    return order_map
  })

  // Compute property range for color scaling
  let property_range = $derived.by((): [number, number] => {
    if (color_property !== `velocity` && color_property !== `custom`) {
      return [0, 1]
    }
    let min_val = Infinity
    let max_val = -Infinity
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

  // Get color for a surface/vertex
  function get_surface_color(surface: Isosurface, vertex_idx?: number): string {
    if (color_property === `band`) {
      return constants.BAND_COLORS[surface.band_index % constants.BAND_COLORS.length]
    }
    if (
      (color_property === `velocity` || color_property === `custom`) &&
      surface.properties &&
      vertex_idx !== undefined
    ) {
      const prop = surface.properties[vertex_idx]
      const [min_val, max_val] = property_range
      const normalized = max_val > min_val
        ? (prop - min_val) / (max_val - min_val)
        : 0.5
      return get_interpolator(color_scale)(normalized)
    }
    // Spin coloring
    if (color_property === `spin` && surface.spin) {
      return surface.spin === `up` ? `#e41a1c` : `#377eb8`
    }
    return constants.BAND_COLORS[surface.band_index % constants.BAND_COLORS.length]
  }

  // Create geometry for an isosurface
  function create_isosurface_geometry(
    surface: Isosurface,
  ): { geometry: BufferGeometry; dispose: () => void } | null {
    if (surface.vertices.length === 0 || surface.faces.length === 0) return null

    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []

    const use_vertex_colors = color_property === `velocity` ||
      color_property === `custom`

    const n_vertices = surface.vertices.length

    for (const face of surface.faces) {
      if (face.length < 3) continue

      // Fan triangulation: for polygon with N vertices, create N-2 triangles
      // e.g. quad [0,1,2,3] becomes triangles [0,1,2] and [0,2,3]
      for (let fan_idx = 1; fan_idx < face.length - 1; fan_idx++) {
        const idx0 = face[0]
        const idx1 = face[fan_idx]
        const idx2 = face[fan_idx + 1]

        // Validate face indices are within bounds (protects against malformed JSON files)
        if (
          idx0 < 0 || idx0 >= n_vertices ||
          idx1 < 0 || idx1 >= n_vertices ||
          idx2 < 0 || idx2 >= n_vertices
        ) {
          continue
        }

        const v0 = surface.vertices[idx0]
        const v1 = surface.vertices[idx1]
        const v2 = surface.vertices[idx2]

        positions.push(...v0, ...v1, ...v2)

        // Use per-vertex normals if available, otherwise compute face normal
        if (surface.normals && surface.normals.length > 0) {
          const n0 = surface.normals[idx0] ?? [0, 0, 1]
          const n1 = surface.normals[idx1] ?? [0, 0, 1]
          const n2 = surface.normals[idx2] ?? [0, 0, 1]
          normals.push(...n0, ...n1, ...n2)
        } else {
          const e1: Vec3 = math.subtract(v1, v0)
          const e2: Vec3 = math.subtract(v2, v0)
          const normal = math.cross_3d(e1, e2)
          const len = Math.hypot(...normal)
          const n = len > 1e-10 ? normal.map((x) => x / len) : [0, 0, 1]
          normals.push(...n, ...n, ...n)
        }

        // Per-vertex colors for this triangle
        if (use_vertex_colors) {
          for (const vert_idx of [idx0, idx1, idx2]) {
            const color_str = get_surface_color(surface, vert_idx)
            const color = new Color(color_str)
            colors.push(color.r, color.g, color.b)
          }
        }
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      `position`,
      new BufferAttribute(new Float32Array(positions), 3),
    )
    geometry.setAttribute(`normal`, new BufferAttribute(new Float32Array(normals), 3))

    if (use_vertex_colors) {
      geometry.setAttribute(`color`, new BufferAttribute(new Float32Array(colors), 3))
    }

    geometry.computeBoundingSphere()

    return { geometry, dispose: () => geometry.dispose() }
  }

  // Memoized geometry cache - pre-compute geometries to avoid recomputation on every render
  type GeometryData = { geometry: BufferGeometry; dispose: () => void }
  let geometry_cache = $derived.by((): Map<string, GeometryData | null> => {
    const cache = new SvelteMap<string, GeometryData | null>()
    for (let idx = 0; idx < visible_surfaces.length; idx++) {
      const surface = visible_surfaces[idx]
      const key = `${surface.band_index}-${surface.spin}-${idx}`
      cache.set(key, create_isosurface_geometry(surface))
    }
    return cache
  })

  // Cleanup geometries when cache changes
  $effect(() => {
    const current_cache = geometry_cache
    return () => {
      for (const geo_data of current_cache.values()) {
        geo_data?.dispose()
      }
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

  // Compute rotation target from surfaces or BZ
  const rotation_target = $derived.by((): Vec3 => {
    if (bz_data?.vertices && bz_data.vertices.length > 0) {
      const sum = bz_data.vertices.reduce(
        (acc, vert) => math.add(acc, vert),
        [0, 0, 0] as Vec3,
      )
      return math.scale(sum, 1 / bz_data.vertices.length)
    }
    return [0, 0, 0]
  })

  // Scene size for camera positioning (uses helper function defined earlier)
  const scene_size = $derived(get_scene_size())

  const computed_camera_position = $derived.by(
    () =>
      camera_position || ([10, 3, 8].map((x) => x * Math.max(1, scene_size)) as Vec3),
  )

  const gizmo_props = $derived({
    background: { enabled: false },
    className: `responsive-gizmo`,
    ...Object.fromEntries(
      [...AXIS_COLORS, ...NEG_AXIS_COLORS].map(([axis, color, hover]) => [
        axis,
        {
          color,
          labelColor: `#111`,
          opacity: axis.startsWith(`n`) ? 0.9 : 0.8,
          hover: {
            color: hover,
            labelColor: `#222`,
            opacity: axis.startsWith(`n`) ? 1 : 0.9,
          },
        },
      ]),
    ),
    ...(typeof gizmo === `object` ? gizmo : {}),
    offset: { left: 5, bottom: 5 },
  })

  const is_ortho = $derived(camera_projection === `orthographic`)
  const orbit_controls_props = $derived({
    position: [0, 0, 0],
    target: rotation_target,
    enableRotate: rotate_speed > 0,
    rotateSpeed: rotate_speed,
    enableZoom: zoom_speed > 0,
    zoomSpeed: is_ortho ? zoom_speed * 2 : zoom_speed,
    zoomToCursor: zoom_to_cursor,
    enablePan: pan_speed > 0,
    panSpeed: pan_speed,
    maxZoom: max_zoom,
    minZoom: min_zoom,
    autoRotate: Boolean(auto_rotate),
    autoRotateSpeed: auto_rotate,
    enableDamping: Boolean(rotation_damping),
    dampingFactor: rotation_damping,
    onstart: () => (camera_is_moving = true),
    onend: () => (camera_is_moving = false),
  })

  const vector_colors = [`red`, `green`, `blue`]
  const vector_labels = [`b₁`, `b₂`, `b₃`]

  // Create BZ geometry
  const bz_geometry = $derived.by(() => {
    if (!bz_data || bz_data.faces.length === 0) return null

    const positions: number[] = []
    const normals: number[] = []

    for (const face of bz_data.faces) {
      if (face.length < 3) continue

      for (let face_idx = 1; face_idx < face.length - 1; face_idx++) {
        const indices = [face[0], face[face_idx], face[face_idx + 1]]
        if (indices.some((idx) => idx < 0 || idx >= bz_data.vertices.length)) continue
        const [v0, v1, v2] = indices.map((idx) => bz_data.vertices[idx])
        positions.push(...v0, ...v1, ...v2)

        const e1: Vec3 = math.subtract(v1, v0)
        const e2: Vec3 = math.subtract(v2, v0)
        const normal_vec = math.cross_3d(e1, e2)
        const len = Math.hypot(...normal_vec)
        const norm = len > 1e-10 ? normal_vec.map((x) => x / len) : [0, 0, 0]
        normals.push(...norm, ...norm, ...norm)
      }
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      `position`,
      new BufferAttribute(new Float32Array(positions), 3),
    )
    geometry.setAttribute(`normal`, new BufferAttribute(new Float32Array(normals), 3))
    geometry.computeBoundingSphere()
    return geometry
  })

  $effect(() => {
    const prev_geometry = bz_geometry
    return () => prev_geometry?.dispose()
  })

  // Get material props for two-pass transparent rendering
  // Pass 1 (back faces): renders interior/back of surfaces first
  // Pass 2 (front faces): renders exterior/front of surfaces on top
  // This avoids z-fighting while showing both sides correctly
  const get_material_props = (
    surface_color: string,
    use_vertex_colors: boolean,
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

    if (use_vertex_colors) {
      return { ...base, vertexColors: true }
    }
    return { ...base, color: surface_color }
  }

  // Compute inverse of k_lattice for Cartesian->fractional conversion (cached)
  const k_lattice_inv = $derived.by(() => {
    if (!fermi_data?.k_lattice) return null
    try {
      return math.matrix_inverse_3x3(fermi_data.k_lattice)
    } catch {
      return null
    }
  })

  // Throttle state for pointer move events to avoid O(n) vertex lookups causing jank
  let last_hover_time = 0

  // Convert Cartesian k-coordinates to fractional (reciprocal lattice units)
  // Returns null if k_lattice is unavailable or inversion failed
  function cartesian_to_fractional(cart: Vec3): Vec3 | null {
    if (!k_lattice_inv) return null
    return math.mat3x3_vec3_multiply(k_lattice_inv, cart)
  }

  // Find index of nearest vertex to a point in a surface
  function find_nearest_vertex(surface: Isosurface, point: Vec3): number {
    let min_dist = Infinity
    let nearest_idx = 0
    for (let idx = 0; idx < surface.vertices.length; idx++) {
      const vertex = surface.vertices[idx]
      const dist = Math.hypot(
        point[0] - vertex[0],
        point[1] - vertex[1],
        point[2] - vertex[2],
      )
      if (dist < min_dist) {
        min_dist = dist
        nearest_idx = idx
      }
    }
    return nearest_idx
  }

  // Create hover data from pointer event on a surface
  function create_hover_data(
    event: ThreltePointerEvent,
    surface: Isosurface,
    surface_color: string,
    sym_idx: number,
    sym_matrix: Matrix4Tuple,
  ): FermiHoverData {
    // event.point is in world space (after sym_matrix transformation)
    const position_cartesian: Vec3 = [event.point.x, event.point.y, event.point.z]
    const position_fractional = cartesian_to_fractional(position_cartesian)

    // Transform world-space point to local space for nearest-vertex lookup
    // surface.vertices are in local space (raw geometry before sym_matrix)
    const local_point = event.point.clone()
    const inv_matrix = new Matrix4().fromArray(sym_matrix).invert()
    local_point.applyMatrix4(inv_matrix)
    const local_position: Vec3 = [local_point.x, local_point.y, local_point.z]

    // Find nearest vertex for property lookup (in local space)
    const nearest_idx = find_nearest_vertex(surface, local_position)
    const property_value = surface.properties?.[nearest_idx]
    const has_velocities = fermi_data?.metadata?.has_velocities
    const property_name = property_value != null
      ? (has_velocities ? `velocity` : `custom`)
      : undefined

    const { clientX, clientY } = event.nativeEvent
    return {
      band_index: surface.band_index,
      spin: surface.spin,
      position_cartesian,
      position_fractional,
      screen_position: { x: clientX, y: clientY },
      surface_color,
      property_value,
      property_name,
      is_tiled: effective_tile_bz,
      symmetry_index: sym_idx,
    }
  }

  // Throttled handler for pointer move events
  // Skips expensive nearest-vertex lookups if called too frequently
  function handle_pointer_move(
    event: ThreltePointerEvent,
    surface: Isosurface,
    surface_color: string,
    sym_idx: number,
    sym_matrix: Matrix4Tuple,
  ): void {
    const now = performance.now()
    if (now - last_hover_time < constants.HOVER_THROTTLE_MS) return
    last_hover_time = now
    hover_data = create_hover_data(event, surface, surface_color, sym_idx, sym_matrix)
  }
</script>

{#if camera_projection === `perspective`}
  <T.PerspectiveCamera makeDefault position={computed_camera_position} {fov}>
    <extras.OrbitControls {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.PerspectiveCamera>
{:else}
  <T.OrthographicCamera
    makeDefault
    position={computed_camera_position}
    zoom={initial_zoom}
    near={-100}
  >
    <extras.OrbitControls {...orbit_controls_props}>
      {#if gizmo}<extras.Gizmo {...gizmo_props} />{/if}
    </extras.OrbitControls>
  </T.OrthographicCamera>
{/if}

<T.DirectionalLight position={[3, 10, 10]} intensity={directional_light} />
<T.DirectionalLight position={[-3, -5, -10]} intensity={directional_light * 0.5} />
<T.AmbientLight intensity={ambient_light} />

<T.Group position={rotation_target}>
  <!-- Brillouin zone overlay -->
  {#if show_bz && bz_data && bz_geometry}
    <T.Mesh geometry={bz_geometry}>
      <T.MeshStandardMaterial
        color={bz_color}
        transparent
        opacity={bz_opacity}
        side={2}
        depthWrite={false}
      />
    </T.Mesh>

    <!-- BZ edges -->
    {#each bz_data.edges as edge_segment, edge_idx (`bz-edge-${edge_idx}`)}
      {@const [from, to] = edge_segment}
      <Cylinder {from} {to} thickness={bz_edge_width} color={bz_edge_color} />
    {/each}
  {/if}

  <!-- Reciprocal lattice vectors -->
  {#if show_vectors && fermi_data?.k_lattice}
    {#each fermi_data.k_lattice as vec, idx (idx)}
      {@const scaled_vec = vec.map((x) => x * vector_scale) as Vec3}
      {@const label_position = scaled_vec.map((x) => x * 1.15) as Vec3}
      <Arrow
        position={[0, 0, 0]}
        vector={scaled_vec}
        color={vector_colors[idx]}
        scale={1}
      />
      <extras.HTML center position={label_position}>
        <span style:color={vector_colors[idx]} style:font-size="1.2em">
          {vector_labels[idx]}
        </span>
      </extras.HTML>
    {/each}
  {/if}

  <!-- Fermi surfaces (with optional symmetry tiling) -->
  {#each visible_surfaces as
    surface,
    surface_idx
    (`surface-${surface.band_index}-${surface.spin}-${surface_idx}`)
  }
    {@const geo_key = `${surface.band_index}-${surface.spin}-${surface_idx}`}
    {@const geo_data = geometry_cache.get(geo_key)}
    {@const surface_color = get_surface_color(surface)}
    {@const use_vertex_colors = color_property === `velocity` || color_property === `custom`}
    {@const symmetry_ops = effective_tile_bz ? OH_SYMMETRY_MATRICES : [IDENTITY_4x4]}
    {@const renderOrder = surface_render_orders.get(surface) ?? surface_idx}

    {#if geo_data}
      {#each symmetry_ops as sym_matrix, sym_idx (`sym-${sym_idx}`)}
        {#if representation === `wireframe`}
          <T.Mesh
            geometry={geo_data.geometry}
            matrix={sym_matrix}
            matrixAutoUpdate={false}
            {renderOrder}
            onpointermove={(event: ThreltePointerEvent) =>
            handle_pointer_move(event, surface, surface_color, sym_idx, sym_matrix)}
            onpointerleave={() => {
              hover_data = null
            }}
          >
            <T.MeshBasicMaterial
              color={surface_color}
              wireframe
              transparent={surface_opacity < 1}
              opacity={surface_opacity}
              depthWrite={true}
              depthTest={true}
            />
          </T.Mesh>
        {:else if surface_opacity < 1}
          <!-- Two-pass rendering for transparent surfaces -->
          <!-- Pass 1: Back faces (rendered first, lower renderOrder) -->
          <T.Mesh
            geometry={geo_data.geometry}
            matrix={sym_matrix}
            matrixAutoUpdate={false}
            renderOrder={renderOrder * 2}
            onpointermove={(event: ThreltePointerEvent) =>
            handle_pointer_move(event, surface, surface_color, sym_idx, sym_matrix)}
            onpointerleave={() => {
              hover_data = null
            }}
          >
            <T.MeshStandardMaterial
              {...get_material_props(surface_color, use_vertex_colors, surface_idx, `back`)}
              metalness={0.1}
              roughness={0.6}
              flatShading={false}
            />
          </T.Mesh>
          <!-- Pass 2: Front faces (rendered second, higher renderOrder) -->
          <T.Mesh
            geometry={geo_data.geometry}
            matrix={sym_matrix}
            matrixAutoUpdate={false}
            renderOrder={renderOrder * 2 + 1}
            onpointermove={(event: ThreltePointerEvent) =>
            handle_pointer_move(event, surface, surface_color, sym_idx, sym_matrix)}
            onpointerleave={() => {
              hover_data = null
            }}
          >
            <T.MeshStandardMaterial
              {...get_material_props(
                surface_color,
                use_vertex_colors,
                surface_idx,
                `front`,
              )}
              metalness={0.1}
              roughness={0.6}
              flatShading={false}
            />
          </T.Mesh>
        {:else}
          <!-- Single pass for opaque surfaces -->
          <T.Mesh
            geometry={geo_data.geometry}
            matrix={sym_matrix}
            matrixAutoUpdate={false}
            {renderOrder}
            onpointermove={(event: ThreltePointerEvent) =>
            handle_pointer_move(event, surface, surface_color, sym_idx, sym_matrix)}
            onpointerleave={() => {
              hover_data = null
            }}
          >
            <T.MeshStandardMaterial
              {...get_material_props(
                surface_color,
                use_vertex_colors,
                surface_idx,
                `front`,
              )}
              metalness={0.1}
              roughness={0.6}
              flatShading={false}
            />
          </T.Mesh>
        {/if}
      {/each}
    {/if}
  {/each}
</T.Group>

<style>
  :global(.fermi-surface .responsive-gizmo) {
    width: clamp(70px, 18cqmin, 100px) !important;
    height: clamp(70px, 18cqmin, 100px) !important;
  }
</style>
