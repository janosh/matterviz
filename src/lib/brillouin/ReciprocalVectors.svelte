<script lang="ts">
  // Reciprocal lattice vector arrows (b₁, b₂, b₃) with HTML labels beyond the tips, shared by BrillouinZoneScene and FermiSurfaceScene
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import Arrow from '$lib/structure/Arrow.svelte'
  import * as extras from '@threlte/extras'

  let {
    k_lattice,
    vector_scale = 1.0,
    size = 1,
  }: {
    k_lattice: Matrix3x3
    vector_scale?: number
    size?: number // characteristic scene size used to scale arrow proportions
  } = $props()

  const vector_colors = [`red`, `green`, `blue`]
  const vector_labels = [`b₁`, `b₂`, `b₃`]
</script>

{#each k_lattice as vec, idx (idx)}
  {@const scaled_vec = vec.map((coord) => coord * vector_scale) as Vec3}
  {@const label_position = scaled_vec.map((coord) => coord * 1.15) as Vec3}
  <Arrow
    position={[0, 0, 0]}
    vector={scaled_vec}
    color={vector_colors[idx]}
    scale={1}
    shaft_radius={size * 0.008}
    arrow_head_radius={size * 0.028}
    arrow_head_length={-0.1}
  />
  <!-- Vector label beyond tip -->
  <extras.HTML center position={label_position}>
    <span style:color={vector_colors[idx]} style:font-size="1.2em">
      {vector_labels[idx]}
    </span>
  </extras.HTML>
{/each}
