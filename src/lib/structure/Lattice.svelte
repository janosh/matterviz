<script lang="ts">
  import { add, type Vector } from '$lib'
  import { T } from '@threlte/core'
  import { BufferGeometry, Vector3 } from 'three'

  export let matrix: [Vector, Vector, Vector]
  export let show_cell: 'surface' | 'wireframe' | null = `wireframe`
  // thickness of the wireframe lines that indicate the lattice's unit cell
  // due to limitations of OpenGL with WebGL renderer, on most platforms linewidth will be 1 regardless of set value
  // see https://threejs.org/docs/#api/en/materials/MeshBasicMaterial.wireframe
  export let cell_color: string = `white`
  export let cell_line_width: number = 1
  // cell opacity
  export let cell_opacity: number | undefined = undefined
  // whether to show the lattice vectors
  export let show_vectors: boolean = true
  // lattice vector colors
  export let vector_colors: [string, string, string] = [`red`, `green`, `blue`]
  // lattice vector origin (all arrows start from this point)
  export let vector_origin: Vector = [-1, -1, -1]

  $: [vec_a, vec_b, vec_c] = matrix

  const origin = [0, 0, 0]

  $: points = [
    origin,
    add(origin, vec_a),
    origin,
    add(origin, vec_b),
    origin,
    add(origin, vec_c),
    add(origin, vec_a),
    add(origin, vec_a, vec_b),
    add(origin, vec_a),
    add(origin, vec_a, vec_c),
    add(origin, vec_b),
    add(origin, vec_b, vec_a),
    add(origin, vec_b),
    add(origin, vec_b, vec_c),
    add(origin, vec_c),
    add(origin, vec_c, vec_a),
    add(origin, vec_c),
    add(origin, vec_c, vec_b),
    add(origin, vec_a, vec_b),
    add(origin, vec_a, vec_b, vec_c),
    add(origin, vec_a, vec_c),
    add(origin, vec_a, vec_b, vec_c),
    add(origin, vec_b, vec_c),
    add(origin, vec_a, vec_b, vec_c),
  ]
</script>

{#if show_cell}
  <T.LineSegments
    geometry={new BufferGeometry().setFromPoints(points.map((p) => new Vector3(...p)))}
  >
    <T.LineBasicMaterial
      color={cell_color}
      opacity={cell_opacity}
      linewidth={cell_line_width}
    />
  </T.LineSegments>
{/if}

{#if show_vectors}
  {#each matrix as vec, idx}
    {@const [x, y, z] = vec ?? []}
    <T.Group position={vector_origin}>
      <T.ArrowHelper
        args={[{ x, y, z }, { x: 0, y: 0, z: 0 }, 6, vector_colors[idx], 1, 1, 1]}
      />
    </T.Group>
  {/each}
{/if}
