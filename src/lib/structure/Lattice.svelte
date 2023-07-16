<script lang="ts">
  import { add, scale, type Vector } from '$lib'
  import { T } from '@threlte/core'
  import { InstancedMesh } from '@threlte/extras'
  import { BoxGeometry, Matrix4, Vector3 } from 'three'
  import Bond from './Bond.svelte'

  export let matrix: [Vector, Vector, Vector]
  export let show_cell: 'surface' | 'wireframe' | null = `wireframe`
  // thickness of the wireframe lines that indicate the lattice's unit cell
  // due to limitations of OpenGL with WebGL renderer, on most platforms linewidth will be 1 regardless of set value
  // see https://threejs.org/docs/#api/en/materials/MeshBasicMaterial.wireframe
  export let cell_color: string = `white`
  export let cell_line_width: number = 1
  // cell opacity
  export let cell_opacity: number = 1
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
  // lattice vector colors
  export let vector_colors: [string, string, string] = [`red`, `green`, `blue`]
  // lattice vector origin (all arrows start from this point)
  export let vector_origin: Vector = [-1, -1, -1]

  $: geometry = new BoxGeometry(1, 1, 1)
  $: shear_matrix = new Matrix4().makeBasis(
    ...matrix.map((vec) => new Vector3(...vec, 0))
  )
  $: geometry.applyMatrix4(shear_matrix)
  $: lattice_center = scale(add(...matrix), 0.5)
</script>

{#if show_cell}
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
      {#each matrix as vec, idx}
        <Bond to={scale(vec, 0.5)} color={vector_colors[idx]} />
      {/each}
    </InstancedMesh>

    <!-- arrow tips -->
    <InstancedMesh>
      <T.MeshStandardMaterial />
      <!-- args=[thickness, length, radial segments] -->
      <T.ConeGeometry args={[0.25, 0.12, 32]} />
      {#each matrix as vec, idx}
        <Bond to={vec} color={vector_colors[idx]} />
      {/each}
    </InstancedMesh>
  </T.Group>
{/if}
