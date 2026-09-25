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
  import { untrack } from 'svelte'

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
  let mesh = $state.raw<InstancedMesh | null>(null)
  // Buffers upload only when `items` change, so an idle on-demand scene stops rendering. The
  // mesh is reused while it has room.
  $effect(() => {
    const previous = untrack(() => mesh)
    const reuse = previous && previous.instanceMatrix.count >= items.length
    if (!reuse || items.length === 0) previous?.dispose()
    const target =
      items.length === 0
        ? null
        : reuse
          ? previous
          : new InstancedMesh(geometry, material, items.length)
    if (target) {
      target.geometry = geometry
      target.material = material
      for (const [idx, { position, radius, color }] of items.entries()) {
        scratch_matrix.makeScale(radius, radius, radius).setPosition(...position)
        target.setMatrixAt(idx, scratch_matrix)
        target.setColorAt(idx, scratch_color.set(color))
      }
      target.count = items.length
      target.instanceMatrix.needsUpdate = true
      if (target.instanceColor) target.instanceColor.needsUpdate = true
      target.computeBoundingSphere() // exact bounds for frustum culling and raycasting
    }
    mesh = target
    invalidate()
  })
  $effect(() => () => mesh?.dispose()) // frees only the instance buffers
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
