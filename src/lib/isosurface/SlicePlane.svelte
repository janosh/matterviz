<script lang="ts">
  // Marks where a 2D cross-section cuts a 3D view: the convex polygon of the plane clipped
  // to the cell as a translucent fill with a closed outline (same look as the Fermi slice
  // plane). Pass e.g. slice_cell_polygon() of the sampled plane.
  import type { Vec3 } from '#lib/math.js'
  import { dispose_on_change, positions_geometry } from '#lib/scene/geometry.svelte.js'
  import { T } from '@threlte/core'
  import { DoubleSide } from 'three/webgpu'

  let {
    polygon,
    color = `#f59e0b`,
    opacity = 0.4,
  }: {
    polygon: Vec3[] // convex polygon corners in order (fewer than 3 draws nothing)
    color?: string
    opacity?: number // of the fill; the outline stays opaque
  } = $props()

  const geometries = $derived.by(() => {
    if (polygon.length < 3) return null
    // corners plus the first again: the outline is a Line closed by hand, as WebGPURenderer
    // does not support LineLoop; the fill's fan index never reaches the repeated corner
    const fill = positions_geometry([...polygon, polygon[0]].flat())
    fill.setIndex(polygon.slice(2).flatMap((_, idx) => [0, idx + 1, idx + 2]))
    const outline = positions_geometry([...polygon, polygon[0]].flat())
    return { fill, outline }
  })
  dispose_on_change(() => [geometries?.fill, geometries?.outline])
</script>

<!-- Drawn after other translucent geometry without writing depth, so isosurfaces behind the
plane stay visible through it -->
{#if geometries}
  <T.Mesh geometry={geometries.fill} renderOrder={1000}>
    <T.MeshBasicMaterial {color} transparent {opacity} side={DoubleSide} depthWrite={false} />
  </T.Mesh>
  <T.Line geometry={geometries.outline}>
    <T.LineBasicMaterial {color} />
  </T.Line>
{/if}
