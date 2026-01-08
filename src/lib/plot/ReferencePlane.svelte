<script lang="ts">
  // ReferencePlane component for rendering 3D reference planes in Three.js
  // Supports axis-aligned planes (xy, xz, yz), normal-defined, and point-defined planes
  import { cross_3d, normalize_vec3 } from '$lib/math'
  import type { Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import { onDestroy } from 'svelte'
  import * as THREE from 'three'
  import { create_to_threejs } from './reference-line-utils'
  import type { RefPlane } from './types'

  let {
    ref_plane,
    scene_size = [10, 10, 5] as Vec3,
    ranges,
  }: {
    ref_plane: RefPlane
    scene_size?: Vec3
    ranges: { x: [number, number]; y: [number, number]; z: [number, number] }
  } = $props()

  // Destructure for convenience
  let [scene_x, scene_y, scene_z] = $derived(scene_size)
  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)

  // Use shared coordinate transform (returns {x, y, z} object)
  let to_data = $derived(
    create_to_threejs({ scene_x, scene_y, scene_z, x_range, y_range, z_range }),
  )

  // Convert to THREE.Vector3
  function to_threejs(
    user_x: number,
    user_y: number,
    user_z: number,
  ): THREE.Vector3 {
    const pos = to_data(user_x, user_y, user_z)
    return new THREE.Vector3(pos.x, pos.y, pos.z)
  }

  // Apply span constraints or use full range
  let x_span = $derived(ref_plane.x_span ?? [null, null])
  let y_span = $derived(ref_plane.y_span ?? [null, null])
  let z_span = $derived(ref_plane.z_span ?? [null, null])

  let x_min = $derived(x_span[0] ?? x_range[0])
  let x_max = $derived(x_span[1] ?? x_range[1])
  let y_min = $derived(y_span[0] ?? y_range[0])
  let y_max = $derived(y_span[1] ?? y_range[1])
  let z_min = $derived(z_span[0] ?? z_range[0])
  let z_max = $derived(z_span[1] ?? z_range[1])

  // Compute plane geometry based on type
  let geometry = $derived.by((): THREE.BufferGeometry | null => {
    if (ref_plane.visible === false) return null

    switch (ref_plane.type) {
      case `xy`: {
        // Horizontal plane at z = value
        const corners = [
          to_threejs(x_min, y_min, ref_plane.z),
          to_threejs(x_max, y_min, ref_plane.z),
          to_threejs(x_max, y_max, ref_plane.z),
          to_threejs(x_min, y_max, ref_plane.z),
        ]
        return create_quad_geometry(corners)
      }
      case `xz`: {
        // Vertical plane at y = value
        const corners = [
          to_threejs(x_min, ref_plane.y, z_min),
          to_threejs(x_max, ref_plane.y, z_min),
          to_threejs(x_max, ref_plane.y, z_max),
          to_threejs(x_min, ref_plane.y, z_max),
        ]
        return create_quad_geometry(corners)
      }
      case `yz`: {
        // Vertical plane at x = value
        const corners = [
          to_threejs(ref_plane.x, y_min, z_min),
          to_threejs(ref_plane.x, y_max, z_min),
          to_threejs(ref_plane.x, y_max, z_max),
          to_threejs(ref_plane.x, y_min, z_max),
        ]
        return create_quad_geometry(corners)
      }
      case `normal`: {
        // Plane defined by normal and point
        // Find intersection with bounding box and create polygon
        const plane_geo = create_plane_from_normal(
          ref_plane.normal,
          ref_plane.point,
        )
        return plane_geo
      }
      case `points`: {
        // Plane through 3 points
        const p1 = to_threejs(ref_plane.p1[0], ref_plane.p1[1], ref_plane.p1[2])
        const p2 = to_threejs(ref_plane.p2[0], ref_plane.p2[1], ref_plane.p2[2])
        const p3 = to_threejs(ref_plane.p3[0], ref_plane.p3[1], ref_plane.p3[2])

        // Compute normal from 3 points
        const v1: Vec3 = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z]
        const v2: Vec3 = [p3.x - p1.x, p3.y - p1.y, p3.z - p1.z]
        const normal = normalize_vec3(cross_3d(v1, v2))

        // Create plane from normal and first point (in user coords)
        return create_plane_from_normal(
          normal,
          [ref_plane.p1[0], ref_plane.p1[1], ref_plane.p1[2]],
        )
      }
      default:
        return null
    }
  })

  // Create a quad geometry from 4 corners
  function create_quad_geometry(corners: THREE.Vector3[]): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry()
    const vertices = new Float32Array([
      // Triangle 1
      corners[0].x,
      corners[0].y,
      corners[0].z,
      corners[1].x,
      corners[1].y,
      corners[1].z,
      corners[2].x,
      corners[2].y,
      corners[2].z,
      // Triangle 2
      corners[0].x,
      corners[0].y,
      corners[0].z,
      corners[2].x,
      corners[2].y,
      corners[2].z,
      corners[3].x,
      corners[3].y,
      corners[3].z,
    ])
    geo.setAttribute(`position`, new THREE.BufferAttribute(vertices, 3))
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
    const center = to_threejs(point[0], point[1], point[2])
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

  // Material properties
  let color = $derived(ref_plane.style?.color ?? `#4488ff`)
  let opacity = $derived(ref_plane.style?.opacity ?? 0.3)
  let wireframe = $derived(ref_plane.style?.wireframe ?? false)
  let wireframe_color = $derived(ref_plane.style?.wireframe_color ?? `white`)
  let double_sided = $derived(ref_plane.style?.double_sided ?? true)

  // Cleanup geometry on unmount to prevent memory leaks
  onDestroy(() => {
    geometry?.dispose()
  })
</script>

{#if geometry}
  <T.Mesh {geometry}>
    <T.MeshBasicMaterial
      {color}
      {opacity}
      transparent={true}
      side={double_sided ? THREE.DoubleSide : THREE.FrontSide}
      depthWrite={false}
    />
  </T.Mesh>

  {#if wireframe}
    <T.LineSegments geometry={new THREE.WireframeGeometry(geometry)}>
      <T.LineBasicMaterial color={wireframe_color} />
    </T.LineSegments>
  {/if}
{/if}
