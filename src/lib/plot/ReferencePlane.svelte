<script lang="ts">
  // ReferencePlane component for rendering 3D reference planes in Three.js
  // Supports axis-aligned planes (xy, xz, yz), normal-defined, and point-defined planes
  import type { Vec3 } from '$lib/math'
  import { cross_3d, normalize_vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import * as THREE from 'three'
  import { create_to_threejs } from './reference-line-utils'
  import type { RefPlane } from './types'

  let { ref_plane, scene_size = [10, 10, 5], ranges }: {
    ref_plane: RefPlane
    scene_size?: Vec3
    ranges: { x: [number, number]; y: [number, number]; z: [number, number] }
  } = $props()

  // Destructure for convenience
  let [scene_x, scene_y, scene_z] = $derived(scene_size)
  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)

  // Coordinate transform from user data space to Three.js space
  let to_vec3 = $derived.by(() => {
    const params = { scene_x, scene_y, scene_z, x_range, y_range, z_range }
    const transform = create_to_threejs(params)
    return (ux: number, uy: number, uz: number) => {
      const pos = transform(ux, uy, uz)
      return new THREE.Vector3(pos.x, pos.y, pos.z)
    }
  })

  // Apply span constraints or use full range (helper reduces repetition)
  const span_or = (
    span: [number | null, number | null] | undefined,
    range: [number, number],
  ) => [span?.[0] ?? range[0], span?.[1] ?? range[1]] as const
  let [x_min, x_max] = $derived(span_or(ref_plane.x_span, x_range))
  let [y_min, y_max] = $derived(span_or(ref_plane.y_span, y_range))
  let [z_min, z_max] = $derived(span_or(ref_plane.z_span, z_range))

  // Helper to create quad from 4 corner coords
  function quad(coords: [number, number, number][]) {
    return create_quad_geometry(coords.map(([ux, uy, uz]) => to_vec3(ux, uy, uz)))
  }

  // Compute plane geometry based on type - returns result to use in $effect
  function compute_geometry(): THREE.BufferGeometry | null {
    if (ref_plane.visible === false) return null

    switch (ref_plane.type) {
      case `xy`:
        return quad([[x_min, y_min, ref_plane.z], [x_max, y_min, ref_plane.z], [
          x_max,
          y_max,
          ref_plane.z,
        ], [x_min, y_max, ref_plane.z]])
      case `xz`:
        return quad([[x_min, ref_plane.y, z_min], [x_max, ref_plane.y, z_min], [
          x_max,
          ref_plane.y,
          z_max,
        ], [x_min, ref_plane.y, z_max]])
      case `yz`:
        return quad([[ref_plane.x, y_min, z_min], [ref_plane.x, y_max, z_min], [
          ref_plane.x,
          y_max,
          z_max,
        ], [ref_plane.x, y_min, z_max]])
      case `normal`:
        return create_plane_from_normal(ref_plane.normal, ref_plane.point)
      case `points`: {
        const { p1, p2, p3 } = ref_plane
        const v1: Vec3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
        const v2: Vec3 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]]
        return create_plane_from_normal(normalize_vec3(cross_3d(v1, v2)), p1)
      }
      default:
        return null
    }
  }

  // Create geometry with proper disposal on dependency change
  let geometry: THREE.BufferGeometry | null = $state(null)

  $effect(() => {
    const geo = compute_geometry()
    geometry = geo
    return () => geo?.dispose()
  })

  // Create a quad geometry from 4 corners (two triangles: 0-1-2 and 0-2-3)
  function create_quad_geometry(corners: THREE.Vector3[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    const [c0, c1, c2, c3] = corners
    const verts = [c0, c1, c2, c0, c2, c3].flatMap((c) => [c.x, c.y, c.z])
    geo.setAttribute(
      `position`,
      new THREE.BufferAttribute(new Float32Array(verts), 3),
    )
    geo.computeVertexNormals()
    return geo
  }

  // Create plane from normal and point, clipped to bounding box
  function create_plane_from_normal(
    normal: [number, number, number],
    point: [number, number, number],
  ): THREE.BufferGeometry {
    // For simplicity, create a large quad perpendicular to normal, then clip
    // This is an approximation - for precise clipping we'd need proper 3D CSG

    // Find two vectors perpendicular to normal
    const n = normalize_vec3(normal)
    let u: Vec3, v: Vec3

    // Choose a vector not parallel to n
    if (Math.abs(n[0]) < 0.9) {
      u = normalize_vec3(cross_3d(n, [1, 0, 0]))
    } else {
      u = normalize_vec3(cross_3d(n, [0, 1, 0]))
    }
    v = cross_3d(n, u)

    // Scale to roughly cover the bounding box
    const scale = Math.max(
      x_max - x_min,
      y_max - y_min,
      z_max - z_min,
    ) * 2

    // Create 4 corners of the plane quad
    const center = to_vec3(point[0], point[1], point[2])
    const u_scaled = new THREE.Vector3(u[0], u[1], u[2]).multiplyScalar(scale)
    const v_scaled = new THREE.Vector3(v[0], v[1], v[2]).multiplyScalar(scale)

    const corners = [
      center.clone().sub(u_scaled).sub(v_scaled),
      center.clone().add(u_scaled).sub(v_scaled),
      center.clone().add(u_scaled).add(v_scaled),
      center.clone().sub(u_scaled).add(v_scaled),
    ]

    return create_quad_geometry(corners)
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
    const wf_geo = geometry && style.wireframe
      ? new THREE.WireframeGeometry(geometry)
      : null
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
