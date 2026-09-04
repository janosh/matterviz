<script lang="ts">
  // Translucent (hkl) lattice planes clipped to the unit cell, with opaque outlines so
  // overlapping planes stay legible (same treatment as the mirror planes in SymmetryElements).
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { dispose_on_change, positions_geometry } from '$lib/scene/geometry.svelte'
  import { T } from '@threlte/core'
  import { DoubleSide } from 'three/webgpu'
  import type { LatticePlane } from './lattice-planes'
  import {
    lattice_plane_polygons,
    polygon_edge_vertices,
    polygon_fan_vertices,
    tile_lattice_planes,
  } from './lattice-planes'

  let {
    planes,
    lattice,
    tiling = [1, 1, 1],
  }: {
    planes: LatticePlane[]
    lattice: Matrix3x3
    // Unit cells the rendered structure spans along a/b/c. Planes are a property of the
    // crystal, not of one cell, so they carry on through the whole tiled block.
    tiling?: Vec3
  } = $props()

  let tile_counts = $derived(tiling.map((count) => Math.max(1, Math.floor(count))) as Vec3)
  let block_lattice = $derived(math.scale_lattice_matrix(lattice, tile_counts))
  let block_planes = $derived(tile_lattice_planes(planes, tile_counts))

  const DEFAULT_COLOR = `#f28e2b`
  const DEFAULT_OPACITY = 0.3
  const EDGE_OPACITY = 0.9

  // One fill mesh (fan-triangulated) and one outline per plane family
  const groups = $derived(
    block_planes.map((plane) => {
      const polygons = lattice_plane_polygons(plane, block_lattice).map(
        ({ polygon }) => polygon,
      )
      const fill_geometry = positions_geometry(polygons.flatMap(polygon_fan_vertices).flat())
      fill_geometry.computeVertexNormals()
      return {
        fill_geometry,
        edge_geometry: positions_geometry(polygons.flatMap(polygon_edge_vertices).flat()),
        color: plane.color ?? DEFAULT_COLOR,
        opacity: plane.opacity ?? DEFAULT_OPACITY,
      }
    }),
  )
  dispose_on_change(() =>
    groups.flatMap((group) => [group.fill_geometry, group.edge_geometry]),
  )
</script>

{#each groups as { fill_geometry, edge_geometry, color, opacity }, idx (idx)}
  <T.Mesh geometry={fill_geometry}>
    <T.MeshStandardMaterial
      {color}
      transparent
      {opacity}
      side={DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
  <T.LineSegments geometry={edge_geometry}>
    <T.LineBasicMaterial {color} transparent opacity={EDGE_OPACITY} />
  </T.LineSegments>
{/each}
