<script lang="ts">
  import { grow_capacity } from '$lib/math'
  // Instanced arrows (shaft cylinders + head cones) for per-site vector layers
  // (forces, magnetic moments, ...). Replaces one <Arrow> component per site
  // (2 meshes + 2 geometries + 2 materials each) with 2 draw calls per layer.
  // Uses the same sizing conventions as Arrow.svelte.
  import type { ArrowColumns } from './arrow-instances'
  import { ArrowMesh, arrow_material } from './arrow-mesh'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import { ConeGeometry, CylinderGeometry } from 'three/webgpu'

  let { arrows }: { arrows: ArrowColumns } = $props()
  const placements = $derived(arrows.placements)

  const { invalidate } = useThrelte()

  // Unit primitives scaled per instance: cylinder radius/length via (x=r, y=len, z=r)
  const geometries = [new CylinderGeometry(1, 1, 1, 12), new ConeGeometry(1, 1, 12)]
  const materials = [arrow_material(0), arrow_material(1)]

  // Grow geometrically (three caches TSL by mesh uuid); shrink via mesh.count.
  let meshes = $state.raw<ArrowMesh[]>([])
  // Geometry and material outlive retired meshes; dispose them only on unmount.
  $effect(() => () => {
    for (const mesh of meshes) mesh.dispose()
    for (const geometry of geometries) geometry.dispose()
    for (const { material } of materials) material.dispose()
  })

  $effect(() => {
    const { count, dimensions } = placements
    let current = untrack(() => meshes)
    const capacity = current[0]?.origins.count ?? 0
    if (count > capacity) {
      for (const mesh of current) mesh.dispose()
      const next_capacity = grow_capacity(capacity, count)
      const shafts = new ArrowMesh(geometries[0], materials[0].material, next_capacity)
      current = [
        shafts,
        new ArrowMesh(geometries[1], materials[1].material, next_capacity, shafts),
      ]
      meshes = current
    }
    if (!current.length) return
    current[0].upload(placements)
    for (const [part, mesh] of current.entries()) {
      mesh.part = part
      mesh.dimensions = [...dimensions]
      mesh.count = count
      mesh.geometry.instanceCount = count
      materials[part].dimensions.value.set(...dimensions)
    }
    invalidate()
  })

  $effect(() => {
    const [mesh] = meshes
    if (mesh?.update_colors(arrows.colors)) invalidate()
  })
</script>

{#each meshes as mesh, idx (idx)}
  <T is={mesh} dispose={false} />
{/each}
