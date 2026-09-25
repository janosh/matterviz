<script lang="ts" module>
  import type { Vec3 } from '$lib/math'

  // One instance of a shared unit sphere: scene position, uniform scale and color
  export interface PointInstanceSpec {
    position: Vec3
    radius: number
    color: string
  }
  // Instance pointer events carry the hit `instanceId`, the index into `items`
  export type InstanceEvent = { instanceId?: number; nativeEvent?: Event }
</script>

<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import {
    Color,
    InstancedMesh,
    type Material,
    Matrix4,
    type SphereGeometry,
  } from 'three/webgpu'

  // One InstancedMesh for many spheres sharing a caller-owned geometry and material
  let {
    items,
    geometry,
    material,
    ...pointer_props
  }: {
    items: readonly PointInstanceSpec[]
    geometry: SphereGeometry
    material: Material
    onpointerenter?: (event: InstanceEvent) => void
    onpointerleave?: (event: InstanceEvent) => void
    onclick?: (event: InstanceEvent) => void
  } = $props()

  const { invalidate } = useThrelte()
  const scratch_matrix = new Matrix4()
  const scratch_color = new Color()
  // A new mesh only when the instance count, geometry or material changes; buffers refill
  // only when `items` change, so an idle on-demand scene stops rendering
  const count = $derived(items.length)
  const mesh = $derived(new InstancedMesh(geometry, material, count))
  $effect(() => {
    const current = mesh
    return () => current.dispose() // frees only the instance buffers
  })
  $effect(() => {
    for (const [idx, { position, radius, color }] of items.entries()) {
      scratch_matrix.makeScale(radius, radius, radius).setPosition(...position)
      mesh.setMatrixAt(idx, scratch_matrix)
      mesh.setColorAt(idx, scratch_color.set(color))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere() // exact bounds for frustum culling and raycasting
    invalidate()
  })
</script>

{#if count > 0}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
