<script lang="ts">
  import { add, scale, type Vector } from '$lib'
  import { T } from '@threlte/core'
  import { InstancedMesh } from '@threlte/extras'
  import { BoxGeometry, Matrix4, Vector3 } from 'three'
  import Bond from './Bond.svelte'

  interface Props {
    matrix?: [Vector, Vector, Vector] | undefined
    show_cell?: `surface` | `wireframe` | null
    // see https://threejs.org/docs/#api/en/materials/MeshBasicMaterial.wireframe
    cell_color?: string
    // thickness of the wireframe lines that indicate the lattice's unit cell
    // due to limitations of OpenGL with WebGL renderer, on most platforms linewidth will be 1 regardless of set value
    cell_line_width?: number
    // cell opacity
    cell_opacity?: number | undefined
    // whether to show the lattice vectors
    show_vectors?: boolean
    // lattice vector colors
    vector_colors?: [string, string, string]
    // lattice vector origin (all arrows start from this point)
    vector_origin?: Vector
  }
  let {
    matrix = undefined,
    show_cell = `wireframe`,
    cell_color = `white`,
    cell_line_width = 1,
    cell_opacity = show_cell == `surface` ? 0.2 : 0.4,
    show_vectors = true,
    vector_colors = [`red`, `green`, `blue`],
    vector_origin = [-1, -1, -1],
  }: Props = $props()

  let lattice_center = $derived(scale(add(...(matrix ?? [])), 0.5))
</script>

{#if matrix}
  {#key matrix}
    {#if show_cell}
      {@const shear_matrix = new Matrix4().makeBasis(
        ...matrix.map((vec) => new Vector3(...vec, 0)),
      )}
      {@const geometry = new BoxGeometry(1, 1, 1).applyMatrix4(shear_matrix)}
      <T.Mesh {geometry} position={lattice_center}>
        <T.MeshBasicMaterial
          color={cell_color}
          opacity={cell_opacity}
          transparent={cell_opacity !== undefined}
          wireframe={show_cell === `wireframe`}
          line_width={cell_line_width}
        />
      </T.Mesh>
    {/if}

    {#if show_vectors}
      <T.Group position={vector_origin}>
        <!-- arrow shafts -->
        <InstancedMesh>
          <T.CylinderGeometry args={[0.1, 0.1, 1, 16]} />
          <T.MeshStandardMaterial />
          {#each matrix as vec, idx (vec)}
            <Bond to={scale(vec, 0.5)} color={vector_colors[idx]} />
          {/each}
        </InstancedMesh>

        <!-- arrow tips -->
        <InstancedMesh>
          <T.MeshStandardMaterial />
          <!-- args=[thickness, length, radial segments] -->
          <T.ConeGeometry args={[0.25, 0.12, 32]} />
          {#each matrix as vec, idx (vec)}
            <Bond to={vec} color={vector_colors[idx]} />
          {/each}
        </InstancedMesh>
      </T.Group>
    {/if}
  {/key}
{/if}
