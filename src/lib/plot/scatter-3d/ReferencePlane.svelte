<script lang="ts">
  // ReferencePlane: 3D reference planes (axis-aligned, normal-defined, or point-defined)
  import type { Vec2, Vec3 } from '#lib/math.js'
  import { cross_3d, normalize_vec, subtract } from '#lib/math.js'
  import { dispose_on_change, positions_geometry } from '#lib/scene/index.js'
  import { T } from '@threlte/core'
  import * as THREE from 'three/webgpu'
  import { create_to_threejs, span_or } from '#lib/plot/scatter-3d/scene-coords.js'
  import type { RefPlane } from '#lib/plot/core/types.js'

  let {
    ref_plane,
    ranges,
  }: {
    ref_plane: RefPlane
    ranges: { x: Vec2; y: Vec2; z: Vec2 }
  } = $props()

  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)
  const to_coords = $derived(create_to_threejs(ranges))

  let [x_min, x_max] = $derived(span_or(ref_plane.x_span, x_range))
  let [y_min, y_max] = $derived(span_or(ref_plane.y_span, y_range))
  let [z_min, z_max] = $derived(span_or(ref_plane.z_span, z_range))

  // Quad geometry from 4 data-space corners (two triangles: 0-1-2 and 0-2-3)
  const quad = (corners: Vec3[]): THREE.BufferGeometry => {
    const pts = corners.map((corner) => to_coords(...corner))
    const verts = [0, 1, 2, 0, 2, 3].flatMap((idx) => [pts[idx].x, pts[idx].y, pts[idx].z])
    const geo = positions_geometry(verts)
    geo.computeVertexNormals()
    return geo
  }

  let geometry = $derived.by((): THREE.BufferGeometry | null => {
    if (ref_plane.visible === false) return null
    if (ref_plane.type === `xy`) {
      return quad([
        [x_min, y_min, ref_plane.z],
        [x_max, y_min, ref_plane.z],
        [x_max, y_max, ref_plane.z],
        [x_min, y_max, ref_plane.z],
      ])
    }
    if (ref_plane.type === `xz`) {
      return quad([
        [x_min, ref_plane.y, z_min],
        [x_max, ref_plane.y, z_min],
        [x_max, ref_plane.y, z_max],
        [x_min, ref_plane.y, z_max],
      ])
    }
    if (ref_plane.type === `yz`) {
      return quad([
        [ref_plane.x, y_min, z_min],
        [ref_plane.x, y_max, z_min],
        [ref_plane.x, y_max, z_max],
        [ref_plane.x, y_min, z_max],
      ])
    }
    if (ref_plane.type === `normal`) {
      if (Math.hypot(...ref_plane.normal) < 1e-9) return null // degenerate normal
      return create_plane_from_normal(ref_plane.normal, ref_plane.point)
    }
    const { type } = ref_plane as { type: unknown }
    if (type !== `points`) throw new Error(`Unknown 3D ref plane type ${JSON.stringify(type)}`)
    // `points`: the plane through 3 points
    const { p1: point_1, p2: point_2, p3: point_3 } = ref_plane
    const cross = cross_3d(subtract(point_2, point_1), subtract(point_3, point_1))
    if (Math.hypot(...cross) < 1e-9) return null // collinear points
    return create_plane_from_normal(normalize_vec(cross), point_1)
  })
  dispose_on_change(() => [geometry])

  // Create plane from normal and point, scaled to cover bounding box
  function create_plane_from_normal(normal: Vec3, point: Vec3): THREE.BufferGeometry {
    const normalized = normalize_vec(normal)
    // Pick u perpendicular to normal (use axis least aligned with normal)
    const u_dir = normalize_vec(
      cross_3d(normalized, Math.abs(normalized[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]),
    )
    const v_dir = cross_3d(normalized, u_dir)
    // Scale to cover the bounding box, whichever way each axis runs
    const scale = Math.max(...[x_max - x_min, y_max - y_min, z_max - z_min].map(Math.abs)) * 2
    const corner = (u_off: number, v_off: number) =>
      point.map((coord, axis) => coord + u_dir[axis] * u_off + v_dir[axis] * v_off) as Vec3
    return quad([
      corner(-scale, -scale),
      corner(scale, -scale),
      corner(scale, scale),
      corner(-scale, scale),
    ])
  }

  let style = $derived({
    color: ref_plane.style?.color ?? `#4488ff`,
    opacity: ref_plane.style?.opacity ?? 0.3,
    wireframe: ref_plane.style?.wireframe ?? false,
    wireframe_color: ref_plane.style?.wireframe_color ?? `white`,
    double_sided: ref_plane.style?.double_sided ?? true,
  })

  let wireframe_geometry = $derived(
    geometry && style.wireframe ? new THREE.WireframeGeometry(geometry) : null,
  )
  dispose_on_change(() => [wireframe_geometry])
</script>

{#if geometry}
  <T.Mesh {geometry}>
    <T.MeshBasicMaterial
      color={style.color}
      opacity={style.opacity}
      transparent={true}
      side={style.double_sided ? THREE.DoubleSide : THREE.FrontSide}
      depthWrite={false}
    />
  </T.Mesh>

  {#if wireframe_geometry}
    <T.LineSegments geometry={wireframe_geometry}>
      <T.LineBasicMaterial color={style.wireframe_color} />
    </T.LineSegments>
  {/if}
{/if}
