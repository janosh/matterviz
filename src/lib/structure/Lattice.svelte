<script lang="ts">
  import { AXIS_COLORS } from '$lib/colors'
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { dispose_on_change } from '$lib/scene/geometry.svelte'
  import { CanvasTooltip } from '$lib/structure'
  import { write_bond_transform } from '$lib/structure/bond-rendering'
  import { supercell_grid_edges } from '$lib/structure/supercell'
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
    tiling = [1, 1, 1],
    cell_edge_color = DEFAULTS.structure.cell_edge_color,
    cell_surface_color = DEFAULTS.structure.cell_surface_color,
    cell_edge_width = DEFAULTS.structure.cell_edge_width,
    cell_edge_opacity = DEFAULTS.structure.cell_edge_opacity,
    cell_surface_opacity = DEFAULTS.structure.cell_surface_opacity,
    show_cell_vectors = true,
  }: {
    matrix?: math.Matrix3x3
    // How many copies of `matrix` the rendered structure spans along a/b/c. Above 1x1x1 the
    // whole tiled block is outlined and the origin cell is drawn more strongly than the rest.
    tiling?: Vec3
    cell_edge_color?: string
    cell_surface_color?: string
    cell_edge_width?: number // thickness of the cell edges
    cell_edge_opacity?: number // opacity of the cell edges
    cell_surface_opacity?: number // opacity of the cell surfaces
    show_cell_vectors?: boolean // whether to show the lattice vectors
  } = $props()

  // Lattice vector arrows all start from this corner, just outside the cell, in the same a/b/c
  // colors as the orientation gizmo and the rotation sliders
  const VECTOR_ORIGIN: Vec3 = [-1, -1, -1]
  // Emphasize the origin cell relative to the tiled block.
  const TILE_EDGE_DIM = 0.45
  const TILE_EDGE_THINNING = 0.6
  // Lift toward opaque instead of multiplying opacity, which would saturate.
  const ORIGIN_SURFACE_LIFT = 0.18
  const BLOCK_SURFACE_DIM = 0.5

  const { invalidate } = useThrelte()
  let hovered_idx = $state<number | null>(null) // track hovered vector
  // Body diagonal midpoint: where a box built on these cell vectors from the origin is centered
  const cell_center = (cell: math.Matrix3x3 | null): Vec3 =>
    cell ? math.scale(math.add(...cell), 0.5) : [0, 0, 0]

  // Via the string so callers handing over a fresh [1,1,1] every trajectory frame don't churn
  // the derived arrays below (and with them the tile mesh) on an unchanged tiling
  let tiling_key = $derived(tiling.map((count) => Math.max(1, Math.floor(count))).join(`,`))
  let tile_counts: Vec3 = $derived(tiling_key.split(`,`).map(Number) as Vec3)
  let n_tiles = $derived(tile_counts[0] * tile_counts[1] * tile_counts[2])
  // Cell vectors of the whole tiled block
  let block_matrix: math.Matrix3x3 | null = $derived(
    matrix ? math.scale_lattice_matrix(matrix, tile_counts) : null,
  )
  let lattice_center: Vec3 = $derived(cell_center(matrix ?? null))
  let block_center: Vec3 = $derived(cell_center(block_matrix))

  let tile_edges = $derived(supercell_grid_edges(tile_counts))

  const make_box_geometry = (cell: math.Matrix3x3) =>
    new BoxGeometry(1, 1, 1).applyMatrix4(
      new Matrix4().makeBasis(
        new Vector3(...cell[0]),
        new Vector3(...cell[1]),
        new Vector3(...cell[2]),
      ),
    )

  // Gate geometry rebuilds on cell numbers, not matrix identity (trajectory frames hand over
  // a fresh matrix object every step)
  let matrix_key = $derived(matrix?.flat().join(`,`) ?? ``)
  const box_geometry = $derived.by(() => {
    void matrix_key
    const cell = untrack(() => matrix)
    return cell ? make_box_geometry(cell) : null
  })
  const block_geometry = $derived.by(() => {
    void matrix_key
    void tiling_key
    const cell = untrack(() => block_matrix)
    return cell && untrack(() => n_tiles) !== 1 ? make_box_geometry(cell) : null
  })
  dispose_on_change(() => [box_geometry])
  dispose_on_change(() => [block_geometry])

  // All 12 edges in ONE InstancedMesh (one unit cylinder, one material) instead of a
  // geometry + material per edge. Edges never take pointer events, so skip raycasting.
  const EDGE_COUNT = 12
  const edge_geometry = new CylinderGeometry(1, 1, 1, 8)
  const edge_material = new MeshStandardMaterial()
  const edge_mesh = new InstancedMesh(edge_geometry, edge_material, EDGE_COUNT)
  edge_mesh.frustumCulled = false
  edge_mesh.raycast = () => undefined
  // Faint copy of the same cylinder for every other tile boundary
  const tile_material = new MeshStandardMaterial()
  $effect(() => () => {
    edge_mesh.dispose()
    edge_geometry.dispose()
    edge_material.dispose()
    tile_material.dispose()
  })

  // The instance count is fixed at construction, so the tile mesh is rebuilt when the tiling
  // changes — not when the matrix does, which would mean a new mesh every trajectory frame
  let tile_mesh = $state<InstancedMesh | null>(null)
  $effect(() => {
    const count = tile_edges.length
    if (count === 0) {
      tile_mesh = null
      return
    }
    const mesh = new InstancedMesh(edge_geometry, tile_material, count)
    mesh.frustumCulled = false
    mesh.raycast = () => undefined
    tile_mesh = mesh
    return () => mesh.dispose()
  })

  // The origin cell's own 12 edges: for each cell vector, the four edges parallel to it start
  // at the corners spanned by the other two vectors
  $effect(() => {
    void matrix_key
    const cell = untrack(() => matrix)
    if (!cell) return
    const [buffer, radius] = [edge_mesh.instanceMatrix.array, cell_edge_width * 0.01]
    let edge_idx = 0
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
  // tile_mesh is rebuilt whenever tile_edges changes, so tracking the mesh tracks the edges
  $effect(() => {
    void matrix_key
    const [cell, mesh] = [untrack(() => matrix), tile_mesh]
    if (!cell || !mesh) return
    const radius = cell_edge_width * 0.01 * TILE_EDGE_THINNING
    const buffer = mesh.instanceMatrix.array
    const to_cart = math.create_frac_to_cart(cell)
    for (const [edge_idx, [cell_indices, axis, span]] of untrack(() => tile_edges).entries()) {
      const start = to_cart(cell_indices)
      const end = math.add(start, math.scale(cell[axis], span))
      write_bond_transform(buffer, edge_idx, start, end, radius)
    }
    mesh.instanceMatrix.needsUpdate = true
    invalidate()
  })
  $effect(() => {
    for (const [material, opacity] of [
      [edge_material, cell_edge_opacity],
      [tile_material, cell_edge_opacity * TILE_EDGE_DIM],
    ] as const) {
      material.color.set(cell_edge_color)
      material.opacity = opacity
      material.transparent = opacity < 1
      material.depthWrite = opacity >= 1
      material.needsUpdate = true
    }
    edge_mesh.visible = cell_edge_opacity > 0
    if (tile_mesh) tile_mesh.visible = cell_edge_opacity > 0
    invalidate()
  })
</script>

{#if matrix && box_geometry}
  <!-- dispose={false}: the mesh outlives re-renders and is disposed with this component -->
  <T is={edge_mesh} dispose={false} />
  {#if tile_mesh}
    <T is={tile_mesh} dispose={false} />
  {/if}

  <!-- Render transparent surfaces if surface opacity > 0 -->
  {#if cell_surface_opacity > 0}
    {@const tiled = n_tiles > 1}
    {#if tiled && block_geometry}
      <T.Mesh geometry={block_geometry} position={block_center}>
        <T.MeshStandardMaterial
          color={cell_surface_color}
          opacity={cell_surface_opacity * BLOCK_SURFACE_DIM}
          transparent
          depthWrite={false}
        />
      </T.Mesh>
    {/if}
    <T.Mesh geometry={box_geometry} position={lattice_center}>
      <T.MeshStandardMaterial
        color={cell_surface_color}
        opacity={tiled
          ? cell_surface_opacity + (1 - cell_surface_opacity) * ORIGIN_SURFACE_LIFT
          : cell_surface_opacity}
        transparent
        depthWrite={false}
      />
    </T.Mesh>
  {/if}

  {#if show_cell_vectors}
    <!-- Stable A/B/C slot keys preserve Arrow instances; vector props update reactively. -->
    {#each matrix as vec, idx (idx)}
      <Arrow
        position={VECTOR_ORIGIN}
        vector={vec}
        scale={0.5}
        color={AXIS_COLORS[idx][hovered_idx === idx ? 2 : 1]}
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
      {@const tooltip_position = math.add(VECTOR_ORIGIN, hovered_vec)}
      <CanvasTooltip position={tooltip_position}>
        <strong>{[`A`, `B`, `C`][hovered_idx]}</strong>
        ({hovered_vec.map((coord) => format_num(coord, `.2f`)).join(`, `)}) Å
      </CanvasTooltip>
    {/if}
  {/if}
{/if}
