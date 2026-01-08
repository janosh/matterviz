<script lang="ts">
  // ReferencePlane component for rendering 3D reference planes in Three.js
  // Supports axis-aligned planes (xy, xz, yz), normal-defined, and point-defined planes
  import type { Vec3 } from '$lib/math'
  import { cross_3d, normalize_vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import * as THREE from 'three'
  import { create_to_threejs, span_or } from './reference-line-utils'
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
        // Check for degenerate normal (near-zero length)
        const normal_len = Math.hypot(...ref_plane.normal)
        if (normal_len < 1e-9) return null
        return create_plane_from_normal(ref_plane.normal, ref_plane.point)
      }
      case `points`: {
        const { p1, p2, p3 } = ref_plane
        const v1: Vec3 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]
        const v2: Vec3 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]]
        const cross = cross_3d(v1, v2)
        // Check for degenerate case (collinear points produce zero cross product)
        const cross_len = Math.hypot(...cross)
        if (cross_len < 1e-9) return null
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

  // Create plane from normal and point, clipped to bounding box
  // Constructs corners in data space then transforms each to Three.js space
  // to correctly handle non-uniform axis scaling
  function create_plane_from_normal(
    normal: [number, number, number],
    point: [number, number, number],
  ): THREE.BufferGeometry {
    // Find two vectors perpendicular to normal (in data space)
    const normalized = normalize_vec3(normal)
    let u_dir: Vec3, v_dir: Vec3

    // Choose a vector not parallel to normal
    if (Math.abs(normalized[0]) < 0.9) {
      u_dir = normalize_vec3(cross_3d(normalized, [1, 0, 0]))
    } else {
      u_dir = normalize_vec3(cross_3d(normalized, [0, 1, 0]))
    }
    v_dir = cross_3d(normalized, u_dir)

    // Scale to roughly cover the bounding box in data space
    const data_scale = Math.max(
      x_max - x_min,
      y_max - y_min,
      z_max - z_min,
    ) * 2

    // Create 4 corners in data space, then transform to Three.js space
    const [px, py, pz] = point
    const data_corners: [number, number, number][] = [
      [
        px - u_dir[0] * data_scale - v_dir[0] * data_scale,
        py - u_dir[1] * data_scale - v_dir[1] * data_scale,
        pz - u_dir[2] * data_scale - v_dir[2] * data_scale,
      ],
      [
        px + u_dir[0] * data_scale - v_dir[0] * data_scale,
        py + u_dir[1] * data_scale - v_dir[1] * data_scale,
        pz + u_dir[2] * data_scale - v_dir[2] * data_scale,
      ],
      [
        px + u_dir[0] * data_scale + v_dir[0] * data_scale,
        py + u_dir[1] * data_scale + v_dir[1] * data_scale,
        pz + u_dir[2] * data_scale + v_dir[2] * data_scale,
      ],
      [
        px - u_dir[0] * data_scale + v_dir[0] * data_scale,
        py - u_dir[1] * data_scale + v_dir[1] * data_scale,
        pz - u_dir[2] * data_scale + v_dir[2] * data_scale,
      ],
    ]

    // Transform each corner from data space to Three.js space
    return create_quad_geometry(
      data_corners.map(([ux, uy, uz]) => to_vec3(ux, uy, uz)),
    )
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
