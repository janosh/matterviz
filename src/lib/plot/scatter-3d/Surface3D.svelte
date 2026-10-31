<script lang="ts">
  import type { Vec2 } from '#lib/math.js'
  import {
    normalize_to_scene,
    SCENE_SIZE,
    surface_vertices,
  } from '#lib/plot/scatter-3d/scene-coords.js'
  import type { Surface3DConfig } from '#lib/plot/core/types.js'
  import { depth_prepass_props, dispose_on_change } from '#lib/scene/index.js'
  import { T } from '@threlte/core'
  import * as THREE from 'three/webgpu'

  let {
    config,
    x_range = [0, 1],
    y_range = [0, 1],
    z_range = [0, 1],
    scene_x = SCENE_SIZE[0],
    scene_y = SCENE_SIZE[1],
    scene_z = SCENE_SIZE[2],
  }: {
    config: Surface3DConfig
    x_range?: Vec2
    y_range?: Vec2
    z_range?: Vec2
    scene_x?: number
    scene_y?: number
    scene_z?: number
  } = $props()

  // The config fields the geometry reads, as a plain object kept while they keep their values,
  // so restyling a surface (opacity, wireframe, double_sided) rebuilds no geometry. A field
  // edited in place on a $state config still rebuilds: the geometry reads through it.
  const shape_of = (surface: Surface3DConfig) => ({
    type: surface.type,
    resolution: surface.resolution,
    x_range: surface.x_range,
    y_range: surface.y_range,
    u_range: surface.u_range,
    v_range: surface.v_range,
    z_fn: surface.z_fn,
    parametric_fn: surface.parametric_fn,
    points: surface.points,
    triangles: surface.triangles,
    color: surface.color,
    color_fn: surface.color_fn,
  })
  let prev_shape: ReturnType<typeof shape_of> | null = null
  const shape = $derived.by(() => {
    const [prev, next] = [prev_shape, shape_of(config)]
    const keys = Object.keys(next) as (keyof typeof next)[]
    if (prev && keys.every((key) => prev[key] === next[key])) return prev
    return (prev_shape = next)
  })

  // Scene geometry from the shared vertex grid (the same vertices the axis bounds sample).
  // A non-finite vertex (z_fn undefined off its domain) leaves a hole: triangles touching it
  // are dropped so NaN doesn't spread into neighbouring normals, and it is parked at the
  // origin so bounds stay finite. Vertex colours come from color_fn, else color, else a blue
  // to red gradient over z; each distinct colour string is parsed once (THREE.Color never
  // throws on an unknown one: it warns and keeps the default white).
  function create_geometry(
    surface: ReturnType<typeof shape_of>,
    [ranges_x, ranges_y, ranges_z]: [Vec2, Vec2, Vec2],
    [size_x, size_y, size_z]: [number, number, number],
  ): THREE.BufferGeometry | null {
    const vertices = surface_vertices(surface, { x: ranges_x, y: ranges_y })
    if (!vertices) return null
    const { points, grid, triangles } = vertices
    const positions = new Float32Array(points.length * 3)
    const colors = new Float32Array(points.length * 3)
    const valid = new Uint8Array(points.length)
    const { color, color_fn } = surface
    const parsed = new Map<string, THREE.Color>()
    const parse = (css: string): THREE.Color => {
      let rgb = parsed.get(css)
      if (!rgb) parsed.set(css, (rgb = new THREE.Color(css)))
      return rgb
    }
    const gradient = new THREE.Color()
    const z_span = ranges_z[1] - ranges_z[0] || 1
    for (let idx = 0; idx < points.length; idx++) {
      const { x: x_val, y: y_val, z: z_val } = points[idx]
      if (!(Number.isFinite(x_val) && Number.isFinite(y_val) && Number.isFinite(z_val)))
        continue
      valid[idx] = 1
      positions[3 * idx] = normalize_to_scene(x_val, ranges_x, size_x)
      positions[3 * idx + 1] = normalize_to_scene(z_val, ranges_z, size_z) // user Z → Three.js Y
      positions[3 * idx + 2] = normalize_to_scene(y_val, ranges_y, size_y) // user Y → Three.js Z
      const rgb = color_fn
        ? parse(color_fn(x_val, y_val, z_val))
        : color
          ? parse(color)
          : gradient.setHSL(0.66 - ((z_val - ranges_z[0]) / z_span) * 0.66, 0.8, 0.5)
      rgb.toArray(colors, 3 * idx)
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
    geom.setAttribute(`position`, new THREE.BufferAttribute(positions, 3))
    geom.setAttribute(`color`, new THREE.BufferAttribute(colors, 3))
    geom.setIndex(indices)
    geom.computeVertexNormals()
    return geom
  }

  let geometry = $derived(
    create_geometry(shape, [x_range, y_range, z_range], [scene_x, scene_y, scene_z]),
  )
  // Separate disposers so toggling the wireframe doesn't release the rendered surface geometry
  let wireframe_geometry = $derived(
    config.wireframe && geometry ? new THREE.WireframeGeometry(geometry) : null,
  )
  dispose_on_change(() => [geometry])
  dispose_on_change(() => [wireframe_geometry])

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
  <!-- Depth-only pre-pass (see depth_prepass_props): where a translucent surface folds over
    itself, its far layer would otherwise show through the near one in stripes along the grid.
    Same position and renderOrder as the surface and created before it, so three's stable
    (renderOrder, depth, id) sort draws it right before, still depth-sorted against other
    objects. Same side, or it would hide front faces behind back faces the surface culls -->
  <T.Mesh visible={is_transparent}>
    <T is={geometry} dispose={false} />
    <T.MeshBasicMaterial side={material_props.side} {...depth_prepass_props(4)} />
  </T.Mesh>
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
