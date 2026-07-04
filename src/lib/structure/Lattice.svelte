<!-- Export default values for use in other components -->
<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { CanvasTooltip } from '$lib/structure'
  import Arrow from './Arrow.svelte'
  import Cylinder from './Cylinder.svelte'
  import { T } from '@threlte/core'
  import { BoxGeometry, EdgesGeometry, Matrix4, Vector3 } from 'three'

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

  let hovered_idx = $state<number | null>(null) // track hovered vector
  let lattice_center: Vec3 = $derived(
    matrix ? math.scale(math.add(...matrix), 0.5) : [0, 0, 0],
  )

  // Build the sheared box geometry in an effect so the previous one is disposed on
  // matrix change / unmount (same disposal pattern as the polyhedra in StructureScene).
  let box_geometry = $state<BoxGeometry | null>(null)
  $effect(() => {
    if (!matrix) {
      box_geometry = null
      return
    }
    const shear_matrix = new Matrix4().makeBasis(
      new Vector3(...matrix[0]),
      new Vector3(...matrix[1]),
      new Vector3(...matrix[2]),
    )
    const geo = new BoxGeometry(1, 1, 1).applyMatrix4(shear_matrix)
    box_geometry = geo
    return () => geo.dispose()
  })

  // Edge segments (Cartesian endpoint pairs) from the box geometry; the transient
  // EdgesGeometry is disposed inline since only its extracted positions are kept.
  let edge_segments = $derived.by<[Vec3, Vec3][]>(() => {
    if (!box_geometry || !(cell_edge_opacity > 0)) return []
    const edges_geometry = new EdgesGeometry(box_geometry)
    const positions = edges_geometry.getAttribute(`position`).array as Float32Array
    edges_geometry.dispose()
    const segments: [Vec3, Vec3][] = []
    // each edge is two consecutive xyz triplets (6 floats)
    for (let idx = 0; idx < positions.length; idx += 6) {
      segments.push([
        [positions[idx], positions[idx + 1], positions[idx + 2]],
        [positions[idx + 3], positions[idx + 4], positions[idx + 5]],
      ])
    }
    return segments
  })
</script>

{#if matrix && box_geometry}
  <!-- Wireframe edges (thick lines via cylinders) when edge opacity > 0 -->
  {#if cell_edge_opacity > 0}
    <T.Group position={lattice_center}>
      {#each edge_segments as [start, end], idx (idx)}
        <Cylinder
          from={start}
          to={end}
          thickness={cell_edge_width * 0.01}
          color={cell_edge_color}
          opacity={cell_edge_opacity}
        />
      {/each}
    </T.Group>
  {/if}

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
    {#each matrix as vec, idx (vec)}
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
