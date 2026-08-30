<script lang="ts">
  // Translucent (hkl) lattice planes clipped to the unit cell, with opaque outlines so
  // overlapping planes stay legible (same treatment as the mirror planes in SymmetryElements).
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import { dispose_on_change, positions_geometry } from '$lib/scene/geometry.svelte'
  import { T } from '@threlte/core'
  import { DoubleSide } from 'three/webgpu'
  import type { LatticePlane } from './lattice-planes'
  import {
    lattice_plane_polygons,
    polygon_edge_vertices,
    polygon_fan_vertices,
  } from './lattice-planes'

  let { planes, lattice }: { planes: LatticePlane[]; lattice: Matrix3x3 } = $props()

  const DEFAULT_COLOR = `#f28e2b`
  const DEFAULT_OPACITY = 0.3
  const EDGE_OPACITY = 0.9

  // One fill mesh (fan-triangulated) and one outline per plane family. A family with invalid
  // Miller indices (e.g. (000) typed transiently into a bound input) is logged and skipped
  // rather than taking down the whole scene with it.
  const clipped_polygons = (plane: LatticePlane): Vec3[][] | null => {
    try {
      return lattice_plane_polygons(plane, lattice).map(({ polygon }) => polygon)
    } catch (error) {
      console.error(`Skipping lattice plane ${JSON.stringify(plane.hkl)}:`, error)
      return null
    }
  }
  const groups = $derived(
    planes.flatMap((plane) => {
      const polygons = clipped_polygons(plane)
      if (!polygons) return []
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
