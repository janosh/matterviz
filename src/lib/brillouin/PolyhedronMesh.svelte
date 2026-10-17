<script lang="ts">
  // Translucent faces plus cylinder edges of a convex polyhedron: the BZ and IBZ in
  // BrillouinZoneScene and the BZ overlay in FermiSurfaceScene. Owns the face geometry and
  // disposes it when the polyhedron changes or the mesh unmounts.
  import { dispose_on_change, type TouchHoverProps } from '#lib/scene/index.js'
  import Cylinder from '#lib/structure/Cylinder.svelte'
  import { T } from '@threlte/core'
  import { DoubleSide } from 'three/webgpu'
  import { polyhedron_geometry } from './geometry'
  import type { BrillouinZoneData } from './types'

  let {
    polyhedron,
    color,
    opacity,
    edge_color = color,
    edge_width,
    pick_rank = 0,
    ...pointer_props
  }: {
    polyhedron: Pick<BrillouinZoneData, `vertices` | `faces` | `edges`>
    color: string
    opacity: number
    edge_color?: string // defaults to the face color (IBZ wedge)
    edge_width: number // absolute cylinder thickness in 1/Å (see bz_mark_sizes)
    pick_rank?: number // hover priority over other meshes on the pointer ray (see front_hit)
  } & Partial<TouchHoverProps> = $props() // hover handlers forwarded to the face mesh

  const geometry = $derived(polyhedron_geometry(polyhedron.vertices, polyhedron.faces))
  dispose_on_change(() => [geometry])
</script>

<!-- Faces can be absent (all degenerate); the edges still outline the polyhedron -->
{#if geometry}
  <T.Mesh {geometry} {...pointer_props} userData={{ pick_rank }}>
    <T.MeshStandardMaterial
      {color}
      transparent
      {opacity}
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
{/if}
{#each polyhedron.edges as [from, target], edge_idx (edge_idx)}
  <Cylinder {from} to={target} thickness={edge_width} color={edge_color} />
{/each}
