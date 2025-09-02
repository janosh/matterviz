<!-- Export default values for use in other components -->
<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import * as math from '$lib/math'
  import { DEFAULTS } from '$lib/settings'
  import { CanvasTooltip } from '$lib/structure'
  import { T } from '@threlte/core'
  import {
    BoxGeometry,
    EdgesGeometry,
    Euler,
    Matrix4,
    Quaternion,
    Vector3,
  } from 'three'

  interface Props {
    matrix?: Matrix3x3 | undefined
    cell_edge_color?: string
    cell_surface_color?: string
    cell_edge_width?: number // thickness of the cell edges
    cell_edge_opacity?: number // opacity of the cell edges
    cell_surface_opacity?: number // opacity of the cell surfaces
    show_cell_vectors?: boolean // whether to show the lattice vectors
    vector_colors?: [string, string, string] // lattice vector colors
    vector_origin?: Vec3 // lattice vector origin (all arrows start from this point)
    float_fmt?: string
  }
  let {
    matrix = undefined,
    cell_edge_color = DEFAULTS.structure.cell_edge_color,
    cell_surface_color = DEFAULTS.structure.cell_surface_color,
    cell_edge_width = DEFAULTS.structure.cell_edge_width,
    cell_edge_opacity = DEFAULTS.structure.cell_edge_opacity,
    cell_surface_opacity = DEFAULTS.structure.cell_surface_opacity,
    show_cell_vectors = true,
    vector_colors = [`red`, `green`, `blue`],
    vector_origin = [-1, -1, -1] as Vec3,
    float_fmt = `.2f`,
  }: Props = $props()

  let hovered_idx = $state<number | null>(null) // track hovered vector
  let lattice_center = $derived(
    matrix ? (math.scale(math.add(...matrix), 0.5) as Vec3) : ([0, 0, 0] as Vec3),
  )

  // Extract line segments from EdgesGeometry for cylinder-based thick lines
  function get_edge_segments(
    edges_geometry: EdgesGeometry,
  ): Array<[Vector3, Vector3]> {
    const positions = edges_geometry.getAttribute(`position`).array as Float32Array
    const segments: Array<[Vector3, Vector3]> = []

    for (let idx = 0; idx < positions.length; idx += 6) {
      const [x1, y1, z1, x2, y2, z2] = positions.slice(idx, idx + 6)
      const start = new Vector3(x1, y1, z1)
      const end = new Vector3(x2, y2, z2)
      segments.push([start, end])
    }

    return segments
  }

  // Calculate cylinder transform for a line segment
  function get_cylinder_transform(
    start: Vector3,
    end: Vector3,
  ): { position: Vec3; rotation: Vec3; length: number } {
    const direction = end.clone().sub(start)
    const length = direction.length()
    const center = start.clone().add(end).multiplyScalar(0.5)

    // Calculate rotation to align cylinder with the line
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0), // cylinder default orientation
      direction.normalize(), // TODO guard against zero-length direction vector
    )
    const euler = new Euler().setFromQuaternion(quaternion)

    return {
      position: center.toArray() as Vec3,
      rotation: euler.toArray().slice(0, 3) as Vec3,
      length,
    }
  }
</script>

{#if matrix}
  {#key matrix}
    {@const shear_matrix = new Matrix4().makeBasis(
    new Vector3(...matrix[0]),
    new Vector3(...matrix[1]),
    new Vector3(...matrix[2]),
  )}
    {@const box_geometry = new BoxGeometry(1, 1, 1).applyMatrix4(shear_matrix)}

    <!-- Render wireframe edges if edge opacity > 0 -->
    {#if cell_edge_opacity > 0}
      {@const edges_geometry = new EdgesGeometry(box_geometry)}
      {@const edge_segments = get_edge_segments(edges_geometry)}

      <!-- Use cylinders for thick wireframe lines -->
      <T.Group position={lattice_center}>
        {#each edge_segments as [start, end], idx (idx)}
          {@const { position, rotation, length } = get_cylinder_transform(start, end)}
          <T.Mesh {position} {rotation}>
            <T.CylinderGeometry
              args={[cell_edge_width * 0.01, cell_edge_width * 0.01, length, 8]}
            />
            <T.MeshStandardMaterial
              color={cell_edge_color}
              opacity={cell_edge_opacity}
              transparent
            />
          </T.Mesh>
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
        />
      </T.Mesh>
    {/if}

    <!-- NOTE below is an untested fix for the lattice vectors being much too small when deployed even though they look correct in local dev -->

    {#if show_cell_vectors}
      <T.Group position={vector_origin}>
        {#each matrix as vec, idx (vec)}
          {@const vector_length = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2)}
          {@const shaft_length = vector_length * 0.85}
          <!-- Shaft goes to 85% of vector length -->
          {@const tip_start_position = math.scale(vec, 0.85) as Vec3}
          <!-- Calculate rotation to align with vector direction -->
          {@const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0), // Default up direction for cylinder/cone
      new Vector3(...vec).normalize(),
    )}
          {@const rotation = new Euler()
      .setFromQuaternion(quaternion)
      .toArray()
      .slice(0, 3) as Vec3}
          <!-- Arrow shaft - position at center of shaft length -->
          {@const shaft_center = math.scale(vec, 0.425) as Vec3}
          <!-- Center at 42.5% = half of 85% -->
          <T.Mesh
            position={shaft_center}
            {rotation}
            onpointerenter={() => hovered_idx = idx}
            onpointerleave={() => hovered_idx = null}
          >
            <T.CylinderGeometry args={[0.05, 0.05, shaft_length, 16]} />
            <T.MeshStandardMaterial color={vector_colors[idx]} />
          </T.Mesh>

          <!-- Arrow tip -->
          <T.Mesh
            position={tip_start_position}
            {rotation}
            onpointerenter={() => hovered_idx = idx}
            onpointerleave={() => hovered_idx = null}
          >
            <T.ConeGeometry args={[0.175, 0.5, 16]} />
            <T.MeshStandardMaterial color={vector_colors[idx]} />
          </T.Mesh>
        {/each}
      </T.Group>

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
  {/key}
{/if}
