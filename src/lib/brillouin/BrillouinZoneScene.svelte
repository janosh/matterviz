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
  import { BufferAttribute, BufferGeometry, type Camera, type Scene } from 'three'
  import type { BrillouinZoneData } from './types'

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

  // Create BZ mesh geometry from faces with fan triangulation
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

        // Compute normal via cross product
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
    const prev_geometry = bz_geometry // Dispose previous geometry on change/unmount; prevents memory leaks
    return () => prev_geometry?.dispose() // (need to assign to a variable in function so closure captures old value)
  })
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
      <T.Mesh geometry={bz_geometry}>
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
    {#each bz_data.edges as edge_segment (JSON.stringify(edge_segment))}
      {@const [from, to] = edge_segment}
      <Cylinder {from} {to} thickness={edge_width} color={edge_color} />
    {/each}

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
        (`${from_point}${k_path_points[idx + 1]}`)
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
