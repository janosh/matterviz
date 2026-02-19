<script lang="ts">
  import { AXIS_COLORS, NEG_AXIS_COLORS } from '$lib/colors'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { type CameraProjection, DEFAULTS } from '$lib/settings'
  import Arrow from '$lib/structure/Arrow.svelte'
  import Cylinder from '$lib/structure/Cylinder.svelte'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import type { Camera, Scene } from 'three'
  import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
  import type { BrillouinZoneData, BZHoverData, IrreducibleBZData } from './types'

  // Threlte pointer event type for mesh interactions
  type ThreltePointerEvent = { point: Vector3; nativeEvent: PointerEvent }

  let {
    bz_data = $bindable(),
    camera_position = $bindable(),
    camera_projection = $bindable(`perspective`),
    surface_color = $bindable(`#4488ff`),
    surface_opacity = $bindable(0.3),
    edge_color = $bindable(`#000000`),
    edge_width = $bindable(0.05),
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
    camera_is_moving = $bindable(false),
    scene = $bindable(),
    camera = $bindable(),
    k_path_points = [],
    k_path_labels = [],
    hovered_k_point = null,
    hovered_qpoint_index = null,
    hover_data = $bindable<BZHoverData | null>(null),
  }: {
    bz_data?: BrillouinZoneData
    camera_position?: Vec3 | undefined
    camera_projection?: CameraProjection
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
    k_path_points?: Vec3[]
    k_path_labels?: { position: Vec3; label: string | null }[]
    hovered_k_point?: Vec3 | null
    hovered_qpoint_index?: number | null
    hover_data?: BZHoverData | null
  } = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
    if (threlte.renderer) {
      Object.assign(threlte.renderer.domElement, { __renderer: threlte.renderer })
    }
  })

  extras.interactivity()

  // Compute centroid of BZ vertices for proper rotation center
  const rotation_target = $derived.by((): Vec3 => {
    if (!bz_data?.vertices || bz_data.vertices.length === 0) return [0, 0, 0]
    const sum = bz_data.vertices.reduce(
      (acc, v) => math.add(acc, v),
      [0, 0, 0] as Vec3,
    )
    return math.scale(sum, 1 / bz_data.vertices.length)
  })

  // BZ size for camera positioning: average magnitude of k-vectors
  const bz_size = $derived.by(() => {
    if (!bz_data?.k_lattice) return 10
    const mags = bz_data.k_lattice.map((vec) => Math.hypot(...vec))
    return mags.reduce((sum, mag) => sum + mag, 0) / 3
  })

  const computed_camera_position = $derived.by(() =>
    camera_position || ([10, 3, 8].map((x) => x * Math.max(1, bz_size)) as Vec3)
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

  // Create mesh geometry from faces with fan triangulation
  function create_mesh_geometry(
    vertices: Vec3[],
    faces: number[][],
  ): BufferGeometry | null {
    if (faces.length === 0) return null

    const positions: number[] = []
    const normals: number[] = []

    for (const face of faces) {
      if (face.length < 3) continue
      for (let face_idx = 1; face_idx < face.length - 1; face_idx++) {
        const indices = [face[0], face[face_idx], face[face_idx + 1]]
        if (indices.some((idx) => idx < 0 || idx >= vertices.length)) continue
        const [v0, v1, v2] = indices.map((idx) => vertices[idx])
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
  }

  const bz_geometry = $derived(
    bz_data ? create_mesh_geometry(bz_data.vertices, bz_data.faces) : null,
  )
  const ibz_geometry = $derived(
    show_ibz && ibz_data
      ? create_mesh_geometry(ibz_data.vertices, ibz_data.faces)
      : null,
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

  // Compute inverse of k_lattice for Cartesian->fractional conversion
  const k_lattice_inv = $derived.by(() => {
    if (!bz_data?.k_lattice) return null
    try {
      return math.matrix_inverse_3x3(bz_data.k_lattice)
    } catch {
      return null
    }
  })

  // Convert Cartesian k-coordinates to fractional (reciprocal lattice units)
  function cartesian_to_fractional(cart: Vec3): Vec3 | null {
    if (!k_lattice_inv) return null
    return math.mat3x3_vec3_multiply(k_lattice_inv, cart)
  }

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
  function create_hover_data(
    event: ThreltePointerEvent,
    is_ibz: boolean,
  ): BZHoverData | null {
    if (!bz_data) return null

    const position_cartesian: Vec3 = [event.point.x, event.point.y, event.point.z]
    const position_fractional = cartesian_to_fractional(position_cartesian)

    const { clientX, clientY } = event.nativeEvent
    const ibz_vol = ibz_data?.volume ?? null
    // Round to nearest integer since symmetry multiplicity is the point group order
    const symmetry_multiplicity = ibz_vol != null && ibz_vol > 0
      ? Math.round(bz_data.volume / ibz_vol)
      : null

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
<T.AmbientLight intensity={ambient_light} />

<T.Group position={rotation_target}>
  {#if bz_data}
    <!-- Brillouin zone surface mesh -->
    {#if bz_geometry}
      <T.Mesh
        geometry={bz_geometry}
        onpointermove={(e: ThreltePointerEvent) => handle_hover(e, false)}
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
        onpointermove={(e: ThreltePointerEvent) => handle_hover(e, true)}
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
      {#each bz_data.k_lattice as vec, idx (idx)}
        {@const scaled_vec = vec.map((x) => x * vector_scale) as Vec3}
        {@const label_position = scaled_vec.map((x) => x * 1.15) as Vec3}
        <Arrow
          position={[0, 0, 0]}
          vector={scaled_vec}
          color={vector_colors[idx]}
          scale={1}
        />
        <!-- Vector label beyond tip -->
        <extras.HTML center position={label_position}>
          <span
            style:color={vector_colors[idx]}
            style:font-size="1.2em"
          >
            {vector_labels[idx]}
          </span>
        </extras.HTML>
      {/each}
    {/if}

    <!-- K-path visualization -->
    {#if k_path_points && k_path_points.length > 1}
      {#each k_path_points.slice(0, -1) as
        from_point,
        idx
        (`${from_point}-${k_path_points[idx + 1]}#${idx}`)
      }
        {@const to_point = k_path_points[idx + 1]}
        {@const is_hovered = hovered_qpoint_index !== null &&
      (idx === hovered_qpoint_index || idx === hovered_qpoint_index - 1)}
        <Cylinder
          from={from_point as Vec3}
          to={to_point as Vec3}
          thickness={0.08}
          color={is_hovered ? `#ff6b35` : `#ffcc00`}
        />
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
          <extras.HTML center position={position.map((x) => x * 1.1) as Vec3}>
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
        <T.MeshStandardMaterial
          color="#ff0000"
          emissive="#ff0000"
          emissiveIntensity={1.2}
        />
      </T.Mesh>
    {/if}
  {/if}
</T.Group>

<style>
  :global(.brillouin-zone .responsive-gizmo) {
    width: clamp(70px, 18cqmin, 100px) !important;
    height: clamp(70px, 18cqmin, 100px) !important;
  }
</style>
