<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import { T } from '@threlte/core'
  import type { ComponentProps } from 'svelte'
  import { cylinder_between } from './geometry'

  let {
    from,
    to,
    color = `#808080`,
    thickness = 0.1,
    opacity = 1,
    ...rest
  }: ComponentProps<typeof T.Mesh> & {
    from: Vec3
    to: Vec3
    color?: string
    thickness?: number
    opacity?: number // < 1 renders semi/fully transparent (e.g. invisible hover proxies)
  } = $props()

  let { position, rotation, length } = $derived(cylinder_between(from, to))
</script>

<T.Mesh {...rest} {position} {rotation} scale={[thickness, length, thickness]}>
  <T.CylinderGeometry args={[1, 1, 1, 8]} />
  <T.MeshStandardMaterial
    {color}
    transparent={opacity < 1}
    {opacity}
    depthWrite={opacity >= 1}
  />
</T.Mesh>
