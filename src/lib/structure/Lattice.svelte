<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { CanvasTooltip } from '$lib/structure'
  import { write_bond_transform } from '$lib/structure/bond-rendering'
  import Arrow from './Arrow.svelte'
  import { T, useThrelte } from '@threlte/core'
  import { untrack } from 'svelte'
  import {
    BoxGeometry,
    CylinderGeometry,
    InstancedMesh,
    Matrix4,
    MeshStandardMaterial,
    Vector3,
  } from 'three/webgpu'

  let {
    matrix = undefined,
    cell_edge_color = DEFAULTS.structure.cell_edge_color,
    cell_surface_color = DEFAULTS.structure.cell_surface_color,
    cell_edge_width = DEFAULTS.structure.cell_edge_width,
    cell_edge_opacity = DEFAULTS.structure.cell_edge_opacity,
    cell_surface_opacity = DEFAULTS.structure.cell_surface_opacity,
    show_cell_vectors = true,
    vector_colors = [`red`, `green`, `blue`],
    vector_origin = [-1, -1, -1],
    float_fmt = `.2f`,
  }: {
    matrix?: math.Matrix3x3
    cell_edge_color?: string
    cell_surface_color?: string
    cell_edge_width?: number // thickness of the cell edges
    cell_edge_opacity?: number // opacity of the cell edges
    cell_surface_opacity?: number // opacity of the cell surfaces
    show_cell_vectors?: boolean // whether to show the lattice vectors
    vector_colors?: readonly [string, string, string] // lattice vector colors
    vector_origin?: Vec3 // lattice vector origin (all arrows start from this point)
    float_fmt?: string
  } = $props()

  const { invalidate } = useThrelte()
  let hovered_idx = $state<number | null>(null) // track hovered vector
  let lattice_center: Vec3 = $derived(
    matrix ? math.scale(math.add(...matrix), 0.5) : [0, 0, 0],
  )

  // Gate geometry rebuilds on cell numbers, not matrix identity (trajectory frames hand over
  // a fresh matrix object every step)
  let matrix_key = $derived(matrix?.flat().join(`,`) ?? ``)
  let box_geometry = $state<BoxGeometry | null>(null)
  $effect(() => {
    void matrix_key
    const cell = untrack(() => matrix)
    if (!cell) {
      box_geometry = null
      return
    }
    const geo = new BoxGeometry(1, 1, 1).applyMatrix4(
      new Matrix4().makeBasis(
        new Vector3(...cell[0]),
        new Vector3(...cell[1]),
        new Vector3(...cell[2]),
      ),
    )
    box_geometry = geo
    return () => geo.dispose()
  })

  // All 12 edges in ONE InstancedMesh (one unit cylinder, one material) instead of a
  // geometry + material per edge. Edges never take pointer events, so skip raycasting.
  const EDGE_COUNT = 12
  const edge_geometry = new CylinderGeometry(1, 1, 1, 8)
  const edge_material = new MeshStandardMaterial()
  const edge_mesh = new InstancedMesh(edge_geometry, edge_material, EDGE_COUNT)
  edge_mesh.frustumCulled = false
  edge_mesh.raycast = () => undefined
  $effect(() => () => {
    edge_mesh.dispose()
    edge_geometry.dispose()
    edge_material.dispose()
  })
  $effect(() => {
    void matrix_key
    const cell = untrack(() => matrix)
    if (!cell) return
    const radius = cell_edge_width * 0.01
    const buffer = edge_mesh.instanceMatrix.array
    let edge_idx = 0
    // For each cell vector, the four edges parallel to it start at the corners spanned by
    // the other two vectors
    for (const [axis_idx, axis] of cell.entries()) {
      const [side_1, side_2] = cell.filter((_, idx) => idx !== axis_idx)
      for (const [along_1, along_2] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const start = math.add(math.scale(side_1, along_1), math.scale(side_2, along_2))
        write_bond_transform(buffer, edge_idx++, start, math.add(start, axis), radius)
      }
    }
    edge_mesh.instanceMatrix.needsUpdate = true
    invalidate()
  })
  $effect(() => {
    edge_material.color.set(cell_edge_color)
    edge_material.opacity = cell_edge_opacity
    edge_material.transparent = cell_edge_opacity < 1
    edge_material.depthWrite = cell_edge_opacity >= 1
    edge_material.needsUpdate = true
    edge_mesh.visible = cell_edge_opacity > 0
    invalidate()
  })
</script>

{#if matrix && box_geometry}
  <!-- dispose={false}: the mesh outlives re-renders and is disposed with this component -->
  <T is={edge_mesh} dispose={false} />

  <!-- Render transparent surfaces if surface opacity > 0 -->
  {#if cell_surface_opacity > 0}
    <T.Mesh geometry={box_geometry} position={lattice_center}>
      <T.MeshStandardMaterial
        color={cell_surface_color}
        opacity={cell_surface_opacity}
        transparent
        depthWrite={false}
      />
    </T.Mesh>
  {/if}

  {#if show_cell_vectors}
    <!-- Stable A/B/C slot keys preserve Arrow instances; vector props update reactively. -->
    {#each matrix as vec, idx (idx)}
      <Arrow
        position={vector_origin}
        vector={vec}
        scale={0.5}
        color={vector_colors[idx]}
        shaft_radius={0.1}
        arrow_head_radius={0.2}
        arrow_head_length={0.8}
        onpointerenter={() => (hovered_idx = idx)}
        onpointerleave={() => (hovered_idx = null)}
      />
    {/each}

    <!-- Tooltip for hovered vector -->
    {#if hovered_idx !== null && matrix}
      {@const hovered_vec = matrix[hovered_idx]}
      {@const tooltip_position = math.add(vector_origin, hovered_vec)}
      <CanvasTooltip position={tooltip_position}>
        <strong>{[`A`, `B`, `C`][hovered_idx]}</strong>
        ({hovered_vec.map((coord) => format_num(coord, float_fmt)).join(`, `)}) Å
      </CanvasTooltip>
    {/if}
  {/if}
{/if}
