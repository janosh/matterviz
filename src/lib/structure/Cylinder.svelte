<script lang="ts">
  import type { Vec3 } from '#lib/math.js'
  import { T } from '@threlte/core'
  import { cylinder_between } from './geometry'

  let {
    from,
    to: target,
    color = `#808080`,
    thickness = 0.1,
  }: {
    from: Vec3
    to: Vec3
    color?: string
    thickness?: number
  } = $props()

  let { position, rotation, length } = $derived(cylinder_between(from, target))
</script>

<T.Mesh {position} {rotation} scale={[thickness, length, thickness]}>
  <T.CylinderGeometry args={[1, 1, 1, 8]} />
  <T.MeshStandardMaterial {color} />
</T.Mesh>
