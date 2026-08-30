<script lang="ts">
  // Translucent (hkl) lattice planes clipped to the unit cell, with opaque outlines so
  // overlapping planes stay legible (same treatment as the mirror planes in SymmetryElements).
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import { polygon_edge_vertices, polygon_fan_vertices } from '$lib/symmetry/symmetry-elements'
  import { T } from '@threlte/core'
  import { BufferAttribute, BufferGeometry, DoubleSide } from 'three/webgpu'
  import type { LatticePlane } from './lattice-planes'
  import { lattice_plane_polygons } from './lattice-planes'

  let { planes, lattice }: { planes: LatticePlane[]; lattice: Matrix3x3 } = $props()

  const DEFAULT_COLOR = `#f28e2b`
  const DEFAULT_OPACITY = 0.3
  const EDGE_OPACITY = 0.9

  const positions_geometry = (vertices: Vec3[]): BufferGeometry => {
    const positions = new Float32Array(vertices.flat())
    return new BufferGeometry().setAttribute(`position`, new BufferAttribute(positions, 3))
  }

  // One fill mesh (fan-triangulated) and one outline per plane family
  const groups = $derived(
    planes.map((plane) => {
      const polygons = lattice_plane_polygons(plane, lattice).map(({ polygon }) => polygon)
      const fill_geometry = positions_geometry(polygons.flatMap(polygon_fan_vertices))
      fill_geometry.computeVertexNormals()
      return {
        fill_geometry,
        edge_geometry: positions_geometry(polygons.flatMap(polygon_edge_vertices)),
        color: plane.color ?? DEFAULT_COLOR,
        opacity: plane.opacity ?? DEFAULT_OPACITY,
      }
    }),
  )
  // read `groups` in the effect body (not only in the cleanup) so each rebuild disposes the
  // previous geometries rather than leaking them until unmount
  $effect(() => {
    const geometries = groups.flatMap((group) => [group.fill_geometry, group.edge_geometry])
    return () => geometries.forEach((geometry) => geometry.dispose())
  })
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
