<script lang="ts">
  // ReferenceLine3D component for rendering 3D reference lines in Three.js
  // Supports axis-parallel lines, segments, and lines through two points
  import type { Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import { onDestroy } from 'svelte'
  import * as THREE from 'three'
  import { create_to_threejs } from './reference-line-utils'
  import type { RefLine3D } from './types'

  let {
    ref_line,
    scene_size = [10, 10, 5] as Vec3,
    ranges,
  }: {
    ref_line: RefLine3D
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

  // Compute line endpoints based on type
  let endpoints = $derived.by((): [THREE.Vector3, THREE.Vector3] | null => {
    if (ref_line.visible === false) return null

    // Apply span constraints or use full range
    const x_span = ref_line.x_span ?? [null, null]
    const y_span = ref_line.y_span ?? [null, null]
    const z_span = ref_line.z_span ?? [null, null]

    const x_min = x_span[0] ?? x_range[0]
    const x_max = x_span[1] ?? x_range[1]
    const y_min = y_span[0] ?? y_range[0]
    const y_max = y_span[1] ?? y_range[1]
    const z_min = z_span[0] ?? z_range[0]
    const z_max = z_span[1] ?? z_range[1]

    switch (ref_line.type) {
      case `x-axis`: {
        // Line parallel to x-axis at given y, z
        return [
          to_threejs(x_min, ref_line.y, ref_line.z),
          to_threejs(x_max, ref_line.y, ref_line.z),
        ]
      }
      case `y-axis`: {
        // Line parallel to y-axis at given x, z
        return [
          to_threejs(ref_line.x, y_min, ref_line.z),
          to_threejs(ref_line.x, y_max, ref_line.z),
        ]
      }
      case `z-axis`: {
        // Line parallel to z-axis at given x, y
        return [
          to_threejs(ref_line.x, ref_line.y, z_min),
          to_threejs(ref_line.x, ref_line.y, z_max),
        ]
      }
      case `segment`: {
        // Line segment between two points
        const [p1x, p1y, p1z] = ref_line.p1
        const [p2x, p2y, p2z] = ref_line.p2
        return [to_threejs(p1x, p1y, p1z), to_threejs(p2x, p2y, p2z)]
      }
      case `line`: {
        // Line through two points, extended to bounds
        // For simplicity, compute parametric extension to scene bounds
        const [p1x, p1y, p1z] = ref_line.p1
        const [p2x, p2y, p2z] = ref_line.p2

        // Direction vector
        const dx = p2x - p1x
        const dy = p2y - p1y
        const dz = p2z - p1z

        // Find t values where line intersects each bound
        const t_values: number[] = []

        // X bounds
        if (dx !== 0) {
          t_values.push((x_min - p1x) / dx)
          t_values.push((x_max - p1x) / dx)
        }
        // Y bounds
        if (dy !== 0) {
          t_values.push((y_min - p1y) / dy)
          t_values.push((y_max - p1y) / dy)
        }
        // Z bounds
        if (dz !== 0) {
          t_values.push((z_min - p1z) / dz)
          t_values.push((z_max - p1z) / dz)
        }

        // Find the valid t range where line is within all bounds
        let t_min = -Infinity
        let t_max = Infinity

        for (const t of t_values) {
          const pt_x = p1x + t * dx
          const pt_y = p1y + t * dy
          const pt_z = p1z + t * dz

          // Check if point is within bounds (with small tolerance)
          const eps = 1e-6
          const in_bounds = pt_x >= x_min - eps &&
            pt_x <= x_max + eps &&
            pt_y >= y_min - eps &&
            pt_y <= y_max + eps &&
            pt_z >= z_min - eps &&
            pt_z <= z_max + eps

          if (in_bounds) {
            t_min = Math.min(t_min, t)
            t_max = Math.max(t_max, t)
          }
        }

        if (!isFinite(t_min) || !isFinite(t_max)) {
          // Line doesn't intersect the visible region
          return null
        }

        return [
          to_threejs(p1x + t_min * dx, p1y + t_min * dy, p1z + t_min * dz),
          to_threejs(p1x + t_max * dx, p1y + t_max * dy, p1z + t_max * dz),
        ]
      }
      default:
        return null
    }
  })

  // Create line geometry
  let geometry = $derived.by(() => {
    if (!endpoints) return null
    const [p1, p2] = endpoints
    const geo = new THREE.BufferGeometry()
    geo.setFromPoints([p1, p2])
    return geo
  })

  // Line style
  let color = $derived(ref_line.style?.color ?? `white`)
  let opacity = $derived(ref_line.style?.opacity ?? 1)
  let line_width = $derived(ref_line.style?.width ?? 1)
  let dashed = $derived(!!ref_line.style?.dash)

  // Cleanup geometry on unmount to prevent memory leaks
  onDestroy(() => {
    geometry?.dispose()
  })
</script>

{#if geometry && endpoints}
  <T.Line {geometry}>
    {#if dashed}
      <T.LineDashedMaterial
        {color}
        {opacity}
        transparent={opacity < 1}
        linewidth={line_width}
        dashSize={3}
        gapSize={1}
      />
    {:else}
      <T.LineBasicMaterial
        {color}
        {opacity}
        transparent={opacity < 1}
        linewidth={line_width}
      />
    {/if}
  </T.Line>
{/if}
