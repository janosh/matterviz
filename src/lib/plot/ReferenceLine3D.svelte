<script lang="ts">
  // ReferenceLine3D component for rendering 3D reference lines in Three.js
  // Supports axis-parallel lines, segments, and lines through two points
  import type { Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import * as THREE from 'three'
  import { create_to_threejs } from './reference-line-utils'
  import type { RefLine3D } from './types'

  let { ref_line, scene_size = [10, 10, 5], ranges }: {
    ref_line: RefLine3D
    scene_size?: Vec3
    ranges: { x: [number, number]; y: [number, number]; z: [number, number] }
  } = $props()

  // Reference to the THREE.Line object for calling computeLineDistances()
  let line_ref: THREE.Line | undefined = $state()

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

  // Compute line endpoints based on type
  let endpoints = $derived.by((): [THREE.Vector3, THREE.Vector3] | null => {
    if (ref_line.visible === false) return null

    // Apply span constraints or use full range (helper to reduce repetition)
    const span_or = (
      span: [number | null, number | null] | undefined,
      range: [number, number],
    ) => [span?.[0] ?? range[0], span?.[1] ?? range[1]] as const
    const [x_min, x_max] = span_or(ref_line.x_span, x_range)
    const [y_min, y_max] = span_or(ref_line.y_span, y_range)
    const [z_min, z_max] = span_or(ref_line.z_span, z_range)

    const { type } = ref_line
    if (type === `x-axis`) {
      const p1 = to_vec3(x_min, ref_line.y, ref_line.z)
      const p2 = to_vec3(x_max, ref_line.y, ref_line.z)
      return [p1, p2]
    } else if (type === `y-axis`) {
      const p1 = to_vec3(ref_line.x, y_min, ref_line.z)
      const p2 = to_vec3(ref_line.x, y_max, ref_line.z)
      return [p1, p2]
    } else if (type === `z-axis`) {
      const p1 = to_vec3(ref_line.x, ref_line.y, z_min)
      const p2 = to_vec3(ref_line.x, ref_line.y, z_max)
      return [p1, p2]
    } else if (type === `segment`) {
      return [to_vec3(...ref_line.p1), to_vec3(...ref_line.p2)]
    } else if (type === `line`) {
      // Line through two points, extended to bounds
      const [p1x, p1y, p1z] = ref_line.p1
      const [p2x, p2y, p2z] = ref_line.p2

      // Direction vector
      const dx = p2x - p1x
      const dy = p2y - p1y
      const dz = p2z - p1z

      // Find t values where line intersects each bound
      const t_values: number[] = []
      if (dx !== 0) {
        t_values.push((x_min - p1x) / dx)
        t_values.push((x_max - p1x) / dx)
      }
      if (dy !== 0) {
        t_values.push((y_min - p1y) / dy)
        t_values.push((y_max - p1y) / dy)
      }
      if (dz !== 0) {
        t_values.push((z_min - p1z) / dz)
        t_values.push((z_max - p1z) / dz)
      }

      // Find the valid t range where line is within all bounds
      let t_min = -Infinity
      let t_max = Infinity
      const eps = 1e-6

      for (const t of t_values) {
        const pt_x = p1x + t * dx
        const pt_y = p1y + t * dy
        const pt_z = p1z + t * dz
        const in_bounds = pt_x >= x_min - eps && pt_x <= x_max + eps &&
          pt_y >= y_min - eps && pt_y <= y_max + eps &&
          pt_z >= z_min - eps && pt_z <= z_max + eps
        if (in_bounds) {
          t_min = Math.min(t_min, t)
          t_max = Math.max(t_max, t)
        }
      }

      if (!isFinite(t_min) || !isFinite(t_max)) return null

      return [
        to_vec3(p1x + t_min * dx, p1y + t_min * dy, p1z + t_min * dz),
        to_vec3(p1x + t_max * dx, p1y + t_max * dy, p1z + t_max * dz),
      ]
    }
    return null
  })

  // Line style (with defaults)
  let style = $derived({
    color: ref_line.style?.color ?? `white`,
    opacity: ref_line.style?.opacity ?? 1,
    width: ref_line.style?.width ?? 1,
    dashed: !!ref_line.style?.dash,
  })

  // Create line geometry with proper disposal on dependency change
  let geometry: THREE.BufferGeometry | null = $state(null)

  $effect(() => {
    if (!endpoints) {
      geometry = null
      return
    }
    const [p1, p2] = endpoints
    const geo = new THREE.BufferGeometry()
    geo.setFromPoints([p1, p2])
    geometry = geo
    return () => geo.dispose()
  })

  // LineDashedMaterial requires computeLineDistances() to render dashes properly
  $effect(() => {
    if (style.dashed && line_ref && geometry) line_ref.computeLineDistances()
  })
</script>

{#if geometry && endpoints}
  <T.Line {geometry} bind:ref={line_ref}>
    {#if style.dashed}
      <T.LineDashedMaterial
        color={style.color}
        opacity={style.opacity}
        transparent={style.opacity < 1}
        linewidth={style.width}
        dashSize={3}
        gapSize={1}
      />
    {:else}
      <T.LineBasicMaterial
        color={style.color}
        opacity={style.opacity}
        transparent={style.opacity < 1}
        linewidth={style.width}
      />
    {/if}
  </T.Line>
{/if}
