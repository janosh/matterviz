<script lang="ts">
  import type { Vec3 } from '$lib'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { T } from '@threlte/core'
  import { Euler, Quaternion, Vector3 } from 'three'

  interface Props {
    position: Vec3 // Starting position of the vector (atom position)
    vector: Vec3 // Vector components [x, y, z] in appropriate units
    scale?: number // Scale factor for vector visualization
    color?: string // Color of the vector
    // Arrow dimensions
    shaft_radius?: number
    arrow_head_radius?: number
    arrow_head_length?: number
  }
  let {
    position,
    vector,
    scale = DEFAULTS.structure.force_scale,
    color = DEFAULTS.structure.force_color,
    shaft_radius = DEFAULTS.structure.force_shaft_radius,
    arrow_head_radius = DEFAULTS.structure.force_arrow_head_radius,
    arrow_head_length = DEFAULTS.structure.force_arrow_head_length,
  }: Props = $props()

  // Calculate vector magnitude and normalized direction
  let vector_magnitude = $derived(Math.hypot(...vector))
  let vector_direction = $derived(
    vector_magnitude > math.EPS
      ? math.scale(vector, 1 / vector_magnitude)
      : [0, 1, 0],
  )

  // Scaled vector length
  let vector_length = $derived(vector_magnitude * scale)

  let shaft_length = $derived(
    Math.max(0, vector_length - arrow_head_length * 0.5),
  )

  // Calculate positions using math helpers
  let shaft_center = $derived(
    math.add(position, math.scale(vector_direction, shaft_length * 0.5)) as Vec3,
  )
  let arrow_head_position = $derived(
    math.add(
      position,
      math.scale(vector_direction, shaft_length + arrow_head_length * 0.5),
    ) as Vec3,
  )

  // Calculate rotation to align Y-axis with vector direction
  let rotation = $derived.by((): Vec3 => {
    if (vector_magnitude < math.EPS) return [0, 0, 0] // Handle zero vector

    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(...vector_direction).normalize(),
    )
    const euler = new Euler().setFromQuaternion(quaternion)
    return euler.toArray().slice(0, 3) as Vec3
  })
</script>

<!-- Vector shaft (cylinder) -->
{#if shaft_length > 0.01}
  <T.Mesh position={shaft_center} {rotation}>
    <T.CylinderGeometry args={[shaft_radius, shaft_radius, shaft_length, 12]} />
    <T.MeshStandardMaterial {color} />
  </T.Mesh>
{/if}

<!-- Arrow head (cone) -->
<T.Mesh position={arrow_head_position} {rotation}>
  <T.ConeGeometry args={[arrow_head_radius, arrow_head_length, 12]} />
  <T.MeshStandardMaterial {color} />
</T.Mesh>
