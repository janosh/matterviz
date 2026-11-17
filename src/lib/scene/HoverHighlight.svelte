<script lang="ts">
  // The hover highlight for 3D surfaces: the hovered triangles (`geometry`, or its `faces`)
  // redrawn unlit just in front (polygon offset, no depth writes) in a brightened colour at
  // half opacity, outlined in a darker shade. Render order 100 puts it after transparent
  // layers, before always-on-top markers. The face subset and outline built here are disposed
  // on change and unmount.
  import { T } from '@threlte/core'
  import { type BufferGeometry, DoubleSide } from 'three/webgpu'
  import { brighten_hex, highlight_edge_color } from './colors'
  import {
    boundary_edges,
    dispose_on_change,
    fat_lines,
    triangle_subset,
  } from './geometry.svelte'

  let {
    geometry,
    faces,
    color,
    edges,
  }: {
    geometry: BufferGeometry | null // source triangles, indexed or not
    faces?: readonly number[] // the source triangles to highlight, default all
    color: string // the source's fill colour
    // outline to draw instead of the faces' boundary (line-segment vertex pairs)
    edges?: BufferGeometry
  } = $props()

  const subset = $derived(geometry && faces ? triangle_subset(geometry, faces) : null)
  const fill = $derived(subset ?? geometry)
  const outline = $derived.by(() => {
    const positions = edges
      ? edges.getAttribute(`position`).array
      : geometry && boundary_edges(geometry, faces)
    return positions?.length ? fat_lines(positions, highlight_edge_color(color)) : null
  })
  dispose_on_change(() => [subset])
  dispose_on_change(() => [outline?.geometry, outline?.material])
</script>

{#if fill}
  <T.Mesh geometry={fill} renderOrder={100} name="hover-highlight">
    <T.MeshBasicMaterial
      color={brighten_hex(color)}
      transparent
      opacity={0.5}
      side={DoubleSide}
      depthWrite={false}
      polygonOffset
      polygonOffsetFactor={-1}
      polygonOffsetUnits={-1}
    />
  </T.Mesh>
{/if}
{#if outline}
  <T is={outline} />
{/if}
