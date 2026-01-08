<script lang="ts">
  // ReferenceLine3D: 3D reference lines for axis-parallel, segments, and extended lines
  // Uses Line2 for proper variable-width lines (WebGL ignores linewidth on basic lines)
  import type { Vec3 } from '$lib/math'
  import { T, useThrelte } from '@threlte/core'
  import * as THREE from 'three'
  import { Line2 } from 'three/examples/jsm/lines/Line2.js'
  import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
  import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
  import { create_to_threejs, span_or } from './reference-line'
  import type { RefLine3D } from './types'

  let { ref_line, scene_size = [10, 10, 5], ranges }: {
    ref_line: RefLine3D
    scene_size?: Vec3
    ranges: { x: [number, number]; y: [number, number]; z: [number, number] }
  } = $props()

  const { size } = useThrelte()
  let [scene_x, scene_y, scene_z] = $derived(scene_size)
  let { x: x_range, y: y_range, z: z_range } = $derived(ranges)

  // Transform data coords to Three.js coordinates
  let to_coords = $derived.by(() => {
    const transform = create_to_threejs({
      scene_x,
      scene_y,
      scene_z,
      x_range,
      y_range,
      z_range,
    })
    return (ux: number, uy: number, uz: number) => transform(ux, uy, uz)
  })

  // Compute line endpoints based on type
  let endpoints = $derived.by(
    ():
      | [{ x: number; y: number; z: number }, { x: number; y: number; z: number }]
      | null => {
      if (ref_line.visible === false) return null
      const [x_min, x_max] = span_or(ref_line.x_span, x_range)
      const [y_min, y_max] = span_or(ref_line.y_span, y_range)
      const [z_min, z_max] = span_or(ref_line.z_span, z_range)

      switch (ref_line.type) {
        case `x-axis`:
          return [
            to_coords(x_min, ref_line.y, ref_line.z),
            to_coords(x_max, ref_line.y, ref_line.z),
          ]
        case `y-axis`:
          return [
            to_coords(ref_line.x, y_min, ref_line.z),
            to_coords(ref_line.x, y_max, ref_line.z),
          ]
        case `z-axis`:
          return [
            to_coords(ref_line.x, ref_line.y, z_min),
            to_coords(ref_line.x, ref_line.y, z_max),
          ]
        case `segment`:
          return [to_coords(...ref_line.p1), to_coords(...ref_line.p2)]
        case `line`: {
          // Extend line through two points to bounding box
          const [p1x, p1y, p1z] = ref_line.p1
          const [dx, dy, dz] = [
            ref_line.p2[0] - p1x,
            ref_line.p2[1] - p1y,
            ref_line.p2[2] - p1z,
          ]
          // Find t values at each boundary plane
          const t_values = [
            ...(dx !== 0 ? [(x_min - p1x) / dx, (x_max - p1x) / dx] : []),
            ...(dy !== 0 ? [(y_min - p1y) / dy, (y_max - p1y) / dy] : []),
            ...(dz !== 0 ? [(z_min - p1z) / dz, (z_max - p1z) / dz] : []),
          ]
          // Keep only t values where the resulting point is inside bounds
          const eps = 1e-6
          const valid_t = t_values.filter((t) => {
            const [px, py, pz] = [p1x + t * dx, p1y + t * dy, p1z + t * dz]
            return px >= x_min - eps && px <= x_max + eps &&
              py >= y_min - eps && py <= y_max + eps && pz >= z_min - eps &&
              pz <= z_max + eps
          })
          if (valid_t.length < 2) return null
          const t_min = Math.min(...valid_t)
          const t_max = Math.max(...valid_t)
          return [
            to_coords(p1x + t_min * dx, p1y + t_min * dy, p1z + t_min * dz),
            to_coords(p1x + t_max * dx, p1y + t_max * dy, p1z + t_max * dz),
          ]
        }
      }
    },
  )

  // Line style (with defaults)
  let style = $derived({
    color: ref_line.style?.color ?? `white`,
    opacity: ref_line.style?.opacity ?? 1,
    width: ref_line.style?.width ?? 2,
    dashed: !!ref_line.style?.dash,
  })

  // Create Line2 with LineGeometry and LineMaterial for proper variable-width lines
  let line2: Line2 | null = $state(null)
  let material: LineMaterial | null = $state(null)

  $effect(() => {
    if (!endpoints) {
      line2 = null
      material = null
      return
    }
    const [p1, p2] = endpoints

    const geo = new LineGeometry()
    geo.setPositions([p1.x, p1.y, p1.z, p2.x, p2.y, p2.z])

    const mat = new LineMaterial({
      color: new THREE.Color(style.color).getHex(),
      linewidth: style.width,
      transparent: style.opacity < 1,
      opacity: style.opacity,
      dashed: style.dashed,
      dashSize: 0.3,
      gapSize: 0.1,
      resolution: new THREE.Vector2($size.width || 1, $size.height || 1),
    })

    const line = new Line2(geo, mat)
    line.computeLineDistances() // Required for dashed lines

    material = mat
    line2 = line

    return () => {
      geo.dispose()
      mat.dispose()
    }
  })

  // Update material resolution when canvas size changes
  $effect(() => {
    if (material) {
      material.resolution.set($size.width || 1, $size.height || 1)
    }
  })
</script>

{#if line2}
  <T is={line2} />
{/if}
