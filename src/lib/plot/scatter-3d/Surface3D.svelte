<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import { normalize_to_scene } from '$lib/plot/core/reference-line'
  import type { Surface3DConfig } from '$lib/plot/core/types'
  import { dispose_on_change } from '$lib/scene'
  import { T } from '@threlte/core'
  import * as THREE from 'three/webgpu'

  let {
    config,
    x_range = [0, 1],
    y_range = [0, 1],
    z_range = [0, 1],
    scene_x = 10,
    scene_y = 10,
    scene_z = 5,
  }: {
    config: Surface3DConfig
    x_range?: Vec2
    y_range?: Vec2
    z_range?: Vec2
    scene_x?: number
    scene_y?: number
    scene_z?: number
  } = $props()

  // Calculate vertex color based on config. THREE.Color never throws on an unknown color
  // string: it warns and keeps the default white, so no fallback is needed here.
  function get_vertex_color(x_val: number, y_val: number, z_val: number): THREE.Color {
    if (config.color_fn) return new THREE.Color(config.color_fn(x_val, y_val, z_val))
    if (config.color) return new THREE.Color(config.color)
    // Default: color by z value (blue to red gradient)
    const z_norm = (z_val - z_range[0]) / (z_range[1] - z_range[0] || 1)
    return new THREE.Color().setHSL(0.66 - z_norm * 0.66, 0.8, 0.5)
  }

  // Add vertex position (with Y/Z swap for Three.js) and color to arrays
  function add_vertex(
    positions: number[],
    colors: number[],
    x_val: number,
    y_val: number,
    z_val: number,
  ): void {
    positions.push(
      normalize_to_scene(x_val, x_range, scene_x),
      normalize_to_scene(z_val, z_range, scene_z), // user Z → Three.js Y (vertical)
      normalize_to_scene(y_val, y_range, scene_y), // user Y → Three.js Z (depth)
    )
    const color = get_vertex_color(x_val, y_val, z_val)
    colors.push(color.r, color.g, color.b)
  }

  // Build geometry from positions/colors arrays with optional grid indices
  function build_geometry(
    positions: number[],
    colors: number[],
    res_a?: number,
    res_b?: number,
    triangles?: number[][],
  ): THREE.BufferGeometry {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    geom.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    // Set indices: either from explicit triangles or generate grid
    if (triangles?.length) {
      geom.setIndex(triangles.flat())
    } else if (res_a && res_b && res_a >= 2 && res_b >= 2) {
      const indices: number[] = []
      for (let ib = 0; ib < res_b - 1; ib++) {
        for (let ia = 0; ia < res_a - 1; ia++) {
          const tl = ib * res_a + ia
          indices.push(tl, tl + res_a, tl + 1, tl + 1, tl + res_a, tl + res_a + 1)
        }
      }
      geom.setIndex(indices)
    }
    geom.computeVertexNormals()
    return geom
  }

  // Parse resolution config into [res_a, res_b]
  const get_resolution = (): Vec2 =>
    Array.isArray(config.resolution)
      ? config.resolution
      : [config.resolution ?? 20, config.resolution ?? 20]

  function create_geometry(): THREE.BufferGeometry | null {
    const [res_a, res_b] = get_resolution()
    const positions: number[] = []
    const colors: number[] = []

    if (config.type === `grid` && config.z_fn) {
      if (res_a < 2 || res_b < 2) return new THREE.BufferGeometry()
      const [x0, x1] = config.x_range ?? x_range
      const [y0, y1] = config.y_range ?? y_range
      const x_step = (x1 - x0) / (res_a - 1)
      const y_step = (y1 - y0) / (res_b - 1)
      for (let ib = 0; ib < res_b; ib++) {
        for (let ia = 0; ia < res_a; ia++) {
          const x_val = x0 + ia * x_step
          const y_val = y0 + ib * y_step
          add_vertex(positions, colors, x_val, y_val, config.z_fn(x_val, y_val))
        }
      }
      return build_geometry(positions, colors, res_a, res_b)
    }

    if (config.type === `parametric` && config.parametric_fn) {
      if (res_a < 2 || res_b < 2) return new THREE.BufferGeometry()
      const [u0, u1] = config.u_range ?? [0, 1]
      const [v0, v1] = config.v_range ?? [0, 1]
      const u_step = (u1 - u0) / (res_a - 1)
      const v_step = (v1 - v0) / (res_b - 1)
      for (let ib = 0; ib < res_b; ib++) {
        for (let ia = 0; ia < res_a; ia++) {
          const pt = config.parametric_fn(u0 + ia * u_step, v0 + ib * v_step)
          add_vertex(positions, colors, pt.x, pt.y, pt.z)
        }
      }
      return build_geometry(positions, colors, res_a, res_b)
    }

    if (config.type === `triangulated` && config.points?.length) {
      for (const pt of config.points) {
        add_vertex(positions, colors, pt.x, pt.y, pt.z)
      }
      return build_geometry(positions, colors, undefined, undefined, config.triangles)
    }

    return null
  }

  // Geometries are derived so they rebuild with the config/ranges; dispose_on_change releases
  // the previous ones on every rebuild and on unmount. The wireframe only exists when shown and
  // gets its own disposer so toggling it doesn't release the still-rendered surface geometry.
  let geometry = $derived(create_geometry())
  let wireframe_geometry = $derived(
    config.wireframe && geometry ? new THREE.WireframeGeometry(geometry) : null,
  )
  dispose_on_change(() => [geometry])
  dispose_on_change(() => [wireframe_geometry])

  // Material properties
  let is_transparent = $derived((config.opacity ?? 1) < 1)
  let material_props = $derived({
    transparent: is_transparent,
    opacity: config.opacity ?? 1,
    side: (config.double_sided ?? is_transparent) ? THREE.DoubleSide : THREE.FrontSide,
    vertexColors: true,
    depthWrite: true,
  })

  let wireframe_props = $derived({
    color: config.wireframe_color ?? `#333`,
    linewidth: config.wireframe_width ?? 1,
    transparent: true,
    opacity: 0.5,
  })
</script>

{#if geometry}
  <T.Mesh>
    <T is={geometry} />
    <T.MeshStandardMaterial {...material_props} />
  </T.Mesh>

  {#if wireframe_geometry}
    <T.LineSegments>
      <T is={wireframe_geometry} />
      <T.LineBasicMaterial {...wireframe_props} />
    </T.LineSegments>
  {/if}
{/if}
