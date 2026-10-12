<script lang="ts">
  // Marks where a 2D cross-section cuts a 3D view: the plane clipped to the cell (e.g.
  // slice_cell_polygon()) as a translucent fill with a closed outline
  import type { Vec3 } from '#lib/math.js'
  import { dispose_on_change, positions_geometry } from '#lib/scene/geometry.svelte.js'
  import { T } from '@threlte/core'
  import { DoubleSide } from 'three/webgpu'

  // polygon: convex corners in order (fewer than 3 draw nothing)
  let { polygon, color = `#f59e0b` }: { polygon: Vec3[]; color?: string } = $props()
  const opacity = 0.4 // of the fill; the outline stays opaque

  const geometries = $derived.by(() => {
    if (polygon.length < 3) return null
    // first corner repeated to close the outline by hand (WebGPU has no LineLoop); the fill's
    // fan index never reaches it
    const closed = [...polygon, polygon[0]].flat()
    const fill = positions_geometry(closed)
    fill.setIndex(polygon.slice(2).flatMap((_, idx) => [0, idx + 1, idx + 2]))
    return { fill, outline: positions_geometry(closed) }
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
