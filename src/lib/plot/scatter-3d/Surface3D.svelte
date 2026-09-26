<script lang="ts">
  import type { Vec2 } from '$lib/math'
  import { normalize_to_scene, surface_vertices } from '$lib/plot/scatter-3d/scene-coords'
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

  // Scene geometry from the shared vertex grid (the same vertices the axis bounds sample).
  // A non-finite vertex (z_fn undefined off its domain) leaves a hole: triangles touching it
  // are dropped so NaN doesn't spread into neighbouring normals, and it is parked at the
  // origin so bounds stay finite.
  function create_geometry(): THREE.BufferGeometry | null {
    const vertices = surface_vertices(config, { x: x_range, y: y_range })
    if (!vertices) return null
    const { points, grid, triangles } = vertices
    const positions: number[] = []
    const colors: number[] = []
    const valid: boolean[] = []
    for (const { x: x_val, y: y_val, z: z_val } of points) {
      const is_valid =
        Number.isFinite(x_val) && Number.isFinite(y_val) && Number.isFinite(z_val)
      valid.push(is_valid)
      if (!is_valid) {
        positions.push(0, 0, 0)
        colors.push(0, 0, 0)
        continue
      }
      positions.push(
        normalize_to_scene(x_val, x_range, scene_x),
        normalize_to_scene(z_val, z_range, scene_z), // user Z → Three.js Y (vertical)
        normalize_to_scene(y_val, y_range, scene_y), // user Y → Three.js Z (depth)
      )
      const color = get_vertex_color(x_val, y_val, z_val)
      colors.push(color.r, color.g, color.b)
    }
    const indices: number[] = []
    const add_triangle = (idx_0: number, idx_1: number, idx_2: number) => {
      if (valid[idx_0] && valid[idx_1] && valid[idx_2]) indices.push(idx_0, idx_1, idx_2)
    }
    if (triangles?.length) {
      for (const [idx_0, idx_1, idx_2] of triangles) add_triangle(idx_0, idx_1, idx_2)
    } else if (grid) {
      const [res_a, res_b] = grid
      for (let index_b = 0; index_b < res_b - 1; index_b++) {
        for (let index_a = 0; index_a < res_a - 1; index_a++) {
          const top_left = index_b * res_a + index_a
          add_triangle(top_left, top_left + res_a, top_left + 1)
          add_triangle(top_left + 1, top_left + res_a, top_left + res_a + 1)
        }
      }
    } else {
      // Triangulated without explicit triangles: consecutive vertex triples, as three draws
      // an unindexed geometry
      for (let idx = 0; idx + 2 < points.length; idx += 3) add_triangle(idx, idx + 1, idx + 2)
    }
    const geom = new THREE.BufferGeometry()
    geom.setAttribute(`position`, new THREE.Float32BufferAttribute(positions, 3))
    geom.setAttribute(`color`, new THREE.Float32BufferAttribute(colors, 3))
    geom.setIndex(indices)
    geom.computeVertexNormals()
    return geom
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
    <T is={geometry} dispose={false} />
    <T.MeshStandardMaterial {...material_props} />
  </T.Mesh>

  {#if wireframe_geometry}
    <T.LineSegments>
      <T is={wireframe_geometry} dispose={false} />
      <T.LineBasicMaterial {...wireframe_props} />
    </T.LineSegments>
  {/if}
{/if}
