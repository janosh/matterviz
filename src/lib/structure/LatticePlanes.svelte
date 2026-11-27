<script lang="ts">
  // Translucent (hkl) lattice planes clipped to the displayed block, with opaque outlines so
  // overlapping planes stay legible (same treatment as the mirror planes in SymmetryElements).
  import type { Matrix3x3 } from '#lib/math'
  import * as math from '#lib/math'
  import { dispose_on_change, positions_geometry } from '#lib/scene/geometry.svelte'
  import { T } from '@threlte/core'
  import { DoubleSide } from 'three/webgpu'
  import { untrack } from 'svelte'
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
    supercell = math.IDENTITY_3X3,
  }: {
    planes: LatticePlane[]
    lattice: Matrix3x3 // the cell Miller indices refer to
    // Integer matrix of the rendered supercell (supercell lattice = supercell · lattice).
    // Planes are a property of the crystal, not of one cell, so they carry on through it.
    supercell?: Matrix3x3
  } = $props()

  const supercell_key = $derived(supercell.flat().join(`,`))
  const supercell_matrix = $derived(supercell_key.split(`,`).map(Number))
  // Trajectory frames often supply new arrays with unchanged geometry. Styles stay reactive
  // separately, so changing only a family's color or opacity never replaces its GPU buffers.
  const geometry_key = $derived(
    JSON.stringify([
      lattice.flat().join(`,`),
      supercell_key,
      planes.map(({ hkl, offsets }) => [hkl.join(`,`), offsets?.join(`,`)]),
    ]),
  )

  const DEFAULT_COLOR = `#f28e2b`
  const DEFAULT_OPACITY = 0.3
  const EDGE_OPACITY = 0.9

  // One fill mesh (fan-triangulated) and one outline per plane family
  const groups = $derived.by(() => {
    void geometry_key
    return untrack(() => {
      const matrix = math.mat3x3_from_flat_row_major(supercell_matrix)
      const block_lattice = math.dot(matrix, lattice)
      return tile_lattice_planes(planes, matrix).map((plane) => {
        const polygons = lattice_plane_polygons(plane, block_lattice).map(
          ({ polygon }) => polygon,
        )
        const fill_geometry = positions_geometry(polygons.flatMap(polygon_fan_vertices).flat())
        fill_geometry.computeVertexNormals()
        return {
          fill_geometry,
          edge_geometry: positions_geometry(polygons.flatMap(polygon_edge_vertices).flat()),
        }
      })
    })
  })
  dispose_on_change(() =>
    groups.flatMap((group) => [group.fill_geometry, group.edge_geometry]),
  )
</script>

{#each groups as { fill_geometry, edge_geometry }, idx (idx)}
  {@const color = planes[idx].color ?? DEFAULT_COLOR}
  {@const opacity = planes[idx].opacity ?? DEFAULT_OPACITY}
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
