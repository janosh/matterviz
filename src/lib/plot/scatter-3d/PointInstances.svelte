<script lang="ts">
  import { T, useThrelte } from '@threlte/core'
  import type { InstancedMesh, Material, SphereGeometry } from 'three/webgpu'
  import { untrack } from 'svelte'
  import { type PointInstanceSpec, sync_point_mesh } from './point-mesh'

  // Instance pointer events carry the hit `instanceId`, the index into `items`
  type InstanceEvent = { instanceId?: number; nativeEvent?: Event }

  // One InstancedMesh for many spheres sharing a geometry and material (both owned by the
  // caller). Instance buffers upload only when `items` change.
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
  let mesh = $state.raw<InstancedMesh | null>(null)
  $effect(() => {
    const next_items = items
    const [next_geometry, next_material] = [geometry, material]
    mesh = untrack(() => sync_point_mesh(mesh, next_geometry, next_material, next_items))
    invalidate()
  })
  // The caller owns geometry and material; only the instance buffers are ours
  $effect(() => () => mesh?.dispose())
</script>

{#if mesh}
  <T is={mesh} {...pointer_props} dispose={false} />
{/if}
