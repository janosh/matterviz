<script lang="ts">
  // ReferencePlane: 3D reference planes (axis-aligned, normal-defined, or point-defined)
  import type { Vec3 } from '$lib/math'
  import { cross_3d, normalize_vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import * as THREE from 'three'
  import { create_to_threejs, span_or } from './reference-line'
  import type { RefPlane } from './types'

  let { ref_plane, scene_size = [10, 10, 5], ranges }: {
    ref_plane: RefPlane
    scene_size?: Vec3
    ranges: { x: [number, number]; y: [number, number]; z: [number, number] }
  } = $props()

  let [scene_x, scene_y, scene_z] = $derived(scene_size)
  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)

  // Transform data coords to Three.js Vector3
  let to_vec3 = $derived.by(() => {
    const transform = create_to_threejs({
      scene_x,
      scene_y,
      scene_z,
      x_range,
      y_range,
      z_range,
    })
    return (ux: number, uy: number, uz: number) => {
      const { x, y, z } = transform(ux, uy, uz)
      return new THREE.Vector3(x, y, z)
    }
  })

  // Apply span constraints or use full range
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
      case `xy`: {
        const zval = ref_plane.z
        return quad([
          [x_min, y_min, zval],
          [x_max, y_min, zval],
          [x_max, y_max, zval],
          [x_min, y_max, zval],
        ])
      }
      case `xz`: {
        const yval = ref_plane.y
        return quad([
          [x_min, yval, z_min],
          [x_max, yval, z_min],
          [x_max, yval, z_max],
          [x_min, yval, z_max],
        ])
      }
      case `yz`: {
        const xval = ref_plane.x
        return quad([
          [xval, y_min, z_min],
          [xval, y_max, z_min],
          [xval, y_max, z_max],
          [xval, y_min, z_max],
        ])
      }
      case `normal`: {
        if (Math.hypot(...ref_plane.normal) < 1e-9) return null // degenerate normal
        return create_plane_from_normal(ref_plane.normal, ref_plane.point)
      }
      case `points`: {
        const { p1, p2, p3 } = ref_plane
        const v1: Vec3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
        const v2: Vec3 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]]
        const cross = cross_3d(v1, v2)
        if (Math.hypot(...cross) < 1e-9) return null // collinear points
        return create_plane_from_normal(normalize_vec3(cross), p1)
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

  // Create plane from normal and point, scaled to cover bounding box
  function create_plane_from_normal(
    normal: [number, number, number],
    point: [number, number, number],
  ): THREE.BufferGeometry {
    const normalized = normalize_vec3(normal)
    // Pick u perpendicular to normal (use axis least aligned with normal)
    const u_dir = normalize_vec3(
      cross_3d(normalized, Math.abs(normalized[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]),
    )
    const v_dir = cross_3d(normalized, u_dir)
    // Scale to cover bounding box
    const scale = Math.max(x_max - x_min, y_max - y_min, z_max - z_min) * 2
    const [px, py, pz] = point
    // Helper to offset point by u*su + v*sv
    const corner = (su: number, sv: number): Vec3 => [
      px + u_dir[0] * su + v_dir[0] * sv,
      py + u_dir[1] * su + v_dir[1] * sv,
      pz + u_dir[2] * su + v_dir[2] * sv,
    ]
    const corners = [
      corner(-scale, -scale),
      corner(scale, -scale),
      corner(scale, scale),
      corner(-scale, scale),
    ]
    return create_quad_geometry(corners.map(([ux, uy, uz]) => to_vec3(ux, uy, uz)))
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
