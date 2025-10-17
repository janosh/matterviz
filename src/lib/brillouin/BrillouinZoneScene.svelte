<script lang="ts">
  import type { Vec3 } from '$lib'
  import { axis_colors, neg_axis_colors } from '$lib'
  import { type CameraProjection, DEFAULTS } from '$lib/settings'
  import { Cylinder, Vector } from '$lib/structure'
  import { T, useThrelte } from '@threlte/core'
  import * as extras from '@threlte/extras'
  import type { ComponentProps } from 'svelte'
  import { BufferAttribute, BufferGeometry, type Camera, type Scene } from 'three'
  import type { BrillouinZoneData } from './types'

  let {
    bz_data = $bindable(undefined),
    camera_position = $bindable(undefined),
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
    zoom_speed = DEFAULTS.structure.zoom_speed,
    pan_speed = DEFAULTS.structure.pan_speed,
    fov = DEFAULTS.structure.fov,
    initial_zoom = DEFAULTS.structure.initial_zoom,
    ambient_light = DEFAULTS.structure.ambient_light,
    directional_light = DEFAULTS.structure.directional_light,
    gizmo = DEFAULTS.structure.show_gizmo,
    auto_rotate = DEFAULTS.structure.auto_rotate,
    camera_is_moving = $bindable(false),
    scene = $bindable(undefined),
    camera = $bindable(undefined),
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
    zoom_speed?: number
    pan_speed?: number
    fov?: number
    initial_zoom?: number
    ambient_light?: number
    directional_light?: number
    gizmo?: boolean | ComponentProps<typeof extras.Gizmo>
    auto_rotate?: number
    camera_is_moving?: boolean
    scene?: Scene
    camera?: Camera
  } = $props()

  const threlte = useThrelte()
  $effect(() => {
    scene = threlte.scene
    camera = threlte.camera.current
  })

  extras.interactivity()

  const rotation_target: Vec3 = [0, 0, 0]

  // BZ size for camera positioning: average magnitude of k-vectors
  const bz_size = $derived.by(() => {
    if (!bz_data?.k_lattice) return 10
    const mags = bz_data.k_lattice.map((v) =>
      Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    )
    return mags.reduce((sum, mag) => sum + mag, 0) / 3
  })

  const computed_camera_position = $derived.by(() =>
    camera_position || ([10, 3, 8].map((x) => x * Math.max(1, bz_size)) as Vec3)
  )

  const gizmo_props = $derived.by(() => ({
    background: { enabled: false },
    className: `responsive-gizmo`,
    ...Object.fromEntries(
      [...axis_colors, ...neg_axis_colors].map(([axis, color, hover]) => [
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
  }))

  const is_ortho = $derived(camera_projection === `orthographic`)
  const orbit_controls_props = $derived({
    position: [0, 0, 0],
    target: rotation_target,
    enableZoom: zoom_speed > 0,
    zoomSpeed: is_ortho ? zoom_speed * 2 : zoom_speed,
    enablePan: pan_speed > 0,
    panSpeed: pan_speed,
    maxZoom: is_ortho ? max_zoom || 200 : max_zoom,
    minZoom: is_ortho ? min_zoom || 0.1 : min_zoom,
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

      for (let i = 1; i < face.length - 1; i++) {
        const indices = [face[0], face[i], face[i + 1]]
        if (indices.some((idx) => idx < 0 || idx >= bz_data.vertices.length)) continue
        const [v0, v1, v2] = indices.map((idx) => bz_data.vertices[idx])
        positions.push(...v0, ...v1, ...v2)

        // Compute normal via cross product
        const [e1, e2] = [[v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]], [
          v2[0] - v0[0],
          v2[1] - v0[1],
          v2[2] - v0[2],
        ]]
        const n = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ]
        const len = Math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
        const norm = len > 1e-10 ? n.map((x) => x / len) : [0, 0, 0]
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

  $effect(() => { // Dispose previous geometry on change/unmount (prevent memory leaks)
    return () => bz_geometry?.dispose()
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
    {#each bz_data.edges as edge_segment (edge_segment.map((v) => v.join(`,`)).join(`-`))}
      <Cylinder
        from={edge_segment[0]}
        to={edge_segment[1]}
        thickness={edge_width}
        color={edge_color}
      />
    {/each}

    <!-- Reciprocal lattice vectors -->
    {#if show_vectors && bz_data.k_lattice}
      {#each bz_data.k_lattice as vec, idx (idx)}
        {@const scaled_vec = vec.map((x) => x * vector_scale) as Vec3}
        {@const label_position = scaled_vec.map((x) => x * 1.15) as Vec3}
        <Vector
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
  {/if}
</T.Group>

<style>
  :global(.brillouin-zone .responsive-gizmo) {
    width: clamp(70px, 18cqmin, 100px) !important;
    height: clamp(70px, 18cqmin, 100px) !important;
  }
</style>
