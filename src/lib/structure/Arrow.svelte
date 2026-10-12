<script lang="ts">
  import type { Vec3 } from '#lib/math.js'
  import { DEFAULTS } from '#lib/settings.js'
  import { T } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { arrow_axis_geometry } from './geometry'
  import { resolve_arrow_size } from './vectors'

  let {
    position,
    vector,
    scale = DEFAULTS.structure.vector_scale,
    color = DEFAULTS.structure.vector_color,
    shaft_radius = DEFAULTS.structure.vector_shaft_radius,
    arrow_head_radius = DEFAULTS.structure.vector_arrow_head_radius,
    arrow_head_length = DEFAULTS.structure.vector_arrow_head_length,
    ...rest
  }: ComponentProps<typeof T.Mesh> & {
    position: Vec3
    vector: Vec3
    scale?: number
    color?: string
    shaft_radius?: number // negative = relative to length
    arrow_head_radius?: number
    arrow_head_length?: number
  } = $props()

  const geometry = $derived(arrow_axis_geometry(vector, scale, arrow_head_length))
  // negative radii are fractions of the shaft length
  const shaft_r = $derived(resolve_arrow_size(shaft_radius, geometry.shaft_length))
  const head_r = $derived(resolve_arrow_size(arrow_head_radius, geometry.shaft_length))
</script>

<T.Group {position} rotation={geometry.rotation}>
  {#if geometry.shaft_length > 0.01}
    <T.Mesh {...rest} position={[0, geometry.shaft_center, 0]}>
      <T.CylinderGeometry args={[shaft_r, shaft_r, geometry.shaft_length, 12]} />
      <T.MeshStandardMaterial {color} />
    </T.Mesh>
  {/if}
  {#if geometry.head_length > 0}
    <T.Mesh {...rest} position={[0, geometry.head_center, 0]}>
      <T.ConeGeometry args={[head_r, geometry.head_length, 12]} />
      <T.MeshStandardMaterial {color} />
    </T.Mesh>
  {/if}
</T.Group>
