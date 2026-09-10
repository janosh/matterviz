<script lang="ts">
  // ReferencePlane: 3D reference planes (axis-aligned, normal-defined, or point-defined)
  import type { Vec2, Vec3 } from '$lib/math'
  import { cross_3d, normalize_vec } from '$lib/math'
  import { T } from '@threlte/core'
  import * as THREE from 'three/webgpu'
  import { create_to_threejs, span_or } from '$lib/plot/scatter-3d/scene-coords'
  import type { RefPlane } from '$lib/plot/core/types'

  let {
    ref_plane,
    scene_size = [10, 10, 5],
    ranges,
  }: {
    ref_plane: RefPlane
    scene_size?: Vec3
    ranges: { x: Vec2; y: Vec2; z: Vec2 }
  } = $props()

  let [scene_x, scene_y, scene_z] = $derived(scene_size)
  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)

  // Transform data coords to Three.js coordinates
  const to_coords = $derived(
    create_to_threejs({ scene_x, scene_y, scene_z, x_range, y_range, z_range }),
  )

  // Apply span constraints or use full range
  let [x_min, x_max] = $derived(span_or(ref_plane.x_span, x_range))
  let [y_min, y_max] = $derived(span_or(ref_plane.y_span, y_range))
  let [z_min, z_max] = $derived(span_or(ref_plane.z_span, z_range))

  // Quad geometry from 4 data-space corners (two triangles: 0-1-2 and 0-2-3)
  const quad = (corners: Vec3[]): THREE.BufferGeometry => {
    const [value_c_0, value_c_1, value_c_2, value_c_3] = corners.map((corner) =>
      to_coords(...corner),
    )
    const verts = [value_c_0, value_c_1, value_c_2, value_c_0, value_c_2, value_c_3].flatMap(
      (corner) => [corner.x, corner.y, corner.z],
    )
    const geo = new THREE.BufferGeometry()
    geo.setAttribute(`position`, new THREE.BufferAttribute(new Float32Array(verts), 3))
    geo.computeVertexNormals()
    return geo
  }

  // Compute plane geometry based on type - returns result to use in $effect
  function compute_geometry(): THREE.BufferGeometry | null {
    if (ref_plane.visible === false) return null

    if (ref_plane.type === `xy`) {
      const zval = ref_plane.z
      return quad([
        [x_min, y_min, zval],
        [x_max, y_min, zval],
        [x_max, y_max, zval],
        [x_min, y_max, zval],
      ])
    }
    if (ref_plane.type === `xz`) {
      const yval = ref_plane.y
      return quad([
        [x_min, yval, z_min],
        [x_max, yval, z_min],
        [x_max, yval, z_max],
        [x_min, yval, z_max],
      ])
    }
    if (ref_plane.type === `yz`) {
      const xval = ref_plane.x
      return quad([
        [xval, y_min, z_min],
        [xval, y_max, z_min],
        [xval, y_max, z_max],
        [xval, y_min, z_max],
      ])
    }
    if (ref_plane.type === `normal`) {
      if (Math.hypot(...ref_plane.normal) < 1e-9) return null // degenerate normal
      return create_plane_from_normal(ref_plane.normal, ref_plane.point)
    }
    if (ref_plane.type === `points`) {
      const { p1: point_1, p2: point, p3: point_3 } = ref_plane
      const vector_1: Vec3 = [
        point[0] - point_1[0],
        point[1] - point_1[1],
        point[2] - point_1[2],
      ]
      const vector_2: Vec3 = [
        point_3[0] - point_1[0],
        point_3[1] - point_1[1],
        point_3[2] - point_1[2],
      ]
      const cross = cross_3d(vector_1, vector_2)
      if (Math.hypot(...cross) < 1e-9) return null // collinear points
      return create_plane_from_normal(normalize_vec(cross), point_1)
    }
    return null
  }

  // Create geometry with proper disposal on dependency change
  let geometry: THREE.BufferGeometry | null = $state(null)

  $effect(() => {
    const geo = compute_geometry()
    geometry = geo
    return () => geo?.dispose()
  })

  // Create plane from normal and point, scaled to cover bounding box
  function create_plane_from_normal(normal: Vec3, point: Vec3): THREE.BufferGeometry {
    const normalized = normalize_vec(normal)
    // Pick u perpendicular to normal (use axis least aligned with normal)
    const u_dir = normalize_vec(
      cross_3d(normalized, Math.abs(normalized[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]),
    )
    const v_dir = cross_3d(normalized, u_dir)
    // Scale to cover bounding box
    const scale = Math.max(x_max - x_min, y_max - y_min, z_max - z_min) * 2
    const [pixel_x, pixel_y, pixel_z] = point
    // Helper to offset point by u*su + v*sv
    const corner = (offset_u: number, offset_v: number): Vec3 => [
      pixel_x + u_dir[0] * offset_u + v_dir[0] * offset_v,
      pixel_y + u_dir[1] * offset_u + v_dir[1] * offset_v,
      pixel_z + u_dir[2] * offset_u + v_dir[2] * offset_v,
    ]
    return quad([
      corner(-scale, -scale),
      corner(scale, -scale),
      corner(scale, scale),
      corner(-scale, scale),
    ])
  }

  // Material properties (with defaults)
  let style = $derived({
    color: ref_plane.style?.color ?? `#4488ff`,
    opacity: ref_plane.style?.opacity ?? 0.3,
    wireframe: ref_plane.style?.wireframe ?? false,
    wireframe_color: ref_plane.style?.wireframe_color ?? `white`,
    double_sided: ref_plane.style?.double_sided ?? true,
  })

  // Create wireframe geometry with automatic disposal when dependencies change
  let wireframe_geometry: THREE.WireframeGeometry | null = $state(null)

  $effect(() => {
    const wf_geo = geometry && style.wireframe ? new THREE.WireframeGeometry(geometry) : null
    wireframe_geometry = wf_geo
    return () => wf_geo?.dispose()
  })
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
